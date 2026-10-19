// @ts-check
// 平台适配：磁盘列表、完全磁盘访问权限、Go 模块缓存路径、正在运行的应用、在访达或资源管理器中显示、系统动作。
import { createHash } from 'node:crypto';
import { getEnv } from './util.mjs';

/** @param {string} platform */
export function labelsFor(platform) {
  return platform === 'win32' ? { trash: '回收站', fileManager: '资源管理器' } : { trash: '废纸篓', fileManager: '访达' };
}

/** @param {any} fs @param {string} p */
async function capacity(fs, p) {
  const s = await fs.statfs(p);
  return {
    totalBytes: s.blocks * s.bsize,
    usedBytes: (s.blocks - s.bfree) * s.bsize,
    freeBytes: s.bavail * s.bsize,
  };
}

/**
 * 解析 `df -k <挂载点>` 的最后一行：Filesystem 1024-blocks Used Available ...
 * @param {string} text
 */
export function parseDfK(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return null;
  const nums = lines[lines.length - 1].trim().split(/\s+/);
  // 文件系统名里可能有空格，从左往右找第一个连续三个整数的位置
  for (let i = 1; i + 2 < nums.length; i += 1) {
    const [a, b, c] = [nums[i], nums[i + 1], nums[i + 2]].map(Number);
    if ([nums[i], nums[i + 1], nums[i + 2]].every((x) => /^\d+$/.test(x))) {
      return { totalBytes: a * 1024, usedBytes: b * 1024, freeBytes: c * 1024 };
    }
  }
  return null;
}

/**
 * macOS 卷容量：APFS 上 Node 的 statfs 把 bfree 报成和 bavail 一样（整个容器的剩余空间），
 * 算出的「已用」包含系统卷、Preboot、VM 等其他卷。df 报告的是这个卷自己的已用空间，和访达、df 一致。
 * @param {any} fs @param {import('./exec.mjs').Runner} exec @param {string} p
 */
async function macCapacity(fs, exec, p) {
  const r = await exec.run('/bin/df', ['-k', p], { timeoutMs: 5000, code: 'df' });
  const parsed = r.ok ? parseDfK(r.stdout) : null;
  return parsed || capacity(fs, p);
}

/** @param {string} text */
export function parseMacMount(text) {
  /** @type {Map<string, { type: string, local: boolean }>} */
  const map = new Map();
  for (const line of text.split('\n')) {
    const m = /^(.+?) on (.+) \(([^)]*)\)$/.exec(line.trim());
    if (!m) continue;
    const opts = m[3].split(',').map((s) => s.trim());
    map.set(m[2], { type: opts[0] || '', local: opts.includes('local') });
  }
  return map;
}

/** @param {{ fs: any, exec: import('./exec.mjs').Runner }} o */
export async function listDisksMac(o) {
  const { fs, exec } = o;
  let dataMount = '/';
  try {
    await fs.access('/System/Volumes/Data');
    dataMount = '/System/Volumes/Data';
  } catch {
    // 旧系统没有独立数据卷
  }
  const cap = await macCapacity(fs, exec, dataMount);
  let label = 'Macintosh HD';
  /** @type {string[]} */
  const others = [];
  try {
    const ents = await fs.readdir('/Volumes', { withFileTypes: true });
    for (const d of ents) {
      const full = `/Volumes/${d.name}`;
      if (d.isSymbolicLink()) {
        try {
          if ((await fs.readlink(full)) === '/') label = d.name;
        } catch {
          // 忽略
        }
      } else if (d.isDirectory()) others.push(full);
    }
  } catch {
    // 忽略
  }
  const disks = [{ id: 'mac-data', label, mount: '/', ...cap, kind: 'internal', defaultScan: true, deletable: true }];
  if (others.length) {
    const r = await exec.run('/sbin/mount', [], { timeoutMs: 5000, code: 'mount' });
    const mounts = r.ok ? parseMacMount(r.stdout) : new Map();
    for (const m of others) {
      const info = mounts.get(m);
      if (!info) continue;
      let c;
      try {
        c = await macCapacity(fs, exec, m);
      } catch {
        continue;
      }
      const id = `mac-vol-${createHash('sha1').update(m).digest('hex').slice(0, 8)}`;
      disks.push({ id, label: m.slice('/Volumes/'.length), mount: m, ...c, kind: info.local ? 'external' : 'network', defaultScan: false, deletable: false });
    }
  }
  return disks;
}

/** @param {string} stdout */
export function parseWinDisks(stdout) {
  let v;
  try {
    v = JSON.parse(stdout.trim());
  } catch {
    return null;
  }
  const arr = Array.isArray(v) ? v : [v];
  const disks = [];
  for (const d of arr) {
    if (!d || typeof d.DeviceID !== 'string') continue;
    const kind = d.DriveType === 3 ? 'internal' : d.DriveType === 2 ? 'external' : d.DriveType === 4 ? 'network' : null;
    if (!kind) continue;
    const total = Number(d.Size) || 0;
    const free = Number(d.FreeSpace) || 0;
    const letter = d.DeviceID.replace(':', '').toLowerCase();
    const name = d.VolumeName || (kind === 'internal' ? '本地磁盘' : kind === 'external' ? '可移动磁盘' : '网络驱动器');
    disks.push({
      id: `win-${letter}`,
      label: `${name} (${d.DeviceID})`,
      mount: `${d.DeviceID}\\`,
      totalBytes: total,
      usedBytes: Math.max(0, total - free),
      freeBytes: free,
      kind,
      defaultScan: kind === 'internal',
      deletable: kind === 'internal',
    });
  }
  return disks;
}

/** @param {{ fs: any, exec: import('./exec.mjs').Runner, env: Record<string, string | undefined> }} o */
export async function listDisksWin(o) {
  const r = await o.exec.run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,DriveType,Size,FreeSpace,VolumeName | ConvertTo-Json -Compress'],
    { timeoutMs: 15000, code: 'powershell-disks' },
  );
  const parsed = r.ok ? parseWinDisks(r.stdout) : null;
  if (parsed && parsed.length) return parsed;
  // 退路：只列系统盘。
  const drive = (getEnv(o.env, 'SystemDrive') || 'C:').replace(/\\$/, '');
  try {
    const c = await capacity(o.fs, `${drive}\\`);
    return [{ id: `win-${drive[0].toLowerCase()}`, label: `本地磁盘 (${drive})`, mount: `${drive}\\`, ...c, kind: 'internal', defaultScan: true, deletable: true }];
  } catch {
    return [];
  }
}

/** macOS：读取 Safari 或 Mail 目录判断完全磁盘访问权限。 @param {{ fs: any, home: string }} o */
export async function checkFullDiskAccess(o) {
  for (const name of ['Safari', 'Mail']) {
    try {
      await o.fs.readdir(`${o.home}/Library/${name}`);
      return 'granted';
    } catch (e) {
      const code = /** @type {any} */ (e).code;
      if (code === 'EPERM' || code === 'EACCES') return 'missing';
    }
  }
  return 'unknown';
}

/**
 * Go 模块缓存路径。go env 只读，但仍禁止它下载工具链（GOTOOLCHAIN=local），并在中立目录执行。
 * @param {{ platform: string, env: Record<string, string | undefined>, home: string, exec: import('./exec.mjs').Runner, pathOps: import('./util.mjs').PathOps, cwd?: string }} o
 */
export async function detectGoModCache(o) {
  const { platform, env, home, exec, pathOps } = o;
  const cands = platform === 'win32' ? ['go.exe', 'C:\\Program Files\\Go\\bin\\go.exe'] : ['go', '/usr/local/go/bin/go', '/opt/homebrew/bin/go', '/usr/local/bin/go'];
  const childEnv = { ...env, GOTOOLCHAIN: 'local', GOFLAGS: '' };
  for (const cmd of cands) {
    const r = await exec.run(cmd, ['env', 'GOMODCACHE'], { timeoutMs: 5000, code: 'go-env', cwd: o.cwd, env: childEnv });
    const v = r.ok ? r.stdout.trim() : '';
    if (v && pathOps.isAbsolute(v)) return pathOps.norm(v);
  }
  const gopath = getEnv(env, 'GOPATH');
  if (gopath) {
    const first = gopath.split(platform === 'win32' ? ';' : ':')[0];
    if (first && pathOps.isAbsolute(first)) return pathOps.join(pathOps.join(pathOps.norm(first), 'pkg'), 'mod');
  }
  return pathOps.join(pathOps.join(pathOps.join(home, 'go'), 'pkg'), 'mod');
}

const APP_PROCESS_NAMES = {
  chrome: ['google chrome', 'chrome.exe'],
  edge: ['microsoft edge', 'msedge.exe'],
  firefox: ['firefox', 'firefox.exe'],
  wechat: ['wechat', 'weixin', 'wechat.exe', 'weixin.exe'],
  dingtalk: ['dingtalk', '钉钉', 'dingtalk.exe'],
  lark: ['lark', 'feishu', '飞书', 'feishu.exe', 'lark.exe'],
  meeting: ['tencentmeeting', 'wemeet', '腾讯会议', 'wemeetapp.exe'],
  qq: ['qq', 'qq.exe'],
  wework: ['wework', '企业微信', 'wxwork.exe'],
  vscode: ['code.exe'],
  slack: ['slack', 'slack.exe'],
  teams: ['ms-teams.exe', 'teams.exe', 'microsoft teams'],
  discord: ['discord', 'discord.exe'],
  spotify: ['spotify', 'spotify.exe'],
};

/** 正在运行的已知应用（用于 in-use 标签）。 @param {{ platform: string, exec: import('./exec.mjs').Runner }} o */
export async function detectRunningApps(o) {
  /** @type {Set<string>} */
  const names = new Set();
  if (o.platform === 'darwin') {
    const r = await o.exec.run('/bin/ps', ['-axco', 'comm'], { timeoutMs: 5000, code: 'ps' });
    if (r.ok) for (const line of r.stdout.split('\n')) if (line.trim()) names.add(line.trim().toLowerCase());
  } else if (o.platform === 'win32') {
    const r = await o.exec.run('tasklist.exe', ['/fo', 'csv', '/nh'], { timeoutMs: 10000, code: 'tasklist' });
    if (r.ok) for (const line of r.stdout.split(/\r?\n/)) {
      const m = /^"([^"]+)"/.exec(line);
      if (m) names.add(m[1].toLowerCase());
    }
  }
  /** @type {Set<string>} */
  const running = new Set();
  for (const [app, procs] of Object.entries(APP_PROCESS_NAMES)) if (procs.some((p) => names.has(p))) running.add(app);
  return running;
}

export const SYSTEM_ACTIONS = ['mac-storage-settings', 'mac-full-disk-access', 'win-storage-settings', 'win-disk-cleanup'];

const PICK_TIMEOUT_MS = 10 * 60 * 1000;
const MAC_PICK_SCRIPT = 'POSIX path of (choose folder with prompt "选择要扫描的文件夹")';
/** 固定脚本，不含双引号；所选路径用 UTF-8 的 base64 输出，不受控制台编码影响。 */
export const WIN_PICK_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms',
  '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
  "$d.Description = '选择要扫描的文件夹'",
  '$d.ShowNewFolderButton = $false',
  'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $b = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($d.SelectedPath)); ConvertTo-Json -InputObject @{ b64 = $b } -Compress } else { ConvertTo-Json -InputObject @{ cancelled = $true } -Compress }',
].join('; ');

/**
 * 解析选择框的输出。返回 { path } 或 { cancelled: true }；打不开时返回 null。
 * @param {string} platform @param {{ ok: boolean, stdout: string, stderr: string, error: string | null }} r
 */
export function parsePickResult(platform, r) {
  if (platform === 'darwin') {
    if (r.ok) {
      const p = r.stdout.trim();
      return p ? { path: p } : { cancelled: true };
    }
    if (/-128/.test(r.stderr) || r.error === 'timeout') return { cancelled: true };
    return null;
  }
  if (r.error === 'timeout') return { cancelled: true };
  if (!r.ok) return null;
  try {
    const v = JSON.parse(r.stdout.trim());
    if (v && v.cancelled) return { cancelled: true };
    if (v && typeof v.b64 === 'string') return { path: Buffer.from(v.b64, 'base64').toString('utf8') };
  } catch {
    // 输出不是 JSON
  }
  return null;
}

/**
 * @param {{ platform: string, env: Record<string, string | undefined>, home: string, fs: any, exec: import('./exec.mjs').Runner, pathOps: import('./util.mjs').PathOps, cwd?: string }} o
 */
export function createSystem(o) {
  const { platform, env, home, fs, exec, pathOps } = o;
  const mac = platform === 'darwin';
  const win = platform === 'win32';
  return {
    labels: labelsFor(platform),
    listDisks: mac ? () => listDisksMac({ fs, exec }) : win ? () => listDisksWin({ fs, exec, env }) : async () => [],
    fullDiskAccess: mac ? () => checkFullDiskAccess({ fs, home }) : async () => 'unknown',
    goModCache: () => detectGoModCache({ platform, env, home, exec, pathOps, cwd: o.cwd }),
    runningApps: () => detectRunningApps({ platform, exec }),
    /** @param {string} p */
    async reveal(p) {
      if (mac) {
        const r = await exec.run('/usr/bin/open', ['-R', p], { timeoutMs: 10000, code: 'open-reveal' });
        return r.ok;
      }
      if (win) return exec.launch('explorer.exe', [`/select,"${p}"`], { verbatim: true });
      return false;
    },
    /**
     * 打开系统自带的文件夹选择框，最多等 10 分钟。返回 { path } / { cancelled: true }，打不开时返回 null。
     * @returns {Promise<{ path?: string, cancelled?: boolean } | null>}
     */
    async pickFolder() {
      if (mac) {
        const r = await exec.run('/usr/bin/osascript', ['-e', MAC_PICK_SCRIPT], { timeoutMs: PICK_TIMEOUT_MS, code: 'osascript-pick' });
        return parsePickResult('darwin', r);
      }
      if (win) {
        const r = await exec.run('powershell.exe', ['-STA', '-NoProfile', '-Command', WIN_PICK_SCRIPT], { timeoutMs: PICK_TIMEOUT_MS, code: 'powershell-pick' });
        return parsePickResult('win32', r);
      }
      return null;
    },
    /** 快速预览（只限 macOS），以分离模式启动，最多开 10 分钟。 @param {string} p */
    async preview(p) {
      if (!mac) return false;
      return exec.launch('/usr/bin/qlmanage', ['-p', p], { killAfterMs: 10 * 60 * 1000 });
    },
    /** @param {string} action */
    async systemAction(action) {
      switch (action) {
        case 'mac-storage-settings':
          return (await exec.run('/usr/bin/open', ['x-apple.systempreferences:com.apple.settings.Storage'], { timeoutMs: 10000, code: 'open-settings' })).ok;
        case 'mac-full-disk-access':
          return (await exec.run('/usr/bin/open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'], { timeoutMs: 10000, code: 'open-settings' })).ok;
        case 'win-storage-settings':
          return exec.launch('explorer.exe', ['ms-settings:storagesense']);
        case 'win-disk-cleanup':
          return exec.launch('cleanmgr.exe', []);
        default:
          return false;
      }
    },
  };
}
