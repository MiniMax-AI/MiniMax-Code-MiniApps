// @ts-check
// 重复文件不比对 git 工作区（主仓库和 worktree）里的文件：同一仓库的不同 worktree 里有相同文件是正常的。
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../miniapp/node/app.mjs';
import { MB } from '../miniapp/node/util.mjs';
import { fakeExec, fakeLogger, fakeRemove, makeTmp, removeTmp, writeFile } from './helpers.mjs';

test('重复文件跳过 git 工作区里的文件（仓库根目录、子目录、扫描根本身在仓库里），其他位置照常比对', async (t) => {
  const dir = await makeTmp('v4-dups');
  t.after(() => removeTmp(dir));
  await fsp.mkdir(path.join(dir, 'disk'), { recursive: true });
  const disk = await fsp.realpath(path.join(dir, 'disk'));
  const home = path.join(disk, 'home');
  const repo = path.join(home, 'code', 'repo');
  const wt = path.join(home, 'code', 'wt');
  const docs = path.join(home, 'docs');
  const seed = randomBytes(2 * MB);
  const seed2 = randomBytes(2 * MB);
  const doc = randomBytes(2 * MB);
  // 主仓库和 worktree：根目录和子目录里各有一份相同的文件
  await writeFile(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  await writeFile(path.join(repo, 'seed.bin'), seed);
  await writeFile(path.join(repo, 'pkg', 'seed2.bin'), seed2);
  await writeFile(path.join(wt, '.git'), `gitdir: ${path.join(repo, '.git', 'worktrees', 'wt')}\n`);
  await writeFile(path.join(wt, 'seed.bin'), seed);
  await writeFile(path.join(wt, 'pkg', 'seed2.bin'), seed2);
  // 仓库外：一对真正的重复文件；seed 在仓库外只有一份，不成组
  await writeFile(path.join(docs, 'a.bin'), doc);
  await writeFile(path.join(docs, 'b.bin'), doc);
  await writeFile(path.join(docs, 'seed-copy.bin'), seed);

  const app = createApp({
    platform: 'darwin',
    env: {},
    home,
    tmpdir: path.join(disk, 'tmp'),
    fs: fsp,
    exec: fakeExec(),
    dataDir: path.join(dir, 'data'),
    logger: fakeLogger(),
    disks: async () => [{ id: 'a', label: 'Disk A', mount: disk, totalBytes: 1e12, usedBytes: 5e9, freeBytes: 9e11, kind: 'internal', defaultScan: true, deletable: true }],
    remove: fakeRemove(),
    fullDiskAccess: async () => 'granted',
    runningApps: async () => new Set(),
    goModCache: async () => null,
    sizeOf: (st) => st.size,
  });
  t.after(() => app.dispose());
  const groups = () => app.views.duplicatesJSON().groups.map((g) => g.files.map((/** @type {any} */ f) => f.path).sort());

  await app.startScan({ diskIds: ['a'] });
  await app.waitIdle();
  assert.deepEqual(groups(), [[path.join(docs, 'a.bin'), path.join(docs, 'b.bin')]]);
  assert.equal(app.views.duplicatesJSON().wastedBytes, 2 * MB);

  // 扫描根本身位于仓库里（.git 在扫描根上面）：同样跳过
  await app.startScan({ paths: [path.join(repo, 'pkg'), path.join(wt, 'pkg'), docs] });
  await app.waitIdle();
  assert.deepEqual(groups(), [[path.join(docs, 'a.bin'), path.join(docs, 'b.bin')]]);

  // 对照：没有 .git 时，同样的文件照常算重复
  await fsp.rm(path.join(repo, '.git'), { recursive: true });
  await fsp.rm(path.join(wt, '.git'));
  await app.startScan({ diskIds: ['a'] });
  await app.waitIdle();
  assert.equal(groups().length, 3);
});
