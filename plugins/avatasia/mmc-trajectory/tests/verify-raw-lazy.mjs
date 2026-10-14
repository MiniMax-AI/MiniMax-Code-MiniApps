/**
 * 「原文过大，已省略」 must still be true — it just moved.
 *
 * Deciding it was the expensive part of every poll: buildRawPayload() serialized each message
 * to measure it against a 64 KB cap, so a rebuild serialized about 100 MB of message bodies to
 * answer a question the page asks for one record at a time, and threw the string away. The
 * record now carries the position of its message instead, and /raw builds it on request.
 *
 * That is a contract change, and a口径 that moved is a口径 nobody is watching. So every reader
 * of the old field is listed in docs/LAYERS.md D11 and asserted here by name, the cap is
 * asserted through the new path rather than dropped, and the one thing that must never come
 * back — the message body on the bulk response — is asserted absent.
 *
 * Read-only: imports the pure helpers, never starts the runtime.
 * mutate-raw-lazy.py breaks each of these in the shipped file.
 */
import { readFileSync } from 'node:fs';
import {
  buildRawPayload,
  buildTrajectoryPayload,
  createRedactor,
  splitRawRecords,
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

const MAX_RAW_BYTES = 65536;
const redact = createRedactor(['C:\\Users\\ava\\.minimax']);

/* =====================================================================
 * 1 — the bulk response stops carrying the message, and says where it is
 * ===================================================================== */

const rows = [
  {
    message_id: 'm1', turn_id: 't1', message: { role: 'user', content: 'hello', timestamp: 1791617886000 },
  },
  {
    message_id: 'm2',
    turn_id: 't1',
    message: {
      role: 'assistant',
      timestamp: 1791617891000,
      stopReason: 'stop',
      content: [{ type: 'text', text: 'the answer' }, { type: 'thinking', thinking: 'why' }],
    },
  },
  {
    message_id: 'm3', turn_id: 't2', message: { role: 'user', content: 'x'.repeat(MAX_RAW_BYTES * 2), timestamp: 1791617895000 },
  },
];

const payload = buildTrajectoryPayload({
  session: { id: 'sess', createdAtMs: 1791617886000 },
  rows,
  sizeBytes: 0,
  redact,
});
const records = payload.turns.flatMap((t) => t.records);
const locators = splitRawRecords(payload.turns);

check('every record was built', records.length, 4);
assert('no record carries a raw message body', records.every((r) => !('raw' in r)));
assert('no record carries the omitted verdict', records.every((r) => !('rawOmitted' in r)));
assert('every record has a locator', records.every((r) => Number.isInteger(locators.get(r.index))));
assert('every locator lands on a row', [...locators.values()].every((i) => rows[i] !== undefined));
// The locator is an internal address, not part of the answer. It is stripped on the way out,
// and a leftover one would ship `rawRow` to the page on every poll.
assert('the locator is stripped before the payload is serialized',
  records.every((r) => !('rawRow' in r)));

// A locator the caller cannot honour has to be dropped, not passed through: /raw would index
// `rows` with it and either throw or answer with a neighbour's message. Both are worse than a
// 404, so the split refuses anything that is not a real row position.
const poisoned = splitRawRecords([
  { records: [{ index: 1, rawRow: -1 }] },
  { records: [{ index: 2, rawRow: 'x' }] },
  { records: [{ index: 3, rawRow: 1.5 }] },
  { records: [{ index: 4, rawRow: null }] },
  { records: [{ index: 0, rawRow: 0 }] },
  { records: [{ index: 5 }] },
  { records: [{ index: 6, rawRow: 0 }] },
]);
check('a locator that is not a row position is dropped', [...poisoned.keys()], [6]);
check('a record index below 1 is not a record', poisoned.has(0), false);
check('a record with no locator is not entered at all', poisoned.has(5), false);
check('a null locator is not silently row zero', poisoned.has(4), false);

// One row can produce several records; they must all answer with the same message, which is
// what sharing a locator per row (rather than per record) means. Grouped by locator, not by
// turn — two different rows in one turn are two different messages.
const byLocator = new Map();
for (const record of records) {
  const key = locators.get(record.index);
  byLocator.set(key, (byLocator.get(key) || 0) + 1);
}
const shared = [...byLocator.values()].filter((n) => n > 1);
assert('a row that split into several records gives them one locator', shared.length > 0);
assert('and every locator is used by at most the records of its own row',
  Math.max(...byLocator.values()) === shared.sort((a, b) => b - a)[0]);

// And a locator resolves to its own row's message, not to a neighbour's.
const assistantLocator = [...byLocator.entries()].find(([, n]) => n > 1)[0];
const assistantRecord = records.find((r) => locators.get(r.index) === assistantLocator);
check('the locator resolves to the row it was cut from',
  rows[locators.get(assistantRecord.index)].message_id, 'm2');

/* =====================================================================
 * 2 — the cap still holds, on the path that now owns it
 * ===================================================================== */

const built = records.map((r) => buildRawPayload(rows[locators.get(r.index)].message, redact));
check('exactly one record is over the cap', built.filter((b) => b.omitted).length, 1);
assert('and it is the one whose message is large',
  built[built.findIndex((b) => b.omitted)].raw === undefined || built[built.findIndex((b) => b.omitted)].value === null);
assert('everything under the cap comes back with its message',
  built.filter((b) => !b.omitted).every((b) => b.value !== null && b.value !== undefined));
assert('nothing under the cap exceeds the cap',
  built.filter((b) => !b.omitted).every((b) => Buffer.byteLength(JSON.stringify(b.value), 'utf8') <= MAX_RAW_BYTES));

// A secret in a message must still be redacted on the way out.
const leaky = buildRawPayload(
  { role: 'user', content: 'see C:\\Users\\ava\\.minimax\\sessions\\x.jsonl', timestamp: 1 },
  redact,
);
check('a secret path is redacted on the way out', JSON.stringify(leaky.value).includes('.minimax'), false);
assert('and the message was still returned', leaky.omitted === false);

/* =====================================================================
 * 3 — the server builds it on request, and the answer carries the verdict
 * ===================================================================== */

const handleRawAt = SERVER.indexOf('const handleRaw = async');
assert('handleRaw exists', handleRawAt > 0);
const handleRawBody = SERVER.slice(handleRawAt, SERVER.indexOf('};', handleRawAt));
assert('it calls buildRawPayload, i.e. it builds rather than looks up a stored message',
  handleRawBody.includes('buildRawPayload(row.message, redact)'));
assert('it follows the locator back into the file the record came from',
  handleRawBody.includes('readRange(locator.filePath, locator.start, locator.end)'));
assert('it reports the verdict alongside the message', /omitted: built\.omitted/.test(handleRawBody));
assert('a missing row is still a 404, not an empty message', handleRawBody.includes("'record_not_found'"));
// The entry shape lives in createTrajectoryCache now, so this asserts the thing the assertions
// above jointly depend on: the route stores the record->locator map into the entry, and /raw reads
// `cached.raws` back out of it. It used to store `rows` and read `cached.rows`, which is the thing
// that was costing 233 MB; anchoring on the JSDoc type comment instead would have made this a
// check on where a type was written rather than on what the route does.
assert('the cache entry keeps the locators /raw follows, keyed by record',
  SERVER.includes('raws, decoded: new Map() })')
  && handleRawBody.includes('cached.raws.get(wanted)'));

/* =====================================================================
 * 4 — each of the five readers, by name
 *
 * D11 lists them. A reader left behind would either silently lose the 「过大」 notice or read a
 * field that no longer exists, and neither shows up in a functional test.
 * ===================================================================== */

assert('1 handoff: the line reads the argument, not the record',
  CLIENT.includes("if (rawOmitted) lines.push('- 提示：原文过大已被省略。');"));
assert('1 handoff: buildHandoffMarkdown takes the verdict',
  /function buildHandoffMarkdown\(session, turn, record, rawText, rawTruncated, rawOmitted\)/.test(CLIENT));
assert('1 handoff: the caller passes it', CLIENT.includes('raw.truncated,\n            omitted\n          );'));

assert('2 rawSourceFor: no longer short-circuits on the record',
  /function rawSourceFor\(record\) \{\s*return fetchRaw\(record\);/.test(CLIENT));
assert('2 rawSourceFor: documents the new shape', CLIENT.includes('Resolves to `{ raw, omitted }`'));

assert('3 raw tab: draws the omitted note from the answer',
  CLIENT.includes('if (fetched.omitted === true) {'));
assert('3 raw tab: and the note still says the same thing',
  CLIENT.includes('原文过大，已省略。可以从参数与结果页查看已保留的部分。'));

assert('4 raw tab: an omitted message renders the dash', CLIENT.includes('pre.textContent = DASH;\n            return;'));
assert('5 copySelected: reads the new shape',
  CLIENT.includes('var noRaw = fetched.omitted === true || fetched.raw === null || fetched.raw === undefined;'));
assert('handoff: reads the new shape', CLIENT.includes('var omitted = fetched.omitted === true;'));

assert('fetchRaw caches the verdict, not just the message',
  CLIENT.includes("var entry = { raw: result.body.raw, omitted: result.body.omitted === true };"));

/* =====================================================================
 * 5 — the field is gone from the client, entirely
 * ===================================================================== */

const stale = [...CLIENT.matchAll(/record\.rawOmitted|record && record\.rawOmitted/g)];
check('no reader still looks for rawOmitted on a record', stale.length, 0);
assert('and the payload no longer carries it either',
  !SERVER.includes('rawOmitted: raw.omitted') && !SERVER.includes('raw: raw.value'));

/* =====================================================================
 * 6 — internalOnly: a record the runtime keeps for itself
 * ===================================================================== */

// Its own payload rather than a fourth row above, so the counts the sections above assert on
// stay the counts they were calibrated against. docs/LAYERS.md D17.

const hostOnlyRows = [
  {
    message_id: 'h1',
    turn_id: 't1',
    message: {
      role: 'custom',
      customType: 'background_task_read_settlement',
      content: '',
      display: false,
      hostMetadata: { providerVisibility: 'omit' },
      timestamp: 1791617900000,
    },
  },
  {
    // A custom record that is NOT host-only. The role alone must not be enough — that is the
    // difference between "the runtime wrote this" and "the runtime wrote this for itself".
    message_id: 'h2',
    turn_id: 't1',
    message: {
      role: 'custom',
      customType: 'todo_cadence_reminder',
      content: '<system-reminder>keep going</system-reminder>',
      timestamp: 1791617901000,
    },
  },
  {
    // providerVisibility present but not 'omit'.
    message_id: 'h3',
    turn_id: 't1',
    message: {
      role: 'custom',
      customType: 'something_else',
      content: 'visible',
      hostMetadata: { providerVisibility: 'pass' },
      timestamp: 1791617902000,
    },
  },
  {
    // The omit marker on a non-custom role must not be honoured either: the runtime's own
    // isHostOnlyMessage() requires role === 'custom' before it looks at hostMetadata.
    message_id: 'h4',
    turn_id: 't1',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'answer' }],
      stopReason: 'stop',
      hostMetadata: { providerVisibility: 'omit' },
      timestamp: 1791617903000,
    },
  },
];

const hostOnlyRecords = buildTrajectoryPayload({
  session: { id: 'sess', createdAtMs: 1791617886000 },
  rows: hostOnlyRows,
  sizeBytes: 0,
  redact,
}).turns.flatMap((t) => t.records);

const flagged = hostOnlyRecords.filter((r) => r.internalOnly === true);
check('exactly the settlement record is flagged internal', flagged.length, 1);
assert('and it is the one carrying providerVisibility: omit',
  flagged.length === 1 && flagged[0].id === 'h1');
assert('a custom record without the omit marker is not flagged',
  hostOnlyRecords.filter((r) => r.id === 'h2').every((r) => r.internalOnly === false));
assert('a different providerVisibility value is not flagged',
  hostOnlyRecords.filter((r) => r.id === 'h3').every((r) => r.internalOnly === false));
assert('the omit marker on an assistant record is not honoured',
  hostOnlyRecords.filter((r) => r.id === 'h4').every((r) => r.internalOnly === false));
// False, not undefined: a page that checks truthiness and a page that checks `=== true` must
// agree, and a field that only exists sometimes is how the two drift apart.
assert('every record carries the field, so it is never undefined',
  hostOnlyRecords.every((r) => typeof r.internalOnly === 'boolean'));
// The record is still emitted. Dropping these rows would renumber every record after them,
// because `index` counts emitted rows — see docs/LAYERS.md D17.
assert('a host-only record is still in the payload, still numbered',
  flagged.length === 1 && typeof flagged[0].index === 'number');

/* ===================================================================== */

if (failures.length) {
  console.error(`\n[raw-lazy] ${failures.length} FAILED, ${pass} passed`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`\n[raw-lazy] ${pass} assertions passed`);