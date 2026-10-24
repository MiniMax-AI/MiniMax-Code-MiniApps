// @ts-check
// v4 代码仓库：识别（主仓库、worktree、子模块、范围外不收录）、两种大小口径、状态解析和锁定、勾选前确认、
// select-deps、stale 和 prune（假执行器 + 测试临时目录下自建的临时仓库）、清理后更新、持久化。
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../miniapp/node/app.mjs';
import { createRunner } from '../miniapp/node/exec.mjs';
import { classifyGitdir, parseGitFile, parseHead, parseStatus } from '../miniapp/node/repos.mjs';
import { createPathOps } from '../miniapp/node/util.mjs';
import { fakeExec, fakeLogger, fakeRemove, makeTmp, removeTmp, writeFile } from './helpers.mjs';

/** 目录不计大小，文件按逻辑大小：结果可以精确比对。 @param {any} st */
const sizeOf = (st) => (st.isDirectory() ? 0 : st.size);

/** 目录里全部文件的大小之和，硬链接每份都算（和 du 口径一致）。 @param {string} p @returns {Promise<number>} */
async function duOf(p) {
  const st = await fsp.lstat(p);
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const name of await fsp.readdir(p)) total += await duOf(path.join(p, name));
  return total;
}

/** @param {() => Promise<boolean> | boolean} fn @param {number} [ms] */
async function waitFor(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('waitFor timeout');
}

/** @param {() => any} fn @param {string} code */
const rejectsCode = (fn, code) => assert.rejects(Promise.resolve().then(fn), (e) => /** @type {any} */ (e).code === code);

/** @param {string} dir */
async function fixture(dir) {
  await fsp.mkdir(path.join(dir, 'disk'), { recursive: true });
  const disk = await fsp.realpath(path.join(dir, 'disk'));
  const home = path.join(disk, 'home');
  const code = path.join(home, 'code');
  const main = path.join(code, 'main-a');
  const wts = path.join(code, 'wts');
  const wt1 = path.join(wts, 'wt1');
  const wtIn = path.join(main, '.worktrees', 'wt-in');
  const wtOut = path.join(wts, 'wt-out');
  const other = path.join(home, 'other', 'other-b');
  const wtX = path.join(home, 'elsewhere', 'wt-x');
  const w = writeFile;
  const rec = (/** @type {string} */ repo, /** @type {string} */ name, /** @type {string} */ wtDir, /** @type {string} */ head) =>
    Promise.all([w(path.join(repo, '.git', 'worktrees', name, 'gitdir'), `${path.join(wtDir, '.git')}\n`), w(path.join(repo, '.git', 'worktrees', name, 'HEAD'), head)]);
  // 主仓库 main-a：.git 目录、依赖、子模块、放在仓库目录里的 worktree、node_modules 里的 .git
  await w(path.join(main, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  await w(path.join(main, '.git', 'index'), Buffer.alloc(100));
  await w(path.join(main, '.git', 'objects', 'pack', 'p.pack'), Buffer.alloc(3000));
  await w(path.join(main, '.git', 'modules', 'sub', 'HEAD'), 'ref: refs/heads/main\n');
  await w(path.join(main, '.git', 'modules', 'sub', 'objects', 'info', 'packs'), 'P\n');
  await rec(main, 'wt1', wt1, 'ref: refs/heads/fix-x\n');
  await rec(main, 'wt-in', wtIn, 'abcdef0123456789abcdef0123456789abcdef01\n');
  await rec(main, 'wt-x', wtX, 'ref: refs/heads/x\n');
  await rec(main, 'gone', path.join(wts, 'gone'), 'ref: refs/heads/gone\n');
  await w(path.join(main, 'package.json'), '{}');
  await w(path.join(main, 'node_modules', 'x.js'), Buffer.alloc(900));
  await w(path.join(main, 'node_modules', 'pkg', '.git', 'HEAD'), 'ref: refs/heads/main\n');
  await w(path.join(main, 'src', 'a.txt'), Buffer.alloc(1000));
  await w(path.join(main, 'vendor', 'sub', '.git'), 'gitdir: ../../.git/modules/sub\n');
  await w(path.join(main, 'vendor', 'sub', 's.txt'), Buffer.alloc(100));
  await w(path.join(wtIn, '.git'), 'gitdir: ../../.git/worktrees/wt-in\n');
  await w(path.join(wtIn, 'f.txt'), Buffer.alloc(200));
  // worktree wt1：hl.bin 是 main-a/src/a.txt 的硬链接（du 口径每份都算，可释放不算）
  await w(path.join(wt1, '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'wt1')}\n`);
  await w(path.join(wt1, 'package.json'), '{}');
  await w(path.join(wt1, 'node_modules', 'y.js'), Buffer.alloc(700));
  await w(path.join(wt1, 'src.txt'), Buffer.alloc(300));
  await fsp.link(path.join(main, 'src', 'a.txt'), path.join(wt1, 'hl.bin'));
  // worktree wt-out：主仓库 other-b 在扫描范围外
  await w(path.join(wtOut, '.git'), `gitdir: ${path.join(other, '.git', 'worktrees', 'wt-out')}\n`);
  await w(path.join(wtOut, 'f.bin'), Buffer.alloc(400));
  await w(path.join(other, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  await w(path.join(other, '.git', 'index'), 'i');
  await rec(other, 'wt-out', wtOut, 'ref: refs/heads/feat\n');
  await w(path.join(other, '.git', 'worktrees', 'dead', 'gitdir'), `${path.join(home, 'nowhere', 'dead', '.git')}\n`);
  // main-a 在 code 外面的 worktree，以及包管理器缓存里的 .git
  await w(path.join(wtX, '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'wt-x')}\n`);
  await w(path.join(wtX, 'x.txt'), Buffer.alloc(50));
  await w(path.join(home, '.npm', '_cacache', 'pkg', '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const disks = [{ id: 'a', label: 'Disk A', mount: disk, totalBytes: 1e12, usedBytes: 5e9, freeBytes: 9e11, kind: 'internal', defaultScan: true, deletable: true }];
  return { disk, home, code, main, wts, wt1, wtIn, wtOut, other, wtX, disks };
}

/** @param {string} dir @param {any} fx @param {any} [extra] */
function makeApp(dir, fx, extra = {}) {
  const logger = fakeLogger();
  const exec = extra.exec || fakeExec();
  const app = createApp({
    platform: 'darwin',
    env: extra.env || {},
    home: fx.home,
    tmpdir: path.join(fx.disk, 'tmp'),
    fs: extra.fs || fsp,
    exec,
    dataDir: path.join(dir, extra.data || 'data'),
    logger,
    disks: async () => fx.disks,
    remove: fakeRemove(),
    fullDiskAccess: async () => 'granted',
    runningApps: async () => new Set(),
    goModCache: async () => null,
    sizeOf,
    concurrency: 8,
    gitPath: 'gitPath' in extra ? extra.gitPath : async () => '/fake/git',
  });
  return { app, exec, logger };
}

/** 假 git：按 worktree 路径给出 status 输出；prune 成功但什么都不做。 @param {Map<string, string>} outputs */
function fakeGit(outputs) {
  return fakeExec({
    execFile: (_cmd, args) => {
      if (args[2] === 'status') {
        const out = outputs.get(args[1]);
        return out === undefined ? { ok: false, exitCode: 128, error: null, stdout: '', stderr: 'fatal: not a git repository' } : { ok: true, exitCode: 0, error: null, stdout: out, stderr: '' };
      }
      if (args[2] === 'worktree' && args[3] === 'prune') return { ok: true, exitCode: 0, error: null, stdout: '', stderr: '' };
      return { ok: false, exitCode: 1, error: 'fake', stdout: '', stderr: '' };
    },
  });
}

/** 记录读到某个前缀下的路径（验证范围外主仓库的 .git 一次都没读）。 @param {string} prefix */
function spyFs(prefix) {
  /** @type {string[]} */
  const hits = [];
  /** @type {any} */
  const fs = { ...fsp };
  for (const k of ['open', 'readdir', 'lstat', 'stat', 'readFile', 'opendir', 'realpath']) {
    const real = /** @type {any} */ (fsp)[k];
    fs[k] = (/** @type {any} */ p, /** @type {any[]} */ ...rest) => {
      if (String(p).startsWith(prefix)) hits.push(`${k}:${p}`);
      return real(p, ...rest);
    };
  }
  return { fs, hits };
}

test('解析：.git 文件、gitdir 分类（含 Windows 路径）、HEAD、git status', () => {
  const posix = createPathOps('posix');
  assert.equal(parseGitFile('gitdir: ../../.git/worktrees/w\n', '/r/a/b', posix), '/r/.git/worktrees/w');
  assert.equal(parseGitFile('nothing', '/r', posix), null);
  assert.deepEqual(classifyGitdir('/r/main/.git/worktrees/fix', posix), { kind: 'worktree', mainPath: '/r/main', name: 'fix' });
  assert.deepEqual(classifyGitdir('/r/bare.git/worktrees/fix', posix), { kind: 'worktree', mainPath: '/r/bare.git', name: 'fix' });
  assert.deepEqual(classifyGitdir('/r/main/.git/modules/sub', posix), { kind: 'submodule' });
  assert.deepEqual(classifyGitdir('/r/main/.git/modules/sub/worktrees/x', posix), { kind: 'submodule' });
  assert.deepEqual(classifyGitdir('/elsewhere/gitdir', posix), { kind: 'other' });
  const win = createPathOps('win32');
  const gd = parseGitFile('gitdir: C:/Users/x/repo/.git/worktrees/fix\r\n', 'D:\\w\\fix', win);
  assert.equal(gd, 'C:\\Users\\x\\repo\\.git\\worktrees\\fix');
  assert.deepEqual(classifyGitdir(/** @type {string} */ (gd), win), { kind: 'worktree', mainPath: 'C:\\Users\\x\\repo', name: 'fix' });
  assert.deepEqual(classifyGitdir('C:\\Users\\x\\repo\\.git\\modules\\sub', win), { kind: 'submodule' });

  assert.equal(parseHead('ref: refs/heads/feat/a\n'), 'feat/a');
  assert.equal(parseHead('0123456789abcdef0123456789abcdef01234567\n'), '01234567');
  assert.equal(parseHead(null), null);

  assert.deepEqual(parseStatus('## main...origin/main\n'), { status: 'clean', changedCount: 0, aheadCount: 0, branch: 'main' });
  assert.deepEqual(parseStatus('## main\n'), { status: 'clean', changedCount: 0, aheadCount: 0, branch: 'main' });
  assert.deepEqual(parseStatus('## fix...origin/fix [ahead 3, behind 1]\n'), { status: 'ahead', changedCount: 0, aheadCount: 3, branch: 'fix' });
  assert.deepEqual(parseStatus('## HEAD (no branch)\r\n M a.txt\r\n?? b\r\n'), { status: 'dirty', changedCount: 2, aheadCount: 0, branch: null });
  assert.deepEqual(parseStatus('## No commits yet on dev\n?? x\n'), { status: 'dirty', changedCount: 1, aheadCount: 0, branch: 'dev' });
  assert.deepEqual(parseStatus('## a...o/a [ahead 1]\nM  z\n'), { status: 'dirty-ahead', changedCount: 1, aheadCount: 1, branch: 'a' });
  assert.equal(parseStatus('## a...o/a [behind 2]\n').status, 'clean');
});

test('仓库识别和两种口径：主仓库、worktree、子模块、范围外不收录；状态检查、锁定、勾选确认、select-deps、清理后更新、持久化', async (t) => {
  const dir = await makeTmp('v4-repos');
  t.after(() => removeTmp(dir));
  const fx = await fixture(dir);
  const outputs = new Map([
    [fx.wt1, '## fix-x...origin/fix-x\n'],
    [fx.wtIn, '## HEAD (no branch)\n M f.txt\n?? new.txt\n'],
    [fx.wtOut, '## feat...origin/feat [ahead 2]\n'],
  ]);
  const spy = spyFs(path.join(fx.other, '.git'));
  const { app, exec, logger } = makeApp(dir, fx, { exec: fakeGit(outputs), fs: spy.fs });
  t.after(() => app.dispose());
  /** @type {{ ev: string, data: any, at: number }[]} */
  const pushes = [];
  const broadcast = app.hub.broadcast.bind(app.hub);
  app.hub.broadcast = (ev, data) => {
    pushes.push({ ev, data, at: Date.now() });
    broadcast(ev, data);
  };

  // 扫描前（以及深度扫描完成前）是 pending
  assert.equal((await app.reposJSON(new URLSearchParams())).status, 'pending');
  await app.startScan({ paths: [fx.code] });
  await app.waitIdle();
  assert.equal(app.stateJSON().scan.status, 'done');
  assert.deepEqual(spy.hits, [`open:${path.join(fx.other, '.git', 'worktrees', 'wt-out', 'gitdir')}`], '主仓库在范围外时只读该 worktree 的登记文件做核对');
  assert.ok(logger.events.some((e) => e.msg === 'repos.analyzed' && e.fields.repos === 2 && e.fields.worktrees === 3 && e.fields.submodules === 1 && e.fields.notRegistered === 0));

  const res = await app.reposJSON(new URLSearchParams());
  assert.equal(res.status, 'ready');
  assert.equal(res.summary.repoCount, 2, '子模块、node_modules 里的 .git 不单独成行');
  assert.equal(res.summary.worktreeCount, 3, 'code 外面的 wt-x 不收录');
  const a = res.repos.find((r) => r.name === 'main-a');
  const b = res.repos.find((r) => r.name === 'other-b');
  assert.ok(a && b);

  const [duMain, duWtIn, duGit, duMainNm, duWt1, duWtOut] = await Promise.all([duOf(fx.main), duOf(fx.wtIn), duOf(path.join(fx.main, '.git')), duOf(path.join(fx.main, 'node_modules')), duOf(fx.wt1), duOf(fx.wtOut)]);
  const mainSize = duMain - duWtIn;
  assert.equal(a.path, fx.main);
  assert.equal(a.mainInScope, true);
  assert.ok(a.main);
  assert.match(String(a.main.entityId), /^n_/);
  assert.equal(a.main.sizeBytes, mainSize, '主仓库大小去掉放在里面的 worktree');
  assert.equal(a.main.releasableBytes, mainSize - 1000, '硬链接的文件不算可释放');
  assert.equal(a.main.gitBytes, duGit);
  assert.equal(a.main.depsBytes, duMainNm);
  assert.equal(a.worktreeCount, 2);
  assert.equal(a.worktreeBytes, duWt1 + duWtIn, 'du 口径：硬链接的文件在 worktree 里也算一份');
  assert.equal(a.worktreeReleasableBytes, duWt1 - 1000 + duWtIn);
  assert.equal(a.depsBytes, duMainNm + 700);
  assert.equal(a.sizeBytes, mainSize + duWt1 + duWtIn);
  assert.equal(a.releasableBytes, mainSize - 1000 + duWt1 - 1000 + duWtIn);
  assert.equal(a.lastActivityMs, (await fsp.lstat(path.join(fx.main, '.git', 'index'))).mtimeMs);
  assert.equal(a.staleCount, 1, 'gone 的目录不存在');
  assert.equal(a.gitDirOutside, false);
  assert.equal(b.gitDirOutside, false);
  assert.equal(b.mainInScope, false);
  assert.equal(b.main, null);
  assert.equal(b.lastActivityMs, null);
  assert.equal(b.staleCount, null);
  assert.equal(b.worktreeCount, 1);
  assert.equal(b.sizeBytes, duWtOut, '主仓库不在范围里时只算范围内的 worktree');
  const bd = res.summary.breakdown;
  assert.equal(bd.gitBytes, duGit);
  assert.equal(bd.depsBytes, duMainNm + 700);
  // 合计和分项是占用口径：硬链接 hl.bin 只算一次，算在先扫到的那份里（主仓库或 worktree，取决于扫描顺序）
  assert.equal(bd.mainSourceBytes + bd.worktreeSourceBytes, mainSize - duGit - duMainNm + duWt1 - 700 + duWtIn + duWtOut - 1000);
  assert.equal(res.summary.sizeBytes, a.sizeBytes + b.sizeBytes - 1000, '合计里硬链接只算一次，单个仓库仍是 du 口径');
  assert.equal(bd.mainSourceBytes + bd.gitBytes + bd.worktreeSourceBytes + bd.depsBytes, res.summary.sizeBytes, '四项互不重叠，加起来等于合计');
  // 目录树（空间地图）的 sizeBytes 仍是去重口径：硬链接只算一次
  const root = app.views.treeJSON(null, null, null, '1').node;
  assert.equal(root.sizeBytes, (await duOf(fx.code)) - 1000);

  // q 和 sort
  assert.deepEqual((await app.reposJSON(new URLSearchParams('q=OTHER'))).repos.map((r) => r.name), ['other-b']);
  assert.equal((await app.reposJSON(new URLSearchParams('q=OTHER'))).summary.repoCount, 2, 'summary 不受搜索影响');
  assert.deepEqual((await app.reposJSON(new URLSearchParams('sort=worktrees'))).repos.map((r) => r.name), ['main-a', 'other-b']);
  assert.deepEqual((await app.reposJSON(new URLSearchParams('sort=activity'))).repos.map((r) => r.name), ['main-a', 'other-b']);
  await rejectsCode(() => app.reposJSON(new URLSearchParams('sort=bad')), 'bad_request');
  await rejectsCode(() => app.worktreesJSON('p_zz'), 'not_found');

  // worktree 列表：分支、两种大小、未检查时锁定
  let wl = (await app.worktreesJSON(a.id)).worktrees;
  const byName = (/** @type {any[]} */ l, /** @type {string} */ n) => l.find((x) => x.name === n);
  assert.deepEqual(wl.map((x) => x.name).sort(), ['wt-in', 'wt1']);
  let w1 = byName(wl, 'wt1');
  assert.match(w1.id, /^n_/);
  assert.equal(w1.path, fx.wt1);
  assert.equal(w1.branch, 'fix-x');
  assert.equal(byName(wl, 'wt-in').branch, 'abcdef01', 'detached 显示提交号前 8 位');
  assert.equal(w1.sizeBytes, duWt1);
  assert.equal(w1.releasableBytes, duWt1 - 1000);
  assert.equal(w1.depsBytes, 700);
  assert.equal(w1.status, 'unchecked');
  assert.equal(w1.locked, true);
  assert.equal(w1.lockReason, '还没检查状态');
  assert.equal(app.views.resolve(w1.id)?.path, fx.wt1, 'id 是目录条目编号');
  const wOut = (await app.worktreesJSON(b.id)).worktrees[0];
  assert.equal(wOut.branch, null, '主仓库在范围外时不读它 .git 里的 HEAD');

  // 检查状态：202 后在后台跑，每批推送 results（kinds 含 repos）
  pushes.length = 0;
  await app.checkRepoStatus({ id: a.id });
  await app.checkRepoStatus({ id: a.id });
  await waitFor(async () => (await app.worktreesJSON(a.id)).worktrees.every((x) => x.status !== 'checking'));
  const statusCalls = exec.calls.filter((c) => c.args[2] === 'status');
  assert.equal(statusCalls.length, 2, '重复请求不重复检查');
  assert.deepEqual(statusCalls.map((c) => c.args[1]).sort(), [fx.wtIn, fx.wt1].sort());
  for (const c of statusCalls) {
    assert.equal(c.cmd, '/fake/git');
    assert.deepEqual(c.args, ['-C', c.args[1], 'status', '--porcelain=v1', '--branch']);
    assert.equal(c.opts.timeoutMs, 10000);
    assert.equal(c.opts.env.GIT_OPTIONAL_LOCKS, '0');
  }
  assert.ok(pushes.some((p) => p.ev === 'results' && p.data.kinds.includes('repos')));
  wl = (await app.worktreesJSON(a.id)).worktrees;
  w1 = byName(wl, 'wt1');
  const wIn = byName(wl, 'wt-in');
  assert.deepEqual([w1.status, w1.locked, w1.lockReason], ['clean', false, null]);
  assert.deepEqual([wIn.status, wIn.changedCount, wIn.locked, wIn.lockReason], ['dirty', 2, true, '有未提交的改动或未推送的提交，先提交或推送再清理']);

  // force：false 只检查 unchecked 和 error，true 全部重新检查；省略时等于 false
  const statusPaths = () => exec.calls.filter((c) => c.args[2] === 'status').map((c) => c.args[1]);
  const settle = () => waitFor(async () => (await app.worktreesJSON(a.id)).worktrees.every((x) => x.status !== 'checking'));
  await app.checkRepoStatus({ id: a.id, force: false });
  await settle();
  assert.equal(statusPaths().length, 2, '都检查过、没有失败的：force=false 不再检查');
  outputs.delete(fx.wt1);
  await app.checkRepoStatus({ id: a.id, force: true });
  await settle();
  assert.deepEqual(statusPaths().slice(2).sort(), [fx.wtIn, fx.wt1].sort(), 'force=true 全部重新检查');
  assert.equal(byName((await app.worktreesJSON(a.id)).worktrees, 'wt1').status, 'error');
  outputs.set(fx.wt1, '## fix-x...origin/fix-x\n');
  await app.checkRepoStatus({ id: a.id });
  await settle();
  assert.deepEqual(statusPaths().slice(4), [fx.wt1], '只重查 error 的那个');
  assert.equal(byName((await app.worktreesJSON(a.id)).worktrees, 'wt1').status, 'clean');
  await rejectsCode(() => app.checkRepoStatus({ id: a.id, force: 'yes' }), 'bad_request');

  // 勾选：clean 的可以；dirty 的跳过；还没检查的（wt-out）当场检查，ahead 跳过
  const sel = await app.updateSelection({ add: [w1.id, wIn.id, wOut.id] });
  assert.deepEqual(/** @type {any} */ (sel).skipped, [
    { id: wIn.id, reason: 'worktree_not_clean' },
    { id: wOut.id, reason: 'worktree_not_clean' },
  ]);
  assert.equal(sel.count, 1);
  const wOut2 = (await app.worktreesJSON(b.id)).worktrees[0];
  assert.deepEqual([wOut2.status, wOut2.aheadCount, wOut2.branch, wOut2.locked], ['ahead', 2, 'feat', true]);
  assert.equal(byName((await app.worktreesJSON(a.id)).worktrees, 'wt1').selected, true);

  // select-deps：主仓库和范围内 worktree 里的依赖目录，返回整个已选清单的合计
  await app.updateSelection({ clear: true });
  const deps = await app.selectRepoDeps({ id: a.id });
  assert.deepEqual(deps, { count: 2, bytes: duMainNm + 700 });
  const selItems = (await app.getSelection()).items.map((/** @type {any} */ i) => i.path).sort();
  assert.deepEqual(selItems, [path.join(fx.main, 'node_modules'), path.join(fx.wt1, 'node_modules')].sort());
  // 已选清单的 source：依赖目录是 junk，worktree 是 worktree，主仓库目录是 manual
  await app.updateSelection({ add: [w1.id, String(a.main.entityId)] });
  const src = Object.fromEntries((await app.getSelection()).items.map((/** @type {any} */ i) => [i.path, i.source]));
  assert.deepEqual(src, {
    [path.join(fx.main, 'node_modules')]: { type: 'junk', categoryId: 'build-artifacts' },
    [path.join(fx.wt1, 'node_modules')]: { type: 'junk', categoryId: 'build-artifacts' },
    [fx.wt1]: { type: 'worktree' },
    [fx.main]: { type: 'manual' },
  });
  await rejectsCode(() => app.selectRepoDeps({ id: 'p_zz' }), 'not_found');

  // 失效 worktree
  assert.deepEqual((await app.repoStaleJSON(a.id)).records, [{ name: 'gone', path: path.join(fx.wts, 'gone') }]);
  await rejectsCode(() => app.repoStaleJSON(b.id), 'main_not_in_scope');
  await rejectsCode(() => app.pruneRepo({ id: b.id }), 'main_not_in_scope');
  const pr = await app.pruneRepo({ id: a.id });
  assert.deepEqual(pr, { removed: 0, remaining: 1 }, '假执行器不删记录');
  const pruneCall = exec.calls.find((c) => c.args[2] === 'worktree');
  assert.deepEqual(pruneCall?.args, ['-C', fx.main, 'worktree', 'prune']);
  assert.equal(pruneCall?.opts.timeoutMs, 30000);
  assert.equal(exec.calls.filter((c) => c.args[2] === 'worktree').length, 1);

  // 清理 wt1：worktree 从列表里去掉，主仓库多一条失效记录
  await app.updateSelection({ clear: true });
  await app.updateSelection({ add: [w1.id] });
  const { jobId } = await app.startClean({ itemIds: [w1.id] });
  await app.waitIdle();
  assert.equal(app.getClean(jobId).results[0].ok, true);
  const after = (await app.reposJSON(new URLSearchParams())).repos.find((r) => r.id === a.id);
  assert.ok(after);
  assert.equal(after.worktreeCount, 1);
  assert.equal(after.staleCount, 2);
  assert.equal(after.worktreeBytes, duWtIn);
  assert.equal(after.depsBytes, duMainNm);
  assert.deepEqual((await app.repoStaleJSON(a.id)).records.map((r) => r.name), ['gone', 'wt1']);

  // 持久化：重新加载后数字一致，worktree 的 id 仍能解析
  const before = await app.reposJSON(new URLSearchParams());
  await app.dispose();
  const { app: app2 } = makeApp(dir, fx, { exec: fakeGit(outputs) });
  t.after(() => app2.dispose());
  const reloaded = await app2.reposJSON(new URLSearchParams());
  assert.deepEqual(reloaded, before);
  const wl2 = (await app2.worktreesJSON(a.id)).worktrees;
  assert.equal(wl2.length, 1);
  assert.equal(app2.views.resolve(wl2[0].id)?.path, fx.wtIn);
  assert.equal(wl2[0].status, 'unchecked', '状态缓存不持久化');
});

test('扫描范围包含主仓库：读失效记录和最近活动；规则目录里的 .git 不算；没有 git 时锁定、prune 返回 501；检查失败为 error', async (t) => {
  const dir = await makeTmp('v4-home');
  t.after(() => removeTmp(dir));
  const fx = await fixture(dir);
  const { app } = makeApp(dir, fx, { gitPath: async () => null });
  t.after(() => app.dispose());
  await app.startScan({ paths: [fx.home] });
  await app.waitIdle();
  const res = await app.reposJSON(new URLSearchParams());
  assert.deepEqual(res.repos.map((r) => r.name).sort(), ['main-a', 'other-b'], '.npm/_cacache 里的 .git 不算');
  const a = res.repos.find((r) => r.name === 'main-a');
  const b = res.repos.find((r) => r.name === 'other-b');
  assert.ok(a && b);
  assert.equal(a.worktreeCount, 3, 'wt-x 也在范围里了');
  assert.equal(b.mainInScope, true);
  assert.equal(b.staleCount, 1);
  assert.equal(typeof b.lastActivityMs, 'number');
  assert.deepEqual((await app.repoStaleJSON(b.id)).records, [{ name: 'dead', path: path.join(fx.home, 'nowhere', 'dead') }]);
  assert.equal(res.summary.worktreeCount, 4);

  await app.checkRepoStatus({ id: b.id });
  await waitFor(async () => (await app.worktreesJSON(b.id)).worktrees.every((x) => x.status !== 'checking'));
  const wOut = (await app.worktreesJSON(b.id)).worktrees[0];
  assert.equal(wOut.branch, 'feat', '主仓库在范围里时读 HEAD');
  assert.deepEqual([wOut.status, wOut.locked, wOut.lockReason], ['no-git', true, '没有找到 git，无法确认是否安全']);
  await rejectsCode(() => app.pruneRepo({ id: b.id }), 'no_git');
  const sel = await app.updateSelection({ add: [wOut.id] });
  assert.deepEqual(/** @type {any} */ (sel).skipped, [{ id: wOut.id, reason: 'worktree_not_clean' }]);

  // 检查超时 / 失败
  const { app: app3 } = makeApp(dir, fx, { data: 'data3', exec: fakeExec({ execFile: () => ({ ok: false, exitCode: null, error: 'timeout', stdout: '', stderr: '' }) }) });
  t.after(() => app3.dispose());
  await app3.startScan({ paths: [fx.code] });
  await app3.waitIdle();
  const a3 = (await app3.reposJSON(new URLSearchParams('q=main-a'))).repos[0];
  await app3.checkRepoStatus({ id: a3.id });
  await waitFor(async () => (await app3.worktreesJSON(a3.id)).worktrees.every((x) => x.status !== 'checking'));
  for (const w of (await app3.worktreesJSON(a3.id)).worktrees) assert.deepEqual([w.status, w.lockReason], ['error', '状态检查失败，无法确认是否安全']);
});

function gitUsable() {
  try {
    execFileSync('/usr/bin/xcode-select', ['-p'], { stdio: 'pipe' });
    execFileSync('git', ['--version'], { stdio: 'pipe' });
    return process.platform === 'darwin';
  } catch {
    return false;
  }
}

test('真实临时仓库（只在测试临时目录下自建）：git status 只读检查、stale 和 prune', { skip: !gitUsable() && '本机没有可用的 git' }, async (t) => {
  const dir = await makeTmp('v4-git');
  t.after(() => removeTmp(dir));
  await fsp.mkdir(path.join(dir, 'disk', 'repo'), { recursive: true });
  const disk = await fsp.realpath(path.join(dir, 'disk'));
  const repo = path.join(disk, 'repo');
  const env = { PATH: process.env.PATH || '/usr/bin:/bin', HOME: dir, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
  const g = (/** @type {string[]} */ ...args) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { env, stdio: 'pipe' });
  g('init', '-q', '-b', 'main');
  await writeFile(path.join(repo, 'a.txt'), 'a');
  g('add', '.');
  g('commit', '-q', '-m', 'init');
  const wa = path.join(disk, 'wts', 'a');
  const wb = path.join(disk, 'wts', 'b');
  g('worktree', 'add', '-q', '-b', 'a', wa);
  g('worktree', 'add', '-q', '-b', 'b', wb);
  await fsp.rm(wb, { recursive: true });
  await writeFile(path.join(wa, 'new.txt'), 'n');

  const fx = { disk, home: path.join(disk, 'home'), disks: [{ id: 'a', label: 'Disk A', mount: disk, totalBytes: 1e12, usedBytes: 5e9, freeBytes: 9e11, kind: 'internal', defaultScan: true, deletable: true }] };
  const logger = fakeLogger();
  const exec = createRunner({ spawn, execFile, logger });
  const { app } = makeApp(dir, fx, { exec, env, gitPath: undefined });
  t.after(() => app.dispose());
  await app.startScan({ paths: [disk] });
  await app.waitIdle();
  const res = await app.reposJSON(new URLSearchParams());
  assert.equal(res.repos.length, 1);
  const r = res.repos[0];
  assert.deepEqual([r.name, r.mainInScope, r.worktreeCount, r.staleCount], ['repo', true, 1, 1]);
  assert.equal((await app.worktreesJSON(r.id)).worktrees[0].branch, 'a');

  await app.checkRepoStatus({ id: r.id });
  await waitFor(async () => (await app.worktreesJSON(r.id)).worktrees.every((x) => x.status !== 'checking'), 15000);
  const w = (await app.worktreesJSON(r.id)).worktrees[0];
  assert.deepEqual([w.status, w.changedCount, w.aheadCount, w.locked], ['dirty', 1, 0, true]);

  assert.deepEqual((await app.repoStaleJSON(r.id)).records, [{ name: 'b', path: wb }]);
  assert.deepEqual(await app.pruneRepo({ id: r.id }), { removed: 1, remaining: 0 });
  assert.deepEqual((await app.repoStaleJSON(r.id)).records, []);
  assert.equal((await app.reposJSON(new URLSearchParams())).repos[0].staleCount, 0);
  const list = execFileSync('git', ['-C', repo, 'worktree', 'list', '--porcelain'], { env, stdio: 'pipe' }).toString();
  assert.ok(list.includes(wa) && !list.includes(wb), 'prune 只删了失效记录');
});

test('--separate-git-dir 的仓库算主仓库：git 目录在范围里时统计 .git 大小，不在时记为 0 并标 gitDirOutside', async (t) => {
  const dir = await makeTmp('v4-sep');
  t.after(() => removeTmp(dir));
  await fsp.mkdir(path.join(dir, 'disk'), { recursive: true });
  const disk = await fsp.realpath(path.join(dir, 'disk'));
  const home = path.join(disk, 'home');
  const code = path.join(home, 'code');
  const outGit = path.join(home, 'store', 'out.git');
  const inGit = path.join(code, 'gitdirs', 'in.git');
  const sepOut = path.join(code, 'sep-out');
  const sepIn = path.join(code, 'sep-in');
  const sw = path.join(code, 'sw');
  const gitDir = async (/** @type {string} */ d, /** @type {number} */ size) => {
    await writeFile(path.join(d, 'HEAD'), 'ref: refs/heads/main\n');
    await writeFile(path.join(d, 'index'), 'i');
    await writeFile(path.join(d, 'objects', 'pack', 'p.pack'), Buffer.alloc(size));
  };
  // sep-out 的 git 目录在扫描范围（code）外，sep-in 的在范围里、但不在仓库目录里
  await gitDir(outGit, 2000);
  await gitDir(inGit, 1500);
  await writeFile(path.join(sepOut, '.git'), 'gitdir: ../../store/out.git\n');
  await writeFile(path.join(sepOut, 'src.txt'), Buffer.alloc(500));
  await writeFile(path.join(sepIn, '.git'), `gitdir: ${inGit}\n`);
  await writeFile(path.join(sepIn, 'b.txt'), Buffer.alloc(200));
  // 独立 git 目录的 worktree 归到 sep-out 下；另有一条失效记录
  await writeFile(path.join(outGit, 'worktrees', 'sw', 'gitdir'), `${path.join(sw, '.git')}\n`);
  await writeFile(path.join(outGit, 'worktrees', 'sw', 'HEAD'), 'ref: refs/heads/sw\n');
  await writeFile(path.join(outGit, 'worktrees', 'old', 'gitdir'), `${path.join(code, 'old', '.git')}\n`);
  await writeFile(path.join(sw, '.git'), `gitdir: ${path.join(outGit, 'worktrees', 'sw')}\n`);
  await writeFile(path.join(sw, 'a.txt'), Buffer.alloc(300));
  // gitdir 指向的目录不是完整的 git 目录（没有 objects）：不收录
  await writeFile(path.join(code, 'notgit', 'HEAD'), 'ref: refs/heads/main\n');
  await writeFile(path.join(code, 'weird', '.git'), 'gitdir: ../notgit\n');
  const fx = { disk, home, disks: [{ id: 'a', label: 'Disk A', mount: disk, totalBytes: 1e12, usedBytes: 5e9, freeBytes: 9e11, kind: 'internal', defaultScan: true, deletable: true }] };
  const { app, exec, logger } = makeApp(dir, fx, { exec: fakeGit(new Map()) });
  t.after(() => app.dispose());
  await app.startScan({ paths: [code] });
  await app.waitIdle();
  assert.ok(logger.events.some((e) => e.msg === 'repos.analyzed' && e.fields.separate === 2 && e.fields.skipped === 1 && e.fields.repos === 2));

  const res = await app.reposJSON(new URLSearchParams());
  assert.deepEqual(res.repos.map((r) => r.name).sort(), ['sep-in', 'sep-out']);
  const o = res.repos.find((r) => r.name === 'sep-out');
  const i = res.repos.find((r) => r.name === 'sep-in');
  assert.ok(o && i && o.main && i.main);
  const [duSepOut, duSepIn, duInGit, duSw] = await Promise.all([duOf(sepOut), duOf(sepIn), duOf(inGit), duOf(sw)]);
  assert.deepEqual([o.mainInScope, o.gitDirOutside, o.main.gitBytes, o.main.sizeBytes], [true, true, 0, duSepOut], 'git 目录在范围外：.git 大小记为 0');
  assert.equal(o.worktreeCount, 1, '独立 git 目录的 worktree 归到主仓库下');
  assert.equal(o.staleCount, 1);
  assert.equal(o.lastActivityMs, (await fsp.lstat(path.join(outGit, 'index'))).mtimeMs);
  assert.deepEqual([i.gitDirOutside, i.main.gitBytes, i.main.sizeBytes], [false, duInGit, duSepIn + duInGit], 'git 目录在范围里：大小计入主仓库');
  assert.equal(i.main.releasableBytes, duSepIn + duInGit, 'git 目录节点留在目录树里，可释放大小同样计入');
  assert.equal(i.staleCount, 0);
  const bd = res.summary.breakdown;
  assert.equal(res.summary.sizeBytes, duSepOut + duSw + duSepIn + duInGit);
  assert.equal(bd.mainSourceBytes + bd.gitBytes + bd.worktreeSourceBytes + bd.depsBytes, res.summary.sizeBytes);
  assert.equal(bd.gitBytes, duInGit);

  const wl = (await app.worktreesJSON(o.id)).worktrees;
  assert.deepEqual(wl.map((w) => [w.name, w.branch, w.sizeBytes]), [['sw', 'sw', duSw]]);
  assert.deepEqual((await app.repoStaleJSON(o.id)).records, [{ name: 'old', path: path.join(code, 'old') }]);
  await app.pruneRepo({ id: o.id });
  assert.deepEqual(exec.calls.find((c) => c.args[2] === 'worktree')?.args, ['-C', sepOut, 'worktree', 'prune']);

  // 持久化后数字一致
  const before = await app.reposJSON(new URLSearchParams());
  await app.dispose();
  const { app: app2 } = makeApp(dir, fx, { exec: fakeGit(new Map()) });
  t.after(() => app2.dispose());
  assert.deepEqual(await app2.reposJSON(new URLSearchParams()), before);
});
