// token-meter-board query layer: windowed usage aggregations shared by the HTTP
// routes (in-process) and the child-process fallback (db-child.mjs). All reads
// are read-only against the MiniMax Code runtime state.
//
// Rate methodology (v1.5): token 输出速率 与 MiniMax Code 界面同口径 ——
// 单次成功调用为 输出 tokens ÷ decode 时长（首 token 到流结束，取自 assistant
// 消息的 usage.decode_duration_ms）；跨调用的聚合一律为 Σ输出 ÷ Σdecode 耗时
//（时间加权），不使用逐次算术平均。没有 decode 记录的老数据不参与，避免被口径
// 外的数值稀释。decode > request 的调用不计入聚合：它等价于首 token 早于请求发起，
// 说明两个时间戳来自不同尝试（实测仅出现在 finish=toolUse，2674 次里 6 次），
// 其 decode 物理上不可能更长，会灌大分母。逐次值仍照常展示。
import fs from 'node:fs';
import {
  openDb,
  queryUsageRows,
  loadCatalog,
  loadTurnEnrichment,
  buildLedgerWithDb,
  loadTurnMessageMeta,
  syncMessageFacts,
  meanCallRate,
  rateStats,
  requestRateStats,
  countRatedCalls,
  emptyMetrics,
  addRow,
  finalize,
  sortGroups,
  dayKey,
  clampInt,
} from './common.mjs';
import { resolveTrendWindow, buildTrendFromContext } from './trend.mjs';

export const NOTES = [
  'cacheHitRate = cacheReadTokens / (cacheReadTokens + inputTokens)，表示提示词中命中缓存的比例；cacheWriteTokens 不计入分母。',
  'totalTokens = input + output + reasoning + cacheRead + cacheWrite。',
  'token 输出速率（token/s）与 MiniMax Code 界面显示的口径完全一致：单次调用的 输出 tokens ÷ decode 时长（首 token 到流结束），窗口值为 Σ输出 ÷ Σdecode 耗时（按耗时加权），并附 P50/P90 供分布参考。',
  'costUsd 为 runtime 记录值；自定义套餐/订阅类提供商通常为 0，不代表实际账单。',
  '请求全程速率（对照列）= 输出 tokens ÷ request_duration_ms（发起请求到流结束），与输出速率的差值即首字等待与排队；decode > request 的调用（首 token 早于请求发起、时间戳来自不同尝试）不计入输出速率聚合，逐次值仍展示。',
  'model 字段由 runtime 日志 llm_response_identifiers 按 turn 补全（按小时文件名覆盖整个窗口）；仍为 unknown 的记录早于日志保留期。',
  '对话明细：每行是一次完整对话，即用户发送一条消息后，模型经过若干次调用直至给出最终回答（turn_id 即该单位）；实时读取，无需等待会话结束。状态分为已完成（末条 finish_reason=stop）、未收尾（末条仍为 toolUse 等）与进行中（尚无 assistant 消息）。',
  '对话明细会显示该轮用户消息原文的前 200 字，仅在本机页面内展示，不出网、不落盘。',
  '统计范围限于本机 runtime 数据库当前保留的数据；早于该保留期的历史不会出现在本表中。',
];

// Open the DB and load the window rows plus the per-call ledger (identity,
// decode timing, response status).
//
// The derived context is cached for a few seconds, so the endpoints that
// describe the same window — trend, call log and conversation list — share one
// scan instead of each repeating it. That is what keeps a window switch from
// queueing three expensive passes behind each other.
//
// The cache key includes the data directory: the same time window against two
// different runtime databases is two different contexts, and keying on the
// window alone would let one answer the other.
const CONTEXT_TTL_MS = 3000;
const contextCache = new Map();

function contextKey(dataDir, startMs, endMs) {
  return `${dataDir}|${startMs}|${endMs}`;
}

function loadSessionTitles(db) {
  const titles = new Map();
  try {
    for (const r of db.prepare('SELECT session_id, title, agent_name, workspace_dir FROM local_runtime_sessions').all()) {
      titles.set(r.session_id, r);
    }
  } catch {
    // titles optional
  }
  return titles;
}

export function openContext(dataDir, startMs, endMs, now = Date.now()) {
  const key = contextKey(dataDir, startMs, endMs);
  const hit = contextCache.get(key);
  if (hit && now - hit.at < CONTEXT_TTL_MS) return hit.ctx;

  const { db, error } = openDb(dataDir);
  if (!db) {
    const err = new Error(error || `runtime state database unavailable under ${dataDir}`);
    err.code = 'NO_DB';
    throw err;
  }
  try {
    const rows = queryUsageRows(db, startMs, endMs);
    const catalog = loadCatalog(dataDir);
    const { map: enrichment, filesScanned } = loadTurnEnrichment(dataDir, startMs, { now });
    // Message facts are extracted once per process and reused; this only picks
    // up rows appended since the last query.
    const store = syncMessageFacts(db, dataDir, { now });
    const ledger = buildLedgerWithDb(db, rows, enrichment, catalog, store);
    const turnMeta = loadTurnMessageMeta(rows, store);
    const titles = loadSessionTitles(db);
    const meta = {
      dataDir,
      window: {
        label: `${dayKey(startMs)}..${dayKey(endMs)}`,
        start: new Date(startMs).toISOString(),
        end: new Date(endMs).toISOString(),
      },
      rows: rows.length,
      rateMeasured: countRatedCalls(ledger),
      rate: rateStats(ledger),
      requestRate: requestRateStats(ledger),
      logFilesScanned: filesScanned,
      turnsEnriched: enrichment.size,
      generatedAt: new Date(now).toISOString(),
    };
    const ctx = { rows, catalog, enrichment, ledger, turnMeta, titles, filesScanned, dataDir, meta };
    contextCache.set(key, { at: now, ctx });
    if (contextCache.size > 32) {
      const oldest = contextCache.keys().next().value;
      if (oldest !== key) contextCache.delete(oldest);
    }
    return ctx;
  } finally {
    db.close();
  }
}

export function groupByModel(ctx) {
  const groups = new Map();
  const total = emptyMetrics();
  let unknownRows = 0;
  for (const call of ctx.ledger) {
    if (call.model === '(unknown)') unknownRows += 1;
    const key = `${call.provider}|${call.model}`;
    if (!groups.has(key)) {
      groups.set(key, {
        provider: call.provider,
        providerName: call.providerName,
        model: call.model,
        modelName: call.modelName,
        custom: call.custom,
        metrics: emptyMetrics(),
        callList: [],
      });
    }
    const g = groups.get(key);
    addRow(g.metrics, call);
    g.callList.push(call);
    addRow(total, call);
  }
  const byModel = sortGroups(
    [...groups.values()].map((g) => ({
      ...g,
      ...finalize(g.metrics),
      outputRate: meanCallRate(g.callList),
      metrics: undefined,
      callList: undefined,
    })),
  );
  return { byModel, total: finalize(total), unknownRows };
}

function summaryFromContext(ctx) {
  const { byModel, total, unknownRows } = groupByModel(ctx);
  return {
    window: ctx.meta.window,
    total: { ...total, outputRate: meanCallRate(ctx.ledger), rate: rateStats(ctx.ledger), rateMeasured: ctx.meta.rateMeasured },
    byModel,
    unknownRows,
    notes: NOTES,
    meta: ctx.meta,
  };
}

// summary: window (startAt/endAt minute precision, or days) grouped by provider/model.
export function querySummary({ dataDir, startAt, endAt, days }, now = Date.now()) {
  const { startMs, endMs } = resolveTrendWindow({ startAt, endAt, days }, now);
  const ctx = openContext(dataDir, startMs, endMs, now);
  return summaryFromContext(ctx);
}

// window: trend + summary over a single DB/log scan (one enrichment pass).
export function queryWindow({ dataDir, startAt, endAt, days, bucket, fillEmpty }, now = Date.now()) {
  const { startMs, endMs } = resolveTrendWindow({ startAt, endAt, days }, now);
  const ctx = openContext(dataDir, startMs, endMs, now);
  const trend = buildTrendFromContext(ctx, { startMs, endMs, bucket, fillEmpty, now });
  const summary = summaryFromContext(ctx);
  return { trend, summary };
}

// calls: the per-call ledger for the window, newest first (调用日志).
export function queryCalls({ dataDir, startAt, endAt, days, limit }, now = Date.now()) {
  const lim = clampInt(limit, 1, 1000, 200);
  const { startMs, endMs } = resolveTrendWindow({ startAt, endAt, days: days ?? 1 }, now);
  const ctx = openContext(dataDir, startMs, endMs, now);
  const calls = ctx.ledger
    .slice()
    .sort((a, b) => b.ts - a.ts)
    .slice(0, lim)
    .map((c) => ({
      ts: c.ts,
      time: new Date(c.ts).toISOString(),
      sessionId: c.sessionId,
      agentName: c.agentName,
      turnId: c.turnId,
      provider: c.provider,
      providerName: c.providerName,
      model: c.model,
      modelName: c.modelName,
      custom: c.custom,
      inputTokens: c.input_tokens,
      outputTokens: c.output_tokens,
      reasoningTokens: c.reasoning_tokens,
      cacheReadTokens: c.cache_read_tokens,
      cacheWriteTokens: c.cache_write_tokens,
      totalTokens:
        c.input_tokens + c.output_tokens + c.reasoning_tokens + c.cache_read_tokens + c.cache_write_tokens,
      decodeMs: c.decodeMs,
      requestMs: c.requestMs,
      status: c.status,
      finishReason: c.finishReason,
      outputRate: c.rate,
      requestRate: c.requestRate,
    }));
  return {
    window: ctx.meta.window,
    calls,
    totalCalls: ctx.ledger.length,
    rateMeasured: ctx.meta.rateMeasured,
    rate: ctx.meta.rate,
    requestRate: ctx.meta.requestRate,
    notes: NOTES,
    meta: ctx.meta,
  };
}

// turns: one row per conversation — a single user message plus however many
// model calls the agent needed before answering. Read live from the database, so
// it works while the conversation is still running and never waits for SessionEnd.
//
// Rate uses the same basis as the KPI (Σoutput ÷ Σdecode); wall-clock span is
// reported separately as 时长 and is deliberately NOT used as the denominator,
// otherwise a long conversation with a slow tail would read as a slow model.
export function queryTurns({ dataDir, startAt, endAt, days, limit }, now = Date.now()) {
  const lim = clampInt(limit, 1, 500, 120);
  const { startMs, endMs } = resolveTrendWindow({ startAt, endAt, days: days ?? 1 }, now);
  const ctx = openContext(dataDir, startMs, endMs, now);
  const byTurn = new Map();
  for (const call of ctx.ledger) {
    if (!call.turnId) continue;
    if (!byTurn.has(call.turnId)) {
      byTurn.set(call.turnId, {
        total: emptyMetrics(),
        calls: [],
        firstTs: call.ts,
        lastCallTs: call.ts,
        groups: new Map(),
        sessionId: call.sessionId,
        agentName: call.agentName || null,
      });
    }
    const t = byTurn.get(call.turnId);
    t.firstTs = Math.min(t.firstTs, call.ts);
    t.lastCallTs = Math.max(t.lastCallTs, call.ts);
    addRow(t.total, call);
    t.calls.push(call);
    const gk = `${call.provider}|${call.model}`;
    if (!t.groups.has(gk)) {
      t.groups.set(gk, {
        provider: call.provider,
        providerName: call.providerName,
        model: call.model,
        modelName: call.modelName,
        custom: call.custom,
        metrics: emptyMetrics(),
        callList: [],
      });
    }
    const g = t.groups.get(gk);
    addRow(g.metrics, call);
    g.callList.push(call);
  }

  const allTurns = [...byTurn.entries()]
    .map(([turnId, t]) => {
      const meta = ctx.turnMeta.get(turnId) || null;
      const startedMs = meta?.userTs != null ? Math.min(meta.userTs, t.firstTs) : t.firstTs;
      const endedMs = meta?.lastTs != null ? meta.lastTs : null;
      const finished = endedMs != null && (meta?.assistantCount || 0) > 0;
      let status = 'pending';
      if (finished) status = meta.finishReason === 'stop' ? 'completed' : 'unfinished';
      const models = sortGroups(
        [...t.groups.values()].map((g) => ({
          ...g,
          ...finalize(g.metrics),
          outputRate: meanCallRate(g.callList),
          metrics: undefined,
          callList: undefined,
        })),
      );
      const metrics = finalize(t.total);
      return {
        turnId,
        sessionId: t.sessionId,
        sessionTitle: ctx.titles.get(t.sessionId)?.title || null,
        agentName: t.agentName,
        startedAt: new Date(startedMs).toISOString(),
        endedAt: endedMs != null ? new Date(endedMs).toISOString() : null,
        durationMs: endedMs != null ? endedMs - startedMs : null,
        status,
        finishReason: meta?.finishReason || null,
        userPreview: meta?.userPreview || null,
        ...metrics,
        outputRate: meanCallRate(t.calls),
        rate: rateStats(t.calls),
        byModel: models,
      };
    })
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));

  // The status breakdown covers EVERY turn in the window, not only the rows
  // that survive the `limit` slice. Counting the slice instead made the
  // headline ("本次窗口共 N 次对话（已完成 X · 未收尾 Y · 进行中 Z）") add up
  // to less than N as soon as the window held more turns than the limit.
  const counts = { completed: 0, unfinished: 0, pending: 0 };
  for (const t of allTurns) counts[t.status] = (counts[t.status] || 0) + 1;

  const turns = allTurns.slice(0, lim);

  return {
    window: ctx.meta.window,
    turns,
    totalTurns: byTurn.size,
    counts,
    notes: NOTES,
    meta: ctx.meta,
  };
}

// sessions: per-session aggregation over the window, newest activity first.
// outputRate = the session's weighted decode rate (Σ output ÷ Σ decode).
export function querySessions({ dataDir, startAt, endAt, days, limit }, now = Date.now()) {
  const lim = clampInt(limit, 1, 50, 10);
  const { startMs, endMs } = resolveTrendWindow({ startAt, endAt, days: days ?? 30 }, now);
  const ctx = openContext(dataDir, startMs, endMs, now);
  const bySession = new Map();
  for (const call of ctx.ledger) {
    if (!bySession.has(call.sessionId)) {
      bySession.set(call.sessionId, {
        total: emptyMetrics(),
        firstTs: call.ts,
        lastTs: call.ts,
        groups: new Map(),
        calls: [],
        agentName: call.agentName || null,
      });
    }
    const s = bySession.get(call.sessionId);
    s.firstTs = Math.min(s.firstTs, call.ts);
    s.lastTs = Math.max(s.lastTs, call.ts);
    addRow(s.total, call);
    s.calls.push(call);
    const gk = `${call.provider}|${call.model}`;
    if (!s.groups.has(gk)) {
      s.groups.set(gk, {
        provider: call.provider,
        providerName: call.providerName,
        model: call.model,
        modelName: call.modelName,
        custom: call.custom,
        metrics: emptyMetrics(),
        callList: [],
      });
    }
    const g = s.groups.get(gk);
    addRow(g.metrics, call);
    g.callList.push(call);
  }
  const sessions = [...bySession.entries()]
    .map(([sessionId, s]) => {
      const info = ctx.titles.get(sessionId);
      const models = sortGroups(
        [...s.groups.values()].map((g) => ({
          ...g,
          ...finalize(g.metrics),
          outputRate: meanCallRate(g.callList),
          metrics: undefined,
          callList: undefined,
        })),
      );
      const metrics = finalize(s.total);
      return {
        sessionId,
        title: info?.title || null,
        agentName: s.agentName || info?.agent_name || null,
        workspaceDir: info?.workspace_dir || null,
        firstActivity: new Date(s.firstTs).toISOString(),
        lastActivity: new Date(s.lastTs).toISOString(),
        ...metrics,
        outputRate: meanCallRate(s.calls),
        rate: rateStats(s.calls),
        byModel: models,
      };
    })
    .sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : -1))
    .slice(0, lim);
  return { window: ctx.meta.window, sessions, notes: NOTES, meta: ctx.meta };
}

// daily: day x model aggregation over the trailing N days.
// outputRate = the day's weighted decode rate (Σ output ÷ Σ decode).
export function queryDaily({ dataDir, days }, now = Date.now()) {
  const n = clampInt(days, 1, 90, 7);
  const { startMs, endMs } = resolveTrendWindow({ days: n }, now);
  const ctx = openContext(dataDir, startMs, endMs, now);
  const byDay = new Map();
  for (const call of ctx.ledger) {
    const key = dayKey(call.ts);
    if (!byDay.has(key)) byDay.set(key, { total: emptyMetrics(), groups: new Map(), calls: [] });
    const day = byDay.get(key);
    addRow(day.total, call);
    day.calls.push(call);
    const gk = `${call.provider}|${call.model}`;
    if (!day.groups.has(gk)) {
      day.groups.set(gk, {
        provider: call.provider,
        providerName: call.providerName,
        model: call.model,
        modelName: call.modelName,
        custom: call.custom,
        metrics: emptyMetrics(),
        callList: [],
      });
    }
    const g = day.groups.get(gk);
    addRow(g.metrics, call);
    g.callList.push(call);
  }
  const daysOut = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, v]) => {
      const total = finalize(v.total);
      return {
        day,
        total: { ...total, outputRate: meanCallRate(v.calls), rate: rateStats(v.calls) },
        byModel: sortGroups(
          [...v.groups.values()].map((g) => ({
            ...g,
            ...finalize(g.metrics),
            outputRate: meanCallRate(g.callList),
            metrics: undefined,
            callList: undefined,
          })),
        ),
      };
    });
  return { window: ctx.meta.window, days: daysOut, notes: NOTES, meta: ctx.meta };
}
