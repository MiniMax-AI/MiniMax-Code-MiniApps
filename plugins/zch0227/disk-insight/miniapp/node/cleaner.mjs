// @ts-check
// 清理：执行前逐项复查，再直接永久删除（不经过废纸篓或回收站；清理由用户勾选确认后才执行）。

/**
 * 五项复查，返回契约里的错误码；全部通过返回 null。
 * 1 路径存在；2 不是链接，dev/ino/mtimeMs 与扫描时一致；3 realpath 等于记录的路径；4 没有锁定；5 磁盘允许删除。
 * @param {{ path: string, dev: number, ino: number, mtimeMs: number }} entry
 * @param {{ fs: any, pathOps: import('./util.mjs').PathOps, lockReason: string | null, deletable: boolean }} o
 */
export async function precheck(entry, o) {
  const { fs, pathOps } = o;
  let st;
  try {
    st = await fs.lstat(entry.path);
  } catch (e) {
    const code = /** @type {any} */ (e).code;
    if (code === 'EACCES' || code === 'EPERM') return 'permission_denied';
    return 'missing';
  }
  if (st.isSymbolicLink()) return 'symlink';
  if (st.dev !== entry.dev || st.ino !== entry.ino || st.mtimeMs !== entry.mtimeMs) return 'changed';
  let real;
  try {
    real = await fs.realpath(entry.path);
  } catch {
    return 'changed';
  }
  if (!pathOps.same(real, entry.path)) return 'symlink';
  if (o.lockReason) return 'protected';
  if (!o.deletable) return 'not_deletable_volume';
  return null;
}

/** 契约里的删除错误码（字符串）。 */
const DELETE_ERRORS = ['missing', 'in_use', 'permission_denied', 'delete_failed'];

/** 删除执行器返回的错误统一成契约取值，不认识的一律 delete_failed。 @param {any} code */
export function normalizeDeleteError(code) {
  return DELETE_ERRORS.includes(code) ? code : 'delete_failed';
}

/** 系统错误码 → 契约错误码。 @param {string | null | undefined} errno */
export function deleteErrorCode(errno) {
  if (errno === 'ENOENT') return 'missing';
  if (errno === 'EACCES' || errno === 'EPERM') return 'permission_denied';
  if (errno === 'EBUSY') return 'in_use';
  return 'delete_failed';
}

/** @param {any} fs @param {string} p */
async function gone(fs, p) {
  try {
    await fs.lstat(p);
    return false;
  } catch (e) {
    return /** @type {any} */ (e).code === 'ENOENT';
  }
}

/**
 * 删除执行器：直接永久删除一个文件或目录，macOS 和 Windows 共用。
 * fs.rm 不跟随符号链接：路径本身是链接时只删链接；目录里指向外部的链接也只删链接本身，链接指向的文件和目录不受影响。
 * （复查已经拒绝了本身是链接、或上级目录经过链接的条目，这里是第二道保证。）
 * 约定：目录删到一半失败时，删除后路径已经不存在就算成功；路径还在就按错误码映射返回失败，
 * 这时可能已经删掉了一部分，释放大小记 0（页面会提示可能已删掉一部分），不另加字段。
 * 日志不含用户路径，只记条目 id；每项的路径和结果写在清理记录里，按 id 能查到。
 * @param {{ fs: any, logger: { info(m: string, f?: any): void, warn(m: string, f?: any): void } }} o
 * @returns {(p: string, id?: string) => Promise<{ ok: boolean, error: string | null, errno: string | null }>}
 */
export function createRemover(o) {
  const { fs, logger } = o;
  return async (p, id) => {
    try {
      await fs.rm(p, { recursive: true, force: false, maxRetries: 2 });
      return { ok: true, error: null, errno: null };
    } catch (e) {
      const errno = /** @type {any} */ (e).code || null;
      // ENOENT 说明路径在复查之后、删除之前就没了（不是我们删的），按 missing 报，不计入释放大小。
      // 其他错误：报错后路径已经不存在（比如删到一半报错，但重试或别的进程把剩下的也删了），要删的内容都没了，算成功。
      if (errno !== 'ENOENT' && (await gone(fs, p))) {
        logger.info('clean.delete.gone_after_error', { id, errno });
        return { ok: true, error: null, errno };
      }
      const error = deleteErrorCode(errno);
      logger.warn('clean.delete.error', { id, errno, error });
      return { ok: false, error, errno };
    }
  };
}

/**
 * 跑一次清理任务。entries 已经是去掉内层后的最外层条目。
 * 逐项串行：每一项先复查、通过了马上删除，再处理下一项。一项可能是上百万个文件的 node_modules，要几十秒；
 * 每处理完一项（跳过或删除）推送一次进度，两项之间检查取消。
 * @param {{
 *   entries: { id: string, path: string, dev: number, ino: number, mtimeMs: number, releasableBytes: number, lockReason: string | null, deletable: boolean }[],
 *   fs: any,
 *   pathOps: import('./util.mjs').PathOps,
 *   remove: (p: string, id?: string) => Promise<{ ok: boolean, error?: string | null, errno?: string | null }>,
 *   onProgress: (r: { id: string, path: string, ok: boolean, bytes: number, error: string | null }[]) => void,
 *   logger: { info(m: string, f?: any): void, warn(m: string, f?: any): void },
 *   signal?: AbortSignal,
 * }} o
 */
export async function runCleanEntries(o) {
  const { entries, fs, pathOps, remove, logger } = o;
  /** @type {{ id: string, path: string, ok: boolean, bytes: number, error: string | null }[]} */
  const results = [];
  for (let i = 0; i < entries.length; i += 1) {
    if (o.signal && o.signal.aborted) {
      // 取消：没轮到的条目一个都不删，按失败返回。
      const rest = entries.slice(i).map((e) => ({ id: e.id, path: e.path, ok: false, bytes: 0, error: 'delete_failed' }));
      results.push(...rest);
      o.onProgress(rest);
      break;
    }
    const e = entries[i];
    // 每一项在删除前立即单独复查，通过了马上删：删除不可恢复，复查要尽量贴近删除的那一刻。
    // 不能先把全部条目复查一遍再逐项删——前面的大目录可能要删几十秒，排在后面的条目复查结果早就过时了。
    const code = await precheck(e, { fs, pathOps, lockReason: e.lockReason, deletable: e.deletable });
    if (code) {
      logger.warn('clean.item.skipped', { code });
      const item = { id: e.id, path: e.path, ok: false, bytes: 0, error: code };
      results.push(item);
      o.onProgress([item]);
      continue;
    }
    const t0 = Date.now();
    /** @type {{ ok: boolean, error?: string | null, errno?: string | null }} */
    let r;
    try {
      r = await remove(e.path, e.id);
    } catch (err) {
      // 执行器本身抛错（正常的执行器不会抛，失败都在返回值里）：按删除失败处理。
      const errno = /** @type {any} */ (err).code || null;
      logger.warn('clean.delete.threw', { id: e.id, errno });
      r = { ok: false, error: deleteErrorCode(errno), errno };
    }
    const error = r.ok ? null : normalizeDeleteError(r.error);
    // 日志不含用户路径，只记条目 id（路径和结果在清理记录里）。
    logger.info('clean.delete', { id: e.id, ok: r.ok, error, errno: r.errno || null, ms: Date.now() - t0 });
    // 失败时释放大小记 0：目录可能已经删掉了一部分，但没法准确知道删了多少。
    const item = { id: e.id, path: e.path, ok: r.ok, bytes: r.ok ? e.releasableBytes || 0 : 0, error };
    results.push(item);
    o.onProgress([item]);
  }
  return results;
}
