// 裁剪 / 切片。视频太长时，先剪一刀往往比暴力压缩划算得多。
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { run } from './ffmpeg.js';
import { parseProbe } from './probe.js';
import { ensureExtension } from './format.js';

export function parseTimecode(spec) {
  // 支持 12 / 1:30 / 01:02:03 / 1m30s / 90.5
  const s = String(spec).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const parts = s.split(':');
  if (parts.length > 3) throw new Error(`看不懂的时间：${spec}`);
  const nums = parts.map((p) => {
    if (!/^\d+(\.\d+)?$/.test(p)) throw new Error(`看不懂的时间：${spec}`);
    return Number(p);
  });
  if (nums.length === 3) return nums[0] * 3600 + nums[1] * 60 + nums[2];
  if (nums.length === 2) return nums[0] * 60 + nums[1];
  return nums[0];
}

export function trimArgs({ input, output, start, duration, reencode = true, speed = 'medium' }) {
  const args = ['-nostdin', '-v', 'error', '-y'];
  if (start > 0) args.push('-ss', String(start));
  args.push('-i', input);
  if (duration !== null && duration !== undefined) args.push('-t', String(duration));
  if (reencode) {
    args.push('-c:v', 'libx264', '-preset', speed, '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart');
  } else {
    args.push('-c', 'copy');
  }
  args.push(output);
  return args;
}

export async function trim(input, opts = {}) {
  const { start = 0, end = null, duration = null, out, reencode = true, speed = 'medium', ffmpeg, ffprobe, signal, onProgress } = opts;
  if (!ffmpeg?.path) throw new Error('缺少 ffmpeg 路径，先跑 express doctor');
  if (!existsSync(input)) throw new Error(`文件不存在：${input}`);
  const startSec = start ? parseTimecode(start) : 0;
  let dur = duration !== null && duration !== undefined ? parseTimecode(duration) : null;
  if (dur === null && end !== null && end !== undefined) {
    const endSec = parseTimecode(end);
    dur = endSec - startSec;
    if (dur <= 0) throw new Error(`结束时间（${end}）必须晚于开始时间（${start}）`);
  }
  if (dur !== null && dur <= 0) throw new Error('时长必须大于 0');
  const outPath = ensureExtension(out || defaultPath(input, startSec, dur), 'mp4');
  // 输出目录要先建好：ffmpeg 打不开输出文件时只会给一个 exit code 1，
  // 报错完全指不到「目录不存在」这个真正的原因
  mkdirSync(path.dirname(outPath), { recursive: true });
  const { code, stderr } = await run(ffmpeg.path, trimArgs({ input, output: outPath, start: startSec, duration: dur, reencode, speed }), { onProgress, signal });
  if (code !== 0 || !existsSync(outPath)) {
    throw new Error(`裁剪失败：${(stderr || '').trim() || `退出码 ${code}`}`);
  }
  const before = statSync(input).size;
  const after = statSync(outPath).size;
  const afterInfo = ffprobe ? await probeQuiet(outPath, ffprobe) : null;
  return { output: outPath, startSec, durationSec: dur, before, after, afterInfo };
}

/** 体检产出是加分项，失败不该让整个裁剪失败 */
async function probeQuiet(file, ffprobe) {
  const bin = typeof ffprobe === 'string' ? ffprobe : ffprobe?.path;
  if (!bin) return null;
  try {
    const res = await run(bin, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
    if (res.code !== 0) return null;
    return parseProbe(res.stdout, { file, sizeBytes: statSync(file).size });
  } catch {
    return null;
  }
}

/** 切成 N 段（每段都不超过 targetBytes），用于「一个文件太大但必须整段发」的场景。 */
export function splitArgs({ input, output, start, duration }) {
  return [
    '-nostdin', '-v', 'error', '-y', '-ss', String(start), '-i', input, '-t', String(duration),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output,
  ];
}

function defaultPath(input, startSec, dur) {
  const dir = path.dirname(input);
  const base = path.basename(input, path.extname(input));
  const s = Math.round(startSec);
  const d = dur ? `-${Math.round(dur)}s` : '';
  return path.join(dir, `${base}.trim${s ? `-${s}s` : ''}${d}.mp4`);
}
