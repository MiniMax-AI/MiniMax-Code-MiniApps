// @ts-check
// 目录树节点、裁剪后的补算、序列化。
import { PRUNE_BYTES } from './util.mjs';

/** 节点自身状态位。 */
export const F = {
  DIR: 1,
  FILE: 2,
  DONE: 4,
  DENIED: 8,
  HAS_GIT: 16,
  GIT_DIR: 32,
  PARTIAL: 64,
  REMOVED: 128,
  VENV: 256,
  ARTIFACT_ROOT: 512,
  DENIED_INSIDE: 1024,
};

/** 向下继承的上下文位。 */
export const CF = {
  PROTECTED: 1,
  DEVCACHE: 2,
  ARTIFACT: 4,
  NODUP: 8,
  INSTALLER: 16,
  NOLARGE: 32,
  CLAIMED: 64,
  /** macOS 只读系统卷上的目录（/System、/usr、/bin、/sbin 中不属于 firmlink 的部分）。 */
  SYSVOL: 128,
  /** APFS 克隆的来源（pnpm 存储）：这里的文件也登记进克隆去重表。 */
  CLONE_SOURCE: 256,
  /** 位于 node_modules、site-packages、.venv、venv 里面：不再识别构建产物和虚拟环境，它们属于所在目录本身。 */
  NO_PATTERN: 512,
  /** 位于 .git 目录里面：这里出现的 .git 不算仓库。 */
  IN_GIT: 1024,
};

const PERSIST_MASK = F.DIR | F.FILE | F.DENIED | F.HAS_GIT | F.GIT_DIR | F.PARTIAL | F.VENV | F.ARTIFACT_ROOT | F.DENIED_INSIDE;

export class TNode {
  /** @param {string} name @param {TNode | null} parent @param {number} flags */
  constructor(name, parent, flags) {
    this.name = name;
    /** @type {TNode | null} */
    this.parent = parent;
    /** @type {TNode[] | null} */
    this.children = null;
    this.size = 0;
    this.rel = 0;
    /** 按 du 口径的大小：APFS 克隆和硬链接的文件每份都计入（代码仓库视图用）。 */
    this.du = 0;
    this.mtime = 0;
    this.maxMtime = 0;
    this.dev = 0;
    this.ino = 0;
    this.flags = flags;
    this.cf = 0;
    /** @type {string | null} */
    this.id = null;
    /** @type {any} */
    this.sp = null;
    this.pending = 0;
    /** 没有父节点的节点（磁盘根、快速扫描的根）记录自己的完整路径。 @type {string | null} */
    this.rp = null;
  }
}

/** @param {TNode} node */
export function nodeKind(node) {
  if (node.flags & F.FILE) return 'file';
  if (node.flags & F.DENIED) return 'denied';
  return 'dir';
}

/**
 * 扫描被取消或中途出错时，把没有完成的目录补算进父节点。
 * 已完成的子节点在 finalize 时已经加到父节点里，这里只补未完成的。
 * @param {TNode} root
 * @param {(n: TNode) => void} [forget]
 */
export function forceFinalize(root, forget) {
  if (root.flags & F.DONE) return;
  /** @type {[TNode, number][]} */
  const stack = [[root, 0]];
  while (stack.length) {
    const top = stack[stack.length - 1];
    const node = top[0];
    const ch = node.children;
    if (ch && top[1] < ch.length) {
      const c = ch[top[1]];
      top[1] += 1;
      if (!(c.flags & F.DONE)) stack.push([c, 0]);
      continue;
    }
    stack.pop();
    node.flags |= F.DONE | F.PARTIAL;
    if (node.size < PRUNE_BYTES && node.children) {
      if (forget) for (const c of node.children) forget(c);
      node.children = null;
    }
    const p = node.parent;
    if (p && stack.length) {
      p.size += node.size;
      p.rel += node.rel;
      p.du += node.du;
      if (node.maxMtime > p.maxMtime) p.maxMtime = node.maxMtime;
      if (node.flags & F.HAS_GIT) p.flags |= F.HAS_GIT;
      if (node.flags & (F.DENIED | F.DENIED_INSIDE)) p.flags |= F.DENIED_INSIDE;
    }
  }
}

/** @param {TNode} root */
export function countNodes(root) {
  let n = 0;
  const stack = [root];
  while (stack.length) {
    const node = /** @type {TNode} */ (stack.pop());
    n += 1;
    if (node.children) for (const c of node.children) stack.push(c);
  }
  return n;
}

/**
 * 按行序列化：先序遍历，每行最多 chunk 个节点，行内每个节点是
 * [name, parentIndex, size, rel, mtime, maxMtime, flags, dev, ino, id, du]。父节点下标一定小于子节点。
 * 生成器逐行产出，调用方可以在行与行之间让出事件循环，不会生成整块大字符串。
 * @param {TNode} root @param {number} [chunk]
 * @returns {Generator<any[][]>}
 */
export function* treeRows(root, chunk = 5000) {
  /** @type {[TNode, number][]} */
  const stack = [[root, -1]];
  let idx = 0;
  /** @type {any[][]} */
  let rows = [];
  while (stack.length) {
    const [n, pi] = /** @type {[TNode, number]} */ (stack.pop());
    const my = idx;
    idx += 1;
    rows.push([n.name, pi, n.size, n.rel, n.mtime, n.maxMtime, n.flags & PERSIST_MASK, n.dev, n.ino, n.id || 0, n.du]);
    if (n.children) for (let i = n.children.length - 1; i >= 0; i -= 1) stack.push([n.children[i], my]);
    if (rows.length >= chunk) {
      yield rows;
      rows = [];
    }
  }
  if (rows.length) yield rows;
}

/** 逐行重建目录树。 @param {(id: string, node: TNode) => void} onId */
export function createTreeBuilder(onId) {
  /** @type {TNode[]} */
  const nodes = [];
  return {
    /** @param {any[][]} rows */
    add(rows) {
      for (const r of rows) {
        const parent = r[1] >= 0 ? nodes[r[1]] : null;
        const n = new TNode(r[0], parent || null, (r[6] | F.DONE) >>> 0);
        n.size = r[2];
        n.rel = r[3];
        n.du = typeof r[10] === 'number' ? r[10] : r[2];
        n.mtime = r[4];
        n.maxMtime = r[5];
        n.dev = r[7];
        n.ino = r[8];
        if (r[9]) {
          n.id = r[9];
          onId(/** @type {string} */ (n.id), n);
        }
        if (parent) (parent.children || (parent.children = [])).push(n);
        nodes.push(n);
      }
    },
    get root() {
      return nodes[0] || null;
    },
    get count() {
      return nodes.length;
    },
  };
}
