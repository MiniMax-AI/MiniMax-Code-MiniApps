import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkReadme } from '../scripts/lib/rules/readme.mjs';
import { createReport } from '../scripts/lib/report.mjs';
import { codes, copyExample, makeTmpRoot } from './helpers.mjs';

async function run(transform) {
  const root = await makeTmpRoot();
  const { dir } = await copyExample(root);
  const file = path.join(dir, 'README.md');
  if (transform) await writeFile(file, transform(await readFile(file, 'utf8')));
  const report = createReport();
  await checkReadme(report, { packageDir: dir });
  return report.diagnostics;
}

test('readme: baseline has both headings', async () => {
  assert.deepEqual(await run(), []);
});

test('readme: CRLF line endings still match', async () => {
  assert.deepEqual(await run((text) => text.replace(/\n/gu, '\r\n')), []);
});

test('readme: each missing heading is one warning', async () => {
  const diagnostics = await run((text) => text.replace('## Data & access', '## Privacy'));
  assert.deepEqual(codes(diagnostics), ['README_HEADING_MISSING']);
  assert.equal(diagnostics[0].level, 'warning');
  assert.match(diagnostics[0].message, /## Data & access/u);
});

test('readme: missing README is not reported here (layout owns it)', async () => {
  const root = await makeTmpRoot();
  const { dir } = await copyExample(root);
  const { rm } = await import('node:fs/promises');
  await rm(path.join(dir, 'README.md'));
  const report = createReport();
  await checkReadme(report, { packageDir: dir });
  assert.deepEqual(report.diagnostics, []);
});
