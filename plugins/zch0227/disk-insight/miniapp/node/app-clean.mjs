// @ts-check
// 清理任务编排：校验已选清单 → 只处理最外层 → 逐项复查并直接永久删除（不经过废纸篓或回收站）→ 更新结果、清理记录并推送。
// 从 app.mjs 拆出，依赖由 app 注入。
import { runCleanEntries } from './cleaner.mjs';
import { diskOf } from './protect.mjs';
import { outermost } from './selection.mjs';
import { HttpError } from './util.mjs';

/**
 * @param {{
 *   st: any,
 *   views: ReturnType<typeof import('./views.mjs').createViews>,
 *   pathOps: import('./util.mjs').PathOps,
 *   fs: any,
 *   remove: (p: string, id?: string) => Promise<{ ok: boolean, error?: string | null, errno?: string | null }>,
 *   logger: import('./miniapp-api.js').MiniAppLogger,
 *   clock: { now(): number },
 *   hub: ReturnType<typeof import('./http.mjs').createSseHub>,
 *   allKinds: string[],
 *   ensureLoaded: () => Promise<void>,
 *   assertIdle: () => void,
 *   refreshDisks: (force?: boolean) => Promise<any[]>,
 *   saveHistory: () => void,
 *   saveScan: () => void,
 *   selChanged: () => void,
 *   pushStateNow: () => void,
 *   onRemoved?: (path: string) => void,
 *   onJobDone: (r: { freedBytes: number, okCount: number, failedCount: number }) => void,
 * }} o
 */
export function createCleanOps(o) {
  const { st, views, pathOps, fs, logger, clock, hub } = o;

  /** @param {any} job */
  function cleanProgress(job) {
    return { jobId: job.jobId, done: job.done, total: job.total, freedBytes: job.freedBytes, failed: job.failed, finished: job.finished };
  }

  /** @param {any} body */
  async function startClean(body) {
    await o.ensureLoaded();
    o.assertIdle();
    const ids = body.itemIds;
    if (!Array.isArray(ids) || !ids.length || ids.some((x) => typeof x !== 'string')) throw new HttpError(400, 'not_selected', '请先勾选要清理的条目');
    /** @type {Map<string, any>} */
    const byKey = new Map();
    for (const id of ids) {
      const e = views.resolve(id);
      if (!e || !st.sel.entries.has(e.key)) throw new HttpError(400, 'not_selected', '要清理的条目必须在已选清单里');
      byKey.set(e.key, e);
    }
    const disks = await o.refreshDisks(true);
    const { outer, inner } = outermost([...byKey.values()], pathOps);
    st.jobSeq += 1;
    const job = { jobId: `c_${st.jobSeq}`, total: outer.length, done: 0, freedBytes: 0, failed: 0, finished: false, /** @type {any[]} */ results: [] };
    st.jobs.set(job.jobId, job);
    if (st.jobs.size > 20) st.jobs.delete(/** @type {string} */ (st.jobs.keys().next().value));
    st.cleaning = job;
    logger.info('clean.started', { count: outer.length, nested: inner.length });
    void runClean(job, outer, inner, disks);
    return { jobId: job.jobId };
  }

  /** @param {any} job @param {any[]} outer @param {{ entry: any, outer: any }[]} inner @param {any[]} disks */
  async function runClean(job, outer, inner, disks) {
    let okCount = 0;
    const t0 = clock.now();
    try {
      const entries = outer.map((e) => {
        const d = diskOf(e.path, disks, pathOps);
        return { id: e.id, path: e.path, dev: e.dev, ino: e.ino, mtimeMs: e.mtimeMs, releasableBytes: e.releasableBytes, lockReason: views.lockFor(e), deletable: !!(d && d.deletable) };
      });
      const results = await runCleanEntries({
        entries,
        fs,
        pathOps,
        remove: o.remove,
        logger,
        onProgress: (chunk) => {
          for (const r of chunk) {
            job.done += 1;
            if (r.ok) job.freedBytes += r.bytes;
            else job.failed += 1;
          }
          job.results.push(...chunk);
          hub.broadcast('clean', cleanProgress(job));
        },
      });
      const byId = new Map(outer.map((e) => [e.id, e]));
      const at = clock.now();
      const resultById = new Map(results.map((r) => [r.id, r]));
      for (const r of results) {
        const e = byId.get(r.id);
        // method: 'delete' 表示直接永久删除。旧记录没有 method 字段，读取时原样返回，由页面按「已移到废纸篓」显示。
        st.history.unshift({ at, path: r.path, bytes: r.ok ? r.bytes : 0, ok: r.ok, error: r.error, method: 'delete' });
        if (r.ok && e && st.model) {
          okCount += 1;
          st.model.removePath(e.path, e.sizeBytes, e.releasableBytes, e.dev, e.duBytes);
          o.onRemoved?.(e.path);
          for (const k of [...st.sel.entries.keys()]) if (k === e.key || pathOps.inside(k, e.key)) st.sel.entries.delete(k);
        }
      }
      for (const { entry, outer: oe } of inner) {
        const r = resultById.get(oe.id);
        job.results.push({ id: entry.id, path: entry.path, ok: !!(r && r.ok), bytes: 0, error: r ? r.error : 'delete_failed' });
      }
      if (st.history.length > 500) st.history.length = 500;
      o.saveHistory();
      o.saveScan();
      // 整批汇总：失败数含复查没通过的；freedBytes 就是真正释放的空间（直接删除，不经过废纸篓）。
      logger.info('clean.done', { ok: okCount, failed: job.failed, freedBytes: job.freedBytes, ms: clock.now() - t0 });
    } catch (e) {
      logger.error('clean.failed', { code: /** @type {any} */ (e).code || 'error' });
    } finally {
      job.finished = true;
      st.cleaning = null;
      o.onJobDone({ freedBytes: job.freedBytes, okCount, failedCount: job.failed });
      hub.broadcast('clean', cleanProgress(job));
      o.selChanged();
      hub.broadcast('results', { kinds: o.allKinds });
      await o.refreshDisks(true);
      o.pushStateNow();
    }
  }

  /** @param {string | null} jobId */
  function getClean(jobId) {
    const job = jobId ? st.jobs.get(jobId) : null;
    if (!job) throw new HttpError(404, 'not_found', '没有这个清理任务');
    return { jobId: job.jobId, finished: job.finished, freedBytes: job.freedBytes, results: job.results };
  }

  return { startClean, getClean };
}
