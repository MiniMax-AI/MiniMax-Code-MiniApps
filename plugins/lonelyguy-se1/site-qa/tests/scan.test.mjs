import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { assertProjectRoot, promptForFinding, scanProject } from '../miniapp/node/scan.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'site-qa-'));
  await writeFile(
    path.join(root, 'index.html'),
    '<html><head></head><body><h1>Hi</h1><img src="x.png"></body></html>',
    'utf8',
  );
  await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  await writeFile(path.join(root, 'node_modules', 'pkg', 'index.html'), '<html></html>', 'utf8');
  await mkdir(path.join(root, 'docs'), { recursive: true });
  await writeFile(
    path.join(root, 'docs', 'guide.html'),
    '<html lang="en"><head><title>Guide page title text</title><meta name="description" content="A description that is long enough to avoid the short-description warning for this fixture." /><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><h1>Guide</h1></body></html>',
    'utf8',
  );
  return root;
}

test('scan finds HTML outside node_modules and returns fixable findings', async () => {
  const root = await fixture();
  const report = await scanProject(root);
  assert.equal(report.filesScanned, 2);
  assert.ok(report.findings.some((item) => item.file === 'index.html' && item.rule === 'img_missing_alt'));
  assert.ok(!report.pages.some((page) => page.relative.includes('node_modules')));
  const img = report.findings.find((item) => item.rule === 'img_missing_alt');
  const prompt = promptForFinding(report, img.id);
  assert.match(prompt, /img_missing_alt/);
  assert.match(prompt, /index\.html/);
});

test('home, missing paths and MiniMax data dirs are refused', async () => {
  const root = await fixture();
  await assert.rejects(() => assertProjectRoot(path.join(root, 'nope')), (error) => error.code === 'path_missing');
  await assert.rejects(() => assertProjectRoot(root, { home: root }), (error) => error.code === 'path_too_broad');
  const data = await mkdtemp(path.join(tmpdir(), 'minimax-data-'));
  const nested = path.join(data, 'plugins', 'site-qa');
  await mkdir(nested, { recursive: true });
  await assert.rejects(() => assertProjectRoot(nested, { minimaxDataDir: data }), (error) => error.code === 'path_forbidden');
});
