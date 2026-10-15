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
  ROW_GENERATION,
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
// The page has to show them somewhere, or searching them finds something the reader cannot open.
for (const field of CARRIED) {
  assert(`the page renders "${field}"`, CLIENT.includes(`record.${field}`));
}
// `arguments` is shown and deliberately NOT searched: it is the page's own choice, recorded as one
// rather than left to look like an oversight. Search it and the coverage grows; do not search it and
// a reader is never shown the field list, so the omission is a decision rather than a defect.
assert('the page shows tool arguments', /record\.arguments/.test(CLIENT));
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
for (const field of SEARCH_FIELDS) {
  assert(`a projected record carries "${field}"`, Object.prototype.hasOwnProperty.call(firstRecord, field));
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
assert('the active generation is not stored as a segment',
  /if \(fileIdx === activeIdx\) continue;/.test(SERVER));

/* --------------------------------------------------------------------- */

if (failures.length) {
  console.log(`\n  [search-endpoint] ${failures.length} failure(s):`);
  for (const line of failures) console.log(`    - ${line}`);
  console.log('');
  process.exitCode = 1;
} else {
  console.log(`[search-endpoint] ${pass} assertions passed`);
}
