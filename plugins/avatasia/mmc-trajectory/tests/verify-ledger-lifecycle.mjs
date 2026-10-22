/**
 * The ledger keeps its rows for the groups the reader is on and gives the rest up — and the
 * promise that comes with giving them up is two-sided.
 *
 * The one side everybody can see: a group the reader is not on must not be holding its rows.
 * Measured on one session of about 50,600 records (2026-10-22), the rows of 「显示全部」 were
 * 463,122 DOM nodes and the renderer's private memory read 785 to 820 MB, so "hold everything"
 * is the whole cost.
 *
 * The other side is the one that is easy to lose: a group that has given up its rows must still
 * be *there*. The rows are the DOM; the height is the reader's place in a session they have
 * scrolled through, and it is what the scrollbar is describing. Two facts about the browser
 * make this harder than it looks:
 *
 *   - `contain-intrinsic-size` sizes an element the browser has SKIPPED. A group near the
 *     viewport is RENDERED, and a rendered group with no rows is 39 px tall — its header. So
 *     releasing the rows of the groups around the viewport took the scroll height down by
 *     79,288 px, and releasing the viewport's own group took another 257,378 px.
 *   - The rows of a group come back when the reader reaches it, so the anchor the page restores
 *     the scroll position from has to be read out of the group the reader is actually on. Read
 *     from the next group down that still has rows, it is an anchor to the wrong place.
 *
 * So the rules here are: the rows of a group the reader is not on are not built; the height of
 * that group is kept; the rows come back when the reader arrives; and the group that is live is
 * bounded in number, which is what makes the memory bounded rather than merely reduced.
 *
 * These are asserted by running the shipped functions in a sandbox with a fake DOM, not by
 * reading the source: a source-shaped check cannot tell a group that is released from one that
 * is released *and keeps its height*, which is the difference between a smaller page and a
 * broken one.
 *
 * mutate-ledger-lifecycle.py breaks each rule in the shipped file and requires this guard to
 * report it by name, so a rule nothing tests cannot be added here.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HTML = fileURLToPath(new URL('../miniapp/client/index.html', import.meta.url));
const html = readFileSync(HTML, 'utf8');

let pass = 0;
const failures = [];
function assert(name, cond) {
  if (cond) pass += 1;
  else failures.push(name);
}

function functionSource(name) {
  const at = html.indexOf('function ' + name + '(');
  if (at < 0) return null;
  let i = html.indexOf('{', at);
  let depth = 0;
  for (let j = i; j < html.length; j += 1) {
    if (html[j] === '{') depth += 1;
    else if (html[j] === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(at, j + 1);
    }
  }
  return null;
}

/* ---------- the shipped pieces, lifted ---------- */

const LIFECYCLE_FNS = [
  'ledgerStateOf',
  'ledgerHoldsRows',
  'releaseStaleGroups',
  // The window's first group, read out of the table: the visit path holds it on to as well as
  // the group the reader has just reached.
  'ledgerFirstGroupKey',
  // The rebuild's half of the release decision, so that a rebuild here is the rebuild the
  // client makes rather than an approximation of it.
  'releaseStaleGroupsBeforeRebuild',
  'fillLedgerGroup',
  'holdLedgerHeight',
  'heldLedgerHeight',
  'fillGroupRows',
  'firstVisibleRow',
  // The emptying of a list, which is how a group gives up its rows.
  'clear',
  // The prediction itself, because the arithmetic of the prediction is half of what this file
  // has to prove: a band is an entry as well as a row, and a prediction that counts it as both
  // prices it twice.
  'applyIntrinsicSize',
  // The build itself, because the rule this file has to prove is about what the build
  // writes. A group the reader has left must not be kept alive by the rebuild — and the
  // source of a function cannot say whether it stamps the reader's lease or not.
  'buildStep'
];

const fnSrc = LIFECYCLE_FNS.map((name) => functionSource(name));
const missing = LIFECYCLE_FNS.filter((_, i) => !fnSrc[i]);
if (missing.length) {
  console.error(`[ledger-lifecycle] 0 passed, ${missing.length} failed`);
  for (const m of missing) console.error('  FAIL  the shipped script has no ' + m + '()');
  process.exit(1);
}

/*
 * The two helpers the live-group measurement and the release of a visited group live in.
 *
 * They are lifted when the client has them and left out when it does not, and that is on
 * purpose: this guard has to be runnable against the client as it was before the fix,
 * because the proof that the new assertions fail is a run of this guard against the broken
 * code. A client without them is a client whose visited groups are never measured and never
 * released, and the assertions below say so by failing.
 */
const OPTIONAL_FNS = ['measureLedgerGroup', 'releaseLedgerRows'];
const optionalSrc = OPTIONAL_FNS.map((name) => functionSource(name)).filter(Boolean);

// The two limits are declarations, not functions, so they are lifted on their own. They are
// numbers the shipped code reads, and the guard below uses the shipped values rather than
// numbers written here — a copy of the cap in this file would keep passing after the shipped
// one changed.
const idleDecl = html.match(/^[ \t]*var LEDGER_IDLE_MS = [^;]+;/m);
const capDecl = html.match(/^[ \t]*var LEDGER_LIVE_GROUPS = [^;]+;/m);
const batchDecl = html.match(/^[ \t]*var LEDGER_BATCH_GROUPS = [^;]+;/m);
assert('the shipped script declares the idle timeout', !!idleDecl);
assert('the shipped script declares the cap on groups holding their rows', !!capDecl);
assert('the shipped script declares how many groups a build does at a time', !!batchDecl);
if (!idleDecl || !capDecl || !batchDecl) {
  console.error(`[ledger-lifecycle] ${pass} passed, ${failures.length} failed`);
  for (const f of failures) console.error('  FAIL  ' + f);
  process.exit(1);
}

/* ---------- a DOM small enough to reason about ---------- */

function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attrs: Object.create(null),
    style: {},
    classes: new Set(),
    appendChild(child) { el.children.push(child); return child; },
    removeChild(child) {
      const at = el.children.indexOf(child);
      if (at >= 0) el.children.splice(at, 1);
      return child;
    },
    get firstChild() { return el.children.length ? el.children[0] : null; },
    setAttribute(name, value) { el.attrs[name] = String(value); },
    getAttribute(name) { return name in el.attrs ? el.attrs[name] : null; },
    querySelector(selector) { return queryOne(el, selector); },
    // The one query the shipped code makes on the ledger: the sections of the table, in the
    // order they were built. Every other query answers with an empty list.
    querySelectorAll(selector) {
      if (selector === ':scope > section.turn-group') {
        return el.children.filter((c) => c && c.tagName === 'SECTION' && c.classes.has('turn-group'));
      }
      return [];
    },
    getBoundingClientRect() { return { height: 240, width: 900, top: 0, bottom: 240 }; }
  };
  el.classList = {
    add(name) { el.classes.add(name); },
    remove(name) { el.classes.delete(name); },
    contains(name) { return el.classes.has(name); }
  };
  return el;
}

function queryOne(root, selector) {
  const parts = selector.split('.');
  const tag = parts.shift();
  for (const child of root.children) {
    if (!child || !child.children) continue;
    const ok = (!tag || child.tagName === tag.toUpperCase())
      && parts.every((c) => child.classes.has(c));
    if (ok) return child;
    const deeper = queryOne(child, selector);
    if (deeper) return deeper;
  }
  return null;
}

function entriesOf(count, bands, prefix) {
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    entries.push({ record: { kind: 'message', id: prefix + i } });
  }
  for (let i = 0; i < bands; i += 1) {
    entries.push({ record: { kind: 'compaction', id: prefix + 'c' + i } });
  }
  return entries;
}

/**
 * A fresh sandbox with the shipped lifecycle code in it.
 *
 * The clock is a variable rather than the real Date, because the idle timeout is a rule about
 * time and a test that has to wait fifteen seconds to check it is a test nobody runs.
 */
function harness() {
  const box = { clock: 1000, built: [], sized: [] };
  const sandbox = {
    console,
    Math,
    JSON,
    Date: { now: () => box.clock },
    ledgerState: new Map(),
    ledgerContent: new Map(),
    // The row heights the last build calibrated. The visit path prices the difference a
    // released group has with them, so the build writes them and the visit path reads them.
    ledgerCalibration: null,
    // The ledger the table is in. The shipped code reads it when it has to take the rows out
    // of a group the reader is no longer on.
    dom: { ledger: makeEl('div') },
    // The shipped el(tag, className), class and all: the class is what a section is found
    // by, and a list without one is a list the shipped code cannot find.
    el: (tag, className) => {
      const e = makeEl(tag);
      if (className) String(className).split(/\s+/).forEach((c) => { if (c) e.classes.add(c); });
      box.built.push(e);
      return e;
    },
    railStates: (entries) => entries.map(() => null),
    buildRow: (entry) => {
      const e = makeEl('div');
      e.classes.add('row');
      e.setAttribute('data-row-id', entry.record.id);
      return e;
    },
    buildCompactionBand: (entry) => {
      const e = makeEl('div');
      e.classes.add('band');
      e.setAttribute('data-row-id', entry.record.id);
      return e;
    },
    sizeBuiltGroup: (section) => { box.sized.push(section); }
  };
  vm.createContext(sandbox);
  vm.runInContext(
    idleDecl[0] + '\n' + capDecl[0] + '\n' + batchDecl[0] + '\n' + fnSrc.join('\n') + '\n' + optionalSrc.join('\n'),
    sandbox
  );
  box.sandbox = sandbox;
  return box;
}

/**
 * The sandbox the build runs in.
 *
 * The build is a nested function inside renderLedger, so lifting it leaves everything it
 * closes over undefined — and it is lifted here to be *run*, not to be read. The collaborators
 * it needs are the ones a build touches: the ledger it appends to, the groups it is told to
 * build, and the clock. The ones that would need a real browser (the observer, the anchor,
 * the measurement) are stubs, because the rule under test is about the lease and the lease is
 * decided before any of them run.
 */
function buildHarness(options) {
  const h = harness();
  const s = h.sandbox;
  s.ledgerBuildToken = 1;
  s.build = { token: 1, at: 0, rows: 0, bands: 0, heights: null };
  s.buildTotal = 0;
  s.groups = [];
  s.anchor = null;
  s.scrollY = 0;
  s.ledger = makeEl('div');
  // The ledger the table is in, which is where the shipped code looks for the groups it has
  // to take the rows out of.
  s.dom = { ledger: s.ledger };
  s.isCount = (n) => typeof n === 'number';
  s.DASH = '—';
  s.turnKey = (turn) => 'k' + turn.index;
  s.buildTurnHead = () => makeEl('div');
  // The prediction is stubbed by default, so a case that does not care about its arithmetic does
  // not have to know the calibrated heights. A case that does care asks for the real one: the
  // arithmetic of the prediction is half of what this file has to prove — a band is an entry as
  // well as a row, and a prediction that counts it as both prices it twice.
  if (!(options && options.realPrediction)) s.applyIntrinsicSize = () => 240;
  // The real calibration answers with the three heights it measured — the head, a row and a
  // band — and the build prices a difference in rows with them. A stub that answers with any
  // other shape is a stub of a different function.
  s.calibrateRowHeights = () => ({ head: 40, row: 36, band: 60 });
  s.setLedgerProgress = () => {};
  s.restoreRowAnchor = () => {};
  s.flushDeferredPoll = () => {};
  s.watchLedgerGroups = () => {};
  s.syncStickyOffsets = () => {};
  s.window = { requestAnimationFrame: () => {} };
  return h;
}

/**
 * One rebuild of the ledger, the way renderLedger does it.
 *
 * The groups are the window's, the first one is the group the window is anchored on, and the
 * state carries over — a rebuild does not reset the reader's lease, and proving that it does
 * not is the whole point of the rule below.
 *
 * The release step is part of it, and it is the shipped one: the fixture calls the function
 * the client calls, so a rebuild here is a rebuild of the client rather than an approximation
 * of it. Leaving it out is what made this file blind to the rebuild's half of the bound — a
 * build that stopped releasing the groups the reader had left came out with more groups
 * holding their rows than the cap allows, and every assertion here still passed.
 */
function rebuild(h, groups) {
  const s = h.sandbox;
  s.ledger.children.length = 0;
  s.ledgerContent.clear();
  s.groups = groups;
  s.build.at = 0;
  s.build.rows = 0;
  s.build.bands = 0;
  s.build.heights = null;
  // The total the build reports while it is running. It lives in renderLedger() beside the
  // build, and a window longer than one batch is the case that reads it.
  s.buildTotal = groups.reduce((n, g) => n + g.entries.length, 0);
  s.releaseStaleGroupsBeforeRebuild(groups);
  s.buildStep();
}

/** The section the build made for a group, by its order in the window. */
function sectionOf(h, index) {
  return h.sandbox.ledger.children[index];
}

/* ---------- 1. the rows of a group the reader is not on are not built ---------- */

{
  const h = harness();
  const s = h.sandbox;
  const group = { key: 'g', turn: { index: 3 }, entries: entriesOf(5, 2, 'r') };
  const bands = s.fillGroupRows(null, group);
  assert('a released group builds no rows', h.built.length === 0);
  assert('the bands of a released group are still counted, because its height depends on them',
    bands === 2);
}

{
  const h = harness();
  const s = h.sandbox;
  const list = makeEl('ul');
  const group = { key: 'g', turn: { index: 3 }, entries: entriesOf(5, 2, 'r') };
  const bands = s.fillGroupRows(list, group);
  assert('a group that is holding its rows builds every one of them', list.children.length === 7);
  assert('the bands are counted the same way either way', bands === 2);
}

/* ---------- 1b. a compaction record is a band, not a row ---------- */

{
  const h = harness();
  const s = h.sandbox;
  const list = makeEl('ul');
  const group = { key: 'g', turn: { index: 3 }, entries: entriesOf(2, 1, 'r') };
  s.fillGroupRows(list, group);
  const isBand = (li) => li.children.some((n) => n.classes.has('band'));
  const isRow = (li) => li.children.some((n) => n.classes.has('row'));
  assert('a compaction record is rendered as a band, not as a row',
    list.children.filter(isBand).length === 1 && list.children.filter(isRow).length === 2);
}

/* ---------- 2. a released group keeps the height it is given ---------- */

{
  const h = harness();
  const s = h.sandbox;
  const section = makeEl('section');
  s.holdLedgerHeight(section, 3643);
  assert('a released group keeps the height it is given', section.style.minHeight === '3643px');
}

{
  const h = harness();
  const s = h.sandbox;
  const section = makeEl('section');
  s.holdLedgerHeight(section, 0);
  assert('a group with no height to keep is not given one',
    section.style.minHeight === undefined);
}

/* ---------- 2b. the height a released group keeps is brought up to date with what it holds ---------- */

/**
 * Measure a group the way the observer does: fill it, and take the height it really has.
 *
 * The counts the height was measured at are recorded by the same call that records the height,
 * so a test that sets them by hand is testing a state the shipped code never produces.
 */
function measureGroup(h, key, entries, bands, height) {
  const s = h.sandbox;
  const section = makeEl('section');
  const list = makeEl('ul');
  list.classes.add('row-list');
  section.appendChild(list);
  section.setAttribute('data-rows', 'released');
  section.getBoundingClientRect = () => ({ height, width: 900, top: 0, bottom: height });
  s.ledgerContent.set(section, { key, turn: { index: 1 }, entries, bands });
  s.fillLedgerGroup(section);
  return section;
}

/*
 * The measured height is a measurement of a past. A group is keyed by its turn, and the turn
 * keeps its key while its content changes — a late reply, a band from a compaction — so the
 * height taken when the group was last on screen describes content that is no longer there.
 * A group that keeps it unchanged is shorter than the content it is holding, and the
 * document under the reader loses the rows that were added.
 *
 * The difference is priced locally: the measured height is kept, and only the rows that
 * changed are charged at the calibrated row height. The cases below are the ways the content
 * can differ — a row added, nothing changed, a band added, a first band gained, a row gone
 * and a band gained.
 *
 * The rows and the bands are two counts, not one. A band is an entry as well as a row, so a
 * count of entries charges every band once as a row and once as a band; the row and band
 * heights are close (36 px and 38 px on a real session), so a band charged twice leaves the
 * box a whole row taller than the content it holds — the document lying about its own height
 * in the other direction. The cases are built so that this shows up: the band cases add a
 * band without removing a row, and the last one removes a row and adds a band at the same
 * time, which is the one a single count cannot tell.
 *
 * The window has to be longer than one batch, because the first batch is priced from the
 * prediction and the groups after it from the measurement. Twenty-five groups is one batch.
 */
{
  const h = buildHarness();
  const s = h.sandbox;
  const groups = [];
  for (let i = 0; i < 31; i += 1) {
    groups.push({ turn: { index: i + 1 }, entries: entriesOf(3, 0, 'g' + i) });
  }
  // Five groups measured for real, each on the content it is compared against.
  measureGroup(h, 'k26', entriesOf(3, 0, 'm26'), 0, 1000);
  measureGroup(h, 'k27', entriesOf(3, 0, 'm27'), 0, 1000);
  measureGroup(h, 'k28', entriesOf(2, 1, 'm28'), 1, 1000);
  measureGroup(h, 'k29', entriesOf(3, 0, 'm29'), 0, 1000);
  measureGroup(h, 'k30', entriesOf(2, 1, 'm30'), 1, 1000);
  // And the content they hold now.
  groups[25].entries = entriesOf(4, 0, 'g25');
  groups[26].entries = entriesOf(3, 0, 'g26');
  groups[27].entries = entriesOf(2, 2, 'g27');
  groups[28].entries = entriesOf(3, 1, 'g28');
  groups[29].entries = entriesOf(1, 2, 'g29');
  // The reader walked away from all of them a long time ago, so they do not hold their rows.
  h.clock = 100000;

  rebuild(h, groups);
  s.buildStep();

  assert('a released group brings the height it keeps up to date with the rows it gained',
    sectionOf(h, 25).style.minHeight === '1036px');
  assert('a released group whose content has not changed keeps the height it was measured at',
    sectionOf(h, 26).style.minHeight === '1000px');
  assert('a released group is charged for the band it gained',
    sectionOf(h, 27).style.minHeight === '1060px');
  assert('a released group that gained its first band is charged for the band',
    sectionOf(h, 28).style.minHeight === '1060px');
  assert('a released group that lost a row and gained a band is charged for both',
    sectionOf(h, 29).style.minHeight === '1024px');
  assert('a rebuild does not change the height a group was measured at',
    s.ledgerState.get('k26').height === 1000);
}

/* ---------- 2c. the first batch is the whole window in the default view ---------- */

/*
 * The page opens on the newest 200 records, and 200 records span fewer turns than a batch is
 * long — so in the default view the whole ledger IS the first batch. The first batch is the
 * one whose groups are measured against the prediction: the calibration does not exist until
 * the batch is built, and the pass that follows the calibration is the one that sizes the
 * groups the build released.
 *
 * So the rule "a released group keeps the height it had, brought up to date with what it holds
 * now" has to hold THERE as well — otherwise it holds only in the full view, which is the
 * opt-in one, and the page nobody opted in is the one with the rule missing.
 *
 * These cases run the build path with the real prediction in it, and read what the released
 * group ends up holding. The prediction is priced from the calibrated heights (40, 36 and 60 in
 * the stub above), so the numbers below are the ones that stub produces: a group of four rows
 * is predicted at 40 + 4*36 = 184, and a group of two rows and two bands at 40 + 2*36 + 2*60
 * = 232 — a band priced once, at its own height, and not at the row's height as well.
 */
{
  const h = buildHarness({ realPrediction: true });
  const s = h.sandbox;
  // The ledger's own query, so the pass that follows the calibration finds the groups the
  // build released. The fake DOM answers every query with an empty list, and a build whose
  // calibration pass finds nothing never sizes the groups it released — so the case would
  // pass for the wrong reason.
  s.ledger.querySelectorAll = (selector) => {
    if (!/data-rows\s*=\s*"released"/.test(selector)) return [];
    return s.ledger.children.filter((c) => c.getAttribute('data-rows') === 'released');
  };
  const groups = [];
  for (let i = 0; i < 26; i += 1) {
    groups.push({ turn: { index: i + 1 }, entries: entriesOf(3, 0, 'g' + i) });
  }
  // Two groups measured for real, each on the content it is compared against: one with three
  // rows and no band, one with two rows and a band.
  measureGroup(h, 'k2', entriesOf(3, 0, 'm2'), 0, 1000);
  measureGroup(h, 'k3', entriesOf(2, 1, 'm3'), 1, 1000);
  // And what they hold now: the first gained a row, the second gained a band.
  groups[1].entries = entriesOf(4, 0, 'g1');
  groups[2].entries = entriesOf(2, 2, 'g2');
  // The group of the second batch, which has a band in it and was never measured.
  groups[25].entries = entriesOf(3, 1, 'g25');
  // The reader walked away a long time ago, so they do not hold their rows.
  h.clock = 100000;

  rebuild(h, groups);
  s.buildStep();

  assert('a released group keeps the height it was measured at in the first batch',
    sectionOf(h, 1).style.minHeight === '1036px');
  assert('a released group is charged for the band it gained in the first batch',
    sectionOf(h, 2).style.minHeight === '1060px');
  assert('the height a released group keeps is not the prediction',
    sectionOf(h, 1).style.minHeight !== '184px');
  assert('a band is priced once in the predicted height',
    sectionOf(h, 2).style.containIntrinsicSize === 'auto 232px');
  assert('the prediction of a group with a band does not charge the band as a row',
    sectionOf(h, 25).style.containIntrinsicSize === 'auto 208px');
}

/* ---------- 3. a group the reader left gives its rows up, and the count is bounded ---------- */

{
  const h = harness();
  const s = h.sandbox;
  s.ledgerState.set('a', { live: true, lastSeen: 1000, height: 0 });

  h.clock = 1000 + s.LEDGER_IDLE_MS - 1;
  s.releaseStaleGroups(['somewhere-else']);
  assert('a group the reader is still within reach of keeps its rows',
    s.ledgerState.get('a').live === true);

  h.clock = 1000 + s.LEDGER_IDLE_MS;
  s.releaseStaleGroups(['somewhere-else']);
  assert('a group the reader has left gives its rows up once the idle time has passed',
    s.ledgerState.get('a').live === false);
}

{
  const h = harness();
  const s = h.sandbox;
  const n = s.LEDGER_LIVE_GROUPS + 2;
  for (let i = 0; i < n; i += 1) {
    s.ledgerState.set('g' + i, { live: true, lastSeen: 1000 + i, height: 0 });
  }
  // The clock is past every lease above. The anchored group is counted with the current time
  // — it has no visit of its own to be dated by — so a clock that sat behind the leases would
  // make the anchored group look like the oldest one, which is the one thing it never is.
  h.clock = 2000;
  s.releaseStaleGroups(['g' + (n - 1)]);
  const live = [...s.ledgerState.values()].filter((v) => v.live).length;
  assert('the number of groups holding their rows is bounded',
    live === s.LEDGER_LIVE_GROUPS);
  assert('the oldest groups are the ones that go when the bound is passed',
    s.ledgerState.get('g0').live === false
    && s.ledgerState.get('g1').live === false
    && s.ledgerState.get('g' + (n - 1)).live === true);
}

/* ---------- 3b. the group the window is anchored on is counted among them ---------- */

/*
 * Two sets, and they have to be the same set.
 *
 * The bound is about the groups that hold their rows: that is the memory. The groups that are
 * live are the groups the reader is keeping alive, and the group the window is anchored on is
 * not one of them — the reader arrives there and every other group's height is predicted from
 * it, so it holds its rows whatever the reader is doing. It has no visit of its own to be
 * dated by, so it is counted rather than timed.
 *
 * Left out of the count, it would go on holding its rows past the bound: the bound would be
 * about one set while the rows on screen were another. That is what the assertion below is
 * for, and it is a separate assertion because it is a separate rule.
 */

{
  const h = harness();
  const s = h.sandbox;
  h.clock = 5000;
  // The anchored group: not live, and its last visit was long enough ago that the idle
  // timeout would have taken it, if the idle timeout were about it. It is not.
  s.ledgerState.set('anchor', { live: false, lastSeen: 1000, height: 0 });
  for (let i = 0; i < s.LEDGER_LIVE_GROUPS + 1; i += 1) {
    s.ledgerState.set('g' + i, { live: true, lastSeen: 4000 + i, height: 0 });
  }
  s.releaseStaleGroups(['anchor']);
  const live = [...s.ledgerState.values()].filter((v) => v.live).length;
  assert('the window\'s first group is one of the groups that hold their rows',
    s.ledgerState.get('anchor').live === true);
  assert('the bound is about the groups holding their rows, and the anchored group is one of them',
    live === s.LEDGER_LIVE_GROUPS);
}

/* ---------- 3c. a rebuild is not a visit ---------- */

/*
 * The poll runs every eight seconds whether the reader is there or not. A build that stamped
 * the reader-idle lease would renew it every time — so the lease could never run out, the
 * group the reader had left would keep its row DOM for the rest of the session, and the
 * fifteen-second idle timeout would be a rule about nothing.
 *
 * The build is run here rather than read: what it writes is the rule, and the source of a
 * function does not say whether it writes it.
 */

{
  const h = buildHarness();
  const s = h.sandbox;
  const groups = [
    { turn: { index: 1 }, entries: entriesOf(2, 0, 'a') },
    { turn: { index: 2 }, entries: entriesOf(2, 0, 'b') }
  ];
  // The second group is the one the reader left: live, last seen at 1000, and nobody has
  // been at it since.
  s.ledgerState.set('k2', { live: true, lastSeen: 1000, height: 0 });

  h.clock = 9000;
  rebuild(h, groups);
  assert('rebuilding an offscreen group does not renew its reader-idle lease',
    s.ledgerState.get('k2').lastSeen === 1000);
  assert('a group the reader has just left still holds its rows, because the idle time has not passed',
    s.ledgerState.get('k2').live === true
    && sectionOf(h, 1).getAttribute('data-rows') === 'live');

  h.clock = 17000;
  s.releaseStaleGroups(['k1']);
  rebuild(h, groups);
  assert('a group the reader has left gives its rows up while the ledger keeps being rebuilt',
    s.ledgerState.get('k2').live === false
    && sectionOf(h, 1).getAttribute('data-rows') === 'released');

  h.clock = 25000;
  rebuild(h, groups);
  assert('a group that has given its rows up does not get them back by being rebuilt',
    s.ledgerState.get('k2').live === false
    && sectionOf(h, 1).getAttribute('data-rows') === 'released');
}

{
  const h = harness();
  const s = h.sandbox;
  assert('the first group of a window always holds its rows, because every height is predicted from it',
    s.ledgerHoldsRows('never-seen', true) === true);
  assert('a group nobody has been on does not hold its rows',
    s.ledgerHoldsRows('never-seen', false) === false);
}

/* ---------- 3d. a group the build made live keeps the height it was measured at ---------- */

/*
 * The build makes the first group of a window live, and that group is laid out for real:
 * every other group's height is predicted from it. But the build never measures — the
 * measurement is the observer's — so the group the build made live has no height of its own
 * until somebody looks at it.
 *
 * The observer does look at it: it is in view, so it is visited. And the visit used to return
 * early, because the rows were already there. So the group never recorded its height, and
 * when the window widened and the group was released it fell back on the prediction: a group
 * of three rows and a band, predicted at 208 px, standing in for a group laid out at 1,000 px,
 * with not one row or band changed.
 *
 * The case below is that one: a window whose first group is live, a real height on it, a
 * visit, a wider window, the idle time, a rebuild — and the height the group reserves.
 */
{
  const h = buildHarness({ realPrediction: true });
  const s = h.sandbox;
  // The ledger's own query, so the pass that follows the calibration finds the groups the
  // build released. The fake DOM answers every query with an empty list, and a build whose
  // calibration pass finds nothing never sizes the groups it released.
  s.ledger.querySelectorAll = (selector) => {
    if (!/data-rows\s*=\s*"released"/.test(selector)) return [];
    return s.ledger.children.filter((c) => c.getAttribute('data-rows') === 'released');
  };
  const groups = [
    { turn: { index: 1 }, entries: entriesOf(3, 1, 'g0') },
    { turn: { index: 2 }, entries: entriesOf(2, 0, 'g1') }
  ];
  h.clock = 1000;
  rebuild(h, groups);
  // The first group is live, and it is really laid out at 1,000 px.
  const first = sectionOf(h, 0);
  first.getBoundingClientRect = () => ({ height: 1000, width: 900, top: 0, bottom: 1000 });
  // The observer visits it: it is in view, and the rows are already there.
  s.fillLedgerGroup(first);
  // The window widens — a group comes in above it, so it is no longer the first one — and
  // the reader walks away from it, so the idle time passes.
  const wider = [
    { turn: { index: 0 }, entries: entriesOf(2, 0, 'w0') },
    { turn: { index: 1 }, entries: entriesOf(3, 1, 'g0') },
    { turn: { index: 2 }, entries: entriesOf(2, 0, 'g1') }
  ];
  h.clock = 1000 + s.LEDGER_IDLE_MS + 1;
  rebuild(h, wider);
  assert('a group built live keeps its measured height when a wider window releases it',
    sectionOf(h, 1).style.minHeight === '1000px');
}

/* ---------- 3e. the cap holds between the rebuilds too ---------- */

/*
 * The bound is about what the reader is holding at this moment. The rebuild enforces it, and
 * so does the visit: a reader who walks through more groups than the cap allows between two
 * rebuilds would otherwise be holding all of them, and the promise the cap makes would hold
 * only right after a poll.
 *
 * The visits below are one after another, and each is within the idle timeout of the one
 * before it, so the idle rule is not what releases the groups — the cap is. And the groups
 * that are counted are the sections that really hold their rows, not the flags in the state.
 *
 * The second group is the one the cap releases, and it carries the height rule with it. It is
 * measured at 1,000 px with three rows in it; a late reply makes it four rows, and the rebuild
 * that brings the reply writes the group with the four rows in it. The rebuild does not
 * measure, so the group still carries the height it was measured at — 1,000 px for three rows —
 * while the height it really has is 1,036 px. When the cap takes it on the visit path, the
 * height it keeps has to be the height it has now: 1,036 px, the measured height and the row
 * that was added, priced at the calibrated row height. The visit path used to write the old
 * measurement back unchanged, so the group came up 36 px short of the content it was holding,
 * and the document under the reader came up short by that much until the next rebuild.
 */
{
  const h = buildHarness();
  const s = h.sandbox;
  const n = s.LEDGER_LIVE_GROUPS + 2;
  const groups = [];
  for (let i = 0; i < n; i += 1) {
    groups.push({ turn: { index: i + 1 }, entries: entriesOf(3, 0, 'g' + i) });
  }
  h.clock = 1000;
  rebuild(h, groups);
  // The reader is on the second group, and it is laid out for real at 1,000 px.
  const second = sectionOf(h, 1);
  second.getBoundingClientRect = () => ({ height: 1000, width: 900, top: 0, bottom: 1000 });
  s.fillLedgerGroup(second);
  h.clock += 10;
  s.fillLedgerGroup(sectionOf(h, 0));
  // A late reply: every group has a fourth row now, and the rebuild that brings it writes the
  // groups with the four rows in it.
  const grown = [];
  for (let i = 0; i < n; i += 1) {
    grown.push({ turn: { index: i + 1 }, entries: entriesOf(4, 0, 'g' + i) });
  }
  h.clock += 10;
  rebuild(h, grown);
  // The second group is laid out at the height it really has now.
  const secondGrown = sectionOf(h, 1);
  secondGrown.getBoundingClientRect = () => ({ height: 1036, width: 900, top: 0, bottom: 1036 });
  // The reader walks through the window, one group at a time.
  for (let i = 0; i < n; i += 1) {
    h.clock += 10;
    s.fillLedgerGroup(sectionOf(h, i));
  }
  const holding = s.ledger.children.filter((c) => {
    const list = c.querySelector('ul.row-list');
    return c.getAttribute('data-rows') === 'live' && !!list && list.children.length > 0;
  });
  assert('reader visits cannot increase the held row groups past the ceiling between rebuilds',
    holding.length <= s.LEDGER_LIVE_GROUPS);
  // The window's first group is where the reader arrives, and every other group's height is
  // predicted from it, so it holds its rows whatever the reader is doing — including after a
  // round of visits that fills more groups than the cap allows. A visit that held on to the
  // group the reader had just reached and nothing else would let this one go: the idle
  // timeout would take it, or the cap would reach for it as the oldest one there is, and the
  // group the heights are predicted from would lose its rows while the reader was on the page.
  const first = sectionOf(h, 0);
  assert('the window\'s first group keeps its rows after a round of visits',
    first.getAttribute('data-rows') === 'live'
    && first.querySelector('ul.row-list').children.length > 0);
  // And the group the cap released gives up its rows at once, and keeps the height it has now.
  const released = sectionOf(h, 1);
  assert('a group the cap released holds no rows',
    released.getAttribute('data-rows') === 'released'
    && released.querySelector('ul.row-list').children.length === 0);
  // The height is the number the group really has, not merely a non-empty string: 1,036 px,
  // the 1,000 px it was measured at and the row that was added, priced at the calibrated row
  // height. A shape check would pass on a height of 1 px, which is the opposite of what the
  // reader is owed.
  assert('a group the cap released keeps the height it has now',
    released.style.minHeight === '1036px');
}

/* ---------- 3f. the window's first group survives the idle timeout ---------- */

/*
 * The window's first group holds its rows whatever the reader is doing, and the visit path
 * has to hold it on to as well as the group the reader has just reached.
 *
 * The case: the reader is on the first group, the observer gives it a lease, and the reader is
 * away long enough for the idle timeout to pass. The reader comes back on the second group,
 * and that one visit is enough to take the first group's rows away — the idle timeout reaches
 * for it, because it is the oldest lease there is — and the group every height is predicted
 * from loses its rows while the reader is on the page.
 */
{
  const h = buildHarness();
  const s = h.sandbox;
  const groups = [
    { turn: { index: 1 }, entries: entriesOf(3, 0, 'g0') },
    { turn: { index: 2 }, entries: entriesOf(3, 0, 'g1') },
    { turn: { index: 3 }, entries: entriesOf(3, 0, 'g2') }
  ];
  h.clock = 1000;
  rebuild(h, groups);
  // The reader is on the first group, and the observer gives it a lease.
  s.fillLedgerGroup(sectionOf(h, 0));
  // The reader is away long enough for the idle timeout to pass, and comes back on the second
  // group. One visit is enough to release the first one.
  h.clock = 1000 + s.LEDGER_IDLE_MS;
  s.fillLedgerGroup(sectionOf(h, 1));
  const first = sectionOf(h, 0);
  assert('the window\'s first group keeps its rows when the reader comes back to another group',
    first.getAttribute('data-rows') === 'live'
    && first.querySelector('ul.row-list').children.length > 0);
}

/* ---------- 3g. the rebuild applies the bound too ---------- */

/*
 * The bound is about the groups that hold their rows, and the rebuild is one of the two
 * places that decides it.
 *
 * The fixture's rebuild() used to leave that step out — it called the build and nothing else —
 * so a build that stopped releasing the groups the reader had left was a build this file
 * could not see: the table came out with more groups holding their rows than the cap allows,
 * and every assertion in this file still passed.
 *
 * The case: the reader has been on six groups, which is the cap, and then the window widens —
 * a group comes in above — so the rebuild's first group is a new one. The rebuild counts it,
 * the count is one over the cap, and the oldest of the reader's groups goes. Without that step
 * the new group is simply added and the table holds seven groups' rows.
 */
{
  const h = buildHarness();
  const s = h.sandbox;
  const groups = [];
  for (let i = 0; i < s.LEDGER_LIVE_GROUPS; i += 1) {
    groups.push({ turn: { index: i + 1 }, entries: entriesOf(2, 0, 'g' + i) });
  }
  h.clock = 1000;
  rebuild(h, groups);
  // The reader walks through the window: six groups, which is the cap.
  for (let i = 0; i < s.LEDGER_LIVE_GROUPS; i += 1) {
    h.clock += 10;
    s.fillLedgerGroup(sectionOf(h, i));
  }
  // The window widens: a group comes in above, so the rebuild's first group is a new one.
  const wider = [{ turn: { index: 0 }, entries: entriesOf(2, 0, 'w0') }].concat(groups);
  h.clock += 10;
  rebuild(h, wider);
  const holding = s.ledger.children.filter((c) => {
    const list = c.querySelector('ul.row-list');
    return c.getAttribute('data-rows') === 'live' && !!list && list.children.length > 0;
  });
  assert('after a rebuild, the number of groups holding their rows is at most the cap',
    holding.length <= s.LEDGER_LIVE_GROUPS);
}

/* ---------- 3h. a tie the clock cannot break ---------- */

/*
 * The cap reaches for the oldest group, and when several groups share a millisecond the order
 * the cap sees is the order the groups were counted in. The groups the caller holds on to are
 * counted after the ones the reader has visited, so a tie cannot put them at the head of the
 * queue — and the group the reader has just reached is the last of them, so the cap cannot
 * reach for the group the reader is on.
 *
 * The case: the reader walks through the window without the clock moving, so every lease is
 * the same age, and the count goes one over the cap on the last visit. Counted before the
 * groups the reader has visited, the window's first group would be the head of that queue and
 * the cap would take it.
 */
{
  const h = buildHarness();
  const s = h.sandbox;
  const groups = [];
  for (let i = 0; i < s.LEDGER_LIVE_GROUPS + 1; i += 1) {
    groups.push({ turn: { index: i + 1 }, entries: entriesOf(2, 0, 'g' + i) });
  }
  h.clock = 1000;
  rebuild(h, groups);
  // The reader walks through the window without the clock moving: every lease is the same age.
  for (let i = 1; i < s.LEDGER_LIVE_GROUPS + 1; i += 1) {
    s.fillLedgerGroup(sectionOf(h, i));
  }
  const first = sectionOf(h, 0);
  assert('the window\'s first group keeps its rows when the clock cannot break the tie',
    first.getAttribute('data-rows') === 'live'
    && first.querySelector('ul.row-list').children.length > 0);
}

/* ---------- 4. the rows come back when the reader reaches the group ---------- */

{
  const h = harness();
  const s = h.sandbox;
  const section = makeEl('section');
  const list = makeEl('ul');
  list.classes.add('row-list');
  section.appendChild(list);
  section.setAttribute('data-rows', 'released');
  section.classList.add('is-released');
  section.style.minHeight = '3643px';

  // Three rows and a band: four items on screen — and the band is a band rather than a row,
  // so the two counts the height was measured at are different numbers.
  const entries = entriesOf(3, 1, 'r');
  s.ledgerContent.set(section, { key: 'g1', turn: { index: 1 }, entries, bands: 1 });
  s.fillLedgerGroup(section);

  assert('a group the reader reaches puts its rows back', list.children.length === 4);
  assert('a group that has its rows back says so', section.getAttribute('data-rows') === 'live');
  assert('a group that has its rows back drops the released state',
    section.classList.contains('is-released') === false);
  assert('a group that has its rows back gives its reserved height back',
    section.style.minHeight === '');
  assert('a group that has its rows back is remembered as live',
    s.ledgerState.get('g1').live === true);
  assert('the height a group was measured at records what it was holding',
    s.ledgerState.get('g1').heightRows === 3 && s.ledgerState.get('g1').heightBands === 1);
}

{
  const h = harness();
  const s = h.sandbox;
  const section = makeEl('section');
  const list = makeEl('ul');
  list.classes.add('row-list');
  list.appendChild(makeEl('li'));
  section.appendChild(list);
  section.setAttribute('data-rows', 'live');

  s.ledgerContent.set(section, { key: 'g2', turn: { index: 2 }, entries: entriesOf(4, 0, 'r'), bands: 0 });
  s.fillLedgerGroup(section);
  assert('a group that is already holding its rows is not filled a second time',
    list.children.length === 1);
}

{
  const h = harness();
  const s = h.sandbox;
  const section = makeEl('section');
  let threw = null;
  try { s.fillLedgerGroup(section); } catch (err) { threw = err; }
  assert('a section the ledger does not know about is left alone',
    threw === null && section.children.length === 0);
}

/* ---------- 5. the anchor is read out of the group the reader is on ---------- */

{
  const h = harness();
  const s = h.sandbox;

  const here = makeEl('section');
  const hereList = makeEl('ul');
  hereList.classes.add('row-list');
  here.appendChild(hereList);
  here.setAttribute('data-rows', 'released');
  here.classList.add('is-released');
  here.getBoundingClientRect = () => ({ height: 240, width: 900, top: 0, bottom: 240 });

  const below = makeEl('section');
  const belowList = makeEl('ul');
  belowList.classes.add('row-list');
  below.appendChild(belowList);
  below.setAttribute('data-rows', 'live');
  below.getBoundingClientRect = () => ({ height: 240, width: 900, top: 240, bottom: 480 });
  s.fillGroupRows(belowList, { key: 'b', turn: { index: 9 }, entries: entriesOf(2, 0, 'b') });

  s.ledgerContent.set(here, { key: 'h', turn: { index: 8 }, entries: entriesOf(2, 0, 'h'), bands: 0 });

  const sections = [here, below];
  const ledger = makeEl('div');
  ledger.querySelectorAll = (selector) => {
    if (selector === ':scope > section.turn-group') return sections;
    if (selector === '[data-row-id]') {
      const out = [];
      for (const sec of sections) {
        const list = sec.querySelector('ul.row-list');
        if (!list) continue;
        for (const item of list.children) {
          for (const node of item.children) {
            if (node.getAttribute('data-row-id') !== null) out.push(node);
          }
        }
      }
      return out;
    }
    return [];
  };
  s.dom = { ledger };

  const anchor = s.firstVisibleRow();
  assert('the group the reader is on is filled before the anchor is read out of it',
    hereList.children.length === 2);
  assert('the anchor comes from the group the reader is on, not from the next one down',
    !!anchor && String(anchor.id).startsWith('h'));
}

/* ---------- 6. the shipped build asks for exactly this ---------- */

const buildStepSrc = functionSource('buildStep') || '';
// The comments are stripped before the shape checks, so a comment that talks about the lease
// is not a lease write. A rule that only holds while nobody writes about it is not a rule.
const buildStepCode = buildStepSrc
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');
assert('the build asks for no rows for a group it is not holding',
  /fillGroupRows\(holds \? list : null, group\)/.test(buildStepSrc));
assert('the build does not write the reader-idle lease',
  !/lastSeen\s*=/.test(buildStepCode) && !/\.live\s*=/.test(buildStepCode));
// The measured height belongs to the observer, for the same reason the lease does: it is
// taken when the group is really laid out. A build that stamped one would be writing down a
// height it never measured, and the next rebuild would read its own guess back as one.
assert('the build does not write a measured height',
  !/\.height\s*=/.test(buildStepCode));
assert('a group the build is not holding is given a height to keep',
  /if \(!holds\) \{[\s\S]{0,400}?holdLedgerHeight\(section,/.test(buildStepSrc));
assert('a group the build is holding says so',
  /setAttribute\('data-rows', 'live'\)/.test(buildStepSrc));
assert('a group the build is not holding says so too',
  /setAttribute\('data-rows', 'released'\)/.test(buildStepSrc));

const renderSrc = functionSource('renderLedger') || '';
assert('the ledger drops what it knew about the groups it just emptied',
  /clear\(ledger\);/.test(renderSrc) && /ledgerContent\.clear\(\);/.test(renderSrc));
// The rebuild asks for the release before it writes the table. The behavioural half of this
// rule is the assertion about the number of groups holding their rows after a rebuild; this
// one is the call site, which no behavioural check can reach: renderLedger() is too big to
// run here, so the fixture calls the shipped release function itself.
assert('the rebuild releases the groups that have to give up their rows before it writes the table',
  /releaseStaleGroupsBeforeRebuild\(groups\);/.test(renderSrc));

const selectSrc = functionSource('selectSession') || '';
assert('the groups of the session being left are forgotten with it',
  /ledgerState\.clear\(\);/.test(selectSrc) && /ledgerContent\.clear\(\);/.test(selectSrc));

const styleEnd = html.indexOf('</style>');
const css = (styleEnd > 0 ? html.slice(0, styleEnd) : '').replace(/\/\*[\s\S]*?\*\//g, '');
assert('the released state is something the reader can see',
  /\.turn-group\.is-released/.test(css));
assert('the released state is turned on by the build, so the rule is not dead',
  /classList\.add\('is-released'\)/.test(buildStepSrc));
assert('the released state is turned off when the rows come back',
  /classList\.remove\('is-released'\)/.test(functionSource('fillLedgerGroup') || ''));

/* ---------- report ---------- */

if (failures.length) {
  console.error(`[ledger-lifecycle] ${pass} passed, ${failures.length} failed`);
  for (const f of failures) console.error('  FAIL  ' + f);
  process.exit(1);
}
// "0 failed" on success is what mutate-ledger-lifecycle.py reads to decide the baseline is green.
console.log(`[ledger-lifecycle] ${pass} passed, 0 failed`);
