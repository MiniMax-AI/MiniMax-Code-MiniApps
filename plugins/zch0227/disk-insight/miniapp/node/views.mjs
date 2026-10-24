// @ts-check
// 视图：把扫描结果转换成接口契约里的 JSON。
import { diskOf } from './protect.mjs';
import { LARGE_KINDS, TYPE_LABELS, categoriesFor, categoryAction } from './rules.mjs';
import { F, nodeKind } from './tree.mjs';
import { DAY_MS, HttpError } from './util.mjs';

const MAX_CATEGORY_ITEMS = 300;
const MAX_LARGE = 500;
const MAX_GROUPS = 300;
const MAX_TREE_CHILDREN = 60;

/**
 * @param {{
 *   platform: string,
 *   pathOps: import('./util.mjs').PathOps,
 *   fs: any,
 *   sizeOf: (st: any) => number,
 *   getModel: () => import('./model.mjs').ScanModel | null,
 *   getDisks: () => any[],
 *   getProtection: () => ReturnType<typeof import('./protect.mjs').createProtection> | null,
 *   isSelected: (key: string) => boolean,
 *   isIgnored: (key: string) => boolean,
 * }} o
 */
export function createViews(o) {
  const { platform, pathOps, fs } = o;
  const categories = categoriesFor(platform);
  const catById = new Map(categories.map((c) => [c.id, c]));

  /** 快速扫描中还在统计的条目：大小取对应目录节点当前已统计的部分。 @param {import('./model.mjs').Item} item */
  function liveNode(item) {
    if (!item.computing) return null;
    const m = o.getModel();
    return (m && m.computingNodes.get(item.key)) || null;
  }

  /** @param {import('./model.mjs').Item} item */
  function entityFromItem(item) {
    const live = liveNode(item);
    return {
      id: item.id,
      path: item.path,
      key: item.key,
      name: item.name,
      kind: item.kind,
      diskId: item.diskId,
      sizeBytes: live ? live.size : item.sizeBytes,
      releasableBytes: live ? live.rel : item.releasableBytes,
      duBytes: live ? live.du : typeof item.duBytes === 'number' ? item.duBytes : item.sizeBytes,
      mtimeMs: item.mtimeMs,
      dev: item.dev,
      ino: item.ino,
      category: item.category,
      tags: item.tags || [],
      note: item.note,
      exempt: !!item.exempt,
      item,
      node: /** @type {import('./tree.mjs').TNode | null} */ (null),
    };
  }

  /** @param {import('./tree.mjs').TNode} node */
  function entityFromNode(node) {
    const model = /** @type {import('./model.mjs').ScanModel} */ (o.getModel());
    const path = model.nodePath(node);
    const key = pathOps.key(path);
    const item = model.itemByKey.get(key) || null;
    /** @type {string[]} */
    const tags = [];
    if (node.flags & F.HAS_GIT && !(node.flags & F.GIT_DIR)) tags.push('git');
    if (item) for (const t of item.tags || []) if (t !== 'git' && !tags.includes(t)) tags.push(t);
    const disk = diskOf(path, o.getDisks(), pathOps);
    return {
      id: model.idOf(node),
      path,
      key,
      name: node.name,
      kind: nodeKind(node),
      diskId: disk ? disk.id : null,
      sizeBytes: node.size,
      releasableBytes: node.rel,
      duBytes: node.du,
      mtimeMs: node.mtime,
      dev: node.dev,
      ino: node.ino,
      category: item ? item.category : null,
      tags,
      note: item ? item.note : null,
      exempt: item ? !!item.exempt : false,
      item,
      node: /** @type {import('./tree.mjs').TNode | null} */ (node),
    };
  }

  /** @typedef {ReturnType<typeof entityFromItem>} Entity */

  /** @param {any} id @returns {Entity | null} */
  function resolve(id) {
    const model = o.getModel();
    if (!model || typeof id !== 'string' || !id) return null;
    if (id.startsWith('i_')) {
      const it = model.items.get(id);
      return it ? entityFromItem(it) : null;
    }
    if (id.startsWith('n_')) {
      const n = model.nodeIds.get(id);
      if (!n || n.flags & F.REMOVED) return null;
      return entityFromNode(n);
    }
    return null;
  }

  /** 按路径找实体：先找规则条目，再找目录树节点。 @param {string} path */
  function resolvePath(path) {
    const model = o.getModel();
    if (!model) return null;
    const it = model.itemByKey.get(pathOps.key(path));
    if (it) return entityFromItem(it);
    const { node } = model.findNode(path);
    return node ? entityFromNode(node) : null;
  }

  /** @param {{ path: string, exempt: boolean, category: string | null, kind: string }} e */
  function lockFor(e) {
    const prot = o.getProtection();
    let reason = prot ? prot.lockReason(e.path, { disks: o.getDisks(), exempt: e.exempt }) : '正在加载保护名单';
    if (!reason && e.category && catById.get(e.category)?.tier === 'info') reason = '只提示，请用系统或对应软件处理';
    if (!reason && e.kind === 'denied') reason = '无权限读取，无法确认里面的内容';
    return reason;
  }

  /** @param {Entity} e */
  function itemJSON(e) {
    const lockReason = lockFor(e);
    return {
      id: e.id,
      path: e.path,
      name: e.name,
      // 条目本身是文件还是目录（大文件接口的 kind 仍表示文件类型）。
      entryKind: e.kind === 'file' ? 'file' : 'dir',
      sizeBytes: e.sizeBytes,
      releasableBytes: e.releasableBytes,
      mtimeMs: e.mtimeMs,
      note: e.note || null,
      tags: e.tags,
      locked: !!lockReason,
      lockReason: lockReason || null,
      selected: o.isSelected(e.key),
      ...(e.item && e.item.computing ? { computing: true } : {}),
    };
  }

  /** @param {import('./model.mjs').Item} it */
  const visible = (it) => !o.isIgnored(it.key);

  /** 排序参数：size（默认，从大到小）、mtime（从旧到新）、name。 @param {string | null} sort */
  function comparator(sort) {
    switch (sort || 'size') {
      case 'size':
        return (/** @type {any} */ a, /** @type {any} */ b) => b.sizeBytes - a.sizeBytes;
      case 'mtime':
        return (/** @type {any} */ a, /** @type {any} */ b) => a.mtimeMs - b.mtimeMs;
      case 'name':
        return (/** @type {any} */ a, /** @type {any} */ b) => a.name.localeCompare(b.name);
      default:
        throw new HttpError(400, 'bad_request', '排序参数只能是 size、mtime、name');
    }
  }

  /** 名称或路径里包含 q（不区分大小写）。 @param {string | null} q */
  function matcher(q) {
    const s = q ? q.trim().toLowerCase() : '';
    if (!s) return null;
    return (/** @type {{ name: string, path: string }} */ it) => it.name.toLowerCase().includes(s) || it.path.toLowerCase().includes(s);
  }

  /** 去掉被忽略的文件后仍有至少两份的重复文件分组。 */
  function visibleDupGroups() {
    const model = o.getModel();
    if (!model) return [];
    const out = [];
    for (const g of model.dup.groups) {
      const files = g.files.filter(visible);
      if (files.length >= 2) out.push({ ...g, files });
    }
    return out;
  }

  /**
   * @param {URLSearchParams} [params]  支持 q（搜索）和 sort（排序），搜索在全部条目里进行
   */
  function junkJSON(params = new URLSearchParams()) {
    const cmp = comparator(params.get('sort'));
    const match = matcher(params.get('q'));
    const model = o.getModel();
    if (!model || !model.scan.startedAt) return { scannedAt: null, tiers: [] };
    /** @type {Map<string, any[]>} */
    const byCat = new Map();
    /** 还有条目或区域在统计的分类（快速扫描中）。 */
    const computingCats = new Set(model.computingAreas.values());
    for (const it of model.items.values()) {
      if (!it.category || it.category === 'duplicates' || !visible(it)) continue;
      const e = entityFromItem(it);
      if (it.computing) computingCats.add(it.category);
      const arr = byCat.get(it.category);
      if (arr) arr.push(e);
      else byCat.set(it.category, [e]);
    }
    /** @type {Record<string, any[]>} */
    const tiers = { safe: [], confirm: [], info: [] };
    for (const c of categories) {
      if (c.id === 'duplicates') {
        const groups = visibleDupGroups();
        let wasted = 0;
        let copies = 0;
        let allCopies = 0;
        for (const g of groups) {
          allCopies += g.files.length - 1;
          if (match && !g.files.some(match)) continue;
          wasted += g.sizeBytes * (g.files.length - 1);
          copies += g.files.length - 1;
        }
        if (match && !copies) continue;
        const dupCat = { id: c.id, name: c.name, effect: c.effect, totalBytes: wasted, releasableBytes: wasted, itemCount: copies, selectable: false, action: null, items: [] };
        tiers.confirm.push(match ? { ...dupCat, matchedFrom: allCopies } : dupCat);
        continue;
      }
      const all = byCat.get(c.id) || [];
      const list = (match ? all.filter(match) : all.slice()).sort(cmp);
      if (match && !list.length) continue;
      let total = 0;
      let rel = 0;
      for (const it of list) {
        total += it.sizeBytes;
        rel += it.releasableBytes;
      }
      tiers[c.tier].push({
        id: c.id,
        name: c.name,
        effect: c.effect,
        totalBytes: total,
        releasableBytes: rel,
        itemCount: list.length,
        ...(match ? { matchedFrom: all.length } : {}),
        selectable: c.tier !== 'info',
        action: categoryAction(platform, c.id),
        ...(computingCats.has(c.id) ? { computing: true } : {}),
        items: list.slice(0, MAX_CATEGORY_ITEMS).map((e) => itemJSON(e)),
      });
    }
    return {
      scannedAt: model.scan.finishedAt || model.scan.startedAt,
      tiers: ['safe', 'confirm', 'info'].map((t) => ({ tier: t, categories: tiers[t] })),
    };
  }

  /** @param {URLSearchParams} q @param {number} now */
  function largeJSON(q, now) {
    const model = o.getModel();
    const kind = q.get('kind');
    const ageRaw = q.get('minAgeDays');
    if (kind && !LARGE_KINDS.includes(kind)) throw new HttpError(400, 'bad_request', '文件类型参数不正确');
    let minAge = 0;
    if (ageRaw !== null && ageRaw !== '') {
      minAge = Number(ageRaw);
      if (!Number.isFinite(minAge) || minAge < 0) throw new HttpError(400, 'bad_request', '天数参数不正确');
    }
    const cmp = comparator(q.get('sort'));
    const match = matcher(q.get('q'));
    if (!model) return { items: [], total: 0 };
    const cutoff = now - minAge * DAY_MS;
    const list = [];
    for (const it of model.items.values()) {
      if (!it.large || !visible(it)) continue;
      const k = it.typeKind || 'other';
      if (kind && k !== kind) continue;
      if (minAge && it.mtimeMs > cutoff) continue;
      if (match && !match(it)) continue;
      list.push(it);
    }
    list.sort(cmp);
    return { items: list.slice(0, MAX_LARGE).map((it) => ({ ...itemJSON(entityFromItem(it)), kind: it.typeKind || 'other' })), total: list.length };
  }

  function duplicatesJSON() {
    const model = o.getModel();
    if (!model) return { status: 'pending', wastedBytes: 0, groups: [] };
    const groups = visibleDupGroups().sort((a, b) => b.sizeBytes * (b.files.length - 1) - a.sizeBytes * (a.files.length - 1));
    let wasted = 0;
    for (const g of groups) wasted += g.sizeBytes * (g.files.length - 1);
    return {
      status: model.dup.status,
      wastedBytes: wasted,
      groups: groups.slice(0, MAX_GROUPS).map((g) => ({ id: g.id, sizeBytes: g.sizeBytes, files: g.files.map((f) => itemJSON(entityFromItem(f))) })),
    };
  }

  /** @param {string | null} rootId @param {string | null} diskId */
  function rootIdFor(rootId, diskId) {
    const model = o.getModel();
    if (rootId) {
      if (!model || !model.roots.has(rootId)) throw new HttpError(404, 'root_not_found', '没有这个扫描根');
      return rootId;
    }
    if (diskId) {
      const info = model ? [...model.rootInfo.values()].find((r) => r.kind === 'disk' && r.diskId === diskId) : null;
      if (!info || !model || !model.roots.has(info.id)) throw new HttpError(404, 'disk_not_scanned', '这个磁盘还没有扫描');
      return info.id;
    }
    if (!model || !model.roots.size) return null;
    const first = [...model.rootInfo.keys()].find((k) => model.roots.has(k));
    return first || [...model.roots.keys()][0];
  }

  /**
   * 节点所属的扫描根：先看目录树顶端是哪个扫描根，还没嫁接进去的（快速扫描根）按路径找最近的扫描根。
   * @param {import('./model.mjs').ScanModel} m @param {import('./tree.mjs').TNode} node @param {string} path
   */
  function rootIdOfNode(m, node, path) {
    let top = node;
    while (top.parent) top = top.parent;
    for (const [id, r] of m.roots) if (r === top) return id;
    const k = pathOps.key(path);
    let best = null;
    let len = -1;
    for (const info of m.rootInfo.values()) {
      const rk = pathOps.key(info.path);
      if (m.roots.has(info.id) && pathOps.sameOrInside(k, rk) && rk.length > len) {
        best = info.id;
        len = rk.length;
      }
    }
    return best;
  }

  /**
   * 优先级：id > rootId > diskId > 第一个扫描根。
   * @param {string | null} id @param {string | null} rootId @param {string | null} diskId @param {string | null} depthRaw
   */
  function treeJSON(id, rootId, diskId, depthRaw) {
    const model = o.getModel();
    let depth = depthRaw ? Number(depthRaw) : 4;
    if (!Number.isInteger(depth) || depth < 1 || depth > 4) throw new HttpError(400, 'bad_request', '层数要在 1 到 4 之间');
    /** @type {import('./tree.mjs').TNode | null | undefined} */
    let node = null;
    /** @type {string | null} */
    let rid = null;
    if (id) {
      const e = model ? resolve(id) : null;
      if (e && model) node = e.node || model.findNode(e.path).node;
      if (!node) throw new HttpError(404, 'not_found', '找不到这个条目，请重新扫描');
    } else {
      rid = rootIdFor(rootId, diskId);
      node = rid && model ? model.roots.get(rid) : null;
      if (!node) throw new HttpError(404, 'not_found', '还没有扫描结果');
    }
    const m = /** @type {import('./model.mjs').ScanModel} */ (model);
    const path = m.nodePath(node);
    const rootSize = node.size || 1;
    /** @type {{ id: string, name: string }[]} */
    const chain = [];
    for (let n = node; n; n = n.parent) chain.push({ id: m.idOf(n), name: n.name });
    chain.reverse();

    /** @param {import('./tree.mjs').TNode} n @param {string} p @param {number} level @returns {any} */
    const build = (n, p, level) => {
      const e = entityFromNode(n);
      const lockReason = lockFor(e);
      const json = {
        id: e.id,
        name: n.name,
        kind: e.kind,
        sizeBytes: n.size,
        mtimeMs: n.mtime,
        category: e.category,
        tags: e.tags,
        locked: !!lockReason,
        lockReason: lockReason || null,
        selected: o.isSelected(e.key),
        children: /** @type {any[]} */ ([]),
      };
      if (level >= depth || e.kind !== 'dir') return json;
      const children = n.children ? n.children.slice().sort((a, b) => b.size - a.size) : [];
      const minShow = level === 0 ? 0 : rootSize * 0.001;
      let other = 0;
      let sum = 0;
      for (const c of children) {
        sum += c.size;
        if (json.children.length < MAX_TREE_CHILDREN && c.size >= minShow) {
          const expand = level === 0 || c.size >= rootSize * 0.005;
          json.children.push(build(c, pathOps.join(p, c.name), expand ? level + 1 : depth));
        } else other += c.size;
      }
      other += Math.max(0, n.size - sum);
      if (other > 0) {
        json.children.push({ id: '', name: '其他小文件', kind: 'others', sizeBytes: other, mtimeMs: 0, category: null, tags: [], locked: false, lockReason: null, selected: false, children: [] });
      }
      return json;
    };
    const disk = diskOf(path, o.getDisks(), pathOps);
    return { diskId: disk ? disk.id : null, rootId: rid || rootIdOfNode(m, node, path), breadcrumbs: chain, node: build(node, path, 0) };
  }

  /** rootId 优先于 diskId；都省略时用第一个扫描根。 @param {string | null} diskId @param {string | null} [rootId] */
  function typesJSON(diskId, rootId = null) {
    const model = o.getModel();
    if (diskId && !rootId && !o.getDisks().some((d) => d.id === diskId)) throw new HttpError(400, 'invalid_disk', '没有这个磁盘');
    if (!model) {
      if (rootId) throw new HttpError(404, 'root_not_found', '没有这个扫描根');
      return { types: [] };
    }
    let id;
    try {
      id = rootIdFor(rootId, diskId);
    } catch (e) {
      if (e instanceof HttpError && e.code === 'disk_not_scanned') return { types: [] };
      throw e;
    }
    const m = id ? model.types.get(id) : null;
    if (!m) return { types: [] };
    const types = [...m.entries()].map(([kind, v]) => ({ kind, label: /** @type {any} */ (TYPE_LABELS)[kind] || kind, bytes: v.bytes, count: v.count }));
    types.sort((a, b) => b.bytes - a.bytes);
    return { types };
  }

  function deniedJSON() {
    const model = o.getModel();
    if (!model) return { count: 0, dirs: [] };
    return { count: model.denied.count, dirs: model.denied.dirs.slice(0, 200) };
  }

  /**
   * 前 N 个子项：目录树里有就用目录树，否则现场列一层（有数量上限）。
   * @param {Entity} e @param {number} max
   */
  async function childrenOf(e, max = 10) {
    if (e.kind === 'file') return [];
    const model = o.getModel();
    const node = e.node || (model ? model.findNode(e.path).node : null);
    if (node && node.children && node.children.length) {
      return node.children
        .slice()
        .sort((a, b) => b.size - a.size)
        .slice(0, max)
        .map((c) => ({ name: c.name, sizeBytes: c.size, kind: nodeKind(c) }));
    }
    return liveChildren(e.path, max);
  }

  /** @param {string} dir @param {number} max */
  async function liveChildren(dir, max) {
    let names = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      return [];
    }
    const budget = { left: 20000 };
    const out = [];
    for (const name of names.slice(0, 2000)) {
      const p = pathOps.join(dir, name);
      let st;
      try {
        st = await fs.lstat(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) out.push({ name, sizeBytes: await smallDu(p, budget), kind: 'dir' });
      else out.push({ name, sizeBytes: o.sizeOf(st), kind: 'file' });
    }
    out.sort((a, b) => b.sizeBytes - a.sizeBytes);
    return out.slice(0, max);
  }

  /** @param {string} dir @param {{ left: number }} budget */
  async function smallDu(dir, budget) {
    let total = 0;
    const stack = [dir];
    while (stack.length && budget.left > 0) {
      const d = /** @type {string} */ (stack.pop());
      let names = [];
      try {
        names = await fs.readdir(d);
      } catch {
        continue;
      }
      for (const name of names) {
        if (budget.left <= 0) break;
        budget.left -= 1;
        const p = pathOps.join(d, name);
        try {
          const st = await fs.lstat(p);
          if (st.isDirectory()) stack.push(p);
          else total += o.sizeOf(st);
        } catch {
          // 忽略
        }
      }
    }
    return total;
  }

  /** @param {Entity} e */
  async function itemDetail(e) {
    const children = await childrenOf(e, 10);
    return { ...itemJSON(e), kind: e.kind, category: e.category, children };
  }

  return { resolve, resolvePath, entityFromItem, entityFromNode, lockFor, itemJSON, junkJSON, largeJSON, duplicatesJSON, visibleDupGroups, treeJSON, typesJSON, deniedJSON, childrenOf, itemDetail, catById };
}
