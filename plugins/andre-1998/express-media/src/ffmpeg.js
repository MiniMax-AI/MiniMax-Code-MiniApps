// ffmpeg / ffprobe 的发现与执行层。
//
// 这里刻意解决一个真实踩过的坑：Windows 上 winget 升级后，%LOCALAPPDATA%\Microsoft\WinGet\Links
// 里的 ffmpeg.exe 会变成悬空符号链接——`where ffmpeg` 能查到、`Get-Command ffmpeg` 能解析出路径，
// 但一执行就报「系统找不到指定的文件」。只看「路径能不能解析」是不够的，**必须真的执行一次**。
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const IS_WIN = process.platform === 'win32';

/** 已知安装位置。顺序即优先级：先专用安装，再系统目录，最后才信 PATH。 */
function knownDirs(env = process.env) {
  const home = env.USERPROFILE || os.homedir();
  const dirs = [];
  if (env.EXPRESS_FFMPEG_DIR) dirs.push(env.EXPRESS_FFMPEG_DIR);
  if (IS_WIN) {
    // 常见的手动安装位置（winget 链接坏掉时的救命稻草）
    dirs.push(path.join(home, '.minimax', 'tools', 'ffmpeg'));
    dirs.push(path.join(home, 'scoop', 'apps', 'ffmpeg', 'current', 'bin'));
    dirs.push('C:\\ffmpeg\\bin', 'C:\\Program Files\\ffmpeg\\bin');
    if (env.LOCALAPPDATA) {
      dirs.push(path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'));
    }
  } else if (process.platform === 'darwin') {
    dirs.push('/opt/homebrew/bin', '/usr/local/bin');
    if (env.HOMEBREW_PREFIX) dirs.push(path.join(env.HOMEBREW_PREFIX, 'bin'));
  } else {
    dirs.push('/usr/bin', '/usr/local/bin', '/snap/bin');
  }
  return dirs.filter(Boolean);
}

/** 展开目录：既接受直接指向 bin 的目录，也接受里面还有一层版本目录的目录。 */
function expandDir(dir) {
  const found = [];
  const direct = path.join(dir, IS_WIN ? 'ffmpeg.exe' : 'ffmpeg');
  if (existsSync(direct)) found.push(dir);
  else {
    // 形如 ~/.minimax/tools/ffmpeg/ffmpeg-9.0.2-essentials_build/bin
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const sub = path.join(dir, e.name, 'bin');
      if (existsSync(path.join(sub, IS_WIN ? 'ffmpeg.exe' : 'ffmpeg'))) found.push(sub);
    }
  }
  return found;
}

function whichAll(cmd) {
  // 用 shell 拿 PATH 上所有同名可执行文件（Windows 上 where.exe，类 Unix 用 command -v）
  return new Promise((resolve) => {
    const shellCmd = IS_WIN ? `where ${cmd}` : `command -v ${cmd}`;
    const p = spawn(shellCmd, { shell: true, windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', (code) => {
      resolve(
        code === 0
          ? out
              .split(/\r?\n/)
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
      );
    });
    p.on('error', () => resolve([]));
  });
}

/** 真的把二进制跑起来。返回 null 表示「路径在但跑不通」——这正是悬空链接的情形。 */
export function tryRun(bin, args = ['-version'], { timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    let p;
    try {
      p = spawn(bin, args, { windowsHide: true });
    } catch (err) {
      resolve({ ok: false, reason: err.code || 'spawn-failed', error: err.message });
      return;
    }
    let out = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { p.kill(); } catch { /* 已经退了 */ }
      resolve({ ok: false, reason: 'timeout' });
    }, timeoutMs);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, reason: err.code === 'ENOENT' ? 'enoent' : err.code || 'error', error: err.message });
    });
    p.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve({ ok: true, version: parseVersion(out) });
      else resolve({ ok: false, reason: 'exit-' + code, output: out.slice(0, 400) });
    });
  });
}

function firstLine(s) {
  const line = String(s).split(/\r?\n/).find((l) => l.trim());
  return line ? line.trim() : '';
}

/**
 * 从 ffmpeg 的版本横幅里只取版本号。
 * 整行横幅是 "ffmpeg version 9.0.2-... Copyright (C) 2020-2026 the FFmpeg developers"，
 * 直接回显给用户既吵又掺进一堆英文（界面承诺是中文），所以这里剥掉。
 */
export function parseVersion(banner) {
  const line = firstLine(banner);
  const m = /version\s+(\S+)/i.exec(line);
  return m ? m[1] : line;
}

function basename(p) {
  return path.basename(p);
}

/**
 * 找一个真正能跑的 ffmpeg（以及同目录的 ffprobe）。
 * 返回 { ffmpeg, ffprobe, rejected[] }——rejected 记录「解析得到但跑不通」的候选，
 * 这样 doctor 能把真实原因讲出来，而不是笼统地报「找不到 ffmpeg」。
 */
export async function resolveBinaries({ env = process.env, required = ['ffmpeg', 'ffprobe'] } = {}) {
  const rejected = [];
  const candidates = new Map(); // 绝对路径 → 来源说明

  const addFromEnv = (name) => {
    const v = env[`EXPRESS_${name.toUpperCase()}`];
    if (v) candidates.set(path.resolve(v), `环境变量 EXPRESS_${name.toUpperCase()}`);
  };
  required.forEach(addFromEnv);

  for (const dir of knownDirs(env)) {
    for (const d of expandDir(dir)) {
      for (const name of required) {
        const bin = path.join(d, IS_WIN ? `${name}.exe` : name);
        if (existsSync(bin) && !candidates.has(bin)) candidates.set(bin, `已知安装位置 ${d}`);
      }
    }
  }

  for (const name of required) {
    for (const p of await whichAll(name)) {
      const abs = path.resolve(p);
      if (!candidates.has(abs)) candidates.set(abs, 'PATH');
    }
  }

  const found = {};
  for (const name of required) {
    // 全都探一遍，而不是找到一个就收工：把「别的候选其实是坏的」这件事也报出来，
    // 否则用户只会看到「一切正常」，然后在别的工具里踩同一个坑。
    // 注意悬空符号链接对 existsSync 是不可见的（existsSync 跟随链接、目标没了就返回 false），
    // 所以这类坏路径只能靠「where 列出来 + 真的执行一次」发现。
    let hit = null;
    const probedDirs = new Set();
    for (const [bin, from] of candidates) {
      if (basename(bin).replace(/\.exe$/i, '') !== name) continue;
      const dir = path.dirname(bin);
      if (probedDirs.has(dir)) continue; // 同一个目录只探一次
      probedDirs.add(dir);
      const r = await tryRun(bin, ['-version']);
      if (r.ok) {
        if (!hit) hit = { path: bin, version: r.version, source: from };
      } else {
        rejected.push({ name, path: bin, from, reason: r.reason, error: r.error });
      }
    }
    if (!hit) {
      return { ffmpeg: found.ffmpeg || null, ffprobe: found.ffprobe || null, rejected, missing: name };
    }
    found[name] = hit;
  }
  return { ffmpeg: found.ffmpeg, ffprobe: found.ffprobe, rejected };
}

const TIME_RE = /time=\s*(-?)(\d+):(\d+):(\d+(?:\.\d+)?)/;

/** 解析 ffmpeg 进度行里的 time=HH:MM:SS.ss */
export function parseFfmpegTime(line) {
  const m = TIME_RE.exec(line);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]));
}

/**
 * 跑一个 ffmpeg / ffprobe 进程。stderr 收日志（ffmpeg 把它当日志通道），stdout 按需收集。
 */
export function run(bin, args, { onProgress, durationSec, maxBuffer = 32 * 1024 * 1024, signal } = {}) {
  return new Promise((resolve, reject) => {
    let p;
    try {
      p = spawn(bin, args, { windowsHide: true, maxBuffer });
    } catch (err) {
      reject(Object.assign(new Error(`无法启动 ${basename(bin)}：${err.message}`), { code: err.code }));
      return;
    }
    let stdout = '';
    const chunks = [];
    let bytes = 0;
    let stderrTail = '';
    let progress = { seconds: 0, ratio: null };
    let onAbort;
    if (signal) {
      if (signal.aborted) { try { p.kill(); } catch { /* noop */ } }
      onAbort = () => { try { p.kill(); } catch { /* noop */ } };
      signal.addEventListener('abort', onAbort, { once: true });
    }
    p.stdout.on('data', (d) => {
      chunks.push(d);
      bytes += d.length;
      if (bytes > maxBuffer) { try { p.kill(); } catch { /* noop */ } return; }
      stdout += d.toString('utf8');
    });
    p.stderr.on('data', (d) => {
      const s = d.toString();
      stderrTail = (stderrTail + s).slice(-8000);
      if (onProgress) {
        for (const line of s.split(/\r?\n|\r/)) {
          const t = parseFfmpegTime(line);
          if (t !== null) {
            progress = { seconds: t, ratio: durationSec ? Math.max(0, Math.min(1, t / durationSec)) : null };
            onProgress(progress);
          }
        }
      }
    });
    p.on('error', (err) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(Object.assign(new Error(`无法执行 ${basename(bin)}：${err.message}（路径：${bin}）`), { code: err.code, bin }));
    });
    p.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      // stdout 是给 ffprobe / 文本输出用的字符串；stdoutBuffer 是给抽帧这种二进制场景用的
      resolve({ code, stdout, stdoutBuffer: Buffer.concat(chunks), stderr: stderrTail });
    });
  });
}

export const IS_WINDOWS = IS_WIN;
