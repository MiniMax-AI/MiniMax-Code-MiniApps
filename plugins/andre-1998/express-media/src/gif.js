// 转 GIF / 表情包。
// 关键点：用 palettegen + paletteuse 两段滤镜，量化调色板由内容决定。
// 直接 -vf fps,scale 输出 GIF 的典型症状是渐变区域出现色带，看着像坏了。
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { run } from './ffmpeg.js';
import { ensureExtension } from './format.js';

export const GIF_LIMITS = {
  wechatEmojiBytes: 1024 * 1024, // 微信自定义表情单个 1MB 以内
  practicalBytes: 2 * 1024 * 1024, // 超过这个体积，很多 IM 里滑动会卡
};

export function buildGifFilter({ width = 480, fps = 12, cropSquare = false, maxColors = 256, dither = 'bayer' }) {
  const parts = [`fps=${fps}`];
  if (cropSquare) {
    parts.push(`scale=${width}:${width}:force_original_aspect_ratio=increase:flags=lanczos`);
    parts.push(`crop=${width}:${width}`);
  } else {
    parts.push(`scale=${width}:-1:flags=lanczos`);
  }
  const base = parts.join(',');
  // 注意：带显式输入标签的滤镜，选项前必须用 `=` 而不是 `:`。
  // 写成 `paletteuse:dither=bayer` 的话，ffmpeg 会把 `:dither` 当成链上的下一个滤镜，
  // 然后报一句完全指不到真因的 "No option name near 'bayer'"。
  const ditherArg = dither === 'none' ? '' : `=dither=${dither}:bayer_scale=3`;
  return `[0:v]${base},split[s0][s1];[s0]palettegen=max_colors=${maxColors}:stats_mode=diff[p];[s1][p]paletteuse${ditherArg}`;
}

/** 体积预测只用于给建议；真实结果一律量出来。 */
export function estimateGifBytes({ width, height, fps, durationSec }) {
  return Math.ceil(width * height * fps * durationSec * 0.09);
}

export async function toGif(input, opts = {}) {
  const {
    out, width = 480, fps = 12, start = 0, duration = null,
    cropSquare = false, maxColors = 256, dither = 'bayer',
    speed = 'medium', ffmpeg, onProgress, signal,
  } = opts;
  if (!ffmpeg?.path) throw new Error('缺少 ffmpeg 路径，先跑 express doctor');
  if (!existsSync(input)) throw new Error(`文件不存在：${input}`);
  const outPath = ensureExtension(out || defaultGifPath(input), 'gif');
  // 目录要先建好，否则 ffmpeg 会因为「打不开输出文件」直接失败，
  // 而报错信息是 exit code 1，指向不了真正的原因
  mkdirSync(path.dirname(outPath), { recursive: true });
  const filter = buildGifFilter({ width, fps, cropSquare, maxColors, dither });
  const args = ['-nostdin', '-v', 'error', '-y'];
  if (start > 0) args.push('-ss', String(start));
  args.push('-i', input);
  if (duration) args.push('-t', String(duration));
  args.push('-filter_complex', filter, '-loop', '0', outPath);

  const { code, stderr } = await run(ffmpeg.path, args, { onProgress, signal });
  if (code !== 0 || !existsSync(outPath)) {
    throw new Error(`转 GIF 失败：${(stderr || '').trim() || `退出码 ${code}`}`);
  }
  const bytes = statSync(outPath).size;
  return {
    output: outPath,
    bytes,
    width, fps, cropSquare,
    estimate: estimateGifBytes({ width, height: width, fps, durationSec: duration || 3 }),
    warnings: gifWarnings(bytes, cropSquare ? width : width),
  };
}

export function gifWarnings(bytes, width) {
  const w = [];
  if (bytes > GIF_LIMITS.wechatEmojiBytes) {
    w.push(`体积 ${(bytes / 1024 / 1024).toFixed(2)}MB 超过微信表情的 1MB 上限；把 width 降到 ${Math.max(80, Math.floor(width * 0.6))} 或 fps 降到 8–10 再试`);
  } else if (bytes > GIF_LIMITS.practicalBytes) {
    w.push(`体积 ${(bytes / 1024 / 1024).toFixed(2)}MB 虽然在 1MB 之上但不算离谱；要更顺滑建议继续压到 1MB 以内`);
  }
  if (width > 480) w.push(`${width}px 偏大，聊天窗口里会缩得很小，表情包一般 240–320px 就够看清`);
  return w;
}

function defaultGifPath(input) {
  const dir = path.dirname(input);
  const base = path.basename(input, path.extname(input));
  return path.join(dir, `${base}.gif`);
}
