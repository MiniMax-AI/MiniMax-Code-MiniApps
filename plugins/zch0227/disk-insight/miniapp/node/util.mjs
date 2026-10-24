// @ts-check
// 通用工具：按平台的路径运算、大小格式化、错误类型。
import path from 'node:path';

export const MB = 1000 * 1000;
export const GB = 1000 * MB;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** 目录树只保留 ≥ 50 MB 的单个文件。 */
export const RETAIN_FILE_BYTES = 50 * MB;
/** 子树小于 10 MB 时丢弃子节点。 */
export const PRUNE_BYTES = 10 * MB;
/** 大文件门槛。 */
export const LARGE_FILE_BYTES = 500 * MB;
/** 重复文件候选门槛（逻辑大小）。 */
export const DUP_MIN_BYTES = 1 * MB;

/**
 * 路径运算一律显式使用 path.posix 或 path.win32，方便在 Mac 上测试 Windows 逻辑。
 * key() 用于比较：统一小写、去掉结尾分隔符（根目录除外）。
 * @param {'posix' | 'win32'} flavor
 */
export function createPathOps(flavor) {
  const win = flavor === 'win32';
  const api = win ? path.win32 : path.posix;
  const sep = api.sep;

  /** @param {string} p */
  function norm(p) {
    let s = win ? p.replace(/\//g, '\\') : p;
    while (s.length > 1 && s.endsWith(sep)) {
      if (win && /^[a-zA-Z]:\\$/.test(s)) break;
      s = s.slice(0, -1);
    }
    if (win && /^[a-zA-Z]:$/.test(s)) s += '\\';
    return s;
  }
  /** @param {string} p */
  function key(p) {
    return norm(p).toLowerCase();
  }
  /** child 严格位于 parent 之内（两个参数都是 key）。 */
  function inside(/** @type {string} */ childKey, /** @type {string} */ parentKey) {
    if (childKey === parentKey) return false;
    const prefix = parentKey.endsWith(sep) ? parentKey : parentKey + sep;
    return childKey.startsWith(prefix);
  }
  /** @param {string} a @param {string} b */
  function join(a, b) {
    return a.endsWith(sep) ? a + b : a + sep + b;
  }
  /** @param {string} k */
  function isRootKey(k) {
    return win ? /^[a-z]:\\$/.test(k) : k === '/';
  }
  /** @param {string} a @param {string} b */
  function same(a, b) {
    return key(a) === key(b);
  }
  return {
    flavor,
    win,
    api,
    sep,
    norm,
    key,
    inside,
    sameOrInside: (/** @type {string} */ c, /** @type {string} */ p) => c === p || inside(c, p),
    join,
    dirname: (/** @type {string} */ p) => api.dirname(p),
    basename: (/** @type {string} */ p) => api.basename(p),
    isAbsolute: (/** @type {string} */ p) => api.isAbsolute(p),
    isRootKey,
    same,
  };
}

/** @typedef {ReturnType<typeof createPathOps>} PathOps */

/** 十进制单位的人类可读大小（与访达一致）。 @param {number} bytes */
export function humanSize(bytes) {
  const b = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (b < 1000) return `${Math.round(b)} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let v = b;
  let i = -1;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i += 1;
  }
  const text = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
  return `${text} ${units[i]}`;
}

/** 本地时间 YYYY-MM-DD。 @param {number} ms */
export function formatDate(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '未知';
  const d = new Date(ms);
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** @param {number} now @param {number} ms */
export function daysSince(now, ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.max(0, Math.floor((now - ms) / DAY_MS));
}

export function yieldNow() {
  return new Promise((resolve) => setImmediate(resolve));
}

export class HttpError extends Error {
  /** @param {number} status @param {string} code @param {string} message */
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function abortError() {
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}

/**
 * 不区分大小写地读环境变量（Windows 的 process.env 本身不区分，测试用的普通对象区分）。
 * @param {Record<string, string | undefined>} env @param {string} name
 */
export function getEnv(env, name) {
  if (!env) return undefined;
  if (typeof env[name] === 'string' && env[name]) return env[name];
  const lower = name.toLowerCase();
  for (const k of Object.keys(env)) {
    if (k.toLowerCase() === lower && env[k]) return env[k];
  }
  return undefined;
}
