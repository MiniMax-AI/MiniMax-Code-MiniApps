// 环境探测：去哪找 gh / git，AI 的工作文件夹能不能用。
// 「去哪找」只在这一个文件里；env / platform / homedir 都能注入，所以能在测试里模拟别人的机器。
import { spawn } from 'node:child_process';
import { access, constants, mkdir, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { isAbsolute, posix, resolve, sep, win32 } from 'node:path';
import { homedir as osHomedir } from 'node:os';
import { randomBytes } from 'node:crypto';

/** 真实环境；测试里换成假的 */
export function realEnv() {
  return { platform: process.platform, env: process.env, homedir: osHomedir() };
}

const lib = (platform) => (platform === 'win32' ? win32 : posix);

/** PATH 里的目录。只要绝对路径：相对路径意味着「当前目录」，不能拿来找要运行的程序 */
export function pathEntries(ctx = realEnv()) {
  const p = lib(ctx.platform);
  const raw = String((ctx.env && (ctx.env.PATH ?? ctx.env.Path ?? ctx.env.path)) || '');
  return raw
    .split(ctx.platform === 'win32' ? ';' : ':')
    .map((s) => s.trim().replace(/^"(.*)"$/, '$1'))
    .filter((s) => s && p.isAbsolute(s));
}

/** 各系统上常见的安装位置（PATH 之外的）。图形界面启动的程序 PATH 常常很短，所以要补这些 */
export function extraDirs(ctx = realEnv()) {
  if (Array.isArray(ctx.commonDirs)) return ctx.commonDirs.slice(); // 测试里指定
  const p = lib(ctx.platform);
  const e = ctx.env || {};
  const home = ctx.homedir || '';
  if (ctx.platform === 'win32') {
    const pf = e.ProgramFiles || 'C:\\Program Files';
    const pf86 = e['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const local = e.LOCALAPPDATA || (home ? p.join(home, 'AppData', 'Local') : '');
    const scoop = e.SCOOP || (home ? p.join(home, 'scoop') : '');
    const choco = e.ChocolateyInstall || 'C:\\ProgramData\\chocolatey';
    return [
      p.join(pf, 'GitHub CLI'),
      p.join(pf86, 'GitHub CLI'),
      p.join(pf, 'Git', 'cmd'),
      p.join(pf, 'Git', 'bin'),
      p.join(pf86, 'Git', 'cmd'),
      local && p.join(local, 'Programs', 'GitHub CLI'),
      local && p.join(local, 'Programs', 'Git', 'cmd'),
      scoop && p.join(scoop, 'shims'),
      p.join(choco, 'bin'),
    ].filter(Boolean);
  }
  const dirs = [
    '/opt/homebrew/bin', // macOS（Apple 芯片）的 Homebrew
    '/usr/local/bin', // macOS（Intel）的 Homebrew、手动安装
    '/usr/bin',
    '/bin',
    '/opt/local/bin', // MacPorts
    '/home/linuxbrew/.linuxbrew/bin', // Linuxbrew
    '/snap/bin',
    '/nix/var/nix/profiles/default/bin',
  ];
  if (e.HOMEBREW_PREFIX) dirs.unshift(p.join(e.HOMEBREW_PREFIX, 'bin'));
  if (home) dirs.push(p.join(home, '.local', 'bin'), p.join(home, 'bin'), p.join(home, '.nix-profile', 'bin'), p.join(home, '.linuxbrew', 'bin'));
  return dirs;
}

/** 要找的目录，按优先级：PATH → 额外给的（登录 shell 的 PATH）→ 常见位置；去重、保持顺序 */
export function searchDirs(ctx = realEnv(), more = []) {
  const p = lib(ctx.platform);
  const key = (d) => (ctx.platform === 'win32' ? d.toLowerCase() : d);
  const seen = new Set();
  const out = [];
  for (const d of [...pathEntries(ctx), ...more, ...extraDirs(ctx)]) {
    if (!d || !p.isAbsolute(d) || seen.has(key(d))) continue;
    seen.add(key(d));
    out.push(d);
  }
  return out;
}

/** Windows 只认 .exe / .com：.cmd、.bat 不经过 shell 没法直接启动（Node 会拒绝），所以不当成可用的 gh / git */
export function exeNames(name, platform) {
  return platform === 'win32' ? [name + '.exe', name + '.com'] : [name];
}

async function isRunnable(file, platform) {
  try {
    const s = await stat(file);
    if (!s.isFile()) return false;
    if (platform === 'win32') return true;
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** 所有可能的候选，按优先级排好；via 说明是在哪找到的：path / shell / common */
export async function locateAll(name, { ctx = realEnv(), shellDirs = [] } = {}) {
  const p = lib(ctx.platform);
  const fromPath = new Set(pathEntries(ctx));
  const fromShell = new Set(shellDirs);
  const seen = new Set();
  const out = [];
  for (const dir of searchDirs(ctx, shellDirs)) {
    for (const fileName of exeNames(name, ctx.platform)) {
      const file = p.join(dir, fileName);
      const k = ctx.platform === 'win32' ? file.toLowerCase() : file;
      if (seen.has(k)) continue;
      if (await isRunnable(file, ctx.platform)) {
        seen.add(k);
        out.push({ path: file, via: fromPath.has(dir) ? 'path' : fromShell.has(dir) ? 'shell' : 'common' });
      }
    }
  }
  return out;
}

/**
 * 运行一个命令，拿它的标准输出。不抛错，返回 { stdout, error }。
 * 用 spawn 而不用 execFile：execFile 要等输出管道全关了才返回，命令（或登录 shell 的 rc 文件）
 * 在后台留个子进程占着管道，它就会一直等下去。这里「进程退出 / 超时 / 取消」任何一个先到就返回。
 */
function execText(file, args, { timeoutMs = 8000, signal, env, maxBuffer = 1024 * 1024 } = {}) {
  return new Promise((resolveText) => {
    let settled = false;
    let stdout = '';
    let child = null;
    let timer = null;
    let grace = null;
    const onAbort = () => {
      kill();
      done(new Error('aborted'));
    };
    const kill = () => {
      try {
        child?.kill('SIGKILL');
      } catch {
        /* 已经退出了 */
      }
    };
    const done = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(grace);
      signal?.removeEventListener('abort', onAbort);
      try {
        child?.stdout?.destroy();
      } catch {
        /* 无所谓 */
      }
      resolveText({ stdout, error: error || null });
    };
    // 已经取消了（比如 Mini App 正在停止）：连进程都不要起，免得起了又马上杀
    if (signal?.aborted) {
      done(new Error('aborted'));
      return;
    }
    try {
      child = spawn(file, args, { env: env || process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (error) {
      done(error);
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      kill();
      done(new Error('timeout'));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > maxBuffer) {
        kill();
        done(new Error('too much output'));
      }
    });
    child.on('error', (error) => done(error));
    child.on('exit', (code) => {
      grace = setTimeout(() => done(code === 0 ? null : new Error('exit ' + code)), 200); // 给还没读完的输出一点时间
    });
    child.on('close', (code) => done(code === 0 ? null : new Error('exit ' + code)));
  });
}

/**
 * 真的能运行吗？返回版本号；不能运行、或输出不像是想要的那个程序，返回空字符串。
 * expect：输出里必须出现的样子（比如 gh 要有 "gh version"），免得把同名的别的程序当成 gh。
 */
export async function probeVersion(file, { signal, timeoutMs = 8000, env, expect } = {}) {
  const { stdout, error } = await execText(file, ['--version'], { timeoutMs, signal, env });
  if (error) return '';
  if (expect && !expect.test(stdout)) return '';
  const m = /(\d+\.\d+(?:\.\d+)?)/.exec(stdout);
  return m ? m[1] : '';
}

/** 是完整路径吗（按那个系统的规则判断；Windows 的 C:\ 在别的系统上不算） */
export const isAbsoluteFor = (platform, p) => lib(platform).isAbsolute(String(p || ''));

/** macOS：没装「命令行开发工具」时，/usr/bin/git 只是个占位程序，运行它会弹出安装窗口。先问一下，别去碰它 */
export const MAC_GIT_SHIM = '/usr/bin/git';
export async function xcodeToolsInstalled(ctx = realEnv(), { signal } = {}) {
  const { error } = await execText(ctx.xcodeSelect || '/usr/bin/xcode-select', ['-p'], { timeoutMs: 5000, signal, env: ctx.env });
  return !error;
}

const SHELLS = new Set(['bash', 'zsh', 'fish', 'sh', 'dash', 'ksh']);

/**
 * 你在终端里用的 PATH。图形界面启动的程序拿不到它，而 gh / git 常常装在终端 PATH 里才有的地方
 * （比如自己指定的 Homebrew 前缀、~/tools/bin、nvm / asdf / mise 的目录）。
 * 做法：用你自己的登录 shell 打印一次 PATH（和 VS Code 的做法一样），限时、失败就当没有。
 * 只用环境变量 SHELL 指向的常见 shell；传给它的命令是固定写死的，不含任何外部输入。
 */
export async function loginShellDirs(ctx = realEnv(), { timeoutMs = 6000, signal } = {}) {
  if (ctx.platform === 'win32') return [];
  const shell = ctx.env && ctx.env.SHELL;
  if (!shell || !posix.isAbsolute(shell) || !SHELLS.has(posix.basename(shell))) return [];
  const mark = '__SHELF_' + randomBytes(6).toString('hex') + '__';
  const script = "printf '%s' '" + mark + "'; printf '%s' \"$PATH\"; printf '%s' '" + mark + "'";
  const plain = ['sh', 'dash'].includes(posix.basename(shell));
  const { stdout } = await execText(shell, [plain ? '-lc' : '-ilc', script], { timeoutMs, signal, env: { ...ctx.env, TERM: 'dumb' } });
  const i = stdout.indexOf(mark);
  const j = stdout.lastIndexOf(mark);
  if (i < 0 || j <= i) return [];
  return stdout
    .slice(i + mark.length, j)
    .split(':')
    .map((s) => s.trim())
    .filter((s) => s && posix.isAbsolute(s));
}

/** 给页面看的安装指引（按系统） */
export function installHint(name, platform = process.platform) {
  if (name === 'gh') {
    if (platform === 'darwin') return '在终端运行 brew install gh，再运行 gh auth login';
    if (platform === 'win32') return '在终端运行 winget install GitHub.cli，再运行 gh auth login';
    return '按 https://cli.github.com 的说明安装 gh，再运行 gh auth login';
  }
  if (name === 'git') {
    if (platform === 'darwin') return '在终端运行 xcode-select --install';
    if (platform === 'win32') return '在终端运行 winget install Git.Git';
    return '用系统的包管理器安装 git（比如 apt install git）';
  }
  return '';
}

/**
 * 这个目录能当「放东西的地方」吗：存在（或建得出来）、能写、剩余空间够。
 * 返回 { ok, dir, freeMB?, reason? }；测试用的临时文件会删掉，不留痕迹。
 */
export async function checkWritableDir(dir, { needMB = 0 } = {}) {
  if (!dir || typeof dir !== 'string') return { ok: false, dir: '', reason: '还没有确定位置' };
  if (!isAbsolute(dir)) return { ok: false, dir, reason: '不是完整路径' };
  try {
    await mkdir(dir, { recursive: true });
    const probe = resolve(dir, '.write-test-' + process.pid + '-' + randomBytes(3).toString('hex'));
    await writeFile(probe, 'ok');
    await rm(probe, { force: true });
  } catch (error) {
    const code = error?.code || '';
    const reason = code === 'EACCES' || code === 'EPERM' ? '没有写入权限' : code === 'ENOSPC' ? '磁盘已满' : code === 'EROFS' ? '这个位置是只读的' : '不能写入（' + (code || '未知原因') + '）';
    return { ok: false, dir, reason };
  }
  let freeMB = null;
  try {
    const s = await statfs(dir);
    freeMB = Math.floor((Number(s.bavail) * Number(s.bsize)) / (1024 * 1024));
  } catch {
    /* 有些系统读不到剩余空间，不影响使用 */
  }
  if (freeMB !== null && needMB > 0 && freeMB < needMB) return { ok: false, dir, freeMB, reason: '剩余空间只有约 ' + freeMB + ' MB，不够' };
  return { ok: true, dir, freeMB };
}

/** target 严格在 root 里面吗？清理文件前用它防止误删到外面 */
export function isInside(root, target) {
  if (!root || !target) return false;
  const r = resolve(root);
  const t = resolve(target);
  return t !== r && t.startsWith(r.endsWith(sep) ? r : r + sep);
}
