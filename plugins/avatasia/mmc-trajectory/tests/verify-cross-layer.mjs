/**
 * R6: a control may sit in one layer and write another, but the pair has to be declared.
 *
 * Two places on this page do that, and neither used to say so anywhere in the code:
 *
 *   1. `#window-bar` lives *inside* the ledger panel (L5) but writes the L3 render projection —
 *      how many rows are on screen. It changes nothing about which records are selected.
 *   2. `#overview` is the L3 projection, and it *also* holds a control that writes an L2 field,
 *      `state.overviewSelection` — the brushed time range the base filter reads.
 *
 * Those are the whole exceptions. Everything else is where it looks like it is, which is why the
 * rule is a declaration and not a prohibition. The cost of not writing them down is concrete:
 * a reader — or the next change — reads position as ownership, and a control that "clearly
 * belongs to the filter" gets moved, and the layer it writes stops being obvious.
 *
 * What this guard checks is the *pair*, not the tidiness: the DOM parent says which layer the
 * control is presented in, and the assignments say which layer it writes. Change either half
 * without declaring it and the pairing stops holding, which is exactly when the document's
 * claim becomes false.
 *
 * What this guard deliberately does NOT check: R5, the claim that L3 writes L2 through exactly
 * one setter. That is a real defect and it is not closed — `state.overviewSelection` has five
 * writers today (`clearOverviewSelection`, `setActualDuration`, `onOverviewPointerMove`,
 * `onOverviewPointerUp`, `resetBaseFilters`). Asserting a convergence that has not happened
 * would be a guard that cannot pass; asserting the current count would be a guard that cannot
 * fail. See docs/LAYERS.md R5 / D4.
 *
 * mutate-cross-layer.py breaks each rule below in the shipped file and requires this guard to
 * report it by name.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HTML = fileURLToPath(new URL('../miniapp/client/index.html', import.meta.url));
const html = readFileSync(HTML, 'utf8');

let pass = 0;
const failures = [];
function assert(name, cond) {
  if (cond) pass += 1;
  else failures.push(name);
}

/** Brace-matched body of a top-level `function name(` declaration. */
function functionSource(name) {
  const at = html.indexOf('function ' + name + '(');
  if (at < 0) return null;
  let depth = 0;
  for (let j = html.indexOf('{', at); j < html.length; j += 1) {
    if (html[j] === '{') depth += 1;
    else if (html[j] === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(at, j + 1);
    }
  }
  return null;
}

/** The inner HTML of the ledger panel — the L5 container the window bar is presented in. */
function ledgerPanelHtml() {
  const open = html.indexOf('<section class="panel" aria-labelledby="ledger-heading">');
  if (open < 0) return null;
  const close = html.indexOf('</section>', open);
  if (close < 0) return null;
  return html.slice(open, close);
}

/** Any `state.<field> =` assignment in a body. Reads like `state.x === y` are not writes. */
function stateWrites(src) {
  if (!src) return [];
  const out = [];
  const re = /state\.(\w+)\s*=(?!=)/g;
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

// ---------------------------------------------------------------- declaration 1: window-bar

// It is presented inside the ledger panel. Moving it out is a move to another layer, which is
// allowed — but then the declaration above stops being true and this guard is where that shows.
{
  const panel = ledgerPanelHtml();
  assert('the ledger panel exists to contain anything', panel !== null);
  assert('#window-bar is presented inside the ledger panel (L5)',
    panel !== null && panel.indexOf('id="window-bar"') >= 0);
}

// It writes the L3 render projection and nothing else: two module-level fields, no `state.*`.
{
  const src = functionSource('updateWindowBar');
  assert('updateWindowBar exists', src !== null);
  const writes = stateWrites(src);
  assert('updateWindowBar writes no state.* field (it is L3, not L2)',
    writes.length === 0);
}

// setLedgerProgress is the second writer into the same bar. Two writers is already the shape D8
// warned about; what D8 needs is for them to be in the same layer, which is what this asserts.
{
  const src = functionSource('setLedgerProgress');
  assert('setLedgerProgress exists', src !== null);
  const writes = stateWrites(src);
  assert('setLedgerProgress writes no state.* field either', writes.length === 0);
}

// The converse, and the reason declaration 1 exists at all: a control presented in L5 must not
// quietly reach back into L2. The brushed range is the one L2 field the overview owns.
{
  const bar = functionSource('updateWindowBar') || '';
  const progress = functionSource('setLedgerProgress') || '';
  assert('neither window-bar writer touches state.overviewSelection',
    bar.indexOf('state.overviewSelection') < 0 && progress.indexOf('state.overviewSelection') < 0);
}

// ---------------------------------------------------------------- declaration 2: overview

// It is its own section, not a panel — the visual language already says it is not part of the
// ledger, so nothing in the layout is carrying the declaration for it.
{
  assert('#overview is its own section rather than a panel',
    /<section class="overview" id="overview"/.test(html));
}

// The control it holds writes an L2 field. `onOverviewPointerUp` is where a brush lands, so it
// is the write that has to keep happening.
{
  const up = functionSource('onOverviewPointerUp');
  assert('onOverviewPointerUp exists', up !== null);
  assert('the overview brush still writes state.overviewSelection on landing',
    up !== null && /state\.overviewSelection\s*=(?!=)/.test(up));
}

// And that field really is L2: the visibility entry point reads it. If the filter stopped
// reading it, the overview would be writing a field nothing filters on, and declaration 2
// would be describing a control that does nothing.
{
  const visible = functionSource('visibleEntries');
  assert('visibleEntries exists', visible !== null);
  assert('the L2 visibility entry point reads state.overviewSelection',
    visible !== null && /state\.overviewSelection/.test(visible));
}

// ---------------------------------------------------------------- reporting

for (const name of failures) console.log('FAIL ' + name);
console.log(pass + ' checks passed' + (failures.length ? ', ' + failures.length + ' FAILED' : ', ALL PASSED'));
process.exit(failures.length ? 1 : 0);
