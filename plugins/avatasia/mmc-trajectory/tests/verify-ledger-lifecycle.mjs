/**
 * The ledger keeps its rows for the groups the reader is on and gives the rest up — and the
 * promise that comes with giving them up is two-sided.
 *
 * The one side everybody can see: a group the reader is not on must not be holding its rows.
 * Measured on a real session of 47,937 records, the rows of 「显示全部」 are 438,986 nodes and
 * about 470 MB of the renderer's private memory, so "hold everything" is the whole cost.
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
  'fillLedgerGroup',
  'holdLedgerHeight',
  'fillGroupRows',
  'firstVisibleRow'
];

const fnSrc = LIFECYCLE_FNS.map((name) => functionSource(name));
const missing = LIFECYCLE_FNS.filter((_, i) => !fnSrc[i]);
if (missing.length) {
  console.error(`[ledger-lifecycle] 0 passed, ${missing.length} failed`);
  for (const m of missing) console.error('  FAIL  the shipped script has no ' + m + '()');
  process.exit(1);
}

// The two limits are declarations, not functions, so they are lifted on their own. They are
// numbers the shipped code reads, and the guard below uses the shipped values rather than
// numbers written here — a copy of the cap in this file would keep passing after the shipped
// one changed.
const idleDecl = html.match(/^[ \t]*var LEDGER_IDLE_MS = [^;]+;/m);
const capDecl = html.match(/^[ \t]*var LEDGER_LIVE_GROUPS = [^;]+;/m);
assert('the shipped script declares the idle timeout', !!idleDecl);
assert('the shipped script declares the cap on groups holding their rows', !!capDecl);
if (!idleDecl || !capDecl) {
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
    setAttribute(name, value) { el.attrs[name] = String(value); },
    getAttribute(name) { return name in el.attrs ? el.attrs[name] : null; },
    querySelector(selector) { return queryOne(el, selector); },
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
    el: (tag) => { const e = makeEl(tag); box.built.push(e); return e; },
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
    idleDecl[0] + '\n' + capDecl[0] + '\n' + fnSrc.join('\n'),
    sandbox
  );
  box.sandbox = sandbox;
  return box;
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

/* ---------- 2. a released group keeps the height it had ---------- */

{
  const h = harness();
  const s = h.sandbox;
  const section = makeEl('section');
  s.holdLedgerHeight(section, 3643);
  assert('a released group keeps the height it had', section.style.minHeight === '3643px');
}

{
  const h = harness();
  const s = h.sandbox;
  const section = makeEl('section');
  s.holdLedgerHeight(section, 0);
  assert('a group with no height to keep is not given one',
    section.style.minHeight === undefined);
}

/* ---------- 3. a group the reader left gives its rows up, and the count is bounded ---------- */

{
  const h = harness();
  const s = h.sandbox;
  s.ledgerState.set('a', { live: true, lastSeen: 1000, height: 0 });

  h.clock = 1000 + s.LEDGER_IDLE_MS - 1;
  s.releaseStaleGroups('somewhere-else');
  assert('a group the reader is still within reach of keeps its rows',
    s.ledgerState.get('a').live === true);

  h.clock = 1000 + s.LEDGER_IDLE_MS;
  s.releaseStaleGroups('somewhere-else');
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
  s.releaseStaleGroups('g' + (n - 1));
  const live = [...s.ledgerState.values()].filter((v) => v.live).length;
  assert('the number of groups holding their rows is bounded',
    live === s.LEDGER_LIVE_GROUPS);
  assert('the oldest groups are the ones that go when the bound is passed',
    s.ledgerState.get('g0').live === false
    && s.ledgerState.get('g1').live === false
    && s.ledgerState.get('g' + (n - 1)).live === true);
}

{
  const h = harness();
  const s = h.sandbox;
  assert('the first group of a window always holds its rows, because every height is predicted from it',
    s.ledgerHoldsRows('never-seen', true) === true);
  assert('a group nobody has been on does not hold its rows',
    s.ledgerHoldsRows('never-seen', false) === false);
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

  const entries = entriesOf(4, 0, 'r');
  s.ledgerContent.set(section, { key: 'g1', turn: { index: 1 }, entries, bands: 0 });
  s.fillLedgerGroup(section);

  assert('a group the reader reaches puts its rows back', list.children.length === 4);
  assert('a group that has its rows back says so', section.getAttribute('data-rows') === 'live');
  assert('a group that has its rows back drops the released state',
    section.classList.contains('is-released') === false);
  assert('a group that has its rows back gives its reserved height back',
    section.style.minHeight === '');
  assert('a group that has its rows back is remembered as live',
    s.ledgerState.get('g1').live === true);
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
assert('the build asks for no rows for a group it is not holding',
  /fillGroupRows\(holds \? list : null, group\)/.test(buildStepSrc));
assert('a group the build is not holding is given a height to keep',
  /if \(!holds\) \{[\s\S]{0,400}?holdLedgerHeight\(section,/.test(buildStepSrc));
assert('a group the build is holding says so',
  /setAttribute\('data-rows', 'live'\)/.test(buildStepSrc));
assert('a group the build is not holding says so too',
  /setAttribute\('data-rows', 'released'\)/.test(buildStepSrc));

const renderSrc = functionSource('renderLedger') || '';
assert('the ledger drops what it knew about the groups it just emptied',
  /clear\(ledger\);/.test(renderSrc) && /ledgerContent\.clear\(\);/.test(renderSrc));

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
