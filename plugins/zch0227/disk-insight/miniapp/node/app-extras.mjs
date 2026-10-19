// @ts-check
// v3 新增：忽略名单、清理统计、选择文件夹、校验路径、快速预览。依赖由 app 注入。
import { normalizeUserPath, validateFolder } from './scope.mjs';
import { HttpError } from './util.mjs';

const IGNORE_FILE = 'ignore-v1.json';
const STATS_FILE = 'stats-v1.json';
const SCOPE_FILE = 'scope-v1.json';

/**
 * 忽略名单：持久保存在 dataDir，带版本号。被忽略的路径和它里面的条目不出现在清理建议、大文件、重复文件里。
 * @param {{ store: ReturnType<typeof import('./store.mjs').createStore>, pathOps: import('./util.mjs').PathOps, clock: { now(): number } }} o
 */
export function createIgnoreList(o) {
  const { store, pathOps, clock } = o;
  /** @type {{ seq: number, entries: { id: string, path: string, key: string, at: number }[] }} */
  let data = { seq: 0, entries: [] };
  let version = 0;
  const save = () => store.writeJSON(IGNORE_FILE, () => ({ version: 1, seq: data.seq, entries: data.entries }));
  return {
    async load() {
      const d = await store.readJSON(IGNORE_FILE, 1);
      if (d && Array.isArray(d.entries)) {
        data = {
          seq: Number(d.seq) || 0,
          entries: d.entries.filter((/** @type {any} */ e) => e && typeof e.id === 'string' && typeof e.path === 'string').map((/** @type {any} */ e) => ({ id: e.id, path: e.path, key: pathOps.key(e.path), at: Number(e.at) || 0 })),
        };
        version += 1;
      }
    },
    /** 这个路径本身或它的某个祖先在忽略名单里。 @param {string} key */
    has(key) {
      for (const e of data.entries) if (key === e.key || pathOps.inside(key, e.key)) return true;
      return false;
    },
    /** @param {string} path */
    add(path) {
      const key = pathOps.key(path);
      const hit = data.entries.find((e) => e.key === key);
      if (hit) return hit;
      data.seq += 1;
      const entry = { id: `g_${data.seq}`, path, key, at: clock.now() };
      data.entries.unshift(entry);
      version += 1;
      save();
      return entry;
    },
    /** @param {string} id */
    remove(id) {
      const i = data.entries.findIndex((e) => e.id === id);
      if (i < 0) return false;
      data.entries.splice(i, 1);
      version += 1;
      save();
      return true;
    },
    list() {
      return data.entries.map((e) => ({ id: e.id, path: e.path, at: e.at }));
    },
    get size() {
      return data.entries.length;
    },
    get version() {
      return version;
    },
  };
}

/**
 * 清理统计：持久保存，重新扫描不会清零。每次清理任务结束后更新。
 * @param {{ store: ReturnType<typeof import('./store.mjs').createStore>, clock: { now(): number } }} o
 */
export function createCleanStats(o) {
  /** @type {{ last: { at: number, freedBytes: number, okCount: number, failedCount: number } | null, totalFreedBytes: number, cleanCount: number }} */
  let data = { last: null, totalFreedBytes: 0, cleanCount: 0 };
  return {
    async load() {
      const d = await o.store.readJSON(STATS_FILE, 1);
      if (d) data = { last: d.last || null, totalFreedBytes: Number(d.totalFreedBytes) || 0, cleanCount: Number(d.cleanCount) || 0 };
    },
    /** @param {{ freedBytes: number, okCount: number, failedCount: number }} r */
    record(r) {
      data = {
        last: { at: o.clock.now(), freedBytes: r.freedBytes, okCount: r.okCount, failedCount: r.failedCount },
        totalFreedBytes: data.totalFreedBytes + r.freedBytes,
        cleanCount: data.cleanCount + 1,
      };
      return o.store.writeJSON(STATS_FILE, () => ({ version: 1, ...data }));
    },
    json() {
      return { last: data.last ? { ...data.last } : null, totalFreedBytes: data.totalFreedBytes, cleanCount: data.cleanCount };
    },
  };
}

/**
 * 上一次实际开始扫描时的范围（state.lastScope）。持久保存，从来没有扫描过时为 null。
 * @param {{ store: ReturnType<typeof import('./store.mjs').createStore> }} o
 */
export function createLastScope(o) {
  /** @type {{ diskIds: string[], paths: string[] } | null} */
  let data = null;
  return {
    async load() {
      const d = await o.store.readJSON(SCOPE_FILE, 1);
      if (d && d.lastScope && Array.isArray(d.lastScope.diskIds) && Array.isArray(d.lastScope.paths)) {
        data = { diskIds: d.lastScope.diskIds.filter((/** @type {any} */ x) => typeof x === 'string'), paths: d.lastScope.paths.filter((/** @type {any} */ x) => typeof x === 'string') };
      }
    },
    /** @param {{ diskIds: string[], paths: string[] }} scope */
    set(scope) {
      data = { diskIds: scope.diskIds.slice(), paths: scope.paths.slice() };
      return o.store.writeJSON(SCOPE_FILE, () => ({ version: 1, lastScope: data }));
    },
    json() {
      return data ? { diskIds: data.diskIds.slice(), paths: data.paths.slice() } : null;
    },
  };
}

/**
 * @param {{
 *   st: any,
 *   views: ReturnType<typeof import('./views.mjs').createViews>,
 *   ignore: ReturnType<typeof createIgnoreList>,
 *   fs: any,
 *   pathOps: import('./util.mjs').PathOps,
 *   home: string,
 *   platform: string,
 *   logger: import('./miniapp-api.js').MiniAppLogger,
 *   ensureLoaded: () => Promise<void>,
 *   refreshDisks: (force?: boolean) => Promise<any[]>,
 *   selChanged: () => void,
 *   broadcastResults: (kinds: string[]) => void,
 *   pickFolder: () => Promise<{ path?: string, cancelled?: boolean } | null>,
 *   preview: (p: string) => Promise<boolean>,
 * }} o
 */
export function createV3Ops(o) {
  const { st, views, ignore, pathOps, logger } = o;
  let picking = false;

  /** @param {any} body */
  async function addIgnore(body) {
    await o.ensureLoaded();
    const e = views.resolve(body.id);
    if (!e) throw new HttpError(404, 'not_found', '找不到这个条目，请重新扫描');
    if (views.lockFor(e)) throw new HttpError(400, 'not_ignorable', '锁定的条目和只提示的条目不能忽略');
    ignore.add(e.path);
    let removed = 0;
    for (const k of [...st.sel.entries.keys()]) {
      if (k === e.key || pathOps.inside(k, e.key)) {
        st.sel.entries.delete(k);
        removed += 1;
      }
    }
    logger.info('ignore.added', { count: ignore.size, unselected: removed });
    o.selChanged();
    o.broadcastResults(['junk', 'large', 'duplicates']);
    return { ok: true };
  }

  /** @param {any} body */
  async function removeIgnore(body) {
    await o.ensureLoaded();
    if (typeof body.id !== 'string' || !ignore.remove(body.id)) throw new HttpError(404, 'not_found', '忽略名单里没有这一项');
    logger.info('ignore.removed', { count: ignore.size });
    o.broadcastResults(['junk', 'large', 'duplicates']);
    return { ok: true };
  }

  async function listIgnore() {
    await o.ensureLoaded();
    return { entries: ignore.list() };
  }

  /** @param {any} body */
  async function validatePath(body) {
    const disks = await o.refreshDisks();
    return validateFolder(body.path, { fs: o.fs, pathOps, home: o.home, disks });
  }

  async function pickFolder() {
    if (picking) throw new HttpError(409, 'picker_open', '已经打开了一个文件夹选择框');
    picking = true;
    try {
      const r = await o.pickFolder();
      if (!r) {
        logger.warn('picker.unavailable', { code: 'exec' });
        throw new HttpError(501, 'picker_unavailable', '无法打开文件夹选择框，请直接粘贴路径');
      }
      if (r.cancelled || !r.path) return { cancelled: true };
      return { path: normalizeUserPath(r.path, pathOps, o.home) || r.path };
    } finally {
      picking = false;
    }
  }

  /** @param {any} body */
  async function preview(body) {
    if (o.platform !== 'darwin') throw new HttpError(501, 'unsupported', '快速预览只支持 macOS');
    await o.ensureLoaded();
    const e = views.resolve(body.id);
    if (!e) throw new HttpError(404, 'not_found', '找不到这个条目，请重新扫描');
    if (e.kind !== 'file') throw new HttpError(400, 'not_file', '只能预览文件');
    const ok = await o.preview(e.path);
    if (!ok) {
      logger.warn('preview.failed', { code: 'exec' });
      throw new HttpError(500, 'preview_failed', '无法打开快速预览');
    }
    return { ok: true };
  }

  return { addIgnore, removeIgnore, listIgnore, validatePath, pickFolder, preview };
}
