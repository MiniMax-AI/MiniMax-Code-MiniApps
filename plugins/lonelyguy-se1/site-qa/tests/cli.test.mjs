import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../skills/site-qa/run.mjs', import.meta.url));

test('cli prints a markdown report for a site folder', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'site-qa-cli-'));
  await writeFile(
    path.join(root, 'index.html'),
    '<html><head></head><body><img src="a.png"></body></html>',
    'utf8',
  );
  const { code, stdout, stderr } = await run(cli, [root]);
  assert.equal(code, 0, stderr);
  assert.match(stdout, /Site QA report/);
  assert.match(stdout, /img_missing_alt|title_missing/);
});

/** @param {string} script @param {string[]} args */
function run(script, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { env: process.env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
