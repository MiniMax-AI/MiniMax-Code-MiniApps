// Comment blocks in index.html are structurally balanced, and every one that opens on its
// own line carries prose.
//
// This is not tidiness. A probe that inserts a function and writes a fresh `/**` above it
// without removing the one that was already there leaves two openers on consecutive lines.
// JavaScript does not care: the second `/**` is just text inside the first comment, and the
// block closes at the first `*/` that follows. So the page renders fine, every behavioural
// guard stays green, and the damage is invisible to all of them.
//
// It is not invisible to a person. Three of these shipped in the 2-b commit — above
// recordVisible(), visibleEntries() and spanPassesFilter(), the three functions that commit
// introduced. All three were found by scanning for two `/**` in a row, after the change had
// already been tested, validated, published and measured in a browser.
//
// So: the invariant is structural rather than behavioural precisely because no behavioural
// guard can see it, and it ships with mutate-comment-shape.py for the same reason.
//
//   node tests/verify-comment-shape.mjs          check, and report
//   node tests/verify-comment-shape.mjs --list   print the assertion names and exit
//
// The --list form exists so mutate-comment-shape.py can tell "the guard has no such assertion"
// (a guard-authoring mistake) apart from "the assertion exists and did not fire" (a guard-logic
// mistake). Both end in a non-zero exit, but they are different bugs.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = join(ROOT, 'miniapp', 'client', 'index.html');

const lines = readFileSync(CLIENT, 'utf8').split('\n');
const trimmed = lines.map((l) => l.trim());

let pass = 0;
const failures = [];
const declared = [];

function assert(name, condition, detail) {
  declared.push(name);
  if (condition) { pass += 1; return; }
  failures.push(name);
  console.log('FAIL ' + name + (detail ? ' — ' + detail : ''));
}

const openers = [];
const closers = [];
trimmed.forEach((t, i) => {
  if (t === '/**') openers.push(i);
  if (t === '*/') closers.push(i);
});

function adjacent(idx) {
  return idx.filter((i) => trimmed[i + 1] !== undefined && trimmed[i + 1] === trimmed[i]);
}

// An opener that opens nothing: the next line is another opener, so this one has no prose.
{
  const orphans = adjacent(openers);
  assert('no comment block opens on top of another', orphans.length === 0,
    orphans.length ? 'lines ' + orphans.map((i) => i + 1).join(', ') : '');
}

// The mirror image, and the one that would actually break the file if it ever happened.
{
  const orphans = adjacent(closers);
  assert('no comment block closes on top of another', orphans.length === 0,
    orphans.length ? 'lines ' + orphans.map((i) => i + 1).join(', ') : '');
}

// Balance. Every opener that adds one also has to take one away, or the rest of the file
// stops being code.
{
  assert('openers and closers balance', openers.length === closers.length,
    openers.length + ' openers vs ' + closers.length + ' closers');
}

// The reason the file is worth reading: an opener is followed by what it documents. A block
// whose body is another opener is the shape the probe left behind, seen from the other side.
{
  const bodyless = openers.filter((i) => trimmed[i + 1] !== undefined && !trimmed[i + 1].startsWith('*'));
  assert('every opener on its own line is followed by its own prose', bodyless.length === 0,
    bodyless.length ? 'lines ' + bodyless.map((i) => i + 1).join(', ') : '');
}

// And the closer is reached by walking forwards, which is the same walk the parser does.
// A file where the counts balance can still be malformed if a closer arrives before its
// opener, so this is not implied by the count.
{
  let depth = 0;
  let underflowAt = -1;
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed[i] === '/**') { depth += 1; continue; }
    if (trimmed[i] !== '*/') continue;
    depth -= 1;
    if (depth < 0 && underflowAt < 0) { underflowAt = i + 1; break; }
  }
  assert('no closer runs ahead of its opener', underflowAt < 0,
    underflowAt ? 'first underflow at line ' + underflowAt : '');
  assert('the file ends with every block closed', depth === 0,
    depth > 0 ? depth + ' block(s) still open at EOF' : '');
}

// ---- and the <style> block, which none of the above looks at --------------------------------
//
// Everything above reads JS block comments. CSS comments are a different parser with a different
// rule, and it turns the same mistake fatal: they do NOT nest, so the first terminator found
// inside one ends it there and there. A comment that spells the terminator inside itself ends
// mid-sentence, the prose after it is read as a selector prelude, and the rule meant to follow is
// swallowed by an invalid one wrapped around it.
//
// That shipped once, on D40's wide-screen block. The @media rule was in the file, every guard that
// reads text passed, the braces balanced, and the browser's CSSOM held ZERO rules mentioning
// #inspector-panel while the JS writing that rule's variables ran perfectly. No behavioural guard
// could see it, which is the same reason the JS assertions above are structural. What does prove
// it is the residue, and the residue is legible: the top level of a stylesheet holds selectors and
// at-rules, never prose, and this file quotes prose with a backtick every single time.
const styleOpen = lines.findIndex((l) => l.includes('<style'));
const styleClose = lines.findIndex((l, i) => i > styleOpen && l.includes('</style>'));
const css = lines.slice(styleOpen + 1, styleClose).join('\n');

// Named once so the tokenizer and the assertions cannot drift apart, and so comment
// syntax never has to be retyped as a pattern anywhere in this file. See the note in the
// block below about a slash lost in transcription.
const OPEN = '/*';
const CLOSE = '*/';

// Browser semantics, walked the only way that shows the residue: an opener starts a comment, the
// FIRST terminator ends it, and a second opener inside the body is inert text.
const cssComments = [];
{
  let at = 0;
  while (at < css.length) {
    const open = css.indexOf(OPEN, at);
    if (open < 0) break;
    const close = css.indexOf(CLOSE, open + OPEN.length);
    if (close < 0) break;
    cssComments.push(css.slice(open, close + 2));
    at = close + 2;
  }
}

{
  // An opener with no terminator swallows everything after it — the same outage, different
  // mechanism, equally invisible from outside.
  const openers = css.split(OPEN).length - 1;
  assert('every CSS comment in the style block is terminated', openers === cssComments.length,
    openers + ' opener(s) but ' + cssComments.length + ' terminated comment(s)');
}

{
  // The terminator this file's CSS comments ride on. A line whose terminator is followed by
  // anything else is a comment that ended before its author meant it to: the intended closer is
  // the one at the end of the prose, so anything trailing an earlier one is that prose spilling
  // out. This is deliberately NOT derived from the tokenizer above — a comment sliced out by CSS
  // semantics cannot contain a terminator by construction, so asking that would be a check that
  // cannot fail. This one reads the file's convention instead, and can.
  //
  // String slicing rather than a regular expression, on purpose: this very line was hand-written
  // once already and came out missing the slash that closes its pattern, which turned the guard
  // into a file that does not parse. See METHODOLOGY.md 8.5 — a character lost in transcription is
  // indistinguishable from a design mistake until you read the bytes back.
  const inStyle = (n) => n >= styleOpen + 2 && n <= styleClose;
  const trailing = lines
    .map((l, i) => [i + 1, l])
    .filter(([n, l]) => {
      if (!inStyle(n) || !l.includes(CLOSE)) return false;
      return l.slice(l.lastIndexOf(CLOSE) + 2).trim() !== '';
    });
  assert('every comment terminator in the style block ends its line', trailing.length === 0,
    trailing.length ? trailing.slice(0, 3).map(([n, l]) => 'line ' + n + ': ' + l.trim().slice(0, 60)).join(' / ') : '');
}

{
  // Prose leaking to the top level of a stylesheet is never valid CSS, and since prose is quoted
  // here, a backtick still standing outside a comment is that leak made visible.
  const outside = [];
  let at = 0;
  for (const c of cssComments) {
    // Advance from where the comment was actually FOUND, not from the previous position —
    // the first comment starts well after 0, and stepping by length alone leaves the gap
    // misaligned, which reports perfectly good comments as spilled prose.
    const start = css.indexOf(c, at);
    outside.push(css.slice(at, start));
    at = start + c.length;
  }
  outside.push(css.slice(at));
  const leaked = outside.join('').split('\n')
    .map((l, i) => [styleOpen + 2 + i, l])
    .filter(([, l]) => l.includes('`'));
  assert('no prose survives outside a CSS comment', leaked.length === 0,
    leaked.length ? leaked.slice(0, 3).map(([n, l]) => 'line ' + n + ': ' + l.trim().slice(0, 60)).join(' / ') : '');
}

{
  // The same convention the JS assertions above hold the JS syntax to, applied to the other one:
  // the closer rides on the last line of the prose rather than alone on a line of its own.
  const bare = cssComments.filter((c) => c.split('\n').pop().trim().slice(0, -2).trim() === '');
  assert('every CSS comment closes after its prose, not on a line of its own', bare.length === 0,
    bare.length ? bare.length + ' comment(s) close bare' : '');
}

if (process.argv.includes('--list')) {
  for (const name of declared) console.log(name);
  process.exit(0);
}

console.log(pass + ' checks passed' + (failures.length ? ', ' + failures.length + ' FAILED' : ', ALL PASSED'));
process.exit(failures.length ? 1 : 0);