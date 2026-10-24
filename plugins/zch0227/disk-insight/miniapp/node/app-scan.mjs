// @ts-check
// 扫描编排：完整扫描（快速 → 深度 → 代码仓库 → 重复文件）、单目录重新扫描、取消。从 app.mjs 拆出，依赖由 app 注入。
import { ScanModel } from './model.mjs';
import { analyzeRepos, forgetRemoved, repinRepos } from './repos.mjs';
import { resolveScanRoots } from './scope.mjs';
import { F, TNode, forceFinalize } from './tree.mjs';
import { HttpError } from './util.mjs';

/** 快速扫描期间 results 最多每秒推一次。 */
const QUICK_PUSH_MS = 1000;
const QUICK_POLL_MS = 200;
const QUICK_KINDS = ['junk', 'large'];

/**
 * @param {{
 *   st: any, engine: ReturnType<typeof import('./scan-engine.mjs').createScanEngine>,
 *   views: ReturnType<typeof import('./views.mjs').createViews>,
 *   fs: any, pathOps: import('./util.mjs').PathOps, home: string, platform: string,
 *   sys: any, hub: ReturnType<typeof import('./http.mjs').createSseHub>,
 *   logger: import('./miniapp-api.js').MiniAppLogger, clock: { now(): number },
 *   lastScope: { set(v: any): Promise<void> }, allKinds: string[], phaseKinds: Record<string, string[]>,
 *   ensureLoaded: () => Promise<void>, assertIdle: () => void, refreshDisks: (force?: boolean) => Promise<any[]>,
 *   selChanged: () => void, applyDefaults: () => void, saveScan: () => void,
 *   pushState: () => void, pushStateNow: () => void, startTicker: () => () => void,
 * }} o
 */
export function createScanOps(o) {
  const { st, engine, views, fs, pathOps, home, hub, logger, clock } = o;

  /** @param {any} body */
  async function startScan(body) {
    await o.ensureLoaded();
    if (o.platform === 'unsupported') throw new HttpError(400, 'unsupported_platform', '暂不支持此系统');
    o.assertIdle();
    const disks = await o.refreshDisks(true);
    const { roots, diskIds, paths } = await resolveScanRoots(body, { fs, pathOps, home, disks });
    void o.lastScope.set({ diskIds, paths });
    const model = new ScanModel(pathOps);
    model.scan = { status: 'running', phase: 'quick', diskIds, paths, startedAt: clock.now(), finishedAt: null, error: null };
    for (const r of roots) {
      const root = new TNode(r.label, null, F.DIR);
      root.rp = r.path;
      model.roots.set(r.id, root);
      model.rootInfo.set(r.id, r);
    }
    st.model = model;
    st.sel.entries.clear();
    st.sel.deselected.clear();
    o.selChanged();
    const ac = new AbortController();
    st.scanAbort = ac;
    st.stats = { files: 0, dirs: 0, bytes: 0, currentPath: '', bytesByDev: model.bytesByDev };
    st.rate = 0;
    logger.info('scan.started', { diskCount: diskIds.length, folderCount: paths.length });
    st.task = runScan(model, disks, roots, ac).finally(() => {
      st.task = null;
      st.scanAbort = null;
    });
    hub.broadcast('results', { kinds: o.allKinds });
    o.pushState();
  }

  /**
   * 快速扫描期间：统计完一个位置就更新结果，最多每秒推一次 results。返回停止函数。
   * @param {ScanModel} model @param {number} t0
   */
  function startQuickPusher(model, t0) {
    let seen = model.computingVersion;
    let lastPush = 0;
    let first = true;
    const timer = setInterval(() => {
      if (model.scan.phase !== 'quick' || model.computingVersion === seen) return;
      const now = clock.now();
      if (now - lastPush < QUICK_PUSH_MS) return;
      seen = model.computingVersion;
      lastPush = now;
      if (first) {
        first = false;
        logger.info('scan.quick.first_results', { ms: now - t0, pending: model.computingNodes.size + model.computingAreas.size, items: model.items.size });
      }
      o.applyDefaults();
      model.touch();
      hub.broadcast('results', { kinds: QUICK_KINDS });
    }, QUICK_POLL_MS);
    return () => clearInterval(timer);
  }

  /** @param {ScanModel} model @param {any[]} disks @param {any[]} roots @param {AbortController} ac */
  async function runScan(model, disks, roots, ac) {
    const t0 = clock.now();
    let phaseStart = t0;
    const stopTicker = o.startTicker();
    const stopQuick = startQuickPusher(model, t0);
    const stats = st.stats;
    /** @type {any} */
    let dedup = null;
    try {
      const ctx = await engine.prepareContext();
      model.ctx = ctx;
      st.protection = ctx.protection;
      await engine.runFullScan({
        model,
        disks,
        roots,
        signal: ac.signal,
        stats,
        ctx,
        now: t0,
        onDedup: (d) => {
          dedup = d;
        },
        onQuickStart: () => {
          // 还在统计的位置先出现在结果里（computing）。
          model.touch();
          hub.broadcast('results', { kinds: QUICK_KINDS });
        },
        onPhase: (p) => {
          model.scan.phase = p;
          phaseStart = clock.now();
          o.pushState();
        },
        onPhaseDone: async (p) => {
          logger.info('scan.phase.done', {
            phase: p,
            files: stats.files,
            dirs: stats.dirs,
            skippedDirs: stats.skipped || 0,
            dupDirs: stats.dupDirs || 0,
            cloneFiles: stats.cloneFiles || 0,
            cloneBytes: stats.cloneBytes || 0,
            dedupKeys: dedup ? dedup.dirs.size + dedup.inodes.size + (dedup.clones ? dedup.clones.size : 0) : 0,
            dedupMB: dedup ? Math.round((dedup.dirs.bytes + dedup.inodes.bytes + (dedup.clones ? dedup.clones.bytes : 0)) / 1e6) : 0,
            ms: clock.now() - phaseStart,
            items: model.items.size,
          });
          if (p === 'quick') {
            stopQuick();
            await tagInUse(model);
          }
          if (p === 'deep') {
            const r0 = clock.now();
            const counts = await analyzeRepos({ model, fs, pathOps });
            logger.info('repos.analyzed', { ...counts, ms: clock.now() - r0 });
          }
          o.applyDefaults();
          model.touch();
          o.saveScan();
          hub.broadcast('results', { kinds: o.phaseKinds[p] });
        },
      });
      finishScan(model, 'done', null);
      logger.info('scan.done', { files: stats.files, dirs: stats.dirs, ms: clock.now() - t0, items: model.items.size, deniedCount: model.denied.count, dupGroups: model.dup.groups.length });
    } catch (e) {
      for (const r of model.allRoots()) forceFinalize(r, (n) => model.forget(n));
      if (model.dup.status === 'running') model.dup.status = 'done';
      o.applyDefaults();
      if (ac.signal.aborted) {
        finishScan(model, 'cancelled', null);
        logger.info('scan.cancelled', { files: stats.files, dirs: stats.dirs, ms: clock.now() - t0 });
      } else {
        finishScan(model, 'error', '扫描出错，已保留得到的结果');
        logger.error('scan.failed', { code: /** @type {any} */ (e).code || /** @type {any} */ (e).name || 'error' });
      }
      hub.broadcast('results', { kinds: o.allKinds });
    } finally {
      stopQuick();
      stopTicker();
      o.saveScan();
      if (!st.disposed) await o.refreshDisks(true);
      o.pushStateNow();
    }
  }

  /** @param {ScanModel} model @param {string} status @param {string | null} error */
  function finishScan(model, status, error) {
    model.scan.status = status;
    model.scan.phase = null;
    model.scan.finishedAt = clock.now();
    model.scan.error = error;
    const s = st.stats || {};
    /** @type {any} */ (model.scan).totals = { files: s.files || 0, dirs: s.dirs || 0, bytes: s.bytes || 0, currentPath: '' };
    model.touch();
  }

  /** 正在运行的应用的缓存加 in-use 标签。 @param {ScanModel} model */
  async function tagInUse(model) {
    let running;
    try {
      running = await o.sys.runningApps();
    } catch {
      return;
    }
    for (const it of model.items.values()) if (it.app && running.has(it.app) && !it.tags.includes('in-use')) it.tags.push('in-use');
  }

  function cancelScan() {
    if (st.scanAbort) st.scanAbort.abort();
    return { ok: true };
  }

  /**
   * 单目录重新扫描：不改变 scan.status / phase / progress，也不清空已选清单。
   * 进行中时其他扫描和清理返回 409，完成后推送 results 和 selection（大小可能变化）。
   * @param {any} body
   */
  async function startRescan(body) {
    await o.ensureLoaded();
    o.assertIdle();
    const e = views.resolve(body.id);
    if (!e) throw new HttpError(404, 'not_found', '找不到这个条目，请重新扫描');
    if (e.kind !== 'dir') throw new HttpError(400, 'not_dir', '只能重新扫描目录');
    const model = /** @type {ScanModel} */ (st.model);
    const ac = new AbortController();
    st.scanAbort = ac;
    const stats = { files: 0, dirs: 0, bytes: 0, currentPath: '', bytesByDev: new Map() };
    logger.info('rescan.started', { kind: e.node ? 'node' : 'item' });
    st.task = (async () => {
      try {
        const ctx = model.ctx || (await engine.prepareContext());
        model.ctx = ctx;
        st.protection = ctx.protection;
        await engine.runRescan({ model, entity: e, disks: st.disks, signal: ac.signal, stats, ctx, now: clock.now() });
        // 目录已经不在了：里面的 worktree 从代码仓库列表里去掉。
        const gone = await fs.lstat(e.path).then(
          () => false,
          () => true,
        );
        if (gone) forgetRemoved(model, pathOps, e.path);
        logger.info('rescan.done', { files: stats.files, dirs: stats.dirs, skippedDirs: stats.skipped || 0 });
      } catch (err) {
        if (ac.signal.aborted) logger.info('rescan.cancelled', { files: stats.files });
        else logger.error('rescan.failed', { code: /** @type {any} */ (err).code || /** @type {any} */ (err).name || 'error' });
      } finally {
        // 已知仓库和 worktree 的新节点钉回目录树，保持有条目编号。
        repinRepos(model, pathOps);
        o.applyDefaults();
        model.touch();
        o.saveScan();
        o.selChanged();
        hub.broadcast('results', { kinds: o.allKinds });
        o.pushStateNow();
      }
    })().finally(() => {
      st.task = null;
      st.scanAbort = null;
    });
  }

  return { startScan, cancelScan, startRescan };
}
