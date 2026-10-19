import { pixelBlendModes, compositePixels } from './blending.js';
import { normalizeStyles, renderStyles, stylePadding } from './layer-styles.js';
import { createRenderCache } from './render-cache.js';
import { normalizeAdjustment, adjustedPixels, compositionGroups } from './adjustment-layers.js';
export const layerRenderCache = createRenderCache();
export const invalidateLayer = (l) => layerRenderCache.invalidate(l.canvas);
export const LIMIT_PIXELS = 32e6;
export const blends = [
  'source-over',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
  ...pixelBlendModes,
];
export const blendNames = [
  '正常',
  '正片叠底',
  '滤色',
  '叠加',
  '变暗',
  '变亮',
  '颜色减淡',
  '颜色加深',
  '强光',
  '柔光',
  '差值',
  '排除',
  '色相',
  '饱和度',
  '颜色',
  '明度',
  '溶解',
  '线性加深',
  '线性减淡（添加）',
  '减去',
  '划分',
  '亮光',
  '线性光',
  '点光',
  '实色混合',
  '深色',
  '浅色',
];
export function canvas(w, h) {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w * h > LIMIT_PIXELS)
    throw Error('画布尺寸须为正整数，最多 3200 万像素');
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
export function cloneCanvas(c) {
  const n = canvas(c.width, c.height);
  n.getContext('2d').drawImage(c, 0, 0);
  return n;
}
export function layer(w, h, name = '图层') {
  return {
    id: crypto.randomUUID(),
    name,
    visible: true,
    locked: false,
    opacity: 1,
    blend: 'source-over',
    x: 0,
    y: 0,
    canvas: canvas(w, h),
    mask: null,
    text: null,
  };
}
export function documentModel(w = 1280, h = 800, name = '未命名') {
  const l = layer(w, h, '背景');
  const ctx = l.canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  return {
    id: crypto.randomUUID(),
    name,
    width: w,
    height: h,
    layers: [l],
    activeId: l.id,
    revision: 0,
    dirty: false,
    history: [],
    future: [],
    selection: null,
    paths: [],
    historyBytes: 0,
  };
}
export const active = (d) => d.layers.find((l) => l.id === d.activeId) || d.layers.at(-1);
export function snapshot(d) {
  return {
    width: d.width,
    height: d.height,
    layers: d.layers.map((l) => ({ ...l })),
    activeId: d.activeId,
    selection: d.selection,
    paths: structuredClone(d.paths),
  };
}
function estimate(entries) {
  const seen = new Set();
  let bytes = 0;
  for (const entry of entries)
    for (const l of entry.state.layers)
      for (const c of [l.canvas, l.mask])
        if (c && !seen.has(c)) {
          seen.add(c);
          bytes += c.width * c.height * 4;
        }
  return bytes;
}
export function begin(d, label, editIds = []) {
  d.history.push({ label, state: snapshot(d) });
  d.future = [];
  d.layers = d.layers.map((l) =>
    editIds.includes(l.id)
      ? { ...l, canvas: cloneCanvas(l.canvas), mask: l.mask ? cloneCanvas(l.mask) : null }
      : { ...l },
  );
  while (d.history.length > 1 && (d.history.length > 40 || estimate(d.history) > 128 * 1024 * 1024))
    d.history.shift();
  d.dirty = true;
}
export function undo(d) {
  const previous = d.history.pop();
  if (!previous) return false;
  d.future.push({ label: previous.label, state: snapshot(d) });
  Object.assign(d, previous.state);
  d.dirty = true;
  return true;
}
export function redo(d) {
  const next = d.future.pop();
  if (!next) return false;
  d.history.push({ label: next.label, state: snapshot(d) });
  Object.assign(d, next.state);
  d.dirty = true;
  return true;
}
export function layerImage(l) {
  if (!l.mask) return l.canvas;
  const c = cloneCanvas(l.canvas),
    ctx = c.getContext('2d');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(l.mask, 0, 0);
  return c;
}
function applyAdjustmentTo(sourceCanvas, l, originX = 0, originY = 0) {
  const ctx = sourceCanvas.getContext('2d'),
    width = sourceCanvas.width,
    height = sourceCanvas.height;
  const source = ctx.getImageData(0, 0, width, height);
  let mask = null;
  if (l.mask) {
    const m = canvas(width, height),
      mc = m.getContext('2d');
    mc.drawImage(l.mask, l.x - originX, l.y - originY);
    mask = mc.getImageData(0, 0, width, height).data;
  }
  const pixels = adjustedPixels(
    source.data,
    width,
    height,
    l.adjustment,
    l.opacity,
    mask,
    l.blend,
    originX,
    originY,
  );
  ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
}
export function composite(d, target) {
  const c = target || canvas(d.width, d.height);
  if (c.width !== d.width) c.width = d.width;
  if (c.height !== d.height) c.height = d.height;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  for (const { base: l, adjustments } of compositionGroups(d.layers)) {
    if (!l.visible) continue;
    if (l.adjustment) {
      applyAdjustmentTo(c, l);
      continue;
    }
    ctx.save();
    ctx.globalAlpha = l.opacity;
    ctx.globalCompositeOperation = l.blend;
    const rendered = renderedLayer(l);
    const visibleAdjustments = adjustments.filter((a) => a.visible);
    const image = visibleAdjustments.length ? cloneCanvas(rendered.image) : rendered.image;
    for (const adjustment of visibleAdjustments)
      applyAdjustmentTo(image, adjustment, l.x + rendered.offset, l.y + rendered.offset);
    if (pixelBlendModes.includes(l.blend)) {
      const x = Math.max(0, Math.floor(l.x + rendered.offset));
      const y = Math.max(0, Math.floor(l.y + rendered.offset));
      const w = Math.min(c.width, Math.ceil(l.x + rendered.offset + image.width)) - x;
      const h = Math.min(c.height, Math.ceil(l.y + rendered.offset + image.height)) - y;
      if (w > 0 && h > 0) {
        const source = canvas(w, h),
          sc = source.getContext('2d');
        sc.drawImage(image, l.x + rendered.offset - x, l.y + rendered.offset - y);
        const pixels = compositePixels(
          ctx.getImageData(x, y, w, h).data,
          sc.getImageData(0, 0, w, h).data,
          l.blend,
          l.opacity,
          w,
          x,
          y,
        );
        ctx.putImageData(new ImageData(pixels, w, h), x, y);
      }
    } else ctx.drawImage(image, l.x + rendered.offset, l.y + rendered.offset);
    ctx.restore();
  }
  return c;
}
export function renderedLayer(l) {
  if (!l.mask && !Object.values(l.styles || {}).some((s) => s?.enabled))
    return { image: l.canvas, offset: 0 };
  return layerRenderCache.get(l.canvas, l.mask, l.styles, () =>
    renderStyles(layerImage(l), l.styles, canvas),
  );
}
export function selectionPath(s) {
  const p = new Path2D();
  if (!s) return p;
  if (s.kind === 'runs') {
    for (const [x, y, w] of s.runs) p.rect(x, y, w, 1);
  } else if (s.kind === 'ellipse')
    p.ellipse(
      s.x + s.w / 2,
      s.y + s.h / 2,
      Math.abs(s.w / 2),
      Math.abs(s.h / 2),
      0,
      0,
      Math.PI * 2,
    );
  else if (s.kind === 'polygon') {
    s.points.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
    p.closePath();
  } else p.rect(s.x, s.y, s.w, s.h);
  return p;
}
export function clipSelection(ctx, d, l) {
  if (!d.selection) return;
  ctx.translate(-l.x, -l.y);
  if (d.selection.invert) {
    const p = new Path2D();
    p.rect(0, 0, d.width, d.height);
    p.addPath(selectionPath(d.selection));
    ctx.clip(p, 'evenodd');
  } else ctx.clip(selectionPath(d.selection));
  ctx.translate(l.x, l.y);
}
export async function imageFrom(src) {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
}
export async function serialize(d) {
  const layers = [];
  for (const l of d.layers) {
    const { canvas: c, mask, ...meta } = l;
    layers.push({ ...meta, image: await dataURL(c), maskImage: mask ? await dataURL(mask) : null });
  }
  return {
    format: 'retouch-lab',
    version: 1,
    id: d.id,
    name: d.name,
    width: d.width,
    height: d.height,
    layers,
    activeId: d.activeId,
    revision: d.revision,
    paths: d.paths,
  };
}
export function dataURL(c) {
  return new Promise((ok, fail) =>
    c.toBlob((blob) => {
      if (!blob) return fail(Error('图像编码失败'));
      const r = new FileReader();
      r.onload = () => ok(r.result);
      r.onerror = () => fail(r.error);
      r.readAsDataURL(blob);
    }, 'image/png'),
  );
}
export async function deserialize(p) {
  if (
    p.format !== 'retouch-lab' ||
    p.version !== 1 ||
    !Array.isArray(p.layers) ||
    p.layers.length < 1 ||
    p.layers.length > 100
  )
    throw Error('不是支持的修图工作台工程');
  canvas(p.width, p.height);
  const d = documentModel(p.width, p.height, String(p.name || '未命名').slice(0, 200));
  d.layers = [];
  let pixels = 0;
  for (const item of p.layers) {
    if (typeof item.image !== 'string' || !item.image.startsWith('data:image/png;base64,'))
      throw Error('工程包含不支持的图像');
    const img = await imageFrom(item.image);
    pixels += img.width * img.height;
    if (pixels > 128e6) throw Error('工程图层合计超过 1.28 亿像素');
    const l = layer(img.width, img.height, String(item.name || '图层').slice(0, 200));
    l.canvas.getContext('2d').drawImage(img, 0, 0);
    l.id = typeof item.id === 'string' ? item.id : l.id;
    l.x = Number.isFinite(item.x) ? item.x : 0;
    l.y = Number.isFinite(item.y) ? item.y : 0;
    l.visible = item.visible !== false;
    l.locked = item.locked === true;
    l.opacity = Number.isFinite(item.opacity) ? Math.max(0, Math.min(1, item.opacity)) : 1;
    l.blend = blends.includes(item.blend) ? item.blend : 'source-over';
    l.text = item.text && typeof item.text.value === 'string' ? item.text : null;
    l.adjustment = item.adjustment ? normalizeAdjustment(item.adjustment) : null;
    l.clipToBelow = Boolean(l.adjustment && item.clipToBelow);
    l.styles = item.styles ? normalizeStyles(item.styles) : null;
    if (l.styles) {
      const padding = stylePadding(l.styles);
      if ((img.width + 2 * padding) * (img.height + 2 * padding) > LIMIT_PIXELS)
        throw Error('工程图层含样式后的尺寸超过 3200 万像素');
    }
    if (item.maskImage) {
      if (!item.maskImage.startsWith('data:image/png;base64,')) throw Error('蒙版数据无效');
      const mask = await imageFrom(item.maskImage);
      l.mask = canvas(l.canvas.width, l.canvas.height);
      l.mask.getContext('2d').drawImage(mask, 0, 0);
    }
    d.layers.push(l);
  }
  d.id = /^[a-f0-9-]{36}$/.test(p.id) ? p.id : crypto.randomUUID();
  d.revision = Number.isInteger(p.revision) ? p.revision : 0;
  d.activeId = d.layers.some((l) => l.id === p.activeId) ? p.activeId : d.layers.at(-1).id;
  d.paths = Array.isArray(p.paths) ? p.paths : [];
  return d;
}
export function download(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
