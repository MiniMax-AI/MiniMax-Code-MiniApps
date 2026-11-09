import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { discoverSiteRoots } from '../miniapp/node/sites.mjs';

test('discoverSiteRoots prefers public/ and folders with index.html', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'site-qa-sites-'));
  await mkdir(path.join(root, 'public'), { recursive: true });
  await writeFile(path.join(root, 'public', 'index.html'), '<html lang="en"><title>Home page title</title></html>', 'utf8');
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src', 'note.html'), '<html></html>', 'utf8');

  const result = await discoverSiteRoots(root);
  assert.ok(result.sites.some((site) => site.path.endsWith(`${path.sep}public`)));
  assert.equal(result.workspace, await import('node:fs/promises').then(async (fs) => fs.realpath(root)));
});
