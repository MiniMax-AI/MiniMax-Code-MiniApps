// 内容类型探测：真的解码几帧灰度图，算运动量、细节密度、黑边。
//
// 为什么不用文件名/分辨率猜？因为「屏保录屏」和「游戏实录」可以用一样的分辨率和帧率，
// 但需要的码率差 3 倍。压缩参数猜错，产物就是「压小了但全糊」或「压不动」。
//
// 采样为什么用原始分辨率而不是缩小？
// 一开始我把整帧缩到 64×36（10 倍下采样）来省事，结果文字边缘被均值抹平，
// 屏幕录制反而被判成 detail 最低的「静止画面」。均值化是细节的敌人。
// 现在按原始像素采样（上限 2560 宽），用步长控制计算量，不再下采样。
import { run } from './ffmpeg.js';

export const MAX_SAMPLE_W = 2560;
export const SAMPLE_STRIDE = 4;   // 运动量：每 4 个像素取 1 个
export const DETAIL_STRIDE = 2;   // 细节量：步长小一点，否则 4×4 色块会被完全跳过

/**
 * 只有三类。原先把「静止」和「屏幕录制」分开是假精度——两者的压缩参数只差 CRF 34 vs 33，
 * 分了等于没分。真正影响成品的是「动得厉害吗、细节多吗」，那才是要分开的地方。
 */
export const KINDS = {
  screen: { label: '静止 / 文字画面（录屏、PPT、聊天记录）', minBpp: 0.012, crfStart: 28, crfStep: 2, maxCrf: 36 },
  camera: { label: '一般画面（实拍、人物讲话、日常）', minBpp: 0.05, crfStart: 25, crfStep: 2, maxCrf: 30 },
  motion: { label: '高运动（游戏、体育、快速摇摄）', minBpp: 0.1, crfStart: 23, crfStep: 2, maxCrf: 28 },
};

/** 采样帧尺寸：不超过上限，保持原始宽高比，且是偶数（gray 不挑，但保持偶数省心）。 */
export function sampleDims(displayW, displayH) {
  const w0 = Math.max(16, displayW || 1280);
  const h0 = Math.max(16, displayH || 720);
  const w = Math.min(MAX_SAMPLE_W, w0);
  const h = Math.max(2, Math.round((h0 * w) / w0 / 2) * 2);
  return { w: Math.round(w / 2) * 2, h };
}

/**
 * 在头/中/尾三个位置各取几帧原始分辨率灰度图。
 * 分三次取样是因为一段视频开头可能是静止标题卡，只看开头会判错。
 */
export async function sampleGrayFrames(file, { ff, durationSec, dims, batches = 3, perBatch = 4, fps = 2 }) {
  const { w, h } = dims;
  const frameBytes = w * h;
  const dur = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 3;
  const positions = batches <= 1
    ? [0]
    : [0.08, 0.5, 0.92].slice(0, batches).map((f) => Math.max(0, Math.min(dur - 0.1, dur * f)));

  const frames = [];
  for (const pos of positions) {
    const args = [
      '-v', 'error', '-nostdin',
      ...(pos > 0.05 ? ['-ss', String(pos.toFixed(3))] : []),
      '-i', file,
      '-an', '-sn', '-dn',
      '-vf', `fps=${fps},scale=${w}:${h}:flags=area,format=gray`,
      '-frames:v', String(perBatch),
      '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1',
    ];
    const { code, stdoutBuffer } = await run(ff, args);
    if (code !== 0) continue; // 采样失败不该让整条命令挂掉
    for (let off = 0; off + frameBytes <= stdoutBuffer.length; off += frameBytes) {
      frames.push(stdoutBuffer.subarray(off, off + frameBytes));
    }
  }
  return frames;
}

/** 逐帧对比：变化像素占比（|Δ|≥8 记为变化）。比「平均差值」更能拉开差距。 */
export function motionRatio(frames, width, threshold = 8) {
  if (frames.length < 2 || !width) return null;
  const height = frames[0].length / width;
  const st = SAMPLE_STRIDE;
  let changed = 0;
  let total = 0;
  for (let i = 1; i < frames.length; i += 1) {
    const a = frames[i - 1];
    const b = frames[i];
    for (let y = 0; y < height; y += st) {
      const row = y * width;
      for (let x = 0; x < width; x += st) {
        if (Math.abs(a[row + x] - b[row + x]) >= threshold) changed += 1;
        total += 1;
      }
    }
  }
  return total ? changed / total : null;
}

/** 细节密度：水平方向相邻像素的落差（原始分辨率下，文字笔画会直接体现成大落差）。 */
export function detailScore(frames, width, threshold = 32) {
  if (!frames.length || !width) return null;
  const st = DETAIL_STRIDE;
  const height = frames[0].length / width;
  let grad = 0;
  let gradN = 0;
  let sharp = 0;
  for (const f of frames) {
    for (let y = 0; y < height; y += st) {
      const row = y * width;
      for (let x = 0; x + 1 < width; x += st) {
        const d = Math.abs(f[row + x] - f[row + x + 1]);
        grad += d;
        gradN += 1;
        if (d >= threshold) sharp += 1;
      }
    }
  }
  return {
    detail: gradN ? grad / gradN / 255 : null,
    sharp: gradN ? sharp / gradN : null,
  };
}

function meanOf(f) {
  let s = 0;
  for (let i = 0; i < f.length; i += 1) s += f[i];
  return s / f.length;
}

function meanRows(f, width) {
  const height = f.length / width;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    let s = 0;
    for (let x = 0; x < width; x += 1) s += f[y * width + x];
    rows.push(s / width);
  }
  return rows;
}

function meanCols(f, width) {
  const height = f.length / width;
  const cols = [];
  for (let x = 0; x < width; x += 1) {
    let s = 0;
    for (let y = 0; y < height; y += 1) s += f[y * width + x];
    cols.push(s / height);
  }
  return cols;
}

/** 从抽样帧里量黑边：头尾若明显比中间暗，且整帧并不暗，那就是真黑边。 */
export function detectBars(f, width) {
  if (!f || !width) return null;
  const height = f.length / width;
  const DARK = 16;
  const overall = meanOf(f);
  if (overall <= 40) return null; // 整帧本来就黑，说不清是黑边还是黑屏
  const rows = meanRows(f, width);
  const cols = meanCols(f, width);
  const edgeMax = Math.max(...rows, ...cols);
  if (edgeMax <= 45) return null; // 没有亮的东西，多半是暗场而不是黑边

  let top = 0;
  while (top < height / 2 && rows[top] < DARK) top += 1;
  let bottom = 0;
  while (bottom < height / 2 && rows[height - 1 - bottom] < DARK) bottom += 1;
  let left = 0;
  while (left < width / 2 && cols[left] < DARK) left += 1;
  let right = 0;
  while (right < width / 2 && cols[width - 1 - right] < DARK) right += 1;

  const has = (n) => n >= 2;
  if (!has(top) && !has(bottom) && !has(left) && !has(right)) return null;
  const by = [];
  if (has(top)) by.push('top');
  if (has(bottom)) by.push('bottom');
  if (has(left)) by.push('left');
  if (has(right)) by.push('right');
  return { top: top / height, bottom: bottom / height, left: left / width, right: right / width, by };
}

// 阈值是对着 10 段合成素材量出来的，不是拍脑袋。
// 实测分布（motion = 变化像素占比）：
//   0.0002 录屏 ｜ 0.034~0.117 一段实拍/测试图 ｜ 0.19~0.31 快速摇摄与高频画面
// 两个阈值都落在明显的空档里。
export const THRESHOLDS = {
  screenMotion: 0.02,  // 低于此：画面基本不动，文字/PPT/录屏
  motionMotion: 0.16,  // 高于此：动得厉害，游戏/体育/快速摇摄
};

/** 纯函数：给运动量，判定内容类型。拆出来是为了能对着合成素材标定阈值。 */
export function classifyByMetrics({ motion }) {
  if (motion === null || motion === undefined) return 'camera'; // 判不出来就走保守的一档
  if (motion < THRESHOLDS.screenMotion) return 'screen';
  if (motion >= THRESHOLDS.motionMotion) return 'motion';
  return 'camera';
}

export async function analyzeContent(file, { ff, durationSec, width, height } = {}) {
  const dims = sampleDims(width, height);
  const frames = await sampleGrayFrames(file, { ff, durationSec, dims });
  if (frames.length < 2) {
    return {
      kind: 'camera', metrics: { motion: null, detail: null, sharp: null, brightness: null, frames: frames.length, sample: `${dims.w}×${dims.h}` },
      bars: null, sampled: false, label: KINDS.camera.label, sampleDims: dims,
      note: '抽不到足够帧，按一般画面处理（参数偏保守，代价是文件略大）',
    };
  }
  const motion = motionRatio(frames, dims.w, 8);
  const det = detailScore(frames, dims.w, 32);
  const brightness = frames.reduce((acc, f) => acc + meanOf(f), 0) / frames.length;
  const kind = classifyByMetrics({ motion });
  return {
    kind,
    label: KINDS[kind].label,
    metrics: {
      motion: r4(motion), detail: r4(det.detail), sharp: r4(det.sharp),
      brightness: r2(brightness), frames: frames.length, sample: `${dims.w}×${dims.h}`,
    },
    bars: detectBars(frames[Math.floor(frames.length / 2)], dims.w),
    sampled: true,
    sampleDims: dims,
    note: null,
  };
}

function r4(n) { return n === null ? null : Math.round(n * 10000) / 10000; }
function r2(n) { return n === null ? null : Math.round(n * 100) / 100; }
