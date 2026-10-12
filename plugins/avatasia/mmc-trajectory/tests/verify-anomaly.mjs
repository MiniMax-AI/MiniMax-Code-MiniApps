// Evidence for the 异常 filter.
//
// The rule set is three predicates, and two of them are one comparison each — a table like that
// cannot be wrong in an interesting way. What can be wrong, and what a fixture cannot show, is
// whether the page's own bookkeeping agrees with the payload:
//
//  1. The rule counts on the buttons are computed by a second walk of the flat list. If that walk
//     and `visibleEntries()` ever disagree, a button promises a number the ledger will not
//     deliver — which is the same class of bug this file has been bitten by twice already.
//  2. 无答复 is a property of a TURN, and the strip is handed a bare record. So the turn has to
//     come back out of an index. If that index is wrong or missing, the strip and the ledger
//     answer different questions about the same row.
//  3. The turn still running must not be flagged. It is open because it is going.
//
// So the load-bearing checks below all run against the live session payload, and the expected
// numbers are counted straight off it by code that shares nothing with the page.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const HTML = join(HERE, '..', 'miniapp', 'client', 'index.html');
// Section 4 used to boot the service and fetch /api/trajectory from a port read out of
// .probe/port.txt. The payload is now the committed one from make-payload.mjs.
const PAYLOAD = join(HERE, 'fixtures', 'trajectory.json');

const html = readFileSync(HTML, 'utf8');

/* ---------- helpers ---------- */
let pass = 0;
const failures = [];
// Names are kept separately from the human-readable detail. They used to be recovered from the
// detail line with `split(':')[0]`, which quietly truncates any assertion whose name contains a
// colon — and the mutation runner matches on these names, so a truncated name reads as a
// mutation that went uncaught by a guard that in fact caught it.
const failedNames = [];
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass += 1;
  else {
    failedNames.push(name);
    failures.push(name + ': got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected));
  }
}
function assert(name, cond) {
  if (cond) pass += 1;
  else {
    failedNames.push(name);
    failures.push(name);
  }
}
function fnSource(sig) {
  const start = html.indexOf(sig);
  if (start < 0) return '';
  let i = html.indexOf('{', start);
  let depth = 0;
  for (let j = i; j < html.length; j += 1) {
    if (html[j] === '{') depth += 1;
    else if (html[j] === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, j + 1);
    }
  }
  return '';
}

/* ---------- 1) the rule table itself ---------- */
const rawSlice = html.split('PURE:START')[1].split('PURE:END')[0];
let block = rawSlice.slice(rawSlice.indexOf('*/') + 2);
const lastCloser = block.lastIndexOf('*/');
const dangling = block.indexOf('/*', lastCloser === -1 ? 0 : lastCloser + 2);
if (dangling >= 0) block = block.slice(0, dangling);
const pure = { console };
vm.createContext(pure);
vm.runInContext(block, pure);

check('the rule set', pure.ANOMALY_RULE_IDS, ['toolError', 'compaction', 'noReply', 'silent']);
check('rule labels', pure.ANOMALY_RULES.map((r) => r.label), ['工具失败', '上下文压缩', '无答复', '空答复']);

// A rule is scoped to a record or to a turn, never both and never neither. A rule with neither
// would silently match nothing and still get a button with a count on it.
for (const rule of pure.ANOMALY_RULES) {
  assert('rule ' + rule.id + ' has exactly one scope', !!rule.record !== !!rule.turn);
  assert('rule ' + rule.id + ' has an id and a label', !!rule.id && !!rule.label);
}
assert('rule ids are unique', new Set(pure.ANOMALY_RULE_IDS).size === pure.ANOMALY_RULES.length);
check('an unknown id labels as itself', pure.anomalyRuleLabel('nope'), 'nope');
check('an empty id labels as the dash', pure.anomalyRuleLabel(''), '—');

/* ---------- 2) rule semantics on hand-built records ---------- */
const CLOSED = { index: 1, closed: true, records: [] };
const BROKEN = { index: 2, closed: false, records: [] };
const LIVE = { index: 3, closed: false, records: [] };
const withLive = (turn) => ({ turn, liveTurn: LIVE });

check('a failing tool result is a tool failure',
  pure.recordAnomalyRules({ kind: 'toolResult', isError: true }, { turn: CLOSED, liveTurn: LIVE }),
  ['toolError']);
check('a successful tool result is not',
  pure.recordAnomalyRules({ kind: 'toolResult', isError: false }, { turn: CLOSED, liveTurn: LIVE }), []);
check('an absent isError is not a failure — null is not true',
  pure.recordAnomalyRules({ kind: 'toolResult', isError: null }, { turn: CLOSED, liveTurn: LIVE }), []);
check('the string "true" is not a failure either',
  pure.recordAnomalyRules({ kind: 'toolResult', isError: 'true' }, { turn: CLOSED, liveTurn: LIVE }), []);
check('a checkpoint is a compaction',
  pure.recordAnomalyRules({ kind: 'compaction' }, { turn: CLOSED, liveTurn: LIVE }), ['compaction']);
// A thinking row is the clean case. `{ kind: 'reply' }` is not — a reply with no body is now
// an anomaly, which is the whole point of the rule below.
check('a normal row is not an anomaly',
  pure.recordAnomalyRules({ kind: 'thinking' }, { turn: CLOSED, liveTurn: LIVE }), []);

check('a turn that never answered, seen from inside it',
  pure.recordAnomalyRules({ kind: 'thinking' }, withLive(BROKEN)), ['noReply']);
check('a turn that answered is not one',
  pure.recordAnomalyRules({ kind: 'thinking' }, withLive(CLOSED)), []);

// This is the one that would have made the filter unusable: the live turn is open on every poll
// for as long as the session runs, so a rule that flagged it re-flagged the newest thing on
// screen every 2.5s and could never be left on.
check('the turn still running is not an anomaly',
  pure.recordAnomalyRules({ kind: 'thinking' }, { turn: LIVE, liveTurn: LIVE }), []);
assert('and the exclusion is by identity, not by position',
  pure.recordAnomalyRules({ kind: 'thinking' }, { turn: { index: 3, closed: false }, liveTurn: LIVE })
    .indexOf('noReply') >= 0);

// Two rules on one row is a real shape: a checkpoint sits inside a turn that never answered.
check('two rules can fire on one record',
  pure.recordAnomalyRules({ kind: 'compaction', isError: true }, withLive(BROKEN)),
  ['toolError', 'compaction', 'noReply']);

/* ---------- 2b) an empty reply: a reply AND an anomaly, and neither rule alone sees it ---------- */
// This is the shape a reader actually met. The turn finished normally and delivered nothing,
// so `closed` is true and 无答复 cannot fire — and the record is still `kind: 'reply'`, so it
// remains a real reply that the 答复 chip counts. Missing it was a hole in the rule set, not a
// subtlety: every other rule tests a field that was present, this one tests an absence.
const SILENT = { kind: 'reply', text: null, summary: '', title: 'assistant', stopReason: 'stop' };
const SPOKE = { kind: 'reply', text: '答完了。', summary: '答完了。', stopReason: 'stop' };

check('a reply with no body is an empty answer',
  pure.recordAnomalyRules(SILENT, { turn: CLOSED, liveTurn: LIVE }), ['silent']);
check('a reply that said something is not',
  pure.recordAnomalyRules(SPOKE, { turn: CLOSED, liveTurn: LIVE }), []);

// 既算回复也算异常, checked from both sides rather than asserted once.
assert('an empty answer keeps its kind — it is still a reply',
  SILENT.kind === 'reply' && pure.hasKind(SILENT, ['reply']) === true);
assert('and the whole kind set still contains it',
  pure.hasKind(SILENT, pure.KIND_ORDER) === true);
assert('so unchecking 答复 hides it, exactly as it hides any other reply',
  pure.hasKind(SILENT, pure.KIND_ORDER.filter((k) => k !== 'reply')) === false);

// 无答复 must NOT double-count it: an empty reply closes its turn, so the turn-level rule has
// nothing to fire on and the whole thing rests on the one record-level rule.
check('an empty answer in a closed turn is only the empty answer',
  pure.recordAnomalyRules(SILENT, { turn: CLOSED, liveTurn: LIVE }), ['silent']);
check('the same record in a turn that never answered fires both',
  pure.recordAnomalyRules(SILENT, withLive(BROKEN)), ['noReply', 'silent']);

// An empty string counts as no body; whitespace does not, because a reader sees something.
check('an empty string is an empty answer',
  pure.recordAnomalyRules({ kind: 'reply', text: '' }, { turn: CLOSED, liveTurn: LIVE }), ['silent']);
check('whitespace is not an empty answer',
  pure.recordAnomalyRules({ kind: 'reply', text: ' ' }, { turn: CLOSED, liveTurn: LIVE }), []);
// A clipped reply still has a body, however short. textTruncated is not the test.
check('a clipped reply is not an empty answer',
  pure.recordAnomalyRules({ kind: 'reply', text: '很长的…', textTruncated: true },
    { turn: CLOSED, liveTurn: LIVE }), []);
// Only replies. A checkpoint has no body by design and is already its own rule; counting it
// twice would make the union smaller than the parts, which is the one thing `any` must not be.
check('a checkpoint is not also an empty answer',
  pure.recordAnomalyRules({ kind: 'compaction', text: null }, { turn: CLOSED, liveTurn: LIVE }),
  ['compaction']);
check('a system record with no body is not an empty answer',
  pure.recordAnomalyRules({ kind: 'system', text: null }, { turn: CLOSED, liveTurn: LIVE }), []);

/* ---------- 3) off is not "match nothing" ---------- */
const OFF = [];
const ALL = pure.ANOMALY_RULE_IDS.slice();
assert('the filter off lets a clean record through',
  pure.passesAnomaly({ kind: 'reply' }, { turn: CLOSED, liveTurn: LIVE }, OFF) === true);
assert('the filter off lets an anomalous record through too',
  pure.passesAnomaly({ kind: 'compaction' }, { turn: CLOSED, liveTurn: LIVE }, OFF) === true);
assert('no rule at all is off, not an empty result',
  pure.passesAnomaly({ kind: 'reply' }, { turn: CLOSED, liveTurn: LIVE }, null) === true);
assert('undefined enabled is off too',
  pure.passesAnomaly({ kind: 'reply' }, { turn: CLOSED, liveTurn: LIVE }, undefined) === true);

assert('all rules on keeps the anomaly',
  pure.passesAnomaly({ kind: 'compaction' }, { turn: CLOSED, liveTurn: LIVE }, ALL) === true);
assert('all rules on drops the clean record',
  pure.passesAnomaly({ kind: 'thinking' }, { turn: CLOSED, liveTurn: LIVE }, ALL) === false);
assert('one rule on keeps only that rule',
  pure.passesAnomaly({ kind: 'compaction' }, { turn: CLOSED, liveTurn: LIVE }, ['compaction']) === true);
assert('one rule on drops a record only another rule matches',
  pure.passesAnomaly({ kind: 'toolResult', isError: true }, { turn: CLOSED, liveTurn: LIVE }, ['compaction']) === false);
assert('a rule nothing matches drops everything it is asked about',
  pure.passesAnomaly({ kind: 'reply' }, { turn: CLOSED, liveTurn: LIVE }, ['compaction']) === false);
assert('an enabled id that is not in the table matches nothing rather than everything',
  pure.passesAnomaly({ kind: 'compaction' }, { turn: CLOSED, liveTurn: LIVE }, ['bogus']) === false);

/* ---------- 4) against the committed payload ---------- */
const payload = JSON.parse(readFileSync(PAYLOAD, 'utf8'));

const page = { console, state: null };
vm.createContext(page);
// The whole PURE block runs here, verbatim, so the rules under test are the page's own rules
// and not a reconstruction of them. Only the functions that reach for state come from the
// client file.
vm.runInContext(block, page);
vm.runInContext('var turnById = new Map(); var overviewSpansById = new Map();', page);
page.state = {
  payload,
  flat: payload.turns.flatMap((turn) => turn.records.map((record) => ({ turn, record }))),
  kinds: pure.KIND_ORDER.slice(),
  query: '',
  // The anomaly axis is one field, not three: mode, rules and last describe one control
  // group and have to move together. 多选 defaults to off, so a reader who has never
  // touched the checkbox is in single mode — which is the behaviour the toggle is
  // asserted on below, and not an accident of the harness. Stated here rather than
  // omitted so that forgetting it fails loudly instead of quietly testing the union
  // branch.
  anomaly: { mode: 'single', rules: [], last: null },
  // 多选 defaults to off, so a reader who has never touched the checkbox is in single mode —
  // which is the behaviour the toggle is asserted on below, and not an accident of the harness
  rangeFrom: null,
  rangeTo: null,
  rangeCutoff: null,
  overviewSelection: null
};
for (const turn of payload.turns) if (turn && turn.id) page.turnById.set(turn.id, turn);

for (const name of ['recordInRange', 'hasTimeRange', 'inTimeRange', 'recordInSelection',
  'recordVisible', 'liveTurn', 'anomalyCounts', 'visibleEntries',
  'turnAnomalyRules', 'spanPassesFilter']) {
  const src = fnSource('function ' + name + '(');
  if (!src) throw new Error('could not extract ' + name);
  vm.runInContext(src, page);
}

/* The expected numbers, counted straight off the payload by code that shares nothing with the
   page. This is the whole point of the file. */
const liveTurn = payload.turns[payload.turns.length - 1];
const brokenTurns = new Set(payload.turns.filter((t) => t.closed === false && t !== liveTurn));
// `noReply` is counted in turns, because that is the unit the page publishes it in: it is a
// rule about a turn, and counting the records inside it is what produced the original lie —
// over a thousand "unanswered" rows in a session that was actually broken a dozen times. The
// record count is still needed for the overlap check, so it is kept under its own name rather
// than being quietly dropped.
const expect = { toolError: 0, compaction: 0, noReply: brokenTurns.size, silent: 0 };
let noReplyRecords = 0;
let expectAny = 0;
const emptyReplies = [];
for (const turn of payload.turns) {
  for (const record of turn.records) {
    const hits = [];
    if (record.isError === true) { expect.toolError += 1; hits.push(1); }
    if (record.kind === 'compaction') { expect.compaction += 1; hits.push(1); }
    if (brokenTurns.has(turn)) { noReplyRecords += 1; hits.push(1); }
    // Written out rather than calling isNil, so this stays an independent reading of the
    // payload rather than a second call into the rule the check is meant to test.
    if (record.kind === 'reply'
      && (record.text === null || record.text === undefined || record.text === '')) {
      expect.silent += 1;
      hits.push(1);
      emptyReplies.push({ turn, record });
    }
    if (hits.length) expectAny += 1;
  }
}

console.log('fixture: ' + payload.turns.length + ' turns, '
  + payload.turns.reduce((n, t) => n + t.records.length, 0) + ' records, '
  + brokenTurns.size + ' turns that never answered');

assert('the fixture has failures to find', expect.toolError > 0);
assert('the fixture has checkpoints to find', expect.compaction > 0);
assert('the fixture has unanswered turns to find', expect.noReply > 0);
assert('and it holds replies that delivered nothing', expect.silent > 0);
assert('they overlap, so `any` is not the sum',
  expectAny < expect.toolError + expect.compaction + expect.silent + noReplyRecords);

// Every empty reply in this session sits in a turn that closed, which is precisely why 无答复
// never reported it. If one of them ever landed in an unclosed turn, the two rules would start
// overlapping and the claim "the empty-answer rule is the only one that can see these" would
// stop being true — so it is checked against the live session rather than assumed.
assert('every empty reply sits in a turn that closed',
  emptyReplies.every((e) => e.turn.closed === true));
assert('so 无答复 genuinely cannot see them',
  emptyReplies.every((e) => brokenTurns.has(e.turn) === false));
assert('and they keep their kind', emptyReplies.every((e) => e.record.kind === 'reply'));

const all = page.anomalyCounts();
check('tool failure count matches the payload', all.byRule.toolError, expect.toolError);
check('compaction count matches the payload', all.byRule.compaction, expect.compaction);
check('unanswered count matches the payload, counted in turns', all.byRule.noReply, expect.noReply);
check('empty answer count matches the payload', all.byRule.silent, expect.silent);
check('the union count matches the payload', all.any, expectAny);

// The unit is part of the claim, not decoration on it. A number without one is read as 条 by
// default, which is exactly how a turn rule came to advertise a thousand records.
check('the turn rule publishes itself in 轮', all.unit.noReply, '轮');
assert('and every record rule publishes itself in 条',
  pure.ANOMALY_RULE_IDS.every((id) => all.unit[id] === '条' || all.unit[id] === '轮'));
assert('the unit follows the rule table, not the button',
  pure.ANOMALY_RULES.every((r) => all.unit[r.id] === (r.turn ? '轮' : '条')));

// The button and the ledger are the same statement about the same records. If these ever drift,
// a button is advertising rows the list refuses to render. The filter has to be on first —
// compared with it off, the ledger returns everything and the check would pass for free.
page.state.anomaly.rules = pure.ANOMALY_RULE_IDS.slice();
check('the button count is the length of the list behind it', all.any, page.visibleEntries().length);
for (const id of pure.ANOMALY_RULE_IDS) {
  page.state.anomaly.rules = [id];
  const only = page.visibleEntries();
  if (all.unit[id] === '条') {
    check('one rule on shows exactly what it counts — ' + id, only.length, all.byRule[id]);
  } else {
    // A turn rule publishes turns and puts on screen every record of those turns. Both halves
    // are checked, because a button promising N turns above a list of M records only adds up
    // if the list is exactly the records of N turns — and if those turns are the ones it named.
    check('a turn rule shows every record of the turns it counts — ' + id, only.length, noReplyRecords);
    check('and exactly the turns it published — ' + id,
      new Set(only.map((e) => e.turn.index)).size, all.byRule[id]);
  }
  assert('nothing else leaked into that filter — ' + id,
    only.every((e) => pure.recordAnomalyRules(e.record, { turn: e.turn, liveTurn })
      .indexOf(id) >= 0));
  assert('that filter is not the whole ledger — ' + id, only.length < page.state.flat.length);
}

/* A partial union is the one case the button counts above cannot reach. `all.any` is the union of
   every rule, and each single-rule check only ever selects one — so before this block nothing
   tested the selection 多选 exists to produce. The expected number is counted here by code that
   shares nothing with the page: a record is in the union when it trips any *selected* rule.
   Without it, `selected` could be the count of the whole table and every assertion above would
   still pass. */
const expectUnion = (ids) => page.state.flat.filter((e) => {
  const hits = pure.recordAnomalyRules(e.record, { turn: e.turn, liveTurn });
  return ids.some((id) => hits.indexOf(id) >= 0);
}).length;
// Record-level, not `byRule`: for a turn rule `byRule` counts turns, so adding it to a record
// count would subtract apples from oranges and report an overlap that is not there.
const recordCount = {};
for (const id of pure.ANOMALY_RULE_IDS) recordCount[id] = expectUnion([id]);

// Each pair, including the pairs with nothing in common. Every one of them has to give a number
// the ledger reproduces, which is the whole claim: a button, a note and a list that agree.
const pairResults = [];
for (const a of pure.ANOMALY_RULE_IDS) {
  for (const b of pure.ANOMALY_RULE_IDS) {
    if (b <= a) continue;
    page.state.anomaly.rules = [a, b];
    pairResults.push({
      a,
      b,
      selected: page.anomalyCounts().selected,
      listed: page.visibleEntries().length,
      expected: expectUnion([a, b]),
      overlap: recordCount[a] + recordCount[b] - expectUnion([a, b])
    });
  }
}
assert('a partial union is not the whole table, so it has to be counted separately',
  pairResults.some((p) => p.selected < all.any));
// One family assertion per pair on top of the per-pair ones below. The per-pair names carry the
// pair, which is what makes a failure readable — and which also makes them unusable as the owner
// of a mutation, because which pair fires depends on the fixture. The family assertion has a
// stable name and is the one the mutation runner is pointed at.
check('a partial union is the length of the list behind it',
  pairResults.every((p) => p.selected === p.listed), true);
check('and it is the union of those rules and not some other set',
  pairResults.every((p) => p.selected === p.expected), true);
for (const p of pairResults) {
  check('a partial union is the length of the list behind it — ' + p.a + ' + ' + p.b,
    p.selected, p.listed);
  check('and it is the union of those two rules and not some other set — ' + p.a + ' + ' + p.b,
    p.selected, p.expected);
}
// The overlap is why the per-rule numbers cannot be added by hand, and why the note has to state
// the total instead of pointing at 全部异常 — which is the union of all four rules and therefore a
// different number again for any selection that is not all of them.
assert('some pair of rules genuinely overlaps, or the total would just be the sum',
  pairResults.some((p) => p.overlap > 0));
assert('and every partial union is smaller than 全部异常, so the two can never be confused',
  pairResults.every((p) => p.selected < all.any));

page.state.anomaly.rules = pure.ANOMALY_RULE_IDS.slice();
const everything = page.visibleEntries();
assert('every rule on is still only the anomalies', everything.length === expectAny);

// The strip is handed a bare record, so the turn comes back out of the index. If that lookup
// were missing, 无答复 would silently match nothing on the strip and everything in the ledger.
page.state.anomaly.rules = ['noReply'];
const byLedger = new Set(page.visibleEntries().map((e) => e.record.id));
const byStrip = new Set();
for (const entry of page.state.flat) {
  if (page.spanPassesFilter(entry.record, false)) byStrip.add(entry.record.id);
}
check('the strip and the ledger keep the same records', byStrip.size, byLedger.size);
assert('and it is the same records', [...byLedger].every((id) => byStrip.has(id)));
assert('the strip is not keeping everything', byStrip.size < page.state.flat.length);

page.state.anomaly.rules = [];

/* ---------- the two axes are exclusive, so the count must not follow the other one ----------
   This inverts what this file used to assert. It required a search to narrow the button count,
   which held exactly while the ledger narrowed it too — and that was the defect: the number was
   describing a filtered view that anomaly mode does not produce, so ticking the rule it was
   advertising gave the reader something else. The number on a button is what you get when you
   tick that button, so it cannot depend on a filter that is switched off at that moment. */
page.state.query = 'verify-time-range';
const searched = page.anomalyCounts();
check('a search does not move the union count', searched.any, expectAny);
check('nor a single record rule', searched.byRule.toolError, expect.toolError);
check('nor the turn rule', searched.byRule.noReply, expect.noReply);
// The list has to agree with that, or the count would be honest and the table would not be.
page.state.anomaly.rules = ['toolError'];
check('and while a rule is ticked the search does not narrow the list either',
  page.visibleEntries().length, expect.toolError);
page.state.anomaly.rules = [];
assert('but with no rule ticked the search is still a filter for the list',
  page.visibleEntries().length < page.state.flat.length);
page.state.query = '';

page.state.kinds = pure.KIND_ORDER.filter((k) => k !== 'toolResult');
const withoutToolResults = page.anomalyCounts();
check('unchecking 工具结果 does not move the count either',
  withoutToolResults.byRule.toolError, expect.toolError);
assert('and it still leaves the checkpoints alone',
  withoutToolResults.byRule.compaction === expect.compaction);
assert('but with no rule ticked it is still a filter for the list',
  page.visibleEntries().length < page.state.flat.length);
page.state.kinds = pure.KIND_ORDER.slice();

/* Turn-level, read on its own: the tag on the turn head. */
const flagged = payload.turns.filter((t) => page.turnAnomalyRules(t).length > 0);
check('every unanswered turn is flagged', flagged.length, brokenTurns.size);
assert('the live turn is not among them', flagged.indexOf(liveTurn) === -1);
check('a closed turn is never flagged',
  page.turnAnomalyRules({ index: 99, closed: true }).length, 0);
check('a rule that is record-scoped never tags a turn',
  page.turnAnomalyRules({ index: 98, closed: false, id: 'x' }).length, 1);
// The turn head is the only place 无答复 is written. A row-level badge was considered and
// dropped: turn 82 alone would have carried the tag 352 times, which buries it.
assert('no rule is tagged on a record',
  pure.ANOMALY_RULES.every((r) => typeof r.record !== 'function' || typeof r.turn !== 'function'));

/* ---------- 5) ticking, run rather than read ---------- */
// The static guards below can only see the shape of onAnomalyToggle. These run it, because the
// shape of a toggle is the same whether it adds, removes or does nothing.
page.resetWindowMode = () => {};
let renders = 0;
page.render = () => { renders += 1; };
const toggleSource = fnSource('function onAnomalyToggle(');
if (!toggleSource) throw new Error('could not extract onAnomalyToggle');
vm.runInContext(toggleSource, page);
// resetBaseFilters is real here, not stubbed: it is the thing that decides whether the row above
// ends up displaying a condition that is not in force. Only its two DOM-touching steps are
// stubbed, because what they do to the widgets is checked by their own guards.
const resetBaseSource = fnSource('function resetBaseFilters(');
if (!resetBaseSource) throw new Error('could not extract resetBaseFilters');
vm.runInContext(resetBaseSource, page);
let rangeCleared = 0;
page.clearTimeRange = () => { rangeCleared += 1; };
page.syncKindButtons = () => {};
// The checkbox is the only part of 多选 that exists outside `state`, and 重置 has to write it.
// A stub with a real `checked` field is what lets that be asserted as behaviour rather than
// inferred from the assignment appearing in the source.
page.dom = { searchInput: null, anomalyMulti: { checked: false } };

/* The note, run rather than read. Its whole job is to publish a number that describes the rows
   under it, and the defect it replaces — 合计见「全部异常」, which pointed at the union of all four
   rules for a selection of two — is a sentence that is perfectly well-formed and wrong. Source
   shape cannot tell a correct sentence from a plausible one; running it can. */
page.document = { body: { setAttribute() {} }, querySelectorAll() { return []; } };
page.dom.anomalyNote = { hidden: true, textContent: '' };
for (const name of ['formatInt', 'syncAnomalyMode']) {
  const src = fnSource('function ' + name + '(');
  if (!src) throw new Error('could not extract ' + name);
  vm.runInContext(src, page);
}
const noteText = (rules, multi) => {
  page.state.anomaly.rules = rules;
  page.state.anomaly.mode = multi ? 'multi' : 'single';
  page.dom.anomalyNote.textContent = '';
  page.syncAnomalyMode(page.anomalyCounts());
  return page.dom.anomalyNote.textContent;
};
const hasNumber = (text, n) => text.includes(page.formatInt(n) + ' 条');
const countOf = (text) => {
  const m = text.match(/合计 ([\d,]+) 条/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
};
const pairs = [];
for (const a of pure.ANOMALY_RULE_IDS) {
  for (const b of pure.ANOMALY_RULE_IDS) if (b > a) pairs.push([a, b]);
}

// The defect, stated as the shape that would reintroduce it. A partial selection is not 全部异常,
// so a total that is not the partial selection's own is the failure, however it is worded.
const notePairs = pairs.map(([a, b]) => {
  const text = noteText([a, b], true);
  page.state.anomaly.rules = [a, b];
  const expected = page.anomalyCounts().selected;
  return { a, b, text, expected, printed: countOf(text) };
});
check('the note publishes the total for the rules that are ticked',
  notePairs.every((p) => p.printed === p.expected), true);
check('and it is a number, not a pointer somewhere else',
  notePairs.every((p) => hasNumber(p.text, p.expected)), true);
for (const p of notePairs) {
  check('the note publishes the total for the rules that are ticked — ' + p.a + ' + ' + p.b,
    p.printed, p.expected);
  assert('and it is a number, not a pointer somewhere else — ' + p.a + ' + ' + p.b,
    hasNumber(p.text, p.expected));
}
page.state.anomaly.rules = [pure.ANOMALY_RULE_IDS[0], pure.ANOMALY_RULE_IDS[1]];
check('the whole set says the same thing',
  countOf(noteText(pure.ANOMALY_RULE_IDS.slice(), true)), all.any);

// 叠加 is 多选's word. In 单选 the only way more than one rule is ever on is 全部异常 — which the
// reader pressed one button to get, rather than stacked four times.
const textMulti = noteText(['toolError', 'compaction'], true);
const textSingle = noteText(['toolError', 'compaction'], false);
assert('多选 calls a stack a stack', textMulti.includes('已叠加'));
assert('单选 does not claim a stack the reader never built', !textSingle.includes('已叠加'));
assert('and 单选 says what is actually happening instead', textSingle.includes('同时生效'));

page.state.anomaly.rules = [];
page.state.anomaly.mode = 'single';

/* 单选 is what the page opens in, so it is what the toggle is read in first. Two assertions here
   used to say the opposite — that ticking a second rule *adds* to the first, and that unticking
   takes off only the one clicked — because the toggle had no mode and stacked unconditionally.
   Those were true of the old code and are false of the new one by request, so they are rewritten
   onto 单选 rather than deleted, and the union they were written for is re-asserted below with
   多选 actually turned on. Nothing here is checked from the source text: a toggle's shape is the
   same whether it adds, removes, replaces or does nothing, so it has to be run. */
page.state.anomaly.rules = [];
page.state.anomaly.mode = 'single';
page.state.anomaly.last = null;
page.onAnomalyToggle('toolError');
check('单选: ticking one rule', page.state.anomaly.rules, ['toolError']);
page.onAnomalyToggle('compaction');
check('单选: ticking a second replaces the first instead of stacking',
  page.state.anomaly.rules, ['compaction']);
page.onAnomalyToggle('compaction');
check('单选: pressing the rule already on turns it off again',
  page.state.anomaly.rules, []);
check('and that did not turn 多选 on as a side effect', page.state.anomaly.mode, 'single');

page.onAnomalyToggle(null);
check('全部异常 ticks the whole set', page.state.anomaly.rules, pure.ANOMALY_RULE_IDS);
vm.runInContext('this.__aliased = state.anomaly.rules === ANOMALY_RULE_IDS;', page);
check('全部异常 ticks a copy, not the table itself', page.__aliased, false);
page.onAnomalyToggle(null);
check('and 全部异常 again unticks it', page.state.anomaly.rules, []);

page.state.anomaly.rules = ['compaction'];
page.onAnomalyToggle(null);
check('全部异常 from a partial selection ticks everything, not just the rest',
  page.state.anomaly.rules, pure.ANOMALY_RULE_IDS);

/* 多选 on: the union the two rewritten assertions above used to describe, now reachable. */
page.state.anomaly.rules = [];
page.state.anomaly.mode = 'multi';
page.onAnomalyToggle('compaction');
check('多选: the first rule is ticked the same way it is in 单选',
  page.state.anomaly.rules, ['compaction']);
page.onAnomalyToggle('toolError');
check('多选: ticking a second stacks instead of replacing',
  page.state.anomaly.rules, ['toolError', 'compaction']);
page.onAnomalyToggle('noReply');
check('多选: three rules stack, and in table order rather than click order',
  page.state.anomaly.rules, ['toolError', 'compaction', 'noReply']);
page.onAnomalyToggle('toolError');
check('多选: unticking removes only that one', page.state.anomaly.rules,
  ['compaction', 'noReply']);
page.onAnomalyToggle('compaction');
check('and the stack can be taken all the way down to nothing',
  page.state.anomaly.rules, ['noReply']);

/* Turning 多选 off. The buttons stop being able to hold more than one rule, so a stack of three
   has to lose two of them here rather than at the next click — otherwise the controls are showing
   a selection they can no longer express, which is the same class of mismatch as a button whose
   number does not match its list. Which two lose is asserted, not left open. */
const multiSrc = fnSource('function onAnomalyMultiChange(');
if (!multiSrc) throw new Error('could not extract onAnomalyMultiChange');
vm.runInContext(multiSrc, page);
page.state.anomaly.rules = ['toolError', 'compaction'];
page.state.anomaly.last = 'compaction';
page.state.anomaly.mode = 'multi';
page.onAnomalyMultiChange(false);
check('turning 多选 off keeps the rule ticked last, not the first in table order',
  page.state.anomaly.rules, ['compaction']);
check('and the mode itself is recorded as off', page.state.anomaly.mode, 'single');

page.state.anomaly.rules = ['toolError', 'silent'];
page.state.anomaly.last = 'noReply';
page.state.anomaly.mode = 'multi';
page.onAnomalyMultiChange(false);
check('when the last-ticked rule has since been unticked, a rule still remains',
  page.state.anomaly.rules, ['toolError']);

page.state.anomaly.rules = ['silent'];
page.state.anomaly.last = 'silent';
page.state.anomaly.mode = 'multi';
page.onAnomalyMultiChange(false);
check('turning 多选 off with only one rule selected keeps it', page.state.anomaly.rules, ['silent']);
// The other direction is not a no-op by construction: 全部异常 can leave four rules ticked while
// the mode is 单选, and turning 多选 on then must not quietly thin them down.
page.state.anomaly.rules = pure.ANOMALY_RULE_IDS.slice();
page.state.anomaly.last = null;
page.state.anomaly.mode = 'single';
page.onAnomalyMultiChange(true);
check('turning 多选 on changes the mode and nothing else',
  page.state.anomaly.rules, pure.ANOMALY_RULE_IDS);
check('and the mode is recorded as on', page.state.anomaly.mode, 'multi');
page.state.anomaly.mode = 'single';

// Ticking a rule puts the row above back to its default. In anomaly mode that row filters
// nothing, so leaving it holding 「用户」 would be the page showing a condition that is not in
// force — the same class of defect as a button whose number does not match its list, one
// control over. Set up a non-default row above, tick, and read the row above again.
page.state.kinds = pure.KIND_ORDER.filter((k) => k !== 'user');
page.state.query = 'verify-time-range';
page.state.overviewSelection = { from: 1, to: 2 };
rangeCleared = 0;
page.state.anomaly.rules = [];
page.onAnomalyToggle('toolError');
check('ticking a rule puts every type back', page.state.kinds, pure.KIND_ORDER);
check('and drops the search', page.state.query, '');
assert('and drops the overview brush', page.state.overviewSelection === null);
check('and clears the time range', rangeCleared, 1);

// 重置 is the way out, and it is run here for the same reason the toggle is: the shape of a
// handler is the same whether it clears, toggles, or does nothing at all.
const resetSource = fnSource('function onAnomalyReset(');
if (!resetSource) throw new Error('could not extract onAnomalyReset');
// 重置 clears the axis by handing the whole field a fresh object, so the factory that builds
// that default is part of what is under test — a reset that rebuilds the three fields itself
// would pass a rule-count assertion and fail the one-writer rule. Loaded verbatim, not stubbed.
const factorySource = fnSource('function defaultAnomaly(');
if (!factorySource) throw new Error('could not extract defaultAnomaly');
vm.runInContext(factorySource, page);
vm.runInContext(resetSource, page);
page.state.anomaly.rules = ['toolError', 'silent'];
page.state.anomaly.last = 'silent';
page.state.anomaly.mode = 'multi';
page.dom.anomalyMulti.checked = true;
page.onAnomalyReset();
check('重置 returns the row to its default', page.state.anomaly.rules, []);
check('and the row above is the default, so the table follows it',
  page.state.kinds, pure.KIND_ORDER);
// 重置 puts the row back to the state it opens in, and the row opens in 单选. Leaving the mode
// switch on would mean the one button that is supposed to mean "default" lands on a non-default
// mode — and the reader has no other way back to it, because that switch is not a filter.
check('and 多选 goes off with it', page.state.anomaly.mode, 'single');
check('and the checkbox stops reading as on', page.dom.anomalyMulti.checked, false);
const beforeSecondPress = renders;
page.onAnomalyReset();
check('and pressing it again is not a toggle into a filtered view', page.state.anomaly.rules, []);
assert('the second press does not even re-render', renders === beforeSecondPress);
page.state.anomaly.rules = [];

/* ---------- 6) what the reader is shown ---------- */

assert('the group is named by the label beside it',
  /id="anomaly-controls" role="group" aria-labelledby="anomaly-label"/.test(html));
assert('and it is named, not just glyphed',
  /id="anomaly-label">异常</.test(html));
// The buttons are built from ANOMALY_RULES. Written into the markup they would be a second
// list of rule names, and the same class of drift the kind chips already had once: a rename
// leaving a button showing one word and announcing another.
assert('no rule is hardcoded in the markup', !/>工具失败</.test(html) && !/>上下文压缩</.test(html));
assert('the container is empty in the markup',
  /<div class="anomaly-quick" id="anomaly-controls" role="group" aria-labelledby="anomaly-label"><\/div>/.test(html));

/* 多选 is a mode switch, not a fifth rule, and the difference is load-bearing: as a rule it would
   be inert the moment another rule is ticked, taking away the only way back from a union. */
const multiBox = /<input type="checkbox" id="anomaly-multi" \/>/.test(html);
assert('多选 is a real checkbox', multiBox);
assert('and it is labelled, so clicking the word is clicking the control',
  /<label class="anomaly-multi" for="anomaly-multi">/.test(html));
// Position is asserted rather than left to the surrounding markup: the checkbox has to sit before
// the rule buttons to read as "these buttons are now single", and after the 异常 heading to read
// as part of that row rather than as a control of its own.
const multiAt = html.indexOf('id="anomaly-multi"');
const labelAt = html.indexOf('id="anomaly-label"');
const groupAt = html.indexOf('id="anomaly-controls"');
assert('多选 sits inside the 异常 row', multiAt > labelAt && labelAt > 0);
assert('and before the rule buttons it changes the meaning of', multiAt < groupAt);
assert('it is not one of the rule buttons', multiAt > 0 && groupAt > 0
  && !html.slice(multiAt, groupAt).includes('anomaly-btn'));
// The one that matters most: `data-filter-scope` is what `syncAnomalyMode` makes inert while an
// anomaly rule is on. A checkbox inside it would be dead exactly when it is needed, and nothing
// else in this file would notice.
assert('and it is never marked as a filter control, so it cannot be made inert',
  !html.slice(html.lastIndexOf('<div class="anomaly-bar', multiAt), groupAt)
    .includes('data-filter-scope'));
assert('the 异常 row itself is not inert-able either',
  !/<div class="anomaly-bar"[^>]*data-filter-scope/.test(html));
// Native checkbox state is the accessible source of truth for the mode. The stylesheet also
// recolours the label, which is a nicety; if the input were replaced by something drawn in CSS,
// that recolouring would be the only signal left and it would fail silently in both themes.
assert('and the mode is carried by the input itself, not by a drawn-in-CSS stand-in',
  multiBox && /\.anomaly-multi input\s*\{/.test(html));

/* Position. It is a second filter axis, so it belongs beside the first one. It used to be the
   last field of the search form, which put it above the KPI cards and the type axis — four cards
   away from the control it reads as part of. A layout defect of that kind is invisible to every
   functional assertion in this file, so it is asserted on its own terms. */
const formEnd = html.indexOf('</form>');
const kindAt = html.indexOf('id="kind-controls"');
const anomalyAt = html.indexOf('id="anomaly-bar"');
const kpiAt = html.indexOf('id="kpi-grid"');
assert('the type axis is still there to sit beside', kindAt > 0);
assert('the 异常 axis comes after it', anomalyAt > kindAt);
assert('and the KPI cards are no longer between the two axes',
  !(kindAt < kpiAt && kpiAt < anomalyAt));
assert('it is no longer a field of the search form', formEnd > 0 && anomalyAt > formEnd);

const buildSrc = fnSource('function buildAnomalyButtons(');
assert('the buttons are built from the table', /ANOMALY_RULES\.length/.test(buildSrc));
assert('one button per rule', /ANOMALY_RULES\[i\]/.test(buildSrc) && /rule\.id/.test(buildSrc));
assert('plus one for the whole set', /'anomaly-all'/.test(buildSrc));
// The page has to be able to get out of the mode it can get into. A way back that only exists
// in the markup, or that a rename of the button would orphan, is not a way back.
assert('and one to put the row back to its default',
  /'anomaly-none'/.test(buildSrc) && /data-anomaly-none/.test(buildSrc));
assert('the way back is built first, so the row reads default-then-kinds',
  buildSrc.indexOf("'anomaly-none'") < buildSrc.indexOf('ANOMALY_RULES.length'));
// 重置 carries no number. 「怎么多会留下多少」 is a question about a rule; a control that keeps
// whatever the row above says has no count of its own, and printing one invites adding it up
// against the numbers beside it.
const noneBlock = buildSrc.slice(buildSrc.indexOf("var none = el("), buildSrc.indexOf('for (var i = 0;'));
assert('重置 advertises no count of its own',
  /ANOMALY_NONE_LABEL/.test(noneBlock) && !/anomaly-count/.test(noneBlock));
assert('every rule button does carry one', /anomaly-count/.test(buildSrc));

const syncSrc = fnSource('function syncAnomalyButtons(counts)');
assert('a button states how many rows it would keep', /anomaly-count/.test(syncSrc));
const labelSrc = fnSource('function ruleLabelFor(');
assert('and the number it publishes carries the unit it was counted in',
  /formatInt\(n\) \+ ' ' \+ unit/.test(labelSrc));
assert('one builder for every rule button, so the wording cannot drift between them',
  /ruleLabelFor\(noun, n, unit, on\)/.test(syncSrc));
assert('the unit comes from the counting pass, not a literal beside each button',
  /counts\.unit\[id\]/.test(syncSrc));
assert('pressed state comes from state, not a captured flag',
  /state\.anomaly\.rules\.indexOf\(id\) >= 0/.test(syncSrc));
// Inverted, and the reason matters. It required 重置 to be pressed whenever no rule was ticked,
// which is true of the filter and false of the row: the axis opens in 单选, and 多选 changes what
// every other button here does when pressed, so a row with 多选 on is not the state 重置 names —
// and 重置 is the only control that turns 多选 off. A reader told the row is already at its
// default has no reason to press the one button that would put it back.
assert('重置 is pressed only when both the rules and the mode are at their default',
  /if \(isNone\) \{[\s\S]*?state\.anomaly\.rules\.length === 0 && state\.anomaly\.mode !== 'multi'/.test(syncSrc));
assert('and a rule button with nothing to find is dimmed, never hidden',
  /n !== null && n === 0/.test(syncSrc));
// The counts arrive from `render()`. Two walks of a live session can disagree — the session grows
// between them — and a button count taken from a different read than the note beside it is the
// same mismatch this row exists to end, just one step further along.
assert('the count comes from the pass render() took, not a second walk',
  /function syncAnomalyButtons\(counts\)/.test(syncSrc) && !/anomalyCounts\(\)/.test(syncSrc));

const countsSrc = fnSource('function anomalyCounts()');
// Inverted from what this asserted before. It required the counts to be drawn through
// the shared visibility entry, which made the number describe a view that anomaly mode does
// not produce — the whole "283 on the button, 1,494 in the list" defect. What has to hold
// instead is that the counts ignore the axis that is switched off while they are on screen.
assert('the counts do NOT walk the other axis, because anomaly mode does not',
  !/recordVisible/.test(countsSrc));
assert('nor read the overview selection', !/state\.overviewSelection/.test(countsSrc));
assert('a turn rule is counted once per turn, not once per record',
  /rule\.turn/.test(countsSrc) && /counted\[key\]/.test(countsSrc));
assert('and its unit is taken from the rule table', /ANOMALY_RULES\[i\]\.turn \? '轮' : '条'/.test(countsSrc));
assert('the total it publishes is the whole ledger', /total: state\.flat\.length/.test(countsSrc));

// The state has to remember the ticks, or a poll re-renders the buttons from nothing.
const stateSrc = fnSource('var state = {');
assert('the filter opens off', /rules: \[\],/.test(stateSrc));
const toggleSrc = fnSource('function onAnomalyToggle(');
assert('ticking adds, unticking removes', /next\.length === state\.anomaly\.rules\.length/.test(toggleSrc));
assert('全部异常 toggles the whole set', /ANOMALY_RULE_IDS\.slice\(\)/.test(toggleSrc));
assert('and it resets the window like every other filter', /resetWindowMode\(\);/.test(toggleSrc));
assert('and re-renders', /render\(\);/.test(toggleSrc));
const clearSrc = fnSource('function clearFilters()');
assert('清除筛选 drops it too', /state\.anomaly = defaultAnomaly\(\);/.test(clearSrc));
assert('and re-syncs the buttons with it', /syncAnomalyButtons\(anomalyCounts\(\)\);/.test(clearSrc));

assert('the filter counts as a filter',
  /state\.anomaly\.rules\.length !== 0/.test(fnSource('function isFiltering()')));

// One entry, two callers. The point of R2 is that the two surfaces cannot answer this
// question separately and drift, so what is asserted is not "both apply 异常" any more — it
// is that neither of them holds a predicate, and that the one entry they share branches on
// the anomaly axis before the others.
const visibleSrc = fnSource('function visibleEntries()');
assert('the ledger applies it', /recordVisible\(entry\.record, entry\.turn, selection\)/.test(visibleSrc));
assert('and hands it the turn off the entry, not a lookup of its own',
  !/turnById/.test(visibleSrc));
const gateSrc = fnSource('function recordVisible(');
assert('and branches on the mode before the other axis, so strip and list agree',
  !!gateSrc && /if \(state\.anomaly\.rules\.length > 0\) \{\s*return passesAnomaly/.test(gateSrc));
// The two axes are alternatives, not a stack. Getting this wrong is not a matter of taste: a
// list built from both predicates at once is the 1,494 rows a 283-row button could never
// deliver, and the reason the two modes could not be told apart from the result alone. The
// anomaly branch has to *return*, and the base tests have to start after it — a branch that
// merely tested and fell through is the stack, spelled the other way.
assert('and treats the two axes as alternatives, not a stack',
  !!gateSrc && /if \(state\.anomaly\.rules\.length > 0\) \{\s*return passesAnomaly[\s\S]*?\n        \}\n        if \(!hasKind/.test(gateSrc));
// The brush is the one condition that legitimately differs between the two callers, so it is
// an argument rather than something the entry reads for itself. If it became a state read
// inside recordVisible(), the strip would start hiding the records the reader drags across.
assert('the brush is an argument, because the strip is what the brush is drawn on',
  !!gateSrc && /function recordVisible\(record, turn, selection\)/.test(gateSrc)
  && !/state\.overviewSelection/.test(gateSrc));

const stripSrc = fnSource('function spanPassesFilter(');
assert('the strip applies it', !!stripSrc && /return recordVisible\(record, owner \|\| null, null\);/.test(stripSrc));
// The strongest form of the claim: the strip's adapter holds no predicate at all. Adapting
// the caller's argument shape is not a second opinion; anything that can answer "is this
// record on screen" in here is.
assert('and the strip keeps no predicate of its own to drift out of step',
  !!stripSrc
  && !/passesAnomaly|hasKind|matchesQuery|recordInSelection|inTimeRange/.test(stripSrc));

const renderSrc = fnSource('function render()');
// Still ordered mode-then-buttons: the strip, the note and the ledger must not each answer a
// different question mid-render. What changed is that both now read one snapshot — a second walk
// of a session that is still growing could hand the note and the buttons different numbers.
assert('the mode is settled before anything reads a count',
  /var anomaly = anomalyCounts\(\);\s*syncAnomalyMode\(anomaly\);\s*syncAnomalyButtons\(anomaly\);/.test(renderSrc));
assert('every poll re-syncs the buttons', /syncAnomalyButtons\(anomaly\);/.test(renderSrc));
assert('and the note and the buttons are handed the same walk, not two of them',
  (renderSrc.match(/anomalyCounts\(\)/g) || []).length === 1);

const modeSrc = fnSource('function syncAnomalyMode(counts)');
// Setting state.kinds without syncKindButtons() leaves the axis drawing whatever was there
// before — which is how 异常 would end up showing 「用户」 while the table was showing something
// else entirely. The count of writers is client-check's business; whether the new one syncs is
// a property of this axis, and this is the file whose mutation control can exercise it.
const baseSrc = fnSource('function resetBaseFilters(');
assert('the reset updates the buttons, or the axis would show a condition that is not in force',
  !!baseSrc && /state\.kinds = KIND_ORDER\.slice\(\);/.test(baseSrc) && /syncKindButtons\(\);/.test(baseSrc));
assert('and it clears every part of the row above, not just the types',
  !!baseSrc && /state\.query = '';/.test(baseSrc) && /state\.overviewSelection = null;/.test(baseSrc)
  && /clearTimeRange\(\);/.test(baseSrc));
const toggleFull = fnSource('function onAnomalyToggle(');
assert('and it runs on every tick into the mode, not only the first',
  !!toggleFull && /if \(next\.length > 0\) resetBaseFilters\(\);/.test(toggleFull));
assert('ticking a rule does not reset the row above on the way back out',
  !!toggleFull && !/if \(next\.length === 0\) resetBaseFilters/.test(toggleFull));
// Dimming alone would leave a control that takes a click and changes nothing — the same class
// of defect this change is about, reintroduced one line away.
assert('the inactive axis is made inert, not merely dimmed', /\.inert = on/.test(modeSrc));
assert('and the body is marked so the dimming has something to key off',
  /data-anomaly-mode/.test(modeSrc));
assert('the note says what stopped applying and how to undo it',
  /异常筛选已开启/.test(modeSrc) && /ANOMALY_NONE_LABEL/.test(modeSrc));
// A poll re-renders from state, so a checkbox left to remember its own position is a checkbox
// that can end up drawn ticked while the buttons are single again — the two disagreeing on screen
// with nothing to reconcile them.
assert('every poll re-draws the checkbox from state, not from where the reader left it',
  /dom\.anomalyMulti\.checked = state\.anomaly\.mode === 'multi'/.test(modeSrc));
assert('and the checkbox is looked up once, with the rest of the anomaly controls',
  /dom\.anomalyMulti = document\.getElementById\('anomaly-multi'\)/.test(html));
assert('多选 opens off, because 单选 is the documented default',
  /mode: 'single',/.test(stateSrc));

const wireSrc = fnSource('function wire(');
// Scoped to the checkbox's own binding rather than the whole of `wire`, which has other change
// listeners in it — a whole-function test would stay green with this one rewritten to `click`,
// which is exactly the mistake this assertion exists to catch.
const multiBindAt = wireSrc.indexOf('dom.anomalyMulti.addEventListener');
const multiBind = wireSrc.slice(multiBindAt, wireSrc.indexOf('});', multiBindAt) + 3);
// `change` rather than `click`: a checkbox toggled from the keyboard fires change and nothing
// else, so binding click leaves the mode unreachable without a mouse.
assert('the checkbox is bound to the mode handler',
  multiBindAt > 0 && /addEventListener\('change'/.test(multiBind)
    && /onAnomalyMultiChange\(this\.checked\)/.test(multiBind));

const muted = html.match(/<[a-z]+[^>]*\sdata-filter-scope[^>]*>/g) || [];
check('exactly the four controls that stop applying are marked', muted.length, 4);
assert('the kind axis is one of them', muted.some((tag) => /id="kind-controls"/.test(tag)));
assert('the search box is one of them', muted.some((tag) => /field-grow/.test(tag)));
assert('the time range is one of them', muted.some((tag) => /field-range/.test(tag)));
assert('but neither picker is — they choose the session, not the records in it',
  muted.every((tag) => !/<select/.test(tag) && !/session-select/.test(tag) && !/generation-select/.test(tag)));
assert('and the dimming is keyed to the mode being on',
  /body\[data-anomaly-mode='on'\] \[data-filter-scope\]/.test(html));

assert('the head tags a broken turn', /turnAnomalyRules\(turn\)/.test(fnSource('function buildTurnHead(')));
assert('with the rule name, not a bare colour', /anomalyRuleLabel\(turnFlags\[flag\]\)/.test(fnSource('function buildTurnHead(')));

// An empty reply has to say so on its own row, not only through the filter. It keeps the 答复
// pill — it is a reply — but with no body the marker is the only thing telling the reader this
// is not an answer, and the duration cell is where 失败 already took one.
const rowSrc = fnSource('function buildRow(');
assert('an empty reply is marked on its row',
  /record\.kind === 'reply' && isNil\(record\.text\)/.test(rowSrc));
assert('and it reuses the duration cell instead of adding a column',
  /else if \(silent\) \{[\s\S]*?anomalyRuleLabel\('silent'\)[\s\S]*?\} else \{/.test(rowSrc));
assert('the row names the rule from the table, not from a label written here',
  /pill\(anomalyRuleLabel\('silent'\)/.test(rowSrc));
// The kind chips had this bug once: the visible word and the announced word lived in different
// places and both were individually correct, so a rename left the button showing one word and
// announcing another. So no rule name may be painted from a literal on the row.
//
// Scoped to the row on purpose. Counting occurrences across the whole file would be wrong: the
// compaction band legitimately prints 上下文压缩 — that names a record *kind*, while this
// filters for an anomaly — and three of the other hits are in comments.
for (const rule of pure.ANOMALY_RULES) {
  assert('the row never paints a rule name literally — ' + rule.id,
    !new RegExp("(pill\\(|\\.title\\s*=)[^;]*" + rule.label).test(rowSrc));
}

/* ---------- report ---------- */
console.log('FAILED_NAMES\t' + JSON.stringify(failedNames));
if (failures.length) {
  console.log('FAILURES:');
  for (const f of failures) console.log(' - ' + f);
  console.error('FAIL ' + pass + ' passed, ' + failures.length + ' failed');
  process.exit(1);
}
console.log('OK  (' + pass + ' assertions; ' + expectAny + ' anomalous records of '
  + page.state.flat.length + ')');
