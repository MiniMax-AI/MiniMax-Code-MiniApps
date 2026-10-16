// Behavioural self-check for the overview strip and the view controls.
//
// These assertions are the evidence that the type chips filter the list, the overview and
// the turn headers together, and that the 时长 button reports the strip it draws. Every
// expected value below is derived by hand from the fixture, not from running the code, so
// the probe can fail rather than merely agree with itself.
//
// It loads the delivered index.html itself and runs its real inline script in a
// sandbox, so there is no copied logic that could drift from what ships.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HTML = fileURLToPath(new URL('../miniapp/client/index.html', import.meta.url));
const html = readFileSync(HTML, 'utf8');

const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])[0];
if (!script) throw new Error('no inline script found');

// Cut the bootstrap: the page must not try to fetch or mount while under test.
const bootIndex = script.lastIndexOf("if (document.readyState === 'loading')");
const body = bootIndex === -1 ? script : script.slice(0, bootIndex);

const store = new Map();
const noop = () => {};

/** The smallest node that `el()`, `clear()` and the overview renderer can run against. */
function domNode(tag) {
  const kids = [];
  const attrs = {};
  return {
    tag,
    childNodes: kids,
    // 0 = "never laid out", which is what the page's own fallback keys off. Tests that care
    // about the width set it; everything else inherits the un-measured path.
    layoutWidth: 0,
    getBoundingClientRect() {
      return { left: 0, right: this.layoutWidth, width: this.layoutWidth, top: 0, bottom: 8, height: 8 };
    },
    querySelectorAll(sel) {
      const attr = String(sel).replace(/^\[/, '').replace(/\]$/, '');
      return kids.filter((k) => k.getAttribute && k.getAttribute(attr) !== null);
    },
    querySelector(sel) {
      const all = this.querySelectorAll(sel);
      return all.length ? all[0] : null;
    },
    get firstChild() { return kids.length ? kids[0] : null; },
    appendChild(n) { kids.push(n); return n; },
    removeChild(n) { const i = kids.indexOf(n); if (i >= 0) kids.splice(i, 1); return n; },
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
    removeAttribute(k) { delete attrs[k]; },
    style: {
      props: Object.create(null),
      setProperty(k, v) { this.props[k] = v; },
      // The page reads the lane back off the node under the pointer, so the stub has to answer
      // the read as well as the write. A stub that only records writes would make `overviewLaneAt`
      // return -1 and quietly turn every hover assertion into "nothing was hovered".
      getPropertyValue(k) { return this.props[k] ?? ''; }
    },
    get classList() {
      const self = this;
      return { contains: (c) => String(self.className || '').split(/\s+/).includes(c) };
    },
    className: '',
    textContent: ''
  };
}

/** Boot the delivered script in a sandbox, optionally with storage pre-seeded. */
function buildSandbox(seed) {
  const local = seed || new Map();
  const sandbox = {
    console,
    window: {
      localStorage: {
        getItem: (k) => (local.has(k) ? local.get(k) : null),
        setItem: (k, v) => local.set(k, String(v))
      },
      matchMedia: () => ({ addEventListener: noop, addListener: noop }),
      setTimeout: () => 0,
      clearTimeout: noop,
      setInterval: () => 0,
      clearInterval: noop
    },
    document: {
      documentElement: { dataset: {} },
      body: { classList: { add: noop, remove: noop } },
      createElement: (tag) => domNode(tag)
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(body, sandbox);
  return sandbox;
}

const sandbox = buildSandbox(store);

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
function rec(id, kind, timestamp, durationMs, extra) {
  return Object.assign({ id, kind, timestamp, durationMs: durationMs ?? null, summary: id }, extra || {});
}
function ent(record, turnIndex) {
  return { record, turn: { id: 'turn-' + (turnIndex ?? 1), index: turnIndex ?? 1, toolCalls: 0, errors: 0, tokens: {} } };
}

/* r2/r3/r4 overlap; r5 starts 8.5s after the rest ends — one big idle gap. */
const MIXED = [
  ent(rec('r1', 'user', 1000, 0), 1),
  ent(rec('r2', 'narration', 1100, 400, { responseId: 'R1' }), 1),
  ent(rec('r3', 'toolCall', 1200, 200, { responseId: 'R1', toolCallId: 'tc1', toolName: 'bash' }), 1),
  ent(rec('r4', 'toolResult', 1200, 200, { toolCallId: 'tc1' }), 1),
  ent(rec('r5', 'user', 10000, 0), 2)
];

/* ---------------------------------------------------------------- Duration off */
sandbox.state.actualDuration = false;
const seq = sandbox.overviewModel(MIXED);
check('Duration off: span count', seq.spans.length, 5);
check('Duration off: every span is one unit wide', seq.spans.map((s) => s.end - s.start), [1, 1, 1, 1, 1]);
check('Duration off: domain starts at zero', seq.start, 0);
check('Duration off: domain is the record count', seq.end, 5);
assert(
  'Duration off: recorded timing has no effect on the axis',
  JSON.stringify(seq.spans.map((s) => s.start)) === JSON.stringify([0, 1, 2, 3, 4])
);
check('Duration off: one boundary per turn', seq.turnBoundaries.length, 2);
check('Duration off: boundaries sit on span starts', seq.turnBoundaries.map((b) => b.time), [0, 4]);

/* ----------------------------------------------------------------- Duration on */
sandbox.state.actualDuration = true;
const dur = sandbox.overviewModel(MIXED);
check('Duration on: span count', dur.spans.length, 5);
// r1 prompt      -> arrival only, zero width
// r2 assistant   -> spans the wait since r1 landed          [1000,1100]
// r3/r4 tool     -> measured run                            [1200,1400]
// r5 prompt      -> arrival only, zero width
check('Duration on: a prompt is a zero-width start marker', dur.spans[0].end - dur.spans[0].start, 0);
check('Duration on: an assistant row spans the wait before it', dur.spans[1].end - dur.spans[1].start, 100);
check('Duration on: a tool call keeps its measured run', dur.spans[2].end - dur.spans[2].start, 200);
check('Duration on: a tool result keeps its measured run', dur.spans[3].end - dur.spans[3].start, 200);
check('Duration on: domain start', dur.start, 1000);
check('Duration on: domain end', dur.end, 1300);
check('Duration on: compressed axis is far shorter than wall clock', dur.end - dur.start < 9000, true);
check('Duration on: idle gap is removed, not shrunk', dur.spans[4].start, 1300);
check('Duration on: boundaries follow the same compression', dur.turnBoundaries.map((b) => b.time), [1000, 1300]);

/* timedRange is the rule the two modes share, so it gets checked on its own */
check('timedRange: a prompt never claims a length',
  sandbox.timedRange({ kind: 'user' }, 0, 500), { start: 500, end: 500, measured: false });
check('timedRange: an assistant takes the gap since the previous event',
  sandbox.timedRange({ kind: 'narration' }, 0, 500), { start: 0, end: 500, measured: true });
check('timedRange: a tool call uses its own measured duration, not the gap',
  sandbox.timedRange({ kind: 'toolCall', durationMs: 30 }, 0, 500), { start: 500, end: 530, measured: true });
check('timedRange: an unpaired tool call is a marker, not a guess',
  sandbox.timedRange({ kind: 'toolCall', durationMs: null }, 0, 500), { start: 500, end: 500, measured: false });
check('timedRange: a backwards or missing previous stamp falls back to the arrival',
  sandbox.timedRange({ kind: 'narration' }, null, 500), { start: 500, end: 500, measured: false });
check('timedRange: a previous stamp after this one is not used',
  sandbox.timedRange({ kind: 'narration' }, 900, 500), { start: 500, end: 500, measured: false });

/* overlapping spans must not double count the covered interval */
const OVERLAP = [
  ent(rec('o1', 'narration', 0, 1000), 1),
  ent(rec('o2', 'narration', 100, 1000), 1)
];
const overlapModel = sandbox.overviewModel(OVERLAP);
check('overlap: the second assistant reuses the covered interval', overlapModel.end - overlapModel.start, 100);

/* --------------------------------------------------------------- lane mapping */
check(
  'lanes follow dsh laneFor',
  MIXED.map((e) => sandbox.overviewLane(e.record)),
  [0, 1, 2, 2, 0]
);
check('lane: thinking is model lane', sandbox.overviewLane({ kind: 'thinking' }), 1);
// 问答 and 过程 are both assistant-family text, so the lane and the real-time axis must
// treat them the same. Checking one and assuming the other is how a whole category ends
// up missing from the strip with nothing red.
check('both qa and narration take the text lane',
  sandbox.overviewLane({ kind: 'reply' }), sandbox.overviewLane({ kind: 'narration' }));
check('both qa and narration get the same timed range',
  JSON.stringify(sandbox.timedRange({ kind: 'reply' }, 0, 500)),
  JSON.stringify(sandbox.timedRange({ kind: 'narration' }, 0, 500)));
check('lane: injected system is input lane', sandbox.overviewLane({ kind: 'system' }), 0);
check('lane: a checkpoint is model lane, not input', sandbox.overviewLane({ kind: 'system', title: 'compaction' }), 0);

/* ------------------------------------------------- undated records stay honest */
const UNDATED = [ent(rec('u1', 'user', null, null), 1), ent(rec('u2', 'user', 500, 0), 1)];
check('a record with no timestamp is not given a position', sandbox.overviewModel(UNDATED).spans.map((s) => s.id), ['u2']);
check('no timed records yields no timeline at all', sandbox.overviewModel([ent(rec('u1', 'user', null, null), 1)]), null);

/* --------------------------------------------------- the model is reused, not rebuilt */
// Count the rebuilds rather than checking that the cache carries the two fields it needs. A cache
// whose key is written but never read, or read but never compared, passes any assertion that only
// looks for the shape — and a shell that stores the inputs and then rebuilds anyway would pass
// one that only checks the values are equal, because a rebuilt model of the same rows IS the same
// model. What has to be true is that the second call does no work.
{
  const realModel = sandbox.overviewModel;
  let builds = 0;
  sandbox.overviewModel = function (entries) { builds += 1; return realModel(entries); };

  sandbox.state.actualDuration = false;
  builds = 0;
  const cold = sandbox.cachedOverviewModel(MIXED);
  check('a cold cache builds the model', builds, 1);
  const warm = sandbox.cachedOverviewModel(MIXED);
  check('the same rows again do not rebuild it', builds, 1);
  assert('and they hand back the very model that was built', cold === warm);

  // A different array holding equal rows is still a rebuild. That is the price of the key: the
  // payload path hands over a fresh array on every poll, so "deeply equal" would mean comparing
  // every record to answer a question identity already answers.
  builds = 0;
  const equalRows = sandbox.cachedOverviewModel(MIXED.slice());
  check('a different array of the same rows rebuilds', builds, 1);
  check('and produces an equal model', JSON.stringify(equalRows), JSON.stringify(cold));

  // Put MIXED back before the axis test. The step above leaves a *different* array in the cache,
  // so a key that compared the rows but dropped the axis would still miss here and rebuild — and
  // the rebuild the axis test observes would then prove nothing about the axis at all. That is
  // not hypothetical: dropping `axis` from the key survived this file until this line was added.
  sandbox.cachedOverviewModel(MIXED);

  // The axis is the model's other input, read from state when it is built. Keying on the rows
  // alone would keep a model from the other axis, and every record would be drawn at its
  // position on the axis the reader just turned off.
  builds = 0;
  sandbox.state.actualDuration = true;
  const onAxis = sandbox.cachedOverviewModel(MIXED);
  check('turning the duration axis on rebuilds', builds, 1);
  check('and the rebuilt model is on the compressed axis', onAxis.end - onAxis.start, 300);
  check('with the idle gap removed, not shrunk', onAxis.spans[4].start, 1300);

  builds = 0;
  sandbox.cachedOverviewModel(MIXED);
  check('the rebuilt axis is cached as well', builds, 0);

  // An empty session produces no model at all, and reusing that answer must not depend on there
  // being one: `overviewModel` returns null, and the caller branches on exactly that.
  builds = 0;
  const emptyRows = [ent(rec('z1', 'user', null, null), 1)];
  check('a session with nothing dated yields no model', sandbox.cachedOverviewModel(emptyRows), null);
  check('and building that answer counted once', builds, 1);
  check('reusing it costs nothing', sandbox.cachedOverviewModel(emptyRows), null);
  check('which is still no rebuild', builds, 1);

  sandbox.overviewModel = realModel;
  sandbox.state.actualDuration = false;
  // Leave no cached model behind for the sections below, which build their own.
  sandbox.overviewCache.flat = null;
  sandbox.overviewCache.axis = null;
  sandbox.overviewCache.model = null;
}

/* ------------------------------------------------------------- layer filters */
/* 轮次 / 思考 / 调用 are presets over the same kind set the type chips edit — one filter,
 * two ways of setting it, so nothing here is a second copy that could disagree. Cancelling
 * a layer leaves no placeholder: the records it covers are simply not in the render plan.
 * Every expectation below is derived by hand from the fixture, not from running the code. */

const LAYER = {
  turn: { id: 'turn-1', index: 1, toolCalls: 1, errors: 0, tokens: {} },
  entries: [
    ent(rec('a1', 'system', 10, 0, { title: 'system-reminder' }), 1),
    ent(rec('a2', 'user', 20, 0), 1),
    ent(rec('a3', 'thinking', 25, 5, { responseId: 'A1' }), 1),
    ent(rec('a4', 'narration', 30, 10, { responseId: 'A1' }), 1),
    ent(rec('a5', 'toolCall', 40, 5, { responseId: 'A1', toolCallId: 'x1', toolName: 'bash' }), 1),
    ent(rec('a6', 'toolResult', 41, 5, { toolCallId: 'x1' }), 1)
  ]
};
sandbox.state.flat = LAYER.entries;
sandbox.state.kinds = sandbox.KIND_ORDER.slice();
sandbox.state.query = '';
sandbox.state.overviewSelection = null;

// The chip set is the one filter, so an assertion sets it the way a reader would: by naming
// the kinds that stay on. There is no second control that could move it behind the probe's
// back, so every expectation below is the render the shipped page would produce.
const only = (...kinds) => { sandbox.state.kinds = kinds; };
const all = () => { sandbox.state.kinds = sandbox.KIND_ORDER.slice(); };

check('filter: everything is visible by default',
  sandbox.visibleEntries().map((e) => e.record.id),
  ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);

// The conversation is just the two kinds the reader ticks. Hiding 用户 and 过程 leaves the
// thinking row, the system row and the two tool rows: hiding what was said is not a reason
// to hide how the model reasoned.
only('thinking', 'toolCall', 'toolResult', 'system');
check('filter: dropping the conversation kinds removes those rows and nothing else',
  sandbox.visibleEntries().map((e) => e.record.id),
  ['a1', 'a3', 'a5', 'a6']);
all();

// 思考 is one kind, and nothing else.
only('user', 'narration', 'toolCall', 'toolResult', 'system');
check('filter: dropping 思考 removes the thinking row and nothing else',
  sandbox.visibleEntries().map((e) => e.record.id),
  ['a1', 'a2', 'a4', 'a5', 'a6']);
check('filter: dropping 思考 leaves no thinking record anywhere',
  sandbox.visibleEntries().filter((e) => e.record.kind === 'thinking').length, 0);
all();

// The tool layer is both call and result, and they go together.
only('user', 'narration', 'thinking', 'system');
check('filter: dropping the tool kinds removes both the calls and their results',
  sandbox.visibleEntries().map((e) => e.record.id),
  ['a1', 'a2', 'a3', 'a4']);
all();

// Kinds are independent, so narrowing one never takes part of another with it.
only('system');
check('filter: narrowing to 系统 alone leaves only that row',
  sandbox.visibleEntries().map((e) => e.record.id), ['a1']);
only('thinking', 'toolCall', 'toolResult', 'system');
check('filter: the conversation and the tool kinds are independent of each other',
  sandbox.visibleEntries().map((e) => e.record.id), ['a1', 'a3', 'a5', 'a6']);
all();

// The whole point of naming kinds instead of picking presets: arbitrary subsets.
only('user');
check('filter: only the user questions is a set a reader can pick',
  sandbox.visibleEntries().map((e) => e.record.id), ['a2']);
only('system');
check('filter: only the system records is too',
  sandbox.visibleEntries().map((e) => e.record.id), ['a1']);
only('narration', 'toolResult');
check('filter: a scattered pair of kinds is a set a reader can pick',
  sandbox.visibleEntries().map((e) => e.record.id), ['a4', 'a6']);
all();

// The overview strip has to agree with the list, span for span.
check('filter: the overview agrees with the list when nothing is ticked off',
  sandbox.spanPassesFilter(LAYER.entries[4].record, false), true);
only('user', 'narration', 'thinking', 'system');
check('filter: the overview drops a span the list refuses to render',
  sandbox.spanPassesFilter(LAYER.entries[4].record, false), false);
check('filter: the overview keeps the rows the list still shows',
  sandbox.spanPassesFilter(LAYER.entries[2].record, false), true);
all();

// A hidden kind is a filter, so the turn headers must recount rather than keep quoting
// whole-turn numbers for rows that are no longer on screen.
check('filter: nothing is filtered while every kind is on', sandbox.isFiltering(), false);
only('user', 'narration', 'thinking', 'system');
check('filter: a hidden kind counts as filtering', sandbox.isFiltering(), true);
all();

// Turn headers describe the rows that survived. With the tool kinds hidden, a1(system@10),
// a2(user@20), a3(thinking@25) and a4(assistant@30) are what is left: no tool call, and a
// span of 10 -> 30 rather than the whole turn's 10 -> 41.
only('user', 'narration', 'thinking', 'system');
sandbox.state.flat = LAYER.entries;
check('filter: a turn head recounts from the surviving rows',
  sandbox.turnTotalsFromEntries(sandbox.visibleEntries()),
  { toolCalls: 0, errors: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, first: 10, last: 30, durationMs: 20 });
all();
sandbox.state.flat = [];


/* -------------------------------------------------------------- brush filtering */
const spans = new Map(dur.spans.map((s) => [s.id, s]));
sandbox.state.overviewSelection = { start: 1090, end: 1300 };
check('brush: a span overlapping the range is inside it', sandbox.recordInSelection(MIXED[2].record, sandbox.state.overviewSelection, spans), true);
check('brush: a span ending before the range is outside it', sandbox.recordInSelection(MIXED[0].record, sandbox.state.overviewSelection, spans), false);
check('brush: a span with no position cannot be claimed', sandbox.recordInSelection({ id: 'ghost' }, sandbox.state.overviewSelection, spans), false);
check('brush: no selection means no filtering', sandbox.recordInSelection(MIXED[0].record, null, spans), true);

/* ------------------------------------------------------------- tooltip wording */
const DASH = '—';
const clockOf = (ms) => {
  const d = new Date(ms);
  const p = (n) => (n < 10 ? '0' + n : String(n));
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
};

/* MIXED: r3/r4 are the tool pair measured at 200 ms; r2's width is the 100 ms gap
 * between r1's arrival and r2's own; r1 is a zero-width prompt marker.
 * Durations below use the page's own "<n> ms" sub-second convention; what is being
 * asserted is which of the two bases is named, not the unit wording. */
check('tooltip: a tool result is labelled as measured runtime, not as a gap',
  sandbox.overviewTipLines(MIXED[3].record, { start: 1200, end: 1400 }, true),
  ['工具结果', clockOf(1200) + ' → ' + clockOf(1400), '实测耗时 200 ms']);
check('tooltip: a tool call with no measured result is a bare arrival marker',
  sandbox.overviewTipLines(rec('r9', 'toolCall', 5000, null, { toolCallId: 'x' }), { start: 5000, end: 5000 }, true),
  ['工具调用', clockOf(5000), '仅记录了到达时刻']);
check('tooltip: an assistant-family row is labelled as the wait since the previous event',
  sandbox.overviewTipLines(MIXED[1].record, { start: 1000, end: 1100 }, true),
  ['过程', clockOf(1000) + ' → ' + clockOf(1100), '距上一条事件 100 ms']);
check('tooltip: a zero-width prompt claims no duration at all',
  sandbox.overviewTipLines(MIXED[0].record, { start: 1000, end: 1000 }, true),
  ['用户', clockOf(1000), '仅记录了到达时刻']);
/* Equal-width mode has index bounds, not clocks — printing those as times would be
 * a 1970 date, so the clock line must come from the record instead. */
check('tooltip: equal-width mode prints the arrival stamp and never the span index',
  sandbox.overviewTipLines(MIXED[3].record, { start: 3, end: 4 }, false),
  ['工具结果', clockOf(1200), '等宽模式 · 每条记录占一格']);
check('tooltip: an undated record drops the clock line entirely',
  sandbox.overviewTipLines(rec('r10', 'narration', null), { start: 0, end: 0 }, true),
  ['过程', '仅记录了到达时刻']);
check('tooltip: no clock line claims a time the record never had',
  sandbox.overviewTipLines(MIXED[0].record, { start: 1000, end: 1000 }, false),
  ['用户', clockOf(1000), '等宽模式 · 每条记录占一格']);
assert('tooltip never reads a start field off the record', (() => {
  const src = html.slice(html.indexOf('function overviewTipLines'));
  const body = src.slice(0, src.indexOf('\n      function '));
  return !/record\.start/.test(body);
})());

/* ------------------------------------------------- preference survives a reload */
/* A second sandbox with the storage already seeded proves the key is actually
 * read at boot. This is the regression guard for a `var` constant declared below
 * the `state` literal that initialises it: hoisted but still undefined, so the
 * read silently used the key "undefined" and the mode reset on every reload. */
const seeded = new Map([['mmc-trajectory.duration', 'true']]);
const sandbox2 = buildSandbox(seeded);
check('preference: duration mode is restored on boot', sandbox2.state.actualDuration, true);
check('preference: nothing was written to a stray "undefined" key', seeded.has('undefined'), false);

const seededFalse = new Map([['mmc-trajectory.duration', 'false']]);
check('preference: an explicit false is restored as equal-width',
  buildSandbox(seededFalse).state.actualDuration, false);
check('preference: with no stored value the mode defaults to equal-width',
  buildSandbox(new Map()).state.actualDuration, false);
// The write path needs a DOM (setActualDuration re-renders), so it stays covered
// statically: client-check.mjs allows exactly one localStorage write key.

/* ------------------------------------------------- an abandoned brush cannot stick */
/* A pointerup that never arrives leaves the brush armed. If anything can clear the
 * range while that is still true, the very next pointer move repaints a range out of
 * a gesture the user already gave up on — the strip filters with no visible way out. */
const stubNoop = () => {};
const stubNode = () => ({ hidden: false, style: { setProperty: stubNoop } });
sandbox.dom.overviewSelection = stubNode();
sandbox.dom.overviewClear = stubNode();
sandbox.dom.overviewHover = stubNode();
sandbox.dom.overviewLanes = { querySelectorAll: () => [] };
sandbox.dom.overviewTrack = {
  getBoundingClientRect: () => ({ left: 0, right: 1000, width: 1000 }),
  setAttribute: stubNoop,
  removeAttribute: stubNoop,
  setPointerCapture: stubNoop,
  releasePointerCapture: stubNoop
};
sandbox.overviewCache.view = { start: 0, duration: 1000 };
sandbox.overviewCache.model = { start: 0, end: 1000 };

sandbox.overviewDrag = { pointerId: 7, anchorClientX: 0, moved: true, start: 100, end: 400 };
sandbox.state.overviewSelection = { start: 100, end: 400 };
sandbox.abortOverviewDrag();
check('an abandoned brush is disarmed', sandbox.overviewDrag, null);

/* Same guard on the live path: only the pointer that pressed may drive the range. */
sandbox.overviewDrag = {
  pointerId: 7, anchorClientX: 0, anchorFraction: 0, anchorTime: 0,
  start: 0, end: 0, moved: false, button: 0, panning: false, viewport: null
};
sandbox.state.overviewSelection = { start: 100, end: 400 };
sandbox.onOverviewPointerMove({ clientX: 600, clientY: 10, pointerId: 99 });
check('a pointermove from another pointer cannot repaint the range',
  sandbox.state.overviewSelection, { start: 100, end: 400 });

/* The owning pointer still brushes normally, so the guard did not simply mute input. */
sandbox.onOverviewPointerMove({ clientX: 600, clientY: 10, pointerId: 7 });
check('the owning pointer still brushes', sandbox.state.overviewSelection, { start: 0, end: 600 });
sandbox.overviewDrag = null;
sandbox.state.overviewSelection = null;

/* A cancelled gesture is not a finished one: it must leave the range alone. */
sandbox.overviewDrag = {
  pointerId: 7, anchorClientX: 0, anchorFraction: 0, anchorTime: 0,
  start: 100, end: 600, moved: true, button: 0, panning: false, viewport: null
};
sandbox.state.overviewSelection = null;
sandbox.onOverviewPointerUp({ type: 'pointercancel', pointerId: 7, clientX: 600, clientY: 10 });
check('a cancelled gesture commits nothing', sandbox.state.overviewSelection, null);
check('a cancelled gesture still disarms the brush', sandbox.overviewDrag, null);

/* ------------------------------------------------------------------- wheel zoom */
/* Domain 0..1000. OVERVIEW_MIN_ZOOM_SPANS is 4, so the floor is a 250-unit window. */
const ZMODEL = { start: 0, end: 1000 };
const WHOLE = { start: 0, duration: 1000 };
const zin = sandbox.zoomViewport(ZMODEL, WHOLE, 0.5, -300);
check('zoom: a wheel-up narrows the window', zin.duration < 1000 && zin.duration > 0, true);
check('zoom: zooming about the middle keeps the middle put',
  [Math.round(zin.start + zin.duration / 2)], [500]);
check('zoom: zooming about the left edge pins the left edge',
  [Math.round(sandbox.zoomViewport(ZMODEL, WHOLE, 0, -300).start)], [0]);
check('zoom: zooming about the right edge pins the right edge',
  [Math.round(sandbox.zoomViewport(ZMODEL, WHOLE, 1, -300).start + sandbox.zoomViewport(ZMODEL, WHOLE, 1, -300).duration)], [1000]);
check('zoom: the window never runs past the domain',
  sandbox.zoomViewport(ZMODEL, { start: 800, duration: 200 }, 1, -300).start + sandbox.zoomViewport(ZMODEL, { start: 800, duration: 200 }, 1, -300).duration <= 1000, true);
check('zoom: it never opens back past the domain either',
  sandbox.zoomViewport(ZMODEL, { start: 100, duration: 300 }, 0.5, 300).duration <= 1000, true);
check('zoom: zooming out all the way returns the whole session, not a sliver',
  sandbox.zoomViewport(ZMODEL, { start: 100, duration: 300 }, 0.5, 3000), null);
/* One gesture is a step, not a reset: exp(0.45) ≈ 1.568, so 300 widens to ~470. */
check('zoom: one wheel-down step is a bounded widening, not a jump to the end',
  [Math.round(sandbox.zoomViewport(ZMODEL, { start: 100, duration: 300 }, 0.5, 300).duration)],
  [Math.round(300 * Math.exp(300 * 0.0015))]);
check('zoom: it stops at the floor instead of collapsing onto one record',
  sandbox.zoomViewport(ZMODEL, WHOLE, 0.5, -5000).duration, 250);
check('zoom: a wheel-down on an unzoomed axis is a no-op',
  sandbox.zoomViewport(ZMODEL, WHOLE, 0.5, 300), null);

/* ------------------------------------ a type filter survives a live session */
/* The session this page watches keeps growing. A fold set records the ids it covered, so
 * a reply that landed after the click was never in it. A filter has no such memory: it
 * decides per record, per render, so unticking 工具调用 covers the replies that have not
 * happened yet without any re-application step. */
const a1 = rec('a1', 'narration', 1000, 0, { responseId: 'R1' });
const c1 = rec('c1', 'toolCall', 1010, 50, { responseId: 'R1', toolCallId: 'tc1', toolName: 'bash' });
const a2 = rec('a2', 'narration', 2000, 0, { responseId: 'R2' });
const c2 = rec('c2', 'toolCall', 2010, 50, { responseId: 'R2', toolCallId: 'tc2', toolName: 'read' });
const turnA = { id: 'turn-A', index: 1, toolCalls: 1, errors: 0, tokens: {} };
const turnB = { id: 'turn-B', index: 2, toolCalls: 1, errors: 0, tokens: {} };
const entryA = [{ record: a1, turn: turnA }, { record: c1, turn: turnA }];
const entryB = [{ record: a2, turn: turnB }, { record: c2, turn: turnB }];

all();
sandbox.state.query = '';
sandbox.state.overviewSelection = null;

const NO_TOOLS = ['user', 'narration', 'thinking', 'system'];
only(...NO_TOOLS);
sandbox.state.flat = entryA.slice();
check('live: unticking the tool kinds covers the first turn',
  sandbox.visibleEntries().map((e) => e.record.id), ['a1']);

/* The conversation moves on: a new turn with its own tool call arrives. */
sandbox.state.flat = entryA.concat(entryB);
check('live: a turn that arrived after the untick is covered too, with no re-apply step',
  sandbox.visibleEntries().map((e) => e.record.id), ['a1', 'a2']);

all();
check('live: ticking them back shows every tool row, old and new',
  sandbox.visibleEntries().map((e) => e.record.id), ['a1', 'c1', 'a2', 'c2']);
sandbox.state.flat = [];
all();


/* -------------------------------------------------- what the 总览轴 button actually says */
/* A lit button has to mean "the strip is drawing this". Getting that backwards would leave
 * a lit 总览轴 sitting above a strip that is laying every record out the same width.
 *
 * The wording is asserted literally, because a control whose purpose the reader has to
 * guess is a defect no functional test would catch. It was labelled 「时长」 and read as a
 * filter on duration; both labels now have to name the strip and the axis. */
function stubButton() {
  const attrs = {};
  return {
    attrs,
    setAttribute: (k, v) => { attrs[k] = v; },
    getAttribute: (k) => attrs[k]
  };
}
const btnAxis = stubButton();

const readAxis = () => {
  sandbox.applyAxisButton(btnAxis);
  return {
    pressed: btnAxis.getAttribute('aria-pressed'),
    label: btnAxis.getAttribute('aria-label'),
    title: btnAxis.getAttribute('title')
  };
};

sandbox.state.payload = { turns: [], stats: { turns: 1 } };
sandbox.state.flat = [{ record: a1, turn: turnA }, { record: c1, turn: turnA }];

sandbox.state.actualDuration = false;
const axisOff = readAxis();
check('axis: off reads as equal-width and says what the click will do',
  axisOff,
  {
    pressed: 'false',
    label: '总览条当前等宽显示：每条记录一样宽，与耗时无关 · 点击改为真实时间轴',
    title: '总览条当前等宽显示：每条记录一样宽，与耗时无关 · 点击改为真实时间轴'
  });
// The label has to say which strip it changes, or it reads as a page-wide filter.
assert('axis: the equal-width label names the strip', axisOff.label.indexOf('总览条') >= 0);
assert('axis: the equal-width label says the click changes the axis', axisOff.label.indexOf('点击改为真实时间轴') >= 0);
assert('axis: the label never says 时长 on its own', axisOff.label.indexOf('「时长」') < 0);

sandbox.state.actualDuration = true;
const axisOn = readAxis();
check('axis: on reads as the real clock and says what the click will do',
  axisOn,
  {
    pressed: 'true',
    label: '总览条当前按真实时间轴显示：宽度等于该记录的真实耗时 · 点击改为等宽，每条记录一样宽',
    title: '总览条当前按真实时间轴显示：宽度等于该记录的真实耗时 · 点击改为等宽，每条记录一样宽'
  });
assert('axis: the real-clock label names the strip', axisOn.label.indexOf('总览条') >= 0);
assert('axis: each label names the mode the other one switches to',
  axisOff.label.indexOf('真实时间轴') >= 0 && axisOn.label.indexOf('等宽') >= 0);

/* It is a projection control, not a filter: the same records are on screen either way,
 * which is what tells the reader no count on the page moved. */
check('axis: switching it leaves the visible records alone',
  sandbox.visibleEntries().map((e) => e.record.id), ['a1', 'c1']);

/* It reads off one flag, so it has an answer before any record arrives — a control that
 * waits for data cannot report that it is already on. */
sandbox.state.payload = null;
sandbox.state.flat = [];
check('axis: it still reports its state before any data arrives',
  readAxis().pressed, 'true');
sandbox.state.actualDuration = false;

/* Untick one kind and the button must not move: the strip's clock is not a kind filter. */
sandbox.state.flat = [{ record: a1, turn: turnA }, { record: c1, turn: turnA }];
all();
only(...NO_TOOLS);
check('axis: filtering by kind does not disturb the axis button',
  readAxis().pressed, 'false');
all();
sandbox.state.flat = [];


/* --------------------------------------------- a filter has to reach the numbers too */
/* Dropping the rows is not filtering if every figure beside them still describes the
 * rows that were dropped. The turn header has to be rebuilt from what survived. */
// Written out, not derived: a list read from the code under test agrees with itself. This one
// is the independent statement of what the shipped kinds are, and the assert below checks it
// against the shipped order.
const ALL_KINDS = ['user', 'steer', 'reply', 'narration', 'thinking', 'toolCall', 'toolResult', 'system', 'compaction'];
assert('the written-out kind list is the shipped one',
  JSON.stringify(ALL_KINDS) === JSON.stringify(sandbox.KIND_ORDER));
const fCall = rec('c', 'toolCall', 1000, 50, { responseId: 'R', toolCallId: 'tc', toolName: 'bash' });
const fOk = rec('k', 'toolResult', 1100, 50, { toolCallId: 'tc' });
const fBad = rec('b', 'toolResult', 1200, 50, { toolCallId: 'tc2', isError: true });
const fUser = rec('u', 'user', 3000, 0);
const fThink = rec('h', 'thinking', 3100, 0, { tokens: { input: 10, output: 3, cacheRead: 100, cacheWrite: 0 } });

check('turn totals: tool calls and failures are counted from the rows given',
  (() => {
    const t = sandbox.turnTotalsFromEntries([fCall, fOk, fBad].map((r) => ({ record: r, turn: turnA })));
    return [t.toolCalls, t.errors];
  })(), [1, 1]);
check('turn totals: tokens are summed from the rows given',
  sandbox.turnTotalsFromEntries([{ record: fThink, turn: turnA }]).input, 10);
check('turn totals: duration is the span of the rows given',
  sandbox.turnTotalsFromEntries([fCall, fBad].map((r) => ({ record: r, turn: turnA }))).durationMs, 200);
check('turn totals: a filtered turn with no tool work reports none',
  (() => {
    const t = sandbox.turnTotalsFromEntries([{ record: fUser, turn: turnA }]);
    return [t.toolCalls, t.errors, t.input];
  })(), [0, 0, 0]);
check('turn totals: rows with no timestamp do not invent a duration',
  sandbox.turnTotalsFromEntries([{ record: rec('z', 'user', null), turn: turnA }]).durationMs, null);

check('filter scope: nothing set means not filtering', sandbox.isFiltering(), false);
sandbox.state.kinds = ['user'];
check('filter scope: turning a kind off counts as filtering', sandbox.isFiltering(), true);
sandbox.state.kinds = ALL_KINDS;
sandbox.state.query = 'x';
check('filter scope: a search counts as filtering', sandbox.isFiltering(), true);
sandbox.state.query = '';
sandbox.state.overviewSelection = { start: 0, end: 1 };
check('filter scope: a brushed range counts as filtering', sandbox.isFiltering(), true);
sandbox.state.overviewSelection = null;

sandbox.state.kinds = ['user'];
check('strip: a record of a filtered-out kind is not drawn', sandbox.spanPassesFilter(fCall, false), false);
check('strip: a record of a kept kind is drawn', sandbox.spanPassesFilter(fUser, false), true);
/* Search is checked on its own, with every kind back on, so a pass can only come from
 * the hit set and a fail can only come from it.
 *
 * These three used to be about text. They are now about the server's answer, and the shape
 * of the question changed with it: there is no needle to match against in the page any
 * more, so "does this record contain the needle" is not a question the strip can answer at
 * all. What it must do is follow the answer — and while there is no answer yet, draw
 * everything, because a strip that empties itself before the search has come back is the
 * exact symptom the count line's 正在搜索 exists to make legible.
 *
 * The records carry an `index` because that is what the answer names, and the set is built
 * through the page's own `searchHitSet` rather than a literal `new Set`, so this goes
 * through the same conversion the response goes through.
 */
const sHit = rec('s1', 'thinking', 3200, 0, { index: 41 });
const sMiss = rec('s2', 'thinking', 3300, 0, { index: 42 });
sandbox.state.kinds = ALL_KINDS;
sandbox.state.query = 'needle-that-is-absent';
sandbox.state.searchHits = null;
check('strip: a search with no answer yet draws every record, not none',
  [sandbox.spanPassesFilter(sHit), sandbox.spanPassesFilter(sMiss)], [true, true]);
sandbox.state.searchHits = sandbox.searchHitSet([{ index: 41 }]);
check('strip: the strip keeps the record the server hit',
  sandbox.spanPassesFilter(sHit), true);
check('strip: the strip drops the record the server did not hit',
  sandbox.spanPassesFilter(sMiss), false);
sandbox.state.searchHits = sandbox.searchHitSet([]);
check('strip: an answered search that hit nothing draws nothing',
  sandbox.spanPassesFilter(sHit), false);
sandbox.state.searchHits = null;
sandbox.state.query = '';
check('strip: with nothing filtered every record is drawn',
  sandbox.spanPassesFilter(fCall, false), true);

/* The turn handoff. `noReply` is the only rule that cannot be decided from a record alone —
 * 无答复 is a property of the turn — so it is the only way to see whether the strip actually
 * looks the owning turn up or just calls the list with nothing.
 *
 * Ticking a rule is a filter, not a highlight: it keeps what fires and drops the rest. So the
 * three below are one contrast — same record shape, three turns — and the open/closed pair is
 * the one that matters: only the turn lookup can tell those two apart.
 *
 * `turnById` is seeded here rather than by pushing a payload through, because the map is built
 * on the poll path and this guard has no fetch to drive it with. That is a seam, not the
 * thing under test: what is under test is that the strip consults the map at all.
 */
const openTurn = { id: 't-open', index: 1, closed: false };
const shutTurn = { id: 't-shut', index: 2, closed: true };
sandbox.turnById = new Map([[openTurn.id, openTurn], [shutTurn.id, shutTurn]]);
sandbox.state.anomaly.rules = ['noReply'];
check('strip: a record in an unclosed turn is drawn under 无答复, which only the turn lookup can decide',
  sandbox.spanPassesFilter(rec('a1', 'user', 3400, 0, { turnId: openTurn.id })), true);
check('strip: the same record in a closed turn is dropped under the same tick',
  sandbox.spanPassesFilter(rec('a2', 'user', 3500, 0, { turnId: shutTurn.id })), false);
check('strip: a record whose turn is unknown is dropped, because no turn rule fires on nothing',
  sandbox.spanPassesFilter(rec('a3', 'user', 3600, 0, { turnId: 't-absent' })), false);
sandbox.state.anomaly.rules = [];
sandbox.turnById = new Map();

/* ------------------------------------------------- the strip, drawn by the shipped code */
/* Everything above asks `spanPassesFilter()` about one record. That is the predicate, not the
 * strip. The defect this section exists for was a gate *in front of* the predicate inside
 * `renderOverview()`, so a predicate-only guard could never see it: the predicate was always
 * right, the caller had simply stopped asking. Hence the render runs here, and the invariant is
 * the one a reader would state out loud — the strip is a picture of the list under it. Same
 * records, same order, under every filter the page offers.
 *
 * A property, not a shape. The gate named two of five axes, and both cases below are one axis
 * each — which is the whole reason the fix removed the gate instead of completing it: a list
 * of axes is a list that drifts the next time an axis is added. Asserting "the strip equals
 * the list" holds for an axis that does not exist yet; asserting "the gate mentions these two"
 * would have passed while the strip was lying. */
const STRIP_DOM_KEYS = ['overviewTrack', 'overviewTurns', 'overviewLanes', 'overviewSelection',
  'overviewHover', 'overviewEmpty', 'overviewTip', 'overviewClear'];
for (const key of STRIP_DOM_KEYS) sandbox.dom[key] = domNode('div');

/* Five records carrying one difference each: a kind that can be unticked, a record the 异常
 * axis can name, a timestamp a range can cut, and two records nothing touches. Both bounds are
 * carried because the two readers disagree about which field they use: spans are placed by
 * `timestamp`, the range filter reads `relativeMs`. A fixture with only one of them drops
 * records for a reason that has nothing to do with the filter under test. */
const STRIP = [
  ent(rec('g1', 'user', 1000, 0, { relativeMs: 1000 }), 1),
  ent(rec('g2', 'toolCall', 1100, 400, { relativeMs: 1100, responseId: 'R1', toolCallId: 'tc1', toolName: 'bash' }), 1),
  ent(rec('g3', 'toolResult', 1100, 400, { relativeMs: 1100, toolCallId: 'tc1' }), 1),
  ent(rec('g4', 'toolResult', 1600, 200, { relativeMs: 1600, toolCallId: 'tc2', isError: true }), 2),
  ent(rec('g5', 'narration', 2000, 100, { relativeMs: 2000, responseId: 'R2' }), 2)
];

/* What the strip puts on screen, as record ids in the order they were first drawn.
 *
 * The strip draws one node per PIXEL COLUMN, so one record can own several columns and appear
 * several times. Deduplicating is not softening the assertion — the claim it rests on is
 * "every visible record is represented", and the old form ("one node per record") was a claim
 * no reader could check at forty-two records to the pixel. Both are stated in the guard: the
 * set equality below, and the column count further down. */
const stripIds = () => {
  const seen = new Set();
  const out = [];
  for (const n of sandbox.dom.overviewLanes.childNodes) {
    const id = n.getAttribute('data-record-id');
    if (id !== null && !seen.has(id)) { seen.add(id); out.push(id); }
  }
  return out;
};
const listIds = () => sandbox.visibleEntries().map((e) => e.record.id);

function resetStrip() {
  sandbox.state.flat = STRIP.slice();
  sandbox.state.kinds = ALL_KINDS;
  sandbox.state.query = '';
  sandbox.state.searchHits = null;
  sandbox.state.overviewSelection = null;
  sandbox.state.overviewViewport = null;
  sandbox.state.anomaly.rules = [];
  sandbox.state.rangeFrom = null;
  sandbox.state.rangeTo = null;
  sandbox.state.rangeCutoff = null;
  sandbox.state.selectedId = null;
}

/* Render, then hold the strip to the list. Every case also states the rows outright, so a
 * comparison cannot pass by both sides being empty — the failure mode a mirror assertion
 * invites, and the one this section has the most reason to be suspicious of. */
function stripIsTheList(name, expected) {
  sandbox.renderOverview();
  check(name + ': the rows under it', stripIds(), expected);
  check(name + ': the strip draws exactly those rows', stripIds(), listIds());
}

resetStrip();
stripIsTheList('strip under no filter', ['g1', 'g2', 'g3', 'g4', 'g5']);

/* The kind axis, which the gate did list. Unchanged behaviour — and unchanged is the point:
 * a fix that silently moved this one would be a fix that broke the case it looked right on. */
resetStrip();
sandbox.state.kinds = NO_TOOLS;
stripIsTheList('strip under a kind filter', ['g1', 'g5']);

/* The range axis. The gate did not list it, which is the defect: set a range and the strip
 * went on drawing every span the list had already dropped. */
resetStrip();
sandbox.state.rangeTo = 1500;
stripIsTheList('strip under a time range', ['g1', 'g2', 'g3']);

/* The 异常 axis, which replaces the filter outright. Same shape of gap: tick one rule and the
 * strip ignored it until a kind filter happened to be on as well. */
resetStrip();
sandbox.state.anomaly.rules = ['toolError'];
stripIsTheList('strip under one 异常 rule', ['g4']);

/* 异常 is exclusive by construction, so a kind filter left on beside it must change nothing —
 * on either surface. If these two ever disagree the strip is not exclusive, whatever the
 * button says. */
resetStrip();
sandbox.state.anomaly.rules = ['toolError'];
sandbox.state.kinds = ['user'];
stripIsTheList('strip under 异常 with a kind filter left on', ['g4']);

/* The selected row is a deliberate exception, and an exception nobody asserts is one more
 * thing the next reader cannot tell from a bug. Its scope is the viewport, not the filter:
 * panning the strip must not delete the row the reader is on, while every other clipped span
 * goes.
 *
 * The viewport is in the model's own position space — `overviewModel()` renumbers every span
 * onto 0..n — so these bounds are fractions of the strip's width, not timestamps. Reading them
 * as milliseconds does not fail loudly; the viewport simply reads as wider than the domain and
 * nothing clips. */
resetStrip();
sandbox.state.overviewViewport = { start: 0, duration: 2.5 };
sandbox.renderOverview();
check('strip: panning the viewport draws only the spans still inside it',
  stripIds(), ['g1', 'g2', 'g3']);
sandbox.state.selectedId = 'g4';
sandbox.renderOverview();
check('strip: the selected row survives being panned off, since it is the row being read',
  stripIds(), ['g1', 'g2', 'g3', 'g4']);

/* And the brush itself is exempt, by argument rather than by omission: `spanPassesFilter`
 * passes a null selection so the window you are dragging over does not erase its own
 * contents. Asserted from the other side — with a brush in state, the list loses records and
 * the strip does not. */
resetStrip();
sandbox.state.overviewSelection = { start: 1100, end: 1600 };
sandbox.renderOverview();
check('strip: a brush empties the list', listIds(), []);
check('strip: and the strip keeps everything it is drawn over', stripIds(), ['g1', 'g2', 'g3', 'g4', 'g5']);

resetStrip();
sandbox.renderOverview();
check('strip: with nothing filtered again the strip is whole',
  stripIds(), ['g1', 'g2', 'g3', 'g4', 'g5']);

/* ------------------------------------------------------------ one node per pixel column */
/* What this pins: at 36,525 records the strip built 36,525 `.ov-span` nodes and rebuilt them on
 * every poll that carried a body — 3,937 ms measured in the browser, against a 2.5s poll. The
 * fix is aggregation, and an aggregation nobody can see from outside is indistinguishable from
 * not having done it.
 *
 * The promise this layer makes is written out here because aggregation changes its SHAPE, not its
 * truth. Two cases, and they are not the same claim:
 *
 *   strip wider than the record count — every record is bigger than a pixel, gets a column of
 *     its own, and the old "the strip is the list" holds exactly. This is the case a reader can
 *     check, and it is the one a zoomed-in view is always in.
 *   strip narrower — records share a pixel and are indistinguishable there. What still holds is
 *     that every record drawn is one the list kept, and that the strip covers every column the
 *     records reach. "Every record appears" cannot be checked at forty-two records to the pixel,
 *     and before aggregation it was not true either: the nodes were stacked, and what a reader
 *     saw in each pixel was whichever record was painted last.
 *
 * `layoutWidth` is the one thing this fixture controls. 0 means "never laid out", which is the
 * page's own fallback and gets its own assertion below. */

const paintedColumns = () => [...new Set(sandbox.dom.overviewLanes.childNodes.map((n) => n.style.props['--ov-left']))].sort();
const paintedIds = () => [...new Set(sandbox.dom.overviewLanes.childNodes.map((n) => n.getAttribute('data-record-id')))];

resetStrip();
sandbox.dom.overviewLanes.layoutWidth = 20;
sandbox.renderOverview();
check('a strip wider than the record count gives every record its own column',
  stripIds(), ['g1', 'g2', 'g3', 'g4', 'g5']);
check('and the column count follows the strip, not the records',
  sandbox.overviewCache.columns, 20);
check('so the strip and the list still say the same thing',
  stripIds(), listIds());

resetStrip();
sandbox.dom.overviewLanes.layoutWidth = 3;
sandbox.renderOverview();
check('a strip narrower than the record count builds fewer nodes than there are records',
  sandbox.dom.overviewLanes.childNodes.length < 5, true);
check('the column count is the strip width', sandbox.overviewCache.columns, 3);
check('nothing on the strip is a record the list dropped',
  paintedIds().every((id) => listIds().includes(id)), true);
check('and the strip covers every column the records reach',
  paintedColumns(), ['0.0000%', '33.3333%', '66.6667%']);

resetStrip();
sandbox.dom.overviewLanes.layoutWidth = 0;
sandbox.renderOverview();
check('a strip that has never been laid out falls back to one column per record',
  sandbox.overviewCache.columns, 5);
check('not to a single column, which would be a solid block',
  stripIds(), ['g1', 'g2', 'g3', 'g4', 'g5']);

/* The selected and hovered records are the two things a column cannot say, so each gets its own
 * node. Without them the strip would still be right and the reader would still be lost. */
resetStrip();
sandbox.dom.overviewLanes.layoutWidth = 20;
sandbox.state.selectedId = 'g3';
sandbox.renderOverview();
check('the selected record has a node marked as the selected one',
  sandbox.dom.overviewLanes.childNodes.filter(
    (n) => n.getAttribute('data-record-id') === 'g3' && n.getAttribute('data-current') === 'true').length >= 1,
  true);
check('and it is marked as a record rather than as a column',
  sandbox.dom.overviewLanes.childNodes.some((n) => n.getAttribute('data-current-marker') === 'true'), true);

/* g3 is the record a 3px strip leaves without a column of its own — exactly the case the hover
 * marker exists for, and exactly the case the old `document.elementFromPoint` hit-test could not
 * reach. An earlier version of this guard called `markOverviewHover('g3')` directly, which passed:
 * the id was injected, so nothing had to discover it. The whole defect lived on the other side of
 * that call. So this drives the real pointer path with the DOM answering as the browser would —
 * returning whichever column node is topmost — and asks for a record that owns none. */
resetStrip();
sandbox.overviewDrag = null;          // a brush left armed by an earlier case would take the
                                       // drag branch and return before the hover is ever asked for
// The track and the lanes are two different elements on the page: the track is the full strip the
// pointer's x is measured against, the lanes are the domain window inset inside it. Giving the
// stub one width for both makes `overviewFractionAt` answer 0 for every x, and every hover
// assertion then quietly measures "the record nearest the start of the session".
sandbox.dom.overviewTrack.layoutWidth = 1000;
sandbox.dom.overviewLanes.layoutWidth = 3;
sandbox.renderOverview();
const crowdedModel = sandbox.overviewCache.model;
const crowded = crowdedModel.spans.find((s) => s.id === 'g3');
check('the crowded record is the one with no column of its own',
  paintedIds().includes('g3'), false);

// Whatever the browser hands back has to be a real, wrong answer for the test to mean anything.
const domAnswer = sandbox.dom.overviewLanes.childNodes.find(
  (n) => n.getAttribute('data-record-id') !== null && Number(n.style.props['--ov-lane']) === crowded.lane);
check('the DOM can only answer with a different record in that lane',
  domAnswer.getAttribute('data-record-id') !== 'g3', true);
sandbox.document.elementFromPoint = () => domAnswer;

const crowdedView = sandbox.overviewCache.view;
const crowdedX = (((crowded.start + crowded.end) / 2 - crowdedView.start) / crowdedView.duration) * 1000;

/* What the hit test RETURNS, asked of the function rather than of the handler that uses it.
 *
 * `client-check.mjs` can only read this one as source text, and enumerating the syntaxes that
 * produce a key does not end: `hit.id`, `recordKey(hit.record)` and `hit.record.id` are three
 * spellings of one defect, and a fourth is always available. Running it is what makes the check
 * total — every one of them answers a string, and a span is not a string.
 *
 * Placed before the handler cases on purpose: a key-returning hit test also breaks those, so if
 * this ran second the mutation would be attributed to whichever of them failed first and would
 * never be given the name it is about. */
const directHit = sandbox.spanAt(crowdedX, 8);
/* Both reads go through the same guard. A hit test that answers null, or answers a key, must fail
 * HERE BY NAME — `directHit.record.id` on a null throws, and a throw names no rule at all, which
 * this suite treats as a weaker outcome than a red assertion and reports as UNNAMED. */
const directIsSpan = directHit !== null && typeof directHit === 'object' && 'record' in directHit;
check('the hit test hands back a span, not a key, whichever way it spells the lookup',
  directIsSpan && 'id' in directHit, true);
/* Shape is not enough, and a second acceptance review showed why: `{ id: hit.id, record: hit.record }`
 * carries every field the shape check looks at and names the right record, so it passes — while
 * being a different object from the one the hit test found. Click and hover act on this value, so
 * what has to hold is that it IS the model's span, not that it resembles one. `crowded` is the very
 * object out of `overviewCache.model.spans`, which is what `nearestSpanAt` returns by reference. */
check('and it is that span itself, not something shaped like it',
  directIsSpan && directHit === crowded, true);
check('and the record it carries is the one under the pointer',
  directIsSpan ? directHit.record.id : null, 'g3');

sandbox.onOverviewPointerMove({ clientX: crowdedX, clientY: 8, pointerId: 3 });
check('the hovered record comes from the model, not from the node under the pointer',
  sandbox.state.overviewHoverId, 'g3');
check('and it is drawn, since it has no column of its own',
  sandbox.dom.overviewLanes.childNodes.some((n) => n.getAttribute('data-hovered-marker') === 'true'), true);
check('and the mark is on that record',
  sandbox.dom.overviewLanes.childNodes.filter((n) => n.getAttribute('data-hovered-marker') === 'true')
    .map((n) => n.getAttribute('data-record-id')), ['g3']);

// A point that is over no span at all must still answer with nothing, rather than snapping to
// whatever record happens to be nearest in time.
sandbox.document.elementFromPoint = () => sandbox.dom.overviewTrack;
sandbox.onOverviewPointerMove({ clientX: crowdedX, clientY: 8, pointerId: 3 });
check('a point over no span hovers nothing', sandbox.state.overviewHoverId, null);
check('and leaves no marker behind',
  sandbox.dom.overviewLanes.childNodes.some((n) => n.getAttribute('data-hovered-marker') === 'true'), false);
check('and the columns are exactly as they were',
  paintedColumns(), ['0.0000%', '33.3333%', '66.6667%']);

/* ----------------------------------------------------------------- distance arithmetic
 * The hit test resolves in TIME so that the answer is the record nearest the pointer rather than
 * whichever one was painted last. Nothing above puts the pointer in a gap between two spans, and
 * that is exactly where the two candidate distances are computed and compared — so a comparison
 * written the other way round leaves every one of those assertions green.
 *
 * Subtracting the smaller time from the larger one leaves both distances positive and the `<`
 * keeps the closer. Subtracting the other way leaves both NEGATIVE, which still admits the first
 * candidate against Infinity and then keeps every LATER candidate that is further away: the strip
 * answers with the record farthest from the pointer. Three spans in one lane make that visible,
 * because nearest and farthest are different records.
 *
 * Expected values are derived by hand from the coordinates below, not read back out of the
 * function, so this block can fail rather than merely agree with itself. */
const D = (id, lane, start, end) => ({ id, lane, start, end, record: { id } });
const restoreModel = sandbox.overviewCache.model;
sandbox.overviewCache.model = {
  start: 0,
  end: 900,
  // near-x sits in the next row and straddles the gap the lane-1 probes use.
  spans: [D('near-l', 1, 0, 100), D('near-m', 1, 220, 300), D('near-r', 1, 400, 900),
    D('near-d', 1, 600, 700), D('near-x', 2, 104, 116)],
};
const at = (time, lane) => { const s = sandbox.nearestSpanAt(time, lane); return s ? s.record.id : null; };

// 110 is in the gap after near-l: 10ms from its end, 110ms from near-m's start, 290 from near-r's.
check('a pointer in a gap resolves to the nearer of the two spans around it, not the further one',
  at(110, 1), 'near-l');
// 390 is in the gap before near-r: 90ms from near-m's end, 10ms from near-r's start, 290 from near-l's.
check('and the same when the nearer span is on the other side of the pointer', at(390, 1), 'near-r');
/* 370 is the case that pins BOTH distance expressions on their own, so neither one can be the
 * only thing carrying the rule: 30ms from near-r's start, 230 from near-d's start, 70 from near-m's
 * end, 270 from near-l's. Flipping either subtraction turns its own candidates negative, and the
 * further one of that side then wins — the `span.start > time` side has two candidates here, so it
 * is distinguishable from the case above where it has only one. */
check('with two spans on the same side, it is still the nearer one that wins', at(370, 1), 'near-r');
// 150 with no row: near-x is 34ms away, near-l 50, near-m 70, near-r 250 — so a second row does
// compete, which is the click fallback's case: it has no row to offer.
check('a pointer with no row given is answered from every row', at(150), 'near-x');
// Past the whole session every span is behind the pointer, so the nearest is the one that ENDS
// last — near-r, at 100ms — not the one that ends first (900ms) and not the last in the array
// (near-d ends at 700, which is 300ms away).
check('a pointer past the whole session resolves to the last span, not the first', at(1000, 1), 'near-r');
check('and one before it, to the first, not the last', at(-50, 1), 'near-l');
// near-x contains 110 exactly, so with no row it wins outright; with lane 1 it is not consulted
// at all, and the row the pointer is actually over answers instead.
check('the row is a filter and not a preference: a span in another row is not consulted', at(110, 1), 'near-l');
sandbox.overviewCache.model = restoreModel;

/* ----------------------------------------------------------------------- report */
console.log('overview + toolbar controls: ' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  for (const f of failures) console.log('FAIL  ' + f);
  process.exit(1);
}
console.log('ALL CHECKS PASSED');
