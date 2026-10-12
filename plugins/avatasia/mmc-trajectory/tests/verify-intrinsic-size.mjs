/**
 * 「显示全部」把两万行建进 DOM 的代价，不能靠一个猜出来的数字压下去。
 *
 * `content-visibility: auto` is the whole win — it is what stops the browser laying out two
 * hundred thousand pixels of rows nobody is looking at. But it only comes with
 * `contain-intrinsic-size`, and that is a *number per group*, and a session's real turn heights
 * span 11× (p25 1,011 / median 2,631 / p75 6,627 / max 29,754 px). One written-down constant is
 * therefore a scrollbar that lies: it says the document is a fifth of its real height, the reader
 * scrolls, and the page grows under them. D12 measured that and rejected it.
 *
 * So the size is derived per group, from that group's own (rows, bands) and three heights
 * calibrated off real laid-out DOM. Three things follow, and all three are rules here:
 *
 *   1. The stylesheet must contain no `contain-intrinsic-size` at all. The only place one may be
 *      written is an inline style computed at runtime — a constant in CSS is the rejected version.
 *   2. `content-visibility` may only be switched on by the class, and only *after* the first batch
 *      has been laid out and measured. Turning it on earlier means calibrating against a skipped
 *      subtree, which is reading the prediction back.
 *   3. Every group ends up sized. A group left unsized collapses to nothing the instant the class
 *      goes on, and the scrollbar becomes shorter than the table it describes.
 *
 * The arithmetic is asserted by hand here — 39 + 100×36 + 2×38 = 3643 — not read back out of the
 * implementation, so a version that gets the formula wrong produces a different number rather than
 * a different-looking number.
 *
 * mutate-intrinsic-size.py breaks each rule in the shipped file and requires this guard to report
 * it, so a rule nothing tests cannot be added here.
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

/* ---------- 1. the stylesheet holds no number ---------- */

// Everything up to the first </style> is the stylesheet. A constant there is the rejected D12
// version wearing a different selector. Comments are stripped first: the rule is about a
// declaration, and naming the property in a comment that explains why there isn't one is not
// violating it — scanning the raw text would make this guard punish its own explanation.
const styleEnd = html.indexOf('</style>');
const cssRaw = styleEnd > 0 ? html.slice(0, styleEnd) : '';
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
assert('the stylesheet declares no contain-intrinsic-size',
  !!css && css.indexOf('contain-intrinsic-size') < 0);

const cssAt = css.indexOf('content-visibility');
assert('content-visibility is gated on the ledger class, not unconditional',
  cssAt >= 0 && /\.ledger-body\.is-skipping-offscreen \.turn-group\s*\{[^}]*content-visibility: auto/.test(css));

/* ---------- 2. calibration, and the class that depends on it ---------- */

const step = functionSource('buildStep');
assert('buildStep is in the shipped script', !!step);

// The row loop ends at its own `built += 1;`, not at the `if (build.at < groups.length)` that
// follows it — the calibration sits between the two, which is exactly the slot that has to be
// after "the first batch exists" and before "the class makes measuring impossible again".
const loopEnd = step && step.indexOf('built += 1;');
const calibAt = step && step.indexOf('if (!build.heights) {');
assert('the calibration runs after the first batch is built',
  loopEnd > 0 && calibAt > loopEnd);

// The class is what makes the heights unmeasurable, so writing it anywhere but inside the
// calibration guard means the next pass measures a prediction.
const classOn = step && step.indexOf("ledger.classList.add('is-skipping-offscreen')");
assert('the class is switched on inside the calibration guard, not before it',
  calibAt > 0 && classOn > calibAt && classOn < step.indexOf('if (build.at < groups.length) {', calibAt));

// Once is the point: recalibrating per batch would be measuring against a mix of real and skipped.
assert('the calibration happens once per build, not once per batch',
  (step.match(/if \(!build\.heights\) \{/g) ?? []).length === 1
  && (step.match(/classList\.add\('is-skipping-offscreen'\)/g) ?? []).length === 1);

/* ---------- 3. every group ends up sized ---------- */

const applyAt = step ? step.indexOf('applyIntrinsicSize(section') : -1;
const appendAt = step ? step.indexOf('ledger.appendChild(section)') : -1;
assert('a group is sized before it is appended, in the row loop',
  applyAt > 0 && appendAt > applyAt && applyAt < loopEnd);

// Anchored on the call's argument, not the bare name: the comment inside the loop explains that
// sizeBuiltGroup() covers the first batch, and a name-only anchor finds that sentence first.
const sizeFirst = step ? step.indexOf('sizeBuiltGroup(firstBatch[f])') : -1;
assert('the first batch, which existed before there was anything to predict from, is sized too',
  sizeFirst > calibAt);

/* ---------- the arithmetic, run ---------- */

/**
 * Run applyIntrinsicSize against a stub section and read back what it wrote. The three heights
 * below are the ones D12 measured on a real session (head 39, row 36, band 38 — the calibrated
 * values were 39.40 / 36 / 38.40, rounded here so the expected number is a whole number of CSS
 * pixels rather than a float this file would have to carry).
 */
function size(rows, bands, heights) {
  const style = {};
  const sandbox = { section: { style }, Math, JSON };
  vm.createContext(sandbox);
  const src = functionSource('applyIntrinsicSize');
  if (!src) return { error: 'applyIntrinsicSize is not in the shipped script' };
  try {
    vm.runInContext(src, sandbox);
    vm.runInContext('applyIntrinsicSize(section, ' + rows + ', ' + bands + ', ' +
      (heights ? JSON.stringify(heights) : 'null') + ');', sandbox);
    return { written: style.containIntrinsicSize, error: null };
  } catch (err) {
    return { error: String(err && err.message) };
  }
}

const H = { head: 39, row: 36, band: 38 };

// 39 + 100×36 + 0×38 = 3,639
assert('a group of 100 rows is sized at head + 100 rows',
  size(100, 0, H).written === 'auto 3639px');

// 39 + 98×36 + 2×38 = 39 + 3528 + 76 = 3,643
assert('compaction bands are counted at their own measured height',
  size(98, 2, H).written === 'auto 3643px');

// The `auto` keyword is what lets the browser prefer a size it has already rendered, so a reader
// who scrolls down and back does not accumulate drift. Without it this reads as a plain number.
assert('the size is remembered rather than frozen',
  /^auto \d+px$/.test(size(100, 0, H).written ?? ''));

// Before the calibration there is nothing to predict from, and writing a number anyway is how a
// group ends up sized from a constant.
//
// Both halves are asserted, and the first one matters: a version that drops the `if (!heights)`
// guard does not write a wrong number, it *throws* on `null.head`. Reading only the style would
// score that the same as correctly declining, which is the "CRASHED is not a catch" trap in
// METHODOLOGY.md — the guard would pass on a build that dies on the first batch.
const noHeights = size(100, 0, null);
assert('declining to size without heights is not a crash',
  !noHeights.error);
assert('nothing is written before the heights are known',
  noHeights.written === undefined);

assert('the derivation is not the rejected single constant',
  size(10, 0, H).written !== size(100, 0, H).written);

if (failures.length) {
  console.error(`[intrinsic-size] ${pass} passed, ${failures.length} failed`);
  for (const f of failures) console.error('  FAIL  ' + f);
  process.exit(1);
}
// "0 failed" on success is what mutate-intrinsic-size.py reads to decide the baseline is green.
console.log(`[intrinsic-size] ${pass} passed, 0 failed`);