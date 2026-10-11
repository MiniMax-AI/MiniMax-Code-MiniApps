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
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass += 1;
  else failures.push(name + ': got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected));
}
function assert(name, cond) {
  if (cond) pass += 1;
  else failures.push(name);
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
  anomalyRules: [],
  rangeFrom: null,
  rangeTo: null,
  rangeCutoff: null,
  overviewSelection: null
};
for (const turn of payload.turns) if (turn && turn.id) page.turnById.set(turn.id, turn);

for (const name of ['recordInRange', 'hasTimeRange', 'inTimeRange', 'recordInSelection',
  'passesBaseFilter', 'liveTurn', 'anomalyContext', 'anomalyCounts', 'visibleEntries',
  'turnAnomalyRules', 'spanPassesFilter']) {
  const src = fnSource('function ' + name + '(');
  if (!src) throw new Error('could not extract ' + name);
  vm.runInContext(src, page);
}

/* The expected numbers, counted straight off the payload by code that shares nothing with the
   page. This is the whole point of the file. */
const liveTurn = payload.turns[payload.turns.length - 1];
const brokenTurns = new Set(payload.turns.filter((t) => t.closed === false && t !== liveTurn));
const expect = { toolError: 0, compaction: 0, noReply: 0, silent: 0 };
let expectAny = 0;
const emptyReplies = [];
for (const turn of payload.turns) {
  for (const record of turn.records) {
    const hits = [];
    if (record.isError === true) { expect.toolError += 1; hits.push(1); }
    if (record.kind === 'compaction') { expect.compaction += 1; hits.push(1); }
    if (brokenTurns.has(turn)) { expect.noReply += 1; hits.push(1); }
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
assert('they overlap, so `any` is not the sum', expectAny < expect.toolError + expect.compaction + expect.noReply + expect.silent);

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
check('unanswered count matches the payload', all.byRule.noReply, expect.noReply);
check('empty answer count matches the payload', all.byRule.silent, expect.silent);
check('the union count matches the payload', all.any, expectAny);

// The button and the ledger are the same statement about the same records. If these ever drift,
// a button is advertising rows the list refuses to render. The filter has to be on first —
// compared with it off, the ledger returns everything and the check would pass for free.
page.state.anomalyRules = pure.ANOMALY_RULE_IDS.slice();
check('the button count is the length of the list behind it', all.any, page.visibleEntries().length);
for (const id of pure.ANOMALY_RULE_IDS) {
  page.state.anomalyRules = [id];
  const only = page.visibleEntries();
  check('one rule on shows exactly what it counts — ' + id, only.length, all.byRule[id]);
  assert('nothing else leaked into that filter — ' + id,
    only.every((e) => pure.recordAnomalyRules(e.record, { turn: e.turn, liveTurn })
      .indexOf(id) >= 0));
  assert('that filter is not the whole ledger — ' + id, only.length < page.state.flat.length);
}

page.state.anomalyRules = pure.ANOMALY_RULE_IDS.slice();
const everything = page.visibleEntries();
assert('every rule on is still only the anomalies', everything.length === expectAny);

// The strip is handed a bare record, so the turn comes back out of the index. If that lookup
// were missing, 无答复 would silently match nothing on the strip and everything in the ledger.
page.state.anomalyRules = ['noReply'];
const byLedger = new Set(page.visibleEntries().map((e) => e.record.id));
const byStrip = new Set();
for (const entry of page.state.flat) {
  if (page.spanPassesFilter(entry.record, false)) byStrip.add(entry.record.id);
}
check('the strip and the ledger keep the same records', byStrip.size, byLedger.size);
assert('and it is the same records', [...byLedger].every((id) => byStrip.has(id)));
assert('the strip is not keeping everything', byStrip.size < page.state.flat.length);

page.state.anomalyRules = [];

/* A rule on the other axis must narrow the count, not merely the list. Otherwise the button
   still advertises the whole session while the table shows a slice of it. */
page.state.query = 'verify-time-range';
const searched = page.anomalyCounts();
// Counted inline rather than through recordAnomalyRules, so this is a third opinion rather than
// the page agreeing with itself: the rule table and the counting loop are both what could be
// wrong, and only a count that shares neither can catch it.
let expectedSearched = 0;
for (const entry of page.state.flat) {
  if (!page.matchesQuery(entry.record, 'verify-time-range')) continue;
  if (entry.record.isError === true || entry.record.kind === 'compaction' || brokenTurns.has(entry.turn)) {
    expectedSearched += 1;
  }
}
check('a search narrows the count too', searched.any, expectedSearched);
assert('and the narrowed count is smaller than the whole session', searched.any < expectAny);
assert('and smaller than the matches it is drawn from', searched.any <= page.visibleEntries().length);
page.state.query = '';

page.state.kinds = pure.KIND_ORDER.filter((k) => k !== 'toolResult');
const withoutToolResults = page.anomalyCounts();
check('unchecking 工具结果 drops those failures from the count', withoutToolResults.byRule.toolError, 0);
assert('but leaves the checkpoints alone', withoutToolResults.byRule.compaction === expect.compaction);
assert('unchecking a kind is still a filter', page.visibleEntries().length < page.state.flat.length);
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
page.render = () => {};
const toggleSource = fnSource('function onAnomalyToggle(');
if (!toggleSource) throw new Error('could not extract onAnomalyToggle');
vm.runInContext(toggleSource, page);

page.state.anomalyRules = [];
page.onAnomalyToggle('toolError');
check('ticking one rule', page.state.anomalyRules, ['toolError']);
page.onAnomalyToggle('compaction');
check('ticking a second keeps table order, not click order', page.state.anomalyRules, ['toolError', 'compaction']);
page.onAnomalyToggle('toolError');
check('unticking removes only that one', page.state.anomalyRules, ['compaction']);
page.onAnomalyToggle(null);
check('全部异常 ticks the whole set', page.state.anomalyRules, pure.ANOMALY_RULE_IDS);
vm.runInContext('this.__aliased = state.anomalyRules === ANOMALY_RULE_IDS;', page);
check('全部异常 ticks a copy, not the table itself', page.__aliased, false);
page.onAnomalyToggle(null);
check('and 全部异常 again unticks it', page.state.anomalyRules, []);

page.state.anomalyRules = [];
page.onAnomalyToggle('compaction');
page.onAnomalyToggle('toolError');
page.onAnomalyToggle(null);
check('全部异常 from a partial selection ticks everything, not just the rest', page.state.anomalyRules, pure.ANOMALY_RULE_IDS);
page.state.anomalyRules = [];

/* ---------- 6) what the reader is shown ---------- */

assert('the group is a labelled part of the search form',
  /id="anomaly-controls" role="group" aria-label="只看异常记录"/.test(html));
assert('and it is named, not just glyphed',
  /id="anomaly-label">异常</.test(html));
// The buttons are built from ANOMALY_RULES. Written into the markup they would be a second
// list of rule names, and the same class of drift the kind chips already had once: a rename
// leaving a button showing one word and announcing another.
assert('no rule is hardcoded in the markup', !/>工具失败</.test(html) && !/>上下文压缩</.test(html));
assert('the container is empty in the markup',
  /<div class="anomaly-quick" id="anomaly-controls" role="group" aria-label="只看异常记录"><\/div>/.test(html));

const buildSrc = fnSource('function buildAnomalyButtons(');
assert('the buttons are built from the table', /ANOMALY_RULES\.length/.test(buildSrc));
assert('one button per rule', /ANOMALY_RULES\[i\]/.test(buildSrc) && /rule\.id/.test(buildSrc));
assert('plus one for the whole set', /'anomaly-all'/.test(buildSrc));

const syncSrc = fnSource('function syncAnomalyButtons()');
assert('a button states how many rows it would keep', /anomaly-count/.test(syncSrc));
assert('and the name it announces is built from the same two facts',
  /noun \+ ' ' \+ formatInt\(n\)/.test(syncSrc));
assert('pressed state comes from state, not a captured flag',
  /state\.anomalyRules\.indexOf\(id\) >= 0/.test(syncSrc));
assert('the count comes from the shared pass, not a second walk',
  /var counts = anomalyCounts\(\);/.test(syncSrc));

const countsSrc = fnSource('function anomalyCounts()');
assert('the counts walk the same predicate the ledger does',
  /passesBaseFilter\(entry\.record, selection\)/.test(countsSrc));
assert('and take the selection the ledger is showing', /state\.overviewSelection/.test(countsSrc));

// The state has to remember the ticks, or a poll re-renders the buttons from nothing.
const stateSrc = fnSource('var state = {');
assert('the filter opens off', /anomalyRules: \[\],/.test(stateSrc));
const toggleSrc = fnSource('function onAnomalyToggle(');
assert('ticking adds, unticking removes', /next\.length === state\.anomalyRules\.length/.test(toggleSrc));
assert('全部异常 toggles the whole set', /ANOMALY_RULE_IDS\.slice\(\)/.test(toggleSrc));
assert('and it resets the window like every other filter', /resetWindowMode\(\);/.test(toggleSrc));
assert('and re-renders', /render\(\);/.test(toggleSrc));
const clearSrc = fnSource('function clearFilters()');
assert('清除筛选 drops it too', /state\.anomalyRules = \[\];/.test(clearSrc));
assert('and re-syncs the buttons with it', /syncAnomalyButtons\(\);/.test(clearSrc));

assert('the filter counts as a filter',
  /state\.anomalyRules\.length !== 0/.test(fnSource('function isFiltering()')));
assert('the ledger applies it', /passesAnomaly\(entry\.record, anomalyContext\(entry\), state\.anomalyRules\)/.test(fnSource('function visibleEntries()')));
assert('the strip applies it', /passesAnomaly/.test(fnSource('function spanPassesFilter(')));
assert('and every poll re-syncs the buttons', /syncAnomalyButtons\(\);/.test(fnSource('function render()')));
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
console.log('FAILED_NAMES\t' + JSON.stringify(failures.map((f) => f.split(':')[0])));
if (failures.length) {
  console.log('FAILURES:');
  for (const f of failures) console.log(' - ' + f);
  console.error('FAIL ' + pass + ' passed, ' + failures.length + ' failed');
  process.exit(1);
}
console.log('OK  (' + pass + ' assertions; ' + expectAny + ' anomalous records of '
  + page.state.flat.length + ')');
