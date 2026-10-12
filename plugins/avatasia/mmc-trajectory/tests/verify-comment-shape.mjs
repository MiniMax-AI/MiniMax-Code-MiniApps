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

if (process.argv.includes('--list')) {
  for (const name of declared) console.log(name);
  process.exit(0);
}

console.log(pass + ' checks passed' + (failures.length ? ', ' + failures.length + ' FAILED' : ', ALL PASSED'));
process.exit(failures.length ? 1 : 0);