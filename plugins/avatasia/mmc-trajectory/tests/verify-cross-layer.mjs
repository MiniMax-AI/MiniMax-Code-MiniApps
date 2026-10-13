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
 * What this guard used NOT to check: R5, the claim that L3 writes L2 through exactly one setter.
 * `state.overviewSelection` had four writers (`dropOverviewSelection`, `setActualDuration`,
 * `onOverviewPointerMove`, `onOverviewPointerUp`), and a count of four is a guard that cannot fail
 * once the code is fixed while a count of one is a guard that cannot pass until it is. So the rule
 * was written down and left unchecked. The four are now one (`setOverviewSelection`) and the
 * convergence is asserted below, by enumeration rather than by count.
 *
 * What it *does* check about R5 is the part that is true and load-bearing: the two paths whose
 * job is to clear the field go through one writer. They used to assign it in two places, and one
 * of them — resetBaseFilters, the one the empty ledger's 「清除筛选」 reaches — was not clearing it
 * at all, which is a defect this guard now names rather than a count it merely records.
 *
 * Two assertions below were rewritten rather than deleted when the four writers became one, and
 * both rewrites are the same move: they still name the writer's JOB (a brush has to land somewhere,
 * the strip control still has to clear the range) and no longer name the spelling that is gone.
 * Deleting them would have dropped the requirement and kept the silence.
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
  // Off `htmlNoComments`, not off `html`. Reading the raw file here while the writer enumeration
  // below reads the stripped one put two views of the same file in one guard: a JSDoc block that
  // quotes the assignment it is describing would fail a per-function check and not the enumeration,
  // with nothing in between to explain the disagreement. Found by the MUST_STAY_GREEN case, which
  // added exactly such a comment and watched the count stay right while the name check went red.
  const at = htmlNoComments.indexOf('function ' + name + '(');
  if (at < 0) return null;
  let depth = 0;
  for (let j = htmlNoComments.indexOf('{', at); j < htmlNoComments.length; j += 1) {
    if (htmlNoComments[j] === '{') depth += 1;
    else if (htmlNoComments[j] === '}') {
      depth -= 1;
      if (depth === 0) return htmlNoComments.slice(at, j + 1);
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

// ----------------------------------------------------------------- the one writer (R5)

// The client with its comments stripped, for enumerating writers. A JSDoc block that quotes the
// line it is describing would otherwise be counted as a writer — and the comment above
// dropOverviewSelection() spent years describing `state.overviewSelection = null` in prose, which
// is exactly the shape that would make this assertion pass for the wrong reason.
//
// Only whole-line comments and block comments are removed, rather than every `//` up to end of line:
// this file contains `http://` inside strings, and a naive pass deletes the rest of those lines.
const htmlNoComments = html
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
  .join('\n');

/** Every `function name(` declaration with the byte range of its body. */
function functionRanges(source) {
  const out = [];
  const re = /function\s+(\w+)\s*\(/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const braceAt = source.indexOf('{', m.index);
    if (braceAt < 0) continue;
    let depth = 0;
    let end = -1;
    for (let j = braceAt; j < source.length; j += 1) {
      if (source[j] === '{') depth += 1;
      else if (source[j] === '}') {
        depth -= 1;
        if (depth === 0) { end = j; break; }
      }
    }
    if (end < 0) continue;
    out.push({ name: m[1], start: m.index, end });
  }
  return out;
}

/** The names of the functions that assign `state.<field>`, innermost declaration first. */
function writersOf(field, source = htmlNoComments) {
  const ranges = functionRanges(source);
  const names = [];
  const re = new RegExp('state\\.' + field + '\\s*=(?!=)', 'g');
  let m;
  while ((m = re.exec(source)) !== null) {
    // Innermost wins: a nested function's range is contained by its parent's, and only the one the
    // assignment textually sits inside is the one that writes it.
    let owner = null;
    for (const r of ranges) {
      if (m.index >= r.start && m.index <= r.end && (owner === null || r.end - r.start < owner.end - owner.start)) {
        owner = r;
      }
    }
    names.push(owner ? owner.name : '<outside any function>');
  }
  return names;
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

// The control it holds writes an L2 field. `onOverviewPointerUp` is where a brush lands, so it is
// the write that has to keep happening — through the one writer now, rather than by assignment.
{
  const up = functionSource('onOverviewPointerUp');
  assert('onOverviewPointerUp exists', up !== null);
  assert('the overview brush still writes state.overviewSelection on landing',
    up !== null && /setOverviewSelection\(\{/.test(up));
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

// ------------------------------------------------------- the one clear path that exists
// R5 wants exactly one writer for the L3→L2 field, and there is now one. What is asserted here is
// that the two paths whose *job* is to clear the field reach it rather than assigning it themselves.
// The negative half of each check matters as much as the positive one — a path that both calls the
// writer and assigns the field is the drift this started from, and only the negative catches it.
{
  const drop = functionSource('dropOverviewSelection');
  const clear = functionSource('clearOverviewSelection');
  const resetBase = functionSource('resetBaseFilters');
  const assignsItself = (src) => src !== null && /state\.overviewSelection\s*=[^=]/.test(src);

  assert('dropOverviewSelection exists and clears the field through the one writer',
    drop !== null && /setOverviewSelection\(null\);/.test(drop));
  assert('the strip control clears through it rather than through its own assignment',
    clear !== null && /dropOverviewSelection\(\);/.test(clear) && !assignsItself(clear));
  assert('and so does the base-filter reset, which is the one the empty ledger reaches',
    resetBase !== null && /dropOverviewSelection\(\);/.test(resetBase) && !assignsItself(resetBase));
}

// ---------------------------------------------------------------- the one writer, itself
//
// Enumerated rather than counted, because the count was the thing that could not be asserted: four
// is unassertable before the fix and unassertable after it. The set of NAMES is assertable at both
// ends, and it also names the offender in the failure detail, which a count cannot.
{
  const writers = writersOf('overviewSelection');
  assert('R5 holds: state.overviewSelection has exactly one writer and it is setOverviewSelection',
    writers.length > 0 && writers.every((n) => n === 'setOverviewSelection'),
    JSON.stringify(writers));
}

// The invariant the single writer exists to carry, which is also the part the four writers disagreed
// about: clearing the range has to disarm the gesture, because a brush in flight repaints the range
// on every pointer move. Two of the four did that and two did not; the setter has no way to forget.
{
  const setter = functionSource('setOverviewSelection');
  assert('setOverviewSelection exists', setter !== null);
  assert('clearing the range through the writer also disarms the brush in flight',
    setter !== null
    && /if \(value === null\) abortOverviewDrag\(\);/.test(setter)
    && /state\.overviewSelection = value;/.test(setter));
}

// A writer that the mode switch no longer goes through would still satisfy the two assertions above
// — the set would be {setOverviewSelection} and the field would have one owner. The convergence is
// only worth anything if every path that used to write still reaches it, so each one is named.
for (const name of ['dropOverviewSelection', 'setActualDuration', 'onOverviewPointerMove', 'onOverviewPointerUp']) {
  const src = functionSource(name);
  assert(name + ' reaches the field through the one writer',
    src !== null
    && /setOverviewSelection\(/.test(src)
    && !/state\.overviewSelection\s*=[^=]/.test(src),
    src === null ? 'function missing' : 'assigns the field itself or never reaches the writer');
}

// ---------------------------------------------------------------- reporting

for (const name of failures) console.log('FAIL ' + name);
console.log(pass + ' checks passed' + (failures.length ? ', ' + failures.length + ' FAILED' : ', ALL PASSED'));
process.exit(failures.length ? 1 : 0);
