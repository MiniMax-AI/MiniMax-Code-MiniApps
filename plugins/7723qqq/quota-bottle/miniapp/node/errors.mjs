// @ts-check

export const ERROR_CODES = Object.freeze([
  'config_invalid',
  'config_unreadable',
  'no_credential',
  'oauth_expired',
  'unauthorized',
  'invalid_credential',
  'missing_credential',
  'api_rejected',
  'quota_exhausted',
  'http_error',
  'network',
  'timeout',
  'invalid_response',
  'no_quota',
  'balance_credential',
  'usage_scan_off',
  'db_missing',
  'db_unreadable',
  'db_schema',
  'db_query_failed',
  'sqlite_unavailable',
  'unknown',
]);

/**
 * Failures a fresh Token Plan login can clear. A rejected credential belongs
 * here: only a new login replaces it, so it is the one remedy worth offering.
 */
export const LOGIN_FIXABLE_CODES = Object.freeze([
  'no_credential',
  'oauth_expired',
  'unauthorized',
  'invalid_credential',
  'missing_credential',
  'config_invalid',
  'config_unreadable',
]);

/**
 * Most actionable first. When several hosts fail differently, the report names
 * the failure the user can act on instead of the last one that happened.
 */
const SPECIFICITY = Object.freeze([
  'invalid_credential',
  'missing_credential',
  'unauthorized',
  'oauth_expired',
  'no_credential',
  'balance_credential',
  'quota_exhausted',
  'api_rejected',
  'http_error',
  'invalid_response',
  'config_invalid',
  'config_unreadable',
  'network',
  'timeout',
  'unknown',
]);

const CODE_SET = new Set(ERROR_CODES);

/** @param {unknown} code */
export function safeErrorCode(code) {
  return typeof code === 'string' && CODE_SET.has(code) ? code : 'unknown';
}

/** @param {unknown} code */
export function isLoginFixable(code) {
  return typeof code === 'string' && LOGIN_FIXABLE_CODES.includes(code);
}

/**
 * Pick the failure worth reporting out of several candidates.
 * @param {string[]} codes
 */
export function pickMostSpecific(codes) {
  let best = 'unknown';
  let bestRank = SPECIFICITY.length;
  for (const code of codes) {
    const rank = SPECIFICITY.indexOf(code);
    const at = rank === -1 ? SPECIFICITY.length : rank;
    if (at < bestRank) {
      best = code;
      bestRank = at;
    }
  }
  return best;
}

export class QuotaError extends Error {
  /** @param {string} code */
  constructor(code) {
    super(safeErrorCode(code));
    this.name = 'QuotaError';
    this.code = safeErrorCode(code);
  }
}
