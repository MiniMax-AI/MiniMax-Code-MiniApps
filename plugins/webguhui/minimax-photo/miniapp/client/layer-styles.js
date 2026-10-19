import { strokePixels, bevelPixels } from './style-pixels.js';
// Styles are immutable layer metadata. Source pixels are never overwritten.
export const styleDefaults = {
  shadow: { enabled: false, color: '#000000', opacity: 0.6, blur: 8, x: 8, y: 8 },
  glow: { enabled: false, color: '#ffffff', opacity: 0.7, blur: 12 },
  color: { enabled: false, color: '#227fa8', opacity: 1 },
  gradient: { enabled: false, color: '#227fa8', endColor: '#e8b36d', opacity: 1, angle: 90 },
  innerShadow: { enabled: false, color: '#000000', opacity: 0.6, blur: 6, x: 5, y: 5 },
  innerGlow: { enabled: false, color: '#ffffff', opacity: 0.8, blur: 8 },
  stroke: { enabled: false, color: '#ffffff', opacity: 1, size: 4, position: 'outside' },
  bevel: {
    enabled: false,
    color: '#ffffff',
    endColor: '#000000',
    opacity: 0.9,
    size: 6,
    depth: 2,
    angle: 135,
    elevation: 45,
  },
  satin: { enabled: false, color: '#000000', opacity: 0.5, blur: 8, distance: 12, angle: 45 },
  pattern: {
    enabled: false,
    color: '#227fa8',
    endColor: '#e8b36d',
    opacity: 0.8,
    size: 16,
    pattern: 'checker',
  },
};
export const styleNames = {
  shadow: '投影',
  glow: '外发光',
  color: '颜色叠加',
  gradient: '渐变叠加',
  innerShadow: '内阴影',
  innerGlow: '内发光',
  stroke: '描边',
  bevel: '斜面浮雕',
  satin: '缎面',
  pattern: '图案叠加',
};
export function normalizeStyles(value) {
  const out = structuredClone(styleDefaults);
  for (const [key, defaults] of Object.entries(out)) {
    const input = value?.[key];
    if (!input || typeof input !== 'object') continue;
    defaults.enabled = input.enabled === true;
    for (const prop of ['color', 'endColor'])
      if (prop in defaults && /^#[a-f\d]{6}$/i.test(input[prop])) defaults[prop] = input[prop];
    for (const [prop, low, high] of [
      ['opacity', 0, 1],
      ['blur', 0, 60],
      ['x', -100, 100],
      ['y', -100, 100],
      ['angle', -180, 180],
      ['size', 0.1, 60],
      ['depth', 0.1, 10],
      ['elevation', 1, 89],
      ['distance', 0, 100],
    ])
      if (prop in defaults && Number.isFinite(input[prop]))
        defaults[prop] = Math.max(low, Math.min(high, input[prop]));
    if ('position' in defaults && ['inside', 'outside', 'center'].includes(input.position))
      defaults.position = input.position;
    if ('pattern' in defaults && ['checker', 'dots', 'stripes'].includes(input.pattern))
      defaults.pattern = input.pattern;
  }
  return out;
}

export function stylePadding(styles) {
  return Math.ceil(
    Math.max(
      styles.shadow.enabled
        ? 3 * styles.shadow.blur + Math.max(Math.abs(styles.shadow.x), Math.abs(styles.shadow.y))
        : 0,
      styles.glow.enabled ? 3 * styles.glow.blur : 0,
      styles.stroke.enabled && styles.stroke.position !== 'inside' ? styles.stroke.size : 0,
      styles.bevel.enabled || styles.stroke.enabled ? 1 : 0,
      ...['innerShadow', 'innerGlow'].map((key) =>
        styles[key].enabled
          ? 3 * styles[key].blur +
            Math.max(Math.abs(styles[key].x || 0), Math.abs(styles[key].y || 0)) +
            2
          : 0,
      ),
    ),
  );
}
export function renderStyles(source, value, makeCanvas) {
  if (!value || !Object.values(value).some((s) => s?.enabled)) return { image: source, offset: 0 };
  const styles = normalizeStyles(value);
  const pad = stylePadding(styles);
  const out = makeCanvas(source.width + 2 * pad, source.height + 2 * pad);
  const ctx = out.getContext('2d');
  const tint = makeCanvas(source.width, source.height),
    t = tint.getContext('2d');
  function silhouette(color) {
    t.globalCompositeOperation = 'source-over';
    t.clearRect(0, 0, tint.width, tint.height);
    t.drawImage(source, 0, 0);
    t.globalCompositeOperation = 'source-in';
    t.fillStyle = color;
    t.fillRect(0, 0, tint.width, tint.height);
  }
  for (const key of ['shadow', 'glow']) {
    const effect = styles[key];
    if (!effect.enabled) continue;
    silhouette(effect.color);
    ctx.save();
    ctx.globalAlpha = effect.opacity;
    ctx.filter = `blur(${effect.blur}px)`;
    ctx.drawImage(tint, pad + (effect.x || 0), pad + (effect.y || 0));
    ctx.restore();
  }
  // Compose overlays on the source first so they do not recolor the shadow/glow.
  t.globalCompositeOperation = 'source-over';
  t.clearRect(0, 0, tint.width, tint.height);
  t.drawImage(source, 0, 0);
  t.globalCompositeOperation = 'source-atop';
  if (styles.color.enabled) {
    t.globalAlpha = styles.color.opacity;
    t.fillStyle = styles.color.color;
    t.fillRect(0, 0, tint.width, tint.height);
  }
  if (styles.gradient.enabled) {
    const effect = styles.gradient,
      angle = (effect.angle * Math.PI) / 180;
    const dx = Math.cos(angle),
      dy = Math.sin(angle);
    const radius = (Math.abs(dx) * tint.width + Math.abs(dy) * tint.height) / 2;
    const gradient = t.createLinearGradient(
      tint.width / 2 - dx * radius,
      tint.height / 2 - dy * radius,
      tint.width / 2 + dx * radius,
      tint.height / 2 + dy * radius,
    );
    gradient.addColorStop(0, effect.color);
    gradient.addColorStop(1, effect.endColor);
    t.globalAlpha = effect.opacity;
    t.fillStyle = gradient;
    t.fillRect(0, 0, tint.width, tint.height);
  }
  if (styles.pattern.enabled) {
    const effect = styles.pattern,
      size = Math.max(2, Math.round(effect.size));
    const tile = makeCanvas(size * 2, size * 2),
      tileCtx = tile.getContext('2d');
    tileCtx.fillStyle = effect.endColor;
    tileCtx.fillRect(0, 0, tile.width, tile.height);
    tileCtx.fillStyle = effect.color;
    if (effect.pattern === 'dots') {
      tileCtx.beginPath();
      tileCtx.arc(size, size, size / 2, 0, Math.PI * 2);
      tileCtx.fill();
    } else if (effect.pattern === 'stripes') tileCtx.fillRect(0, 0, size, tile.height);
    else {
      tileCtx.fillRect(0, 0, size, size);
      tileCtx.fillRect(size, size, size, size);
    }
    t.globalAlpha = effect.opacity;
    t.fillStyle = t.createPattern(tile, 'repeat');
    t.fillRect(0, 0, tint.width, tint.height);
  }
  // Inner effects use the inverse alpha silhouette; source-atop clips them to the layer.
  for (const key of ['innerShadow', 'innerGlow']) {
    const effect = styles[key];
    if (!effect.enabled) continue;
    const margin = Math.ceil(
      3 * effect.blur + Math.max(Math.abs(effect.x || 0), Math.abs(effect.y || 0)) + 2,
    );
    const inverse = makeCanvas(source.width + margin * 2, source.height + margin * 2),
      inverseCtx = inverse.getContext('2d');
    inverseCtx.fillStyle = effect.color;
    inverseCtx.fillRect(0, 0, inverse.width, inverse.height);
    inverseCtx.globalCompositeOperation = 'destination-out';
    inverseCtx.drawImage(source, margin, margin);
    t.save();
    t.globalAlpha = effect.opacity;
    t.filter = `blur(${effect.blur}px)`;
    t.drawImage(inverse, -margin + (effect.x || 0), -margin + (effect.y || 0));
    t.restore();
  }
  if (styles.satin.enabled) {
    const effect = styles.satin,
      angle = (effect.angle * Math.PI) / 180;
    const dx = Math.cos(angle) * effect.distance,
      dy = Math.sin(angle) * effect.distance;
    const folds = makeCanvas(source.width, source.height),
      f = folds.getContext('2d');
    f.filter = `blur(${effect.blur}px)`;
    f.drawImage(source, dx, dy);
    f.globalCompositeOperation = 'xor';
    f.drawImage(source, -dx, -dy);
    f.filter = 'none';
    f.globalCompositeOperation = 'source-in';
    f.fillStyle = effect.color;
    f.fillRect(0, 0, folds.width, folds.height);
    t.globalAlpha = effect.opacity;
    t.drawImage(folds, 0, 0);
  }
  ctx.drawImage(tint, pad, pad);
  if (styles.stroke.enabled || styles.bevel.enabled) {
    const silhouette = makeCanvas(out.width, out.height),
      s = silhouette.getContext('2d');
    s.drawImage(source, pad, pad);
    const rgba = s.getImageData(0, 0, out.width, out.height).data;
    const alpha = new Uint8Array(out.width * out.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
    for (const [key, render] of [
      ['bevel', bevelPixels],
      ['stroke', strokePixels],
    ]) {
      if (!styles[key].enabled) continue;
      const pixels = render(alpha, out.width, out.height, styles[key]);
      s.putImageData(new ImageData(pixels, out.width, out.height), 0, 0);
      ctx.drawImage(silhouette, 0, 0);
    }
  }
  return { image: out, offset: -pad };
}
