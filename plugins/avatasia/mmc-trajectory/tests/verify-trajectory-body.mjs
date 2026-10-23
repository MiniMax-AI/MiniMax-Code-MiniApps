/**
 * The trajectory body is built in pieces, and the pieces are the same bytes.
 *
 * WHAT CHANGED. The body used to be produced by ONE `JSON.stringify(payload)` call, so the
 * process had to hold all of it as one string at once, and V8's string builder leaves its
 * intermediate copies behind while it doubles its buffer. Measured on this machine, serializing
 * a 52.4M-character body cost 745 MB of heap on top of the payload it came from; the peak that
 * left behind kept the process at 965 MB resident with an 8.4 MB live heap, long after the body
 * itself was gone. The body is now serialized in pieces and kept as bytes.
 *
 * WHY THIS FILE IS A GUARD AND NOT A COMMENT. Five things about that change can each be undone
 * without anything else noticing, and each of them has a name here:
 *
 *   1. the pieces must be the same bytes `JSON.stringify` would have produced. A body that is
 *      *nearly* the same is a body the page cannot parse, and the page is the only consumer that
 *      would notice — the server would answer 200 the whole time.
 *   2. the pieces must be BYTES. Strings are what the change was for: a piece kept as a string
 *      is a piece V8 holds as a two-byte string whenever it holds one character outside Latin-1,
 *      which is every Chinese transcript on this machine.
 *   3. there must be MORE THAN ONE piece, and no piece may be bigger than the budget unless it
 *      holds a single element. A serializer that stopped splitting would still produce the right
 *      bytes and would bring the whole peak back.
 *   4. the declared length must be the sum of the pieces. A length computed from one piece, or
 *      from the number of characters rather than the number of bytes, is a length the socket
 *      disagrees with, and the page hangs waiting for a body that ended early.
 *   5. the route must USE the pieces, and the cache must KEEP them. A helper that is correct and
 *      a route that does not call it are both green, and the memory is exactly as bad as before.
 *   6. the socket has to be handed the PIECES, as bytes, and the bytes that arrive have to be
 *      the bytes of the body. A send path that joins the pieces into one write brings the peak
 *      this change was made to remove back, and one that changes the bytes without changing
 *      their length is a body the page cannot tell from the right one. Comparing the LENGTHS
 *      sees neither.
 *   7. the closing bracket has to be counted against the budget. It is one byte and it lands on
 *      the piece that holds the last element, so a piece that held two elements and ended
 *      exactly at the budget came out one byte over it.
 *
 * The live section at the end is the wiring: it asks a real service for a real body and checks
 * that the bytes on the wire are the bytes the serializer produced, on the first read and on the
 * warm read that comes out of the cache.
 *
 * `mutate-trajectory-body.py` breaks each of these in the shipped source and requires this guard
 * to catch it by name.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { mkdir, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializeTrajectoryBody, sendJsonBody, start } from '../miniapp/node/server.mjs';

const SERVER = readFileSync(new URL('../miniapp/node/server.mjs', import.meta.url), 'utf8');
/** The package root, so the route serves the same page the reader gets. */
const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url));

// `node:sqlite` is still flagged experimental, and the flag goes to stderr the moment the module
// is first loaded. The runner reads `stdout + stderr` and prints the LAST non-empty line, so the
// warning would land where this guard's own result line should be.
const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) => (
  String(warning).startsWith('SQLite is an experimental feature')
    ? undefined
    : emitWarning.call(process, warning, ...rest));

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

/**
 * The pieces as bytes, whatever they are.
 *
 * A piece that came back as a string is read as its own bytes rather than crashing the report:
 * the assertion that owns "the pieces are bytes" has to be able to FAIL, and a crash takes the
 * names of the other assertions with it.
 */
const asBytes = (pieces) => Buffer.concat(pieces.map((piece) => (
  Buffer.isBuffer(piece) ? piece : Buffer.from(piece, 'utf8')
)));

/* =====================================================================
 * 1 — the bytes are the same bytes
 * ===================================================================== */

const SHAPES = [
  { name: 'a plain object', payload: { a: 1, b: 'two', c: true, d: null } },
  {
    name: 'the shape the route builds',
    payload: {
      session: { id: 'sess', createdAtMs: 1791600000000, lastActiveAt: 1791600000000 },
      stats: { messages: 2, turns: 1 },
      turns: [
        { id: 't1', index: 1, records: [{ index: 0, id: 'm1', kind: 'user' }, { index: 1, id: 'm2', kind: 'assistant' }] },
        { id: 't2', index: 2, records: [] },
      ],
    },
  },
  { name: 'text outside Latin-1', payload: { turns: [{ summary: '会话轨迹', text: '你好，世界' }] } },
  {
    name: 'characters that have to be escaped',
    payload: { turns: [{ s: 'quote " backslash \\ newline \n tab \t control ' }] },
  },
  { name: 'an empty array', payload: { turns: [] } },
  { name: 'keys that have to be escaped', payload: { 'a"b': 1, 'c\\d': 2, 'e\nf': 3 } },
  { name: 'values JSON.stringify leaves out', payload: { a: 1, b: undefined, c: () => 1, d: 2 } },
  { name: 'numbers of every shape', payload: { turns: [{ n: [0, -0, 1.5, 1e21, 1e-7, 12345678901234567890] }] } },
  { name: 'nested objects and arrays', payload: { turns: [{ r: { deep: { deeper: [1, [2, [3]]] } } }] } },
  { name: 'an undefined element inside the array', payload: { turns: [undefined, 1] } },
];

const mismatched = [];
for (const shape of SHAPES) {
  const expected = JSON.stringify(shape.payload);
  const pieces = serializeTrajectoryBody(shape.payload);
  const actual = asBytes(pieces).toString('utf8');
  check(`the chunked body is the same bytes JSON.stringify would have produced (${shape.name})`,
    actual, expected);
  if (actual !== expected) mismatched.push(shape.name);
}
assert('the chunked body is the same bytes JSON.stringify would have produced', mismatched.length === 0);

/* =====================================================================
 * 2 — the pieces are bytes, and there is more than one of them
 * ===================================================================== */

const turnsFor = (count) => Array.from({ length: count }, (unused, index) => ({
  id: 't' + index,
  index,
  records: [{ index, id: 'm' + index, turnId: 't' + index, kind: 'assistant', role: 'user', timestamp: 1791600000000 + index }],
}));
const SMALL = { turns: turnsFor(10) };
const LARGE = { turns: turnsFor(20000) };
const smallPieces = serializeTrajectoryBody(SMALL);
const largePieces = serializeTrajectoryBody(LARGE);

// The number of pieces a body is cut into has to GROW with the body. That is the whole
// invariant: a serializer that stops splitting answers a bigger session with the same number
// of pieces, and the piece that holds everything is the peak this change was made to remove.
// The count is not compared with a number — the body's own small case is the yardstick.
assert('the body is cut into more pieces as it grows, so no single string holds it',
  largePieces.length > smallPieces.length);
assert('the pieces are bytes, so the body is not held as a string',
  largePieces.every((piece) => Buffer.isBuffer(piece)));
check('the pieces add up to the body',
  asBytes(largePieces).length, Buffer.byteLength(JSON.stringify(LARGE), 'utf8'));

/* =====================================================================
 * 3 — the budget bounds a piece
 * ===================================================================== */

const BUDGET = 4096;
const budgeted = serializeTrajectoryBody({
  turns: Array.from({ length: 50 }, (unused, index) => ({ id: 'm' + index, text: 'x'.repeat(200) })),
}, BUDGET);
assert('no piece is bigger than the budget unless it holds a single element',
  budgeted.length > 1 && budgeted.every((piece) => piece.length <= BUDGET));

// The one thing the budget cannot bound: an element bigger than the budget on its own. It
// becomes a piece of its own rather than being cut in half, because half a record is not a
// record.
const HUGE = { turns: [{ id: 'a', text: 'x'.repeat(BUDGET * 2) }] };
const huge = serializeTrajectoryBody(HUGE, BUDGET);
assert('an element bigger than the budget becomes a piece of its own',
  huge.length === 3 && huge[1].length > BUDGET);
check('and it is still the same bytes', asBytes(huge).toString('utf8'), JSON.stringify(HUGE));

// The bracket that closes the array is counted against the budget. The element below is sized
// so that the array ENDS exactly at the budget: with the bracket left out of the count, the
// piece that holds both elements comes out one byte over it, and the budget did not bound the
// piece it was supposed to bound. This is the fixture that sees it, and the one above cannot:
// its piece holds a single element, and a single element is the one thing the budget cannot
// bound.
const BOUNDARY_PAYLOAD = { turns: ['x'.repeat(BUDGET - 5), 0] };
const boundary = serializeTrajectoryBody(BOUNDARY_PAYLOAD, BUDGET);
assert('a piece never ends over the budget because of the bracket that closes it',
  boundary.every((piece) => piece.length <= BUDGET));
check('and the bytes are the same bytes', asBytes(boundary).toString('utf8'),
  JSON.stringify(BOUNDARY_PAYLOAD));

/* =====================================================================
 * 4 — the declared length is the sum of the pieces
 * ===================================================================== */

const fakeResponse = () => ({
  writableEnded: false,
  destroyed: false,
  headers: null,
  written: [],
  writeHead(status, headers) { this.headers = headers; },
  write(chunk) { this.written.push(chunk); return true; },
  end(chunk) { if (chunk !== undefined) this.written.push(chunk); },
});

const chunked = fakeResponse();
sendJsonBody(chunked, 200, largePieces, {});
const declared = Number(chunked.headers['content-length']);
const sent = asBytes(chunked.written).length;
assert('the declared length is the sum of the pieces, not the length of one string',
  declared === sent && declared === asBytes(largePieces).length);
// What reached the socket has to BE the pieces: one write per piece, each of them bytes.
// A send path that joins them into one write brings back the peak this change was made to
// remove, and one that hands over a string does it with the very representation the change
// was made to get rid of. The COUNT is what sees the first, and the TYPE is what sees the
// second -- and a length comparison sees neither.
assert('and the pieces are what reached the socket',
  chunked.written.length === largePieces.length);
assert('the socket was handed the pieces as bytes, not as a string',
  chunked.written.every((chunk) => Buffer.isBuffer(chunk)));
// And the bytes that arrived have to be the bytes of the body, compared against an
// expectation THIS FILE derives itself -- its own JSON.stringify of the payload -- rather
// than against whatever the product produced. A body changed on the way out without
// changing its length is the same length and a different body, and the page cannot tell it
// from the right one.
assert('the bytes that reached the socket are the bytes of the body',
  asBytes(chunked.written).equals(Buffer.from(JSON.stringify(LARGE), 'utf8')));

const asString = fakeResponse();
sendJsonBody(asString, 200, JSON.stringify(LARGE), {});
assert('a body that is one string still declares its own length',
  Number(asString.headers['content-length']) === Buffer.byteLength(JSON.stringify(LARGE), 'utf8'));

/* =====================================================================
 * 5 — the route uses the pieces, and the cache keeps them
 * ===================================================================== */

const routeStart = SERVER.indexOf('const handleTrajectory = async');
const route = SERVER.slice(routeStart, SERVER.indexOf('\n  /**', routeStart));
// How many times the route assigns the body it is about to keep. One, and it is the
// serializer's own result: a second assignment is a copy, and a copy of a body this size is
// the thing that has to stop happening.
const bodyAssignments = route.match(/^\s*body = .*$/gm) || [];
assert('the route serializes the body in pieces', route.includes('body = serializeTrajectoryBody(payload);'));
assert('the route does not serialize the whole payload as one string', !route.includes('JSON.stringify(payload)'));
assert('the cache keeps the pieces the serializer produced, not a string of its own',
  bodyAssignments.length === 1
  && bodyAssignments[0].trim() === 'body = serializeTrajectoryBody(payload);'
  && /trajectoryCache\.set\([^;]*\{ at: Date\.now\(\), etag, body, raws/.test(route));

/* =====================================================================
 * 6 — the live route: the bytes on the wire are the bytes the serializer produced
 * ===================================================================== */

const home = mkdtempSync(join(tmpdir(), 'mmc-trajectory-body-'));
const SID = 'mvs_body_pieces';
const sessionDir = join(home, 'v2', 'sessions', '2026', '10', '22', '00-00-00-session_'
  + Buffer.from(SID, 'utf8').toString('base64url'));
await mkdir(sessionDir, { recursive: true });
const rows = [];
// Enough records that the body on the wire is bigger than one piece, so the live section
// exercises the path this change is about and not only the small-body case.
for (let index = 0; index < 12000; index += 1) {
  rows.push(JSON.stringify({
    message_id: 'm' + index,
    turn_id: 't' + (index >> 3),
    message: { role: 'user', content: 'PIECE ' + index, timestamp: 1791600000000 + index },
  }));
}
await writeFile(join(sessionDir, 'messages.jsonl'), rows.join('\n') + '\n', 'utf8');
await writeFile(join(sessionDir, 'manifest.json'), JSON.stringify({ sessionId: SID }), 'utf8');
const stamp = new Date(1791600000000);
await utimes(join(sessionDir, 'messages.jsonl'), stamp, stamp);

const previousRoot = process.env.MMC_TRAJECTORY_ROOT;
process.env.MMC_TRAJECTORY_ROOT = home;
const controller = new AbortController();
const noop = () => {};
let instance = null;
try {
  let port = 0;
  for (let attempt = 0; attempt < 12 && port === 0; attempt += 1) {
    const candidate = 20900 + Math.floor(Math.random() * 900) + attempt;
    try {
      instance = await start({
        pluginId: 'mmc-trajectory',
        pluginRoot: PLUGIN_ROOT,
        dataDir: home,
        generationId: 'guard',
        listen: { host: '127.0.0.1', port: candidate },
        signal: controller.signal,
        logger: { debug: noop, info: noop, warn: noop, error: noop },
      });
      port = candidate;
    } catch (error) {
      // The port was taken. Another one is tried; a guard that gave up here would be a guard
      // that sometimes checks nothing.
    }
  }
  assert('the service came up on a port of its own', port !== 0);
  if (port !== 0) {
    const base = 'http://127.0.0.1:' + port;
    const cold = await fetch(base + '/api/trajectory?session=' + encodeURIComponent(SID));
    const coldBytes = Buffer.from(await cold.arrayBuffer());
    const coldLength = Number(cold.headers.get('content-length'));
    assert('the cold body declares the length it really has', coldLength === coldBytes.length);
    // A body that cannot be parsed is read as no body at all rather than as a thrown error: the
    // throw would take this report with it, and the names above are what a mutation is caught by.
    let parsed = null;
    try {
      parsed = JSON.parse(coldBytes.toString('utf8'));
    } catch (error) {
      parsed = null;
    }
    assert('and it is a body the page can parse',
      parsed !== null && Array.isArray(parsed.turns) && parsed.turns.length > 0);
    assert('and it holds the records the session has',
      parsed !== null && Array.isArray(parsed.turns)
        ? parsed.turns.flatMap((turn) => turn.records || []).length === 12000
        : false);
    // The bytes on the wire have to be the ones the FILE holds. The route builds its own
    // payload, so the oracle here is the file this guard wrote: the ids are in it, and the
    // body has to carry them. A count and a parse are not enough -- a body can hold the
    // right number of records and be the wrong records.
    const idsInBody = ['m0', 'm11999'].every((id) => (
      coldBytes.includes(Buffer.from('"id":"' + id + '"', 'utf8'))
    ));
    assert('the bytes on the wire carry the records the file holds', idsInBody);

    // The warm read is the one that comes out of the cache, and the cache keeps PIECES now.
    const warm = await fetch(base + '/api/trajectory?session=' + encodeURIComponent(SID));
    const warmBytes = Buffer.from(await warm.arrayBuffer());
    assert('the warm body declares the length it really has',
      Number(warm.headers.get('content-length')) === warmBytes.length);
    assert('the warm body is the same bytes as the cold one', warmBytes.equals(coldBytes));

    // And the validator still answers, which is the one path that sends no body at all.
    const revalidated = await fetch(base + '/api/trajectory?session=' + encodeURIComponent(SID), {
      headers: { 'if-none-match': cold.headers.get('etag') || '' },
    });
    assert('a revalidated request is still answered with 304', revalidated.status === 304);
  }
} finally {
  if (instance) await instance.dispose();
  if (previousRoot === undefined) delete process.env.MMC_TRAJECTORY_ROOT;
  else process.env.MMC_TRAJECTORY_ROOT = previousRoot;
}

console.log('[trajectory-body] ' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('[trajectory-body] OK');
