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
const layers = read('docs/LAYERS.md');
const serverJs = read('miniapp/node/server.mjs');
const clientHtml = read('miniapp/client/index.html');
const plugin = JSON.parse(read('.minimax-plugin/plugin.json'));

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
assert('no document still points at the deleted spec',
  !/STAGE1-SPEC/.test(layers) && !/STAGE1-SPEC/.test(readme) && !/STAGE1-SPEC/.test(readmeZh));
// The specific leak: a shell invocation, a model list, and a path under the author's home directory.
const shipped = [readme, readmeZh, layers, clientHtml, serverJs];
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
const processMarkers = [/reviews\s*=\s*0/, /perf-payload/, /OAuth 过期/, /codebuddy 要/];
for (const re of processMarkers) {
  assert(`LAYERS.md carries no process snapshot (${re})`, !re.test(layers));
}
// Scoped deliberately, because the obvious version of this rule is wrong. LAYERS.md attributes
// decisions to whoever made them in 25 places — 「报告者的原话」, 「报告截图」 — and that provenance
// is the most load-bearing part of the document: without it, a reader cannot tell a settled decision
// from a preference someone happened to hold. What has to go is the shape where the reader is named
// as the person who still has to *do* something on their own machine.
assert('LAYERS.md does not hand the reader a to-do on their own machine',
  !/需\s*报告者/.test(layers) && !/报告者\s*交互式/.test(layers) && !/由\s*报告者\s*处理/.test(layers));
// Provenance is the most load-bearing part of the document: without it a reader cannot tell a
// settled decision from a preference someone happened to hold. Asserted in bulk rather than per
// quote — scrubbing one citation is not a failure mode anyone commits on purpose, and pinning each
// individual string here would be maintenance with no defect behind it. What must not happen is
// attribution being swept away wholesale, which is what a "tidy up the docs" pass looks like.
//
// The bound is derived, not guessed. The document carries 25 of these markers across 9 distinct
// forms. mutate-review16.py sweeps the largest form (报告者的原话 ×10) and leaves 15. The floor is 18:
// above the mutated count with room to spare, and below the real 25 so ordinary edits that add or
// drop a citation do not turn the guard red.
const attributions = (layers.match(/报告者(?:的原话|直接指定|直接问|直接报|先报|定的方向|的反应|改写了我)|报告截图/g) || []).length;
assert('LAYERS.md keeps attributing decisions to whoever made them',
  attributions >= 18, `only ${attributions} attributions left, floor is 18`);
assert('LAYERS.md still keeps the real pending items',
  /未做清单/.test(layers) && /跨家族验证/.test(layers));

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

console.log('[review16] ' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exitCode = 1;
}