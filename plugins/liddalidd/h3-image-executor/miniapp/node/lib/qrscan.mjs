// 扫码：从像素里把二维码重新认一遍。
//
// 「贴回去的真码能不能扫」只认这一步的结果：编码器说自己编对了不算数，要像手机一样，
// 从最终图片的像素里找定位图形、读格式信息、纠错、解出内容，解出来的和要放的内容一致才算通过。
//
// 解码器用 jsQR 1.4.0（https://github.com/cozmo/jsQR，Apache-2.0，作者 Cosmo Wolfe、Jefff Nelson）。
// ../vendor/jsqr/jsQR.cjs 是它 npm 包里的 dist/jsQR.js 原样拷贝，只把扩展名改成 .cjs，
// 让它不管放在哪个 package.json 下面都按 CommonJS 加载；许可证全文在同目录的 LICENSE。
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const jsQR = require('../vendor/jsqr/jsQR.cjs');

// image: { width, height, channels, data }。
// options.rect：只扫这一块 { x, y, width, height }（原图像素坐标）；
// options.maxEdge：先把这一块缩到长边不超过这么多像素再扫（盒式滤波，相当于手机离远了看）；
// options.invert：true 时深浅两种都试（浅色码印在深底上也能认）。
// 返回 { data, bytes, version, corners: [左上, 右上, 右下, 左下] }，corners 换算回原图坐标；扫不出返回 null。
export function scanQr(image, options) {
  const opts = options || {};
  const rect = clampRect(opts.rect, image);
  if (!rect) return null;
  const scale = opts.maxEdge ? Math.min(1, opts.maxEdge / Math.max(rect.width, rect.height)) : 1;
  const view = toRgba(image, rect, scale);
  if (view.width < 21 || view.height < 21) return null;
  let found;
  try {
    found = jsQR(view.data, view.width, view.height, { inversionAttempts: opts.invert ? 'attemptBoth' : 'dontInvert' });
  } catch {
    found = null;
  }
  if (!found) return null;
  const back = (point) => ({
    x: rect.x + point.x / view.scaleX,
    y: rect.y + point.y / view.scaleY,
  });
  const loc = found.location;
  return {
    data: String(found.data || ''),
    bytes: Array.isArray(found.binaryData) ? found.binaryData.slice() : [],
    version: found.version,
    corners: [loc.topLeftCorner, loc.topRightCorner, loc.bottomRightCorner, loc.bottomLeftCorner].map(back),
  };
}

// 把图里所有能扫出来的码都找出来：扫到一枚就把它涂白，再扫下一枚。jsQR 一次只认一枚。
export function scanAllQr(image, options) {
  const opts = options || {};
  const limit = Math.max(1, Math.min(8, opts.max || 4));
  const found = [];
  let work = image;
  for (let i = 0; i < limit; i += 1) {
    const hit = scanQr(work, { ...opts, rect: undefined, invert: opts.invert !== false });
    if (!hit) break;
    found.push(hit);
    if (work === image) work = { ...image, data: Buffer.from(image.data) };
    fillPolygon(work, grow(hit.corners, 0.12), 255);
  }
  return found;
}

// ---------------------------------------------------------------- 内部工具

function clampRect(rect, image) {
  const r = rect || { x: 0, y: 0, width: image.width, height: image.height };
  const x = Math.max(0, Math.floor(r.x));
  const y = Math.max(0, Math.floor(r.y));
  const right = Math.min(image.width, Math.ceil(r.x + r.width));
  const bottom = Math.min(image.height, Math.ceil(r.y + r.height));
  if (right - x < 1 || bottom - y < 1) return null;
  return { x, y, width: right - x, height: bottom - y };
}

// 取出一块并（按需）用盒式滤波缩小，转成 jsQR 要的 RGBA。
// 盒式滤波而不是取最近点：最近点会把细小的模块直接漏掉，扫码结果会比真实情况更差。
function toRgba(image, rect, scale) {
  const { channels, data } = image;
  const width = Math.max(1, Math.round(rect.width * scale));
  const height = Math.max(1, Math.round(rect.height * scale));
  const out = new Uint8ClampedArray(width * height * 4);
  const scaleX = width / rect.width;
  const scaleY = height / rect.height;
  for (let oy = 0; oy < height; oy += 1) {
    const sy0 = rect.y + Math.floor(oy / scaleY);
    const sy1 = Math.max(sy0 + 1, Math.min(rect.y + rect.height, rect.y + Math.floor((oy + 1) / scaleY)));
    for (let ox = 0; ox < width; ox += 1) {
      const sx0 = rect.x + Math.floor(ox / scaleX);
      const sx1 = Math.max(sx0 + 1, Math.min(rect.x + rect.width, rect.x + Math.floor((ox + 1) / scaleX)));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy += 1) {
        let i = (sy * image.width + sx0) * channels;
        for (let sx = sx0; sx < sx1; sx += 1, i += channels) {
          if (channels >= 3) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
          } else {
            r += data[i];
            g += data[i];
            b += data[i];
          }
          n += 1;
        }
      }
      const o = (oy * width + ox) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  }
  return { width, height, data: out, scaleX, scaleY };
}

function grow(corners, ratio) {
  const cx = corners.reduce((sum, p) => sum + p.x, 0) / corners.length;
  const cy = corners.reduce((sum, p) => sum + p.y, 0) / corners.length;
  return corners.map((p) => ({ x: cx + (p.x - cx) * (1 + ratio), y: cy + (p.y - cy) * (1 + ratio) }));
}

// 扫描线填充凸多边形，只用于把已经认出来的码涂掉。
function fillPolygon(image, points, value) {
  const minY = Math.max(0, Math.floor(Math.min(...points.map((p) => p.y))));
  const maxY = Math.min(image.height - 1, Math.ceil(Math.max(...points.map((p) => p.y))));
  for (let y = minY; y <= maxY; y += 1) {
    const xs = [];
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    if (xs.length < 2) continue;
    const left = Math.max(0, Math.floor(Math.min(...xs)));
    const right = Math.min(image.width - 1, Math.ceil(Math.max(...xs)));
    image.data.fill(value, (y * image.width + left) * image.channels, (y * image.width + right + 1) * image.channels);
  }
}
