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
import { existsSync, readFileSync, readdirSync, writeFileSync, rmSync, mkdirSync,
         cpSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, basename, dirname, relative, isAbsolute } from 'node:path';

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
// the two could not disagree about what ships.
//
// The table this replaces was itself such a list, and it was half the package: eight entries that
// reached six of the twelve text files that ship. `.gitattributes`, `.gitignore`, `LICENSE`,
// `package.json`, `miniapp/miniapp.json` and `miniapp/node/miniapp-api.ts` were read by nothing,
// so all three checks below passed over them without saying so. A list that omits half its members
// cannot be told apart from a complete one by its own result, because the omitted half is exactly
// the unchecked half -- which is the shape this file was written about, one level up.
//
// So the set is derived now: walk the package and keep what decodes as strict UTF-8.
//
// Strict UTF-8, and NOT "does it contain a NUL": NUL is a legal code point (U+0000), so a file
// carrying one still decodes and still counts as text -- which is exactly what lets the NUL check
// below still see it. Judging text-ness by NUL would make that check an empty one. icon.png does
// not decode, so it drops out, which is the same verdict the class table reaches.
//
// The boundary is unchanged and deliberate: `tests/` is a DEV tree, and the guard and mutation
// files inside it carry private numbers as provenance rather than as labels (the reasoning sits
// above the private-number check). Two files under tests/ are added back by hand below, because
// those two are part of what installs onto a reader's machine.
const DEV_TREES = new Set(['tests', '__pycache__', 'fixtures', 'node_modules']);
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });
function isTextFile(abs) {
  let buf;
  try { buf = readFileSync(abs); } catch { return false; }
  try { strictUtf8.decode(buf); } catch { return false; }
  return true;
}
function shippedTextPaths(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (DEV_TREES.has(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...shippedTextPaths(p));
    else if (isTextFile(p)) out.push(p);
  }
  return out;
}
const derivedRel = shippedTextPaths(PKG).map((p) => relative(PKG, p).split(/[\\/]/).join('/'));
const SHIPPED_TEXT = {};
for (const rel of derivedRel) SHIPPED_TEXT[rel] = read(rel);
SHIPPED_TEXT['tests/make-fixtures.mjs'] = read('tests/make-fixtures.mjs');
SHIPPED_TEXT['tests/client-check.mjs'] = read('tests/client-check.mjs');

// The deriver is what the three checks below now stand on, so it gets a check of its own. If the
// walk ever returns nothing -- a skip list that grew a name, a directory that moved -- all three
// read an empty set and none of them fires, and a guard that cannot fail is not a guard that
// passed. Twelve is the number of text files that ship today: adding one to the package must not
// trip this, losing one must.
assert('the shipped text set is derived from the package, and covers the twelve text files that ship',
  derivedRel.length >= 12, 'derived ' + derivedRel.length);

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
  /createParsedRowsCache[\s\S]*?clear\(\)\s*\{[^}]*entries\.clear\(\);[^}]*bytes = 0;[^}]*\}/.test(serverJs));

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

/* ---------- 8. the harness must notice what the LAST run left behind ---------- */

// Section 1 is about a run that cannot find its interpreter. This one is about a run that cannot
// see what the previous run left on disk, which is the failure mode the snapshot in run.mjs was
// written for and then did not have.
//
// The gap was three bugs that each disabled the check on their own: the snapshot was written only
// when the file already existed (so a fresh checkout never had a baseline), it recorded the run's
// START state rather than the state it ended with, and — the one that made the whole thing
// decorative — nothing ever read it. The visible symptom was exactly the one the reviewer reported:
// after a `kill -9` mid-mutation, `index.html` stayed mutated and the next run reported unrelated
// red with no mention of the residue, because the only guard that knew about residue was comparing
// the start of a run with the end of the SAME run.
//
// Reproduced on 2026-10-14 before changing anything: a run left no snapshot at all, and with a
// snapshot planted by hand plus one real mutation in index.html, `node tests/run.mjs
// verify-ledger-jump` printed `0/1 guards passed / failed: verify-ledger-jump.mjs` and one line
// about nothing being left over.
// Pinned to the one return expression that exists for this, not to a bare `readFileSync(SNAPSHOT`
// and not to a lazy span from `readSnapshot` onwards — the runner's self-test reads the snapshot too,
// and both looser forms are satisfied by that, so a mutation removing the harness's own read leaves
// the assertion green. The cost of this one was 38 of 39 mutations caught.
assert('the harness reads the snapshot the previous run wrote',
  /return existsSync\(SNAPSHOT\) \? JSON\.parse\(readFileSync\(SNAPSHOT, 'utf8'\)\) : null;/.test(runMjs));
assert('the startup comparison is per file, against the digest that was recorded',
  /!== undefined && \w+\[rel\] !== digest\(rel\)/.test(runMjs));
// A checkout nobody has run the suite on has no baseline. Treating that as "everything differs"
// would warn on every first run, and treating it as a failure would fail every fresh clone.
assert('a missing baseline is neither a difference nor a failure',
  /const readSnapshot = \(\) => \{[\s\S]*?return null;/.test(runMjs)
  && /const leftover = previous\s*\?/.test(runMjs));
// Reported, not failed. The suite runs on machines with uncommitted work, and "these files are
// not what the last run left" is true of a contributor mid-edit. So this must never reach
// `failed`. The check is structural -- a WARN line exists, and `leftover` reaches no `failed`
// call -- because the alternative was a regex for the wording, which is a test of the message
// rather than of the rule, and which this suite has now been bitten by for both of these.
assert('files that differ from the last run are reported and not failed',
  /console\.log\(`WARN/.test(runMjs)
  && !/failed\.push\([^\n]*leftover/.test(runMjs));
// Written on every clean run. Gating the write on the file already existing is what left a fresh
// checkout with nothing to compare against — the machine least likely to have a stale snapshot is
// the one that could never get one.
assert('the snapshot is written on every clean run, not only when it already exists',
  !/existsSync\(SNAPSHOT\)\s*&&/.test(runMjs) && !/if\s*\(existsSync\(SNAPSHOT\)/.test(runMjs));
// And it records the state the run ENDED with, only when that state was clean. Recording a drifted
// end would make the next run's comparison agree with the mutation, which is the one thing this
// file exists to prevent.
assert('the snapshot records the state the run ended with, and only a clean end',
  /if \(drift\.length === 0\) \{[\s\S]*?writeFileSync\(SNAPSHOT/.test(runMjs)
  && !/JSON\.stringify\(snapshotBefore\)/.test(runMjs));
// Two findings, two names. Collapsing them into one line is the regression this section exists to
// stop: one label means this run dirtied the source, the other means it was already dirty, and a
// reader who cannot tell them apart cannot act on either.
//
// Read the two labels back out of the file and compare them, rather than matching either against a
// literal. Pinning the exact words made this a check on the message, not on the rule, and the round
// that changed the residue label broke it for no reason a reviewer could have acted on.
const warnLabel = /console\.log\(`WARN\s+\$\{'([^']+)'/.exec(runMjs);
const failLabel = /console\.log\(`FAIL\s+\$\{'([^']+)'/.exec(runMjs);
assert('this run\'s own residue and last run\'s residue are named differently',
  warnLabel !== null && failLabel !== null && warnLabel[1] !== failLabel[1]);
// Run the harness against a copy of the package in a temp directory, never against this one.
//
// That sentence is the fix for a family of problems this file spent several revisions creating. The
// state under test is "a package with no baseline", and a scratch copy is in exactly that state by
// construction -- nobody had to delete anything to get there. Nothing is shared, so nothing another
// process can reach, so there is no lock to key, no key to canonicalise, no owner to record, and no
// way for a recycled pid to impersonate one. Four concurrent invocations of the version that moved
// the real baseline aside deleted it outright, and a hard kill left a lock file in the temp directory
// that the residue check cannot see and that kept every later run out. `cpSync` is one call.
// Is `child` this package or somewhere under it? The scratch destination is refused when it is,
// because a copy of the package into its own subtree is exactly what `cpSync` declines to do, and it
// declines by throwing -- which would take this guard down before any assertion ran, on a machine
// whose TEMP simply points somewhere unusual.
//
// Physical identity, not lexical. A temporary directory reached through a junction that points back
// here is inside the package even though no string in it says so, and on that machine cpSync refuses
// the copy by luck rather than by decision. The destination does not exist yet, so its parent is what
// gets resolved and the last segment is put back.
//
// The alias case itself is not exercised below: making a junction needs a privilege this suite does not
// assume, and a mutation that only differs under an alias would survive rather than fail.
const insidePackage = (child) => {
  let target = child;
  try {
    target = join(realpathSync.native(dirname(child)), basename(child));
  } catch { /* a parent that is not there has nothing to resolve */ }
  const rel = relative(realpathSync.native(PKG), target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

// One path, not one basename. `basename(src) !== '.shipped-snapshot.json'` also drops every file
// with that name anywhere in the tree, so the copy stops being "the package without its bookkeeping
// file" and becomes "the package without anything so named" -- a difference no assertion would have
// noticed while the tree happened to hold no second one.
//
// A factory, not a constant over PKG, and the reason is a property this file could not check for a
// year of looking: the filter's promise is "the copy has no baseline EVEN WHEN THE SOURCE HAS
// ONE", and the only source available here is the package this guard is sitting in -- whose
// baseline file is gitignored and therefore ABSENT on every fresh clone and on CI. There, a filter
// that excluded nothing and this one produced identical copies, so `filter: () => true` survived
// and the mutation counted 46/47 on a clean checkout while counting 47/47 on a developer machine
// that had run the suite. Given a root, the same predicate can be asked about a source built here,
// where a baseline is planted on purpose and its absence in the copy is therefore a fact about the
// filter rather than about what happened to be lying around.
const notTheBaselineIn = (root) => (src) => relative(root, src) !== join('tests', '.shipped-snapshot.json');
const notTheBaseline = notTheBaselineIn(PKG);

const scratchPackage = () => {
  const dir = mkdtempSync(join(tmpdir(), 'mmc-trajectory-selfcheck-'));
  if (insidePackage(dir)) {
    rmSync(dir, { recursive: true, force: true });
    const e = new Error('the temporary directory is inside the package; set TEMP somewhere else');
    e.code = 'ERR_SCRATCH_INSIDE_PACKAGE';
    throw e;
  }
  try {
    cpSync(PKG, dir, {
      recursive: true,
      filter: notTheBaseline,
    });
  } catch (err) {
    // The caller cannot clean up a path it was never handed, so this function has to.
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
  return dir;
};

assert('the copy leaves out the bookkeeping file and nothing else',
  notTheBaseline(join(PKG, 'tests', '.shipped-snapshot.json')) === false
  && notTheBaseline(join(PKG, 'fixtures', '.shipped-snapshot.json')) === true
  && notTheBaseline(join(PKG, 'tests', 'run.mjs')) === true,
  'pkg=' + PKG);

/* Asking the predicate about a path only proves it reads paths correctly. What the filter is FOR is
 * a property of a finished copy, and that one cannot be read off a path at all -- it has to be
 * produced. The source is built here rather than borrowed, so it holds a baseline on every machine:
 * `tests/.shipped-snapshot.json` is gitignored, so the real package has none on a fresh clone, and
 * a copy of a source with nothing in it cannot tell this filter from `() => true`. That is not a
 * theoretical gap -- with the filter neutered the mutation control reported 46/47 on a clean
 * checkout and 47/47 only where an earlier suite run had left the file behind. */
const filterSource = mkdtempSync(join(tmpdir(), 'mmc-trajectory-filtersrc-'));
let filterCopy = null;
try {
  mkdirSync(join(filterSource, 'tests'), { recursive: true });
  mkdirSync(join(filterSource, 'fixtures'), { recursive: true });
  writeFileSync(join(filterSource, 'tests', '.shipped-snapshot.json'), '{"planted":"as-a-baseline"}');
  writeFileSync(join(filterSource, 'fixtures', '.shipped-snapshot.json'), '{"planted":"under-fixtures"}');
  writeFileSync(join(filterSource, 'tests', 'run.mjs'), '// planted\n');
  filterCopy = mkdtempSync(join(tmpdir(), 'mmc-trajectory-filterdst-'));
  cpSync(filterSource, filterCopy, { recursive: true, filter: notTheBaselineIn(filterSource) });
  assert('a copy of a source that carries the bookkeeping file still comes out without it',
    existsSync(join(filterSource, 'tests', '.shipped-snapshot.json'))
    && !existsSync(join(filterCopy, 'tests', '.shipped-snapshot.json')),
    'src=' + filterSource + ' dst=' + filterCopy);
  assert('and it comes out without it by path, keeping the file of the same name under fixtures/',
    existsSync(join(filterCopy, 'fixtures', '.shipped-snapshot.json'))
    && existsSync(join(filterCopy, 'tests', 'run.mjs')),
    'dst=' + filterCopy);
} finally {
  rmSync(filterCopy, { recursive: true, force: true });
  rmSync(filterSource, { recursive: true, force: true });
}

// The predicate above is what decides whether the copy is attempted at all, and the whole guard hangs
// off it, so it is checked against paths with known answers rather than trusted.
assert('a path under the package is recognised as under the package',
  insidePackage(PKG) && insidePackage(join(PKG, 'tests', 'scratch'))
  && !insidePackage(join(PKG, '..', 'scratch'))
  && !insidePackage(join(tmpdir(), 'mmc-trajectory-selfcheck-elsewhere')),
  'pkg=' + PKG + ' tmp=' + tmpdir());

const GONE = 'tests/__absent-probe__.mjs';
let scratch = null;
let sawBaseline = null;
let selfTest = { status: null, stdout: '', stderr: '' };
let wiring = { status: null, stdout: '' };
let scratchError = null;
try {
  scratch = scratchPackage();
  const harness = join(scratch, 'tests', 'run.mjs');
  const there = (...args) => spawnSync(process.execPath, [harness, ...args],
    { cwd: scratch, encoding: 'utf8' });

  // Read the state back off the copy rather than reasoning about it. "The filter excludes the
  // baseline" is a claim about a line of code; this is the file system answering.
  sawBaseline = existsSync(join(scratch, 'tests', '.shipped-snapshot.json'));
  selfTest = there('--self-test-residue');

  // And the wiring, which nothing above can reach: those phases build their own input and hand it
  // straight to the comparison, so they measure the comparison function and say nothing about whether
  // the startup hands it one at all. Planting a baseline and asking the harness what its own startup
  // made of that measures the part with no other check. The harness picks no input here -- and here it
  // is planting into a directory this process created, so the question of whose file that is does not
  // arise.
  writeFileSync(join(scratch, 'tests', '.shipped-snapshot.json'),
    JSON.stringify({ [GONE]: 'planted-by-verify-review16' }));
  wiring = there('--print-startup-leftover');
} catch (err) {
  // Named rather than thrown. A machine whose TEMP points inside the package cannot produce the state
  // under test, and saying so is a result; an uncaught exception out of here is the reading that looks
  // exactly like a surviving mutation.
  scratchError = err.code || String(err);
} finally {
  if (scratch !== null) rmSync(scratch, { recursive: true, force: true });
}

assert('the residue self-test runs on a package that has no baseline',
  scratchError === null && sawBaseline === false, 'scratchError=' + scratchError + ' sawBaseline=' + sawBaseline);
{
  const say = 'exit=' + selfTest.status + ' out=' + JSON.stringify((selfTest.stdout || '').slice(0, 200))
    + ' err=' + JSON.stringify((selfTest.stderr || '').slice(0, 160));
  // Two phases, two assertions, two mutations. One assertion covering both would let either
  // direction fail alone while the other still passes, which is how the first version of this
  // reported an exhaustive check that was silent about a deleted file.
  assert('the residue check names a file the old hand-maintained list did not cover',
    selfTest.status === 0 && /^caught /m.test(selfTest.stdout || ''), say);
  assert('the startup comparison names a path the last run recorded and this tree no longer has',
    selfTest.status === 0 && /^caught-absent /m.test(selfTest.stdout || ''), say);
}
// Parsed, not matched. Substring membership was enough to pass while the mode printed anything at all
// that mentioned the path -- a debug line, an error, a hard-coded string. What has to hold is the
// shape the mode promises: a baseline was read, and the one path the planted baseline recorded is the
// one it named, and nothing else was.
//
// `warned` is the part that cannot be read off the computed values. A comparison that runs correctly
// and a comparison whose result is then gated out of the warning look identical from here, and the
// whole point of the residue check is that somebody is told. So the mode reports which branch it took.
const wiringLine = /^startup-leftover=(.*)$/m.exec(wiring.stdout || '');
let payload = null;
try {
  payload = JSON.parse(wiringLine === null ? '' : wiringLine[1]);
} catch { payload = null; }
assert('the startup comparison warns when the baseline records a difference',
  wiring.status === 0 && payload !== null && payload.hadBaseline === true && payload.warned === true
  && Array.isArray(payload.leftover) && payload.leftover.length === 1
  && payload.leftover[0] === GONE,
  'exit=' + wiring.status + ' payload=' + JSON.stringify(payload).slice(0, 200));
console.log('[review16] ' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exitCode = 1;
}