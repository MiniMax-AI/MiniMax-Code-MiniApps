// @ts-check
// 保护名单和锁定判断。路径比较不区分大小写。
import { getEnv } from './util.mjs';

/**
 * @param {{
 *   platform: string,
 *   pathOps: import('./util.mjs').PathOps,
 *   home: string,
 *   env: Record<string, string | undefined>,
 *   goModCache?: string | null,
 *   mcodeDataDir?: string | null,
 *   dataDir?: string | null,
 * }} o
 */
export function createProtection(o) {
  const { platform, pathOps, home, env } = o;
  /** @type {{ key: string, reason: string }[]} */
  const list = [];
  /** @type {Map<string, string>} 只锁定本身，里面的条目不受影响 */
  const itself = new Map();
  /** @type {string[]} */
  const trashKeys = [];
  const add = (/** @type {string | null | undefined} */ p, /** @type {string} */ reason) => {
    if (!p) return;
    const key = pathOps.key(p);
    if (!list.some((x) => x.key === key)) list.push({ key, reason });
  };
  const self = (/** @type {string} */ p, /** @type {string} */ reason) => itself.set(pathOps.key(p), reason);
  const j = (/** @type {string} */ base, /** @type {string[]} */ ...segs) => segs.reduce((acc, s) => pathOps.join(acc, s), pathOps.norm(base));

  if (platform === 'darwin') {
    for (const p of ['/System', '/Library', '/usr', '/bin', '/sbin', '/private']) add(p, '系统目录');
    add('/Applications/Safari.app', '系统自带应用');
    add('/Applications/Utilities', '系统自带应用');
    add(j(home, 'Library', 'Keychains'), '钥匙串（凭据）');
    add(j(home, '.ssh'), 'SSH 凭据');
    add(j(home, '.gnupg'), 'GPG 凭据');
    add(j(home, 'Library', 'Mobile Documents'), 'iCloud 云盘目录，删除会同步删除云端文件');
    add(j(home, 'Library', 'CloudStorage'), '云盘目录，删除会同步删除云端文件');
    const trash = j(home, '.Trash');
    add(trash, '已经在废纸篓里');
    trashKeys.push(pathOps.key(trash));
    self(home, '用户主目录');
    self(j(home, 'Library'), '资源库文件夹');
    for (const [name, label] of [['Desktop', '桌面'], ['Documents', '文稿'], ['Downloads', '下载'], ['Pictures', '图片'], ['Movies', '影片'], ['Music', '音乐']]) {
      self(j(home, name), `${label}文件夹本身`);
    }
  } else if (platform === 'win32') {
    const user = getEnv(env, 'USERPROFILE') || home;
    const sysDrive = pathOps.norm(getEnv(env, 'SystemDrive') || 'C:');
    add(getEnv(env, 'SystemRoot') || getEnv(env, 'windir') || j(sysDrive, 'Windows'), '系统目录');
    add(getEnv(env, 'ProgramFiles') || j(sysDrive, 'Program Files'), '程序目录');
    add(getEnv(env, 'ProgramFiles(x86)') || j(sysDrive, 'Program Files (x86)'), '程序目录');
    add(getEnv(env, 'ProgramData') || j(sysDrive, 'ProgramData'), '系统程序数据目录');
    const roaming = getEnv(env, 'APPDATA') || j(user, 'AppData', 'Roaming');
    add(j(roaming, 'Microsoft'), '凭据和系统设置目录');
    add(j(user, '.ssh'), 'SSH 凭据');
    for (const name of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) add(getEnv(env, name), 'OneDrive 云盘目录，删除会同步删除云端文件');
    add(j(user, 'OneDrive'), 'OneDrive 云盘目录，删除会同步删除云端文件');
    self(user, '用户主目录');
    for (const [name, label] of [['Desktop', '桌面'], ['Documents', '文档'], ['Downloads', '下载'], ['Pictures', '图片'], ['Videos', '视频'], ['Music', '音乐']]) {
      self(j(user, name), `${label}文件夹本身`);
    }
    // 与 macOS 的 ~/Library 对应。
    self(j(user, 'AppData'), '应用数据根目录');
    self(j(user, 'AppData', 'Local'), '应用数据根目录');
    self(j(user, 'AppData', 'LocalLow'), '应用数据根目录');
    self(roaming, '应用数据根目录');
  }
  // Go 模块目录是只读的，直接删除会失败；官方的清理方式是 go clean -modcache，所以不提供删除。
  if (o.goModCache) add(o.goModCache, 'Go 模块缓存，请在终端运行 go clean -modcache 清理');
  add(j(home, 'go', 'pkg', 'mod'), 'Go 模块缓存，请在终端运行 go clean -modcache 清理');
  add(o.mcodeDataDir, 'MiniMax Code 数据目录');
  add(o.dataDir, '磁盘透视自己的数据目录');

  /** @type {WeakMap<object, { key: string, reason: string }[]>} */
  const perDiskCache = new WeakMap();
  /** Windows 各盘的系统条目。 @param {any[]} disks */
  function diskEntries(disks) {
    if (platform !== 'win32' || !disks) return [];
    let v = perDiskCache.get(disks);
    if (!v) {
      v = [];
      for (const d of disks) {
        for (const name of ['System Volume Information', '$Recycle.Bin']) v.push({ key: pathOps.key(pathOps.join(d.mount, name)), reason: '系统目录' });
        for (const name of ['pagefile.sys', 'hiberfil.sys', 'swapfile.sys']) v.push({ key: pathOps.key(pathOps.join(d.mount, name)), reason: '系统文件' });
      }
      perDiskCache.set(disks, v);
    }
    return v;
  }

  /**
   * 返回锁定原因；可以勾选时返回 null。
   * @param {string} path
   * @param {{ disks?: any[], exempt?: boolean }} [opts]
   */
  function lockReason(path, opts = {}) {
    const { disks = [], exempt = false } = opts;
    const key = pathOps.key(path);
    if (pathOps.isRootKey(key) || disks.some((d) => pathOps.key(d.mount) === key)) return '磁盘根目录';
    const own = itself.get(key);
    if (own) return own;
    if (pathOps.basename(key) === '.git') return 'git 仓库数据（.git 目录本身）';
    if (!exempt) {
      const entries = list.concat(diskEntries(disks));
      for (const e of entries) {
        if (key === e.key || pathOps.inside(key, e.key)) return e.reason;
      }
      for (const e of entries) {
        if (pathOps.inside(e.key, key)) return `里面包含受保护的路径（${e.reason}）`;
      }
    }
    const disk = diskOf(path, disks, pathOps);
    if (!disk) return '不在已知磁盘上';
    if (!disk.deletable) return '外接磁盘和网络盘上的条目只扫描，不提供删除';
    return null;
  }

  return {
    lockReason,
    protectedKeys: list.map((x) => x.key),
    trashKeys,
    list,
  };
}

/**
 * 按挂载点最长前缀找所在磁盘。
 * @param {string} path @param {any[]} disks @param {import('./util.mjs').PathOps} pathOps
 */
export function diskOf(path, disks, pathOps) {
  const key = pathOps.key(path);
  let best = null;
  let bestLen = -1;
  for (const d of disks || []) {
    const mk = pathOps.key(d.mount);
    if ((key === mk || pathOps.inside(key, mk)) && mk.length > bestLen) {
      best = d;
      bestLen = mk.length;
    }
  }
  return best;
}
