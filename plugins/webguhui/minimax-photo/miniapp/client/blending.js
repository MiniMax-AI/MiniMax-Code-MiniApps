// Canvas-standard RGB modes follow W3C Compositing Level 1, section 10.
// https://www.w3.org/TR/compositing-1/#blending
// Extended modes follow Adobe mode descriptions; external pixel parity is unverified.
// Alpha/coverage belongs to the caller, not this color-only operation.
const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
const sat = (c) => Math.max(...c) - Math.min(...c);
function setLum(c, value) {
  const delta = value - lum(c);
  let result = c.map((v) => v + delta);
  const low = Math.min(...result),
    high = Math.max(...result);
  if (low < 0) result = result.map((v) => value + ((v - value) * value) / (value - low));
  if (high > 1) result = result.map((v) => value + ((v - value) * (1 - value)) / (high - value));
  return result;
}
function setSat(c, value) {
  const order = [0, 1, 2].sort((a, b) => c[a] - c[b]);
  const [lo, mid, hi] = order,
    out = [0, 0, 0];
  if (c[hi] > c[lo]) {
    out[mid] = ((c[mid] - c[lo]) * value) / (c[hi] - c[lo]);
    out[hi] = value;
  }
  return out;
}
export const pixelBlendModes = [
  'dissolve',
  'linear-burn',
  'linear-dodge',
  'subtract',
  'divide',
  'vivid-light',
  'linear-light',
  'pin-light',
  'hard-mix',
  'darker-color',
  'lighter-color',
];
const scalar = {
  'vivid-light': (b, s) =>
    s <= 0.5 ? scalar['color-burn'](b, 2 * s) : scalar['color-dodge'](b, 2 * s - 1),
  'linear-light': (b, s) => Math.max(0, Math.min(1, b + 2 * s - 1)),
  'pin-light': (b, s) => (s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1)),
  'hard-mix': (b, s) => (b + s >= 1 ? 1 : 0),
  'linear-burn': (b, s) => Math.max(0, b + s - 1),
  'linear-dodge': (b, s) => Math.min(1, b + s),
  subtract: (b, s) => Math.max(0, b - s),
  divide: (b, s) => (s === 0 ? 1 : Math.min(1, b / s)),
  'source-over': (_b, s) => s,
  dissolve: (_b, s) => s,
  multiply: (b, s) => b * s,
  screen: (b, s) => b + s - b * s,
  overlay: (b, s) => (b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)),
  darken: Math.min,
  lighten: Math.max,
  'color-dodge': (b, s) => (b === 0 ? 0 : s === 1 ? 1 : Math.min(1, b / (1 - s))),
  'color-burn': (b, s) => (b === 1 ? 1 : s === 0 ? 0 : 1 - Math.min(1, (1 - b) / s)),
  'hard-light': (b, s) => (s <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)),
  'soft-light': (b, s) =>
    s <= 0.5
      ? b - (1 - 2 * s) * b * (1 - b)
      : b + (2 * s - 1) * ((b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)) - b),
  difference: (b, s) => Math.abs(b - s),
  exclusion: (b, s) => b + s - 2 * b * s,
};
export function blendPixel(mode, backdrop, source, offset, out) {
  // Whole-color comparisons choose a complete triplet, never a per-channel minimum.
  if (mode === 'darker-color' || mode === 'lighter-color') {
    const b = backdrop[offset] + backdrop[offset + 1] + backdrop[offset + 2];
    const s = source[offset] + source[offset + 1] + source[offset + 2];
    const chosen = (mode === 'darker-color' ? s < b : s > b) ? source : backdrop;
    for (let c = 0; c < 3; c++) out[c] = chosen[offset + c];
    return out;
  }
  const formula = scalar[mode];
  if (formula) {
    for (let c = 0; c < 3; c++)
      out[c] = 255 * formula(backdrop[offset + c] / 255, source[offset + c] / 255);
    return out;
  }
  const b = [backdrop[offset] / 255, backdrop[offset + 1] / 255, backdrop[offset + 2] / 255];
  const s = [source[offset] / 255, source[offset + 1] / 255, source[offset + 2] / 255];
  let result;
  if (mode === 'hue') result = setLum(setSat(s, sat(b)), lum(b));
  else if (mode === 'saturation') result = setLum(setSat(b, sat(s)), lum(b));
  else if (mode === 'color') result = setLum(s, lum(b));
  else if (mode === 'luminosity') result = setLum(b, lum(s));
  else throw Error('不支持的混合模式');
  for (let c = 0; c < 3; c++) out[c] = result[c] * 255;
  return out;
}

// Source-over coverage, with blending restricted to the overlap of both layers.
// Coordinate hashing keeps the grain deterministic across repaint, clipping and save/reopen.
export function dissolveCoverage(coverage, x, y) {
  if (coverage <= 0) return 0;
  if (coverage >= 1) return 1;
  let hash =
    Math.imul(Math.floor(x), 0x1f123bb5) ^ Math.imul(Math.floor(y), 0x5f356495) ^ 0x6d2b79f5;
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296 < coverage ? 1 : 0;
}
export function compositePixels(
  backdrop,
  source,
  mode,
  opacity = 1,
  width = backdrop.length / 4,
  originX = 0,
  originY = 0,
) {
  const out = new Uint8ClampedArray(backdrop.length);
  const mixed = new Float64Array(3);
  for (let i = 0; i < out.length; i += 4) {
    const ab = backdrop[i + 3] / 255;
    let as = (source[i + 3] / 255) * opacity;
    if (mode === 'dissolve')
      as = dissolveCoverage(as, originX + ((i / 4) % width), originY + Math.floor(i / 4 / width));
    const alpha = as + ab * (1 - as);
    if (!alpha) continue;
    blendPixel(mode, backdrop, source, i, mixed);
    for (let c = 0; c < 3; c++)
      out[i + c] =
        ((1 - as) * ab * backdrop[i + c] + as * (1 - ab) * source[i + c] + as * ab * mixed[c]) /
        alpha;
    out[i + 3] = alpha * 255;
  }
  return out;
}
