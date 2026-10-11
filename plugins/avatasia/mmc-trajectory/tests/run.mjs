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
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const REAL = args.includes('--real');
const filter = args.find((a) => !a.startsWith('--')) ?? '';

// verify-time-range.mjs is here but not run. Its assertions are calibrated against a full
// multi-generation session — stats.messages > 1000, a checkpoint nested inside a turn — and the
// committed fixture is a single-file session of a few dozen rows. Shipping it in the default set
// would mean shipping a red suite; relax the numbers instead and the timezone arithmetic stops
// being exercised at all. Run it by hand against a booted service: see its own header.
const SKIP = new Set(['verify-time-range.mjs']);

const files = readdirSync(HERE)
  .filter((n) => n !== 'run.mjs' && n !== 'README.md' && !SKIP.has(n)
    && (n.startsWith('verify-') || n.startsWith('mutate-')
      || n === 'client-check.mjs' || n === 'check-light-theme.mjs'))
  .filter((n) => !filter || n.startsWith(filter))
  .sort();

const results = [];
for (const name of files) {
  const isPy = name.endsWith('.py');
  const cmd = isPy
    ? ['python', join(HERE, name)]
    : [process.execPath, join(HERE, name), ...(REAL ? ['--real'] : [])];
  const started = Date.now();
  const r = spawnSync(cmd[0], cmd.slice(1), {
    cwd: HERE,
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  const ok = r.status === 0;
  results.push({ name, ok, ms: Date.now() - started, tail: out.split('\n').filter(Boolean).slice(-1)[0] ?? '' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(30)} ${String(Date.now() - started).padStart(6)}ms  ${results.at(-1).tail.slice(0, 70)}`);
}

const failed = results.filter((r) => !r.ok);
console.log();
console.log(`${results.length - failed.length}/${results.length} guards passed`);
if (failed.length) {
  console.log('failed: ' + failed.map((f) => f.name).join(', '));
  process.exitCode = 1;
}