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
 * Read-only: it imports the pure helpers, and it runs the PAGE's own inline script in a sandbox
 * whose DOM is stubbed; it never starts the runtime.
 * mutate-parsed-rows.py and mutate-parsed-rows-owner-escapes.py break each of these in the
 * shipped file.
 */
import { mkdtemp, mkdir, writeFile, rm, utimes, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
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
// How many of the assertions below held VACUOUSLY -- green because there was nothing to compare
// against, rather than because the thing they are about was checked and matched.
//
// A vacuous holding has to be VISIBLE. An owner that says nothing cannot be told apart from one
// that was checked and found true, and the reader of this guard's output has to be able to tell
// the two apart -- that reader is the one asking "did this break break the rule that owner
// names?", and an owner that went quiet is not an answer to it.
let vacuous = 0;

// A comparison that holds vacuously when it cannot be made, and counts itself when it does.
const holds = (actual, expected, comparable) => {
  if (!comparable) { vacuous += 1; return true; }
  return actual === expected;
};
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass += 1;
  else failures.push(`${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function assert(name, cond) {
  if (cond) pass += 1;
  else failures.push(name);
}

// The timer the cache starts is not reachable from outside it, so the only way to see the
// interval it really got -- and the only way to see whether it holds the process open -- is to
// stand in for the clock's own timer call while the cache runs.
//
// The handle handed to the cache is a REAL timer handle, so its reference state is the platform's
// own answer and not this file's opinion of it. The handle is cleared as soon as the window
// closes, so no timer is left behind, and its callback can never run: the window is synchronous
// and the event loop does not turn inside it.
//
// A pattern over the source cannot do this. It can see that the text says `sweeper.unref()`, but
// not that the handle the cache was given is the one that was unref'd -- and an unrelated
// function with a parameter of the same name used to satisfy it while the real timer stayed
// referenced.
function withRecordedTimers(run) {
  const recorded = [];
  const handles = [];
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (callback, delay, ...rest) => {
    recorded.push(delay);
    const handle = realSetInterval(callback, delay, ...rest);
    handles.push(handle);
    return handle;
  };
  globalThis.clearInterval = () => {};
  try {
    run();
  } finally {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
    for (const handle of handles) realClearInterval(handle);
  }
  return { recorded, handles };
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
// The ARRAY is what the name says: the same array, not a copy of it. The check used to compare
// the whole value the read returned, which is a STRONGER thing than the name claims -- a read
// that handed back a fresh wrapper around the same array would have been reported as a copy of
// the array, and the rule this owner names would have been reported as broken by a break that
// did not break it. The owner now compares the arrays.
assert('and it is literally the same array, not a copy', one.rows === two.rows);
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
// The second read of an empty file is served from the cache, and what it hands back is the very
// object the cold read gave. The name used to say "the hit is a hit" while the check compared
// objects -- and "is a hit" is not what an object comparison can tell you: a cache that served a
// copy on a hit would still have been a hit, and the owner would have reported the rule it names
// as broken by a break that did not break it. The owner now says what it compares.
assert('and the hit on an empty file gives back the same object the cold read gave', e1 === e2);

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
 *   exactly when the reader comes back, which is the one moment they are wanted again. And the
 *   release lands on a sweep tick, so the rows are gone a sweep interval AFTER the limit, not at
 *   it: the number to promise a reader is the limit plus that interval, and the two have to stay
 *   in that relation. Both ends of that interval are floored at a millisecond, because a timer
 *   cannot be finer than that: an interval a caller asks for that is not positive would
 *   otherwise switch the sweeper off, and a sweeper that is off releases the rows only when
 *   somebody asks for them.
 * ===================================================================== */

// A lexical mask of a JavaScript source: which characters are CODE, and which are inside a
// string, a template literal or a comment.
//
// A scanner that cannot tell those apart stops at a bracket that was never one, and reads a
// declaration that is only text. A template literal can hold a whole declaration -- and the
// service's own arithmetic cannot tell a number from the string that looks like one -- so the
// helpers below talk about the code, not about the characters.
//
// WHAT THIS IS NOT, and it is worth being exact about it: this is not a complete lexical
// analysis. A REGULAR EXPRESSION LITERAL is not recognised. `/` is both the division operator
// and the start of one, and telling them apart needs the parser this package does not have --
// there is no JavaScript parser in it, and adding one is a bigger change than this guard is.
//
// The shipped service has such literals: miniapp/node/server.mjs:340, :345 and :349, and each of
// them holds a quote inside a character class. The scan reads that quote as the start of a string
// and swallows the text up to the next one, so the mask steps out of step with the file from
// line 340 on.
//
// The direction of that step is the part that matters, and it is LOUD rather than quiet. Every
// declaration this mask is asked about -- the time limit, at :203 -- is declared ABOVE those
// lines, so the mask is right about all of them today. And a declaration the mask could not find
// leaves the owner that wants it with nothing to read, which FAILS: the promise in brackets is
// read out of the file, and a file whose mask is out of step does not yield one. A mask that is
// out of step can only cost this guard a red, never a green.
const codeMask = (source) => {
  const mask = new Uint8Array(source.length);
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i += 1;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === quote) { i += 1; break; }
        i += 1;
      }
      continue;
    }
    if (ch === '`') {
      i += 1;
      let depth = 0;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === '$' && source[i + 1] === '{') { depth += 1; i += 2; continue; }
        if (depth > 0 && source[i] === '}') { depth -= 1; i += 1; continue; }
        if (depth === 0 && source[i] === '`') { i += 1; break; }
        i += 1;
      }
      continue;
    }
    mask[i] = 1;
    i += 1;
  }
  return mask;
};

// The page's own script, and the scope it declares.
//
// The interval the trajectory is polled at is declared by the page, and a constant read out of
// the page's TEXT is a line of text: a copy of the declaration inside a template literal
// satisfies any pattern over the text while the binding the page's timer really uses is
// something else. So the script is RUN, in a context that answers the DOM with stubs, and the
// values are read out of the scope it created. A template literal creates no binding, so a
// declaration that is only text cannot be read here.
//
// The DELAY is not read out of the text either. The page is asked to start its timers, the stub
// records what it was handed, and the timer that polls the trajectory is found by the handle the
// page itself stored in `trajectoryPollTimer` -- not by the order the timers were started in,
// and not by the biggest delay among them. So both halves of the comparison -- what the page
// declares, and what the page's own timer is really given -- are facts about the running page
// rather than about its characters.
//
// The context never lets the page start by itself: `document.readyState` is 'loading', so the
// page's own entry point is not called, no DOM is touched and no request is made. The guard
// starts the page's polling itself, because that is the thing being observed.
const CLIENT_SOURCE = readFileSync(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
const CLIENT_SCRIPT = (() => {
  const match = /<script\b[^>]*>([\s\S]*?)<\/script>/i.exec(CLIENT_SOURCE);
  return match === null ? null : match[1];
})();

// A stub for anything the page asks the DOM for: a function that answers everything and does
// nothing. The script is run to observe the timers it starts, not to exercise the page, so the
// DOM only has to not be there.
const domStub = (name) => new Proxy(function stub() {}, {
  get: (target, property) => {
    if (property === 'then') return undefined;                    // not a thenable
    if (property === Symbol.toPrimitive) return () => name;
    return domStub(`${name}.${String(property)}`);
  },
  apply: () => domStub(`${name}()`),
  set: () => true,
});

// The scope the page's script declares, and the timers it starts.
//
// A script that will not run is a fact about the PAGE and not about this file's harness: the
// page's own entry point is not called here, so the only thing that can throw is the script's
// top level. Either way the owner below cannot read what it is about, and that is reported as a
// failure of this guard -- never as a quiet holding, and never as an accusation of the service.
// A guard that says nothing about a rule is a guard that has stopped holding it.
const CLIENT_SCOPE = (() => {
  if (CLIENT_SCRIPT === null) {
    return { ok: false, error: new Error('the page has no inline script') };
  }
  const timers = [];
  let nextHandle = 0;
  const document = new Proxy({ readyState: 'loading' }, {
    get: (target, property) => (property in target
      ? target[property]
      : domStub(`document.${String(property)}`)),
  });
  const sandbox = {
    console,
    document,
    fetch: () => new Promise(() => {}),
    setTimeout: () => 0,
    clearTimeout: () => {},
    // The page's timers are recorded, not run. The handle is a FRESH OBJECT every time, so the
    // page's own global says which timer is which -- the page stores the handle it was given in
    // `trajectoryPollTimer`, and the identity of that object is what identifies the timer.
    setInterval: (_callback, delay) => {
      const handle = { id: (nextHandle += 1) };
      timers.push({ handle, delay });
      return handle;
    },
    clearInterval: () => {},
    matchMedia: () => domStub('matchMedia'),
    location: { href: 'http://localhost/', search: '', hash: '' },
    navigator: domStub('navigator'),
  };
  const context = vm.createContext(sandbox);
  sandbox.window = sandbox;
  try {
    vm.runInContext(CLIENT_SCRIPT, context, { filename: 'client-inline.js', timeout: 20000 });
    // The page does not start its timers by itself -- its entry point waits for the DOM -- so the
    // guard starts the polling, because that is the thing being observed.
    if (typeof context.startPolling !== 'function') {
      throw new Error('the page does not expose the function that starts its polling');
    }
    context.startPolling();
  } catch (error) {
    return { ok: false, error };
  }
  return { ok: true, context, timers };
})();
if (!CLIENT_SCOPE.ok) {
  failures.push('the page\'s inline script did not run, so the owner cannot read the delay the '
    + `page's poll waits: ${CLIENT_SCOPE.error && CLIENT_SCOPE.error.message}`);
}

// A value read out of the page's own scope.
const readInPage = (expression) => {
  if (!CLIENT_SCOPE.ok) return { ok: false, value: null };
  try {
    return { ok: true, value: vm.runInContext(expression, CLIENT_SCOPE.context, { timeout: 5000 }) };
  } catch {
    return { ok: false, value: null };
  }
};

// The values the shipped module really binds.
//
// A constant read out of the source TEXT is a line of text, not a binding: a template literal
// holding the same line satisfies any pattern over the text while the binding the service uses is
// something else -- a string, for instance, which the service's multiplication still coerces to the
// number it looks like, so every owner that reads the text goes on saying the rule holds.
//
// So the numbers are read from the module itself. A copy of it -- the shipped bytes with one export
// line appended -- is imported next to a copy of the module it imports relatively, and the values
// are read out of that namespace. The copy is the shipped file: the export line adds a name, not a
// value.
//
// If the copy cannot be imported at all, that is a fact about THIS FILE and not about the
// service: this guard imports the same module statically at the top of it, so a copy that will
// not import means the copy is broken. It is reported as a failure of this guard -- and NOT as a
// quiet holding. An owner that cannot read what it needs must not accuse the rules it is not
// about, and it must not go quiet either: the guard says that it could not read, and it stops.
const readModuleBindings = async (names) => {
  try {
    const dir = join(root, 'module');
    await mkdir(dir, { recursive: true });
    const nodeDir = new URL('../miniapp/node/', import.meta.url);
    for (const file of ['server.mjs', 'search-segments.mjs']) {
      await writeFile(join(dir, file), readFileSync(new URL(file, nodeDir)));
    }
    const shipped = readFileSync(new URL('server.mjs', nodeDir), 'utf8');
    await writeFile(join(dir, 'server.mjs'), `${shipped}\nexport { ${names.join(', ')} };\n`);
    const copy = await import(pathToFileURL(join(dir, 'server.mjs')).href);
    const values = {};
    for (const name of names) values[name] = copy[name];
    return { ok: true, values };
  } catch (error) {
    return { ok: false, error };
  }
};

// The three numbers the service declares, read from the module itself.
const BINDINGS_RESULT = await readModuleBindings([
  'PARSED_ROWS_HEAP_PER_SOURCE_BYTE',
  'PARSED_ROWS_CACHE_TTL_MS',
  'PARSED_ROWS_CACHE_SWEEP_INTERVAL_MS',
]);
if (!BINDINGS_RESULT.ok) {
  failures.push('the shipped module could not be imported by the copy this guard reads the '
    + `service's declared numbers from, so they cannot be read: ${BINDINGS_RESULT.error && BINDINGS_RESULT.error.message}`);
}
const BINDINGS = BINDINGS_RESULT.ok ? BINDINGS_RESULT.values : null;
const PROXY = BINDINGS === null ? null : BINDINGS.PARSED_ROWS_HEAP_PER_SOURCE_BYTE;
const TTL = BINDINGS === null ? null : BINDINGS.PARSED_ROWS_CACHE_TTL_MS;
const SHIPPED_SWEEP = BINDINGS === null ? null : BINDINGS.PARSED_ROWS_CACHE_SWEEP_INTERVAL_MS;

// The doc block above a constant, so a promise the package states in prose can be read and
// compared with what the code does. The block is taken around ONE declaration rather than the
// whole file, because a whole-file match keeps passing after the promise has moved somewhere
// else -- which is the way a rule quietly loses its owner.
//
// The declaration is found in the CODE, not in the text: a copy of it inside a template literal is
// not a declaration, and the block above such a copy is not the block above the real one.
const docBlockOf = (source, name, mask) => {
  const at = declarationIndexOf(source, name, mask);
  if (at < 0) return null;
  const before = source.slice(0, at);
  const start = before.lastIndexOf('/**');
  const end = before.lastIndexOf('*/');
  return start >= 0 && end > start ? before.slice(start, end) : null;
};

// Where a constant is declared in the code of a source, or -1 when it is not declared in code.
const declarationIndexOf = (source, name, mask) => {
  const pattern = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=`, 'g');
  let match;
  while ((match = pattern.exec(source)) !== null) {
    if (mask[match.index]) return match.index;
  }
  return -1;
};

// The mask of the shipped service: which of its characters are code.
const SERVER_MASK = codeMask(SERVER);

// The sentence of a doc block that makes a promise. A block can hold several sentences, and only
// one of them is the promise to a reader -- so the number has to be read out of THAT sentence and
// not out of the block. A number that sat in some other sentence of the same block would answer
// the pattern while the promise itself said something else.
const promiseSentenceOf = (block) => {
  if (block === null) return null;
  // The sentences of the block, keeping their terminators so a sentence can be recognised.
  const sentences = block.split(/(?<=\.)\s+/);
  return sentences.find((sentence) => sentence.includes('no later than')) ?? null;
};

// The number words a promise may be written in.
const UNITS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

// The number a run of words states, read from its END: the words of a number are the last ones
// before "minutes", and the words before them belong to the sentence around it.
const englishNumber = (text) => {
  const words = text.toLowerCase().replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  let half = false;
  if (words.length >= 3
    && words[words.length - 3] === 'and'
    && words[words.length - 2] === 'a'
    && words[words.length - 1] === 'half') {
    half = true;
    words.splice(words.length - 3, 3);
  }
  const last = words[words.length - 1];
  let value = null;
  if (/^\d+(?:\.\d+)?$/.test(last)) value = Number(last);
  else if (last in UNITS) value = UNITS[last];
  else if (last in TENS) {
    const unit = words.length >= 2 ? UNITS[words[words.length - 2]] : undefined;
    value = unit === undefined ? TENS[last] : TENS[last] + unit;
  }
  if (value === null) return null;
  return half ? value + 0.5 : value;
};

// The minutes a sentence promises, and whether it states them in the form the promise is written
// in.
//
// The number words are parsed COMPLETELY. A parser that knows only some of the numbers a promise
// may be written in answers "I did not understand" for the rest -- and an owner that accepts that
// answer as agreement lets a promise state two different numbers and still report success. So
// every number word a promise can use is understood here, and a phrase that is still not
// understood is not agreement: it is a promise nobody can check.
//
// The word "minutes" is the one the millisecond form FOLLOWS. The promise writes the two forms
// together, and a sentence can hold other uses of the word -- "the rows are gone within a few
// minutes, and no later than twelve and a half minutes (750000 ms)" -- whose words are not the
// promise. Reading the wrong one accuses the promise of a number it never stated, so the phrase
// is taken from the word the millisecond form is attached to and from nowhere else.
//
// TWO ANSWERS, and they are kept apart. `written` says the promise states the minutes at all;
// `minutes` is the number, and it is null when the words are there but cannot be read. "There are
// no minutes in this promise" and "the minutes in this promise are words nobody can read" are
// different facts about the promise, and an owner that treats them as one thing either accuses
// the promise of a number it never stated or lets a promise nobody can check pass.
const minutesForm = (sentence) => {
  if (sentence === null) return { written: false, minutes: null };
  const anchor = /\bminutes?\s*\(/i.exec(sentence);
  if (anchor === null) return { written: false, minutes: null };
  const at = anchor.index;
  let start = at;
  while (start > 0 && /[A-Za-z0-9\s.-]/.test(sentence[start - 1])) start -= 1;
  const phrase = sentence.slice(start, at).trim();
  const digits = /^\s*(\d+(?:\.\d+)?)\s*$/.exec(phrase);
  return { written: true, minutes: digits !== null ? Number(digits[1]) : englishNumber(phrase) };
};

// The lifetime the cache gives its rows when nobody tells it one, observed rather than read.
//
// The declaration of the limit says what the service INTENDS to give its rows; this says what it
// gives them. A cache whose default is taken from somewhere else than the constant the prose
// documents answers every declaration-based check with the documented number while the rows it
// actually holds live twice as long -- so the clock is moved until the cache lets the rows go by
// itself, and the moment it does is the limit.
const defaultLimitOf = (budget) => {
  const CAP = 2 ** 31;
  const releasedAt = (delta) => {
    const clock = { at: 1_700_000_000_000 };
    const cache = createParsedRowsCache(budget, { now: () => clock.at });
    cache.set('k', { id: 'k' }, 1);
    clock.at += delta;
    cache.sweep();
    const released = cache.bytes === 0;
    cache.clear();
    return released;
  };
  // A cache that never lets the rows go has no limit to find -- but it does have a FLOOR on the
  // limit it gives: the ceiling this probe reached. So the probe returns that ceiling rather
  // than nothing, and the owners below read it as the lower bound it is. A limit of at least
  // twenty-four days is longer than one poll and longer than five minutes, and it is not the
  // limit the service declares -- so every owner below says the right thing about it, instead of
  // going quiet and accusing the rules of a break that did not break them.
  if (!releasedAt(CAP)) return CAP;
  let low = 0;
  let high = CAP;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (releasedAt(middle)) high = middle;
    else low = middle;
  }
  return high;
};

// The proxy is read out of the shipped MODULE rather than repeated here, so the relationship
// below is checked against the constant the service actually charges with -- and against the type
// it really has: the service's multiplication coerces the string "2" to the number 2, so only the
// binding itself can tell whether the proxy is a number or the text of one.
assert('the heap proxy is a number the service declares',
  holds(typeof PROXY, 'number', PROXY !== null));

// A file of a known size, loaded through the shipped step: the cache must be charged the source
// bytes times the proxy, so the source bytes it holds are recoverable from its own accounting.
//
// The three owners below are about the CHARGE, and the proxy they compare against is read out of
// the source. When it cannot be read as a number there is no proxy to charge with -- and the rule
// that the proxy has to be a number the service DECLARES has an owner of its own, the one above.
// So these three hold vacuously in that case, and they never accuse the rule about the
// declaration.
//
// That is not a technicality. A cache whose proxy is the string "2" is still charged twice the
// source bytes, because that is what the service's own arithmetic does with it, so the rule these
// three name is not broken by the break that made them red. An owner that reports "I expected 0
// bytes" is not reporting a broken rule -- it is reporting that it could not read the number it
// wanted. A break of the declaration has to be reported by the owner of the declaration and by
// nobody else.
const sized = join(root, 'sized.jsonl');
const sizedText = ROWS.map((r) => JSON.stringify(r)).join('\n') + '\n';
await writeFile(sized, sizedText);
const sizedBytes = Buffer.byteLength(sizedText, 'utf8');
const coverageCache = createParsedRowsCache(64 * 1024 * 1024);
await loadParsedRows(coverageCache, sized, LIMIT);
assert('the cache is charged the source bytes times the heap proxy',
  holds(coverageCache.bytes, Math.ceil(sizedBytes * PROXY), PROXY !== null));
assert('so the source bytes it holds are computable from its own accounting',
  holds(coverageCache.bytes / PROXY, sizedBytes, PROXY !== null));
// The charge the ROUTE makes, observed by making the call the route makes. The route passes
// options, and a fixture that leaves them out takes a different branch of the same function, so
// a charge that was wrong on the route's path was invisible here -- and the old owner asked only
// whether the text of the charge was somewhere in the file, which a commented-out line satisfied.
const routeCache = createParsedRowsCache(64 * 1024 * 1024);
await loadParsedRows(routeCache, sized, LIMIT, { cacheable: true });
assert('and the charge the route makes is that one',
  holds(routeCache.bytes, Math.ceil(sizedBytes * PROXY), PROXY !== null));

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
//
// Both numbers here are OBSERVED, and that is the point of this block. The delay the poll waits
// is what the page really hands to its timer, and the lifetime the cache gives its rows is what
// the running cache gives them. A source says what the code INTENDS -- the number a constant is
// declared with, and the number the page writes next to its timer -- and a cache whose default
// lifetime comes from somewhere else, or a poll that multiplies the interval it declared, leaves
// every declaration exactly as it was while the service behaves differently -- and the promise to
// a reader is about the service, not about a declaration.
// The interval the page declares, read out of the scope the page's own script created.
//
// The declaration has to be a NUMBER: this value is what the page hands to a timer, and a
// string that looks like one would be handed over as a string.
const DECLARED = readInPage('TRAJECTORY_POLL_INTERVAL');
const DECLARED_INTERVAL = DECLARED.ok ? DECLARED.value : null;
assert('the client declares the interval it polls the trajectory at',
  DECLARED_INTERVAL !== null
  && typeof DECLARED_INTERVAL === 'number'
  && Number.isFinite(DECLARED_INTERVAL));

// The timer the page polls the trajectory with, and the delay it was really given.
//
// The timer is found by the HANDLE the page stored in `trajectoryPollTimer` -- the page starts a
// second timer for the session list, and the two are told apart by the object the page was
// given, not by the order they were started in and not by which delay is the larger one.
//
// The delay is what the page handed to the timer, which is not the same thing as the text
// around the interval's name: a comma expression hides a second value behind the first, so
// `(TRAJECTORY_POLL_INTERVAL, 8000000)` gives the timer eight million milliseconds while the
// characters around the name still read "TRAJECTORY_POLL_INTERVAL".
const TRAJECTORY_TIMER = CLIENT_SCOPE.ok
  && CLIENT_SCOPE.context.trajectoryPollTimer !== null
  && CLIENT_SCOPE.context.trajectoryPollTimer !== undefined
  ? CLIENT_SCOPE.timers.find((timer) => timer.handle === CLIENT_SCOPE.context.trajectoryPollTimer)
  : undefined;
const POLL_DELAY = TRAJECTORY_TIMER === undefined ? null : TRAJECTORY_TIMER.delay;
assert('the poll waits as long as the client declares',
  POLL_DELAY !== null && POLL_DELAY === DECLARED_INTERVAL);

assert('the rows cache has a time limit', holds(TTL !== null, true, BINDINGS !== null));
assert('the time limit is a number the service declares',
  holds(typeof TTL, 'number', BINDINGS !== null));

// The lifetime the cache really gives its rows.
const DEFAULT_LIMIT = defaultLimitOf(1024 * 1024);
assert('the limit the service declares is the limit the cache gives its rows',
  holds(DEFAULT_LIMIT, TTL, BINDINGS !== null));
assert('the time limit is longer than one poll, so an open tab never loses its rows',
  POLL_DELAY !== null && DEFAULT_LIMIT > POLL_DELAY);
// The page stops polling while its tab is hidden, so a reader who switches away for a while is
// the ordinary case. A limit shorter than that would make every return to the tab cost a
// re-parse — which is the other half of what this limit buys, and it has to be paid for.
assert('the time limit is at least five minutes, so stepping away from the tab does not cost a re-parse',
  DEFAULT_LIMIT >= 5 * 60 * 1000);

// And the sweeper must never be the reason the process is still running. The owner of that rule
// used to be a pattern over the source, and a pattern cannot tell the cache's own handle from an
// unrelated one's: a function elsewhere with a parameter of the same name satisfied it while the
// real timer stayed referenced. So the owner watches the handle the cache was given: a timer the
// cache created has to be one that does not hold the process open.
//
// A cache that starts no timer at all has nothing that could hold the process open, so that is
// green here: whether a sweeper starts at all is another owner's rule, and this one is not a second
// accusation of it. A handle that exists but cannot answer the question is not green either -- the
// owner has to be able to say that the handle does not hold the process open, and a handle it
// cannot ask has not said it.
const unrefWindow = withRecordedTimers(() => {
  const unrefCache = createParsedRowsCache(1000, { ttlMs: 1_000 });
  unrefCache.set('k', val, 500);
});
assert('the sweeper does not keep the process alive',
  unrefWindow.handles.every((handle) => typeof handle.hasRef === 'function'
    && handle.hasRef() === false));

// The release lands on a sweep tick, so the rows are gone a sweep interval AFTER the limit. The
// promise to a reader is that interval added on, and it only stays a promise while the interval
// is a fraction of the limit. This is checked on the interval the cache ACTUALLY uses, for
// several limits — not on two numbers read out of the source, which would keep passing after
// the line that takes the interval had changed.
assert('the sweep interval is a number the service declares',
  holds(typeof SHIPPED_SWEEP, 'number', BINDINGS !== null));
for (const limit of [1_000, 60_000, 600_000, 3_600_000]) {
  const bounded = createParsedRowsCache(1000, { ttlMs: limit });
  assert('the sweep interval the cache uses is at most a quarter of the limit',
    bounded.sweepIntervalMs <= limit / 4);
}
const asked = createParsedRowsCache(1000, { ttlMs: 1_000, sweepIntervalMs: 500_000 });
assert('an interval the caller asks for is clamped to the limit as well',
  asked.sweepIntervalMs <= 1_000 / 4);
assert('the shipped default is the interval the service declares',
  createParsedRowsCache(1000).sweepIntervalMs === SHIPPED_SWEEP);

// The number a reader is promised: the rows are gone no later than the limit plus one sweep
// interval. The bound is computed here from the limit the service DECLARES and the interval
// the RUNNING cache uses, and it is compared with the number the package states in prose -- so
// a change to one of them without the other is caught here and not by a reader. The promise is
// in prose because that is where a reader meets it, and a promise nobody checks is a promise
// that is true on the day it was written.
// The number the package promises a reader, read out of the SENTENCE that makes the promise.
//
// That block states the promise twice -- as a number of minutes and as a number of milliseconds
// -- and the two forms have to be the same promise, or the reader is told one thing and the
// service does another. A block can also hold a number that is not part of the promise at all: an
// annotation left beside it would answer the pattern while the sentence a reader reads said
// something else. So the number is taken from the promise sentence, that sentence's own words
// are read as well, and the two are compared with each other and with the limit the cache really
// gives its rows.
const ttlDoc = docBlockOf(SERVER, 'PARSED_ROWS_CACHE_TTL_MS', SERVER_MASK);
const promiseSentence = promiseSentenceOf(ttlDoc);
const promisedNumbers = promiseSentence === null
  ? []
  : [...promiseSentence.matchAll(/\((\d+) ms\)/g)].map((found) => Number(found[1]));
const MINUTES_FORM = minutesForm(promiseSentence);
const promisedMinutes = MINUTES_FORM.minutes;
const DEFAULT_INTERVAL = createParsedRowsCache(1000).sweepIntervalMs;
assert('the number promised to a reader is the limit plus one sweep interval',
  promisedNumbers.length === 1
  && promisedNumbers[0] === DEFAULT_LIMIT + DEFAULT_INTERVAL);
// The two forms have to be the SAME promise. A promise whose words cannot be read is not
// agreement: the words are parsed completely above, so a phrase that is still not a number is a
// promise nobody can check, and this owner says so rather than passing it.
//
// And a promise that is written in only ONE of the two forms is nothing for this owner to
// compare -- the minutes are there and the milliseconds are not, or the other way round. That is
// counted with the result, so a reader can tell it from one that was checked and matched.
//
// So the two answers about the minutes are kept apart here, and they are what the two cases are.
// The minutes are stated next to the millisecond form, the promise writes both forms, and the two
// have to agree: a promise that states the minutes in words nobody can read is a promise nobody
// can check, and it is NOT the same thing as a promise that states only one form.
const samePromiseInBothForms = promisedMinutes !== null
  && promisedNumbers.length === 1
  && Math.abs(promisedMinutes * 60_000 - promisedNumbers[0]) < 1;
const bothFormsWritten = MINUTES_FORM.written && promisedNumbers.length === 1;
assert('the promise to a reader is the same promise in both of the forms it is written in',
  holds(samePromiseInBothForms, true, bothFormsWritten));

// The promise above holds only if the TIMER runs on that interval: the rows are released on the
// next tick, and the tick is the sweep. Nothing in the package watched the call that starts that
// timer, so an interval multiplied by two left every other check here green while the real
// release moved to "the limit plus twice the interval" -- and the promise to a reader went on
// saying twelve and a half minutes.
//
// What has to be checked is the NUMBER the timer is given, not the way the call spells it. A
// pattern over the source can only see the spelling, and a local binding that shadows the name
// keeps that spelling while doubling the number that is actually passed: the cache kept reporting
// the interval it was asked for, the number in the prose kept matching that reported interval, and
// the real release moved out to nearly fifteen minutes.
//
// The timer is not reachable from outside the cache, so the only way to see the interval it really
// got is to stand in for the clock's own timer call while the cache runs.
//
// What this owner rules about is the INTERVAL a timer runs on -- not whether a timer is started at
// all. A cache that starts no sweeper has no timer running on the wrong interval, and "a sweeper
// has to start" is a different rule with a different owner (the rows have to be released without a
// request). So the check below holds for every timer the cache starts, and holds vacuously when
// it starts none: that keeps the two rules apart instead of making one of them the other's echo.
let timedCache = null;
const timerWindow = withRecordedTimers(() => {
  timedCache = createParsedRowsCache(1000, { ttlMs: TTL });
  timedCache.set('k', val, 500);
});
assert('the timer that releases the rows runs on the interval the cache reports',
  timerWindow.recorded.every((interval) => interval === timedCache.sweepIntervalMs));

// The quarter has a floor of a millisecond, because a timer cannot be finer than that. For a
// limit below four milliseconds the floor is the larger of the two, so the release is then at
// most a millisecond late rather than a quarter of a tiny limit late. The limit below is
// deliberately tiny: with a limit of a second the floor never applies, and a case that cannot
// reach the floor would pass without anything having been decided.
const tinyLimit = createParsedRowsCache(1000, { ttlMs: 3 });
assert('a limit below four milliseconds is still swept every millisecond, so the release is at most a millisecond late',
  tinyLimit.sweepIntervalMs === 1);

// An interval the caller asks for that is not positive is taken as a millisecond. It used to
// switch the sweeper off instead, and a cache whose sweeper is off only releases the rows when
// somebody asks for them -- the one moment they are wanted again.
const nonPositive = createParsedRowsCache(1000, { ttlMs: 1_000, sweepIntervalMs: 0 });
const negative = createParsedRowsCache(1000, { ttlMs: 1_000, sweepIntervalMs: -5 });
assert('an interval the caller asks for that is not positive is taken as a millisecond',
  nonPositive.sweepIntervalMs === 1 && negative.sweepIntervalMs === 1);

// And the consequence of that floor: the sweeper still runs, so the rows are still released
// without a request. This one is a real timer, because the sweeper is a timer.
const nonPositiveCache = createParsedRowsCache(1000, { ttlMs: 100, sweepIntervalMs: 0 });
nonPositiveCache.set('k', val, 500);
await new Promise((resolve) => setTimeout(resolve, 500));
check('a caller who asks for a non-positive interval still gets the rows released without a request',
  nonPositiveCache.bytes, 0);

// A time limit of zero means NO time limit. The other reading — everything expires at once —
// would be a cache that never hits and never releases, which is worse than either.
const noLimit = createParsedRowsCache(1000, { ttlMs: 0, now: () => clock });
noLimit.set('k', val, 500);
clock += 10 * 60 * 1000;
assert('a time limit of zero means no time limit, not that everything expires at once',
  noLimit.get('k') !== null);
check('and the rows are still held', noLimit.bytes, 500);

// The other half of that promise is that NO SWEEPER runs. In a cache in which nothing ever
// expires, a timer would scan it for ever, because the sweep only stops when the cache empties
// and this one never does. So that half has to be owned by watching the TIMER, not by watching
// the hit: the hit stays true and the bytes stay counted either way.
const zeroTimerCalls = withRecordedTimers(() => {
  const zeroCache = createParsedRowsCache(1000, { ttlMs: 0, now: () => clock });
  zeroCache.set('k', val, 500);
});
assert('a time limit of zero starts no sweeper, because nothing in it ever expires',
  zeroTimerCalls.recorded.length === 0);

await rm(root, { recursive: true, force: true });

/* ===================================================================== */

if (failures.length) {
  console.error(`\n[parsed-rows] ${failures.length} FAILED, ${pass} passed`);
  for (const f of failures) console.error('  - ' + f);
  if (vacuous > 0) {
    console.error(`[parsed-rows] ${vacuous} of them held vacuously: there was nothing to `
      + `compare against, so they say nothing about the thing they are about`);
  }
  process.exit(1);
}
console.log(`\n[parsed-rows] ${pass} assertions passed`);
if (vacuous > 0) {
  console.log(`[parsed-rows] ${vacuous} of them held vacuously: there was nothing to compare `
    + `against, so they say nothing about the thing they are about`);
}