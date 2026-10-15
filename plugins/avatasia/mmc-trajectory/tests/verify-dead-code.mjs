/**
 * Every function the client declares is called by something.
 *
 * Same property as the stylesheet guard one file over — a declaration earns its place by being
 * read — applied to the inline script instead of the `<style>` block. It replaces a hand list of
 * three names, and a hand list only stops those three from coming back.
 *
 * Scoped to `index.html` on purpose. `server.mjs` has the same shape of dead helper, but its
 * exports are read by eight test files that ship with the package, so "no reader" there is a
 * question about test infrastructure rather than about shipped code. Adding this rule to the
 * server means calibrating it there first, which is a separate piece of work.
 *
 * Three things this rule got wrong before it was right, and all three are false positives —
 * a guard that blocks legitimate work gets argued with, and the next version of it gets
 * weakened:
 *
 *   1. **Calls only.** Thirteen top-level functions here are event handlers that hand
 *      themselves to `addEventListener` as values: `onOverviewPointerDown`, `copySelected`,
 *      `onInspectorResizeUp` and ten more. A rule that looks for `name(` calls all thirteen
 *      dead. The rule is therefore "the name appears anywhere outside its own declaration",
 *      not "the name is called".
 *   2. **Comments counted.** Names are mentioned in prose throughout this file. Comments are
 *      stripped before anything is counted — `//` by whole line, because a `//` inside a string
 *      is a URL here and scanning for it would delete the rest of the line.
 *   3. **The bootstrap sliced off.** Cutting the script at `document.readyState` to keep the
 *      page from mounting removes the one call to `init()`, which then reads as dead. The whole
 *      script is scanned; a mutation that deletes the bootstrap's call to `init()` is then a
 *      live case of this rule rather than a false positive.
 *
 * The rule is exact on this file, not approximately: 230 declared functions and four with no
 * reader before the cleanup (`formatCompact`, `turnContextSuffix`, `buildBlock`, plus the
 * `init` slice artifact), and 226 with none after it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HTML = fileURLToPath(new URL('../miniapp/client/index.html', import.meta.url));
const html = readFileSync(HTML, 'utf8');

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
let pass = 0;
const failures = [];
function assert(name, cond, detail) {
  if (cond) pass += 1;
  else failures.push(detail ? `${name}\n      ${detail}` : name);
}

assert('the page has exactly one inline script', scripts.length === 1,
  'found ' + scripts.length);
const script = scripts[0] || '';

/* Comments first. A comment is prose about the code, not the code. */
const live = script.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

/* Top-level declarations only: the ones at the file's own indent. Nested helpers are inside
 * another function, where "who calls this" is a question about a closure rather than about
 * whether the file still uses it. */
const declared = new Map();
for (const m of live.matchAll(/^ {6}function ([A-Za-z_$][\w$]*)\s*\(/gm)) {
  declared.set(m[1], script.slice(0, m.index).split('\n').length);
}
assert('the scan found the top-level functions at all', declared.size > 200,
  'only ' + declared.size + ' matched; the indentation assumption is probably wrong');

/* The scan assumes the file's own indent for a top-level declaration is six spaces. If a
 * reformat moved them, the rule would stop covering most of the file and report nothing —
 * which is the failure that looks most like success. So the assumption itself is asserted:
 * every declaration is either exactly at that indent (top level) or deeper (nested inside
 * one), and never shallower. */
const shallow = [];
for (const m of script.matchAll(/^( *)[ \t]*function ([A-Za-z_$][\w$]*)\s*\(/gm)) {
  const indent = m[1].length;
  if (indent !== 6 && indent < 6) shallow.push(m[2] + ' at indent ' + indent);
}
assert('no function is declared above the file\'s own top-level indent', shallow.length === 0,
  'these would escape the scan: ' + shallow.join(', '));

/* A reader is any appearance of the name outside its own `function` keyword. */
const esc = (s) => s.replace(/\$/g, '\\$&');
const readersOf = (name) => {
  let n = 0;
  for (const m of live.matchAll(new RegExp('(?<![\\w$.])' + esc(name) + '(?![\\w$])', 'g'))) {
    if (/\bfunction\s*$/.test(live.slice(Math.max(0, m.index - 12), m.index))) continue;
    n += 1;
  }
  return n;
};

const dead = [...declared.entries()].filter(([name]) => readersOf(name) === 0)
  .map(([name, line]) => name + ' (line ' + line + ')');
assert('every function the client declares is used by something',
  dead.length === 0,
  'declared and never used: ' + dead.join(', '));

console.log('dead-code: ' + pass + ' passed, ' + failures.length + ' failed ('
  + declared.size + ' top-level functions)');
if (failures.length) {
  for (const f of failures) console.log('FAIL  ' + f);
  process.exit(1);
}
console.log('ALL CHECKS PASSED');
