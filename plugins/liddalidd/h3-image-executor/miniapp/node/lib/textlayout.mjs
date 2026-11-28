// 程序排字的排版与光栅化：把一段文字按字体排进一个矩形，画成覆盖率蒙版（0-1）。
// 只管几何，不管颜色和合成（见 textoverlay.mjs）。
//
// 光栅化用的是按面积累加的扫描算法（和 font-rs 同一思路）：每条边把自己在每个像素里扫过的
// 有向面积记下来，逐行求前缀和就是覆盖率，抗锯齿是精确的面积而不是超采样近似。
// 同向重叠的轮廓（毛笔字体里很常见）取绝对值后截到 1，等价于非零环绕规则。

// ---------------------------------------------------------------- 光栅化

// 字体单位 -> 像素的仿射矩阵 [a, b, c, d, e, f]：px = a*x + c*y + e，py = b*x + d*y + f。
// scale：每个字体单位多少像素；theta：屏幕上顺时针旋转的弧度；把字体里的点 pivot 放到屏幕上的 at。
export function placeMatrix(scale, theta, pivot, at, stretchX) {
  const cos = Math.cos(theta || 0);
  const sin = Math.sin(theta || 0);
  const sx = scale * (stretchX || 1);
  const a = sx * cos;
  const b = sx * sin;
  const c = scale * sin;
  const d = -scale * cos;
  return [a, b, c, d, at[0] - (a * pivot[0] + c * pivot[1]), at[1] - (b * pivot[0] + d * pivot[1])];
}

function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

// 每个字实际落墨的矩形（像素）。查两层字有没有叠在一起要用它：排字框四周留了白边，比墨迹大；
// 整段的外接矩形又太粗（段首缩进、末行半行都算进去了）。
export function glyphRects(glyphs) {
  const out = [];
  for (const glyph of glyphs || []) {
    const outline = glyph.font && glyph.font.outline(glyph.gid);
    if (!outline || !outline.contours || !outline.contours.length) continue;
    const corners = [
      apply(glyph.m, outline.xMin, outline.yMin),
      apply(glyph.m, outline.xMax, outline.yMin),
      apply(glyph.m, outline.xMin, outline.yMax),
      apply(glyph.m, outline.xMax, outline.yMax),
    ];
    const xs = corners.map((p) => p[0]);
    const ys = corners.map((p) => p[1]);
    out.push({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), ch: glyph.ch });
  }
  return out;
}

// 一个字形画成一块小蒙版。返回 { x, y, w, h, data }（x、y 是这块蒙版在目标坐标里的左上角）。
export function rasterizeGlyph(outline, m) {
  if (!outline || !outline.contours || !outline.contours.length) return null;
  const corners = [
    apply(m, outline.xMin, outline.yMin),
    apply(m, outline.xMax, outline.yMin),
    apply(m, outline.xMin, outline.yMax),
    apply(m, outline.xMax, outline.yMax),
  ];
  const x0 = Math.floor(Math.min(...corners.map((p) => p[0]))) - 2;
  const y0 = Math.floor(Math.min(...corners.map((p) => p[1]))) - 2;
  const x1 = Math.ceil(Math.max(...corners.map((p) => p[0]))) + 2;
  const y1 = Math.ceil(Math.max(...corners.map((p) => p[1]))) + 2;
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0 || w * h > 64e6) return null;
  const stride = w + 2;
  const acc = new Float32Array(stride * h + 2);
  const local = [m[0], m[1], m[2], m[3], m[4] - x0, m[5] - y0];
  for (const contour of outline.contours) walkContour(contour, local, acc, stride, h);
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    let sum = 0;
    const row = y * stride;
    for (let x = 0; x < w; x += 1) {
      sum += acc[row + x];
      const v = sum < 0 ? -sum : sum;
      data[y * w + x] = v > 1 ? 1 : v;
    }
  }
  return { x: x0, y: y0, w, h, data };
}

// TrueType 轮廓：on 点之间是直线，off 点是二次贝塞尔的控制点，两个相邻 off 点中间隐含一个 on 点。
function walkContour(points, m, acc, stride, h) {
  const n = points.length;
  if (n < 2) return;
  let pts;
  const first = points.findIndex((p) => p.on);
  if (first < 0) {
    const mid = { x: (points[n - 1].x + points[0].x) / 2, y: (points[n - 1].y + points[0].y) / 2, on: true };
    pts = [mid, ...points];
  } else {
    pts = points.slice(first).concat(points.slice(0, first));
  }
  const toPx = (p) => apply(m, p.x, p.y);
  const start = toPx(pts[0]);
  let cur = start;
  let ctrl = null;
  for (let i = 1; i <= pts.length; i += 1) {
    const p = i === pts.length ? pts[0] : pts[i];
    const pp = toPx(p);
    if (p.on) {
      if (ctrl) {
        quad(acc, stride, h, cur, ctrl, pp);
        ctrl = null;
      } else {
        line(acc, stride, h, cur[0], cur[1], pp[0], pp[1]);
      }
      cur = pp;
    } else {
      if (ctrl) {
        const mid = [(ctrl[0] + pp[0]) / 2, (ctrl[1] + pp[1]) / 2];
        quad(acc, stride, h, cur, ctrl, mid);
        cur = mid;
      }
      ctrl = pp;
    }
  }
}

function quad(acc, stride, h, p0, p1, p2) {
  const devx = p0[0] - 2 * p1[0] + p2[0];
  const devy = p0[1] - 2 * p1[1] + p2[1];
  const devsq = devx * devx + devy * devy;
  if (devsq < 0.333) {
    line(acc, stride, h, p0[0], p0[1], p2[0], p2[1]);
    return;
  }
  const n = 1 + Math.floor(Math.sqrt(Math.sqrt(3 * devsq)));
  let px = p0[0];
  let py = p0[1];
  for (let i = 1; i <= n; i += 1) {
    const t = i / n;
    const mt = 1 - t;
    const x = mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0];
    const y = mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1];
    line(acc, stride, h, px, py, x, y);
    px = x;
    py = y;
  }
}

function line(acc, stride, h, ax, ay, bx, by) {
  if (Math.abs(ay - by) <= 1e-9) return;
  let dir = 1;
  let x0p = ax;
  let y0p = ay;
  let x1p = bx;
  let y1p = by;
  if (ay > by) {
    dir = -1;
    x0p = bx;
    y0p = by;
    x1p = ax;
    y1p = ay;
  }
  const dxdy = (x1p - x0p) / (y1p - y0p);
  let x = x0p;
  let yStart = Math.floor(y0p);
  if (y0p < 0) {
    x -= y0p * dxdy;
    yStart = 0;
  }
  const yEnd = Math.min(h, Math.ceil(y1p));
  const maxX = stride - 2;
  for (let y = yStart; y < yEnd; y += 1) {
    const rowStart = y * stride;
    const dy = Math.min(y + 1, y1p) - Math.max(y, y0p);
    const xnext = x + dxdy * dy;
    const d = dy * dir;
    let lo = x < xnext ? x : xnext;
    let hi = x < xnext ? xnext : x;
    lo = lo < 0 ? 0 : lo > maxX ? maxX : lo;
    hi = hi < 0 ? 0 : hi > maxX ? maxX : hi;
    const loFloor = Math.floor(lo);
    const hiCeil = Math.ceil(hi);
    if (hiCeil <= loFloor + 1) {
      const xmf = 0.5 * (lo + hi) - loFloor;
      const i = rowStart + loFloor;
      acc[i] += d - d * xmf;
      acc[i + 1] += d * xmf;
    } else {
      const s = 1 / (hi - lo);
      const loFrac = lo - loFloor;
      const a0 = 0.5 * s * (1 - loFrac) * (1 - loFrac);
      const hiFrac = hi - hiCeil + 1;
      const am = 0.5 * s * hiFrac * hiFrac;
      const i = rowStart + loFloor;
      acc[i] += d * a0;
      if (hiCeil === loFloor + 2) {
        acc[i + 1] += d * (1 - a0 - am);
      } else {
        const a1 = s * (1.5 - loFrac);
        acc[i + 1] += d * (a1 - a0);
        for (let xi = loFloor + 2; xi < hiCeil - 1; xi += 1) acc[rowStart + xi] += d * s;
        const a2 = a1 + (hiCeil - loFloor - 3) * s;
        acc[rowStart + hiCeil - 1] += d * (1 - a2 - am);
      }
      acc[rowStart + hiCeil] += d * am;
    }
    x = xnext;
  }
}

// 把一批已经定好位置的字形画进一块蒙版（取最大值合并）。mask：{ x, y, w, h, data }，坐标与字形同一套。
export function drawGlyphs(mask, glyphs) {
  for (const glyph of glyphs) {
    const outline = glyph.font.outline(glyph.gid);
    const tile = rasterizeGlyph(outline, glyph.m);
    if (!tile) continue;
    const alpha = glyph.alpha === undefined ? 1 : glyph.alpha;
    for (let ty = 0; ty < tile.h; ty += 1) {
      const my = tile.y + ty - mask.y;
      if (my < 0 || my >= mask.h) continue;
      for (let tx = 0; tx < tile.w; tx += 1) {
        const mx = tile.x + tx - mask.x;
        if (mx < 0 || mx >= mask.w) continue;
        const v = tile.data[ty * tile.w + tx] * alpha;
        const at = my * mask.w + mx;
        if (v > mask.data[at]) mask.data[at] = v;
      }
    }
  }
  return mask;
}

// ---------------------------------------------------------------- 部件分色
//
// 一个字里偏旁和其余部分用不同颜色（识字挂图：「清」的「氵」橙色、「青」深灰）。以前只能把字拆成
// 「氵」「青」两层并排摆，或者在整字上再叠一个「氵」，拼出来都不是正确的字（真机 20261116-e7b1b1、20261117-f57a0f）。
// 字体轮廓不一定按部件分：毛笔字常把几笔连成一个轮廓，「氵」的提也会伸进右边部件的范围。所以不按轮廓分，
// 而是在渲染好的字上找一条墨最少的切线（逐行最多挪 1 像素，可以绕开伸过来的笔画），切线靠偏旁那一侧算偏旁。
// 几条一样好的切线里取最靠外侧的：「湖」里「古」和「月」之间也有一条不碰墨的缝，取靠里的会把「古」也算成偏旁。
// 偏旁那一侧的墨太少的不算：「忄」的左点和竖之间也有一条缝，只切出左边那一点不是偏旁。
const PART_MIN_SHARE = 0.1;
const PART_MAX_SHARE = 0.62;
const SEAM_MOVE_COST = 0.02;
// 能分色的字：统一汉字。标点、运算符、上标的脚注符号整个用一种颜色。
const SPLIT_CHAR = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]|[\u{20000}-\u{3FFFF}]/u;

export function splittableChar(ch) {
  return SPLIT_CHAR.test(ch);
}

// tile 是 rasterizeGlyph 的结果。返回 { ok, seam, vertical, near, share（偏旁分到的墨占比）, cut（切断笔画的行占有墨的行的比例）}。
export function splitTile(tile, side) {
  const { w, h, data } = tile;
  const vertical = side === 'left' || side === 'right';
  const near = side === 'left' || side === 'top';
  const R = vertical ? h : w;
  const P = vertical ? w : h;
  const ink = vertical ? (r, p) => data[r * w + p] : (r, p) => data[p * w + r];
  let p0 = P;
  let p1 = -1;
  let r0 = R;
  let r1 = -1;
  let total = 0;
  for (let r = 0; r < R; r += 1) {
    for (let p = 0; p < P; p += 1) {
      const v = ink(r, p);
      total += v;
      if (v > 0.3) {
        if (p < p0) p0 = p;
        if (p > p1) p1 = p;
        if (r < r0) r0 = r;
        if (r > r1) r1 = r;
      }
    }
  }
  if (p1 - p0 < 4 || total <= 0) return { ok: false, reason: 'empty' };
  const span = p1 - p0;
  const lo = Math.max(1, Math.round(p0 + span * (near ? 0.08 : 0.35)));
  const hi = Math.min(P - 2, Math.round(p0 + span * (near ? 0.65 : 0.92)));
  const L = hi - lo + 1;
  if (L < 2) return { ok: false, reason: 'empty' };
  // 每行的前缀和：一条切线把多少墨分到偏旁那一侧，逐行查表就行。
  const prefix = new Float64Array(R * (P + 1));
  for (let r = 0; r < R; r += 1) {
    let s = 0;
    const row = r * (P + 1);
    for (let p = 0; p < P; p += 1) {
      s += ink(r, p);
      prefix[row + p + 1] = s;
    }
  }
  const cost = new Float64Array(R * L);
  const from = new Int8Array(R * L);
  for (let i = 0; i < L; i += 1) cost[i] = ink(0, lo + i);
  for (let r = 1; r < R; r += 1) {
    const prev = (r - 1) * L;
    for (let i = 0; i < L; i += 1) {
      let best = cost[prev + i];
      let step = 0;
      if (i > 0 && cost[prev + i - 1] + SEAM_MOVE_COST < best) {
        best = cost[prev + i - 1] + SEAM_MOVE_COST;
        step = -1;
      }
      if (i < L - 1 && cost[prev + i + 1] + SEAM_MOVE_COST < best) {
        best = cost[prev + i + 1] + SEAM_MOVE_COST;
        step = 1;
      }
      cost[r * L + i] = best + ink(r, lo + i);
      from[r * L + i] = step;
    }
  }
  const inkRows = Math.max(1, r1 - r0 + 1);
  const valid = [];
  for (let end = 0; end < L; end += 1) {
    const seam = new Int32Array(R);
    let i = end;
    for (let r = R - 1; r >= 0; r -= 1) {
      seam[r] = lo + i;
      if (r > 0) i += from[r * L + i];
    }
    let part = 0;
    let cut = 0;
    let mean = 0;
    for (let r = 0; r < R; r += 1) {
      const s = seam[r];
      const row = r * (P + 1);
      part += near ? prefix[row + s] : prefix[row + P] - prefix[row + s + 1];
      if (ink(r, s) > 0.5) cut += 1;
      mean += s;
    }
    const share = part / total;
    if (share < PART_MIN_SHARE || share > PART_MAX_SHARE) continue;
    valid.push({ seam, cost: cost[(R - 1) * L + end], share, cut: cut / inkRows, mean: mean / R });
  }
  if (!valid.length) return { ok: false, reason: 'no_split' };
  const minCost = Math.min(...valid.map((item) => item.cost));
  const best = valid.filter((item) => item.cost <= minCost + 0.5).sort((a, b) => (near ? a.mean - b.mean : b.mean - a.mean))[0];
  return { ok: true, seam: best.seam, vertical, near, share: best.share, cut: best.cut };
}

// tile 内坐标 (x, y) 是不是落在偏旁那一侧。切线本身那一列算其余部分。
export function inPart(split, x, y) {
  const r = split.vertical ? y : x;
  const p = split.vertical ? x : y;
  return split.near ? p < split.seam[r] : p > split.seam[r];
}

// 按 192 像素试切一个字：选字体用（见 textoverlay.choosePartFonts）。
export function probeSplit(font, ch, side, size) {
  const gid = font.glyphId(ch.codePointAt(0));
  if (!gid) return { ok: false, reason: 'missing' };
  const outline = font.outline(gid);
  if (!outline || !outline.contours.length) return { ok: false, reason: 'empty' };
  const scale = (size || 192) / font.unitsPerEm;
  const tile = rasterizeGlyph(outline, [scale, 0, 0, -scale, -outline.xMin * scale + 3, outline.yMax * scale + 3]);
  const split = tile ? splitTile(tile, side) : null;
  return split && split.ok ? { ok: true, cut: split.cut, share: split.share } : { ok: false, reason: (split && split.reason) || 'empty' };
}

// 和 drawGlyphs 一样画字，汉字按切线分进两张蒙版：偏旁进 partMask，其余进 mask。切不开的字整个进 mask。
export function drawGlyphsSplit(mask, partMask, glyphs, side) {
  const report = { split: 0, failed: [], maxCut: 0 };
  for (const glyph of glyphs) {
    const outline = glyph.font.outline(glyph.gid);
    const tile = rasterizeGlyph(outline, glyph.m);
    if (!tile) continue;
    let split = null;
    if (splittableChar(glyph.ch)) {
      split = splitTile(tile, side);
      if (split.ok) {
        report.split += 1;
        report.maxCut = Math.max(report.maxCut, split.cut);
      } else {
        report.failed.push(glyph.ch);
        split = null;
      }
    }
    const alpha = glyph.alpha === undefined ? 1 : glyph.alpha;
    for (let ty = 0; ty < tile.h; ty += 1) {
      const my = tile.y + ty - mask.y;
      if (my < 0 || my >= mask.h) continue;
      for (let tx = 0; tx < tile.w; tx += 1) {
        const mx = tile.x + tx - mask.x;
        if (mx < 0 || mx >= mask.w) continue;
        const v = tile.data[ty * tile.w + tx] * alpha;
        if (!v) continue;
        const target = split && inPart(split, tx, ty) ? partMask : mask;
        const at = my * mask.w + mx;
        if (v > target.data[at]) target.data[at] = v;
      }
    }
  }
  return report;
}

// ---------------------------------------------------------------- 字符分类

const CJK = /[\u2E80-\u2FFF\u3000-\u303F\u3040-\u30FF\u3100-\u312F\u3190-\u31FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFE10-\uFE1F\uFE30-\uFE4F\uFF00-\uFFEF]|[\u{20000}-\u{3FFFF}]/u;
const PUNCT = /[\u3000-\u303F\uFF01-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40\uFF5B-\uFF65\u2010-\u2027\u2030-\u205E\u00B7\uFE10-\uFE1F\uFE30-\uFE4F!-\/:-@\[-`{-~]/;
// 不能出现在行首（列首）的标点：放不下时挂到上一行行尾。
const NO_START = new Set(Array.from('，。、；：？！）》」』】〕〉’”…—～·%‰,.;:?!)]}'));
// 不能出现在行尾（列尾）的标点：和后一个字绑在一起。
const NO_END = new Set(Array.from('（《「『【〔〈‘“([{'));
// 竖排时放在字格右上角的标点。
const CORNER = new Set(Array.from('，。、．,.'));
// 竖排时转 90° 的标点（括号、书名号、破折号、省略号）。
const ROTATE = new Set(Array.from('（）《》〈〉「」『』【】〔〕［］｛｝—…～()[]{}<>-–_'));
// 竖排引号换成直角引号的竖排形式，字体里没有就把横排的直角引号转 90°。
const VERTICAL_QUOTE = { '“': ['﹁', '「'], '”': ['﹂', '」'], '‘': ['﹃', '『'], '’': ['﹄', '』'] };
// 脚注序号：①–⑳、⑴–⒇、㉑–㊿。紧跟在字后面的是正文里的脚注符号，排成右上角的小字（上标）；
// 在段首、句号分号冒号后面的是脚注区里每一条开头的序号，照正常字号排（课本、书刊都是这样）。
const NOTE_MARK = /[\u2460-\u2487\u3251-\u325F\u32B1-\u32BF]/;
const NOTE_AFTER = new Set(Array.from('。！？；：…!?;:'));
const SUP_SCALE = 0.58;

export function isPunct(ch) {
  return PUNCT.test(ch) && !/[0-9A-Za-z]/.test(ch);
}

export function isCjk(ch) {
  return CJK.test(ch);
}

// 可以排的字符数（不计空白）。
export function glyphCount(text) {
  return Array.from(String(text || '')).filter((ch) => !/\s/.test(ch)).length;
}

// ---------------------------------------------------------------- 字体与度量

// fonts：主字体在前，后面是缺字时依次补字的字体。每个字符取第一个有这个字的字体。
function pick(fonts, ch) {
  const cp = ch.codePointAt(0);
  for (const font of fonts) {
    const gid = font.glyphId(cp);
    if (gid) return { font, gid };
  }
  return null;
}

// 汉字字身框（em 框）的竖直中心，字体单位。不能只用 ascender/descender：不少毛笔字体的
// 上下伸部写得很夸张，按它居中会让整列字偏上或偏下。改用几个方块字的轮廓框中心取平均。
const CENTER_PROBES = Array.from('国永中日田口回');
const centerCache = new WeakMap();
export function emCenter(font) {
  if (centerCache.has(font)) return centerCache.get(font);
  const centers = [];
  for (const ch of CENTER_PROBES) {
    const gid = font.glyphId(ch.codePointAt(0));
    const outline = gid ? font.outline(gid) : null;
    if (outline && outline.contours.length) centers.push((outline.yMin + outline.yMax) / 2);
  }
  centers.sort((a, b) => a - b);
  const value = centers.length ? centers[Math.floor(centers.length / 2)] : (font.ascender + font.descender) / 2;
  centerCache.set(font, value);
  return value;
}

export function probeChars() {
  return CENTER_PROBES.join('');
}

// ---------------------------------------------------------------- 随机抖动（手写感）

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashText(text) {
  let h = 2166136261;
  for (const ch of String(text)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------- 排版入口

// 把一段文字排进 box（{ x, y, w, h }，像素）。opts：
//   direction 'horizontal' | 'vertical'（竖排：从上到下、从右到左）
//   align     'start' | 'center' | 'end'（横排是左中右；竖排是每列的上中下）
//   punctuation（竖排）'inline' 占一格 | 'side' 小字写在字旁、不占格 | 'omit' 不写
//   handwriting  true 时每个字加一点大小、角度、位置的随机变化（毛笔字体用）
//   minSize   字号下限（像素），排不下就返回 fits: false
//   maxSize   字号上限（像素）
// 返回 { fits, size, glyphs: [{ font, gid, m, ch }], rows, cols, lines, dropped, reason }。
export function layoutText(fonts, text, box, opts) {
  const options = opts || {};
  const direction = options.direction === 'vertical' ? 'vertical' : 'horizontal';
  return direction === 'vertical' ? layoutVertical(fonts, text, box, options) : layoutHorizontal(fonts, text, box, options);
}

// ---------------------------------------------------------------- 竖排

function layoutVertical(fonts, text, box, options) {
  const punctMode = ['inline', 'side', 'omit'].includes(options.punctuation) ? options.punctuation : 'inline';
  const charGap = options.charSpacing === undefined ? 0.1 : Number(options.charSpacing);
  const colGap = options.columnSpacing === undefined ? (punctMode === 'side' ? 0.5 : 0.35) : Number(options.columnSpacing);
  const rand = seeded(hashText(text) ^ 0x9e3779b9);
  const main = fonts[0];

  // 先切成字格：每个非标点字一格；标点按模式处理（占格 / 挂到相邻字上 / 丢掉）。
  const paragraphs = [];
  let current = [];
  const dropped = [];
  const missing = [];
  const pendingOpen = [];
  for (const ch of Array.from(String(text || ''))) {
    if (ch === '\n') {
      paragraphs.push(current);
      current = [];
      continue;
    }
    if (/\s/.test(ch)) continue;
    const punct = isPunct(ch);
    if (punct && punctMode === 'omit') {
      dropped.push(ch);
      continue;
    }
    if (punct && punctMode === 'side') {
      if (NO_END.has(ch)) pendingOpen.push(ch);
      else if (current.length) current[current.length - 1].after.push(ch);
      else if (paragraphs.length && paragraphs[paragraphs.length - 1].length) {
        const last = paragraphs[paragraphs.length - 1];
        last[last.length - 1].after.push(ch);
      } else pendingOpen.push(ch);
      continue;
    }
    const cell = { ch, before: pendingOpen.splice(0), after: [], punct };
    current.push(cell);
  }
  if (current.length) paragraphs.push(current);
  if (pendingOpen.length && paragraphs.length) {
    const last = paragraphs[paragraphs.length - 1];
    if (last.length) last[last.length - 1].after.push(...pendingOpen.splice(0));
  }
  const cells = paragraphs.flat();
  if (!cells.length) return { fits: false, reason: 'empty', size: 0, glyphs: [], rows: 0, cols: 0, dropped, missing };

  // 选每列字数：让字号最大。
  const longest = Math.max(...paragraphs.map((p) => p.length));
  let best = null;
  for (let rows = 1; rows <= longest; rows += 1) {
    const columns = splitColumns(paragraphs, rows, punctMode);
    const cols = columns.length;
    const sizeByH = box.h / (rows * (1 + charGap) - charGap);
    const sizeByW = box.w / (cols * (1 + colGap) - colGap);
    const size = Math.min(sizeByH, sizeByW, options.maxSize || Infinity);
    if (!best || size > best.size + 1e-6) best = { rows, cols, size, columns };
  }
  const size = best.size;
  const fits = size >= (options.minSize || 0);
  const cols = best.columns.length;
  // 列距：宽度有富余时把列铺满整个区域（书法长卷是满纸写的），但列距最多放到字宽的 1.2 倍，
  // 再多就居中，免得几列字散在一大张纸上。
  const naturalPitch = size * (1 + colGap);
  let pitchX = cols > 1 ? Math.min((box.w - size) / (cols - 1), size * 2.2) : 0;
  if (pitchX < naturalPitch) pitchX = naturalPitch;
  const blockW = (cols - 1) * pitchX + size;
  const startRight = box.x + box.w - (box.w - blockW) / 2 - size / 2;
  const pitchY = size * (1 + charGap);
  const glyphs = [];
  const handwriting = Boolean(options.handwriting);
  best.columns.forEach((column, ci) => {
    const colDrift = handwriting ? (rand() - 0.5) * 0.08 * size : 0;
    const cx = startRight - ci * pitchX + colDrift;
    const usedH = (column.length - 1) * pitchY + size;
    let top = box.y;
    if (options.align === 'center') top = box.y + (box.h - usedH) / 2;
    else if (options.align === 'end') top = box.y + box.h - usedH;
    column.forEach((cell, ri) => {
      const cy = top + ri * pitchY + size / 2;
      placeVerticalCell(glyphs, fonts, cell.ch, cx, cy, size, handwriting ? rand : null, missing, cell.punct);
      cell.before.forEach((mark, k) => placeSideMark(glyphs, fonts, mark, cx, cy - size * (0.32 + k * 0.22), size, pitchX, missing));
      cell.after.forEach((mark, k) => placeSideMark(glyphs, fonts, mark, cx, cy + size * (0.3 + k * 0.24), size, pitchX, missing));
    });
  });
  return {
    fits,
    reason: fits ? '' : 'too_small',
    size: round2(size),
    glyphs,
    rows: best.rows,
    cols,
    lines: cols,
    cells: cells.length,
    dropped,
    missing: [...new Set(missing)],
    font: main ? main.family : '',
  };
}

// 按每列 rows 个字切列；占格的标点不能落在列首，落在列首时挂回上一列列尾（挤在最后一格的旁边）。
function splitColumns(paragraphs, rows, punctMode) {
  const columns = [];
  for (const paragraph of paragraphs) {
    let column = [];
    for (const cell of paragraph) {
      if (column.length >= rows) {
        if (punctMode === 'inline' && NO_START.has(cell.ch) && column.length) {
          column[column.length - 1] = { ...column[column.length - 1], after: [...column[column.length - 1].after, cell.ch] };
          continue;
        }
        columns.push(column);
        column = [];
      }
      column.push(cell);
    }
    if (column.length) columns.push(column);
  }
  return columns;
}

function placeVerticalCell(glyphs, fonts, ch, cx, cy, size, rand, missing, punct) {
  let glyphCh = ch;
  let rotate = 0;
  if (VERTICAL_QUOTE[ch]) {
    const [vertical, corner] = VERTICAL_QUOTE[ch];
    if (pick(fonts, vertical)) glyphCh = vertical;
    else if (pick(fonts, corner)) {
      glyphCh = corner;
      rotate = Math.PI / 2;
    } else rotate = Math.PI / 2;
  } else if (ROTATE.has(ch)) rotate = Math.PI / 2;
  const hit = pick(fonts, glyphCh);
  if (!hit) {
    missing.push(ch);
    return;
  }
  const scale = size / hit.font.unitsPerEm;
  const outline = hit.font.outline(hit.gid);
  if (!outline) return;
  if (punct) {
    const pivot = [(outline.xMin + outline.xMax) / 2, (outline.yMin + outline.yMax) / 2];
    let at = [cx, cy];
    if (CORNER.has(ch)) at = [cx + size * 0.24, cy - size * 0.24];
    glyphs.push({ font: hit.font, gid: hit.gid, ch, m: placeMatrix(scale, rotate, pivot, at) });
    return;
  }
  const adv = hit.font.advance(hit.gid) || hit.font.unitsPerEm;
  const pivot = [adv / 2, emCenter(hit.font)];
  let s = scale;
  let theta = rotate;
  let at = [cx, cy];
  if (rand) {
    s *= 0.95 + rand() * 0.1;
    theta += (rand() - 0.5) * 0.045;
    at = [cx + (rand() - 0.5) * 0.05 * size, cy + (rand() - 0.5) * 0.05 * size];
  }
  glyphs.push({ font: hit.font, gid: hit.gid, ch, m: placeMatrix(s, theta, pivot, at), alpha: rand ? 0.9 + rand() * 0.1 : 1 });
}

// 不占格的标点：缩小写在字的右侧（右下挂在前一个字上，开引号、开括号挂在后一个字的右上）。
function placeSideMark(glyphs, fonts, ch, cx, cy, size, pitchX, missing) {
  let glyphCh = ch;
  let rotate = 0;
  if (VERTICAL_QUOTE[ch]) {
    const [vertical, corner] = VERTICAL_QUOTE[ch];
    if (pick(fonts, vertical)) glyphCh = vertical;
    else if (pick(fonts, corner)) {
      glyphCh = corner;
      rotate = Math.PI / 2;
    } else rotate = Math.PI / 2;
  } else if (ROTATE.has(ch)) rotate = Math.PI / 2;
  const hit = pick(fonts, glyphCh);
  if (!hit) {
    missing.push(ch);
    return;
  }
  const outline = hit.font.outline(hit.gid);
  if (!outline) return;
  const markSize = size * 0.5;
  const scale = markSize / hit.font.unitsPerEm;
  const pivot = [(outline.xMin + outline.xMax) / 2, (outline.yMin + outline.yMax) / 2];
  // 紧贴本字的右缘：放在列缝正中会分不清是这一列的还是右边那一列的。
  const halfInk = ((rotate ? outline.yMax - outline.yMin : outline.xMax - outline.xMin) * scale) / 2;
  const gap = Math.max(0, pitchX - size);
  const x = cx + size / 2 + halfInk + Math.min(gap * 0.12, size * 0.06);
  glyphs.push({ font: hit.font, gid: hit.gid, ch, m: placeMatrix(scale, rotate, pivot, [x, cy]) });
}

// ---------------------------------------------------------------- 横排

function layoutHorizontal(fonts, text, box, options) {
  const lineGap = options.lineSpacing === undefined ? 0.35 : Number(options.lineSpacing);
  const letter = options.letterSpacing === undefined ? 0 : Number(options.letterSpacing);
  const missing = [];
  const chars = Array.from(String(text || '').replace(/\r\n?/g, '\n'));
  const items = [];
  for (const ch of chars) {
    if (ch === '\n') {
      items.push({ ch, newline: true });
      continue;
    }
    // 全角空格占一个字宽：段首空两格就是两个全角空格。其余空白当半角空格。
    if (ch === '\u3000') {
      items.push({ ch, space: true, full: true });
      continue;
    }
    if (/\s/.test(ch)) {
      items.push({ ch: ' ', space: true });
      continue;
    }
    const hit = pick(fonts, ch);
    if (!hit) {
      missing.push(ch);
      continue;
    }
    const prev = items[items.length - 1];
    const sup = options.superscript !== false && NOTE_MARK.test(ch) && prev && !prev.newline && !prev.space && !NOTE_AFTER.has(prev.ch);
    items.push({ ch, font: hit.font, gid: hit.gid, adv: (hit.font.advance(hit.gid) / hit.font.unitsPerEm) * (sup ? SUP_SCALE : 1), sup });
  }
  // 断行单位：汉字一个字一个单位；连续的西文字母数字是一个词，不从中间断；
  // 行首禁则标点并进前一个单位，行尾禁则标点并进后一个单位。
  const units = [];
  let word = null;
  for (const item of items) {
    if (item.newline) {
      word = null;
      units.push({ newline: true });
      continue;
    }
    if (item.space) {
      word = null;
      units.push({ space: true, full: Boolean(item.full), items: [{ ch: item.ch, adv: item.full ? 1 : 0.3 }] });
      continue;
    }
    const latin = /[0-9A-Za-z\u00C0-\u024F'@#&_\-./:%+]/.test(item.ch) && !isCjk(item.ch);
    if (latin && word) {
      word.items.push(item);
      continue;
    }
    const unit = { items: [item] };
    word = latin ? unit : null;
    const prev = units[units.length - 1];
    // 上标的脚注符号和它前面的字绑在一起：「闰土①」不能把①甩到下一行行首。
    if ((NO_START.has(item.ch) || item.sup) && prev && !prev.newline && !prev.space) {
      prev.items.push(item);
      word = null;
      continue;
    }
    if (prev && prev.openTail) {
      prev.items.push(item);
      prev.openTail = NO_END.has(item.ch);
      if (latin) word = prev;
      continue;
    }
    unit.openTail = NO_END.has(item.ch);
    units.push(unit);
  }
  const widthOf = (unit, size) => unit.items.reduce((sum, item) => sum + item.adv * size + letter * size, 0);

  function breakLines(size) {
    const lines = [];
    let current = [];
    let width = 0;
    // 段首（开头、换行之后）的空格是有意写的：全角空格是缩进，半角空格用来对齐（规划把矩阵逐行写成
    // 「A = [ 1 2 3 ]」「     [ 4 5 6 ]」）。只有自动折行到下一行的行首空白才去掉。
    let paragraphStart = true;
    const push = () => {
      while (current.length && current[current.length - 1].space) current.pop();
      lines.push(current);
      current = [];
      width = 0;
    };
    for (const unit of units) {
      if (unit.newline) {
        current.paraEnd = true;
        push();
        paragraphStart = true;
        continue;
      }
      if (unit.space && !current.length && !paragraphStart) continue;
      if (!unit.space) paragraphStart = false;
      const w = widthOf(unit, size);
      if (width + w <= box.w + 0.01 || !current.length) {
        if (w > box.w + 0.01 && !unit.space) {
          // 一个词比整行还宽：按字拆开。
          for (const item of unit.items) {
            const iw = item.adv * size + letter * size;
            if (width + iw > box.w + 0.01 && current.length) push();
            current.push({ items: [item] });
            width += iw;
          }
          continue;
        }
        current.push(unit);
        width += w;
      } else {
        push();
        if (unit.space) continue;
        current.push(unit);
        width = w;
      }
    }
    if (current.length) {
      current.paraEnd = true;
      push();
    }
    return lines;
  }

  function fitsAt(size) {
    const lines = breakLines(size);
    const height = lines.length * size * (1 + lineGap) - size * lineGap;
    if (height > box.h + 0.01) return null;
    for (const lineUnits of lines) {
      const w = lineUnits.reduce((sum, unit) => sum + widthOf(unit, size), 0);
      if (w > box.w + 0.5) return null;
    }
    if (options.maxLines && lines.length > options.maxLines) return null;
    return lines;
  }

  let lo = Math.max(1, options.minSize ? options.minSize * 0.5 : 4);
  let hi = Math.min(box.h, options.maxSize || Infinity);
  let lines = fitsAt(hi);
  let size = hi;
  if (!lines) {
    for (let i = 0; i < 30; i += 1) {
      const mid = (lo + hi) / 2;
      if (fitsAt(mid)) lo = mid;
      else hi = mid;
    }
    size = lo;
    lines = fitsAt(size);
  }
  if (!lines) return { fits: false, reason: 'too_small', size: 0, glyphs: [], lines: 0, missing: [...new Set(missing)], dropped: [] };
  const fits = size >= (options.minSize || 0);
  const lineHeight = size * (1 + lineGap);
  const blockH = lines.length * lineHeight - size * lineGap;
  let top = box.y + (box.h - blockH) / 2;
  if (options.valign === 'start') top = box.y;
  else if (options.valign === 'end') top = box.y + box.h - blockH;
  const glyphs = [];
  lines.forEach((lineUnits, li) => {
    const items = lineUnits.flatMap((unit) => unit.items);
    const w = items.reduce((sum, item) => sum + item.adv * size + letter * size, 0) - letter * size;
    let x = box.x;
    if (options.align === 'center') x = box.x + (box.w - w) / 2;
    else if (options.align === 'end') x = box.x + box.w - w;
    // 两端对齐（正文、脚注）：除了每段最后一行，把这一行剩下的空当平均分进字距，右边缘才齐。
    // 差得太多（一行里只有一个长单词）就不硬撑，免得字被拉得很散。
    let spread = 0;
    if (options.justify && !lineUnits.paraEnd && items.length > 1 && (!options.align || options.align === 'start')) {
      spread = Math.max(0, box.w - w) / (items.length - 1);
      if (spread > size * 0.35) spread = 0;
    }
    const emTop = top + li * lineHeight;
    for (const item of items) {
      if (item.font) {
        // 上标：字身缩到 SUP_SCALE，顶边比这一行的字身顶边略高一点，落在前一个字的右上角。
        const glyphSize = item.sup ? size * SUP_SCALE : size;
        const glyphTop = item.sup ? emTop - size * 0.06 : emTop;
        const scale = glyphSize / item.font.unitsPerEm;
        const baseline = glyphTop + glyphSize / 2 + emCenter(item.font) * scale;
        glyphs.push({ font: item.font, gid: item.gid, ch: item.ch, m: [scale, 0, 0, -scale, x, baseline] });
      }
      x += item.adv * size + letter * size + spread;
    }
  });
  return {
    fits,
    reason: fits ? '' : 'too_small',
    size: round2(size),
    glyphs,
    lines: lines.length,
    rows: lines.length,
    cols: 0,
    missing: [...new Set(missing)],
    dropped: [],
    superscripts: items.filter((item) => item.sup).length,
    // 文字块实际占的上沿（像素）：脚注上方的分隔线画在它上面。
    top,
    font: fonts[0] ? fonts[0].family : '',
  };
}

function round2(value) {
  return Math.round(value * 100) / 100;
}
