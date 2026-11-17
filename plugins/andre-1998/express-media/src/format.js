// 输出格式化 + 平台限制表加载。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_PATH = path.resolve(here, '..', 'data', 'platforms.json');

let cached = null;
export function loadPlatforms({ reload = false } = {}) {
  if (cached && !reload) return cached;
  const raw = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
  if (!Array.isArray(raw.targets) || raw.targets.length === 0) {
    throw new Error(`平台表坏了：${DATA_PATH} 里没有 targets`);
  }
  const byId = new Map();
  for (const t of raw.targets) {
    if (!t.id) throw new Error('平台表里有一条没有 id');
    if (byId.has(t.id)) throw new Error(`平台表里 id 重复：${t.id}`);
    byId.set(t.id, t);
  }
  cached = { ...raw, byId };
  return cached;
}

export function getTarget(id) {
  const db = loadPlatforms();
  const t = db.byId.get(id);
  if (!t) {
    throw new Error(`没这个目标：${id}。可用：${[...db.byId.keys()].join(', ')}`);
  }
  return t;
}

const SIZE_RE = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|k|m|g)?$/i;

/** 把 "25MB" / "500k" / "1.5g" / 数字 统一成字节数 */
export function parseSize(spec) {
  if (typeof spec === 'number') return Math.floor(spec);
  const m = SIZE_RE.exec(String(spec).trim());
  if (!m) throw new Error(`看不懂的大小：${spec}（试试 25MB / 500k / 1.5g）`);
  const value = Number(m[1]);
  const unit = (m[2] || 'b').toLowerCase();
  const mult = { b: 1, k: 1024, kb: 1024, m: 1024 ** 2, mb: 1024 ** 2, g: 1024 ** 3, gb: 1024 ** 3 }[unit];
  return Math.floor(value * mult);
}

export const MIN_TARGET_BYTES = 16 * 1024;

/**
 * 解析 --to 的值：要么是平台 id，要么是自定义大小。
 * 返回 { label, hardBytes, aimBytes, confidence, platform }
 */
export function resolveTarget(spec) {
  const s = String(spec).trim();
  if (/^\d/.test(s)) {
    const bytes = parseSize(s);
    // 荒唐的输入要在入口就拦下：给一个 0 字节的目标，工具会老老实实压三档再报超限，
    // 浪费几分钟还让人以为自己哪里没设置对。这明显是打字打错了。
    if (bytes < MIN_TARGET_BYTES) {
      throw new Error(
        `目标体积太小：${s}（${bytes} 字节）。视频压到 ${MIN_TARGET_BYTES / 1024}KB 以下已经不算视频了。\n` +
        '  如果你想发到某个平台，用 --to 加平台 id（express platforms 看有哪些），或者确认一下是不是少打了个 0。',
      );
    }
    return {
      kind: 'custom',
      label: `自定义 ${formatBytes(bytes)}`,
      hardBytes: bytes,
      aimBytes: safeAim(bytes),
      confidence: 'custom',
      platform: null,
    };
  }
  const t = getTarget(s);
  return {
    kind: 'platform',
    label: t.label,
    hardBytes: t.maxBytes,
    // 平台给了建议值就用建议值，否则自己留 2% 余量
    aimBytes: t.suggestedMaxBytes ? Math.min(t.suggestedMaxBytes, safeAim(t.maxBytes)) : safeAim(t.maxBytes),
    confidence: t.confidence,
    maxDurationSec: t.maxDurationSec ?? null,
    platform: t,
  };
}

/**
 * 压到硬上限以内还要留一点余量：容器/元数据的开销、以及各家「25MB 但实际 25.0 就失败」的脾气。
 *
 * 余量取「固定 512KB / 2% 里的大者」，但**再封顶在上限的 10%**。
 * 不封顶会踩坑：固定 512KB 对 400KB 的目标来说比上限还大，
 * 目标体积会被吃成 1KB，于是「裁到多少秒能压进去」这类建议永远算不出来。
 */
export function safeAim(hardBytes) {
  const want = Math.max(512 * 1024, Math.round(hardBytes * 0.02));
  const headroom = Math.min(want, Math.round(hardBytes * 0.1));
  return Math.max(1, hardBytes - headroom);
}

export function formatBytes(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = Math.abs(n);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  const digits = v >= 100 || i === 0 ? 0 : v >= 10 ? 1 : 2;
  return `${n < 0 ? '-' : ''}${v.toFixed(digits)} ${units[i]}`;
}

export function formatDuration(sec) {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '—';
  if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)} 秒`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m < 60) return s ? `${m} 分 ${s} 秒` : `${m} 分`;
  const h = Math.floor(m / 60);
  return `${h} 小时 ${m % 60} 分`;
}

export function formatBitrate(bps) {
  if (!bps || !Number.isFinite(bps)) return '—';
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} Mbps`;
  return `${Math.round(bps / 1e3)} kbps`;
}

/**
 * ffprobe 的 format_name 是「所有能装下这个流的容器」的清单，例如 mp4 会报
 * "mov,mp4,m4a,3gp,3g2,mj2"。用户只关心「这是个什么文件」，所以挑一个真容器名出来。
 */
export function containerLabel(formatName) {
  const list = String(formatName || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.length) return '—';
  const known = ['matroska', 'webm', 'mp4', 'mov', 'avi', 'mpegts', 'flv', 'gif', 'mxf', 'asf', '3gp', 'm4v'];
  for (const k of known) if (list.includes(k)) return k === 'matroska' ? 'mkv' : k;
  return list[0];
}

/**
 * 按**显示宽度**补空格对齐。中文是双宽字符，用 padEnd 按字符数补会彻底错位。
 */
const WIDE = /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;
export function displayWidth(s) {
  let w = 0;
  for (const ch of String(s)) w += WIDE.test(ch) ? 2 : 1;
  return w;
}
export function padDisplay(s, width) {
  const str = String(s);
  return str + ' '.repeat(Math.max(0, width - displayWidth(str)));
}

export function formatTimecode(sec) {
  if (!Number.isFinite(sec)) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * 补上输出文件的扩展名。
 *
 * ffmpeg 靠扩展名判断输出格式，路径没有扩展名时它会报一句
 * "Unable to choose an output format for 'xxx'; use a standard extension"，
 * 而用户只是写了 `--out myclip` —— 这种报错不该由用户来翻译。
 * 扩展名不对时也不覆盖用户写的名字（那样太意外），而是在后面补上正确的一个。
 */
export function ensureExtension(p, ext) {
  const s = String(p);
  const current = path.extname(s);
  if (!current) return `${s}.${ext}`;
  if (current.toLowerCase() === `.${ext.toLowerCase()}`) return s;
  return `${s}.${ext}`;
}
