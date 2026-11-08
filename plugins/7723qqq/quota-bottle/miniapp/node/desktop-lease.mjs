// @ts-check

import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import { dirname, join } from 'node:path';

/**
 * The desktop application keeps its account session in its own process and
 * hands out short-lived leases to other local processes over a named pipe (or
 * a unix socket). This is the supported way for a local tool to act as the
 * signed-in desktop user, and it is how the bottle reads the same quota the
 * desktop's own usage panel shows.
 *
 * The lease is short-lived on purpose: the token is requested per read, is
 * never written to disk by this module, and is never logged.
 */
const CAPABILITY_FILE = 'mcode-auth-lease-v1.cap';
const SOCKET_FILE = 'mcode-auth-lease-v1.sock';
const WINDOWS_PIPE_PREFIX = '\\\\.\\pipe\\mcode-auth-lease-';
const FRAME_PREFIX_BYTES = 4;
const MAX_FRAME_BYTES = 64 * 1024;
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const REQUEST_TIMEOUT_MS = 10_000;
const CONNECT_TIMEOUT_MS = 5_000;

/**
 * @param {string} dataDir
 * @param {NodeJS.Platform} [platform]
 */
export function resolveLeaseEndpoint(dataDir, platform = process.platform) {
  const canonical = dataDir.replace(/[\\/]+$/u, '');
  if (platform === 'win32') {
    const digest = createHash('sha256').update(canonical.toLowerCase()).digest('hex').slice(0, 16);
    return {
      transport: /** @type {'pipe'} */ ('pipe'),
      endpoint: `${WINDOWS_PIPE_PREFIX}${digest}`,
      capabilityFile: join(canonical, 'run', CAPABILITY_FILE),
    };
  }
  return {
    transport: /** @type {'unix'} */ ('unix'),
    endpoint: join(canonical, 'run', SOCKET_FILE),
    capabilityFile: join(canonical, 'run', CAPABILITY_FILE),
  };
}

/**
 * The desktop's data root, inferred from the plugin's own data directory.
 * The lease endpoint lives next to the runtime state, not inside it.
 * @param {string} dataDir
 */
export function resolveDesktopDataRoot(dataDir) {
  let dir = dataDir;
  for (let i = 0; i < 12; i += 1) {
    const parts = dir.split(/[\\/]/u);
    if (parts[parts.length - 1] === 'v2') {
      const parent = dirname(dir);
      if (parent && parent !== dir) return parent;
    }
    const parent = dirname(dir);
    if (!parent || parent === dir) break;
    dir = parent;
  }
  return join(process.env.HOME ?? process.env.USERPROFILE ?? '', '.minimax');
}

/** @param {unknown} value */
function encodeFrame(value) {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  if (payload.length === 0 || payload.length > MAX_FRAME_BYTES) throw new Error('frame too large');
  const prefix = Buffer.allocUnsafe(FRAME_PREFIX_BYTES);
  prefix.writeUInt32BE(payload.length, 0);
  return Buffer.concat([prefix, payload]);
}

/**
 * @param {string} endpoint
 * @param {string} capabilityFile
 * @param {{ requestTimeoutMs?: number, minValidityMs?: number, signal?: AbortSignal }} [options]
 */
export async function requestAuthLease(endpoint, capabilityFile, options = {}) {
  const timeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const minValidityMs = options.minValidityMs ?? timeoutMs;
  const signal = options.signal;
  if (signal?.aborted) return { ok: false, code: 'desktop_unavailable' };
  let capability;
  try {
    capability = (await readFile(capabilityFile, 'utf8')).trim();
  } catch {
    return { ok: false, code: 'desktop_unavailable' };
  }
  if (!CAPABILITY_PATTERN.test(capability)) return { ok: false, code: 'desktop_unavailable' };

  return await new Promise((resolve) => {
    const socket = net.createConnection(endpoint);
    const pending = new Map();
    let buffer = Buffer.alloc(0);
    let settled = false;

    // Declared before `finish` reads it, so an abort during connect, write or wait
    // tears the socket down through the same path as a timeout.
    function onAbort() {
      finish({ ok: false, code: 'desktop_unavailable' });
    }

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      socket.destroy();
      resolve(result);
    };

    const timer = setTimeout(() => finish({ ok: false, code: 'desktop_unavailable' }), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });

    socket.on('error', () => finish({ ok: false, code: 'desktop_unavailable' }));
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= FRAME_PREFIX_BYTES) {
        const length = buffer.readUInt32BE(0);
        if (length === 0 || length > MAX_FRAME_BYTES) {
          finish({ ok: false, code: 'invalid_response' });
          return;
        }
        if (buffer.length < FRAME_PREFIX_BYTES + length) break;
        let frame;
        try {
          frame = JSON.parse(buffer.subarray(FRAME_PREFIX_BYTES, FRAME_PREFIX_BYTES + length).toString('utf8'));
        } catch {
          finish({ ok: false, code: 'invalid_response' });
          return;
        }
        buffer = buffer.subarray(FRAME_PREFIX_BYTES + length);
        const waiter = pending.get(frame?.requestId);
        if (!waiter) continue;
        pending.delete(frame.requestId);
        waiter(frame);
      }
    });

    socket.once('connect', () => {
      const requestId = randomUUID();
      const timer2 = setTimeout(() => {
        pending.delete(requestId);
        finish({ ok: false, code: 'desktop_unavailable' });
      }, timeoutMs);
      pending.set(requestId, (frame) => {
        clearTimeout(timer2);
        if (frame?.ok !== true) {
          const code = frame?.error?.code === 'AUTH_REQUIRED' ? 'desktop_session_expired' : 'desktop_unavailable';
          finish({ ok: false, code });
          return;
        }
        const result = frame.result;
        if (result?.method !== 'lease' || typeof result.accessToken !== 'string' || !result.accessToken) {
          finish({ ok: false, code: 'invalid_response' });
          return;
        }
        finish({
          ok: true,
          accessToken: result.accessToken,
          expiresAtMs: Number(result.expiresAtMs) || 0,
          generation: Number(result.generation) || 0,
        });
      });
      socket.write(encodeFrame({
        version: 1,
        requestId,
        capability,
        method: 'lease',
        minValidityMs: Math.min(5 * 60 * 1000, Math.max(0, minValidityMs)),
      }));
    });
  });
}

/**
 * Ask the desktop for a live session token.
 * @param {{ dataDir: string, env?: NodeJS.ProcessEnv, minValidityMs?: number, signal?: AbortSignal }} options
 * @returns {Promise<{ ok: true, accessToken: string, expiresAtMs: number, generation: number } | { ok: false, code: string }>}
 */
export async function requestDesktopLease(options) {
  const env = options.env ?? process.env;
  const leaseOptions = { signal: options.signal, minValidityMs: options.minValidityMs };
  const explicitEndpoint = env.MCODE_AUTH_BROKER_ENDPOINT?.trim();
  const explicitCapability = env.MCODE_AUTH_BROKER_CAPABILITY_FILE?.trim();
  if (explicitEndpoint && explicitCapability) {
    return await requestAuthLease(explicitEndpoint, explicitCapability, leaseOptions);
  }
  const dataRoot = resolveDesktopDataRoot(options.dataDir);
  const endpoint = resolveLeaseEndpoint(dataRoot);
  return await requestAuthLease(endpoint.endpoint, endpoint.capabilityFile, leaseOptions);
}
