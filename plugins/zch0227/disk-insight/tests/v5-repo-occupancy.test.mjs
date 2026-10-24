// @ts-check
// v5 代码仓库合计的口径：顶部合计和四项分项按占用口径（APFS 克隆、硬链接只算一次），不超过磁盘真实占用；
// 每个仓库、worktree 的大小和排序仍按 du 口径（每份都算），和 du 对得上。
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../miniapp/node/app.mjs';
import { fakeExec, fakeLogger, fakeRemove, makeTmp, removeTmp, writeFile } from './helpers.mjs';

/** 目录不计大小，文件按逻辑大小：结果可以精确比对。 @param {any} st */
const sizeOf = (st) => (st.isDirectory() ? 0 : st.size);

/** 目录里全部文件的大小之和，克隆和硬链接每份都算（du 口径）。 @param {string} p @returns {Promise<number>} */
async function duOf(p) {
  const st = await fsp.lstat(p);
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const name of await fsp.readdir(p)) total += await duOf(path.join(p, name));
  return total;
}

const CLONE = 300 * 1024;

test('两个 worktree 共享克隆的 node_modules：合计按占用口径只算一份，单个仓库和 worktree 仍按 du 口径；四项之和等于合计；可释放大小不变', async (t) => {
  const dir = await makeTmp('v5-occ');
  t.after(() => removeTmp(dir));
  await fsp.mkdir(path.join(dir, 'disk'), { recursive: true });
  const disk = await fsp.realpath(path.join(dir, 'disk'));
  const home = path.join(disk, 'home');
  const code = path.join(home, 'code');
  const main = path.join(code, 'main');
  const gitDir = path.join(main, '.git');
  const wts = ['wt1', 'wt2'].map((n) => path.join(code, 'wts', n));
  // 克隆的来源放在扫描范围外（模拟 pnpm 存储），范围里只有两份克隆
  const src = path.join(disk, 'store', 'x.bin');
  await writeFile(src, Buffer.alloc(CLONE, 7));
  await writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
  await writeFile(path.join(gitDir, 'index'), 'i');
  await writeFile(path.join(gitDir, 'objects', 'pack', 'p.pack'), Buffer.alloc(500));
  await writeFile(path.join(main, 'src.txt'), Buffer.alloc(200));
  for (const wt of wts) {
    const name = path.basename(wt);
    await writeFile(path.join(gitDir, 'worktrees', name, 'gitdir'), `${path.join(wt, '.git')}\n`);
    await writeFile(path.join(gitDir, 'worktrees', name, 'HEAD'), `ref: refs/heads/${name}\n`);
    await writeFile(path.join(wt, '.git'), `gitdir: ${path.join(gitDir, 'worktrees', name)}\n`);
    await writeFile(path.join(wt, 'package.json'), '{}');
    await writeFile(path.join(wt, 'a.txt'), Buffer.alloc(50));
    await fsp.mkdir(path.join(wt, 'node_modules'), { recursive: true });
  }
  // 克隆特征是 ctime 比复制来的 mtime/birthtime 晚 2 秒以上，先等一会儿再克隆（同 scanner.test.mjs）。
  await new Promise((r) => setTimeout(r, 2200));
  const cp = (/** @type {string[]} */ args) => new Promise((resolve) => execFile('/bin/cp', args, (err) => resolve(!err)));
  if (!(await cp(['-c', src, path.join(wts[0], 'node_modules', 'x.bin')]))) {
    t.skip('当前文件系统不支持克隆');
    return;
  }
  assert.ok(await cp(['-c', src, path.join(wts[1], 'node_modules', 'x.bin')]));

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
    sizeOf,
    concurrency: 8,
    gitPath: async () => '/fake/git',
  });
  t.after(() => app.dispose());
  await app.startScan({ paths: [code] });
  await app.waitIdle();

  const [duMain, duGit, duWt1, duWt2, duCode] = await Promise.all([duOf(main), duOf(gitDir), duOf(wts[0]), duOf(wts[1]), duOf(code)]);
  // 前提：目录树的 size 口径里两份克隆只算一份
  assert.equal(app.views.treeJSON(null, null, null, '1').node.sizeBytes, duCode - CLONE, '前提：克隆在目录树里只算一次');

  const res = await app.reposJSON(new URLSearchParams());
  assert.equal(res.repos.length, 1);
  const a = res.repos[0];
  assert.ok(a.main);
  // 单个仓库、worktree：du 口径，每份克隆都算
  assert.equal(a.sizeBytes, duMain + duWt1 + duWt2, '单个仓库按 du 口径');
  assert.equal(a.worktreeBytes, duWt1 + duWt2);
  assert.equal(a.depsBytes, 2 * CLONE, '单个仓库的依赖按 du 口径，两份都算');
  assert.deepEqual([a.main.sizeBytes, a.main.gitBytes, a.main.depsBytes], [duMain, duGit, 0]);
  const wl = (await app.worktreesJSON(a.id)).worktrees;
  assert.deepEqual(wl.map((w) => [w.name, w.sizeBytes, w.depsBytes]), [['wt1', duWt1, CLONE], ['wt2', duWt2, CLONE]], '每个 worktree 都是完整的 du 大小');

  // 顶部合计和分项：占用口径，克隆只算一份
  const s = res.summary;
  assert.equal(s.sizeBytes, a.sizeBytes - CLONE, '合计按占用口径，比各仓库 du 之和少一份克隆');
  assert.deepEqual(s.breakdown, { mainSourceBytes: duMain - duGit, gitBytes: duGit, worktreeSourceBytes: duWt1 - CLONE + duWt2 - CLONE, depsBytes: CLONE });
  const bd = s.breakdown;
  assert.equal(bd.mainSourceBytes + bd.gitBytes + bd.worktreeSourceBytes + bd.depsBytes, s.sizeBytes, '四项之和等于合计');
  assert.ok(s.sizeBytes <= duCode - CLONE, '合计不超过目录树里的真实占用');

  // 可释放大小不变：仍是各仓库 releasableBytes 之和；去重掉的那份克隆本来就不可释放
  assert.equal(s.releasableBytes, a.releasableBytes);
  assert.equal(a.releasableBytes, a.sizeBytes - CLONE);
});
