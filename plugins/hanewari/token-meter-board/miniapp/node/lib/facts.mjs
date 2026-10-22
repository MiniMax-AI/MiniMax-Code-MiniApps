// token-meter message fact store.
//
// WHY THIS EXISTS
// The runtime database stores every message as a row in local_runtime_message_rows,
// and that table has NO index on turn_id — so any lookup by turn is a full table
// scan. The payloads are whole conversation turns (≈350 MB of JSON on a busy
// machine), while the board only needs four scalars per assistant message:
// decode duration, request duration, finish reason, plus the turn's user-message
// preview.
//
// Pulling data_json into JS and JSON.parse()-ing it measured ≈2.8 s per scan;
// extracting the same scalars inside SQLite measured ≈0.6 s. Doing that twice
// per endpoint (once for call timings, once for turn metadata) and again for
// every endpoint and every window is what made the board feel stuck when the
// query window changed.
//
// So the facts are extracted once, in rowid order, and kept in memory. Later
// scans only pick up the rows appended since the last one (`id > watermark`),
// which is what makes switching the query window instant. The rowid scan seeks
// the INTEGER PRIMARY KEY directly, so it costs nothing but the new rows.
//
// Rows are append-only in this runtime (the table holds immutable source rows
// and the state changes live in a separate diff journal), so a rowid-keyed
// cache cannot drift in practice. A full re-extract still runs periodically as
// a safety net in case a row is ever rewritten in place.

import path from 'node:path';

// Re-extract everything this often, so a rewritten row can never be missed.
const REVERIFY_MS = 10 * 60 * 1000;

// How much of the user's own message is kept for the conversation table.
// Applied inside SQLite with substr(), so the full text (up to ~52 k chars on
// this machine) is never carried into JS memory — only the first 200
// characters are.
const USER_PREVIEW_CHARS = 200;

// CASE (not AND) is deliberate: SQLite evaluates CASE lazily, so the inner
// json_type/json_extract calls only run on rows that are valid JSON. An
// expression like `json_valid(x) AND json_type(x, ...)` is not guaranteed to
// short-circuit and would raise "malformed JSON" on a bad row.
function jsonField(path, kind) {
  return `CASE WHEN json_valid(data_json) THEN CASE WHEN json_type(data_json,'${path}') ${kind} THEN json_extract(data_json,'${path}') END END`;
}

const FACT_SQL = `
  SELECT id, session_id, role, turn_id, created_at_ms,
         ${jsonField('$.usage', "= 'object'")} AS has_usage,
         ${jsonField('$.usage.decode_duration_ms', "IN ('integer','real')")} AS decode_ms,
         ${jsonField('$.usage.request_duration_ms', "IN ('integer','real')")} AS request_ms,
         ${jsonField('$.finish_reason', "= 'text'")} AS finish_reason,
         substr(${jsonField('$.msg_content', "= 'text'")}, 1, ${USER_PREVIEW_CHARS}) AS msg_preview
    FROM local_runtime_message_rows
   WHERE id > ?
   ORDER BY id`;

// One store per runtime database file.
const stores = new Map();

function createStore() {
  return {
    byTurn: new Map(), // turn_id -> entry
    watermark: 0, // highest rowid already extracted
    extractedRows: 0,
    lastSyncAt: 0,
    lastVerifyAt: 0,
    everScanned: false,
  };
}


export function getFactsStore(dataDir) {
  const key = path.join(dataDir, 'v2', 'sqlite', 'runtime-state.sqlite');
  let store = stores.get(key);
  if (!store) {
    store = createStore();
    stores.set(key, store);
  }
  return store;
}

function applyRow(store, row) {
  const turnId = row.turn_id;
  if (!turnId) return;
  let entry = store.byTurn.get(turnId);
  if (!entry) {
    entry = {
      sessionId: row.session_id,
      maxTs: null,
      calls: new Map(), // rowid -> call fact (assistant messages that carry a usage block)
      assistantCount: 0, // every assistant row, including the ones that are not model calls
      users: new Map(), // rowid -> user message fact
    };
    store.byTurn.set(turnId, entry);
  }
  if (row.created_at_ms != null && (entry.maxTs == null || row.created_at_ms > entry.maxTs)) {
    entry.maxTs = row.created_at_ms;
  }
  if (row.role === 'assistant') {
    entry.assistantCount += 1;
    // Only an assistant message that carries a usage block is a MODEL CALL.
    // The runtime also writes assistant rows for non-call events — context
    // compaction, for instance (490 of 17,214 such rows on this machine).
    // Counting those as calls shifts every later pairing in the turn by one,
    // which made a whole turn report the previous call's decode duration and
    // rate. They are counted for "did the agent answer?" but never paired.
    if (row.has_usage) {
      entry.calls.set(row.id, {
        ts: row.created_at_ms,
        decodeMs: row.decode_ms,
        requestMs: row.request_ms,
        finishReason: row.finish_reason,
      });
    }
  } else if (row.role === 'user') {
    entry.users.set(row.id, { ts: row.created_at_ms, preview: row.msg_preview });
  }
}

// Pull in every row appended since the last extraction. A full re-extract
// happens on the first sync and then every REVERIFY_MS, so the store always
// converges on the current contents of the table.
export function syncFacts(store, db, options = {}) {
  const now = options.now ?? Date.now();
  const full = !store.everScanned || now - store.lastVerifyAt >= REVERIFY_MS;
  if (full) {
    store.byTurn.clear();
    store.watermark = 0;
  }
  let rows = 0;
  let maxId = store.watermark;
  const stmt = db.prepare(FACT_SQL);
  for (const row of stmt.iterate(store.watermark)) {
    rows += 1;
    if (row.id > maxId) maxId = row.id;
    applyRow(store, row);
  }
  store.watermark = maxId;
  store.extractedRows += rows;
  store.lastSyncAt = now;
  store.everScanned = true;
  if (full) store.lastVerifyAt = now;
  return { rows, full, watermark: store.watermark, turns: store.byTurn.size };
}

// Model calls of a turn, oldest first — the same order the original query
// produced (ORDER BY created_at_ms), with the rowid as a stable tie-breaker.
// Only messages that carry a usage block are returned: those are the calls
// the runtime recorded in local_runtime_token_usage, and they are what the
// per-call ledger pairs against.
export function assistantCallsForTurn(store, turnId) {
  const entry = store.byTurn.get(turnId);
  if (!entry || entry.calls.size === 0) return null;
  const out = [...entry.calls.values()].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  return out;
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
export function turnMetaForTurn(store, turnId) {
  const entry = store.byTurn.get(turnId);
  if (!entry) return null;
  let userTs = null;
  let userPreview = null;
  for (const u of entry.users.values()) {
    if (u.ts == null) continue;
    if (userTs == null || u.ts < userTs || (u.ts === userTs && u.preview != null && userPreview == null)) {
      userTs = u.ts;
      userPreview = u.preview != null ? u.preview : userPreview;
    }
  }
  // The finish reason of the last MODEL CALL that carries one. Non-call
  // assistant rows (compaction) are deliberately excluded: they carry a
  // finish_reason of their own, and reading it would report a still-running
  // turn as "completed".
  const calls = assistantCallsForTurn(store, turnId);
  let finishReason = null;
  if (calls) {
    for (let i = calls.length - 1; i >= 0; i -= 1) {
      if (calls[i].finishReason != null) {
        finishReason = calls[i].finishReason;
        break;
      }
    }
  }
  return {
    userTs,
    userPreview,
    lastTs: entry.maxTs,
    finishReason,
    assistantCount: entry.assistantCount,
  };
}

export function factsStats(store) {
  return {
    turns: store.byTurn.size,
    extractedRows: store.extractedRows,
    watermark: store.watermark,
    lastSyncAt: store.lastSyncAt,
    lastVerifyAt: store.lastVerifyAt,
  };
}
