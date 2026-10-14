/**
 * What PR #16's review found, turned into rules that fail if it happens again.
 *
 * Every item here is a thing that was true and shipped: a stale claim in a README that a test in
 * this very directory already contradicted, a document that carried the author's machine paths and
 * a shell command into every reader's install, a harness that named one interpreter and then hid
 * the reason it could not find it, and a cache nobody released. None of them was a subtle bug.
 * They were all "the file says a thing that is no longer true", which is exactly the class nothing
 * in a test suite catches by itself — so each one is pinned here.
 *
 * The through-line is the same one the mutation controls exist for: a rule nobody can fail is not
 * a rule. mutate-review16.py breaks each of these in the shipped file and requires this guard to
 * report it by name.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, basename } from 'node:path';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PKG = join(HERE, '..');
const read = (rel) => readFileSync(join(PKG, rel), 'utf8');

let pass = 0;
const failures = [];
function assert(name, ok, detail) {
  if (ok) { pass += 1; return; }
  failures.push(detail ? `${name} — ${detail}` : name);
}

const runMjs = read('tests/run.mjs');
const readme = read('README.md');
const readmeZh = read('README.zh-CN.md');
// docs/LAYERS.md is not in this package and must not come back. The reviewer asked for it to be moved
// to the PR description or a local note, because plugin.json declares no files/exclude and the whole
// directory installs onto every reader's machine. It now lives at the workspace root (docs/LAYERS.md
// there) as an archive copy — no counterpart in this repo, so nothing here can read it.
const LAYERS_REL = 'docs/LAYERS.md';
const layers = existsSync(join(PKG, 'docs')) ? (readdirSync(join(PKG, 'docs')).join(',') || '(empty)') : '';
assert('the design document is not in the plugin directory',
  !existsSync(join(PKG, LAYERS_REL)) && !existsSync(join(PKG, 'docs', 'STAGE1-SPEC.md')),
  layers);
const serverJs = read('miniapp/node/server.mjs');
const clientHtml = read('miniapp/client/index.html');
const plugin = JSON.parse(read('.minimax-plugin/plugin.json'));

// Every shipped text file, once. Two checks below read this same map, which is the point: the first
// version of the dangling check hard-coded two paths, and the second one invented its own list, so
// the two could not disagree about what ships. If a file is added to the package it belongs here.
const SHIPPED_TEXT = {
  'README.md': readme,
  'README.zh-CN.md': readmeZh,
  'miniapp/client/index.html': clientHtml,
  'miniapp/node/server.mjs': serverJs,
  'tests/make-fixtures.mjs': read('tests/make-fixtures.mjs'),
  'tests/client-check.mjs': read('tests/client-check.mjs'),
  '.minimax-plugin/plugin.json': read('.minimax-plugin/plugin.json'),
};

// This assertion was written over the two READMEs, because those are what a reader opens first, and
// the two shipped source files were never added to it. They carried 19 of these pointers between
// them — 13 in the client, 7 in the server, and one of those a bare section number with no file name
// at all, so grepping for the filename could not find it. The label claimed a coverage it did not
// have, which is the shape this project keeps finding: the check and the thing it is about turned
// out to be two different objects.
const DANGLING = /\b(?:LAYERS\.md|STAGE1-SPEC)\b/;
const danglingIn = Object.entries(SHIPPED_TEXT).filter(([, t]) => DANGLING.test(t)).map(([rel]) => rel);
assert('nothing still points at a docs/ file that does not ship',
  danglingIn.length === 0, danglingIn.join(', '));

// A NUL byte shipped inside server.mjs, in a string literal that was meant to be empty — it was
// correct by luck and invisible on purpose. What makes it worth a guard is not the behaviour: it is
// that one byte made the whole file read as binary, so an audit of server.mjs under-reported it by
// two thirds and grep stopped halfway through it. A file that reads as binary cannot be reviewed,
// and a reviewer has no way to learn that from a diff.
const nulIn = Object.keys(SHIPPED_TEXT).filter((rel) => SHIPPED_TEXT[rel].includes('\u0000'));
assert('no shipped source file carries a NUL byte',
  nulIn.length === 0, nulIn.join(', '));

// The same dangling reference with no file name attached, so the check above cannot see it. D8,
// `D40:` and R1 are labels in a defect registry this reader does not have; L0-L6 is a layer model
// defined in a document that left the package. Most of them sat on a comment that explains itself
// on the next line, so a reader is not going to go looking -- which is exactly why they need a
// check rather than an argument. What they did tell a reader of the installed plugin is that the
// project keeps a numbered defect list it cannot see, and that is the part that does not ship.
//
// The boundary of this check is deliberate, and the next person will trip over it. It covers the
// runtime sources and the two shipped test files, and NOT the guard and mutation files -- which
// carry more of this numbering than the runtime did, by a factor of five. Those are not the same
// shape. Here: `D40:` on a section header, with the explanation a screen away or not at all, so
// the number is a label and nothing else. There: "D40 gave the wide panel a ceiling and an inner
// scroller, so the sentence that scoped the header ... stopped being true" -- the number names the
// defect and the same sentence says what it did, which is the provenance that tells a reader WHY
// a mutation exists. tests/METHODOLOGY.md is built the same way. Stripping those would cost the
// reason a control is in the suite, to remove a word nobody follows anyway.
//
// Word boundaries are the rest of it: `#D8D8` is a colour and `R1` could be an identifier, so the
// pattern has to fire on neither. Anything looser makes this a guard that fails for the wrong
// reason, which is worse than not having it.
const PRIVATE_IDS = /\b(?:[DR][0-9]+|L[0-9])\b/;
const numberedIn = Object.entries(SHIPPED_TEXT)
  .filter(([, t]) => PRIVATE_IDS.test(t))
  .map(([rel]) => rel);
assert('no shipped file carries a private defect or layer number',
  numberedIn.length === 0, numberedIn.join(', '));

/* ---------- 1. the harness must be able to find Python, and must say so when it cannot ---------- */

// A hardcoded `python` is not portable: it does not exist on a stock Linux or macOS image. The
// failure was silent for a second reason on top of that — a process that never started has no
// stdout and no stderr, so the per-guard summary line printed an empty tail and named no cause.
// 15 mutation controls failed at once and the run said only "19/34".
assert('the harness looks for more than one Python, and honours PYTHON first',
  /PYTHON_CANDIDATES\s*=\s*\[\s*process\.env\.PYTHON\s*,\s*'python3'\s*,\s*'python'\s*\]/.test(runMjs));
assert('the harness never spawns a bare python as its only choice',
  !/\?\s*\[\s*'python'\s*,/.test(runMjs));
assert('a spawn that never started is reported by name, not swallowed',
  /r\.error\s*\?\s*r\.error\.message/.test(runMjs) && /r\.status\s*===\s*0\s*&&\s*!r\.error/.test(runMjs));
assert('no interpreter at all is a stated failure, not a silent skip',
  /no Python interpreter found/.test(runMjs) && /PYTHON_CANDIDATES\.join/.test(runMjs));
// The interpreter is probed once and reused, so a run cannot mix two of them. The `break` is the
// half that matters: without it the loop keeps probing and the *last* working candidate wins, so a
// machine with both interpreters silently runs its controls under a different one than the first
// that answered — which is the kind of difference that only shows up as an odd failure elsewhere.
assert('one interpreter is chosen for the whole run',
  /if\s*\(\s*!probe\.error\s*&&\s*probe\.status\s*===\s*0\s*\)\s*\{\s*cmd = \[candidate, join\(HERE, name\)\];\s*break;/.test(runMjs)
  && /import sys; sys\.exit\(0\)/.test(runMjs));

/* ---------- 2. the READMEs must not claim what the code stopped doing ---------- */

// Ticking an anomaly rule calls resetBaseFilters(), which returns kinds to all. The README said
// the kind array was written from exactly three controls and that neither cut-across control
// rewrote it. client-check.mjs has asserted 「four controls」 for several rounds, so the suite knew
// and the prose did not — which is what makes these two worth pinning rather than just fixing.
const staleClaims = [
  ['README.md', readme, 'written from exactly three controls'],
  ['README.md', readme, 'Neither rewrites the kind array'],
  ['README.zh-CN.md', readmeZh, '只由三个控件写入'],
  ['README.zh-CN.md', readmeZh, '两者都不改写类型数组'],
];
for (const [file, text, phrase] of staleClaims) {
  assert(`the withdrawn claim 「${phrase}」 is not back in ${file}`, !text.includes(phrase));
}
assert('the README says anomaly is the control that does rewrite the kind array',
  /four controls/.test(readme) && /also rewrites the kind array/.test(readme));
assert('the Chinese README says the same thing',
  /只由四个控件写入/.test(readmeZh) && /改写类型数组/.test(readmeZh));
// The claim has to match the code, not just sound better: the delegation is what makes four
// controls three literal assignments.
assert('the README documents the delegation the code actually uses',
  /resetBaseFilters\(\)/.test(readme) && /resetBaseFilters\(\)/.test(readmeZh)
  && /state\.kinds\s*=\s*KIND_ORDER\.slice\(\)/.test(clientHtml));

/* ---------- 3. nothing that ships may carry this machine's environment ---------- */

assert('the withdrawn stage 1 spec is gone',
  !existsSync(join(PKG, 'docs', 'STAGE1-SPEC.md')));
// It was referenced twice, so deleting the file alone would have left two dangling pointers.
// Already asserted above: neither spec may exist and no README may name one. Kept here as a
// named assertion because 'a reader is told to open a file that is not there' is its own bug.
// The specific leak: a shell invocation, a model list, and a path under the author's home directory.
const shipped = [readme, readmeZh, clientHtml, serverJs];
const leaks = [/codex exec/, /models_cache/, /~\/\.codex/, /[A-Z]:\\Users\\/];
for (const re of leaks) {
  assert(`no shipped file carries ${re}`, !shipped.some((t) => re.test(t)));
}

/* ---------- 3b. nothing that ships may name the author ---------- */

// A real name in a shipped file identifies the author to every reader who installs the plugin, and
// plugin.json declares no `files`/`exclude`, so the whole directory ships. This was found in
// index.html, where two comments said the height cap was 「on chli's instruction」, and in
// docs/LAYERS.md, where 48 attributions used the name.
//
// Two files are exempt, and the exemption is the point rather than a loophole:
//   mutate-review16.py  — 「需 chli 交互式处理」 is a mutation *anchor*; rewrite it and the anchor
//                         stops resolving, so the mutation reports as survived.
//   verify-review16.mjs — this file; those strings are the pattern the rule below matches on.
// A guard has to keep naming the thing it detects, exactly as verify-parsers.mjs keeps
// C:\Users\ava\.minimax. Rewriting a detector's own vocabulary makes it vacuously true.
//
// docs/LAYERS.md is NOT exempt. The attributions there are load-bearing — they are what separates a
// settled decision from a preference someone happened to hold — but attribution does not require a
// name. It ships 「报告者的原话」 and 「报告者直接指定」 instead, which keeps the who-decided and the
// quoted words and drops only the name. The floor count below is asserted over those role words, so
// scrubbing the provenance still fails exactly as before.
const AUTHOR_NAME = /\bchli\b/i;
const NAME_EXEMPT = new Set(['mutate-review16.py', 'verify-review16.mjs']);
function shippedSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__pycache__' || entry.name === 'fixtures' || entry.name === 'node_modules') continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...shippedSourceFiles(p));
    else if (/\.(mjs|js|py|ts|html|json|md|yml|yaml)$/i.test(entry.name)) out.push(p);
  }
  return out;
}
const namedFiles = shippedSourceFiles(PKG)
  .filter((p) => !NAME_EXEMPT.has(basename(p)))
  .filter((p) => AUTHOR_NAME.test(readFileSync(p, 'utf8')));
assert(`no shipped file names the author (${namedFiles.length} do)`,
  namedFiles.length === 0,
  namedFiles.map((p) => p.slice(PKG.length + 1)).join(', '));

/* ---------- 4. the design document holds conclusions, not this week's process ---------- */

// These were rows in the 未做清单: one said which PR had no reviews yet, the other named a temp
// file already in the recycle bin. Both were true only on the day they were written and neither
// told the next reader anything they could act on.
// The four rules that used to read LAYERS.md are gone with the document. What they promised still
// holds, from the other direction: the process snapshots and the reader-facing to-do went out with it,
// and the provenance that made the document worth keeping is preserved in the workspace archive. The
// guard above is what stops either from being reintroduced into a package that installs to everyone.

/* ---------- 5. dispose releases every cache it creates ---------- */

// descriptorCache and trajectoryCache were released; parsedRows — the largest of the three, and
// the one holding a whole session's parsed rows — was not. It has the same clear(); it was simply
// missed, and a missed release looks exactly like a correct one until someone measures heap.
const disposeBody = /const dispose = \(\) => \{([\s\S]*?)\n  \};/.exec(serverJs);
assert('dispose() clears the parsed-row cache too',
  !!disposeBody && /parsedRows\.clear\(\)/.test(disposeBody[1]));
assert('dispose() still clears the other two caches',
  !!disposeBody && /descriptorCache\.clear\(\)/.test(disposeBody[1])
  && /trajectoryCache\.clear\(\)/.test(disposeBody[1]));
assert('the parsed-row cache really does expose clear()',
  /createParsedRowsCache[\s\S]*?clear\(\)\s*\{\s*entries\.clear\(\);\s*bytes = 0;\s*\}/.test(serverJs));

/* ---------- 6. the empty state names a control that still works ---------- */

// Under an anomaly rule the type chips and the search box are marked inert, precisely because
// ticking the rule already reset them. The hint used to tell the reader to relax exactly those
// two, so it sent them to press two controls that do nothing.
// Scoped to the empty-state block on purpose. `state.anomaly.rules.length > 0` also occurs in the
// anomaly counters, so a whole-file search is satisfied by code that has nothing to do with this
// hint — the check would pass with the branch deleted.
const emptyBlock = /if \(matched\.length === 0\) \{([\s\S]*?)\n        \}/.exec(clientHtml);
assert('the empty state has a branch for anomaly mode',
  !!emptyBlock && /state\.anomaly\.rules\.length\s*>\s*0/.test(emptyBlock[1]));
assert('the anomaly branch tells the reader to press 清除筛选',
  /要回到全部记录请点「清除筛选」/.test(clientHtml));
assert('the non-anomaly hint is still the one that names types and search',
  /可以放宽类型或搜索词/.test(clientHtml));
assert('the empty state still offers the reset button',
  /var reset = el\('button', 'btn', '清除筛选'\)/.test(clientHtml));

/* ---------- 7. the shipped version moved ---------- */

assert('the plugin version was bumped off 1.0.0', plugin.version !== '1.0.0', `still ${plugin.version}`);
assert('the plugin version is a valid semver minor bump',
  /^1\.[1-9]\d*\.\d+$/.test(plugin.version), plugin.version);

// The two READMEs were the actual complaint, and this block covered neither of them: it read
// `plugin.json` and called that done, while both READMEs still announced `1.0.0` to every reader
// who opens the plugin's front page. A rule that checks the field nobody complained about and not
// the two files that were named is the same shape as the D43 bug — a list of three where the rule
// pinned one.
//
// Asserted as *equality with plugin.json*, not as "not 1.0.0": the failure this prevents is the
// next bump, where plugin.json moves to 1.2.0 and the READMEs quietly stay behind again.
const versionTag = '`' + plugin.version + '`';
assert('the English README carries the shipped version',
  readme.includes('Version: ' + versionTag), `looking for Version: ${versionTag}`);
assert('the Chinese README carries the shipped version',
  readmeZh.includes('版本：' + versionTag), `looking for 版本：${versionTag}`);
assert('neither README still announces the old version',
  !/1\.0\.0/.test(readme) && !/1\.0\.0/.test(readmeZh));

console.log('[review16] ' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exitCode = 1;
}