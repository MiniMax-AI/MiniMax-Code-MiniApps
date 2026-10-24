// @ts-check
// 测试辅助：临时夹具只放在 TMP_ROOT 下，清理时只删自己建的目录。
// TMP_ROOT 可以用环境变量 DISK_INSIGHT_TEST_TMP 指定。默认值：Windows 和 Linux 是系统临时目录下的
// disk-insight-test；macOS 是 ~/Library/Caches/disk-insight-test，因为 macOS 的系统临时目录实际在
// /private/var/folders 下，而 /private 在保护名单里，夹具会全部被锁定。
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PKG_ROOT = path.resolve(here, '..');
const DEFAULT_TMP = process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library', 'Caches', 'disk-insight-test')
  : path.join(os.tmpdir(), 'disk-insight-test');
export const TMP_ROOT = path.resolve(process.env.DISK_INSIGHT_TEST_TMP || DEFAULT_TMP);
export const DAY = 24 * 60 * 60 * 1000;

/** @param {string} name */
export async function makeTmp(name) {
  await fsp.mkdir(TMP_ROOT, { recursive: true });
  return fsp.mkdtemp(path.join(TMP_ROOT, `${name}-`));
}

/** 只允许删除 TMP_ROOT 下由测试创建的目录。 @param {string} dir */
export async function removeTmp(dir) {
  const real = path.resolve(dir);
  if (!real.startsWith(TMP_ROOT + path.sep)) throw new Error(`refuse to remove ${real}`);
  // 服务里可能还有排队的持久化写入，目录非空时重试几次。
  await fsp.rm(real, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

/** @param {string} file @param {string | Buffer} [content] */
export async function writeFile(file, content = 'x') {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, content);
}

/** 稀疏文件：逻辑大小很大，不占磁盘。 @param {string} file @param {number} size */
export async function sparseFile(file, size) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const fh = await fsp.open(file, 'w');
  await fh.truncate(size);
  await fh.close();
}

/** @param {string} p @param {number} daysAgo */
export async function age(p, daysAgo) {
  const t = new Date(Date.now() - daysAgo * DAY);
  await fsp.utimes(p, t, t);
}

export function fakeLogger() {
  /** @type {{ level: string, msg: string, fields: any }[]} */
  const events = [];
  const mk = (/** @type {string} */ level) => (/** @type {string} */ msg, /** @type {any} */ fields) => {
    events.push({ level, msg, fields });
  };
  return { events, debug: mk('debug'), info: mk('info'), warn: mk('warn'), error: mk('error') };
}

/**
 * 不启动任何真实进程的 runner。execFile 可以传入假的应答函数（返回 run 的结果格式），默认失败。
 * @param {{ execFile?: (cmd: string, args: string[], opts: any) => Promise<any> | any }} [opts]
 */
export function fakeExec(opts = {}) {
  /** @type {{ cmd: string, args: string[], opts?: any }[]} */
  const calls = [];
  return {
    calls,
    async run(/** @type {string} */ cmd, /** @type {string[]} */ args) {
      calls.push({ cmd, args });
      return { ok: false, exitCode: 1, error: 'fake', stdout: '', stderr: '' };
    },
    async execFile(/** @type {string} */ cmd, /** @type {string[]} */ args, /** @type {any} */ o = {}) {
      calls.push({ cmd, args, opts: o });
      if (opts.execFile) return opts.execFile(cmd, args, o);
      return { ok: false, exitCode: 1, error: 'fake', stdout: '', stderr: '' };
    },
    async launch(/** @type {string} */ cmd, /** @type {string[]} */ args) {
      calls.push({ cmd, args });
      return true;
    },
    killAll() {},
    size: 0,
  };
}

/**
 * 假删除执行器：只允许删除 TMP_ROOT 下的路径（其他路径直接抛错），记录调用；fail 里的路径返回 in_use 失败、不删除。
 * @param {{ fail?: Set<string> }} [opts]
 */
export function fakeRemove(opts = {}) {
  /** @type {string[]} */
  const calls = [];
  const fn = async (/** @type {string} */ p) => {
    calls.push(p);
    if (!path.resolve(p).startsWith(TMP_ROOT + path.sep)) throw new Error(`fakeRemove refuses ${p}`);
    if (opts.fail && opts.fail.has(p)) return { ok: false, error: 'in_use', errno: 'EBUSY' };
    await fsp.rm(p, { recursive: true, force: false });
    return { ok: true, error: null, errno: null };
  };
  return Object.assign(fn, { calls });
}
