// @ts-check

import { loadQuotaConfig } from './config.mjs';
import { resolveCredentialFromSnapshot } from './auth.mjs';
import { QuotaError, pickMostSpecific } from '../errors.mjs';
import { fetchWithoutRedirect } from '../net.mjs';

const QUOTA_PATH = '/v1/token_plan/remains';

/** @param {string} apiKey */
export function isSecretApiKey(apiKey) {
  return apiKey.startsWith('sk-api-');
}

/** @param {string} baseUrl */
export function quotaEndpoint(baseUrl) {
  return `${baseUrl}${QUOTA_PATH}`;
}

/**
 * Read a signed-in user's Token Plan quota. Account-balance API keys have no
 * total, so they are reported as a fallback condition rather than queried.
 *
 * The request is sent to every candidate host in turn: a credential that one
 * host rejects may belong to the other region, and a host that refuses the
 * credential must not hide a host that accepts it. The failure that gets
 * reported is the one the user can act on.
 * @param {AbortSignal} [signal]
 * @param {{ fetchImpl?: typeof fetch }} [deps]
 */
export async function fetchQuota(signal, deps = {}) {
  const snapshot = await loadQuotaConfig();
  if (!snapshot.ok) throw new QuotaError(snapshot.code);
  const { config } = snapshot;
  const credential = await resolveCredentialFromSnapshot({
    oauth: snapshot.credentials,
    apiKey: snapshot.apiKey,
  }, signal);
  if (credential.method === 'api-key' && isSecretApiKey(credential.token)) {
    throw new QuotaError('balance_credential');
  }
  const hosts = Array.isArray(config.baseUrls) && config.baseUrls.length > 0
    ? config.baseUrls
    : [config.baseUrl];
  /** @type {string[]} */
  const failures = [];
  for (const host of hosts) {
    try {
      return await readQuota(host, credential.token, signal, config.timeout * 1000, deps.fetchImpl);
    } catch (error) {
      if (!(error instanceof QuotaError)) throw error;
      failures.push(error.code);
      // A transport failure says nothing about the host, so another host is
      // not worth trying; a rejected credential might be another host's.
      if (error.code === 'network' || error.code === 'timeout') break;
    }
  }
  throw new QuotaError(pickMostSpecific(failures));
}

/**
 * @param {string} baseUrl
 * @param {string} token
 * @param {AbortSignal} [signal]
 * @param {number} timeoutMs
 * @param {typeof fetch} [fetchImpl]
 */
async function readQuota(baseUrl, token, signal, timeoutMs, fetchImpl) {
  const response = await fetchWithoutRedirect(quotaEndpoint(baseUrl), {
    method: 'GET',
    headers: {
      'User-Agent': 'quota-bottle/1.3.0',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  }, signal, timeoutMs, fetchImpl);
  if (!response.ok) throw new QuotaError(mapStatus(response.status));
  let data;
  try {
    data = await response.json();
  } catch {
    throw new QuotaError('invalid_response');
  }
  const code = data?.base_resp?.status_code;
  if (typeof code === 'number' && code !== 0) throw new QuotaError(mapBaseCode(code));
  return data;
}

/** @param {number} status */
function mapStatus(status) {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429 || status === 402) return 'quota_exhausted';
  if (status === 408 || status === 504) return 'timeout';
  return 'http_error';
}

/**
 * The service answers a refused credential inside a 200 response. Each code
 * means something different, and only one of them is fixed by logging in.
 * @param {number} code
 */
function mapBaseCode(code) {
  if (code === 2049) return 'invalid_credential';
  if (code === 1004) return 'missing_credential';
  if (code === 1028 || code === 1030 || code === 2061) return 'quota_exhausted';
  return 'api_rejected';
}
