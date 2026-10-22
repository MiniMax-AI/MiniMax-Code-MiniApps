/**
 * `/raw` must still answer after the parsed rows it used to point into are gone.
 *
 * The rows are released on purpose. Retaining a session's parsed object graph was the largest
 * single cost in this process: 378 MB of heap held while one 68 MB session was open, against
 * 145 MB once the active generation's rows are not kept. What is kept instead is, per record, the
 * file it came from, the byte range of its line, and a digest of that line — about 40 bytes a
 * record instead of the megabytes the rows cost.
 *
 * So this guard is about the seam that replacement creates, in three parts:
 *
 *   1. The positions are real. A span must be a byte range into the file, read from offset 0, so
 *      that `readRange(file, start, end)` gives back exactly the line that was parsed. Getting
 *      this wrong is silent: JSON.parse of the wrong bytes either throws or, worse, succeeds on a
 *      neighbouring line.
 *   2. The digest means something. Same length, same offset, different content must be caught —
 *      that is the whole case the digest exists for, because the trajectory entry is keyed on size
 *      and mtime and so cannot see a rewrite that preserved both.
 *   3. The route actually uses it. These are structural assertions on the source, because the
 *      property they describe ("the entry holds locators, not rows") is not observable from any
 *      exported function.
 *
 * Read-only: imports the pure helpers and reads files it wrote itself, never starts the runtime
 * and never touches a real session store. mutate-raw-locators.py breaks each of these in the
 * shipped file.
 */
import { mkdtemp, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  createParsedRowsCache,
  lineDigest,
  loadParsedRows,
  parseMessagesJsonl,
  readHead,
  readRange,
} from '../miniapp/node/server.mjs';

const SERVER = readFileSync(new URL('../miniapp/node/server.mjs', import.meta.url), 'utf8');
const CLIENT = readFileSync(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');

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
const root = await mkdtemp(join(tmpdir(), 'raw-locators-'));

/* =====================================================================
 * 1 — spans are byte ranges into the file, not into the decoded string
 * ===================================================================== */

const ROWS = [
  { message_id: 'm1', turn_id: 't1', message: { role: 'user', content: 'first', timestamp: 1791617886000 } },
  { message_id: 'm2', turn_id: 't1', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }], timestamp: 1791617891000 } },
  { message_id: 'm3', turn_id: 't2', message: { role: 'user', content: '中文内容', timestamp: 1791617895000 } },
  { message_id: 'm4', turn_id: 't2', message: { role: 'toolResult', content: 'done', timestamp: 1791617897000 } },
];
// Multi-byte content on purpose: a UTF-16 index and a byte offset stop agreeing the moment a line
// leaves ASCII, so a guard written only in ASCII would pass on the bug this pins.
const jsonl = ROWS.map((r) => JSON.stringify(r)).join('\n') + '\n';

const file = join(root, 'messages.jsonl');
await writeFile(file, jsonl);

const head = await readHead(file, LIMIT);
const parse = parseMessagesJsonl(head.buffer);
check('one span per parsed row', parse.spans.length, ROWS.length);
check('one row per span', parse.rows.length, ROWS.length);
assert('the fixture really does contain a multi-byte line', Buffer.byteLength(jsonl) > jsonl.length);

let spansExact = true;
for (let i = 0; i < ROWS.length; i += 1) {
  const [start, end] = parse.spans[i];
  const line = head.buffer.subarray(start, end).toString('utf8');
  if (JSON.parse(line).message_id !== ROWS[i].message_id) spansExact = false;
}
assert('every span reads back as exactly the line it produced the row from', spansExact);

const thirdLine = JSON.stringify(ROWS[2]);
check('the multi-byte row is found by the byte span', head.buffer.subarray(parse.spans[2][0], parse.spans[2][1]).toString('utf8'), thirdLine);
// The character index of the same line, which is what the old string-based parse produced. The
// two agree on where the line STARTS — everything before it is ASCII — and part company at its
// end, which is why the guard has to compare the end and not the start.
const charIndex = jsonl.indexOf(thirdLine);
check('the start is the same either way, because everything before it is ASCII', charIndex, parse.spans[2][0]);
assert('but the byte end and the character end are different numbers',
  parse.spans[2][1] !== charIndex + thirdLine.length);
assert('and the byte end is larger, because the CJK characters are 3 bytes each',
  parse.spans[2][1] > charIndex + thirdLine.length);
check('by exactly the extra bytes those characters take',
  parse.spans[2][1] - (charIndex + thirdLine.length),
  Buffer.byteLength(thirdLine) - thirdLine.length);

// readHead must start at offset 0 or none of this means anything.
assert('readHead reads from the start of the file', /handle\.read\(buffer, filled, wanted - filled, filled\)/.test(SERVER));
check('so the first span starts at byte 0', parse.spans[0][0], 0);

/* =====================================================================
 * 2 — the locators a parse carries
 * ===================================================================== */

const sealedCache = createParsedRowsCache(64 * 1024 * 1024);
const sealed = await loadParsedRows(sealedCache, file, LIMIT);
check('one locator per row', sealed.locators.length, sealed.rows.length);
assert('every locator carries a start, an end and a digest',
  sealed.locators.every((l) => Number.isInteger(l.start) && Number.isInteger(l.end)
    && l.end > l.start && typeof l.digest === 'string' && l.digest.length > 0));
// The file is part of the locator rather than something the route adds on the way past. It used to
// be, which meant a spread per row — 36,527 of them on a session this size — and a cached entry
// whose locators were unusable until a caller remembered to complete them.
assert('every locator names the file it was read from, complete',
  sealed.locators.every((l) => l.filePath === file));
assert('the digest is 64 bits of hex', sealed.locators.every((l) => /^[0-9a-f]{16}$/.test(l.digest)));

let digestsMatch = true;
let locatorAgrees = true;
for (let i = 0; i < sealed.locators.length; i += 1) {
  const { start, end, digest } = sealed.locators[i];
  if (lineDigest(head.buffer.subarray(start, end)) !== digest) digestsMatch = false;
  if (start !== parse.spans[i][0] || end !== parse.spans[i][1]) locatorAgrees = false;
}
assert('each digest is taken over exactly the bytes its locator names', digestsMatch);
assert('and the locator and the parse agree on every position', locatorAgrees);

const roundTrip = await readRange(file, sealed.locators[2].start, sealed.locators[2].end);
assert('readRange returns exactly the line the locator names',
  roundTrip !== null && roundTrip.toString('utf8') === thirdLine);
check('and its digest is the one recorded', lineDigest(roundTrip), sealed.locators[2].digest);

/* =====================================================================
 * 3 — readRange refuses rather than returning whatever is there
 * ===================================================================== */

check('a range that starts after it ends is refused', await readRange(file, 10, 10), null);
check('a backwards range is refused', await readRange(file, 20, 10), null);
check('a negative start is refused', await readRange(file, -1, 10), null);
check('a non-integer start is refused', await readRange(file, 1.5, 10), null);
check('a range past the end of the file is refused', await readRange(file, 0, Buffer.byteLength(jsonl) + 1), null);
check('but one that ends exactly at the end is not', (await readRange(file, 0, Buffer.byteLength(jsonl)))?.length, Buffer.byteLength(jsonl));
// A file that cannot be opened has to answer, not throw: this runs inside a request handler, and
// an exception here is a 500 for the reader rather than the 409 they should get.
let missingThrew = false;
let missingAnswer = null;
try {
  missingAnswer = await readRange(join(root, 'no-such-file.jsonl'), 0, 10);
} catch {
  missingThrew = true;
}
assert('a missing file is refused, not thrown', !missingThrew && missingAnswer === null);

/* =====================================================================
 * 4 — the case the digest exists for
 *
 * Same path, same length, same mtime, different content. Nothing above the file level can see it:
 * the trajectory entry is keyed on size and mtime, so it stays valid and the record still names
 * its index. Without the digest this line would be served under the wrong record's name.
 * ===================================================================== */

const rewritten = join(root, 'rewritten.jsonl');
await writeFile(rewritten, jsonl);
const beforeRewrite = await loadParsedRows(createParsedRowsCache(1024), rewritten, LIMIT, { cacheable: false });
const swap = jsonl.replace('"first"', '"firsx"');
assert('the rewrite is the same byte length, which is the point', Buffer.byteLength(swap) === Buffer.byteLength(jsonl));
await writeFile(rewritten, swap);
const frozen = new Date(1791617886000);
await utimes(rewritten, frozen, frozen);
const locatorBefore = beforeRewrite.locators[0];
const bytesAfter = await readRange(rewritten, locatorBefore.start, locatorBefore.end);
assert('the bytes at the recorded position did change', bytesAfter.toString('utf8') !== jsonl.slice(0, locatorBefore.end - locatorBefore.start));
assert('equal length is not mistaken for equal content', bytesAfter.length === locatorBefore.end - locatorBefore.start);
assert('and the digest is what says so',
  lineDigest(bytesAfter) !== locatorBefore.digest);

/* =====================================================================
 * 5 — the active file is parsed every time and retained never
 * ===================================================================== */

const activeCache = createParsedRowsCache(64 * 1024 * 1024);
const firstPass = await loadParsedRows(activeCache, file, LIMIT, { cacheable: false });
const secondPass = await loadParsedRows(activeCache, file, LIMIT, { cacheable: false });
check('cacheable:false stores nothing', activeCache.size, 0);
assert('so every call really parses', firstPass !== secondPass);
assert('while still returning equal content',
  JSON.stringify(firstPass.rows) === JSON.stringify(secondPass.rows));

const mixedCache = createParsedRowsCache(64 * 1024 * 1024);
await loadParsedRows(mixedCache, file, LIMIT, { cacheable: false });
check('an uncacheable call stores nothing even in an empty cache', mixedCache.size, 0);
const kept = await loadParsedRows(mixedCache, file, LIMIT);
check('a cacheable call does store', mixedCache.size, 1);
await loadParsedRows(mixedCache, file, LIMIT, { cacheable: false });
check('and an uncacheable one does not disturb what is there', mixedCache.size, 1);
// Two halves, and both matter. Reading through the cache when told not to is the dangerous one:
// it hands back a parse of whatever the file held when it was stored, which for the file being
// appended to is exactly the stale answer this change exists to stop serving.
assert('a cacheable call does hit the cache', (await loadParsedRows(mixedCache, file, LIMIT)) === kept);
const despite = await loadParsedRows(mixedCache, file, LIMIT, { cacheable: false });
assert('an uncacheable call parses anyway, even with that file sitting in the cache', despite !== kept);
assert('and still returns equal content', JSON.stringify(despite.rows) === JSON.stringify(kept.rows));

/* =====================================================================
 * 6 — structure: the route keeps locators, not rows
 * ===================================================================== */

const startAt = SERVER.indexOf('export async function start(');
assert('start() exists', startAt > 0);
const startBody = SERVER.slice(startAt);

assert('the route asks not to cache the file being appended to',
  startBody.includes('loadParsedRows(parsedRows, filePath, limit, { cacheable: link.fileName !== activeFileName })'));
assert('and that test names the active file rather than whatever it read last',
  startBody.includes('const activeFileName = lineage.chain[lineage.chain.length - 1].fileName;'));
assert('the entry keeps a locator map and a decode cache',
  /trajectoryCache\.set\(cacheKey,[\s\S]{0,200}?raws[\s\S]{0,200}?decoded: new Map\(\)/.test(startBody));
assert('and not the rows it used to keep',
  !/trajectoryCache\.set\(cacheKey,[\s\S]{0,200}?\{[^}]*\brows\b[^}]*\}\)/.test(startBody));
// The release has to be read INSIDE `handleTrajectory`, not anywhere in the runtime. It used to be
// `startBody.includes('rows.length = 0;')`, which the search handler's own `view.rows.length = 0;`
// satisfies — the assertion passed for a reason that had nothing to do with the thing it claimed to
// hold, and the mutation that deletes the real release went unnoticed. The same trap as a label that
// does not describe what it covers; it is caught here by asking the question of the right text.
const handleTrajectoryAt = startBody.indexOf('const handleTrajectory = async');
assert('handleTrajectory exists', handleTrajectoryAt > 0);
const handleTrajectoryBody = startBody.slice(handleTrajectoryAt, startBody.indexOf('const handleSearch = async'));
assert('the rows array is emptied once nothing else can reach it',
  /\n {4}rows\.length = 0;/.test(handleTrajectoryBody));
assert('and the locator array goes with it',
  /\n {4}rowLocators\.length = 0;/.test(handleTrajectoryBody));
assert('the release is the payload\'s own row array, not some other array that ends in rows.length',
  handleTrajectoryBody.includes('const rows = view.rows;'));

// The route must not reach into rows for /raw any more; it seeks.
const handleRawAt = startBody.indexOf('const handleRaw = async');
assert('handleRaw exists', handleRawAt > 0);
const rawBody = startBody.slice(handleRawAt, startBody.indexOf('const handleDashboard'));
assert('handleRaw does not read the rows the entry used to keep', !rawBody.includes('cached.rows'));
// The read and its digest check moved into `readRecordRow` when `/api/trajectory/record` needed
// the same two steps. They are asserted there and the handler is asserted to call it — a second
// copy in one of the handlers would be a second answer to the same question, and would also have
// made these two assertions pass for the wrong copy.
const readRowAt = startBody.indexOf('const readRecordRow = async');
assert('the shared line reader exists', readRowAt > 0);
const readRowBody = startBody.slice(readRowAt, startBody.indexOf('const handleRaw = async'));
assert('it reads the line back through readRange', readRowBody.includes('readRange(locator.filePath, locator.start, locator.end)'));
assert('and refuses the answer when the digest disagrees',
  readRowBody.includes('lineDigest(bytes) !== locator.digest') && readRowBody.includes("'raw_stale'"));
assert('handleRaw goes through it rather than reading a line of its own',
  rawBody.includes('readRecordRow(locator)') && !rawBody.includes('lineDigest('));
assert('and so does the record-detail endpoint',
  startBody.includes("url.pathname === '/api/trajectory/record'")
  && !startBody.slice(startBody.indexOf('const handleRecord = async'), readRowAt).includes('lineDigest('));
assert('the decode cache is bounded rather than grown',
  rawBody.includes('cached.decoded.size > RAW_DECODE_CACHE_ENTRIES'));
assert('RAW_DECODE_CACHE_ENTRIES is a real bound, not a comment',
  /const RAW_DECODE_CACHE_ENTRIES = \d+;/.test(SERVER));
assert('the decode cache is per entry, so a new body starts empty',
  /trajectoryCache\.set\([\s\S]{0,200}?decoded: new Map\(\)/.test(startBody));

/* =====================================================================
 * 7 — structure: the page keys its own raw cache on the version
 *
 * The server binding the message to the body it was built from does not cover the browser's copy.
 * A record index is a position within one version of one body, so without the validator in the
 * key the page keeps showing the previous version's message for the same record.
 * ===================================================================== */

const rawCacheKeyAt = CLIENT.indexOf('function rawCacheKey(index, version)');
assert('rawCacheKey exists', rawCacheKeyAt > 0);
// The whole function, not a fixed number of characters. A window of N characters stops being
// the function the moment a comment grows, and the assertion then fails on the edit rather
// than on the defect it is about — which is how a guard starts reporting somebody else's work.
const keyEnd = rawCacheKeyAt >= 0 ? CLIENT.indexOf('\n      }', rawCacheKeyAt) : -1;
const keyBody = rawCacheKeyAt >= 0 && keyEnd > rawCacheKeyAt
  ? CLIENT.slice(rawCacheKeyAt, keyEnd)
  : '';
assert("the page's raw cache key includes the validator", /state\.etag/.test(keyBody));
assert('and still the session and the index', keyBody.includes("sid + '#' + gen + '#'"));
// The key says whose answer a caller gets, so it has to say which RECORD is being read: the
// validator and the position do not, and a read that was retried after a reload found the pending
// read of the record that had taken its place.
assert("and the record's own version, so a read cannot take another record's answer",
  keyBody.includes("(version || '')"));
// A raw the server refuses is a hint, not a broken tab, so there is deliberately no second chance
// for it: `raw_stale` stays out of the reload-and-retry path and lands on the same line every
// other raw failure uses. What must not happen is the opposite — a stale answer being kept.
assert('a refused raw is reported, not retried into a loop',
  !/err\.code === 'raw_stale'/.test(CLIENT)
  && CLIENT.includes("err.code === 'trajectory_not_cached'"));

await rm(root, { recursive: true, force: true });

if (failures.length) {
  console.error(`\n[raw-locators] ${failures.length} FAILED, ${pass} passed`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`\n[raw-locators] ${pass} assertions passed`);
