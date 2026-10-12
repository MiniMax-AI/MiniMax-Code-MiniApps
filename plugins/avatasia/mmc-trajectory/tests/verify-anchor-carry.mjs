/**
 * The reader's scroll position has to survive a rebuild.
 *
 * There is no moment where it survives on its own. `renderLedger()` clears the ledger, which
 * takes the document from 716,000px to about 1,500px, and the browser clamps `scrollY` to match —
 * measured 715,080 → 616. The position only comes back at the end of the build, from
 * `restoreRowAnchor()`. So between the capture and the restore there is nothing, and every pass in
 * between has to carry the intent rather than re-read it.
 *
 * That is the whole defect. `buildStep()` stops at `if (build.token !== ledgerBuildToken) return;`
 * when it is superseded, so a superseded pass never reached the restore — and the pass that
 * replaced it captured its anchor from the wreckage. Measured: a click on any row that landed while
 * a poll build was in flight left the page on the first turn for good, because that is now what
 * the anchor said. See docs/LAYERS.md D14.
 *
 * The rule has two halves and both are checked here. The capture is *run* against a preset intent,
 * so a version that re-reads it produces a different answer rather than merely looking different.
 * The consumers are counted, because the half that was broken was a missing call on a path that
 * ends the ledger early.
 *
 * mutate-anchor-carry.py breaks each of these in the shipped file and requires this guard to
 * report it, so a rule nothing tests cannot be added here.
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

const ledger = functionSource('renderLedger');
assert('renderLedger is in the shipped script', !!ledger);

/* ---------- the capture, run ---------- */

/**
 * The three statements that decide what a pass anchors on, lifted out of renderLedger() and run
 * against an intent that is already set. `firstVisibleRow()` and `window.scrollY` are stubs that
 * report a *different* position from the preset one, so a capture that re-reads them returns the
 * stub's answer and the assertion below sees it. If the capture honours the intent it returns the
 * preset's, which is the behaviour that keeps the reader where they were.
 */
function capture({ preset, visible, scrollY }) {
  const sandbox = {
    pendingAnchor: preset,
    firstVisibleRow: () => visible,
    window: { scrollY, pageYOffset: 0 },
  };
  vm.createContext(sandbox);
  const at = ledger.indexOf('if (!pendingAnchor)');
  if (at < 0) return { error: 'the guarded capture is not in renderLedger' };
  const end = ledger.indexOf('var scrollY = pendingAnchor.y;', at);
  if (end < 0) return { error: 'the capture does not end where this guard expects' };
  const src = ledger.slice(at, end) + '\nanchor = pendingAnchor.row;\nscrollY = pendingAnchor.y;\n';
  try {
    return vm.runInContext(src + '({ anchor: anchor, scrollY: scrollY });', sandbox);
  } catch (err) {
    return { error: String(err && err.message) };
  }
}

const kept = capture({
  preset: { row: { id: 'anchor-1', top: 412 }, y: 715080 },
  visible: { id: 'anchor-9', top: -6 },
  scrollY: 616,
});

assert('a pass inside a chain re-uses the intent it was handed',
  !kept.error && kept.anchor && kept.anchor.id === 'anchor-1' && kept.anchor.top === 412);
assert('a pass inside a chain re-uses the pixel offset too, not the clamped one',
  !kept.error && kept.scrollY === 715080);

const fresh = capture({ preset: null, visible: { id: 'anchor-9', top: -6 }, scrollY: 616 });
assert('the first pass of a chain reads the live position',
  !fresh.error && fresh.anchor && fresh.anchor.id === 'anchor-9' && fresh.scrollY === 616);

/* ---------- one writer ---------- */

// `pendingAnchor` is nulled in exactly one place. Two writers is how the chain would learn to
// expect a promise it cannot keep — and this page has paid for a two-writer state field before
// (state.limit, see docs/LAYERS.md D13). The declaration is not a write; the lookbehind is what
// keeps `var pendingAnchor = null;` out of the count, since it contains the same nine characters.
const clears = (html.match(/(?<!var )pendingAnchor = null;/g) ?? []).length;
assert('pendingAnchor has one writer', clears === 1);

const forget = functionSource('forgetScrollAnchor');
assert('forgetScrollAnchor nulls it and does nothing else',
  !!forget && forget.replace(/\s+/g, ' ') === 'function forgetScrollAnchor() { pendingAnchor = null; }');

/* ---------- the consumers ---------- */

// restoreRowAnchor() is the one place a chain ends by restoring, so it is the one place that has to
// consume. Not calling it leaves the intent armed for whatever runs next.
const restore = functionSource('restoreRowAnchor');
assert('restoring consumes the intent',
  !!restore && restore.indexOf('forgetScrollAnchor();') >= 0
    && restore.indexOf('forgetScrollAnchor();') < restore.indexOf('if (anchor)'));

const forgetCalls = (html.match(/forgetScrollAnchor\(\);/g) ?? []).length;
assert('forgetScrollAnchor is called from both endings and nothing else',
  forgetCalls === 6); // 1 in restoreRowAnchor + 5 early returns

// The five early returns between the clear and the build: loading, hard error, no payload, no
// sessions, no matches. Each leaves the ledger holding a block rather than rows, so there is
// nothing to anchor to and the intent has to go. Carrying it would apply a position measured
// against one session or one filter to a different one.
if (ledger) {
  const from = ledger.indexOf('clear(ledger);');
  const to = ledger.indexOf('var groups = visibleTurns(');
  const head = from >= 0 && to > from ? ledger.slice(from, to) : '';
  const earlyReturns = (head.match(/^\s*return;$/gm) ?? []).length;
  const earlyForgets = (head.match(/forgetScrollAnchor\(\);/g) ?? []).length;
  assert('every early return after the clear drops the intent',
    earlyReturns > 0 && earlyReturns === earlyForgets);
}

// `firstVisibleRow()` and `window.scrollY` are how a pass could re-read a position that no longer
// describes anything. One call site each, both inside the guarded capture.
assert('the live position is read in exactly one place',
  !!ledger
    && (ledger.match(/firstVisibleRow\(\)/g) ?? []).length === 1
    && (ledger.match(/window\.scrollY/g) ?? []).length === 1);

if (failures.length) {
  console.error(`[anchor-carry] ${pass} passed, ${failures.length} failed`);
  for (const f of failures) console.error('  FAIL  ' + f);
  process.exit(1);
}
// "0 failed" on success is not decoration: mutate-anchor-carry.py reads this line to decide the
// baseline is green, and a guard whose success marker it cannot match makes the mutation run
// report every mutation as caught while it was in fact testing nothing.
console.log(`[anchor-carry] ${pass} passed, 0 failed`);