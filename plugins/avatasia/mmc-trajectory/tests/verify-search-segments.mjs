/**
 * A search segment has to search what the page was searching, and only whole records.
 *
 * The page searches five fields per record (`recordSearchText`, client/index.html). This module
 * stores those five fields once per sealed generation so the question does not have to be re-asked
 * of 198 MB. Two things follow, and both are pinned here rather than asserted in a comment:
 *
 *  1. **The surface is the page's function, not a paraphrase of it.** The field list and its ORDER
 *     are load-bearing — two lists differing only in order produce different surfaces, so a phrase
 *     spanning two of them hits in one build and misses in another. The page's own implementation is
 *     reproduced below and compared field for field.
 *
 *  2. **A scan may not cross a record boundary.** One record's surface is one line and the scan
 *     tests each line alone. Joining the surfaces into one blob would let a needle starting at the
 *     end of one record and finishing at the start of the next report a match belonging to neither —
 *     and a measurement that found zero such false hits on real data is luck, not a property. So the
 *     fixture below CONSTRUCTS one and the scan has to refuse it.
 *
 * Plus the artifact rules: a half-published segment is never consumed, each line carries the answer
 * the reader needs, a batch of hits is read in ONE walk, and nothing in the segment carries a machine
 * path.
 *
 * Read-only: imports the pure helpers and writes only under a temp dir it makes itself.
 * mutate-search-segments.py breaks each of these in the shipped module.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_HITS,
  MIN_NEEDLE_CHARS,
  SEARCH_FIELDS,
  buildSegment,
  capHits,
  createSegmentStore,
  digestOf,
  foldNeedle,
  generationKey,
  needleIsUsable,
  normaliseWhitespace,
  readSegmentHits,
  sameSource,
  scanSegment,
  searchSurfaceOf,
} from '../miniapp/node/search-segments.mjs';

const SEGMENT_PATH = new URL('../miniapp/node/search-segments.mjs', import.meta.url);

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

/* =====================================================================
 * 1 — the surface is the page's own function
 * ===================================================================== */

// Transcribed from client/index.html `recordSearchText` and `safeText`. Deliberately a COPY: the
// point of the comparison is that the two implementations agree, and importing the page's would
// make the check true by construction.
function safeText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value.text !== undefined) return safeText(value.text);
  return '';
}
function pageRecordSearchText(record) {
  if (!record || typeof record !== 'object') return '';
  const thinking = record.thinking;
  const thinkingText = thinking && typeof thinking === 'object'
    ? safeText(thinking.text !== undefined ? thinking.text : thinking)
    : safeText(thinking);
  return [record.summary, record.text, safeText(record.result), thinkingText, record.toolName]
    .map((part) => safeText(part))
    .join('\n')
    .toLowerCase();
}

const RECORDS = [
  { summary: 'the first answer', text: 'a longer Body of the reply', result: null, thinking: null, toolName: null },
  { summary: 'Reading a file', text: null, result: 'file contents here', thinking: null, toolName: 'read' },
  { summary: 'Thinking it over', text: null, result: null, thinking: { text: 'weighing the options' }, toolName: null },
  { summary: '', text: null, result: null, thinking: null, toolName: 'grep' },
  { summary: 'No text at all', text: null, result: null, thinking: null, toolName: null },
  // A record whose five fields are all empty. It searches as nothing, but it still OCCUPIES its
  // ordinal — a scan that counted only non-empty lines would number everything after it one short,
  // and every later hit would resolve to the record before the one that matched.
  { summary: '', text: '', result: '', thinking: null, toolName: '' },
  { summary: 'A summary with\nan embedded newline', text: 'line one\nline two', result: null, thinking: null, toolName: null },
  { summary: null, text: null, result: null, thinking: null, toolName: null },
];

check('the field list is the page\'s, in the page\'s order',
  SEARCH_FIELDS, ['summary', 'text', 'result', 'thinking', 'toolName']);
// The page does not search any more — the server does, from segments — so the list cannot be
// pinned against a client function that is gone. What still has to be true is that every field the
// segment stores is something the reader is shown, or a search finds text nobody can open. Read
// out of the shipped client rather than out of this file's own copy, or the check is true by
// construction.
const CLIENT = readFileSync(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
check('the field list is the five the page can show',
  SEARCH_FIELDS, ['summary', 'text', 'result', 'thinking', 'toolName']);
// Every field the segment stores must be something the reader is shown, or a search finds text
// nobody can open. Three of them are no longer on the row — they arrive from the record-detail
// read — so the check follows the value to where it is drawn rather than to where it used to live.
// `text` is the honest exception and always was: no inspector tab has ever rendered it, and what a
// hit on it leads to is the 原文 tab, which every record has.
const SHOWN_FROM_DETAIL = [['result', '工具结果'], ['thinking', '思考过程'], ['arguments', '工具参数']];
for (const field of ['summary', 'toolName']) {
  assert(`the page renders "${field}", so a hit on it leads somewhere`,
    CLIENT.includes(`record.${field}`));
}
for (const [field, label] of SHOWN_FROM_DETAIL) {
  assert(`the page renders "${field}", so a hit on it leads somewhere`,
    CLIENT.includes(`buildDetailBlock('${label}', record, '${field}'`));
}
assert('a hit on "text" still leads somewhere: 原文 is on every record',
  CLIENT.includes("{ id: 'raw', label: '原文', available: function () { return true; } }")
  && /if \(tabId === 'raw'\) return buildRaw\(record\);/.test(CLIENT));
assert('the page has no local search left to disagree with',
  !/recordSearchText/.test(CLIENT) && !/indexOf\(String\(needle\)/.test(CLIENT));

// The page's surface under the ONE normalisation the module states: runs of whitespace become one
// space, ends trimmed. Anything else — a field dropped, a field reordered, a field read in the
// wrong shape — shows up here as a string that differs.
const pageSurface = (record) => normaliseWhitespace(pageRecordSearchText(record));
for (let i = 0; i < RECORDS.length; i += 1) {
  check(`record ${i} searches as the page searched it, under the stated normalisation`,
    searchSurfaceOf(RECORDS[i]), pageSurface(RECORDS[i]));
}

// And the property that string equality alone cannot see: the same needle finds the same RECORDS.
const NEEDLES = new Set(['', 'the', 'answer', 'grep', 'file', 'weighing', 'newline', 'answer a longer']);
for (const record of RECORDS) {
  const words = pageSurface(record).split(' ').filter(Boolean);
  for (let i = 0; i + 2 < words.length; i += 1) NEEDLES.add(words.slice(i, i + 3).join(' '));
  for (const word of words) NEEDLES.add(word);
}
let mismatch = [];
const builtSurface = buildSegment({ records: RECORDS }).surface;
for (const needle of NEEDLES) {
  const folded = foldNeedle(needle);
  if (folded === '') continue;
  const onSurface = scanSegment(builtSurface, folded);
  const onPage = RECORDS
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => pageSurface(r).includes(folded))
    .map(({ i }) => i);
  if (JSON.stringify(onSurface) !== JSON.stringify(onPage)) mismatch.push(`${needle}: ${onSurface} vs ${onPage}`);
}
check(`the surface finds exactly what the page found, over ${NEEDLES.size} needles`, mismatch, []);
// And the needle's own whitespace cannot change the answer.
check('a needle with odd whitespace finds what the tidy one finds',
  scanSegment(builtSurface, foldNeedle('  the   first  ')), scanSegment(builtSurface, foldNeedle('the first')));
check('the page would NOT have matched a needle spanning its field separator, and that is stated',
  pageRecordSearchText(RECORDS[0]).includes('answer a longer'), false);

check('a record with no fields searches as empty', searchSurfaceOf(null), '');
check('a record whose summary is empty searches as empty', searchSurfaceOf({}), '');
assert('the surface is folded once, at build time',
  searchSurfaceOf({ summary: 'MiXeD Case' }) === 'mixed case');
// One line per record is what makes a scan's line number the record ordinal. The first draft joined
// the five fields with the page's newline and produced five lines per record, so `scanSegment`
// answered with line numbers while the locators were numbered by record — and every hit resolved to
// whichever record sat at that line.
assert('a record with five fields is still one line',
  !searchSurfaceOf({ summary: 'a', text: 'b', result: 'c', thinking: { text: 'd' }, toolName: 'e' }).includes('\n'));
check('its five fields are all still searchable',
  scanSegment(buildSegment({
    records: [{ summary: 'alpha', text: 'beta', result: 'gamma', thinking: { text: 'delta' }, toolName: 'epsilon' }],
  }).surface, 'beta'), [0]);
check('and it is still one line in the built surface',
  buildSegment({
    records: [{ summary: 'alpha', text: 'beta', result: 'gamma', thinking: { text: 'delta' }, toolName: 'epsilon' }],
  }).surface.split('\n').length, 1);
// Located by content, not by index: this fixture has grown records and an assertion pinned to a
// position would then be checking a different record while still reading as if it were the same one.
const newlineRecord = RECORDS.findIndex((r) => String(r.summary).includes('\n'));
assert('the fixture really does carry a record with an embedded newline', newlineRecord >= 0);
assert('and that record is one line on the surface',
  !searchSurfaceOf(RECORDS[newlineRecord]).includes('\n'));
check('and its two halves are still searchable together',
  scanSegment(builtSurface, foldNeedle('with an embedded newline')), [newlineRecord]);
check('and a needle spanning two fields of one record is found, which is the point of the space',
  scanSegment(builtSurface, foldNeedle('answer a longer')), [0]);

check('a record with no fields searches as empty', searchSurfaceOf(null), '');
check('a record whose summary is empty searches as empty', searchSurfaceOf({}), '');
assert('the surface is folded once, at build time',
  searchSurfaceOf({ summary: 'MiXeD Case' }) === 'mixed case');
assert('a record with five fields is still one line',
  !searchSurfaceOf({ summary: 'a', text: 'b', result: 'c', thinking: { text: 'd' }, toolName: 'e' }).includes('\n'));
check('all five of those fields are still on that one line',
  searchSurfaceOf({ summary: 'a', text: 'b', result: 'c', thinking: { text: 'd' }, toolName: 'e' }),
  'a b c d e');

/* =====================================================================
 * 2 — a scan cannot answer with a record that does not exist
 * ===================================================================== */

// One answer out of a one-element batch. There is no per-ordinal reader to call, and that is
// deliberate rather than incidental — see the batch block below.
const oneHit = (surface, ordinal) => readSegmentHits(surface, [ordinal])[0] ?? null;

const segment = buildSegment({ records: RECORDS });
check('one surface line per record', segment.surface.split('\n').length, RECORDS.length);

// The line carries its own answer, which is why a search no longer reads the session's record
// index: matching 14 records out of 36,525 should not have to parse the other 36,511. Read as one
// batch, because that is the only shape the reader has — see the batch block further down.
const answered = readSegmentHits(segment.surface, RECORDS.map((_, i) => i));
assert('every line reads back at all', answered.every((h) => h !== null));
check('and the ledger index it reads back is the record it describes',
  answered.map((h) => (h === null ? null : h.index)),
  RECORDS.map((r) => (typeof r.index === 'number' ? r.index : -1)));
check('the summary it reads back is the record\'s own', answered.map((h) => (h === null ? null : h.summary)), RECORDS.map((r) => (typeof r.summary === 'string' ? r.summary : '')));
check('and so is its kind', answered.map((h) => (h === null ? null : h.kind)), RECORDS.map((r) => (typeof r.kind === 'string' ? r.kind : '')));
check('and its generation', answered.map((h) => (h === null ? null : h.generation)), RECORDS.map((r) => (typeof r.generation === 'number' ? r.generation : null)));
assert('a line past the end reads back as nothing rather than as the last record',
  oneHit(segment.surface, RECORDS.length + 5) === null);
assert('and neither does a negative ordinal', oneHit(segment.surface, -1) === null);
assert('nor one that is not a whole number', oneHit(segment.surface, 1.5) === null);

/* ---------------------------------------------------------------------
 * THE READER TAKES A BATCH, AND THE REASON IS COST.
 *
 * The first version took ONE ordinal and scanned from byte zero to find
 * it. That is fine for a guard checking one record and catastrophic for
 * the route: a needle like "the" matched 14,092 records on the largest
 * session on this machine, so it walked a 1.3 MB segment 14,092 times —
 * eighteen gigabytes of walking to answer one search, and measured
 * SLOWER than the 34.2 MB index read this work was meant to remove.
 *
 * Nothing about that was wrong in the answers. Every hit still named the
 * right record. So no assertion about values could have caught it, which
 * is why the cost is pinned here instead: the walk is counted.
 *
 * The bound is an UPPER bound, on purpose. A single walk costs about two
 * per-line string calls, so anything that stopped using indexOf/slice and
 * walked some other way would read as ZERO calls and pass — a guard that
 * fails safe in the direction of not complaining about a correct rewrite.
 * The form that must not come back overshoots by the number of ordinals
 * asked for, which is the factor the bound cannot absorb.
 * --------------------------------------------------------------------- */
// Ledger indices that are deliberately out of step with their ordinals, so an answer ordered by
// position in the segment cannot pass for an answer ordered by the question.
const namedSurface = buildSegment({
  records: [{ summary: 'alpha', index: 40 }, { summary: 'beta', index: 41 }, { summary: 'gamma', index: 42 }],
}).surface;
check('the batch reader answers in the order asked, not the order they sit',
  readSegmentHits(namedSurface, [2, 0, 1]).map((h) => (h === null ? null : h.index)), [42, 40, 41]);
check('a repeated ordinal answers once per asking rather than collapsing',
  readSegmentHits(namedSurface, [1, 1, 1]).map((h) => (h === null ? null : h.index)), [41, 41, 41]);
check('an empty batch is answered with nothing, and reads nothing',
  readSegmentHits(namedSurface, []).length, 0);
{
  const N = 200;
  const wide = buildSegment({ records: Array.from({ length: N }, (_, i) => ({ summary: `record ${i}` })) });
  const asked = Array.from({ length: N }, (_, i) => N - 1 - i);
  let calls = 0;
  // A boxed String: every per-line operation the reader does goes through a method on it, so they
  // can be tallied without the module having to cooperate by exposing a counter.
  const counted = new String(wide.surface);
  for (const method of ['indexOf', 'slice', 'substring', 'substr']) {
    const original = String.prototype[method];
    counted[method] = function tally(...args) { calls += 1; return original.apply(this, args); };
  }
  const wideAnswers = readSegmentHits(counted, asked);
  check('a whole segment asked back to front answers every ordinal',
    wideAnswers.map((h) => (h === null ? null : h.summary)), asked.map((i) => `record ${i}`));
  assert(`reading ${N} answers out of ${N} lines takes one walk (counted ${calls} per-line string calls)`,
    calls <= 4 * N);
}
// The structural half of the same rule. A per-ordinal reader could be reintroduced without breaking
// anything above — the batch reader would still be correct, and the O(n²) form would simply sit next
// to it waiting to be called. Read the module's whole export list, because the named import at the
// top of this file cannot see an export it does not name.
const SEGMENTS = await import(SEGMENT_PATH);
assert('and there is no per-ordinal reader exported for a caller to reach for by mistake',
  typeof SEGMENTS.readSegmentHit === 'undefined' && typeof SEGMENTS.readSegmentHits === 'function');

// The JSON prefix holds the answer, so a needle must not be able to match it. Otherwise a search
// for a record's kind would return every record of that kind whether its text says so or not.
const kindNeedle = RECORDS[0].kind;
check('a needle that is only in the answer, not in the text, finds nothing',
  scanSegment(buildSegment({ records: [{ kind: kindNeedle, summary: 'zzz nothing alike', text: null, result: null, thinking: null, toolName: null }] }).surface,
    foldNeedle(kindNeedle)), []);

// The direct statement of the line-number bug, as an assertion: for every record, that record's own
// surface finds that record, AT THAT RECORD'S ORDINAL. A surface that kept the page's newline
// separator between its five fields produced one line per FIELD, so the scan answered with field
// ordinals while the locators were numbered by record — and a hit resolved to whichever record
// happened to sit at that line. The per-needle equivalence above cannot see it, because both sides
// shift together; only the ordinal can.
let wrongOrdinal = [];
for (let i = 0; i < RECORDS.length; i += 1) {
  const own = searchSurfaceOf(RECORDS[i]);
  if (own === '') continue;
  const hits = scanSegment(segment.surface, foldNeedle(own));
  if (!hits.includes(i)) wrongOrdinal.push(`${i}: ${JSON.stringify(hits)}`);
}
check("each record's own surface finds that record, at its own ordinal", wrongOrdinal, []);

check('a word in a summary is found', scanSegment(segment.surface, foldNeedle('answer')), [0]);
check('a word in the body text is found', scanSegment(segment.surface, foldNeedle('longer body')), [0]);
check('a word in a tool result is found', scanSegment(segment.surface, foldNeedle('contents here')), [1]);
check('a word in a thinking block is found', scanSegment(segment.surface, foldNeedle('weighing')), [2]);
check('a tool name is found', scanSegment(segment.surface, foldNeedle('grep')), [3]);
check('the needle is folded the same way the surface was',
  scanSegment(segment.surface, foldNeedle('ANSWER')), [0]);

// The boundary, constructed rather than observed: one record ends with `record` and the next begins
// with `the first`. The needle belongs to neither. The control below flattens the searchable parts
// to one string, which reports a match that exists in no record.
const boundaryRecords = [
  { summary: 'the last word of one record' },
  { summary: 'the first word of the next' },
];
const boundarySegment = buildSegment({ records: boundaryRecords });
// The hazard is stated over the searchable parts themselves, because that is what a joined blob
// would have been built from. The stored text cannot simply be joined and tested: each line now
// carries a JSON prefix, so a join would splice two records' text through a record's own answer and
// the demonstration would be testing the prefix rather than the boundary.
const joinedSearchable = boundaryRecords.map(searchSurfaceOf).join(' ');
check('a needle spanning two records matches nothing', scanSegment(boundarySegment.surface, foldNeedle('record the first')), []);
check('and does not match either side', scanSegment(boundarySegment.surface, foldNeedle('last word of one')), [0]);
assert('a blob of those parts WOULD have matched, which is what the boundary is for',
  joinedSearchable.includes(foldNeedle('record the first')));

check('an empty needle matches nothing', scanSegment(segment.surface, ''), []);
check('a single line scan still finds the last record',
  scanSegment(buildSegment({ records: [{ summary: 'a' }, { summary: 'z' }] }).surface, 'z'), [1]);
check('one record is one hit, not one per occurrence',
  scanSegment(buildSegment({ records: [{ summary: 'x x x' }] }).surface, 'x'), [0]);
check('an empty generation scans to nothing', scanSegment('', 'x'), []);

// The usable-needle floor: measured, not guessed. A one-character needle on this surface matches
// every record that carries a letter, so the floor is what keeps a search an answer.
assert('a one-character needle is refused', !needleIsUsable('x'));
assert('a two-character needle is accepted', needleIsUsable('xy'));
check('the floor is the number the guard reads', MIN_NEEDLE_CHARS, 2);
check('whitespace does not count toward the floor', needleIsUsable('  '), false);
assert('a needle longer than the floor passes', needleIsUsable('  real words  '));

/* =====================================================================
 * 3 — a hit maps back to the line it came from
 * ===================================================================== */

const withLocators = buildSegment({
  records: RECORDS.map((r, i) => ({ ...r, index: i, fileIdx: i < 4 ? 0 : 1, byteStart: i * 100, byteEnd: i * 100 + 40 })),
});
// The locator triple rides on the same line as the searchable text, so it is read back from the
// line the scan named rather than from a second file that had to be walked in parallel with this one.
const lineAt = (n) => withLocators.surface.split('\n')[n] ?? '';
const locatorAt = (n) => {
  const tab = lineAt(n).indexOf('\t');
  return tab < 0 ? null : JSON.parse(lineAt(n).slice(0, tab));
};
check('locator ordinals are the record order',
  RECORDS.map((_, i) => locatorAt(i)?.ordinal ?? null), RECORDS.map((_, i) => i));
check('locators carry which file',
  RECORDS.map((_, i) => locatorAt(i)?.fileIdx ?? null), RECORDS.map((_, i) => (i < 4 ? 0 : 1)));
check('locators carry where the line sat',
  RECORDS.map((_, i) => locatorAt(i)?.byteStart ?? null), RECORDS.map((_, i) => i * 100));
check('a record with no position says -1, not 0',
  RECORDS.map((_, i) => locatorAt(i)?.byteEnd ?? null),
  RECORDS.map((_, i) => (i === 0 ? 40 : i * 100 + 40)));
check('a record that carries no locator at all still gets a line',
  RECORDS.map((_, i) => locatorAt(i) !== null), RECORDS.map(() => true));
{
  const bare = buildSegment({ records: [{ summary: 'x' }] }).surface.split('\n')[0];
  const parsed = JSON.parse(bare.slice(0, bare.indexOf('\t')));
  check('a record with no position says -1',
    { fileIdx: parsed.fileIdx, byteStart: parsed.byteStart, byteEnd: parsed.byteEnd },
    { fileIdx: -1, byteStart: -1, byteEnd: -1 });
}

const hit = scanSegment(withLocators.surface, foldNeedle('grep'))[0];
// Read through `?.` so a build whose surfaces no longer line up with their records FAILS HERE BY
// NAME rather than throwing on an undefined locator — a crash names no rule, and the reader is left
// with a stack trace instead of the thing that moved.
check('a hit resolves to the line it came from', locatorAt(hit)?.ordinal ?? null, hit ?? null);
check('and that line names where the record sat', locatorAt(hit)?.byteStart ?? null, hit === undefined ? null : hit * 100);
check('and reads back as the answer, not as a locator',
  oneHit(withLocators.surface, hit)?.index ?? null, hit ?? null);

/* =====================================================================
 * 4 — a half-published segment is never consumed
 * ===================================================================== */

const SOURCE = [{ fileName: 'g0.jsonl', generation: 0, size: 100, revision: 'sha256:' + 'a'.repeat(64) }];
const root = await mkdtemp(join(tmpdir(), 'mmc-seg-'));
const store = createSegmentStore(root);
const storeFailures = [];

try {
  assert('nothing stored yet reads as no segment',
    (await store.read('s', 'all', 'g0', SOURCE)) === null);

  const written = await store.write('s', 'all', 'g0', segment, { generation: 0, source: SOURCE });
  check('the manifest counts the records', written.recordCount, RECORDS.length);
  const good = await store.read('s', 'all', 'g0', SOURCE);
  assert('a complete segment reads back', good !== null);
  if (good !== null) {
    check('the surface is the one written', good.surface, segment.surface);
    check('and every line of it is a record', good.surface === '' ? 0 : good.surface.split('\n').length, RECORDS.length);
  }

  const dir = store.dirOf('s', 'all', 'g0');

  await writeFile(join(dir, 'surface.txt'), '', 'utf8');
  assert('a surface that does not match its manifest is refused',
    (await store.read('s', 'all', 'g0', SOURCE)) === null);
  await writeFile(join(dir, 'surface.txt'), `${segment.surface}\nextra`, 'utf8');
  assert('a surface with a line the manifest does not count is refused',
    (await store.read('s', 'all', 'g0', SOURCE)) === null);

  // The record count, isolated from the checksum. Every other refusal above is caught by a digest
  // first, which means "the file holds exactly what the manifest claims" was never actually on
  // trial. Here the surface gains a line AND the manifest's digest for it is re-taken, so both
  // bytes check out and only the count disagrees.
  const baseManifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  const grownSurface = `${segment.surface}\n${JSON.stringify({ ordinal: RECORDS.length, index: -1, fileIdx: 0, byteStart: 0, byteEnd: 1 })}\t${'extra'}`;
  await writeFile(join(dir, 'surface.txt'), grownSurface, 'utf8');
  await writeFile(join(dir, 'manifest.json'),
    JSON.stringify({ ...baseManifest, surfaceDigest: digestOf(grownSurface), surfaceBytes: Buffer.byteLength(grownSurface) }), 'utf8');
  assert('a surface the manifest does not count is refused',
    (await store.read('s', 'all', 'g0', SOURCE)) === null);
  // And the positive control, because a check that refuses everything would pass the line above:
  // the same file with a manifest that counts it IS read.
  await writeFile(join(dir, 'manifest.json'),
    JSON.stringify({ ...baseManifest, surfaceDigest: digestOf(grownSurface), surfaceBytes: Buffer.byteLength(grownSurface), recordCount: RECORDS.length + 1 }), 'utf8');
  const counted = await store.read('s', 'all', 'g0', SOURCE);
  assert('and is read once the manifest counts it', counted !== null);
  if (counted !== null) check('with every line present', counted.surface.split('\n').length, RECORDS.length + 1);
  await store.write('s', 'all', 'g0', segment, { generation: 0, source: SOURCE });

  await rm(join(dir, 'manifest.json'), { force: true });
  assert('a pair with no manifest is refused',
    (await store.read('s', 'all', 'g0', SOURCE)) === null);

  await store.write('s', 'all', 'g0', segment, { generation: 0, source: SOURCE });
  const manifestPath = join(dir, 'manifest.json');
  const original = JSON.parse(await readFile(manifestPath, 'utf8'));
  for (const [patch, label] of [
    [{ schemaVersion: 99 }, 'another schema version'],
    [{ view: 'g3' }, 'another view'],
  ]) {
    await writeFile(manifestPath, JSON.stringify({ ...original, ...patch }), 'utf8');
    assert(`a manifest from ${label} is refused`, (await store.read('s', 'all', 'g0', SOURCE)) === null);
  }
  await writeFile(manifestPath, 'not json', 'utf8');
  assert('an unreadable manifest is refused', (await store.read('s', 'all', 'g0', SOURCE)) === null);
  await writeFile(manifestPath, JSON.stringify(original), 'utf8');
  assert('the restored manifest reads again', (await store.read('s', 'all', 'g0', SOURCE)) !== null);

  // The source identity that decides reuse.
  assert('a source that grew refuses the segment',
    (await store.read('s', 'all', 'g0', [{ ...SOURCE[0], size: 101 }])) === null);
  assert('a source whose revision changed refuses the segment',
    (await store.read('s', 'all', 'g0', [{ ...SOURCE[0], revision: 'sha256:' + 'f'.repeat(64) }])) === null);
  assert('a renamed source refuses the segment',
    (await store.read('s', 'all', 'g0', [{ ...SOURCE[0], fileName: 'x.jsonl' }])) === null);
  assert('a source that went away refuses the segment',
    (await store.read('s', 'all', 'g0', [])) === null);
  assert('a touched-but-unchanged source keeps the segment, on purpose',
    (await store.read('s', 'all', 'g0', [{ ...SOURCE[0], revision: SOURCE[0].revision }])) !== null);

  // Two generations are two segments: one never answers for the other.
  await store.write('s', 'all', 'g1', segment, { generation: 1, source: [{ ...SOURCE[0], generation: 1 }] });
  const g0 = await store.read('s', 'all', 'g0', SOURCE);
  const g1 = await store.read('s', 'all', 'g1', [{ ...SOURCE[0], generation: 1 }]);
  check('two generations read back the same bytes', g0?.surface, g1?.surface);
  assert('and each is keyed by its own generation',
    store.dirOf('s', 'all', 'g0') !== store.dirOf('s', 'all', 'g1'));
  assert('another session does not answer', (await store.read('other', 'all', 'g0', SOURCE)) === null);
} catch (error) {
  storeFailures.push(`the segment store could not be exercised: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await rm(root, { recursive: true, force: true });
}
for (const line of storeFailures) failures.push(line);

/* =====================================================================
 * 5 — the rest of the contract
 * ===================================================================== */

check('the active generation has a key of its own', generationKey(null), 'active');
check('a sealed generation keys on its number', generationKey(3), 'g3');
check('two sessions cannot collide on a generation key', generationKey(0) !== generationKey(1), true);

const many = Array.from({ length: MAX_HITS + 40 }, (_, i) => ({ summary: `hit ${i}` }));
const manyHits = scanSegment(buildSegment({ records: many }).surface, 'hit');
const capped = capHits(manyHits);
check('hits are capped', capped.ordinals.length, MAX_HITS);
check('the real total is still reported', capped.total, MAX_HITS + 40);
check('and the cap says so', capped.truncated, true);
const underCap = capHits([1, 2, 3]);
check('a short answer is not marked truncated', [underCap.truncated, underCap.total], [false, 3]);

check('sameSource is order sensitive', sameSource(SOURCE, [{ ...SOURCE[0] }]), true);
check('sameSource rejects an empty stored source', sameSource([], SOURCE), false);
check('sameSource rejects a longer live source',
  sameSource(SOURCE, [SOURCE[0], { ...SOURCE[0], generation: 1 }]), false);

const source = await readFile(SEGMENT_PATH, 'utf8');
assert('the segment is written under the runtime data dir and nowhere else',
  !/join\([^)]*sessions/i.test(source));
// The publish order is only observable in the source: a correct writer and one that publishes the
// manifest first leave the same directory behind. Read the two rename TARGETS rather than the word
// "manifest", which appears in the reader too.
const publishSurface = source.indexOf(`join(dir, 'surface.txt'))`);
const publishManifest = source.indexOf(`join(dir, 'manifest.json'))`);
assert('the manifest is published last',
  publishSurface >= 0 && publishManifest > publishSurface);
assert('nothing here spawns a thread; the route owns that',
  !/worker_threads/.test(source));
assert('the scan is a per-line test, not a joined blob',
  /line\.slice\(tab \+ 1\)\.includes\(needle\)/.test(source)
  && !/\+ .*surface.*\+/.test(source.split('export function scanSegment')[1].split('export function')[0]));

/* ---------------------------------------------------------------------
 * A generation read short by our own read cap produces a segment that
 * covers a PREFIX of the file, while `size` is the whole file. Without
 * this comparison the two are indistinguishable, and a segment that
 * covers a prefix would be served as one that covers everything: a
 * smaller `total`, hits that went missing, and nothing said about it.
 * --------------------------------------------------------------------- */
const WHOLE_SOURCE = { fileName: 'g1.jsonl', generation: 1, size: 500, revision: 'r1' };
const SHORT_SOURCE = { ...WHOLE_SOURCE, truncated: true };
check('a source read short is not trusted as if it had been read whole',
  sameSource([{ ...WHOLE_SOURCE, truncated: false }], [SHORT_SOURCE]), false);
check('and not in the other direction either',
  sameSource([SHORT_SOURCE], [{ ...WHOLE_SOURCE, truncated: false }]), false);
check('two sources that agree about truncation still trust each other',
  sameSource([SHORT_SOURCE], [SHORT_SOURCE]), true);
check('and two that agree it was read whole do too',
  sameSource([WHOLE_SOURCE], [{ ...WHOLE_SOURCE, truncated: false }]), true);
assert('an older artifact that predates the field is rebuilt rather than trusted',
  sameSource([{ fileName: 'g1.jsonl', generation: 1, size: 500, revision: 'r1' }], [{ ...WHOLE_SOURCE, truncated: false }]), true);
assert('the comparison is in this module and not only in the caller',
  /if \(\(a\.truncated === true\) !== \(b\.truncated === true\)\) return false;/.test(
    source.split('export function sameSource')[1] || ''));

/* --------------------------------------------------------------------- */

if (failures.length) {
  console.log(`\n  [search-segments] ${failures.length} failure(s):`);
  for (const line of failures) console.log(`    - ${line}`);
  console.log('');
  process.exitCode = 1;
} else {
  console.log(`[search-segments] ${pass} assertions passed`);
}
