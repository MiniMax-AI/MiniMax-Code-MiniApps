/**
 * `--check` used to be a command that could not fail.
 *
 * make-fixtures.mjs printed "(dry run -- pass --record to write)" and exited 0 for every input,
 * `--check` was not an option at all, and AGENTS.md listed `node tests/make-fixtures.mjs --check`
 * as a command whose output had to stay green. Six of the eight committed fixture files had
 * meanwhile drifted away from the workspace copies, and no signal existed: the command that was
 * supposed to notice was a no-op, and the real problem -- the fixture being half-regenerated for
 * reasons nobody could name -- could not be seen through a byte comparison anyway, because the
 * live store moves under it.
 *
 * So the promise had to be re-derived rather than implemented literally. What was actually ever
 * promised is not "identical to what this machine distils today": that drifts with every session
 * written and chasing it is what half-regenerates the tree. It is the weaker, durable one -- the
 * committed fixture still parses the way the service reads it, still covers every shape
 * verify-anomaly.mjs asserts on, still carries nothing from this machine, and still sits inside the
 * space the distil rules describe (distil it again and it must read the same).
 *
 * Two properties this guard depends on, both of them checked here rather than assumed:
 *
 *   1. `--check` can go red. `--checkselftest` builds a good fixture and six broken ones -- a
 *      leaked machine path, a shape nobody covers any more, an empty-string payload that stops
 *      being empty once synthesised, too few sessions, too few rows, and one that cannot pass --
 *      and requires each to be rejected for its own reason. Without this, "fixture check OK" is a
 *      string, not a verdict.
 *   2. The committed fixture passes. That is the state anyone else will clone.
 *
 * The second half of the file drives the `--check` branch itself rather than checkFixture(), and
 * that split is not tidiness -- it is the whole lesson of mutation A. Disabling the branch that
 * prints the verdict leaves the function judging correctly, leaves --checkselftest passing, and
 * leaves `node tests/make-fixtures.mjs --check` printing "fixture check OK" and exiting 0. It
 * survived the first version of this guard. A property can be computed correctly and still be
 * invisible from every path anybody actually runs, so the broken trees are pushed through the real
 * CLI and read by exit code, using --root and --emit-demo-tree so the committed bytes are never
 * the thing being broken.
 *
 * mutate-fixture.py carries those mutations as a permanent record; the shapeOf() structure check
 * is deliberately not in it, with the reason written there.
 */
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const script = join(HERE, 'make-fixtures.mjs');

let pass = 0;
const failures = [];
function assert(name, ok, detail) {
  if (ok) { pass += 1; return; }
  failures.push(detail ? `${name} — ${detail}` : name);
}

function run(...flags) {
  const r = spawnSync(process.execPath, [script, ...flags], { encoding: 'utf8', cwd: HERE, maxBuffer: 16 * 1024 * 1024 });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

/* ---------- 1. the gate has to be able to reject ---------- */

const self = run('--checkselftest');
assert('--checkselftest passes: the gate clears a good tree and rejects each broken one',
  self.code === 0, self.out.split('\n').filter((l) => /MISSED|FAILED/.test(l)).join(' | ') || `exit ${self.code}`);

// Four cases, and each must be rejected for its *own* reason. A gate that rejected the broken trees
// with some unrelated complaint -- "too few sessions", say -- would satisfy a weaker version of
// this and prove nothing about leaks or coverage.
for (const [label, kind] of [
  ['machine path leaked in', 'fixture leak'],
  ['a shape went missing', 'MISSING coverage'],
  ['empty payload drifts', 'changes coverage when distilled again'],
]) {
  assert(`--check rejects "${label}" by naming ${kind}`,
    new RegExp(`ok\\s+${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(self.out));
}
assert('the good tree is the one case that comes back clean',
  /ok\s+good tree\s+clean/.test(self.out) && !/MISSED/.test(self.out));

// The wiring, not the verdict. On a healthy tree every case passes, so `ok` is never cleared and
// "a case was missed -> the process exits non-zero" is invisible from outside. Force the failure.
const brokenSelf = run('--checkselftest-broken');
assert('a missed case makes --checkselftest exit non-zero and say so',
  brokenSelf.code === 1 && /MISSED\s+this case cannot pass/.test(brokenSelf.out) && /check self-test FAILED/.test(brokenSelf.out),
  `exit ${brokenSelf.code}: ${brokenSelf.out.split('\n').filter((l) => /MISSED|FAILED/.test(l)).join(' | ')}`);

/* ---------- 2. the committed fixture has to pass ---------- */

const checked = run('--check');
assert('the committed fixture passes --check', checked.code === 0,
  checked.out.split('\n').filter((l) => /^ {2}- /.test(l)).slice(0, 3).join(' | ') || `exit ${checked.code}`);
// The success line, not just the exit code. Delete the --check branch and the script falls through
// to the distil path, which on a machine that happens to have ~/.minimax also exits 0 and also
// prints a coverage list -- the guard would call that a passing check. Only this line is unique to
// the branch that judges the committed tree.
assert('--check announces itself rather than falling through to the distiller',
  /\nfixture check OK/.test(checked.out) && !/dry run/.test(checked.out));
assert('--check reports coverage for all ten shapes the guards assert on',
  /userPrompt, injected, toolCall, thinking, reply, narration, toolResult, compaction, silent, toolError/.test(checked.out));
// Never the literal 8: SESSIONS_WANTED is a knob. The floor is the number verify-parsers depends on.
const sessionCount = Number(/sessions\s+:\s+(\d+)/.exec(checked.out)?.[1] ?? '0');
assert('--check counted the sessions without reaching for the live store', sessionCount >= 6,
  `parsed ${sessionCount} from: ${checked.out.split('\n').slice(0, 2).join(' | ')}`);

/* ---------- 3. the --check branch itself must report the verdict ---------- */

// Everything above proves checkFixture() works. None of it proves the branch a person actually
// types reports it: neuter `if (r.problems.length)` and the function still judges correctly, the
// self-test still passes, and `node tests/make-fixtures.mjs --check` still prints "fixture check
// OK" and exits 0. That mutation survived the first version of this guard. These four assertions
// are the ones that catch it -- they drive the real branch, over a real tree, and read its exit
// code rather than its prose.

function checkTree(which) {
  const made = run(`--emit-demo-tree=${which}`);
  if (made.code !== 0) return { code: made.code, out: made.out, root: '' };
  const root = made.out.split('\n').filter(Boolean).at(-1);
  const r = spawnSync(process.execPath, [script, '--check', `--root=${root}`], { encoding: 'utf8', cwd: HERE, maxBuffer: 16 * 1024 * 1024 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  rmSync(root, { recursive: true, force: true });
  return { code: r.status, out: out.trim(), root };
}

const COMMITTED_ROOT = join(HERE, 'fixtures', 'minimax-home');

const goodTree = checkTree('good');
assert('--check exits 0 on a tree that is genuinely fine', goodTree.code === 0 && /fixture check OK/.test(goodTree.out),
  `exit ${goodTree.code}: ${goodTree.out.split('\n').slice(-2).join(' | ')}`);
// Which tree it judged is the one thing a reader of the output takes away from it. A branch that
// computed the right verdict against the wrong directory and printed the committed one's name
// would satisfy every other assertion here while lying to whoever reads the output.
assert('--check names the tree it actually judged',
  goodTree.out.includes(`fixture root : ${goodTree.root}`) && !goodTree.out.includes(COMMITTED_ROOT),
  goodTree.out.split('\n')[0]);

for (const [which, named] of [
  ['leak', /fixture leak/],
  ['hole', /MISSING coverage/],
  ['drift', /changes coverage when distilled again/],
  ['thin', /verify-parsers asserts entries\.length > 5/],
  ['short', /below the 12 floor/],
]) {
  const t = checkTree(which);
  assert(`--check exits 1 on a "${which}" tree and names the problem`, t.code === 1 && named.test(t.out),
    `exit ${t.code}: ${t.out.split('\n').slice(-1)[0] ?? ''}`);
}

/* ---------- 4. the writer must not be able to grade itself ---------- */

const both = run('--check', '--record');
assert('--check and --record refuse to run together', both.code === 2 && /pick one/.test(both.out),
  `exit ${both.code}: ${both.out.split('\n').slice(-1)[0] ?? ''}`);

console.log(`[fixture] ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exitCode = 1;
}