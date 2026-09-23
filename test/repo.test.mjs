import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { discoverPackages, validateRepository } from '../scripts/lib/repo.mjs';
import { codes, copyExample, editJson, makeTmpRoot } from './helpers.mjs';

async function readmes(root, names) {
  const rows = names.map((n) => `| [${n.id}](plugins/${n.author}/${n.id}/) | x | [${n.author}](https://github.com/${n.author}) |`).join('\n');
  await writeFile(path.join(root, 'README.md'), `# Repo\n\n| MiniApp | What | Author |\n| --- | --- | --- |\n${rows}\n`);
  const zh = names.map((n) => `| [${n.id}](plugins/${n.author}/${n.id}/README.zh-CN.md) | x | [${n.author}](https://github.com/${n.author}) |`).join('\n');
  await writeFile(path.join(root, 'README.zh-CN.md'), `# 仓库\n\n| MiniApp | 功能 | 作者 |\n| --- | --- | --- |\n${zh}\n`);
}

test('repo: discoverPackages lists plugins by author and examples, sorted', async () => {
  const root = await makeTmpRoot();
  await copyExample(root, { author: 'bob', dirName: 'hello-miniapp' });
  await copyExample(root, { author: 'alice', dirName: 'hello-miniapp' });
  const { cp } = await import('node:fs/promises');
  await cp(path.join(root, 'plugins', 'bob', 'hello-miniapp'), path.join(root, 'examples', 'hello-miniapp'), { recursive: true });
  const packages = await discoverPackages(root);
  assert.deepEqual(packages.map((p) => [p.kind, p.label]), [
    ['plugin', 'plugins/alice/hello-miniapp'],
    ['plugin', 'plugins/bob/hello-miniapp'],
    ['example', 'examples/hello-miniapp'],
  ]);
});

test('repo: duplicate plugin names across packages are an error', async () => {
  const root = await makeTmpRoot();
  await copyExample(root, { author: 'alice' });
  await copyExample(root, { author: 'bob' });
  await readmes(root, [{ author: 'alice', id: 'hello-miniapp' }, { author: 'bob', id: 'hello-miniapp' }]);
  const diagnostics = await validateRepository(root, await discoverPackages(root));
  assert.deepEqual(codes(diagnostics), ['REPO_DUPLICATE_NAME']);
});

test('repo: every plugin needs a link in both root READMEs; examples do not', async () => {
  const root = await makeTmpRoot();
  const { dir } = await copyExample(root, { author: 'alice', dirName: 'alpha' });
  await editJson(path.join(dir, '.minimax-plugin', 'plugin.json'), (m) => ({ ...m, name: 'alpha' }));
  const { cp } = await import('node:fs/promises');
  await cp(dir, path.join(root, 'examples', 'hello-miniapp'), { recursive: true });
  await editJson(path.join(root, 'examples', 'hello-miniapp', '.minimax-plugin', 'plugin.json'), (m) => ({ ...m, name: 'hello-miniapp' }));
  await readmes(root, []);
  const missing = await validateRepository(root, await discoverPackages(root));
  assert.deepEqual(codes(missing), ['REPO_README_LINK_MISSING', 'REPO_README_LINK_MISSING']);
  await readmes(root, [{ author: 'alice', id: 'alpha' }]);
  assert.deepEqual(await validateRepository(root, await discoverPackages(root)), []);
});
