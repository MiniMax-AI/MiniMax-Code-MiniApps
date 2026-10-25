// Local ffmpeg access for the media tools.
//
// The media tools (抽帧 / 宫格抽帧 / 片段剪辑 / 视频剪裁 / 音画分离 / 合并视频)
// are not provider features. The reference implementation runs them on the
// local ffmpeg binary, and this MiniApp does the same: the binary is looked
// up on the machine instead of being shipped, because a bundled ffmpeg is
// several times larger than the package size limit.
//
// Every command is spawned with an argument array and without a shell, every
// argument that carries user input is validated by the caller before it
// reaches a filter string, and every command is disclosed in README.md.
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readdir } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

const IS_WINDOWS = process.platform === 'win32';
const FFMPEG_NAME = IS_WINDOWS ? 'ffmpeg.exe' : 'ffmpeg';
const FFPROBE_NAME = IS_WINDOWS ? 'ffprobe.exe' : 'ffprobe';

const MAX_SEARCH_DEPTH = 4;
const DEFAULT_TIMEOUT_MS = 300_000;
// ffprobe writes a lot of metadata about a file — every tag of every stream —
// and a clip with a long tag list runs past a small cap. The cap is there for
// the case where a tool prints without end, so it is wide enough for a real
// answer and still bounded.
const MAX_CAPTURE_BYTES = 1024 * 1024;

async function isExecutable(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// A bounded walk, so a deep package folder cannot turn the lookup into a scan
// of the whole disk.
async function findInTree(dir, name, depth = 0) {
  if (depth > MAX_SEARCH_DEPTH) return null;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const nested = join(dir, entry.name);
    const candidate = join(nested, name);
    if (await isExecutable(candidate)) return candidate;
    const found = await findInTree(nested, name, depth + 1);
    if (found) return found;
  }
  return null;
}

function candidateRoots() {
  const roots = [];
  // An explicit override wins, so a user can point at a portable build.
  for (const key of ['NXC_FFMPEG', 'FFMPEG_PATH']) {
    const value = process.env[key];
    if (value) roots.push({ dir: value, file: null });
  }
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir) roots.push({ dir, file: null });
  }
  const local = process.env.LOCALAPPDATA;
  if (local) {
    roots.push({ dir: join(local, 'Microsoft', 'WinGet', 'Links'), file: null });
    roots.push({ dir: join(local, 'Microsoft', 'WinGet', 'Packages'), file: 'ffmpeg' });
  }
  if (IS_WINDOWS) {
    // Chocolatey puts its shims here, and a portable build often lands in
    // one of the two locations below.
    roots.push({ dir: 'C:\\ProgramData\\chocolatey\\bin', file: null });
    roots.push({ dir: 'C:\\Program Files\\ffmpeg\\bin', file: null });
    roots.push({ dir: 'C:\\ffmpeg\\bin', file: null });
  } else {
    roots.push({ dir: '/usr/local/bin', file: null });
    roots.push({ dir: '/opt/homebrew/bin', file: null });
    roots.push({ dir: '/usr/bin', file: null });
  }
  return roots;
}

async function locateBinary(name) {
  for (const root of candidateRoots()) {
    if (root.file === null) {
      const candidate = join(root.dir, name);
      if (await isExecutable(candidate)) return candidate;
      continue;
    }
    // A package folder, e.g. `.../WinGet/Packages/Gyan.FFmpeg...`.
    let entries;
    try {
      entries = await readdir(root.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!entry.name.toLowerCase().includes(root.file)) continue;
      const found = await findInTree(join(root.dir, entry.name), name);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Local ffmpeg access.
 *
 * The spawned children are tracked so `dispose()` can stop them: the Host
 * stops the Node entry, and a tool that is still encoding must not outlive
 * the board.
 */
export function createFfmpeg(context) {
  const children = new Set();
  let located = null;
  let locatedAt = 0;
  const LOCATE_TTL_MS = 30_000;

  async function locate(force = false) {
    const now = Date.now();
    if (!force && located && now - locatedAt < LOCATE_TTL_MS) return located;
    const ffmpeg = await locateBinary(FFMPEG_NAME);
    const ffprobe = ffmpeg ? await locateBinary(FFPROBE_NAME) : null;
    located = { ffmpeg, ffprobe };
    locatedAt = now;
    return located;
  }

  function spawnCapture(file, args, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    return new Promise((resolve, reject) => {
      // The argument array is passed through as-is and the shell is never
      // involved, so no part of a path or a parameter can be interpreted as
      // shell syntax.
      const child = spawn(file, args, { shell: false, windowsHide: true });
      children.add(child);
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);
      child.stdout.on('data', (chunk) => {
        if (stdout.length < MAX_CAPTURE_BYTES) stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk) => {
        if (stderr.length < MAX_CAPTURE_BYTES) stderr += chunk.toString('utf8');
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        children.delete(child);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        children.delete(child);
        resolve({ code, stdout, stderr, timedOut });
      });
    });
  }

  async function requireFfmpeg() {
    const found = await locate();
    if (!found.ffmpeg) {
      throw Object.assign(new Error('本机没有找到 ffmpeg，无法运行媒体处理工具'), {
        code: 'FFMPEG_UNAVAILABLE',
      });
    }
    return found.ffmpeg;
  }

  /**
   * Run ffmpeg with an argument array. Resolves only on a zero exit code.
   *
   * `logLevel` is raised to `info` by the scene detection, which reads the
   * cut points from the filter report on stderr.
   */
  async function run(args, options = {}) {
    const file = await requireFfmpeg();
    const logLevel = options.logLevel ?? 'error';
    const result = await spawnCapture(
      file,
      ['-hide_banner', '-loglevel', logLevel, '-y', ...args],
      options,
    );
    if (result.timedOut) {
      throw Object.assign(new Error('ffmpeg 执行超时'), { code: 'FFMPEG_TIMEOUT' });
    }
    if (result.code !== 0) {
      // ffmpeg prints the real reason first and the generic exit summary
      // last. The prefix is the filter and its address, so only the part
      // after it says anything useful.
      const lines = (result.stderr || result.stdout || '').split('\n').map((line) => line.trim()).filter(Boolean);
      const first = lines[0] ?? '';
      const message = first.replace(/^\[[^\]]*\]\s*/, '').trim() || first;
      throw Object.assign(new Error(`ffmpeg 执行失败${message ? `：${message.slice(0, 200)}` : ''}`), {
        code: 'FFMPEG_FAILED',
      });
    }
    return result;
  }

  /** Read the stream information of a media file. */
  async function probe(file) {
    const found = await locate();
    if (!found.ffprobe) {
      throw Object.assign(new Error('本机没有找到 ffprobe，无法读取媒体信息'), {
        code: 'FFMPEG_UNAVAILABLE',
      });
    }
    // Only the fields this needs are asked for. The whole of every stream and
    // every tag of the file is a lot of text, and it grows with the file: the
    // answer was cut off in the middle and could not be read at all.
    const result = await spawnCapture(
      found.ffprobe,
      [
        '-v', 'error',
        '-print_format', 'json',
        '-show_entries', 'stream=codec_type,width,height,avg_frame_rate,duration:format=duration',
        file,
      ],
      { timeoutMs: 60_000 },
    );
    if (result.code !== 0) {
      throw Object.assign(new Error('ffprobe 读取媒体信息失败'), { code: 'FFMPEG_FAILED' });
    }
    let data;
    try {
      data = JSON.parse(result.stdout);
    } catch {
      throw Object.assign(new Error('ffprobe 输出无法解析'), { code: 'FFMPEG_FAILED' });
    }
    const streams = Array.isArray(data?.streams) ? data.streams : [];
    const video = streams.find((item) => item?.codec_type === 'video') ?? {};
    const format = data?.format ?? {};
    const duration = Number(format.duration ?? video.duration ?? 0) || 0;
    const [num, den] = String(video.avg_frame_rate ?? '0/1').split('/');
    const fps = Number(den) > 0 ? Number(num) / Number(den) : 0;
    return {
      duration: Math.round(duration * 1000) / 1000,
      width: Number(video.width ?? 0) || 0,
      height: Number(video.height ?? 0) || 0,
      fps: Math.round(fps * 1000) / 1000,
      hasAudio: streams.some((item) => item?.codec_type === 'audio'),
    };
  }

  /** The capability state the page renders from. */
  async function status() {
    const found = await locate();
    if (!found.ffmpeg) {
      return { available: false, version: '', ffprobe: false };
    }
    let version = '';
    try {
      const result = await spawnCapture(found.ffmpeg, ['-version'], { timeoutMs: 20_000 });
      version = (result.stdout || '').split('\n')[0]?.trim() ?? '';
    } catch {
      version = '';
    }
    return { available: true, version, ffprobe: Boolean(found.ffprobe) };
  }

  function dispose() {
    for (const child of children) {
      try {
        child.kill('SIGKILL');
      } catch {
        // The child is already gone.
      }
    }
    children.clear();
  }

  return { locate, run, probe, status, dispose, isWindows: IS_WINDOWS };
}
