// @ts-check

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

import { QuotaError } from '../errors.mjs';
import { normalizeAbsoluteExpiry, normalizeFlexibleExpiry, normalizePollInterval, normalizeUserCode, normalizeVerificationUrl, oauthRegionForUrl } from '../urls.mjs';
import { OAUTH_CLIENT } from './oauth-client.mjs';

const REQUEST_TIMEOUT_MS = 12_000;

/**
 * Start a device authorization grant. Every value the network returns is
 * validated before it is shown to the user or passed to a browser.
 * @param {'cn' | 'global'} region
 * @param {AbortSignal} [signal]
 */
export async function startDeviceLogin(region, signal) {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('base64url');
  const controller = combinedSignal(signal, REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(OAUTH_CLIENT.deviceCodeUrl(region), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: OAUTH_CLIENT.clientId,
        scope: OAUTH_CLIENT.scopes.join(' '),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
      }),
      signal: controller.signal,
      redirect: 'error',
    });
  } catch {
    throw new QuotaError(signal?.aborted ? 'timeout' : 'network');
  } finally {
    controller.cleanup();
  }
  if (!response.ok) throw new QuotaError(response.status >= 500 ? 'network' : 'api_rejected');
  let data;
  try {
    data = await response.json();
  } catch {
    throw new QuotaError('invalid_response');
  }
  if (data?.state !== state) throw new QuotaError('invalid_response');
  const verificationUri = normalizeVerificationUrl(data.verification_uri, region);
  const userCode = normalizeUserCode(data.user_code);
  const expiresAt = normalizeAbsoluteExpiry(Number(data.expired_in));
  const intervalMs = normalizePollInterval(data.interval);
  if (!verificationUri || !userCode || !expiresAt || !intervalMs) throw new QuotaError('invalid_response');
  return {
    region,
    verifier,
    userCode,
    verificationUri,
    expiresAt,
    intervalMs,
    lastPollAt: 0,
    status: 'pending',
  };
}

/**
 * Poll once. A transient network failure keeps the flow pending; an
 * authorization response is validated before credentials are returned.
 * @param {any} flow
 * @param {AbortSignal} [signal]
 * @param {{ fetchImpl?: typeof fetch }} [deps]
 */
export async function pollDeviceLogin(flow, signal, deps = {}) {
  if (flow.status !== 'pending') return { status: flow.status === 'cancelled' ? 'idle' : flow.status };
  const now = Date.now();
  if (now >= flow.expiresAt) {
    flow.status = 'expired';
    return { status: 'expired' };
  }
  if (now < flow.lastPollAt + flow.intervalMs) return { status: 'pending' };
  flow.lastPollAt = now;
  const controller = combinedSignal(signal, REQUEST_TIMEOUT_MS);
  const run = deps.fetchImpl ?? fetch;
  let response;
  try {
    response = await run(OAUTH_CLIENT.tokenUrl(flow.region), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: OAUTH_CLIENT.clientId,
        user_code: flow.userCode,
        code_verifier: flow.verifier,
      }),
      signal: controller.signal,
      redirect: 'error',
    });
  } catch {
    if (signal?.aborted) {
      flow.status = 'error';
      return { status: 'error' };
    }
    return { status: 'pending' };
  } finally {
    controller.cleanup();
  }
  let data;
  try {
    data = await response.json();
  } catch {
    flow.status = 'error';
    return { status: 'error' };
  }
  // The service has answered with more than one shape: a granted token, a
  // pending grant, and a refused grant. A token is the only thing that makes
  // the flow succeed, and it is recognized by its own presence, so a renamed
  // status field cannot turn a granted login into a failure.
  const token = typeof data?.access_token === 'string' ? data.access_token : '';
  if (response.ok && token) {
    const expiredIn = normalizeFlexibleExpiry(data?.expired_in);
    if (!expiredIn) {
      flow.status = 'error';
      return { status: 'error' };
    }
    flow.status = 'success';
    return {
      status: 'success',
      credentials: {
        access_token: token,
        refresh_token: typeof data.refresh_token === 'string' ? data.refresh_token : '',
        expires_at: new Date(expiredIn).toISOString(),
        region: flow.region,
      },
    };
  }
  const code = typeof data?.error === 'string' ? data.error : typeof data?.status === 'string' ? data.status : '';
  if (code === 'authorization_pending' || code === 'pending') return { status: 'pending' };
  if (code === 'slow_down') {
    flow.intervalMs = Math.min(60_000, flow.intervalMs + 2000);
    return { status: 'pending' };
  }
  flow.status = 'error';
  return { status: 'error' };
}

/**
 * Open the validated verification page using a platform opener. Arguments are
 * passed as an array and the process is never routed through a shell.
 * @param {string} url
 */
export function openBrowser(url) {
  const normalized = normalizeVerificationUrl(url, oauthRegionForUrl(url));
  if (!normalized) return;
  try {
    const command = process.platform === 'win32'
      ? 'explorer.exe'
      : process.platform === 'darwin'
        ? 'open'
        : 'xdg-open';
    const child = spawn(command, [normalized], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // The page shows the same link, so the login can continue by hand.
  }
}

/**
 * @param {AbortSignal} [signal]
 * @param {number} timeoutMs
 */
function combinedSignal(signal, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}
