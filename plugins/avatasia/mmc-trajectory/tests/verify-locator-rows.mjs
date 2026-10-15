/**
 * Where each record sat in the file it came from.
 *
 * `locatorRowsFromPayload` produces the locator triple that a segment line carries in its JSON
 * prefix, so a search hit in a sealed generation can be mapped back to the line it came from long
 * after the row objects that knew that have stopped existing. It used to be `indexRowsFromPayload`
 * in a module called `trajectory-index`, returning a whole index row per record so the index
 * artifact could be written; nothing ever read that artifact back, so the extra shape was built on
 * every publish and read by one caller that wanted three of those fields.
 *
 * The case this file exists for is the one the other end cannot cover. `verify-search-segments.mjs`
 * asserts that a record carrying **no locator fields at all** is serialised with `-1/-1/-1` — but
 * that is `buildSegment` normalising an empty input, and it never calls this projection. If the
 * projection repaired an unlocated record to file `0`, `buildSegment` would faithfully carry that
 * `0` out into the segment and every one of those 122 assertions would still pass. The server
 * groups records by `located.fileIdx === fileIdx`, so a record silently filed under the first
 * source file is a record answered from a different generation's message.
 *
 * Which is why the `-1` assertions here are about **the projection**, not about the segment, and
 * why they moved here with the function rather than being assumed to already exist downstream.
 *
 * Read-only, pure: the projection has no I/O and this file writes nothing.
 * `mutate-locator-rows.py` breaks each of these in the shipped module.
 */
import { locatorRowsFromPayload } from '../miniapp/node/search-segments.mjs';

let pass = 0;
const failures = [];
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass += 1;
  else failures.push(`${name}\n      got  ${JSON.stringify(actual)}\n      want ${JSON.stringify(expected)}`);
}
function assert(name, cond) {
  if (cond) pass += 1;
  else failures.push(name);
}

/* ------------------------------------------------------------------ fixtures */
/* `index` is the only field the projection reads off a record, so a record is one number here. */
const payloadOf = (indexes) => ({
  turns: indexes.map((indexesInTurn, t) => ({
    index: t + 1,
    records: indexesInTurn.map((index) => ({ index }))
  }))
});
const FLAT = [1, 2, 3, 4, 5, 6];
const PAYLOAD = payloadOf([FLAT.slice(0, 3), FLAT.slice(3)]);

/* Two generations, deliberately named so a basename match would confuse them: both files are
 * called `messages.jsonl`, because that is exactly how a lineage lays out. */
const FILES = [
  { filePath: '/store/s/snapshots/g0/messages.jsonl', fileName: 'messages.jsonl', generation: 0 },
  { filePath: '/store/s/active/messages.jsonl', fileName: 'messages.jsonl', generation: 1 }
];
const loc = (filePath, start, end) => ({ filePath, start, end, digest: 'd' });

const rawsOf = (entries) => new Map(entries.map(([index, locator]) => [index, locator]));

/* Everything in the first file except the last record, which is in the second. Byte 0 is a real
 * position here on purpose: `-1` has to stay distinguishable from it. */
const raws = rawsOf([
  [1, loc(FILES[0].filePath, 0, 120)],
  [2, loc(FILES[0].filePath, 121, 260)],
  [3, loc(FILES[0].filePath, 261, 400)],
  [4, loc(FILES[1].filePath, 0, 90)],
  [5, loc(FILES[1].filePath, 91, 200)],
  [6, loc(FILES[1].filePath, 201, 340)]
]);
const rows = locatorRowsFromPayload(PAYLOAD, raws, FILES);

/* ------------------------------------------------------------------ order and shape */
check('one entry per record, in the order the payload is walked',
  rows.length, FLAT.length);
assert('and the order is the payload\'s, not sorted by file or byte',
  rows.map((r) => r.byteStart).join(',') !== '0,0,0,121,201,261');
check('every entry carries exactly the locator triple',
  Object.keys(rows[0]).sort(), ['byteEnd', 'byteStart', 'fileIdx']);

check('each record names the file its locator names',
  rows.map((r) => r.fileIdx), [0, 0, 0, 1, 1, 1]);
check('each record carries where its line sat',
  rows.map((r) => r.byteStart), [0, 121, 261, 0, 91, 201]);
check('and where it ended',
  rows.map((r) => r.byteEnd), [120, 260, 400, 90, 200, 340]);

/* Byte 0 is a position a record really can have, so `-1` cannot be confused with it. */
assert('byte 0 is a real position in this fixture, so -1 is distinguishable from it',
  rows[0].byteStart === 0 && rows[3].byteStart === 0);

/* Two generations both hold a `messages.jsonl`. A basename match would file the second
 * generation's records under the first, which is a different generation's message. */
assert('the two source files really do share a basename',
  FILES[0].fileName === FILES[1].fileName);

/* ------------------------------------------------- a record whose line was never located */
/* The full map minus ONE entry, so exactly one record is unlocated. Building a sparse map by hand
 * instead would leave three records unlocated and the "exactly one" assertions below would be
 * measuring the fixture rather than the projection. */
const partialRaws = rawsOf([...raws].filter(([index]) => index !== 3));
const partial = locatorRowsFromPayload(PAYLOAD, partialRaws, FILES);

check('a record with no locator says file -1', partial[2].fileIdx, -1);
check('and its neighbours keep theirs', [partial[1].fileIdx, partial[3].fileIdx], [0, 1]);
check('no record silently became file 0', partial.filter((r) => r.fileIdx === -1).length, 1);
check('a record with no locator has no line position either',
  [partial[2].byteStart, partial[2].byteEnd], [-1, -1]);

/* The same question asked of the OTHER kind of "no location": the locator exists but names a file
 * that is not in the table. That is a source that moved, and it must not be filed under file 0
 * either — the two cases reach file 0 by different routes and both would answer from the wrong
 * generation. */
const movedRaws = rawsOf([
  [1, loc('/store/s/snapshots/g0/messages.jsonl', 0, 120)],
  [2, loc('/store/s/elsewhere/gone.jsonl', 10, 20)]
]);
const moved = locatorRowsFromPayload(PAYLOAD, movedRaws, FILES);
check('a locator whose file is not in the table says file -1, not file 0', moved[1].fileIdx, -1);
check('but it keeps the byte range it was handed',
  [moved[1].byteStart, moved[1].byteEnd], [10, 20]);

/* ------------------------------------------------------------------ empty and odd inputs */
check('a payload with no records projects to nothing',
  locatorRowsFromPayload(payloadOf([]), new Map(), FILES).length, 0);
check('an empty locator map leaves every record unlocated, not every record in file 0',
  locatorRowsFromPayload(PAYLOAD, new Map(), FILES).map((r) => r.fileIdx), [-1, -1, -1, -1, -1, -1]);
check('no source files at all is the same as no location',
  locatorRowsFromPayload(PAYLOAD, raws, []).map((r) => r.fileIdx), [-1, -1, -1, -1, -1, -1]);

/* First writer wins: a path is only in the table once per session, and a duplicated path must not
 * make the second entry reachable in a way that depends on iteration order. */
const dupFiles = [FILES[0], { filePath: FILES[0].filePath, fileName: 'copy', generation: 9 }];
check('a path listed twice still resolves to the first file that claimed it',
  locatorRowsFromPayload(PAYLOAD, raws, dupFiles).map((r) => r.fileIdx), [0, 0, 0, -1, -1, -1]);

/* ---------------------------------------------------------------------- report */
console.log('locator-rows: ' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  for (const f of failures) console.log('FAIL  ' + f);
  process.exit(1);
}
console.log('ALL CHECKS PASSED');
