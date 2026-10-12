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
 */
function mediaBody(condition) {
  const at = css.indexOf('@media ' + condition);
  if (at < 0) return null;
  let i = css.indexOf('{', at);
  let depth = 0;
  for (let j = i; j < css.length; j += 1) {
    if (css[j] === '{') depth += 1;
    else if (css[j] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(i + 1, j);
    }
  }
  return null;
}

// The feature is scoped to the narrow media query, and that scope has to sit at or *below* the
// width at which .columns collapses to one column — not at the same width. Collapsing happens at
// 1080px; docking at 767px is narrower on purpose, because between those two widths the inspector
// is a second column and a pinned panel would fight the band it is meant to sit under. The two
// numbers are read out of the stylesheet rather than repeated here: a docking query *wider* than the
// collapse is the defect, and asserting equality would have hidden it.
const columnsSingle = /@media\s*\(max-width:\s*(\d+)px\)\s*\{[\s\S]{0,600}?\.columns\s*\{\s*grid-template-columns:\s*(?:minmax\(0,\s*1fr\)|1fr)/.exec(css);
assert('the narrow layout collapses .columns to one column', !!columnsSingle);

// Which media query actually carries the inspector rules, read rather than assumed: if the rules
// migrate to a different query the guard below still measures the one that is really in force.
let dockCondition = null;
for (const m of css.matchAll(/@media\s*\(max-width:\s*(\d+)px\)/g)) {
  const body = mediaBody(`(max-width: ${m[1]}px)`);
  if (body && /#inspector-panel\s*\{/.test(body)) { dockCondition = Number(m[1]); break; }
}
assert('the inspector rules live in a narrow-screen media query', dockCondition !== null);
assert('docking only starts once .columns is a single column',
  dockCondition !== null && columnsSingle && dockCondition <= Number(columnsSingle[1]));

const narrow = dockCondition !== null ? mediaBody(`(max-width: ${dockCondition}px)`) : null;

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
assert('the half-height number is declared, not left to fall back', !!dockH);
assert('half height is a share of the viewport, and the share is written down',
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
// three-state field is a closed set of the places allowed to write it, so a fourth writer added
// somewhere unrelated fails here instead of quietly becoming a fourth state.
//
// `(?!=)` on the assignment is not decoration: without it the `!==` comparisons read as writes too,
// and the count becomes a statement about how often the field is compared rather than how often it
// is changed.
const writes = [...jsHtml.matchAll(/state\.inspectorDock\s*=(?!=)\s*([^;\n]+)/g)].map((m) => m[1].trim());
assert('the field names all three states, not a boolean',
  ['flow', 'docked', 'full'].every((s) => jsHtml.includes(`'${s}'`)));
assert('nothing writes the dock state from outside the three declared exits',
  writes.length === 3
  && writes.every((w) => w === "'docked'" || w === "'flow'" || w.includes("=== 'full'")));

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
assert('the expanded height is measured from the window and the pinned offsets',
  !!applyFn && /--inspector-full-h/.test(applyFn) && /window\.innerHeight/.test(applyFn)
  && /--sticky-band-h/.test(applyFn) && /--sticky-overview-h/.test(applyFn));
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

console.log('[inspector-dock] ' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('[inspector-dock] OK');