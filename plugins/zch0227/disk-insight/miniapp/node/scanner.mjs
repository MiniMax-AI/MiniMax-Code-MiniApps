// @ts-check
// 并发目录遍历：opendir + lstat，并发 32，不进入符号链接和目录联接。
// 同一目录（dev+ino）、硬链接、APFS 克隆都只算一次。
import { CF, F, TNode } from './tree.mjs';
import { newMeta, noteMeta } from './rules.mjs';
import { PRUNE_BYTES, RETAIN_FILE_BYTES, abortError, yieldNow } from './util.mjs';

/** 目录去重只登记离遍历根不超过这么多层的目录（最深的 firmlink 是 /System/Library/CoreServices/CoreTypes.bundle/Contents/Library，第 6 层）。 */
export const DIR_DEDUP_DEPTH = 6;

/**
 * @typedef {{
 *   special(key: string): any,
 *   deriveChildren(node: TNode, path: string, meta: any, subdirs: { node: TNode, path: string }[]): void,
 *   onFile(node: TNode, name: string, path: string, st: import('node:fs').Stats, size: number, rel: number, du: number): void,
 *   onDirDone(node: TNode, path: string, meta: any, parentMeta: any): void,
 *   onDenied(node: TNode, path: string): void,
 *   forget(node: TNode): void,
 * }} WalkHooks
 */

/**
 * @param {{
 *   fs: any,
 *   pathOps: import('./util.mjs').PathOps,
 *   sizeOf: (st: any) => number,
 *   signal: AbortSignal,
 *   hooks: WalkHooks,
 *   inodes: import('./clones.mjs').KeySet,
 *   dirs?: import('./clones.mjs').KeySet | null,
 *   clones?: import('./clones.mjs').KeySet | null,
 *   stats: { files: number, dirs: number, bytes: number, currentPath: string, bytesByDev: Map<number, number>, skipped?: number, dupDirs?: number, cloneFiles?: number, cloneBytes?: number },
 *   concurrency?: number | (() => number),
 *   allowedDevs?: Set<number> | null,
 *   graft?: Map<string, TNode> | null,
 *   yieldEvery?: number,
 * }} o
 */
export function createWalker(o) {
  const { fs, pathOps, sizeOf, signal, hooks, inodes, stats } = o;
  /** 并发数可以是函数：快速扫描的几个遍历共享并发额度，别的遍历结束后剩下的自动提速。 */
  const conc = o.concurrency;
  const concurrency = typeof conc === 'function' ? conc : () => conc || 32;
  const allowedDevs = o.allowedDevs || null;
  const graft = o.graft || null;
  const dirs = o.dirs || null;
  const clones = o.clones || null;
  const yieldEvery = o.yieldEvery || 1024;
  /** @type {Map<TNode, any>} */
  const metaMap = new Map();

  /** 系统卷上的字节记在负的设备号下，计算「未扫描」时只用数据卷的部分。 @param {TNode} node @param {number} dev */
  function volKey(node, dev) {
    return node.cf & CF.SYSVOL ? -dev - 1 : dev;
  }

  /** @param {number} dev @param {number} bytes */
  function addDev(dev, bytes) {
    if (!bytes) return;
    stats.bytesByDev.set(dev, (stats.bytesByDev.get(dev) || 0) + bytes);
  }

  /** 硬链接按 dev + ino 只算一次（带上卷标记）。返回 true 表示第一次见到。 @param {number} dev @param {number} ino */
  function firstSeen(dev, ino) {
    return inodes.add(dev, ino);
  }

  /**
   * 按 dev + ino 登记，返回 true 表示第一次见到。
   * macOS 系统卷的 inode 号约为 1.15e18，超过 2^53，转成 JS 数字会丢精度，不同目录（例如 /bin 和 /sbin）会变成同一个数。
   * 这种情况下用 bigint 重新读一次 inode，按高低 32 位登记。
   * @param {import('./clones.mjs').KeySet} set @param {number} devKey @param {string} p @param {any} st
   */
  async function addIno(set, devKey, p, st) {
    if (Number.isSafeInteger(st.ino)) return set.add(devKey, st.ino);
    let big;
    try {
      big = (await fs.lstat(p, { bigint: true })).ino;
    } catch {
      return true;
    }
    if (typeof big !== 'bigint') return true;
    return set.add(devKey, Number(big >> 32n), Number(big & 0xffffffffn), 1);
  }

  /**
   * APFS 克隆：不同 inode 共享数据块，du 和 blocks 都会各算一份。
   * 克隆（cp -c、ditto、pnpm 的 clone 导入）会原样复制源文件纳秒级的 mtime 和 birthtime，ctime 则是克隆发生的时间。
   * 识别条件：
   *   1. ctime 比 mtime/birthtime 晚 2 秒以上（克隆特征），或位于克隆来源目录（pnpm 存储）；
   *   2. mtime 和 birthtime 都带亚秒部分（排除 rsync -t、解包这类整秒时间）；
   *   3. birthtime 不等于 mtime（cp -p 这类事后设置时间的普通副本，APFS 会把 birthtime 改成和 mtime 相同，
   *      两份副本的时间完全一样；正常写出的文件 birthtime 总比 mtime 早一点）。
   * 返回 true 表示这是已经统计过的克隆，应计为 0。
   * @param {TNode} node @param {any} st
   */
  function isSeenClone(node, st) {
    if (!clones || st.size === 0) return false;
    const m = st.mtimeMs;
    const b = st.birthtimeMs;
    if (!(m % 1000) || !(b % 1000) || m === b) return false;
    const cloneLike = st.ctimeMs - (m > b ? m : b) > 2000;
    if (!cloneLike && !(node.cf & CF.CLONE_SOURCE)) return false;
    return !clones.add(volKey(node, st.dev), st.size, m, b);
  }

  /** @param {TNode} node @param {string} path */
  function finalize(node, path) {
    let n = node;
    let p = path;
    for (;;) {
      n.flags |= F.DONE;
      const meta = metaMap.get(n);
      if (meta && meta.hasGit) n.flags |= F.HAS_GIT;
      hooks.onDirDone(n, p, meta || null, n.parent ? metaMap.get(n.parent) || null : null);
      metaMap.delete(n);
      if (n.size < PRUNE_BYTES && n.children) {
        for (const c of n.children) hooks.forget(c);
        n.children = null;
      }
      const parent = n.parent;
      if (!parent || parent.flags & F.DONE) return;
      parent.size += n.size;
      parent.rel += n.rel;
      parent.du += n.du;
      if (n.maxMtime > parent.maxMtime) parent.maxMtime = n.maxMtime;
      if (n.flags & F.HAS_GIT) parent.flags |= F.HAS_GIT;
      if (n.flags & (F.DENIED | F.DENIED_INSIDE)) parent.flags |= F.DENIED_INSIDE;
      parent.pending -= 1;
      if (parent.pending > 0) return;
      n = parent;
      p = pathOps.dirname(p);
    }
  }

  /** @param {TNode} node @param {TNode} g */
  function attachGraft(node, g) {
    g.parent = node;
    (node.children || (node.children = [])).push(g);
    node.size += g.size;
    node.rel += g.rel;
    node.du += g.du;
    if (g.maxMtime > node.maxMtime) node.maxMtime = g.maxMtime;
    if (g.flags & F.HAS_GIT) node.flags |= F.HAS_GIT;
    if (g.flags & (F.DENIED | F.DENIED_INSIDE)) node.flags |= F.DENIED_INSIDE;
  }

  /** @param {{ node: TNode, path: string, depth?: number }} item @param {{ node: TNode, path: string, depth?: number }[]} stack */
  async function processDir(item, stack) {
    const { node, path } = item;
    const childDepth = (item.depth || 0) + 1;
    stats.dirs += 1;
    stats.currentPath = path;
    let dir;
    try {
      dir = await fs.opendir(path, { bufferSize: 256 });
    } catch (e) {
      const code = /** @type {any} */ (e).code;
      if (code === 'EACCES' || code === 'EPERM') {
        node.flags |= F.DENIED;
        hooks.onDenied(node, path);
      }
      finalize(node, path);
      return;
    }
    const meta = newMeta();
    /** @type {{ node: TNode, path: string, depth: number }[]} */
    const subdirs = [];
    let n = 0;
    try {
      for await (const de of dir) {
        if (signal.aborted) break;
        const name = de.name;
        const childPath = pathOps.join(path, name);
        let st;
        try {
          st = await fs.lstat(childPath);
        } catch {
          continue;
        }
        noteMeta(meta, name, st);
        if (st.isDirectory()) {
          if (allowedDevs && !allowedDevs.has(st.dev)) continue;
          const key = childPath.toLowerCase();
          const sp = hooks.special(key);
          if (sp && sp.skip) {
            stats.skipped = (stats.skipped || 0) + 1;
            continue;
          }
          const g = graft && graft.get(key);
          if (g && !g.parent) {
            attachGraft(node, g);
            continue;
          }
          // 同一个目录（dev + ino）从第二条路径到达时不再统计。
          // macOS 的 firmlink 别名都在离根 6 层以内，只登记这一范围，省掉整盘 800 万个目录的去重表。
          // 系统卷和数据卷报告同一个 dev，inode 编号会撞，键里带上卷标记。
          const childSys = node.cf & CF.SYSVOL ? !(sp && sp.dataVol) : !!(sp && sp.cf & CF.SYSVOL);
          if (dirs && childDepth <= DIR_DEDUP_DEPTH && !(await addIno(dirs, childSys ? -st.dev - 1 : st.dev, childPath, st))) {
            stats.dupDirs = (stats.dupDirs || 0) + 1;
            continue;
          }
          const child = new TNode(name, node, F.DIR);
          child.mtime = st.mtimeMs;
          child.maxMtime = st.mtimeMs;
          child.dev = st.dev;
          child.ino = st.ino;
          child.sp = sp;
          const own = sizeOf(st);
          child.size = own;
          child.du = own;
          addDev(volKey(node, st.dev), own);
          stats.bytes += own;
          if (name === '.git') child.flags |= F.GIT_DIR;
          (node.children || (node.children = [])).push(child);
          node.pending += 1;
          subdirs.push({ node: child, path: childPath, depth: childDepth });
        } else {
          const raw = sizeOf(st);
          let size = raw;
          let rel = size;
          if (st.nlink > 1 && st.isFile()) {
            rel = 0;
            if (!(await addIno(inodes, volKey(node, st.dev), childPath, st))) size = 0;
          } else if (st.isFile() && isSeenClone(node, st)) {
            stats.cloneFiles = (stats.cloneFiles || 0) + 1;
            stats.cloneBytes = (stats.cloneBytes || 0) + size;
            size = 0;
            rel = 0;
          }
          node.size += size;
          node.rel += rel;
          node.du += raw;
          if (st.mtimeMs > node.maxMtime) node.maxMtime = st.mtimeMs;
          stats.files += 1;
          stats.bytes += size;
          addDev(volKey(node, st.dev), size);
          if (st.isFile()) {
            hooks.onFile(node, name, childPath, st, size, rel, raw);
            if (size >= RETAIN_FILE_BYTES) {
              const f = new TNode(name, node, F.FILE | F.DONE);
              f.size = size;
              f.rel = rel;
              f.du = raw;
              f.mtime = st.mtimeMs;
              f.maxMtime = st.mtimeMs;
              f.dev = st.dev;
              f.ino = st.ino;
              (node.children || (node.children = [])).push(f);
            }
          }
        }
        n += 1;
        if (n % yieldEvery === 0) await yieldNow();
      }
    } catch {
      // 读到一半出错（例如目录被删除）：保留已经读到的部分。
    }
    if (signal.aborted) return;
    metaMap.set(node, meta);
    hooks.deriveChildren(node, path, meta, subdirs);
    for (let i = subdirs.length - 1; i >= 0; i -= 1) stack.push(subdirs[i]);
    if (node.pending === 0) finalize(node, path);
  }

  /**
   * 遍历若干根目录。根节点由调用方创建（已填好 dev/ino/mtime 和自身大小）。
   * 取消时等正在进行的目录处理结束后再 reject。
   * @param {{ node: TNode, path: string }[]} roots
   */
  function walkRoots(roots) {
    /** @type {{ node: TNode, path: string }[]} */
    const stack = [];
    for (let i = roots.length - 1; i >= 0; i -= 1) {
      const r = roots[i];
      // 根目录本身也登记，之后从别的路径再到达它时不重复统计（inode 号超出安全整数范围时不登记）。
      if (dirs && Number.isSafeInteger(r.node.ino) && r.node.ino && !dirs.add(r.node.cf & CF.SYSVOL ? -r.node.dev - 1 : r.node.dev, r.node.ino)) {
        stats.dupDirs = (stats.dupDirs || 0) + 1;
        r.node.flags |= F.DONE;
        continue;
      }
      stack.push(r);
    }
    let active = 0;
    let settled = false;
    return new Promise((resolve, reject) => {
      const pump = () => {
        if (settled) return;
        if (signal.aborted) {
          stack.length = 0;
          if (active === 0) {
            settled = true;
            reject(abortError());
          }
          return;
        }
        while (active < concurrency() && stack.length) {
          const item = /** @type {{ node: TNode, path: string }} */ (stack.pop());
          active += 1;
          processDir(item, stack).then(done, done);
        }
        if (active === 0 && stack.length === 0) {
          settled = true;
          resolve(undefined);
        }
      };
      const done = () => {
        active -= 1;
        pump();
      };
      pump();
    });
  }

  /** 让 rescan 的根节点能拿到父目录的同级信息。 @param {TNode} node @param {any} meta */
  function setMeta(node, meta) {
    metaMap.set(node, meta);
  }

  return { walkRoots, setMeta, firstSeen };
}
