// Evidence for the time-range filter.
//
// Two things here are load-bearing and neither can be checked with a fixture:
//
// 1. A range wide enough to cover the whole session must reproduce `payload.stats` field for
//    field. The range KPI is re-derived in the page from `state.flat` instead of being asked
//    for, so a headline and the table under it cannot be computed from two different sets. That
//    is only safe if the re-derivation agrees with the server where both are defined.
// 2. A wall-clock range must select exactly the records whose `timestamp` falls in that window,
//    counted straight off the payload. The control is a `datetime-local`, but the ledger filters
//    on `relativeMs`, so every bound is a subtraction — and a subtraction that is off by the
//    machine's distance from Greenwich still looks like a working filter.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { buildTrajectoryPayload } from '../miniapp/node/server.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const HTML = join(HERE, '..', 'miniapp', 'client', 'index.html');

const html = readFileSync(HTML, 'utf8');

/* ---------- the session section 3 runs against ---------- */
// WHY IT IS BUILT HERE. This file was excluded from `run.mjs` for its whole life, and the reason
// was always the input: its assertions want a session with more than a thousand messages spanning a
// local midnight, and the only one available was whatever the machine running the service happened
// to have. The committed fixture is sixty rows of one afternoon. So the file sat in the directory,
// looked like coverage, and proved nothing — 509 lines of timezone arithmetic that no run exercised.
//
// Relaxing the numbers to fit the fixture was the alternative on the table and it is worse: the
// whole point of the file is that a bound is a subtraction, and a window that no longer crosses a
// midnight stops exercising the machine's distance from Greenwich at all.
//
// Committing a multi-megabyte real transcript was the other alternative. Rejected: it puts a
// session's contents in the package, and this is a fixture, not a corpus.
//
// So the transcript is synthetic and built here, and it is handed to the server's OWN
// `buildTrajectoryPayload` — the same exported function the `/api/trajectory` route calls. What is
// synthetic is the conversation; the `stats` this compares against is still computed by the code
// under test, in the file that serves it. Section 3 asks "does the page's re-derivation agree with
// the server's numbers", and both sides of that question are still the real implementations.
//
// Four properties are load-bearing, and none of them is "big":
//
//   - over a thousand messages, or the half-range comparison compares two numbers too close to tell
//   - a local midnight with rows on both sides of it, or the wall-clock arithmetic is never exercised
//   - EVERY field section 3 compares is non-zero, or the comparison is `0 === 0`: green, and not
//     evidence of anything. That includes the two compaction counters, so the session carries a
//     turn that is nothing but a checkpoint. Leaving them at zero looked like a deliberate choice
//     — "no bare checkpoint turn, or the two sides re-derive different populations" — and it was
//     exactly backwards: it meant `stats.compactions += 1` and `stats.compactionTurns += 1` could
//     both be deleted from the page and this guard would still pass. A turn that is nothing but a
//     checkpoint is also the only way that branch of the classifier is reachable, so it is what
//     makes the two counters comparable rather than assumed. The product invariant that a real
//     session has none of these belongs to `verify-compaction-turn.mjs`; asserting it here proved
//     nothing, because the number it asserted was this file's own choice.
const SYNTHETIC_TURNS = 300;
// Eight hours from 20:00 local puts the midnight four hours in, with roughly half the records on
// each side of it — dense enough that the ±5 minute window section 3b picks is never empty, and
// spread thinly enough that the window stays far under the tenth-of-the-session slice it asserts.
const SYNTHETIC_SPAN_MS = 8 * 3600 * 1000;

/**
 * A local wall-clock instant far enough from any daylight-saving step to span one safely.
 *
 * Anchored to the calendar rather than to a UTC instant on purpose: the crossing under test is a
 * LOCAL midnight, so a fixed UTC start would place it somewhere else on every other machine's
 * clock and the file would be testing the store's timezone instead of the arithmetic. The retry is
 * for the remaining case — a zone whose transition falls inside the eight hours, where the wall
 * clock moves without `relativeMs` moving and the two readings section 3b compares part company.
 *
 * @returns {number} epoch ms
 */
function syntheticStart() {
  let start = new Date(2026, 9, 10, 20, 0, 0).getTime();
  for (let guard = 0; guard < 14; guard += 1) {
    const offset = new Date(start).getTimezoneOffset();
    if (offset === new Date(start + SYNTHETIC_SPAN_MS).getTimezoneOffset()) return start;
    start = new Date(2026, 9, 10 + guard + 1, 20, 0, 0).getTime();
  }
  return start;
}

/**
 * @returns {Array<Record<string, any>>} rows in the file shape the store keeps
 */
function buildRows(start) {
  /** @type {Array<{ turn: string, message: Record<string, any>, stamp: number }>} */
  const plan = [];
  let at = 0;
  const add = (turnId, message) => {
    at += 1;
    plan.push({ turn: turnId, message, stamp: at });
  };
  const assistant = (t, blocks, stopReason) => ({
    role: 'assistant',
    content: blocks,
    api: 'synthetic-api', provider: 'synthetic-provider', model: 'synthetic-model',
    usage: {
      input: 1000 + t, output: 40 + (t % 17), cacheRead: 9000 + t * 2, cacheWrite: 7 * t,
      totalTokens: 1000 + t + 40 + (t % 17) + 9000 + t * 2 + 7 * t,
    },
    stopReason,
  });
  const thinking = (t) => ({ type: 'thinking', thinking: 'synthetic reasoning ' + t, thinkingSignature: 'sig-' + t });

  for (let t = 1; t <= SYNTHETIC_TURNS; t += 1) {
    const turnId = 'turn-' + String(t).padStart(4, '0');

    // Every twelfth turn is the model resuming without a new reader message — the shape the
    // server files as a continuation. It needs a `reply` record to be closed, otherwise it lands
    // in `turnsWithoutPrompt` instead and the classifier's second branch is never taken.
    if (t % 12 === 5) {
      add(turnId, assistant(t, [thinking(t), { type: 'text', text: 'synthetic resumed ' + t }], 'stop'));
      continue;
    }

    // Every twenty-third turn is a checkpoint that opened a turn the file never named — the only
    // shape the server classifies as `compaction`, and the reason the two compaction counters are
    // compared rather than assumed. Without it the page's `+= 1` for either one could be deleted
    // and every assertion below would still pass on `0 === 0`.
    if (t % 23 === 7) {
      add(turnId, {
        role: 'compactionSummary',
        summary: 'synthetic checkpoint ' + t,
        tokensBefore: 1000 + t,
      });
      continue;
    }

    // Every seventeenth turn has neither an opener nor a closing reply, so the classifier falls
    // through to its last branch. Left uncovered, the page's `else` arm was being compared with
    // the server's against zero.
    if (t % 17 === 3) {
      add(turnId, assistant(t, [
        thinking(t),
        { type: 'text', text: 'synthetic unfinished ' + t },
        { type: 'toolCall', id: 'call_' + t + '_0', name: 'tool_' + (t % 7), arguments: { n: t } },
      ], 'toolUse'));
      add(turnId, {
        role: 'toolResult',
        toolCallId: 'call_' + t + '_0',
        toolName: 'tool_' + (t % 7),
        content: [{ type: 'text', text: 'synthetic result ' + t }],
        isError: false,
      });
      continue;
    }

    add(turnId, { role: 'user', content: [{ type: 'text', text: 'synthetic prompt ' + t }] });

    // `closed` is not a stop reason: the server sets it from a record of kind `reply`, and that
    // kind is assigned from the literal string `stop` — anything else projects as `narration`. So a
    // turn only closes when a second assistant row follows its tool results carrying `'stop'`, and
    // a generator that omits it — or spells it `'endTurn'` — leaves every turn open.
    const asks = t === SYNTHETIC_TURNS;
    const open = asks || t % 9 === 4;
    const callIds = ['call_' + t + '_0', 'call_' + t + '_1'];
    // The last turn calls a tool whose answer arrives through the tool, which is what makes it a
    // question to the reader (`qaTurns`) rather than just an unfinished turn.
    const callNames = asks ? ['ask_user', 'tool_' + (t % 7)] : ['tool_' + (t % 7), 'tool_' + ((t + 3) % 7)];
    add(turnId, assistant(t, [
      thinking(t),
      { type: 'text', text: 'synthetic answer ' + t },
      { type: 'toolCall', id: callIds[0], name: callNames[0], arguments: { n: t } },
      { type: 'toolCall', id: callIds[1], name: callNames[1], arguments: { n: t } },
    ], 'toolUse'));

    // Two tool results, and every ninth one fails — so `errors` is non-zero and the
    // de-duplication of errors by message id has something to de-duplicate.
    for (let c = 0; c < 2; c += 1) {
      add(turnId, {
        role: 'toolResult',
        toolCallId: callIds[c],
        toolName: callNames[c],
        content: [{ type: 'text', text: 'synthetic result ' + t + '.' + c }],
        isError: (t + c) % 9 === 0,
      });
    }

    if (!open) add(turnId, assistant(t, [thinking(t), { type: 'text', text: 'synthetic close ' + t }], 'stop'));
    // A prompt typed while the turn was still running. The server projects a user row that is not
    // its turn's opener as a steer rather than as a message, so without one `steers` is 0 on both
    // sides and the check degenerates to comparing 0 with 0.
    else if (!asks) add(turnId, { role: 'user', content: [{ type: 'text', text: 'synthetic steer ' + t }] });
  }

  // Timestamps are laid over the span only once the row count is known, so the density does not
  // depend on how many rows a turn happens to contribute.
  const step = SYNTHETIC_SPAN_MS / plan.length;
  return plan.map((entry, i) => ({
    message_id: 'msg-' + String(i + 1).padStart(5, '0'),
    turn_id: entry.turn,
    message: { ...entry.message, timestamp: start + Math.round(i * step) },
  }));
}

const SYNTHETIC_START = syntheticStart();
const SYNTHETIC_ROWS = buildRows(SYNTHETIC_START);

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

/* ---------- 1) pure helpers, straight out of the PURE block ---------- */
const rawSlice = html.split('PURE:START')[1].split('PURE:END')[0];
let block = rawSlice.slice(rawSlice.indexOf('*/') + 2);
const lastCloser = block.lastIndexOf('*/');
const dangling = block.indexOf('/*', lastCloser === -1 ? 0 : lastCloser + 2);
if (dangling >= 0) block = block.slice(0, dangling);
const pure = { console };
vm.createContext(pure);
vm.runInContext(block, pure);

/* The offsets this page measures from, chosen to straddle a midnight: this session began
   2026-10-10 11:45:31 local, and the checks below sit either side of 2026-10-11 00:00. */
const CLOCK = new Date(2026, 9, 10, 11, 45, 31).getTime();
const MIDNIGHT = new Date(2026, 9, 11, 0, 0, 0).getTime();
const NOW = new Date(2026, 9, 11, 11, 30, 0).getTime();

/* parsing: empty is null, unreadable is NaN, and the two must never be confused */
check('parse empty', pure.parseRangeBound('', CLOCK), null);
check('parse spaces', pure.parseRangeBound('   ', CLOCK), null);
check('parse null', pure.parseRangeBound(null, CLOCK), null);
check('parse at session start', pure.parseRangeBound('2026-10-10T11:45', CLOCK), -31000);
check('parse with seconds', pure.parseRangeBound('2026-10-10T11:45:31', CLOCK), 0);
check('parse across midnight', pure.parseRangeBound('2026-10-11T00:00', CLOCK), 44069000);
check('parse a space instead of T', pure.parseRangeBound('2026-10-11 00:00', CLOCK), NaN);

assert('junk is refused', Number.isNaN(pure.parseRangeBound('abc', CLOCK)));
assert('a date with no time is refused', Number.isNaN(pure.parseRangeBound('2026-10-11', CLOCK)));
assert('a lone time is refused', Number.isNaN(pure.parseRangeBound('11:45', CLOCK)));
assert('an impossible hour is refused', Number.isNaN(pure.parseRangeBound('2026-10-11T25:00', CLOCK)));
assert('hour 24 is refused, not rolled into the next day',
  Number.isNaN(pure.parseRangeBound('2026-10-11T24:00', CLOCK)));
assert('an impossible month is refused', Number.isNaN(pure.parseRangeBound('2026-13-01T00:00', CLOCK)));
// Date would roll 2026-02-30 forward into March and hand back a range nobody asked for.
assert('a day that does not exist is refused', Number.isNaN(pure.parseRangeBound('2026-02-30T00:00', CLOCK)));
assert('leap day is accepted', pure.parseRangeBound('2028-02-29T00:00', CLOCK) > 0);
assert('minute 60 is refused, not rolled', Number.isNaN(pure.parseRangeBound('2026-10-11T12:60', CLOCK)));
assert('a trailing Z is refused, since the control never sends one',
  Number.isNaN(pure.parseRangeBound('2026-10-11T00:00Z', CLOCK)));
// A bound before the session began stays negative: it is true, and clamping it would hide a
// window the reader chose that this session cannot answer for.
assert('a bound before session start is negative', pure.parseRangeBound('2026-10-09T00:00', CLOCK) < 0);
// No session to measure from is the one way a bound fails silently, so it must not be silent.
assert('a bound with no session start is refused', Number.isNaN(pure.parseRangeBound('2026-10-11T00:00', null)));

/* formatting, and a round trip so a resolved value can be typed back in */
check('format a bound', pure.formatRangeInput(MIDNIGHT), '2026-10-11T00:00');
check('format the session start', pure.formatRangeInput(CLOCK), '2026-10-10T11:45');
check('format null', pure.formatRangeInput(null), '');
check('format NaN', pure.formatRangeInput(NaN), '');
for (const ms of [0, 1000, MIDNIGHT, MIDNIGHT + 3600000, NOW]) {
  const round = pure.parseRangeBound(pure.formatRangeInput(ms), CLOCK);
  // The control has minute resolution, so a value floors to the minute on the way back.
  assert('round trip ' + ms, Math.abs(round - (ms - CLOCK)) < 60000);
}

/* local midnights, and the day before, stepped through the calendar */
check('local midnight', pure.startOfLocalDay(NOW), MIDNIGHT);
check('the day before', pure.previousLocalMidnight(NOW), new Date(2026, 9, 10, 0, 0, 0, 0).getTime());
check('local midnight of nothing', pure.startOfLocalDay(NaN), null);
check('previous midnight of nothing', pure.previousLocalMidnight(NaN), null);

/* the quick picks — the four buttons, resolved without touching the DOM */
const q15 = pure.quickRange('15m', CLOCK, NOW);
assert('15m ends now', q15.to === NOW - CLOCK);
assert('15m starts fifteen minutes earlier', q15.from === Math.max(q15.to - 15 * 60000, 0));
const q1h = pure.quickRange('1h', CLOCK, NOW);
assert('1h ends now', q1h.to === NOW - CLOCK);
assert('1h starts an hour earlier', q1h.from === Math.max(q1h.to - 3600000, 0));
const qToday = pure.quickRange('today', CLOCK, NOW);
assert('today ends now', qToday.to === NOW - CLOCK);
assert('today starts at local midnight', CLOCK + qToday.from === MIDNIGHT);
// Yesterday is the interesting one: this session began at 11:45 on the 10th, so yesterday's
// window opens before the session exists. Clamping says "from the beginning", and the hint
// then explains that the window is empty — which is the truth. Not clamping would report a
// negative range the reader never asked for.
const qYest = pure.quickRange('yesterday', CLOCK, NOW);
assert('yesterday ends at midnight', qYest.to === MIDNIGHT - CLOCK);
assert('yesterday is clamped to the start of the session', qYest.from === 0);
// And on a session old enough to cover it, the clamp must not fire.
const OLD = new Date(2026, 8, 1, 9, 0, 0).getTime();
const qOld = pure.quickRange('yesterday', OLD, NOW);
assert('yesterday on a session that covers it is not clamped',
  OLD + qOld.from === new Date(2026, 9, 10, 0, 0, 0, 0).getTime());
check('an unknown pick is refused', pure.quickRange('lastweek', CLOCK, NOW), null);
check('a pick with no session start is refused', pure.quickRange('today', null, NOW), null);
check('a pick with no now is refused', pure.quickRange('today', CLOCK, NaN), null);

/* the comparison, on its own terms */
const rec = (ms) => ({ relativeMs: ms });
assert('no range keeps everything', pure.recordInRange(rec(999), null, null) === true);
assert('no range keeps an undated record', pure.recordInRange({}, null, null) === true);
assert('from only, before', pure.recordInRange(rec(10), 100, null) === false);
assert('from only, after', pure.recordInRange(rec(150), 100, null) === true);
assert('to only, before', pure.recordInRange(rec(10), null, 100) === true);
assert('to only, after', pure.recordInRange(rec(150), null, 100) === false);
assert('from is inclusive', pure.recordInRange(rec(100), 100, null) === true);
assert('to is inclusive', pure.recordInRange(rec(100), null, 100) === true);
// An undated record cannot be placed on this clock. Keeping it would put a row on screen whose
// timestamp says nothing about whether it belongs; the brush already drops these.
assert('an undated record leaves a set range', pure.recordInRange({}, 0, 1000) === false);

check('label both open', pure.rangeLabel(null, null, CLOCK), '');
check('label from only', pure.rangeLabel(44069000, null, CLOCK), '2026-10-11 00:00:00 – 现在');
check('label to only', pure.rangeLabel(null, 44069000, CLOCK), '开始 – 2026-10-11 00:00:00');
check('label both ends', pure.rangeLabel(44069000, 45269000, CLOCK),
  '2026-10-11 00:00:00 – 2026-10-11 00:20:00');
// A bound before the session prints the date it names, not a negative offset — the one place
// the sign would have carried the message, and now the date does.
check('label a bound before the session', pure.rangeLabel(-42331000, 44069000, CLOCK),
  '2026-10-10 00:00:00 – 2026-10-11 00:00:00');
check('label without a session to measure from', pure.rangeLabel(0, 1, null), '');

/* ---------- 2) the hint, run rather than read ----------
   An unreadable picker is never written into state — that is the rule the filter rests on — so
   a hint keyed on `state.rangeTo` can never report it. Checked by running it, because a regex
   over the source cannot tell a live branch from a dead one: neutering the condition leaves
   every identifier a regex looks for exactly where it was. */
const hint = fnSource('function updateRangeHint()');
assert('the hint reads the pickers, not the filter',
  /parseRangeBound\(state\.rangeFromText/.test(hint) && /parseRangeBound\(state\.rangeToText/.test(hint));
assert('the unreadable branch names the range still in force', /hasTimeRange\(\) \? '\uff08'/.test(hint));
{
  const say = (statePatch, extra) => {
    const note = { textContent: '', classes: [], classList: { add: (c) => note.classes.push(c), remove: () => {} } };
    const ctx = {
      console,
      dom: { rangeHint: note },
      state: Object.assign({ payload: null, flat: [], rangeFrom: null, rangeTo: null, rangeCutoff: null }, statePatch)
    };
    vm.createContext(ctx);
    vm.runInContext('var isCount = ' + pure.isCount.toString() + ';', ctx);
    for (const name of ['pad2', 'formatInt', 'formatClock', 'parseRangeBound', 'formatRangeInput',
      'startOfLocalDay', 'previousLocalMidnight', 'quickRange', 'rangeLabel', 'recordsPastCutoff',
      'latestRecordIndex', 'latestRecordTimestamp', 'hasTimeRange', 'inTimeRange', 'recordInRange',
      'rangeHasRecords', 'sessionStartedAt', 'timeRangeLabel', 'updateRangeHint']) {
      vm.runInContext(fnSource('function ' + name + '('), ctx);
    }
    vm.runInContext('function kpiStats() { return ' + (extra || 'null') + '; }', ctx);
    ctx.updateRangeHint();
    return note;
  };
  const withSession = (patch) => Object.assign({ payload: { session: { startedAt: CLOCK } } }, patch);

  const live = withSession({ rangeFrom: 44069000, rangeTo: 2700000,
    rangeFromText: '2026-10-11T00:00', rangeToText: 'abc' });
  assert('an unreadable box says so', say(live).textContent.indexOf('这一刻无法识别') === 0);
  assert('and names the range still in force', say(live).textContent.indexOf('2026-10-11 00:00:00') >= 0);

  assert('a reversed range says so',
    say(withSession({ rangeFrom: 44069000, rangeTo: 729000,
      rangeFromText: '2026-10-11T00:00', rangeToText: '2026-10-11T00:01' }))
      .textContent === '起点晚于终点，没有记录落在这段时间里。');

  assert('no range is the plain instruction',
    say(withSession({ rangeFromText: '', rangeToText: '' })).textContent.indexOf('留空 = 不限') === 0);

  // The window is well formed and the session has nothing in it. This is what 昨天 does on a
  // session that began this morning, and the reader is owed where the session actually starts.
  const empty = say(withSession({ rangeFrom: 0, rangeTo: 44069000,
    rangeFromText: '2026-10-10T00:00', rangeToText: '2026-10-11T00:00' }));
  assert('an empty window says there is nothing in it',
    empty.textContent.indexOf('这段时间里没有记录') === 0);
  assert('and names where the session starts', empty.textContent.indexOf('2026-10-10 11:45:31') >= 0);

  const set = say(withSession({ rangeFrom: 44069000, rangeTo: 45269000,
    rangeFromText: '2026-10-11T00:00', rangeToText: '2026-10-11T00:20',
    flat: [{ record: { index: 1, relativeMs: 44500000 } }] }), '{ messages: 3 }');
  assert('a live range reports itself', set.textContent.indexOf('区间 2026-10-11 00:00:00 – 2026-10-11 00:20:00') === 0);
  assert('a live range says the KPI follows it', set.textContent.indexOf('关键指标已按此区间统计') >= 0);
  assert('a live range says it is fixed', set.textContent.indexOf('已固定在设定时的样子') >= 0);
  assert('and counts the messages inside it', set.textContent.indexOf('3 条消息') >= 0);

  // A session whose records carry no timestamp has no origin to convert against.
  const noBase = say({ rangeFrom: 44069000, rangeTo: null, rangeFromText: '2026-10-11T00:00', rangeToText: '' });
  assert('a session with no timestamps says so',
    noBase.textContent.indexOf('没有时间戳') >= 0);
  assert('and does not blame the value', noBase.textContent.indexOf('无法识别') < 0);
}

/* ---------- 3) against a projected session ---------- */
// The one line that used to be `await fetch(BASE_URL + '/api/trajectory')`. Same builder, no
// service: what the route adds around `buildTrajectoryPayload` is a handful of `session.*` fields
// this file never reads, which is the same observation `make-payload.mjs` is built on.
const payload = buildTrajectoryPayload({
  session: { id: 'mvs_0000000000000000000000000000000f', createdAtMs: SYNTHETIC_START },
  rows: SYNTHETIC_ROWS,
  sizeBytes: SYNTHETIC_ROWS.length,
  truncated: false,
});

const scoped = { console, state: { payload, flat: [], rangeFrom: null, rangeTo: null, rangeCutoff: null } };
scoped.state.flat = payload.turns.flatMap((turn) => turn.records.map((record) => ({ turn, record })));
vm.createContext(scoped);
for (const name of ['recordInRange', 'hasTimeRange', 'inTimeRange', 'scopedStats', 'pad2', 'formatClock',
  'parseRangeBound', 'formatRangeInput', 'startOfLocalDay', 'previousLocalMidnight', 'quickRange',
  'rangeLabel', 'sessionStartedAt', 'timeRangeLabel']) {
  const src = fnSource('function ' + name + '(');
  if (!src) throw new Error('could not extract ' + name);
  vm.runInContext(src, scoped);
}
// The pure block's own isCount, so the comparison inside scopedStats is the real one.
vm.runInContext('var isCount = ' + pure.isCount.toString() + ';', scoped);

let mins = Infinity;
let maxs = -Infinity;
for (const entry of scoped.state.flat) {
  if (Number.isFinite(entry.record.relativeMs)) {
    if (entry.record.relativeMs < mins) mins = entry.record.relativeMs;
    if (entry.record.relativeMs > maxs) maxs = entry.record.relativeMs;
  }
}

// A range covering the whole session must land on the server's own numbers. Anything else is a
// definitional difference, and every scoped number below it inherits that difference.
scoped.state.rangeFrom = mins;
scoped.state.rangeTo = maxs;
const whole = scoped.scopedStats();

const FIELDS = [
  'messages', 'userMessages', 'toolCalls', 'toolResults', 'thinkingBlocks', 'errors',
  'compactions', 'turnsWithPrompt', 'continuationTurns', 'qaTurns', 'openTurns',
  'turnsWithoutPrompt', 'compactionTurns', 'durationMs',
  // Added 2026-10-15. This list is hand-written, and `steers` was missing from it — so the one
  // field the re-scoped stats had actually lost went unchecked. `client-check.mjs` now reads both
  // halves off the function itself, which is what stops the NEXT one; this entry is the direct
  // number check for this one.
  'steers'
];
for (const field of FIELDS) {
  check('whole-session ' + field, whole[field], payload.stats[field]);
}
for (const field of ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens']) {
  check('whole-session tokens.' + field, whole.tokens[field], payload.stats.tokens[field]);
}

// The one field that must NOT be re-scoped: 「全程 N」 beside the range is the comparison the
// reader wants, and re-scoping it would leave the note with nothing to say.
check('messagesAll stays whole-session', whole.messagesAll, payload.stats.messagesAll);
// The preconditions of section 3, asserted rather than assumed. A generator edited down to a
// tenth of its size would leave every assertion below it comparing two near-identical small
// numbers — still green, and no longer evidence of anything.
assert('the synthetic session is big enough to be worth checking', payload.stats.messages > 1000);
// The one that was wrong before. It read `compactionTurns === 0`, which made the fixture guarantee
// the precondition of the comparison it was about to perform: two counters that are zero by
// construction compare equal whether or not the page counts them at all. Asking for a non-zero
// one is what turns two tautologies into two checks.
assert('the compaction counters are non-zero, so the page is actually counted against them',
  payload.stats.compactions > 0 && payload.stats.compactionTurns > 0);

// A narrower range must produce strictly fewer messages, or the filter is not filtering.
const halfEnd = Math.floor((mins + maxs) / 2);
scoped.state.rangeFrom = mins;
scoped.state.rangeTo = halfEnd;
const half = scoped.scopedStats();
assert('a narrower range holds fewer messages', half.messages < whole.messages);
assert('a narrower range holds fewer tool calls', half.toolCalls < whole.toolCalls);
assert('a narrower range still holds something', half.messages > 0);

// And it must equal a count taken straight from the rows, which is the property that makes
// the headline and the table one statement rather than two.
const kept = scoped.state.flat.filter(
  (entry) => Number.isFinite(entry.record.relativeMs)
    && entry.record.relativeMs >= mins
    && entry.record.relativeMs <= halfEnd
);
check('half-range messages == distinct ids of the rows kept',
  half.messages, new Set(kept.map((e) => e.record.id)).size);

// Duration has to be the span of the rows kept, not the span of the session. Quoting the
// session's own number here would have passed the whole-range comparison above untouched.
const keptTimes = kept.map((e) => e.record.relativeMs);
check('half-range duration == span of the rows kept',
  half.durationMs, Math.max(...keptTimes) - Math.min(...keptTimes));

/* ---------- 3b) a wall-clock range is the window it names ---------- */
// The control is a `datetime-local`; the ledger filters on `relativeMs`. Every bound is
// therefore a subtraction, and a subtraction that is off by this machine's distance from
// Greenwich still looks like a working filter — so it is checked against timestamps read
// straight off the payload, over a window that crosses midnight.
const START = payload.session.startedAt;
assert('the payload carries a session start', Number.isFinite(START) && START > 0);
{
  /* The window is chosen from the payload, not written down.
   *
   * It used to be a literal -- 23:50 to 00:20 on fixed October dates -- which made this section a
   * statement about the store rather than about the code. When that session was compacted away
   * both sides of the equality below were 0, so it passed while comparing nothing; only the
   * assertion after it noticed. A literal window is the one input here that silently stops being
   * evidence, and nothing about the code can tell you that.
   *
   * What stays literal is the part that makes it worth running: the window crosses a LOCAL
   * midnight, so converting each bound really is a subtraction the machine's distance from
   * Greenwich gets to corrupt. */
  const pad2n = (n) => (n < 10 ? '0' + n : String(n));
  const dayKey = (ts) => {
    const d = new Date(ts);
    return d.getFullYear() + '-' + pad2n(d.getMonth() + 1) + '-' + pad2n(d.getDate());
  };
  const wallClock = (ts) => {
    const d = new Date(ts);
    return dayKey(ts) + ' ' + pad2n(d.getHours()) + ':' + pad2n(d.getMinutes()) + ':' + pad2n(d.getSeconds());
  };
  const stamped = scoped.state.flat
    .map((e) => e.record.timestamp)
    .filter((ts) => Number.isFinite(ts))
    .sort((a, b) => a - b);

  const PAD = 5 * 60000;
  const wholeMinute = (ms, dir) => (dir < 0 ? Math.floor(ms / 60000) * 60000 : Math.ceil(ms / 60000) * 60000);
  const span = stamped.length ? stamped[stamped.length - 1] - stamped[0] : 0;
  let chosen = null;
  let cursor = stamped.length ? new Date(stamped[0]) : null;
  if (cursor) {
    cursor.setHours(0, 0, 0, 0);
    if (cursor.getTime() < stamped[0]) cursor.setDate(cursor.getDate() + 1);
    for (let guard = 0; cursor.getTime() <= stamped[stamped.length - 1] && guard < 400; guard += 1) {
      const midnight = cursor.getTime();
      // Reached from the rows themselves rather than from a fixed number of minutes: the reader
      // steps away, and on this session the last record before the one usable midnight was 41
      // minutes early. A window of ±10 minutes would have found nothing and reported the store's
      // habits as a fault in the arithmetic. Both ends have to exist, and the two ends together
      // have to stay a small slice, or it is not a window.
      let beforeAt = -1;
      let afterAt = -1;
      for (let i = 0; i < stamped.length; i += 1) {
        if (stamped[i] < midnight) beforeAt = stamped[i];
        else {
          afterAt = stamped[i];
          break;
        }
      }
      const lo = beforeAt < 0 ? NaN : wholeMinute(beforeAt - PAD, -1);
      const hi = afterAt < 0 ? NaN : wholeMinute(afterAt + PAD, 1);
      if (Number.isFinite(lo) && Number.isFinite(hi) && hi - lo <= span / 4) {
        chosen = { wallFrom: lo, wallTo: hi };
        break;
      }
      cursor = new Date(cursor.getTime());
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  if (!chosen) {
    // Failing by name beats carrying on: everything below reads `chosen`, and a guard that
    // limps past its own precondition reports the arithmetic's faults for the store's.
    console.log('[3b] no local midnight inside this session has rows on both sides of it');
    console.log('FAILED_NAMES\t'
      + JSON.stringify(['the session spans a local midnight with rows on both sides of it']));
    process.exit(1);
  }
  const wallFrom = chosen.wallFrom;
  const wallTo = chosen.wallTo;
  assert('the window crosses a local midnight', dayKey(wallFrom) !== dayKey(wallTo));

  // Typed into the pickers as the control actually sends them, so the strings under test are the
  // ones the page reads rather than ones written to match the arithmetic.
  const fromText = pure.formatRangeInput(wallFrom);
  const toText = pure.formatRangeInput(wallTo);
  const from = pure.parseRangeBound(fromText, START);
  const to = pure.parseRangeBound(toText, START);
  check('a pair of bounds across midnight converts to the window it names',
    [from, to], [wallFrom - START, wallTo - START]);

  const byDate = scoped.state.flat.filter((e) => pure.recordInRange(e.record, from, to));
  const byClock = scoped.state.flat.filter(
    (e) => Number.isFinite(e.record.timestamp) && e.record.timestamp >= wallFrom && e.record.timestamp <= wallTo);
  check('a date range selects exactly the records inside that wall-clock window',
    byDate.length, byClock.length);
  assert('the window has records in it, or the equality above proves nothing', byClock.length > 0);
  assert('and it is a small slice of the session', byClock.length < scoped.state.flat.length / 10);

  scoped.state.rangeFrom = from;
  scoped.state.rangeTo = to;
  scoped.state.rangeFromText = fromText;
  scoped.state.rangeToText = toText;
  const stats = scoped.scopedStats();
  check('the KPI over a date range equals the distinct ids of those rows',
    stats.messages, new Set(byClock.map((e) => e.record.id)).size);
  check('and the page-level label reads back as the wall clock it was typed as',
    scoped.timeRangeLabel(), wallClock(wallFrom) + ' – ' + wallClock(wallTo));

  // And the same window, typed into the pickers as what the control actually sends.
  check('the control round trips back to the same offsets',
    [pure.parseRangeBound(pure.formatRangeInput(START + from), START),
      pure.parseRangeBound(pure.formatRangeInput(START + to), START)],
    [from, to]);
}

/* ---------- 4) one line, many records ---------- */
// The session on disk happens to split every failing tool call into exactly one record, so
// de-duplicating errors by id changes nothing here and a live check cannot tell a correct
// de-dup from a missing one. The synthetic case is what actually pins the rule.
{
  const one = { turns: [{ index: 1, turnClass: 'none', closed: true, askedReader: false, records: [] }] };
  const split = [
    { turn: one.turns[0], record: { id: 'm1', kind: 'thinking', relativeMs: 0, isError: true, tokens: null } },
    { turn: one.turns[0], record: { id: 'm1', kind: 'toolResult', relativeMs: 5, isError: true, tokens: null } }
  ];
  const synth = { console, state: { payload: { ...one, stats: {} }, flat: split, rangeFrom: 0, rangeTo: 100 } };
  vm.createContext(synth);
  vm.runInContext('var isCount = ' + pure.isCount.toString() + ';', synth);
  for (const name of ['recordInRange', 'hasTimeRange', 'inTimeRange', 'scopedStats']) {
    vm.runInContext(fnSource('function ' + name + '('), synth);
  }
  const out = synth.scopedStats();
  check('a split line counts as one message', out.messages, 1);
  check('a split failing line counts as one error', out.errors, 1);
}

/* ---------- 5) the range is a snapshot, not a subscription ---------- */
// Measured in the browser before this existed: with 起点 set and 终点 left open, the session
// grew by 11 records and 「已显示 588」 became 「已显示 599」 with nobody touching anything.
// The cutoff is what stops that, so it gets checked directly.
{
  const snap = { console, state: { flat: [], rangeFrom: 0, rangeTo: null, rangeCutoff: null } };
  vm.createContext(snap);
  vm.runInContext('var isCount = ' + pure.isCount.toString() + ';', snap);
  for (const name of ['recordInRange', 'hasTimeRange', 'inTimeRange', 'latestRecordIndex',
    'latestRecordTimestamp', 'recordsPastCutoff', 'rangeHasRecords']) {
    const src = fnSource('function ' + name + '(');
    if (!src) throw new Error('could not extract ' + name);
    vm.runInContext(src, snap);
  }
  snap.state.flat = [1, 2, 3, 4].map((i) => ({ record: { index: i, relativeMs: i * 1000, timestamp: CLOCK + i * 1000 } }));

  check('latest record index', snap.latestRecordIndex(), 4);
  check('latest record timestamp', snap.latestRecordTimestamp(), CLOCK + 4000);

  assert('without a cutoff the range accepts the newest record',
    snap.inTimeRange({ index: 4, relativeMs: 4000 }) === true);

  snap.state.rangeCutoff = 2;
  check('records behind the cutoff', snap.recordsPastCutoff(), 2);
  assert('a record inside the range but past the cutoff is held back',
    snap.inTimeRange({ index: 3, relativeMs: 3000 }) === false);
  assert('a record inside both the range and the cutoff still shows',
    snap.inTimeRange({ index: 2, relativeMs: 2000 }) === true);
  // The cutoff is a record bound, not a clock. Judging it by time instead would re-admit a
  // record that arrived late but was stamped early — the fixture makes the two readings
  // disagree, so this is the assertion that tells them apart.
  assert('the cutoff judges by index, not by clock',
    snap.inTimeRange({ index: 3, relativeMs: 1 }) === false);

  assert('the range holds something', snap.rangeHasRecords() === true);
  snap.state.rangeFrom = 90000;
  snap.state.rangeTo = 200000;
  assert('and a range that holds nothing says so', snap.rangeHasRecords() === false);
}

/* ---------- 6) the controls on screen ---------- */
assert('the picker is a calendar, not a text box',
  /<input type="datetime-local" id="range-from"/.test(html) && /<input type="datetime-local" id="range-to"/.test(html));
assert('no text input survived on the range row', !/<input type="text" id="range-/.test(html));
assert('the clear button exists', /id="range-clear"/.test(html));
assert('the clear button starts hidden', /id="range-clear"[^>]*hidden/.test(html));
assert('the refresh button exists', /id="range-refresh"/.test(html));
assert('the refresh button starts hidden', /id="range-refresh"[^>]*hidden/.test(html));

const QUICKS = ['15m', '1h', 'today', 'yesterday'];
const quickSrc = html.match(/data-range-quick="[^"]+"/g) || [];
check('the four quick picks are on the page', quickSrc.map((s) => s.slice('data-range-quick="'.length, -1)).sort(), [...QUICKS].sort());
// Every one of them has to resolve, or the button silently does nothing.
for (const kind of QUICKS) {
  assert('the ' + kind + ' pick resolves', pure.quickRange(kind, CLOCK, NOW) !== null);
}
const bindSrc = fnSource('function applyQuickRange(kind)');
assert('a quick pick goes through the same filter', /applyTimeRange\(\);/.test(bindSrc));
assert('a quick pick writes the pickers, so the reader can see and adjust what it chose',
  /dom\.rangeFrom\.value = state\.rangeFromText;/.test(bindSrc)
  && /dom\.rangeTo\.value = state\.rangeToText;/.test(bindSrc));
const listeners = html.slice(html.indexOf("dom.rangeFrom.addEventListener('change'"));
assert('the pickers commit on change, not on every keystroke',
  listeners.indexOf("dom.rangeTo.addEventListener('change'") > 0);
const boundsSrc = fnSource('function syncRangeBounds()');
assert('the pickers are bounded by the span the session covers',
  /dom\.rangeFrom\.min = low;/.test(boundsSrc) && /dom\.rangeTo\.max = high;/.test(boundsSrc));
const renderSrc = fnSource('function render()');
assert('the refresh button is re-decided on every render', /syncRangeButtons\(\)/.test(renderSrc));
assert('the bounds are re-decided on every render', /syncRangeBounds\(\)/.test(renderSrc));

// Not `hidden` on "nothing waiting": that count changes every poll, and the button appearing
// and disappearing moved 清空区间 sideways so clicks on it landed on nothing.
const syncButtons = fnSource('function syncRangeButtons()');
assert('the refresh button keeps its box when there is nothing to bring in',
  /dom\.rangeRefresh\.hidden = !isSet;/.test(syncButtons)
  && /dom\.rangeRefresh\.disabled = !isSet \|\| recordsPastCutoff\(\) === 0;/.test(syncButtons));
const applyRange2 = fnSource('function applyTimeRange()');
assert('applying a range re-cuts the snapshot', /state\.rangeCutoff = latestRecordIndex\(\)/.test(applyRange2));
const clearRange2 = fnSource('function clearTimeRange()');
assert('clearing drops the snapshot', /state\.rangeCutoff = null;/.test(clearRange2));

// A range used to force 「全部」 so that the newest-200 window could not hide the start of
// it. Measured on a range covering the whole session — 全部 rendered ~11,000 rows, the document
// reached 414,000px and one query took 19s.
// \b matters: resetWindowMode contains the substring setWindowMode, so without it the helper it
// is supposed to be calling would read as a direct mode change.
assert('a range never forces 全部 on screen', !/\bsetWindowMode\(/.test(applyRange2));
assert('a range resets the window like every other filter', /\bresetWindowMode\(\);/.test(applyRange2));

// The range has to reach every predicate that decides what is drawn. The ledger and the
// turn-grouping strip used to keep a test each and drifted apart once already; there is now
// one entry they both go through, and these pin the entry and both of its callers reaching
// for it — including the strip, which must reach for it rather than carry its own range test.
const gateSrc = fnSource('function recordVisible(');
assert('the shared entry applies the range',
  /if \(!inTimeRange\(record\)\) return false;/.test(gateSrc));
assert('visibleEntries filters through the shared entry',
  /recordVisible\(entry\.record, entry\.turn, selection\)/.test(fnSource('function visibleEntries()')));
assert('and the strip reaches it rather than carrying its own range test',
  /return recordVisible\(record, owner \|\| null, null\);/.test(fnSource('function spanPassesFilter('))
  && !/inTimeRange/.test(fnSource('function spanPassesFilter(')));

// A range is a snapshot, so the window must stop following the tail on its own. Without this
// the newest-200 window would drag the view forward every poll under a fixed filter.
assert('a range stops the window following the tail',
  /if \(hasTimeRange\(\)\) return state\.limit;/.test(fnSource('function rePinWindow()')));

// The KPI re-derivation is only legitimate because with no range it is the server's own number,
// verbatim. Re-scoping an unscoped view would report a different headline over the same table.
assert('no range means the server numbers, untouched',
  /if \(!hasTimeRange\(\)\) \{\s*\n\s*return state\.payload/.test(fnSource('function kpiStats()')));

// Defaults and clearing: a range that opens set filters the session before anyone asks, and one
// that survives 清除筛选 is a filter the reader cannot see and cannot turn off.
const stateSrc = fnSource('var state = {');
assert('the range opens unset', /rangeFrom: null,\s*\n\s*rangeTo: null,/.test(stateSrc));
// Order, not adjacency. 清除筛选 grew a line when 异常 became a filter of its own, and the old
// two-line regex failed on that instead of on anything wrong — it had frozen the shape of the
// function rather than what the function has to do. What matters is that both are cleared and
// that the query goes before the range, so the ledger never re-renders once with neither.
// The reset then moved into `resetBaseFilters`, and the same mistake repeated one indirection
// later: the lines were read out of `clearFilters`, which no longer has them, so the assertion
// went red on a code change that broke nothing. Naming the function that owns the rule fixes it;
// dropping the hop would not have. Checked order alone would pass on a 清除筛选 that had stopped
// calling the reset altogether, which is a filter the reader cannot see and cannot turn off.
const clearSrc = fnSource('function clearFilters()');
assert('清除筛选 runs the base reset', /resetBaseFilters\(\);/.test(clearSrc));
const resetSrc = fnSource('function resetBaseFilters()');
const queryAt = resetSrc.indexOf("state.query = '';");
const rangeAt = resetSrc.indexOf('clearTimeRange();');
assert('清除筛选 also drops the range', queryAt >= 0 && rangeAt > queryAt);

// A picker the page could not read must not reach the filter. `NaN` fails the `isCount` test
// behind `hasTimeRange`, so assigning it would switch the whole range off mid-edit and hand back
// the entire session — the one failure that looks like the filter simply did nothing.
assert('an unreadable box is not assigned',
  /if \(!isNaN\(from\)\) state\.rangeFrom = from;/.test(applyRange2)
  && /if \(!isNaN\(to\)\) state\.rangeTo = to;/.test(applyRange2));

/* ---------- report ---------- */
console.log('[1] parse / format / compare: ' + pass + ' assertions, ' + failures.length + ' failed');
console.log('    session: ' + payload.stats.messages + ' messages, ' + scoped.state.flat.length + ' records, '
  + payload.turns.length + ' turns, span ' + maxs + ' ms');
// Machine-readable, so the mutation runner can require the *named* guard to fire instead of
// matching on a substring that any nearby assertion can satisfy by accident. Assertion names
// must not contain a colon: this splits on the first one to strip the ": got …" suffix.
console.log('FAILED_NAMES\t' + JSON.stringify(failures.map((f) => f.split(':')[0])));
if (failures.length) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('OK  (a whole-session range reproduces payload.stats field for field)');
