// @ts-check

import { open, readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */
/** @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle */

const MAX_WALK_DEPTH = 4;
const MAX_SESSION_CANDIDATES = 400;
const MAX_SESSION_LIST = 30;
const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;
/**
 * Tools whose reply arrives through the tool rather than as a chat message. A turn that calls
 * one of these is followed, sometimes after a compaction sits in between, by a turn that has
 * no user message because the reader's answer never became one.
 */
const USER_INPUT_TOOLS = new Set(['ask_user', 'request_feature_enable']);
/**
 * Suffix the runtime appends to a turn id when it writes that turn's compaction checkpoint. The
 * checkpoint names the turn it interrupts, so stripping this is what puts the two back together.
 */
const COMPACTION_TURN_SUFFIX = ':compaction';
// Enough of a file to read its opening line. A generation marker lives on the first row, so
// deciding whether a snapshot belongs to the lineage never needs more than this.
const GENERATION_PROBE_BYTES = 64 * 1024;
/**
 * Bytes of `messages.jsonl` the session list reads to derive one label and one set of counters.
 *
 * Kept at the generation probe's budget on purpose: the generation marker lives on the first row,
 * so a list that needed more than that to find one would be a list wanting the whole session.
 *
 * The counters this buys are approximate by design (see countRolesInPrefix), so a narrower prefix
 * costs accuracy, not correctness — 256 KB was reading four times what the label needed, on every
 * cache miss.
 *
 * The last clause used to end "for counts nobody treats as exact", and that is what turned out
 * to be false: the page printed the message count in the session picker (`（3 分钟前 · 10 条）`), so it
 * was treated as exact. On a session whose active file is 1 MB, the first 64 KB held 10 messages
 * out of 23,642 — a number that was wrong by three orders of magnitude and carried no hint of it.
 * So the prefix stays bounded and the counters it buys are only REPORTED when the prefix was the
 * whole file; see {@link describeSession}. Counting exactly is not available: the list reads the
 * active file, and an exact count there would still miss the rest of the lineage.
 */
const LIST_PEEK_BYTES = 64 * 1024;
const MAX_FIELD_CHARS = 20000;
const MAX_SUMMARY_CHARS = 160;
const MAX_ARGUMENT_BYTES = 32000;
const MAX_LABEL_CHARS = 60;
const MAX_RAW_BYTES = 65536;
/**
 * How long the session list may keep its scan of the store before walking it again.
 *
 * This has to stay at or above the page's poll interval, and that relationship — not this
 * number — is the invariant tests/verify-list-cache.mjs holds. Below the interval the cache
 * cannot survive a single poll: every tick expires it, so the list re-walks the session tree
 * and reopens the runtime database on every tick. Measured on this machine, that was most of
 * the 16 GB this process read in 68 minutes, and the allocation behind it held the process at
 * a 1.2-2.5 GB high-water mark for as long as the page stayed open.
 */
const LIST_CACHE_TTL_MS = 3000;
const SESSION_CACHE_TTL_MS = 5000;
const SESSION_CACHE_ENTRIES = 80;
const TRAJECTORY_CACHE_ENTRIES = 4;
/**
 * Upper bound on the parsed generation rows kept resident, in bytes.
 *
 * The whole-session cache above stores serialized bodies; this one stores parsed object
 * graphs, which cost several times their source text. Measured on this machine: JSON.parse
 * retains 1.36x the text of the emitted payload, and that is a floor — the payload has
 * already had its message bodies stripped by splitRawRecords, so the rows graph is larger.
 * A 95 MB lineage lands somewhere in 130-290 MB.
 *
 * The trade is deliberate: it converts roughly 350 MB of allocation every 2.5 s into one
 * resident cost. Pinned by tests/verify-parsed-rows.mjs.
 */
const PARSED_ROWS_CACHE_BYTES = 256 * 1024 * 1024;
/**
 * Heap charged to one cache entry per source byte read. V8 cannot report an object graph's
 * size, so a byte budget needs a proxy.
 *
 * Measured on this machine's own lineage: 95.3 MB of messages.jsonl retained 116 MB of heap
 * after two forced collections, i.e. 1.22x the source. 2x leaves headroom over that while
 * still erring on the side of over-counting, because a proxy that under-counts would let the
 * cache grow past its own budget without noticing.
 *
 * It was 3x before, and that was wrong in the direction that matters: 95.3 MB x 3 charged
 * 286 MB against a 256 MB budget, so the LRU evicted entries it had room for in reality and
 * re-parsed them on the next poll. The budget is only as good as this number.
 */
const PARSED_ROWS_HEAP_PER_SOURCE_BYTE = 2;
const SESSION_STORE_TOKEN = '<session-store>';
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const ROLE_PATTERN = /"role"\s*:\s*"(user|assistant|toolResult|custom)"/g;
const TURN_PATTERN = /"turn_id"\s*:\s*"([^"]*)"/g;
const BLOCK_PATTERN = /"type"\s*:\s*"(toolCall|thinking|text)"/g;
const ABSOLUTE_STORE_PATTERN = /(?:[A-Za-z]:[\\/])?[^\s"'`<>|]{0,120}?[\\/]?\.minimax(?:[\\/][^\s"'`<>|]{0,160})?/g;

/**
 * Resolve the local session store. Never returns a location that is logged or returned to the browser.
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ root: string, sessionsRoot: string }}
 */
export function resolveSessionsRoot(env = process.env) {
  const candidates = [env.MMC_TRAJECTORY_ROOT, env.MAVIS_HOME];
  let home = '';
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      home = candidate.trim();
      break;
    }
  }
  if (!home) home = join(homedir(), '.minimax');
  return { root: home, sessionsRoot: join(home, 'v2', 'sessions') };
}

/**
 * Versioned `.history-mutation-*` copies also contain `messages.jsonl`; only real session folders count.
 * @param {string} name
 */
export function isSessionDirName(name) {
  return name.includes('-session_') && !name.startsWith('.');
}

/**
 * @param {unknown} raw
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 */
export function normalizeLimit(raw, fallback, min, max) {
  const parsed = Number.parseInt(typeof raw === 'string' ? raw : '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

/**
 * @param {string} value
 * @param {number} max
 */
export function singleLine(value, max) {
  const flattened = String(value ?? '').replace(/\s+/g, ' ').trim();
  return flattened.length > max ? flattened.slice(0, max) : flattened;
}

/**
 * @param {unknown} value
 * @param {number} max
 * @returns {{ text: string | null, truncated: boolean }}
 */
export function clipField(value, max) {
  if (typeof value !== 'string' || value === '') return { text: null, truncated: false };
  if (value.length <= max) return { text: value, truncated: false };
  return { text: value.slice(0, max), truncated: true };
}

/**
 * Replaces internal store locations so the browser never learns where sessions live.
 * @param {readonly string[]} secrets
 */
export function createRedactor(secrets) {
  const prefixes = [...new Set(secrets.filter((entry) => typeof entry === 'string' && entry.length > 0))]
    .sort((a, b) => b.length - a.length);
  if (prefixes.length === 0) return (value) => value;
  return (value) => {
    let out = String(value);
    for (const prefix of prefixes) out = out.split(prefix).join(SESSION_STORE_TOKEN);
    return out.includes('.minimax') ? out.replace(ABSOLUTE_STORE_PATTERN, SESSION_STORE_TOKEN) : out;
  };
}

/**
 * @param {string} text
 * @returns {{ rows: Array<Record<string, any>>, skipped: number }}
 */
export function parseMessagesJsonl(text) {
  /** @type {Array<Record<string, any>>} */
  const rows = [];
  let skipped = 0;
  let start = 0;
  while (start <= text.length) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    const line = text.slice(start, end);
    start = end + 1;
    if (line.trim() === '') {
      if (end >= text.length) break;
      continue;
    }
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object') rows.push(parsed);
      else skipped += 1;
    } catch {
      skipped += 1;
    }
    if (end >= text.length) break;
  }
  return { rows, skipped };
}

/**
 * Cheap single-pass counters used by the session list; values are approximate by design.
 * @param {string} text
 */
export function countRolesInPrefix(text) {
  const turnIds = new Set();
  const counts = { messages: 0, userMessages: 0, assistantMessages: 0, toolResults: 0, systemMessages: 0, toolCalls: 0, thinkingBlocks: 0, turns: 0 };
  for (const match of text.matchAll(/"message_id"\s*:/g)) counts.messages += 1;
  for (const match of text.matchAll(ROLE_PATTERN)) {
    if (match[1] === 'user') counts.userMessages += 1;
    else if (match[1] === 'assistant') counts.assistantMessages += 1;
    else if (match[1] === 'toolResult') counts.toolResults += 1;
    else counts.systemMessages += 1;
  }
  for (const match of text.matchAll(TURN_PATTERN)) turnIds.add(match[1]);
  for (const match of text.matchAll(BLOCK_PATTERN)) {
    if (match[1] === 'toolCall') counts.toolCalls += 1;
    else if (match[1] === 'thinking') counts.thinkingBlocks += 1;
  }
  counts.turns = turnIds.size;
  return counts;
}

/**
 * @param {string} dirName
 */
export function decodeSessionIdFromDirName(dirName) {
  const marker = '-session_';
  const index = dirName.indexOf(marker);
  if (index < 0) return null;
  const decoded = Buffer.from(dirName.slice(index + marker.length), 'base64url').toString('utf8');
  return /^[A-Za-z0-9_-]{4,128}$/.test(decoded) ? decoded : null;
}

/**
 * The active catalog length is the only trustworthy byte boundary while the file is being appended.
 * @param {unknown} catalog
 * @returns {number | null}
 */
export function activeCatalogBytes(catalog) {
  if (!catalog || typeof catalog !== 'object') return null;
  const artifacts = /** @type {{ artifacts?: unknown }} */ (catalog).artifacts;
  if (!Array.isArray(artifacts)) return null;
  let total = 0;
  let found = false;
  for (const entry of artifacts) {
    if (!entry || typeof entry !== 'object') continue;
    const artifact = /** @type {{ kind?: unknown, fileName?: unknown, byteLength?: unknown }} */ (entry);
    if (artifact.kind !== 'active' || artifact.fileName !== 'messages.jsonl') continue;
    const size = Number(artifact.byteLength);
    if (Number.isFinite(size) && size >= 0) {
      total = Math.max(total, Math.floor(size));
      found = true;
    }
  }
  return found ? total : null;
}

/**
 * Whether our own read cap, and nothing else, cut a file short.
 *
 * The catalog-recorded sizes are a snapshot, and the active `messages.jsonl` keeps being appended
 * to after the catalog was written — so "we read fewer bytes than the file now has" is not evidence
 * that the file is too large. Reporting it as truncation is how a merely-active session ended up
 * claiming the first 64 MB when it was nowhere near it.
 *
 * @param {number} size the file's size at read time
 * @param {number} limit the bytes we were willing to read
 * @returns {boolean}
 */
export function truncatedByCap(size, limit) {
  if (!Number.isFinite(size) || !Number.isFinite(limit)) return false;
  return size > limit;
}

/**
 * @param {string} filePath
 * @param {number} limit
 * @returns {Promise<{ text: string, size: number, read: number }>}
 */
export async function readHead(filePath, limit) {
  const handle = await open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const size = stat.size;
    const wanted = Math.max(0, Math.min(limit, size));
    const buffer = Buffer.allocUnsafe(wanted);
    let filled = 0;
    while (filled < wanted) {
      const { bytesRead } = await handle.read(buffer, filled, wanted - filled, filled);
      if (bytesRead <= 0) break;
      filled += bytesRead;
    }
    const view = buffer.subarray(0, filled);
    const lastNewline = view.lastIndexOf(0x0a);
    const usable = lastNewline === -1 ? filled : lastNewline;
    return { text: view.subarray(0, usable).toString('utf8'), size, read: filled };
  } finally {
    await handle.close();
  }
}

/**
 * @param {string} dir
 */
async function readJsonIfPresent(dir, name) {
  try {
    const raw = await readFile(join(dir, name), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * A basename we are willing to join onto a directory. The catalog is data on disk, and data
 * does not get to choose which file gets opened, so anything carrying a separator, a dot
 * segment or an unexpected extension is dropped rather than normalised.
 */
const SAFE_ARTIFACT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.jsonl$/;
const SAFE_REVISION = /^sha256:[0-9a-f]{64}$/;

/**
 * Which generation a row came from, carried on the row itself while a stitched lineage is
 * being built. A symbol keeps it off `JSON.stringify` and out of every raw payload.
 */
export const ROW_GENERATION = Symbol('rowGeneration');

/**
 * A finite, non-negative JSON number — or nothing.
 *
 * `Number()` is deliberately not used here: it turns `null` into 0 and `"7"` into 7, so a
 * malformed catalog would come back as a confident-looking zero-byte generation rather than
 * as a dropped entry.
 * @param {unknown} value
 */
function nonNegativeInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Every context generation the runtime has recorded for a session.
 *
 * A compaction does not trim history in place: the runtime rotates the previous
 * `messages.jsonl` into `snapshots/<name>.jsonl` and starts a fresh active file, so after a
 * compaction the active file holds only what came *after* the checkpoint. `artifacts[]` is
 * the only place the earlier generations are still listed, so without this a compacted
 * session silently reads as if all of its earlier messages never existed.
 *
 * @param {unknown} catalog
 * @returns {Array<{ generation: number, kind: string, fileName: string, byteLength: number | null, messageCount: number | null, revision: string | null, active: boolean }>}
 */
export function parseCatalogGenerations(catalog) {
  if (!catalog || typeof catalog !== 'object') return [];
  const artifacts = /** @type {{ artifacts?: unknown }} */ (catalog).artifacts;
  if (!Array.isArray(artifacts)) return [];
  /** @type {Map<number, { generation: number, kind: string, fileName: string, byteLength: number | null, messageCount: number | null, revision: string | null, active: boolean }>} */
  const byGeneration = new Map();
  for (const entry of artifacts) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const artifact = /** @type {Record<string, unknown>} */ (entry);
    const generation = nonNegativeInteger(artifact.generation);
    if (generation === null) continue;
    const fileName = typeof artifact.fileName === 'string' ? artifact.fileName : '';
    if (!SAFE_ARTIFACT_NAME.test(fileName) || fileName.includes('..')) continue;
    const kind = typeof artifact.kind === 'string' && artifact.kind.trim() ? artifact.kind.trim() : 'snapshot';
    const revision = typeof artifact.revision === 'string' && SAFE_REVISION.test(artifact.revision) ? artifact.revision : null;
    // First entry wins: a duplicated generation is a malformed catalog, and picking the
    // first one keeps the answer stable instead of depending on array order luck.
    if (byGeneration.has(generation)) continue;
    byGeneration.set(generation, {
      generation,
      kind,
      fileName,
      byteLength: nonNegativeInteger(artifact.byteLength),
      messageCount: nonNegativeInteger(artifact.messageCount),
      revision,
      active: kind === 'active',
    });
  }
  return [...byGeneration.values()].sort((a, b) => a.generation - b.generation);
}

/**
 * @param {unknown} catalog
 * @param {Array<{ generation: number, kind: string, fileName: string, byteLength: number | null, messageCount: number | null, revision: string | null, active: boolean }>} generations
 * @returns {number | null}
 */
export function activeCatalogGeneration(catalog, generations) {
  const declared = catalog && typeof catalog === 'object'
    ? nonNegativeInteger(/** @type {{ activeGeneration?: unknown }} */ (catalog).activeGeneration)
    : null;
  if (declared !== null && generations.some((entry) => entry.generation === declared)) return declared;
  const actives = generations.filter((entry) => entry.active);
  if (actives.length > 0) return actives[actives.length - 1].generation;
  return generations.length > 0 ? generations[generations.length - 1].generation : null;
}

/**
 * Resolves a catalog artifact to a readable file inside the session directory.
 *
 * Two independent checks stand between the catalog and `open()`: the name must match the
 * safe-basename pattern, and the resolved path must still sit under the session directory.
 * Either one alone would be enough to catch a hand-edited catalog; both are cheap, and this
 * is the only place in the app that opens a file named by something other than the app.
 *
 * @param {string} dir
 * @param {{ generation: number, kind: string, fileName: string, byteLength: number | null, messageCount: number | null, revision: string | null, active: boolean }} artifact
 * @returns {string | null}
 */
export function resolveArtifactPath(dir, artifact) {
  if (!artifact || typeof artifact.fileName !== 'string') return null;
  if (!SAFE_ARTIFACT_NAME.test(artifact.fileName) || artifact.fileName.includes('..')) return null;
  const root = resolve(dir);
  const candidate = resolve(root, artifact.active ? artifact.fileName : join('snapshots', artifact.fileName));
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;
  return candidate;
}

/**
 * The generation marker a file opens with.
 *
 * A rotation is only believable because the file that opens it says so: the first row of
 * every generation after the first is a `compactionSummary` carrying `history_artifact`,
 * and that object names the generation it opened and the exact revision it replaced. The
 * runtime reads the same marker to walk its lineage, and so does this app — a filename or
 * a catalog entry is a claim, this is the receipt.
 *
 * @param {string} headText
 * @returns {{ generation: number, parentGeneration: number | null, parentCompactionId: string | null, parentRevision: string | null } | null}
 */
export function readGenerationMarker(headText) {
  const firstLine = headText.split('\n', 1)[0];
  if (!firstLine) return null;
  /** @type {any} */
  let row;
  try {
    row = JSON.parse(firstLine);
  } catch {
    return null;
  }
  if (!row || typeof row !== 'object') return null;
  const message = row.message;
  if (!message || typeof message !== 'object' || message.role !== 'compactionSummary') return null;
  const artifact = row.history_artifact;
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) return null;
  const generation = nonNegativeInteger(artifact.generation);
  if (generation === null || generation === 0) return null;
  const parent = artifact.parentSnapshot && typeof artifact.parentSnapshot === 'object' && !Array.isArray(artifact.parentSnapshot)
    ? /** @type {Record<string, any>} */ (artifact.parentSnapshot)
    : null;
  return {
    generation,
    parentGeneration: parent ? nonNegativeInteger(parent.generation) : null,
    parentCompactionId: parent && typeof parent.compactionId === 'string' ? parent.compactionId : null,
    parentRevision: parent && typeof parent.revision === 'string' && SAFE_REVISION.test(parent.revision)
      ? parent.revision
      : null,
  };
}

/**
 * Walks a session's generation chain the way the runtime does: start at the active file,
 * take the generation it declares, then step back one generation at a time through the
 * parent each file names.
 *
 * The catalog is used only to find candidate files. Every candidate still has to open and
 * declare the generation it was reached for, so a catalog that lists a file belonging to a
 * different lineage cannot smuggle it in, and a file whose parent generation is not exactly
 * one lower ends the chain instead of being stitched on. Snapshots never reached are orphans
 * — a fork leaves them behind — and are reported rather than shown.
 *
 * @param {{ generations: Array<{ generation: number, kind: string, fileName: string, byteLength: number | null, messageCount: number | null, revision: string | null, active: boolean }> }} catalog
 * @param {(generation: number | null) => Promise<{ fileName: string, marker: { generation: number, parentGeneration: number | null } | null } | null>} probe `null` asks for the active file
 */
export async function walkLineage(catalog, probe) {
  const byGeneration = new Map();
  for (const entry of catalog.generations) {
    if (!entry.active && !byGeneration.has(entry.generation)) byGeneration.set(entry.generation, entry);
  }

  const activeProbe = await probe(null);
  if (activeProbe === null) return { chain: [], orphans: [] };

  const activeGeneration = activeProbe.marker ? activeProbe.marker.generation : 0;
  const chain = [{ generation: activeGeneration, fileName: activeProbe.fileName }];
  const reached = new Set([activeGeneration]);

  let expect = activeGeneration;
  while (expect > 0) {
    const want = expect - 1;
    if (!byGeneration.has(want)) break;
    const parent = await probe(want);
    if (parent === null) break;
    const declared = parent.marker ? parent.marker.generation : 0;
    if (declared !== want) break;
    if (parent.marker && parent.marker.parentGeneration !== null && parent.marker.parentGeneration !== want - 1) break;
    if (reached.has(declared)) break;
    reached.add(declared);
    chain.unshift({ generation: declared, fileName: parent.fileName });
    expect = want;
  }

  const orphans = catalog.generations
    .filter((entry) => !entry.active && !reached.has(entry.generation))
    .map((entry) => ({ generation: entry.generation, fileName: entry.fileName }));
  return { chain, orphans };
}

/**
 * @param {string} dir
 */
export async function readSessionIdentity(dir) {
  const manifest = await readJsonIfPresent(dir, 'manifest.json');
  const catalog = await readJsonIfPresent(dir, 'history-catalog.json');
  const manifestId = manifest && typeof manifest.sessionId === 'string' ? manifest.sessionId.trim() : '';
  const id = manifestId || decodeSessionIdFromDirName(basename(dir)) || basename(dir);
  const createdAtMs = manifest && Number.isFinite(Number(manifest.createdAtMs)) ? Number(manifest.createdAtMs) : null;
  const generations = parseCatalogGenerations(catalog);
  return {
    id,
    createdAtMs,
    catalogBytes: activeCatalogBytes(catalog),
    generations,
    activeGeneration: activeCatalogGeneration(catalog, generations),
  };
}

/**
 * Depth-capped walk that only descends into dated folders and never into a session folder twice.
 * @param {string} sessionsRoot
 */
export async function collectSessionEntries(sessionsRoot) {
  /** @type {Array<{ dir: string, sizeBytes: number, lastActiveAt: number }>} */
  const entries = [];
  /** @param {string} dir @param {number} depth */
  const walk = async (dir, depth) => {
    if (depth > MAX_WALK_DEPTH || entries.length >= MAX_SESSION_CANDIDATES) return;
    let names;
    try {
      names = await readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (entries.length >= MAX_SESSION_CANDIDATES) return;
      const child = join(dir, name);
      if (isSessionDirName(name)) {
        try {
          const fileStat = await stat(join(child, 'messages.jsonl'));
          entries.push({ dir: child, sizeBytes: fileStat.size, lastActiveAt: Math.floor(fileStat.mtimeMs) });
        } catch {
          // A session folder without a readable messages file is simply not a candidate.
        }
        continue;
      }
      if (name.startsWith('.')) continue;
      await walk(child, depth + 1);
    }
  };
  await walk(sessionsRoot, 0);
  entries.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  return entries.slice(0, MAX_SESSION_LIST);
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function finiteOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * The runtime database is the only place on this machine that knows which conversation is
 * live. It is optional: a missing file, a missing `node:sqlite`, or any query failure must
 * degrade to the filesystem heuristic rather than break the board.
 * @param {string} home
 */
async function openRuntimeStateDb(home) {
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const dbPath = join(home, 'v2', 'sqlite', 'runtime-state.sqlite');
    if (!existsSync(dbPath)) return null;
    return new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return null;
  }
}

/** @param {unknown} value */
function toNumber(value) {
  if (typeof value === 'bigint') return Number(value);
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Resolve the conversation the user is actually in.
 *
 * The Host never tells the page which session opened it, so we ask the runtime database
 * instead. Ranking, strongest signal first:
 *   1. holds a live turn lease      — an agent turn is running right now
 *   2. status = 'started'           — open and not finished
 *   3. most recently updated        — the fallback for a long-idle conversation
 *
 * Only real user conversations qualify. `session_kind = 'conversation'` with a NULL
 * `purpose` excludes cron runs (`purpose = 'cron:...'`) and background worker/explore
 * tasks (`purpose = 'local-background-task:bg_...'`), which are exactly the sessions that
 * would otherwise win on file mtime while the user is looking at a different one.
 *
 * @param {string} home
 * @returns {Promise<{ sessionId: string, title: string | null, relativeDir: string | null, status: string | null, leased: boolean } | null>}
 */
export async function resolveCurrentConversation(home) {
  const db = await openRuntimeStateDb(home);
  if (!db) return null;
  const now = Date.now();
  const QUALIFY = "s.session_kind = 'conversation' and s.purpose is null and ifnull(s.archived, 0) = 0";
  try {
    const row = db.prepare(`
      select s.session_id as session_id, s.title as title, s.status as status,
             s.history_relative_dir as history_relative_dir,
             case when exists (
               select 1 from local_runtime_session_locks l
               where l.session_id = s.session_id and l.expires_at_ms > ?
             ) then 1 else 0 end as leased
      from local_runtime_sessions s
      where ${QUALIFY}
      order by leased desc,
               case when s.status = 'started' then 0 else 1 end asc,
               s.updated_at_ms desc
      limit 1
    `).get(now);
    if (!row || typeof row.session_id !== 'string') return null;

    // More than one conversation holding a live lease means we genuinely cannot tell which
    // one this page belongs to. Report it instead of silently picking by a stale timestamp.
    const leasedRows = db.prepare(`
      select s.session_id as session_id, s.title as title
      from local_runtime_sessions s
      where ${QUALIFY}
        and exists (select 1 from local_runtime_session_locks l
                    where l.session_id = s.session_id and l.expires_at_ms > ?)
      order by s.updated_at_ms desc
      limit 5
    `).all(now);
    const candidates = leasedRows
      .filter((entry) => entry && typeof entry.session_id === 'string')
      .map((entry) => ({
        sessionId: entry.session_id,
        title: typeof entry.title === 'string' && entry.title.trim() ? entry.title.trim() : null,
      }));

    return {
      sessionId: row.session_id,
      title: typeof row.title === 'string' && row.title.trim() ? row.title.trim() : null,
      relativeDir: typeof row.history_relative_dir === 'string' && row.history_relative_dir.trim()
        ? row.history_relative_dir.trim()
        : null,
      status: typeof row.status === 'string' ? row.status : null,
      leased: toNumber(row.leased) === 1,
      ambiguous: candidates.length > 1,
      candidates,
    };
  } catch {
    return null;
  } finally {
    // Every call opened its own handle and none of them closed it. Polling every 2.5s meant
    // 20–30 live handles waiting on the GC, and dispose() left them open too.
    closeQuietly(db);
  }
}

/**
 * Titles for the session picker. Missing database simply means the caller keeps its
 * filesystem-derived label.
 * @param {string} home
 * @param {readonly string[]} sessionIds
 * @returns {Promise<Map<string, { title: string | null, kind: string | null }>>}
 */
export async function readSessionTitles(home, sessionIds) {
  const result = new Map();
  const db = await openRuntimeStateDb(home);
  if (!db) return result;
  try {
    if (sessionIds.length === 0) return result;
    const stmt = db.prepare('select session_id, title, session_kind from local_runtime_sessions where session_id = ?');
    for (const id of sessionIds) {
      const row = stmt.get(id);
      if (!row) continue;
      result.set(id, {
        title: typeof row.title === 'string' && row.title.trim() ? row.title.trim() : null,
        kind: typeof row.session_kind === 'string' ? row.session_kind : null,
      });
    }
  } catch {
    // A title is a nicety; never let it fail the list.
  } finally {
    closeQuietly(db);
  }
  return result;
}

/**
 * Closing a read-only handle cannot fail in a way the caller can act on — the work it was
 * opened for is already done or already abandoned. Swallowing keeps every call site from
 * having to wrap its own error handling around cleanup.
 * @param {{ close?: () => void } | null} db
 */
function closeQuietly(db) {
  if (!db || typeof db.close !== 'function') return;
  try {
    db.close();
  } catch {
    // Nothing to do: the handle is being released either way.
  }
}

function emptyTokens() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
}

/**
 * @param {unknown} usage
 * @returns {{ input: number, output: number, cacheRead: number, cacheWrite: number, totalTokens: number | null } | null}
 */
export function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  const source = /** @type {Record<string, unknown>} */ (usage);
  const input = finiteOrNull(source.input);
  if (input === null && finiteOrNull(source.output) === null) return null;
  return {
    input: input ?? 0,
    output: finiteOrNull(source.output) ?? 0,
    cacheRead: finiteOrNull(source.cacheRead) ?? 0,
    cacheWrite: finiteOrNull(source.cacheWrite) ?? 0,
    totalTokens: finiteOrNull(source.totalTokens),
  };
}

/**
 * @param {unknown} block
 * @returns {string | null}
 */
function blockText(block) {
  if (!block || typeof block !== 'object') return typeof block === 'string' ? block : null;
  const source = /** @type {Record<string, unknown>} */ (block);
  if (typeof source.text === 'string') return source.text;
  return null;
}

/**
 * @param {unknown} content
 * @returns {string | null}
 */
export function contentToPlainText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const parts = [];
  for (const block of content) {
    const text = blockText(block);
    if (text !== null) parts.push(text);
  }
  return parts.length > 0 ? parts.join('\n') : null;
}

/**
 * Host-injected blocks are recorded with role "user" but are not user prompts.
 * They must not be shown as if the user typed them.
 */
const INJECTED_PREFIX = /^\s*(?:<(?:system-reminder|async-audit|background-task-finished|media-output-reminder|mcode-tools-master-reminder|task-completion-reminder|environment_details)\b|\[runaway guard\])/;

/**
 * `canonicalTextRange` marks where the real prompt starts inside a message whose
 * content is prefixed by injected blocks. Checked before the injection test because
 * a real prompt is itself prefixed by `<system-reminder>`.
 * @param {Record<string, any>} message
 * @returns {{ start: number, end: number } | null}
 */
export function canonicalPromptRange(message) {
  const range = message.canonicalTextRange;
  if (!range || typeof range !== 'object' || Array.isArray(range)) return null;
  const start = Number(/** @type {any} */ (range).startOffset);
  if (!Number.isFinite(start) || start < 0) return null;
  const rawEnd = Number(/** @type {any} */ (range).endOffset);
  const end = Number.isFinite(rawEnd) && rawEnd > start ? rawEnd : null;
  return { start, end: end ?? start };
}

/**
 * Splits a "user" row into the injected prefix and the real prompt.
 * @param {Record<string, any>} message
 * @param {string | null} plain
 * @returns {{ prompt: string | null, injected: string | null }}
 */
export function splitUserMessage(message, plain) {
  if (plain === null || plain.trim() === '') return { prompt: null, injected: null };
  const range = canonicalPromptRange(message);
  if (range) {
    const prompt = plain.slice(range.start, range.end).trim();
    const injected = plain.slice(0, range.start).trim();
    if (prompt) return { prompt, injected: injected || null };
    if (injected) return { prompt: null, injected };
  }
  if (INJECTED_PREFIX.test(plain)) return { prompt: null, injected: plain };
  return { prompt: plain.trim(), injected: null };
}

/**
 * @param {unknown} args
 */
function compactValue(value, max) {
  if (value === null) return 'null';
  if (typeof value === 'string') return singleLine(value, max);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${
    value.slice(0, 3).map((entry) => compactValue(entry, 24)).join(', ')
  }${value.length > 3 ? ', …' : ''}]`;
  if (typeof value === 'object') return '{…}';
  return 'null';
}

/**
 * @param {string} name
 * @param {unknown} args
 */
export function toolCallSummary(name, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return `${name}{}`;
  const entries = Object.entries(/** @type {Record<string, unknown>} */ (args)).slice(0, 4);
  if (entries.length === 0) return `${name}{}`;
  const rendered = entries.map(([key, value]) => `${key}="${compactValue(value, 48)}"`);
  return `${name}{${rendered.join(', ')}}`;
}

/**
 * Moves the raw-message locator off every record into an index-keyed map.
 *
 * Two things used to happen here and only one of them was load-bearing.
 *
 * The message itself was carried on every row and taken off again by this function. That is
 * what kept the bulk response small, and it stays true. What did not survive scrutiny is how
 * the size was decided: buildRawPayload() had to JSON.stringify the message to measure it, so
 * every rebuild serialized about 100 MB of message bodies to compare them against a 64 KB cap
 * and then threw the string away — for a body the page reads for one record at a time, if at
 * all. Pinned by tests/verify-raw-lazy.mjs.
 *
 * What the row carries now is the position of the message it came from. One row can produce
 * several records (an assistant message yields its thinking, its text and each tool call),
 * and they all answer with the same message, so the locator is per row, not per segment.
 *
 * Records are carried per turn, not as one flat list, so this walks the turns.
 *
 * @param {Array<Record<string, any>>} turns
 * @returns {Map<number, number>}
 */
export function splitRawRecords(turns) {
  /** @type {Map<number, number>} */
  const raws = new Map();
  if (!Array.isArray(turns)) return raws;
  for (const turn of turns) {
    if (!turn || typeof turn !== 'object' || !Array.isArray(turn.records)) continue;
    for (const record of turn.records) {
      if (!record || typeof record !== 'object' || !('rawRow' in record)) continue;
      const index = Number(record.index);
      // Not Number(record.rawRow): Number(null) is 0, so a record whose locator is absent
      // would resolve to the first row and answer with the wrong message.
      const rowIndex = record.rawRow;
      if (Number.isInteger(index) && index > 0 && typeof rowIndex === 'number' && Number.isInteger(rowIndex) && rowIndex >= 0) {
        raws.set(index, rowIndex);
      }
      delete record.rawRow;
    }
  }
  return raws;
}

/**
 * A record the runtime keeps for itself: written to the session, never shown, never sent.
 *
 * Mirrors the runtime's own `isHostOnlyMessage()` — a `custom`-role record whose
 * `hostMetadata.providerVisibility` is `'omit'`. That predicate is what
 * `projectAgentMessagesForModel()` filters on before the outbound request is built, so it is
 * the field to read: matching a list of `customType` strings instead would go stale the first
 * time the runtime adds another host-only record type.
 *
 * @param {unknown} message
 * @returns {boolean}
 */
export function isHostOnlyMessage(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
  const record = /** @type {Record<string, any>} */ (message);
  if (record.role !== 'custom') return false;
  const metadata = record.hostMetadata;
  return !!metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    && metadata.providerVisibility === 'omit';
}
/**
 * Builds the frozen `/api/trajectory` payload from already-parsed rows.
 * @param {{ session: { id: string, createdAtMs?: number | null }, rows: Array<Record<string, any>>, sizeBytes?: number, truncated?: boolean, redact?: (value: string) => string, generations?: Array<Record<string, any>>, generation?: number | null, orphans?: Array<{ generation: number, fileName: string }> }} input
 */
export function buildTrajectoryPayload(input) {
  const { session, rows, sizeBytes = 0, truncated = false } = input;
  const redact = input.redact ?? ((value) => value);
  /** @type {Array<Record<string, any>>} */
  const records = [];
  /** @type {Array<Record<string, any>>} */
  const turns = [];
  const turnById = new Map();
  const toolCallsById = new Map();
  const stats = {
    messages: rows.length,
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    toolResults: 0,
    thinkingBlocks: 0,
    injectedBlocks: 0,
    compactions: 0,
    turns: 0,
    turnsWithPrompt: 0,
    continuationTurns: 0,
    qaTurns: 0,
    openTurns: 0,
    steers: 0,
    compactionTurns: 0,
    turnsWithoutPrompt: 0,
    errors: 0,
    tokens: emptyTokens(),
    durationMs: null,
  };

  let startedAt = null;
  let lastTimestamp = null;
  let label = null;
  let textTruncatedAny = false;

  /** @param {string | null} turnId */
  const ensureTurn = (turnId) => {
    const key = turnId ?? '';
    let turn = turnById.get(key);
    if (!turn) {
      turn = {
        id: turnId,
        index: turns.length + 1,
        startedAt: null,
        endedAt: null,
        durationMs: null,
        toolCalls: 0,
        errors: 0,
        tokens: emptyTokens(),
        records: [],
      };
      turnById.set(key, turn);
      turns.push(turn);
    }
    return turn;
  };

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const message = row && typeof row.message === 'object' && row.message !== null ? row.message : {};
    const source = /** @type {Record<string, any>} */ (message);
    const role = typeof source.role === 'string' ? source.role : 'unknown';
    const timestamp = finiteOrNull(source.timestamp);
    const turnId = typeof row.turn_id === 'string' ? row.turn_id : null;
    // A compactionSummary is written under "<turnId>:compaction" — the id of the turn it
    // interrupted, plus a suffix — while every row after it carries the bare id. Keying on the
    // whole string therefore opened a turn for the checkpoint alone, and because a turn joins the
    // list the moment it is first seen, that turn was emitted after the entire turn it belongs to:
    // the checkpoint rendered past records that came later, and the numbering ran backwards
    // (#1037 then #970). Keying the checkpoint on the bare id puts it back where it happened —
    // inside the turn it interrupted, which is also the only place a context checkpoint is.
    const turnKey = role === 'compactionSummary'
      && turnId !== null
      && turnId.length > COMPACTION_TURN_SUFFIX.length
      && turnId.endsWith(COMPACTION_TURN_SUFFIX)
      ? turnId.slice(0, -COMPACTION_TURN_SUFFIX.length)
      : turnId;
    const turn = ensureTurn(turnKey);
    if (timestamp !== null) {
      if (startedAt === null || timestamp < startedAt) startedAt = timestamp;
      if (lastTimestamp === null || timestamp > lastTimestamp) lastTimestamp = timestamp;
      if (turn.startedAt === null || timestamp < turn.startedAt) turn.startedAt = timestamp;
      if (turn.endedAt === null || timestamp > turn.endedAt) turn.endedAt = timestamp;
    }

    const usage = normalizeUsage(source.usage);
    if (usage) {
      stats.tokens.input += usage.input;
      stats.tokens.output += usage.output;
      stats.tokens.cacheRead += usage.cacheRead;
      stats.tokens.cacheWrite += usage.cacheWrite;
      if (usage.totalTokens !== null) stats.tokens.totalTokens += usage.totalTokens;
      turn.tokens.input += usage.input;
      turn.tokens.output += usage.output;
      turn.tokens.cacheRead += usage.cacheRead;
      turn.tokens.cacheWrite += usage.cacheWrite;
      if (usage.totalTokens !== null) turn.tokens.totalTokens += usage.totalTokens;
    }
    if (source.isError === true) {
      stats.errors += 1;
      turn.errors += 1;
    }

    const messageId = typeof row.message_id === 'string' ? row.message_id : null;
    const base = {
      id: messageId,
      // The turn this record belongs to, which for a checkpoint is the turn it interrupted — not
      // the suffixed id the file wrote. A record whose `turnId` names no turn is a contradiction
      // the page cannot resolve.
      turnId: turnKey,
      role,
      // Stamped when a lineage is stitched, so the page can group or filter by generation
      // without having to re-derive it from timestamps.
      generation: nonNegativeInteger(/** @type {any} */ (row)[ROW_GENERATION]),
      timestamp,
      // One model call = one responseId, and every row split out of that message repeats it,
      // so the page can draw which rows arrived together. Tool results are not model
      // responses and carry none.
      responseId: typeof source.responseId === 'string' ? source.responseId : null,
      relativeMs: null,
      durationMs: null,
      toolName: null,
      toolCallId: null,
      tokens: null,
      model: typeof source.model === 'string' ? source.model : null,
      provider: typeof source.provider === 'string' ? source.provider : null,
      api: typeof source.api === 'string' ? source.api : null,
      stopReason: typeof source.stopReason === 'string' ? source.stopReason : null,
      isError: source.isError === true ? true : source.isError === false ? false : null,
      // Whether the runtime keeps this record for itself. Carried as one boolean so the page
      // can select on it (the 异常 axis has a rule for it) without the page having to know the
      // runtime's customType names, and without the record leaving the payload — dropping these
      // rows would renumber every record after them, because `index` counts emitted rows.
      internalOnly: isHostOnlyMessage(source),
      // Where the untouched message lives, not the message itself. /raw follows this back
      // when a reader actually opens the record; nothing else reads it.
      rawRow: rowIndex,
      textTruncated: false,
    };

    /** @param {Partial<Record<string, any>> & { kind: string, title: string, summary: string }} patch */
    const push = (patch) => {
      const record = {
        ...base,
        index: records.length + 1,
        relativeMs: timestamp === null || startedAt === null ? null : timestamp - startedAt,
        text: null,
        thinking: null,
        arguments: null,
        result: null,
        error: null,
        tokensBefore: null,
        producedBy: null,
        parentGeneration: null,
        parentCompactionId: null,
        parentRevision: null,
        ...patch,
      };
      if (record.textTruncated) textTruncatedAny = true;
      records.push(record);
      turn.records.push(record);
      return record;
    };

    const content = source.content;
    const blocks = Array.isArray(content) ? content : null;

    if (role === 'assistant') {
      stats.assistantMessages += 1;
      const texts = [];
      const thinkingParts = [];
      const callParts = [];
      if (blocks) {
        for (const block of blocks) {
          if (!block || typeof block !== 'object') continue;
          const item = /** @type {Record<string, any>} */ (block);
          if (item.type === 'text' && typeof item.text === 'string') texts.push(item.text);
          else if (item.type === 'thinking' && typeof item.thinking === 'string') thinkingParts.push(item.thinking);
          else if (item.type === 'toolCall') callParts.push(item);
        }
      } else if (typeof content === 'string') texts.push(content);
      else if (typeof source.text === 'string') texts.push(source.text);

      const textSource = texts.length > 0 ? texts.join('\n') : null;
      const textField = clipField(textSource === null ? null : redact(textSource), MAX_FIELD_CHARS);
      const thinkingField = clipField(thinkingParts.length > 0 ? redact(thinkingParts.join('\n')) : null, MAX_FIELD_CHARS);

      let usageAttached = false;
      const carrierUsage = () => {
        if (usageAttached) return null;
        usageAttached = true;
        return usage;
      };

      // The ledger imposes one explicit order on an assistant message: the reasoning, then
      // the answer, then the actions it asked for. The session writer emits them in this order
      // today, but the page must not depend on that — an ordering this UI presents is an
      // invariant we own, so state it outright rather than inferring it from array position.
      /** @type {Array<'text' | 'thinking' | 'toolCall'>} */
      const segmentOrder = [];
      const present = (kind) => (
        kind === 'text' ? textField.text !== null
          : kind === 'thinking' ? thinkingField.text !== null
            : callParts.length > 0
      );
      for (const kind of /** @type {const} */ (['thinking', 'text', 'toolCall'])) {
        if (present(kind)) segmentOrder.push(kind);
      }

      // Token usage belongs to the assistant message, and must follow the answer it was
      // measured for — not the reasoning block that now precedes it. A message with no text
      // keeps the usage on its first record, which is the rule that applied before.
      const usageOwner = textField.text !== null ? 'text' : (segmentOrder[0] ?? null);

      for (const kind of segmentOrder) {
        if (kind === 'text') {
          if (textField.text === null) continue;
          push({
            // The model says why it stopped, and that sentence is the whole test. `stop`
            // means it finished, so this text is the answer the turn delivers. `toolUse`
            // means it is about to call a tool, so this text is the commentary it wrote on
            // the way there. A third value, `aborted`, marks a turn cut off part-way; its
            // text never became an answer, so it stays with the commentary rather than
            // being passed off as one. Filing all of them under one label buried the
            // answers under several times their own volume.
            kind: source.stopReason === 'stop' ? 'reply' : 'narration',
            title: 'assistant',
            summary: singleLine(textField.text, MAX_SUMMARY_CHARS),
            text: textField.text,
            textTruncated: textField.truncated,
            tokens: kind === usageOwner ? carrierUsage() : undefined,
          });
          continue;
        }
        if (kind === 'thinking') {
          if (thinkingField.text === null) continue;
          stats.thinkingBlocks += 1;
          push({
            kind: 'thinking',
            title: 'thinking',
            summary: singleLine(thinkingField.text, MAX_SUMMARY_CHARS),
            thinking: thinkingField.text,
            textTruncated: thinkingField.truncated,
            tokens: kind === usageOwner ? carrierUsage() : undefined,
          });
          continue;
        }
        for (const call of callParts) {
          stats.toolCalls += 1;
          turn.toolCalls += 1;
          const name = typeof call.name === 'string' ? call.name : 'unknown';
          const toolCallId = typeof call.id === 'string' ? call.id : null;
          const prepared = prepareArguments(call.arguments, redact);
          const record = push({
            kind: 'toolCall',
            title: name,
            summary: toolCallSummary(name, prepared.summaryArgs),
            toolName: name,
            toolCallId,
            arguments: prepared.value,
            argumentsOmitted: prepared.omitted,
            tokens: kind === usageOwner ? carrierUsage() : undefined,
          });
          if (toolCallId) toolCallsById.set(toolCallId, { record, toolCallId });
        }
      }
      // The test is this message's own segments, not the turn's record count. `turn.records`
      // already holds everything earlier in the turn, so an assistant message carrying only
      // `content: []` — a stopReason 'error', or a turn cut off before it said anything — added
      // no row once any earlier message had produced one, while its usage still landed on the
      // turn's Token total. The page then showed a number it could not attribute to any line.
      if (segmentOrder.length === 0) {
        push({ kind: source.stopReason === 'stop' ? 'reply' : 'narration', title: 'assistant', summary: '', text: null, tokens: carrierUsage() });
      }
      continue;
    }

    if (role === 'toolResult') {
      stats.toolResults += 1;
      const resultField = clipField(contentToPlainText(content) === null ? null : redact(String(contentToPlainText(content))), MAX_FIELD_CHARS);
      const toolCallId = typeof source.toolCallId === 'string' ? source.toolCallId : null;
      const toolName = typeof source.toolName === 'string' ? source.toolName : null;
      const record = push({
        kind: 'toolResult',
        title: toolName ?? 'toolResult',
        summary: singleLine(resultField.text ?? '', MAX_SUMMARY_CHARS),
        result: resultField.text,
        textTruncated: resultField.truncated,
        toolName,
        toolCallId,
        error: source.isError === true && resultField.text ? resultField.text : null,
      });
      const pending = toolCallId ? toolCallsById.get(toolCallId) : null;
      if (pending && !pending.result) pending.result = record;
      continue;
    }

    if (role === 'user') {
      const plain = contentToPlainText(content) ?? (typeof source.text === 'string' ? source.text : null);
      const split = splitUserMessage(source, plain);

      if (split.injected !== null) {
        stats.injectedBlocks += 1;
        const injectedField = clipField(redact(split.injected), MAX_FIELD_CHARS);
        push({
          kind: 'system',
          title: 'injected',
          summary: singleLine(injectedField.text ?? '', MAX_SUMMARY_CHARS),
          text: injectedField.text,
          textTruncated: injectedField.truncated,
        });
      }

      if (split.prompt !== null) {
        // The first prompt of a turn is what opened it. Anything later arrived while the
        // turn was still running — a steer, redirecting work already under way.
        //
        // Nothing in the session file marks this. Compared field by field, a steer is
        // byte-identical to a typed prompt in role, stopReason, api, model, provider, tokens,
        // producedBy, turnId and everything else; only id, timestamp and index differ. The
        // signal available is position: measured across every turn that has one, its prompt
        // sits at record 1 or 2 and never further in, so a user record past that point can
        // only have been written mid-turn. That is an inference from ordering, not a fact
        // the file asserts, and it is recorded as `steered` so the detail panel can say so.
        const steered = turn.records.some((r) => r.kind === 'user');
        if (steered) stats.steers += 1; else stats.userMessages += 1;
        if (label === null) label = singleLine(redact(split.prompt), MAX_LABEL_CHARS);
        const promptField = clipField(redact(split.prompt), MAX_FIELD_CHARS);
        push({
          kind: steered ? 'steer' : 'user',
          title: 'user',
          summary: singleLine(promptField.text ?? '', MAX_SUMMARY_CHARS),
          text: promptField.text,
          textTruncated: promptField.truncated,
          steered,
        });
      }

      if (split.prompt === null && split.injected === null) {
        push({ kind: 'system', title: 'user', summary: '', text: null });
      }
      continue;
    }

    // A compaction is a context checkpoint written by the runtime, not something the user
    // or the model said. It gets its own kind rather than riding inside `system` because
    // the client filters on kind alone: filed under `system`, a checkpoint would be
    // impossible to keep or drop on its own, and unticking 系统 would take every context
    // checkpoint with it. `title` still says which of the `system` family it is.
    if (role === 'compactionSummary') {
      stats.compactions += 1;
      const checkpoint = typeof source.summary === 'string'
        ? source.summary
        : contentToPlainText(content);
      const checkpointField = clipField(checkpoint === null ? null : redact(checkpoint), MAX_FIELD_CHARS);
      // `history_artifact` is the only thing on this row that says *what happened*: which
      // generation it opened, who produced it, and which earlier revision it replaced.
      const artifact = row.history_artifact && typeof row.history_artifact === 'object' && !Array.isArray(row.history_artifact)
        ? /** @type {Record<string, any>} */ (row.history_artifact)
        : null;
      const parent = artifact && artifact.parentSnapshot && typeof artifact.parentSnapshot === 'object'
        ? /** @type {Record<string, any>} */ (artifact.parentSnapshot)
        : null;
      push({
        kind: 'compaction',
        title: 'compaction',
        summary: singleLine(checkpointField.text ?? '', MAX_SUMMARY_CHARS),
        text: checkpointField.text,
        textTruncated: checkpointField.truncated,
        tokensBefore: finiteOrNull(source.tokensBefore),
        producedBy: artifact && typeof artifact.producedBy === 'string' ? artifact.producedBy : null,
        generation: artifact && Number.isInteger(Number(artifact.generation)) ? Number(artifact.generation) : null,
        parentGeneration: parent && Number.isInteger(Number(parent.generation)) ? Number(parent.generation) : null,
        parentCompactionId: parent && typeof parent.compactionId === 'string' ? parent.compactionId : null,
        parentRevision: parent && typeof parent.revision === 'string' && SAFE_REVISION.test(parent.revision)
          ? parent.revision
          : null,
      });
      continue;
    }

    const systemText = contentToPlainText(content)
      ?? (typeof source.summary === 'string' ? source.summary : null)
      ?? (typeof source.text === 'string' ? source.text : null);
    const systemField = clipField(systemText === null ? null : redact(systemText), MAX_FIELD_CHARS);
    push({
      kind: 'system',
      title: 'system',
      summary: singleLine(systemField.text ?? '', MAX_SUMMARY_CHARS),
      text: systemField.text,
      textTruncated: systemField.truncated,
    });
  }

  for (const turn of turns) {
    turn.durationMs = turn.startedAt === null || turn.endedAt === null ? null : turn.endedAt - turn.startedAt;
  }

  for (const pending of toolCallsById.values()) {
    const callRecord = pending.record;
    const resultRecord = pending.result;
    if (!resultRecord) continue;
    const durationMs = callRecord.timestamp === null || resultRecord.timestamp === null
      ? null
      : resultRecord.timestamp - callRecord.timestamp;
    callRecord.durationMs = durationMs;
    resultRecord.durationMs = durationMs;
    const preview = singleLine(resultRecord.result ?? '', 80);
    if (preview) callRecord.summary = singleLine(`${callRecord.summary} → ${preview}`, MAX_SUMMARY_CHARS);
  }

  stats.turns = turns.length;
  // A raw turn total is the number most likely to be misread, so every turn is filed and the
  // count is broken down.
  //
  //   对话       a turn somebody typed into — has a first-of-turn prompt
  //   续作     no prompt, but it closed with a reply: the agent working after the reader
  //                answered a question, which arrives through the tool channel rather than
  //                as a message
  //   压缩       a turn that opened a context generation; a checkpoint, not conversation
  //   其他       neither a prompt nor a reply
  //
  // 问答 is not a turn class, which is what it was mistaken for. It is a prompted turn that
  // did not close: it ends on the “is waiting for the local user” result of a tool that waits on
  // the reader. Labelling the *next* turn instead — as an earlier version did — put the tag on
  // a turn while the reader still had not answered, and on turns holding hundreds of records
  // that were plainly work rather than a Q&A.
  //
  // The other thing worth saying: a turn either ends with exactly one reply (stopReason: stop)
  // or with none. Measured over 63 prompted turns, 54 closed, 5 stopped on ask_user, 4 were cut
  // off. So whether a turn finished is a fact about the data, and it is the fact the counts
  // are built from.
  let turnsWithPrompt = 0;
  let continuationTurns = 0;
  let qaTurns = 0;
  let openTurns = 0;
  let compactionTurns = 0;
  for (const turn of turns) {
    let hasPrompt = false;
    let isCompaction = false;
    let askedReader = false;
    let closed = false;
    for (const record of turn.records) {
      // Injected blocks were demoted to system records, and a later prompt is filed as a
      // steer, so a `user` record here is the prompt that opened the turn.
      if (record.kind === 'user') hasPrompt = true;
      if (record.kind === 'compaction') isCompaction = true;
      if (record.kind === 'reply') closed = true;
      if (record.kind === 'toolCall' && typeof record.toolName === 'string'
        && USER_INPUT_TOOLS.has(record.toolName)) askedReader = true;
    }
    turn.askedReader = askedReader;
    turn.closed = closed;
    // A turn that *contains* a checkpoint is still judged on what it did. A checkpoint used to be
    // a turn of its own, so "contains one" was the same as "is one"; now that the checkpoint
    // rejoins the turn it interrupted, that would relabel every turn the runtime ever compacted
    // as a checkpoint and drop all of them out of the prompted count. Only a turn that holds
    // nothing but its checkpoint is one.
    if (hasPrompt) {
      turn.turnClass = 'prompt';
      turnsWithPrompt += 1;
      if (!closed) openTurns += 1;
      if (askedReader && !closed) qaTurns += 1;
    } else if (closed) {
      turn.turnClass = 'continuation';
      continuationTurns += 1;
    } else if (isCompaction && turn.records.length === 1) {
      // Only reachable when a checkpoint opens a turn the file never names — no work either side
      // of it to attach to.
      turn.turnClass = 'compaction';
      compactionTurns += 1;
    } else {
      turn.turnClass = 'none';
      stats.turnsWithoutPrompt += 1;
    }
  }
  stats.turnsWithPrompt = turnsWithPrompt;
  stats.continuationTurns = continuationTurns;
  stats.qaTurns = qaTurns;
  stats.openTurns = openTurns;
  stats.compactionTurns = compactionTurns;
  if (startedAt !== null && lastTimestamp !== null) stats.durationMs = lastTimestamp - startedAt;
  const resolvedLabel = label ?? `会话 ${String(session.id).slice(4, 12)}`;

  const orphans = Array.isArray(input.orphans) ? input.orphans : [];
  // The catalog can list a generation the lineage walk rejected: a snapshot left behind by a fork
  // is on disk but is not part of this conversation. Summing those into `messagesAll` inflated the
  // session-wide count, and listing them in `generations` offered the reader a pick that resolved
  // to nothing. Both are fixed by reporting the chain rather than the catalog — the rejected ones
  // are still disclosed through `orphans`.
  const orphanFiles = new Set(orphans.map((orphan) => orphan.fileName));
  const generations = (Array.isArray(input.generations) ? input.generations : [])
    .filter((entry) => !orphanFiles.has(entry.fileName));
  // `messages` counts what is on screen. When the whole lineage is stitched that already
  // spans every generation; when the reader filtered to one, `messagesAll` keeps the
  // session-wide number from silently shrinking to a single slice.
  const messagesAll = generations.length > 1
    ? generations.reduce((sum, entry) => sum + (Number.isInteger(entry.messageCount) ? entry.messageCount : 0), 0)
    : rows.length;

  return {
    session: {
      id: session.id,
      label: resolvedLabel,
      messageCount: rows.length,
      turnCount: turns.length,
      startedAt,
      lastActiveAt: session.createdAtMs ?? startedAt,
      sizeBytes,
      truncated,
      // The page prints this number when it reports truncation, so it is sent rather than
      // restated in the markup where the two could drift apart again.
      maxMessageBytes: MAX_MESSAGE_BYTES,
      generation: input.generation ?? null,
      generations,
      orphans,
    },
    stats: { ...stats, messagesAll },
    turns: turns.map((turn) => ({
      id: turn.id,
      index: turn.index,
      startedAt: turn.startedAt,
      endedAt: turn.endedAt,
      durationMs: turn.durationMs,
      toolCalls: turn.toolCalls,
      errors: turn.errors,
      tokens: turn.tokens,
      // prompt | continuation | compaction | none.
      turnClass: turn.turnClass ?? 'none',
      // Whether this turn asked the reader something and therefore has not closed yet, and
      // whether it ended with the answer it owes. Together they explain every gap between the
      // turn count and the reply count.
      askedReader: turn.askedReader === true,
      closed: turn.closed === true,
      records: turn.records,
    })),
  };
}

/**
 * Redacts decoded string values in place of the serialized form: rewriting serialized JSON would
 * corrupt nested escaped strings (a manifest embedded in `details` re-parses as broken JSON).
 * @param {any} value
 * @param {(value: string) => string} redact
 * @param {number} [depth]
 */
function redactStructure(value, redact, depth = 0) {
  if (depth > 24) return null;
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map((entry) => redactStructure(entry, redact, depth + 1));
  if (value && typeof value === 'object') {
    /** @type {Record<string, any>} */
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = redactStructure(entry, redact, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * @param {Record<string, any>} message
 * @param {(value: string) => string} redact
 */
export function buildRawPayload(message, redact) {
  if (!message || typeof message !== 'object') return { value: null, omitted: true };
  let serialized = '';
  try {
    serialized = JSON.stringify(message);
  } catch {
    return { value: null, omitted: true };
  }
  if (typeof serialized !== 'string') return { value: null, omitted: true };
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RAW_BYTES) return { value: null, omitted: true };
  return { value: serialized.includes('.minimax') ? redactStructure(message, redact) : message, omitted: false };
}

/**
 * @param {unknown} args
 * @param {(value: string) => string} redact
 */
function prepareArguments(args, redact) {
  if (args === undefined || args === null) return { value: null, omitted: false, summaryArgs: null };
  if (typeof args !== 'object') return { value: String(args), omitted: false, summaryArgs: String(args) };
  let serialized = '';
  try {
    serialized = JSON.stringify(args);
  } catch {
    return { value: null, omitted: true, summaryArgs: null };
  }
  // The summary is truncated to one short line, so it can safely use the uncapped redacted copy.
  const redacted = serialized.includes('.minimax') ? redactStructure(args, redact) : args;
  if (Buffer.byteLength(serialized, 'utf8') > MAX_ARGUMENT_BYTES) {
    return { value: null, omitted: true, summaryArgs: redacted };
  }
  return { value: redacted, omitted: false, summaryArgs: redacted };
}

/**
 * @param {any} response
 * @param {number} status
 * @param {unknown} payload
 */
function sendJson(response, status, payload) {
  if (response.writableEnded || response.destroyed) return;
  let body;
  try {
    body = JSON.stringify(payload);
  } catch {
    return;
  }
  try {
    response.writeHead(status, { ...JSON_HEADERS, 'content-length': Buffer.byteLength(body, 'utf8') });
    response.end(body);
  } catch {
    // The client polls aggressively and aborts requests; a closed socket is not an error here.
  }
}

/**
 * A weak validator derived only from cheap-to-read facts, so it can be computed *before*
 * the expensive file read and still change whenever the payload would change.
 * @param {string} material
 * @returns {string}
 */
export function weakETag(material) {
  return 'W/"' + createHash('sha1').update(material).digest('hex').slice(0, 20) + '"';
}

/**
 * Matches an `If-None-Match` header against the current tag, per RFC 9110: `*` matches
 * anything, and a list matches if any member matches (weak comparison ignores the `W/` prefix).
 * @param {string | undefined | null} header
 * @param {string} etag
 * @returns {boolean}
 */
export function etagMatches(header, etag) {
  if (typeof header !== 'string' || header === '') return false;
  const target = etag.replace(/^W\//, '');
  return header.split(',').some((candidate) => {
    const value = candidate.trim();
    if (value === '*') return true;
    return value.replace(/^W\//, '') === target;
  });
}

/**
 * The cache key for one rendered trajectory. Every component comes from a `stat`, a small
 * manifest/catalog file, or the already-resolved session binding — never from reading
 * `messages.jsonl`, which is the whole point: a matching key proves the file did not grow.
 * @param {{ dir: string, sizeBytes: number, lastActiveAt: number }} entry
 * @param {{ catalogBytes?: number | null }} identity
 * @param {any} binding
 * @returns {string}
 */
export function trajectoryCacheKey(entry, identity, binding, filter) {
  const bind = binding
    ? [
      binding.sessionId ?? '',
      binding.title ?? '',
      binding.ambiguous ? '1' : '0',
      binding.leased ? '1' : '0',
      (binding.candidates ?? []).map((c) => `${c.sessionId}:${c.title}`).join(','),
    ].join('|')
    : 'file-mtime';
  // The stitched answer depends on every generation in the chain, not just the file that is
  // being appended to, so the catalog's own numbers have to be part of the key. Without them a
  // compaction that only rotated snapshots could serve a stale pre-rotation body.
  const lineage = (identity.generations ?? [])
    .map((g) => `${g.generation}:${g.fileName}:${g.byteLength ?? ''}`)
    .join(',');
  // The requested slice is part of the answer too: the same session stitched and unfiltered is
  // two different bodies and must never share an entry.
  const gen = filter === null || filter === undefined ? 'all' : String(filter);
  return `${entry.dir}|gen=${gen}|${lineage}|${entry.sizeBytes}|${entry.lastActiveAt}|${identity.catalogBytes ?? ''}|${bind}`;
}
/**
 * The `?since=` cursor, or null when there is not a usable one.
 *
 * An absent, blank, non-integer or negative value is not an error: it is a page that has
 * nothing yet, and a page with nothing yet needs the whole payload. Turning that into a
 * 400 would put the first poll of every session on an error path for a question with a
 * perfectly good default answer.
 * @param {string | null | undefined} raw
 * @returns {number | null}
 */
export function parseSince(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

/**
 * The part of a payload the page does not have: every record after the cursor.
 *
 * `stats` and `session` travel whole in every delta. `stats` because it is an accumulator,
 * every counter in it the result of walking all the rows, so a tail could not be added to
 * it without the page re-deriving the server's own arithmetic. `session` because it is a few
 * hundred bytes and answering it from the previous copy would make each payload depend on
 * a history the server does not keep.
 *
 * A turn travels whole. Its turn-level fields were always sent whole — a turn's `closed` flips as
 * the conversation moves on, and 无答复 is decided by it — but its `records` used to be cut down
 * to the ones after the cursor, and that cut is what dropped a tool call's duration.
 *
 * `durationMs` and the result preview are written onto the call record *after* it was first
 * pushed, when its result message arrives. So the record that gains a value is an OLD one, with
 * an index below the cursor: it was never in the tail, and the row the reader was already looking
 * at stayed blank until they refreshed. Measured by running both halves: with the cut in place
 * the page holds `durationMs: null` while the server holds 1533.
 *
 * The fix is to cut at turn granularity — a turn with anything new after the cursor travels whole
 * — and the cost is bounded rather than open-ended, because `?since=` never saved the server any
 * work to begin with: the whole body is serialized either way for the cache entry and `/raw`. This
 * only moves bytes on the wire and work into the page's `JSON.parse`.
 *
 * A call and its result sit in the SAME turn — a turn opens on a prompt and closes when the agent
 * finishes responding, so the tool cycle is inside one span. That is what makes turn granularity
 * sufficient rather than a narrowing: the turn that gains a record is the turn that gets written
 * back onto. A result that landed in a later turn than its call would still wait for a refresh,
 * and that is the one shape this does not cover.
 *
 * Returns null when a delta would not be a faithful answer; that is the caller's signal to
 * send the whole payload instead. It happens when the payload carries no records, and when
 * the cursor is past the end. The second is the page being *ahead* of the server, which is
 * what a generation switch looks like from here — and a tail from there is empty, so
 * serving it would leave the page believing the server has nothing to add.
 *
 * @param {any} payload
 * @param {number} since
 * @returns {any | null}
 */
export function buildDeltaPayload(payload, since) {
  if (!Number.isInteger(since) || since < 0) return null;
  const turns = payload && Array.isArray(payload.turns) ? payload.turns : [];
  if (turns.length === 0) return null;
  let upTo = 0;
  for (const turn of turns) {
    const records = turn && Array.isArray(turn.records) ? turn.records : [];
    for (const record of records) {
      if (typeof record.index === 'number' && record.index > upTo) upTo = record.index;
    }
  }
  if (since > upTo) return null;
  const tail = [];
  // `records` counts what is NEW, not what travels. A turn that ships whole with 300 records
  // contributes 1 here. The page reads `delta.upTo` for its next cursor and never reads this
  // number, but three guards pin it as the count of additions — and that is what it is, so the
  // count and the cut are computed apart instead of the count inheriting the cut.
  let records = 0;
  for (const turn of turns) {
    const all = turn && Array.isArray(turn.records) ? turn.records : [];
    let fresh = 0;
    for (const record of all) {
      if (typeof record.index === 'number' && record.index > since) fresh += 1;
    }
    if (fresh === 0) continue;
    records += fresh;
    tail.push({ ...turn, records: all.slice() });
  }
  return {
    session: payload.session,
    stats: payload.stats,
    turns: tail,
    delta: { since, upTo, records },
  };
}

/**
 * @typedef {{ rows: Array<Record<string, any>>, skipped: number, size: number, read: number, empty: boolean, truncated: boolean }} ParsedRows
 */

/**
 * Cache key for one generation file's parsed rows.
 *
 * Built from what the filesystem says right now, never from the catalog. The catalog's
 * byteLength is a snapshot — this file documents that as going stale, and the active file
 * grows past it between polls — so a key built from it would eventually serve a stale parse.
 *
 * The key names the full path, not the basename: every session has a `messages.jsonl`, so a
 * basename key lets two sessions' identical files collide.
 *
 * `limit` participates because readHead truncates at it, and whether the file was truncated is
 * part of what this entry holds.
 *
 * @param {string} filePath
 * @param {number} size
 * @param {number} mtimeMs
 * @param {number} limit
 * @returns {string}
 */
export function parsedRowsKey(filePath, size, mtimeMs, limit) {
  return `${filePath}|${size}|${mtimeMs}|${limit}`;
}

/**
 * LRU over parsed generation rows, bounded by bytes.
 *
 * Bounded by bytes rather than entries because entries say nothing about volume: one
 * generation file is 40 KB and the next is 10 MB. A single entry larger than the whole budget
 * is not stored at all — it would evict everything else and still miss every time.
 *
 * @param {number} budget
 */
export function createParsedRowsCache(budget) {
  /** @type {Map<string, { value: ParsedRows, size: number }>} */
  const entries = new Map();
  let bytes = 0;
  return {
    get bytes() { return bytes; },
    get size() { return entries.size; },
    /**
     * @param {string} key
     * @returns {ParsedRows | null}
     */
    get(key) {
      const hit = entries.get(key);
      if (hit === undefined) return null;
      // Re-reading is the only signal that a file is still hot, so it refreshes recency.
      entries.delete(key);
      entries.set(key, hit);
      return hit.value;
    },
    /**
     * @param {string} key
     * @param {ParsedRows} value
     * @param {number} size
     * @returns {number}
     */
    set(key, value, size) {
      const previous = entries.get(key);
      if (previous !== undefined) {
        bytes -= previous.size;
        entries.delete(key);
      }
      if (size > budget) return bytes;
      entries.set(key, { value, size });
      bytes += size;
      while (bytes > budget && entries.size > 1) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        const victim = entries.get(oldest.value);
        entries.delete(oldest.value);
        bytes -= victim ? victim.size : 0;
      }
      return bytes;
    },
    clear() {
      entries.clear();
      bytes = 0;
    },
  };
}

/**
 * One generation file's rows, from the cache when the filesystem still agrees with the key.
 *
 * Extracted from the route so a test can run the real step twice and compare: a cache hit
 * that is even slightly different from a cold read is the one failure this cache may not
 * have, and it is invisible to any test that does not run this function.
 *
 * Throws whatever readHead throws; the caller owns the error response, because the route
 * needs to answer 500 and the test needs the throw.
 *
 * @param {ReturnType<typeof createParsedRowsCache>} cache
 * @param {string} filePath
 * @param {number} limit
 * @returns {Promise<ParsedRows>}
 */
export async function loadParsedRows(cache, filePath, limit) {
  // Stat for the key rather than trusting the catalog, for the same reason the read limit is
  // not taken from it: the active file grows past its recorded size between polls. If the file
  // changes between this stat and readHead the entry ends up keyed on a size it does not
  // match, and the next poll — which stats again — misses and re-reads. The race can only cost
  // a redundant read; it can never serve a stale parse, because a different size is a
  // different key.
  const current = await stat(filePath);
  const key = parsedRowsKey(filePath, current.size, current.mtimeMs, limit);
  const hit = cache.get(key);
  if (hit !== null) return hit;

  const head = await readHead(filePath, limit);
  const parsed = parseMessagesJsonl(head.text);
  const value = {
    rows: parsed.rows,
    skipped: parsed.skipped,
    size: head.size,
    read: head.read,
    empty: head.text === '',
    // Truncated means our cap cut the read, nothing else.
    truncated: truncatedByCap(head.size, limit),
  };
  cache.set(key, value, Math.ceil(head.size * PARSED_ROWS_HEAP_PER_SOURCE_BYTE));
  return value;
}

/**
 * Sends an already-serialized JSON body. Unlike {@link sendJson} it supports revalidation:
 * `no-store` would suppress the 304 path, so revalidated responses advertise `no-cache`
 * (storable, but must be revalidated) and carry the tag the page echoes back.
 * @param {any} response
 * @param {number} status
 * @param {string} body
 * @param {{ etag?: string, revalidate?: boolean }} [options]
 */
export function sendJsonBody(response, status, body, options) {
  if (response.writableEnded || response.destroyed) return;
  const headers = { ...JSON_HEADERS };
  if (options && options.revalidate) headers['cache-control'] = 'no-cache';
  if (options && options.etag) headers.etag = options.etag;
  if (status === 304) {
    // A 304 carries no body and must not advertise one.
    try {
      response.writeHead(status, headers);
      response.end();
    } catch {
      // Aborted by the client; see sendJson.
    }
    return;
  }
  headers['content-length'] = Buffer.byteLength(body, 'utf8');
  try {
    response.writeHead(status, headers);
    response.end(body);
  } catch {
    // The client polls aggressively and aborts requests; a closed socket is not an error here.
  }
}

/** @param {any} response */
function sendNotFound(response) {
  sendJson(response, 404, { error: 'not_found' });
}

/** @param {any} response @param {string} code @param {string} message */
function sendError(response, status, code, message) {
  sendJson(response, status, { error: code, message });
}

/**
 * @param {MiniAppContext} context
 */
export async function start(context) {
  const location = resolveSessionsRoot();
  const secrets = [location.sessionsRoot, location.root, join(homedir(), '.minimax')];
  const redact = createRedactor(secrets);
  /** @type {Buffer | null} */
  let clientEntry = null;
  let listCache = { at: 0, entries: null };
  /** @type {Map<string, { at: number, value: any }>} */
  const descriptorCache = new Map();
  /**
   * Serialized `/api/trajectory` payloads keyed by facts that are cheap to read, so an
   * unchanged session is neither re-read from disk nor re-transferred on the next poll.
   *
   * `raw` lives here rather than in `body`: the untouched message is most of the session
   * but is only ever read for one record at a time, so keeping it beside the body means
   * the poll transfers the small payload and the record that gets opened still costs
   * nothing extra.
   * @type {Map<string, { at: number, etag: string, body: string, raws: Map<number, number>, rows: Array<Record<string, any>> }>}
   */
  const trajectoryCache = new Map();
  /**
   * Parsed generation rows, keyed by path+size+mtime+limit. Beside trajectoryCache, not
   * inside it: a whole-session hit still short-circuits before this is touched at all, so
   * the two caches never answer for each other. Pinned by tests/verify-parsed-rows.mjs.
   */
  const parsedRows = createParsedRowsCache(PARSED_ROWS_CACHE_BYTES);

  const loadClientEntry = async () => {
    if (clientEntry) return clientEntry;
    const buffer = await readFile(join(context.pluginRoot, 'miniapp', 'client', 'index.html'));
    clientEntry = buffer;
    return buffer;
  };

  const listEntries = async () => {
    const now = Date.now();
    if (listCache.entries && now - listCache.at < LIST_CACHE_TTL_MS) return listCache.entries;
    const entries = await collectSessionEntries(location.sessionsRoot);
    listCache = { at: now, entries };
    return entries;
  };

  /**
   * Titles and kinds for the visible slice, cached on the same budget as the walk above.
   *
   * readSessionTitles opens the runtime database on every call, and the list route calls it once
   * per poll for rows that only change when somebody renames a session. Raising the walk's TTL
   * without this would still reopen a 700 MB store every 2.5 s forever, so the two caches answer
   * the same poll or neither does.
   * @type {{ at: number, key: string, map: Map<string, { title: string | null, kind: string | null }> }}
   */
  let titleCache = { at: 0, key: '', map: new Map() };
  /** @param {readonly string[]} ids */
  const sessionTitles = async (ids) => {
    const key = ids.join('');
    const now = Date.now();
    if (key === titleCache.key && now - titleCache.at < LIST_CACHE_TTL_MS) return titleCache.map;
    const map = await readSessionTitles(location.root, ids);
    titleCache = { at: now, key, map };
    return map;
  };

  const describeSession = async (entry) => {
    const cacheKey = `${entry.dir}|${entry.sizeBytes}|${entry.lastActiveAt}`;
    const cached = descriptorCache.get(cacheKey);
    if (cached && Date.now() - cached.at < SESSION_CACHE_TTL_MS) return cached.value;
    const identity = await readSessionIdentity(entry.dir);
    const cacheId = `${entry.dir}|${identity.id}`;
    let peek = { messages: 0, userMessages: 0, assistantMessages: 0, toolResults: 0, toolCalls: 0, thinkingBlocks: 0, turns: 0 };
    let label = null;
    let startedAt = identity.createdAtMs;
    // Whether the prefix was the whole file, and so whether its counters mean what their names say.
    // False until a read proves otherwise: a failed read has counted nothing at all, and reporting
    // its zeros as 「0 条」 would be the same lie with a smaller number.
    let peekIsWhole = false;
    try {
      const head = await readHead(join(entry.dir, 'messages.jsonl'), LIST_PEEK_BYTES);
      peek = countRolesInPrefix(head.text);
      label = findFirstUserLabel(head.text, redact);
      const firstTimestamp = firstTimestampIn(head.text);
      if (firstTimestamp !== null) startedAt = firstTimestamp;
      peekIsWhole = !truncatedByCap(head.size, LIST_PEEK_BYTES);
    } catch (error) {
      context.logger.warn('miniapp.trajectory.read_error', { reason: 'peek_failed', code: errorCode(error) });
    }
    const value = {
      id: identity.id,
      label: label ?? `会话 ${String(identity.id).slice(4, 12)}`,
      // A prefix count is a prefix count. Reported as the session's message count it is simply
      // untrue, so when the prefix was not the whole file these are absent rather than approximate —
      // and the page's job is to print nothing rather than to print a number it cannot stand behind.
      messageCount: peekIsWhole ? peek.messages : null,
      startedAt,
      lastActiveAt: entry.lastActiveAt,
      // The active file's size, which is exactly what it is: `sizeBytes` is not a lineage total
      // here, and /api/trajectory's is. Same name, different scope. Pinned by tests/verify-list-cache.mjs.
      sizeBytes: entry.sizeBytes,
      turnCount: peekIsWhole ? peek.turns : null,
      cacheId,
    };
    descriptorCache.set(cacheKey, { at: Date.now(), value });
    if (descriptorCache.size > SESSION_CACHE_ENTRIES) {
      const oldest = descriptorCache.keys().next();
      if (!oldest.done) descriptorCache.delete(oldest.value);
    }
    return value;
  };

  /**
   * Diagnostics: report what this Node process can actually observe about its own session
   * identity. Names and structure only — no environment *values* are returned unless the
   * value is itself a session id, which is the one fact this route exists to settle.
   */
      const handleRuntime = async (response) => {
   let diagError = null;
   try {
    let sqlite = { available: false, error: null, dbFile: null, exists: false, opened: false, queryError: null, resolvedSessionId: null, conversationCount: null };
    /** @type {any} */
    let mod = null;
    try {
      mod = await import('node:sqlite');
      sqlite.available = typeof mod.DatabaseSync === 'function';
    } catch (error) {
      sqlite.error = String(/** @type {any} */ (error)?.message ?? error).slice(0, 200);
    }
    if (sqlite.available) {
      // Name only — this route must never hand the browser a filesystem location.
      sqlite.dbFile = basename(join(location.root, 'v2', 'sqlite', 'runtime-state.sqlite'));
      const sqlitePath = join(location.root, 'v2', 'sqlite', 'runtime-state.sqlite');
      sqlite.exists = existsSync(sqlitePath);
      let probe = null;
      try {
        probe = new mod.DatabaseSync(sqlitePath, { readOnly: true });
        const count = probe.prepare(
          "select count(*) as n from local_runtime_sessions where session_kind = 'conversation' and purpose is null",
        ).get();
        sqlite.conversationCount = count ? toNumber(count.n) : null;
      } catch (error) {
        sqlite.queryError = String(/** @type {any} */ (error)?.message ?? error).slice(0, 240);
      } finally {
        // A schema mismatch is the case this route exists to report, and it is exactly the case
        // where `prepare` throws — so closing inside the try left the handle waiting for GC.
        closeQuietly(probe);
      }
      const current = await resolveCurrentConversation(location.root);
      sqlite.opened = Boolean(current);
      sqlite.resolvedSessionId = current ? current.sessionId : null;
    }
    sendJson(response, 200, {
      nodeVersion: process.version,
      // Everything below is a basename, a count, or a flag. This route deliberately publishes no
      // path and no process internals: `process.argv[0]` is the absolute path of the node
      // executable, which on Windows carries the user profile directory, and pid/ppid/execArgv
      // are internals the page has no use for. The page reads none of this; the route exists to
      // answer "is the runtime binding alive", and `sqlite` plus `sessionRootExists` answer that.
      sqlite,
      cwdBasename: basename(process.cwd()) || null,
      dataDirBasename: basename(context.dataDir) || null,
      sessionRootExists: existsSync(location.sessionsRoot),
    });
   } catch (error) {
    diagError = String(/** @type {any} */ (error)?.stack ?? error).slice(0, 600);
    sendJson(response, 200, { diagError });
   }
  };

  const handleSessions = async (response, url) => {    const limit = normalizeLimit(url.searchParams.get('limit'), 20, 1, 50);
    let entries;
    try {
      entries = await listEntries();
    } catch (error) {
      context.logger.error('miniapp.trajectory.read_error', { reason: 'root_unreadable', code: errorCode(error) });
      sendError(response, 503, 'trajectory_unavailable', '未找到本地会话数据目录');
      return;
    }
    if (entries.length === 0) {
      sendError(response, 503, 'trajectory_unavailable', '未找到本地会话数据目录');
      return;
    }
    const described = [];
    const visible = entries.slice(0, limit);
    // Real titles from the runtime database; sub-agent and cron sessions get a kind badge so
    // the picker never presents them as if they were the user's conversation.
    const titles = await sessionTitles(
      visible.map((entry) => decodeSessionIdFromDirName(basename(entry.dir))).filter(Boolean),
    );
    for (const entry of visible) {
      try {
        const descriptor = await describeSession(entry);
        const meta = titles.get(decodeSessionIdFromDirName(basename(entry.dir)));
        if (meta) {
          if (meta.title) descriptor.label = meta.title;
          descriptor.sessionKind = meta.kind;
        }
        described.push(descriptor);
      } catch (error) {
        context.logger.warn('miniapp.trajectory.read_error', { reason: 'describe_failed', code: errorCode(error) });
      }
    }
    sendJson(response, 200, { sessions: described.map(stripInternalFields) });
  };

  /**
   * Which session a trajectory request is about, plus everything that decides whether it
   * has changed. The bulk payload and the per-record raw fetch both go through here, so
   * the same query string can never be read as two different sessions.
   *
   * @param {URL} url
   */
  const resolveTrajectoryRequest = async (url) => {
    let entries;
    try {
      entries = await listEntries();
    } catch (error) {
      context.logger.error('miniapp.trajectory.read_error', { reason: 'root_unreadable', code: errorCode(error) });
      return { ok: false, status: 503, code: 'trajectory_unavailable', message: '未找到本地会话数据目录' };
    }
    if (entries.length === 0) {
      return { ok: false, status: 503, code: 'trajectory_unavailable', message: '未找到本地会话数据目录' };
    }
    const requested = url.searchParams.get('session');
    let entry = null;
    let binding = null;
    if (!requested || requested === 'latest') {
      // Ask the runtime database which conversation is live before falling back to mtime:
      // a worker or cron session often has the newest file even while the user reads another one.
      const current = await resolveCurrentConversation(location.root);
      if (current) {
        entry = entries.find((candidate) => basename(candidate.dir).includes('session_')
          && decodeSessionIdFromDirName(basename(candidate.dir)) === current.sessionId) ?? null;
        if (!entry && current.relativeDir) {
          // Not in the recent window — build the entry straight from the recorded path. That value
          // is a database column rather than a name this app chose, so it earns the same
          // containment check `resolveArtifactPath` gives catalog file names.
          const root = resolve(location.sessionsRoot);
          const dir = resolve(root, current.relativeDir.replace(/\\/g, '/'));
          if (dir !== root && !dir.startsWith(root + sep)) {
            context.logger.warn('miniapp.trajectory.read_error', { reason: 'session_dir_rejected' });
            entry = null;
          } else {
            try {
              const fileStat = await stat(join(dir, 'messages.jsonl'));
              entry = { dir, sizeBytes: fileStat.size, lastActiveAt: Math.floor(fileStat.mtimeMs) };
            } catch {
              entry = null;
            }
          }
        }
        if (entry) binding = current;
      }
      if (!entry) entry = entries[0];
    } else {
      const matched = [];
      for (const candidate of entries) {
        const identity = await readSessionIdentity(candidate.dir);
        if (identity.id === requested || basename(candidate.dir) === requested) {
          matched.push({ entry: candidate, identity });
          break;
        }
      }
      if (matched.length === 0) {
        return { ok: false, status: 404, code: 'session_not_found', message: '找不到该会话' };
      }
      entry = matched[0].entry;
    }

    const identity = await readSessionIdentity(entry.dir);

    // Which slice of history to show. The default is the whole lineage, because that is what
    // the session actually contains: a compaction rotates the old messages into a snapshot
    // rather than deleting them, so reading only the active file would show a conversation
    // that stops existing at its first checkpoint. `?generation=N` narrows to one slice.
    const generations = identity.generations;
    const requestedGeneration = url.searchParams.get('generation');
    /** @type {number | null} */
    let filter = null;
    if (requestedGeneration !== null && requestedGeneration !== '') {
      const wanted = Number(requestedGeneration);
      filter = Number.isInteger(wanted) && wanted >= 0 ? wanted : NaN;
      if (!generations.some((candidate) => candidate.generation === filter)) {
        return { ok: false, status: 404, code: 'generation_not_found', message: '找不到该上下文代' };
      }
    }

    // Everything needed to decide "did this change?" is already in hand. Building the key
    // before the read is what lets an unchanged session skip the read entirely.
    return { ok: true, entry, binding, identity, generations, filter, cacheKey: trajectoryCacheKey(entry, identity, binding, filter) };
  };

  const handleTrajectory = async (response, url) => {
    const ctx = await resolveTrajectoryRequest(url);
    if (!ctx.ok) {
      sendError(response, ctx.status, ctx.code, ctx.message);
      return;
    }
    const { entry, binding, identity, generations, filter, cacheKey } = ctx;
    const etag = weakETag(cacheKey);
    const requestEtag = response.req && response.req.headers ? response.req.headers['if-none-match'] : null;
    const cached = trajectoryCache.get(cacheKey);
    if (cached) {
      if (etagMatches(requestEtag, etag)) {
        sendJsonBody(response, 304, '', { etag, revalidate: true });
        return;
      }
      // No validator from the page (first load, or a fresh tab): reuse the body we already
      // built instead of re-reading and re-parsing the files to rebuild the same bytes.
      // No `?since=` handling here, and that is not an oversight. A page that carries a
      // cursor carries the validator it was taken against, so a request that reaches this
      // line with a cursor means the session changed — which is the branch below. Cutting
      // a tail out of a cached payload would also mean holding that payload in memory, and
      // this cache deliberately does not: it holds the serialized bytes and the rows /raw
      // needs, not the object graph the bytes came from.
      sendJsonBody(response, 200, cached.body, { etag, revalidate: true });
      return;
    }

    // Walk the lineage from the active file outward. A small head of each candidate is enough
    // to learn which generation it claims to be, so only the files that actually belong to the
    // chain get parsed in full.
    const artifactByFile = new Map(generations.map((candidate) => [candidate.fileName, candidate]));
    // history-catalog.json is written by the runtime when it rotates generations, so a session
    // that has never compacted does not have one and its `generations` list is empty. The active
    // file is real regardless, and `probe` below already synthesises an artifact for it; reuse
    // that same shape here instead of rejecting the whole session with artifact_path_rejected.
    const activeArtifactFor = (fileName) => artifactByFile.get(fileName)
      ?? (fileName === 'messages.jsonl'
        ? {
          fileName: 'messages.jsonl',
          active: true,
          generation: null,
          kind: 'messages',
          byteLength: null,
          messageCount: null,
          revision: null,
        }
        : null);
    /** @type {Map<number, { marker: any, head: string }>} */
    const probed = new Map();
    const probe = async (generation) => {
      const artifact = generation === null
        ? { fileName: 'messages.jsonl', active: true, byteLength: identity.catalogBytes }
        : generations.find((candidate) => candidate.generation === generation) ?? null;
      if (artifact === null) return null;
      if (generation !== null && artifact.active) return null;
      const filePath = resolveArtifactPath(entry.dir, artifact);
      if (filePath === null) return null;
      if (probed.has(artifact.fileName)) return probed.get(artifact.fileName);
      const head = await readHead(filePath, GENERATION_PROBE_BYTES);
      const result = { fileName: artifact.fileName, marker: readGenerationMarker(head.text) };
      probed.set(artifact.fileName, result);
      return result;
    };

    /** @type {{ chain: Array<{ generation: number, fileName: string }>, orphans: Array<{ generation: number, fileName: string }> }} */
    let lineage;
    try {
      lineage = await walkLineage({ generations }, probe);
    } catch (error) {
      context.logger.error('miniapp.trajectory.read_error', { reason: 'lineage_unreadable', code: errorCode(error) });
      sendError(response, 500, 'trajectory_unreadable', '会话数据暂时无法读取');
      return;
    }
    if (lineage.chain.length === 0) {
      sendError(response, 500, 'trajectory_unreadable', '会话数据暂时无法读取');
      return;
    }
    const activeFileName = lineage.chain[lineage.chain.length - 1].fileName;
    const activeArtifact = activeArtifactFor(activeFileName);

    // Concatenate oldest → newest, which is the order the conversation actually happened in.
    /** @type {Array<Record<string, any>>} */
    const rows = [];
    let skippedTotal = 0;
    let truncated = false;
    let readBytes = 0;
    for (const link of lineage.chain) {
      const artifact = activeArtifactFor(link.fileName);
      const filePath = artifact === null ? null : resolveArtifactPath(entry.dir, artifact);
      if (filePath === null) {
        context.logger.error('miniapp.trajectory.read_error', { reason: 'artifact_path_rejected', code: errorCode(null) });
        sendError(response, 500, 'trajectory_unreadable', '会话数据暂时无法读取');
        return;
      }
      // Bound the read by our own cap only. The catalog's recorded sizes are a snapshot and the
      // active messages.jsonl keeps being appended to after the catalog was written, so using
      // them as a read limit both dropped records that were really on disk and — because the read
      // then stopped short of the file — made `head.read < head.size` report "file too large" for
      // a file that was merely newer than its catalog entry. `readHead` already clamps to the real
      // stat size, so MAX_MESSAGE_BYTES bounds memory on its own.
      const limit = MAX_MESSAGE_BYTES;
      /** @type {ParsedRows} */
      let parsedFile;
      try {
        parsedFile = await loadParsedRows(parsedRows, filePath, limit);
      } catch (error) {
        context.logger.error('miniapp.trajectory.read_error', { reason: 'messages_unreadable', code: errorCode(error) });
        sendError(response, 500, 'trajectory_unreadable', '会话数据暂时无法读取');
        return;
      }
      // Kept as a flag on the cached value rather than a log line at the read site: a file that
      // parsed empty once will parse empty every time, and a hit must still say so.
      if (parsedFile.empty) {
        context.logger.warn('miniapp.trajectory.read_error', { reason: 'empty_messages' });
      }
      if (parsedFile.truncated) truncated = true;
      readBytes += parsedFile.read;
      skippedTotal += parsedFile.skipped;
      const keep = filter === null || filter === link.generation;
      // The rows are shared with the cache and with every other request that read this file.
      // Stamping the generation is the only write to them, and one filePath always maps to one
      // generation, so it is idempotent. Pinned by tests/verify-parsed-rows.mjs.
      for (const row of parsedFile.rows) {
        if (keep) {
          row[ROW_GENERATION] = link.generation;
          rows.push(row);
        }
      }
    }
    if (skippedTotal > 0) {
      context.logger.warn('miniapp.trajectory.parse_warn', { skipped: skippedTotal });
    }

    const shown = filter === null ? lineage.chain : lineage.chain.filter((link) => link.generation === filter);
    const payload = buildTrajectoryPayload({
      session: { id: identity.id, createdAtMs: entry.lastActiveAt },
      rows,
      sizeBytes: readBytes,
      truncated,
      redact,
      generations,
      generation: shown.length === 1 ? shown[0].generation : null,
      orphans: lineage.orphans,
    });
    payload.session.lastActiveAt = entry.lastActiveAt;
    payload.session.activeGeneration = activeArtifact === null ? null : activeArtifact.generation;
    payload.session.stitched = shown.length > 1;
    if (binding) {
      // Tell the page how this session was chosen so the footer can be honest about it.
      payload.session.binding = binding.ambiguous ? 'ambiguous' : 'runtime-db';
      payload.session.leased = binding.leased;
      if (binding.title) payload.session.label = binding.title;
      if (binding.ambiguous) {
        payload.session.ambiguousCandidates = binding.candidates.map((candidate) => ({
          id: candidate.sessionId,
          label: candidate.title,
        }));
      }
    } else {
      payload.session.binding = 'file-mtime';
      payload.session.leased = false;
    }

    // Last thing before serializing, and the only place `raw` is ever touched: from here on
    // the body carries no message bodies at all.
    // The locator map plus the rows it points into. Both are references: the rows are the
    // same objects the parsed-rows cache holds, so this adds a map of numbers and an array of
    // pointers rather than a second copy of the session. Keeping the array here also means
    // /raw still answers after the parsed-rows cache has evicted the file.
    const raws = splitRawRecords(payload.turns);

    let body;
    try {
      body = JSON.stringify(payload);
    } catch {
      sendJson(response, 500, { error: 'trajectory_unserializable', message: '会话数据暂时无法读取' });
      return;
    }
    trajectoryCache.set(cacheKey, { at: Date.now(), etag, body, raws, rows });
    while (trajectoryCache.size > TRAJECTORY_CACHE_ENTRIES) {
      const oldest = trajectoryCache.keys().next();
      if (oldest.done) break;
      trajectoryCache.delete(oldest.value);
    }
    // `?since=` asks for the tail. The whole body is serialized either way — the cache
    // entry and /raw both need it — so this saves the transfer and the page's JSON.parse,
    // and not the server's work. Any reading of "41 MB → a few KB, so polling got faster"
    // has to carry that with it. Pinned by tests/verify-incremental.mjs.
    const since = parseSince(url.searchParams.get('since'));
    const delta = since === null ? null : buildDeltaPayload(payload, since);
    sendJsonBody(response, 200, delta === null ? body : JSON.stringify(delta), { etag, revalidate: true });
  };

  /**
   * One record's untouched message, fetched only when something actually reads it.
   *
   * Served out of the same cache entry as the bulk body, so opening the inspector's raw
   * tab costs one record rather than a session. A miss means this process restarted
   * between the two calls; saying so is more honest than silently showing the normalized
   * record in a panel labelled 原文.
   */
  const handleRaw = async (response, url) => {
    const ctx = await resolveTrajectoryRequest(url);
    if (!ctx.ok) {
      sendError(response, ctx.status, ctx.code, ctx.message);
      return;
    }
    const wanted = Number.parseInt(url.searchParams.get('index') ?? '', 10);
    if (!Number.isInteger(wanted) || wanted < 1) {
      sendError(response, 400, 'record_index_required', '缺少记录序号');
      return;
    }
    const cached = trajectoryCache.get(ctx.cacheKey);
    if (!cached) {
      sendError(response, 503, 'trajectory_not_cached', '会话数据已释放，请重新加载');
      return;
    }
    const rowIndex = cached.raws.get(wanted);
    const row = rowIndex === undefined ? undefined : cached.rows[rowIndex];
    if (rowIndex === undefined || !row || typeof row !== 'object') {
      sendError(response, 404, 'record_not_found', '找不到该记录');
      return;
    }
    // The one place the untouched message is materialised, for one record, on request. The
    // size verdict travels with it because the page has to be able to say "omitted" rather
    // than silently show something else — see tests/verify-raw-lazy.mjs.
    const built = buildRawPayload(row.message, redact);
    sendJson(response, 200, { index: wanted, raw: built.value, omitted: built.omitted });
  };

  const handleDashboard = async (response) => {
    try {
      const entry = await loadClientEntry();
      if (response.writableEnded || response.destroyed) return;
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': entry.length,
        'cache-control': 'no-store',
      });
      response.end(entry);
    } catch (error) {
      context.logger.error('miniapp.trajectory.read_error', { reason: 'client_entry_unreadable', code: errorCode(error) });
      sendError(response, 500, 'trajectory_unreadable', '页面资源暂时无法读取');
    }
  };

  const server = createServer((request, response) => {
    const rawUrl = request.url ?? '/';
    response.on('error', () => undefined);
    request.on('error', () => undefined);
    if (request.method !== 'GET') {
      sendNotFound(response);
      return;
    }
    let url;
    try {
      url = new URL(rawUrl, 'http://miniapp.local');
    } catch {
      sendNotFound(response);
      return;
    }
    if (request.destroyed || response.destroyed) return;
    if (url.pathname === '/dashboard') {
      void handleDashboard(response).catch((error) => {
        context.logger.warn('miniapp.request.failed', { route: 'dashboard', code: errorCode(error) });
        sendError(response, 500, 'trajectory_unreadable', '页面资源暂时无法读取');
      });
      return;
    }
    if (url.pathname === '/api/runtime') {
      void handleRuntime(response).catch((error) => {
        context.logger.error('miniapp.trajectory.read_error', { reason: 'runtime_diag_failed', code: errorCode(error) });
        sendError(response, 500, 'trajectory_unreadable', '运行时诊断暂时不可用');
      });
      return;
    }
    if (url.pathname === '/api/sessions') {
      void handleSessions(response, url).catch((error) => {
        context.logger.error('miniapp.trajectory.read_error', { reason: 'sessions_failed', code: errorCode(error) });
        sendError(response, 500, 'trajectory_unreadable', '会话数据暂时无法读取');
      });
      return;
    }
    if (url.pathname === '/api/trajectory') {
      void handleTrajectory(response, url).catch((error) => {
        context.logger.error('miniapp.trajectory.read_error', { reason: 'trajectory_failed', code: errorCode(error) });
        sendError(response, 500, 'trajectory_unreadable', '会话数据暂时无法读取');
      });
      return;
    }
    if (url.pathname === '/api/trajectory/raw') {
      void handleRaw(response, url).catch((error) => {
        context.logger.error('miniapp.trajectory.read_error', { reason: 'raw_failed', code: errorCode(error) });
        sendError(response, 500, 'trajectory_unreadable', '原文暂时无法读取');
      });
      return;
    }
    sendNotFound(response);
  });

  // Keep aborted polls quiet: half-open sockets from frequent client interrupts are normal here.
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    else socket.destroy();
  });
  server.on('error', (error) => {
    context.logger.error('miniapp.runtime.error', { code: errorCode(error) });
  });
  server.keepAliveTimeout = 5000;
  server.headersTimeout = 10000;

  await listen(server, context.listen.host, context.listen.port);
  context.logger.info('miniapp.runtime.listening');

  /** @type {Promise<void> | null} */
  let disposal = null;
  /** @type {() => Promise<void>} */
  const dispose = () => {
    if (disposal) return disposal;
    context.signal.removeEventListener('abort', onAbort);
    listCache = { at: 0, entries: null };
    titleCache = { at: 0, key: '', map: new Map() };
    descriptorCache.clear();
    trajectoryCache.clear();
    // The parsed-row cache is the largest of the three and was the only one not released here, so a
    // disposed runtime kept a whole session's parsed rows alive — measured at roughly 43MB of heap
    // still held for a 39MB session after dispose. It has the same clear() as the others and was
    // simply missed; the line is here so the next cache added cannot repeat the omission quietly.
    parsedRows.clear();
    clientEntry = null;
    disposal = close(server).then(() => undefined);
    return disposal;
  };
  const onAbort = () => {
    void dispose().catch(() => undefined);
  };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  return { dispose };
}

/** @param {any} value */
function stripInternalFields(value) {
  return {
    id: value.id,
    label: value.label,
    messageCount: value.messageCount,
    startedAt: value.startedAt,
    lastActiveAt: value.lastActiveAt,
    sizeBytes: value.sizeBytes,
    turnCount: value.turnCount,
    sessionKind: value.sessionKind ?? null,
  };
}

/**
 * @param {string} text
 * @param {(value: string) => string} redact
 */
function findFirstUserLabel(text, redact) {
  for (const line of text.split('\n')) {
    if (!line.includes('"role":"user"') && !line.includes('"role": "user"')) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const message = parsed && typeof parsed === 'object' ? parsed.message : null;
    if (!message || message.role !== 'user') continue;
    const plain = contentToPlainText(message.content) ?? (typeof message.text === 'string' ? message.text : null);
    // Sub-agent sessions have only injected "user" rows; those must not become the label.
    const prompt = splitUserMessage(message, plain).prompt;
    if (!prompt) continue;
    const label = singleLine(redact(prompt), MAX_LABEL_CHARS);
    if (label) return label;
  }
  return null;
}

/**
 * @param {string} text
 */
function firstTimestampIn(text) {
  const match = /"timestamp"\s*:\s*(\d{10,16})/.exec(text);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

/**
 * @param {unknown} error
 */
function errorCode(error) {
  if (error && typeof error === 'object' && typeof (/** @type {any} */ (error).code) === 'string') {
    return /** @type {any} */ (error).code;
  }
  return 'unknown';
}

/**
 * @param {any} server
 * @param {string} host
 * @param {number} port
 */
function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (/** @type {unknown} */ error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve(undefined);
    });
  });
}

/**
 * @param {any} server
 */
function close(server) {
  return new Promise((resolve) => {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    server.close(() => resolve(undefined));
  });
}