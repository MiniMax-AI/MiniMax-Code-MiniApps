// 分段：一个大文件拆成几个都小于上限的片段。
//
// 复用 fit 的收敛逻辑——每一段都自己压、自己量、自己判定，不存在「以为压好了」的可能。
// 分段数按「体积 / 目标」估算，视频码率大体恒定，所以等分时长 ≈ 等分体积。
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { statSync } from 'node:fs';
import { fit } from './fit.js';
import { resolveTarget, formatBytes, formatDuration } from './format.js';

export function planSplit({ sizeBytes, aimBytes, durationSec, parts = null }) {
  const need = Math.max(2, Math.ceil(sizeBytes / aimBytes));
  // 段数的语义要说清楚：不给（或给 0）就按体积自动算；给 1 等于没分，抬到 2；
  // 给 ≥2 就尊重用户的选择，哪怕比「刚好够」多切几段
  const n = !parts || parts === 0 ? need : parts < 2 ? 2 : parts;
  const seg = durationSec / n;
  return { parts: n, need, segSeconds: seg };
}

export async function split(input, opts = {}) {
  const {
    to, parts = null, outDir = null, preset = 'balanced', speed = 'medium',
    ffmpeg, ffprobe, onProgress, onPart = () => {}, signal, maxPasses = 3,
  } = opts;
  if (!ffmpeg?.path) throw new Error('缺少 ffmpeg 路径，先跑 express doctor');

  const target = resolveTarget(to);
  const dir = outDir || path.join(path.dirname(input), path.basename(input, path.extname(input)) + '.分片');
  mkdirSync(dir, { recursive: true });

  // 先体检一次：整体已经装得下就没必要分
  const { probe } = await import('./probe.js');
  const info = await probe(input, { ffprobe });
  if (info.sizeBytes <= target.hardBytes) {
    return { action: 'noop', target, inputInfo: info, segments: [], reason: `本来就装得下（${formatBytes(info.sizeBytes)} ≤ ${formatBytes(target.hardBytes)}），不用分` };
  }

  const plan = planSplit({ sizeBytes: info.sizeBytes, aimBytes: target.aimBytes, durationSec: info.durationSec, parts });
  const segments = [];
  const total = plan.parts;
  for (let i = 0; i < total; i += 1) {
    const start = round3(i * plan.segSeconds);
    let end = round3((i + 1) * plan.segSeconds);
    if (i === total - 1) end = round3(info.durationSec);
    if (end <= start) continue;
    const out = path.join(dir, `${String(i + 1).padStart(2, '0')}.mp4`);
    const r = await fit(input, {
      to, out, preset, speed, ffmpeg, ffprobe, maxPasses, signal,
      trim: { start, end },
      onProgress: onProgress ? (p) => onProgress({ ...p, part: i + 1, parts: total }) : undefined,
    });
    const bytes = statSync(out).size;
    segments.push({
      index: i + 1, of: total, path: out, start, end, bytes,
      startText: formatDuration(start), endText: formatDuration(end),
      fits: bytes <= target.hardBytes,
      content: r.content,
    });
    onPart({ index: i + 1, of: total, bytes, fits: bytes <= target.hardBytes });
  }

  const over = segments.filter((s) => !s.fits);
  return {
    action: 'split',
    target,
    inputInfo: info,
    plan,
    dir,
    segments,
    allFit: over.length === 0,
    overSegments: over.map((s) => s.index),
    // 分段 = 体积之和（各段压完的总和），用于跟原文件对比
    totalBytes: segments.reduce((a, s) => a + s.bytes, 0),
  };
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}
