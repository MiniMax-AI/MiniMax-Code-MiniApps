// @ts-check
// 扫描结果：目录树、规则条目、大文件、重复文件、无权限目录、文件类型统计。
import { F, TNode, createTreeBuilder, treeRows } from './tree.mjs';

export const SCAN_VERSION = 4;

/**
 * @typedef {{
 *   id: string, path: string, key: string, name: string, kind: 'dir' | 'file', diskId: string | null,
 *   sizeBytes: number, releasableBytes: number, mtimeMs: number, dev: number, ino: number,
 *   category: string | null, tags: string[], note: string | null, defaultSelected: boolean,
 *   exempt: boolean, typeKind: string | null, app: string | null, large: boolean,
 *   duBytes?: number, computing?: boolean,
 * }} Item
 */

export class ScanModel {
  /** @param {import('./util.mjs').PathOps} pathOps */
  constructor(pathOps) {
    this.pathOps = pathOps;
    this.scan = {
      status: 'idle',
      phase: /** @type {string | null} */ (null),
      diskIds: /** @type {string[]} */ ([]),
      paths: /** @type {string[]} */ ([]),
      startedAt: /** @type {number | null} */ (null),
      finishedAt: /** @type {number | null} */ (null),
      error: /** @type {string | null} */ (null),
    };
    /** @type {Map<string, TNode>} 扫描根的目录树，键是 rootId */
    this.roots = new Map();
    /** @type {Map<string, { id: string, kind: 'disk' | 'folder', label: string, path: string, diskId: string }>} 扫描根的说明 */
    this.rootInfo = new Map();
    /** @type {Map<string, TNode>} 快速扫描的根（深度扫描时嫁接进目录树） */
    this.quickRoots = new Map();
    /** @type {Map<string, Item>} */
    this.items = new Map();
    /** @type {Map<string, Item>} */
    this.itemByKey = new Map();
    /** @type {{ status: string, groups: { id: string, sizeBytes: number, files: Item[] }[] }} */
    this.dup = { status: 'pending', groups: [] };
    /** @type {{ count: number, dirs: { path: string, reason: string }[] }} */
    this.denied = { count: 0, dirs: [] };
    /** @type {Map<string, Map<string, { bytes: number, count: number }>>} 文件类型统计，键是 rootId */
    this.types = new Map();
    /** @type {Map<number, number>} */
    this.bytesByDev = new Map();
    /** @type {Map<string, number[]>} 计算「未扫描」时使用的设备号 */
    this.diskDevs = new Map();
    /** @type {Map<string, TNode>} */
    this.nodeIds = new Map();
    this.seq = { item: 0, node: 0, dup: 0 };
    /** @type {Item[]} 还没有做默认勾选的新条目 */
    this.newItems = [];
    /** @type {any} 规则上下文（不持久化） */
    this.ctx = null;
    this.version = 0;
    /** @type {{ status: 'pending' | 'ready', seq: number, list: any[] }} 代码仓库（深度扫描结束时生成） */
    this.repos = { status: 'pending', seq: 0, list: [] };
    /** @type {{ node: TNode, path: string, gitFile: boolean, gitDu: number, gitNode: TNode | null }[]} 遍历中发现的仓库候选（不持久化） */
    this.repoCandidates = [];
    /** @type {Map<string, TNode>} 遍历中发现的、本身就是 git 目录的目录（有 HEAD 和 objects），键是路径 key（不持久化） */
    this.gitDirCandidates = new Map();
    /** @type {Map<string, TNode>} 快速扫描中还在统计的规则条目对应的节点（键是条目 key，不持久化） */
    this.computingNodes = new Map();
    /** @type {Map<string, string>} 快速扫描中还在统计的规则区域（子项规则、安装包目录等），值是分类 */
    this.computingAreas = new Map();
    /** 每完成一个统计位置加一，用来节流推送 results */
    this.computingVersion = 0;
  }

  touch() {
    this.version += 1;
  }

  /** @param {TNode} node */
  idOf(node) {
    if (!node.id) {
      this.seq.node += 1;
      node.id = `n_${this.seq.node.toString(36)}`;
      this.nodeIds.set(node.id, node);
    }
    return node.id;
  }

  /** @param {TNode} node */
  forget(node) {
    if (node.id) this.nodeIds.delete(node.id);
  }

  /** @param {TNode} node */
  forgetDeep(node) {
    const stack = [node];
    while (stack.length) {
      const n = /** @type {TNode} */ (stack.pop());
      this.forget(n);
      if (n.children) for (const c of n.children) stack.push(c);
    }
  }

  /** @param {TNode} node */
  nodePath(node) {
    /** @type {string[]} */
    const names = [];
    let cur = node;
    while (cur.parent) {
      names.push(cur.name);
      cur = cur.parent;
    }
    let p = cur.rp || cur.name;
    for (let i = names.length - 1; i >= 0; i -= 1) p = this.pathOps.join(p, names[i]);
    return p;
  }

  /** 没有父节点的根：磁盘根和还没嫁接的快速扫描根。 */
  allRoots() {
    const out = [...this.roots.values()];
    for (const r of this.quickRoots.values()) if (!r.parent) out.push(r);
    return out;
  }

  /**
   * 按路径找目录树节点。找不到时返回最深的已知祖先。
   * @param {string} path
   * @returns {{ node: TNode | null, ancestor: TNode | null }}
   */
  findNode(path) {
    const po = this.pathOps;
    const key = po.key(path);
    let best = null;
    let bestKey = '';
    for (const r of this.allRoots()) {
      if (!r.rp) continue;
      const rk = po.key(r.rp);
      if ((key === rk || po.inside(key, rk)) && rk.length > bestKey.length) {
        best = r;
        bestKey = rk;
      }
    }
    if (!best) return { node: null, ancestor: null };
    if (key === bestKey) return { node: best, ancestor: best.parent };
    const rest = po.norm(path).slice(po.norm(/** @type {string} */ (best.rp)).length).split(po.sep).filter(Boolean);
    let cur = best;
    for (const seg of rest) {
      const ch = cur.children;
      let next = ch ? ch.find((c) => c.name === seg) : undefined;
      if (!next && ch) {
        const low = seg.toLowerCase();
        next = ch.find((c) => c.name.toLowerCase() === low);
      }
      if (!next) return { node: null, ancestor: cur };
      cur = next;
    }
    return { node: cur, ancestor: cur.parent };
  }

  /**
   * 新增规则条目。同一路径已有条目时返回已有的。
   * @param {Omit<Item, 'id' | 'key'> & { key?: string }} f
   */
  addItem(f) {
    const key = f.key || this.pathOps.key(f.path);
    const existing = this.itemByKey.get(key);
    if (existing && existing.computing) {
      // 快速扫描开始时先占位的条目：统计完成，用真实数据覆盖并去掉 computing 标记。
      const { id } = existing;
      Object.assign(existing, f, { key, id });
      delete existing.computing;
      this.computingNodes.delete(key);
      this.computingVersion += 1;
      this.newItems.push(existing);
      return existing;
    }
    if (existing) {
      if (!existing.category && f.category) {
        existing.category = f.category;
        existing.note = f.note;
        existing.defaultSelected = f.defaultSelected;
        existing.tags = f.tags;
        this.newItems.push(existing);
      }
      if (f.large) existing.large = true;
      if (f.typeKind && !existing.typeKind) existing.typeKind = f.typeKind;
      return existing;
    }
    this.seq.item += 1;
    /** @type {Item} */
    const item = { ...f, key, id: `i_${this.seq.item.toString(36)}` };
    this.items.set(item.id, item);
    this.itemByKey.set(key, item);
    this.newItems.push(item);
    return item;
  }

  /** @param {Item} item */
  removeItem(item) {
    this.items.delete(item.id);
    if (this.itemByKey.get(item.key) === item) this.itemByKey.delete(item.key);
  }

  /**
   * 快速扫描开始：给存在的规则位置先建占位条目（computing），记录还在统计的区域。
   * @param {{ path: string, cat: string, name: string, mode: string, app?: string | null, chat?: boolean, tier: string, node: TNode | null, diskId: string | null }[]} targets
   */
  beginComputing(targets) {
    for (const t of targets) {
      const key = this.pathOps.key(t.path);
      if (t.mode !== 'dir') {
        this.computingAreas.set(key, t.cat);
        continue;
      }
      if (this.itemByKey.has(key)) continue;
      const item = this.addItem({
        path: t.path,
        name: t.name,
        kind: 'dir',
        diskId: t.diskId,
        sizeBytes: 0,
        releasableBytes: 0,
        duBytes: 0,
        mtimeMs: 0,
        dev: 0,
        ino: 0,
        category: t.cat,
        tags: t.chat ? ['chat'] : [],
        note: null,
        defaultSelected: t.tier === 'safe',
        exempt: false,
        typeKind: null,
        app: t.app || null,
        large: false,
      });
      item.computing = true;
      if (t.node) this.computingNodes.set(key, t.node);
    }
  }

  /** 遍历到占位条目对应的目录时登记节点，之后按节点的当前大小显示。 @param {string} key @param {TNode} node */
  attachComputing(key, node) {
    const it = this.itemByKey.get(key);
    if (it && it.computing) this.computingNodes.set(key, node);
  }

  /** 区域统计完成。 @param {string} key */
  finishArea(key) {
    if (this.computingAreas.delete(key)) this.computingVersion += 1;
  }

  /** 快速扫描结束（或被取消）：剩下的占位条目按已统计的部分定稿，从来没遍历到的去掉。 */
  endComputing() {
    for (const it of [...this.items.values()]) {
      if (!it.computing) continue;
      const node = this.computingNodes.get(it.key);
      if (node && node.flags & F.DONE) {
        it.sizeBytes = node.size;
        it.releasableBytes = node.rel;
        it.duBytes = node.du;
        it.mtimeMs = node.mtime;
        it.dev = node.dev;
        it.ino = node.ino;
        delete it.computing;
      } else this.removeItem(it);
    }
    this.computingNodes.clear();
    this.computingAreas.clear();
    this.computingVersion += 1;
  }

  /** @param {string} path @param {number} max */
  addDenied(path, max = 200) {
    this.denied.count += 1;
    if (this.denied.dirs.length < max) this.denied.dirs.push({ path, reason: 'permission' });
  }

  /** @param {string} diskId @param {string} kind @param {number} bytes */
  addType(diskId, kind, bytes) {
    let m = this.types.get(diskId);
    if (!m) {
      m = new Map();
      this.types.set(diskId, m);
    }
    const t = m.get(kind);
    if (t) {
      t.bytes += bytes;
      t.count += 1;
    } else m.set(kind, { bytes, count: 1 });
  }

  /** 删除重复文件分组里的条目，少于 2 个文件的分组一起去掉。 @param {(it: Item) => boolean} drop */
  pruneDupGroups(drop) {
    const groups = [];
    for (const g of this.dup.groups) {
      const files = g.files.filter((f) => !drop(f));
      if (files.length >= 2) groups.push({ ...g, files });
    }
    this.dup.groups = groups;
  }

  /**
   * 清理成功后：移除条目（含其中的条目），扣减祖先目录和祖先条目的大小（去重口径和 du 口径都扣）。
   * 返回实际扣减的 du 口径大小，供代码仓库视图更新。
   * @param {string} path @param {number} size @param {number} rel @param {number} dev @param {number} [du]
   */
  removePath(path, size, rel, dev, du = size) {
    const po = this.pathOps;
    const key = po.key(path);
    const { node, ancestor } = this.findNode(path);
    let s = size;
    let r = rel;
    let d = du;
    let start = ancestor;
    if (node) {
      s = node.size;
      r = node.rel;
      d = node.du;
      start = node.parent;
      if (node.parent && node.parent.children) {
        const i = node.parent.children.indexOf(node);
        if (i >= 0) node.parent.children.splice(i, 1);
      }
      node.flags |= F.REMOVED;
      this.forgetDeep(node);
    }
    for (let n = start; n; n = n.parent) {
      n.size = Math.max(0, n.size - s);
      n.rel = Math.max(0, n.rel - r);
      n.du = Math.max(0, n.du - d);
    }
    const removed = new Set();
    for (const it of [...this.items.values()]) {
      if (it.key === key || po.inside(it.key, key)) {
        this.removeItem(it);
        removed.add(it);
      } else if (po.inside(key, it.key)) {
        it.sizeBytes = Math.max(0, it.sizeBytes - s);
        it.releasableBytes = Math.max(0, it.releasableBytes - r);
        if (typeof it.duBytes === 'number') it.duBytes = Math.max(0, it.duBytes - d);
      }
    }
    if (removed.size) this.pruneDupGroups((f) => removed.has(f));
    if (dev) this.bytesByDev.set(dev, Math.max(0, (this.bytesByDev.get(dev) || 0) - s));
    this.denied.dirs = this.denied.dirs.filter((x) => {
      const k = po.key(x.path);
      return !(k === key || po.inside(k, key));
    });
    this.touch();
    return d;
  }

  /**
   * 按行产出持久化内容（NDJSON）。整棵树不会被拼成一个大字符串。
   * 行类型：header、root、nodes、items、dup、end。
   * @returns {Generator<string>}
   */
  *serializeLines() {
    yield JSON.stringify({
      type: 'header',
      version: SCAN_VERSION,
      scan: this.scan,
      denied: this.denied,
      types: [...this.types.entries()].map(([d, m]) => [d, [...m.entries()]]),
      bytesByDev: [...this.bytesByDev.entries()],
      diskDevs: [...this.diskDevs.entries()],
      rootInfo: [...this.rootInfo.values()],
      seq: this.seq,
    });
    const roots = [...this.roots.entries()].map(([rootId, root]) => ({ rootId, quick: false, root }));
    for (const r of [...this.quickRoots.values()]) if (!r.parent) roots.push({ rootId: '', quick: true, root: r });
    for (const { rootId, quick, root } of roots) {
      yield JSON.stringify({ type: 'root', rootId, quick, rootPath: root.rp, name: root.name });
      for (const rows of treeRows(root)) yield JSON.stringify({ type: 'nodes', rows });
    }
    const items = [...this.items.values()];
    for (let i = 0; i < items.length; i += 2000) yield JSON.stringify({ type: 'items', rows: items.slice(i, i + 2000) });
    const groups = this.dup.groups.map((g) => ({ id: g.id, sizeBytes: g.sizeBytes, fileIds: g.files.map((f) => f.id) }));
    for (let i = 0; i < groups.length || i === 0; i += 2000) yield JSON.stringify({ type: 'dup', status: this.dup.status, groups: groups.slice(i, i + 2000) });
    yield JSON.stringify({ type: 'repos', status: this.repos.status, seq: this.repos.seq, list: this.repos.list });
    yield JSON.stringify({ type: 'end' });
  }

  /**
   * 逐行读取。第一行必须是同版本的 header，否则返回 null；没有 end 行视为文件不完整。
   * @param {AsyncIterable<string>} lines @param {import('./util.mjs').PathOps} pathOps
   */
  static async deserializeLines(lines, pathOps) {
    const m = new ScanModel(pathOps);
    const onId = (/** @type {string} */ id, /** @type {TNode} */ n) => m.nodeIds.set(id, n);
    /** @type {{ builder: ReturnType<typeof createTreeBuilder>, rootId: string, quick: boolean, rootPath: string } | null} */
    let cur = null;
    let first = true;
    let ended = false;
    /** @type {any[]} */
    const dupGroups = [];
    const flush = () => {
      if (!cur || !cur.builder.root) return;
      const root = cur.builder.root;
      root.rp = cur.rootPath;
      if (cur.quick) m.quickRoots.set(pathOps.key(cur.rootPath), root);
      else m.roots.set(cur.rootId, root);
    };
    for await (const line of lines) {
      if (!line) continue;
      const rec = JSON.parse(line);
      if (first) {
        if (rec.type !== 'header' || rec.version !== SCAN_VERSION) return null;
        first = false;
        m.scan = { ...m.scan, ...rec.scan };
        if (m.scan.status === 'running') {
          m.scan.status = 'cancelled';
          m.scan.phase = null;
        }
        m.denied = rec.denied || m.denied;
        m.types = new Map((rec.types || []).map((/** @type {any} */ [d, entries]) => [d, new Map(entries)]));
        m.bytesByDev = new Map(rec.bytesByDev || []);
        m.diskDevs = new Map(rec.diskDevs || []);
        m.rootInfo = new Map((rec.rootInfo || []).map((/** @type {any} */ r) => [r.id, r]));
        m.seq = { ...m.seq, ...(rec.seq || {}) };
        continue;
      }
      switch (rec.type) {
        case 'root':
          flush();
          cur = { builder: createTreeBuilder(onId), rootId: rec.rootId, quick: !!rec.quick, rootPath: rec.rootPath };
          break;
        case 'nodes':
          if (cur) cur.builder.add(rec.rows);
          break;
        case 'items':
          for (const it of rec.rows) {
            delete it.computing;
            m.items.set(it.id, it);
            m.itemByKey.set(it.key, it);
          }
          break;
        case 'dup':
          m.dup.status = rec.status === 'running' ? 'done' : rec.status || 'pending';
          dupGroups.push(...rec.groups);
          break;
        case 'repos':
          m.repos = { status: rec.status === 'ready' ? 'ready' : 'pending', seq: Number(rec.seq) || 0, list: Array.isArray(rec.list) ? rec.list : [] };
          break;
        case 'end':
          ended = true;
          break;
        default:
          break;
      }
    }
    flush();
    if (first || !ended) return null;
    m.dup.groups = dupGroups
      .map((g) => ({ id: g.id, sizeBytes: g.sizeBytes, files: g.fileIds.map((/** @type {string} */ id) => m.items.get(id)).filter(Boolean) }))
      .filter((g) => g.files.length >= 2);
    return m;
  }
}
