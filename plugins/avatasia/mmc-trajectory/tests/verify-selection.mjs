/**
 * The inspector has to describe the table the reader is looking at.
 *
 * Selecting a record and then changing a filter used to leave the inspector pointing at a record
 * that was no longer in the table: the ledger read 已显示 2 条, the inspector still showed the row
 * that had been picked, and no row anywhere carried the selection mark. Two functions decided what
 * "selected" meant and they read different lists — the rows were built from `visibleEntries()`, the
 * selection was checked against `state.flat`, the whole session with nothing filtered out of it.
 *
 * The fix is not a second check bolted onto the poll path. `revealSelection()` is handed the very
 * array the rows are built from and is called from `renderLedger()`, which is the one exit every
 * path that changes what the table shows goes through — nine of them call it directly instead of
 * calling render().
 *
 * It is checked by *running* revealSelection() against a `state` that carries both the unfiltered
 * session and the filtered list, so a version that reads the unfiltered one again produces the
 * wrong answer here rather than looking plausible.
 *
 * mutate-selection.py breaks each of these in the shipped file and requires this guard to catch it
 * with the right reason, so a rule nothing tests cannot be added here.
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

/* ---------- the behaviour, run ---------- */

const rec = (id) => ({ record: { id } });

/**
 * Run revealSelection(entries) against a state that also carries `flat` — the unfiltered session —
 * so a version that reads `flat` instead of its argument runs to a wrong answer rather than
 * throwing, and the failure below is a decision rather than a crash.
 */
function reveal({ selectedId, limit, entries, flat }) {
  const state = { selectedId, limit, flat: flat ?? entries };
  const sandbox = { state };
  vm.createContext(sandbox);
  const src = functionSource('revealSelection');
  if (!src) return { error: 'revealSelection is not in the shipped script' };
  try {
    vm.runInContext(src, sandbox);
    var dropped = sandbox.revealSelection(entries);
  } catch (error) {
    return { error: String(error && error.message) };
  }
  return { selectedId: state.selectedId, limit: state.limit, dropped: dropped === true, error: null };
}

// Ten rows survive the filter; five more exist in the session but were filtered out. The selected
// record is row 3 — present in the table, and three rows from the end of the *session* rather than
// of the table.
const rows = Array.from({ length: 10 }, (_, i) => rec('r' + i));
const hidden = Array.from({ length: 5 }, (_, i) => rec('hidden' + i));
const session = rows.concat(hidden);

// The bug: the record is in the session and gone from the table.
const gone = reveal({ selectedId: 'hidden0', limit: 10, entries: rows, flat: session });
assert('a record the filter removed loses its selection',
  gone.error === null && gone.selectedId === null && gone.dropped === true);

// The normal case: still in the table, still selected, window untouched.
const kept = reveal({ selectedId: 'r3', limit: 10, entries: rows, flat: session });
assert('a record still in the table keeps its selection',
  kept.error === null && kept.selectedId === 'r3' && kept.limit === 10 && kept.dropped === false);

// Below the window. `needed` has to be counted over the table, not the session: counting over the
// session would reach for 12 rows when 8 are enough, and the window bar would claim 4 of them are
// hidden when they were filtered out rather than scrolled off.
const widened = reveal({ selectedId: 'r2', limit: 3, entries: rows, flat: session });
assert('the window is pulled down to a selection below it, counted over the table',
  widened.error === null && widened.selectedId === 'r2' && widened.limit === 8);

const none = reveal({ selectedId: null, limit: 10, entries: rows, flat: session });
assert('no selection means nothing to reveal',
  none.error === null && none.selectedId === null && none.dropped === false);

// Clearing the id is half the answer. Nine writers reach the table through renderLedger() without
// going on to redraw the panel — the search box among them — so a judgement that drops the selection
// has to say so, and the exit has to act on it. Otherwise the panel goes on naming the record that
// was just dropped while no row carries the mark: the page contradicting itself again, one layer
// further along.
assert('dropping the selection is reported so the panel can be redrawn',
  /function revealSelection\(entries\)[\s\S]*?state\.selectedId = null;\s*\n\s*return true;/.test(
    functionSource('revealSelection') ?? ''));

// An empty table is the same verdict as a filtered-out record, reached by a different route.
const empty = reveal({ selectedId: 'r0', limit: 10, entries: [], flat: session });
assert('a table with nothing in it clears the selection',
  empty.error === null && empty.selectedId === null && empty.dropped === true);

/* ---------- where it is called from ---------- */

const ledgerSrc = functionSource('renderLedger');
const ledgerBody = ledgerSrc ? ledgerSrc.slice(ledgerSrc.indexOf('{') + 1, ledgerSrc.lastIndexOf('}')) : '';
const ledgerCalls = ledgerBody.match(/revealSelection\(/g) ?? [];
assert('the selection is re-judged at the one exit every filter passes through', ledgerCalls.length === 1);

// Judged against the array the rows are built from, and before it is windowed: raising `limit` after
// the slice would reveal a row that was never drawn and leave the window bar counting a window
// that is not the one on screen.
const atMatched = ledgerBody.indexOf('var matched = visibleEntries();');
const atReveal = ledgerBody.indexOf('revealSelection(matched)');
// The slice is `var windowed`: it reads `state.limit` to decide what is on screen, so a selection
// judged after that line raised the limit too late to be counted.
const atSlice = ledgerBody.indexOf('var windowed');
assert('the re-judgement runs against the rows, before the window is sliced',
  atMatched >= 0 && atReveal > atMatched && atSlice > atReveal);

// The poll path used to be the only caller, which is precisely why a local filter change — none of
// which go through applyPayload — never touched it.
const payloadSrc = functionSource('applyPayload');
assert('the poll path does not judge the selection a second time',
  !!payloadSrc && !/revealSelection\(/.test(payloadSrc));

// The argument is a parameter, not a re-read of the page. A version that recomputes the list inside
// the function can be handed one list and judge another.
assert('the list to judge against is an argument rather than a second read',
  !!functionSource('revealSelection') && /function revealSelection\(entries\)/.test(functionSource('revealSelection')));

// And the ledger really does build its rows from visibleEntries(), which is what makes "the same
// list" a fact about the page rather than an intention in a comment.
assert('the rows on screen are built from the same list',
  atMatched >= 0 && /var windowed = matched\.length > state\.limit/.test(ledgerBody));

// Clearing the id is half the answer. Nine writers reach the table through renderLedger() without
// going on to redraw the panel — the search box, the type axis and the overview brush among them —
// so a judgement that drops the selection has to be acted on here. Otherwise the panel goes on
// naming the record that was just dropped while no row carries the mark: the page contradicting
// itself again, one layer further along. This is the half that is easy to miss, because the state
// is correct after the judgement and only the DOM is stale.
assert('the panel is redrawn when the selection is dropped',
  /if\s*\(\s*revealSelection\(matched\)\s*\)\s*renderInspector\(\);/.test(ledgerBody));

console.log('[selection] ' + pass + ' passed, ' + failures.length + ' failed');
for (const [label, run] of Object.entries({ gone, kept, widened, none, empty })) {
  if (run.error) console.log('  ' + label + ' threw: ' + run.error);
}
if (failures.length) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('[selection] OK');