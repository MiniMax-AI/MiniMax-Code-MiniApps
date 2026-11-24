import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Runs the bundled importer's Python suite as part of `npm test`.
test('bundled importer Python tests pass', () => {
  const dir = fileURLToPath(new URL('./python', import.meta.url));
  const python = process.env.PYTHON || 'python3';
  const result = spawnSync(python, ['-B', '-m', 'unittest', 'discover', '-s', dir, '-t', dir], { encoding: 'utf8', timeout: 300_000 });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stderr.slice(-4000));
  assert.match(result.stderr, /\nOK/);
});
