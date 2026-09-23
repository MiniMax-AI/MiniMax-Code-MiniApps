import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const RETIRED_TERM = new RegExp(['live', 'board'].join(''), 'iu');
const SCAN = [
  'AGENTS.md',
  'CONTRIBUTING.md',
  'CONTRIBUTING.zh-CN.md',
  'README.md',
  'README.zh-CN.md',
  'package.json',
  'docs',
  'examples',
  'scripts',
  'test',
  '.github',
];
const BINARY = /\.(?:png|jpe?g|webp|ico)$/u;

async function* walk(target) {
  let entries;
  try {
    entries = await readdir(target, { withFileTypes: true });
  } catch {
    yield target;
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules') continue;
    yield* walk(path.join(target, entry.name));
  }
}

test('repository-owned files use only the current product vocabulary', async () => {
  const hits = [];
  for (const start of SCAN) {
    for await (const file of walk(path.join(REPO_ROOT, start))) {
      if (BINARY.test(file)) continue;
      const text = await readFile(file, 'utf8').catch(() => undefined);
      if (text !== undefined && RETIRED_TERM.test(text)) hits.push(path.relative(REPO_ROOT, file));
    }
  }
  assert.deepEqual(hits, [], `retired vocabulary found in: ${hits.join(', ')}`);
});
