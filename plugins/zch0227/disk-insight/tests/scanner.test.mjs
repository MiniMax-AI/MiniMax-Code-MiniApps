// @ts-check
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createKeySet } from '../miniapp/node/clones.mjs';
import { createWalker } from '../miniapp/node/scanner.mjs';
import { CF, F, TNode, createTreeBuilder, forceFinalize, treeRows } from '../miniapp/node/tree.mjs';
import { createPathOps, MB } from '../miniapp/node/util.mjs';
import { makeTmp, removeTmp, sparseFile, writeFile } from './helpers.mjs';

const po = createPathOps('posix');

function noopHooks() {
  /** @type {string[]} */
  const denied = [];
  /** @type {string[]} */
  const done = [];
  return {
    denied,
    done,
    special: () => null,
    /** 子目录继承父目录的上下文位（和真实钩子一样）。 @param {TNode} node @param {string} _p @param {any} _m @param {{ node: TNode }[]} subdirs */
    deriveChildren(node, _p, _m, subdirs) {
      for (const s of subdirs) s.node.cf = node.cf;
    },
    onFile() {},
    onDirDone(/** @type {TNode} */ _n, /** @type {string} */ p) {
      done.push(p);
    },
    onDenied(/** @type {TNode} */ _n, /** @type {string} */ p) {
      denied.push(p);
    },
    forget() {},
  };
}

/**
 * @param {string} root @param {any} hooks @param {AbortSignal} [signal]
 * @param {{ fs?: any, cf?: number, clones?: boolean }} [opts]
 */
async function walk(root, hooks, signal = new AbortController().signal, opts = {}) {
  const fs = opts.fs || fsp;
  const st = await fs.lstat(root);
  const node = new TNode('root', null, F.DIR);
  node.rp = root;
  node.dev = st.dev;
  node.ino = st.ino;
  node.cf = opts.cf || 0;
  /** @type {any} */
  const stats = { files: 0, dirs: 0, bytes: 0, currentPath: '', bytesByDev: new Map() };
  const walker = createWalker({
    fs,
    pathOps: po,
    sizeOf: (s) => s.size,
    signal,
    hooks,
    inodes: createKeySet(),
    dirs: createKeySet(),
    clones: opts.clones ? createKeySet() : null,
    stats,
    concurrency: 4,
  });
  /** @type {any} */
  let error = null;
  try {
    await walker.walkRoots([{ node, path: root }]);
  } catch (e) {
    error = e;
  } finally {
    forceFinalize(node);
  }
  return { node, stats, error };
}

/** @param {TNode} n @param {string} name */
const child = (n, name) => (n.children || []).find((c) => c.name === name);

test('目录树裁剪：小子树丢弃子节点只留合计，≥50MB 文件保留', async (t) => {
  const dir = await makeTmp('tree');
  t.after(() => removeTmp(dir));
  await writeFile(path.join(dir, 'small', 'a', 'f1.txt'), Buffer.alloc(1000));
  await writeFile(path.join(dir, 'small', 'b', 'f2.txt'), Buffer.alloc(2000));
  await sparseFile(path.join(dir, 'big', 'movie.mp4'), 60 * MB);
  await writeFile(path.join(dir, 'big', 'sub', 'x.txt'), Buffer.alloc(10));
  const { node } = await walk(dir, noopHooks());
  const small = /** @type {TNode} */ (child(node, 'small'));
  const big = /** @type {TNode} */ (child(node, 'big'));
  assert.ok(small && big);
  assert.equal(small.children, null, '小于 10 MB 的子树丢弃子节点');
  assert.ok(small.size >= 3000 && small.size < 3000 + 4096, '合计保留（含目录本身的大小）');
  assert.ok(big.children, '大目录保留子节点');
  const movie = child(big, 'movie.mp4');
  assert.ok(movie && movie.flags & F.FILE, '≥ 50 MB 文件保留为节点');
  assert.ok(!child(big, 'x.txt'), '小文件不保留节点');
  assert.ok(node.size >= 60 * MB + 3000);
  assert.ok(node.flags & F.DONE);

  // 按行序列化往返（每行 2 个节点，验证跨行的父子关系）
  const builder = createTreeBuilder(() => {});
  let lines = 0;
  for (const rows of treeRows(node, 2)) {
    builder.add(JSON.parse(JSON.stringify(rows)));
    lines += 1;
  }
  const back = builder.root;
  assert.ok(lines > 1);
  assert.equal(back?.size, node.size);
  assert.equal(child(/** @type {TNode} */ (child(/** @type {TNode} */ (back), 'big')), 'movie.mp4')?.size, 60 * MB);
});

test('硬链接按 dev+ino 只算一次，可释放大小只算 nlink 为 1 的文件；不进入符号链接；hasGit 冒泡', async (t) => {
  const dir = await makeTmp('hardlink');
  t.after(() => removeTmp(dir));
  await writeFile(path.join(dir, 'h', 'a.bin'), Buffer.alloc(5000));
  await fsp.link(path.join(dir, 'h', 'a.bin'), path.join(dir, 'h', 'b.bin'));
  await writeFile(path.join(dir, 'solo.bin'), Buffer.alloc(700));
  await fsp.mkdir(path.join(dir, 'target-dir'));
  await writeFile(path.join(dir, 'target-dir', 'big.bin'), Buffer.alloc(9000));
  await fsp.symlink(path.join(dir, 'target-dir'), path.join(dir, 'link'));
  await fsp.mkdir(path.join(dir, 'proj', '.git'), { recursive: true });
  await writeFile(path.join(dir, 'proj', '.git', 'HEAD'), 'ref');
  await sparseFile(path.join(dir, 'pad.bin'), 20 * MB);
  const { node } = await walk(dir, noopHooks());
  const h = /** @type {TNode} */ (child(node, 'h'));
  assert.ok(h.size >= 5000 && h.size < 10000, '硬链接只算一次');
  assert.equal(h.rel, 0, 'nlink 为 2 的文件不计入可释放');
  assert.equal(child(node, 'link'), undefined, '符号链接不作为目录进入');
  const lnk = await fsp.lstat(path.join(dir, 'link'));
  const td = /** @type {TNode} */ (child(node, 'target-dir'));
  assert.ok(node.size < 5000 + 700 + td.size + 9000 + lnk.size + 2000 + 20 * MB, '链接目标没有被统计两次');
  assert.ok(node.rel >= 700 + 9000);
  const proj = /** @type {TNode} */ (child(node, 'proj'));
  assert.ok(proj.flags & F.HAS_GIT, '子项有 .git 时为真');
  assert.ok(node.flags & F.HAS_GIT, '向上冒泡');
});

test('取消扫描后补算未完成的目录，已得到的结果保留', async (t) => {
  const dir = await makeTmp('abort');
  t.after(() => removeTmp(dir));
  for (let i = 0; i < 30; i += 1) await writeFile(path.join(dir, `d${i}`, 'f.txt'), Buffer.alloc(100));
  const ac = new AbortController();
  const hooks = noopHooks();
  const origDone = hooks.onDirDone;
  hooks.onDirDone = (n, p) => {
    origDone.call(hooks, n, p);
    if (hooks.done.length === 5) ac.abort();
  };
  const { node, error } = await walk(dir, hooks, ac.signal);
  assert.equal(error && error.name, 'AbortError', '取消后 walkRoots 以 AbortError 结束');
  assert.ok(node.flags & F.DONE, '根节点被补算为完成');
  assert.ok(node.flags & F.PARTIAL, '标记为部分结果');
  assert.ok(node.size >= 5 * 100, '已完成目录的大小保留在合计里');
});

/**
 * 内存里的假文件系统，模拟 macOS firmlink：两条路径指向同一个目录（同一 dev + ino）。
 * @param {Record<string, { dir?: string[], size?: number, ino: number, nlink?: number, bigIno?: bigint }>} tree
 */
function aliasFs(tree) {
  const stat = (/** @type {string} */ p, /** @type {any} */ opts) => {
    const e = tree[p];
    if (!e) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    const isDir = !!e.dir;
    return {
      dev: 7,
      ino: opts && opts.bigint ? e.bigIno ?? BigInt(e.ino) : e.ino,
      nlink: e.nlink || 1,
      size: e.size || 0,
      blocks: 0,
      mtimeMs: 1000,
      birthtimeMs: 1000,
      ctimeMs: 1000,
      isDirectory: () => isDir,
      isFile: () => !isDir,
      isSymbolicLink: () => false,
    };
  };
  return {
    async lstat(/** @type {string} */ p, /** @type {any} */ opts) {
      return stat(p, opts);
    },
    async opendir(/** @type {string} */ p) {
      const e = tree[p];
      if (!e || !e.dir) throw Object.assign(new Error('ENOTDIR'), { code: 'ENOTDIR' });
      const names = e.dir;
      return {
        async *[Symbol.asyncIterator]() {
          for (const name of names) yield { name };
        },
      };
    },
  };
}

test('同一 dev+ino 的目录从两条路径到达时只算一次（模拟 firmlink）', async () => {
  // /r/Users 和 /r/System/Data/Users 是同一个目录（ino 10），里面的文件 nlink 为 1，硬链接去重管不到。
  const fs = aliasFs({
    '/r': { dir: ['Users', 'System'], ino: 1 },
    '/r/Users': { dir: ['big.bin'], ino: 10 },
    '/r/Users/big.bin': { size: 1000, ino: 11 },
    '/r/System': { dir: ['Data'], ino: 2 },
    '/r/System/Data': { dir: ['Users', 'own.bin'], ino: 3 },
    '/r/System/Data/Users': { dir: ['big.bin'], ino: 10 },
    '/r/System/Data/Users/big.bin': { size: 1000, ino: 11 },
    '/r/System/Data/own.bin': { size: 5, ino: 12 },
  });
  const { node, stats, error } = await walk('/r', noopHooks(), undefined, { fs });
  assert.equal(error, null);
  assert.equal(node.size, 1005, '1000 字节只算一次，加上另一个独立文件');
  assert.equal(stats.dupDirs, 1, '第二条路径上的目录被跳过');
  assert.equal(stats.files, 2);
  // 根目录本身也登记：从子路径再次到达根目录时同样跳过。
  const loop = aliasFs({
    '/r': { dir: ['self', 'f'], ino: 1 },
    '/r/self': { dir: ['f'], ino: 1 },
    '/r/f': { size: 9, ino: 5 },
  });
  const r2 = await walk('/r', noopHooks(), undefined, { fs: loop });
  assert.equal(r2.node.size, 9);
  assert.equal(r2.stats.dupDirs, 1);
});

test('系统卷和数据卷报告同一个 dev 时，相同 inode 号的两个目录不会被当成同一个', async () => {
  const fs = aliasFs({
    '/r': { dir: ['System', 'Users'], ino: 1 },
    '/r/System': { dir: ['Lib'], ino: 2 },
    '/r/System/Lib': { dir: ['a'], ino: 50 },
    '/r/System/Lib/a': { size: 30, ino: 51 },
    '/r/Users': { dir: ['x'], ino: 3 },
    '/r/Users/x': { dir: ['b'], ino: 50 },
    '/r/Users/x/b': { size: 70, ino: 52 },
  });
  const hooks = {
    ...noopHooks(),
    special: (/** @type {string} */ key) => (key === '/r/system' ? { cf: CF.SYSVOL, skip: false, dataVol: false } : null),
    deriveChildren(/** @type {TNode} */ node, /** @type {string} */ _p, /** @type {any} */ _m, /** @type {{ node: TNode }[]} */ subdirs) {
      for (const s of subdirs) s.node.cf = node.cf | (s.node.sp ? s.node.sp.cf : 0);
    },
  };
  const { node, stats } = await walk('/r', hooks, undefined, { fs });
  assert.equal(stats.dupDirs || 0, 0);
  assert.equal(node.size, 100);
  assert.equal(stats.bytesByDev.get(7), 70, '数据卷部分');
  assert.equal(stats.bytesByDev.get(-8), 30, '系统卷部分记在单独的键下');
});

test('inode 号超过 2^53 时按 bigint 比较：转成数字后相同的两个目录和硬链接文件都照算', async () => {
  // macOS 系统卷上 /bin 和 /sbin 的 inode 是 1152921500312607304 和 ...385，转成 JS 数字后相等。
  const bin = 1152921500312607304n;
  const sbin = 1152921500312607385n;
  assert.equal(Number(bin), Number(sbin), '前提：数字精度不够');
  const fs = aliasFs({
    '/r': { dir: ['bin', 'sbin'], ino: 1 },
    '/r/bin': { dir: ['a'], ino: Number(bin), bigIno: bin },
    '/r/bin/a': { size: 40, ino: Number(bin + 1n), bigIno: bin + 1n, nlink: 2 },
    '/r/sbin': { dir: ['b'], ino: Number(sbin), bigIno: sbin },
    '/r/sbin/b': { size: 60, ino: Number(sbin + 1n), bigIno: sbin + 1n, nlink: 2 },
  });
  const { node, stats } = await walk('/r', noopHooks(), undefined, { fs });
  assert.equal(stats.dupDirs || 0, 0, '两个不同目录都进入');
  assert.equal(node.size, 100, 'inode 不同的两个硬链接文件都计入');
});

test('APFS 克隆按 dev+大小+mtime+birthtime 只算一次；cp -p 和普通副本照算', async (t) => {
  const dir = await makeTmp('clones');
  t.after(() => removeTmp(dir));
  const size = 300 * 1024;
  const data = Buffer.alloc(size, 7);
  const src = path.join(dir, 'a', 'x.bin');
  await writeFile(src, data);
  // 克隆特征是 ctime 比复制来的 mtime/birthtime 晚 2 秒以上，先等一会儿再克隆。
  await new Promise((r) => setTimeout(r, 2200));
  const cp = (/** @type {string[]} */ args) => new Promise((resolve) => execFile('/bin/cp', args, (err) => resolve(!err)));
  for (const d of ['b', 'e', 'c']) await fsp.mkdir(path.join(dir, d));
  // Node 的 COPYFILE_FICLONE_FORCE 在 macOS 上返回 ENOSYS，用 cp -c（clonefile）给夹具文件做克隆。
  if (!(await cp(['-c', src, path.join(dir, 'b', 'x.bin')]))) {
    t.skip('当前文件系统不支持克隆');
    return;
  }
  await cp(['-c', src, path.join(dir, 'e', 'x.bin')]);
  await cp(['-p', src, path.join(dir, 'c', 'x.bin')]); // 保留时间的普通副本，不共享数据块
  await writeFile(path.join(dir, 'd', 'x.bin'), data); // 普通副本：birthtime 是现在
  const sa = await fsp.lstat(src);
  const sb = await fsp.lstat(path.join(dir, 'b', 'x.bin'));
  const sc = await fsp.lstat(path.join(dir, 'c', 'x.bin'));
  assert.notEqual(sa.ino, sb.ino, '克隆是不同的 inode');
  assert.equal(sb.nlink, 1, '克隆不是硬链接');
  assert.equal(sb.mtimeMs, sa.mtimeMs, '克隆复制了 mtime');
  assert.equal(sb.birthtimeMs, sa.birthtimeMs, '克隆复制了 birthtime');
  assert.ok(sb.ctimeMs - sb.mtimeMs > 2000, '克隆的 ctime 是克隆发生的时间');
  assert.equal(sc.birthtimeMs, sc.mtimeMs, 'cp -p 的副本 birthtime 被改成和 mtime 相同，因此不会被当成克隆');

  const plain = await walk(dir, noopHooks(), undefined, { clones: false });
  const anyDir = await walk(dir, noopHooks(), undefined, { clones: true });
  const fromStore = await walk(dir, noopHooks(), undefined, { clones: true, cf: CF.CLONE_SOURCE });
  assert.equal(anyDir.stats.cloneFiles, 1, '两个克隆只算一份（源文件不像克隆，不登记）');
  assert.equal(plain.node.size - anyDir.node.size, size);
  assert.equal(anyDir.node.rel, plain.node.rel - size, '去重掉的克隆不计入可释放大小');
  assert.equal(fromStore.stats.cloneFiles, 2, '在克隆来源目录（pnpm 存储）里源文件也登记，两个克隆都去重');
  assert.equal(plain.node.size - fromStore.node.size, 2 * size, 'cp -p 副本和普通副本都照算');
});
