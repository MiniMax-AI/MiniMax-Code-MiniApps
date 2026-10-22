// token-meter trend pipeline: window parsing, bucket picking, and bucketed
// per-model usage series. buildTrendFromContext lets callers combine the trend
// with other aggregations over a single DB/log scan; buildTrendResult keeps
// the standalone one-shot behavior.
import {
  resolveDataDir,
  openDb,
  clampInt,
  queryUsageRows,
  loadCatalog,
  loadTurnEnrichment,
  resolveRowIdentity,
  emptyMetrics,
  addRow,
  finalize,
  buildLedgerWithDb,
  syncMessageFacts,
  meanCallRate,
  rateStats,
  requestRateStats,
  countRatedCalls,
} from './common.mjs';

export function parseLocalDateTime(value) {
  const m = String(value || '')
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0), 0);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

export function resolveTrendWindow(args, now = Date.now()) {
  if (args?.startAt) {
    const startMs = parseLocalDateTime(args.startAt);
    const endRaw = args.endAt ? parseLocalDateTime(args.endAt) : now;
    if (startMs == null || endRaw == null) {
      throw new Error('invalid startAt/endAt; expect local "YYYY-MM-DDTHH:MM"');
    }
    const endMs = Math.min(endRaw, now);
    if (endMs <= startMs) throw new Error('endAt must be after startAt');
    return { startMs, endMs };
  }
  const days = clampInt(args?.days, 1, 90, 7);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  // Second-level quantisation keeps a rolling window stable, so repeated
  // queries inside the same second share one cached context instead of
  // rebuilding the scan for every request.
  return { startMs: todayStart.getTime() - (days - 1) * 86400000, endMs: Math.floor(now / 1000) * 1000 };
}

export function pickBucket(startMs, endMs, requested) {
  const spanMin = (endMs - startMs) / 60000;
  let bucket = requested && requested !== 'auto' ? requested : spanMin <= 360 ? 'minute' : spanMin <= 7 * 24 * 60 ? 'hour' : 'day';
  // keep bucket count manageable
  const spanMs = Math.max(endMs - startMs, 1);
  const approx = (b) => Math.ceil(spanMs / (b === 'minute' ? 60000 : b === 'hour' ? 3600000 : 86400000));
  if (approx(bucket) > 600) bucket = bucket === 'minute' ? 'hour' : 'day';
  return bucket;
}

export function bucketFloor(ts, bucket) {
  const d = new Date(ts);
  if (bucket === 'minute') d.setSeconds(0, 0);
  else if (bucket === 'hour') d.setMinutes(0, 0, 0);
  else d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function bucketLabel(ms, bucket, multiDay) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  if (bucket === 'day') return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  if (multiDay) return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

const MAX_TREND_MODELS = 5;

function round2(v) {
  return Math.round(v * 100) / 100;
}

// Build the trend result from an already-open query context.
// ctx: { rows, catalog, enrichment (Map), ledger, dataDir, filesScanned }.
// ledger entries are per-call records (identity + tokens + decode rate) built
// by common.buildCallLedger; when absent it is derived from rows for
// backward compatibility (rates then stay null).
export function buildTrendFromContext(ctx, { startMs, endMs, bucket: requestedBucket, fillEmpty: fillArg, now = Date.now() }) {
  const bucket = pickBucket(startMs, endMs, requestedBucket);
  const { rows, catalog, enrichment } = ctx;
  const ledger = ctx.ledger || rows.map((row) => ({ ...row, ...resolveRowIdentity(row, enrichment, catalog), ts: row.ts, rate: null }));
  const dir = ctx.dataDir;
  const filesScanned = ctx.filesScanned ?? 0;

  // rank models by total tokens (ledger entries already carry resolved identity)
  const byModelTotals = new Map();
  let unknownRows = 0;
  for (const call of ledger) {
    if (call.model === '(unknown)') unknownRows += 1;
    const key = `${call.provider}|${call.model}`;
    if (!byModelTotals.has(key)) byModelTotals.set(key, { id: call, tokens: 0 });
    byModelTotals.get(key).tokens +=
      (call.input_tokens || 0) + (call.output_tokens || 0) + (call.reasoning_tokens || 0) + (call.cache_read_tokens || 0) + (call.cache_write_tokens || 0);
  }
  const ranked = [...byModelTotals.entries()].sort((a, b) => {
    if (a[1].id.custom !== b[1].id.custom) return a[1].id.custom ? -1 : 1;
    return b[1].tokens - a[1].tokens;
  });
  const topKeys = ranked.slice(0, MAX_TREND_MODELS).map(([k]) => k);
  const modelList = ranked.slice(0, MAX_TREND_MODELS).map(([key, v]) => ({
    key,
    model: v.id.model,
    modelName: v.id.modelName,
    providerName: v.id.providerName,
    custom: v.id.custom,
    totalTokens: v.tokens,
  }));
  const hasOther = ranked.length > MAX_TREND_MODELS;
  if (hasOther) {
    modelList.push({
      key: '__other__',
      model: '(other)',
      modelName: '其他模型',
      providerName: '',
      custom: false,
      totalTokens: ranked.slice(MAX_TREND_MODELS).reduce((s, [, v]) => s + v.tokens, 0),
    });
  }

  // bucket aggregation
  const multiDay = endMs - startMs > 24 * 3600000;
  const buckets = new Map();
  const kpi = emptyMetrics();
  const seriesKeys = hasOther ? [...topKeys, '__other__'] : topKeys;
  for (const call of ledger) {
    addRow(kpi, call);
    const bStart = bucketFloor(call.ts, bucket);
    if (!buckets.has(bStart)) {
      buckets.set(bStart, { totals: emptyMetrics(), perModel: new Map(), rateOut: 0, rateDecodeMs: 0, rated: 0 });
    }
    const b = buckets.get(bStart);
    addRow(b.totals, call);
    // Accumulate the UI basis directly (Σoutput ÷ Σdecode) instead of averaging
    // per-call rates: the arithmetic mean is wrecked by the few calls the runtime
    // times with a sub-second decode span, and it disagreed with the headline KPI.
    // The inconsistent-timing exclusion mirrors common.collectDecodeRates/weightedRate.
    if (
      typeof call.rate === 'number' &&
      !(call.decodeMs != null && call.requestMs != null && call.decodeMs > call.requestMs)
    ) {
      b.rateOut += call.output_tokens || 0;
      b.rateDecodeMs += call.decodeMs || 0;
      b.rated += 1;
    }
    const modelKey = `${call.provider}|${call.model}`;
    const key = topKeys.includes(modelKey) ? modelKey : '__other__';
    const rowTotal =
      (call.input_tokens || 0) + (call.output_tokens || 0) + (call.reasoning_tokens || 0) + (call.cache_read_tokens || 0) + (call.cache_write_tokens || 0);
    b.perModel.set(key, (b.perModel.get(key) || 0) + rowTotal);
  }

  const fillEmpty = fillArg !== false;
  let starts;
  if (fillEmpty) {
    const stepMs = bucket === 'minute' ? 60000 : bucket === 'hour' ? 3600000 : 86400000;
    starts = [];
    // Day buckets align to local midnight; stepping from the floored start keeps
    // minute/hour buckets aligned to wall-clock boundaries as well.
    for (let ms = bucketFloor(startMs, bucket), end = bucketFloor(endMs, bucket); ms <= end; ms += stepMs) {
      starts.push(ms);
      if (starts.length > 1000) break; // safety, pickBucket already caps at ~600
    }
  } else {
    starts = [...buckets.keys()].sort((a, b) => a - b);
  }
  const labels = starts.map((ms) => bucketLabel(ms, bucket, multiDay));
  const tokensByModel = {};
  for (const key of seriesKeys) tokensByModel[key] = [];
  const cacheHitRate = [];
  const outputRate = [];
  const calls = [];
  const totalTokens = [];
  for (const ms of starts) {
    const b = buckets.get(ms);
    if (b) finalize(b.totals);
    for (const key of seriesKeys) tokensByModel[key].push(b?.perModel.get(key) || 0);
    cacheHitRate.push(b ? b.totals.cacheHitRate : null);
    // Σoutput ÷ Σdecode for the calls in this bucket — same basis as the headline
    // KPI and the desktop UI; null when nothing measured, so the chart leaves a gap
    // instead of a misleading zero
    outputRate.push(b && b.rated > 0 && b.rateDecodeMs > 0 ? round2(b.rateOut / (b.rateDecodeMs / 1000)) : null);
    calls.push(b ? b.totals.calls : 0);
    totalTokens.push(b ? b.totals.totalTokens : 0);
  }
  finalize(kpi);
  kpi.outputRate = meanCallRate(ledger);
  kpi.rate = rateStats(ledger);
  kpi.requestRate = requestRateStats(ledger);
  kpi.rateMeasured = countRatedCalls(ledger);

  return {
    window: {
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      bucket,
      bucketCount: starts.length,
      fillEmpty,
    },
    kpis: { ...kpi, activeModels: ranked.length },
    models: modelList,
    series: { labels, bucketStarts: starts, tokensByModel, cacheHitRate, outputRate, calls, totalTokens },
    unknownRows,
    meta: {
      dataDir: dir,
      rows: rows.length,
      logFilesScanned: filesScanned,
      turnsEnriched: enrichment.size,
      generatedAt: new Date(now).toISOString(),
    },
  };
}

// Standalone trend query: opens its own context, aggregates, closes.
export function buildTrendResult({ dataDir, startMs, endMs, bucket, fillEmpty, now = Date.now() }) {
  const dir = dataDir || resolveDataDir();
  const { db, error } = openDb(dir);
  if (!db) {
    const err = new Error(error || `runtime state database unavailable under ${dir}`);
    err.code = 'NO_DB';
    throw err;
  }
  try {
    const rows = queryUsageRows(db, startMs, endMs);
    const catalog = loadCatalog(dir);
    const { map: enrichment, filesScanned } = loadTurnEnrichment(dir, startMs, { now });
    const store = syncMessageFacts(db, dir, { now });
    const ledger = buildLedgerWithDb(db, rows, enrichment, catalog, store);
    return buildTrendFromContext(
      { rows, catalog, enrichment, ledger, dataDir: dir, filesScanned },
      { startMs, endMs, bucket, fillEmpty, now },
    );
  } finally {
    db.close();
  }
}
