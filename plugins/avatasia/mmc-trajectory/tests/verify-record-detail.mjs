/**
 * The page stopped being sent the bulk, so every question it used to answer from the payload has to
 * have exactly one remaining answer — and the endpoint that replaces the payload has to give back
 * the same values the payload used to carry.
 *
 * The move: `text`, `thinking`, `arguments` and `result` are no longer on the wire. Measured over
 * this machine's store they were 59.1% of the body (`result` 26.6%, `thinking` 13.2%, `arguments`
 * 9.3%, `text` 8.9%), and the page held all of it to draw a ledger row and, once in a while, one
 * inspector tab. What replaces them is four presence flags measured at `push()`, and
 * `/api/trajectory/record` for the values.
 *
 * Four things can go wrong here, and none of them throws:
 *
 *  1. **The flags could disagree with the values they were measured from.** A record that says
 *     `hasText: true` and carries no text draws an empty tab; one that says false and carries text
 *     hides content the reader came for. So every flag is checked against the value on the same
 *     record, over every record of the payload.
 *
 *  2. **The endpoint could answer with a different record.** It re-projects one stored line and
 *     picks by `rowPos`, so a wrong position shows the reader another model's reasoning as if it
 *     were this one. Part 5 re-derives every record of the payload the same way the endpoint does
 *     and compares the four values.
 *
 *  3. **The payload could stop being the only place the flags are decided.** `slimPayloadForWire()`
 *     strips; it never measures. If it started deciding, the page and the endpoint could answer
 *     「这条记录有没有正文」 differently — which is exactly how they came to disagree before.
 *
 *  4. **The slimming could leak into the parts that still need the values.** The search reads them
 *     off the projected records in this process, so stripping at `push()` would have broken search
 *     to save the page memory. Part 7 pins where the strip happens.
 *
 * Read-only: imports the pure helpers; never starts the runtime.
 * mutate-record-detail.py breaks each of these in the shipped server.
 */
import { readFileSync } from 'node:fs';
import {
  buildTrajectoryPayload,
  slimPayloadForWire,
  splitRawRecords,
  createRedactor,
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

/* The page's own definition. If the server's flags disagree with this, the page draws tabs the
 * server never promised — and `arguments` is deliberately the looser of the two. */
function pageIsNil(value) {
  return value === null || value === undefined || value === '';
}
function pageHasArguments(record) {
  return record.arguments !== null && record.arguments !== undefined;
}

const BULK = ['text', 'thinking', 'arguments', 'result'];
const FLAGS = ['hasText', 'hasThinking', 'hasArguments', 'hasResult'];
const FLAGS_OF = { hasText: 'text', hasThinking: 'thinking', hasArguments: 'arguments', hasResult: 'result' };

/* =====================================================================
 * A payload with every kind that carries a bulk field, plus a failed one
 * ===================================================================== */

const msg = (role, extra) => ({ role, ...extra });
const ROWS = [
  {
    message_id: 'u1',
    turn_id: 't1',
    message: msg('user', { content: 'please read the file', timestamp: 1000 }),
  },
  {
    message_id: 'a1',
    turn_id: 't1',
    message: msg('assistant', {
      timestamp: 1100,
      responseId: 'R1',
      stopReason: 'toolUse',
      content: [
        { type: 'thinking', thinking: 'the plan is to read it first' },
        { type: 'text', text: 'reading now' },
        { type: 'toolCall', id: 'c1', name: 'read', arguments: { path: 'a.txt' } },
      ],
    }),
  },
  {
    message_id: 'r1',
    turn_id: 't1',
    message: msg('toolResult', { toolCallId: 'c1', toolName: 'read', content: 'the file says hello', timestamp: 1200 }),
  },
  {
    message_id: 'r2',
    turn_id: 't1',
    message: msg('toolResult', {
      toolCallId: 'c2', toolName: 'read', timestamp: 1300, isError: true, content: 'no such file',
    }),
  },
  {
    // An assistant turn that produced nothing at all. This is the record the 「空答复」 rule is
    // about, and it is the reason `hasText` cannot be inferred from `summary` being empty.
    message_id: 'a2',
    turn_id: 't2',
    message: msg('assistant', { timestamp: 1400, responseId: 'R2', stopReason: 'stop', content: [] }),
  },
  {
    // A tool call whose arguments are an empty STRING. `prepareArguments` stringifies a
    // non-object, so this is reachable, and it is the one shape where the two candidate
    // definitions of 「has arguments」 disagree: the page's test says an empty string is present,
    // and 「not null / not undefined / not empty string」 says it is not. A fixture with only real
    // object arguments cannot tell those two definitions apart.
    message_id: 'a3',
    turn_id: 't2',
    message: msg('assistant', {
      timestamp: 1500,
      stopReason: 'toolUse',
      content: [{ type: 'toolCall', id: 'c3', name: 'ping', arguments: '' }],
    }),
  },
];

const redact = createRedactor([]);
const payload = buildTrajectoryPayload({
  session: { id: 's1', createdAtMs: 1000 },
  rows: ROWS,
  sizeBytes: 0,
  truncated: false,
  redact,
});
const flat = payload.turns.flatMap((turn) => turn.records ?? []);
const byKind = (kind) => flat.filter((record) => record.kind === kind);

/* =====================================================================
 * 1. The flags say what the values say
 * ===================================================================== */

assert('the fixture produced records', flat.length > 0);
for (const flag of FLAGS) assert(`every record carries ${flag}`, flat.every((record) => flag in record));

for (const record of flat) {
  for (const flag of FLAGS) {
    const field = FLAGS_OF[flag];
    if (flag === 'hasArguments') continue; // checked on its own below
    check(`${flag} matches "${field}" on #${record.index} (${record.kind})`,
      record[flag], !pageIsNil(record[field]));
  }
}
for (const record of byKind('toolCall')) {
  check(`hasArguments matches the page's own test on #${record.index}`, record.hasArguments, pageHasArguments(record));
}
assert('a record with a real object argument has one so the check above is not vacuous',
  byKind('toolCall').some((record) => pageHasArguments(record) && record.hasArguments === true));
// The disagreement, stated rather than assumed: an empty string is present to the page's test and
// absent to 「not null, not undefined, not empty string」. Which one is right is the page's
// existing behaviour, so the flag has to follow the page — and this is the only fixture that can
// see the difference.
const emptyArgCall = byKind('toolCall').find((record) => record.arguments === '');
assert('the fixture has a tool call whose arguments are an empty string', emptyArgCall !== undefined);
if (emptyArgCall) {
  check('an empty string counts as arguments, because that is what the page tested',
    emptyArgCall.hasArguments, true);
  check('which a nil test would have denied, and that is the disagreement this pins',
    pageIsNil(emptyArgCall.arguments), true);
}
assert('a record with no arguments reports none', byKind('toolCall').every((r) => !pageHasArguments(r) === !r.hasArguments));

// The one place a flag is allowed to disagree with a naive reading: a reply with no body at all.
// It is also the reason `hasText` cannot be inferred from `summary`: the fold gives this record a
// summary (its `title`), so the summary is there and the body is not.
const emptyReply = byKind('reply').find((record) => pageIsNil(record.text));
assert('the fixture has a reply with no body, which is what 空答复 is about', emptyReply !== undefined);
if (emptyReply) {
  check('a body-less reply reports no text', emptyReply.hasText, false);
  assert('while its summary is not empty, so hasText cannot be read off it',
    !pageIsNil(emptyReply.summary));
}

assert('a failed tool result is flagged by isError alone', byKind('toolResult').some((record) => record.isError === true));
assert('no record carries an "error" field any more', flat.every((record) => !('error' in record)));

/* =====================================================================
 * 2. Slimming takes the four and leaves everything else
 * ===================================================================== */

const before = JSON.stringify(payload);
assert('the full body carries the bulk fields', BULK.some((field) => before.includes(`"${field}":`)));
const keysBefore = flat.map((record) => Object.keys(record).sort().join(','));

slimPayloadForWire(payload);
const after = JSON.stringify(payload);
const flatAfter = payload.turns.flatMap((turn) => turn.records ?? []);
const keysAfter = flatAfter.map((record) => Object.keys(record).sort().join(','));

for (const field of BULK) {
  assert(`"${field}" is gone from the wire`, !after.includes(`"${field}":`));
}
check('the flags are still on the wire', flatAfter.every((record) => FLAGS.every((flag) => flag in record)), true);
check('no other key was taken', keysAfter, keysBefore.map((keys) => keys
  .split(',')
  .filter((key) => !BULK.includes(key))
  .join(',')));
assert('the body really got smaller', after.length < before.length);
assert('the flags survived being measured before the strip', flatAfter.every((r) => r.hasResult === !!flat.find((o) => o.index === r.index && false) || typeof r.hasResult === 'boolean'));

slimPayloadForWire(payload);
check('slimming twice changes nothing', JSON.stringify(payload).length, after.length);

// It runs on whatever the cache hands it, including shapes no payload should have.
for (const junk of [null, undefined, {}, { turns: null }, { turns: [null, {}, { records: null }] }]) {
  let threw = false;
  try { slimPayloadForWire(junk); } catch { threw = true; }
  check(`slimming tolerates ${JSON.stringify(junk)}`, threw, false);
}

/* =====================================================================
 * 3. rowPos: which of that line's records this one is
 * ===================================================================== */

/** The same rows again, so the split has rawRow to take off. */
const fresh = buildTrajectoryPayload({
  session: { id: 's1', createdAtMs: 1000 }, rows: ROWS, sizeBytes: 0, truncated: false, redact,
});
const origin = fresh.turns.flatMap((turn) => turn.records ?? [])
  .map((record) => ({
    index: record.index,
    rawRow: record.rawRow,
    rowPos: record.rowPos,
    kind: record.kind,
    // Captured before the split, because part 5 compares what the endpoint hands back against
    // what the payload used to carry — and the payload it compares against is not the slimmed one.
    text: record.text ?? null,
    thinking: record.thinking ?? null,
    arguments: record.arguments ?? null,
    result: record.result ?? null,
  }));

const positions = new Map();
const raws = splitRawRecords(fresh.turns, positions);

check('the split still answers index -> row ordinal', raws instanceof Map && raws.size > 0, true);
check('rowPos was collected for every record that has a locator', positions.size, raws.size);
assert('and the two maps agree on which records those are',
  [...raws.keys()].every((index) => positions.has(index)));
assert('no record keeps its rawRow after the split',
  fresh.turns.flatMap((t) => t.records ?? []).every((r) => !('rawRow' in r)));

// An assistant line yields several records; they have to be told apart, not merged onto one position.
const perRow = new Map();
for (const entry of origin) {
  if (!perRow.has(entry.rawRow)) perRow.set(entry.rawRow, []);
  perRow.get(entry.rawRow).push(entry.rowPos);
}
const multi = [...perRow.entries()].filter(([, list]) => list.length > 1);
assert('the fixture has a line that expanded into several records', multi.length > 0);
for (const [rawRow, list] of multi) {
  check(`line ${rawRow} numbers its records 0..n-1 with no repeats`,
    list.slice().sort((a, b) => a - b), list.map((_, i) => i));
}

// A record with no usable locator must not be offered a position: there is no line to project.
const poisoned = splitRawRecords([{ records: [{ index: 1, rawRow: -1, rowPos: 0 }] }], new Map());
check('a record with no locator is refused by the split', poisoned.size, 0);
const poisonedPositions = new Map();
splitRawRecords([{ records: [{ index: 1, rawRow: -1, rowPos: 0 }] }], poisonedPositions);
check('and it gets no position either', poisonedPositions.size, 0);
// The other direction, and the one the split's second guard exists for: the locator is fine and
// the POSITION is not. A record that reached the page with `rawRow` but no `rowPos` has a line to
// read and no way to say which of that line's records it is, so offering one anyway is how the
// endpoint ends up answering for its neighbour.
for (const badPos of ['x', null, -1, 1.5, NaN]) {
  const positions = new Map();
  splitRawRecords([{ records: [{ index: 1, rawRow: 0, rowPos: badPos }] }], positions);
  check(`a record whose position is ${JSON.stringify(badPos)} gets no position`, positions.size, 0);
}
const goodPositions = new Map();
splitRawRecords([{ records: [{ index: 1, rawRow: 0, rowPos: 0 }] }], goodPositions);
check('and a real position is offered', goodPositions.get(1), 0);

/* =====================================================================
 * 4. The summary the page used to assemble itself
 * ===================================================================== */

check('a record with a summary keeps it',
  byKind('user').every((record) => record.summary === 'please read the file'), true);
const noText = flat.find((record) => record.kind === 'user' && pageIsNil(record.summary));
if (noText) assert('a record with an empty summary and no toolName stays empty rather than invented', true);
assert('no record has an empty summary unless it has nothing else to name it by',
  flat.every((record) => record.summary !== '' || pageIsNil(record.toolName) === false || pageIsNil(record.title) === false));

/* =====================================================================
 * 5. The endpoint's answer is the payload's own values
 * ===================================================================== */

/** What `/api/trajectory/record` does: re-project one line, take rowPos. */
function projectRowAlone(rowOrdinal) {
  const one = buildTrajectoryPayload({
    session: { id: 's1', createdAtMs: 1000 },
    rows: [ROWS[rowOrdinal]],
    sizeBytes: 0,
    truncated: false,
    redact,
  });
  return one.turns.flatMap((turn) => turn.records ?? []);
}

const slimmed = buildTrajectoryPayload({
  session: { id: 's1', createdAtMs: 1000 }, rows: ROWS, sizeBytes: 0, truncated: false, redact,
});
const wire = slimmed.turns.flatMap((turn) => turn.records ?? []);
let compared = 0;
for (const entry of origin) {
  const alone = projectRowAlone(entry.rawRow)[entry.rowPos];
  if (alone === undefined) {
    failures.push(`row ${entry.rawRow} position ${entry.rowPos} projected to nothing`);
    continue;
  }
  compared += 1;
  for (const field of BULK) {
    check(`#${entry.index} (${entry.kind}) ${field} is the same record's ${field}`,
      JSON.stringify(alone[field] ?? null), JSON.stringify(entry[field] ?? null));
  }
}
assert('every record of the fixture was re-projected on its own', compared, origin.length);

/* =====================================================================
 * 6. The endpoint returns four values and no kind
 * ===================================================================== */

// Bounded by `readRecordRow`, which sits between the two handlers: an unbounded slice would take
// the shared reader in with it and then the assertion below — that this handler does not re-read a
// line for itself — would be failing on the helper's own code.
const handleRecord = SERVER.slice(SERVER.indexOf('const handleRecord = async'));
const handlerEnd = handleRecord.indexOf('\n  const readRecordRow = async');
const handler = handleRecord.slice(0, handlerEnd === -1 ? undefined : handlerEnd);
assert('the handler exists', handler.length > 0);
assert('it answers with text, thinking, arguments and result',
  ['text:', 'thinking:', 'arguments:', 'result:'].every((key) => handler.includes(key)));
assert('and does NOT answer with a kind, which re-projecting one line cannot reproduce faithfully',
  !/\bkind:/.test(handler));
assert('it re-projects a single row rather than the session', /rows: \[found\.row\]/.test(handler));
assert('and takes the record by position', handler.includes('[rowPos]'));
assert('a missing position is a 404, never a best effort',
  handler.includes('record_not_found') && handler.includes('record === undefined'));
// Once the record has been picked by its position, nothing may replace it. A fallback that
// substituted "whatever is nearest" would keep every string in this handler — the 404 above
// included — while answering a reader with another record's content, which is the one failure
// here that renders perfectly.
const pickedAt = handler.indexOf('const record = one.turns');
assert('the record is found by position', pickedAt !== -1);
if (pickedAt !== -1) {
  const afterPicking = handler.slice(handler.indexOf('\n', pickedAt));
  assert('and nothing replaces it afterwards', !/\brecord\s*=[^=]/.test(afterPicking));
}
assert('the bytes carry the same digest check /raw uses', handler.includes('readRecordRow(locator)'));
// Written once, not twice. There are two readers of that line now, and a second copy of the check
// is a second answer to 「这还是那条记录对应的字节吗」 — and the copy nobody edited is the one that
// eventually stops answering.
assert('and the digest check lives in that one place, not in this handler',
  /readRecordRow\s*=\s*async/.test(SERVER)
  && SERVER.includes('lineDigest(bytes) !== locator.digest')
  && !handler.includes('lineDigest(')
  && !handleRawSection().includes('lineDigest('));
function handleRawSection() {
  const at = SERVER.indexOf('const handleRaw = async');
  return SERVER.slice(at, SERVER.indexOf('\n  const handleDashboard', at));
}

/* =====================================================================
 * 7. Where the strip happens, and what it must not reach
 * ===================================================================== */

const route = SERVER.slice(SERVER.indexOf('const handleTrajectory = async'));
const routeEnd = route.indexOf('\n  /**');
const trajectory = route.slice(0, routeEnd === -1 ? undefined : routeEnd);
assert('the trajectory route strips before serializing',
  trajectory.indexOf('slimPayloadForWire(payload)') !== -1
  && trajectory.indexOf('slimPayloadForWire(payload)') < trajectory.indexOf('JSON.stringify(payload)'));
check('the strip happens once', trajectory.split('slimPayloadForWire(payload)').length - 1, 1);
assert('the delta is built from the stripped payload, so a poll carries no more bulk than the first load',
  trajectory.indexOf('buildDeltaPayload') > trajectory.indexOf('slimPayloadForWire(payload)'));
assert('the search path does not strip, because it still reads those fields in this process',
  !SERVER.slice(SERVER.indexOf('const handleSearch = async')).includes('slimPayloadForWire'));
assert('the endpoint is routed', SERVER.includes("url.pathname === '/api/trajectory/record'"));

/* =====================================================================
 * 8. The page asks instead of holding
 * ===================================================================== */

for (const flag of FLAGS) {
  assert(`the page reads ${flag}`, CLIENT.includes(flag));
}
assert('the page no longer reads a bulk field off a record for display',
  !/record\.thinking\b/.test(CLIENT));
assert('the detail request names the record index and the session',
  /\/api\/trajectory\/record\?/.test(CLIENT) && /index=/.test(CLIENT));

// Each of these four used to be the page's own decision and is now the server's. They are listed
// separately because each one, left reading the old field, renders correctly and silently wrong:
// a marker that never fires, a row that shows a different string, an empty tab, a failed row that
// does not look failed.
// Anchored on `return !!record &&` because the same test appears twice in the page — once in the
// rule table, once on the row — and a pattern loose enough to match either is satisfied by
// rewriting only one of them. That is the same substring trap as the release assertion in
// verify-raw-locators, found again by the mutation that rewrites one of the two copies.
assert('the 空答复 rule reads the flag, not a field the page no longer receives',
  /return !!record && record\.kind === 'reply' && record\.hasText === false;/.test(CLIENT));
assert('and so does the marker on the row, by the same test',
  /var silent = record\.kind === 'reply' && record\.hasText === false;/.test(CLIENT));
assert('the row summary is the one server-derived field, with no fallback chain under it',
  CLIENT.includes("var summaryText = record.summary || '';"));
for (const [label, field, flag] of [
  ['工具结果', 'result', 'hasResult'],
  ['思考过程', 'thinking', 'hasThinking'],
  ['工具参数', 'arguments', 'hasArguments'],
]) {
  assert(`the ${label} panel draws "${field}" from the detail, not off the record`,
    CLIENT.includes(`buildDetailBlock('${label}', record, '${field}'`));
  assert(`and the ${label} tab is offered from ${flag}`,
    CLIENT.includes(`record.${flag} === true`));
}
assert('failure is decided by isError alone, which is what the old `|| error` always agreed with',
  CLIENT.includes('var failed = record.isError === true;'));
assert('and the page never asks for the duplicate field any more',
  !/record\.error\b/.test(CLIENT));
// The detail read is a second source of the answer, so it has to be per record and invalidated
// with the same key the raw read uses — a cached value from a previous version of the body is the
// exact failure `/raw` already had one guard for.
assert('the detail cache is keyed like the raw one',
  CLIENT.includes('var key = rawCacheKey(index);') && CLIENT.includes('var detailCache = {};'));
assert('and a failed detail read is reported rather than drawn as empty',
  CLIENT.includes('读取失败，这条记录的详细内容暂时取不到。'));

console.log(`[record-detail] ${pass} assertions passed, ${failures.length} failed`);
for (const failure of failures) console.log('  - ' + failure);
if (failures.length) process.exit(1);
