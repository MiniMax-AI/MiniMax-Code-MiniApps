/**
 * The parsed-rows cache may not change a single byte of what the page receives.
 *
 * `handleTrajectory()` used to re-read and re-parse every generation file in the lineage on
 * every poll, because `trajectoryCacheKey()` carries each generation's byteLength: while the
 * session is still growing the key changes, the whole-session cache misses, and all of it is
 * redone. Measured on a 23-generation session, that was 99,986,501 source bytes per poll of
 * which 99.90% was byte-identical to the previous poll, costing 1,138 ms.
 *
 * The cache that fixes it holds parsed object graphs across requests, which makes it the one
 * piece of this service that can silently serve yesterday's file. So the invariant is stated
 * as the strongest thing available: run the real per-file step twice — once cold, once
 * through the cache — build the payload both ways, and require the serialized bodies to be
 * identical. Not "looks the same", identical.
 *
 * What the cache now covers is narrower than it was: only sealed generations are retained, because
 * for the file being appended to the key cannot hit by construction. That narrower job is pinned in
 * tests/verify-raw-locators.mjs, along with what replaced the rows for `/raw`. What is left here is
 * the cache's own correctness — that a hit is identical to a cold read, that its key names
 * everything it must name, and that it cannot serve one session's rows to another.
 *
 * The key's three components are each tested by the failure they exist to prevent:
 * a path, because every session has a `messages.jsonl` and a basename key lets two of them
 * collide; a size, because the active file grows; a limit, because readHead truncates at it.
 *
 * Read-only: imports the pure helpers, never starts the runtime.
 * mutate-parsed-rows.py breaks each of these in the shipped file.
 */
import { mkdtemp, mkdir, writeFile, rm, utimes, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  ROW_GENERATION,
  buildTrajectoryPayload,
  createParsedRowsCache,
  loadParsedRows,
  parsedRowsKey,
} from '../miniapp/node/server.mjs';

const SERVER = readFileSync(new URL('../miniapp/node/server.mjs', import.meta.url), 'utf8');

let pass = 0;
const failures = [];
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass += 1;
  else failures.push(`${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function assert(name, cond) {
  if (cond) pass += 1;
  else failures.push(name);
}

const LIMIT = 64 * 1024 * 1024;
const root = await mkdtemp(join(tmpdir(), 'parsed-rows-'));

/* =====================================================================
 * fixture — hand-written, so every expectation below is countable
 * ===================================================================== */

// 6 well-formed lines across 2 turns, one line deliberately corrupt so `skipped` is 1, and
// one line that is not an object.
const ROWS = [
  { message_id: 'm1', turn_id: 't1', message: { role: 'user', content: 'first', timestamp: 1791617886000 } },
  { message_id: 'm2', turn_id: 't1', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }], timestamp: 1791617891000, usage: { input_tokens: 10, output_tokens: 5 } } },
  { message_id: 'm3', turn_id: 't2', message: { role: 'user', content: 'second', timestamp: 1791617895000 } },
  { message_id: 'm4', turn_id: 't2', message: { role: 'assistant', content: [{ type: 'toolCall', name: 'bash' }], timestamp: 1791617896000 } },
  { message_id: 'm5', turn_id: 't2', message: { role: 'toolResult', content: 'done', timestamp: 1791617897000 } },
  { message_id: 'm6', turn_id: 't3', message: { role: 'assistant', content: [], timestamp: 1791617900000 } },
];
const CORRUPT = '{ this is not json';
const NOT_OBJECT = '"just a string"';

const jsonl = [
  ...ROWS.map((r) => JSON.stringify(r)),
  CORRUPT,
  NOT_OBJECT,
  '',
].join('\n') + '\n';

// 6 parseable rows, 2 skipped (one unparseable, one not an object). Counted by hand.
const EXPECTED_SKIPPED = 2;

// A stand-in session, so a key built for one conversation cannot be served another's. It carries a
// session and nothing else: `sizeBytes` and `truncated` are spread BELOW this, so any value added
// here would silently replace what the loop just computed — and the body-equality comparison would
// then be asserting a constant instead of what was actually read.
const other = { session: { id: 'sess-b', createdAtMs: 1791617886000 } };

/** Build the body the way the route does, from a set of per-file results. */
async function buildBody(files, filter) {
  const rows = [];
  let truncated = false;
  let readBytes = 0;
  let skipped = 0;
  for (const file of files) {
    const parsedFile = await loadParsedRows(file.cache, file.path, LIMIT);
    if (parsedFile.truncated) truncated = true;
    readBytes += parsedFile.read;
    skipped += parsedFile.skipped;
    const keep = filter === null || filter === file.generation;
    for (const row of parsedFile.rows) {
      if (keep) {
        row[ROW_GENERATION] = file.generation;
        rows.push(row);
      }
    }
  }
  const payload = buildTrajectoryPayload({
    session: { id: 'sess-a', createdAtMs: 1791617886000 },
    rows,
    sizeBytes: readBytes,
    truncated,
    ...other,
  });
  return { body: JSON.stringify(payload), rows, skipped, readBytes };
}

/* =====================================================================
 * 1 — a hit is byte-identical to a cold read
 * ===================================================================== */

const a = join(root, 'gen0.jsonl');
await writeFile(a, jsonl);

const coldCache = createParsedRowsCache(64 * 1024 * 1024);
const warmCache = createParsedRowsCache(64 * 1024 * 1024);

// cold: empty cache. warm: primed by a first pass that is thrown away.
const cold = await buildBody([{ cache: coldCache, path: a, generation: 0 }], null);
await buildBody([{ cache: warmCache, path: a, generation: 0 }], null);
const warm = await buildBody([{ cache: warmCache, path: a, generation: 0 }], null);

assert('a cache hit produces a body byte-identical to a cold read', cold.body === warm.body);
check('the payload really did carry records (so the comparison is not empty-vs-empty)',
  JSON.parse(cold.body).turns.length > 0, true);
check('a hit reports the same skipped count as a cold read', warm.skipped, cold.skipped);
check('a hit reports the same read byte count as a cold read', warm.readBytes, cold.readBytes);
check('two lines are skipped: one unparseable, one not an object', cold.skipped, EXPECTED_SKIPPED);
check('the record count survives the round trip', JSON.parse(cold.body).stats.messages, ROWS.length);

// the same, with a generation filter in force, because `keep` is the other thing that walks rows
const coldF = await buildBody([{ cache: coldCache, path: a, generation: 0 }], 0);
const warmF = await buildBody([{ cache: warmCache, path: a, generation: 0 }], 0);
assert('a hit is byte-identical to a cold read under a generation filter too', coldF.body === warmF.body);

// three turns is what these rows make: t1 (m1,m2), t2 (m3,m4,m5), t3 (m6)
check('the fixture really does group into three turns', JSON.parse(cold.body).turns.length, 3);

/* =====================================================================
 * 2 — a hit is a hit, and a miss is a miss
 * ===================================================================== */

const before = await loadParsedRows(warmCache, a, LIMIT);
const second = await loadParsedRows(warmCache, a, LIMIT);
assert('an unchanged file is served from the cache (same object, not a re-read)', before === second);
check('the cache holds exactly one entry after two reads', warmCache.size, 1);

// A rewrite that lands on the same length is invisible to the size, so mtime is the only thing
// that can tell it apart. The timestamp is set explicitly rather than left to the filesystem's
// resolution, so this cannot pass or fail by accident on a slow clock.
const rw = join(root, 'rewritten.jsonl');
await writeFile(rw, jsonl);
const rwCache = createParsedRowsCache(64 * 1024 * 1024);
const rwFirst = await loadParsedRows(rwCache, rw, LIMIT);
await writeFile(rw, jsonl.replace('"m6"', '"mX"'));
check('the rewrite really is the same byte length', Buffer.byteLength(jsonl.replace('"m6"', '"mX"')), Buffer.byteLength(jsonl));
await utimes(rw, new Date(1791617886000 + 60_000), new Date(1791617886000 + 60_000));
const rwSecond = await loadParsedRows(rwCache, rw, LIMIT);
assert('a same-size rewrite is noticed, via mtime', rwSecond.rows[5].message_id === 'mX');
assert('and it is a different object, not the cached one', rwFirst !== rwSecond);

// Growing the file must miss: this is the whole reason the cache exists, and a key that did
// not notice would pin the page to a stale tail forever.
await writeFile(a, jsonl + JSON.stringify({ message_id: 'm7', turn_id: 't3', message: { role: 'assistant', content: 'more', timestamp: 1791617905000 } }) + '\n');
const grown = await loadParsedRows(warmCache, a, LIMIT);
check('appending to the file is noticed: one more row', grown.rows.length, before.rows.length + 1);
assert('the appended row is the one that was added', grown.rows[grown.rows.length - 1].message_id === 'm7');
check('the cache now holds two entries', warmCache.size, 2);

/* =====================================================================
 * 3 — two sessions must not collide on messages.jsonl
 *
 * Every session has a `messages.jsonl`. If the key were a basename, two sessions whose active
 * files happened to be the same length at the same instant would share parsed rows — one
 * session's conversation rendered as another's.
 * ===================================================================== */

const dirX = join(root, 'sess-x');
const dirY = join(root, 'sess-y');
await mkdir(dirX);
await mkdir(dirY);
await writeFile(join(dirX, 'messages.jsonl'), jsonl);

// The other session holds one different row, padded to exactly the same byte length with a
// whitespace line. parseMessagesJsonl skips a line whose trim() is empty, so the padding
// changes the file's size without changing what it means — which is precisely the collision:
// two sessions, same basename, same size, same mtime, different conversations.
const otherLine = JSON.stringify({
  message_id: 'zz',
  turn_id: 'tz',
  message: { role: 'user', content: 'other session', timestamp: 1791617886000 },
}) + '\n';
const pad = Buffer.byteLength(jsonl) - Buffer.byteLength(otherLine);
assert('the collision fixture can be padded at all', pad > 0);
// No trailing newline after the padding: it would add a byte and break the exact match.
const padded = otherLine + ' '.repeat(pad);
await writeFile(join(dirY, 'messages.jsonl'), padded);

const forced = new Date(1791617886000);
await utimes(join(dirX, 'messages.jsonl'), forced, forced);
await utimes(join(dirY, 'messages.jsonl'), forced, forced);

const sx = await stat(join(dirX, 'messages.jsonl'));
const sy = await stat(join(dirY, 'messages.jsonl'));
check('the fixture really does give both sessions the same size', sx.size, sy.size);
check('the fixture really does give both sessions the same mtime', sx.mtimeMs, sy.mtimeMs);

const shareCache = createParsedRowsCache(64 * 1024 * 1024);
const fromX = await loadParsedRows(shareCache, join(dirX, 'messages.jsonl'), LIMIT);
const fromY = await loadParsedRows(shareCache, join(dirY, 'messages.jsonl'), LIMIT);
check('two sessions with identically-sized, identically-timed messages.jsonl do not share rows',
  fromY.rows.length, 1);
assert('and the first one was not served the second one\'s content',
  fromY.rows[0].message_id === 'zz' && fromX.rows[0].message_id === 'm1');
check('the cache kept both', shareCache.size, 2);

/* =====================================================================
 * 4 — the key is built from all four things it must be built from
 * ===================================================================== */

const base = '/tmp/x/messages.jsonl';
const k = (p, s, m, l) => parsedRowsKey(p, s, m, l);
assert('the path is part of the key (two sessions, one basename)', k(base, 100, 5, 9) !== k('/tmp/y/messages.jsonl', 100, 5, 9));
assert('the size is part of the key (the active file grows)', k(base, 100, 5, 9) !== k(base, 101, 5, 9));
assert('the mtime is part of the key (a rewrite at the same size)', k(base, 100, 5, 9) !== k(base, 100, 6, 9));
assert('the limit is part of the key (readHead truncates at it)', k(base, 100, 5, 9) !== k(base, 100, 5, 10));
assert('nothing else perturbs it', k(base, 100, 5, 9), k(base, 100, 5, 9));

/* =====================================================================
 * 5 — the budget
 * ===================================================================== */

const small = createParsedRowsCache(100);
small.set('a', { rows: [], skipped: 0, size: 0, read: 0, empty: false, truncated: false }, 40);
small.set('b', { rows: [], skipped: 0, size: 0, read: 0, empty: false, truncated: false }, 40);
check('two 40-byte entries fit in a 100-byte budget', small.bytes, 80);
small.set('c', { rows: [], skipped: 0, size: 0, read: 0, empty: false, truncated: false }, 40);
check('the third evicts the oldest, keeping the budget', small.bytes, 80);
check('and the total stays inside the budget', small.bytes <= 100, true);
assert('the least recently used entry is the one that went', small.get('a') === null);
assert('the newest is still there', small.get('c') !== null);

// reading refreshes recency: the 22 frozen snapshots are read on every rebuild, so the cache
// that evicts by insertion order would throw away the ones it is for.
const lru = createParsedRowsCache(100);
const val = { rows: [], skipped: 0, size: 0, read: 0, empty: false, truncated: false };
lru.set('a', val, 40);
lru.set('b', val, 40);
lru.get('a');
lru.set('c', val, 40);
assert('a file that was just read survives the eviction that follows', lru.get('a') !== null);
assert('the file that was not read is the one evicted', lru.get('b') === null);

// one file bigger than the whole budget: storing it would evict everything and still miss
const huge = createParsedRowsCache(100);
huge.set('small', val, 40);
huge.set('huge', val, 500);
check('a single entry larger than the budget is not stored', huge.bytes, 40);
assert('and it is not retrievable', huge.get('huge') === null);

// re-setting a key must not double-count it
const recount = createParsedRowsCache(1000);
recount.set('k', val, 500);
recount.set('k', val, 500);
check('re-storing the same key counts once', recount.bytes, 500);
check('and keeps one entry', recount.size, 1);

/* =====================================================================
 * 6 — sharing must not leak writes between requests
 *
 * The rows are handed to every request that reads the file. buildTrajectoryPayload is handed
 * the same objects, so anything it did to them would persist into the next poll's answer.
 * ===================================================================== */

const shareRows = createParsedRowsCache(64 * 1024 * 1024);
const one = await loadParsedRows(shareRows, a, LIMIT);
const beforeShape = JSON.stringify(one.rows);
await buildBody([{ cache: shareRows, path: a, generation: 4 }], null);
const two = await loadParsedRows(shareRows, a, LIMIT);
assert('building a payload leaves the cached rows byte-identical', beforeShape === JSON.stringify(two.rows));
assert('and it is literally the same array, not a copy', one === two);
// ROW_GENERATION is the one write the route makes to a cached row, and one path maps to one
// generation — so stamping twice leaves the same value.
check('stamping the generation is idempotent', two.rows[0][ROW_GENERATION], 4);

/* =====================================================================
 * 7 — truncation still comes from the tested helper
 * ===================================================================== */

const big = join(root, 'big.jsonl');
await writeFile(big, jsonl.repeat(20));
const truncCache = createParsedRowsCache(64 * 1024 * 1024);
const cut = await loadParsedRows(truncCache, big, 64);
assert('a file past the cap reports truncated', cut.truncated === true);
const whole = await loadParsedRows(createParsedRowsCache(64 * 1024 * 1024), big, LIMIT);
assert('a file inside the cap does not', whole.truncated === false);

// and an empty file says so on a hit too, because the flag rides on the cached value
const emptyPath = join(root, 'empty.jsonl');
await writeFile(emptyPath, '');
const emptyCache = createParsedRowsCache(1024);
const e1 = await loadParsedRows(emptyCache, emptyPath, LIMIT);
const e2 = await loadParsedRows(emptyCache, emptyPath, LIMIT);
assert('an empty file reports empty on a cold read', e1.empty === true);
assert('an empty file still reports empty on a hit', e2.empty === true);
assert('and the hit is a hit', e1 === e2);

/* =====================================================================
 * 8 — structure: where the cache lives and what it is keyed on
 * ===================================================================== */

const startAt = SERVER.indexOf('export async function start(');
assert('start() exists', startAt > 0);
const startBody = SERVER.slice(startAt);
assert('the cache is created inside start(), not at module level',
  startBody.indexOf('const parsedRows = createParsedRowsCache(') > 0
  && !/\nconst parsedRows = createParsedRowsCache\(/.test(SERVER.slice(0, startAt)));

assert('the route reaches the file through loadParsedRows()',
  startBody.includes('await loadParsedRows(parsedRows, filePath, limit, { cacheable: link.fileName !== activeFileName })'));
assert('the route no longer parses messages inline',
  !startBody.includes('parseMessagesJsonl(head.text)'));
assert('the bytes readHead returns are what gets parsed, not a decoded string',
  SERVER.includes('parseMessagesJsonl(head.buffer)'));
assert('the key is built from a stat of the file, not from the catalog',
  /const current = await stat\(filePath\);/.test(SERVER)
  && !/parsedRowsKey\(filePath, entry\.sizeBytes/.test(SERVER)
  && !/parsedRowsKey\(filePath, identity\.catalogBytes/.test(SERVER));
assert('the truncation verdict comes from truncatedByCap',
  SERVER.includes('truncated: truncatedByCap(head.size, limit),'));
assert('loadParsedRows is exported so a test can run the real step',
  SERVER.includes('export async function loadParsedRows('));

/* =====================================================================
 * 9 — the coverage is computable, and the rows are released when nobody wants them
 *
 * Two questions this cache has to answer, and neither of them is "how many entries are in
 * there" — that number moves with the order the files happened to be read in.
 *
 *   COVERAGE. The budget is charged in SOURCE bytes times the heap proxy, not in resident bytes,
 *   which V8 cannot report. That is what makes the coverage computable: the source bytes a
 *   round does NOT have to parse again are the lineage's source bytes minus the source bytes this
 *   cache holds, and the cache can say the second number exactly. A cache whose accounting had
 *   drifted from its input could not answer that at all, and then the budget would only be a
 *   number in a source file.
 *
 *   LIFETIME. The rows are the largest thing this service holds and they are only worth holding
 *   while somebody asks for them: the page stops asking the moment its tab is hidden, so a cache
 *   with no expiry keeps that conversation's rows for as long as the runtime lives. The release
 *   has to happen WITHOUT a request — a sweep that only ran on a request would release them
 *   exactly when the reader comes back, which is the one moment they are wanted again.
 * ===================================================================== */

// A constant the source declares as an expression — `60 * 1000` — is read by arithmetic rather
// than by a digit pattern, so the check follows the constant instead of repeating it.
const declaredNumber = (source, name) => {
  const match = source.match(new RegExp(`const ${name} = ([0-9_ *]+);`));
  if (match === null) return null;
  const parts = match[1].replace(/_/g, '').split('*').map((part) => Number(part.trim()));
  if (parts.some((part) => !Number.isFinite(part))) return null;
  return parts.reduce((carry, part) => carry * part, 1);
};

// The proxy is read out of the shipped source rather than repeated here, so the relationship
// below is checked against the constant the service actually charges with.
const PROXY = declaredNumber(SERVER, 'PARSED_ROWS_HEAP_PER_SOURCE_BYTE');
assert('the heap proxy is a number the service declares', PROXY !== null);

// A file of a known size, loaded through the shipped step: the cache must be charged the source
// bytes times the proxy, so the source bytes it holds are recoverable from its own accounting.
const sized = join(root, 'sized.jsonl');
const sizedText = ROWS.map((r) => JSON.stringify(r)).join('\n') + '\n';
await writeFile(sized, sizedText);
const sizedBytes = Buffer.byteLength(sizedText, 'utf8');
const coverageCache = createParsedRowsCache(64 * 1024 * 1024);
await loadParsedRows(coverageCache, sized, LIMIT);
check('the cache is charged the source bytes times the heap proxy',
  coverageCache.bytes, Math.ceil(sizedBytes * PROXY));
check('so the source bytes it holds are computable from its own accounting',
  coverageCache.bytes / PROXY, sizedBytes);
assert('and the charge the route makes is that one',
  SERVER.includes('cache.set(key, value, Math.ceil(head.size * PARSED_ROWS_HEAP_PER_SOURCE_BYTE));'));

// A clock the test controls, so "expired" is a fact rather than a wait.
let clock = 1_700_000_000_000;
const ttlCache = createParsedRowsCache(1000, { ttlMs: 60_000, now: () => clock });
ttlCache.set('k', val, 500);
assert('a stored entry is there', ttlCache.get('k') !== null);
clock += 59_000;
assert('a read inside the time limit is still a hit', ttlCache.get('k') !== null);
check('and it is still held', ttlCache.bytes, 500);
// The read above refreshed the entry, so the limit runs from THAT moment: the clock has to move
// a whole limit again, not a little more than the limit.
clock += 61_000;
assert('a read after the time limit is a miss', ttlCache.get('k') === null);
check('and the entry is not held any more', ttlCache.bytes, 0);

// The sweep releases what expired and keeps what has not.
const sweepCache = createParsedRowsCache(1000, { ttlMs: 60_000, now: () => clock });
sweepCache.set('k', val, 500);
sweepCache.sweep();
check('a sweep inside the time limit keeps the entry', sweepCache.bytes, 500);
clock += 61_000;
sweepCache.sweep();
check('a sweep releases what expired', sweepCache.bytes, 0);
check('and leaves nothing behind', sweepCache.size, 0);

// And the release happens without a request, which is the whole point of the time limit.
const liveCache = createParsedRowsCache(1000, { ttlMs: 100, sweepIntervalMs: 25 });
liveCache.set('k', val, 500);
assert('the rows are there to begin with', liveCache.bytes, 500);
await new Promise((resolve) => setTimeout(resolve, 1000));
check('the rows are released without a request', liveCache.bytes, 0);
check('and the cache is empty', liveCache.size, 0);

// The time limit has to outlive one poll, or an open tab would lose its rows between polls.
const clientSource = readFileSync(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
const pollMatch = clientSource.match(/TRAJECTORY_POLL_INTERVAL = (\d+)/);
assert('the client says how often it polls the trajectory', pollMatch !== null);
const ttlMatch = SERVER.match(/const PARSED_ROWS_CACHE_TTL_MS = ([0-9_ *]+);/);
assert('the rows cache has a time limit', ttlMatch !== null);
const TTL = declaredNumber(SERVER, 'PARSED_ROWS_CACHE_TTL_MS');
assert('the time limit is a number the service declares', TTL !== null);
assert('the time limit is longer than one poll, so an open tab never loses its rows',
  TTL > Number(pollMatch[1]));
// The page stops polling while its tab is hidden, so a reader who switches away for a while is
// the ordinary case. A limit shorter than that would make every return to the tab cost a
// re-parse — which is the other half of what this limit buys, and it has to be paid for.
assert('the time limit is at least five minutes, so stepping away from the tab does not cost a re-parse',
  TTL >= 5 * 60 * 1000);

// And the sweeper must never be the reason the process is still running.
assert('the sweeper does not keep the process alive', /\.unref\(\)/.test(SERVER));

await rm(root, { recursive: true, force: true });

/* ===================================================================== */

if (failures.length) {
  console.error(`\n[parsed-rows] ${failures.length} FAILED, ${pass} passed`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`\n[parsed-rows] ${pass} assertions passed`);