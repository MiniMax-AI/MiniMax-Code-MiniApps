// Run every regression guard in this directory.
//
//   node tests/run.mjs            run all of them
//   node tests/run.mjs verify-    run only the verifiers
//   node tests/run.mjs mutate-   run only the mutation controls
//
// A guard that cannot fail is not a guard. That is what the mutate-* files are for: each one
// breaks one rule in the shipped source, runs the guard that owns that rule, and requires it to
// fail with the right reason before restoring the file byte-for-byte. If a mutation is reported
// as "survived", the guard it exercised is not actually testing anything.
//
// Nothing here needs a running Mini App, a network, or a specific machine's paths: every path
// resolves from this file's own location.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const REAL = args.includes('--real');
const filter = args.find((a) => !a.startsWith('--')) ?? '';

// The mutate-* controls rewrite shipped files in place. Each one restores what it found, and all
// of them now restore through `finally` plus atexit and a signal handler — but a hard kill (a
// killed terminal, taskkill /F, a power loss) runs no cleanup at all, and the file stays mutated.
// That failure is silent: the next run reads a mutated index.html and reports unrelated red, or a
// guard that suddenly "passes" for the wrong reason. So the shipped files this suite is about to
// rewrite are hashed before the first control runs and checked after the last one. A mismatch is
// reported as a failed guard of its own, with the restore command, instead of being inferred from
// whatever the next person sees.
//
// That catches a control that failed to restore DURING a run. A run that was killed outright writes
// nothing, so its residue can only be seen by comparing against the state the run BEFORE it ended
// with — which means a snapshot on disk, read at startup, and a report that is deliberately not a
// verdict. The two are separate findings: the drift below says "this run dirtied the source", the
// warning at startup says "the source was already different when this run began".
// There is no list here, and there was one until an independent review pass found what that cost.
//
// The rule this file enforces is "a mutate-* control leaves the source exactly as it found it". The
// first version enforced it over a hand-maintained list of the files a control rewrites, and the
// list — not the rule — was the weak point: `mutate-review16.py` rewrites this very file and
// `mutate-freshness.py` rewrites `verify-freshness.mjs`, and neither was on it, so a control killed
// mid-run could leave residue there and no check would have said so. A list that has to stay in step
// with 45 controls is a list that will not, and nothing owned the membership rule, so it drifted.
//
// So the whole tree is the subject instead. That cannot fall behind: a file nobody thought to list
// is still hashed, and one that appears during the run is still compared. The list also carried a
// dead entry — `docs/LAYERS.md` hashed to 'absent' on every run after it moved out of the package —
// which advertised protecting a shipped file that no longer existed here.
//
// The one exclusion is this runner's own bookkeeping file: it is written by this run, on purpose.
const SELF_EXCLUDE = ['tests/.shipped-snapshot.json'];

const ROOT = join(HERE, '..');

function treeDigests(prefix = '') {
  const out = {};
  for (const entry of readdirSync(join(ROOT, prefix), { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(out, treeDigests(rel));
    else if (!SELF_EXCLUDE.includes(rel)) out[rel] = digest(rel);
  }
  return out;
}
const SNAPSHOT = join(HERE, '.shipped-snapshot.json');

const digest = (rel) => {
  const p = join(ROOT, rel);
  if (!existsSync(p)) return 'absent';
  return createHash('sha256').update(readFileSync(p)).digest('hex');
};

const snapshotBefore = treeDigests();

// What the previous run left behind. The snapshot this reads was written by that run and meant the
// bytes it ended with, so a file that differs now is one of two things — a mutate-* control killed
// mid-run, or somebody edited the plugin after that run — and this suite cannot tell them apart.
// Both were once silent: nothing read the snapshot at all, so the residue surfaced only as unrelated
// red in whatever guard happened to read the mutated file, which reads as that guard being broken
// rather than as the checkout being dirty.
//
// Reported, not failed, and that is a decision rather than a dodge. The suite runs on machines with
// uncommitted work; failing on "these files are not what the last run left" would report a
// contributor writing code as a broken checkout, and the fix for that — trusting git — is exactly
// what is unavailable in an unpackaged copy. So the two states are named separately and only one
// of them is a verdict: this is a line above the results, the drift below is a failed guard.
const readSnapshot = () => {
  try {
    return existsSync(SNAPSHOT) ? JSON.parse(readFileSync(SNAPSHOT, 'utf8')) : null;
  } catch {
    // A missing or unreadable baseline is not a reason to stop. Without one there is nothing to
    // compare against, which is the state a fresh checkout is in, and that is a normal first run.
    return null;
  }
};

const previous = readSnapshot();

// Both key sets, and that is the whole fix. Iterating only the tree as it is now walks straight past
// a path the last run recorded and this tree no longer has — a rename, or a control that deleted a
// file — because that path is in neither `snapshotBefore` nor anywhere the filter would reach. It was
// a hole in a check whose entire claim is "compare against what the previous run left behind", and it
// was not in either direction: the end-of-run comparison already looked at both sides.
//
// A path that is NEW since the last run is not residue, so it stays filtered out: somebody adding a
// file is a contributor working, and calling that residue is the false positive that would make a
// contributor delete their own work.
const filesMissingSinceLastRun = (prev) => [...new Set([...Object.keys(snapshotBefore), ...Object.keys(prev)])]
  .filter((rel) => prev[rel] !== undefined && prev[rel] !== digest(rel));

const leftover = previous ? filesMissingSinceLastRun(previous) : [];

if (leftover.length) {
  console.log('');
  console.log(`WARN  ${'files differ from the last run'.padEnd(30)}  ${leftover.join(', ')}`);
  console.log('       either a mutate-* control was killed mid-run and left the source mutated,');
  console.log('       or these files were edited after that run. Not a failure: this suite runs on');
  console.log('       machines with uncommitted work, and a contributor writing code is not a broken');
  console.log('       checkout. The results below are only meaningful if you know which one it was.');
  console.log('       if you did not just edit them:  git checkout -- <file>');
}

function checkShipped() {
  const after = treeDigests();
  // Both directions. A file that moved is residue; a file that appeared is a control that wrote
  // something it did not clean up, which the old list could not have seen even in principle.
  const drift = Object.keys(snapshotBefore)
    .filter((rel) => after[rel] !== snapshotBefore[rel])
    .concat(Object.keys(after).filter((rel) => !(rel in snapshotBefore)));
  // Only a clean end becomes the baseline for the next run. Recording a drifted end would make the
  // next comparison agree with the mutation, which is the one thing this file exists to prevent.
  if (drift.length === 0) {
    try {
      writeFileSync(SNAPSHOT, JSON.stringify(after));
    } catch { /* the snapshot is bookkeeping, never a reason to fail the suite */ }
  }
  return drift;
}

// `--self-test-residue` proves the comparison above can fail, which a passing run cannot show.
//
// Two phases, because there are two directions and they fail for different reasons.
//
// Phase one plants a byte in `tests/verify-freshness.mjs`: that is a file `mutate-freshness.py`
// rewrites, and it was never on the hand-maintained list this replaced, so residue there used to be
// invisible by construction. This covers what moves DURING one invocation.
//
// Phase two asks the startup comparison about a path the last run recorded and this tree does not
// have — a rename, or a control that deleted a file. Phase one cannot reach it at all, because the
// snapshot it compares against was taken from a tree that still had everything in it. An earlier
// version of this file had only phase one and so reported the end-of-run check as exhaustive while
// the other direction walked past a deleted file in silence.
//
// Run by `verify-review16.mjs`, and by the mutations that narrow either direction.
if (args.includes('--self-test-residue')) {
  const TARGET = 'tests/verify-freshness.mjs';
  const GONE = 'tests/__absent-probe__.mjs';
  const original = readFileSync(join(ROOT, TARGET));
  const savedSnapshot = existsSync(SNAPSHOT) ? readFileSync(SNAPSHOT) : null;
  let caught = 1;
  try {
    writeFileSync(join(ROOT, TARGET), Buffer.concat([original, Buffer.from('\n')]));
    const named = checkShipped();
    caught = named.includes(TARGET) ? 0 : 1;
    console.log((caught === 0 ? 'caught ' : 'MISSED ') + TARGET + '  ' + JSON.stringify(named));

    const recorded = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
    writeFileSync(SNAPSHOT, JSON.stringify(Object.assign({}, recorded, { [GONE]: 'absent-probe' })));
    const named2 = filesMissingSinceLastRun(JSON.parse(readFileSync(SNAPSHOT, 'utf8')));
    const caught2 = named2.includes(GONE);
    console.log((caught2 ? 'caught-absent ' : 'MISSED-absent ') + GONE + '  ' + JSON.stringify(named2));
    if (caught === 0 && !caught2) caught = 1;
  } finally {
    // Restored here rather than left to the end-of-run check: this mode exits before the suite does.
    // And `process.exit` is called OUTSIDE the try, because it terminates the process without
    // unwinding — a `process.exit` inside the try skips this finally, which is exactly the residue
    // this check exists to catch. The whole-tree comparison caught that on its first real run.
    writeFileSync(join(ROOT, TARGET), original);
    // The snapshot is bookkeeping this mode borrowed and must give back, or the next run compares
    // against a path that never existed.
    if (savedSnapshot === null) rmSync(SNAPSHOT, { force: true });
    else writeFileSync(SNAPSHOT, savedSnapshot);
  }
  process.exit(caught);
}

// Nothing is excluded any more. `verify-time-range.mjs` used to be here, not run, because the only
// session it could get was whatever a booted service had — and the committed fixture is sixty rows
// of one afternoon, against assertions that want more than a thousand messages spanning a local
// midnight. Shipping it anyway would have meant shipping a red suite, and relaxing the numbers to
// fit the fixture would have meant not testing the timezone arithmetic at all. So it now builds its
// own transcript and hands it to the server's own `buildTrajectoryPayload`; see that file's header
// for why that is not the same as testing a fixture. A guard that is in the directory but never
// runs is not a guard, and that one was 152 assertions of one.
const files = readdirSync(HERE)
  .filter((n) => n !== 'run.mjs' && n !== 'README.md'
    && (n.startsWith('verify-') || n.startsWith('mutate-')
      || n === 'client-check.mjs' || n === 'check-light-theme.mjs'))
  .filter((n) => !filter || n.startsWith(filter))
  .sort();

const results = [];

// Which Python runs the mutate-* controls. Not a constant: `python` does not exist on a stock
// Linux or macOS image, where the interpreter is `python3`, and the 15 mutation files then all
// fail at once — 34 guards, 19 pass — for a reason that was invisible, because a spawn that never
// started has no stdout and no stderr, so the summary line printed an empty tail and named no
// cause. `PYTHON` is honoured first so a machine with both can say which one it meant.
const PYTHON_CANDIDATES = [process.env.PYTHON, 'python3', 'python'].filter(Boolean);

for (const name of files) {
  const isPy = name.endsWith('.py');
  // Probed once, not per file: whichever interpreter answers is the one every .py control uses,
  // so a partial run can never come from two different interpreters.
  let cmd;
  if (isPy) {
    cmd = null;
    let lastError = null;
    for (const candidate of PYTHON_CANDIDATES) {
      const probe = spawnSync(candidate, ['-c', 'import sys; sys.exit(0)'], { encoding: 'utf8' });
      if (!probe.error && probe.status === 0) { cmd = [candidate, join(HERE, name)]; break; }
      lastError = probe.error || new Error(`${candidate} exited ${probe.status}`);
    }
    if (!cmd) {
      const detail = lastError ? ` (${lastError.message})` : '';
      results.push({ name, ok: false, ms: 0, tail: `no Python interpreter found; tried ${PYTHON_CANDIDATES.join(', ')}${detail}` });
      console.log(`FAIL  ${name.padEnd(30)}       0ms  ${results.at(-1).tail.slice(0, 70)}`);
      continue;
    }
  } else {
    cmd = [process.execPath, join(HERE, name), ...(REAL ? ['--real'] : [])];
  }
  const started = Date.now();
  const r = spawnSync(cmd[0], cmd.slice(1), {
    cwd: HERE,
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  // r.error is the one thing stdout/stderr cannot carry: a process that never started produces
  // neither. Naming it is the difference between "19/34, no idea why" and a readable line.
  const tail = out.split('\n').filter(Boolean).slice(-1)[0] ?? '';
  const ok = r.status === 0 && !r.error;
  results.push({ name, ok, ms: Date.now() - started, tail: r.error ? r.error.message : tail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(30)} ${String(Date.now() - started).padStart(6)}ms  ${results.at(-1).tail.slice(0, 70)}`);
}

const failed = results.filter((r) => !r.ok);
console.log();
// A shipped file left mutated by a hard-killed run is itself a guard failure, reported by name
// rather than left to surface later as somebody else's unrelated red.
const drift = checkShipped();
if (drift.length) {
  console.log('');
  console.log(`FAIL  ${'package restored byte for byte'.padEnd(30)}  ${drift.join(', ')}`);
  console.log('       a mutate-* control ran to completion and left the source mutated. This run\'s own');
  console.log('       residue, not the one the warning above reported.');
  console.log('       restore with:  git checkout -- <file>');
  failed.push({ name: 'package restored byte for byte', ok: false });
}

console.log(`${results.length - failed.length}/${results.length} guards passed`);
if (failed.length) {
  console.log('failed: ' + failed.map((f) => f.name).join(', '));
  process.exitCode = 1;
}