// @ts-check
// token-meter-board queries.
//
// Every number comes from the session records read by lib/sessions.mjs. There
// is no runtime database, no observability log and no Host configuration in
// this file, and therefore no token rate and no workspace path: the session
// records do not carry durations or paths.
//
// A call is identified by its message id and de-duplicated globally, because a
// rebuilt session copies its earlier messages into the new session file.

import { SessionStore, dayKey } from './sessions.mjs';

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */

/** How long an aggregate stays valid before it is rebuilt. */
const AGGREGATE_TTL_MS = 3000;
/** How often the transcript files are re-read. */
const SCAN_TTL_MS = 3000;

/** @type {SessionStore | null} */
let store = null;

/**
 * @param {MiniAppContext} context
 * @returns {SessionStore}
 */
export function getStore(context) {
  if (!store) store = new SessionStore(context);
  return store;
}

/** Reset the module-level store (used by tests and on dispose). */
export function resetStore() {
  store = null;
}

/**
 * Persist the scan cursor so the next start resumes instead of re-reading
 * every transcript.
 * @param {boolean} force
 */
export async function saveStore(force = true) {
  if (store) await store.save(force);
}

/**
 * Make sure the transcripts are read up to date.
 * @param {MiniAppContext} context
 * @param {number} now
 */
export async function ensureScanned(context, now = Date.now()) {
  const current = getStore(context);
  if (!current.ready) await current.init();
  if (now - current.scannedAt > SCAN_TTL_MS) await current.scan();
  return current;
}

/** @param {unknown} value */
export function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Parse a local "YYYY-MM-DDTHH:MM" stamp.
 * @param {unknown} value
 */
export function parseLocalDateTime(value) {
  const m = String(value ?? '')
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0), 0);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

/**
 * Resolve a query window: an explicit local start/end pair, or a trailing
 * number of days that includes today.
 * @param {{startAt?: unknown, endAt?: unknown, days?: unknown}} args
 * @param {number} now
 */
export function resolveWindow(args = {}, now = Date.now()) {
  const startMs = parseLocalDateTime(args.startAt);
  if (startMs != null) {
    const endRaw = args.endAt != null ? parseLocalDateTime(args.endAt) : now;
    if (endRaw == null) throw new Error('invalid endAt; expect local "YYYY-MM-DDTHH:MM"');
    const endMs = Math.min(endRaw, now);
    if (endMs <= startMs) throw new Error('endAt must be after startAt');
    return { startMs, endMs, label: `${dayKey(startMs)}..${dayKey(endMs)}` };
  }
  const days = clampInt(args.days ?? 7, 1, 400, 7);
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const start = todayStart.getTime() - (days - 1) * 86400000;
  return { startMs: start, endMs: now, label: days === 1 ? dayKey(start) : `${dayKey(start)}..${dayKey(now)}` };
}

/**
 * @param {number} startMs
 * @param {number} endMs
 * @param {unknown} requested
 */
export function pickBucket(startMs, endMs, requested) {
  const spanMin = (endMs - startMs) / 60000;
  let bucket = requested && requested !== 'auto' ? String(requested) : spanMin <= 360 ? 'minute' : spanMin <= 7 * 24 * 60 ? 'hour' : 'day';
  const spanMs = Math.max(endMs - startMs, 1);
  const approx = (b) => Math.ceil(spanMs / (b === 'minute' ? 60000 : b === 'hour' ? 3600000 : 86400000));
  if (approx(bucket) > 600) bucket = bucket === 'minute' ? 'hour' : 'day';
  return bucket;
}

/**
 * @param {number} ts
 * @param {string} bucket
 */
export function bucketFloor(ts, bucket) {
  const d = new Date(ts);
  if (bucket === 'minute') d.setSeconds(0, 0);
  else if (bucket === 'hour') d.setMinutes(0, 0, 0);
  else d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * @param {number} ms
 * @param {string} bucket
 * @param {boolean} multiDay
 */
export function bucketLabel(ms, bucket, multiDay) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  if (bucket === 'day') return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  if (multiDay) return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Cache the aggregate for the current window. */
/** @type {{key: string, at: number, agg: any}} */
let aggregateCache = { key: '', at: 0, agg: null };

/**
 * @param {SessionStore} current
 * @param {number} startMs
 * @param {number} endMs
 * @param {number} now
 */
function aggregateCached(current, startMs, endMs, now) {
  const key = `${startMs}|${endMs}|${current.scannedAt}`;
  if (aggregateCache.key === key && now - aggregateCache.at < AGGREGATE_TTL_MS) return aggregateCache.agg;
  const agg = current.aggregate(startMs, endMs);
  aggregateCache = { key, at: now, agg };
  return agg;
}

/** @param {any} bucket */
function hitRate(bucket) {
  const denom = (bucket.cacheRead || 0) + (bucket.input || 0);
  if (!denom) return null;
  return (bucket.cacheRead || 0) / denom;
}

/** @param {number} ms */
function isoLocal(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * A turn's status, derived from the stop reason of its last assistant call.
 * @param {any} turn
 */
function turnStatus(turn) {
  if (turn.calls === 0) return 'pending';
  if (turn.lastStop === 3) return 'aborted';
  if (turn.lastStop === 2) return 'unfinished';
  if (turn.lastStop === 1) return 'completed';
  return 'unfinished';
}

/**
 * The window view: KPIs, a per-model share and a bucketed trend.
 * @param {MiniAppContext} context
 * @param {{startAt?: unknown, endAt?: unknown, days?: unknown, bucket?: unknown, fillEmpty?: unknown}} args
 * @param {number} now
 */
export async function queryWindow(context, args, now = Date.now()) {
  const current = await ensureScanned(context, now);
  const { startMs, endMs } = resolveWindow(args, now);
  const agg = aggregateCached(current, startMs, endMs, now);
  const bucket = pickBucket(startMs, endMs, args.bucket);
  const multiDay = dayKey(startMs) !== dayKey(endMs);

  /** @type {Map<string, any>} */
  const buckets = new Map();
  const ensureBucket = (ts) => {
    const key = String(bucketFloor(ts, bucket));
    let entry = buckets.get(key);
    if (!entry) {
      entry = {
        key,
        label: bucketLabel(bucketFloor(ts, bucket), bucket, multiDay),
        calls: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
        cost: 0,
        models: new Map(),
      };
      buckets.set(key, entry);
    }
    return entry;
  };
  for (const call of agg.calls) {
    const entry = ensureBucket(call.ts);
    entry.calls += 1;
    entry.input += call.input;
    entry.output += call.output;
    entry.cacheRead += call.cacheRead;
    entry.cacheWrite += call.cacheWrite;
    entry.total += call.total;
    entry.cost += call.cost;
    entry.models.set(call.model, (entry.models.get(call.model) ?? 0) + call.total);
  }

  const ordered = [...buckets.values()].sort((a, b) => Number(a.key) - Number(b.key));
  const models = [...agg.byModel.entries()]
    .map(([model, bucketValue]) => ({
      key: model,
      model,
      modelName: model,
      providerName: '',
      custom: false,
      totalTokens: bucketValue.total,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens);
  const topModels = models.slice(0, 6);

  const labels = ordered.map((b) => b.label);
  const tokensByModel = {};
  for (const model of topModels) {
    tokensByModel[model.key] = ordered.map((b) => b.models.get(model.key) ?? 0);
  }
  const cacheHitRate = ordered.map((b) => {
    const denom = b.cacheRead + b.input;
    return denom ? b.cacheRead / denom : null;
  });

  const totals = agg.totals;
  return {
    trend: {
      window: { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(), bucket },
      meta: { rows: totals.calls, generatedAt: now },
      kpis: {
        totalTokens: totals.total,
        calls: totals.calls,
        cacheHitRate: hitRate(totals),
        activeModels: agg.byModel.size,
        inputTokens: totals.input,
        outputTokens: totals.output,
        cacheReadTokens: totals.cacheRead,
        cacheWriteTokens: totals.cacheWrite,
        turns: agg.byTurn.size,
        sessions: agg.bySession.size,
        cost: totals.cost,
      },
      models: topModels,
      series: {
        labels,
        tokensByModel,
        cacheHitRate,
        calls: ordered.map((b) => b.calls),
        totalTokens: ordered.map((b) => b.total),
      },
      unknownRows: 0,
    },
    summary: {
      byModel: [...agg.byModel.entries()]
        .map(([model, bucketValue]) => ({
          model,
          modelName: model,
          provider: '',
          providerName: '',
          custom: false,
          calls: bucketValue.calls,
          inputTokens: bucketValue.input,
          outputTokens: bucketValue.output,
          cacheReadTokens: bucketValue.cacheRead,
          cacheWriteTokens: bucketValue.cacheWrite,
          totalTokens: bucketValue.total,
          cacheHitRate: hitRate(bucketValue),
        }))
        .sort((a, b) => b.totalTokens - a.totalTokens),
    },
  };
}

/**
 * Per-model breakdown for the window.
 * @param {MiniAppContext} context
 * @param {{startAt?: unknown, endAt?: unknown, days?: unknown}} args
 * @param {number} now
 */
export async function queryModels(context, args, now = Date.now()) {
  const current = await ensureScanned(context, now);
  const { startMs, endMs } = resolveWindow(args, now);
  const agg = aggregateCached(current, startMs, endMs, now);
  return {
    byModel: [...agg.byModel.entries()]
      .map(([model, bucketValue]) => ({
        model,
        modelName: model,
        provider: '',
        providerName: '',
        custom: false,
        calls: bucketValue.calls,
        inputTokens: bucketValue.input,
        outputTokens: bucketValue.output,
        cacheReadTokens: bucketValue.cacheRead,
        cacheWriteTokens: bucketValue.cacheWrite,
        totalTokens: bucketValue.total,
        cacheHitRate: hitRate(bucketValue),
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens),
  };
}

/**
 * Sessions ranked by usage. Only the session id and its own title are shown:
 * no workspace path is ever read, so none can be shown.
 * @param {MiniAppContext} context
 * @param {{startAt?: unknown, endAt?: unknown, days?: unknown, limit?: unknown}} args
 * @param {number} now
 */
export async function querySessions(context, args, now = Date.now()) {
  const current = await ensureScanned(context, now);
  const { startMs, endMs } = resolveWindow(args, now);
  const agg = aggregateCached(current, startMs, endMs, now);
  const limit = clampInt(args.limit ?? 50, 1, 500, 50);
  const rows = [...agg.bySession.values()]
    .map((session) => ({
      sessionId: session.sessionId,
      title: session.title || session.sessionId,
      calls: session.calls,
      inputTokens: session.input,
      outputTokens: session.output,
      cacheReadTokens: session.cacheRead,
      cacheWriteTokens: session.cacheWrite,
      totalTokens: session.total,
      cacheHitRate: hitRate(session),
      turns: session.turns.size,
      firstActivity: new Date(session.firstTs).toISOString(),
      lastActivity: new Date(session.lastTs).toISOString(),
      byModel: [...session.models.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([model, tokens]) => ({ model, modelName: model, totalTokens: tokens })),
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, limit);
  return { sessions: rows };
}

/**
 * One row per local day.
 * @param {MiniAppContext} context
 * @param {{startAt?: unknown, endAt?: unknown, days?: unknown}} args
 * @param {number} now
 */
export async function queryDaily(context, args, now = Date.now()) {
  const current = await ensureScanned(context, now);
  const { startMs, endMs } = resolveWindow(args, now);
  const agg = aggregateCached(current, startMs, endMs, now);
  const rows = [...agg.byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, bucketValue]) => ({
      day,
      total: {
        calls: bucketValue.calls,
        inputTokens: bucketValue.input,
        outputTokens: bucketValue.output,
        cacheReadTokens: bucketValue.cacheRead,
        cacheWriteTokens: bucketValue.cacheWrite,
        totalTokens: bucketValue.total,
        cacheHitRate: hitRate(bucketValue),
      },
      byModel: [...bucketValue.models.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([model, tokens]) => ({ model, modelName: model, totalTokens: tokens })),
    }));
  return { days: rows };
}

/**
 * One row per conversation turn.
 * @param {MiniAppContext} context
 * @param {{startAt?: unknown, endAt?: unknown, days?: unknown, limit?: unknown}} args
 * @param {number} now
 */
export async function queryTurns(context, args, now = Date.now()) {
  const current = await ensureScanned(context, now);
  const { startMs, endMs } = resolveWindow(args, now);
  const agg = aggregateCached(current, startMs, endMs, now);
  const limit = clampInt(args.limit ?? 100, 1, 1000, 100);
  const rows = [...agg.byTurn.values()]
    .sort((a, b) => b.lastTs - a.lastTs)
    .slice(0, limit);
  const counts = { completed: 0, unfinished: 0, pending: 0, aborted: 0 };
  for (const turn of agg.byTurn.values()) {
    const status = turnStatus(turn);
    if (counts[status] != null) counts[status] += 1;
  }
  return {
    turns: rows.map((turn) => ({
      turnId: turn.turnId,
      sessionId: turn.sessionId,
      sessionTitle: turn.title || turn.sessionId,
      status: turnStatus(turn),
      startedAt: new Date(turn.firstTs).toISOString(),
      finishedAt: new Date(turn.lastTs).toISOString(),
      calls: turn.calls,
      inputTokens: turn.input,
      outputTokens: turn.output,
      cacheReadTokens: turn.cacheRead,
      cacheWriteTokens: turn.cacheWrite,
      totalTokens: turn.total,
      cacheHitRate: hitRate(turn),
      byModel: [...turn.models].map((model) => ({ model, modelName: model })),
    })),
    counts,
    totalTurns: agg.byTurn.size,
  };
}

/**
 * One row per call, newest first.
 * @param {MiniAppContext} context
 * @param {{startAt?: unknown, endAt?: unknown, days?: unknown, limit?: unknown}} args
 * @param {number} now
 */
export async function queryCalls(context, args, now = Date.now()) {
  const current = await ensureScanned(context, now);
  const { startMs, endMs } = resolveWindow(args, now);
  const agg = aggregateCached(current, startMs, endMs, now);
  const limit = clampInt(args.limit ?? 200, 1, 2000, 200);
  const rows = [...agg.calls]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit);
  return {
    calls: rows.map((call) => ({
      ts: call.ts,
      time: isoLocal(call.ts),
      turnId: call.turn,
      sessionId: '',
      model: call.model,
      modelName: call.model,
      provider: '',
      custom: false,
      inputTokens: call.input,
      outputTokens: call.output,
      cacheReadTokens: call.cacheRead,
      cacheWriteTokens: call.cacheWrite,
      totalTokens: call.total,
      stopReason: call.stop,
    })),
  };
}

/**
 * A short description of the scan. No absolute path is returned.
 * @param {MiniAppContext} context
 * @param {number} now
 */
export async function queryHealth(context, now = Date.now()) {
  const current = await ensureScanned(context, now);
  const info = current.describe();
  return {
    ok: true,
    now,
    source: 'session-records',
    sessionsDir: current.root ? current.root.split(/[\\/]/).pop() : '',
    files: info.files,
    calls: info.calls,
    turns: info.turns,
    scannedAt: info.scannedAt,
    scanMs: info.scanMs,
    runtime: { node: process.version },
  };
}
