// token-meter shared helpers: data-dir resolution, catalog parsing, log enrichment, metrics.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { getFactsStore, syncFacts, assistantCallsForTurn, turnMetaForTurn, factsStats } from './facts.mjs';

export const SQLITE_REQUIREMENT =
  'token-meter requires Node.js 23.4+ (24 LTS recommended) so that the built-in node:sqlite module is available without flags.';

// node:sqlite is unflagged only on Node.js >= 23.4. Load it lazily so that an
// unsupported runtime gets a clear tool error instead of a process crash.
let sqliteModule;
let sqliteError;
function loadSqlite() {
  if (sqliteModule === undefined && sqliteError === undefined) {
    try {
      sqliteModule = createRequire(import.meta.url)('node:sqlite');
    } catch (err) {
      sqliteModule = null;
      sqliteError = err;
    }
  }
  return { sqlite: sqliteModule, error: sqliteError ?? null };
}

export function resolveDataDir(env = process.env) {
  if (env.MINIMAX_DATA_DIR && fs.existsSync(env.MINIMAX_DATA_DIR)) {
    return path.resolve(env.MINIMAX_DATA_DIR);
  }
  if (env.PLUGIN_DATA) {
    // <dataDir>/v2/plugin-data/<kind>/<name> -> dataDir is four levels up.
    const candidate = path.resolve(env.PLUGIN_DATA, '..', '..', '..', '..');
    if (fs.existsSync(path.join(candidate, 'v2'))) return candidate;
  }
  return path.join(os.homedir(), '.minimax');
}

export function dbPath(dataDir) {
  return path.join(dataDir, 'v2', 'sqlite', 'runtime-state.sqlite');
}

// Open the runtime state database read-only.
// Returns { db, error }: exactly one of the two is non-null.
export function openDb(dataDir) {
  const { sqlite, error: sqliteErr } = loadSqlite();
  if (!sqlite) {
    return { db: null, error: `${SQLITE_REQUIREMENT} (${sqliteErr?.code || sqliteErr?.message || 'node:sqlite unavailable'})` };
  }
  const file = dbPath(dataDir);
  if (!fs.existsSync(file)) {
    return { db: null, error: `runtime state database not found at ${file} — is this a MiniMax Code data directory with recorded usage?` };
  }
  try {
    return { db: new sqlite.DatabaseSync(file, { readOnly: true }), error: null };
  } catch (err) {
    return { db: null, error: `failed to open runtime state database read-only: ${err.message}` };
  }
}

// The message fact store is shared per runtime database, so every query in this
// process reuses the same extraction instead of re-parsing the message table.
export function factsStore(dataDir) {
  return getFactsStore(dataDir);
}

// Snapshot of the message-fact cache, for the health endpoint.
export { factsStats };

// Query raw usage rows in [startMs, endMs] ascending by ts.
export function queryUsageRows(db, startMs, endMs) {
  return db
    .prepare(
      `SELECT session_id, agent_name, turn_id, model, ts,
              input_tokens, output_tokens, reasoning_tokens,
              cache_read_tokens, cache_write_tokens, cost_usd
         FROM local_runtime_token_usage
        WHERE ts >= ? AND ts <= ?
        ORDER BY ts`,
    )
    .all(startMs, endMs);
}

export function dayKey(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Resolve a query window. Either explicit startDate/endDate (YYYY-MM-DD, inclusive,
// local time) or `days` = trailing N days including today.
export function resolveWindow({ days, startDate, endDate } = {}, now = Date.now()) {
  if (startDate) {
    const start = new Date(`${startDate}T00:00:00`);
    const endBase = endDate ? new Date(`${endDate}T23:59:59.999`) : new Date(start.getTime() + 86400000 - 1);
    if (Number.isNaN(start.getTime()) || Number.isNaN(endBase.getTime())) {
      throw new Error(`invalid startDate/endDate: ${startDate} ${endDate || ''}`.trim());
    }
    const startMs = start.getTime();
    const endMs = Math.min(endBase.getTime(), now);
    if (endMs < startMs) throw new Error('window end is before start');
    return { startMs, endMs, label: `${dayKey(startMs)}..${dayKey(endMs)}` };
  }
  const n = clampInt(days ?? 1, 1, 90, 1);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const startMs = todayStart.getTime() - (n - 1) * 86400000;
  return { startMs, endMs: now, label: n === 1 ? dayKey(startMs) : `${dayKey(startMs)}..${dayKey(now)}` };
}

// --- config.yaml catalog (provider/model display names) ----------------------

function unquote(value) {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

// Minimal line-based YAML reader targeting only the provider sections we need.
// Returns { providers: Map<id, {name, kind}>, modelNames: Map<'providerId/modelId', name>,
//           modelToProvider: Map<modelId, providerId> }.
//
// The catalog is read from the same config.yaml on every query, so it is cached
// per (mtime, size) and only re-parsed when the file actually changes.
let catalogCache = null;

export function loadCatalog(dataDir) {
  const file = path.join(dataDir, 'config.yaml');
  let stamp = null;
  try {
    const st = fs.statSync(file);
    stamp = `${st.mtimeMs}:${st.size}`;
  } catch {
    stamp = null;
  }
  if (catalogCache && catalogCache.stamp === stamp) return catalogCache.catalog;
  const catalog = parseCatalog(file);
  catalogCache = { stamp, catalog };
  return catalog;
}

function parseCatalog(file) {
  const providers = new Map();
  const modelNames = new Map();
  const modelToProvider = new Map();
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { providers, modelNames, modelToProvider };
  }
  try {
    // ctx: null | { section: 'custom'|'builtin', providerId, providerIndent, inModels, modelId, modelIndent }
    let ctx = null;
    for (const rawLine of text.split('\n')) {
      if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) continue;
      const indent = rawLine.length - rawLine.trimStart().length;
      const line = rawLine.trim();

      if (indent === 0) {
        if (line === 'custom_provider:') {
          ctx = { section: 'custom', providerId: null, providerIndent: -1, inModels: false, modelId: null };
        } else if (line === 'provider:') {
          ctx = { section: 'builtin', providerId: null, providerIndent: -1, inModels: false, modelId: null };
        } else if (!line.startsWith('-')) {
          ctx = null; // left the provider sections
        }
        continue;
      }
      if (!ctx) continue;

      // Provider entry: "  provider-c582e6:" or "  minimax:"
      if (ctx.providerId === null || indent <= ctx.providerIndent) {
        const m = line.match(/^([A-Za-z0-9._-]+):\s*$/);
        if (m && indent >= 2) {
          ctx.providerId = m[1];
          ctx.providerIndent = indent;
          ctx.inModels = false;
          ctx.modelId = null;
          if (!providers.has(ctx.providerId)) {
            providers.set(ctx.providerId, { name: ctx.providerId, kind: ctx.section });
          }
          continue;
        }
      }
      if (!ctx.providerId) continue;

      const kv = line.match(/^([A-Za-z0-9._-]+):\s*(.*)$/);
      if (!kv) continue;
      const [, key, rest] = kv;

      if (key === 'models' && rest === '') {
        ctx.inModels = true;
        ctx.modelId = null;
        ctx.modelIndent = -1;
        continue;
      }
      if (!ctx.inModels && key === 'name' && rest) {
        providers.get(ctx.providerId).name = unquote(rest);
        continue;
      }
      if (ctx.inModels) {
        if (ctx.modelId === null || indent <= ctx.modelIndent) {
          const mm = line.match(/^([A-Za-z0-9._-]+):\s*$/);
          if (mm) {
            ctx.modelId = mm[1];
            ctx.modelIndent = indent;
            modelToProvider.set(ctx.modelId, ctx.providerId);
            continue;
          }
        }
        if (ctx.modelId && key === 'name' && rest) {
          modelNames.set(`${ctx.providerId}/${ctx.modelId}`, unquote(rest));
        }
      }
    }
  } catch {
    // tolerate partial catalog
  }
  return { providers, modelNames, modelToProvider };
}

// --- runtime log enrichment (turn_id -> provider/model, per-call status) -----
//
// Log files rotate hourly: runtime-YYYYMMDDHH.log (local time). Select files by
// filename hour intersecting the window (plus 1h look-behind for stragglers),
// so coverage spans the whole window instead of just the newest few files.
// Each llm_response_identifiers line contributes one call record with its own
// timestamp and response_status; a turn produces one line per LLM call.

const LOG_LINE_TS = /^\[(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]/;

// Log files rotate hourly and are append-only, so a file whose (mtime, size) is
// unchanged still holds exactly the same records. Caching per file means a
// window switch re-reads only the hour currently being written instead of
// rescanning every hour of the window — that was ≈750 ms on a one-week window.
const logFileCache = new Map(); // absolute path -> { stamp, records }
const LOG_FILE_CACHE_MAX = 256; // bound the memory of a long-running runtime

function stampOf(st) {
  return `${st.mtimeMs}:${st.size}`;
}

function parseLogFile(file, maxBytesPerFile) {
  const records = [];
  let text;
  try {
    const st = fs.statSync(file);
    const fd = fs.openSync(file, 'r');
    try {
      const start = st.size > maxBytesPerFile ? st.size - maxBytesPerFile : 0;
      const buf = Buffer.alloc(st.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      text = buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
  for (const line of text.split('\n')) {
    const i = line.indexOf('llm_response_identifiers ');
    if (i < 0) continue;
    const j = line.indexOf('{', i);
    if (j < 0) continue;
    let obj;
    try {
      obj = JSON.parse(line.slice(j));
    } catch {
      continue; // partial tail line or unexpected shape
    }
    if (!obj || !obj.turn_id) continue;
    const tm = line.slice(0, i).match(LOG_LINE_TS);
    // Seconds since local midnight. The capture groups are strings, so they
    // must be coerced explicitly — `a + tm[3]` would concatenate instead of add.
    const ts = tm
      ? Number(tm[1]) * 3600 + Number(tm[2]) * 60 + Number(tm[3]) + Number(tm[4]) / 1000
      : null;
    records.push({
      turn_id: obj.turn_id,
      provider: obj.provider || null,
      model: obj.model || null,
      status: typeof obj.response_status === 'number' ? obj.response_status : null,
      ts,
    });
  }
  return records;
}

export function loadTurnEnrichment(dataDir, windowStartMs, options = {}) {
  const maxBytesPerFile = options.maxBytesPerFile ?? 12 * 1024 * 1024;
  const now = options.now ?? Date.now();
  const map = new Map();
  const dir = path.join(dataDir, 'v2', 'observability', 'logs');
  let names;
  try {
    names = fs.readdirSync(dir).filter((f) => /^runtime-\d+\.log$/.test(f));
  } catch {
    return { map, filesScanned: 0 };
  }
  const firstHour = new Date(windowStartMs - 3600000);
  firstHour.setMinutes(0, 0, 0);
  let filesScanned = 0;
  for (const name of names) {
    const m = name.match(/^runtime-(\d{4})(\d{2})(\d{2})(\d{2})\.log$/);
    if (!m) continue;
    const fileHourMs = new Date(+m[1], +m[2] - 1, +m[3], +m[4]).getTime();
    if (fileHourMs < firstHour.getTime() || fileHourMs > now + 3600000) continue;
    const p = path.join(dir, name);
    let stamp = null;
    try {
      stamp = stampOf(fs.statSync(p));
    } catch {
      continue;
    }
    const cached = logFileCache.get(p);
    let records;
    if (cached && cached.stamp === stamp) {
      records = cached.records;
    } else {
      const parsed = parseLogFile(p, maxBytesPerFile);
      if (!parsed) continue;
      records = parsed;
      logFileCache.set(p, { stamp, records });
      while (logFileCache.size > LOG_FILE_CACHE_MAX) {
        const oldest = logFileCache.keys().next().value;
        if (oldest === p) break;
        logFileCache.delete(oldest);
      }
    }
    filesScanned += 1;
    // The log line carries a wall-clock time; the file name carries the hour it
    // belongs to, so the absolute timestamp is the file's day base plus that.
    const dayBase = new Date(+m[1], +m[2] - 1, +m[3]).getTime();
    for (const rec of records) {
      if (!map.has(rec.turn_id)) map.set(rec.turn_id, { provider: null, model: null, calls: [] });
      const entry = map.get(rec.turn_id);
      if (!entry.provider && rec.provider) entry.provider = rec.provider;
      if (!entry.model && rec.model) entry.model = rec.model;
      entry.calls.push({ ts: rec.ts == null ? null : dayBase + rec.ts * 1000, status: rec.status });
    }
  }
  for (const entry of map.values()) entry.calls.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  return { map, filesScanned };
}

// --- row identity + metrics ---------------------------------------------------

export function resolveRowIdentity(row, enrichment, catalog) {
  let model = row.model || null;
  let provider = null;
  const hit = row.turn_id ? enrichment.get(row.turn_id) : null;
  if (hit) {
    provider = hit.provider || null;
    model = model || hit.model || null;
  }
  let providerId = null;
  let custom = false;
  if (provider && provider.startsWith('custom_provider:')) {
    providerId = provider.slice('custom_provider:'.length);
    custom = true;
  } else if (provider) {
    providerId = provider;
    custom = catalog.providers.get(providerId)?.kind === 'custom';
  }
  if (!providerId && model && catalog.modelToProvider.has(model)) {
    providerId = catalog.modelToProvider.get(model);
    custom = catalog.providers.get(providerId)?.kind === 'custom';
    provider = custom ? `custom_provider:${providerId}` : providerId;
  }
  const modelKey = providerId && model ? `${providerId}/${model}` : null;
  return {
    provider: provider || 'unknown',
    providerId: providerId || 'unknown',
    model: model || '(unknown)',
    custom,
    providerName: (providerId && catalog.providers.get(providerId)?.name) || provider || 'unknown',
    modelName: (modelKey && catalog.modelNames.get(modelKey)) || model || '(unknown)',
  };
}

export function emptyMetrics() {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    cacheHitRate: null,
    costUsd: 0,
  };
}

export function addRow(m, r) {
  m.calls += 1;
  m.inputTokens += r.input_tokens || 0;
  m.outputTokens += r.output_tokens || 0;
  m.reasoningTokens += r.reasoning_tokens || 0;
  m.cacheReadTokens += r.cache_read_tokens || 0;
  m.cacheWriteTokens += r.cache_write_tokens || 0;
  m.costUsd += r.cost_usd || 0;
}

export function finalize(m) {
  m.totalTokens = m.inputTokens + m.outputTokens + m.reasoningTokens + m.cacheReadTokens + m.cacheWriteTokens;
  const denom = m.inputTokens + m.cacheReadTokens;
  m.cacheHitRate = denom > 0 ? Math.round((m.cacheReadTokens / denom) * 10000) / 10000 : null;
  m.costUsd = Math.round(m.costUsd * 1e6) / 1e6;
  return m;
}

export function sortGroups(groups) {
  return groups.sort((a, b) => {
    if (a.custom !== b.custom) return a.custom ? -1 : 1;
    return b.totalTokens - a.totalTokens;
  });
}

// --- per-call ledger (usage rows joined with message timing + log status) ----
//
// local_runtime_token_usage never stores the model and has no call duration.
// One side source completes the picture: assistant message rows
// (local_runtime_message_rows.data_json) carry the very timings MiniMax Code
// itself uses for pi_llm_tokens_per_second — usage.request_duration_ms (request
// start → stream end) and usage.decode_duration_ms (first token → stream end) —
// plus finish_reason. Log lines additionally carry response_status.
//
// Pairing: inside a turn the runtime writes two records per call — the usage
// row is stamped when the call STARTS, and the matching assistant message is
// written when that call ENDS. So the message that belongs to a call that
// started at T is the FIRST message of that turn written at or after T: every
// earlier message of the turn was written before this call started.
//
// That rule replaces the old "the i-th message pairs with the i-th usage row",
// because the message sequence also holds rows that are not model calls at
// all — context compaction writes an assistant row with no usage block (490
// of the 17,214 assistant messages on this machine). Counting those as calls
// shifted a whole turn by one, so 22.5% of the calls reported the PREVIOUS
// call's decode duration and rate. With the "first message at or after the
// call start" rule all 16,723 measurable calls pair correctly (0 errors), and
// it stays correct when the query window starts in the middle of a turn.
//
// There is deliberately no upper bound on how long a single call may take —
// see the interleaving invariant in buildCallLedger.

// Bring the in-memory fact store up to date with the database, then hand it
// back. Extracting the message facts is the expensive part of a query, so it
// happens once per process and only picks up newly appended rows afterwards.
export function syncMessageFacts(db, dataDir, options = {}) {
  const store = factsStore(dataDir);
  syncFacts(store, db, options);
  return store;
}

// Assistant call timings per turn, keyed `${session_id}|${turn_id}`.
// The facts come from the shared store, so this no longer touches the
// message table at all.
export function loadAssistantCallDetails(rows, store) {
  const byTurn = new Map(); // key `${session_id}|${turn_id}` -> [{ts, decodeMs, requestMs, finishReason}]
  for (const r of rows) {
    if (!r.turn_id) continue;
    const key = `${r.session_id}|${r.turn_id}`;
    if (byTurn.has(key)) continue;
    const list = assistantCallsForTurn(store, r.turn_id);
    if (list) byTurn.set(key, list);
  }
  return byTurn;
}

// Per-turn message metadata for the conversation table.
//
// A turn is exactly one user message followed by however many model calls the
// agent needed before answering, so it is the natural unit for "one thing the
// user asked" — and it is readable from the database the instant the first
// usage row of that turn lands, with no hook and no waiting for the session
// to close. Verified on this machine: 26 turns today, 24 carrying exactly one
// user message, 0 carrying more than one, and all 26 ending on an assistant
// message.
export function loadTurnMessageMeta(rows, store) {
  const meta = new Map(); // turn_id -> {userTs, userPreview, lastTs, finishReason, assistantCount}
  for (const r of rows) {
    if (!r.turn_id || meta.has(r.turn_id)) continue;
    const m = turnMetaForTurn(store, r.turn_id);
    if (m) meta.set(r.turn_id, m);
  }
  return meta;
}

// Build one ledger entry per usage row, ordered by ts.
//
// Pairing (see the header comment for the full invariant):
//   - the assistant message is the first message of the turn written at or
//     after the call started;
//   - the log line is the first llm_response_identifiers record of the turn
//     written at or after the call started, and not after the next call of
//     the same turn started.
//
// rate = output_tokens / decode_duration.
//
// Validity is the interleaving invariant, not an absolute duration limit: a call
// cannot finish before it starts, and cannot finish after the *next* call in the
// same turn has already started. An absolute cap would reject legitimate long
// calls (a 9-minute run) and push the pairing back onto nearest-neighbour matching,
// which shifts every following row by one — so there is deliberately no upper
// bound on how long a single call may take.

export function buildCallLedger(rows, enrichment, assistantByTurn, catalog) {
  const ledger = [];
  const msgCursor = new Map(); // turn key -> next assistant message index
  const logCursor = new Map(); // turn key -> next log record index
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const id = resolveRowIdentity(row, enrichment, catalog);
    const key = `${row.session_id}|${row.turn_id}`;
    const next = rows[i + 1];
    // The next call of the SAME turn bounds the interval this call owns.
    const boundTs = next && next.turn_id === row.turn_id ? next.ts : null;

    // --- assistant message (decode / request timing, finish reason) ---
    let msg = null;
    const list = row.turn_id ? assistantByTurn.get(key) : null;
    if (list && list.length) {
      const from = msgCursor.get(key) || 0;
      for (let j = from; j < list.length; j += 1) {
        const c = list[j];
        // written before this call started — belongs to an earlier call
        if (c.ts == null || c.ts < row.ts) continue;
        msg = c;
        msgCursor.set(key, j + 1);
        break;
      }
    }

    // --- log line (response status) ---
    // The runtime writes the llm_response_identifiers line a moment AFTER the
    // usage row is stamped (measured: +443 ms … +194 s, median +2.6 s), so a
    // nearest-time match walks BACKWARDS and lands on the PREVIOUS call's
    // line: of 2220 measured mismatches, every single one was off by one in
    // that direction. The matching record is the first one at or after this
    // call's start.
    let statusHit = null;
    const enrichEntry = row.turn_id ? enrichment.get(row.turn_id) : null;
    if (enrichEntry && enrichEntry.calls.length) {
      const from = logCursor.get(key) || 0;
      for (let j = from; j < enrichEntry.calls.length; j += 1) {
        const c = enrichEntry.calls[j];
        if (c.ts == null || c.ts < row.ts) continue;
        // written after the next call of this turn started — that one owns it
        if (boundTs != null && c.ts > boundTs) break;
        statusHit = c;
        logCursor.set(key, j + 1);
        break;
      }
    }
    const status = statusHit ? statusHit.status : null;
    const decodeMs = msg ? msg.decodeMs : null;
    const requestMs = msg ? msg.requestMs : null;
    const output = row.output_tokens || 0;
    const succeeded = status == null || status === 200; // a recorded usage row implies a completed call
    // Headline rate: identical to the desktop UI's tokens/s — output tokens ÷ decode
    // duration (first token → stream end), the span during which tokens actually arrive.
    const rate = succeeded && decodeMs > 0 && output > 0 ? Math.round((output / (decodeMs / 1000)) * 100) / 100 : null;
    // Whole-request reference (output ÷ request_duration_ms); the gap between the two
    // is time-to-first-token plus queueing.
    const requestRate =
      succeeded && requestMs > 0 && output > 0 ? Math.round((output / (requestMs / 1000)) * 100) / 100 : null;
    ledger.push({
      ts: row.ts,
      sessionId: row.session_id,
      agentName: row.agent_name || null,
      turnId: row.turn_id || null,
      // identity (from resolveRowIdentity)
      provider: id.provider,
      providerId: id.providerId,
      model: id.model,
      custom: id.custom,
      providerName: id.providerName,
      modelName: id.modelName,
      // snake_case token fields keep addRow() compatibility
      input_tokens: row.input_tokens || 0,
      output_tokens: row.output_tokens || 0,
      reasoning_tokens: row.reasoning_tokens || 0,
      cache_read_tokens: row.cache_read_tokens || 0,
      cache_write_tokens: row.cache_write_tokens || 0,
      cost_usd: row.cost_usd || 0,
      decodeMs,
      requestMs,
      finishReason: msg ? msg.finishReason : null,
      status,
      rate,
      requestRate,
    });
  }
  return ledger;
}

export function buildLedgerWithDb(db, rows, enrichment, catalog, store) {
  return buildCallLedger(rows, enrichment, loadAssistantCallDetails(rows, store), catalog);
}

// --- rate aggregation ---------------------------------------------------------
//
// The rate shown by MiniMax Code's own UI lives in the desktop bundle and is
// computed as tokensPerSecond = Σ outputTokens / Σ decodeDurationMs over a set of
// calls — i.e. decode-based (first token → stream end) and time-weighted, NOT the
// arithmetic mean of per-call rates. We reproduce exactly that so the board and
// the chat UI agree, and keep the whole-request rate as the reference column
// (their difference is time-to-first-token plus queueing).
//
// `decode > request` is a CONSISTENCY guard, not a truncation detector.
// decode = completed − firstToken and request = completed − requestStarted, so
// decode > request is exactly firstTokenTime < requestStartedAt: the first
// token "arrived" before the request was sent. That cannot happen inside one
// coherent call — the two stamps must come from different attempts. Measured
// on this machine it shows up only on finish_reason='toolUse', where the
// request timer gets re-stamped on the tool-call continuation: 6 of 2674 timed
// calls (0.22%), overshooting by 0.25–2.1s against 3.8–56s requests. Such a
// decode is longer than physically possible and would pad the aggregate's
// denominator, so it is skipped; the per-call value is still shown.
//
// NOTE this is NOT what catches the degenerate sub-second decode spans. Those
// run ~100ms against a multi-second request, so decode < request and they pass
// straight through — they inflate the rate instead, which is a separate known
// property of the runtime's timing (see README).

export function collectDecodeRates(calls) {
  const out = [];
  for (const c of calls) {
    if (typeof c.rate !== 'number') continue;
    if (c.decodeMs != null && c.requestMs != null && c.decodeMs > c.requestMs) continue;
    out.push(c.rate);
  }
  return out;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

function describe(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  return {
    mean: round2(sorted.reduce((s, v) => s + v, 0) / sorted.length),
    p50: round2(percentile(sorted, 0.5)),
    p90: round2(percentile(sorted, 0.9)),
    max: round2(sorted[sorted.length - 1]),
    n: sorted.length,
  };
}

// MiniMax Code UI basis: Σ output tokens ÷ Σ decode duration.
function weightedRate(calls, msKey, rateKey) {
  let tokens = 0;
  let ms = 0;
  for (const c of calls) {
    if (typeof c[rateKey] !== 'number') continue;
    if (msKey === 'decodeMs' && c.decodeMs != null && c.requestMs != null && c.decodeMs > c.requestMs) continue;
    tokens += c.output_tokens || 0;
    ms += c[msKey] || 0;
  }
  return ms > 0 ? round2(tokens / (ms / 1000)) : null;
}

// The headline metric: identical to the desktop UI's tokens/s figure.
export function rateStats(calls) {
  const d = describe(collectDecodeRates(calls));
  const weighted = weightedRate(calls, 'decodeMs', 'rate');
  return d ? { ...d, weighted } : null;
}

// Whole-request reference rate (output ÷ request_duration_ms).
export function requestRateStats(calls) {
  const values = [];
  for (const c of calls) if (typeof c.requestRate === 'number') values.push(c.requestRate);
  const d = describe(values);
  const weighted = weightedRate(calls, 'requestMs', 'requestRate');
  return d ? { ...d, weighted } : null;
}

export function meanCallRate(calls) {
  return rateStats(calls)?.weighted ?? null;
}

export function countRatedCalls(calls) {
  let n = 0;
  for (const c of calls) if (typeof c.rate === 'number') n += 1;
  return n;
}
