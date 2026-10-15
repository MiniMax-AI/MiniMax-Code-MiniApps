/**
 * The index has to be the same answer as the payload it was built from, or it is a second opinion.
 *
 * `trajectory-index.mjs` exists so that reading a window, counting a kind or brushing a time range
 * stops costing a re-parse of every generation a session has stored. It can only be allowed to do
 * that if what it serves is what the full build would have served — so most of this file builds a
 * real payload through `buildTrajectoryPayload`, indexes it, and compares the two field by field.
 *
 * The cases that are easy to get wrong, and are therefore pinned here:
 *
 *  1. A record's every carried field survives the round trip, and the six excluded ones are the six
 *     that were meant to go. A field quietly dropped is a row that renders blank.
 *  2. A window at EVERY boundary equals the corresponding slice of the full payload, including the
 *     turns that the range only partly covers — a cut turn would print a header about rows the
 *     reader cannot see.
 *  3. Timestamps are not monotonic, so a time range is answered from the side array and equals a
 *     brute-force filter. The control group is the point: it shows that bisecting the primary key
 *     order would have MISSED rows, which is why the side array exists at all.
 *  4. A half-written pair of files is never consumed: no manifest, a digest that disagrees, a
 *     schema from another version, a source that moved — each answers "no index", not "some index".
 *  5. No machine path is written into the artifact, so the file is meaningless outside its session
 *     rather than a pointer into somebody's home directory.
 *
 * Read-only: imports the pure helpers and writes only under a temp dir it makes itself.
 * mutate-trajectory-index.py breaks each of these in the shipped module.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTrajectoryPayload, ROW_GENERATION } from '../miniapp/node/server.mjs';
import {
  MAX_WINDOW_RECORDS,
  buildSecondary,
  createIndexStore,
  digestOf,
  indexRowsFromPayload,
  parseIndex,
  projectionDigestOf,
  recordsInTimeRange,
  resolveWindow,
  sameSources,
  serializeIndex,
  windowTurns,
} from '../miniapp/node/trajectory-index.mjs';

const INDEX_PATH = new URL('../miniapp/node/trajectory-index.mjs', import.meta.url);

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
 * A payload built the way the route builds one, from rows that exercise the shapes
 * ===================================================================== */

/** @param {string} id */
const message = (id, role, extra) => ({ message_id: id, role, ...extra });

const rawRows = [
  { message_id: 'u1', turn_id: 't1', message: message('u1', 'user', { content: 'first question', timestamp: 1000 }) },
  {
    message_id: 'a1',
    turn_id: 't1',
    message: message('a1', 'assistant', {
      timestamp: 1100,
      stopReason: 'stop',
      model: 'm',
      provider: 'p',
      api: 'a',
      content: [
        { type: 'thinking', thinking: 'weighing it' },
        { type: 'text', text: 'the answer' },
        { type: 'toolCall', id: 'c1', name: 'read', arguments: { path: 'x' } },
        { type: 'toolCall', id: 'c2', name: 'grep', arguments: { q: 'y' } },
      ],
    }),
  },
  { message_id: 'tr1', turn_id: 't1', message: message('tr1', 'toolResult', { timestamp: 1200, toolCallId: 'c1', toolName: 'read', content: 'file body' }) },
  // A second prompt in the same turn: a steer, decided over the lineage.
  { message_id: 'u2', turn_id: 't1', message: message('u2', 'user', { content: 'actually do this instead', timestamp: 1300 }) },
  { message_id: 'u3', turn_id: 't2', message: message('u3', 'user', { content: 'second question', timestamp: 2000 }) },
  { message_id: 'a2', turn_id: 't2', message: message('a2', 'assistant', { timestamp: 2100, stopReason: 'toolUse', content: [{ type: 'text', text: 'on it' }] }) },
  // A message with no usable id at all: unkeyed, and it must not join any group. Two of them, so
  // that "does not join a group" is a statement about the pair and not about a lone record that
  // happened to be alone.
  { message_id: null, turn_id: 't2', message: message('', 'assistant', { timestamp: 2200, stopReason: 'stop', content: [{ type: 'text', text: 'unkeyed tail' }] }) },
  { message_id: null, turn_id: 't2', message: message('', 'assistant', { timestamp: 2300, stopReason: 'stop', content: [{ type: 'text', text: 'second unkeyed tail' }] }) },
];

const generations = [{ generation: 0, fileName: 'g0.jsonl', byteLength: 10 }, { generation: 1, fileName: 'g1.jsonl', byteLength: 10 }];
const rowsForBuild = rawRows.map((row, i) => {
  const copy = { ...row, [ROW_GENERATION]: i < 4 ? 0 : 1 };
  return copy;
});

const payload = buildTrajectoryPayload({
  session: { id: 's1', createdAtMs: 2200 },
  rows: rowsForBuild,
  sizeBytes: 999,
  generations,
  generation: null,
});

/** One locator per record, in the shape the route builds for `/raw`. */
const FILES = [
  { fileName: 'g0.jsonl', generation: 0, size: 100, mtimeMs: 5, revision: 'sha256:' + 'a'.repeat(64), filePath: '/store/session-a/g0.jsonl' },
  { fileName: 'g1.jsonl', generation: 1, size: 100, mtimeMs: 5, revision: 'sha256:' + 'b'.repeat(64), filePath: '/store/session-a/g1.jsonl' },
];
const raws = new Map();
let byteCursor = 0;
for (const turn of payload.turns) {
  for (const record of turn.records) {
    const fileIdx = record.generation === 0 ? 0 : 1;
    raws.set(record.index, {
      filePath: `/store/session-a/${FILES[fileIdx].fileName}`,
      start: byteCursor,
      end: byteCursor + 40,
      digest: 'd' + String(record.index).padStart(3, '0'),
    });
    byteCursor += 40;
  }
}

const EXCLUDED = ['text', 'thinking', 'arguments', 'result', 'error', 'rawRow'];
const flatRecords = payload.turns.flatMap((turn) => turn.records);

/* =====================================================================
 * 1 — every carried field survives the round trip, and only the excluded ones go
 * ===================================================================== */

const rows = indexRowsFromPayload(payload, raws, FILES);
const text = serializeIndex(rows);
const manifest = {
  schemaVersion: 1,
  projectionVersion: 1,
  view: 'all',
  files: FILES,
  recordCount: rows.records.length,
  turnCount: rows.turns.length,
  recordsBytes: Buffer.byteLength(text),
  recordsDigest: digestOf(text),
  projectionDigest: projectionDigestOf(payload),
};
const back = parseIndex(text, manifest);

assert('the index round-trips', back !== null);
check('the record count survives', back.records.length, flatRecords.length);
check('the turn count survives', back.turns.length, payload.turns.length);

// A file that holds more lines than its manifest claims. The digest is re-taken over the longer
// text so this is NOT caught by the checksum: it isolates the rule that the file must hold exactly
// what the manifest says, which is what makes a manifest from a different write unusable.
const overlong = `${text}\n{"index":99999}`;
const overlongManifest = { ...manifest, recordsDigest: digestOf(overlong) };
assert('a file with a line the manifest does not claim is refused',
  parseIndex(overlong, overlongManifest) === null);
const truncated = text.split('\n').slice(0, -1).join('\n');
assert('a file that is short a line is refused',
  parseIndex(truncated, { ...manifest, recordsDigest: digestOf(truncated) }) === null);

let mismatched = [];
for (let i = 0; i < flatRecords.length; i += 1) {
  const original = flatRecords[i];
  const stored = back.records[i];
  for (const key of Object.keys(original)) {
    if (EXCLUDED.includes(key)) continue;
    if (JSON.stringify(stored[key]) !== JSON.stringify(original[key])) {
      mismatched.push(`${original.index}.${key}`);
    }
  }
}
check('every carried field is identical', mismatched, []);

let leaked = [];
for (const [key] of Object.entries(back.records[0])) {
  if (EXCLUDED.includes(key)) leaked.push(key);
}
check('no excluded field is carried', leaked, []);

let leakedHeavy = 0;
for (const record of back.records) {
  for (const key of ['text', 'thinking', 'arguments', 'result', 'error']) {
    if (record[key] !== undefined) leakedHeavy += 1;
  }
}
check('no heavy text field is carried anywhere', leakedHeavy, 0);

// `error` becomes a flag, because a row is styled by whether there was error text.
const withErrorFlag = back.records.filter((r) => r.hasErrorText === true);
check('the error-text flag is a boolean', withErrorFlag.every((r) => typeof r.hasErrorText === 'boolean'), true);

check('a record knows which file it came from',
  back.records.every((r) => r.fileIdx === 0 || r.fileIdx === 1), true);
// The line position is what a search hit in a sealed generation is mapped back through, and `-1` has
// to stay distinguishable from byte 0 — a record at the very start of a file is not "no location".
check('a located record carries where its line sat',
  back.records.map((r) => r.byteStart), flatRecords.map((r) => raws.get(r.index).start));
check('a located record carries where its line ended',
  back.records.map((r) => r.byteEnd), flatRecords.map((r) => raws.get(r.index).end));
check('the fixture really does start a record at byte 0, so -1 is distinguishable',
  back.records[0].byteStart, 0);
// A record whose line was never located says so. Repairing it to 0 would point it at whichever
// file happens to be first, and /raw would then answer with a different generation's message.
const partialRaws = new Map(raws);
partialRaws.delete(flatRecords[3].index);
const partial = indexRowsFromPayload(payload, partialRaws, FILES);
check('a record with no locator says file -1', partial.records[3].fileIdx, -1);
check('and its neighbours keep theirs', partial.records[2].fileIdx, back.records[2].fileIdx);
check('no record silently became file 0',
  partial.records.filter((r) => r.fileIdx === -1).length, 1);
check('a record with no locator has no line position either',
  [partial.records[3].byteStart, partial.records[3].byteEnd], [-1, -1]);

assert('the file carries no absolute path', !/[A-Za-z]:\\|\/(?:store|home|Users)\//.test(text));
assert('the file carries no store path from the locator', !text.includes('/store/session-a'));

/* =====================================================================
 * 2 — a window at every boundary equals the slice of the full payload
 * ===================================================================== */

const secondary = buildSecondary(back.records);
const total = flatRecords.length;

const rangeOf = (from, limit) => resolveWindow(secondary, { from, limit });

check('a window at the very start is the full width asked for',
  [rangeOf(1, 3).from, rangeOf(1, 3).to], [1, 3]);
check('a window in the middle is the same width',
  [rangeOf(5, 3).from, rangeOf(5, 3).to], [5, 7]);
check('a window past the end is clamped to the last record',
  [rangeOf(total + 50, 3).from, rangeOf(total + 50, 3).to], [total, total]);
check('a window that starts past the end still returns one record',
  rangeOf(total + 50, 3).limit, 1);
check('a window wider than the session stops at the session',
  rangeOf(1, 10_000).limit, total);
const bigSession = buildSecondary(Array.from({ length: MAX_WINDOW_RECORDS * 3 }, (_, i) => ({ timestamp: i })));
check('a window wider than the ceiling is capped on a session large enough to show it',
  resolveWindow(bigSession, { from: 1, limit: MAX_WINDOW_RECORDS + 500 }).limit, MAX_WINDOW_RECORDS);
check('an explicit tail wider than the ceiling is capped too',
  resolveWindow(bigSession, { tail: MAX_WINDOW_RECORDS + 500 }).limit, MAX_WINDOW_RECORDS);
check('a tail window is the last n records',
  [rangeOf(null, null) && resolveWindow(secondary, { tail: 4 }).from, resolveWindow(secondary, { tail: 4 }).to],
  [total - 3, total]);
check('a tail wider than the session is the whole session',
  resolveWindow(secondary, { tail: 10_000 }).from, 1);
check('an empty index has no window', resolveWindow(buildSecondary([]), { from: 1, limit: 5 }), { from: 1, to: 0, limit: 0, total: 0 });

// The real comparison: every boundary, one record at a time.
let windowBad = [];
for (let from = 1; from <= total; from += 1) {
  const range = resolveWindow(secondary, { from, limit: 3 });
  const expected = flatRecords.slice(range.from - 1, range.to).map((r) => r.index);
  const served = [];
  for (const { records } of windowTurns(back, range)) {
    for (let i = records[0]; i <= records[1]; i += 1) served.push(i);
  }
  served.sort((a, b) => a - b);
  if (JSON.stringify(served) !== JSON.stringify(expected)) windowBad.push(`from ${from}: ${served} vs ${expected}`);
}
check('every window boundary serves exactly the full payload slice', windowBad, []);

// A range that straddles the boundary between the two turns: every turn the range touches has to
// appear, because a turn header carries token and error totals that a window cannot recompute.
const cutRange = resolveWindow(secondary, { from: 7, limit: 2 });
const cutTurns = windowTurns(back, cutRange);
check('a window straddling two turns shows both', cutTurns.map((t) => t.turn.id), ['t1', 't2']);
check('each turn is served only its overlap with the window',
  cutTurns.map((t) => t.records), [[7, 7], [8, 8]]);
// A window sitting wholly inside one turn still shows that turn, header and all: the turn's own
// span is wider than the window, so dropping it would print a range with no group above it.
const innerRange = resolveWindow(secondary, { from: 3, limit: 3 });
const innerTurns = windowTurns(back, innerRange);
check('a window inside a turn still shows the turn', innerTurns.map((t) => t.turn.id), ['t1']);
check('the inside window is served in full', innerTurns[0]?.records ?? null, [3, 5]);
check('a cut turn keeps its own header',
  cutTurns[0]?.turn.tokens ?? null, payload.turns.find((t) => t.id === 't1').tokens);
check('a turn narrower than the window is never stretched',
  windowTurns(back, { from: 1, to: total, total })[1]?.records ?? null, [8, total]);

const allTurns = windowTurns(back, { from: 1, to: total, total });
check('the whole range shows every turn', allTurns.length, payload.turns.length);
let headerBad = [];
for (let i = 0; i < payload.turns.length; i += 1) {
  const served = allTurns[i];
  if (served === undefined) {
    headerBad.push(`${payload.turns[i].id}.<missing>`);
    continue;
  }
  for (const key of ['id', 'index', 'startedAt', 'endedAt', 'toolCalls', 'errors', 'turnClass', 'askedReader', 'closed', 'openerInView', 'openerOutOfView']) {
    if (JSON.stringify(served.turn[key]) !== JSON.stringify(payload.turns[i][key])) {
      headerBad.push(`${payload.turns[i].id}.${key}`);
    }
  }
}
check('every turn header is identical to the full build', headerBad, []);

/* =====================================================================
 * 3 — a time range is answered from the side array, and the control shows why
 * ===================================================================== */

// Timestamps on a real session are nearly, but not quite, monotonic. Reproduced here by pulling two
// records' timestamps back below the one before them, so the fixture has the inversions the side
// array exists for — a value BELOW its predecessor, not merely an equal or a smaller-than-later one.
const staggered = back.records.map((r, i) => ({ ...r, timestamp: i === 3 ? 5 : i === 6 ? 15 : (i + 1) * 10 }));
const inversions = staggered.reduce((n, r, i) => (i > 0 && r.timestamp < staggered[i - 1].timestamp ? n + 1 : n), 0);
assert('the fixture really does go backwards in time', inversions >= 2);

const staggeredSecondary = buildSecondary(staggered);
const brute = (from, to) => staggered
  .map((r, i) => ({ r, i }))
  .filter(({ r }) => typeof r.timestamp === 'number' && r.timestamp >= from && r.timestamp <= to)
  .map(({ i }) => i);

let rangeBad = [];
for (const [from, to] of [[0, 45], [0, 55], [55, 65], [70, 75], [100, 100], [0, 10_000], [500, 600]]) {
  const got = recordsInTimeRange(staggeredSecondary, from, to);
  if (JSON.stringify(got) !== JSON.stringify(brute(from, to))) rangeBad.push(`${from}..${to}: ${got} vs ${brute(from, to)}`);
}
check('a time range equals a brute-force filter on non-monotonic timestamps', rangeBad, []);
check('a time range answers in ledger order', JSON.stringify(recordsInTimeRange(staggeredSecondary, 0, 10_000)), JSON.stringify(brute(0, 10_000).sort((a, b) => a - b)));

// The control: bisecting the PRIMARY order on this same data loses rows, which is the whole reason
// the timestamp side array is a separate structure rather than an assumption about the rows. The
// range is bounded on purpose — a range covering every row would be answered correctly even by the
// wrong implementation, which is exactly how a broken shortcut survives.
const bisectOnIndexOrder = (records, from, to) => {
  const at = (i) => records[i].timestamp;
  let lo = 0;
  let hi = records.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (at(mid) < from) lo = mid + 1;
    else hi = mid;
  }
  const hits = [];
  for (let i = lo; i < records.length && at(i) <= to; i += 1) hits.push(i);
  return hits;
};
const lostRows = brute(0, 45).filter((i) => !bisectOnIndexOrder(staggered, 0, 45).includes(i));
assert('bisecting the primary key order on this data would lose rows', lostRows.length > 0);
check('and the side array loses none',
  recordsInTimeRange(staggeredSecondary, 0, 45).length, brute(0, 45).length);

check('a record with no timestamp joins no time range',
  buildSecondary([{ timestamp: null }, { timestamp: 5 }]).timeValues.length, 1);
check('the count of untimed records is reported',
  buildSecondary([{ timestamp: null }, { timestamp: 5 }]).untimedCount, 1);
check('an empty range answers nothing', recordsInTimeRange(staggeredSecondary, 900, 100), []);
check('an inverted range answers nothing', recordsInTimeRange(staggeredSecondary, 500, 100), []);

/* =====================================================================
 * 4 — the secondary structures answer what they claim to
 * ===================================================================== */

const kinds = new Map();
for (const record of back.records) kinds.set(record.kind, (kinds.get(record.kind) ?? 0) + 1);
check('kind counts match the records',
  [...secondary.kindCounts.entries()].sort(), [...kinds.entries()].sort());
check('every record is counted under some kind',
  [...secondary.kindCounts.values()].reduce((a, b) => a + b, 0), back.records.length);

const grouped = new Map();
for (let i = 0; i < back.records.length; i += 1) {
  const id = back.records[i].id;
  if (typeof id !== 'string' || id.length === 0) continue;
  if (!grouped.has(id)) grouped.set(id, []);
  grouped.get(id).push(i);
}
check('message grouping matches the records',
  [...secondary.byMessageId.entries()].sort(), [...grouped.entries()].sort());
assert('a message expanded into several records groups under one key',
  (secondary.byMessageId.get('a1') ?? []).length > 1);
// The form of that rule: every record filed under a key must carry that key. A group holding a
// record that does not belong to it is a merge of two messages that never shared an id — which is
// what filing every unkeyed record under one placeholder would do.
const mismatchedGroup = [];
for (const [key, list] of secondary.byMessageId) {
  for (const i of list) if (back.records[i].id !== key) mismatchedGroup.push(`${key}<-${back.records[i].id}@${i}`);
}
check('no group holds a record whose id is not that group', mismatchedGroup, []);
const unkeyedCount = back.records.filter((r) => typeof r.id !== 'string' || r.id.length === 0).length;
assert('the fixture really does carry unkeyed records', unkeyedCount >= 2);
check('no unkeyed record is in any group',
  [...secondary.byMessageId.values()].flat().filter((i) => !byMessageIdOwns(back.records[i])).length, 0);
function byMessageIdOwns(record) {
  return typeof record.id === 'string' && record.id.length > 0;
}

const byGen = new Map();
for (let i = 0; i < back.records.length; i += 1) {
  const g = back.records[i].generation;
  if (!byGen.has(g)) byGen.set(g, []);
  byGen.get(g).push(i);
}
check('generation grouping matches the records',
  [...secondary.byGeneration.entries()].sort(), [...byGen.entries()].sort());
check('generations partition the records',
  [...secondary.byGeneration.values()].flat().length, back.records.length);

/* =====================================================================
 * 5 — the shape the file is written in, read before anything is written with it
 * ===================================================================== */

// Checked before the store is exercised, and deliberately a reading of the source rather than of a
// behaviour: the publish ORDER is only observable in the source, since a correct writer and a writer
// that publishes the manifest first produce the same directory afterwards. Doing it here also means
// a build that gets the order wrong is named rather than crashing inside the write below.
const source = await readFile(INDEX_PATH, 'utf8');
assert('the module names its five secondary structures',
  ['byMessageId', 'byGeneration', 'kindCounts', 'timeValues', 'timeRows'].every((n) => source.includes(n)));
assert('the primary key needs no structure of its own: the rows are already in order',
  /records\[a\]\.timestamp - records\[b\]\.timestamp/.test(source));
assert('the timestamp side array is built, not assumed',
  source.includes('Float64Array') && source.includes('Int32Array'));
assert('a time range bisects the side array',
  /values\[mid\] < from/.test(source));
const publishRecords = source.indexOf('recordPath}.tmp`, recordPath)');
const publishManifest = source.indexOf('manifestPath}.tmp`, manifestPath)');
assert('the records are published before the manifest',
  publishRecords >= 0 && publishManifest > publishRecords);
assert('the manifest strips the machine path',
  /files: meta\.files\.map\(stripPath\)/.test(source));
assert('nothing is ever read from the session history directory',
  !/join\([^)]*sessions/i.test(source));

/* =====================================================================
 * 6 — a half-written pair of files is never consumed
 * ===================================================================== */

const root = await mkdtemp(join(tmpdir(), 'mmc-index-'));
const store = createIndexStore(root);
const sourceFiles = FILES.map((f) => ({ ...f }));

/**
 * The store is exercised inside a catch, and every read is checked for `null` rather than
 * dereferenced. A guard that crashes reports a stack trace and no rule, which is a weaker outcome
 * than failing by name: the reader cannot tell which invariant moved. Here a store that cannot be
 * written at all is itself the finding, and the summary still prints the assertions around it.
 */
const storeFailures = [];
try {
  const written = await store.read('session-a', 'all', sourceFiles);
  assert('nothing stored yet reads as no index', written === null);

  const manifestWritten = await store.write('session-a', 'all', rows, { files: FILES, projectionDigest: manifest.projectionDigest });
  const good = await store.read('session-a', 'all', sourceFiles);
  assert('a complete pair reads back', good !== null);
  if (good !== null && manifestWritten !== undefined) {
    check('the manifest records what it holds', manifestWritten.recordCount, rows.records.length);
    check('the read-back is the same records', good.records.length, rows.records.length);
  }

  const dir = store.dirOf('session-a', 'all');

  // Manifest written, records not: the state a crash between the two renames leaves.
  await writeFile(join(dir, 'records.jsonl'), '', 'utf8');
  assert('records that do not match the manifest are refused',
    (await store.read('session-a', 'all', sourceFiles)) === null);

  // Records written, manifest not yet: the other order, and the one the write order prevents.
  await rm(join(dir, 'manifest.json'), { force: true });
  assert('records with no manifest are refused',
    (await store.read('session-a', 'all', sourceFiles)) === null);

  await store.write('session-a', 'all', rows, { files: FILES, projectionDigest: manifest.projectionDigest });
  assert('a rebuilt pair reads again',
    (await store.read('session-a', 'all', sourceFiles)) !== null);

  // A manifest that describes a schema or a projection this build does not speak.
  const manifestPath = join(dir, 'manifest.json');
  const original = JSON.parse(await readFile(manifestPath, 'utf8'));
  await writeFile(manifestPath, JSON.stringify({ ...original, schemaVersion: 99 }), 'utf8');
  assert('a manifest from another schema version is refused',
    (await store.read('session-a', 'all', sourceFiles)) === null);
  await writeFile(manifestPath, JSON.stringify({ ...original, projectionVersion: 99 }), 'utf8');
  assert('a manifest from another projection version is refused',
    (await store.read('session-a', 'all', sourceFiles)) === null);
  await writeFile(manifestPath, JSON.stringify({ ...original, view: 'g3' }), 'utf8');
  assert('a manifest for another view is refused',
    (await store.read('session-a', 'all', sourceFiles)) === null);
  await writeFile(manifestPath, JSON.stringify({ ...original, recordCount: original.recordCount + 1 }), 'utf8');
  assert('a manifest that overstates the record count is refused',
    (await store.read('session-a', 'all', sourceFiles)) === null);
  await writeFile(manifestPath, 'not json at all', 'utf8');
  assert('an unreadable manifest is refused',
    (await store.read('session-a', 'all', sourceFiles)) === null);
  await writeFile(manifestPath, JSON.stringify(original), 'utf8');
  assert('the restored manifest reads again',
    (await store.read('session-a', 'all', sourceFiles)) !== null);

  // The source it was built from is the identity that decides reuse.
  const grown = sourceFiles.map((f, i) => (i === 0 ? { ...f, size: f.size + 1 } : f));
  assert('a source that grew refuses the stored index',
    (await store.read('session-a', 'all', grown)) === null);
  const rewritten = sourceFiles.map((f, i) => (i === 0 ? { ...f, revision: 'sha256:' + 'f'.repeat(64) } : f));
  assert('a source whose revision changed refuses the stored index',
    (await store.read('session-a', 'all', rewritten)) === null);
  const renamed = sourceFiles.map((f, i) => (i === 0 ? { ...f, fileName: 'other.jsonl' } : f));
  assert('a renamed source refuses the stored index',
    (await store.read('session-a', 'all', renamed)) === null);
  const dropped = sourceFiles.slice(1);
  assert('a source that went away refuses the stored index',
    (await store.read('session-a', 'all', dropped)) === null);
  const touched = sourceFiles.map((f, i) => (i === 0 ? { ...f, mtimeMs: f.mtimeMs + 999 } : f));
  assert('a touched-but-unchanged source keeps the stored index, on purpose',
    (await store.read('session-a', 'all', touched)) !== null);

  // Two sessions, two sets of bytes.
  await store.write('session-b', 'all', { turns: [], records: [] }, { files: FILES, projectionDigest: 'x' });
  assert('one session does not answer for another',
    (await store.read('session-b', 'all', [])) === null);

  check('sameSources is order sensitive', sameSources(FILES, [...FILES].reverse()), false);
  check('sameSources rejects a length mismatch', sameSources(FILES, FILES.slice(0, 1)), false);

  // A generation read short by our own cap leaves a row set that covers a PREFIX, while `size` is
  // the whole file. That is the one case the identity facts cannot tell apart, so it is carried
  // and compared: an index built from it would otherwise be served as one holding every record.
  const WHOLE = { fileName: 'messages.jsonl', generation: 3, size: 900, mtimeMs: 7, revision: 'r3' };
  check('a source read short is not trusted as if read whole',
    sameSources([{ ...WHOLE, truncated: false }], [{ ...WHOLE, truncated: true }]), false);
  check('and not in the other direction either',
    sameSources([{ ...WHOLE, truncated: true }], [{ ...WHOLE, truncated: false }]), false);
  check('two sources that agree about truncation trust each other',
    sameSources([{ ...WHOLE, truncated: true }], [{ ...WHOLE, truncated: true }]), true);
  check('and so do two that agree it was read whole',
    sameSources([WHOLE], [{ ...WHOLE, truncated: false }]), true);
} catch (error) {
  storeFailures.push(`the store could not be exercised: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await rm(root, { recursive: true, force: true });
}
for (const line of storeFailures) failures.push(line);

/* --------------------------------------------------------------------- */

if (failures.length) {
  console.log(`\n  [trajectory-index] ${failures.length} failure(s):`);
  for (const line of failures) console.log(`    - ${line}`);
  console.log('');
  process.exitCode = 1;
} else {
  console.log(`[trajectory-index] ${pass} assertions passed`);
}
