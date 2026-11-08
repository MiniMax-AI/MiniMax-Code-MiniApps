// @ts-check

import { OAUTH_HOSTS, OAUTH_VERIFY_ORIGINS, REGIONS } from './auth/constants.mjs';

const API_HOSTS = new Set(['api.minimaxi.com', 'api.minimax.io', 'api.minimax.cn']);
const ACCOUNT_HOSTS = new Set(Object.values(OAUTH_HOSTS).map((host) => new URL(host).hostname));
const ALLOWED_HOSTS = new Set([...API_HOSTS, ...ACCOUNT_HOSTS, '127.0.0.1', 'localhost', '[::1]']);

/**
 * Accept a credential-bearing URL only when it is an HTTPS MiniMax host. A
 * config entry may override the API host; loopback HTTP is allowed only for
 * explicit local testing.
 * @param {unknown} value
 * @param {{ purpose: 'api' | 'account', allowHttpLoopback?: boolean }} options
 */
export function normalizeHttpsUrl(value, options) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password || url.hash || url.search) return null;
  const hostname = url.hostname.toLowerCase();
  const loopback = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
  if (url.protocol === 'http:' && !(loopback && options.allowHttpLoopback === true)) return null;
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (options.purpose === 'api' && !API_HOSTS.has(hostname) && !loopback) return null;
  if (options.purpose === 'account' && !ACCOUNT_HOSTS.has(hostname)) return null;
  if (!ALLOWED_HOSTS.has(hostname) && !loopback) return null;
  return url.origin + url.pathname.replace(/\/+$/, '');
}

/**
 * Accept a verification URL returned by the account service. It must be an
 * HTTPS URL on one of the region's verification origins: the account host, or
 * the platform host the service answers with today.
 * @param {unknown} value
 * @param {'cn' | 'global'} region
 */
export function normalizeVerificationUrl(value, region) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const allowed = OAUTH_VERIFY_ORIGINS[region] ?? [];
  if (url.protocol !== 'https:' || !allowed.includes(url.origin) || url.username || url.password) return null;
  url.hash = '';
  return url.href;
}

/** @param {unknown} value */
export function normalizeUserCode(value) {
  return typeof value === 'string' && /^[A-Za-z0-9-]{4,32}$/.test(value) ? value : null;
}

/** @param {unknown} value */
export function normalizeAbsoluteExpiry(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > Date.now() && value < Date.now() + 24 * 60 * 60 * 1000
    ? value
    : null;
}

/**
 * Read an expiry that may arrive as an absolute timestamp or as a lifetime in
 * seconds. A value below one trillion is a lifetime, so a service that counts
 * down instead of counting to a moment still yields a usable expiry.
 * @param {unknown} value
 */
export function normalizeFlexibleExpiry(value) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  if (number >= 1e12) return normalizeAbsoluteExpiry(number);
  return normalizeAbsoluteExpiry(Date.now() + number * 1000);
}

/** @param {unknown} value */
export function normalizePollInterval(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1000 && value <= 60_000
    ? value
    : null;
}

/**
 * Hosts to try for a quota read, most likely first: the host the region
 * points at, an explicitly configured host, then the other region's host so a
 * stale region setting cannot hide a working credential.
 * @param {'cn' | 'global'} region
 * @param {string | null | undefined} configuredBaseUrl
 */
export function quotaHostCandidates(region, configuredBaseUrl) {
  const configured = normalizeHttpsUrl(configuredBaseUrl, { purpose: 'api', allowHttpLoopback: true });
  const other = region === 'cn' ? 'global' : 'cn';
  const ordered = [REGIONS[region], configured, REGIONS[other]];
  return [...new Set(ordered.filter((host) => typeof host === 'string' && host.length > 0))];
}

/**
 * @param {string} url
 * @returns {'cn' | 'global'}
 */
export function oauthRegionForUrl(url) {
  for (const [region, origins] of Object.entries(OAUTH_VERIFY_ORIGINS)) {
    if (origins.some((origin) => url.startsWith(`${origin}/`))) return /** @type {'cn' | 'global'} */ (region);
  }
  return 'global';
}
