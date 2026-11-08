import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { join } from 'node:path';
import test from 'node:test';

import { fetchDesktopSessionQuota } from '../miniapp/node/desktop-session.mjs';
import { requestAuthLease, requestDesktopLease } from '../miniapp/node/desktop-lease.mjs';
import { disposeTemp, tempDir } from './helpers.mjs';

const CAPABILITY = 'a'.repeat(43);

/** @param {unknown} value */
function encodeFrame(value) {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  const prefix = Buffer.allocUnsafe(4);
  prefix.writeUInt32BE(payload.length, 0);
  return Buffer.concat([prefix, payload]);
}

/**
 * A stand-in for the desktop's lease broker: it speaks the same framed
 * protocol over a named pipe (Windows) or a unix socket (elsewhere).
 * @param {{ token: string, status?: string, reject?: boolean }} options
 */
async function startBroker(options) {
  const suffix = Math.random().toString(36).slice(2);
  const endpoint = process.platform === 'win32'
    ? `\\\\.\\pipe\\quota-bottle-test-${suffix}`
    : join(process.env.TMPDIR ?? '/tmp', `quota-bottle-test-${suffix}.sock`);
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const length = buffer.readUInt32BE(0);
        if (buffer.length < 4 + length) break;
        const request = JSON.parse(buffer.subarray(4, 4 + length).toString('utf8'));
        buffer = buffer.subarray(4 + length);
        const reply = options.reject
          ? { version: 1, requestId: request.requestId, ok: false, error: { code: 'AUTH_REQUIRED', message: 'Desktop authentication is required.' } }
          : request.method === 'status'
            ? { version: 1, requestId: request.requestId, ok: true, result: { method: 'status', status: options.status ?? 'authenticated', generation: 7 } }
            : { version: 1, requestId: request.requestId, ok: true, result: { method: 'lease', accessToken: options.token, expiresAtMs: Date.now() + 3_600_000, generation: 7, audience: 'agent-backend', scopes: ['agent.default'] } };
        socket.write(encodeFrame(reply));
      }
    });
  });
  await new Promise((resolve) => server.listen(endpoint, resolve));
  return { endpoint, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** @param {string} dir */
async function writeCapability(dir) {
  const capabilityFile = join(dir, 'mcode-auth-lease-v1.cap');
  await writeFile(capabilityFile, CAPABILITY, 'utf8');
  return capabilityFile;
}

test('the broker hands out a lease over the framed protocol', async () => {
  const dir = await tempDir('quota-lease-');
  const broker = await startBroker({ token: 'mmoat_test_token' });
  try {
    const capabilityFile = await writeCapability(dir);
    const lease = await requestAuthLease(broker.endpoint, capabilityFile);
    assert.equal(lease.ok, true);
    assert.equal(lease.accessToken, 'mmoat_test_token');
    assert.equal(lease.generation, 7);
  } finally {
    await broker.close();
    await disposeTemp(dir);
  }
});

test('a rejected lease is reported, never silently treated as a session', async () => {
  const dir = await tempDir('quota-lease-reject-');
  const broker = await startBroker({ token: '', reject: true });
  try {
    const capabilityFile = await writeCapability(dir);
    const lease = await requestAuthLease(broker.endpoint, capabilityFile);
    assert.equal(lease.ok, false);
    assert.equal(lease.code, 'desktop_session_expired');
  } finally {
    await broker.close();
    await disposeTemp(dir);
  }
});

test('the desktop quota asks the Token Plan endpoint with the leased token and nothing else', async () => {
  const dir = await tempDir('quota-lease-read-');
  const broker = await startBroker({ token: 'mmoat_test_token' });
  try {
    const capabilityFile = await writeCapability(dir);
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ href: String(url), init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          base_resp: { status_code: 0 },
          model_remains: [{ model_name: 'general', current_interval_total_count: 0, current_interval_remaining_percent: 33 }],
        }),
      };
    };
    const result = await fetchDesktopSessionQuota({ dataDir: join(dir, 'x') }, {
      preferredRegion: 'cn',
      fetchImpl,
      env: { MCODE_AUTH_BROKER_ENDPOINT: broker.endpoint, MCODE_AUTH_BROKER_CAPABILITY_FILE: capabilityFile },
    });

    assert.equal(result.region, 'cn');
    assert.equal(result.payload.model_remains[0].current_interval_remaining_percent, 33);
    assert.equal(calls.length, 1);

    const [call] = calls;
    assert.equal(call.href, 'https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains');
    assert.equal(call.init.method, 'GET');
    assert.equal(call.init.headers.Authorization, 'Bearer mmoat_test_token');
    // The desktop sends the group id only when it already knows it, and never
    // signs this request. Neither header belongs here.
    assert.equal(call.init.headers['X-Group-Id'], undefined);
    assert.equal(call.init.headers['x-signature'], undefined);
    assert.equal(call.init.headers.yy, undefined);
    assert.equal(call.init.redirect, 'error');
  } finally {
    await broker.close();
    await disposeTemp(dir);
  }
});

test('the region is discovered from the token, not guessed', async () => {
  const dir = await tempDir('quota-lease-region-');
  const broker = await startBroker({ token: 'mmoat_test_token' });
  try {
    const capabilityFile = await writeCapability(dir);
    const calls = [];
    const fetchImpl = async (url) => {
      const href = String(url);
      calls.push(href);
      if (href.startsWith('https://www.minimaxi.com/')) {
        // A token issued by one region's client is refused by the other one.
        return { ok: true, status: 200, json: async () => ({ base_resp: { status_code: 1004 } }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          base_resp: { status_code: 0 },
          model_remains: [{ model_name: 'general', current_interval_total_count: 0, current_interval_remaining_percent: 61 }],
        }),
      };
    };
    const result = await fetchDesktopSessionQuota({ dataDir: join(dir, 'x') }, {
      preferredRegion: 'cn',
      fetchImpl,
      env: { MCODE_AUTH_BROKER_ENDPOINT: broker.endpoint, MCODE_AUTH_BROKER_CAPABILITY_FILE: capabilityFile },
    });
    assert.equal(result.region, 'global');
    assert.deepEqual(calls, [
      'https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains',
      'https://platform.minimax.io/v1/api/openplatform/coding_plan/remains',
    ]);
  } finally {
    await broker.close();
    await disposeTemp(dir);
  }
});

test('a refusal from both regions is reported as the failure the user can act on', async () => {
  const dir = await tempDir('quota-lease-refused-');
  const broker = await startBroker({ token: 'mmoat_test_token' });
  try {
    const capabilityFile = await writeCapability(dir);
    const result = await fetchDesktopSessionQuota({ dataDir: join(dir, 'x') }, {
      preferredRegion: 'cn',
      fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }),
      env: { MCODE_AUTH_BROKER_ENDPOINT: broker.endpoint, MCODE_AUTH_BROKER_CAPABILITY_FILE: capabilityFile },
    }).then((value) => ({ ok: true, value }), (error) => ({ ok: false, code: error.code }));
    assert.equal(result.ok, false);
    assert.equal(result.code, 'unauthorized');
  } finally {
    await broker.close();
    await disposeTemp(dir);
  }
});

test('the desktop quota reports a signed-out desktop instead of guessing', async () => {
  const dir = await tempDir('quota-lease-signedout-');
  const broker = await startBroker({ token: '', reject: true });
  try {
    const capabilityFile = await writeCapability(dir);
    const result = await fetchDesktopSessionQuota({ dataDir: join(dir, 'x') }, {
      region: 'cn',
      fetchImpl: async () => { throw new Error('should not reach the network'); },
      env: { MCODE_AUTH_BROKER_ENDPOINT: broker.endpoint, MCODE_AUTH_BROKER_CAPABILITY_FILE: capabilityFile },
    }).then((value) => ({ ok: true, value }), (error) => ({ ok: false, code: error.code }));
    assert.equal(result.ok, false);
    assert.equal(result.code, 'desktop_session_expired');
  } finally {
    await broker.close();
    await disposeTemp(dir);
  }
});

test('the lease endpoint falls back to the desktop data root when no override is set', async () => {
  const dir = await tempDir('quota-lease-root-');
  try {
    const lease = await requestDesktopLease({
      dataDir: join(dir, 'v2', 'plugin-data', 'liveboards', 'quota-bottle'),
      env: {},
    });
    assert.equal(lease.ok, false);
    assert.equal(lease.code, 'desktop_unavailable');
  } finally {
    await disposeTemp(dir);
  }
});
