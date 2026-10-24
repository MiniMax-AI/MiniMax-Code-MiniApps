// @ts-check
// 扫描范围：路径规范化和校验、把请求里的磁盘和文件夹整理成扫描根、常用位置。
import { diskOf } from './protect.mjs';
import { HttpError, getEnv } from './util.mjs';

export const MAX_SCAN_PATHS = 20;

/**
 * 规范化用户输入的路径：去掉首尾空白，解析 ~，Windows 上统一斜杠方向和盘符大小写，去掉末尾分隔符。
 * @param {any} raw @param {import('./util.mjs').PathOps} pathOps @param {string} home
 * @returns {string | null} 不是绝对路径时返回 null
 */
export function normalizeUserPath(raw, pathOps, home) {
  if (typeof raw !== 'string') return null;
  let p = raw.trim();
  if (!p) return null;
  if (p === '~') p = home;
  else if (p.startsWith('~/') || (pathOps.win && p.startsWith('~\\'))) p = pathOps.join(home, p.slice(2));
  if (pathOps.win) {
    p = p.replace(/\//g, '\\');
    if (/^[a-zA-Z]:/.test(p)) p = p[0].toUpperCase() + p.slice(1);
  }
  if (!pathOps.isAbsolute(p) || (pathOps.win && !/^[A-Z]:\\/.test(p) && !p.startsWith('\\\\'))) return null;
  return pathOps.norm(p);
}

/**
 * 校验文件夹路径：绝对路径、存在、是目录、位于已知磁盘上。返回真实路径。
 * 错误码：not_absolute、not_found、not_dir、unknown_disk。
 * @param {any} raw
 * @param {{ fs: any, pathOps: import('./util.mjs').PathOps, home: string, disks: any[] }} o
 */
export async function validateFolder(raw, o) {
  const { fs, pathOps } = o;
  const p = normalizeUserPath(raw, pathOps, o.home);
  if (!p) throw new HttpError(400, 'not_absolute', '请填写完整的绝对路径');
  let real;
  try {
    real = await fs.realpath(p);
  } catch {
    throw new HttpError(400, 'not_found', '这个路径不存在或无法访问');
  }
  real = normalizeUserPath(real, pathOps, o.home) || pathOps.norm(real);
  let st;
  try {
    st = await fs.stat(real);
  } catch {
    throw new HttpError(400, 'not_found', '这个路径不存在或无法访问');
  }
  if (!st.isDirectory()) throw new HttpError(400, 'not_dir', '请选择文件夹，不是文件');
  const disk = diskOf(real, o.disks, pathOps);
  if (!disk) throw new HttpError(400, 'unknown_disk', '这个文件夹不在已知的磁盘上');
  return { path: real, diskId: disk.id, deletable: !!disk.deletable };
}

/**
 * 把扫描请求整理成扫描根。扫描范围必须显式选择：diskIds 和 paths 都为空或都省略时返回 scope_required。
 * 文件夹位于所选磁盘之内时按磁盘处理；嵌套的文件夹只留外层。
 * @param {any} body
 * @param {{ fs: any, pathOps: import('./util.mjs').PathOps, home: string, disks: any[] }} o
 * @returns {Promise<{ roots: { id: string, kind: 'disk' | 'folder', label: string, path: string, diskId: string }[], diskIds: string[], paths: string[] }>}
 */
export async function resolveScanRoots(body, o) {
  const { pathOps, disks } = o;
  const hasDisks = body.diskIds !== undefined && body.diskIds !== null;
  const hasPaths = body.paths !== undefined && body.paths !== null;
  const emptyDisks = !hasDisks || (Array.isArray(body.diskIds) && body.diskIds.length === 0);
  const emptyPaths = !hasPaths || (Array.isArray(body.paths) && body.paths.length === 0);
  if (emptyDisks && emptyPaths) throw new HttpError(400, 'scope_required', '请先选择扫描范围');
  /** @type {string[]} */
  let diskIds = [];
  if (hasDisks) {
    if (!Array.isArray(body.diskIds) || body.diskIds.some((/** @type {any} */ x) => typeof x !== 'string' || !disks.some((d) => d.id === x))) {
      throw new HttpError(400, 'invalid_disk', '磁盘编号不正确');
    }
    diskIds = [...new Set(/** @type {string[]} */ (body.diskIds))];
  }
  /** @type {string[]} */
  let paths = [];
  if (hasPaths) {
    if (!Array.isArray(body.paths)) throw new HttpError(400, 'invalid_path', '文件夹列表格式不正确');
    if (body.paths.length > MAX_SCAN_PATHS) throw new HttpError(400, 'invalid_path', `最多选择 ${MAX_SCAN_PATHS} 个文件夹`);
    for (const raw of body.paths) {
      try {
        paths.push((await validateFolder(raw, o)).path);
      } catch (e) {
        const msg = e instanceof HttpError ? e.message : '路径不合法';
        throw new HttpError(400, 'invalid_path', `${typeof raw === 'string' ? raw : ''}：${msg}`);
      }
    }
  }
  // 位于所选磁盘之内的文件夹按磁盘处理
  paths = paths.filter((p) => {
    const d = diskOf(p, disks, pathOps);
    return !(d && diskIds.includes(d.id));
  });
  // 嵌套的文件夹只留外层，重复的去掉
  const keys = paths.map((p) => pathOps.key(p));
  paths = paths.filter((p, i) => keys.indexOf(keys[i]) === i && !keys.some((k, j) => j !== i && pathOps.inside(keys[i], k)));
  if (!diskIds.length && !paths.length) throw new HttpError(400, hasPaths ? 'invalid_path' : 'invalid_disk', '没有可扫描的磁盘或文件夹');
  /** @type {{ id: string, kind: 'disk' | 'folder', label: string, path: string, diskId: string }[]} */
  const roots = [];
  for (const id of diskIds) {
    const d = disks.find((x) => x.id === id);
    roots.push({ id: `r_${roots.length + 1}`, kind: 'disk', label: d.label, path: d.mount, diskId: d.id });
  }
  for (const p of paths) {
    const d = /** @type {any} */ (diskOf(p, disks, pathOps));
    roots.push({ id: `r_${roots.length + 1}`, kind: 'folder', label: pathOps.basename(p) || p, path: p, diskId: d.id });
  }
  return { roots, diskIds, paths };
}

/**
 * 常用位置：只列出存在的目录。
 * @param {{ fs: any, pathOps: import('./util.mjs').PathOps, home: string, platform: string, env: Record<string, string | undefined> }} o
 */
export async function listPlaces(o) {
  const { fs, pathOps, platform } = o;
  const home = platform === 'win32' ? getEnv(o.env, 'USERPROFILE') || o.home : o.home;
  const cands = [
    { id: 'home', label: '主目录', path: home },
    { id: 'desktop', label: '桌面', path: pathOps.join(home, 'Desktop') },
    { id: 'downloads', label: '下载', path: pathOps.join(home, 'Downloads') },
    { id: 'documents', label: platform === 'win32' ? '文档' : '文稿', path: pathOps.join(home, 'Documents') },
  ];
  const out = [];
  for (const c of cands) {
    try {
      if ((await fs.stat(c.path)).isDirectory()) out.push(c);
    } catch {
      // 不存在或读不到，不列出
    }
  }
  return out;
}
