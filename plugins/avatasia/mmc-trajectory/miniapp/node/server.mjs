// @ts-check

import { open, readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import {
  MAX_HITS,
  SEARCH_FIELDS,
  buildSegment,
  createSegmentStore,
  foldNeedle,
  generationKey,
  locatorRowsFromPayload,
  needleIsUsable,
  normaliseWhitespace,
  readSegmentHits,
  scanSegment,
  searchSurfaceOf,
} from './search-segments.mjs';

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
 * The most hits one search response carries. The count is still reported in full — a needle that
 * matches ten thousand records is a real answer — so this is a transport bound and not a claim
 * about how many there were.
 */
const MAX_SEARCH_HITS = MAX_HITS;
/**
 * Upper bound on the parsed generation rows kept resident, in bytes.
 *
 * This budget no longer covers the file that matters. A cache keyed on path+size+mtime for a file
 * that is being appended to has no hit rate to speak of: `handleTrajectory` only reaches the parse
 * after the trajectory key — which carries the same size and mtime — has already missed, so every
 * store here is followed by a miss and the entry is dead weight that still costs its rows'
 * memory. Measured on this machine, retaining it was the largest single cost in the process: 378 MB
 * of heap after one session and 304 polls, against 145 MB once it is not retained.
 *
 * What is left is the sealed generations, whose stat never changes and which are therefore the
 * only parses a second request can genuinely reuse. Those files are rare at a session root — the
 * store keeps rotated generations under `snapshots/`, not beside `messages.jsonl` — so the budget
 * is now generous rather than tuned. Pinned by tests/verify-parsed-rows.mjs.
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
/**
 * How many decoded messages one trajectory entry keeps for `/raw`, per open session.
 *
 * Bounded by count rather than bytes because the thing being kept is one message, and a 64 KB cap
 * is already what decides whether a message is too big to show. The point is not to be a cache —
 * it is so that paging back and forth in the inspector does not re-read the file each time — and a
 * reader who opens more than this many at once is served correctly either way.
 */
const RAW_DECODE_CACHE_ENTRIES = 32;
const SESSION_STORE_TOKEN = '<session-store>';
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
/**
 * Scans for the list counters, one per field. Each one stops right after the opening quote of
 * the value, so the value can be read out of `text` by position instead of being captured —
 * which is the whole point: a capturing `matchAll` allocates a match object per hit, and on a
 * 64 KB prefix with thousands of messages that is thousands of short-lived objects per session,
 * per rebuild.
 *
 * They carry `/g` and are driven with `test`, which allocates nothing. That mutates `lastIndex`,
 * and `matchAll` (which the previous version used) did not, so every scan resets it first.
 * These are module-level on purpose — a `new RegExp` per call would trade the allocation back.
 */
const MESSAGE_ID_SCAN = /"message_id"\s*:/g;
const ROLE_SCAN = /"role"\s*:\s*"/g;
const TURN_SCAN = /"turn_id"\s*:\s*"/g;
const BLOCK_SCAN = /"type"\s*:\s*"/g;
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
 * Whether a projected field carries nothing a reader could be shown.
 *
 * The page has its own `isNil` and it counts an empty string as nothing; this is the same three
 * cases. They have to agree, because the page decides whether to draw a tab from the flag this
 * produces — a definition that treated `''` as present would offer a tab that renders an empty box.
 *
 * @param {unknown} value
 */
function isNilField(value) {
  return value === null || value === undefined || value === '';
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
 * One generation file's rows, plus where each row's line sits in the bytes they were read from.
 *
 * The positions are the second half of what this returns, and they are not a convenience: they
 * are the only thing `/raw` has left once the parsed rows are released, which is what stops a
 * 68 MB session from costing hundreds of megabytes of resident object graph. A line's bytes are
 * found again by seeking to `start` and taking `end - start` of them, and the digest is what says
 * they are still the same bytes.
 *
 * Offsets are byte offsets into `source`. For the route that source is a file read from offset 0,
 * so they are byte offsets into the file; the guards that pass text get offsets into that text's
 * UTF-8 encoding, which is the same relation.
 *
 * @param {string | Buffer} source
 * @returns {{ rows: Array<Record<string, any>>, skipped: number, spans: Array<[number, number]> }}
 */
export function parseMessagesJsonl(source) {
  // One code path, two inputs. The route hands over the bytes it already read, which costs
  // nothing; a caller holding text pays one encode here. Scanning the bytes rather than the string
  // is also what makes the offsets free — a UTF-16 index is not a byte offset.
  const bytes = typeof source === 'string' ? Buffer.from(source, 'utf8') : source;
  /** @type {Array<Record<string, any>>} */
  const rows = [];
  /** @type {Array<[number, number]>} */
  const spans = [];
  let skipped = 0;
  let start = 0;
  while (start < bytes.length) {
    const newline = bytes.indexOf(0x0a, start);
    const end = newline === -1 ? bytes.length : newline;
    const line = bytes.subarray(start, end).toString('utf8');
    if (line.trim() !== '') {
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === 'object') {
          rows.push(parsed);
          spans.push([start, end]);
        } else skipped += 1;
      } catch {
        skipped += 1;
      }
    }
    if (newline === -1) break;
    start = newline + 1;
  }
  return { rows, skipped, spans };
}

/**
 * How much of a line's SHA-256 is kept.
 *
 * Sixteen hex characters is 64 bits, which is chosen against the thing it has to survive: two
 * different lines of the same length producing the same digest. Not a collision an adversary
 * would have to find — nothing here is attacker-controlled — but the 32-bit FNV that was
 * considered first, where a 68 MB session makes birthday-range collisions a matter of how many
 * lines you are willing to hash. A full digest would cost the same to compare and twice the memory
 * per row.
 */
const LINE_DIGEST_CHARS = 16;

/**
 * @param {Buffer} bytes
 * @returns {string}
 */
export function lineDigest(bytes) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, LINE_DIGEST_CHARS);
}

/**
 * Cheap single-pass counters used by the session list; values are approximate by design.
 *
 * Allocation-free apart from the turn-id set, which has to hold the ids to count them
 * distinctly. `tests/verify-count-roles.mjs` runs this against the capturing implementation it
 * replaced over real session prefixes and hand-written edges, so the rewrite is held to being
 * the same function rather than merely a faster one.
 * @param {string} text
 */
export function countRolesInPrefix(text) {
  const counts = { messages: 0, userMessages: 0, assistantMessages: 0, toolResults: 0, systemMessages: 0, toolCalls: 0, thinkingBlocks: 0, turns: 0 };

  MESSAGE_ID_SCAN.lastIndex = 0;
  while (MESSAGE_ID_SCAN.test(text)) counts.messages += 1;

  // The value runs from the scan's `lastIndex` (just past the opening quote) to the next quote.
  // Comparing length first is what makes `user` not also match `userSomething`, and reading the
  // span with `startsWith` keeps the comparison from building a substring per hit.
  const valueIs = (start, literal) => text.startsWith(literal, start)
    && start + literal.length === valueEnd;
  /** @type {number} */
  let valueEnd = 0;

  ROLE_SCAN.lastIndex = 0;
  while (ROLE_SCAN.test(text)) {
    const start = ROLE_SCAN.lastIndex;
    valueEnd = text.indexOf('"', start);
    // No closing quote left means no later field of this kind can match either, so stop.
    if (valueEnd < 0) break;
    if (valueIs(start, 'user')) counts.userMessages += 1;
    else if (valueIs(start, 'assistant')) counts.assistantMessages += 1;
    else if (valueIs(start, 'toolResult')) counts.toolResults += 1;
    // `custom` is the fourth role the counters recognize. A value outside the four is not a
    // role this list counts at all, and must stay uncounted rather than falling into the else.
    else if (valueIs(start, 'custom')) counts.systemMessages += 1;
  }

  const turnIds = new Set();
  TURN_SCAN.lastIndex = 0;
  while (TURN_SCAN.test(text)) {
    const start = TURN_SCAN.lastIndex;
    const end = text.indexOf('"', start);
    if (end < 0) break;
    turnIds.add(text.slice(start, end));
  }
  counts.turns = turnIds.size;

  BLOCK_SCAN.lastIndex = 0;
  while (BLOCK_SCAN.test(text)) {
    const start = BLOCK_SCAN.lastIndex;
    valueEnd = text.indexOf('"', start);
    if (valueEnd < 0) break;
    if (valueIs(start, 'toolCall')) counts.toolCalls += 1;
    else if (valueIs(start, 'thinking')) counts.thinkingBlocks += 1;
  }

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
 * Read at most `limit` bytes from the start of a file, cut back to the last complete line.
 *
 * The read always starts at offset 0 and never moves, so an index into `buffer` is also the byte
 * offset of the same place in the file. That is what lets `/raw` go back to one line later without
 * the parsed rows still being in memory, and it is the reason `buffer` is the primary result:
 * decoding the whole thing into a JS string is what this function used to return, and a 68 MB
 * JSONL read as UTF-16 is up to 136 MB of heap for the duration of the parse.
 *
 * `text` is derived from those bytes on demand for the callers that want a string, and cached
 * because the fixtures read it more than once.
 *
 * @param {string} filePath
 * @param {number} limit
 * @returns {Promise<{ buffer: Buffer, text: string, size: number, read: number }>}
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
    const usableBytes = view.subarray(0, usable);
    /** @type {string | null} */
    let decoded = null;
    return {
      buffer: usableBytes,
      size,
      read: filled,
      get text() {
        if (decoded === null) decoded = usableBytes.toString('utf8');
        return decoded;
      },
    };
  } finally {
    await handle.close();
  }
}

/**
 * Read exactly `[start, end)` out of a file, for one line.
 *
 * Used only by `/raw`, and only after the line's position was recorded during the parse. The
 * length check is not decoration: a file that shrank since then would otherwise answer with
 * whatever now sits at that offset.
 *
 * @param {string} filePath
 * @param {number} start
 * @param {number} end
 * @returns {Promise<Buffer | null>} null when the file no longer reaches `end`
 */
export async function readRange(filePath, start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) return null;
  let handle;
  try {
    handle = await open(filePath, 'r');
  } catch {
    return null;
  }
  try {
    const stat = await handle.stat();
    if (stat.size < end) return null;
    const buffer = Buffer.allocUnsafe(end - start);
    let filled = 0;
    while (filled < buffer.length) {
      const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, start + filled);
      if (bytesRead <= 0) return null;
      filled += bytesRead;
    }
    return buffer;
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => undefined);
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
 * The catalog is used only to find candidate files, with one exception: a file that opens with
 * no marker is taken at the generation the catalog reached it for, because a file that declares
 * nothing offers nothing to check it against. Every file that DOES declare a generation still
 * has to declare the one it was reached for, so a catalog that lists a file belonging to a
 * different lineage cannot smuggle it in, and a file whose parent generation is not exactly one
 * lower ends the chain instead of being stitched on. Snapshots never reached are orphans — a
 * fork leaves them behind — and are reported rather than shown.
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

  // A file that opens with a marker says which generation it is, and the file wins: it is the
  // thing the rest of this function is about verifying. Not every active file opens with one
  // though — the marker rides on the checkpoint row that ROTATED the generation, so a session
  // whose active file was rewritten in place has none. Read from the head of an active file and
  // find nothing, and the walk used to start at generation 0: it reached no parent, so every
  // sealed generation it actually had was reported as an orphan and never shown.
  //
  // The catalog names the same generation, and where both exist they agree — measured over every
  // session on this machine with a catalog: 5 of 5 agree, none contradicts. So the catalog is
  // used for exactly the value the file does not carry, and a file that does carry one still
  // overrides it. That keeps the rule this function already states: the catalog finds candidate
  // files, and each file still has to declare the generation it is reached for.
  const activeGeneration = activeProbe.marker
    ? activeProbe.marker.generation
    : activeCatalogGeneration(null, catalog.generations) ?? 0;
  const chain = [{ generation: activeGeneration, fileName: activeProbe.fileName }];
  const reached = new Set([activeGeneration]);

  let expect = activeGeneration;
  while (expect > 0) {
    const want = expect - 1;
    if (!byGeneration.has(want)) break;
    const parent = await probe(want);
    if (parent === null) break;
    // A file that opens with no marker declares nothing, so there is nothing to check it
    // against — and refusing it would drop a sealed generation the session really has. The
    // first snapshot of a session that never compacted is exactly this shape: the marker rides
    // on the checkpoint row that rotated the generation, and there was never one. Taken at the
    // generation the catalog reached it for. A file that DOES declare a different generation is
    // still refused, which is what keeps a fork's snapshot out.
    const declared = parent.marker ? parent.marker.generation : want;
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
 * The whole candidate set from one walk, as two products of the same traversal.
 *
 * These used to be one thing, and that is the defect. `slice(0, MAX_SESSION_LIST)` ran last,
 * so the only handle the service had on a session directory was "one of the 30 most recently
 * touched" — and `resolveTrajectoryRequest` resolved an explicit id by scanning exactly those
 * 30. Measured on this machine: 146 candidate directories, 30 exposed, 116 of them
 * unreachable by id (window inside 200/200, a sample outside 404/404). A session the user
 * could name but not open is a correctness bug, not a small one.
 *
 * So the traversal now yields two things:
 *
 *  - `recentEntries` — sorted by mtime, capped at `MAX_SESSION_LIST`. This is what the picker
 *    shows, and it stays exactly as small as it was.
 *  - `byDecodedId` — every candidate directory, keyed by the id decoded from its own name.
 *    Decoding reads no file: the walk already stat'ed `messages.jsonl` for every candidate, so
 *    the index costs no I/O the walk was not doing anyway.
 *
 * Two properties this must not lose:
 *
 *  - A decoded name is a *claim*, not a fact. `readSessionIdentity` prefers `manifest.sessionId`
 *    over the directory name, so every caller of this index still reads the identity of the one
 *    directory it picked and checks the id before serving it.
 *  - Two directories can decode to the same id. `Map.set` would silently keep whichever came
 *    last, which makes the answer depend on `readdir` order. Duplicates are therefore kept as a
 *    list and resolved against the manifests, not discarded and not guessed.
 *
 * `truncated` says the walk hit `MAX_SESSION_CANDIDATES` and stopped early. That budget is a
 * resource guard, and it must not be allowed to masquerade as "this session does not exist" —
 * callers use it to say the scan budget was exhausted, which is a different answer and a
 * truthful one.
 *
 * @param {string} sessionsRoot
 * @returns {Promise<{ recentEntries: Array<{ dir: string, sizeBytes: number, lastActiveAt: number }>,
 *   byDecodedId: Map<string, Array<{ dir: string, sizeBytes: number, lastActiveAt: number }>>,
 *   truncated: boolean }>}
 */
export async function collectSessionCandidates(sessionsRoot) {
  /** @type {Array<{ dir: string, sizeBytes: number, lastActiveAt: number }>} */
  const entries = [];
  let truncated = false;
  /** @param {string} dir @param {number} depth */
  const walk = async (dir, depth) => {
    if (depth > MAX_WALK_DEPTH) return;
    if (entries.length >= MAX_SESSION_CANDIDATES) { truncated = true; return; }
    let names;
    try {
      names = await readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (entries.length >= MAX_SESSION_CANDIDATES) { truncated = true; return; }
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

  /** @type {Map<string, Array<{ dir: string, sizeBytes: number, lastActiveAt: number }>>} */
  const byDecodedId = new Map();
  for (const entry of entries) {
    const id = decodeSessionIdFromDirName(basename(entry.dir));
    // A name that does not decode is still a real session; it just has no fast path and is
    // found the slow way. Dropping it here would turn "no fast path" into "does not exist".
    if (!id) continue;
    const bucket = byDecodedId.get(id);
    if (bucket) bucket.push(entry);
    else byDecodedId.set(id, [entry]);
  }

  return { recentEntries: entries.slice(0, MAX_SESSION_LIST), byDecodedId, truncated };
}

/**
 * Depth-capped walk that only descends into dated folders and never into a session folder twice.
 *
 * Kept as its own export with its old shape and its old meaning — "the most recent sessions" —
 * because the fixture builders and several guards consume exactly that. The id index lives in
 * `collectSessionCandidates` and is deliberately not exposed through this one.
 *
 * @param {string} sessionsRoot
 * @returns {Promise<Array<{ dir: string, sizeBytes: number, lastActiveAt: number }>>}
 */
export async function collectSessionEntries(sessionsRoot) {
  return (await collectSessionCandidates(sessionsRoot)).recentEntries;
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
 * `rowPos` is optional and collected in the same pass. It is the record's position among the
 * records its own row produced, which `/api/trajectory/record` needs to say *which* of them it is
 * answering for — the locator alone says which message, and one message can be several records.
 * It is an out-parameter rather than a second return because this is the one place already walking
 * every record, and a second walk to read a number is how two passes drift apart.
 *
 * @param {Array<Record<string, any>>} turns
 * @param {Map<number, number> | null} [rowPos]
 * @returns {Map<number, number>}
 */
export function splitRawRecords(turns, rowPos = null) {
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
        // Collected here, while the record is in hand, and only for a record that has a locator to
        // answer with. A position with no message behind it cannot be projected and must not be
        // offered as if it could.
        const pos = record.rowPos;
        if (rowPos !== null && typeof pos === 'number' && Number.isInteger(pos) && pos >= 0) {
          rowPos.set(index, pos);
        }
      }
      delete record.rawRow;
    }
  }
  return raws;
}

/**
 * Takes the four heavy fields off every record, in place, and hands the payload back.
 *
 * Measured over this machine's whole session store — 149 files, 13223 records, 27.2 MB of payload:
 * `result` 26.6%, `thinking` 13.2%, `arguments` 9.3%, `text` 8.9%. **59.1% of the body**, and the
 * page was holding all of it to draw a ledger row and, once in a while, one inspector tab.
 *
 * The values are on the records when this is called and still on them afterwards: the search reads
 * them in this process, and `/api/trajectory/record` re-projects the one row it needs. What goes
 * away is the copy that crosses the wire and lands in the page's heap.
 *
 * In place, and in one place. The flags were measured at `push()`, so there is nothing here that
 * can disagree with them — a second measurement site is exactly how the page and the server came
 * to answer 「这条记录有没有正文」 differently.
 *
 * @param {{ turns?: Array<any> }} payload
 */
export function slimPayloadForWire(payload) {
  const turns = payload && Array.isArray(payload.turns) ? payload.turns : [];
  for (const turn of turns) {
    const records = turn && Array.isArray(turn.records) ? turn.records : [];
    for (const record of records) {
      if (!record || typeof record !== 'object') continue;
      delete record.text;
      delete record.thinking;
      delete record.arguments;
      delete record.result;
    }
  }
  return payload;
}

/**
 * Every record of a built payload whose own search text contains the needle.
 *
 * The whole of the search's answer, and a pure function of what is already in hand, so the rule can
 * be pinned without a runtime: it runs over the PROJECTED view rather than over the stored rows, so
 * a version the identity layer suppressed cannot be reported as a row in the ledger, and it tests
 * one record at a time, so a needle cannot be answered by a phrase that spans two of them.
 *
 * `limit` bounds what is RETURNED and never what is COUNTED. A needle that matches ten thousand
 * records is a real answer, and saying so is more useful than a silent truncation.
 *
 * @param {{ turns: Array<any> }} payload
 * @param {string} needle already normalised and folded
 * @param {number} limit
 * @returns {{ hits: Array<{ index: number, turnIndex: number, kind: string, summary: string, generation: number | null }>, total: number }}
 */
export function collectSearchHits(payload, needle, limit) {
  /** @type {Array<{ index: number, turnIndex: number, kind: string, summary: string, generation: number | null }>} */
  const hits = [];
  let total = 0;
  const turns = payload && Array.isArray(payload.turns) ? payload.turns : [];
  for (const turn of turns) {
    const records = Array.isArray(turn.records) ? turn.records : [];
    for (const record of records) {
      if (!searchSurfaceOf(record).includes(needle)) continue;
      total += 1;
      if (hits.length >= limit) continue;
      hits.push({
        index: record.index,
        turnIndex: turn.index,
        kind: record.kind,
        // Already projected and already redacted. Sending it is how the reader sees WHAT matched
        // without opening every row the needle found.
        summary: typeof record.summary === 'string' ? record.summary : '',
        generation: typeof record.generation === 'number' ? record.generation : null,
      });
    }
  }
  return { hits, total };
}


/**
 * The five fields a search reads, in the page's order, normalised and folded exactly as the stored
 * surfaces are. Re-exported so a guard can compare the page's own `recordSearchText` against this
 * without reaching into a private module.
 */
export { SEARCH_FIELDS, normaliseWhitespace, searchSurfaceOf, scanSegment, foldNeedle, needleIsUsable };

/**
 * The runtime's marker for a tool result it dropped while compacting the context.
 *
 * Measured across the whole session store: 141 occurrences, and every one of them the same
 * wording. This is what separates "the runtime rewrote this message" from "something else
 * changed it" — and that distinction decides whether a repeated message_id is a second COPY of
 * one message or a second VERSION of it.
 */
const TOOL_RESULT_REMOVED = /\[Tool result removed by context compaction\.\]/;

/**
 * Two rows are the same message with its content taken out — the comparison that tells a declared
 * trim apart from a rewrite nobody claimed.
 *
 * Only `message.content` is removed, because only it is supposed to change: a trim replaces the
 * result text and leaves the tool name, the call id, the error flag and the turn alone. Anything
 * else moving means this is not the transformation we recognise.
 *
 * `history_artifact` is removed too, for the same reason `contentFingerprint()` removes it. It is
 * the declaring generation's provenance about itself, not a property of the message, and the store
 * attaches it to a generation's own opener row rather than to the message it rewrote. Counting it
 * here made whether a trim was recognised depend on which row happened to carry the annotation —
 * so a correct rewrite sitting on an annotated row read as an unexplained difference, and the two
 * functions disagreed about the same field for opposite reasons.
 *
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
function equalOutsideContent(a, b) {
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const am = a.message;
  const bm = b.message;
  if (am === null || bm === null || typeof am !== 'object' || typeof bm !== 'object') return false;
  const { history_artifact: _omittedFromA, ...restA } = a;
  const { history_artifact: _omittedFromB, ...restB } = b;
  const left = JSON.stringify({ ...restA, message: { ...am, content: null } });
  const right = JSON.stringify({ ...restB, message: { ...bm, content: null } });
  return left === right;
}

/**
 * What makes two occurrences the same CONTENT VERSION of a message.
 *
 * Not the raw line. The newer generation's own opener carries `history_artifact`, so its bytes
 * differ from the identical row in the sealed snapshot while nothing about the message changed —
 * that row is the same version with provenance attached, not a second version. So the fingerprint
 * drops `history_artifact` and nothing else; `message.content` stays in, because that is exactly
 * what a version difference is.
 *
 * @param {any} row
 * @returns {string}
 */
function contentFingerprint(row) {
  if (row === null || typeof row !== 'object') return '';
  const { history_artifact: _omitted, ...rest } = row;
  return JSON.stringify(rest);
}

/**
 * Is this row one the runtime trimmed?
 *
 * All four have to hold, and each one on its own is not enough. The marker describes a
 * GENERATION, not every change inside it; the placeholder wording on its own is just a string that
 * happens to appear. What is not stated anywhere is assumed not to have happened.
 *
 * @param {any} olderRow
 * @param {any} newerRow
 * @param {Set<number>} trimmedGenerations generations that declare `producedBy: 'tool_trim'`
 * @param {number|null} newerGeneration
 * @returns {boolean}
 */
function isDeclaredTrim(olderRow, newerRow, trimmedGenerations, newerGeneration) {
  if (olderRow?.message?.role !== 'toolResult' || newerRow?.message?.role !== 'toolResult') return false;
  if (!equalOutsideContent(olderRow, newerRow)) return false;
  const text = contentToPlainText(newerRow.message.content) ?? '';
  if (!TOOL_RESULT_REMOVED.test(text)) return false;
  return newerGeneration !== null && trimmedGenerations.has(newerGeneration);
}

/**
 * One logical message, and every content version it was stored in.
 *
 * @typedef {object} MessageVersion
 * @property {string|null} digest
 * @property {number|null} generation
 * @property {any} locator
 * @property {any} row
 * @property {number} occurrences how many times this exact version turned up
 * @property {'only'|'trimmed'|'unclassified'} relation how it differs from the first version
 */

/**
 * Merge every occurrence of a message across the whole lineage into one identity.
 *
 * A message can be stored more than once: the active file may re-record a message a sealed
 * snapshot already holds (the same bytes, so it is a second copy of one version), and sealing a
 * generation can rewrite old tool results in place (different bytes, so it is a second version).
 * Treating either as "delete the later row" loses a message or loses a version, so neither is
 * what this does: it keeps both and says which kind it is.
 *
 * Rows with no usable id are NOT keyed together. The builder accepts a non-string id and maps it
 * to null, and a shared `null` key would delete real rows or reject the request outright, so
 * those rows pass straight through in `unkeyed`.
 *
 * @param {Array<{ row: any, generation: number|null, locator: any }>} occurrences in lineage order, oldest first
 * @returns {{
 *   identities: Map<string, { id: string, turnId: string|null, role: string|null, versions: MessageVersion[], openers: string[] }>,
 *   unkeyed: Array<{ row: any, generation: number|null, locator: any }>,
 *   openers: Map<string, string>,
 *   openerOccurrence: Map<string, { row: any, generation: number|null, locator: any }>,
 *   conflicts: Array<{ id: string, reason: string, expected: any, found: any }>,
 *   unclassified: Array<{ id: string, olderGeneration: number|null, newerGeneration: number|null }>,
 *   trimmedGenerations: Set<number>,
 *   stats: { occurrences: number, identities: number, identical: number, trimmed: number, unclassified: number, conflicts: number, unkeyed: number },
 * }}
 */
export function buildMessageIdentity(occurrences) {
  const identities = new Map();
  const unkeyed = [];
  const conflicts = [];
  const unclassified = [];
  const trimmedGenerations = new Set();
  const openers = new Map();
  // Which OCCURRENCE opened each turn, not just which id. A view can contain a message without
  // containing the copy of it that opened the turn, and "is this row the opener" has to be
  // answerable by comparing rows rather than by comparing ids.
  const openerOccurrence = new Map();
  let identical = 0;
  let total = 0;

  for (const occ of occurrences) {
    const row = occ.row;
    const artifact = row?.history_artifact;
    if (artifact && artifact.producedBy === 'tool_trim' && Number.isInteger(artifact.generation)) {
      trimmedGenerations.add(artifact.generation);
    }
    const id = typeof row?.message_id === 'string' && row.message_id !== '' ? row.message_id : null;
    if (id === null) { unkeyed.push(occ); continue; }
    total += 1;

    const role = typeof row?.message?.role === 'string' ? row.message.role : null;
    const turnId = typeof row?.turn_id === 'string' ? row.turn_id : null;
    let entry = identities.get(id);
    if (entry === undefined) {
      entry = { id, turnId, role, versions: [], byFingerprint: new Map() };
      identities.set(id, entry);
    } else if (turnId !== entry.turnId) {
      conflicts.push({ id, reason: 'turn_id', expected: entry.turnId, found: turnId });
    } else if (role !== entry.role) {
      conflicts.push({ id, reason: 'role', expected: entry.role, found: role });
    }

    const digest = typeof occ.locator?.digest === 'string' ? occ.locator.digest : null;
    const fingerprint = contentFingerprint(row);
    const occurrence = { row, generation: occ.generation ?? null, locator: occ.locator ?? null };
    const seen = entry.byFingerprint.get(fingerprint);
    if (seen !== undefined) {
      // Same content version showing up again. Which generation it belongs to is a property of
      // the OCCURRENCE, not of the version: a sealed snapshot and the active file can both hold
      // it, and a generation view has to be able to find the copy that file actually stores.
      seen.occurrences.push(occurrence);
      identical += 1;
      continue;
    }
    const version = {
      fingerprint,
      digest,
      generation: occurrence.generation,
      locator: occurrence.locator,
      row,
      occurrences: [occurrence],
      relation: 'only',
    };
    entry.versions.push(version);
    entry.byFingerprint.set(fingerprint, version);
  }

  let trimmed = 0;
  for (const entry of identities.values()) {
    const first = entry.versions[0];
    for (let v = 1; v < entry.versions.length; v += 1) {
      const other = entry.versions[v];
      if (isDeclaredTrim(first.row, other.row, trimmedGenerations, other.generation)) {
        other.relation = 'trimmed';
        trimmed += 1;
      } else {
        other.relation = 'unclassified';
        unclassified.push({ id: entry.id, olderGeneration: first.generation, newerGeneration: other.generation });
      }
    }
  }

  // The turn opener, decided over the whole lineage rather than over whatever a request kept.
  // Deciding it from the projected slice is what would let a real steer become the first visible
  // prompt of its turn and be counted as dialogue.
  for (const entry of identities.values()) {
    if (entry.role !== 'user' || entry.turnId === null) continue;
    const message = entry.versions[0].row?.message;
    const plain = contentToPlainText(message?.content) ?? (typeof message?.text === 'string' ? message.text : null);
    if (splitUserMessage(message ?? {}, plain).prompt === null) continue;
    if (!openers.has(entry.turnId)) {
      openers.set(entry.turnId, entry.id);
      openerOccurrence.set(entry.turnId, entry.versions[0].occurrences[0]);
    }
  }

  return {
    identities,
    unkeyed,
    openers,
    openerOccurrence,
    conflicts,
    unclassified,
    trimmedGenerations,
    stats: {
      occurrences: total,
      identities: identities.size,
      identical,
      trimmed,
      unclassified: unclassified.length,
      conflicts: conflicts.length,
      unkeyed: unkeyed.length,
    },
  };
}

/**
 * Where each turn's opener stands relative to one projected view.
 *
 * A turn has an entry here whenever the WHOLE lineage has an opener for it, and `row` is that
 * opener only when this view actually contains it. The two facts are kept apart on purpose: a
 * generation slice that does not hold the opener still has to classify the prompt it does show
 * as a steer, and still has to call the turn a prompted turn — it just has no opener row to point
 * at. Collapsing them into "the opener is this row, else there is no opener" is what let a real
 * steer become the first visible prompt of its own turn.
 *
 * @param {ReturnType<typeof buildMessageIdentity>} identity
 * @param {Array<{ row: any, generation: number|null, locator: any }>} occurrences the projected rows
 * @returns {Map<string, { row: any | null }>} turn id -> its lineage opener, row null when out of view
 */
export function openerRowsForView(identity, occurrences) {
  // Compared by the ROW, not by the occurrence wrapper. `buildMessageIdentity` wraps every
  // occurrence in a fresh object of its own, so a caller's own array never contains the same
  // wrapper the identity table holds — comparing wrappers made every turn look like its opener was
  // missing, and every prompt in it a steer. Each stored copy is a distinct row object, so the row
  // is the thing that actually says "this is the copy the view contains".
  const rows = new Set(occurrences.map((occurrence) => occurrence.row));
  /** @type {Map<string, { row: any | null }>} */
  const byTurn = new Map();
  for (const [turnId, occurrence] of identity.openerOccurrence) {
    byTurn.set(turnId, { row: rows.has(occurrence.row) ? occurrence.row : null });
  }
  return byTurn;
}

/**
 * How many logical messages each generation's stored context holds.
 *
 * A generation's count is the number of identities with at least one occurrence in it, plus its
 * own unkeyed rows. The counts OVERLAP and their sum is not the conversation: a message sealed
 * into generation 0 and re-recorded in generation 1 is in both, which is what a stored context
 * is. That is also why this cannot be derived from the catalog's per-file `messageCount` — that
 * counts stored rows, so a message recorded twice in one file, and one written three times across
 * a lineage, are both invisible to it.
 *
 * @param {ReturnType<typeof buildMessageIdentity>} identity
 * @returns {Map<number, number>}
 */
export function logicalCountByGeneration(identity) {
  /** @type {Map<number, number>} */
  const counts = new Map();
  const bump = (generation) => {
    if (generation === null || generation === undefined) return;
    counts.set(generation, (counts.get(generation) ?? 0) + 1);
  };
  for (const entry of identity.identities.values()) {
    // One tick per generation the message appears in, however many copies that generation holds
    // of it — a sealed snapshot and the active file can both store the same version.
    const generations = new Set();
    for (const version of entry.versions) {
      for (const occurrence of version.occurrences) generations.add(occurrence.generation);
    }
    for (const generation of generations) bump(generation);
  }
  for (const occurrence of identity.unkeyed) bump(occurrence.generation);
  return counts;
}

/**
 * The rows one request should project, given the identity table and the generation it asked for.
 *
 * `null` generation is the whole lineage: every logical message appears once, at its first
 * version, because the reader wants the original. A generation number is that generation's own
 * stored context: every message that appears in it, at ITS version, including the trimmed
 * placeholder. Those are different views of one message, not different messages — a generation can
 * therefore hold a message the whole-lineage view already counted, which is why the generation
 * counts are overlapping sets and their sum need not equal the lineage total.
 *
 * @param {ReturnType<typeof buildMessageIdentity>} identity
 * @param {number|null} generation `null` for the whole lineage
 * @returns {{ rows: Array<any>, occurrences: Array<{ row: any, generation: number|null, locator: any }>, versionOf: Map<string, number>, openerByTurn: Map<string, { row: any | null }> }}
 */
export function selectIdentityView(identity, generation) {
  const occurrences = [];
  /** logical id -> index into `versions` of the one being shown */
  const versionOf = new Map();
  for (const entry of identity.identities.values()) {
    if (generation === null) {
      const first = entry.versions[0];
      occurrences.push(first.occurrences[0]);
      versionOf.set(entry.id, 0);
      continue;
    }
    // A generation view is that generation's own stored context: pick the version that file
    // actually holds, and among its occurrences the one from that file — the rows of one version
    // differ only in `history_artifact`, which is provenance about the generation.
    let picked = null;
    let pickedIndex = -1;
    for (let v = 0; v < entry.versions.length && picked === null; v += 1) {
      const version = entry.versions[v];
      const hit = version.occurrences.find((o) => o.generation === generation);
      if (hit !== undefined) { picked = hit; pickedIndex = v; }
    }
    if (picked === null) continue;
    occurrences.push(picked);
    versionOf.set(entry.id, pickedIndex);
  }
  // Rows with no usable id were never merged, so they pass through filtered like anything else.
  for (const occ of identity.unkeyed) {
    if (generation === null || (occ.generation ?? null) === generation) occurrences.push(occ);
  }
  return {
    rows: occurrences.map((o) => o.row),
    occurrences,
    versionOf,
    openerByTurn: openerRowsForView(identity, occurrences),
  };
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
  // The identity table the route already built over the whole lineage, so that a turn's opener is
  // known even when the opener's own row falls outside the generation being projected. A caller
  // that only holds a slice derives one from the rows it was given — the same function, so
  // "how many messages is this" has one definition rather than one per caller.
  const sliceOccurrences = input.identity
    ? null
    : rows.map((row) => ({
      row,
      generation: typeof row[ROW_GENERATION] === 'number' ? row[ROW_GENERATION] : null,
      locator: null,
    }));
  const identity = input.identity ?? buildMessageIdentity(sliceOccurrences);
  const openerByTurn = input.openerByTurn ?? openerRowsForView(identity, sliceOccurrences);
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

    /**
     * Where this record sits among the records its own source row produced.
     *
     * A message can expand into several records — an assistant turn yields its text, each of its
     * thinking blocks and each of its tool calls — and `/api/trajectory/record` re-projects that one
     * row to answer for one record. Without a position it would have to guess which of the row's
     * records was meant, and a guess that picks the wrong thinking block shows the reader another
     * block's reasoning as if it were this one.
     */
    let rowPos = 0;

    /** @param {Partial<Record<string, any>> & { kind: string, title: string, summary: string }} patch */
    const push = (patch) => {
      const record = {
        ...base,
        index: records.length + 1,
        relativeMs: timestamp === null || startedAt === null ? null : timestamp - startedAt,
        // Four presence flags, measured here and nowhere else. The values themselves stay on the
        // record — the search reads them in this process — and `slimPayloadForWire()` is what stops
        // them crossing to the page. Deciding it anywhere else would give the page a second answer
        // to 「这条记录有没有正文」, and the two would disagree exactly the way they did before.
        hasText: !isNilField(patch.text),
        hasThinking: !isNilField(patch.thinking),
        // Not `!isNilField(...)`: the page's own test for the 参数 tab is `!== null && !== undefined`,
        // and an empty string is a present argument to it. Matching it here keeps the tab from
        // appearing and disappearing when the payload changes shape.
        hasArguments: patch.arguments !== null && patch.arguments !== undefined,
        hasResult: !isNilField(patch.result),
        rowPos: rowPos++,
        tokensBefore: null,
        producedBy: null,
        parentGeneration: null,
        parentCompactionId: null,
        parentRevision: null,
        ...patch,
      };
      // The row summary the page used to assemble itself: `summary || text || toolName || title`.
      // Measured over this machine's store, the `text` step never decided anything — `singleLine`
      // had already reduced that text to nothing — and the `toolName`/`title` step decided it for
      // 5 of 1287 records, all `system`. So the chain is folded here, once, and the page reads one
      // field. It is a fold and not a replacement: a record that already has a summary keeps it.
      if (!record.summary) record.summary = record.toolName || record.title || '';
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
        // Nothing in the session file marks this, so it is decided from the lineage: the turn's
        // opener is its earliest prompt across every generation, and this row is a steer exactly
        // when it is not that row. Deciding it from the projected slice instead is what let a real
        // steer become the first visible prompt of its own turn whenever the opener's generation
        // was filtered away — and it counted as a new turn rather than as a redirect.
        //
        // The older fallback, kept for a turn the lineage says nothing about: position within the
        // records seen so far. A steer is byte-identical to a typed prompt in role, stopReason,
        // api, model, provider, tokens, producedBy, turnId and everything else; only id, timestamp
        // and index differ, so position was the only signal available before the lineage was read.
        const opener = openerByTurn.get(turnKey);
        const steered = opener === undefined
          ? turn.records.some((r) => r.kind === 'user')
          : opener.row !== row;
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
    // A turn somebody opened, and whether this view can show the row that opened it. The two are
    // separate because a generation slice routinely holds a turn's steer without holding its
    // opener: reading "no opener row" as "no opener" is what filed that turn as 其他 and lost it
    // from the 对话 count while the reader was looking at a prompted turn.
    const opener = turn.id === null ? undefined : openerByTurn.get(turn.id);
    turn.openerInView = opener !== undefined && opener.row !== null;
    turn.openerOutOfView = opener !== undefined && opener.row === null;
    turn.askedReader = askedReader;
    turn.closed = closed;
    // A turn that *contains* a checkpoint is still judged on what it did. A checkpoint used to be
    // a turn of its own, so "contains one" was the same as "is one"; now that the checkpoint
    // rejoins the turn it interrupted, that would relabel every turn the runtime ever compacted
    // as a checkpoint and drop all of them out of the prompted count. Only a turn that holds
    // nothing but its checkpoint is one.
    // `hasPrompt` already covers the opener being in view — a prompt row in the records is what sets
    // it — so only the out-of-view case adds anything here.
    if (hasPrompt || turn.openerOutOfView) {
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
  const logicalPerGeneration = logicalCountByGeneration(identity);
  // A copy per entry rather than the caller's objects: the count is ours to attach, and the
  // catalog entries are read by other callers.
  const generations = (Array.isArray(input.generations) ? input.generations : [])
    .filter((entry) => !orphanFiles.has(entry.fileName))
    .map((entry) => ({ ...entry, logicalMessageCount: logicalPerGeneration.get(entry.generation) ?? 0 }));
  // `messages` counts what is on screen. `messagesAll` counts the conversation: one entry per
  // LOGICAL message over the whole reachable lineage, so a message the store wrote into two
  // generations is one message and a message the runtime trimmed into a new content version is
  // still one message. It is therefore not a function of the generation the reader picked, which
  // is the whole reason it exists — the previous definition summed the per-file counts the
  // catalog recorded, so it counted the stored copies rather than the conversation, and a forked
  // snapshot the lineage walk had already rejected still reached the total.
  //
  // `messageRowsAll` is the physical counterpart, kept because the two answer different questions
  // and only one of them is "how many messages did this conversation have".
  const messagesAll = identity.stats.identities + identity.stats.unkeyed;
  const messageRowsAll = identity.stats.occurrences + identity.stats.unkeyed;

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
    stats: { ...stats, messagesAll, messageRowsAll },
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
      // The turn's opener over the whole lineage: whether this view holds the row that opened it,
      // and whether the lineage says the turn was opened at all while the row is somewhere else.
      // `openerOutOfView` is why a `steer` record can be the only prompt a turn shows and the turn
      // is still 对话 rather than 其他.
      openerInView: turn.openerInView === true,
      openerOutOfView: turn.openerOutOfView === true,
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
 * The material a `/api/sessions` validator is derived from.
 *
 * The soundness of a 304 is not "this covers every input that could change the payload" — it is
 * "this is built from the same values the payload is built from, in the same request". So the
 * function takes the two things the payload is built from and nothing else, and the route builds
 * both from one call: a tag derived from anything else is a tag about a different payload.
 *
 * `visible` contributes `dir|sizeBytes|lastActiveAt` — exactly what `describeSession` keys its
 * descriptor cache on, so a matching tag means the descriptors this request would produce are the
 * ones behind the tag the caller already holds. `titles` contributes the renamed-session case,
 * which no file stat can see. `limit` is in it because `?limit=10` and `?limit=20` are different
 * payloads and must not satisfy one another.
 *
 * What it does not claim: a session whose `manifest.json` appears after the walk listed it would
 * change `startedAt` without changing anything here. That is already invisible for up to
 * SESSION_CACHE_TTL_MS to the descriptor cache this reuses, so the bound is that cache's and not
 * a new one. tests/verify-list-cache.mjs pins the TTL relationship that says so.
 *
 * @param {ReadonlyArray<{ dir: string, sizeBytes: number, lastActiveAt: number }>} visible
 * @param {Map<string, { title: string | null, kind: string | null }>} titles
 * @param {number} limit
 * @returns {string}
 */
export function sessionsValidator(visible, titles, limit) {
  const parts = ['limit=' + limit];
  for (const entry of visible) {
    const meta = titles.get(decodeSessionIdFromDirName(basename(entry.dir)));
    // A NUL between the fields, so a rename cannot be masked by the stat beside it: with a plain
    // separator, {"ab",""} and {"a","b"} concatenate to the same string and the tag does not move.
    parts.push(entry.dir + "|" + entry.sizeBytes + "|" + entry.lastActiveAt
      + "|" + (meta ? String(meta.title ?? "") : "")
      + "\u0000" + (meta ? String(meta.kind ?? "") : ""));
  }
  return parts.join("\n");
}

/**
 * The part of a cache key that says WHAT is being asked, as opposed to which version of it.
 *
 * Everything after this — lineage, size, mtime, catalog bytes, binding — decides whether the answer
 * went stale. Everything in it decides what the answer is. A newer version of one family must
 * replace its predecessor; two families are two different questions and must not evict each other.
 * Exported because `trajectoryCacheKey` builds the same prefix, and two copies of that expression
 * would be free to drift.
 *
 * @param {string} dir
 * @param {number | null | undefined} filter
 * @returns {string}
 */
export function trajectoryCacheFamily(dir, filter) {
  const gen = filter === null || filter === undefined ? 'all' : String(filter);
  return `${dir}|gen=${gen}|`;
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
  return `${trajectoryCacheFamily(entry.dir, filter)}${lineage}|${entry.sizeBytes}|${entry.lastActiveAt}|${identity.catalogBytes ?? ''}|${bind}`;
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
  // Which record the cursor is pointing AT, so the page can tell whether the numbering it is
  // holding is still the numbering this tail was cut from.
  //
  // The cursor is `record.index`, and the identity layer can renumber a payload that is otherwise
  // untouched: a message arriving that is a newer version of an earlier one suppresses that
  // earlier copy, and every record after it shifts down by one. A tail cut at the old number then
  // lands in the middle of the wrong turn, with no error anywhere — which is why the delta says
  // what it assumed rather than leaving the page to guess.
  //
  // `null` for index 0 and for a cursor that names no record, which is the same thing the page
  // treats as 「there is nothing before here to have moved」.
  let basedOn = null;
  for (const turn of turns) {
    const all = turn && Array.isArray(turn.records) ? turn.records : [];
    for (const record of all) {
      if (record && record.index === since) {
        basedOn = { index: since, id: record.id === undefined ? null : record.id };
      }
    }
  }
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
    delta: { since, upTo, records, basedOn },
  };
}

/**
 * One generation file, parsed once.
 *
 * `locators` is parallel to `rows` and is what makes releasing `rows` safe: each entry says which
 * file the line came from, where in it, and what it hashed to, which is everything `/raw` needs to
 * fetch that one line again.
 *
 * @typedef {{ filePath: string, start: number, end: number, digest: string }} LineLocator
 * @typedef {{ rows: Array<Record<string, any>>, locators: Array<LineLocator>, skipped: number, size: number, read: number, empty: boolean, truncated: boolean }} ParsedRows
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
 * LRU over rendered trajectory bodies, bounded by entries.
 *
 * The bound alone is not enough. `trajectoryCacheKey` carries the active file's size and mtime, so
 * a session that is still being written to mints a NEW key every time it grows — and every miss
 * stores another complete body. A plain FIFO therefore keeps four versions of the SAME question
 * alive, three of which no request can reach any more: `/raw` resolves the current key, and the
 * page's next poll produces a newer one. Measured on a 9.1 MB session polled every 8s, the cache
 * held four bodies (49.6 MB) after four polls; at this machine's 68 MB body that is three dead
 * copies.
 *
 * So an entry carries the family it answers for — the session directory plus the requested slice —
 * and storing a new one drops its predecessor. Everything that changes the ANSWER stays in the
 * key; everything that only marks it stale stays in the family.
 *
 * Different `?generation=` slices are different families and each keeps its own entry, bounded by
 * `limit` as before.
 *
 * @param {number} limit
 */
export function createTrajectoryCache(limit) {
  /** @type {Map<string, { at: number, family: string, value: any }>} */
  const entries = new Map();
  return {
    get size() { return entries.size; },
    /**
     * @param {string} key
     * @returns {any | null}
     */
    get(key) {
      const hit = entries.get(key);
      if (hit === undefined) return null;
      // Re-reading is the only signal that an entry is still hot, so it refreshes recency.
      entries.delete(key);
      entries.set(key, hit);
      return hit.value;
    },
    /**
     * @param {string} key
     * @param {string} family the (session, slice) this answers for; a newer version of the same
     *   family replaces the older one instead of stacking beside it
     * @param {any} value
     */
    set(key, family, value) {
      const previous = entries.get(key);
      if (previous !== undefined) entries.delete(key);
      entries.set(key, { at: Date.now(), family, value });
      for (const [existingKey, existing] of entries) {
        if (existingKey !== key && existing.family === family) entries.delete(existingKey);
      }
      while (entries.size > limit) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
    },
    clear() {
      entries.clear();
    },
  };
}

/**
 * One generation file, parsed once, from the cache when the caller says the file can be reused.
 *
 * `cacheable` is the whole of what step 2 changed, and it is not a tuning knob: a cache entry
 * keyed on path+size+mtime for a file that grows between polls cannot be hit, because the caller
 * only gets here after a key carrying that same size and mtime already missed. The active file is
 * therefore parsed every time and retained never, and `/raw` finds its lines from the locators
 * instead. Sealed generations still go in, because for those the stat really is constant.
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
 * @param {{ cacheable?: boolean }} [options]
 * @returns {Promise<ParsedRows>}
 */
export async function loadParsedRows(cache, filePath, limit, options) {
  const cacheable = options === undefined || options.cacheable !== false;
  // Stat for the key rather than trusting the catalog, for the same reason the read limit is
  // not taken from it: the active file grows past its recorded size between polls. If the file
  // changes between this stat and readHead the entry ends up keyed on a size it does not
  // match, and the next poll — which stats again — misses and re-reads. The race can only cost
  // a redundant read; it can never serve a stale parse, because a different size is a
  // different key.
  const current = await stat(filePath);
  const key = parsedRowsKey(filePath, current.size, current.mtimeMs, limit);
  if (cacheable) {
    const hit = cache.get(key);
    if (hit !== null) return hit;
  }

  const head = await readHead(filePath, limit);
  const parsed = parseMessagesJsonl(head.buffer);
  // Built complete rather than completed by the caller: one locator per row is 36,527 objects on a
  // session this size, and spreading each of them into a second object to add a field the parse
  // already had in hand cost more than the digests do.
  const locators = parsed.spans.map(([start, end]) => ({
    filePath,
    start,
    end,
    digest: lineDigest(head.buffer.subarray(start, end)),
  }));
  const value = {
    rows: parsed.rows,
    locators,
    skipped: parsed.skipped,
    size: head.size,
    read: head.read,
    empty: head.buffer.length === 0,
    // Truncated means our cap cut the read, nothing else.
    truncated: truncatedByCap(head.size, limit),
  };
  if (cacheable) cache.set(key, value, Math.ceil(head.size * PARSED_ROWS_HEAP_PER_SOURCE_BYTE));
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
  /** @type {{ at: number, candidates: Awaited<ReturnType<typeof collectSessionCandidates>> | null }} */
  let listCache = { at: 0, candidates: null };
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
   * @type {ReturnType<typeof createTrajectoryCache>}
   */
  const trajectoryCache = createTrajectoryCache(TRAJECTORY_CACHE_ENTRIES);
  /**
   * Parsed generation rows, keyed by path+size+mtime+limit, and now holding sealed generations
   * only — `loadParsedRows` is called with `cacheable: false` for the file being appended to.
   * Beside trajectoryCache, not inside it: a whole-session hit still short-circuits before this is
   * touched at all, so the two caches never answer for each other.
   * Pinned by tests/verify-parsed-rows.mjs.
   */
  const parsedRows = createParsedRowsCache(PARSED_ROWS_CACHE_BYTES);

  // Derived artifacts, under the runtime's own data dir and nowhere else. The session history is
  // read-only input and the plugin package installs onto every reader's machine, so neither is a
  // place to write. Held per runtime instance rather than as module state, so two runtimes in one
  // process cannot share a root.
  //
  // Only the search segments live here. There was a second store under `index/`, written on every
  // publish and never read by anything; it is gone, and directories it already wrote are left
  // alone — nothing consults them, and deleting them is a migration that does not belong in the
  // same change as stopping the writes.
  const artifactRoot = join(context.dataDir, 'trajectory-artifacts');
  const segmentStore = createSegmentStore(join(artifactRoot, 'search'));

  /**
   * A name for one session's artifacts, derived rather than quoted.
   *
   * Hashed because the key becomes a DIRECTORY NAME: a session id is not something to scatter across
   * a filesystem, and two stores on one machine can hold the same id for different sessions, so the
   * store's own path has to be part of it. The two are joined by a newline CHARACTER at runtime,
   * written here as an escape rather than as the byte — a literal NUL here made this file binary to
   * every text tool reading it, and the guard that says so is the one that caught it.
   *
   * @param {string} dir
   * @param {string} sessionId
   */
  const searchSessionKey = (dir, sessionId) =>
    createHash('sha256').update(`${dir}\n${sessionId}`).digest('hex').slice(0, 32);

  /**
   * @param {number | null} filter
   */
  const searchViewKey = (filter) => (filter === null || filter === undefined ? 'all' : `g${filter}`);

  const loadClientEntry = async () => {
    if (clientEntry) return clientEntry;
    const buffer = await readFile(join(context.pluginRoot, 'miniapp', 'client', 'index.html'));
    clientEntry = buffer;
    return buffer;
  };

  const listEntries = async () => {
    const now = Date.now();
    if (listCache.candidates && now - listCache.at < LIST_CACHE_TTL_MS) return listCache.candidates;
    const candidates = await collectSessionCandidates(location.sessionsRoot);
    listCache = { at: now, candidates };
    return candidates;
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
  /**
   * The last list body, kept under the tag it was built for. One entry, not a cache: the tag is
   * recomputed per request and a mismatch simply means the list moved, which is the common case
   * while the reader is working. Its job is the page that arrives with no validator — first load
   * or a fresh tab — so the descriptors behind the previous answer can be reused instead of read.
   * @type {{ material: string, body: string | null }}
   */
  let sessionsBody = { material: '', body: null };
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

  const handleSessions = async (response, url) => {
    const limit = normalizeLimit(url.searchParams.get('limit'), 20, 1, 50);
    let entries;
    try {
      // The picker still sees only the most recent sessions. The id index beside it is what
      // `handleTrajectory` resolves explicit ids against, and it is deliberately not what the
      // picker is built from — widening the list is a separate decision about the UI.
      entries = (await listEntries()).recentEntries;
    } catch (error) {
      context.logger.error('miniapp.trajectory.read_error', { reason: 'root_unreadable', code: errorCode(error) });
      sendError(response, 503, 'trajectory_unavailable', '未找到本地会话数据目录');
      return;
    }
    if (entries.length === 0) {
      sendError(response, 503, 'trajectory_unavailable', '未找到本地会话数据目录');
      return;
    }
    const visible = entries.slice(0, limit);
    // Real titles from the runtime database; sub-agent and cron sessions get a kind badge so
    // the picker never presents them as if they were the user's conversation.
    const titles = await sessionTitles(
      visible.map((entry) => decodeSessionIdFromDirName(basename(entry.dir))).filter(Boolean),
    );

    // Built from the same two values the payload below is built from, and computed before any
    // descriptor work — which is what lets an unchanged list answer without building it.
    const etag = weakETag(sessionsValidator(visible, titles, limit));
    const requestEtag = response.req && response.req.headers ? response.req.headers['if-none-match'] : null;
    if (etagMatches(requestEtag, etag)) {
      sendJsonBody(response, 304, '', { etag, revalidate: true });
      return;
    }

    // Same shape as the trajectory route's cache-hit branch: a page that arrives without a
    // validator — first load, a fresh tab — still gets bytes it does not have to cause a rebuild
    // to produce.
    let body = sessionsBody.material === etag ? sessionsBody.body : null;
    if (body === null) {
      const described = [];
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
      body = JSON.stringify({ sessions: described.map(stripInternalFields) });
      sessionsBody = { material: etag, body };
    }
    sendJsonBody(response, 200, body, { etag, revalidate: true });
  };

  /**
   * Which session a trajectory request is about, plus everything that decides whether it
   * has changed. The bulk payload and the per-record raw fetch both go through here, so
   * the same query string can never be read as two different sessions.
   *
   * @param {URL} url
   */
  const resolveTrajectoryRequest = async (url) => {
    let candidates;
    try {
      candidates = await listEntries();
    } catch (error) {
      context.logger.error('miniapp.trajectory.read_error', { reason: 'root_unreadable', code: errorCode(error) });
      return { ok: false, status: 503, code: 'trajectory_unavailable', message: '未找到本地会话数据目录' };
    }
    const entries = candidates.recentEntries;
    if (entries.length === 0 && candidates.byDecodedId.size === 0) {
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
      // Two ways in, and the order matters.
      //
      // Fast path: the id was decoded from a directory name during the walk, so the directory is
      // already known and no scanning is needed. This is what makes a session outside the recent
      // 30 reachable at all — before this, the only directories this branch could see were the 30
      // the picker shows, so 116 of 146 sessions on this machine answered 404 to their own id.
      //
      // The decoded name is still only a claim. `readSessionIdentity` prefers `manifest.sessionId`,
      // so a directory whose name disagrees with its manifest must not be served under the
      // requested id; it falls through to the slow path instead, which re-checks every candidate.
      const fastPath = candidates.byDecodedId.get(requested);
      let picked = null;
      if (fastPath) {
        // Duplicates are kept as a list rather than collapsed, because collapsing them with
        // `Map.set` would make the answer depend on `readdir` order. Here the manifests decide.
        const verified = [];
        for (const candidate of fastPath) {
          const candidateIdentity = await readSessionIdentity(candidate.dir);
          if (candidateIdentity.id === requested) verified.push({ entry: candidate, identity: candidateIdentity });
        }
        if (verified.length === 1) picked = verified[0];
        else if (verified.length > 1) {
          // Two directories both claim this id. Rather than pick one by directory order, fall
          // through to the slow path, which keeps the original scan-and-compare behaviour.
          context.logger.warn('miniapp.trajectory.read_error', { reason: 'ambiguous_session_id', code: requested });
        }
      }

      if (!picked) {
        const matched = [];
        for (const candidate of entries) {
          const candidateIdentity = await readSessionIdentity(candidate.dir);
          if (candidateIdentity.id === requested || basename(candidate.dir) === requested) {
            matched.push({ entry: candidate, identity: candidateIdentity });
            break;
          }
        }
        if (matched.length === 0) {
          // The scan budget stopped the walk before this id could be seen. That is not the same
          // answer as "no such session", and reporting it as one is how 400 became a correctness
          // boundary instead of a resource guard.
          if (candidates.truncated) {
            return {
              ok: false, status: 404, code: 'session_scan_budget_exhausted',
              message: '会话数量超出本次扫描预算，请重试或缩小会话目录范围',
            };
          }
          return { ok: false, status: 404, code: 'session_not_found', message: '找不到该会话' };
        }
        entry = matched[0].entry;
      } else {
        entry = picked.entry;
      }
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

  /**
   * One session's lineage, and every stored row of every generation that belongs to it.
   *
   * The ONE place the lineage is walked. Two readers need it and they must not be allowed to walk it
   * separately: the payload answers from the whole chain, and a search answers from the same chain
   * with the active generation read fresh. A second walk would be a second answer to "which files
   * are this session made of", and the two could disagree about a generation that rotated between
   * two requests.
   *
   * `files` is the same chain as a table the index and the search segments address: one entry per
   * generation, carrying the identity that decides whether a stored artifact may be reused. It holds
   * the resolved path so a record can be matched to its file exactly; the index strips it before
   * anything is written.
   *
   * Throws rather than answering: an unreadable lineage is reported by the caller, which is the only
   * place that knows how to phrase it.
   *
   * @param {{ dir: string }} entry
   * @param {Array<any>} generations
   */
  const collectLineage = async (entry, generations) => {
    const artifactByFile = new Map(generations.map((candidate) => [candidate.fileName, candidate]));
    // history-catalog.json is written by the runtime when it rotates generations, so a session
    // that has never compacted does not have one and its `generations` list is empty. The active
    // file is real regardless, and `probe` below already synthesises an artifact for it; reuse
    // that same shape here instead of rejecting the whole session with artifact_path_rejected.
    const artifactFor = (fileName) => artifactByFile.get(fileName)
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
        ? { fileName: 'messages.jsonl', active: true, byteLength: null }
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

    const lineage = await walkLineage({ generations }, probe);
    if (lineage.chain.length === 0) throw new Error('lineage_empty');
    const activeFileName = lineage.chain[lineage.chain.length - 1].fileName;

    /** @type {Array<{ row: Record<string, any>, generation: number | null, locator: any }>} */
    const occurrences = [];
    /** @type {Array<any>} */
    const files = [];
    let skippedTotal = 0;
    let truncated = false;
    let readBytes = 0;
    for (const link of lineage.chain) {
      const artifact = artifactFor(link.fileName);
      const filePath = artifact === null ? null : resolveArtifactPath(entry.dir, artifact);
      if (filePath === null) throw new Error('artifact_path_rejected');
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
        parsedFile = await loadParsedRows(parsedRows, filePath, limit, { cacheable: link.fileName !== activeFileName });
      } catch {
        throw new Error('messages_unreadable');
      }
      // Kept as a flag on the cached value rather than a log line at the read site: a file that
      // parsed empty once will parse empty every time, and a hit must still say so.
      if (parsedFile.empty) {
        context.logger.warn('miniapp.trajectory.read_error', { reason: 'empty_messages' });
      }
      if (parsedFile.truncated) truncated = true;
      readBytes += parsedFile.read;
      skippedTotal += parsedFile.skipped;
      // The identity a stored index or search segment is reused under. Read before the rows so a
      // file that cannot be stat()ed is a missing entry rather than a wrong one — a file that
      // cannot be stat()ed was not read either.
      let size = 0;
      let mtimeMs = 0;
      try {
        const fileStat = await stat(filePath);
        size = fileStat.size;
        mtimeMs = fileStat.mtimeMs;
      } catch {
        throw new Error('messages_unreadable');
      }
      files.push({
        fileName: link.fileName,
        generation: link.generation,
        size,
        mtimeMs,
        revision: typeof artifact.revision === 'string' ? artifact.revision : null,
        // Per generation, not only summed into the session-level flag: an artifact built from this
        // generation has to be able to tell that it covers a prefix of the file rather than all of
        // it, and the only place that fact exists is here.
        truncated: parsedFile.truncated === true,
        filePath,
      });
      // A sealed file's rows are shared with every other request that read it; the active file's
      // are this request's alone and are released below. Either way stamping the generation is the
      // only write, and one filePath always maps to one generation, so it is idempotent.
      // Pinned by tests/verify-parsed-rows.mjs.
      for (let index = 0; index < parsedFile.rows.length; index += 1) {
        const row = parsedFile.rows[index];
        row[ROW_GENERATION] = link.generation;
        // One entry per row, holding where that row's line was read from and what it hashed to —
        // enough for `/raw` to go back to one line without any of the parsed rows still being
        // alive, which is what lets the rows be released once the payload is serialized.
        occurrences.push({ row, generation: link.generation, locator: parsedFile.locators[index] });
      }
    }
    return {
      lineage,
      occurrences,
      files,
      skippedTotal,
      truncated,
      readBytes,
      activeFileName,
      activeArtifact: artifactFor(activeFileName),
      artifactFor,
    };
  };

  /**
   * Why a lineage could not be collected. Named here so the caller reports the same reason the
   * walk used to, from one table instead of two blocks of inline sends.
   * @param {unknown} error
   */
  const lineageFailure = (error) => {
    const reason = error instanceof Error ? error.message : String(error);
    if (reason === 'lineage_unreadable') {
      context.logger.error('miniapp.trajectory.read_error', { reason: 'lineage_unreadable' });
      return '会话数据暂时无法读取';
    }
    if (reason === 'artifact_path_rejected') {
      context.logger.error('miniapp.trajectory.read_error', { reason: 'artifact_path_rejected', code: errorCode(null) });
      return '会话数据暂时无法读取';
    }
    if (reason === 'messages_unreadable') {
      context.logger.error('miniapp.trajectory.read_error', { reason: 'messages_unreadable', code: errorCode(error) });
      return '会话数据暂时无法读取';
    }
    // `lineage_empty` and anything unforeseen both land here, and both are the same answer to the
    // reader: there is nothing to show. The reason is kept for the log, never for the page.
    context.logger.error('miniapp.trajectory.read_error', { reason: `lineage_${reason}` });
    return '会话数据暂时无法读取';
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
      // this cache deliberately does not: it holds the serialized bytes and the locators
      // /raw needs, not the object graph the bytes came from.
      sendJsonBody(response, 200, cached.body, { etag, revalidate: true });
      return;
    }

    // The lineage is walked in ONE place (`collectLineage`), because two readers need it and a
    // second walk would be a second answer to "which files is this session made of".
    let walked;
    try {
      walked = await collectLineage(entry, generations);
    } catch (error) {
      sendError(response, 500, 'trajectory_unreadable', lineageFailure(error));
      return;
    }
    const { lineage, occurrences, files, truncated, readBytes, activeFileName, activeArtifact } = walked;
    if (walked.skippedTotal > 0) {
      context.logger.warn('miniapp.trajectory.parse_warn', { skipped: walked.skippedTotal });
    }
    // One logical message per id, every stored copy of it folded in, and the versions it was
    // written in kept rather than dropped. `filter === null` shows every message once at its
    // first version; a generation number shows that generation's own stored context.
    const identityTable = buildMessageIdentity(occurrences);
    const view = selectIdentityView(identityTable, filter);
    const rows = view.rows;
    const rowLocators = view.occurrences.map((occurrence) => occurrence.locator);
    if (identityTable.conflicts.length > 0) {
      context.logger.warn('miniapp.trajectory.parse_warn', { identity_conflicts: identityTable.conflicts.length });
    }
    if (identityTable.stats.unclassified > 0) {
      context.logger.warn('miniapp.trajectory.parse_warn', { identity_unclassified: identityTable.stats.unclassified });
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
      identity: identityTable,
      openerByTurn: view.openerByTurn,
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
    // The record -> locator map. Locators, not row references: the parsed rows behind them are
    // about to stop existing, and this entry is what has to outlive them for `/raw` to still work.
    // `rowPos` says which of that row's records this index is, which is what lets
    // `/api/trajectory/record` project one line and answer for one record out of it.
    /** @type {Map<number, number>} */
    const rowPosByRecord = new Map();
    const rowIndexByRecord = splitRawRecords(payload.turns, rowPosByRecord);
    /** @type {Map<number, LineLocator>} */
    const raws = new Map();
    for (const [recordIndex, rowIndex] of rowIndexByRecord) {
      const locator = rowLocators[rowIndex];
      if (locator !== undefined) raws.set(recordIndex, locator);
    }

    // Last thing before serializing, and the only place the bulk fields are ever taken off a
    // record. It happens here rather than at `push()` because the search, which runs in this
    // process and never serialises, still reads those fields off the projected records — so
    // removing them at the projection would have broken search to save the page memory. The delta
    // below is built from the same payload, so it is slim too: a poll carries no more bulk than
    // the first load did.
    slimPayloadForWire(payload);

    let body;
    try {
      body = JSON.stringify(payload);
    } catch {
      sendJson(response, 500, { error: 'trajectory_unserializable', message: '会话数据暂时无法读取' });
      return;
    }
    // The family is the session plus the requested slice: the parts of the answer that stay the
    // same while it goes stale. Everything that decides whether the answer changed stays in the
    // key, so a newer version of one family replaces its predecessor instead of stacking beside it.
    // `decoded` is filled in by /raw, at most RAW_DECODE_CACHE_ENTRIES lines' worth.
    trajectoryCache.set(cacheKey, trajectoryCacheFamily(entry.dir, filter), { at: Date.now(), etag, body, raws, rowPos: rowPosByRecord, decoded: new Map() });
    // Nothing below reads `rows` or `rowLocators`, and `payload` holds its own projections rather
    // than the rows, so this is where the object graph stops being reachable. A sealed generation's
    // rows are still held by the parsed-rows cache — that is the point of that cache — but the
    // active file's are now only held by this array.
    rows.length = 0;
    rowLocators.length = 0;
    // `?since=` asks for the tail. The whole body is serialized either way — the cache
    // entry and /raw both need it — so this saves the transfer and the page's JSON.parse,
    // and not the server's work. Any reading of "41 MB → a few KB, so polling got faster"
    // has to carry that with it. Pinned by tests/verify-incremental.mjs.
    const since = parseSince(url.searchParams.get('since'));
    const delta = since === null ? null : buildDeltaPayload(payload, since);
    sendJsonBody(response, 200, delta === null ? body : JSON.stringify(delta), { etag, revalidate: true });
  };

/**
 * One needle against one session, answered from the same projection the payload is built from.
   *
   * WHY IT IS A READ AND NOT A SCAN OF WHAT THE PAGE ALREADY HAS. The page searches five fields per
   * record, and those five fields are the bulk of the payload — so a search the page can do itself
   * requires the page to hold the bulk, which is the thing being removed. A search that is answered
   * here does not have to be shipped to it.
   *
   * WHY IT REBUILDS FOR NOW. This walks the lineage and projects it exactly as `/api/trajectory`
   * does, so the records it searches are the records that payload would carry — which is what makes
   * a hit a row the reader can actually be sent to. Segments are written as a side effect here, so a
   * later pass can answer a search without the rebuild; until then this is the correct answer and
   * the measured cost of one.
   *
   * The two rules that are not negotiable, because both were true of the version it replaces:
   *
   *  - **A hit is a DISPLAYED record.** The scan runs over the projected view, not over the stored
   *    rows, so a version the identity layer suppressed — a copy of a message already shown, or the
   *    trimmed half of a rewrite — cannot be reported as a row in the ledger.
   *  - **A needle never crosses a record.** Each record is tested on its own, which is what
   *    `scanSegment` is for and what a joined blob would quietly stop doing.
   */
  const handleSearch = async (response, url) => {
    const ctx = await resolveTrajectoryRequest(url);
    if (!ctx.ok) {
      sendError(response, ctx.status, ctx.code, ctx.message);
      return;
    }
    const asked = url.searchParams.get('q') ?? '';
    // A needle too short to be a question matches almost every record; answering with the whole
    // ledger is not an answer, and returning it would cost more than the reader wanted to know.
    if (!needleIsUsable(asked)) {
      sendError(response, 400, 'search_query_required', '请输入至少两个字符');
      return;
    }
    const needle = foldNeedle(asked);
    const { entry, filter } = ctx;

    let walked;
    try {
      walked = await collectLineage(entry, ctx.generations);
    } catch (error) {
      sendError(response, 500, 'trajectory_unreadable', lineageFailure(error));
      return;
    }
    const { occurrences, files } = walked;
    const sessionKey = searchSessionKey(entry.dir, ctx.identity.id);
    const viewKey = searchViewKey(filter);

    // Before anything expensive. The lineage walk above is stat-driven and cheap; everything after
    // this line is the rebuild, and on the largest session measured here it was 3.7 seconds for a
    // search that returns at most 500 rows.
    const onDisk = await searchFromArtifacts({ sessionKey, viewKey, files, needle });
    if (onDisk !== null) {
      sendJson(response, 200, {
        query: asked,
        hits: onDisk.hits,
        total: onDisk.total,
        truncated: onDisk.total > onDisk.hits.length,
        // The same field the rebuild sends. Two paths answering the same request with two different
        // response shapes is not a faster version of the endpoint, it is a second endpoint.
        session: { id: ctx.identity.id, generation: filter },
      });
      return;
    }

    const identityTable = buildMessageIdentity(occurrences);
    const view = selectIdentityView(identityTable, filter);
    const payload = buildTrajectoryPayload({
      session: { id: ctx.identity.id, createdAtMs: entry.lastActiveAt },
      rows: view.rows,
      sizeBytes: walked.readBytes,
      truncated: walked.truncated,
      redact,
      generations: ctx.generations,
      generation: null,
      orphans: walked.lineage.orphans,
      identity: identityTable,
      openerByTurn: view.openerByTurn,
    });
    const rowLocators = view.occurrences.map((occurrence) => occurrence.locator);
    const rowIndexByRecord = splitRawRecords(payload.turns);

    /** @type {Array<{ index: number, turnIndex: number, kind: string, summary: string, generation: number | null }>} */
    const hits = [];
    let total = 0;
    const searched = collectSearchHits(payload, needle, MAX_SEARCH_HITS);
    hits.push(...searched.hits);
    total = searched.total;

    // Written as a side effect, never awaited into the answer: an artifact that cannot be written is
    // a slower next search, not a failed one, and a failure here must not turn a hit into an error.
    void publishSearchArtifacts({
      entry,
      sessionKey,
      viewKey,
      payload,
      raws: rowIndexByRecord,
      rowLocators,
      files,
      activeFileName: walked.activeFileName,
    }).catch(() => undefined);

    sendJson(response, 200, {
      query: asked,
      hits,
      total,
      truncated: total > hits.length,
      session: { id: ctx.identity.id, generation: filter },
    });
    // Nothing below reads the view, and the payload holds projections rather than rows, so this is
    // where the object graph stops being reachable.
    view.rows.length = 0;
    rowLocators.length = 0;
  };

  /**
   * Answers a search from the stored segment of each generation, or `null` when they cannot.
   *
   * `null` is the answer for every "no" here — a segment missing, unreadable, or not readable
   * back once the scan has named a line in it — and the caller rebuilds. It is deliberately not a
   * partial answer: `total` is how many records in the whole session matched, so answering from 44
   * of 45 generations would report a smaller total and the page would tell the reader the needle
   * matched fewer things than it did, with nothing anywhere saying so.
   *
   * What makes the segments trustworthy without re-deriving anything: `sameSource` checks each
   * generation's identity and whether its read was cut short, the manifest pins the schema and the
   * bytes' digest, and the identity decisions baked into them are a pure function of exactly those.
   * Same sources and same code, so the answers are the ones the rebuild would have produced —
   * which is why no second intersection against the current view is done here. That extra
   * intersection is the kind of step that silently disagrees with the thing it is checking.
   *
   * The session's record index is NOT read. Each segment line carries its own answer, so a needle
   * matching 14 records out of 36,525 reads those 14 lines rather than parsing 34.2 MB of index.
   *
   * @param {{ sessionKey: string, viewKey: string, files: Array<any>, needle: string }} input
   */
  const searchFromArtifacts = async ({ sessionKey, viewKey, files, needle }) => {
    /** @type {Array<{ index: number, turnIndex: number | null, kind: string, summary: string, generation: number | null }>} */
    const hits = [];
    let total = 0;
    // `files` is the lineage walk's own output, so a generation that is no longer in the lineage
    // has no entry here and no segment is read — a leftover on disk cannot keep it searchable.
    for (let fileIdx = 0; fileIdx < files.length; fileIdx += 1) {
      const file = files[fileIdx];
      const segment = await segmentStore.read(sessionKey, viewKey, generationKey(file.generation), [file]);
      if (segment === null) return null;
      const ordinals = scanSegment(segment.surface, needle);
      const answers = readSegmentHits(segment.surface, ordinals);
      for (const hit of answers) {
        // A line the scan named that cannot be read back is a segment written by something that
        // does not agree with this reader. Answering without it would quietly drop a record.
        if (hit === null) return null;
        total += 1;
        if (hits.length < MAX_SEARCH_HITS) hits.push(hit);
      }
    }
    // Ascending ledger order, because the segments were read oldest generation first and a hit's
    // place in that list is what the page scrolls to. Sorting by the index itself is the order the
    // rebuild produces, and two answers that differ only in order are two answers.
    hits.sort((a, b) => a.index - b.index);
    return { hits, total };
  };

  /**
   * The artifacts a search would like the NEXT search to be able to skip the rebuild for.
   *
   * Best effort by construction: every step is wrapped, and the whole thing is fire-and-forget from
   * the caller. A session that never gets an index keeps answering correctly, just at the rebuild's
   * cost — which is what it did before any of this existed.
   *
   * @param {{ entry: any, sessionKey: string, viewKey: string, payload: any, raws: Map<number, number>, rowLocators: Array<any>, files: Array<any>, activeFileName: string }} input
   */
  const publishSearchArtifacts = async (input) => {
    const { entry, sessionKey, viewKey, payload, raws, rowLocators, files, activeFileName } = input;
    /** @type {Map<number, any>} */
    const locators = new Map();
    for (const [recordIndex, rowIndex] of raws) {
      const locator = rowLocators[rowIndex];
      if (locator !== undefined) locators.set(recordIndex, locator);
    }
    const locatorRows = locatorRowsFromPayload(payload, locators, files);

    // One segment per generation, the active one included. §8.8.1 rule 5 excluded the active
    // generation on the grounds that a segment for it would be stale before it was written — true,
    // and it is still true. What changed is that nothing has to TRUST it: `sameSource` reads the
    // generation's own size, so an appended file invalidates its own segment and only its own, and
    // an artifact that cannot be trusted makes the search fall back rather than answer. Without a
    // segment for the active generation there would be nothing to scan at all on a session that is
    // still being written, which is the one case a reader is most likely to search.
    //
    // The surface comes from the PAYLOAD's records, not from a narrower copy of them. That copy
    // dropped the four bulk fields to stay small, and three of the five fields — `text`, `result`,
    // `thinking` — are searchable. A segment built from it therefore searched two of the five, which
    // narrows what a reader can find with nothing anywhere reporting it. Measured on the largest
    // session here: the needle "needle" reported 14 matches through the artifacts and 45 through
    // the rebuild, and the two answers were both plausible.
    //
    // What the payload cannot say on its own is which source file a record came from, so that is
    // what gets projected out of the lineage's row locators: the payload's fields for the surface,
    // and a locator whose file number is the grouping key below. The byte range rides along on the
    // segment line and is read by nothing here — see the note on locatorRowsFromPayload.
    const flatRecords = [];
    for (const turn of payload.turns) {
      for (const record of turn.records) flatRecords.push({ record, turn });
    }
    for (let fileIdx = 0; fileIdx < files.length; fileIdx += 1) {
      const records = [];
      for (let i = 0; i < flatRecords.length; i += 1) {
        const located = locatorRows[i];
        if (located === undefined || located.fileIdx !== fileIdx) continue;
        records.push({
          ...flatRecords[i].record,
          // The turn this record sits in travels with it: the answer names a turn, and reading it
          // back out of the session's turn table would mean reading that table on every search.
          turnIndex: flatRecords[i].turn.index,
          fileIdx: located.fileIdx,
          byteStart: located.byteStart,
          byteEnd: located.byteEnd,
        });
      }
      // A generation with no records still gets a segment, and it is an empty one. Skipping it
      // would leave the reader with nothing to find, and "nothing to find" is exactly what a
      // missing segment reports — so a session holding one empty generation would fall back to the
      // rebuild forever, for a generation that could never match anything.
      const generation = files[fileIdx].generation;
      const generationKeyValue = generationKey(generation);
      // Already there and still matching its source: nothing to do, which is the common case on a
      // session that is not being compacted right now.
      const existing = await segmentStore.read(sessionKey, viewKey, generationKeyValue, [files[fileIdx]]);
      if (existing !== null) continue;
      const segment = buildSegment({ records });
      await segmentStore.write(sessionKey, viewKey, generationKeyValue, segment, {
        generation,
        source: [files[fileIdx]],
      });
    }
    void entry;
  };

  /**
   * One record's untouched message, fetched only when something actually reads it.
   *
   * The body no longer has the parsed rows behind it, so the line is read back out of the file it
   * came from. That is a seek and a digest over one line, against the alternative of holding every
   * session's object graph in memory for the life of the page — measured at 233 MB of the 378 MB
   * this process held while one session was open.
   *
   * The digest is what makes that safe to do. Between building the body and answering this request
   * the file can be rewritten; the trajectory entry is keyed on the file's size and mtime, so a
   * rewrite that preserved both would otherwise be served the wrong message under the right
   * record's name. Answering `raw_stale` says the session moved instead.
   *
   * A missing entry means this process restarted between the two calls; saying so is more honest
   * than silently showing the normalized record in a panel labelled 原文.
   */
  /**
   * One record's four bulk fields, read on request.
   *
   * The page used to receive all four on every row of every poll — measured over this machine's
   * whole store, 59.1% of the body: `result` 26.6%, `thinking` 13.2%, `arguments` 9.3%, `text`
   * 8.9% — and used them to draw a ledger row and, when the reader opened one record, four tabs.
   * It now receives four presence flags and asks for the values when it is going to show them.
   *
   * It re-projects the ONE stored line that record came from, rather than rebuilding the session.
   * A line can expand into several records (its text, each thinking block, each tool call), so the
   * answer has to name which of them — `rowPos`, stamped at `push()` — and rebuilding the whole
   * session to return one field would cost exactly what this change exists to stop paying.
   *
   * The bytes come through the same locator `/raw` uses and carry the same digest check, so a file
   * that moved under the cache answers 「该记录所在的文件已变化」 here too, instead of projecting a
   * line that is no longer the one the page is looking at.
   */
  const handleRecord = async (response, url) => {
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
    const locator = cached.raws.get(wanted);
    const rowPos = cached.rowPos.get(wanted);
    if (locator === undefined || typeof locator.filePath !== 'string' || typeof rowPos !== 'number') {
      sendError(response, 404, 'record_not_found', '找不到该记录');
      return;
    }
    const found = await readRecordRow(locator);
    if ('error' in found) {
      context.logger.warn('miniapp.trajectory.read_error', { reason: `record_${found.reason}` });
      sendError(response, found.status, found.error, found.error === 'raw_stale'
        ? '该记录所在的文件已变化，请重新加载会话'
        : '找不到该记录');
      return;
    }
    // One row in, one row's records out. `sizeBytes` is this line's own length: the only thing the
    // projection does with it is report truncation, and a one-line view is never truncated.
    const one = buildTrajectoryPayload({
      session: { id: ctx.identity.id, createdAtMs: ctx.entry.lastActiveAt },
      rows: [found.row],
      sizeBytes: found.sizeBytes,
      truncated: false,
      redact,
      generation: null,
    });
    const record = one.turns.flatMap((turn) => turn.records ?? [])[rowPos];
    if (record === undefined) {
      // The line projected into fewer records than the payload had for it. That means the two
      // projections disagree about what this line contains, and answering with the wrong one would
      // show the reader another record's content — so it is a 404, not a best effort.
      context.logger.warn('miniapp.trajectory.read_error', { reason: 'record_position_gone', rowPos });
      sendError(response, 404, 'record_not_found', '找不到该记录');
      return;
    }
    sendJson(response, 200, {
      index: wanted,
      // No `kind`. Measured over 6568 records of this machine's store: re-projecting one row
      // returns the same four values every time, but it disagrees about `kind` for an opener —
      // a `steer` row projected alone has no earlier turn to have been interrupted by, so it
      // comes back a `user`. The page already has the record and its kind; handing back a second
      // one that is known to differ on openers is a second answer to a question it already
      // answered, and the kind is the one field a reader would act on.
      text: typeof record.text === 'string' ? record.text : null,
      thinking: typeof record.thinking === 'string' ? record.thinking : null,
      arguments: record.arguments ?? null,
      result: typeof record.result === 'string' ? record.result : null,
      textTruncated: record.textTruncated === true,
    });
  };

  /**
   * The stored line a record was projected from, or the reason there isn't one.
   *
   * ONE place, because there are two readers of it: `/api/trajectory/raw` wants the untouched
   * message and `/api/trajectory/record` wants the projected fields. The check that the bytes are
   * still the bytes that record was built from belongs to neither of them. Written twice it is two
   * answers to "is this still the right line", and the copy nobody thinks about is the one that
   * eventually stops answering — which is also how the guard stopped being able to tell the two
   * apart.
   *
   * The digest is the whole point. A file that rotated under the cache has the same path and
   * different bytes, and without this a record index would quietly resolve to whichever line now
   * sits at that offset.
   *
   * @param {{ filePath: string, start: number, end: number, digest: string }} locator
   * @returns {Promise<{ row: any, sizeBytes: number } | { error: string, status: number, reason: string }>}
   */
  const readRecordRow = async (locator) => {
    const bytes = await readRange(locator.filePath, locator.start, locator.end);
    if (bytes === null || lineDigest(bytes) !== locator.digest) {
      return { error: 'raw_stale', status: 409, reason: 'stale' };
    }
    /** @type {any} */
    let row;
    try {
      row = JSON.parse(bytes.toString('utf8'));
    } catch {
      return { error: 'raw_stale', status: 409, reason: 'unparseable' };
    }
    if (!row || typeof row !== 'object') {
      return { error: 'record_not_found', status: 404, reason: 'not_object' };
    }
    return { row, sizeBytes: bytes.length };
  };

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
    // Re-reading a record the reader has already opened is the common case, and a decoded message
    // is far smaller than a session, so the entry keeps the ones it has already paid for.
    const alreadyDecoded = cached.decoded.get(wanted);
    if (alreadyDecoded !== undefined) {
      sendJson(response, 200, { index: wanted, raw: alreadyDecoded.value, omitted: alreadyDecoded.omitted });
      return;
    }
    const locator = cached.raws.get(wanted);
    if (locator === undefined || typeof locator.filePath !== 'string') {
      sendError(response, 404, 'record_not_found', '找不到该记录');
      return;
    }
    const found = await readRecordRow(locator);
    if ('error' in found) {
      context.logger.warn('miniapp.trajectory.read_error', { reason: `raw_${found.reason}` });
      sendError(response, found.status, found.error, found.error === 'raw_stale'
        ? '该记录所在的文件已变化，请重新加载会话'
        : '找不到该记录');
      return;
    }
    // The one place the untouched message is materialised, for one record, on request. The
    // size verdict travels with it because the page has to be able to say "omitted" rather
    // than silently show something else — see tests/verify-raw-lazy.mjs.
    const built = buildRawPayload(found.row.message, redact);
    cached.decoded.set(wanted, built);
    while (cached.decoded.size > RAW_DECODE_CACHE_ENTRIES) {
      const oldest = cached.decoded.keys().next();
      if (oldest.done) break;
      cached.decoded.delete(oldest.value);
    }
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
    if (url.pathname === '/api/trajectory/search') {
      void handleSearch(response, url).catch((error) => {
        context.logger.error('miniapp.trajectory.read_error', { reason: 'search_failed', code: errorCode(error) });
        sendError(response, 500, 'trajectory_unreadable', '搜索暂时不可用');
      });
      return;
    }
    if (url.pathname === '/api/trajectory/record') {
      void handleRecord(response, url).catch((error) => {
        context.logger.error('miniapp.trajectory.read_error', { reason: 'record_failed', code: errorCode(error) });
        sendError(response, 500, 'trajectory_unreadable', '记录详情暂时无法读取');
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
    listCache = { at: 0, candidates: null };
    titleCache = { at: 0, key: '', map: new Map() };
    sessionsBody = { material: '', body: null };
    descriptorCache.clear();
    trajectoryCache.clear();
    // The parsed-row cache only ever holds sealed generations now, but it is still a cache that
    // has to be released here: a disposed runtime that kept it would still hold a rotated
    // generation's rows. The line is here so the next cache added cannot repeat the omission.
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
