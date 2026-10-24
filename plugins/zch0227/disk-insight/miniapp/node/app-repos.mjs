// @ts-check
// 代码仓库接口：仓库列表、worktree 列表、状态检查（git status）、勾选前确认、勾选依赖、失效 worktree 和 prune。
// git 一律走 exec.execFile，参数数组，带超时；不写锁文件、不弹认证提示。
import { computeRepos, forgetRemoved, gitDirOf, listStale, mapLimit, parseStatus } from './repos.mjs';
import { HttpError, getEnv } from './util.mjs';

const STATUS_TIMEOUT_MS = 10000;
const PRUNE_TIMEOUT_MS = 30000;
const GIT_SLOTS = 4;
const NOT_SAFE = '有未提交的改动或未推送的提交，先提交或推送再清理';
/** @type {Record<string, string>} */
const LOCK_TEXT = {
  dirty: NOT_SAFE,
  ahead: NOT_SAFE,
  'dirty-ahead': NOT_SAFE,
  unchecked: '还没检查状态',
  checking: '还没检查状态',
  error: '状态检查失败，无法确认是否安全',
  'no-git': '没有找到 git，无法确认是否安全',
};
const SORTS = ['size', 'worktrees', 'activity'];

/**
 * @typedef {{ status: string, changedCount: number, aheadCount: number, branch: string | null }} WtStatus
 */

/**
 * @param {{
 *   st: any,
 *   views: ReturnType<typeof import('./views.mjs').createViews>,
 *   pathOps: import('./util.mjs').PathOps,
 *   fs: any,
 *   exec: import('./exec.mjs').Runner,
 *   env: Record<string, string | undefined>,
 *   platform: string,
 *   logger: import('./miniapp-api.js').MiniAppLogger,
 *   ensureLoaded: () => Promise<void>,
 *   selChanged: () => void,
 *   selSummary: () => { count: number, bytes: number },
 *   isIgnored: (key: string) => boolean,
 *   broadcastResults: (kinds: string[]) => void,
 *   saveScan: () => void,
 *   gitPath?: () => Promise<string | null>,
 * }} o
 */
export function createRepoOps(o) {
  const { st, views, pathOps, fs, exec, env, logger } = o;
  const gitEnv = { ...env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' };

  /** 状态缓存跟着扫描结果走：换成新的扫描结果就清空。 */
  let cache = newCache(null);
  /** @param {any} model */
  function newCache(model) {
    return { model, /** @type {Map<string, WtStatus>} */ status: new Map(), /** @type {Map<string, Promise<WtStatus>>} */ inflight: new Map(), /** @type {Set<string>} */ checking: new Set() };
  }
  function cur() {
    if (cache.model !== st.model) cache = newCache(st.model);
    return cache;
  }

  /** @type {{ model: any, version: number, value: ReturnType<typeof computeRepos> }} */
  let viewCache = { model: null, version: -1, value: [] };
  function view() {
    const m = st.model;
    if (!m) return [];
    if (viewCache.model !== m || viewCache.version !== m.version) viewCache = { model: m, version: m.version, value: computeRepos(m, pathOps) };
    return viewCache.value;
  }

  // ---------------------------------------------------------------- git

  /** @type {Promise<string | null> | null} */
  let gitFound = null;
  function gitPath() {
    if (o.gitPath) return o.gitPath();
    if (!gitFound) gitFound = findGit();
    return gitFound;
  }
  /** macOS 上没装命令行工具时运行 /usr/bin/git 会弹出安装窗口，先确认开发者目录存在。其他系统交给 PATH。 */
  async function findGit() {
    if (o.platform !== 'darwin') return 'git';
    const dirs = [...String(getEnv(env, 'PATH') || '').split(':'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
    for (const d of dirs) {
      if (!d || !d.startsWith('/')) continue;
      const p = pathOps.join(d, 'git');
      const isFile = await fs.stat(p).then(
        (/** @type {any} */ s) => s.isFile(),
        () => false,
      );
      if (!isFile) continue;
      if (p === '/usr/bin/git') {
        const r = await exec.execFile('/usr/bin/xcode-select', ['-p'], { timeoutMs: 5000, code: 'xcode-select' });
        const dev = r.ok ? r.stdout.trim() : '';
        const ok = !!dev && (await fs.stat(dev).then(
          () => true,
          () => false,
        ));
        if (!ok) continue;
      }
      return p;
    }
    return null;
  }
  /** @param {{ error: string | null, stderr: string }} r */
  const isNoGit = (r) => r.error === 'ENOENT' || /xcrun: error|invalid active developer path|CommandLineTools/i.test(r.stderr || '');

  let running = 0;
  /** @type {(() => void)[]} */
  const waiters = [];
  /** 同时最多 4 个 git 进程。 @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
  async function withSlot(fn) {
    while (running >= GIT_SLOTS) await new Promise((r) => waiters.push(() => r(undefined)));
    running += 1;
    try {
      return await fn();
    } finally {
      running -= 1;
      const w = waiters.shift();
      if (w) w();
    }
  }

  /** 检查一个 worktree。同一个正在检查时复用。 @param {string} path @returns {Promise<WtStatus>} */
  function checkOne(path) {
    const c = cur();
    const key = pathOps.key(path);
    const inflight = c.inflight.get(key);
    if (inflight) return inflight;
    const prev = c.status.get(key);
    c.status.set(key, { status: 'checking', changedCount: 0, aheadCount: 0, branch: prev ? prev.branch : null });
    const p = (async () => {
      /** @type {WtStatus} */
      let res;
      const git = await gitPath();
      if (!git) res = { status: 'no-git', changedCount: 0, aheadCount: 0, branch: null };
      else {
        const r = await withSlot(() =>
          // 服务已经停止时不再启动新的 git 进程。
          st.disposed
            ? Promise.resolve({ ok: false, exitCode: null, error: 'disposed', stdout: '', stderr: '' })
            : exec.execFile(git, ['-C', path, 'status', '--porcelain=v1', '--branch'], { timeoutMs: STATUS_TIMEOUT_MS, maxBytes: 16 * 1024 * 1024, env: gitEnv, code: 'git-status' }),
        );
        res = r.ok ? parseStatus(r.stdout) : { status: isNoGit(r) ? 'no-git' : 'error', changedCount: 0, aheadCount: 0, branch: null };
      }
      c.status.set(key, res);
      return res;
    })().finally(() => c.inflight.delete(key));
    c.inflight.set(key, p);
    return p;
  }

  // ---------------------------------------------------------------- 视图

  /** @param {any} id */
  function repoById(id) {
    if (typeof id !== 'string' || !id) throw new HttpError(400, 'bad_request', '缺少仓库编号');
    const m = st.model;
    const r = m && m.repos.status === 'ready' ? m.repos.list.find((/** @type {any} */ x) => x.id === id) : null;
    if (!r) throw new HttpError(404, 'not_found', '找不到这个仓库，请重新扫描');
    return r;
  }

  /** @param {ReturnType<typeof computeRepos>[number]} r */
  function repoJSON(r) {
    const { rec, main } = r;
    const mainEntity = main ? views.resolvePath(main.path) : null;
    return {
      id: rec.id,
      name: rec.name,
      path: rec.path,
      mainInScope: !!main,
      sizeBytes: r.sizeBytes,
      releasableBytes: r.releasableBytes,
      main: main ? { entityId: mainEntity ? mainEntity.id : null, sizeBytes: main.du, releasableBytes: main.rel, gitBytes: main.git, depsBytes: main.deps } : null,
      gitDirOutside: !!(main && rec.gitOutside),
      worktreeCount: r.wts.length,
      worktreeBytes: r.worktreeBytes,
      worktreeReleasableBytes: r.worktreeReleasableBytes,
      depsBytes: r.depsBytes,
      lastActivityMs: main ? rec.lastActivityMs : null,
      staleCount: main ? rec.staleCount : null,
    };
  }

  /** @param {URLSearchParams} params */
  async function reposJSON(params) {
    await o.ensureLoaded();
    const sort = params.get('sort') || 'size';
    if (!SORTS.includes(sort)) throw new HttpError(400, 'bad_request', '排序参数只能是 size、worktrees、activity');
    const q = (params.get('q') || '').trim().toLowerCase();
    const m = st.model;
    const all = view();
    const breakdown = { mainSourceBytes: 0, gitBytes: 0, worktreeSourceBytes: 0, depsBytes: 0 };
    const summary = { repoCount: all.length, worktreeCount: 0, sizeBytes: 0, releasableBytes: 0, breakdown };
    // 合计和四项分项用占用口径（克隆和硬链接只算一次），保证不超过磁盘真实占用；四项加起来等于 sizeBytes。
    // 每个仓库的 sizeBytes、main.*、worktree 大小和排序仍是 du 口径，和 du 对得上、不受扫描顺序影响（见 computeRepos）。
    // releasableBytes 照旧累加：它本来就不把克隆和硬链接重复计入。
    for (const r of all) {
      summary.worktreeCount += r.wts.length;
      summary.sizeBytes += r.occSizeBytes;
      summary.releasableBytes += r.releasableBytes;
      breakdown.depsBytes += r.occDepsBytes;
      if (r.main) {
        breakdown.gitBytes += r.main.occGit;
        breakdown.mainSourceBytes += Math.max(0, r.main.occ - r.main.occGit - r.main.occDeps);
      }
      for (const w of r.wts) breakdown.worktreeSourceBytes += Math.max(0, w.occ - w.occDeps);
    }
    const list = q ? all.filter((r) => r.rec.name.toLowerCase().includes(q) || r.rec.path.toLowerCase().includes(q)) : all.slice();
    const bySize = (/** @type {any} */ a, /** @type {any} */ b) => b.sizeBytes - a.sizeBytes;
    if (sort === 'size') list.sort(bySize);
    else if (sort === 'worktrees') list.sort((a, b) => b.wts.length - a.wts.length || bySize(a, b));
    else list.sort((a, b) => (b.main ? b.rec.lastActivityMs || 0 : -1) - (a.main ? a.rec.lastActivityMs || 0 : -1) || bySize(a, b));
    return { status: m ? m.repos.status : 'pending', summary, repos: list.map(repoJSON) };
  }

  /** @param {any} id */
  async function worktreesJSON(id) {
    await o.ensureLoaded();
    const rec = repoById(id);
    const r = view().find((x) => x.rec === rec);
    const c = cur();
    const wts = r ? r.wts.slice().sort((a, b) => b.du - a.du) : [];
    return {
      worktrees: wts.map((w) => {
        const s = c.status.get(w.key);
        const status = s ? s.status : 'unchecked';
        const e = views.resolvePath(w.path);
        let lockReason = status === 'clean' ? null : LOCK_TEXT[status] || LOCK_TEXT.error;
        if (!lockReason && e) lockReason = views.lockFor(e);
        return {
          id: e ? e.id : null,
          name: w.rec.name,
          path: w.path,
          branch: w.rec.branch || (s && s.branch) || null,
          sizeBytes: w.du,
          releasableBytes: w.rel,
          depsBytes: w.deps,
          mtimeMs: w.node ? w.node.maxMtime : w.rec.mtime,
          status,
          changedCount: s ? s.changedCount : 0,
          aheadCount: s ? s.aheadCount : 0,
          locked: !!lockReason,
          lockReason: lockReason || null,
          selected: st.sel.entries.has(w.key),
        };
      }),
    };
  }

  // ---------------------------------------------------------------- 操作

  /**
   * force 为 false（默认）时只检查 unchecked 和 error 的 worktree，为 true 时全部重新检查。
   * 每完成一批（4 个）推送一次 results。这个仓库已经在检查时直接返回。
   * @param {any} body
   */
  async function checkStatus(body) {
    await o.ensureLoaded();
    if (body.force !== undefined && typeof body.force !== 'boolean') throw new HttpError(400, 'bad_request', 'force 只能是 true 或 false');
    const rec = repoById(body.id);
    const c = cur();
    if (c.checking.has(rec.id)) return;
    const force = body.force === true;
    const paths = rec.worktrees
      .map((/** @type {any} */ w) => w.path)
      .filter((/** @type {string} */ p) => {
        if (force) return true;
        const s = c.status.get(pathOps.key(p));
        return !s || s.status === 'unchecked' || s.status === 'error';
      });
    if (!paths.length) return;
    c.checking.add(rec.id);
    for (const p of paths) {
      const k = pathOps.key(p);
      if (!c.inflight.has(k)) c.status.set(k, { status: 'checking', changedCount: 0, aheadCount: 0, branch: (c.status.get(k) || { branch: null }).branch });
    }
    o.broadcastResults(['repos']);
    const t0 = Date.now();
    void (async () => {
      let done = 0;
      /** @type {Record<string, number>} */
      const tally = {};
      try {
        await mapLimit(paths, GIT_SLOTS, async (p) => {
          const res = await checkOne(p);
          tally[res.status] = (tally[res.status] || 0) + 1;
          done += 1;
          if (done % GIT_SLOTS === 0 && done < paths.length && !st.disposed) o.broadcastResults(['repos']);
        });
      } catch (e) {
        logger.warn('repos.status.failed', { code: /** @type {any} */ (e).code || 'error' });
      } finally {
        c.checking.delete(rec.id);
        logger.info('repos.status.checked', { count: done, clean: tally.clean || 0, dirty: (tally.dirty || 0) + (tally['dirty-ahead'] || 0), ahead: tally.ahead || 0, error: tally.error || 0, noGit: tally['no-git'] || 0, ms: Date.now() - t0 });
        if (!st.disposed) o.broadcastResults(['repos']);
      }
    })();
  }

  /**
   * 勾选前确认：范围内的 worktree 必须是 clean；还没检查的当场检查（10 秒超时）。返回跳过原因或 null。
   * @param {{ key: string, path: string }} e
   */
  async function gateAdd(e) {
    const m = st.model;
    if (!m || m.repos.status !== 'ready') return null;
    const isWt = m.repos.list.some((/** @type {any} */ r) => r.worktrees.some((/** @type {any} */ w) => pathOps.key(w.path) === e.key));
    if (!isWt) return null;
    const c = cur();
    let s = c.status.get(e.key);
    const inflight = c.inflight.get(e.key);
    if (inflight) s = await inflight;
    else if (!s || s.status === 'unchecked' || s.status === 'checking') s = await checkOne(e.path);
    return s.status === 'clean' ? null : 'worktree_not_clean';
  }

  /** 这个仓库和它在范围内的 worktree 里的依赖和构建产物都加入已选清单，锁定和忽略的跳过。 @param {any} body */
  async function selectDeps(body) {
    await o.ensureLoaded();
    const rec = repoById(body.id);
    const r = view().find((x) => x.rec === rec);
    let locked = 0;
    let added = 0;
    for (const c of r ? [r.main, ...r.wts] : []) {
      if (!c) continue;
      for (const it of c.depItems) {
        if (o.isIgnored(it.key)) continue;
        if (views.lockFor(views.entityFromItem(it))) {
          locked += 1;
          continue;
        }
        st.sel.entries.set(it.key, { id: it.id, path: it.path });
        st.sel.deselected.delete(it.key);
        added += 1;
      }
    }
    logger.info('repos.select_deps', { count: added, locked });
    o.selChanged();
    return o.selSummary();
  }

  /** @param {any} rec */
  function assertMain(rec) {
    if (!rec.mainInScope) throw new HttpError(400, 'main_not_in_scope', '主仓库不在扫描范围里');
  }

  /** @param {any} id */
  async function staleJSON(id) {
    await o.ensureLoaded();
    const rec = repoById(id);
    assertMain(rec);
    const records = await listStale(fs, pathOps, gitDirOf(pathOps, rec));
    if (rec.staleCount !== records.length) {
      rec.staleCount = records.length;
      st.model.touch();
    }
    return { records };
  }

  /** git worktree prune：只删除目录已经不存在的 worktree 记录。 @param {any} body */
  async function prune(body) {
    await o.ensureLoaded();
    const rec = repoById(body.id);
    assertMain(rec);
    const git = await gitPath();
    if (!git) throw new HttpError(501, 'no_git', '没有找到 git');
    const model = st.model;
    const before = await listStale(fs, pathOps, gitDirOf(pathOps, rec));
    const r = await exec.execFile(git, ['-C', rec.path, 'worktree', 'prune'], { timeoutMs: PRUNE_TIMEOUT_MS, env: gitEnv, code: 'git-prune' });
    if (!r.ok) {
      if (isNoGit(r)) throw new HttpError(501, 'no_git', '没有找到 git');
      logger.warn('repos.prune.failed', { code: r.error || `exit_${r.exitCode}` });
      throw new HttpError(500, 'prune_failed', '清理失效 worktree 失败');
    }
    const after = await listStale(fs, pathOps, gitDirOf(pathOps, rec));
    rec.staleCount = after.length;
    model.touch();
    o.saveScan();
    const removed = Math.max(0, before.length - after.length);
    logger.info('repos.prune.done', { removed, remaining: after.length });
    o.broadcastResults(['repos']);
    return { removed, remaining: after.length };
  }

  /** 范围内全部 worktree 的路径 key（已选清单判断来源用）。 */
  function worktreeKeys() {
    const m = st.model;
    const keys = new Set();
    if (m && m.repos.status === 'ready') for (const r of m.repos.list) for (const w of r.worktrees) keys.add(pathOps.key(w.path));
    return keys;
  }

  /** 清理成功后调用：去掉被移走的 worktree。 @param {string} path */
  function onRemoved(path) {
    const m = st.model;
    if (m && m.repos.list.length && forgetRemoved(m, pathOps, path)) m.touch();
  }

  return { reposJSON, worktreesJSON, checkStatus, gateAdd, selectDeps, staleJSON, prune, onRemoved, worktreeKeys };
}
