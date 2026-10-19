// @ts-check
// 清理规则：分类表、macOS / Windows 固定位置、模式规则、文件类型。
import { CF } from './tree.mjs';
import { getEnv } from './util.mjs';
import { winSpecs } from './rules-win.mjs';

/**
 * @typedef {{ id: string, tier: 'safe' | 'confirm' | 'info', name: string, effect: string, platforms?: string[] }} Category
 */

/** @param {string} platform @returns {Category[]} */
export function categoriesFor(platform) {
  const mac = platform === 'darwin';
  /** @type {Category[]} */
  const all = [
    { id: 'temp', tier: 'safe', name: '临时文件', effect: '没有影响。正在使用的文件删除失败会跳过' },
    { id: 'pkg-cache', tier: 'safe', name: '包管理器缓存', effect: '下次安装依赖时重新下载，第一次会慢' },
    { id: 'browser-cache', tier: 'safe', name: '浏览器缓存', effect: '网页第一次打开变慢。登录状态、书签、历史记录不受影响' },
    { id: 'logs', tier: 'safe', name: '日志和崩溃报告', effect: '排查旧问题时没有日志可看' },
    { id: 'thumbnails', tier: 'safe', name: '缩略图缓存', effect: '资源管理器重新生成缩略图。被占用的文件会跳过', platforms: ['win32'] },
    { id: 'build-artifacts', tier: 'safe', name: '开发构建产物', effect: '下次 install 或 build 时重建。所在项目 90 天以上没改动时默认勾选' },
    { id: 'installers', tier: 'safe', name: '旧安装包', effect: '以后要用得重新下载' },
    { id: 'pnpm-store', tier: 'confirm', name: 'pnpm 存储', effect: '存储里的文件和各项目 node_modules 用硬链接共享，只删存储释放不了多少空间，以「可释放」大小为准' },
    { id: 'app-cache', tier: 'confirm', name: '应用缓存', effect: '应用会重建缓存，下次打开可能变慢。正在运行的应用要先退出' },
    { id: 'chat-cache', tier: 'confirm', name: '聊天软件缓存', effect: '聊天记录里的图片、视频打不开或要重新下载' },
    { id: 'chat-received', tier: 'confirm', name: '聊天软件接收的文件', effect: '聊天记录里的文件打不开或要重新下载' },
    { id: 'python-venv', tier: 'confirm', name: 'Python 虚拟环境', effect: '要重新建环境、装包' },
    { id: 'simulators', tier: 'confirm', name: '模拟器和设备支持', effect: '需要时重新下载或重建' },
    { id: 'large-old', tier: 'confirm', name: '大且久未修改的文件', effect: '多为个人文件，删之前要逐个确认' },
    { id: 'duplicates', tier: 'confirm', name: '重复文件', effect: '删掉的是副本，原文件还在。每组至少保留一份' },
    {
      id: 'system-junk',
      tier: 'info',
      name: '系统垃圾（需要管理员权限）',
      effect: mac ? '系统会自动清理。需要时在系统设置的存储页处理，本地 Time Machine 快照也在那里管理' : '用系统设置的存储页或系统自带的磁盘清理处理',
    },
    { id: 'trash', tier: 'info', name: mac ? '废纸篓' : '回收站', effect: mac ? '只显示大小，请自己清空废纸篓' : '只显示大小，请自己清空回收站' },
    { id: 'docker', tier: 'info', name: 'Docker 磁盘镜像', effect: '在 Docker 里清理不用的镜像、容器和构建缓存' },
    // Go 模块目录是只读的，直接删除会失败；官方的清理方式是 go clean -modcache，所以这里只显示大小。
    { id: 'go-mod-cache', tier: 'info', name: 'Go 模块缓存', effect: '在终端运行 go clean -modcache 清理，这里只显示大小' },
  ];
  return all.filter((c) => !c.platforms || c.platforms.includes(platform));
}

/** 只提示类的系统动作按钮。 @param {string} platform @param {string} categoryId */
export function categoryAction(platform, categoryId) {
  if (categoryId !== 'system-junk') return null;
  return platform === 'darwin'
    ? { id: 'mac-storage-settings', label: '打开存储设置' }
    : { id: 'win-disk-cleanup', label: '打开磁盘清理' };
}

// ---------------------------------------------------------------------------
// 固定位置规则
// mode：
//   dir        路径本身是一个条目
//   children   路径下的每个子项是一个条目（temp、DerivedData）
//   remainder  路径下没有被其他规则认领的子目录各是一个条目（~/Library/Caches）
//   installers 路径下（任意深度）符合扩展名和时间的文件
//   thumbs     路径下的 thumbcache_*.db
//   scan       只纳入快速扫描（Docker 目录，靠文件名识别）
// ---------------------------------------------------------------------------

/**
 * @typedef {{ cat: string, name: string, at: string[], mode?: string, app?: string, chat?: boolean, devCache?: boolean, ageDays?: number }} RuleSpec
 */

/** @returns {RuleSpec[]} */
function macSpecs() {
  const WX4 = ['~', 'Library', 'Containers', 'com.tencent.xinWeChat', 'Data', 'Documents', 'xwechat_files', '*'];
  const WX3 = ['~', 'Library', 'Containers', 'com.tencent.xinWeChat', 'Data', 'Library', 'Application Support', 'com.tencent.xinWeChat', '*', '*', 'Message', 'MessageTemp'];
  const DING = ['~', 'Library', 'Application Support', 'DingTalkMac', '*'];
  const LARK = ['~', 'Library', 'Application Support', 'LarkShell', 'sdk_storage', '*', 'resources'];
  const QQ = ['~', 'Library', 'Containers', 'com.tencent.qq', 'Data', 'Library', 'Application Support', 'QQ', '*', 'nt_data'];
  const WEWORK = ['~', 'Library', 'Containers', 'com.tencent.WeWorkMac', 'Data', 'Documents', 'Profiles', '*', 'Caches'];
  return [
    { cat: 'temp', name: '临时文件', at: ['$TMPDIR'], mode: 'children', ageDays: 3 },

    { cat: 'pkg-cache', name: 'npm 缓存', at: ['~', '.npm', '_cacache'], devCache: true },
    { cat: 'pkg-cache', name: 'npx 缓存', at: ['~', '.npm', '_npx'], devCache: true },
    { cat: 'pkg-cache', name: 'Yarn 缓存', at: ['~', 'Library', 'Caches', 'Yarn'], devCache: true },
    { cat: 'pkg-cache', name: 'pip 缓存', at: ['~', 'Library', 'Caches', 'pip'], devCache: true },
    { cat: 'pkg-cache', name: 'Homebrew 缓存', at: ['~', 'Library', 'Caches', 'Homebrew'], devCache: true },
    { cat: 'pkg-cache', name: 'CocoaPods 缓存', at: ['~', 'Library', 'Caches', 'CocoaPods'], devCache: true },
    { cat: 'pkg-cache', name: 'Cargo 下载缓存', at: ['~', '.cargo', 'registry', 'cache'], devCache: true },
    { cat: 'pkg-cache', name: 'Gradle 缓存', at: ['~', '.gradle', 'caches'], devCache: true },
    { cat: 'pkg-cache', name: 'Maven 本地仓库', at: ['~', '.m2', 'repository'], devCache: true },
    { cat: 'pkg-cache', name: 'uv 缓存', at: ['~', '.cache', 'uv'], devCache: true },
    { cat: 'pkg-cache', name: 'pip 缓存（~/.cache）', at: ['~', '.cache', 'pip'], devCache: true },
    { cat: 'pkg-cache', name: 'pnpm 缓存（~/.cache）', at: ['~', '.cache', 'pnpm'], devCache: true },

    { cat: 'browser-cache', name: 'Chrome 缓存', at: ['~', 'Library', 'Caches', 'Google', 'Chrome'], app: 'chrome' },
    { cat: 'browser-cache', name: 'Edge 缓存', at: ['~', 'Library', 'Caches', 'Microsoft Edge'], app: 'edge' },
    { cat: 'browser-cache', name: 'Firefox 缓存', at: ['~', 'Library', 'Caches', 'Firefox'], app: 'firefox' },

    { cat: 'logs', name: '用户日志和崩溃报告', at: ['~', 'Library', 'Logs'] },

    { cat: 'build-artifacts', name: 'Xcode 构建缓存', at: ['~', 'Library', 'Developer', 'Xcode', 'DerivedData'], mode: 'children', devCache: true },

    { cat: 'installers', name: '旧安装包', at: ['~', 'Downloads'], mode: 'installers', ageDays: 30 },
    { cat: 'installers', name: '旧安装包', at: ['~', 'Desktop'], mode: 'installers', ageDays: 30 },

    { cat: 'pnpm-store', name: 'pnpm 存储', at: ['~', 'Library', 'pnpm', 'store'], devCache: true },
    { cat: 'pnpm-store', name: 'pnpm 元数据缓存', at: ['~', 'Library', 'Caches', 'pnpm'], devCache: true },

    { cat: 'app-cache', name: '应用缓存', at: ['~', 'Library', 'Caches'], mode: 'remainder' },

    { cat: 'chat-cache', name: '微信 图片和附件', at: [...WX4, 'msg', 'attach'], chat: true, app: 'wechat' },
    { cat: 'chat-cache', name: '微信 视频', at: [...WX4, 'msg', 'video'], chat: true, app: 'wechat' },
    { cat: 'chat-cache', name: '微信 缓存', at: [...WX4, 'cache'], chat: true, app: 'wechat' },
    { cat: 'chat-received', name: '微信 接收的文件', at: [...WX4, 'msg', 'file'], chat: true, app: 'wechat' },
    { cat: 'chat-cache', name: '微信 聊天图片和视频（旧版）', at: WX3, chat: true, app: 'wechat' },
    { cat: 'chat-cache', name: '钉钉 图片', at: [...DING, 'ImageFiles'], chat: true, app: 'dingtalk' },
    { cat: 'chat-cache', name: '钉钉 视频', at: [...DING, 'VideoFiles'], chat: true, app: 'dingtalk' },
    { cat: 'chat-cache', name: '钉钉 语音', at: [...DING, 'AudioFiles'], chat: true, app: 'dingtalk' },
    { cat: 'chat-cache', name: '钉钉 资源缓存', at: [...DING, 'resource_cache'], chat: true, app: 'dingtalk' },
    { cat: 'chat-cache', name: '飞书 图片', at: [...LARK, 'images'], chat: true, app: 'lark' },
    { cat: 'chat-cache', name: '飞书 视频和媒体', at: [...LARK, 'medias'], chat: true, app: 'lark' },
    { cat: 'chat-cache', name: '飞书 语音', at: [...LARK, 'audios'], chat: true, app: 'lark' },
    { cat: 'chat-received', name: '飞书 接收的文件', at: [...LARK, 'files'], chat: true, app: 'lark' },
    { cat: 'chat-cache', name: 'QQ 图片', at: [...QQ, 'Pic'], chat: true, app: 'qq' },
    { cat: 'chat-cache', name: 'QQ 视频', at: [...QQ, 'Video'], chat: true, app: 'qq' },
    { cat: 'chat-received', name: 'QQ 接收的文件', at: [...QQ, 'File'], chat: true, app: 'qq' },
    { cat: 'chat-cache', name: '企业微信 图片', at: [...WEWORK, 'Images'], chat: true, app: 'wework' },
    { cat: 'chat-cache', name: '企业微信 视频', at: [...WEWORK, 'Videos'], chat: true, app: 'wework' },
    { cat: 'chat-received', name: '企业微信 接收的文件', at: [...WEWORK, 'Files'], chat: true, app: 'wework' },
    { cat: 'chat-cache', name: '腾讯会议 图片缓存', at: ['~', 'Library', 'Containers', 'com.tencent.meeting', 'Data', 'Library', '.nx_caches'], chat: true, app: 'meeting' },

    { cat: 'simulators', name: 'iOS 模拟器', at: ['~', 'Library', 'Developer', 'CoreSimulator', 'Devices'] },
    { cat: 'simulators', name: 'iOS 设备支持文件', at: ['~', 'Library', 'Developer', 'Xcode', 'iOS DeviceSupport'] },
    { cat: 'simulators', name: 'watchOS 设备支持文件', at: ['~', 'Library', 'Developer', 'Xcode', 'watchOS DeviceSupport'] },
    { cat: 'simulators', name: 'tvOS 设备支持文件', at: ['~', 'Library', 'Developer', 'Xcode', 'tvOS DeviceSupport'] },
    { cat: 'simulators', name: 'Android 模拟器', at: ['~', '.android', 'avd'] },

    { cat: 'system-junk', name: '系统缓存 /Library/Caches', at: ['/', 'Library', 'Caches'] },
    { cat: 'system-junk', name: '系统日志 /private/var/log', at: ['/', 'private', 'var', 'log'] },

    { cat: 'trash', name: '废纸篓', at: ['~', '.Trash'] },

    { cat: 'docker', name: 'Docker 数据', at: ['~', 'Library', 'Containers', 'com.docker.docker', 'Data', 'vms'], mode: 'scan' },

    { cat: 'go-mod-cache', name: 'Go 模块缓存', at: ['$GOMODCACHE'], devCache: true },
  ];
}


/**
 * 把规则模板展开成路径（可能仍含 * 通配段）。
 * @param {{ platform: string, env: Record<string, string | undefined>, home: string, tmpdir: string, goModCache: string | null, pathOps: import('./util.mjs').PathOps }} o
 */
export function buildRuleSpecs(o) {
  const { platform, env, home, tmpdir, goModCache, pathOps } = o;
  /** @type {Record<string, string | null>} */
  const vars = {};
  /** @type {RuleSpec[]} */
  let specs = [];
  if (platform === 'darwin') {
    vars['~'] = home;
    vars['$TMPDIR'] = tmpdir;
    vars['/'] = '/';
    specs = macSpecs();
  } else if (platform === 'win32') {
    const user = getEnv(env, 'USERPROFILE') || home;
    const local = getEnv(env, 'LOCALAPPDATA') || pathOps.join(pathOps.join(user, 'AppData'), 'Local');
    const roaming = getEnv(env, 'APPDATA') || pathOps.join(pathOps.join(user, 'AppData'), 'Roaming');
    const sysDrive = pathOps.norm(getEnv(env, 'SystemDrive') || 'C:');
    vars['%USERPROFILE%'] = user;
    vars['%LOCALAPPDATA%'] = local;
    vars['%APPDATA%'] = roaming;
    vars['%TEMP%'] = getEnv(env, 'TEMP') || getEnv(env, 'TMP') || tmpdir || pathOps.join(local, 'Temp');
    vars['%SystemRoot%'] = getEnv(env, 'SystemRoot') || getEnv(env, 'windir') || pathOps.join(sysDrive, 'Windows');
    vars['%SystemDrive%'] = sysDrive;
    specs = winSpecs();
  }
  vars['$GOMODCACHE'] = goModCache;
  const out = [];
  for (const s of specs) {
    const base = vars[s.at[0]];
    if (!base) continue;
    let p = pathOps.norm(base);
    for (const seg of s.at.slice(1)) p = pathOps.join(p, seg);
    out.push({ ...s, mode: s.mode || 'dir', path: p });
  }
  return out;
}

/** @typedef {ReturnType<typeof buildRuleSpecs>[number]} ResolvedSpec */

/**
 * 展开 * 通配段，只保留真实存在的路径，并取真实路径。
 * @param {ResolvedSpec[]} specs
 * @param {any} fs  需要 readdir(withFileTypes)、realpath
 * @param {import('./util.mjs').PathOps} pathOps
 */
export async function expandSpecs(specs, fs, pathOps) {
  /** @type {(ResolvedSpec & { path: string })[]} */
  const out = [];
  const seen = new Set();
  for (const s of specs) {
    const parts = s.path.split(pathOps.sep);
    /** @type {string[]} */
    let cands = [];
    const first = parts.indexOf('*');
    if (first < 0) {
      cands = [s.path];
    } else {
      let prefixes = [parts.slice(0, first).join(pathOps.sep) || pathOps.sep];
      if (pathOps.win && /^[a-zA-Z]:$/.test(prefixes[0])) prefixes = [prefixes[0] + '\\'];
      for (let i = first; i < parts.length; i += 1) {
        const seg = parts[i];
        /** @type {string[]} */
        const next = [];
        for (const pre of prefixes) {
          if (seg === '*') {
            let ents = [];
            try {
              ents = await fs.readdir(pre, { withFileTypes: true });
            } catch {
              continue;
            }
            for (const d of ents.slice(0, 200)) if (d.isDirectory()) next.push(pathOps.join(pre, d.name));
          } else {
            next.push(pathOps.join(pre, seg));
          }
        }
        prefixes = next;
        if (!prefixes.length) break;
      }
      cands = prefixes;
    }
    for (const c of cands) {
      let real;
      try {
        real = await fs.realpath(c);
      } catch {
        continue;
      }
      real = pathOps.norm(real);
      const k = `${s.cat}|${pathOps.key(real)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ ...s, path: real });
    }
  }
  return out;
}

/** 构建产物目录名（用于「项目最后改动时间」排除和模式识别）。 */
export const ARTIFACT_NAMES = new Set(['node_modules', 'target', '.next', '.turbo', '.vite', '.parcel-cache', '__pycache__', 'bin', 'obj']);

/** 依赖安装目录：里面的 __pycache__、target、.next 等都属于它们本身，不单独识别。 */
export const NO_PATTERN_PARENTS = new Set(['node_modules', 'site-packages', '.venv', 'venv']);

/**
 * 按位置认定的容器目录（和 site-packages 一样，里面不识别构建产物）：
 * uv 管理的 Python 安装和工具，macOS 在 ~/.local/share/uv，Windows 在 %APPDATA%\uv。
 * @param {{ platform: string, env: Record<string, string | undefined>, home: string, pathOps: import('./util.mjs').PathOps }} o
 */
export function containerPaths(o) {
  const { platform, env, home, pathOps } = o;
  if (platform === 'darwin') return [pathOps.join(pathOps.join(pathOps.join(home, '.local'), 'share'), 'uv')];
  if (platform === 'win32') {
    const user = getEnv(env, 'USERPROFILE') || home;
    const roaming = getEnv(env, 'APPDATA') || pathOps.join(pathOps.join(user, 'AppData'), 'Roaming');
    return [pathOps.join(pathOps.norm(roaming), 'uv')];
  }
  return [];
}

export function newMeta() {
  return { hasGit: false, gitIsFile: false, hasHead: false, hasObjects: false, hasPkgJson: false, hasCargo: false, hasCsproj: false, hasPyvenv: false, hasPy: false, maxMtimeNonArtifact: 0 };
}

/** 列目录时记录判断构建产物所需的同级信息。 @param {ReturnType<typeof newMeta>} meta @param {string} name @param {{ mtimeMs: number, isFile?: () => boolean, isDirectory?: () => boolean }} st */
export function noteMeta(meta, name, st) {
  switch (name) {
    case '.git':
      meta.hasGit = true;
      // .git 是目录：主仓库；是文件：worktree 或子模块（内容是 gitdir: ...）
      meta.gitIsFile = typeof st.isDirectory === 'function' ? !st.isDirectory() : false;
      break;
    case 'HEAD':
      // HEAD 文件加 objects 目录：这个目录本身是一个 git 目录（--separate-git-dir 的仓库会指向它）。
      meta.hasHead = typeof st.isFile === 'function' ? st.isFile() : false;
      break;
    case 'objects':
      meta.hasObjects = typeof st.isDirectory === 'function' ? st.isDirectory() : false;
      break;
    case 'package.json':
      meta.hasPkgJson = true;
      break;
    case 'Cargo.toml':
      meta.hasCargo = true;
      break;
    case 'pyvenv.cfg':
      meta.hasPyvenv = true;
      break;
    default:
      if (name.endsWith('.csproj') || name.endsWith('.fsproj') || name.endsWith('.vbproj')) meta.hasCsproj = true;
      else if (name.endsWith('.py') && (typeof st.isFile !== 'function' || st.isFile())) meta.hasPy = true;
  }
  if (!ARTIFACT_NAMES.has(name) && st.mtimeMs > meta.maxMtimeNonArtifact) meta.maxMtimeNonArtifact = st.mtimeMs;
}

/**
 * 模式规则：根据目录名和同级文件判断是否是构建产物目录。
 * __pycache__ 只在父目录里有 .py 文件时才算（Python 项目的源码目录）。
 * @param {string} name @param {ReturnType<typeof newMeta> | null} parentMeta @param {string} platform
 */
export function isArtifactDir(name, parentMeta, platform) {
  if (!parentMeta) return false;
  switch (name) {
    case 'node_modules':
    case '.next':
    case '.turbo':
    case '.vite':
    case '.parcel-cache':
      return parentMeta.hasPkgJson;
    case 'target':
      return parentMeta.hasCargo;
    case '__pycache__':
      return parentMeta.hasPy;
    case 'bin':
    case 'obj':
      return platform === 'win32' && parentMeta.hasCsproj;
    default:
      return false;
  }
}

/** @param {string} name */
export function isVenvName(name) {
  return name === '.venv' || name === 'venv';
}

export const DOCKER_FILE_NAMES = new Set(['docker.raw', 'ext4.vhdx', 'docker_data.vhdx']);

/** @param {string} platform */
export function installerExts(platform) {
  return platform === 'win32' ? new Set(['exe', 'msi', 'iso', 'zip']) : new Set(['dmg', 'pkg', 'iso', 'zip']);
}

export const LARGE_KINDS = ['video', 'image', 'audio', 'disk-image', 'archive', 'installer', 'vm', 'other'];
export const TYPE_LABELS = {
  video: '视频',
  image: '图片',
  audio: '音频',
  'disk-image': '磁盘镜像',
  archive: '压缩包',
  installer: '安装包',
  vm: '虚拟机磁盘',
  other: '其他',
  'dev-cache': '开发缓存',
};

const EXT_KIND = new Map();
for (const [kind, exts] of /** @type {[string, string[]][]} */ ([
  ['video', ['mp4', 'mov', 'mkv', 'avi', 'wmv', 'flv', 'm4v', 'webm', 'mpg', 'mpeg', 'm2ts', 'mts', '3gp']],
  ['image', ['jpg', 'jpeg', 'png', 'gif', 'heic', 'heif', 'webp', 'tif', 'tiff', 'bmp', 'raw', 'cr2', 'cr3', 'nef', 'arw', 'dng', 'psd', 'svg']],
  ['audio', ['mp3', 'm4a', 'aac', 'wav', 'flac', 'aif', 'aiff', 'ogg', 'opus', 'wma', 'ape']],
  ['disk-image', ['dmg', 'iso', 'img']],
  ['archive', ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst']],
  ['installer', ['pkg', 'exe', 'msi']],
  ['vm', ['vmdk', 'vdi', 'qcow2', 'vhdx', 'vhd']],
])) {
  for (const e of exts) EXT_KIND.set(e, kind);
}

/** @param {string} name */
export function extOf(name) {
  const i = name.lastIndexOf('.');
  if (i <= 0 || i === name.length - 1) return '';
  return name.slice(i + 1).toLowerCase();
}

/** @param {string} name */
export function fileKind(name) {
  return EXT_KIND.get(extOf(name)) || 'other';
}

/** macOS 上深度扫描要跳过的路径（避免重复统计数据卷；/.vol、/.resolve、/.nofollow 是按 inode 或按标志解析路径的特殊目录）。 */
export const MAC_SKIP = ['/System/Volumes', '/Volumes', '/dev', '/net', '/home', '/.vol', '/.resolve', '/.nofollow'];

/** macOS 只读系统卷上的顶层目录。 */
export const MAC_SYSVOL = ['/System', '/usr', '/bin', '/sbin'];

/** /usr/share/firmlinks 读不到时使用的默认列表（系统卷目录里映射到数据卷的部分）。 */
export const MAC_FIRMLINKS_DEFAULT = [
  '/System/Library/Caches',
  '/System/Library/Assets',
  '/System/Library/PreinstalledAssets',
  '/System/Library/AssetsV2',
  '/System/Library/PreinstalledAssetsV2',
  '/System/Library/CoreServices/CoreTypes.bundle/Contents/Library',
  '/System/Library/Speech',
  '/usr/local',
  '/usr/libexec/cups',
  '/usr/share/snmp',
];

/** 解析 /usr/share/firmlinks（每行「系统卷路径<Tab>数据卷相对路径」）。 @param {string} text */
export function parseFirmlinks(text) {
  return text
    .split('\n')
    .map((l) => l.split('\t')[0].trim())
    .filter((p) => p.startsWith('/'));
}

/**
 * 规则索引：每个特殊路径一个对象，遍历时按目录 key 查一次。
 * @param {{ specs: (ResolvedSpec & { path: string })[], pathOps: import('./util.mjs').PathOps, platform: string, protectedKeys: string[], trashKeys?: string[], skipPaths?: string[], noDupPaths?: string[], sysVolPaths?: string[], dataVolPaths?: string[], noPatternPaths?: string[] }} o
 */
export function buildRuleIndex(o) {
  const { specs, pathOps, platform, protectedKeys, trashKeys = [], skipPaths = [], noDupPaths = [], sysVolPaths = [], dataVolPaths = [], noPatternPaths = [] } = o;
  /** @type {Map<string, any>} */
  const specials = new Map();
  const get = (/** @type {string} */ k) => {
    let s = specials.get(k);
    if (!s) {
      s = { cf: 0, target: null, childrenRule: null, pass: false, skip: false, thumbs: false, quick: false, dataVol: false };
      specials.set(k, s);
    }
    return s;
  };
  /** @type {string[]} */
  const quick = [];
  /** @type {string[]} */
  const remainderRoots = [];
  for (const s of specs) {
    const k = pathOps.key(s.path);
    const sp = get(k);
    quick.push(s.path);
    if (s.devCache) sp.cf |= CF.DEVCACHE | CF.NODUP;
    if (s.cat === 'pnpm-store') sp.cf |= CF.CLONE_SOURCE;
    switch (s.mode) {
      case 'children':
        sp.childrenRule = { kind: s.cat === 'temp' ? 'temp' : 'derived', cat: s.cat, name: s.name, ageDays: s.ageDays || 0 };
        break;
      case 'remainder':
        sp.childrenRule = { kind: 'remainder', cat: s.cat, name: s.name };
        remainderRoots.push(k);
        break;
      case 'installers':
        sp.cf |= CF.INSTALLER;
        break;
      case 'thumbs':
        sp.thumbs = true;
        break;
      case 'scan':
        break;
      default:
        sp.target = { cat: s.cat, name: s.name, app: s.app || null, chat: !!s.chat };
        sp.cf |= CF.CLAIMED;
    }
    if (s.cat === 'trash') sp.cf |= CF.NODUP | CF.NOLARGE;
  }
  // remainder 根目录下：规则目标的各级祖先只做「穿透」，它们的其余子目录仍按应用缓存列出。
  for (const rk of remainderRoots) {
    const rule = specials.get(rk).childrenRule;
    for (const [k, sp] of [...specials.entries()]) {
      if (!sp.target || !pathOps.inside(k, rk)) continue;
      let cur = k;
      for (;;) {
        const parent = pathOps.key(pathOps.dirname(cur));
        if (parent === rk || parent === cur) break;
        const psp = get(parent);
        psp.pass = true;
        if (!psp.childrenRule) psp.childrenRule = rule;
        cur = parent;
      }
    }
  }
  for (const k of protectedKeys) get(k).cf |= CF.PROTECTED | CF.NODUP;
  for (const k of trashKeys) get(k).cf |= CF.NODUP | CF.NOLARGE;
  for (const p of skipPaths) get(pathOps.key(p)).skip = true;
  for (const p of noDupPaths) get(pathOps.key(p)).cf |= CF.NODUP;
  for (const p of sysVolPaths) get(pathOps.key(p)).cf |= CF.SYSVOL;
  for (const p of dataVolPaths) get(pathOps.key(p)).dataVol = true;
  for (const p of noPatternPaths) get(pathOps.key(p)).cf |= CF.NO_PATTERN;
  if (platform === 'darwin') {
    // 系统目录不参与重复文件比对。
    for (const p of ['/System', '/Library', '/usr', '/bin', '/sbin', '/private', '/Applications']) get(pathOps.key(p)).cf |= CF.NODUP;
  }

  // 快速扫描的根：去掉嵌套在其他根里的路径。
  const sorted = [...new Set(quick.map((p) => pathOps.norm(p)))].sort((a, b) => a.length - b.length);
  /** @type {string[]} */
  const roots = [];
  for (const p of sorted) {
    const k = pathOps.key(p);
    if (roots.some((r) => pathOps.sameOrInside(k, pathOps.key(r)))) continue;
    roots.push(p);
  }

  /** 路径自身和所有祖先的继承位（从根往下算，firmlink 的数据卷目录清掉 SYSVOL）。 @param {string} p */
  function ancestorCf(p) {
    /** @type {string[]} */
    const chain = [];
    let k = pathOps.key(p);
    for (;;) {
      chain.push(k);
      const parent = pathOps.key(pathOps.dirname(k));
      if (parent === k) break;
      k = parent;
    }
    let cf = 0;
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      if (i > 0 && NO_PATTERN_PARENTS.has(pathOps.basename(chain[i]))) cf |= CF.NO_PATTERN;
      const sp = specials.get(chain[i]);
      if (!sp) continue;
      cf |= sp.cf;
      if (sp.dataVol) cf &= ~CF.SYSVOL;
      if (i > 0 && (sp.childrenRule || sp.target)) cf |= CF.CLAIMED;
    }
    return cf;
  }

  /**
   * 给测试和排查用：说明一个路径会被哪条规则认领。
   * @param {string} p
   */
  function lookup(p) {
    const k = pathOps.key(p);
    const sp = specials.get(k);
    if (sp && sp.target) return { category: sp.target.cat, name: sp.target.name, via: 'target' };
    const parentKey = pathOps.key(pathOps.dirname(p));
    const psp = specials.get(parentKey);
    if (psp && psp.childrenRule) {
      const r = psp.childrenRule;
      if (r.kind === 'remainder' && sp && sp.pass) return null;
      return { category: r.cat, name: r.name, via: r.kind };
    }
    const cf = ancestorCf(p);
    if (cf & CF.INSTALLER && installerExts(platform).has(extOf(p))) return { category: 'installers', name: '旧安装包', via: 'installers' };
    if (psp && psp.thumbs && /^thumbcache_.*\.db$/i.test(pathOps.basename(p))) return { category: 'thumbnails', name: '缩略图缓存', via: 'thumbs' };
    if (DOCKER_FILE_NAMES.has(pathOps.basename(p).toLowerCase())) return { category: 'docker', name: 'Docker 磁盘镜像', via: 'file-name' };
    return null;
  }

  return { specials, quickRoots: roots, ancestorCf, lookup, specs };
}
