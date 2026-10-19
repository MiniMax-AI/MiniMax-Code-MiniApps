// @ts-check
// v5 worktree 登记核对：.git 文件指向某条 worktree 登记时，还要登记的 gitdir 指回这个目录才算 worktree（和 git worktree list 一致）。
// 拷贝出来的副本、登记已经不在的目录当普通目录处理，计入 repos.analyzed 的 notRegistered。
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../miniapp/node/app.mjs';
import { checkWorktreeRecord } from '../miniapp/node/repos.mjs';
import { createPathOps } from '../miniapp/node/util.mjs';
import { fakeExec, fakeLogger, fakeRemove, makeTmp, removeTmp, writeFile } from './helpers.mjs';

/** @param {any} st */
const sizeOf = (st) => (st.isDirectory() ? 0 : st.size);

/** 核对不通过的目录（相对 copies）和期望的原因。 */
const EXPECTED_NOT_REGISTERED = {
  copy1: 'points-elsewhere',
  copy2: 'points-elsewhere',
  ghost: 'points-elsewhere',
  'sw-copy': 'points-elsewhere',
  vanished: 'record-missing',
  nofile: 'record-missing',
  empty: 'record-missing',
};

/** @param {string} dir */
async function fixture(dir) {
  await fsp.mkdir(path.join(dir, 'disk'), { recursive: true });
  const disk = await fsp.realpath(path.join(dir, 'disk'));
  const home = path.join(disk, 'home');
  const code = path.join(home, 'code');
  const main = path.join(code, 'main');
  const wts = path.join(code, 'wts');
  const copies = path.join(code, 'copies');
  const store = path.join(home, 'store', 'sep.git');
  const sepMain = path.join(code, 'sep-main');
  const link = path.join(disk, 'code-link');
  const gitDir = path.join(main, '.git');
  const w = writeFile;
  /** 在 git 目录里写一条 worktree 登记；gitdirText 为 null 时不写 gitdir 文件。 */
  const reg = async (/** @type {string} */ gd, /** @type {string} */ name, /** @type {string | null} */ gitdirText) => {
    await w(path.join(gd, 'worktrees', name, 'HEAD'), `ref: refs/heads/${name}\n`);
    if (gitdirText !== null) await w(path.join(gd, 'worktrees', name, 'gitdir'), gitdirText);
  };
  const dotGit = (/** @type {string} */ d, /** @type {string} */ target) => w(path.join(d, '.git'), `gitdir: ${target}\n`);
  // 主仓库 main（.git 目录）
  await w(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
  await w(path.join(gitDir, 'index'), 'i');
  await w(path.join(gitDir, 'objects', 'pack', 'p.pack'), Buffer.alloc(100));
  await w(path.join(main, 'a.txt'), Buffer.alloc(100));
  // (a) 真实 worktree：登记指回自己；rel 的登记是相对路径（按登记目录解析）
  await reg(gitDir, 'real', `${path.join(wts, 'real', '.git')}\n`);
  await dotGit(path.join(wts, 'real'), path.join(gitDir, 'worktrees', 'real'));
  await reg(gitDir, 'rel', '../../../../wts/rel/.git\n');
  await dotGit(path.join(wts, 'rel'), path.join(gitDir, 'worktrees', 'rel'));
  // (d) 登记里写的是经过符号链接的路径，扫描到的是真实路径
  await reg(gitDir, 'via-link', `${path.join(link, 'wts', 'via-link', '.git')}\n`);
  await dotGit(path.join(wts, 'via-link'), path.join(gitDir, 'worktrees', 'via-link'));
  // (b) 副本：.git 文件原样拷贝，登记指向真实 worktree；ghost 的登记指向一个已经不存在的位置
  await dotGit(path.join(copies, 'copy1'), path.join(gitDir, 'worktrees', 'real'));
  await w(path.join(copies, 'copy1', 'f.txt'), Buffer.alloc(30));
  await dotGit(path.join(copies, 'copy2'), path.join(gitDir, 'worktrees', 'real'));
  await reg(gitDir, 'ghost', `${path.join(home, 'nowhere', 'ghost', '.git')}\n`);
  await dotGit(path.join(copies, 'ghost'), path.join(gitDir, 'worktrees', 'ghost'));
  // (c) 登记目录不存在、gitdir 文件不存在、gitdir 文件只有空白
  await dotGit(path.join(copies, 'vanished'), path.join(gitDir, 'worktrees', 'vanished'));
  await reg(gitDir, 'nofile', null);
  await dotGit(path.join(copies, 'nofile'), path.join(gitDir, 'worktrees', 'nofile'));
  await reg(gitDir, 'empty', '  \n');
  await dotGit(path.join(copies, 'empty'), path.join(gitDir, 'worktrees', 'empty'));
  // 独立 git 目录（在 code 外）的 worktree sw 和它的副本：借 byGitDir 归到 sep-main 下的候选同样核对
  await w(path.join(store, 'HEAD'), 'ref: refs/heads/main\n');
  await w(path.join(store, 'index'), 'i');
  await w(path.join(store, 'objects', 'pack', 'p.pack'), Buffer.alloc(100));
  await dotGit(sepMain, store);
  await w(path.join(sepMain, 'b.txt'), Buffer.alloc(50));
  await reg(store, 'sw', `${path.join(wts, 'sw', '.git')}\n`);
  await dotGit(path.join(wts, 'sw'), path.join(store, 'worktrees', 'sw'));
  await dotGit(path.join(copies, 'sw-copy'), path.join(store, 'worktrees', 'sw'));
  await fsp.symlink(code, link);
  const disks = [{ id: 'a', label: 'Disk A', mount: disk, totalBytes: 1e12, usedBytes: 5e9, freeBytes: 9e11, kind: 'internal', defaultScan: true, deletable: true }];
  return { disk, home, code, main, gitDir, wts, copies, store, sepMain, link, disks };
}

/** @param {string} dir @param {any} fx @param {any} [fs] */
function makeApp(dir, fx, fs = fsp) {
  const logger = fakeLogger();
  const app = createApp({
    platform: 'darwin',
    env: {},
    home: fx.home,
    tmpdir: path.join(fx.disk, 'tmp'),
    fs,
    exec: fakeExec(),
    dataDir: path.join(dir, 'data'),
    logger,
    disks: async () => fx.disks,
    remove: fakeRemove(),
    fullDiskAccess: async () => 'granted',
    runningApps: async () => new Set(),
    goModCache: async () => null,
    sizeOf,
    concurrency: 8,
    gitPath: async () => '/fake/git',
  });
  return { app, logger };
}

/** @param {any} logger */
const analyzed = (logger) => logger.events.find((/** @type {any} */ e) => e.msg === 'repos.analyzed')?.fields;

/** (f) counts 的三个新字段：总数、按原因计数、最多 5 条样本且每条原因正确。 @param {any} f @param {any} fx */
function assertNotRegistered(f, fx) {
  assert.equal(f.notRegistered, 7);
  assert.deepEqual(f.notRegisteredReasons, { 'points-elsewhere': 4, 'record-missing': 3 });
  assert.equal(f.notRegisteredSample.length, 5, '样本最多 5 条');
  const expected = new Map(Object.entries(EXPECTED_NOT_REGISTERED).map(([name, reason]) => [path.join(fx.copies, name), reason]));
  for (const s of f.notRegisteredSample) assert.equal(s.reason, expected.get(s.path), `样本 ${s.path} 的原因`);
  assert.equal(new Set(f.notRegisteredSample.map((/** @type {any} */ s) => s.path)).size, 5);
  assert.equal(f.skipped, 0, '核对不通过的不算 skipped');
}

test('checkWorktreeRecord：指回自己算；指向别处、登记缺失不算；符号链接两个方向、大小写、Windows 路径', async (t) => {
  const dir = await makeTmp('v5-backref-unit');
  t.after(() => removeTmp(dir));
  const fx = await fixture(dir);
  const po = createPathOps('posix');
  const rec = (/** @type {string} */ name) => path.join(fx.gitDir, 'worktrees', name);
  // (a) 指回自己；相对路径登记
  assert.equal(await checkWorktreeRecord(fsp, po, rec('real'), path.join(fx.wts, 'real')), null);
  assert.equal(await checkWorktreeRecord(fsp, po, rec('rel'), path.join(fx.wts, 'rel')), null);
  // (d) 登记经过符号链接、扫描路径是真实路径；以及反过来
  assert.equal(await checkWorktreeRecord(fsp, po, rec('via-link'), path.join(fx.wts, 'via-link')), null);
  assert.equal(await checkWorktreeRecord(fsp, po, rec('real'), path.join(fx.link, 'wts', 'real')), null);
  // (b) 副本、指向已经不存在的位置
  assert.equal(await checkWorktreeRecord(fsp, po, rec('real'), path.join(fx.copies, 'copy1')), 'points-elsewhere');
  assert.equal(await checkWorktreeRecord(fsp, po, rec('ghost'), path.join(fx.copies, 'ghost')), 'points-elsewhere');
  // (c) 登记目录不存在、gitdir 文件不存在、内容为空
  assert.equal(await checkWorktreeRecord(fsp, po, rec('vanished'), path.join(fx.copies, 'vanished')), 'record-missing');
  assert.equal(await checkWorktreeRecord(fsp, po, rec('nofile'), path.join(fx.copies, 'nofile')), 'record-missing');
  assert.equal(await checkWorktreeRecord(fsp, po, rec('empty'), path.join(fx.copies, 'empty')), 'record-missing');

  // 假 fs：realpath 原样返回，验证比较走 pathOps.key（大小写不敏感、Windows 分隔符）
  /** @param {Record<string, string>} files */
  const memFs = (files) => ({
    async open(/** @type {string} */ p) {
      if (!(p in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      const data = Buffer.from(files[p]);
      return {
        async read(/** @type {Buffer} */ buf, /** @type {number} */ off, /** @type {number} */ len, /** @type {number} */ pos) {
          return { bytesRead: data.copy(buf, off, pos, pos + len) };
        },
        async close() {},
      };
    },
    async realpath(/** @type {string} */ p) {
      return p;
    },
  });
  assert.equal(await checkWorktreeRecord(memFs({ '/r/.git/worktrees/fix/gitdir': '/R/Wts/Fix/.git\n' }), po, '/r/.git/worktrees/fix', '/r/wts/fix'), null);
  const win = createPathOps('win32');
  const wfs = memFs({ 'C:\\Users\\x\\repo\\.git\\worktrees\\fix\\gitdir': 'C:/Users/X/Repo/.worktrees/Fix/.git\r\n' });
  assert.equal(await checkWorktreeRecord(wfs, win, 'C:\\Users\\x\\repo\\.git\\worktrees\\fix', 'c:\\users\\x\\repo\\.worktrees\\fix'), null);
  assert.equal(await checkWorktreeRecord(wfs, win, 'C:\\Users\\x\\repo\\.git\\worktrees\\fix', 'D:\\copy\\fix'), 'points-elsewhere');
});

test('主仓库在范围里：真实 worktree 照常识别，副本和登记缺失的目录不算 worktree，日志带 notRegistered', async (t) => {
  const dir = await makeTmp('v5-backref-in');
  t.after(() => removeTmp(dir));
  const fx = await fixture(dir);
  const { app, logger } = makeApp(dir, fx);
  t.after(() => app.dispose());
  await app.startScan({ paths: [fx.code] });
  await app.waitIdle();
  const f = analyzed(logger);
  assert.ok(f);
  assert.deepEqual([f.repos, f.worktrees, f.separate], [2, 4, 1]);
  assertNotRegistered(f, fx);

  const res = await app.reposJSON(new URLSearchParams());
  assert.deepEqual(res.repos.map((r) => r.name).sort(), ['main', 'sep-main']);
  assert.equal(res.summary.worktreeCount, 4);
  const m = res.repos.find((r) => r.name === 'main');
  const s = res.repos.find((r) => r.name === 'sep-main');
  assert.ok(m && s);
  const names = async (/** @type {string} */ id) => (await app.worktreesJSON(id)).worktrees.map((w) => w.name).sort();
  assert.deepEqual(await names(m.id), ['real', 'rel', 'via-link'], '(a)(d) 指回自己、相对路径、经过符号链接的登记都算');
  assert.deepEqual(await names(s.id), ['sw'], '独立 git 目录的副本 sw-copy 不算');
  for (const w of (await app.worktreesJSON(m.id)).worktrees) assert.ok(!w.path.startsWith(fx.copies + path.sep));
  assert.equal(m.staleCount, 1, '失效记录判断不变：ghost 的登记指向不存在的位置');
});

test('(e) 主仓库不在范围里：副本照样排除，真实 worktree 照样识别，只读登记文件', async (t) => {
  const dir = await makeTmp('v5-backref-out');
  t.after(() => removeTmp(dir));
  const fx = await fixture(dir);
  /** @type {string[]} */
  const hits = [];
  /** @type {any} */
  const spy = { ...fsp };
  for (const k of ['open', 'readdir', 'lstat', 'stat', 'readFile', 'opendir', 'realpath']) {
    const real = /** @type {any} */ (fsp)[k];
    spy[k] = (/** @type {any} */ p, /** @type {any[]} */ ...rest) => {
      if (String(p).startsWith(fx.gitDir + path.sep)) hits.push(`${k}:${p}`);
      return real(p, ...rest);
    };
  }
  const { app, logger } = makeApp(dir, fx, spy);
  t.after(() => app.dispose());
  // (d) 扫描路径经过符号链接：扫描根按真实路径处理，登记里的真实路径仍能对上
  await app.startScan({ paths: [path.join(fx.link, 'wts'), fx.copies] });
  await app.waitIdle();
  const f = analyzed(logger);
  assert.ok(f);
  assert.deepEqual([f.repos, f.worktrees, f.outOfScopeMains], [2, 4, 2]);
  assertNotRegistered(f, fx);
  assert.ok(hits.length > 0);
  for (const h of hits) assert.match(h, /^open:.*[/\\]worktrees[/\\][^/\\]+[/\\]gitdir$/, '主仓库的 .git 里只读 worktree 的登记文件');

  const res = await app.reposJSON(new URLSearchParams());
  assert.ok(res.repos.every((r) => r.mainInScope === false));
  /** @type {string[]} */
  const all = [];
  for (const r of res.repos) for (const w of (await app.worktreesJSON(r.id)).worktrees) all.push(w.path);
  assert.deepEqual(all.sort(), [path.join(fx.wts, 'real'), path.join(fx.wts, 'rel'), path.join(fx.wts, 'sw'), path.join(fx.wts, 'via-link')]);
});
