// 程序合成 GIF 动图。生图模型一次只出一张静态图，动图由程序把几帧拼起来：统一缩到同一尺寸，
// 所有帧共用一套调色板，编码成 GIF89a。
//
// 各帧都是从参考图（或前一帧）改出来的，没动的地方理应和参考图一样，但模型每次都会把整幅重画一遍：
// 细纹理（笔触、颗粒、雨丝）全变了，整体色调差几级，画面还会错开一两个像素、放大不到 1%。
// 真机 20261115-d7e30e 的水彩雨景：只改猫头的一帧有 16% 的像素差超过 14 级，改伞的两帧错开 1–3 像素；
// 原样拼起来静止的背景每一帧都在闪。所以给了参考图（base）时，每一帧先对齐参考图、校正色调，
// 再找出真正变了的区域，区域外一律用参考图的像素：背景一动不动，只有动作的部位在变。
// 编码时和当前画面差得很少的像素沿用上一帧（透明像素 + 不清除上一帧），只更新真正变了的地方。
// 共用调色板保证同一种颜色在每一帧里都是同一个色号，颜色不会跳。
// 关键帧之间可以补几帧渐变（tween）：几百毫秒一个姿态的关键帧，硬切看起来是一下一下跳的。
//
// decodeGif 用来校验交付文件：帧数、尺寸、每帧时长都从写出去的字节里读回来核对。

export const GIF_DEFAULTS = {
  edge: 768,
  frameMs: 300,
  // 每个通道和当前画面相差不超过这个值的像素沿用上一帧。
  stabilize: 14,
  // 色号 255 留给透明。
  colors: 255,
  // 相邻两个关键帧之间补几帧渐变，0 是直接切换。
  tween: 0,
};

// 锁背景的参数按长边 768 定，别的尺寸按比例缩放。阈值用 20261115-d7e30e 的四帧调过：
// 只改猫头的一帧，变化区域只剩猫（约 4%）；改伞的帧，变化区域是人、伞和伞挪开后露出的背景（25–35%）。
const LOCK = {
  // 对齐时每一块最多往各个方向找几个像素。
  search: 4,
  // 先模糊再比较：笔触、颗粒、雨丝这类细纹理的差别正负相抵，真正的形状变化留下来。
  blur: 4,
  threshold: 12,
  // 先腐蚀再膨胀，去掉零星的噪点。
  open: 2,
  // 变化区域往外扩，把动作的边缘、跟着动的阴影一起带上。
  grow: 6,
  feather: 3,
  // 变化区域超过整幅的这个比例，说明整幅画都在变（换光线、换场景），锁了反而丢掉变化。
  maxArea: 0.7,
};

const TRANSPARENT = 255;

export function isGif(buffer) {
  return Boolean(buffer && buffer.length > 6 && /^GIF8[79]a$/.test(Buffer.from(buffer.subarray(0, 6)).toString('ascii')));
}

// images：解码后的帧 {width,height,channels,data}。options.width/height 给了就按它定尺寸，否则按第一帧：
// 长边缩到 edge，其余帧居中裁到同一画幅再缩放。
// options.delays：每帧毫秒数（数组），没给的用 frameMs。loop：true 无限循环，false 只播一遍。
// options.base：各帧共同的参考图。给了就把每一帧锁到它上面（见文件开头），不给就只按第一帧校正色调。
// options.tween：相邻关键帧之间补几帧渐变，渐变的时间从前一个关键帧里扣，整组时长不变。
export function makeGif(images, options) {
  const opts = { ...GIF_DEFAULTS, ...(options || {}) };
  if (!Array.isArray(images) || !images.length) throw new Error('gif_no_frames');
  const size = opts.width && opts.height ? { width: opts.width, height: opts.height } : gifSize(images[0].width, images[0].height, opts.edge);
  const { width, height } = size;
  let frames = images.map((image) => fitFrame(image, width, height));
  let locked = null;
  if (opts.base) {
    const ctx = lockContext(fitFrame(opts.base, width, height));
    locked = [];
    frames = frames.map((frame) => {
      const result = lockFrame(frame, ctx);
      locked.push(result.info);
      return result.frame;
    });
  } else if (opts.matchTone !== false) {
    for (let i = 1; i < frames.length; i += 1) frames[i] = matchTone(frames[i], frames[0]);
  }
  let delays = frames.map((_, index) => clampDelay((opts.delays && opts.delays[index]) || opts.frameMs));
  let tweens = 0;
  let cuts = 0;
  if (opts.tween > 0 && frames.length > 1) {
    const result = addTweens(frames, delays, Math.min(4, Math.round(opts.tween)), opts.loop !== false, opts.tweenMaxChange || 0);
    frames = result.frames;
    delays = result.delays;
    tweens = result.added;
    cuts = result.cuts;
  }
  const { palette, flat } = buildPalette(frames, opts.colors);
  const dither = opts.dither === undefined ? (flat ? 'none' : 'ordered') : opts.dither;
  const mapper = makeMapper(palette);

  const chunks = [];
  chunks.push(Buffer.from('GIF89a', 'ascii'));
  chunks.push(u16le(width), u16le(height), Buffer.from([0xf7, 0, 0]));
  const table = Buffer.alloc(256 * 3);
  for (let i = 0; i < palette.length; i += 1) {
    table[i * 3] = palette[i][0];
    table[i * 3 + 1] = palette[i][1];
    table[i * 3 + 2] = palette[i][2];
  }
  chunks.push(table);
  if (opts.loop !== false) {
    chunks.push(Buffer.from([0x21, 0xff, 0x0b]), Buffer.from('NETSCAPE2.0', 'ascii'), Buffer.from([0x03, 0x01, 0x00, 0x00, 0x00]));
  }

  const shown = new Uint8Array(width * height * 3);
  const written = [];
  const changed = [];
  for (let index = 0; index < frames.length; index += 1) {
    const src = frames[index].data;
    let rect;
    let indices;
    if (index === 0) {
      rect = { x: 0, y: 0, w: width, h: height };
      indices = new Uint8Array(width * height);
      for (let p = 0; p < width * height; p += 1) indices[p] = mapper(src, p * 3, p % width, (p / width) | 0, dither);
      shown.set(src);
      changed.push(1);
    } else {
      const mask = changeMask(src, shown, width, height, opts.stabilize);
      const box = maskBounds(mask, width, height);
      if (!box) {
        // 和上一帧一模一样：并到上一帧的时长里，不单独写一帧。
        written[written.length - 1].delay += delays[index];
        changed.push(0);
        continue;
      }
      rect = box;
      indices = new Uint8Array(box.w * box.h);
      let count = 0;
      for (let y = 0; y < box.h; y += 1) {
        for (let x = 0; x < box.w; x += 1) {
          const p = (box.y + y) * width + box.x + x;
          if (mask[p]) {
            indices[y * box.w + x] = mapper(src, p * 3, box.x + x, box.y + y, dither);
            shown[p * 3] = src[p * 3];
            shown[p * 3 + 1] = src[p * 3 + 1];
            shown[p * 3 + 2] = src[p * 3 + 2];
            count += 1;
          } else {
            indices[y * box.w + x] = TRANSPARENT;
          }
        }
      }
      changed.push(count / (width * height));
    }
    written.push({ rect, indices, delay: delays[index], transparent: index > 0 });
  }

  for (const frame of written) {
    const cs = Math.max(2, Math.round(frame.delay / 10));
    chunks.push(Buffer.from([0x21, 0xf9, 0x04, (1 << 2) | (frame.transparent ? 1 : 0), cs & 0xff, (cs >> 8) & 0xff, frame.transparent ? TRANSPARENT : 0, 0]));
    chunks.push(Buffer.from([0x2c]), u16le(frame.rect.x), u16le(frame.rect.y), u16le(frame.rect.w), u16le(frame.rect.h), Buffer.from([0]));
    chunks.push(Buffer.from([8]), subBlocks(lzwEncode(frame.indices, 8)));
  }
  chunks.push(Buffer.from([0x3b]));
  const buffer = Buffer.concat(chunks);
  return {
    buffer,
    width,
    height,
    frameCount: written.length,
    delays: written.map((frame) => frame.delay),
    dither,
    colors: palette.length,
    changed,
    locked,
    tweens,
    // 动作跨度太大、没有补渐变的地方（叠出来是两个半透明的人影，见 addTweens）。
    cuts,
  };
}

function clampDelay(ms) {
  return Math.max(20, Math.min(10000, Math.round(Number(ms) || GIF_DEFAULTS.frameMs)));
}

// 长边缩到 edge（不放大）后的 GIF 尺寸。
export function gifSize(width, height, edge) {
  const scale = Math.min(1, (edge || GIF_DEFAULTS.edge) / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// 两帧之间变了的像素占比：缩到 160 像素再比，某个通道差超过 24 级算变了。
export function changeShare(a, b) {
  const S = 160;
  const w = Math.max(1, Math.round(a.width >= a.height ? S : (S * a.width) / a.height));
  const h = Math.max(1, Math.round(a.width >= a.height ? (S * a.height) / a.width : S));
  const x = resizeArea(toRgb(a), w, h).data;
  const y = resizeArea(toRgb(b), w, h).data;
  let changed = 0;
  for (let p = 0; p < w * h; p += 1) {
    const o = p * 3;
    if (Math.max(Math.abs(x[o] - y[o]), Math.abs(x[o + 1] - y[o + 1]), Math.abs(x[o + 2] - y[o + 2])) > 24) changed += 1;
  }
  return changed / (w * h);
}

// 各帧锁回参考图之后（和合成 GIF 时一样），相邻两帧变了多少。循环时最后一帧接回第一帧也算一步。
// 返回 [{ from, to, change }]，change 是占整幅的比例。用来找一步跨得太大的地方补中间帧（见 animation.smoothSteps）。
export function motionSteps(images, base, options) {
  const opts = options || {};
  const size = gifSize(base.width, base.height, opts.edge || 384);
  const ctx = lockContext(fitFrame(base, size.width, size.height));
  const frames = images.map((image) => lockFrame(fitFrame(image, size.width, size.height), ctx).frame);
  const out = [];
  for (let i = 0; i < frames.length; i += 1) {
    const next = i + 1 < frames.length ? i + 1 : opts.loop ? 0 : -1;
    if (next < 0 || next === i) continue;
    out.push({ from: i, to: next, change: Math.round(changeShare(frames[i], frames[next]) * 1000) / 1000 });
  }
  return out;
}

// 把一帧变成 GIF 尺寸的 RGB：先居中裁到目标画幅，再面积平均缩放。尺寸已经对的原样返回。
export function fitFrame(image, width, height) {
  if (image.channels === 3 && image.width === width && image.height === height) return image;
  return resizeArea(cropToAspect(toRgb(image), width / height), width, height);
}

function u16le(value) {
  return Buffer.from([value & 0xff, (value >> 8) & 0xff]);
}

export function toRgb(image) {
  const { width, height, channels, data } = image;
  if (channels === 3) return { width, height, channels: 3, data };
  const out = Buffer.alloc(width * height * 3);
  for (let p = 0; p < width * height; p += 1) {
    const s = p * channels;
    let r;
    let g;
    let b;
    let a = 255;
    if (channels >= 3) {
      r = data[s];
      g = data[s + 1];
      b = data[s + 2];
      if (channels === 4) a = data[s + 3];
    } else {
      r = g = b = data[s];
      if (channels === 2) a = data[s + 1];
    }
    // 半透明的地方铺在白底上：GIF 只有全透明和不透明两种。
    out[p * 3] = Math.round((r * a + 255 * (255 - a)) / 255);
    out[p * 3 + 1] = Math.round((g * a + 255 * (255 - a)) / 255);
    out[p * 3 + 2] = Math.round((b * a + 255 * (255 - a)) / 255);
  }
  return { width, height, channels: 3, data: out };
}

// 画幅差得不多的帧（接口偶尔回一个略有不同的尺寸）居中裁成第一帧的画幅，不拉伸。
function cropToAspect(image, aspect) {
  const current = image.width / image.height;
  if (Math.abs(current - aspect) / aspect < 0.005) return image;
  let w = image.width;
  let h = image.height;
  if (current > aspect) w = Math.max(1, Math.round(h * aspect));
  else h = Math.max(1, Math.round(w / aspect));
  const x0 = Math.floor((image.width - w) / 2);
  const y0 = Math.floor((image.height - h) / 2);
  const out = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y += 1) {
    const s = ((y0 + y) * image.width + x0) * 3;
    out.set(image.data.subarray(s, s + w * 3), y * w * 3);
  }
  return { width: w, height: h, channels: 3, data: out };
}

// 接口改出来的帧整体色调常和参考图差一两级（实测一帧的背景整体暗了约 3 / 255）。沿用上一帧的像素和
// 新更新的像素拼在一起时，这点差别会在动的部位周围拼出一块看得见的色块。用两帧里没动的像素（差得少的）
// 量出每个通道的平均偏差，整帧平移回去。
function matchTone(frame, reference) {
  const a = frame.data;
  const b = reference.data;
  const sums = [0, 0, 0];
  let n = 0;
  for (let s = 0; s < a.length; s += 3 * 3) {
    if (Math.abs(a[s] - b[s]) + Math.abs(a[s + 1] - b[s + 1]) + Math.abs(a[s + 2] - b[s + 2]) > 60) continue;
    sums[0] += b[s] - a[s];
    sums[1] += b[s + 1] - a[s + 1];
    sums[2] += b[s + 2] - a[s + 2];
    n += 1;
  }
  if (n < a.length / 3 / 3 / 10) return frame;
  const offsets = sums.map((sum) => Math.max(-20, Math.min(20, Math.round(sum / n))));
  if (!offsets[0] && !offsets[1] && !offsets[2]) return frame;
  const out = Buffer.alloc(a.length);
  for (let s = 0; s < a.length; s += 3) {
    out[s] = Math.max(0, Math.min(255, a[s] + offsets[0]));
    out[s + 1] = Math.max(0, Math.min(255, a[s + 1] + offsets[1]));
    out[s + 2] = Math.max(0, Math.min(255, a[s + 2] + offsets[2]));
  }
  return { width: frame.width, height: frame.height, channels: 3, data: out };
}

// ------------------------------------------------------------------ 锁背景

// 一帧锁到另一帧上：对齐、校正色调，只留下真正变了的区域，其余用 base 的像素（见 lockFrame）。
// 组图的过渡格用它：过渡格是另一张图里重画的，背景的细纹理、屏幕上的走势每个像素都差一点，原样放进去，
// 前一格 → 过渡格 → 后一格的背景要闪两下，GIF 也大一倍多（真机 20261119-250f55：909 KB 变成 2430 KB）。
// maxArea：变化区域超过整幅的这么多就不锁（默认同 LOCK.maxArea）。过渡格的背景照规定和那一格一样，变化区域大是因为主体大、
// 动得多（真机一格双手从头上放到肩膀，变化区域 73%），这时照样锁住剩下的背景。
export function lockToBase(frame, base, maxArea) {
  return lockFrame(fitFrame(frame, base.width, base.height), lockContext(base), maxArea);
}

function lockContext(base) {
  const { width, height } = base;
  const unit = Math.max(width, height) / 768;
  const radius = (value) => Math.max(1, Math.round(value * unit));
  const radii = { blur: radius(LOCK.blur), open: radius(LOCK.open), grow: radius(LOCK.grow), feather: radius(LOCK.feather) };
  return { base, width, height, radii, search: Math.max(2, Math.round(LOCK.search * unit)), luma: luma(base), blurred: boxBlur(base.data, width, height, 3, radii.blur) };
}

// 返回锁好的帧和一段说明（对齐挪了多少、变化区域占多大），和参考图一模一样的帧原样返回、说明为 null。
function lockFrame(frame, ctx, maxArea) {
  const { base, width, height } = ctx;
  if (frame === base || Buffer.compare(frame.data, base.data) === 0) return { frame: base, info: null };
  const shift = estimateShift(frame, ctx);
  const aligned = shift ? warp(frame, shift, base) : frame;
  const toned = matchTone(aligned, base);
  const { alpha, area } = changeArea(toned, ctx);
  const info = {
    dx: shift ? round2(shift.bx) : 0,
    dy: shift ? round2(shift.by) : 0,
    scale: shift ? round2(((shift.ax + shift.ay) / 2) * 100) : 0,
    area: round2(area),
    locked: area <= (maxArea || LOCK.maxArea),
  };
  if (!info.locked) return { frame: toned, info };
  const a = toned.data;
  const b = base.data;
  const out = Buffer.alloc(width * height * 3);
  for (let p = 0; p < width * height; p += 1) {
    const k = alpha[p];
    const s = p * 3;
    if (k <= 0) {
      out[s] = b[s];
      out[s + 1] = b[s + 1];
      out[s + 2] = b[s + 2];
    } else {
      out[s] = Math.round(b[s] + (a[s] - b[s]) * k);
      out[s + 1] = Math.round(b[s + 1] + (a[s + 1] - b[s + 1]) * k);
      out[s + 2] = Math.round(b[s + 2] + (a[s + 2] - b[s + 2]) * k);
    }
  }
  return { frame: { width, height, channels: 3, data: out }, info };
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

// 这一帧相对参考图挪了多少：画面切成 6×8 左右的块，每块在 ±search 像素里找最贴合的位置（再用抛物线细到亚像素）。
// 人物在动的块对不上，纹理太平的块哪儿都差不多，两种都不要；剩下的块拟合「每个方向一个缩放 + 一个平移」，
// 偏差大的块剔掉再拟合。模型改图时画面会整体放大一点点，只算平移的话画面两边仍然对不上。
function estimateShift(frame, ctx) {
  const { width: w, height: h, search: S } = ctx;
  const patch = Math.max(16, Math.round(Math.min(w, h) / 6));
  const bg = ctx.luma;
  const fg = luma(frame);
  const side = 2 * S + 1;
  const costs = new Float64Array(side * side);
  const samples = Math.ceil(patch / 2) * Math.ceil(patch / 2);
  const points = [];
  for (let y0 = S; y0 < h - patch - S; y0 += patch) {
    for (let x0 = S; x0 < w - patch - S; x0 += patch) {
      for (let v = -S; v <= S; v += 1) {
        for (let u = -S; u <= S; u += 1) {
          let sum = 0;
          for (let y = y0; y < y0 + patch; y += 2) {
            const rb = y * w;
            const rf = (y + v) * w + u;
            for (let x = x0; x < x0 + patch; x += 2) sum += Math.abs(bg[rb + x] - fg[rf + x]);
          }
          costs[(v + S) * side + u + S] = sum;
        }
      }
      let bi = 0;
      for (let i = 1; i < costs.length; i += 1) if (costs[i] < costs[bi]) bi = i;
      const bu = bi % side;
      const bv = (bi / side) | 0;
      let far = Infinity;
      for (let i = 0; i < costs.length; i += 1) {
        if (Math.abs((i % side) - bu) <= 1 && Math.abs(((i / side) | 0) - bv) <= 1) continue;
        if (costs[i] < far) far = costs[i];
      }
      if (costs[bi] / samples > 14 || far < costs[bi] * 1.15) continue;
      const refine = (before, at, after) => {
        const den = before - 2 * at + after;
        return den > 1e-9 ? Math.max(-0.5, Math.min(0.5, (0.5 * (before - after)) / den)) : 0;
      };
      const du = bu > 0 && bu < side - 1 ? refine(costs[bi - 1], costs[bi], costs[bi + 1]) : 0;
      const dv = bv > 0 && bv < side - 1 ? refine(costs[bi - side], costs[bi], costs[bi + side]) : 0;
      points.push({ x: x0 + patch / 2, y: y0 + patch / 2, dx: bu - S + du, dy: bv - S + dv });
    }
  }
  if (points.length < 3) return null;
  const fx = fitAxis(points.map((p) => p.x), points.map((p) => p.dx), w / 2, S);
  const fy = fitAxis(points.map((p) => p.y), points.map((p) => p.dy), h / 2, S);
  // 挪得最多的地方（画面四角）也不到 0.25 像素：不重采样，免得白白糊一点。
  if (Math.abs(fx.a) * (w / 2) + Math.abs(fx.b) < 0.25 && Math.abs(fy.a) * (h / 2) + Math.abs(fy.b) < 0.25) return null;
  return { ax: fx.a, bx: fx.b, ay: fy.a, by: fy.b, points: points.length };
}

// 位移 = a ×（坐标 − 中心）+ b，最小二乘；和拟合差 0.75 像素以上的块剔掉再来，最多三遍。块不到 6 个只算平移。
function fitAxis(coords, shifts, center, limit) {
  let keep = coords.map(() => true);
  let a = 0;
  let b = 0;
  for (let round = 0; round < 3; round += 1) {
    const idx = [];
    for (let i = 0; i < coords.length; i += 1) if (keep[i]) idx.push(i);
    if (idx.length >= 6) {
      let sx = 0;
      let sy = 0;
      let sxx = 0;
      let sxy = 0;
      for (const i of idx) {
        const x = coords[i] - center;
        sx += x;
        sy += shifts[i];
        sxx += x * x;
        sxy += x * shifts[i];
      }
      const n = idx.length;
      const den = n * sxx - sx * sx;
      a = den > 1e-9 ? Math.max(-0.02, Math.min(0.02, (n * sxy - sx * sy) / den)) : 0;
      b = (sy - a * sx) / n;
    } else {
      a = 0;
      b = median(idx.map((i) => shifts[i]));
    }
    const next = coords.map((c, i) => Math.abs(a * (c - center) + b - shifts[i]) < 0.75);
    if (next.filter(Boolean).length < 3) break;
    keep = next;
  }
  return { a, b: Math.max(-limit, Math.min(limit, b)) };
}

function median(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((x, y) => x - y);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// 按拟合出来的位移双线性取样，把这一帧挪回参考图的位置。挪完落到画面外、这一帧里没有的那一两个像素，
// 用参考图补上；照边缘像素外延的话，边上会多出一条每帧都在变的细线。
function warp(frame, shift, base) {
  const { width: w, height: h, data } = frame;
  const out = Buffer.alloc(w * h * 3);
  const cx = w / 2;
  const cy = h / 2;
  for (let y = 0; y < h; y += 1) {
    const ty = y + shift.ay * (y - cy) + shift.by;
    const sy = Math.max(0, Math.min(h - 1.001, ty));
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    const y1 = Math.min(h - 1, y0 + 1);
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * 3;
      const tx = x + shift.ax * (x - cx) + shift.bx;
      if (tx < -0.01 || tx > w - 0.99 || ty < -0.01 || ty > h - 0.99) {
        out[o] = base.data[o];
        out[o + 1] = base.data[o + 1];
        out[o + 2] = base.data[o + 2];
        continue;
      }
      const sx = Math.max(0, Math.min(w - 1.001, tx));
      const x0 = Math.floor(sx);
      const fx = sx - x0;
      const x1 = Math.min(w - 1, x0 + 1);
      const i00 = (y0 * w + x0) * 3;
      const i01 = (y0 * w + x1) * 3;
      const i10 = (y1 * w + x0) * 3;
      const i11 = (y1 * w + x1) * 3;
      for (let c = 0; c < 3; c += 1) {
        const top = data[i00 + c] + (data[i01 + c] - data[i00 + c]) * fx;
        const bottom = data[i10 + c] + (data[i11 + c] - data[i10 + c]) * fx;
        out[o + c] = Math.round(top + (bottom - top) * fy);
      }
    }
  }
  return { width: w, height: h, channels: 3, data: out };
}

// 真正变了的区域：两张图都模糊之后任一通道差超过阈值，去掉零星噪点，往外扩一圈，边缘做成渐变。
// alpha 是每个像素取这一帧的比例（0 全用参考图，1 全用这一帧）；area 是扩完之后的区域占整幅的比例。
function changeArea(frame, ctx) {
  const { width: w, height: h, radii } = ctx;
  const n = w * h;
  const blurred = boxBlur(frame.data, w, h, 3, radii.blur);
  const ref = ctx.blurred;
  const core = new Float32Array(n);
  for (let p = 0; p < n; p += 1) {
    const s = p * 3;
    const d = Math.max(Math.abs(blurred[s] - ref[s]), Math.abs(blurred[s + 1] - ref[s + 1]), Math.abs(blurred[s + 2] - ref[s + 2]));
    if (d > LOCK.threshold) core[p] = 1;
  }
  const eroded = above(boxBlur(core, w, h, 1, radii.open), 0.999);
  const opened = above(boxBlur(eroded, w, h, 1, radii.open), 0.001);
  const grown = above(boxBlur(opened, w, h, 1, radii.grow), 0.001);
  const alpha = boxBlur(grown, w, h, 1, radii.feather);
  let area = 0;
  for (let p = 0; p < n; p += 1) area += grown[p];
  return { alpha, area: area / n };
}

function above(values, threshold) {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 1) if (values[i] > threshold) out[i] = 1;
  return out;
}

function luma(image) {
  const n = image.width * image.height;
  const out = new Float32Array(n);
  const d = image.data;
  for (let p = 0; p < n; p += 1) out[p] = 0.299 * d[p * 3] + 0.587 * d[p * 3 + 1] + 0.114 * d[p * 3 + 2];
  return out;
}

// 方框模糊（边缘像素外延），先横后竖，每个方向用滑动窗口的累加和，和半径无关。
function boxBlur(src, w, h, channels, r) {
  const tmp = new Float32Array(w * h * channels);
  const out = new Float32Array(w * h * channels);
  const k = 2 * r + 1;
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    for (let c = 0; c < channels; c += 1) {
      let acc = 0;
      for (let i = -r; i <= r; i += 1) acc += src[(row + Math.min(w - 1, Math.max(0, i))) * channels + c];
      for (let x = 0; x < w; x += 1) {
        tmp[(row + x) * channels + c] = acc / k;
        acc += src[(row + Math.min(w - 1, x + r + 1)) * channels + c] - src[(row + Math.max(0, x - r)) * channels + c];
      }
    }
  }
  for (let x = 0; x < w; x += 1) {
    for (let c = 0; c < channels; c += 1) {
      let acc = 0;
      for (let i = -r; i <= r; i += 1) acc += tmp[(Math.min(h - 1, Math.max(0, i)) * w + x) * channels + c];
      for (let y = 0; y < h; y += 1) {
        out[(y * w + x) * channels + c] = acc / k;
        acc += tmp[(Math.min(h - 1, y + r + 1) * w + x) * channels + c] - tmp[(Math.max(0, y - r) * w + x) * channels + c];
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ 过渡帧

// 每个关键帧和下一帧（循环时最后一帧接回第一帧）之间插 count 帧渐变。渐变每帧的时长取两帧里短的那个的 15%
// （40–100 毫秒），从前一个关键帧的时长里扣，关键帧自己至少留一半；关键帧短于 120 毫秒不插，快节奏的本来就看不出跳。
// 渐变是两张图按比例叠在一起，不是中间的动作：两帧差得多（转头、手从画面外抬进来）时叠出来是两个半透明的人影
// （真机 20261117-21581a：头周围一圈虚影、手半透明）。maxChange 给了就只在变化不超过它的两帧之间补渐变。
function addTweens(frames, delays, count, loop, maxChange) {
  const outFrames = [];
  const outDelays = [];
  let added = 0;
  let cuts = 0;
  for (let i = 0; i < frames.length; i += 1) {
    const next = i + 1 < frames.length ? i + 1 : loop ? 0 : -1;
    let hold = delays[i];
    const extra = [];
    let step = 0;
    if (next >= 0 && next !== i && Buffer.compare(frames[i].data, frames[next].data) !== 0) {
      step = tweenDelay(delays[i], delays[next]);
      if (step && maxChange > 0 && changeShare(frames[i], frames[next]) > maxChange) {
        step = 0;
        cuts += 1;
      }
      const k = step ? Math.min(count, Math.floor(hold / 2 / step)) : 0;
      for (let j = 1; j <= k; j += 1) extra.push(blend(frames[i], frames[next], j / (k + 1)));
      hold -= k * step;
    }
    outFrames.push(frames[i]);
    outDelays.push(hold);
    for (const frame of extra) {
      outFrames.push(frame);
      outDelays.push(step);
      added += 1;
    }
  }
  return { frames: outFrames, delays: outDelays, added, cuts };
}

function tweenDelay(a, b) {
  const shorter = Math.min(a, b);
  if (shorter < 120) return 0;
  return Math.round(Math.max(40, Math.min(100, shorter * 0.15)) / 10) * 10;
}

function blend(a, b, t) {
  const out = Buffer.alloc(a.data.length);
  for (let i = 0; i < out.length; i += 1) out[i] = Math.round(a.data[i] + (b.data[i] - a.data[i]) * t);
  return { width: a.width, height: a.height, channels: 3, data: out };
}

// 面积平均缩放：每个目标像素取它覆盖的那块源像素的均值。缩小时不会像最近邻那样出锯齿和闪点。
export function resizeArea(image, outW, outH) {
  const src = image.channels === 3 ? image : toRgb(image);
  if (src.width === outW && src.height === outH) return src;
  const out = Buffer.alloc(outW * outH * 3);
  const xs = new Int32Array(outW + 1);
  for (let x = 0; x <= outW; x += 1) xs[x] = Math.min(src.width, Math.floor((x * src.width) / outW));
  for (let y = 0; y < outH; y += 1) {
    const y0 = Math.min(src.height - 1, Math.floor((y * src.height) / outH));
    const y1 = Math.max(y0 + 1, Math.min(src.height, Math.floor(((y + 1) * src.height) / outH)));
    for (let x = 0; x < outW; x += 1) {
      const x0 = Math.min(src.width - 1, xs[x]);
      const x1 = Math.max(x0 + 1, xs[x + 1]);
      let r = 0;
      let g = 0;
      let b = 0;
      for (let yy = y0; yy < y1; yy += 1) {
        let s = (yy * src.width + x0) * 3;
        for (let xx = x0; xx < x1; xx += 1) {
          r += src.data[s];
          g += src.data[s + 1];
          b += src.data[s + 2];
          s += 3;
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      const o = (y * outW + x) * 3;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
    }
  }
  return { width: outW, height: outH, channels: 3, data: out };
}

// 中位切分：在所有帧的 5 位直方图上切盒子，每个盒子取盒内像素的平均色。
// flat：前 colors 个最常见的颜色覆盖了九成像素（插画、表情包），这类图不加抖动，平涂的色块保持干净。
function buildPalette(frames, colors) {
  const count = new Uint32Array(32768);
  const sums = new Float64Array(32768 * 3);
  let total = 0;
  for (const frame of frames) {
    const pixels = frame.width * frame.height;
    const step = Math.max(1, Math.floor(pixels / 160000));
    const data = frame.data;
    for (let p = 0; p < pixels; p += step) {
      const s = p * 3;
      const bin = ((data[s] >> 3) << 10) | ((data[s + 1] >> 3) << 5) | (data[s + 2] >> 3);
      count[bin] += 1;
      sums[bin * 3] += data[s];
      sums[bin * 3 + 1] += data[s + 1];
      sums[bin * 3 + 2] += data[s + 2];
      total += 1;
    }
  }
  const bins = [];
  for (let bin = 0; bin < 32768; bin += 1) if (count[bin]) bins.push(bin);
  const sorted = bins.map((bin) => count[bin]).sort((a, b) => b - a);
  let top = 0;
  for (let i = 0; i < Math.min(colors, sorted.length); i += 1) top += sorted[i];
  const flat = total > 0 && top / total >= 0.9;

  const channel = (bin, axis) => (axis === 0 ? bin >> 10 : axis === 1 ? (bin >> 5) & 31 : bin & 31);
  const describe = (list) => {
    const lo = [31, 31, 31];
    const hi = [0, 0, 0];
    let weight = 0;
    for (const bin of list) {
      for (let axis = 0; axis < 3; axis += 1) {
        const v = channel(bin, axis);
        if (v < lo[axis]) lo[axis] = v;
        if (v > hi[axis]) hi[axis] = v;
      }
      weight += count[bin];
    }
    const ranges = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    const axis = ranges[1] >= ranges[0] && ranges[1] >= ranges[2] ? 1 : ranges[0] >= ranges[2] ? 0 : 2;
    return { list, weight, axis, range: ranges[axis] };
  };
  const boxes = bins.length ? [describe(bins)] : [];
  while (boxes.length < colors) {
    let pick = -1;
    let best = 0;
    for (let i = 0; i < boxes.length; i += 1) {
      const box = boxes[i];
      if (box.list.length < 2 || box.range === 0) continue;
      const score = box.weight * (box.range + 1);
      if (score > best) {
        best = score;
        pick = i;
      }
    }
    if (pick < 0) break;
    const box = boxes[pick];
    const list = box.list.slice().sort((a, b) => channel(a, box.axis) - channel(b, box.axis));
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < list.length - 1; i += 1) {
      acc += count[list[i]];
      cut = i + 1;
      if (acc * 2 >= box.weight) break;
    }
    boxes.splice(pick, 1, describe(list.slice(0, cut)), describe(list.slice(cut)));
  }
  const palette = boxes.map((box) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (const bin of box.list) {
      r += sums[bin * 3];
      g += sums[bin * 3 + 1];
      b += sums[bin * 3 + 2];
      n += count[bin];
    }
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  });
  if (!palette.length) palette.push([0, 0, 0]);
  return { palette, flat };
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const DITHER_AMPLITUDE = 10;

// 最近色查表：按 5 位量化后的颜色缓存结果，每个像素只查一次表。
// 有序抖动按像素位置加固定的偏移，同一位置同一颜色每一帧都映射到同一个色号，不会在帧间闪烁。
function makeMapper(palette) {
  const cache = new Int16Array(32768).fill(-1);
  const nearest = (r, g, b) => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < palette.length; i += 1) {
      const c = palette[i];
      const dr = r - c[0];
      const dg = g - c[1];
      const db = b - c[2];
      const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };
  return (data, s, x, y, dither) => {
    let r = data[s];
    let g = data[s + 1];
    let b = data[s + 2];
    if (dither === 'ordered') {
      const t = ((BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5) * DITHER_AMPLITUDE;
      r = Math.max(0, Math.min(255, r + t));
      g = Math.max(0, Math.min(255, g + t));
      b = Math.max(0, Math.min(255, b + t));
    }
    const bin = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let index = cache[bin];
    if (index < 0) {
      index = nearest((r & 0xf8) + 4, (g & 0xf8) + 4, (b & 0xf8) + 4);
      cache[bin] = index;
    }
    return index;
  };
}

// 变了的像素：任一通道和当前画面差超过阈值。再向外扩一圈，把动的部位边缘的抗锯齿过渡带一起更新，
// 否则新旧两帧的边缘会叠出一圈毛边。
function changeMask(src, shown, width, height, threshold) {
  const raw = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p += 1) {
    const s = p * 3;
    if (
      Math.abs(src[s] - shown[s]) > threshold ||
      Math.abs(src[s + 1] - shown[s + 1]) > threshold ||
      Math.abs(src[s + 2] - shown[s + 2]) > threshold
    ) {
      raw[p] = 1;
    }
  }
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!raw[y * width + x]) continue;
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = x + dx;
          if (xx >= 0 && xx < width) mask[yy * width + xx] = 1;
        }
      }
    }
  }
  return mask;
}

function maskBounds(mask, width, height) {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// GIF 的 LZW：码长从 9 位涨到 12 位，码表满了发清除码重来。
function lzwEncode(indices, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let nextCode = eoiCode + 1;
  let codeSize = minCodeSize + 1;
  let table = new Map();
  const out = [];
  let cur = 0;
  let shift = 0;
  const emit = (code) => {
    cur |= code << shift;
    shift += codeSize;
    while (shift >= 8) {
      out.push(cur & 0xff);
      cur >>>= 8;
      shift -= 8;
    }
  };
  emit(clearCode);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i += 1) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const code = table.get(key);
    if (code !== undefined) {
      prefix = code;
      continue;
    }
    emit(prefix);
    if (nextCode === 4096) {
      emit(clearCode);
      nextCode = eoiCode + 1;
      codeSize = minCodeSize + 1;
      table = new Map();
    } else {
      if (nextCode >= 1 << codeSize) codeSize += 1;
      table.set(key, nextCode);
      nextCode += 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoiCode);
  if (shift > 0) out.push(cur & 0xff);
  return Uint8Array.from(out);
}

function subBlocks(bytes) {
  const parts = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.subarray(i, Math.min(bytes.length, i + 255));
    parts.push(Buffer.from([chunk.length]), Buffer.from(chunk));
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

// 读回 GIF：按处置方式把每一帧合成到整张画布上，返回每帧的完整画面（RGB）和时长。
export function decodeGif(buffer) {
  if (!isGif(buffer)) throw new Error('not_gif');
  const bytes = buffer;
  let pos = 6;
  const width = bytes[pos] | (bytes[pos + 1] << 8);
  const height = bytes[pos + 2] | (bytes[pos + 3] << 8);
  const packed = bytes[pos + 4];
  const background = bytes[pos + 5];
  pos += 7;
  let globalTable = null;
  if (packed & 0x80) {
    const size = 3 * (1 << ((packed & 7) + 1));
    globalTable = bytes.subarray(pos, pos + size);
    pos += size;
  }
  const canvas = new Uint8Array(width * height * 4);
  const frames = [];
  let loop = null;
  let gce = null;
  while (pos < bytes.length) {
    const block = bytes[pos];
    pos += 1;
    if (block === 0x3b) break;
    if (block === 0x21) {
      const label = bytes[pos];
      pos += 1;
      if (label === 0xf9) {
        const size = bytes[pos];
        const flags = bytes[pos + 1];
        gce = {
          disposal: (flags >> 2) & 7,
          transparent: flags & 1 ? bytes[pos + 4] : -1,
          delayMs: (bytes[pos + 2] | (bytes[pos + 3] << 8)) * 10,
        };
        pos += 1 + size;
        while (bytes[pos] !== 0) pos += 1 + bytes[pos];
        pos += 1;
      } else if (label === 0xff) {
        const size = bytes[pos];
        const id = Buffer.from(bytes.subarray(pos + 1, pos + 1 + size)).toString('ascii');
        pos += 1 + size;
        while (bytes[pos] !== 0) {
          if (id === 'NETSCAPE2.0' && bytes[pos] >= 3 && bytes[pos + 1] === 1) loop = bytes[pos + 2] | (bytes[pos + 3] << 8);
          pos += 1 + bytes[pos];
        }
        pos += 1;
      } else {
        while (bytes[pos] !== 0) pos += 1 + bytes[pos];
        pos += 1;
      }
      continue;
    }
    if (block !== 0x2c) throw new Error('gif_bad_block:' + block);
    const x = bytes[pos] | (bytes[pos + 1] << 8);
    const y = bytes[pos + 2] | (bytes[pos + 3] << 8);
    const w = bytes[pos + 4] | (bytes[pos + 5] << 8);
    const h = bytes[pos + 6] | (bytes[pos + 7] << 8);
    const flags = bytes[pos + 8];
    pos += 9;
    let table = globalTable;
    if (flags & 0x80) {
      const size = 3 * (1 << ((flags & 7) + 1));
      table = bytes.subarray(pos, pos + size);
      pos += size;
    }
    if (!table) throw new Error('gif_no_color_table');
    const minCodeSize = bytes[pos];
    pos += 1;
    const data = [];
    while (bytes[pos] !== 0) {
      data.push(bytes.subarray(pos + 1, pos + 1 + bytes[pos]));
      pos += 1 + bytes[pos];
    }
    pos += 1;
    const indices = lzwDecode(Buffer.concat(data), minCodeSize, w * h);
    const rows = flags & 0x40 ? interlacedRows(h) : null;
    const control = gce || { disposal: 0, transparent: -1, delayMs: 0 };
    const before = control.disposal === 3 ? canvas.slice() : null;
    for (let row = 0; row < h; row += 1) {
      const cy = y + (rows ? rows[row] : row);
      if (cy >= height) continue;
      for (let col = 0; col < w; col += 1) {
        const cx = x + col;
        if (cx >= width) continue;
        const index = indices[row * w + col];
        if (index === control.transparent) continue;
        const o = (cy * width + cx) * 4;
        canvas[o] = table[index * 3];
        canvas[o + 1] = table[index * 3 + 1];
        canvas[o + 2] = table[index * 3 + 2];
        canvas[o + 3] = 255;
      }
    }
    const rgb = Buffer.alloc(width * height * 3);
    for (let p = 0; p < width * height; p += 1) {
      rgb[p * 3] = canvas[p * 4];
      rgb[p * 3 + 1] = canvas[p * 4 + 1];
      rgb[p * 3 + 2] = canvas[p * 4 + 2];
    }
    frames.push({ delayMs: control.delayMs, disposal: control.disposal, rect: { x, y, w, h }, image: { width, height, channels: 3, data: rgb } });
    if (control.disposal === 2) {
      for (let row = 0; row < h; row += 1) {
        for (let col = 0; col < w; col += 1) {
          const o = ((y + row) * width + x + col) * 4;
          if (o + 3 < canvas.length) canvas.fill(0, o, o + 4);
        }
      }
    } else if (before) {
      canvas.set(before);
    }
    gce = null;
  }
  return { width, height, background, loop, frames };
}

function interlacedRows(h) {
  const rows = [];
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let r = start; r < h; r += step) rows.push(r);
  return rows;
}

function lzwDecode(bytes, minCodeSize, length) {
  const out = new Uint8Array(length);
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  const prefix = new Uint16Array(4096);
  const suffix = new Uint8Array(4096);
  for (let i = 0; i < clearCode; i += 1) suffix[i] = i;
  const stack = new Uint8Array(4097);
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  let old = -1;
  let first = 0;
  let bits = 0;
  let count = 0;
  let pos = 0;
  let o = 0;
  while (o < length) {
    while (count < codeSize) {
      if (pos >= bytes.length) return out;
      bits |= bytes[pos] << count;
      pos += 1;
      count += 8;
    }
    const code = bits & ((1 << codeSize) - 1);
    bits >>>= codeSize;
    count -= codeSize;
    if (code === clearCode) {
      codeSize = minCodeSize + 1;
      nextCode = eoiCode + 1;
      old = -1;
      continue;
    }
    if (code === eoiCode) break;
    if (old < 0) {
      out[o] = suffix[code];
      o += 1;
      old = code;
      first = code;
      continue;
    }
    let sp = 0;
    let cur = code;
    if (code >= nextCode) {
      stack[sp] = first;
      sp += 1;
      cur = old;
    }
    while (cur >= clearCode) {
      stack[sp] = suffix[cur];
      sp += 1;
      cur = prefix[cur];
    }
    stack[sp] = cur;
    sp += 1;
    first = cur;
    while (sp > 0 && o < length) {
      sp -= 1;
      out[o] = stack[sp];
      o += 1;
    }
    if (nextCode < 4096) {
      prefix[nextCode] = old;
      suffix[nextCode] = first;
      nextCode += 1;
      if (nextCode === 1 << codeSize && codeSize < 12) codeSize += 1;
    }
    old = code;
  }
  return out;
}
