// @ts-check
// token-meter-board session-record reader.
//
// DATA SOURCE — and the only one:
//
//   <dataRoot>/v2/sessions/<YYYY>/<MM>/<DD>/<session>/messages.jsonl
//   <dataRoot>/v2/sessions/<YYYY>/<MM>/<DD>/<session>/manifest.json
//
// The runtime's internal database, its observability logs and its
// configuration file are deliberately NOT read. A community Mini App must not
// open Host-internal stores, not even read-only, so every number on this
// board is derived from the session records the runtime writes for the user's
// own conversations.
//
// WHAT THE SESSION RECORDS CONTAIN
//
//   message.role      user | assistant | toolResult | custom | compactionSummary
//   message.timestamp  epoch ms
//   message.model     model id reported by the provider
//   message.usage     { input, output, cacheRead, cacheWrite, totalTokens, cost }
//   message.stopReason  "stop" | "toolUse" | "aborted" | ...
//   record.turn_id    one user question and the assistant calls that answer it
//   record.message_id stable id, used to de-duplicate
//
// The records do NOT carry request or decode durations, so this board cannot
// show token rates, and they do not carry workspace paths, so it never shows
// one.
//
// SCANNING
//
// A full scan of every session file on this machine is ~320 MiB of JSON. The
// reader therefore keeps a per-file cursor (byte offset + head hash) and only
// parses the bytes appended since the previous scan. The cursor is persisted
// in the plugin's own `context.dataDir`, so a restart resumes instead of
// re-reading everything.

import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const STATE_FILE = 'session-scan-state.json';
const STATE_VERSION = 1;
const HEAD_BYTES = 4096;
const SAVE_THROTTLE_MS = 15000;

/** stopReason codes kept compact in the persisted state. */
const STOP_CODES = { stop: 1, toolUse: 2, aborted: 3 };
const STOP_NAMES = { 1: 'stop', 2: 'toolUse', 3: 'aborted' };

// ---------------------------------------------------------------------------
// path helpers
// ---------------------------------------------------------------------------

/** @param {string} dir */
async function isDirectory(dir) {
  try {
    return (await fsp.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Locate the active runtime's session-record directory.
 *
 * The Host-provided `context.dataDir` lives inside the active data root (for
 * example `<dataRoot>/v2/plugin-data/<plugin>`), so walking up from it finds
 * the root that is actually in use. This is the same resolution the official
 * gallery's token-usage board uses.
 *
 * @param {import('./miniapp-api.js').MiniAppContext} context
 * @returns {Promise<string>}
 */
export async function resolveSessionsRoot(context) {
  const envDir = process.env.MINIMAX_DATA_DIR;
  if (envDir) {
    const candidate = path.join(envDir, 'v2', 'sessions');
    if (await isDirectory(candidate)) return candidate;
  }
  let dir = context.dataDir ? path.resolve(context.dataDir) : null;
  for (let i = 0; dir && i < 10; i += 1) {
    const candidate = path.join(dir, 'v2', 'sessions');
    if (await isDirectory(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(os.homedir(), '.minimax', 'v2', 'sessions');
}

/**
 * Collect every `messages.jsonl` under the session root.
 * The layout is `<root>/YYYY/MM/DD/<session>/`, but the walk also accepts
 * other depths so a future runtime layout still works.
 * @param {string} root
 */
async function collectSessionFiles(root) {
  /** @type {string[]} */
  const found = [];
  /** @type {{dir: string, depth: number}[]} */
  const queue = [{ dir: root, depth: 0 }];
  while (queue.length) {
    const current = queue.shift();
    if (!current) break;
    let entries;
    try {
      entries = await fsp.readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < 5) queue.push({ dir: full, depth: current.depth + 1 });
        continue;
      }
      if (entry.name === 'messages.jsonl') found.push(full);
    }
  }
  return found.sort();
}

/**
 * Read a session id from the manifest that sits next to the transcript.
 * @param {string} dir
 */
async function readSessionId(dir) {
  try {
    const raw = await fsp.readFile(path.join(dir, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(raw);
    if (typeof manifest?.sessionId === 'string' && manifest.sessionId) return manifest.sessionId;
  } catch {
    // manifest is optional
  }
  return null;
}

const SYSTEM_REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
const TITLE_MAX = 80;

/**
 * Derive a short human-readable session title from the first user text.
 * Mirrors the official gallery's token-usage board: only the first text block
 * of the first user message, with injected system reminders removed.
 * @param {any} message
 */
function titleFromUserMessage(message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  for (const block of content) {
    if (block?.type !== 'text' || typeof block.text !== 'string') continue;
    const cleaned = block.text.replace(SYSTEM_REMINDER_RE, '').replace(/\s+/g, ' ').trim();
    if (cleaned) return cleaned.length > TITLE_MAX ? `${cleaned.slice(0, TITLE_MAX)}…` : cleaned;
  }
  return null;
}

/** @param {unknown} value */
function num(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * The runtime records `cost` either as a number or as a breakdown object
 * (`{ input, output, cacheRead, cacheWrite, total }`); the object form is what
 * this runtime writes.
 * @param {unknown} value
 */
function costValue(value) {
  if (typeof value === 'number') return num(value);
  if (value && typeof value === 'object') return num(/** @type {any} */ (value).total);
  return 0;
}

// ---------------------------------------------------------------------------
// file parsing
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} CallFact
 * @property {string} id       message id
 * @property {number} ts       epoch ms
 * @property {string} model
 * @property {string} turn     turn id ('' when the record has none)
 * @property {number} input
 * @property {number} output
 * @property {number} cacheRead
 * @property {number} cacheWrite
 * @property {number} total
 * @property {number} cost
 * @property {number} stop     stopReason code
 */

/**
 * @typedef {Object} TurnFact
 * @property {number} user
 * @property {number} assistant
 * @property {number} firstTs
 * @property {number} lastTs
 * @property {number} lastStop
 * @property {number} lastStopTs
 */

/**
 * @typedef {Object} FileFact
 * @property {string} path
 * @property {number} size
 * @property {number} mtimeMs
 * @property {number} offset     bytes already consumed
 * @property {string} head       hash of the first bytes, detects rewrites
 * @property {string} sessionId
 * @property {string} title
 * @property {CallFact[]} calls
 * @property {Map<string, TurnFact>} turns
 */

/**
 * Read the first bytes of a file and hash them, so a rewritten transcript is
 * detected even when it only grew.
 * @param {string} file
 */
async function readHeadHash(file) {
  let handle;
  try {
    handle = await fsp.open(file, 'r');
    const buf = Buffer.allocUnsafe(HEAD_BYTES);
    const { bytesRead } = await handle.read(buf, 0, HEAD_BYTES, 0);
    return crypto.createHash('sha1').update(buf.subarray(0, bytesRead)).digest('hex').slice(0, 16);
  } catch {
    return '';
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * Read a byte range of a file.
 * @param {string} file
 * @param {number} start
 * @param {number} length
 */
async function readRange(file, start, length) {
  if (length <= 0) return Buffer.alloc(0);
  let handle;
  try {
    handle = await fsp.open(file, 'r');
    const buf = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buf, 0, length, start);
    return buf.subarray(0, bytesRead);
  } catch {
    return Buffer.alloc(0);
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * Parse the text of one transcript into calls and per-turn counters.
 * @param {string} text
 * @param {Map<string, TurnFact>} turns  mutated in place
 * @param {{id: string, ts: number, model: string, turn: string, input: number, output: number, cacheRead: number, cacheWrite: number, total: number, cost: number, stop: number}[]} calls  mutated in place
 */
function parseTranscript(text, turns, calls) {
  const lines = text.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    /** @type {any} */
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const message = record?.message;
    if (!message || typeof message !== 'object') continue;
    const turn = typeof record.turn_id === 'string' ? record.turn_id : '';
    const ts = typeof message.timestamp === 'number' ? message.timestamp : 0;

    let turnFact = turn ? turns.get(turn) : undefined;
    if (turn && !turnFact) {
      turnFact = { user: 0, assistant: 0, firstTs: 0, lastTs: 0, lastStop: 0, lastStopTs: 0 };
      turns.set(turn, turnFact);
    }
    if (turnFact) {
      if (ts && (!turnFact.firstTs || ts < turnFact.firstTs)) turnFact.firstTs = ts;
      if (ts && ts > turnFact.lastTs) turnFact.lastTs = ts;
    }

    if (message.role === 'user') {
      if (turnFact) turnFact.user += 1;
      continue;
    }
    if (message.role !== 'assistant') continue;
    if (turnFact) turnFact.assistant += 1;

    const stopCode = STOP_CODES[message.stopReason] ?? 0;
    if (turnFact && ts >= turnFact.lastStopTs) {
      turnFact.lastStop = stopCode;
      turnFact.lastStopTs = ts;
    }

    const usage = message.usage;
    if (!usage || typeof usage !== 'object') continue;
    calls.push({
      id: typeof record.message_id === 'string' && record.message_id ? record.message_id : `${message.responseId ?? ''}:${ts}:${calls.length}`,
      ts,
      model: typeof message.model === 'string' && message.model ? message.model : '(unknown)',
      turn,
      input: num(usage.input),
      output: num(usage.output),
      cacheRead: num(usage.cacheRead),
      cacheWrite: num(usage.cacheWrite),
      total: num(usage.totalTokens),
      cost: costValue(usage.cost),
      stop: stopCode,
    });
  }
}

// ---------------------------------------------------------------------------
// the store
// ---------------------------------------------------------------------------

export class SessionStore {
  /** @param {import('./miniapp-api.js').MiniAppContext} context */
  constructor(context) {
    this.context = context;
    /** @type {string} */
    this.root = '';
    /** @type {Map<string, FileFact>} */
    this.files = new Map();
    this.scannedAt = 0;
    this.scanMs = 0;
    this.lastError = '';
    /** @type {Promise<void> | null} */
    this.scanning = null;
    this.lastSaveAt = 0;
    this.dirty = false;
    this.statePath = path.join(context.dataDir, STATE_FILE);
    this.ready = false;
  }

  /** Load the persisted cursor, if one is usable. */
  async init() {
    this.root = await resolveSessionsRoot(this.context);
    try {
      const raw = await fsp.readFile(this.statePath, 'utf8');
      const state = JSON.parse(raw);
      if (state?.version === STATE_VERSION && state.root === this.root && Array.isArray(state.files)) {
        for (const entry of state.files) {
          /** @type {FileFact} */
          const file = {
            path: entry.p,
            size: entry.size | 0,
            mtimeMs: entry.mtimeMs | 0,
            offset: entry.offset | 0,
            head: typeof entry.head === 'string' ? entry.head : '',
            sessionId: typeof entry.sessionId === 'string' ? entry.sessionId : '',
            title: typeof entry.title === 'string' ? entry.title : '',
            calls: [],
            turns: new Map(),
          };
          for (const c of entry.calls ?? []) {
            file.calls.push({
              id: c[0],
              ts: c[1],
              model: c[2],
              turn: c[3],
              input: c[4],
              output: c[5],
              cacheRead: c[6],
              cacheWrite: c[7],
              total: c[8],
              cost: c[9],
              stop: c[10],
            });
          }
          for (const t of entry.turns ?? []) {
            file.turns.set(t[0], { user: t[1], assistant: t[2], firstTs: t[3], lastTs: t[4], lastStop: t[5], lastStopTs: t[6] });
          }
          this.files.set(file.path, file);
        }
      }
    } catch {
      // no usable snapshot; the first scan reads everything
    }
    this.ready = true;
  }

  /**
   * Refresh the file set and parse whatever changed.
   * Concurrent callers share one scan.
   */
  async scan() {
    if (this.scanning) return this.scanning;
    this.scanning = this.#scanInner().finally(() => {
      this.scanning = null;
    });
    return this.scanning;
  }

  async #scanInner() {
    const started = Date.now();
    let files = [];
    try {
      files = await collectSessionFiles(this.root);
    } catch (error) {
      this.lastError = 'sessions_root_unreadable';
      this.scannedAt = Date.now();
      this.scanMs = Date.now() - started;
      return;
    }
    this.lastError = '';

    const seen = new Set();
    for (const file of files) {
      seen.add(file);
      await this.#updateFile(file);
    }
    for (const known of [...this.files.keys()]) {
      if (!seen.has(known)) this.files.delete(known);
    }
    this.scannedAt = Date.now();
    this.scanMs = Date.now() - started;
    this.dirty = true;
    await this.save();
  }

  /**
   * Parse one transcript, reusing the previous cursor when the file only grew.
   * @param {string} file
   */
  async #updateFile(file) {
    let stat;
    try {
      stat = await fsp.stat(file);
    } catch {
      this.files.delete(file);
      return;
    }
    if (!stat.isFile()) return;

    const previous = this.files.get(file);
    const head = await readHeadHash(file);
    const canResume = Boolean(
      previous &&
        previous.head === head &&
        stat.size >= previous.size &&
        previous.offset <= stat.size,
    );

    /** @type {CallFact[]} */
    const calls = [];
    /** @type {Map<string, TurnFact>} */
    const turns = new Map();
    let title = '';
    let offset = 0;

    if (canResume && previous) {
      calls.push(...previous.calls);
      for (const [key, value] of previous.turns) turns.set(key, { ...value });
      title = previous.title;
      const tail = await readRange(file, previous.offset, stat.size - previous.offset);
      const text = tail.toString('utf8');
      const lastBreak = text.lastIndexOf('\n');
      if (lastBreak >= 0) {
        const complete = text.slice(0, lastBreak + 1);
        parseTranscript(complete, turns, calls);
        offset = previous.offset + Buffer.byteLength(complete, 'utf8');
      } else {
        // A single trailing line with no newline: it may still be growing.
        // Parse it, and only accept it when it is valid JSON.
        const before = calls.length;
        parseTranscript(text, turns, calls);
        const grew = calls.length > before;
        offset = grew ? previous.offset + Buffer.byteLength(text, 'utf8') : previous.offset;
      }
    } else {
      const whole = await readRange(file, 0, stat.size);
      const text = whole.toString('utf8');
      const lastBreak = text.lastIndexOf('\n');
      const complete = lastBreak >= 0 ? text.slice(0, lastBreak + 1) : text;
      parseTranscript(complete, turns, calls);
      offset = Buffer.byteLength(complete, 'utf8');
      // a transcript whose last line has no newline is still complete
      if (lastBreak < 0) offset = stat.size;
    }

    const sessionId = (await readSessionId(path.dirname(file))) ?? '';
    if (!title) {
      // The title comes from the first user text in this transcript.
      title = await this.#extractTitle(file);
    }

    this.files.set(file, {
      path: file,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      offset,
      head,
      sessionId,
      title,
      calls,
      turns,
    });
  }

  /**
   * Read the first user text of a transcript for a session title.
   * Only the head of the file is inspected.
   * @param {string} file
   */
  async #extractTitle(file) {
    try {
      const head = await readRange(file, 0, 256 * 1024);
      const text = head.toString('utf8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        /** @type {any} */
        let record;
        try {
          record = JSON.parse(line);
        } catch {
          continue;
        }
        const message = record?.message;
        if (!message || message.role !== 'user') continue;
        const title = titleFromUserMessage(message);
        if (title) return title;
      }
    } catch {
      // no title available
    }
    return '';
  }

  /** Persist the cursor, throttled so an active session does not thrash disk. */
  async save(force = false) {
    if (!this.dirty) return;
    const now = Date.now();
    if (!force && now - this.lastSaveAt < SAVE_THROTTLE_MS) return;
    this.lastSaveAt = now;
    this.dirty = false;
    /** @type {any[]} */
    const files = [];
    for (const file of this.files.values()) {
      files.push({
        p: file.path,
        size: file.size,
        mtimeMs: file.mtimeMs,
        offset: file.offset,
        head: file.head,
        sessionId: file.sessionId,
        title: file.title,
        calls: file.calls.map((c) => [c.id, c.ts, c.model, c.turn, c.input, c.output, c.cacheRead, c.cacheWrite, c.total, c.cost, c.stop]),
        turns: [...file.turns.entries()].map(([k, v]) => [k, v.user, v.assistant, v.firstTs, v.lastTs, v.lastStop, v.lastStopTs]),
      });
    }
    const payload = JSON.stringify({ version: STATE_VERSION, root: this.root, savedAt: now, files });
    const temp = `${this.statePath}.tmp`;
    try {
      await fsp.mkdir(path.dirname(this.statePath), { recursive: true });
      await fsp.writeFile(temp, payload, 'utf8');
      await fsp.rename(temp, this.statePath);
    } catch (error) {
      this.lastError = 'state_write_failed';
      await fsp.rm(temp, { force: true }).catch(() => {});
    }
  }

  /**
   * Aggregate every call inside a window.
   *
   * The same message can appear in more than one transcript (a rebuilt session
   * copies its earlier messages), so calls are de-duplicated by message id.
   *
   * @param {number} startMs
   * @param {number} endMs
   */
  aggregate(startMs, endMs) {
    /** @type {Map<string, any>} */
    const byDay = new Map();
    /** @type {Map<string, any>} */
    const byModel = new Map();
    /** @type {Map<string, any>} */
    const bySession = new Map();
    /** @type {Map<string, any>} */
    const byTurn = new Map();
    const seenIds = new Set();
    const calls = [];
    let totalCalls = 0;
    let input = 0;
    let output = 0;
    let cacheRead = 0;
    let cacheWrite = 0;
    let total = 0;
    let cost = 0;

    const emptyBucket = () => ({
      calls: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
      cost: 0,
      firstTs: 0,
      lastTs: 0,
    });

    for (const file of this.files.values()) {
      const sessionId = file.sessionId || file.path;
      for (const call of file.calls) {
        if (call.ts < startMs || call.ts > endMs) continue;
        if (seenIds.has(call.id)) continue;
        seenIds.add(call.id);
        totalCalls += 1;
        input += call.input;
        output += call.output;
        cacheRead += call.cacheRead;
        cacheWrite += call.cacheWrite;
        total += call.total;
        cost += call.cost;
        calls.push(call);

        const day = dayKey(call.ts);
        let bucket = byDay.get(day);
        if (!bucket) {
          bucket = { ...emptyBucket(), models: new Map() };
          byDay.set(day, bucket);
        }
        addTo(bucket, call);
        bucket.models.set(call.model, (bucket.models.get(call.model) ?? 0) + call.total);

        let modelBucket = byModel.get(call.model);
        if (!modelBucket) {
          modelBucket = emptyBucket();
          byModel.set(call.model, modelBucket);
        }
        addTo(modelBucket, call);

        let sessionBucket = bySession.get(sessionId);
        if (!sessionBucket) {
          sessionBucket = { ...emptyBucket(), sessionId, title: file.title || '', turns: new Set(), models: new Map() };
          bySession.set(sessionId, sessionBucket);
        }
        addTo(sessionBucket, call);
        sessionBucket.models.set(call.model, (sessionBucket.models.get(call.model) ?? 0) + call.total);
        if (call.turn) sessionBucket.turns.add(call.turn);

        if (call.turn) {
          let turnBucket = byTurn.get(call.turn);
          if (!turnBucket) {
            const fact = file.turns.get(call.turn);
            turnBucket = {
              turnId: call.turn,
              sessionId,
              title: file.title || '',
              calls: 0,
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
              cost: 0,
              firstTs: call.ts,
              lastTs: call.ts,
              lastStop: fact?.lastStop ?? 0,
              lastStopTs: fact?.lastStopTs ?? 0,
              models: new Set(),
              userMessages: fact?.user ?? 0,
              assistantMessages: fact?.assistant ?? 0,
            };
            byTurn.set(call.turn, turnBucket);
          }
          addTo(turnBucket, call);
          turnBucket.models.add(call.model);
          if (call.ts < turnBucket.firstTs) turnBucket.firstTs = call.ts;
          if (call.ts > turnBucket.lastTs) turnBucket.lastTs = call.ts;
          if (call.ts >= turnBucket.lastStopTs) {
            turnBucket.lastStop = call.stop;
            turnBucket.lastStopTs = call.ts;
          }
          if (!turnBucket.title && file.title) turnBucket.title = file.title;
        }
      }
    }

    // Turns that have a user message but no assistant call yet are still
    // running; they are not part of `byTurn` because no call was counted.
    for (const file of this.files.values()) {
      for (const [turnId, fact] of file.turns) {
        if (byTurn.has(turnId)) continue;
        if (fact.user <= 0) continue;
        if (fact.lastTs < startMs || fact.firstTs > endMs) continue;
        byTurn.set(turnId, {
          turnId,
          sessionId: file.sessionId || file.path,
          title: file.title || '',
          calls: 0,
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
          cost: 0,
          firstTs: fact.firstTs,
          lastTs: fact.lastTs,
          lastStop: fact.lastStop,
          lastStopTs: fact.lastStopTs,
          models: new Set(),
          userMessages: fact.user,
          assistantMessages: fact.assistant,
        });
      }
    }

    return {
      calls,
      totals: { calls: totalCalls, input, output, cacheRead, cacheWrite, total, cost },
      byDay,
      byModel,
      bySession,
      byTurn,
    };
  }

  /** A short, non-identifying description of the scan, for the health view. */
  describe() {
    let calls = 0;
    let turns = 0;
    for (const file of this.files.values()) {
      calls += file.calls.length;
      turns += file.turns.size;
    }
    return {
      files: this.files.size,
      calls,
      turns,
      scannedAt: this.scannedAt,
      scanMs: this.scanMs,
    };
  }
}

/** @param {any} bucket @param {CallFact} call */
function addTo(bucket, call) {
  bucket.calls += 1;
  bucket.input += call.input;
  bucket.output += call.output;
  bucket.cacheRead += call.cacheRead;
  bucket.cacheWrite += call.cacheWrite;
  bucket.total += call.total;
  bucket.cost += call.cost;
  if (!bucket.firstTs || call.ts < bucket.firstTs) bucket.firstTs = call.ts;
  if (call.ts > bucket.lastTs) bucket.lastTs = call.ts;
}

/** Local-time day key. */
export function dayKey(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Human label for a stopReason code. */
export function stopName(code) {
  return STOP_NAMES[code] || '';
}
