// 程序动效：生图模型只画一张静态图，动起来的部分由程序按周期算出每一帧（jungle-adventure、david-voxel-loop 两个例子的做法）。
// 现在有绕中心转（spin）：加载圈、转动的图标、齿轮、风车、唱片。这类动作生图模型画不准：真机 20261119-e645c0
// 的十二点加载圈，一帧一帧改出来的十二帧有一半亮点落错格子，扔掉以后亮点一下跳一格、一下跳三格。
// 按圆心把画面转过去，每一帧都准，最后一帧再转一格正好接回第一帧。
//
// 转的只是圆心周围那一块圆盘，圆盘外面不动；圆盘边缘留一圈渐变，边上是均匀的背景，转了也看不出接缝。
// 一格一格跑的（steps：圆环上等距的 N 个点或 N 根辐条）每帧转 360/N 度：点和点正好重合，暗的点看起来不动，只有亮点在跑。
// 这要求圆心找得准：先按给的圆心，在附近找「转一格之后边缘和自己最重合」的位置（refineCenter）。
import { resizeArea, toRgb } from './gif.mjs';

export const SPIN = {
  minSteps: 3,
  maxSteps: 60,
  minFrames: 8,
  maxFrames: 60,
  frames: 24,
  // 转的圆盘：给的半径和程序量出来的内容半径取大的，再放大一点；最外面一圈渐变过渡，最大到画面短边的一半。
  margin: 1.06,
  feather: 0.08,
  maxRadius: 0.5,
  // 找圆心：在长边 384 的图上，给定圆心附近 ±6% 里先粗后细地找。
  refineEdge: 384,
  refineRange: 0.06,
};

// 规划、编辑节点写的 spin 参数 → 规格。center 是画面宽高的比例，radius 是画面短边的比例。
export function normalizeSpin(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const num = (v, lo, hi, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
  };
  const center = Array.isArray(value.center) && value.center.length === 2 ? value.center.map((v) => num(v, 0.05, 0.95, 0.5)) : [0.5, 0.5];
  const stepsRaw = Math.round(Number(value.steps));
  const steps = Number.isFinite(stepsRaw) && stepsRaw >= SPIN.minSteps ? Math.min(SPIN.maxSteps, stepsRaw) : 0;
  const framesRaw = Math.round(Number(value.frames));
  return {
    center,
    radius: num(value.radius, 0.05, SPIN.maxRadius, 0.35),
    steps,
    frames: steps ? steps : Number.isFinite(framesRaw) && framesRaw >= SPIN.minFrames ? Math.min(SPIN.maxFrames, framesRaw) : SPIN.frames,
    direction: value.direction === 'ccw' ? 'ccw' : 'cw',
    refine: value.refine !== false,
  };
}

// 找圆心和要转的半径（都是 rgb 的像素）。steps ≥ 3 时按「转一格之后和自己最重合」细找圆心：比的是梯度（边缘），
// 均匀的背景怎么转都一样，比的就是点、辐条这些边缘；亮点挪了一格的那几处不管圆心在哪都对不上，是个常数，不影响找最小。
// 连续转的（steps 为 0）没有这种对称，用给的圆心。
export function locateSpin(image, spin) {
  const rgb = toRgb(image);
  const short = Math.min(rgb.width, rgb.height);
  let cx = spin.center[0] * rgb.width;
  let cy = spin.center[1] * rgb.height;
  let refined = { moved: 0, score: 0, base: 0 };
  const scale = Math.min(1, SPIN.refineEdge / Math.max(rgb.width, rgb.height));
  const w = Math.max(32, Math.round(rgb.width * scale));
  const h = Math.max(32, Math.round(rgb.height * scale));
  const grad = gradient(resizeArea(rgb, w, h));
  const r0 = Math.max(4, spin.radius * Math.min(w, h));
  if (spin.refine && spin.steps >= SPIN.minSteps) {
    const theta = (2 * Math.PI) / spin.steps;
    const cost = (x, y) => rotationCost(grad, w, h, x, y, r0, theta);
    let bx = cx * scale;
    let by = cy * scale;
    const base = cost(bx, by);
    let best = base;
    const range = SPIN.refineRange * Math.min(w, h);
    for (const [span, step] of [[range, Math.max(1, range / 6)], [Math.max(1, range / 6), Math.max(0.25, range / 36)]]) {
      const ox = bx;
      const oy = by;
      for (let dy = -span; dy <= span + 1e-9; dy += step) {
        for (let dx = -span; dx <= span + 1e-9; dx += step) {
          const c = cost(ox + dx, oy + dy);
          if (c < best) {
            best = c;
            bx = ox + dx;
            by = oy + dy;
          }
        }
      }
    }
    refined = { moved: Math.hypot(bx / scale - cx, by / scale - cy), score: best, base };
    cx = bx / scale;
    cy = by / scale;
  }
  // 内容半径：从圆心往外，梯度（边缘）的累计量到 98% 的半径。给的半径小了（切到点上），半截点不转、半截转，一眼就看得出。
  const contentR = contentRadius(grad, w, h, cx * scale, cy * scale, SPIN.maxRadius * Math.min(w, h)) / scale;
  const radius = Math.min(SPIN.maxRadius * short, Math.max(spin.radius * short, contentR) * SPIN.margin);
  return { cx, cy, radius, contentRadius: contentR, refined };
}

function rotationCost(grad, w, h, cx, cy, r, theta) {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const r2 = r * r;
  let sum = 0;
  let n = 0;
  const x0 = Math.max(1, Math.floor(cx - r));
  const x1 = Math.min(w - 2, Math.ceil(cx + r));
  const y0 = Math.max(1, Math.floor(cy - r));
  const y1 = Math.min(h - 2, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;
      // 这一点转一格之后落在哪
      const sx = cx + dx * cos - dy * sin;
      const sy = cy + dx * sin + dy * cos;
      if (sx < 0 || sy < 0 || sx > w - 1 || sy > h - 1) continue;
      sum += Math.abs(grad[y * w + x] - bilinear1(grad, w, h, sx, sy));
      n += 1;
    }
  }
  return n ? sum / n : Infinity;
}

function contentRadius(grad, w, h, cx, cy, maxR) {
  const bins = Math.max(8, Math.ceil(maxR));
  const energy = new Float64Array(bins + 1);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const r = Math.hypot(x - cx, y - cy);
      if (r > maxR) continue;
      energy[Math.min(bins, Math.floor(r))] += grad[y * w + x];
    }
  }
  // 均匀背景本身也有一点点梯度（渐变、噪点）：按每一圈的中位强度扣掉一份底子再累计。
  const perRing = [];
  for (let r = 0; r <= bins; r += 1) perRing.push(energy[r] / Math.max(1, 2 * Math.PI * Math.max(0.5, r)));
  const floor = perRing.slice().sort((a, b) => a - b)[Math.floor(perRing.length * 0.5)];
  let total = 0;
  const net = perRing.map((v, r) => Math.max(0, v - floor * 1.5) * 2 * Math.PI * Math.max(0.5, r));
  for (const v of net) total += v;
  if (!total) return 0;
  let acc = 0;
  for (let r = 0; r <= bins; r += 1) {
    acc += net[r];
    if (acc >= total * 0.98) return r + 1;
  }
  return bins;
}

// 把圆盘转 angle（弧度，顺时针为正：图像坐标 y 朝下），圆盘外不动，边缘渐变。返回新的 RGB 图。
export function spinFrame(rgb, cx, cy, radius, angle) {
  const { width: w, height: h, data } = rgb;
  const out = Buffer.from(data);
  const feather = Math.max(1, radius * SPIN.feather);
  const inner = radius - feather;
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(w - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(h - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const r = Math.hypot(dx, dy);
      if (r >= radius) continue;
      const k = r <= inner ? 1 : 0.5 + 0.5 * Math.cos((Math.PI * (r - inner)) / feather);
      // 反着找：这一点转之前在哪
      const sx = cx + dx * cos - dy * sin - 0.5;
      const sy = cy + dx * sin + dy * cos - 0.5;
      const o = (y * w + x) * 3;
      for (let c = 0; c < 3; c += 1) {
        const v = bilinear3(data, w, h, sx, sy, c);
        out[o + c] = Math.round(data[o + c] + (v - data[o + c]) * k);
      }
    }
  }
  return { width: w, height: h, channels: 3, data: out };
}

function bilinear1(g, w, h, x, y) {
  const x0 = Math.max(0, Math.min(w - 2, Math.floor(x)));
  const y0 = Math.max(0, Math.min(h - 2, Math.floor(y)));
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  const p = y0 * w + x0;
  const top = g[p] + (g[p + 1] - g[p]) * fx;
  const bottom = g[p + w] + (g[p + w + 1] - g[p + w]) * fx;
  return top + (bottom - top) * fy;
}

function bilinear3(data, w, h, x, y, c) {
  const xx = Math.max(0, Math.min(w - 1.001, x));
  const yy = Math.max(0, Math.min(h - 1.001, y));
  const x0 = Math.floor(xx);
  const y0 = Math.floor(yy);
  const fx = xx - x0;
  const fy = yy - y0;
  const p = (y0 * w + x0) * 3 + c;
  const q = p + w * 3;
  const top = data[p] + (data[p + 3] - data[p]) * fx;
  const bottom = data[q] + (data[q + 3] - data[q]) * fx;
  return top + (bottom - top) * fy;
}

function gradient(img) {
  const { width: w, height: h, data } = img;
  const lum = new Float32Array(w * h);
  for (let p = 0; p < w * h; p += 1) lum[p] = 0.299 * data[p * 3] + 0.587 * data[p * 3 + 1] + 0.114 * data[p * 3 + 2];
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const p = y * w + x;
      out[p] = Math.abs(lum[p + 1] - lum[p - 1]) + Math.abs(lum[p + w] - lum[p - w]);
    }
  }
  return out;
}
