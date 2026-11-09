// @ts-check

import { QuotaError, safeErrorCode } from './errors.mjs';
import { fetchQuota } from './auth/quota.mjs';

export { QuotaError, safeErrorCode, fetchQuota };

/**
 * Resolve the ambiguous `*_usage_count` field using the server's remaining
 * percentage. Without a percentage the historical "remaining" reading wins.
 * @param {number} reported
 * @param {number} total
 * @param {number | null} remainingPercent
 */
export function resolveCounts(reported, total, remainingPercent) {
  if (!Number.isSafeInteger(reported) || !Number.isSafeInteger(total)) return null;
  if (total <= 0 || reported < 0 || reported > total) return null;
  if (remainingPercent !== null && (!Number.isFinite(remainingPercent) || remainingPercent < 0 || remainingPercent > 100)) return null;

  let remaining = reported;
  if (remainingPercent !== null) {
    const asRemaining = (reported / total) * 100;
    const asUsed = ((total - reported) / total) * 100;
    const remainingGap = Math.abs(asRemaining - remainingPercent);
    const usedGap = Math.abs(asUsed - remainingPercent);
    if (Math.min(remainingGap, usedGap) > 1) return null;
    if (usedGap < remainingGap) remaining = total - reported;
  }
  return { used: total - remaining, remaining, total };
}

/**
 * Compute the manual-total fallback state.
 *
 * Usage above the saved total is a fact about two numbers, not an empty
 * balance, so it is reported as its own state instead of being clamped into a
 * believable-looking zero. The saved total is hand-written, so the state never
 * pretends to be a measured quota.
 * @param {number | null} total
 * @param {number | null} used
 */
export function manualState(total, used) {
  if (total === null) {
    return {
      mode: /** @type {'unset'} */ ('unset'),
      total: null,
      used,
      remaining: null,
      ratio: null,
      percent: null,
      overBudget: false,
      overBy: 0,
    };
  }
  if (used === null) {
    return {
      mode: /** @type {'manual'} */ ('manual'),
      total,
      used: null,
      remaining: null,
      ratio: null,
      percent: null,
      overBudget: false,
      overBy: 0,
    };
  }
  const overBudget = used > total;
  const remaining = Math.max(0, total - used);
  const ratio = Math.min(1, remaining / total);
  return {
    mode: /** @type {'manual'} */ ('manual'),
    total,
    used,
    remaining,
    ratio,
    percent: ratio * 100,
    overBudget,
    overBy: overBudget ? used - total : 0,
  };
}

/**
 * Read one quota window from a response row.
 *
 * A window can arrive in two shapes: a counted window (`total_count` and
 * `usage_count`) and a percentage-only window (`total_count` is 0 and only
 * `remaining_percent` is set). A percentage-only window is a real quota and
 * must not be dropped, so both shapes are read and reported side by side.
 *
 * @param {any} row
 * @param {'interval' | 'weekly'} kind
 */
function readWindow(row, kind) {
  const prefix = kind === 'interval' ? 'current_interval' : 'current_weekly';
  const status = numberOrNull(row[`${prefix}_status`]);
  const unlimited = status === 3;
  const total = finiteCount(row[`${prefix}_total_count`]);
  const reported = numberOrNull(row[`${prefix}_usage_count`]);
  const remainingPercent = percentOrNull(row[`${prefix}_remaining_percent`]);
  const usedPercent = percentOrNull(row[`${prefix}_used_percent`]);

  // The counted shape wins when it is present: the percentage only resolves
  // which direction the ambiguous count is read in.
  const counts = total > 0 && reported !== null
    ? resolveCounts(reported, total, remainingPercent)
    : null;

  let remaining = counts ? counts.remaining : null;
  let used = counts ? counts.used : null;
  let percent = remainingPercent;
  if (percent === null && usedPercent !== null) percent = 100 - usedPercent;
  if (percent === null && counts) percent = (counts.remaining / counts.total) * 100;

  const resetKey = kind === 'interval' ? 'end_time' : 'weekly_end_time';
  const remainsKey = kind === 'interval' ? 'remains_time' : 'weekly_remains_time';
  return {
    unlimited,
    percent: percent === null ? null : clamp(percent, 0, 100),
    usedPercent: percent === null ? null : clamp(100 - percent, 0, 100),
    total: counts ? counts.total : null,
    remaining,
    used,
    resetAt: numberOrNull(row[resetKey]),
    remainsMs: numberOrNull(row[remainsKey]),
  };
}

/** @param {any} payload */
export function normalizeQuota(payload) {
  const rows = Array.isArray(payload?.model_remains) ? payload.model_remains : [];
  /** @type {any[]} */
  const models = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    if (hasNumber(row.current_interval_remaining_percent) && percentOrNull(row.current_interval_remaining_percent) === null) continue;

    const interval = readWindow(row, 'interval');
    const weekly = readWindow(row, 'weekly');
    // A row with neither a percentage nor a count says nothing about the quota.
    if (interval.percent === null && weekly.percent === null) continue;

    models.push({
      name: typeof row.model_name === 'string' && row.model_name ? row.model_name : 'model',
      percent: interval.percent,
      usedPercent: interval.usedPercent,
      unlimited: interval.unlimited,
      total: interval.total,
      remaining: interval.remaining,
      used: interval.used,
      resetAt: interval.resetAt,
      remainsMs: interval.remainsMs,
      weekly: weekly.percent === null && !weekly.unlimited
        ? null
        : {
            percent: weekly.percent,
            usedPercent: weekly.usedPercent,
            unlimited: weekly.unlimited,
            total: weekly.total,
            remaining: weekly.remaining,
            used: weekly.used,
            resetAt: weekly.resetAt,
            remainsMs: weekly.remainsMs,
          },
    });
  }
  if (models.length === 0) return { ok: false, code: 'no_quota' };

  // The plan's own panel reads the first row of `model_remains`; choosing a
  // different row here would put a second number next to the same panel.
  const text = models[0];
  const percent = text.percent ?? 0;
  const ratio = clamp(percent / 100, 0, 1);
  return {
    ok: true,
    total: text.total,
    used: text.used,
    remaining: text.remaining,
    ratio,
    percent,
    usedPercent: text.usedPercent ?? 100 - percent,
    models,
    weekly: text.weekly,
    primaryModel: text.name,
  };
}

/** @param {unknown} value */
function finiteCount(value) {
  const n = numberOrNull(value);
  return n === null || n < 0 || !Number.isSafeInteger(n) ? 0 : n;
}

/** @param {unknown} value */
function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** @param {unknown} value */
function hasNumber(value) {
  return typeof value === 'number';
}

/** @param {unknown} value */
function percentOrNull(value) {
  const n = numberOrNull(value);
  return n === null || n < 0 || n > 100 ? null : n;
}

/** @param {number} value */
function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/** @param {Array<number | null>} values */
function earliest(values) {
  let best = null;
  for (const value of values) {
    if (value === null || value <= 0) continue;
    if (best === null || value < best) best = value;
  }
  return best;
}
