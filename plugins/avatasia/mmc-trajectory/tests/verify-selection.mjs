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
 * What changed since, and why (docs/LAYERS.md D13): it used to be judged *before* the window was
 * sliced, and it used to raise `state.limit` to reach a selection sitting below the window. Two
 * things were wrong with that. The window became something the inspector could widen, so pressing
 * 「显示最新 200 条」 left the bar promising 200 条 and then, a second later, 15,224 条 — the
 * reader's own click contradicted the number on screen. And `state.limit` had two writers: the
 * window controls, and a judgement. Every other two-writer defect in this client has had that
 * shape.
 *
 * So the judgement is now a predicate over the rows that will actually be drawn, and it writes
 * `state.selectedId` and nothing else. A selection below the window is *dropped*, not revealed:
 * the reader's explicit window choice outranks an earlier click, and it matches what the filter
 * axes already do.
 *
 * It is checked by *running* revealSelection() against a `state` that carries both the unfiltered
 * session and the filtered list, so a version that reads the unfiltered one again produces the
 * wrong answer here rather than looking plausible — and the same run asserts that `state.limit`
 * comes out untouched, which is the half that used to be silently wrong.
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
 * throwing, and the failure below is a decision rather than a crash. `limit` comes back out too:
 * the judgement is allowed to end with the window exactly where it found it.
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

// Below the window. This is the reported defect: the reader had an old record selected in 全部,
// pressed 「显示最新 200 条」, the record left the table and the inspector went on naming it.
//
// It used to be answered by widening the window to reach the selection — which is why pressing
// 显示最新 200 条 could leave the bar reading 「已显示 15,224 条」 a second after promising 200.
// The selection is dropped instead, and the window is left exactly where the reader put it.
const belowWindow = reveal({ selectedId: 'r2', limit: 3, entries: rows.slice(7), flat: session });
assert('a selection below the window is dropped, and the window is left alone',
  belowWindow.error === null && belowWindow.selectedId === null
  && belowWindow.limit === 3 && belowWindow.dropped === true);

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

// One writer per field. `state.limit` belongs to the window controls — setWindowMode,
// resetWindowMode, the 「向上加载更早的 N 条」 button and rePinWindow — and a judgement that also
// moves it makes it a second writer, which is the shape every two-writer defect in this file has
// taken. Asserted on the source rather than on the run above, because a version that reaches for
// the window through some route other than `state.limit` would still pass the behaviour check.
const revealSrc = functionSource('revealSelection') ?? '';
assert('the judgement never touches the window',
  revealSrc.length > 0 && !/\blimit\b/.test(revealSrc));

// An empty table is the same verdict as a filtered-out record, reached by a different route.
const empty = reveal({ selectedId: 'r0', limit: 10, entries: [], flat: session });
assert('a table with nothing in it clears the selection',
  empty.error === null && empty.selectedId === null && empty.dropped === true);

/* ---------- where it is called from ---------- */

const ledgerSrc = functionSource('renderLedger');
const ledgerBody = ledgerSrc ? ledgerSrc.slice(ledgerSrc.indexOf('{') + 1, ledgerSrc.lastIndexOf('}')) : '';
const ledgerCalls = ledgerBody.match(/revealSelection\(/g) ?? [];
assert('the selection is re-judged at the one exit every filter passes through', ledgerCalls.length === 1);

// Judged against the rows the table will actually draw, and after they are sliced. Judging the
// filtered list would leave a selection standing on a record that survived the filters and was
// still cut off by the window — the same page-contradicts-itself defect, one layer further in.
const atMatched = ledgerBody.indexOf('var matched = visibleEntries();');
const atSlice = ledgerBody.indexOf('var windowed');
const atReveal = ledgerBody.indexOf('revealSelection(windowed)');
assert('the re-judgement runs against the rows the table will actually draw',
  atMatched >= 0 && atSlice > atMatched && atReveal > atSlice);

assert('the selection is judged against the window, not the filter result',
  /revealSelection\(windowed\)/.test(ledgerBody) && !/revealSelection\(matched\)/.test(ledgerBody));

// The poll path used to be the only caller, which is precisely why a local filter change — none of
// which go through applyPayload — never touched it.
const payloadSrc = functionSource('applyPayload');
assert('the poll path does not judge the selection a second time',
  !!payloadSrc && !/revealSelection\(/.test(payloadSrc));

// The argument is a parameter, not a re-read of the page. A version that recomputes the list inside
// the function can be handed one list and judge another.
assert('the list to judge against is an argument rather than a second read',
  !!revealSrc && /function revealSelection\(entries\)/.test(revealSrc));

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
  /if\s*\(\s*revealSelection\(windowed\)\s*\)\s*renderInspector\(\);/.test(ledgerBody));

console.log('[selection] ' + pass + ' passed, ' + failures.length + ' failed');
for (const [label, run] of Object.entries({ gone, kept, belowWindow, none, empty })) {
  if (run.error) console.log('  ' + label + ' threw: ' + run.error);
}
if (failures.length) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('[selection] OK');
