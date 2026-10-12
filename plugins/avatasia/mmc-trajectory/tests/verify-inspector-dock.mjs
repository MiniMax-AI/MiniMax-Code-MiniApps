/**
 * The inspector has three states on a narrow screen and only one of them is a scroll decision:
 *
 *   flow   — the panel is in the document; nothing is pinned and the handle is absent
 *   docked — the panel's bottom is pinned to the viewport bottom at half height, handle present
 *   full   — the reader pressed the handle; the cap comes off
 *
 * and it returns to `flow` at the end of the document, which is the state the reader needs in order
 * to reach the footer at all.
 *
 * The scroll decision is where this actually broke, twice, and both breakages look like working
 * code, which is why the rules below are shaped around them rather than around the feature:
 *
 *   1. `rect.bottom >= innerHeight` reads true both when the panel has been scrolled past and when
 *      it has not been reached yet, so the panel shrinks into half height in front of the reader.
 *      Only a bounded comparison separates the two, and the bound is the whole rule.
 *   2. A second reference was added to fix that — main.columns' bottom — on the theory that a
 *      never-sticky container sits above the viewport while the panel is pinned. The panel is a
 *      child of that container, so pinning the panel pins it too: the conjunction was false in
 *      every state and the panel never docked at all.
 *   3. `offsetTop` is an estimate on this page, because the ledger is virtualised. Measured 926,767
 *      against a real layout position near 934,100. A predicate built on it fires on scroll position
 *      instead of on the panel leaving.
 *
 * The transitions are guarded as three named exits with one literal each, rather than as one
 * boolean flipped in three places: a boolean makes the third state unnameable, and the third state
 * is the entire feature.
 *
 * mutate-inspector-dock.py breaks each rule in the shipped file and requires this guard to report
 * it by name, so nothing here can be decorative.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HTML = fileURLToPath(new URL('../miniapp/client/index.html', import.meta.url));
const html = readFileSync(HTML, 'utf8');

const styleMatch = /<style>([\s\S]*?)<\/style>/.exec(html);
if (!styleMatch) {
  console.log('FAIL: no <style> block in the client');
  process.exit(1);
}
const css = styleMatch[1].replace(/\/\*[\s\S]*?\*\//g, '');

// The client with its comments removed. Two of the rules below are about what the code *does*, and
// the reasoning for the mistakes they encode sits in comments immediately next to the code — the
// offsetTop alternative is named in the comment precisely so it is not re-added. Reading the raw
// text would let a correct explanation of a bug look like the bug still being there, which is the
// same way client-check's vh rule used to punish its own documentation.
//
// Line comments are stripped whole-line, and a `//` preceded by `:` is left alone, so a URL in a
// string survives.
const jsHtml = html
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/[^\n]*$/gm, '');

let pass = 0;
const failures = [];
function assert(name, cond) {
  if (cond) pass += 1;
  else failures.push(name);
}

/* ---------- CSS ---------- */

/** The declarations of `sel` across `text`, as a property -> last value map. */
function declsIn(text, sel) {
  const map = new Map();
  const re = /^[ \t]*([^{}@][^{}]*?)\{[^{}]*\}/gm;
  let m;
  while ((m = re.exec(text))) {
    const selectors = m[1].split(',').map((s) => s.trim());
    if (!selectors.includes(sel)) continue;
    for (const part of m[0].slice(m[0].indexOf('{') + 1, m[0].lastIndexOf('}')).split(';')) {
      const at = part.indexOf(':');
      if (at < 0) continue;
      map.set(part.slice(0, at).trim(), part.slice(at + 1).replace(/\s+/g, ' ').trim());
    }
  }
  return map;
}
function valueIn(text, sel, prop) {
  const d = declsIn(text, sel);
  return d.has(prop) ? d.get(prop) : null;
}
function varsRead(text) {
  const out = new Set();
  if (!text) return out;
  for (const m of text.matchAll(/var\(\s*(--[\w-]+)/g)) out.add(m[1]);
  return out;
}

/**
 * The body of the media query whose condition matches exactly. Returned as css with the at-rule and
 * its braces stripped, so the same rule readers work on it. Returns null when there is no such
 * query — which is itself a failure the caller has to report, not a reason to skip.
 *
 * All of them, not the first: two media queries can carry the same condition in one stylesheet
 * (1080px already appears twice — the `.columns` collapse and the dock rules), and a lookup that
 * stops at the first one silently measures the wrong block.
 */
function mediaBodies(condition) {
  const out = [];
  const needle = '@media ' + condition;
  let at = css.indexOf(needle);
  while (at >= 0) {
    const i = css.indexOf('{', at);
    let depth = 0;
    let end = -1;
    for (let j = i; j < css.length; j += 1) {
      if (css[j] === '{') depth += 1;
      else if (css[j] === '}') {
        depth -= 1;
        if (depth === 0) { end = j; break; }
      }
    }
    if (end < 0) break;
    out.push(css.slice(i + 1, end));
    at = css.indexOf(needle, end);
  }
  return out;
}

// The width at which .columns collapses to one column, read out of the stylesheet rather than
// repeated here: it is the other half of the invariant below, and two places naming it is how the
// two drift apart in the first place.
const columnsSingle = /@media\s*\(max-width:\s*(\d+)px\)\s*\{[\s\S]{0,600}?\.columns\s*\{\s*grid-template-columns:\s*(?:minmax\(0,\s*1fr\)|1fr)/.exec(css);
assert('the narrow layout collapses .columns to one column', !!columnsSingle);

// Which media query actually carries the inspector rules, read rather than assumed: if the rules
// migrate to a different query the guard below still measures the one that is really in force.
let dockCondition = null;
let narrow = null;
for (const m of css.matchAll(/@media\s*\(max-width:\s*(\d+)px\)/g)) {
  for (const body of mediaBodies(`(max-width: ${m[1]}px)`)) {
    if (/#inspector-panel\s*\{/.test(body)) { dockCondition = Number(m[1]); narrow = body; break; }
  }
  if (dockCondition !== null) break;
}
assert('the inspector rules live in a narrow-screen media query', dockCondition !== null);
// The feature is scoped to a media query, and the scope has to *be* the single-column breakpoint
// rather than sit somewhere inside it. Two failure directions, and the narrow one is the one that
// shipped:
//
//   narrower than the collapse (the defect that shipped: 767 against a collapse at 1080) leaves a
//     band where the panel is below the ledger and nothing pins it — both the cause and the
//     remedy are missing at once, which reads as "the feature is not here" rather than "it is
//     broken". It went unnoticed because the whole feature was only ever measured at 420px.
//   wider than the collapse docks a panel that is still its own column beside the ledger, where a
//     pinned bottom edge fights the sticky band it is supposed to sit under.
//
// Both bounds are asserted separately so the failure names which side drifted. An earlier version
// of this file asserted only the upper bound, which is exactly why the defect passed review here.
assert('docking covers every width at which the inspector sits below the ledger',
  dockCondition !== null && !!columnsSingle && dockCondition >= Number(columnsSingle[1]));
assert('docking never engages while the inspector is still beside the ledger',
  dockCondition !== null && !!columnsSingle && dockCondition <= Number(columnsSingle[1]));

// The same width is written twice — once in the stylesheet, once in the query the script matches
// against — and the two drive different halves of the same decision. If they drift, the script
// keeps deciding the panel should dock at widths where nothing pins it (and vice versa), and every
// other rule here still passes because each of them only looks at one of the two.
const queryConst = /var INSPECTOR_DOCK_QUERY = '\(max-width:\s*(\d+)px\)'/.exec(jsHtml);
assert('the script and the stylesheet dock at the same width',
  !!queryConst && dockCondition !== null && Number(queryConst[1]) === dockCondition);

const dockRule = narrow ? valueIn(narrow, '#inspector-panel', 'position') : null;
const panelBottom = narrow ? valueIn(narrow, '#inspector-panel', 'bottom') : null;
const dockedMax = narrow ? valueIn(narrow, '#inspector-panel.is-inspector-docked', 'max-height') : null;
const dockedOverflow = narrow ? valueIn(narrow, '#inspector-panel.is-inspector-docked', 'overflow-y') : null;
const fullMax = narrow ? valueIn(narrow, '#inspector-panel.is-inspector-full', 'max-height') : null;

assert('on a narrow screen the panel sticks to the bottom of the viewport',
  dockRule === 'sticky' && panelBottom === '0');
assert('half height is a cap on the panel, not a cap on its content',
  dockedMax !== null && varsRead(dockedMax).has('--inspector-dock-h'));
assert('the half-height panel scrolls its own content', dockedOverflow === 'auto');
assert('fully expanded is capped by a different number than half height',
  fullMax !== null && varsRead(fullMax).has('--inspector-full-h')
  && (!dockedMax || fullMax !== dockedMax));

// The half-height number has to exist, or the cap above resolves to nothing and the panel is only
// half height by accident.
const dockVar = /:root\s*\{([^{}]*)\}/.exec(css);
const dockH = dockVar ? /--inspector-dock-h\s*:\s*([^;]+)/.exec(dockVar[1]) : null;
assert('the two-fifths fallback is declared, not left to fall back', !!dockH);
assert('the docked height is a share of the viewport, and the share is written down',
  !!dockH && /^(\d+(?:\.\d+)?)vh$/.test(dockH[1].trim()));

// A sticky strip has to paint over what scrolls under it: ledger rows are background: transparent,
// so a pinned panel that does not cover them lets them show through.
const dockedBg = narrow ? valueIn(narrow, '#inspector-panel.is-inspector-docked', 'background') : null;
assert('the docked panel paints a background over the rows under it',
  !!dockedBg && dockedBg !== 'transparent' && !dockedBg.startsWith('rgba'));

/* ---------- markup ---------- */

const panelTag = /<section([^>]*\bid="inspector-panel"[^>]*)>/.exec(html);
const toggleTag = /<button([^>]*\bid="inspector-toggle"[^>]*)>/.exec(html);
const panelClass = panelTag ? /class="([^"]*)"/.exec(panelTag[1]) : null;
const toggleClass = toggleTag ? /class="([^"]*)"/.exec(toggleTag[1]) : null;

assert('the inspector panel ships the id the script looks it up by', !!panelTag);
assert('the handle ships inside the panel head, as one of the existing section toggles',
  !!toggleClass && toggleClass[1].split(/\s+/).includes('section-toggle'));
assert('the handle ships hidden, because in flow there is nothing to expand',
  !!toggleTag && /\shidden(\s|=|$)/.test(toggleTag[1]));
assert('the handle names the action it performs, for both directions of the cycle',
  !!toggleTag && /aria-label="完全展开检视"/.test(toggleTag[1]));

// A panel that is not a sticky candidate cannot be docked: the rules above are all id-based, so a
// missing class would leave them matching nothing while still reading as present.
assert('the panel is a .panel, the same block every other section uses',
  !!panelClass && panelClass[1].split(/\s+/).includes('panel'));

/* ---------- the three states ---------- */

function functionSource(name) {
  const at = jsHtml.indexOf('function ' + name + '(');
  if (at < 0) return null;
  let i = jsHtml.indexOf('{', at);
  let depth = 0;
  for (let j = i; j < jsHtml.length; j += 1) {
    if (jsHtml[j] === '{') depth += 1;
    else if (jsHtml[j] === '}') {
      depth -= 1;
      if (depth === 0) return jsHtml.slice(at, j + 1);
    }
  }
  return null;
}

/**
 * `src` with every nested `function (…) { … }` block removed, by brace counting.
 *
 * Needed because a call made by an enclosing function and the same call made inside an event handler
 * it registers read identically to a regex over the whole body: wire() calls applyInspectorDock()
 * once for itself and once more inside the handle's click handler, so asserting "wire calls it"
 * passes whether or not the top-level call is still there.
 */
function withoutNestedFunctions(src) {
  let out = src;
  for (;;) {
    const m = /function\s*(\([^)]*\))?\s*\{/.exec(out);
    if (!m) return out;
    let end = out.length;
    let depth = 0;
    for (let j = m.index + m[0].length - 1; j < out.length; j += 1) {
      if (out[j] === '{') depth += 1;
      else if (out[j] === '}') {
        depth -= 1;
        if (depth === 0) { end = j + 1; break; }
      }
    }
    out = out.slice(0, m.index) + out.slice(end);
  }
}

const stateDecl = /inspectorDock\s*:\s*'([^']+)'/.exec(jsHtml);
assert('the panel starts in the document, not pinned', !!stateDecl && stateDecl[1] === 'flow');

// Three named exits, one literal each. A version that toggles a boolean cannot express the third
// state, so this is asserted as three separate literals rather than as "three states exist".
const dockFn = functionSource('dockInspector');
const resetFn = functionSource('resetInspectorDock');
const applyFn = functionSource('applyInspectorDock');
const updateFn = functionSource('updateInspectorDock');
const scheduleFn = functionSource('scheduleInspectorDock');

assert('one exit pins the panel', !!dockFn && /state\.inspectorDock\s*=\s*'docked'/.test(dockFn));
assert('one exit puts the panel back in the document', !!resetFn && /state\.inspectorDock\s*=\s*'flow'/.test(resetFn));
assert('both exits repaint the panel before returning', !!dockFn && !!resetFn
  && dockFn.includes('applyInspectorDock()') && resetFn.includes('applyInspectorDock()'));

// Every write to the field, listed. R5 is "one writer per state field"; the honest form of that for a
// three-state field is a closed set of the places allowed to write it, so a sixth writer added
// somewhere unrelated fails here instead of quietly becoming a fourth state.
//
// The set grew from three to five, and the count alone would not say whether that was justified —
// so each writer is named, with the state it is allowed to write. Two of them are new: losing the
// selection has to take the panel out of the dock, and a drag settles it into the docked state
// rather than leaving it expanded.
//
// `(?!=)` on the assignment is not decoration: without it the `!==` comparisons read as writes too,
// and the count becomes a statement about how often the field is compared rather than how often it
// is changed.
const writes = [...jsHtml.matchAll(/state\.inspectorDock\s*=(?!=)\s*([^;\n]+)/g)].map((m) => m[1].trim());
assert('the field names all three states, not a boolean',
  ['flow', 'docked', 'full'].every((s) => jsHtml.includes(`'${s}'`)));
assert('nothing writes the dock state from outside the five declared exits',
  writes.length === 5
  && writes.filter((w) => w === "'docked'").length === 2
  && writes.filter((w) => w === "'flow'").length === 2
  && writes.filter((w) => w.includes("=== 'full'")).length === 1);
assert('the declared writers are the ones that exist, and each writes what it is allowed to',
  /state\.inspectorDock\s*=\s*'docked'/.test(dockFn)
  && /state\.inspectorDock\s*=\s*'flow'/.test(resetFn)
  && /state\.inspectorDock\s*=\s*'flow'/.test(applyFn)
  && /state\.inspectorDock\s*=\s*'docked'/.test(functionSource('onInspectorResizeMove')));

/* ---------- the handle contract ---------- */

assert('the handle is hidden unless the panel is pinned',
  !!applyFn && /toggle\.hidden\s*=\s*!narrow\s*\|\|\s*!docked/.test(applyFn));
// Read through the derived variable, not through the presence of the word: applyInspectorDock
// mentions 'full' in three other places (the class toggle and both label branches), so an assertion
// that only looks for the literal is satisfied by a handle that reports a hard-coded "true".
assert('the handle reports which of the two pinned states it is in',
  !!applyFn
  && /var\s+expanded\s*=\s*state\.inspectorDock\s*===\s*'full'/.test(applyFn)
  && /aria-expanded',\s*expanded\s*\?/.test(applyFn));
assert('the two pinned states are named by one rule, so the labels cannot disagree',
  !!applyFn && /收起到半高/.test(applyFn) && /完全展开检视/.test(applyFn));

// The fully expanded height is measured, not derived from vh: this page runs in a host iframe where
// 100vh is not the reader's height, which is the reason client-check bans it.
// The expanded height is measured, not derived from vh: this page runs in a host iframe where
// 100vh is not the reader's height, which is the reason client-check bans it.
//
// Asserted as the expression, not as the presence of the four names. Reading --sticky-band-h and
// window.innerHeight somewhere in the function is satisfied by a version that computes the ceiling
// from neither of them — the mutation replaces the arithmetic with a constant and leaves all four
// tokens in place, and a token-presence check calls that a pass.
assert('the expanded height is measured from the window and the pinned offsets',
  !!applyFn
  && /var\s+panelMax\s*=\s*Math\.max\(\s*\w+\s*,\s*Math\.round\(\s*window\.innerHeight\s*-\s*band\s*-\s*overview\s*-\s*ledgerReserve\s*\)\s*\)/.test(applyFn)
  && /--sticky-band-h/.test(applyFn) && /--sticky-overview-h/.test(applyFn));

/* ---------- the ledger keeps its share of the window ----------
 *
 * chli's words: 「全高把轮次的表格给覆盖了，建议表格至少留整个页面高度的1/4」. Measured before
 * the fix at 900 CSS px wide: the expanded panel ran from y=135 to the bottom of a 900px window,
 * and not one ledger row was visible.
 *
 * One rule, two ceilings. The expanded cap and the drag clamp are the two ways the panel can grow,
 * so bounding only one of them leaves the other able to do exactly what the rule forbids — and two
 * copies of the number is how they would drift apart. The guard therefore checks that both read the
 * same variable rather than that both are bounded.
 */
assert('the ledger keeps a quarter of the window',
  !!applyFn && /window\.innerHeight\s*\*\s*INSPECTOR_LEDGER_SHARE/.test(applyFn)
  && /var\s+INSPECTOR_LEDGER_SHARE\s*=\s*0\.25/.test(jsHtml));
assert('the ledger share is subtracted from the height the panel may take',
  !!applyFn && /-\s*ledgerReserve\s*\)\s*\)/.test(applyFn));
// Both ceilings, one number. A drag that could exceed the expanded cap is a panel that covers the
// rows — the defect — reached by a different door.
assert('expanding and dragging are bounded by the same ceiling',
  !!applyFn && /Math\.min\(\s*Math\.max\(\s*Math\.round\(dockH\)\s*,\s*INSPECTOR_MIN_DOCK_H\s*\)\s*,\s*panelMax\s*\)/.test(applyFn)
  && /setProperty\(\s*'--inspector-full-h'\s*,\s*panelMax\s*\+\s*'px'\s*\)/.test(applyFn));
// flow has no cap at all, so 「完全显示」 is the end of the document and only the end of it.
const flowRule = narrow ? valueIn(narrow, '#inspector-panel.is-inspector-full', 'max-height') : null;
assert('no cap applies while the panel is in the document',
  flowRule !== null && !/^#inspector-panel\s*\{[^}]*max-height/s.test(narrow || ''));
assert('the expanded height is written in pixels',
  !!applyFn && /setProperty\(\s*'--inspector-full-h'\s*,\s*[\w+ ]+\+\s*'px'\s*\)/.test(applyFn));

/* ---------- the scroll decision ---------- */

// The predicate, and specifically that it is bounded. A loose comparison against the viewport edge
// passes this test's shape and fails in the browser.
assert('the panel counts as pinned only when its bottom equals the viewport bottom',
  !!updateFn && /Math\.abs\([\w.]+\.bottom\s*-\s*window\.innerHeight\)\s*<=\s*1/.test(updateFn));
assert('no second reference is consulted: the panel is a child of anything it would be compared to',
  !!updateFn && !/dom\.columns/.test(updateFn) && !/querySelector\(\s*'main\.columns'\s*\)/.test(jsHtml));
assert('the decision does not read the panel\'s position in the document',
  !!updateFn && !/offsetTop/.test(updateFn));
assert('scrolling away pins the panel and scrolling back unpins it',
  !!updateFn && /if\s*\(\s*pinned\s*\)\s*dockInspector\(\)/.test(updateFn)
  && /else if\s*\(\s*state\.inspectorDock\s*!==\s*'flow'\s*\)\s*resetInspectorDock\(\)/.test(updateFn));

// Widening the window past the breakpoint takes the panel out of the narrow rules; without this the
// panel would stay capped and half height in a layout that has no docked state at all.
// Scoped to the early-return clause with `[^}]*`, because the function has a second
// resetInspectorDock() call below it and a lazy `[\s\S]*?` would be satisfied by that one — which
// is precisely the mutation that removes this one.
assert('leaving the narrow layout puts the panel back in the document',
  !!updateFn && /matchMedia\(\s*INSPECTOR_DOCK_QUERY\s*\)\.matches\s*\)\s*\{[^}]*resetInspectorDock\(\)[^}]*return;/.test(updateFn));

// The ledger re-batches as it scrolls, so this fires many times a frame.
assert('the scroll decision coalesces into one frame',
  !!scheduleFn && /requestAnimationFrame/.test(scheduleFn) && /stickyFrame|inspectorDockFrame/.test(scheduleFn));

/* ---------- wiring ---------- */

const scrollRegs = [...jsHtml.matchAll(/window\.addEventListener\(\s*'scroll'\s*,\s*(\w+)/g)].map((m) => m[1]);
const resizeRegs = [...jsHtml.matchAll(/window\.addEventListener\(\s*'resize'\s*,\s*(\w+)/g)].map((m) => m[1]);

// Resolved through the registration, not by name: under a first-match rule, deleting the scroll
// registration is quietly satisfied by any other handler that happens to reach the same code.
const reachesDock = scrollRegs.filter((n) => {
  const src = functionSource(n);
  return src && /updateInspectorDock\(\)/.test(src);
});
assert('scrolling decides the dock state', reachesDock.length > 0);
assert('the scroll listener is passive, because nothing here scrolls the page from inside the handler',
  /window\.addEventListener\(\s*'scroll'\s*,\s*scheduleInspectorDock\s*,\s*\{\s*passive:\s*true\s*\}\s*\)/.test(jsHtml));

// A resize has to re-decide for two reasons: the viewport bottom moved under a pinned panel, and the
// media query itself can stop matching.
assert('a resize re-decides the dock state',
  resizeRegs.filter((n) => { const src = functionSource(n); return src && /updateInspectorDock\(\)/.test(src); }).length > 0);

// The initial decision, so a page loaded scrolled into the middle of a ledger is correct before the
// reader moves anything.
const wireFn = functionSource('wire');
assert('the dock state is decided once at wire time',
  !!wireFn && /^\s*applyInspectorDock\(\);/m.test(withoutNestedFunctions(wireFn)));

// Pressing the handle has to repaint: the class and the height are both written there, and a click
// that only changed the field would leave the panel looking exactly as it did.
const clickReg = /dom\.inspectorToggle\.addEventListener\(\s*'click'\s*,\s*function\s*\(\s*\)\s*\{([\s\S]*?)\n\s*\}\);/.exec(jsHtml);
assert('pressing the handle moves between the two pinned states and repaints',
  !!clickReg && /'full'\s*\?\s*'docked'\s*:\s*'full'/.test(clickReg[1])
  && clickReg[1].includes('applyInspectorDock()'));

/* ---------- visibility: the panel is the selection ----------
 *
 * A panel that renders an empty shell when nothing is selected costs the reader a screen's worth of
 * scrolling to reach the footer, and there is nothing in it to read. So visibility is the selection
 * — read off the field that already holds it.
 *
 * The thing worth guarding is that there is *no second source*: a `panelVisible` flag beside the
 * selection is the obvious way to write this, and it can disagree with the selection with nothing
 * noticing, because every other rule here looks at classes and numbers, not at flags.
 */
const renderFn = functionSource('renderInspector');
assert('the panel is on the page only while a record is selected',
  !!applyFn && /hasSelection\s*=\s*state\.selectedId\s*!==\s*null/.test(applyFn)
  && /dom\.inspectorPanel\.hidden\s*=\s*!hasSelection/.test(applyFn));
assert('visibility is derived from the selection field, not from a second flag',
  !jsHtml.includes('inspectorVisible') && !jsHtml.includes('panelVisible'));
// One exit. renderInspector() is where every selection change lands — selectRecord(),
// revealSelection(), the generation picker and each poll — so deciding anywhere else is a second
// place to keep in sync. Checked at the top of the function, before the empty branch returns.
assert('one exit re-decides the panel\'s visibility',
  !!renderFn && /applyInspectorDock\(\);/.test(renderFn)
  && renderFn.indexOf('applyInspectorDock();') < renderFn.indexOf('if (!entry)'));
assert('losing the selection takes the panel back out of the dock',
  !!applyFn && /!hasSelection[\s\S]*?state\.inspectorDock\s*=\s*'flow'/.test(applyFn));

/* ---------- the docked height: two fifths of the window, and the reader can move it ---------- */

// chli: 「检视的中间高度改为2/5」. The share is a named constant rather than a bare `/ 4` so that the
// two places that need it — the height the panel is given, and the height a drag starts from — read
// the same number instead of each carrying its own copy of the arithmetic.
assert('the default docked height is two fifths of the measured window',
  /var\s+INSPECTOR_DOCK_SHARE\s*=\s*0\.4\s*;/.test(jsHtml)
  && /function\s+inspectorDefaultDockHeight\s*\(\s*\)\s*\{\s*return\s+Math\.round\(\s*window\.innerHeight\s*\*\s*INSPECTOR_DOCK_SHARE\s*\)/.test(jsHtml));
// The failure this exists to prevent: `/ 4` was written twice, so changing the share meant finding
// both copies, and changing one of them would have given the panel a height the drag then refused
// to start from. Asserting that neither caller computes the share itself is what keeps them one
// writer rather than two that happen to agree.
assert('the default docked height is computed once and both readers call it',
  !!functionSource('inspectorDefaultDockHeight')
  && !!applyFn && /dockH\s*=\s*inspectorDefaultDockHeight\(\s*\)/.test(applyFn)
  && !!functionSource('inspectorDockHeightNow')
  && /:\s*inspectorDefaultDockHeight\(\s*\)/.test(functionSource('inspectorDockHeightNow'))
  && !/window\.innerHeight\s*\/\s*4/.test(jsHtml));
// The stylesheet fallback and the measured default are the same promise written twice, so a guard
// holds them together rather than trusting a reader to keep 40 and 0.4 in step.
assert('the stylesheet fallback agrees with the measured share',
  /--inspector-dock-h:\s*40vh\s*;/.test(html)
  && /INSPECTOR_DOCK_SHARE\s*=\s*0\.4/.test(jsHtml));
assert('the docked height is written in pixels, like every other offset here',
  !!applyFn && /setProperty\(\s*'--inspector-dock-h'\s*,\s*[\w+ ]+\+\s*'px'\s*\)/.test(applyFn));
// A drag that could exceed the pinned strips, or shrink past the panel head, hands the reader a
// panel they cannot use and a handle they cannot see.
assert('the docked height is clamped at both ends',
  !!applyFn && /INSPECTOR_MIN_DOCK_H/.test(applyFn) && /\bpanelMax\b/.test(applyFn)
  && /Math\.min\(\s*Math\.max\(/.test(applyFn));
// The reader's dragged height has to outlive the drag. Reading the anchor height instead of
// accumulating a running total also keeps a long drag from rounding its way off.
assert('a drag is measured from the height the panel had, not accumulated',
  !!functionSource('onInspectorResizeMove')
  && /anchorH\s*\+\s*\(\s*inspectorResizeDrag\.anchorClientY\s*-\s*event\.clientY\s*\)/.test(jsHtml));
// Only the pointer that started the drag may drive it. Scoped to the move handler, not the file:
// the same line also appears in the up handler, so a whole-file search is satisfied by a move
// handler that dropped the check entirely — which is what the mutation does.
assert('a drag is driven only by the pointer that started it',
  !!functionSource('onInspectorResizeMove')
  && /inspectorResizeDrag\.pointerId\s*!==\s*event\.pointerId/.test(functionSource('onInspectorResizeMove')));
assert('a drag settles the panel into the docked state rather than leaving it expanded',
  !!functionSource('onInspectorResizeMove')
  && /state\.inspectorDock\s*=\s*'docked'/.test(functionSource('onInspectorResizeMove')));
assert('the dragged height is kept in its own field, so it survives leaving the dock',
  /inspectorDockH\s*:\s*null/.test(jsHtml) && /state\.inspectorDockH\s*=\s*next/.test(jsHtml));

/* ---------- the grip ---------- */

const gripTag = /<div([^>]*\bid="inspector-resize"[^>]*)>/.exec(html);
assert('the grip ships with the panel', !!gripTag);
assert('the grip is a separator, so it is announced as one and not as a button',
  !!gripTag && /role="separator"/.test(gripTag[1]) && /aria-orientation="horizontal"/.test(gripTag[1]));
const gripRule = narrow ? valueIn(narrow, '#inspector-panel .inspector-resize', 'touch-action') : null;
// Without this the drag is a page scroll on touch, and the feature is unavailable on the devices
// where a narrow layout actually is a phone rather than a small window.
assert('a vertical drag on the grip resizes instead of scrolling the page', gripRule === 'none');
assert('the grip is on the edge that moves when the panel is pinned to the bottom',
  narrow ? valueIn(narrow, '#inspector-panel .inspector-resize', 'top') === '-7px' : false);
assert('the grip is only offered while the panel is pinned',
  !!applyFn && /dom\.inspectorResize\.hidden\s*=\s*!\(\s*narrow\s*&&\s*docked\s*\)/.test(applyFn));
// …and 「pinned」 has to mean both pinned states, not just the default one, or the grip disappears
// in exactly the state the reader most wants to make taller.
assert('pinned means both docked and expanded, so the grip survives expanding',
  !!applyFn && /var\s+docked\s*=\s*state\.inspectorDock\s*!==\s*'flow'/.test(applyFn));

/* ---------- D27: the grip had every property right and was still invisible ---------- */
//
// On 2026-10-13 chli reported 「刚才说的支持resize，没做」 and he was right. The grip had shipped
// with D24 carrying a correct top, a correct cursor, a correct touch-action, four attached pointer
// listeners and a `hidden` attribute the script was setting correctly — and it had never rendered
// once. `display: none` on the base rule outranks the `hidden` attribute, and nothing in the file
// put it back, so the strip held a 0x0 box and sat outside the hit tree entirely.
//
// What every existing assertion had in common is that each asked "is this property present in this
// rule". None asked "is there a rule that undoes the one keeping it invisible". So the guards below
// do not check the grip's geometry again — they check that the switch is wired end to end.

// The base rule keeps the default off. This half is not decoration: it is what makes the grip
// safe before the script has run, and it is why the second half has to exist.
assert('the grip is off by default in CSS, not by waiting for the script',
  narrow ? valueIn(narrow, '#inspector-panel .inspector-resize', 'display') === 'none' : false);
// This is the assertion that would have caught it. The base rule's `display: none` is final unless
// something contradicts it, and this is the only thing that does.
assert('a rule exists that can turn the grip back on',
  narrow ? valueIn(narrow, '#inspector-panel .inspector-resize:not([hidden])', 'display') === 'block' : false);
// …and the contradiction has to be reachable by the one switch that governs visibility, so
// enumerate every `display` that can land on the grip and require there to be exactly the pair
// above. A third rule is the shape this bug came in through, and it would hide the grip again.
const gripDisplayRules = [];
{
  const re = /^[ \t]*([^{}@][^{}]*?)\{[^{}]*\}/gm;
  let m;
  while ((m = re.exec(narrow || ''))) {
    const sels = m[1].split(',').map((s) => s.trim());
    if (!sels.some((s) => s.includes('.inspector-resize'))) continue;
    const dm = /^[ \t]*display\s*:\s*([^;]+)/m
      .exec(m[0].slice(m[0].indexOf('{') + 1, m[0].lastIndexOf('}')));
    if (dm) gripDisplayRules.push({ sels: sels.join(' , '), display: dm[1].replace(/\s+/g, ' ').trim() });
  }
}
assert('the grip has exactly one switch: off by default, on when not hidden',
  gripDisplayRules.length === 2
  && gripDisplayRules.some((r) => !r.sels.includes(':not([hidden])') && r.display === 'none')
  && gripDisplayRules.some((r) => r.sels.includes(':not([hidden])') && r.display === 'block'),
  'grip display rules: ' + JSON.stringify(gripDisplayRules));
// The two halves have to be the same switch, and both halves have to be here for this to mean
// anything: the script writes `hidden` exactly once, and the stylesheet's way back on is keyed on
// that same attribute. Checked against the mutation that swaps the CSS selector for a class nothing
// writes — the rule still exists, still reads `display: block`, and the grip is still invisible.
assert('the grip is shown by removing the very attribute that hides it',
  !!applyFn && /dom\.inspectorResize\.hidden\s*=/.test(applyFn)
  && (jsHtml.match(/dom\.inspectorResize\.hidden\s*=/g) || []).length === 1
  && narrow ? valueIn(narrow, '#inspector-panel .inspector-resize:not([hidden])', 'display') === 'block' : false);

for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
  assert('the grip listens for ' + ev,
    new RegExp(`dom\\.inspectorResize\\.addEventListener\\(\\s*'${ev}'\\s*,\\s*onInspectorResize\\w+\\s*\\)`).test(jsHtml));
}
// A drag that ends any other way would leave the drag object alive, and every later pointermove
// would then resize a panel nobody is touching.
assert('a cancelled drag is released like a finished one',
  /dom\.inspectorResize\.addEventListener\(\s*'pointercancel'\s*,\s*onInspectorResizeUp\s*\)/.test(jsHtml));

// chli's question: 「窗口的高度和 检视的完整高度, 取最大还是最小?」 Answer: the smaller one — and
// it already is, because both pinned states cap with `max-height` rather than setting `height`, so
// what the reader sees is min(content, cap).
//
// It is worth stating rather than relying on: the branch where the content is the smaller number
// cannot fire today (the shortest record measured 752px of content against a 400px cap — it was 250px
// while the default was a quarter, and the share moved in D28 without closing the gap — because
// the summary tab always renders its metadata table). So there is no measurement to protect — what
// can break is the *mechanism*, by someone writing `height` instead of `max-height`, and a `height`
// looks right in review and puts a blank band inside a short panel with every other rule still
// green. Hence the negative half of this rule, which is the half that does the work.
// The base rule is deliberately NOT in the first list: with no state class the panel is in the
// document and has no cap at all, which is the one place where 「完全显示」 means uncapped. Adding
// a cap there would put the cap back on the state chli asked to be the only uncapped one.
const cappedSels = ['#inspector-panel.is-inspector-docked', '#inspector-panel.is-inspector-full'];
const allPanelSels = ['#inspector-panel', ...cappedSels];
assert('both pinned states cap the panel rather than fixing its height',
  cappedSels.every((s) => narrow && valueIn(narrow, s, 'max-height') !== null)
  && valueIn(narrow || '', '#inspector-panel', 'max-height') === null);
assert('nothing forces the panel taller than its own content',
  !allPanelSels.some((s) => narrow && ['height', 'min-height'].some((p) => valueIn(narrow, s, p) !== null))
  && !/#[^{]*inspector-panel[^{]*\{[^{}]*\bmin-height\s*:/s.test(narrow || ''));
// D26's original anchor was the bare `/ 4` in applyInspectorDock(). D28 moved that arithmetic into
// inspectorDefaultDockHeight(), so the anchor moved with it — the assertion is repointed, not
// weakened: it still fails if the cap stops being derived from the measured window, and the px
// half is unchanged. Overlapping the 「two fifths」 guard is the cheap direction to err in.
assert('the cap is a ceiling, not a target',
  !!functionSource('inspectorDefaultDockHeight')
  && /Math\.round\(\s*window\.innerHeight\s*\*\s*INSPECTOR_DOCK_SHARE\s*\)/.test(functionSource('inspectorDefaultDockHeight'))
  && /setProperty\(\s*'--inspector-dock-h'\s*,\s*[\w+ ]+\+\s*'px'\s*\)/.test(applyFn));

console.log('[inspector-dock] ' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('[inspector-dock] OK');