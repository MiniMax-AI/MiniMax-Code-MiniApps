// @ts-check
// 扫描引擎：快速扫描（规则固定位置）→ 深度扫描（全盘，嫁接快速扫描结果）→ 重复文件比对；以及单目录重新扫描。
import { createHooks } from './hooks.mjs';
import { findDuplicateGroups } from './duplicates.mjs';
import { createProtection, diskOf } from './protect.mjs';
import { MAC_FIRMLINKS_DEFAULT, MAC_SKIP, MAC_SYSVOL, buildRuleIndex, buildRuleSpecs, categoriesFor, containerPaths, expandSpecs, fileKind, newMeta, noteMeta, parseFirmlinks } from './rules.mjs';
import { createKeySet } from './clones.mjs';
import { createWalker } from './scanner.mjs';
import { CF, F, TNode, forceFinalize } from './tree.mjs';
import { getEnv } from './util.mjs';

/** 快速扫描同时统计的固定位置数，以及每个位置最少分到的并发数（总并发仍是 concurrency）。 */
const QUICK_PARALLEL = 4;
const QUICK_MIN_CONCURRENCY = 4;

/**
 * 并发上限为 n 地执行，第一个错误之后不再开始新的任务，等进行中的结束后抛出。
 * @template T @param {T[]} tasks @param {number} n @param {(t: T) => Promise<void>} fn
 */
async function runPool(tasks, n, fn) {
  let next = 0;
  /** @type {{ e: any } | null} */
  let failed = null;
  const worker = async () => {
    while (!failed && next < tasks.length) {
      const t = tasks[next];
      next += 1;
      try {
        await fn(t);
      } catch (e) {
        if (!failed) failed = { e };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
  if (failed) throw failed.e;
}

/**
 * @param {{
 *   fs: any, pathOps: import('./util.mjs').PathOps, platform: string, env: Record<string, string | undefined>,
 *   home: string, tmpdir: string, sys: ReturnType<typeof import('./platform.mjs').createSystem>,
 *   mcodeDataDir: string | null, dataDir: string, concurrency?: number, sizeOf?: (st: any) => number,
 * }} o
 */
export function createScanEngine(o) {
  const { fs, pathOps, platform, env, home, tmpdir, sys } = o;
  const sizeOf = o.sizeOf || (platform === 'darwin' ? (/** @type {any} */ st) => (st.blocks || 0) * 512 : (/** @type {any} */ st) => st.size || 0);
  const concurrency = o.concurrency || 32;
  /** @type {string | null | undefined} */
  let goModCache;

  async function getGoModCache() {
    if (goModCache === undefined) {
      try {
        goModCache = await sys.goModCache();
      } catch {
        goModCache = null;
      }
    }
    return goModCache;
  }

  /** 只用于锁定判断的保护名单（不展开规则）。 */
  async function protectionOnly() {
    return createProtection({ platform, pathOps, home, env, goModCache: await getGoModCache(), mcodeDataDir: o.mcodeDataDir, dataDir: o.dataDir });
  }

  async function prepareContext() {
    const gm = await getGoModCache();
    const protection = createProtection({ platform, pathOps, home, env, goModCache: gm, mcodeDataDir: o.mcodeDataDir, dataDir: o.dataDir });
    const specs = buildRuleSpecs({ platform, env, home, tmpdir, goModCache: gm, pathOps });
    const concrete = await expandSpecs(specs, fs, pathOps);
    /** @type {string[]} */
    let noDupPaths = [];
    /** 云盘目录不遍历：列目录会触发云端按需下载目录信息，既慢又有副作用；它们本来就在保护名单里。 @type {string[]} */
    let cloudPaths = [];
    /** @type {string[]} */
    let dataVolPaths = [];
    if (platform === 'darwin') {
      noDupPaths = [pathOps.join(home, 'Library')];
      cloudPaths = [pathOps.join(pathOps.join(home, 'Library'), 'Mobile Documents'), pathOps.join(pathOps.join(home, 'Library'), 'CloudStorage')];
      try {
        dataVolPaths = parseFirmlinks(await fs.readFile('/usr/share/firmlinks', 'utf8'));
      } catch {
        dataVolPaths = [];
      }
      if (!dataVolPaths.length) dataVolPaths = MAC_FIRMLINKS_DEFAULT;
    }
    if (platform === 'win32') {
      const user = getEnv(env, 'USERPROFILE') || home;
      noDupPaths = [pathOps.join(user, 'AppData')];
      cloudPaths = [getEnv(env, 'OneDrive'), getEnv(env, 'OneDriveConsumer'), getEnv(env, 'OneDriveCommercial'), pathOps.join(user, 'OneDrive')].filter((p) => !!p).map((p) => pathOps.norm(/** @type {string} */ (p)));
    }
    const rules = buildRuleIndex({
      specs: concrete,
      pathOps,
      platform,
      protectedKeys: protection.protectedKeys,
      trashKeys: protection.trashKeys,
      skipPaths: [...(platform === 'darwin' ? MAC_SKIP : []), ...cloudPaths],
      noDupPaths,
      sysVolPaths: platform === 'darwin' ? MAC_SYSVOL : [],
      dataVolPaths,
      noPatternPaths: containerPaths({ platform, env, home, pathOps }),
    });
    return { rules, protection, goModCache: gm };
  }

  /** 一次完整扫描共用的去重表：目录、硬链接、APFS 克隆（只在 macOS 上）。 */
  function newDedup() {
    return { inodes: createKeySet(16), dirs: createKeySet(18), clones: platform === 'darwin' ? createKeySet(18) : null };
  }

  /** @param {any} stats @param {number} dev @param {number} bytes */
  function addDev(stats, dev, bytes) {
    if (bytes) stats.bytesByDev.set(dev, (stats.bytesByDev.get(dev) || 0) + bytes);
  }

  /** @param {string} path @param {any} st @param {string} name @param {any} rules */
  function makeRoot(path, st, name, rules) {
    const node = new TNode(name, null, F.DIR);
    node.rp = path;
    node.mtime = st.mtimeMs;
    node.maxMtime = st.mtimeMs;
    node.dev = st.dev;
    node.ino = st.ino;
    node.sp = rules.specials.get(pathOps.key(path)) || null;
    node.cf = rules.ancestorCf(path);
    node.size = sizeOf(st);
    node.du = node.size;
    if (name === '.git') node.flags |= F.GIT_DIR;
    return node;
  }

  /** 深度扫描允许的设备号：macOS 根目录同时允许系统卷和数据卷。 @param {string} mount @param {any} st */
  async function devsForMount(mount, st) {
    const devs = new Set([st.dev]);
    let usedDev = st.dev;
    if (platform === 'darwin' && mount === '/') {
      try {
        const d = await fs.lstat('/System/Volumes/Data');
        devs.add(d.dev);
        usedDev = d.dev;
      } catch {
        // 旧系统
      }
    }
    return { devs, usedDev };
  }

  /**
   * 扫描根本身位于 git 工作区里（遍历时看不到上面的 .git）：从上一级往上找 .git，找到所在磁盘的挂载点为止。
   * @param {string} p @param {string} mount
   */
  async function insideGitWorkTree(p, mount) {
    const mk = pathOps.key(mount);
    for (let cur = pathOps.dirname(p); pathOps.sameOrInside(pathOps.key(cur), mk); ) {
      const hit = await fs.lstat(pathOps.join(cur, '.git')).then(
        () => true,
        () => false,
      );
      if (hit) return true;
      const parent = pathOps.dirname(cur);
      if (parent === cur) return false;
      cur = parent;
    }
    return false;
  }

  /** @param {string} dir */
  async function buildMeta(dir) {
    const meta = newMeta();
    let ents = [];
    try {
      ents = await fs.readdir(dir);
    } catch {
      return meta;
    }
    for (const name of ents.slice(0, 5000)) {
      try {
        noteMeta(meta, name, await fs.lstat(pathOps.join(dir, name)));
      } catch {
        // 忽略
      }
    }
    return meta;
  }

  /**
   * @param {{
   *   model: import('./model.mjs').ScanModel, disks: any[], roots: { id: string, kind: string, label: string, path: string, diskId: string }[],
   *   signal: AbortSignal, stats: any, ctx: any, now: number,
   *   onPhase: (phase: string) => void, onPhaseDone: (phase: string) => Promise<void>, onDedup?: (d: ReturnType<typeof newDedup>) => void,
   *   onQuickStart?: () => void,
   * }} a
   */
  async function runFullScan(a) {
    const { model, disks, signal, stats, ctx, now } = a;
    const dedup = newDedup();
    a.onDedup?.(dedup);
    /** @type {Map<number, any[]>} */
    const dupBySize = new Map();
    const hooks = createHooks({ model, rules: ctx.rules, platform, now, dupBySize });
    const forget = (/** @type {TNode} */ n) => model.forget(n);
    /** 规则位置是否落在这个扫描根里：磁盘按所在磁盘判断，文件夹按路径前缀判断。 @param {string} p @param {any} r */
    const within = (p, r) => {
      if (r.kind === 'disk') {
        const d = diskOf(p, disks, pathOps);
        return !!d && d.id === r.diskId;
      }
      return pathOps.sameOrInside(pathOps.key(p), pathOps.key(r.path));
    };

    // 快速扫描：各个固定位置分开遍历，同时最多 QUICK_PARALLEL 个，统计完一个就出一个的结果。
    // 每个扫描根一套钩子（钩子里记着所在磁盘和文件类型归属）。
    a.onPhase('quick');
    /** @type {{ node: TNode, path: string, hooks: ReturnType<typeof createHooks> }[]} */
    const tasks = [];
    for (const r of a.roots) {
      const rh = createHooks({ model, rules: ctx.rules, platform, now, dupBySize });
      rh.setDisk(r.diskId, r.id);
      for (const p of ctx.rules.quickRoots) {
        if (!within(p, r) || model.quickRoots.has(pathOps.key(p))) continue;
        let st;
        try {
          st = await fs.lstat(p);
        } catch {
          continue;
        }
        if (!st.isDirectory()) continue;
        const node = makeRoot(p, st, pathOps.basename(p), ctx.rules);
        addDev(stats, st.dev, node.size);
        model.quickRoots.set(pathOps.key(p), node);
        tasks.push({ node, path: p, hooks: rh });
      }
    }
    model.beginComputing(await computingTargets(model, ctx, a.roots, within));
    a.onQuickStart?.();
    let active = 0;
    const share = () => Math.max(QUICK_MIN_CONCURRENCY, Math.floor(concurrency / Math.max(1, active)));
    try {
      await runPool(tasks, QUICK_PARALLEL, async (t) => {
        active += 1;
        const walker = createWalker({ fs, pathOps, sizeOf, signal, hooks: t.hooks, ...dedup, stats, concurrency: share });
        try {
          await walker.walkRoots([{ node: t.node, path: t.path }]);
        } finally {
          active -= 1;
          forceFinalize(t.node, forget);
          model.computingVersion += 1;
        }
      });
    } finally {
      model.endComputing();
    }
    await a.onPhaseDone('quick');

    a.onPhase('deep');
    for (const r of a.roots) {
      const root = model.roots.get(r.id);
      if (!root) continue;
      let st;
      try {
        st = await fs.lstat(r.path);
      } catch {
        continue;
      }
      // 文件夹本身就是快速扫描过的规则位置：直接用快速扫描的结果作为这个根。
      const quick = r.kind === 'folder' ? model.quickRoots.get(pathOps.key(r.path)) : null;
      if (quick && !quick.parent) {
        quick.name = r.label;
        model.roots.set(r.id, quick);
        continue;
      }
      root.mtime = st.mtimeMs;
      root.maxMtime = st.mtimeMs;
      root.dev = st.dev;
      root.ino = st.ino;
      root.sp = ctx.rules.specials.get(pathOps.key(r.path)) || null;
      root.cf = ctx.rules.ancestorCf(r.path);
      const disk = r.kind === 'folder' ? disks.find((d) => d.id === r.diskId) || diskOf(r.path, disks, pathOps) : null;
      if (disk && (await insideGitWorkTree(r.path, disk.mount))) root.cf |= CF.NODUP;
      root.size = sizeOf(st);
      root.du = root.size;
      addDev(stats, st.dev, root.size);
      /** @type {Set<number>} */
      let devs = new Set([st.dev]);
      if (r.kind === 'disk') {
        const got = await devsForMount(r.path, st);
        devs = got.devs;
        model.diskDevs.set(r.diskId, [got.usedDev]);
      }
      hooks.setDisk(r.diskId, r.id);
      const walker = createWalker({ fs, pathOps, sizeOf, signal, hooks, ...dedup, stats, concurrency, allowedDevs: devs, graft: model.quickRoots });
      try {
        await walker.walkRoots([{ node: root, path: r.path }]);
      } finally {
        forceFinalize(root, forget);
      }
    }
    await a.onPhaseDone('deep');

    a.onPhase('duplicates');
    model.dup.status = 'running';
    model.dup.groups = [];
    const progress = {
      files: 0,
      bytes: 0,
      get currentPath() {
        return stats.currentPath;
      },
      set currentPath(v) {
        stats.currentPath = v;
      },
    };
    // git 工作区根目录里的文件：登记候选时还没列到 .git，这里筛掉（目录节点已经带上 NODUP）。
    for (const [size, arr] of dupBySize) {
      const keep = arr.filter((c) => !(c.dir.cf & CF.NODUP));
      if (keep.length < 2) dupBySize.delete(size);
      else if (keep.length !== arr.length) dupBySize.set(size, keep);
    }
    await findDuplicateGroups({
      bySize: dupBySize,
      fs,
      signal,
      progress,
      pathOf: (c) => pathOps.join(model.nodePath(c.dir), c.name),
      onGroup: (g) => addDupGroup(model, g),
    });
    dupBySize.clear();
    model.dup.status = 'done';
    await a.onPhaseDone('duplicates');
  }

  /**
   * 快速扫描开始前：范围内存在的规则位置。路径本身是条目的先建占位条目（computing），其他的记为统计中的区域。
   * @param {import('./model.mjs').ScanModel} model @param {any} ctx @param {any[]} roots @param {(p: string, r: any) => boolean} within
   */
  async function computingTargets(model, ctx, roots, within) {
    const tiers = new Map(categoriesFor(platform).map((c) => [c.id, c.tier]));
    const out = [];
    for (const s of ctx.rules.specs) {
      const r = roots.find((x) => within(s.path, x));
      if (!r) continue;
      try {
        if (!(await fs.lstat(s.path)).isDirectory()) continue;
      } catch {
        continue;
      }
      const node = model.quickRoots.get(pathOps.key(s.path)) || null;
      out.push({ path: s.path, cat: s.cat, name: s.name, mode: s.mode || 'dir', app: s.app || null, chat: !!s.chat, tier: tiers.get(s.cat) || 'confirm', node, diskId: r.diskId });
    }
    return out;
  }

  /** @param {import('./model.mjs').ScanModel} model @param {{ size: number, files: any[] }} g */
  function addDupGroup(model, g) {
    const files = g.files.map((c) => {
      const p = pathOps.join(model.nodePath(c.dir), c.name);
      return model.addItem({
        path: p,
        name: c.name,
        kind: 'file',
        diskId: c.diskId,
        sizeBytes: c.bytes,
        releasableBytes: c.bytes,
        mtimeMs: c.mtime,
        dev: c.dev,
        ino: c.ino,
        category: 'duplicates',
        tags: [],
        note: null,
        defaultSelected: false,
        exempt: false,
        typeKind: fileKind(c.name),
        app: null,
        large: false,
      });
    });
    model.seq.dup += 1;
    model.dup.groups.push({ id: `d_${model.seq.dup.toString(36)}`, sizeBytes: g.files[0].bytes, files });
    model.touch();
  }

  /**
   * 只重新扫描一个目录，结果合并回目录树并重算这个目录里的规则条目。
   * @param {{ model: import('./model.mjs').ScanModel, entity: any, disks: any[], signal: AbortSignal, stats: any, ctx: any, now: number }} a
   */
  async function runRescan(a) {
    const { model, entity, disks, signal, stats, ctx, now } = a;
    const path = entity.path;
    const key = pathOps.key(path);
    let st;
    try {
      st = await fs.lstat(path);
    } catch {
      model.removePath(path, entity.sizeBytes, entity.releasableBytes, entity.dev, entity.duBytes);
      return;
    }
    if (!st.isDirectory() || st.isSymbolicLink()) return;
    const { node: oldNode, ancestor } = model.findNode(path);
    const oldSize = oldNode ? oldNode.size : entity.sizeBytes || 0;
    const oldRel = oldNode ? oldNode.rel : entity.releasableBytes || 0;
    const oldDu = oldNode ? oldNode.du : entity.duBytes || entity.sizeBytes || 0;

    const removed = new Set();
    for (const it of [...model.items.values()]) {
      if (it.key === key || pathOps.inside(it.key, key)) {
        model.removeItem(it);
        removed.add(it);
      }
    }
    model.pruneDupGroups((f) => removed.has(f));
    const before = model.denied.dirs.length;
    model.denied.dirs = model.denied.dirs.filter((d) => {
      const k = pathOps.key(d.path);
      return !(k === key || pathOps.inside(k, key));
    });
    model.denied.count = Math.max(0, model.denied.count - (before - model.denied.dirs.length));

    const isRoot = !!oldNode && !oldNode.parent;
    const parentPath = pathOps.dirname(path);
    /** @type {TNode | null} */
    let realParent = oldNode ? oldNode.parent : null;
    if (!realParent && ancestor && pathOps.same(model.nodePath(ancestor), parentPath)) realParent = ancestor;
    /** @type {TNode | null} */
    let walkParent = realParent;
    if (!walkParent && !isRoot) {
      walkParent = new TNode(pathOps.basename(parentPath), null, F.DIR | F.DONE);
      walkParent.rp = parentPath;
      walkParent.sp = ctx.rules.specials.get(pathOps.key(parentPath)) || null;
    }
    const node = makeRoot(path, st, oldNode ? oldNode.name : pathOps.basename(path), ctx.rules);
    if (isRoot && oldNode) {
      node.rp = oldNode.rp;
    } else {
      node.rp = null;
      node.parent = walkParent;
    }
    const disk = diskOf(path, disks, pathOps);
    const hooks = createHooks({ model, rules: ctx.rules, platform, now, dupBySize: new Map() });
    hooks.setDisk(entity.diskId || (disk ? disk.id : null), null);
    const mountHit = disks.find((d) => pathOps.same(d.mount, path));
    const allowedDevs = mountHit ? (await devsForMount(mountHit.mount, st)).devs : new Set([st.dev]);
    const walker = createWalker({ fs, pathOps, sizeOf, signal, hooks, ...newDedup(), stats, concurrency, allowedDevs });
    if (walkParent) walker.setMeta(walkParent, await buildMeta(parentPath));
    /** @type {any} */
    let walkError = null;
    try {
      await walker.walkRoots([{ node, path }]);
    } catch (e) {
      walkError = e;
    } finally {
      forceFinalize(node, (n) => model.forget(n));
    }

    const delta = node.size - oldSize;
    const deltaRel = node.rel - oldRel;
    const deltaDu = node.du - oldDu;
    /** @type {TNode | null} */
    let propagateFrom = null;
    if (isRoot && oldNode) {
      for (const [id, r] of model.roots) if (r === oldNode) model.roots.set(id, node);
      for (const [k, r] of model.quickRoots) if (r === oldNode) model.quickRoots.set(k, node);
    } else if (realParent) {
      const ch = realParent.children;
      const i = ch && oldNode ? ch.indexOf(oldNode) : -1;
      if (ch && i >= 0) ch[i] = node;
      else if (ch) ch.push(node);
      propagateFrom = realParent;
    } else {
      propagateFrom = ancestor;
    }
    if (oldNode) {
      oldNode.flags |= F.REMOVED;
      model.forgetDeep(oldNode);
    }
    for (let n = propagateFrom; n; n = n.parent) {
      n.size = Math.max(0, n.size + delta);
      n.rel = Math.max(0, n.rel + deltaRel);
      n.du = Math.max(0, n.du + deltaDu);
    }
    for (const it of model.items.values()) {
      if (pathOps.inside(key, it.key)) {
        it.sizeBytes = Math.max(0, it.sizeBytes + delta);
        it.releasableBytes = Math.max(0, it.releasableBytes + deltaRel);
        if (typeof it.duBytes === 'number') it.duBytes = Math.max(0, it.duBytes + deltaDu);
      }
    }
    model.bytesByDev.set(st.dev, Math.max(0, (model.bytesByDev.get(st.dev) || 0) + delta));
    model.touch();
    if (walkError) throw walkError;
  }

  return { prepareContext, protectionOnly, runFullScan, runRescan, sizeOf, getGoModCache };
}
