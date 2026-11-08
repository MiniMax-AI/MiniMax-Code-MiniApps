// @ts-check

import { getConfigPath, updateConfigFile } from './config.mjs';
import { OAUTH_CLIENT } from './oauth-client.mjs';
import { QuotaError } from '../errors.mjs';
import { normalizeFlexibleExpiry } from '../urls.mjs';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;
const REQUEST_TIMEOUT_MS = 10_000;
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
/** @type {Map<string, Promise<string>>} */
const pendingRefreshes = new Map();

/**
 * Write OAuth credentials without dropping unknown fields. The token replaces
 * any API key and sets the region in the CLI's own config.
 * @param {'cn' | 'global'} region
 * @param {Record<string, unknown>} credentials
 * @param {AbortSignal} [signal]
 */
export async function saveOauth(region, credentials, signal) {
  await updateConfigFile((raw) => {
    if (signal?.aborted) throw new Error('aborted');
    delete raw.api_key;
    raw.oauth = { ...credentials, region };
    raw.region = region;
    delete raw.base_url;
  });
}

/**
 * Resolve a credential from the config snapshot supplied by the caller.
 * @param {{ oauth?: (Record<string, unknown> & { configPath?: string }) | null, apiKey?: string }} snapshot
 * @param {AbortSignal} [signal]
 */
export async function resolveCredentialFromSnapshot(snapshot, signal) {
  const oauth = snapshot.oauth;
  if (oauth && typeof oauth.access_token === 'string' && oauth.access_token) {
    const token = await ensureFreshToken(oauth, signal);
    return { token, method: /** @type {'oauth'} */ ('oauth') };
  }
  if (typeof snapshot.apiKey === 'string' && snapshot.apiKey) {
    return { token: snapshot.apiKey, method: /** @type {'api-key'} */ ('api-key') };
  }
  throw new QuotaError('no_credential');
}

/**
 * Refresh and persist a token approaching expiry. Concurrent callers share one
 * network request and one config write.
 * @param {Record<string, unknown> & { configPath?: string }} creds
 * @param {AbortSignal} [signal]
 * @param {{ fetchImpl?: typeof fetch }} [deps]
 */
export async function ensureFreshToken(creds, signal, deps = {}) {
  const expiresAt = new Date(String(creds.expires_at)).getTime();
  const accessToken = String(creds.access_token ?? '');
  const refreshToken = String(creds.refresh_token ?? '');
  if (!refreshToken) {
    if (Number.isFinite(expiresAt) && Date.now() < expiresAt - REFRESH_BUFFER_MS) return accessToken;
    throw new QuotaError('oauth_expired');
  }
  if (Number.isFinite(expiresAt) && Date.now() < expiresAt - REFRESH_BUFFER_MS) return accessToken;
  const region = creds.region === 'cn' || creds.region === 'global' ? creds.region : 'global';
  const key = JSON.stringify([String(creds.configPath ?? getConfigPath()), region, refreshToken]);
  const existing = pendingRefreshes.get(key);
  if (existing && !signal?.aborted) return existing;
  const pending = (async () => {
    const fresh = await refreshAccessToken(refreshToken, region, signal, deps);
    const updated = {
      access_token: fresh.access_token,
      refresh_token: fresh.refresh_token,
      expires_at: fresh.expires_at,
      region,
    };
    if (typeof creds.account === 'string') updated.account = creds.account;
    if (signal?.aborted) throw new QuotaError('timeout');
    await updateConfigFile((raw) => {
      if (signal?.aborted) throw new Error('aborted');
      raw.oauth = updated;
    }, String(creds.configPath ?? getConfigPath()));
    return fresh.access_token;
  })();
  pendingRefreshes.set(key, pending);
  try {
    return await pending;
  } finally {
    if (pendingRefreshes.get(key) === pending) pendingRefreshes.delete(key);
  }
}

/**
 * @param {string} refreshToken
 * @param {'cn' | 'global'} region
 * @param {AbortSignal} [signal]
 * @param {{ fetchImpl?: typeof fetch }} [deps]
 */
async function refreshAccessToken(refreshToken, region, signal, deps = {}) {
  /** @type {string | null} */
  let lastCode = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (signal?.aborted) throw new QuotaError('timeout');
    if (attempt > 0) await delay(RETRY_DELAY_MS * attempt, signal);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const run = deps.fetchImpl ?? fetch;
    try {
      const response = await run(OAUTH_CLIENT.tokenUrl(region), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: OAUTH_CLIENT.clientId,
        }),
        signal: controller.signal,
        redirect: 'error',
      });
      if (response.status === 401 || response.status === 403) throw new QuotaError('oauth_expired');
      if (!response.ok) {
        lastCode = response.status >= 500 ? 'network' : 'api_rejected';
        continue;
      }
      const body = await response.json();
      // A refreshed token is recognized by the token itself, so a renamed
      // status field cannot turn a good refresh into an expired login.
      if (typeof body?.access_token !== 'string' || !body.access_token) {
        throw new QuotaError('oauth_expired');
      }
      const expiredIn = normalizeFlexibleExpiry(body.expired_in);
      if (!expiredIn) throw new QuotaError('invalid_response');
      return {
        access_token: body.access_token,
        refresh_token: typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : refreshToken,
        expires_at: new Date(expiredIn).toISOString(),
      };
    } catch (error) {
      if (error instanceof QuotaError) throw error;
      lastCode = signal?.aborted ? 'timeout' : 'network';
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    }
  }
  throw new QuotaError(lastCode ?? 'network');
}

/** @param {number} ms @param {AbortSignal} [signal] */
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new QuotaError('timeout'));
    let onAbort;
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    onAbort = () => { clearTimeout(timer); reject(new QuotaError('timeout')); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
