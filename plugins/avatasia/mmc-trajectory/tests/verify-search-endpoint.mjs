/**
 * A hit has to be a row the reader can be sent to, and the count has to be the count.
 *
 * The search moved from the page to the server, and a move like that can change an answer in two
 * ways that no error message would report:
 *
 *  1. **It could report a version the ledger is not showing.** The stored rows of a lineage hold
 *     every copy of every message; the identity layer keeps one per message and suppresses the rest.
 *     A scan over the STORED rows would find a match inside a suppressed copy and hand back an index
 *     no row occupies — so the reader is sent nowhere. `collectSearchHits` runs over the projected
 *     view instead, and the fixture below has a message stored twice with different content in each
 *     generation, which is exactly the shape that makes this wrong when it happens.
 *
 *  2. **It could change what "how many" means.** The cap bounds what is SENT and never what is
 *     COUNTED, so a needle that matches ten thousand records is reported as ten thousand rather than
 *     as however many happened to fit.
 *
 * And the surface itself: the endpoint searches what the page searched, under the one normalisation
 * the segment module states. A dropped field would narrow what a reader can find without failing
 * anything, so the page's own `recordSearchText` is read out of the shipped client and compared.
 *
 * Read-only: imports the pure helpers; never starts the runtime.
 * mutate-search-endpoint.py breaks each of these in the shipped server.
 */
import { readFileSync } from 'node:fs';
import {
  SEARCH_FIELDS,
  buildMessageIdentity,
  buildTrajectoryPayload,
  collectSearchHits,
  foldNeedle,
  needleIsUsable,
  normaliseWhitespace,
  selectIdentityView,
  splitRawRecords,
  ROW_GENERATION,
} from '../miniapp/node/server.mjs';
import { buildSegment, fileIdxRowsFromPayload, readSegmentHits, scanSegment } from '../miniapp/node/search-segments.mjs';

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

/* =====================================================================
 * The page's own search text, and the endpoint's claim about it
 * ===================================================================== */

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
// The five searched fields used to be pinned against the page's own `recordSearchText`. The page
// does not search any more — that is the move — so the pin is against what those fields are FOR:
// each one is something the reader is shown. That a record also carries them is checked below,
// once there is a record to carry them.
const CARRIED = ['summary', 'text', 'result', 'thinking', 'toolName'];
// Still on the row, so still read from the row.
for (const field of ['summary', 'toolName']) {
  assert(`the page renders "${field}"`, CLIENT.includes(`record.${field}`));
}
// Shown, but no longer from the row: these three come from `/api/trajectory/record`, which is what
// makes 「命中 → 看得见」 still true without the page holding them.
for (const [field, label] of [['result', '工具结果'], ['thinking', '思考过程'], ['arguments', '工具参数']]) {
  assert(`the page renders "${field}"`, CLIENT.includes(`buildDetailBlock('${label}', record, '${field}'`));
}
// `text` is the honest exception and it always was: no inspector tab has ever shown it. What a hit
// on it leads to is 原文, which every record has. So the assertion is that the path exists, not
// that the field is rendered.
assert('a hit on "text" still leads somewhere: every record has the 原文 tab',
  CLIENT.includes("{ id: 'raw', label: '原文', available: function () { return true; } }"));
assert('and 原文 is drawn for a record, not only when something was selected',
  /if \(tabId === 'raw'\) return buildRaw\(record\);/.test(CLIENT));
assert('and arguments are deliberately not searched', !SEARCH_FIELDS.includes('arguments'));

/** The page's filter, given a payload and a needle. This is what the endpoint must reproduce. */
function pageHits(payload, needle) {
  const folded = foldNeedle(needle);
  const out = [];
  for (const turn of payload.turns) {
    for (const record of turn.records) {
      if (normaliseWhitespace(pageRecordSearchText(record)).includes(folded)) out.push(record.index);
    }
  }
  return out;
}

/* =====================================================================
 * A lineage that stores one message twice, with different content
 * ===================================================================== */

const message = (id, role, extra) => ({ message_id: id, role, ...extra });

const RAW = [
  { message_id: 'u1', turn_id: 't1', message: message('u1', 'user', { content: 'the needle is in the question', timestamp: 1000 }) },
  // Generation 0's copy of this message. The second copy below is the SAME message id with the
  // tool result replaced by the runtime's compaction marker — a second VERSION, kept rather than
  // dropped, and the one a generation view would show.
  {
    message_id: 'a1',
    turn_id: 't1',
    message: message('a1', 'assistant', {
      timestamp: 1100,
      stopReason: 'toolUse',
      content: [
        // A thinking block, because `thinking` is one of the five searched fields and a fixture
        // with none of them makes every assertion about it pass by having nothing to look at.
        { type: 'thinking', thinking: 'first I need the file, then the answer' },
        { type: 'text', text: 'working on it' },
        { type: 'toolCall', id: 'c1', name: 'read', arguments: { path: 'a' } },
      ],
    }),
  },
  {
    message_id: 'tr1',
    turn_id: 't1',
    message: message('tr1', 'toolResult', {
      timestamp: 1200,
      toolCallId: 'c1',
      toolName: 'read',
      content: 'the needle is in the tool result',
    }),
  },
  { message_id: 'u2', turn_id: 't2', message: message('u2', 'user', { content: 'second question', timestamp: 2000 }) },
  // The runtime copies this message into generation 1, with its tool result trimmed away.
  {
    message_id: 'tr1',
    turn_id: 't1',
    message: message('tr1', 'toolResult', {
      timestamp: 1200,
      toolCallId: 'c1',
      toolName: 'read',
      content: '[Tool result removed by context compaction.]',
    }),
  },
];

// Generation 0 holds the conversation as it was written; generation 1 holds the later question and
// the runtime's copy of the trimmed message. So the trimmed copy IS what generation 1 stores, and
// the lineage view shows generation 0's.
const rowsForBuild = RAW.map((row, i) => ({ ...row, [ROW_GENERATION]: i < 3 ? 0 : 1 }));

const occurrences = rowsForBuild.map((row, i) => ({
  row,
  generation: rowsForBuild[i][ROW_GENERATION],
  locator: { filePath: `/store/s/g${rowsForBuild[i][ROW_GENERATION]}.jsonl`, start: i * 100, end: i * 100 + 40, digest: `d${i}` },
}));

const identityTable = buildMessageIdentity(occurrences);
const allView = selectIdentityView(identityTable, null);
const allPayload = buildTrajectoryPayload({
  session: { id: 's1', createdAtMs: 2000 },
  rows: allView.rows,
  generations: [],
  generation: null,
  identity: identityTable,
  openerByTurn: allView.openerByTurn,
});

assert('the identity layer really did keep one version of the message stored twice',
  allPayload.turns.flatMap((t) => t.records).filter((r) => r.id === 'tr1').length === 1);
const firstRecord = allPayload.turns.flatMap((t) => t.records)[0];
const allRecords = allPayload.turns.flatMap((t) => t.records);
// Every searched field used to be on EVERY record, null when it had none, which is what let the
// old loop ask `hasOwnProperty` of the first record and mean anything by the answer. A record now
// carries only the field its kind has — a reply has no `arguments` to carry — so the question is
// whether the projection still has each one SOMEWHERE, which is what this search is reading. The
// wire copy is the other half of that, and tests/verify-record-detail.mjs holds it.
for (const field of SEARCH_FIELDS) {
  assert(`the projection carries "${field}" where it exists`,
    allRecords.some((r) => Object.prototype.hasOwnProperty.call(r, field) && r[field] !== null));
}
check('and the searched fields are exactly the five that are both carried and shown', SEARCH_FIELDS, CARRIED);
assert('and it is the one with the real result',
  allPayload.turns.flatMap((t) => t.records).some((r) => r.id === 'tr1' && String(r.result).includes('needle')));

const genView = selectIdentityView(identityTable, 0);
const gen0Payload = buildTrajectoryPayload({
  session: { id: 's1', createdAtMs: 2000 },
  rows: genView.rows,
  generations: [],
  generation: 0,
  identity: identityTable,
  openerByTurn: genView.openerByTurn,
});

/* =====================================================================
 * 1 — the endpoint reproduces the page, record for record
 * ===================================================================== */

const NEEDLES = ['needle', 'the needle is in', 'working on it', 'read', 'second question', 'zzz', 'trimmed'];
for (const needle of NEEDLES) {
  const expected = pageHits(allPayload, needle);
  const got = collectSearchHits(allPayload, foldNeedle(needle), 500);
  check(`"${needle}" finds the records the page found`, got.hits.map((h) => h.index), expected);
  check(`"${needle}" counts them the same way`, got.total, expected.length);
}

// The same for a generation view, because the whole point of a view is that it shows different
// versions of the same message and a search has to follow the view.
const gen0Needle = 'needle';
check('a generation view finds the records ITS records contain',
  collectSearchHits(gen0Payload, foldNeedle(gen0Needle), 500).hits.map((h) => h.index),
  pageHits(gen0Payload, gen0Needle));

/* =====================================================================
 * 2 — a suppressed version is not a hit
 * ===================================================================== */

// Generation 1's copy of `tr1` carries the compaction marker and no result. Nothing in the whole
// lineage view shows it, so nothing may be reported from it. This is the failure a scan over the
// stored rows would produce and this one must not.
const trimmedCopyIsStored = occurrences.some((o) => String(o.row.message.content).includes('Tool result removed'));
assert('the fixture really does store the trimmed copy', trimmedCopyIsStored);
check('the whole-lineage search reports the message once, from the version on show',
  collectSearchHits(allPayload, foldNeedle('needle'), 500).hits.filter((h) => allPayload.turns.flatMap((t) => t.records).find((r) => r.index === h.index)?.id === 'tr1').length, 1);
check('and never reports a record index the ledger does not have',
  collectSearchHits(allPayload, foldNeedle('needle'), 500).hits
    .filter((h) => !allPayload.turns.flatMap((t) => t.records).some((r) => r.index === h.index)).length, 0);
// The trimmed copy carries wording that exists NOWHERE else in the lineage, so it is the one needle
// that can only be answered by that version. The whole-lineage view does not show it, so it may not
// be reported; the generation that HOLDS it does show it, so it must be. One assertion, both ways.
const trimmedOnly = foldNeedle('Tool result removed by context compaction');
check('the whole-lineage search does not report a version it is not showing',
  collectSearchHits(allPayload, trimmedOnly, 500).total, 0);

const gen1View = selectIdentityView(identityTable, 1);
const gen1Payload = buildTrajectoryPayload({
  session: { id: 's1', createdAtMs: 2000 },
  rows: gen1View.rows,
  generations: [],
  generation: 1,
  identity: identityTable,
  openerByTurn: gen1View.openerByTurn,
});
assert('the generation that holds the trimmed copy really does show it',
  gen1Payload.turns.flatMap((t) => t.records).some((r) => String(r.result).includes('Tool result removed')));
check('and a search in THAT view reports it',
  collectSearchHits(gen1Payload, trimmedOnly, 500).total, 1);
check('and reports it at the index that view gives it, not at a stored one',
  collectSearchHits(gen1Payload, trimmedOnly, 500).hits.map((h) => h.index),
  pageHits(gen1Payload, 'Tool result removed by context compaction'));

/* =====================================================================
 * 3 — the count is the count; the cap is on the send
 * ===================================================================== */

const many = {
  turns: [{
    index: 1,
    records: Array.from({ length: 40 }, (_, i) => ({
      index: i + 1, kind: 'reply', summary: `needle ${i}`, text: null, result: null, thinking: null, toolName: null, generation: 0,
    })),
  }],
};
const capped = collectSearchHits(many, foldNeedle('needle'), 10);
check('the cap bounds what is returned', capped.hits.length, 10);
check('and not what is counted', capped.total, 40);
const uncapped = collectSearchHits(many, foldNeedle('needle'), 1000);
check('without a cap everything is returned', uncapped.hits.length, 40);
check('and the count is still right', uncapped.total, 40);
check('a limit of zero returns nothing and still counts',
  [collectSearchHits(many, foldNeedle('needle'), 0).hits.length, collectSearchHits(many, foldNeedle('needle'), 0).total], [0, 40]);

check('a hit carries the turn it is in',
  collectSearchHits(allPayload, foldNeedle('needle'), 500).hits.every((h) => Number.isInteger(h.turnIndex)), true);
check('a hit carries a summary, never the body it matched in',
  collectSearchHits(allPayload, foldNeedle('needle'), 500).hits.every((h) => typeof h.summary === 'string' && !h.summary.includes('\n')), true);
check('a hit carries the generation it is in',
  collectSearchHits(allPayload, foldNeedle('needle'), 500).hits.every((h) => h.generation === 0 || h.generation === 1), true);
check('a payload with no turns answers nothing',
  collectSearchHits({}, foldNeedle('needle'), 500), { hits: [], total: 0 });

/* =====================================================================
 * 4 — a needle never crosses a record, and never gets that far if too short
 * ===================================================================== */

const boundary = {
  turns: [{
    index: 1,
    records: [
      { index: 1, kind: 'reply', summary: 'the last word of one', text: null, result: null, thinking: null, toolName: null, generation: 0 },
      { index: 2, kind: 'reply', summary: 'the first word of the next', text: null, result: null, thinking: null, toolName: null, generation: 0 },
    ],
  }],
};
check('a needle spanning two records finds nothing', collectSearchHits(boundary, foldNeedle('one the first'), 500).total, 0);
check('and each side is still findable',
  collectSearchHits(boundary, foldNeedle('last word of one'), 500).total, 1);

assert('a one-character needle is not a search', !needleIsUsable('x'));
assert('a two-character needle is', needleIsUsable('xy'));
check('whitespace does not count toward the floor', needleIsUsable('  '), false);

/* =====================================================================
 * 5 — the shape the route depends on
 * ===================================================================== */

assert('the route exists and is not the trajectory route',
  SERVER.includes("url.pathname === '/api/trajectory/search'")
  && !SERVER.includes("url.pathname === '/api/trajectory/search/"));
assert('the endpoint answers through the one search helper',
  SERVER.includes('collectSearchHits(payload, needle, MAX_SEARCH_HITS)'));
assert('the lineage is walked in one place, and both readers use it',
  (SERVER.match(/collectLineage\(entry, /g) ?? []).length === 2
  && SERVER.includes('const collectLineage = async'));
// Both readers project the slice they were asked for. A search that quietly widened to the whole
// lineage would answer every query with generations the reader is not looking at — and the guard's
// own fixtures cannot see it, because they call the pure helper with a payload already chosen.
assert('both readers project the requested slice, not the whole lineage',
  (SERVER.match(/selectIdentityView\(identityTable, filter\)/g) ?? []).length === 2);
assert('a failed artifact write cannot fail the search that asked for it',
  /void publishSearchArtifacts\(\{[\s\S]*?\}\)\.catch\(\(\) => undefined\);/.test(SERVER));
assert('a needle too short is refused with a status, not answered with everything',
  /search_query_required/.test(SERVER) && /needleIsUsable\(asked\)/.test(SERVER));
assert('the artifacts are written under the runtime data dir',
  SERVER.includes("join(context.dataDir, 'trajectory-artifacts')"));
assert('and never beside the session history or inside the package',
  !/trajectory-artifacts['"]\s*,\s*entry\.dir/.test(SERVER));
assert('the session key is a hash, so no session id becomes a directory name',
  /createHash\('sha256'\)\.update\(`\$\{dir\}\\n\$\{sessionId\}`\)/.test(SERVER));
assert('writing the artifacts cannot fail the request that asked for a search',
  /\.catch\(\(\) => undefined\)/.test(SERVER));
/* =====================================================================
 * 3 — the artifact path answers exactly what the rebuild answers
 * ===================================================================== */

/**
 * The endpoint can now skip the rebuild: the stored index names every record and one segment per
 * generation holds their searchable text. Two paths answering one request is only a performance
 * change if they answer it IDENTICALLY, and the two ways they could differ are both silent — a hit
 * the ledger does not have, and a `total` that is really a cap.
 *
 * The comparison is made against the same payload the rebuild would have produced, so it is a
 * statement about the answers rather than about the plumbing.
 */
const ARTIFACT_FILES = [
  { filePath: '/store/s/g0.jsonl', fileName: 'g0.jsonl', generation: 0, size: 300, mtimeMs: 1, revision: 'r0', truncated: false },
  { filePath: '/store/s/g1.jsonl', fileName: 'g1.jsonl', generation: 1, size: 500, mtimeMs: 1, revision: 'r1', truncated: false },
];
// `fileIdxRowsFromPayload` wants the record -> locator map, not the record -> row map the split
// produces; the server builds it the same way before handing it over. Getting this wrong leaves
// every record at `-1`, which is a locator set with no file in it and would answer with no line.
const rowIndexByRecord = splitRawRecords(allPayload.turns);
const rowLocators = occurrences.map((o) => o.locator);
const locatorByRecord = new Map();
for (const [recordIndex, rowIndex] of rowIndexByRecord) {
  locatorByRecord.set(recordIndex, rowLocators[rowIndex]);
}
const fileIdxRows = fileIdxRowsFromPayload(allPayload, locatorByRecord, ARTIFACT_FILES);
const flatPairs = [];
for (const turn of allPayload.turns) for (const record of turn.records) flatPairs.push({ record, turn });
// The same merge the server does: the surface is built from the PAYLOAD's records and only the
// locator triple comes from the projection. Building it from anything else searches two of the five
// fields — `text`, `result` and `thinking` are the bulk ones — and that was a real bug this
// comparison did not catch, so it is now pinned directly rather than left to a needle that
// happens to match.
const segmentRecordsFor = (fileIdx) => {
  const out = [];
  for (let i = 0; i < flatPairs.length; i += 1) {
    const located = fileIdxRows[i];
    if (located === undefined || located.fileIdx !== fileIdx) continue;
    out.push({
      ...flatPairs[i].record,
      turnIndex: flatPairs[i].turn.index,
      fileIdx: located.fileIdx,
    });
  }
  return out;
};
// What the route now does: scan each generation's segment, then read the answers back off the lines
// the scan named, in one batch. The index is not consulted — that was the 34.2 MB it used to read on
// every search. The batch is the shape on purpose: reading one ordinal at a time walked the segment
// once per hit, which for a common needle is once per thousand records. The count is this guard's,
// the walk bound lives in verify-search-segments.mjs where the reader is.
const scanArtifacts = (folded) => {
  /** @type {Array<{ index: number, turnIndex: number | null, kind: string, summary: string, generation: number | null }>} */
  const hits = [];
  let total = 0;
  for (let fileIdx = 0; fileIdx < ARTIFACT_FILES.length; fileIdx += 1) {
    const surface = buildSegment({ records: segmentRecordsFor(fileIdx) }).surface;
    const found = readSegmentHits(surface, scanSegment(surface, folded));
    if (found.some((hit) => hit === null)) return null;
    total += found.length;
    for (const hit of found) {
      if (hits.length < limit) hits.push(hit);
    }
  }
  hits.sort((a, b) => a.index - b.index);
  return { hits, total };
};
let limit = 500;
const withLimit = (n) => {
  const saved = limit;
  limit = n;
  const out = scanArtifacts(foldNeedle('needle'));
  limit = saved;
  return out;
};

check('the locator projection kept every record the rebuild would have shown',
  fileIdxRows.length, allRecords.length);
assert('and it kept the generation each record came from',
  new Set(fileIdxRows.map((r) => r.fileIdx)).size === ARTIFACT_FILES.length);

// The direct version of the bug: a segment's line for a record must contain that record's own
// searchable text, in every field the endpoint searches. Read from the shipped server's own merge,
// because a guard that builds the merge itself would only prove that it and itself agree.
const bulkOnly = allRecords.find((r) => typeof r.result === 'string' && r.result.length > 0);
assert('the fixture really does hold a record whose match is only in a bulk field', bulkOnly !== undefined);
if (bulkOnly !== undefined) {
  const located = fileIdxRows[flatPairs.findIndex((pair) => pair.record === bulkOnly)];
  const line = buildSegment({ records: [{ ...bulkOnly, fileIdx: located.fileIdx }] }).surface;
  assert('and the segment carries that field, though the projection does not',
    !Object.prototype.hasOwnProperty.call(located, 'result') && line.includes(normaliseWhitespace(bulkOnly.result)));
  assert('the shipped server merges the payload into the segment for the same reason',
    /flatRecords\.push\(\{ record, turn \}\)/.test(SERVER)
    && /\.\.\.flatRecords\[i\]\.record,/.test(SERVER)
    && /turnIndex: flatRecords\[i\]\.turn\.index,/.test(SERVER));
}

for (const needle of NEEDLES) {
  const folded = foldNeedle(needle);
  const rebuilt = collectSearchHits(allPayload, folded, 500);
  const fromDisk = scanArtifacts(folded);
  check(`"${needle}" — the artifact path sends the same hits`, fromDisk.hits, rebuilt.hits);
  check(`"${needle}" — and counts them the same way`, fromDisk.total, rebuilt.total);
}

const capRebuilt = collectSearchHits(allPayload, foldNeedle('needle'), 2);
const capFromDisk = withLimit(2);
check('a cap bounds what is sent, on the artifact path too',
  capFromDisk.hits.length, Math.min(2, capRebuilt.total));
check('and never bounds what is counted', capFromDisk.total, capRebuilt.total);

// A line the scan named that cannot be read back is a segment written by something that does not
// agree with this reader. Answering without it would quietly drop a record, so the route falls
// back instead — and that decision has to be visible here, not only in the route's source text.
const gen0Surface = buildSegment({ records: segmentRecordsFor(0) }).surface;
const oneAnswer = (surface, ordinal) => readSegmentHits(surface, [ordinal])[0] ?? null;
check('an ordinal past the end of a segment is refused, not guessed',
  oneAnswer(gen0Surface, 9999), null);
check('and so is a negative or fractional one',
  [oneAnswer(gen0Surface, -1), oneAnswer(gen0Surface, 1.5)], [null, null]);
check('while the ordinals the scan really returns do read back',
  scanSegment(gen0Surface, foldNeedle('the needle is in')).map((o) => oneAnswer(gen0Surface, o)?.index ?? null),
  scanSegment(gen0Surface, foldNeedle('the needle is in')).map((o) => {
    const recs = segmentRecordsFor(0);
    return typeof recs[o].index === 'number' ? recs[o].index : -1;
  }));

/* ---------------------------------------------------------------------
 * A generation read short by our own cap produces a segment covering a
 * PREFIX, while its recorded `size` is the whole file. That rule is owned
 * where the comparison lives — verify-search-segments.mjs for `sameSource` — and is deliberately
 * NOT restated here: an assertion parked in a guard whose mutation control
 * never touches it reads as covered without being covered.
 * --------------------------------------------------------------------- */

/* ---------------------------------------------------------------------
 * The wiring. These read the shipped source, so they hold the shape rather
 * than the behaviour; the behaviour is the comparisons above.
 * --------------------------------------------------------------------- */
assert('the active generation IS stored as a segment, so a session still being written has something to scan',
  !/if \(fileIdx === activeIdx\) continue;/.test(SERVER));
assert('a generation with no records still gets one, and it is empty — "no segment" and "no records" must not read alike',
  !/records\.length === 0\) continue/.test(SERVER));
assert('one missing segment makes the whole search fall back rather than answer from the rest',
  /if \(segment === null\) return null;/.test(SERVER));

// The cap assertions above run against a copy of the loop written here, so they say the rule holds
// and not that the shipped route holds it. These read the shipped function: `total` is incremented
// for every match, the push is the thing that is bounded, and the return hands back the count.
const artifactsSrc = SERVER.slice(
  SERVER.indexOf('const searchFromArtifacts = async'),
  SERVER.indexOf('const publishSearchArtifacts = async'));
assert('and the shipped artifact path counts every match rather than what it sent',
  /total \+= 1;/.test(artifactsSrc)
  && /if \(hits\.length < MAX_SEARCH_HITS\) hits\.push\(hit\);/.test(artifactsSrc)
  && /return \{ hits, total \};/.test(artifactsSrc));

// The route resolves a whole scan in ONE call, because resolving one ordinal at a time walks the
// segment once per hit. That version is not a slower version of this one, it is the version that
// was shipped first: for a two-letter needle on the largest session here it walked 1.3 MB of
// segment 14,092 times and measured SLOWER than the 34.2 MB index read this step removed. The cost
// bound is pinned in verify-search-segments.mjs, where the reader itself is; what is pinned here is
// that the ROUTE takes the batch shape rather than a loop of single reads.
assert('the shipped artifact path resolves a whole scan in one batch call',
  /readSegmentHits\(segment\.surface, ordinals\)/.test(artifactsSrc)
  && !/for \(const ordinal of /.test(artifactsSrc));
// A hit the scan named that the reader cannot resolve means the segment was written by something
// that disagrees with this reader. Skipping it would drop a record and report a smaller total with
// nothing said about being wrong, so the route falls back like it does for a missing segment.
assert('a hit the scan named but the reader could not resolve falls back rather than being skipped',
  /if \(hit === null\) return null;/.test(artifactsSrc));
// And the index is not consulted at all — reading it was the 34.2 MB this step took off the path.
// This used to be scoped to "this path", because a store was still being *written* under the same
// name for a different reason. Nothing is written either now, so the rule is stated as what it is
// actually about: the whole server has no record index, in any form, and the module that built
// one is gone. A narrower version of this assertion would pass on a server that had reintroduced
// the index under a different name, which is the thing worth ruling out.
//
// Comments are stripped first. The server explains where the index went, and an explanation that
// named it would otherwise fail the rule that says there is none — so documenting the removal would
// have been the one way guaranteed to break this, and the incentive would have been to write
// nothing. `//` by whole line, because a `//` inside a string is a URL in this file.
const serverCode = SERVER
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');
assert('and the server holds no record index at all, in any form',
  !/indexStore|trajectory-index|collectSearchHitsFromArtifacts/.test(serverCode));
// The three names above are a list, and a list only catches what is on it: a store rebuilt under a
// fresh name would pass. The on-disk shape is not a name, though — the removed store's whole cost
// was that it made a second directory under the artifact root and filled it on every publish, so
// the property worth stating is that there IS no second directory. Segments are the only artifact;
// the root holds exactly one subdirectory and it is the one they live in.
const artifactDirs = [...serverCode.matchAll(/join\(\s*artifactRoot\s*,\s*'([^']+)'\s*\)/g)].map((m) => m[1]);
assert('and the artifact root holds segments and nothing else',
  artifactDirs.length === 1 && artifactDirs[0] === 'search');
// Two paths answering one request is only a performance change if they answer it identically,
// and the response body is part of the answer the page reads.
check('both paths send the same session field',
  (SERVER.match(/session: \{ id: ctx\.identity\.id, generation: filter \}/g) || []).length, 2);
// Scoped to handleSearch's own text: the same two lines also appear in the trajectory route, and
// a whole-file indexOf would compare a search against an unrelated request's body.
const handleSearchSrc = SERVER.slice(
  SERVER.indexOf('const handleSearch = async'),
  SERVER.indexOf('const searchFromArtifacts = async'));
assert('and the artifact path is tried before anything expensive',
  handleSearchSrc.indexOf('const onDisk = await searchFromArtifacts(') > 0
  && handleSearchSrc.indexOf('const identityTable = buildMessageIdentity(occurrences);') > 0
  && handleSearchSrc.indexOf('const onDisk = await searchFromArtifacts(')
    < handleSearchSrc.indexOf('const identityTable = buildMessageIdentity(occurrences);'));

// "Every generation in the lineage ends up with a segment" is the rule; naming the skip that used
// to be there would only pin the old bug. And the loop legitimately HAS early exits — an inner one
// that collects this generation's records, and an outer one that skips a generation already on
// disk — so the rule is about the OUTER level only, told apart by indentation: an outer exit is
// indented six spaces, an inner one eight. A generation may only be passed over after something
// was read back for it.
const publishSrc = SERVER.slice(
  SERVER.indexOf('const publishSearchArtifacts = async'),
  SERVER.indexOf('void entry;'));
const generationLoop = publishSrc.slice(
  publishSrc.indexOf('for (let fileIdx = 0; fileIdx < files.length; fileIdx += 1) {'));
const outerContinues = generationLoop.match(/^ {6}(?! )[^\n]*\bcontinue;/gm) || [];
assert('every generation ends up with a segment: the only outer early exit is "already on disk", and it comes after the read',
  generationLoop.length > 0
  && outerContinues.length <= 1
  && (outerContinues.length === 0
    || (outerContinues[0].includes('existing !== null')
      && generationLoop.indexOf(outerContinues[0]) > generationLoop.indexOf('segmentStore.read('))));


/* --------------------------------------------------------------------- */

if (failures.length) {
  console.log(`\n  [search-endpoint] ${failures.length} failure(s):`);
  for (const line of failures) console.log(`    - ${line}`);
  console.log('');
  process.exitCode = 1;
} else {
  console.log(`[search-endpoint] ${pass} assertions passed`);
}
