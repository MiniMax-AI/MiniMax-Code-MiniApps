/**
 * The inspector has four values on a narrow screen, three of which are heights, and only one of the
 * four is a scroll decision:
 *
 *   flow   — the panel is in the document; nothing is pinned and neither control is offered
 *   docked — the panel's bottom is pinned to the viewport bottom at half height; both controls are
 *   full   — the reader pressed expand; the cap comes off
 *   folded — the reader pressed minimize; the panel is its own header and only that control remains
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
 * D38 is the same shape one layer up, and the third time this page has produced it. The field had
 * four values and one control that cycled through them: `folded -> half -> full` reaches `full` in
 * one press from `folded` and two from `half`, so what the button offered was a sequence, and a
 * reader had to know which click they were on. Two controls, each with one sentence, fixed it.
 *
 * So what this file asserts below is each control's CONTRACT — what one press of it does, where it
 * is offered, what it says — and never the NUMBER of controls. A third control with a real job
 * would be an improvement, and a guard that counted controls would report it as a defect.
 *
 * The transitions are guarded as one named writer plus the exits that reach it, rather than as one
 * boolean flipped in three places: a boolean makes the third state unnameable, and the third state
 * is the entire feature. Two controls each assigning the field would have made that worse rather
 * than better, which is why both of them hand a named target to `setInspectorDock()` instead.
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

// The client with its comments removed. Three of the rules below are about what the code *does*, and
// the reasoning for the mistakes they encode sits in comments immediately next to the code — the
// offsetTop alternative is named in the comment precisely so it is not re-added. Reading the raw
// text would let a correct explanation of a bug look like the bug still being there, which is the
// same way client-check's vh rule used to punish its own documentation.
//
// HTML comments are removed too, and not only for tidiness: the D38 markup comment explains that
// the buttons hand a target to `setInspectorDock()`, and an argument-extraction rule that reads the
// whole file then finds a call that does not exist.
//
// Line comments are stripped whole-line, and a `//` preceded by `:` is left alone, so a URL in a
// string survives.
const jsHtml = html
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/[^\n]*$/gm, '');

let pass = 0;
const failures = [];
/**
 * `detail` is carried into the failure line. Several rules below pass one — a value, a rule list, a
 * JSON dump — and they used to be dropped on the floor, which is the worst kind of silent: the guard
 * said which rule broke and nothing about what it saw, so a failure was a thing to re-derive by hand
 * from the regex that produced it. Which is exactly the loop the guard exists to end.
 */
function assert(name, cond, detail) {
  if (cond) pass += 1;
  else failures.push(detail ? `${name} — ${detail}` : name);
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

// The three states that are pinned. Named here because D36 made the selector itself the rule: a
// state is pinned by being listed, and `flow` is pinned by nothing. Reading them off one list keeps
// the guard from being able to assert three states while checking two.
const PINNED_STATES = ['.is-inspector-docked', '.is-inspector-full', '.is-inspector-folded'];

const basePosition = narrow ? valueIn(narrow, '#inspector-panel', 'position') : null;
const baseBottom = narrow ? valueIn(narrow, '#inspector-panel', 'bottom') : null;
const pinnedPosition = PINNED_STATES.map((s) => (narrow ? valueIn(narrow, '#inspector-panel' + s, 'position') : null));
const pinnedBottom = PINNED_STATES.map((s) => (narrow ? valueIn(narrow, '#inspector-panel' + s, 'bottom') : null));
const dockedMax = narrow ? valueIn(narrow, '#inspector-panel.is-inspector-docked', 'max-height') : null;
const dockedOverflow = narrow ? valueIn(narrow, '#inspector-panel.is-inspector-docked', 'overflow-y') : null;
const fullMax = narrow ? valueIn(narrow, '#inspector-panel.is-inspector-full', 'max-height') : null;

assert('the three pinned states stick to the bottom of the viewport',
  pinnedPosition.every((v) => v === 'sticky') && pinnedBottom.every((v) => v === '0'),
  PINNED_STATES.map((s, i) => `${s}=${pinnedPosition[i]}/${pinnedBottom[i]}`).join(' '));

// D36 replaced the assertion this one used to make. It read `position: sticky` off the BASE rule and
// called it correct, because the base rule is where the panel's `position` used to be declared — for
// all four states. `bottom: 0` is a promise about height, and it only means 「stay reachable」 while
// the panel is shorter than the scrollport; taller than that the browser slides it up out of its
// grid row. So `flow` was a class name and not a position. Measured 2026-10-13 at 897x858 with one
// record selected: the panel's layout position is document y=8250, which is correctly after the
// ledger, and its rendered position was document y=858 — 7392px up and in FRONT of the ledger at
// 959. `covers` was true at all sixteen scroll stops, and at scrollY=0 the panel's top edge sat
// exactly on the fold with the whole ledger below it.
//
// The fix is an omission, so the property is the omission: flow must not be pinned by a default.
//
// D40 renamed this rule, because by D40 its NAME was the wrong one. It always read the narrow
// query — `valueIn(narrow, …)` — and said 「the base rule」, which was true only while the base had
// no other job. D40 gave the wide side its own `@media (min-width: …)` block and its own sticky
// scheme, so 「base」 stopped naming a region and started naming a coincidence (§8.3). The rule is
// unchanged and still passes; what changed is that it now says which width it is about, and the
// wide side is asserted separately below instead of being implied by the narrow one.
assert('flow is not pinned on a narrow screen: no position at all inside the dock query',
  basePosition === null && baseBottom === null,
  `position=${basePosition} bottom=${baseBottom}`);
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

/**
 * The region between `<tag …>` and the matching close, by counting tags. Used to answer 「is this
 * inside the panel head」 rather than 「does the file contain it」, and to answer it relative to the
 * inspector rather than to the document.
 *
 * The `from` argument is the half of this that matters. The ledger has its own `.panel-head`, it
 * appears earlier in the document, and a whole-file lookup finds that one — the first version of
 * the assertion below was satisfied by a head holding neither control, which is §8.2 of METHODOLOGY
 * in the other direction: not a name too narrow, but a name where a relation was meant.
 */
function elementRegion(text, tag, openTag, from = 0) {
  const at = text.indexOf(openTag, from);
  if (at < 0) return null;
  const re = new RegExp('<' + tag + '\\b|</' + tag + '>', 'g');
  re.lastIndex = at + openTag.length;
  let depth = 1;
  let m;
  while ((m = re.exec(text))) {
    depth += m[0].charAt(1) === '/' ? -1 : 1;
    if (depth === 0) {
      return { start: at, end: m.index + m[0].length, body: text.slice(at, m.index + m[0].length) };
    }
  }
  return null;
}

const panelTag = /<section([^>]*\bid="inspector-panel"[^>]*)>/.exec(html);
const panelClass = panelTag ? /class="([^"]*)"/.exec(panelTag[1]) : null;
const minTag = /<button([^>]*\bid="inspector-minimize"[^>]*)>/.exec(html);
const expTag = /<button([^>]*\bid="inspector-expand"[^>]*)>/.exec(html);

assert('the inspector panel ships the id the script looks it up by', !!panelTag);

// Both controls, as a set. An assertion written against 「the handle」 in the singular is satisfied
// by one of the two shipping, which is exactly what happened once: the count went from one to two
// and the guard kept reading as though it were still one.
const CONTROL_TAGS = [['inspector-minimize', minTag], ['inspector-expand', expTag]];
assert('both controls ship, as the existing section toggle rather than as new kinds of control',
  CONTROL_TAGS.every(([, tag]) => {
    const c = tag && /class="([^"]*)"/.exec(tag[1]);
    return !!c && c[1].split(/\s+/).includes('section-toggle');
  }),
  'ids present: ' + (CONTROL_TAGS.filter(([, t]) => !!t).map(([id]) => id).join(' ') || 'none'));

const panelRegion = elementRegion(html, 'section', '<section class="panel" id="inspector-panel"');
const headRegion = panelRegion
  && elementRegion(html, 'div', '<div class="panel-head">', panelRegion.start);
const actionsRegion = headRegion
  && elementRegion(html, 'div', '<div class="panel-head-actions">', headRegion.start);
assert('both controls ship inside the inspector panel\'s own head',
  !!panelRegion && !!headRegion && !!actionsRegion
  && headRegion.end <= panelRegion.end && actionsRegion.end <= headRegion.end
  && actionsRegion.body.includes('id="inspector-minimize"')
  && actionsRegion.body.includes('id="inspector-expand"'));

assert('both controls ship hidden, because in flow there is no height to change',
  !!minTag && /\shidden(\s|=|$)/.test(minTag[1])
  && !!expTag && /\shidden(\s|=|$)/.test(expTag[1]));

// Each one names what its first press does, in both the accessible name and the tooltip, and the
// two are the same string — a tooltip that describes the previous action is the failure mode of
// writing the two attributes from separate ternaries, which every presence check would accept.
assert('each control ships a label naming what its first press does',
  !!minTag && /aria-label="折叠到最小"/.test(minTag[1]) && /title="折叠到最小"/.test(minTag[1])
  && !!expTag && /aria-label="完全展开检视"/.test(expTag[1]) && /title="完全展开检视"/.test(expTag[1]));

// `aria-controls` that points at nothing is an accessibility defect no other rule here can see, and
// this is the first control in the panel to carry one.
assert('both controls point at a container that exists',
  /<div id="panels">/.test(html)
  && !!minTag && /aria-controls="panels"/.test(minTag[1])
  && !!expTag && /aria-controls="panels"/.test(expTag[1]));

// The two halves of the glyph problem, asserted as two facts because they are two facts. The
// minimize button's glyph is a dash, and `.section-toggle` rotates its icon off `aria-expanded` —
// so the attribute must not be on it. The expand button legitimately carries `aria-expanded`, and
// therefore needs the rotation switched off for it, or the chevron points sideways whenever the
// panel is at half height. Neither half is visible in the other.
assert('the minimize control carries no aria-expanded, which would rotate its dash',
  !!minTag && !/aria-expanded/.test(minTag[1]));
assert('the expand control carries aria-expanded, and its glyph opts out of the disclosure rotation',
  !!expTag && /aria-expanded="false"/.test(expTag[1])
  && /rotate\(\s*-?[\d.]+(?:deg|turn)\s*\)/.test(valueIn(css, ".section-toggle[aria-expanded='false'] .icon", 'transform') || '')
  && valueIn(css, '#inspector-expand .icon', 'transform') === 'none');

// `.panel-head` wraps. Two loose children are two flex items and either can take its own line; one
// inline-flex group with `flex: none` cannot. Asserted with the hazard beside it, for the same
// reason as the rotation above: the rule is only load-bearing while `flex-wrap: wrap` is there.
assert('the two controls are one flex group, so a wrapped header cannot split them across lines',
  valueIn(css, '.panel-head', 'flex-wrap') === 'wrap'
  && valueIn(css, '.panel-head-actions', 'display') === 'inline-flex'
  && valueIn(css, '.panel-head-actions', 'flex') === 'none');

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
 * once for itself and once more inside the two controls' click handlers, so asserting "wire calls it"
 * passes whether or not the top-level call is still there. D38 made this worse rather than better —
 * one extra call site became two.
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

// Three named exits with one literal each became one writer with the exits handing it a target, in
// D38: turning one control into two would otherwise mean two places assigning the field, which is
// the thing R1 exists to prevent and the thing that lets two controls quietly grow a third height
// nobody can name.
const dockFn = functionSource('dockInspector');
const resetFn = functionSource('resetInspectorDock');
const applyFn = functionSource('applyInspectorDock');
const updateFn = functionSource('updateInspectorDock');
const scheduleFn = functionSource('scheduleInspectorDock');
const setFn = functionSource('setInspectorDock');
const moveFn = functionSource('onInspectorResizeMove');

assert('one function writes the dock state, for everything that reacts to input',
  !!setFn && /state\.inspectorDock\s*=\s*next\s*;/.test(setFn) && /applyInspectorDock\(\)\s*;/.test(setFn));

// The writer must not early-return on a same-value call. The drag calls it with 'docked' on every
// pointermove, so `if (state.inspectorDock === next) return;` would look like a harmless
// optimisation and would freeze the panel at whatever height it had reached halfway through the
// drag.
//
// Asserted as the body BEING exactly those statements, not as them being adjacent. Adjacency was the
// first version and the mutation survived it — a version that guards the call and then does exactly
// the same two things still has them adjacent. "Nothing sits between these two" and "nothing sits
// before these two" are different claims, and only the second one is the rule.
//
// D39 gave the body a third statement, and that is why the assertion is an equality rather than a
// pattern: the set of things this function is allowed to do is exactly these, and a fourth is a
// decision somebody has to make here rather than in a regex.
assert('the writer\'s whole body is the memory write plus the change, with no early return',
  !!setFn
  && setFn.replace(/^[^]*?\{/, '').replace(/\}\s*$/, '').replace(/\s+/g, ' ').trim()
    === "if (next === 'folded') state.inspectorDockBeforeFold = state.inspectorDock; "
       + 'state.inspectorDock = next; applyInspectorDock();');

assert('the scroll exit that pins the panel hands its literal to that one writer',
  !!dockFn && /setInspectorDock\(\s*'docked'\s*\)/.test(dockFn)
  && /state\.inspectorDock\s*!==\s*'flow'\s*\)\s*return/.test(dockFn));
assert('the scroll exit that unpins hands its literal to that one writer',
  !!resetFn && /setInspectorDock\(\s*'flow'\s*\)/.test(resetFn));
// Neither exit repaints on its own. A `applyInspectorDock()` beside the writer call is a second
// repaint path through the same state change, and the reason the writer exists is that there is one.
assert('both scroll exits repaint through the writer, not on their own',
  dockFn.includes('setInspectorDock(') && resetFn.includes('setInspectorDock(')
  && !/applyInspectorDock/.test(dockFn) && !/applyInspectorDock/.test(resetFn));

// Every write to the field, listed. R5 is "one writer per state field"; with two controls the honest
// form of that is a closed set of TWO writes — the writer, and the one place that forces the panel
// back into the document when the selection is lost. A third write is a fourth door, and the count
// is what notices it.
//
// `(?!=)` on the assignment is not decoration: without it the `!==` comparisons read as writes too,
// and the count becomes a statement about how often the field is compared rather than how often it
// is changed.
const writes = [...jsHtml.matchAll(/state\.inspectorDock\s*=(?!=)\s*([^;\n]+)/g)].map((m) => m[1].trim());
assert('the field names its one position and all three heights, not a boolean',
  ['flow', 'docked', 'folded', 'full'].every((s) => jsHtml.includes(`'${s}'`)));
assert('nothing writes the dock state except the one writer and the lost-selection exit',
  writes.length === 2
  && writes.filter((w) => w === 'next').length === 1
  && writes.filter((w) => w === "'flow'").length === 1,
  'writes: ' + JSON.stringify(writes));

// The write count above is a count, not a statement about what the values are. A caller that hands
// the writer a computed height — a variable, an expression — would pass it while inventing a fourth
// state nobody declared, so every argument is required to be a spelled-out member of the set.
//
// The leading `\b` is load-bearing and is here because of what it refuses: `resetInspectorDock`
// CONTAINS the substring `setInspectorDock`, so without it every one of the three `resetInspectorDock()`
// occurrences in the file was read as a fourth, fifth and sixth call into the writer with no
// argument. §8.1 of METHODOLOGY — a name that is a prefix of another name is still a name.
//
// The argument pattern allows ONE level of nested parentheses, because D39's exit target is a call.
// `[^)]*` truncates it at `inspectorFoldReturnDock(` and yields an argument no reader can make
// anything of — which reads as a violated rule rather than as a broken parser.
const dockArgs = [...jsHtml.matchAll(/\bsetInspectorDock\(\s*((?:[^()]|\([^()]*\))*)\)/g)]
  .map((m) => m[1].trim());
const STATE_FRAG = "'[^']+'";
const CALL_FRAG = '[A-Za-z_]\\w*\\(\\)';
const SPELLED_STATE = new RegExp('^' + STATE_FRAG + '$');
const SPELLED_CHOICE = new RegExp(
  '^state\\.inspectorDock\\s*===\\s*' + STATE_FRAG
  + '\\s*\\?\\s*(?:' + STATE_FRAG + '|' + CALL_FRAG + ')'
  + '\\s*:\\s*' + STATE_FRAG + '$'
);
assert('every caller hands the writer one of the declared states, spelled out',
  dockArgs.length > 0
  && dockArgs.every((a) => a === 'next' || SPELLED_STATE.test(a) || SPELLED_CHOICE.test(a)),
  'arguments: ' + JSON.stringify(dockArgs));
assert('the only unspelled argument is the writer\'s own parameter declaration',
  dockArgs.filter((a) => a === 'next').length === 1
  && /function\s+setInspectorDock\(\s*next\s*\)/.test(jsHtml));
// A computed destination has to name something that exists. Nothing else in this file follows a call
// into the function it names, so a typo here would be a runtime no-op reported by no assertion at all.
const computedTargets = [...new Set(dockArgs.flatMap((a) => a.match(new RegExp(CALL_FRAG, 'g')) || []))];
assert('a computed destination names a function that exists',
  computedTargets.length > 0
  && computedTargets.every((c) => !!functionSource(c.slice(0, -2))),
  'computed: ' + JSON.stringify(computedTargets));

/* ---------- the two contracts ---------- */

// Visibility. The two rules differ by exactly one term, and the difference IS the design: folded is
// the only state with no other way out, so the minimize control stays — hiding it there would turn
// 「fold it away」 into 「dismiss it」, which is not what the reader asked for. The expand control
// goes, because its contract is 「完全展开 ↔ 半高」 and folded is neither of the two.
//
// Both anchored at the semicolon on purpose. Without it these were prefix matches, and `|| folded`
// — the exact mutation the second one exists for — passed: the pattern stopped at `!docked` and
// never saw what came after. The mutation survived, so the assertion was wrong, not the mutation.
assert('the minimize control is offered wherever there is a height to change',
  !!applyFn && /minimize\.hidden\s*=\s*!narrow\s*\|\|\s*!docked\s*;/.test(applyFn)
  && !/minimize\.hidden\s*=[^;]*folded/.test(applyFn));
assert('the expand control is offered on the two heights it toggles between',
  !!applyFn && /expand\.hidden\s*=\s*!narrow\s*\|\|\s*!docked\s*\|\|\s*folded\s*;/.test(applyFn));

// Labels, read through the derived variables rather than through the presence of the words:
// applyInspectorDock mentions 'full' and 'folded' in several other places — both class toggles and
// both label branches — so a check that only looks for a literal is satisfied by a control that
// reports a hard-coded label and never changes it.
assert('the minimize label is produced from the field, and both its outcomes are named',
  !!applyFn
  && /var\s+minLabel\s*=\s*folded\s*\?\s*\(\s*inspectorFoldReturnDock\(\)\s*===\s*'full'\s*\?\s*'恢复到完全展开'\s*:\s*'恢复到半高'\s*\)\s*:\s*'折叠到最小'\s*;/.test(applyFn)
  && /minimize\.setAttribute\(\s*'aria-label',\s*minLabel\s*\)/.test(applyFn)
  && /minimize\.setAttribute\(\s*'title',\s*minLabel\s*\)/.test(applyFn));
assert('the expand label is produced from the field, and both its outcomes are named',
  !!applyFn && /var\s+expandLabel\s*=\s*expanded\s*\?\s*'收起为半高'\s*:\s*'完全展开检视'\s*;/.test(applyFn)
  && /expand\.setAttribute\(\s*'aria-label',\s*expandLabel\s*\)/.test(applyFn)
  && /expand\.setAttribute\(\s*'title',\s*expandLabel\s*\)/.test(applyFn));

// Tooltip and accessible name come from one variable, so a label change cannot leave the tooltip
// describing the previous action — the failure mode of writing the two attributes from separate
// ternaries, which every presence check above would have accepted. Counted inside the function
// rather than the file: other controls set their own titles for their own reasons.
assert('no control writes its tooltip from anything but its own label variable',
  !!applyFn
  && (applyFn.match(/setAttribute\(\s*'title'/g) || []).length === 2
  && (applyFn.match(/setAttribute\(\s*'title',\s*\w+Label\s*\)/g) || []).length === 2);

// The expand control's own state signal, read through the derived variable rather than through the
// presence of the word: `expanded` is what both the attribute and the glyph are written from, so an
// assertion satisfied by a hard-coded 'true' would pass while the chevron pointed the wrong way.
assert('the expand control reports which of the two heights it is in',
  !!applyFn
  && /var\s+expanded\s*=\s*state\.inspectorDock\s*===\s*'full'/.test(applyFn)
  && /expand\.setAttribute\(\s*'aria-expanded',\s*expanded\s*\?\s*'true'\s*:\s*'false'\s*\)/.test(applyFn));

// The glyph points the way the click goes. Bound once at lookup and written through that same
// binding, because the write sits inside `if (dom.inspectorExpandIcon)` — delete the lookup and the
// guard stops doing anything at all, silently, for the life of the panel. That is the D27 shape
// exactly: the property is present, the code is right, and the arrow points the wrong way.
assert('the expand glyph is bound at lookup, and its direction comes from the same field',
  /dom\.inspectorExpandIcon\s*=\s*document\.getElementById\(\s*'inspector-expand-icon'\s*\)/.test(jsHtml)
  && /<path id="inspector-expand-icon"/.test(html)
  && !!applyFn
  && /dom\.inspectorExpandIcon\.setAttribute\(\s*'d',\s*expanded\s*\?\s*'M4 9\.5 8 5\.5 12 9\.5'\s*:\s*'M4 6\.5 8 10\.5 12 6\.5'/.test(
    applyFn.replace(/\s+/g, ' '))
  && /<path id="inspector-expand-icon" d="M4 6\.5 8 10\.5 12 6\.5"/.test(html));

// The fully expanded height is measured, not derived from vh: this page runs in a host iframe where
// 100vh is not the reader's height, which is the reason client-check bans it.
// The expanded height is measured, not derived from vh: this page runs in a host iframe where
// 100vh is not the reader's height, which is the reason client-check bans it.
//
// Asserted as the expression, not as the presence of the four names. Reading --sticky-band-h and
// window.innerHeight somewhere in the function is satisfied by a version that computes the ceiling
// from neither of them — the mutation replaces the arithmetic with a constant and leaves all four
// tokens in place, and a token-presence check calls that a pass.
// D42: the sum moved into inspectorUnderPins(). What this still asserts is the pair of facts that
// matters — the caller subtracts its own reserve from that helper, and the helper is where the
// two strips and the window are combined. Reading for the helper by name rather than for a
// literal `Math.round(window.innerHeight - band - overview ...)`, because a second derivation of
// the same sum is exactly the drift this change exists to remove.
const underPinsFn = functionSource('inspectorUnderPins');
assert('the expanded height is measured from the window and the pinned offsets',
  !!applyFn && !!underPinsFn
  && /var\s+panelMax\s*=\s*Math\.max\(\s*INSPECTOR_MIN_DOCK_H\s*,\s*inspectorUnderPins\(\)\s*-\s*ledgerReserve\s*\)/.test(applyFn)
  && /window\.innerHeight\s*-\s*band\s*-\s*overview/.test(underPinsFn)
  && /--sticky-band-h/.test(underPinsFn) && /--sticky-overview-h/.test(underPinsFn));

/* ---------- the ledger keeps its share of the window ----------
 *
 * review feedback: 「全高把轮次的表格给覆盖了，建议表格至少留整个页面高度的1/4」. Measured before
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
  !!applyFn && /inspectorUnderPins\(\)\s*-\s*ledgerReserve/.test(applyFn));
// Both ceilings, one number. A drag that could exceed the expanded cap is a panel that covers the
// rows — the defect — reached by a different door.
assert('expanding and dragging are bounded by the same ceiling',
  !!applyFn && /Math\.min\(\s*Math\.max\(\s*Math\.round\(dockH\)\s*,\s*INSPECTOR_MIN_DOCK_H\s*\)\s*,\s*panelMax\s*\)/.test(applyFn)
  && /setProperty\(\s*'--inspector-full-h'\s*,\s*panelMax\s*\+\s*'px'\s*\)/.test(applyFn));
// D32 replaced this assertion. It used to read `no cap applies while the panel is in the
// document`, which encoded the opposite rule and was the reason the defect shipped: the panel
// carries `position: sticky; bottom: 0` in EVERY state, and a sticky-bottom element taller than
// the scrollport has nowhere legal to sit. Measured on 2026-10-13 at 863x803 with one record
// selected: layout position document y=8302, rendered position document y=885, 972px tall in a
// 706px viewport, covering the ledger. `main.columns` had rows `7400px 849px` — the grid was
// never wrong; the sticky offset was.
//
// D32 put the cap on the sticky rule because sticky was on the base rule. D36 moved sticky to the
// three pinned states and left the cap on the base one, so the pairing that mattered is not
// 「sticky and capped are the same rule」 but 「every state is capped」. The cap no longer exists to
// give a sticky element a legal position — flow is an ordinary static block now — it exists because
// the panel is the last thing in the document and a panel taller than the window is one the reader
// has to scroll past to reach the end of the page.
const baseCap = narrow ? valueIn(narrow, '#inspector-panel', 'max-height') : null;
const fullCap = narrow ? valueIn(narrow, '#inspector-panel.is-inspector-full', 'max-height') : null;
assert('every state is capped, including the one that is no longer pinned',
  baseCap !== null && varsRead(baseCap).has('--inspector-full-h'),
  `max-height=${baseCap}`);
// One ceiling, two states. If these can differ, 「完全显示」 in the document and 「完全展开」 while
// pinned stop meaning the same thing, and the two numbers drift apart with no failure anywhere.
assert('in the document and fully expanded are bounded by the same number',
  baseCap !== null && fullCap !== null && baseCap === fullCap,
  `${baseCap} vs ${fullCap}`);
// …and that number is the one that already reserves the ledger's quarter, not a fresh constant.
assert('the document state is bounded by the ceiling that spares the rows',
  varsRead(baseCap || '').has('--inspector-full-h')
  && !!applyFn && /setProperty\(\s*'--inspector-full-h'\s*,\s*panelMax\s*\+\s*'px'\s*\)/.test(applyFn)
  && /ledgerReserve/.test(applyFn));
assert('the expanded height is written in pixels',
  !!applyFn && /setProperty\(\s*'--inspector-full-h'\s*,\s*[\w+ ]+\+\s*'px'\s*\)/.test(applyFn));

/* ---------- the scroll decision ---------- */

// The predicate, and specifically what it is a predicate ABOUT. It used to ask whether the panel's
// own bottom edge had reached the viewport bottom, which is a question about the panel, and it
// answered it early: measured at 897x858 the panel was already pinned around scrollY 550 while the
// filter band was still 140px short of the top of the window. The reported rule is about the band —
// 「只有全部、异常、轨迹这个区域处于最上方的时候, 检视才会强制下部显示」 — and `#filter-sticky` is
// `position: sticky; top: 0`, so whether it is at the top is a reading rather than a computation.
// Measured after the change: the band pins at scrollY 691 and the decision flips at 691, in both
// scroll directions, which is the whole acceptance condition.
assert('pinned means the filter band is at the top of the viewport',
  !!updateFn && /var\s+pinned\s*=\s*band\.getBoundingClientRect\(\)\.top\s*<=\s*1\s*;/.test(updateFn));
assert('the band it reads is the element the report names',
  !!updateFn && /dom\.filterSticky/.test(updateFn));
// Asserting only the new predicate would pass on a function that also kept the old one. The old one
// is the failure — it is what pinned the panel before the band arrived — so its absence is part of
// the rule and is asserted separately rather than left implicit in a regex swap.
assert('the decision no longer reads the panel\'s own geometry',
  !!updateFn && !/getBoundingClientRect\(\)\.bottom/.test(updateFn)
  && !/\.bottom\s*-\s*window\.innerHeight/.test(updateFn));
// The band is read across a layer boundary and written across none. A writer here would give the
// filter layer a second owner of its state, which is what R1 exists to prevent — and this read is
// the one place in the dock feature that is not intra-layer, so it is the one that needs saying.
//
// Asserted as 「this function writes nothing to any object」 rather than as 「it does not touch
// dom.filterSticky」. Naming the handle would only catch a write spelled `filterSticky.something`;
// one aliased through a local reads the same band and passes. The first version of this rule was
// written that way and the mutation that aliases the band survived it — the same mistake as §8.1 of
// METHODOLOGY, in the other direction: there it was a name too narrow, here it would be a name.
assert('the decision reads a rectangle and writes nothing to any object',
  !!updateFn
  && !/\.\s*classList/.test(updateFn)
  && !/\.\s*setAttribute\s*\(/.test(updateFn)
  && !/\.\s*removeAttribute\s*\(/.test(updateFn)
  && !/\.\s*dataset\b/.test(updateFn)
  && !/\.\s*style\b/.test(updateFn)
  && !/\.\s*hidden\s*=/.test(updateFn));
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

/* ---------- wiring: what one press of each control does ---------- *
 *
 * The report D38 answers was not that the cycle was wrong. `folded -> half -> full -> folded` was
 * correct and complete, and it still made the reader count: reaching 半高 from 完全展开 took two
 * clicks and a reader had to know which click they were on. What each control does now lives in its
 * own handler and nowhere else, so each handler is read and turned into a transition table below —
 * and the assertions are made against that table rather than against a sentence restating the code,
 * because a handler that grew a fourth height has to change the table.
 *
 * `state.X === P ? A : B` reads as 「from P this press lands on A, from anywhere else on B」, and A may
 * be a literal OR a call to the one function that decides it. D39 is why that has to be allowed: the
 * way out of folded depends on the height the reader came from, so it cannot be spelled at the call
 * site — and a parser that only understands literals stops seeing the control at all, which is worse
 * than failing loudly.
 */
const pressReg = (prop) => new RegExp(
  'dom\\.' + prop + '\\.addEventListener\\(\\s*\'click\'\\s*,\\s*function\\s*\\(\\s*\\)\\s*\\{([\\s\\S]*?)\\n\\s*\\}\\);'
);
const minClick = pressReg('inspectorMinimize').exec(jsHtml);
const expClick = pressReg('inspectorExpand').exec(jsHtml);

const PRESS = new Map();
for (const [key, hit] of [['minimize', minClick], ['expand', expClick]]) {
  if (!hit) continue;
  const m = /state\.inspectorDock\s*===\s*'([^']+)'\s*\?\s*([A-Za-z_]\w*\(\)|'[^']+')\s*:\s*'([^']+)'/.exec(hit[1]);
  if (m) PRESS.set(key, { probe: m[1], escapeTo: m[2], fallbackTo: m[3], body: hit[1] });
}

/** A destination the handler computes instead of spelling. */
const isComputed = (t) => /[(][)]$/.test(t);

/**
 * A destination resolved to a state, following the one call it may make.
 *
 * Two spellings arrive here and both have to work: the probe's branch is captured WITH its quotes
 * (it has to, or a call and a literal are indistinguishable) and the other branch without them.
 * Normalising inside the resolver is the fix; normalising them at the parse site is what the first
 * version tried, and it made one comparison in the table silently vacuous.
 *
 * The function's body is READ, not assumed: a handler calling something the guard cannot resolve
 * yields null and the assertions below fail, rather than quietly comparing against a guess.
 */
function resolveDestination(dest) {
  const lit = /^'([^']+)'$/.exec(dest);
  if (lit) return lit[1];
  if (isComputed(dest)) {
    const src = functionSource(dest.slice(0, -2));
    if (!src) return null;
    const m = /return\s+state\.(\w+)\s*===\s*'([^']+)'\s*\?\s*'([^']+)'\s*:\s*'([^']+)'\s*;/.exec(src);
    return m ? (m[2] === 'full' ? m[3] : m[4]) : null;
  }
  return dest || null;
}

const pressTo = (key, from) => {
  const p = PRESS.get(key);
  if (!p) return null;
  return resolveDestination(from === p.probe ? p.escapeTo : p.fallbackTo);
};

assert('each control is wired to a press, and each names the one state it is the partner of',
  !!minClick && !!expClick && !!PRESS.get('minimize') && !!PRESS.get('expand')
  && PRESS.get('minimize').probe === 'folded' && PRESS.get('expand').probe === 'full');
// Neither control assigns the field or repaints by itself. Two controls that each assigned it would
// be two writers of one value, which is the shape D38 had to be careful not to introduce while
// removing the shape it was removing.
assert('no control writes the dock state itself: both hand a target to the one writer',
  ['minimize', 'expand'].every((k) => PRESS.get(k).body.includes('setInspectorDock('))
  && !/state\.inspectorDock\s*=(?!=)/.test((minClick ? minClick[1] : '') + (expClick ? expClick[1] : '')));
// …and neither repaints on its own either. Calling the writer and then calling applyInspectorDock()
// again looks like belt-and-braces and is a second path from a change to a repaint, which is the
// reason the writer exists.
assert('no control repaints on its own: the writer is the only place a change becomes visible',
  ['minimize', 'expand'].every((k) => !/applyInspectorDock/.test(PRESS.get(k).body)));

// The table. Written against the transitions rather than against the literals in the source, so the
// claims below are the ones a reader would make about the panel and not the ones a reader of the
// diff would make about the code.
//
// D39 rewrote the folded row. 「both heights other than half are one press away from half height」 was
// true for the wrong reason: from folded the answer depended on the memory, and the memory was not a
// thing this file could see. It is now stated as what the control actually guarantees — one press
// out of folded reaches a PINNED height, and which one is the reader's earlier choice, not the
// control's.
assert('from half height one press reaches either of the other two heights',
  pressTo('expand', 'docked') === 'full' && pressTo('minimize', 'docked') === 'folded');
assert('from fully expanded one press reaches either of the other two heights',
  pressTo('expand', 'full') === 'docked' && pressTo('minimize', 'full') === 'folded');
assert('from folded one press lands on a pinned height rather than on nothing',
  ['full', 'docked'].includes(pressTo('minimize', 'folded')));
assert('the two heights the expand control owns exchange in a single press each way',
  pressTo('expand', 'docked') === 'full' && pressTo('expand', 'full') === 'docked');
assert('the minimize control is the only way into folded and the only way out of it',
  pressTo('minimize', 'docked') === 'folded' && pressTo('minimize', 'full') === 'folded'
  && pressTo('minimize', 'folded') !== 'folded'
  && [...PRESS.keys()].every((k) => k === 'minimize'
    || ['docked', 'folded', 'full'].every((from) => pressTo(k, from) !== 'folded')));
// `flow` is a scroll decision, not a button target. A control that could put the panel back in the
// document would give the reader a way to leave the dock that nothing re-decides — and the band
// predicate, which is the only thing allowed to make that call, would stop being the only one.
//
// Stated over EVERY source state and through the resolver, because the two branches of a ternary
// arrive here with different quoting: the probe's branch is captured WITH its quotes — it has to be,
// or a call and a literal become indistinguishable — and the other without. Comparing the raw
// strings therefore passes for `'flow'` while it is exactly the value that must not appear, which is
// a vacuous rule; the first version of this was one, and a mutation got through it. The computed
// destination counts too: a function that can answer 'flow' opens the same door.
assert('no control can put the panel back in the document; the scroll decision owns that alone',
  [...PRESS.keys()].every((k) => ['flow', 'docked', 'folded', 'full']
    .every((from) => {
      const dest = pressTo(k, from);
      return dest !== null && dest !== 'flow';
    })));

/* ---------- D39: the way out of folded remembers where the reader came from ---------- *
 *
 * 「恢复到半高」 shipped as a literal and was wrong for half the cases: fold a fully expanded panel
 * and it came back to half height. The exit was announcing something it was not going to do, and
 * every assertion above was green throughout, because the label was present and the press worked —
 * they just did not agree about the destination.
 *
 * Splitting the control in two (D38) did not fix this and could not have: the split decided WHICH
 * branch each control owns, not what that branch points at. The target is a function of the reader's
 * earlier action, so it has to be carried in a field and computed in one place.
 */

const foldReturnFn = functionSource('inspectorFoldReturnDock');

assert('the way out of folded is decided by where the reader came from, not written at the control',
  !!PRESS.get('minimize') && !isComputed(PRESS.get('minimize').fallbackTo)
  && isComputed(PRESS.get('minimize').escapeTo)
  && /inspectorFoldReturnDock/.test(PRESS.get('minimize').body));

// One function, both readers. A label that picked its own branch is exactly how a button ends up
// saying 「恢复到半高」 and taking the reader to full height — the two disagreeing IS the defect, and
// counting the calls keeps a third reader from appearing too.
assert('the folded label and the folded press read the same rule, and nobody else does',
  !!foldReturnFn && /inspectorFoldReturnDock/.test(applyFn || '')
  && (jsHtml.match(/inspectorFoldReturnDock\(\)/g) || []).length === 3
  && /function\s+inspectorFoldReturnDock\(\s*\)/.test(jsHtml));

// The rule itself, as the expression. Not as the presence of two state strings: a version that
// returns one of them unconditionally is satisfied by a token check and is the old defect back.
assert('a full panel comes back full, and every other height comes back to half',
  !!foldReturnFn
  && /return\s+state\.inspectorDockBeforeFold\s*===\s*'full'\s*\?\s*'full'\s*:\s*'docked'\s*;/.test(foldReturnFn));

// Every state the exit is even capable of naming must be a pinned height.
//
// Stated over the tokens rather than over the one branch, because `resolveDestination` can only
// follow the branch the memory is currently set to — a defect in the OTHER branch is invisible to
// every reachability assertion in this file, and a mutation that put `'flow'` there survived until
// this rule existed. The resolver cannot be fixed for this: which branch a reader takes depends on
// what they had open, and a static file does not get to decide that.
assert('the way out of folded can only name a pinned height, never a position',
  !!foldReturnFn
  && [...foldReturnFn.matchAll(/'([^']+)'/g)].map((m) => m[1])
    .every((s) => s === 'docked' || s === 'folded' || s === 'full'),
  'named: ' + JSON.stringify(foldReturnFn ? [...foldReturnFn.matchAll(/'([^']+)'/g)].map((m) => m[1]) : null));

// The memory. One writer, and it writes on the way IN — which is the whole reason it cannot go
// stale: the field is read only while folded, so there is no window in which the dock has moved on
// and the memory has not, and nothing has to clear it.
const memWrites = [...jsHtml.matchAll(/state\.inspectorDockBeforeFold\s*=(?!=)\s*([^;\n]+)/g)]
  .map((m) => m[1].trim());
assert('one place remembers the height, and it is the writer of the dock state',
  memWrites.length === 1 && memWrites[0] === 'state.inspectorDock'
  && /if\s*\(\s*next\s*===\s*'folded'\s*\)\s*state\.inspectorDockBeforeFold\s*=/.test(setFn || ''),
  'writes: ' + JSON.stringify(memWrites));
// Read in exactly one place. A second reader — an inline `=== 'full'` at the click site — is free to
// disagree with the function, and the disagreement is invisible because both spellings are correct.
assert('the remembered height is read in exactly one place',
  (jsHtml.match(/state\.inspectorDockBeforeFold/g) || []).length === 2
  && /inspectorDockBeforeFold\s*:\s*'docked'\s*,/.test(jsHtml)
  && /state\.inspectorDockBeforeFold\s*===\s*'full'/.test(foldReturnFn || ''));

// The control that folds the panel is the rightmost one. A position is a promise like any other —
// 「where the window puts it」 — and nothing else in this file could see it move: both controls would
// still ship, still be wired, still be labelled correctly.
assert('the control that folds the panel is the rightmost of the two',
  !!actionsRegion
  && actionsRegion.body.indexOf('id="inspector-expand"') >= 0
  && actionsRegion.body.indexOf('id="inspector-minimize"') > actionsRegion.body.indexOf('id="inspector-expand"'));

// The glyph follows the label, same as the chevron above. Two glyphs toggled by `hidden` would not
// work — `hidden` is not reliably honoured on an SVG element — and a dash that means both 「fold this
// away」 and 「put it back」 is the thing D38 was fixing in the label.
assert('the minimize glyph follows its label: a dash to fold away, a restore mark to come back',
  /dom\.inspectorMinimizeIcon\s*=\s*document\.getElementById\(\s*'inspector-minimize-icon'\s*\)/.test(jsHtml)
  && /<path id="inspector-minimize-icon" d="M3\.5 8 H12\.5"/.test(html)
  && !!applyFn
  && /dom\.inspectorMinimizeIcon\.setAttribute\(\s*'d',\s*folded\s*\?\s*'[^']+'\s*:\s*'M3\.5 8 H12\.5'/.test(
    applyFn.replace(/\s+/g, ' ')));

// Which branch a given fold takes cannot be read from a static file — it depends on what the reader
// had open. What this file CAN refuse is a version that never reads the memory, and that is the
// assertion above. The two branches are measured in the browser instead; see the note at the end of
// METHODOLOGY.md §9 on stating what was not checked here.

/* ---------- D40: the same layer, a different region on the other side of the breakpoint ----------
 *
 * Measured 2026-10-13 at 1276x1280 with one record selected: the right column was a `static` block
 * 833px tall at the top of a 7,545px grid row. Visible 692px at scrollY=0, full at 200–400, 621 at
 * 800, and **0 from scrollY 1645 onward** — it scrolled away after about 600px and never came back,
 * so it was invisible across 88% of the trajectory. The ledger scrolls; the thing being read while it
 * scrolls was not on screen.
 *
 * This is the same layer and the same element as everything above, in a mutually exclusive media
 * query, with the OPPOSITE kind of sticky: the narrow side pins to the viewport bottom because the
 * panel is the last thing in the document, the wide side pins under the stacked strips because the
 * ledger beside it is a quarter of a million pixels tall. Both mean 「stop scrolling away」.
 *
 * Every assertion here is scoped to the WIDE query. Nothing above can see this side: it was written
 * when the panel had no wide behaviour at all, and an assertion that cannot see the thing it is about
 * is worse than no assertion, because it reads as coverage.
 */

const wideCondition = '(min-width: 1081px)';
const wideBodies = mediaBodies(wideCondition);
const wide = wideBodies.find((b) => /#inspector-panel\s*\{/.test(b)) || null;

assert('the wide-screen region exists and is scoped above the single-column breakpoint',
  !!wide && dockCondition !== null,
  `wide bodies: ${wideBodies.length}, dock at: ${dockCondition}`);
// …and the two queries cannot both match. `max-width: 1080` and `min-width: 1081` leave no width
// where both fire and none where neither does; an overlapping pair would give the panel two
// contradictory positions and the later rule would win by source order, silently.
assert('the two layouts are mutually exclusive, with no width claimed by both or neither',
  dockCondition !== null && Number(wideCondition.match(/(\d+)px/)[1]) === dockCondition + 1,
  `dock ${dockCondition} vs wide ${wideCondition}`);

// The top is a sum of two MEASURED strips, not a number and not a re-measurement. band is L2 and
// overview is L3, and verify-generation-pin already exists to stop the fourth place that holds the
// same fact from drifting — so a new reader has to read them, not recompute them.
const wideTop = wide ? valueIn(wide, '#inspector-panel', 'top') : null;
assert('the wide panel sticks under the two measured strips',
  !!wide && valueIn(wide, '#inspector-panel', 'position') === 'sticky'
  && /calc\(\s*var\(\s*--sticky-band-h[^)]*\)\s*\+\s*var\(\s*--sticky-overview-h[^)]*\)\s*\)/.test(wideTop || ''),
  `position=${wide ? valueIn(wide, '#inspector-panel', 'position') : null} top=${wideTop}`);
// The window bar is left out on purpose: it only ever occupies the LEFT column, so including it
// would drop the panel 45px below the overview for no reason. Asserted so the "harmless addition"
// that would be wrong has a name.
assert('the wide top excludes the window bar, which only ever occupies the left column',
  !!wide && !/sticky-window-h/.test(wideTop || ''));
// …and it is not a bottom-pinned region. `bottom` here would mean the narrow scheme leaking across,
// and the narrow scheme is a promise about a panel shorter than the scrollport.
assert('the wide panel is not pinned to the bottom of anything',
  !!wide && valueIn(wide, '#inspector-panel', 'bottom') === null
  && !/is-inspector-/.test(wide || ''));

// The ceiling. A record measured 1,022px and the cap on a 768px-tall window is 621px, so without
// one the panel simply grows past the fold again — the same invisible defect by a different door.
const wideMax = wide ? valueIn(wide, '#inspector-panel', 'max-height') : null;
assert('the wide panel is capped, and scrolls its own content',
  !!wide && wideMax !== null && varsRead(wideMax).has('--inspector-wide-h')
  && valueIn(wide, '#inspector-panel', 'overflow-y') === 'auto');
// Measured from the window, never `vh`: this page runs in a host iframe where 100vh is not the
// reader's viewport, which is the whole reason client-check bans it. Asserted as the expression
// rather than the token, because a version that computes the ceiling from `band` alone satisfies a
// presence check and disagrees with the `top` by exactly the overview's height.
const syncFn = functionSource('syncStickyOffsets');
const wideWrites = [...jsHtml.matchAll(/setProperty\(\s*'--inspector-wide-h'\s*,\s*([^;]*)\)/g)]
  .map((m) => m[1].replace(/\s+/g, ' ').trim());
assert('the wide ceiling is measured from the window, and never from vh',
  !!syncFn && wideWrites.length === 1
  && /inspectorUnderPins\(\)\s*-\s*INSPECTOR_WIDE_BOTTOM_GAP/.test(wideWrites[0])
  && !/vh\b/.test(wideWrites[0]),
  'writes: ' + JSON.stringify(wideWrites));
// One writer. `--inspector-wide-h` is a fact about the window, so a second place computing it is
// two places able to disagree about where the pinned stack ends.
assert('the wide ceiling has exactly one writer, and it is the function that already owns the strips',
  wideWrites.length === 1 && !!syncFn
  && /--sticky-band-h'\s*,\s*band\s*\+\s*'px'/.test(syncFn)
  && /--sticky-overview-h'\s*,\s*overview\s*\+\s*'px'/.test(syncFn));
// The gap below the panel has to be a named constant, not a literal in the arithmetic: it is the
// difference between 「there is more below」 and 「cut off at the window's edge」, and a literal is
// where the two would start to drift.
assert('the hair of viewport below the wide panel is a named number, not a literal in the arithmetic',
  /var\s+INSPECTOR_WIDE_BOTTOM_GAP\s*=\s*\d+\s*;/.test(jsHtml)
  && (jsHtml.match(/INSPECTOR_WIDE_BOTTOM_GAP/g) || []).length === 2,
  'uses: ' + (jsHtml.match(/INSPECTOR_WIDE_BOTTOM_GAP/g) || []).length);

/** Every selector in a rule list, one entry per rule and one per comma. */
function selectorsIn(text) {
  return [...(text || '').matchAll(/^[ \t]*([^{}@][^{}]*?)\s*\{/gm)]
    .map((m) => m[1].split(',').map((s) => s.trim()));
}

// One line of CSS for a whole new positioning scheme, and nothing else changed on the narrow side.
//
// The first version of this asserted 「no offset is re-declared here」, which is a real rule and not
// the one that was asked for — and it was vacuous: a mutation that added a `#filter-sticky` rule to
// the same block passed it, because moving something the report never mentioned is not re-declaring
// an offset. What the rule actually says is that the block has one selector, so it is enumerated
// rather than spot-checked.
assert('the wide region touches the panel and nothing else',
  !!wide && selectorsIn(wide).length === 1
  && selectorsIn(wide)[0].length === 1 && selectorsIn(wide)[0][0] === '#inspector-panel',
  'selectors: ' + JSON.stringify(selectorsIn(wide)));

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

/* ---------- the selection is a dock input, and nothing else fires for it ----------
 *
 * the reviewer: 「当前检视第一次出现的高度太高，我之前说是 2/5，还有折叠的按钮也没了。」
 *
 * The decision above is reached from three wires — scroll, resize, wire time — and none of them
 * fires when the reader selects a record. Selecting changes what the panel contains and therefore
 * how tall it is, which is exactly the input the decision reads, and it emits no event at all. So
 * the first appearance inherited the previous state: measured `rect.bottom == innerHeight`, i.e.
 * sticky had already pinned the panel, while `state.inspectorDock` still said `flow`. A panel that
 * reports flow comes up at panelMax with no handle — too tall, and no way to change it.
 *
 * These three guard the trigger, which the 77 assertions above it never did: they read whether the
 * exit that shows the record re-decides. The CSS rules and the decision function were both correct
 * throughout, and every assertion about them stayed green.
 */
const renderScheduleCalls = (renderFn.match(/scheduleInspectorDock\(\)/g) || []).length;
assert('the exit that shows the record is the exit that re-decides how it is docked',
  !!renderFn && renderScheduleCalls > 0);

// Resolved through the call chain rather than by name: a scheduler that stops calling the decision
// still leaves renderInspector() mentioning it, and reading the call site alone would pass.
assert('the dock decision is reachable from a change that fires no scroll event',
  !!renderFn && renderScheduleCalls > 0
  && !!scheduleFn && /updateInspectorDock\(\)/.test(scheduleFn));

// One call site, and it is past the early return. The empty branch has no panel left to measure —
// applyInspectorDock() has already forced `hidden` and `flow` for that case — so a call there would
// be a second place deciding the same thing, which is the shape D14 rules out.
assert('the empty-selection branch has no panel left to measure',
  !!renderFn && renderScheduleCalls === 1
  && renderFn.indexOf('scheduleInspectorDock();') > renderFn.indexOf('if (!entry)'));

/* ---------- the docked height: two fifths of the window, and the reader can move it ---------- */

// the reviewer: 「检视的中间高度改为2/5」. The share is a named constant rather than a bare `/ 4` so that the
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
  !!moveFn && /setInspectorDock\(\s*'docked'\s*\)/.test(moveFn)
  && !/state\.inspectorDock\s*=/.test(moveFn));
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
// Offered exactly where there is a height to drag: pinned, and not folded. A folded panel is down to
// its own header, and dragging a header that cannot grow is the same dead control as no grip at all.
assert('the grip is offered exactly where there is a height to drag',
  !!applyFn && /dom\.inspectorResize\.hidden\s*=\s*!\(\s*narrow\s*&&\s*docked\s*&&\s*!folded\s*\)/.test(applyFn));
// …and 「pinned」 has to mean both pinned states, not just the default one, or the grip disappears
// in exactly the state the reader most wants to make taller.
assert('pinned means both docked and expanded, so the grip survives expanding',
  !!applyFn && /var\s+docked\s*=\s*state\.inspectorDock\s*!==\s*'flow'/.test(applyFn));

// review #5. The grip used to ship `position: absolute` on the panel's top edge, and every
// assertion above still passed — the same shape as D27 one layer down. Inside a scrolling box an
// absolutely positioned child travels WITH the content, so the strip left the scrollport on the
// first scroll: measured at 900x780, its overlap with the panel was 8px at scrollTop 0 and 0px by
// scrollTop 174. `sticky` is what pins a box to the SCROLLPORT instead, which is the thing a grip
// has to survive.
//
// Not D45. That number is already taken by the endpoint-count mismatch recorded in docs/LAYERS.md,
// and a defect number that points at two different things is a number that will be cited wrong.
assert('the grip is pinned to the panel scrollport, not carried along by its content',
  narrow ? valueIn(narrow, '#inspector-panel .inspector-resize', 'position') === 'sticky' : false,
  narrow ? `position: ${valueIn(narrow, '#inspector-panel .inspector-resize', 'position')}` : 'no narrow block');

// …and it has to be pinned there BY ONE RULE. The D27 lesson is that a later rule can undo the one
// keeping a property, so reading the base rule is not enough: enumerate every `position` that can
// land on the grip and require it to be exactly the one value. Same shape as the display-pair
// enumeration at the end of this section.
//
// The pseudo-elements are excluded, and deliberately so rather than by accident: `.inspector-resize::after`
// is the visible hairline and it legitimately carries `position: absolute` against the strip, which is
// the one thing the strip itself must not be. Counting it would make this assertion demand the strip
// lose the thing that draws it.
const gripPositions = [...(narrow || '').matchAll(/^([^{}@][^{}]*?)\{([^{}]*)\}/gm)]
  .filter((m) => m[1].split(',').map((s) => s.trim()).some((s) =>
    s.includes('.inspector-resize') && !s.includes('::')))
  .map((m) => (/^[ \t]*position\s*:\s*([^;]+)/m.exec(m[2]) || [, ''])[1].trim())
  .filter(Boolean);
assert('exactly one rule positions the grip itself, and it is the one that pins it',
  gripPositions.length === 1 && gripPositions[0] === 'sticky',
  JSON.stringify(gripPositions));

// The second cause, and the one that outlived scrollTop 0. The grip shares its edge with
// `.inspector-chrome`, which is sticky at the panel's top with an opaque background at z-index 2.
// The grip sat at z-index 1, so of the 8px where the two overlapped, 45 of 45 sampled points hit
// the header: the reader could not drag the panel taller on ANY scroll position, not only after
// scrolling. Same family as D27 — the properties were all present and all correct in isolation.
//
// The chrome is read out of `css` and not out of `narrow`, and that is not tidiness. The chrome rule
// lives in the base stylesheet and the grip rule lives in the dock query, so reading both from
// `narrow` finds nothing for the chrome, `Number(null)` is 0, and `3 > 0` is true whatever the grip
// says — an assertion that cannot fail, produced by writing the same variable twice. The first
// version of this line did exactly that and caught none of the mutations below.
const gripZ = narrow ? Number(valueIn(narrow, '#inspector-panel .inspector-resize', 'z-index')) : NaN;
const chromeZ = Number(valueIn(css, '#inspector-panel > .inspector-chrome', 'z-index'));
assert('the grip paints above the header it shares an edge with, so it can be reached',
  Number.isFinite(gripZ) && Number.isFinite(chromeZ) && gripZ > chromeZ,
  `grip z-index ${gripZ}, chrome z-index ${chromeZ}`);

// Sticky puts the strip back IN the flow, which costs height the panel did not used to pay, so the
// margin has to take exactly that back. Two numbers that have to be one rule: change `height`
// without changing the margin and the chrome is pushed down by the difference, which is a layout
// change nobody asked for and no assertion would otherwise catch.
const gripHeight = narrow ? parseFloat(valueIn(narrow, '#inspector-panel .inspector-resize', 'height')) : NaN;
const gripMargin = narrow ? parseFloat(valueIn(narrow, '#inspector-panel .inspector-resize', 'margin-bottom')) : NaN;
assert('the negative margin cancels the height the strip now takes in the flow',
  Number.isFinite(gripHeight) && Number.isFinite(gripMargin) && gripMargin === -gripHeight,
  `height ${gripHeight}px, margin-bottom ${gripMargin}px`);

/* ---------- D34: the third height, and the one that was missing ----------
 *
 * the reviewer: 「不是三态么？- 折叠到最小 这个按钮没做。」
 *
 * The field had three values and only two of them were heights: `flow` is a position ("not pinned").
 * So the panel could go from two fifths to fully expanded and had nowhere smaller to go. Nothing in
 * this file could see that — every assertion here counted values, classes or writers, and the count
 * was three.
 */

// Folded has carried two selectors since D43, and the second half is the load-bearing one.
// `.inspector-chrome` wraps the three identifying rows so they can be pinned as one unit, and a
// wrapper is exactly what `:not(.panel-head)` used to be protecting: written as the outer selector
// alone it keeps the wrapper and takes out its whole contents, so folded would have no header at
// all — and the minimize control that is the only way out of folded lives inside that header.
// The failure is asymmetric, which is why the halves are asserted separately: losing the outer half
// leaves folded standing at the chrome's full 124px, and losing the inner half deletes the one row
// the state exists to keep.
const foldedOuter = '#inspector-panel.is-inspector-folded > *:not(.inspector-chrome)';
const foldedInner = '#inspector-panel.is-inspector-folded .inspector-chrome > *:not(.panel-head)';
const foldedRule = narrow ? valueIn(narrow, foldedOuter, 'display') : null;

// Folded is the header alone: everything else leaves the flow, so the panel's height IS the
// header's height. Asserted as "this rule declares nothing but that", not as "the property is
// there": the first version of this checked `display: none` plus the absence of a property named
// `--inspector-folded-h`, and a `max-height: 51px` added alongside it sailed past — the cap was
// back, wearing a different variable's absence as camouflage. A cap that has to be measured is a
// cap that can be wrong, and this one was measured wrong twice on the way here.
const foldedDecls = narrow ? declsIn(narrow, foldedOuter) : new Map();
assert('folded is the header alone, so its height needs no number of its own',
  foldedDecls.size === 1 && foldedDecls.get('display') === 'none' && !/--inspector-folded-h/.test(jsHtml));

// Both halves belong to one rule, and `declsIn` splits on commas, so either selector finds it. That
// is what lets the two assertions below be about *which* rows each half keeps rather than about
// there being a folded rule at all.
const foldedInnerDecls = narrow ? declsIn(narrow, foldedInner) : new Map();
assert('folded keeps the wrapper and takes out everything inside it except the header',
  !!narrow
  && foldedInnerDecls.size === 1 && foldedInnerDecls.get('display') === 'none'
  && new RegExp(foldedInner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(narrow));

// The header survives by exclusion, which is also what makes it fragile to read: written as `> *`
// the rule would fold the minimize control away along with the content, and the reader would be
// stuck in the one state with no other way out.
assert('folded keeps the header and takes the rest out of flow',
  !!narrow && new RegExp(foldedOuter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(narrow));

// Folded is the only state with no other way out, so the minimize control has to stay there. That
// single condition is the difference between 「fold it away」 and 「dismiss it」, and nothing else in
// the file would notice it flipping: the panel still renders, the selection is still there, the
// guard still passes. Written in the negative as well as the positive, because the first version of
// this was a prefix match and `|| folded` sailed through it — the mutation survived, so the
// assertion was wrong, not the mutation.
//
// Reachable from the reader, not merely present in the field's value set — which is the distinction
// the original bug turned on, and the one D38 had to preserve while splitting the control in two.
assert('folded is reachable in one press, and so is the way back out of it',
  pressTo('minimize', 'docked') === 'folded'
  && ['full', 'docked'].includes(pressTo('minimize', 'folded'))
  && !!applyFn && /'折叠到最小'/.test(applyFn)
  && /'恢复到半高'/.test(applyFn) && /'恢复到完全展开'/.test(applyFn));

/* ---------- D43: the pinned unit was one row out of the three that belong together ---------- *
 *
 * the reviewer: 「宽屏下, 检视向下滚动到底, title又没了.」
 *
 * D41 pinned `.panel-head`, and the comment above that rule named the loss as three rows: the
 * header, the 「第 N 轮 · #NNNNN · 思考」 line, and the whole tab bar. Two of the three were still
 * ordinary blocks, scrolling away like anything else. Measured in the real window with real records
 * scrolled to their real bottom, counting the pixels still inside the panel's own scrollport:
 *
 *     1366x768   212px of scroll   header 49/49   turn line 0/36   tab bar 0/39
 *     1100x900   169px             header 76/76   turn line 0/36   tab bar 0/39
 *     897x900    329px             header 49/49   turn line 0/36   tab bar 0/39
 *
 * The header being 76px at one width and 49px at another is why the fix is a wrapper and not three
 * sticky siblings with stacked `top` offsets: a stacked version needs 49/85/124 written down, and is
 * wrong the moment a long record id wraps the header onto a second line, with nothing able to say so.
 * This file has already paid for the other answer — the folded state's comment explains why the
 * header's height was never measured into a custom property. So the three rows are one element, and
 * nothing about its height is written down anywhere.
 *
 * The loss also scales with how far the panel can scroll, which is why this shipped green twice: at
 * 1600x900 the panel scrolls 80px, the tab bar survives by accident and the turn line keeps 5 of its
 * 36 pixels, so D41's 12/12 and its re-measurement at 18/18 both read correct over a defect that was
 * still there. Three assertions follow, and none of them is the old one restated:
 *
 *   1. The pinned unit CONTAINS all three rows — asserted as containment, not as three separate
 *      "is it sticky" checks. "The header is sticky" was true the whole time the defect shipped; it
 *      was true of the one row that worked. The claim is about the unit, not about a member.
 *   2. What disappeared is asserted too: no row inside may declare a sticky of its own. That is the
 *      defect's shape coming back through a different door, and it reads green against every other
 *      assertion in this block.
 *   3. Declared once, at the top level, scoped to this panel — carried over from D41 unchanged,
 *      because the scope's REASON is what expires, so the scope is part of the property.
 */
function allMediaBodies(text) {
  const out = [];
  const re = /@media[^{]*\{/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < text.length && depth > 0) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') depth -= 1;
      i += 1;
    }
    out.push(text.slice(re.lastIndex, i - 1));
    re.lastIndex = i;
  }
  return out;
}

const CHROME_SEL = '#inspector-panel > .inspector-chrome';
const chromeSticky = valueIn(css, CHROME_SEL, 'position');
const chromeStickyTop = valueIn(css, CHROME_SEL, 'top');

// Located from inside the panel region, so "the three rows are together" cannot be satisfied by a
// wrapper that happens to sit elsewhere on the page with the right class. Null-safe on purpose: a
// mutation that renames the panel's class leaves `panelRegion` null, and a guard that dereferences it
// dies before it can report anything — the harness then reads that as "no assertion caught this",
// which is the correct verdict about a guard that crashes, and a very misleading one about the
// assertion that was supposed to catch it.
const chromeRegion = panelRegion
  ? elementRegion(html, 'div', '<div class="inspector-chrome">', panelRegion.start)
  : null;
const chromeBody = chromeRegion ? chromeRegion.body : '';
assert('the pinned unit holds the header, the turn line and the tab bar together',
  !!chromeRegion && !!panelRegion
  && chromeRegion.start > panelRegion.start && chromeRegion.end < panelRegion.end
  && chromeBody.indexOf('<div class="panel-head">') >= 0
  && chromeBody.indexOf('id="inspector-locator"') >= 0
  && chromeBody.indexOf('id="tablist"') >= 0);

// The background is part of the property, not decoration: a sticky band with a transparent background
// paints the content scrolling underneath straight through it, and the rows read as part of the table
// rather than as the thing the table is inside.
assert('the identifying rows stay at the top while content scrolls under them, at every width',
  chromeSticky === 'sticky' && chromeStickyTop === '0'
  && /#inspector-panel\s*>\s*\.inspector-chrome\s*\{[^}]*background:\s*var\(--mcode-surface\)/.test(css));

// A member that pins itself is not harmless: it pins to the wrapper, which does not scroll, so the
// declaration does nothing at all — and it reads as though the row were taken care of. That is the
// exact shape of the defect this replaced, one row at a time.
const chromeRows = ['#inspector-panel > .panel-head', '#inspector-panel .inspector-locator', '#inspector-panel #tablist'];
const selfPinnedRows = chromeRows.filter((s) => valueIn(css, s, 'position') === 'sticky');
assert('no row inside the pinned unit declares a sticky of its own',
  selfPinnedRows.length === 0, selfPinnedRows.join(' '));

// `valueIn` cannot tell the top level from inside a media block — `declsIn` matches any line-initial
// selector, so a rule buried in a query reads exactly like one at the top. Braces have to be counted.
const chromeRuleHits = (css.match(/#inspector-panel\s*>\s*\.inspector-chrome\s*\{/g) || []).length;
const chromeInsideAnyQuery = allMediaBodies(css)
  .filter((b) => /#inspector-panel\s*>\s*\.inspector-chrome\s*\{/.test(b));
const bareChromeSticky = /(?:^|[},])\s*\.inspector-chrome\s*\{[^}]*position:\s*sticky/.test(css);
assert('the pinned unit is declared once, at the top level, for the inspector panel alone',
  chromeRuleHits === 1 && chromeInsideAnyQuery.length === 0 && !bareChromeSticky);

// Any `#inspector-panel` rule that mentions overflow-y has to say auto, and both sides of the
// breakpoint have to have said it — otherwise some width leaves the panel in flow and the pinned unit
// falls back to the viewport, following the reader down a 7,000px ledger column.
const panelOverflows = [...css.matchAll(/#inspector-panel\s*\{([^{}]*)\}/g)]
  .map((m) => (m[1].match(/overflow-y:\s*([^;]+);/) || [])[1])
  .filter(Boolean);
assert('every width gives the panel its own scroller, which is what makes an unscoped pinned unit safe',
  panelOverflows.length >= 2 && panelOverflows.every((v) => v.trim() === 'auto'));

/* ---------- D42: one sum, one reader, and a write only where something reads it ---------- *
 *
 * The report was 「为什么窄屏和宽屏检视内部的滚动逻辑会不一样, 我认为这个是内部的逻辑, 应该要统一的」.
 * The honest answer splits three ways, and only one of them was a defect:
 *
 *   - the SCROLL MECHANISM was already one thing (`max-height` plus `overflow-y: auto`), and the
 *     header became the same after D41. Measured, both widths.
 *   - the EDGE each layout pins to cannot be unified, and unifying it re-opens D36: a sticky
 *     element pinned to the bottom and taller than the scrollport is dragged out of its grid row
 *     and in front of the ledger (897x858: dragged 7,471px, covering it at all sixteen stops).
 *   - the CEILING was computed twice, in two functions, from two different sources. That was the
 *     defect, and these are the three assertions that say so.
 *
 * The third one is the important shape: every guard here covers one side or the other, and none
 * of them ever covered the RELATION between the two. So the common sum could drift and stay green.
 */
assert('both ceilings subtract their reserve from one shared sum, not from their own copy of it',
  !!underPinsFn && !!applyFn && !!syncFn
  && /window\.innerHeight\s*-\s*band\s*-\s*overview/.test(underPinsFn)
  && /inspectorUnderPins\(\)/.test(applyFn) && /inspectorUnderPins\(\)/.test(syncFn)
  // …and neither caller may still be doing the arithmetic itself. This pair is the teeth:
  // without it, adding the helper while leaving the old expressions in place would pass everything
  // above and leave the drift exactly where it was.
  && !/innerHeight\s*-\s*band\s*-\s*overview/.test(applyFn)
  && !/innerHeight\s*-\s*band\s*-\s*overview/.test(syncFn));

// One reader of the two measured strips for a ceiling. Measured at 1600x900: --inspector-full-h
// stood at 540px while the panel was being capped at 753px by a different variable, so the number
// that looked like the truth governed nothing.
const bandReaders = (jsHtml.match(/getPropertyValue\(\s*'--sticky-band-h'\s*\)/g) || []).length;
const overviewReaders = (jsHtml.match(/getPropertyValue\(\s*'--sticky-overview-h'\s*\)/g) || []).length;
assert('one place reads the measured strips when it needs a ceiling',
  bandReaders === 1 && overviewReaders === 1
  && !!underPinsFn && /getPropertyValue\(\s*'--sticky-band-h'\s*\)/.test(underPinsFn));

// Each variable is written only in the layout whose rules read it. Both writers used to write on
// both sides, which meant that at every width exactly one ceiling was live and the others were
// numbers nobody was reading. The predicate is the shipped dock query, not a hard-coded width.
assert('each ceiling is written only in the layout whose rules read it',
  !!applyFn && !!syncFn
  && /if \(dom\.inspectorPanel && narrow\)/.test(applyFn)
  && /if \(!window\.matchMedia\(INSPECTOR_DOCK_QUERY\)\.matches\)/.test(syncFn)
  // …and neither writer touches the other layout's variables at all, which is the other half of
  // 「only where something reads it».
  && !/--inspector-wide-h/.test(applyFn)
  && !/--inspector-(full|dock)-h/.test(syncFn));

/* ---------- D27: the grip had every property right and was still invisible ---------- */
//
// On 2026-10-13 the reviewer reported 「刚才说的支持resize，没做」 and he was right. The grip had shipped
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

// the open question: 「窗口的高度和 检视的完整高度, 取最大还是最小?」 Answer: the smaller one — and
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
// The base rule is in the list now, and that is the whole point of D32: it used to be excluded on
// the grounds that flow is 「the one place where 完全显示 means uncapped」, which is exactly the
// claim that shipped the defect. The rule below is that sticky and cap travel together.
const allPanelSels = ['#inspector-panel', '#inspector-panel.is-inspector-docked', '#inspector-panel.is-inspector-full'];
assert('every state the panel can be in carries a cap',
  allPanelSels.every((s) => narrow && valueIn(narrow, s, 'max-height') !== null)
  && allPanelSels.some((s) => narrow && varsRead(valueIn(narrow, s, 'max-height') || '').has('--inspector-dock-h')));
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