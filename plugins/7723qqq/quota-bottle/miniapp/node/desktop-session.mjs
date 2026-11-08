// @ts-check

import { QuotaError, pickMostSpecific } from './errors.mjs';
import { requestDesktopLease } from './desktop-lease.mjs';
import { fetchWithoutRedirect } from './net.mjs';

/**
 * The desktop keeps its account session in its own process and lends it out
 * over the auth lease. The lease hands back a token and nothing else, so the
 * quota is exactly one request away — and that request needs neither a client
 * signature nor a group lookup.
 *
 * The account's region is a property of the installed client, and the Host
 * does not pass it down: a Mini App process starts with a filtered environment
 * that carries no region. So the region is discovered instead of guessed. The
 * leased token was issued by the client, so only the client's own region will
 * accept it; asking both is how "same region as the client" becomes a fact
 * rather than an assumption.
 */
const OPEN_PLATFORM_ORIGINS = Object.freeze({
  cn: 'https://www.minimaxi.com',
  global: 'https://platform.minimax.io',
});

const TOKEN_PLAN_REMAINS_PATH = '/v1/api/openplatform/coding_plan/remains';
const REQUEST_TIMEOUT_MS = 8_000;
const LEASE_MIN_VALIDITY_MS = 10_000;

/**
 * The client's region first when it is known, the other one second. Order only
 * decides which host is asked first; correctness comes from asking both.
 * @param {'cn' | 'global'} preferred
 * @returns {Array<'cn' | 'global'>}
 */
function regionOrder(preferred) {
  return preferred === 'cn' ? ['cn', 'global'] : ['global', 'cn'];
}

/**
 * Read the Token Plan quota through the desktop's own session.
 *
 * @param {{ dataDir: string }} context
 * @param {{ preferredRegion?: 'cn' | 'global' | null, fetchImpl?: typeof fetch, signal?: AbortSignal, env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<{ payload: any, region: 'cn' | 'global', detail: string }>} throws when no desktop session is usable
 */
export async function fetchDesktopSessionQuota(context, options = {}) {
  const lease = await requestDesktopLease({
    dataDir: context.dataDir,
    env: options.env,
    minValidityMs: LEASE_MIN_VALIDITY_MS,
    signal: options.signal,
  });
  if (!lease.ok) {
    // No desktop session: the desktop is signed out or not running. The caller
    // decides whether another source can still answer.
    throw new QuotaError(lease.code === 'desktop_session_expired' ? 'desktop_session_expired' : 'desktop_unavailable');
  }

  /** @type {string[]} */
  const failures = [];
  for (const region of regionOrder(options.preferredRegion ?? 'cn')) {
    try {
      const payload = await readTokenPlanQuota(region, lease.accessToken, options);
      return { payload, region, detail: 'desktop session' };
    } catch (error) {
      if (!(error instanceof QuotaError)) throw error;
      failures.push(error.code);
    }
  }
  // When every origin failed the same way, that code is the answer; otherwise
  // report the failure the user can act on.
  const code = failures.length > 0 && failures.every((value) => value === failures[0])
    ? failures[0]
    : pickMostSpecific(failures);
  throw new QuotaError(code);
}

/**
 * One credentialed read, shaped exactly like the desktop's own request: a
 * bearer token, no query string, no signature, and `X-Group-Id` only when the
 * group is already known — which makes it optional here too.
 *
 * @param {'cn' | 'global'} region
 * @param {string} accessToken
 * @param {{ fetchImpl?: typeof fetch, signal?: AbortSignal }} options
 */
async function readTokenPlanQuota(region, accessToken, options) {
  const response = await fetchWithoutRedirect(
    `${OPEN_PLATFORM_ORIGINS[region]}${TOKEN_PLAN_REMAINS_PATH}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    },
    options.signal,
    REQUEST_TIMEOUT_MS,
    options.fetchImpl,
  );
  if (!response.ok) {
    throw new QuotaError(response.status === 401 || response.status === 403 ? 'unauthorized' : 'http_error');
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new QuotaError('invalid_response');
  }
  const status = payload?.base_resp?.status_code;
  if (typeof status === 'number' && status !== 0) {
    throw new QuotaError(status === 2049 ? 'invalid_credential' : status === 1004 ? 'missing_credential' : 'api_rejected');
  }
  if (!Array.isArray(payload?.model_remains) || payload.model_remains.length === 0) {
    throw new QuotaError('no_quota');
  }
  return payload;
}
