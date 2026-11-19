import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

export class AppError extends Error {
  constructor(code, message, status = 400, extra = undefined) {
    super(message);
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

export const nowIso = () => new Date().toISOString();
export const newId = (prefix) => prefix + '_' + randomBytes(6).toString('hex');
export const clamp = (value, max) => {
  const s = String(value ?? '');
  return s.length > max ? s.slice(0, max) : s;
};
export const clip = (value, max = 300) => {
  const s = redact(String(value ?? '')).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
};
/** 去掉可能出现在报错里的令牌 */
export function redact(text) {
  return String(text)
    .replace(/(gh[pousr]_[A-Za-z0-9]{20,})/g, '***')
    .replace(/(github_pat_[A-Za-z0-9_]{20,})/g, '***')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{16,}/gi, '$1***');
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AppError('cancelled', '已取消', 499));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new AppError('cancelled', '已取消', 499));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** 先写临时文件再改名，进程被强杀也不会留下半个文件 */
export async function atomicWrite(file, data) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.' + randomBytes(3).toString('hex') + '.tmp';
  await writeFile(tmp, data);
  try {
    await rename(tmp, file);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

/** 接受 owner/repo、GitHub 网址、git@ 地址 */
export function parseRepoRef(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!s || s.length > 300) return null;
  let m = s.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (!m) m = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s?#]+)\/([^/\s?#]+?)(?:\.git)?(?:[/?#].*)?$/i);
  if (!m) m = s.match(/^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  if (!m) return null;
  const owner = m[1];
  const name = m[2];
  if (!OWNER_RE.test(owner) || !REPO_RE.test(name) || name === '.' || name === '..') return null;
  return { owner, name, fullName: owner + '/' + name };
}

/** 项目的稳定标识，也用作缓存文件夹名：owner__repo（小写） */
export const keyOf = (fullName) => String(fullName).toLowerCase().replace('/', '__');
export const isKey = (key) => typeof key === 'string' && /^[a-z0-9-]{1,39}__[a-z0-9._-]{1,100}$/.test(key);

export const readJsonBody = (request, limit = 262144) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new AppError('too_large', '请求内容太大', 413));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (size === 0) return resolve({});
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(value && typeof value === 'object' ? value : {});
      } catch {
        reject(new AppError('bad_json', '请求格式不对', 400));
      }
    });
    request.on('error', () => reject(new AppError('aborted', '请求中断', 400)));
  });
