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
 * Plus the artifact rules: a half-published segment is never consumed, the locators map a hit back to
 * the line it came from, and nothing in the segment carries a machine path.
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
// The field list is only the page's if the page still says it is. Read out of the shipped client
// rather than out of this file's own copy of it, or the check would be true by construction.
const CLIENT = readFileSync(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
assert('the page still searches exactly these five fields, in this order',
  /\[record\.summary, record\.text, safeText\(record\.result\), thinkingText, record\.toolName\]/.test(CLIENT));

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

const segment = buildSegment({ records: RECORDS });
check('one surface line per record', segment.surface.split('\n').length, RECORDS.length);
check('one locator per record', segment.locators.split('\n').length, RECORDS.length);

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
// with `the first`. The needle belongs to neither. The control is the implementation this is here to
// prevent — flatten every newline in the surface to a space, then read it as one string — which
// reports a match that exists in no record.
const boundarySegment = buildSegment({
  records: [{ summary: 'the last word of one record' }, { summary: 'the first word of the next' }],
});
const joinedAsOneBlob = boundarySegment.surface.replace(/\n/g, ' ');
check('a needle spanning two records matches nothing', scanSegment(boundarySegment.surface, foldNeedle('record the first')), []);
check('and does not match either side', scanSegment(boundarySegment.surface, foldNeedle('last word of one')), [0]);
assert('the joined blob WOULD have matched, which is what the boundary is for',
  joinedAsOneBlob.includes(foldNeedle('record the first')));

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
  records: RECORDS.map((r, i) => ({ ...r, fileIdx: i < 4 ? 0 : 1, byteStart: i * 100, byteEnd: i * 100 + 40 })),
});
const locatorList = withLocators.locators.split('\n').map((line) => JSON.parse(line));
check('locator ordinals are the record order', locatorList.map((l) => l.ordinal), RECORDS.map((_, i) => i));
check('locators carry which file', locatorList.map((l) => l.fileIdx), RECORDS.map((_, i) => (i < 4 ? 0 : 1)));
check('locators carry where the line sat', locatorList.map((l) => l.byteStart), RECORDS.map((_, i) => i * 100));
check('a locator of a record with no position says -1',
  JSON.parse(buildSegment({ records: [{ summary: 'x' }] }).locators),
  { ordinal: 0, fileIdx: -1, byteStart: -1, byteEnd: -1 });

const hit = scanSegment(withLocators.surface, foldNeedle('grep'))[0];
// Read through `?.` so a build whose surfaces no longer line up with their records FAILS HERE BY
// NAME rather than throwing on an undefined locator — a crash names no rule, and the reader is left
// with a stack trace instead of the thing that moved.
check('a hit resolves to a locator', locatorList[hit]?.ordinal ?? null, hit ?? null);
check('and that locator names the line the hit came from', locatorList[hit]?.byteStart ?? null, hit === undefined ? null : hit * 100);

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
  assert('a complete pair reads back', good !== null);
  if (good !== null) {
    check('the surface is the one written', good.surface, segment.surface);
    check('every locator is readable', good.locators.length, RECORDS.length);
  }

  const dir = store.dirOf('s', 'all', 'g0');

  await writeFile(join(dir, 'surface.txt'), '', 'utf8');
  assert('a surface that does not match its manifest is refused',
    (await store.read('s', 'all', 'g0', SOURCE)) === null);
  await writeFile(join(dir, 'surface.txt'), `${segment.surface}\nextra`, 'utf8');
  assert('a surface with a line the locators do not account for is refused',
    (await store.read('s', 'all', 'g0', SOURCE)) === null);

  // The locator count, isolated from the checksums. Every other refusal above is caught by a digest
  // first, which means "the file holds exactly what the manifest claims" was never actually on
  // trial. Here the locator file gains a line AND the manifest's digest for it is re-taken, so both
  // bytes check out and only the count disagrees.
  const baseManifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  // Put the surface back first: the case above deliberately left a grown one on disk, and this
  // control is about the LOCATOR count, not about two files being wrong at once.
  await writeFile(join(dir, 'surface.txt'), segment.surface, 'utf8');
  const grownLocators = `${segment.locators}\n${JSON.stringify({ ordinal: RECORDS.length, fileIdx: 0, byteStart: 0, byteEnd: 1 })}`;
  await writeFile(join(dir, 'locators.jsonl'), grownLocators, 'utf8');
  await writeFile(join(dir, 'manifest.json'),
    JSON.stringify({ ...baseManifest, locatorDigest: digestOf(grownLocators), locatorBytes: Buffer.byteLength(grownLocators) }), 'utf8');
  assert('locators the manifest does not count are refused',
    (await store.read('s', 'all', 'g0', SOURCE)) === null);
  // And the positive control, because a check that refuses everything would pass the line above:
  // the same file with a manifest that counts it IS read.
  await writeFile(join(dir, 'manifest.json'),
    JSON.stringify({ ...baseManifest, locatorDigest: digestOf(grownLocators), locatorBytes: Buffer.byteLength(grownLocators), recordCount: RECORDS.length + 1 }), 'utf8');
  const counted = await store.read('s', 'all', 'g0', SOURCE);
  assert('and is read once the manifest counts it', counted !== null);
  if (counted !== null) check('with every locator present', counted.locators.length, RECORDS.length + 1);
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
  /line\.includes\(needle\)/.test(source) && !/\+ .*surface.*\+/.test(source.split('export function scanSegment')[1].split('export function')[0]));

/* --------------------------------------------------------------------- */

if (failures.length) {
  console.log(`\n  [search-segments] ${failures.length} failure(s):`);
  for (const line of failures) console.log(`    - ${line}`);
  console.log('');
  process.exitCode = 1;
} else {
  console.log(`[search-segments] ${pass} assertions passed`);
}
