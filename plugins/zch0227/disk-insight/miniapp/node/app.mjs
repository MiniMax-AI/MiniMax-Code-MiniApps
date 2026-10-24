// @ts-check
// 业务服务：状态、加载、已选清单、扫描 / 重新扫描 / 清理的编排、SSE 推送。所有依赖都可注入。
import { createItemActions } from './app-actions.mjs';
import { createCleanOps } from './app-clean.mjs';
import { createCleanStats, createIgnoreList, createLastScope, createV3Ops } from './app-extras.mjs';
import { createRepoOps } from './app-repos.mjs';
import { createScanOps } from './app-scan.mjs';
import { createSelectionOps } from './app-selection.mjs';
import { createRemover } from './cleaner.mjs';
import { listPlaces } from './scope.mjs';
import { selectionTotals } from './selection.mjs';
import { createSseHub } from './http.mjs';
import { ScanModel } from './model.mjs';
import { createSystem } from './platform.mjs';
import { createScanEngine } from './scan-engine.mjs';
import { createStore } from './store.mjs';
import { HttpError, createPathOps } from './util.mjs';
import { createViews } from './views.mjs';

const SCAN_FILE = 'scan-v4.ndjson.gz';
const SEL_FILE = 'selection-v1.json';
const HISTORY_FILE = 'history-v1.json';
const ALL_KINDS = ['junk', 'tree', 'large', 'duplicates', 'types', 'denied', 'repos'];
const PHASE_KINDS = { quick: ['junk', 'large', 'types', 'denied'], deep: ['junk', 'tree', 'large', 'types', 'denied', 'repos'], duplicates: ['junk', 'duplicates'] };

/**
 * @param {{
 *   platform: string, env: Record<string, string | undefined>, home: string, tmpdir: string, fs: any,
 *   exec: import('./exec.mjs').Runner, dataDir: string, logger: import('./miniapp-api.js').MiniAppLogger,
 *   clock?: { now(): number }, mcodeDataDir?: string | null, concurrency?: number,
 *   disks?: () => Promise<any[]>, remove?: (p: string, id?: string) => Promise<{ ok: boolean, error?: string | null, errno?: string | null }>, fullDiskAccess?: () => Promise<string>,
 *   runningApps?: () => Promise<Set<string>>, reveal?: (p: string) => Promise<boolean>, systemAction?: (a: string) => Promise<boolean>,
 *   goModCache?: () => Promise<string | null>, sizeOf?: (st: any) => number,
 *   pickFolder?: () => Promise<{ path?: string, cancelled?: boolean } | null>, preview?: (p: string) => Promise<boolean>,
 *   gitPath?: () => Promise<string | null>,
 * }} deps
 */
export function createApp(deps) {
  const { env, home, tmpdir, fs, exec, dataDir, logger } = deps;
  const clock = deps.clock || { now: () => Date.now() };
  const rawPlatform = deps.platform;
  const platform = rawPlatform === 'darwin' || rawPlatform === 'win32' ? rawPlatform : 'unsupported';
  const pathOps = createPathOps(rawPlatform === 'win32' ? 'win32' : 'posix');
  const base = createSystem({ platform: rawPlatform, env, home, fs, exec, pathOps, cwd: dataDir });
  // 删除执行器改名为 remove（直接永久删除）。还传旧名 trash 的调用方（测试、只读脚本）会被静默换成真删除，直接报错。
  if ('trash' in deps) throw new Error('createApp: deps.trash 已改名为 deps.remove');
  const remove = deps.remove || createRemover({ fs, logger });
  const sys = {
    ...base,
    listDisks: deps.disks || base.listDisks,
    fullDiskAccess: deps.fullDiskAccess || base.fullDiskAccess,
    runningApps: deps.runningApps || base.runningApps,
    reveal: deps.reveal || base.reveal,
    systemAction: deps.systemAction || base.systemAction,
    goModCache: deps.goModCache || base.goModCache,
    pickFolder: deps.pickFolder || base.pickFolder,
    preview: deps.preview || base.preview,
  };
  const engine = createScanEngine({ fs, pathOps, platform: rawPlatform, env, home, tmpdir, sys, mcodeDataDir: deps.mcodeDataDir || null, dataDir, concurrency: deps.concurrency, sizeOf: deps.sizeOf });
  const store = createStore({ fs, dataDir, logger });
  const hub = createSseHub();
  const ignore = createIgnoreList({ store, pathOps, clock });
  const cleanStats = createCleanStats({ store, clock });
  const lastScope = createLastScope({ store });

  const st = {
    loaded: false,
    /** @type {Promise<void> | null} */
    loading: null,
    /** @type {ScanModel | null} */
    model: null,
    sel: { /** @type {Map<string, { id: string, path: string }>} */ entries: new Map(), /** @type {Set<string>} */ deselected: new Set(), version: 0 },
    /** @type {any[]} */
    history: [],
    /** @type {any[]} */
    disks: [],
    disksAt: 0,
    /** @type {Promise<any[]> | null} */
    disksPending: null,
    fda: 'unknown',
    fdaAt: 0,
    /** @type {any[]} */
    places: [],
    placesAt: 0,
    /** @type {any} */
    protection: null,
    /** @type {AbortController | null} */
    scanAbort: null,
    /** @type {Promise<void> | null} */
    task: null,
    /** @type {any} */
    stats: null,
    rate: 0,
    /** @type {any} */
    cleaning: null,
    /** @type {Map<string, any>} */
    jobs: new Map(),
    jobSeq: 0,
    /** @type {{ key: string, value: any } | null} */
    selCache: null,
    disposed: false,
  };
  /** @type {Set<ReturnType<typeof setTimeout>>} */
  const timers = new Set();
  let lastStatePush = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let statePushTimer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let selSaveTimer = null;

  const views = createViews({
    platform: rawPlatform,
    pathOps,
    fs,
    sizeOf: engine.sizeOf,
    getModel: () => st.model,
    getDisks: () => st.disks,
    getProtection: () => st.protection,
    isSelected: (key) => st.sel.entries.has(key),
    isIgnored: (key) => ignore.has(key),
  });

  // ---------------------------------------------------------------- 加载与持久化

  async function ensureLoaded() {
    if (st.loaded) return;
    if (!st.loading) {
      st.loading = (async () => {
        const loaded = await store.readLines(SCAN_FILE, (lines) => ScanModel.deserializeLines(lines, pathOps));
        if (loaded) st.model = loaded;
        else if (loaded === null) logger.info('persist.scan_absent', { count: 0 });
        const sel = await store.readJSON(SEL_FILE, 1);
        if (sel && st.model) {
          for (const e of sel.entries || []) if (e && typeof e.path === 'string') st.sel.entries.set(pathOps.key(e.path), { id: e.id, path: e.path });
          for (const k of sel.deselected || []) if (typeof k === 'string') st.sel.deselected.add(k);
        }
        const hist = await store.readJSON(HISTORY_FILE, 1);
        if (hist && Array.isArray(hist.entries)) st.history = hist.entries.slice(0, 500);
        await ignore.load();
        await cleanStats.load();
        await lastScope.load();
        st.protection = await engine.protectionOnly();
        await refreshDisks(true);
        st.loaded = true;
      })();
    }
    await st.loading;
  }

  function saveScan() {
    const m = st.model;
    if (m) store.writeLines(SCAN_FILE, () => m.serializeLines());
  }
  function saveSelectionSoon() {
    if (selSaveTimer) return;
    selSaveTimer = setTimeout(() => {
      if (selSaveTimer) timers.delete(selSaveTimer);
      selSaveTimer = null;
      store.writeJSON(SEL_FILE, () => ({ version: 1, entries: [...st.sel.entries.values()], deselected: [...st.sel.deselected] }));
    }, 300);
    timers.add(selSaveTimer);
  }
  function saveHistory() {
    store.writeJSON(HISTORY_FILE, () => ({ version: 1, entries: st.history }));
  }

  /** @param {boolean} [force] */
  async function refreshDisks(force = false) {
    if (!force && st.disksAt && clock.now() - st.disksAt < 5000) return st.disks;
    if (!st.disksPending) {
      st.disksPending = (async () => {
        try {
          st.disks = await sys.listDisks();
        } catch (e) {
          logger.warn('disks.failed', { code: /** @type {any} */ (e).code || 'error' });
        }
        st.disksAt = clock.now();
        return st.disks;
      })().finally(() => {
        st.disksPending = null;
      });
    }
    return st.disksPending;
  }
  async function refreshFda() {
    if (st.fdaAt && clock.now() - st.fdaAt < 30000) return;
    try {
      st.fda = await sys.fullDiskAccess();
    } catch {
      st.fda = 'unknown';
    }
    st.fdaAt = clock.now();
  }
  /** 常用位置（只列存在的目录），30 秒内复用。 */
  async function refreshPlaces() {
    if (st.placesAt && clock.now() - st.placesAt < 30000) return;
    st.places = await listPlaces({ fs, pathOps, home, platform: rawPlatform, env }).catch(() => []);
    st.placesAt = clock.now();
  }

  // ---------------------------------------------------------------- 已选清单

  function selEntities() {
    /** @type {ReturnType<typeof views.resolve>[]} */
    const out = [];
    for (const [key, entry] of [...st.sel.entries]) {
      let e = views.resolve(entry.id);
      if (!e || e.key !== key) e = views.resolvePath(entry.path);
      if (!e) {
        st.sel.entries.delete(key);
        continue;
      }
      entry.id = e.id;
      out.push(e);
    }
    return /** @type {NonNullable<ReturnType<typeof views.resolve>>[]} */ (out);
  }
  function selSummary() {
    const key = `${st.sel.version}:${st.model ? st.model.version : 0}`;
    if (st.selCache && st.selCache.key === key) return st.selCache.value;
    const value = selectionTotals(selEntities(), pathOps);
    st.selCache = { key, value };
    return value;
  }
  function selChanged() {
    st.sel.version += 1;
    saveSelectionSoon();
    hub.broadcast('selection', selSummary());
  }
  function applyDefaults() {
    const m = st.model;
    if (!m) return;
    let changed = false;
    /** 快速扫描中还在统计的条目，统计完成后再做默认勾选。 */
    const later = [];
    for (const it of m.newItems) {
      if (it.computing) {
        later.push(it);
        continue;
      }
      if (!it.defaultSelected || !m.items.has(it.id)) continue;
      if (ignore.has(it.key)) continue;
      if (st.sel.deselected.has(it.key) || st.sel.entries.has(it.key)) continue;
      if (views.lockFor(views.entityFromItem(it))) continue;
      st.sel.entries.set(it.key, { id: it.id, path: it.path });
      changed = true;
    }
    m.newItems = later;
    if (changed) selChanged();
  }

  // ---------------------------------------------------------------- 状态

  /** 单个磁盘的「已用空间减去扫描到的总和」，最小为 0；没扫描过的磁盘为 0。 @param {any} d */
  function diskUnscanned(d) {
    const m = st.model;
    if (!m || !m.scan.diskIds.includes(d.id)) return 0;
    const devs = m.diskDevs.get(d.id);
    if (!devs || !devs.length) return 0;
    let scanned = 0;
    for (const dev of devs) scanned += m.bytesByDev.get(dev) || 0;
    return Math.max(0, (d.usedBytes || 0) - scanned);
  }

  function stateJSON() {
    const m = st.model;
    const scan = m ? m.scan : { status: 'idle', phase: null, diskIds: [], paths: [], startedAt: null, finishedAt: null, error: null };
    const s = st.stats || (m && /** @type {any} */ (m.scan).totals) || { files: 0, dirs: 0, bytes: 0, currentPath: '' };
    const disks = st.disks.map((d) => ({ ...d, unscannedBytes: diskUnscanned(d) }));
    let unscanned = 0;
    for (const d of disks) unscanned += d.unscannedBytes;
    return {
      platform,
      labels: sys.labels,
      fullDiskAccess: rawPlatform === 'darwin' ? st.fda : 'unknown',
      disks,
      roots: m ? [...m.rootInfo.values()].map((r) => ({ id: r.id, kind: r.kind, label: r.label, path: r.path, diskId: r.diskId })) : [],
      places: st.places,
      scan: {
        status: scan.status,
        phase: scan.phase,
        diskIds: scan.diskIds,
        paths: scan.paths || [],
        startedAt: scan.startedAt,
        finishedAt: scan.finishedAt,
        progress: { files: s.files || 0, dirs: s.dirs || 0, bytes: s.bytes || 0, filesPerSec: scan.status === 'running' ? Math.round(st.rate) : 0, currentPath: scan.status === 'running' ? s.currentPath || '' : '' },
        error: scan.error,
      },
      lastScanAt: m && (scan.status === 'done' || scan.status === 'cancelled') ? scan.finishedAt : null,
      selection: selSummary(),
      unscanned: { bytes: unscanned, deniedDirCount: m ? m.denied.count : 0 },
      stats: cleanStats.json(),
      lastScope: lastScope.json(),
    };
  }
  /** 扫描中每秒最多推 4 次。 */
  function pushState() {
    if (st.disposed || !hub.size) return;
    const wait = 250 - (clock.now() - lastStatePush);
    if (wait <= 0) {
      lastStatePush = clock.now();
      hub.broadcast('state', stateJSON());
    } else if (!statePushTimer) {
      statePushTimer = setTimeout(() => {
        if (statePushTimer) timers.delete(statePushTimer);
        statePushTimer = null;
        pushState();
      }, wait);
      timers.add(statePushTimer);
    }
  }
  function startTicker() {
    let lastFiles = 0;
    let lastAt = clock.now();
    const t = setInterval(() => {
      const s = st.stats;
      if (!s) return;
      const now = clock.now();
      const dt = (now - lastAt) / 1000;
      if (dt > 0) {
        const inst = (s.files - lastFiles) / dt;
        st.rate = st.rate ? st.rate * 0.7 + inst * 0.3 : inst;
      }
      lastFiles = s.files;
      lastAt = now;
      pushState();
    }, 250);
    return () => clearInterval(t);
  }
  function busy() {
    return !!st.task;
  }
  function assertIdle() {
    if (busy()) throw new HttpError(409, 'scan_running', '正在扫描，请等扫描结束或先取消');
    if (st.cleaning) throw new HttpError(409, 'clean_running', '正在清理，请稍候');
  }

  // ---------------------------------------------------------------- 扫描、代码仓库、已选清单接口、清理（见 app-scan.mjs、app-repos.mjs、app-selection.mjs、app-clean.mjs）

  function pushStateNow() {
    lastStatePush = 0;
    pushState();
  }
  const isIgnored = (/** @type {string} */ key) => ignore.has(key);
  const broadcastResults = (/** @type {string[]} */ kinds) => hub.broadcast('results', { kinds });
  const repos = createRepoOps({
    st,
    views,
    pathOps,
    fs,
    exec,
    env,
    platform: rawPlatform,
    logger,
    ensureLoaded,
    selChanged,
    selSummary,
    isIgnored,
    broadcastResults,
    saveScan,
    gitPath: deps.gitPath,
  });
  const { getSelection, updateSelection, keepNewest } = createSelectionOps({ st, views, pathOps, logger, ensureLoaded, selEntities, selSummary, selChanged, isIgnored, gateAdd: repos.gateAdd, worktreeKeys: repos.worktreeKeys });
  const { startScan, cancelScan, startRescan } = createScanOps({
    st,
    engine,
    views,
    fs,
    pathOps,
    home,
    platform,
    sys,
    hub,
    logger,
    clock,
    lastScope,
    allKinds: ALL_KINDS,
    phaseKinds: PHASE_KINDS,
    ensureLoaded,
    assertIdle,
    refreshDisks,
    selChanged,
    applyDefaults,
    saveScan,
    pushState,
    pushStateNow,
    startTicker,
  });
  const { startClean, getClean } = createCleanOps({
    st,
    views,
    pathOps,
    fs,
    remove,
    logger,
    clock,
    hub,
    allKinds: ALL_KINDS,
    ensureLoaded,
    assertIdle,
    refreshDisks,
    saveHistory,
    saveScan,
    selChanged,
    pushStateNow,
    onRemoved: (p) => repos.onRemoved(p),
    onJobDone: (r) => {
      void cleanStats.record(r);
      logger.info('clean.stats', { okCount: r.okCount, failedCount: r.failedCount, freedBytes: r.freedBytes });
    },
  });
  const v3 = createV3Ops({
    st,
    views,
    ignore,
    fs,
    pathOps,
    home,
    platform: rawPlatform,
    logger,
    ensureLoaded,
    refreshDisks,
    selChanged,
    broadcastResults,
    pickFolder: () => sys.pickFolder(),
    preview: (p) => sys.preview(p),
  });

  // ---------------------------------------------------------------- 其他（见 app-actions.mjs）

  const { askContext, reveal, systemAction } = createItemActions({ views, sys, platform: rawPlatform, logger, ensureLoaded });

  async function dispose() {
    if (st.disposed) return;
    st.disposed = true;
    if (st.scanAbort) st.scanAbort.abort();
    for (const t of timers) clearTimeout(t);
    timers.clear();
    hub.closeAll();
    exec.killAll();
    const settle = (/** @type {Promise<any> | null} */ p, /** @type {number} */ ms) =>
      p ? Promise.race([p.catch(() => undefined), new Promise((r) => setTimeout(r, ms).unref?.())]) : Promise.resolve();
    await settle(st.task, 3000);
    await settle(store.flush(), 3000);
  }

  return {
    pathOps,
    platform,
    ensureLoaded,
    refreshDisks,
    refreshFda,
    refreshPlaces,
    stateJSON,
    hub,
    views,
    startScan,
    cancelScan,
    startRescan,
    getSelection,
    updateSelection,
    keepNewest,
    startClean,
    getClean,
    askContext,
    reveal,
    systemAction,
    ...v3,
    reposJSON: repos.reposJSON,
    worktreesJSON: repos.worktreesJSON,
    checkRepoStatus: repos.checkStatus,
    selectRepoDeps: repos.selectDeps,
    repoStaleJSON: repos.staleJSON,
    pruneRepo: repos.prune,
    history: () => ({ entries: st.history.slice(0, 500) }),
    getModel: () => st.model,
    isBusy: () => busy() || !!st.cleaning,
    waitIdle: async () => {
      while (st.task || st.cleaning) await new Promise((r) => setTimeout(r, 50));
    },
    flush: () => store.flush(),
    dispose,
  };
}
