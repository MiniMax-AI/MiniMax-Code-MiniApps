/**
 * A window too large for one frame has to stop being a frozen page.
 *
 * The defect: pressing 「显示全部」 on an 18,924-row session put every row into the ledger inside a
 * single synchronous loop. Measured on this machine, that is about 3,956 ms of main thread during
 * which the page answers nothing, with no indication that anything was happening. The reader's
 * only evidence was that clicking had not worked yet.
 *
 * The fix does not change what 「显示全部」 promises — every record is still shown. It changes how
 * many rows are built before the browser gets the thread back, and it says so while it does it.
 * See docs/LAYERS.md D12, which also records the `content-visibility: auto` alternative that was
 * measured (3,956 ms → 979 ms) and rejected: its `contain-intrinsic-size` is one number for a
 * distribution spanning 2,667 px to 29,754 px, so the scrollbar it produces does not describe the
 * page.
 *
 * Four things have to hold together, and each one is a way this can go wrong on its own:
 *
 *   1. The frame is actually handed back. A loop that recurses synchronously instead of through
 *      requestAnimationFrame is the original defect wearing a batch.
 *   2. A new exit retires the build in flight. Ten writers change "what the table shows"; two
 *      loops appending to one ledger is how the page ends up with two tables interleaved.
 *   3. Progress is reported through the one writer of that count. setLedgerProgress() reaching for
 *      the node itself is the two-writers defect D8 exists to prevent, one layer in.
 *   4. A poll never replaces a table that is still being built, and the tick it holds back is
 *      actually run afterwards. The build takes longer than the poll interval, so this is not a
 *      theoretical concern; and a deferral that is never flushed is a silently dropped refresh.
 *
 * The batch size is checked for the property that makes it terminate rather than for the value that
 * was measured: a batch of zero groups never advances `built`, so the loop would re-schedule itself
 * every frame forever. 25 is what the measurement gave; 1 is what correctness requires.
 *
 * mutate-ledger-batch.py breaks each of these in the shipped file and requires this guard to fail
 * by name.
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

/** The body of a top-level `function name(...)`, braces matched. */
function functionBody(name) {
  const at = html.indexOf('function ' + name + '(');
  if (at < 0) return null;
  const open = html.indexOf('{', at);
  let depth = 0;
  for (let j = open; j < html.length; j += 1) {
    if (html[j] === '{') depth += 1;
    else if (html[j] === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(open + 1, j);
    }
  }
  return null;
}

/** The body of the nested `function buildStep()` inside renderLedger. */
function buildStepBody() {
  const ledger = functionBody('renderLedger');
  if (!ledger) return null;
  const at = ledger.indexOf('function buildStep()');
  if (at < 0) return null;
  const open = ledger.indexOf('{', at);
  let depth = 0;
  for (let j = open; j < ledger.length; j += 1) {
    if (ledger[j] === '{') depth += 1;
    else if (ledger[j] === '}') {
      depth -= 1;
      if (depth === 0) return ledger.slice(open + 1, j);
    }
  }
  return null;
}

const ledger = functionBody('renderLedger');
const step = buildStepBody();

assert('the ledger exit still exists and the batch step is declared inside it',
  !!ledger && !!step);

/* ---------- 1. the frame is handed back ---------- */

assert('the build hands the frame back between batches',
  !!step && /window\.requestAnimationFrame\(buildStep\);/.test(step));

// Not merely present — reached only when there is more to build. A rAF outside the "is there more"
// test costs every window, including the default 200-row one, a frame it never needed to spend.
const moreBlock = step && step.indexOf('if (build.at < groups.length)');
const rafAt = step && step.indexOf('window.requestAnimationFrame(buildStep);');
assert('a window that fits in one batch does not spend a frame',
  moreBlock >= 0 && rafAt > moreBlock
  && step.slice(moreBlock, step.indexOf('}', moreBlock) + 1).includes('requestAnimationFrame'));

/* ---------- the promise is unchanged ---------- */

// LEDGER_BATCH_GROUPS gates how much runs per frame. It must not gate how much exists: the loop's
// progress bound is the group count, and the batch size is a second, narrower term beside it.
assert('显示全部 still means every record: the batch size is not a cap',
  !!step && /while \(build\.at < groups\.length && built < LEDGER_BATCH_GROUPS\)/.test(step));

assert('the batch always advances its cursor',
  !!step && /build\.at \+= 1;/.test(step));

// A batch of zero groups never increments `built`, so the loop would re-schedule itself on every
// frame forever and the page would spin instead of building. Correctness needs 1; the measurement
// chose 25.
const batchDecl = /var LEDGER_BATCH_GROUPS = (\d+);/.exec(html);
assert('the batch is at least one group',
  !!batchDecl && Number(batchDecl[1]) >= 1);

/* ---------- 2. a new exit retires the build in flight ---------- */

assert('every pass through the exit retires the build in flight',
  !!ledger && (ledger.match(/ledgerBuildToken \+= 1;/g) ?? []).length === 1);

// The bump has to precede the line that *records* the new build's token. If it came after, the
// build would be handed the token the previous build was still using, and two concurrent builds
// would compare equal — the exact interleaving the token exists to prevent.
const bumpAt = ledger && ledger.indexOf('ledgerBuildToken += 1;');
const claimAt = ledger && ledger.indexOf('var build = { token: ledgerBuildToken');
assert('the exit retires the old build before the new one claims a token',
  bumpAt >= 0 && claimAt >= 0 && bumpAt < claimAt);

// And it has to sit above `clear(ledger)`, not merely somewhere earlier in the function. Four
// early returns sit between them — loading, hard error, no payload, no sessions — and each of
// them clears the ledger too. A bump below them means a pass that returned early retired
// nothing, so the previous build stayed alive and went on appending turn groups into whatever
// that pass had put there. Counting one bump in the source cannot see that; counting the
// returns between the two lines can. See docs/LAYERS.md D14.
const clearAt = ledger && ledger.indexOf('clear(ledger);');
const between = bumpAt >= 0 && clearAt > bumpAt ? ledger.slice(bumpAt, clearAt) : '';
assert('no early return sits between the token bump and the clear it precedes',
  !!between && !/\breturn;/.test(between));

assert('a build whose exit has been replaced stops without appending',
  !!step && /if \(build\.token !== ledgerBuildToken\) return;/.test(step));

// The check has to come first. A version that appended one more batch before testing would put a
// section into a ledger that renderLedger() had already emptied — rows appearing in a table that
// does not exist yet.
assert('the token is tested before the first row is built',
  !!step && step.indexOf('if (build.token !== ledgerBuildToken) return;')
  < step.indexOf('while (build.at < groups.length'));

/* ---------- 3. one writer of the count ---------- */

const setProgress = functionBody('setLedgerProgress');
const updateBar = functionBody('updateWindowBar');

assert('progress is reported through the one writer of the count',
  !!setProgress && /updateWindowBar\(/.test(setProgress)
  && !/textContent/.test(setProgress) && !/window-count/.test(setProgress));

assert('the window bar count has exactly one writer',
  !!updateBar && (updateBar.match(/parts\.count\.textContent =/g) ?? []).length === 2
  && (html.match(/parts\.count\.textContent =/g) ?? []).length === 2);

// Two because updateWindowBar reports two states, and both have to be honest. Mid-build the bar
// must not claim 已显示 for rows that do not exist yet — the count promising a table that is not
// there is the same defect D8 was written for.
assert('the mid-build count reports rows built, not rows promised',
  !!updateBar && /正在显示 ' \+ formatInt\(ledgerProgress\.rows\)/.test(updateBar)
  && /\/ ' \+ formatInt\(ledgerProgress\.total\)/.test(updateBar));

assert('progress cannot outlive the build',
  !!step && /setLedgerProgress\(null\);/.test(step));

assert('a settled window is not reported as mid-build',
  !!updateBar && /if \(ledgerProgress\) \{[\s\S]*?return;\n        \}/.test(updateBar));

/* ---------- 4. the poll defers, and the deferral is not swallowed ---------- */

const pollSrc = functionBody('startPolling');
assert('a poll never replaces a table that is still being built',
  !!pollSrc && /if \(ledgerBuilding\(\)\) \{/.test(pollSrc)
  && /pollDeferred = true;/.test(pollSrc)
  && /return;/.test(pollSrc));

// The deferral has to be cleared before the fetch, or every flush would re-arm itself and the
// page would poll once per frame instead of once per 2.5 s.
const flush = functionBody('flushDeferredPoll');
assert('the held-back poll is run once, and only once',
  !!flush && flush.indexOf('pollDeferred = false;') >= 0
  && flush.indexOf('pollDeferred = false;') < flush.indexOf('fetchTrajectory(false);'));

assert('the held-back poll is not swallowed at the end of a build',
  !!step && /flushDeferredPoll\(\);/.test(step));

// One source of truth. A separate "is a build running" flag is a second thing that has to agree
// with the progress flag, and the day it stops agreeing the poll starts replacing tables that are
// still being built while the bar still says they are.
assert('the in-flight flag is derived from the progress, not a second variable',
  /function ledgerBuilding\(\) \{\s*return ledgerProgress !== null;\s*\}/.test(html)
  && (html.match(/var\s+ledgerBuilding\b/g) ?? []).length === 0);

// The finishing path, in order. restoreRowAnchor moves the page, so measuring before it would pin
// the strips against a scroll position the reader is no longer at; verify-sticky.mjs pins that
// same ordering and its own mutations break it.
if (step) {
  const atRestore = step.indexOf('restoreRowAnchor(anchor, scrollY);');
  const atFlush = step.indexOf('flushDeferredPoll();');
  const atMeasure = step.lastIndexOf('syncStickyOffsets();');
  assert('the finishing path anchors, then flushes, then measures',
    atRestore >= 0 && atFlush > atRestore && atMeasure > atFlush);
}

console.log('[ledger-batch] ' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('[ledger-batch] OK');
