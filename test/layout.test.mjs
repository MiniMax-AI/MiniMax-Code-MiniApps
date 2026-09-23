import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkImageFile, checkLayout, checkNameMatchesDirectory } from '../scripts/lib/rules/layout.mjs';
import { createReport } from '../scripts/lib/report.mjs';
import { codes, copyExample, makeTmpRoot } from './helpers.mjs';

test('layout: baseline copy passes', async () => {
  const root = await makeTmpRoot();
  const { dir } = await copyExample(root);
  const report = createReport();
  await checkLayout(report, { packageDir: dir, requireLowercaseAuthor: true });
  await checkNameMatchesDirectory(report, { packageDir: dir, name: 'hello-miniapp' });
  await checkImageFile(report, { packageDir: dir, relativePath: 'icon.png', label: 'icon' });
  assert.deepEqual(report.diagnostics, []);
});

test('layout: missing LICENSE and uppercase author are errors', async () => {
  const root = await makeTmpRoot();
  const { dir } = await copyExample(root, { author: 'Tester' });
  await rm(path.join(dir, 'LICENSE'));
  const report = createReport();
  await checkLayout(report, { packageDir: dir, requireLowercaseAuthor: true });
  assert.deepEqual(codes(report.diagnostics), ['LAYOUT_AUTHOR_NOT_LOWERCASE', 'LAYOUT_FILE_MISSING']);
});

test('layout: author case is not checked for examples', async () => {
  const root = await makeTmpRoot();
  const { dir } = await copyExample(root, { author: 'Tester' });
  const report = createReport();
  await checkLayout(report, { packageDir: dir, requireLowercaseAuthor: false });
  assert.deepEqual(report.diagnostics, []);
});

test('layout: directory name must equal manifest name', async () => {
  const root = await makeTmpRoot();
  const { dir } = await copyExample(root, { dirName: 'other-name' });
  const report = createReport();
  await checkNameMatchesDirectory(report, { packageDir: dir, name: 'hello-miniapp' });
  assert.deepEqual(codes(report.diagnostics), ['LAYOUT_NAME_MISMATCH']);
});

test('layout: icon must be a real PNG, JPEG, or WebP', async () => {
  const root = await makeTmpRoot();
  const { dir } = await copyExample(root);
  await writeFile(path.join(dir, 'icon.png'), 'not an image');
  const report = createReport();
  await checkImageFile(report, { packageDir: dir, relativePath: 'icon.png', label: 'icon' });
  assert.deepEqual(codes(report.diagnostics), ['LAYOUT_IMAGE_INVALID']);
});
