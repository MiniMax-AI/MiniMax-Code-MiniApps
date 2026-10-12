/**
 * The anomaly axis is one thing, so it is one field.
 *
 * It used to be three top-level fields — `anomalyRules`, `multiAnomaly`, `anomalyLast` — which
 * meant that "no rule is on" had to be re-derived from three places and that turning one of them
 * off without the other two read as a different state rather than as a bug. That is D5: the
 * coordination had to live in call order, because there was no shared model for the coordination
 * to live in.
 *
 * This guard checks the *shape* of that model, and it is deliberately narrow about what it will
 * accept: the three names must be gone from the shipped file entirely (not aliased, not kept in
 * parallel), the object must declare all three keys at once, and each of the three must be
 * written exactly as many times as the old fields were. That last part is the load-bearing one —
 * collapsing three fields into an object must not quietly become a second writer for any of them.
 *
 * The counts below are counted by hand from the three-level version, not read out of the file.
 * The three-level version wrote:
 *
 *   anomalyRules =  4   onAnomalyRuleClick · onAnomalyMultiChange · onAnomalyReset · clearFilters
 *   anomalyLast  =  7   onAnomalyRuleClick x4 · onAnomalyMultiChange · onAnomalyReset · clearFilters
 *   multiAnomaly =  3   onAnomalyMultiChange · onAnomalyReset · clearFilters
 *
 * ...which is 14 assignments spread over three names, two of which (clearFilters and
 * onAnomalyReset) were writing all three to the same defaults. Collapsing the fields lets those
 * two become one whole-object assignment each, so the expected counts are:
 *
 *   state.anomaly = defaultAnomaly()  2   onAnomalyReset · clearFilters
 *   state.anomaly.rules =             2   onAnomalyRuleClick · onAnomalyMultiChange
 *   state.anomaly.last  =             5   onAnomalyRuleClick x4 · onAnomalyMultiChange
 *   state.anomaly.mode  =             1   onAnomalyMultiChange
 *
 * Every writer in the old version still has exactly one writer here. Nothing was merged away
 * except the duplication, which is the point.
 *
 * What this guard does NOT check is that the anomaly axis and the base filters stay mutually
 * exclusive — that is D5's other half and it is still open; see docs/LAYERS.md Stage 2.
 *
 * mutate-anomaly-model.py breaks each rule below in the shipped file and requires this guard to
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

/** Occurrences of a literal, not lines containing it. */
function countOf(needle) {
  let n = 0;
  let i = html.indexOf(needle);
  while (i >= 0) {
    n += 1;
    i = html.indexOf(needle, i + needle.length);
  }
  return n;
}

/**
 * Assignments to `field`, excluding `===`.
 *
 * The plain `field =` count is wrong for any field that is also compared: `state.anomaly.mode ===`
 * contains `state.anomaly.mode =`, so a substring count reports three readers as three writers.
 */
function countAssign(field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (html.match(new RegExp(escaped + '\\s*=(?!=)', 'g')) || []).length;
}

/** The `anomaly: { ... }` literal inside the state declaration. */
function anomalyDeclaration() {
  const at = html.indexOf('anomaly: {');
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

// ------------------------------------------------------------- the old names are gone

// Not "kept in sync" — gone. A parallel alias would leave two answers to 「异常轴现在是什么状态」,
// which is the whole defect.
assert('the old field state.anomalyRules is gone', countOf('state.anomalyRules') === 0);
assert('the old field state.multiAnomaly is gone', countOf('state.multiAnomaly') === 0);
assert('the old field state.anomalyLast is gone', countOf('state.anomalyLast') === 0);

// ------------------------------------------------------------- the new field declares all three at once

{
  const decl = anomalyDeclaration();
  assert('state declares anomaly as one object', decl !== null);
  if (decl !== null) {
    assert('the anomaly object declares mode', /\bmode\s*:/.test(decl));
    assert('the anomaly object declares rules', /\brules\s*:/.test(decl));
    assert('the anomaly object declares last', /\blast\s*:/.test(decl));
    // 单选 is what the axis opens in; a multi-union axis as the default would break the plain
    // click that answers 「点什么就显示什么」.
    assert('the anomaly axis opens in single mode',
      /mode\s*:\s*'single'/.test(decl));
  }
}

// ------------------------------------------------------------- one writer per key, same as before

// Collapsing three fields into an object must not have turned any of them into a second writer.
assert('the whole anomaly model is assigned in exactly 2 places', countOf('state.anomaly = defaultAnomaly()') === 2);
assert('state.anomaly.rules has exactly 2 writers', countAssign('state.anomaly.rules') === 2);
assert('state.anomaly.last has exactly 5 writers', countAssign('state.anomaly.last') === 5);
assert('state.anomaly.mode has exactly 1 writer', countAssign('state.anomaly.mode') === 1);

// The duplication this removes: both whole-object assignments must hand back a fresh object,
// never the same literal. Sharing one would make ticking a rule write through to the "default".
assert('defaultAnomaly() returns a fresh literal rather than a shared constant',
  /function defaultAnomaly\(\)\s*\{[\s\S]{0,200}?return\s*\{\s*mode:\s*'single',\s*rules:\s*\[\],\s*last:\s*null\s*\};/.test(html));

// ------------------------------------------------------------- the mode reads are comparisons, not a bare flag

// The one thing the string form has to earn over the old boolean: every read says which mode it
// means, and none of them reaches for a bare truthy test of the field.
{
  const writes = countAssign('state.anomaly.mode');
  const reads = countOf('state.anomaly.mode') - writes;
  const comparisons = countOf("state.anomaly.mode === 'multi'")
    + countOf("state.anomaly.mode !== 'multi'")
    + countOf("state.anomaly.mode === 'single'")
    + countOf("state.anomaly.mode !== 'single'");
  assert('every state.anomaly.mode read is an explicit mode comparison',
    reads > 0 && comparisons === reads);
}

// ------------------------------------------------------------- the checkbox is still drawn from the model

// 多选 is a checkbox, and a checkbox the model does not draw is a control that can show a state
// the state does not have. It is read back from the model on every render, so this cannot drift.
assert('the 多选 checkbox is drawn from state.anomaly.mode',
  /dom\.anomalyMulti\.checked\s*=\s*state\.anomaly\.mode === 'multi'/.test(html));

// ---------------------------------------------------------------- reporting

for (const name of failures) console.log('FAIL ' + name);
console.log(pass + ' checks passed' + (failures.length ? ', ' + failures.length + ' FAILED' : ', ALL PASSED'));
process.exit(failures.length ? 1 : 0);
