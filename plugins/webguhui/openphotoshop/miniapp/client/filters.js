import { oilPaint } from './oil-paint.js';
import { artisticFilter } from './artistic-filters.js';
import { applyCurves } from './tone.js';
import { gaussianBlur } from './gaussian.js';
const clamp = (v) => Math.max(0, Math.min(255, v));
function hsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min,
    l = (max + min) / 2;
  let h = 0,
    s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [(h + 1) % 1, s, l];
}
function rgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s,
    x = c * (1 - Math.abs(((h * 6) % 2) - 1)),
    m = l - c / 2;
  const a =
    h < 1 / 6
      ? [c, x, 0]
      : h < 2 / 6
        ? [x, c, 0]
        : h < 3 / 6
          ? [0, c, x]
          : h < 4 / 6
            ? [0, x, c]
            : h < 5 / 6
              ? [x, 0, c]
              : [c, 0, x];
  return a.map((v) => (v + m) * 255);
}
export function filterPixels(data, w, h, type, value = 20) {
  if (['halftone', 'diffuse', 'traceContour', 'glowingEdges'].includes(type))
    return artisticFilter(data, w, h, type, value);
  if (type === 'oilPaint') return oilPaint(data, w, h, value);
  if (type === 'curves') return applyCurves(data, value?.curves);
  if (type === 'gaussian') return gaussianBlur(data, w, h, Number(value));
  const src = new Uint8ClampedArray(data),
    out = new Uint8ClampedArray(src);
  const amount = Number(value);
  if (['blur', 'sharpen', 'emboss', 'edges', 'unsharp'].includes(type)) {
    const radius = type === 'blur' ? Math.max(1, Math.min(30, Math.round(amount))) : 1;
    if (type === 'blur' || type === 'unsharp') {
      // Sliding window, O(width * height), independent of blur radius.
      const tmp = new Float32Array(src.length),
        r = type === 'unsharp' ? 2 : radius,
        span = 2 * r + 1;
      for (let y = 0; y < h; y++)
        for (let c = 0; c < 4; c++) {
          let sum = 0;
          for (let k = -r; k <= r; k++)
            sum += src[(y * w + Math.max(0, Math.min(w - 1, k))) * 4 + c];
          for (let x = 0; x < w; x++) {
            tmp[(y * w + x) * 4 + c] = sum / span;
            sum +=
              src[(y * w + Math.min(w - 1, x + r + 1)) * 4 + c] -
              src[(y * w + Math.max(0, x - r)) * 4 + c];
          }
        }
      for (let x = 0; x < w; x++)
        for (let c = 0; c < 4; c++) {
          let sum = 0;
          for (let k = -r; k <= r; k++)
            sum += tmp[(Math.max(0, Math.min(h - 1, k)) * w + x) * 4 + c];
          for (let y = 0; y < h; y++) {
            const i = (y * w + x) * 4 + c;
            out[i] =
              type === 'unsharp' && c < 3
                ? clamp(src[i] + ((src[i] - sum / span) * amount) / 20)
                : type === 'unsharp'
                  ? src[i]
                  : sum / span;
            sum +=
              tmp[(Math.min(h - 1, y + r + 1) * w + x) * 4 + c] -
              tmp[(Math.max(0, y - r) * w + x) * 4 + c];
          }
        }
      return out;
    }
    const kernel =
      type === 'sharpen'
        ? [0, -1, 0, -1, 5, -1, 0, -1, 0]
        : type === 'emboss'
          ? [-2, -1, 0, -1, 1, 1, 0, 1, 2]
          : [-1, -1, -1, -1, 8, -1, -1, -1, -1];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++)
              sum +=
                src[
                  (Math.max(0, Math.min(h - 1, y + dy)) * w +
                    Math.max(0, Math.min(w - 1, x + dx))) *
                    4 +
                    c
                ] * kernel[(dy + 1) * 3 + dx + 1];
          out[(y * w + x) * 4 + c] = clamp(sum + (type === 'emboss' ? 128 : 0));
        }
    return out;
  }
  if (type === 'pixelate') {
    const size = Math.max(2, Math.round(amount));
    for (let y = 0; y < h; y += size)
      for (let x = 0; x < w; x += size) {
        const sums = [0, 0, 0, 0];
        let n = 0;
        for (let yy = y; yy < Math.min(y + size, h); yy++)
          for (let xx = x; xx < Math.min(x + size, w); xx++) {
            for (let c = 0; c < 4; c++) sums[c] += src[(yy * w + xx) * 4 + c];
            n++;
          }
        for (let yy = y; yy < Math.min(y + size, h); yy++)
          for (let xx = x; xx < Math.min(x + size, w); xx++)
            for (let c = 0; c < 4; c++) out[(yy * w + xx) * 4 + c] = sums[c] / n;
      }
    return out;
  }
  if (['twirl', 'pinch', 'spherize', 'ripple', 'wave', 'polar', 'shear'].includes(type)) {
    const cx = w / 2,
      cy = h / 2,
      radius = Math.min(w, h) / 2;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let sx = x,
          sy = y;
        const dx = x - cx,
          dy = y - cy,
          r = Math.hypot(dx, dy),
          a = Math.atan2(dy, dx);
        if (type === 'twirl' && r < radius) {
          const angle = a + ((1 - r / radius) * amount) / 30;
          sx = cx + Math.cos(angle) * r;
          sy = cy + Math.sin(angle) * r;
        }
        if ((type === 'pinch' || type === 'spherize') && r < radius && r > 0) {
          const q =
            type === 'pinch'
              ? Math.pow(r / radius, 1 + amount / 100)
              : Math.sin(((r / radius) * Math.PI) / 2);
          sx = cx + (dx * q * radius) / r;
          sy = cy + (dy * q * radius) / r;
        }
        if (type === 'wave') sx = x + Math.sin(y / 20) * amount;
        if (type === 'ripple' && r > 0) {
          sx = x + ((dx / r) * Math.sin(r / 10) * amount) / 5;
          sy = y + ((dy / r) * Math.sin(r / 10) * amount) / 5;
        }
        if (type === 'shear') sx = x + (y / h - 0.5) * amount;
        if (type === 'polar') {
          sx = ((a + Math.PI) / (2 * Math.PI)) * w;
          sy = (r / radius) * h;
        }
        const si =
          (Math.max(0, Math.min(h - 1, Math.round(sy))) * w +
            Math.max(0, Math.min(w - 1, Math.round(sx)))) *
          4;
        out.set(src.subarray(si, si + 4), (y * w + x) * 4);
      }
    return out;
  }
  for (let i = 0; i < src.length; i += 4) {
    let r = src[i],
      g = src[i + 1],
      b = src[i + 2],
      lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    switch (type) {
      case 'brightness':
        r += amount;
        g += amount;
        b += amount;
        break;
      case 'contrast': {
        const f = (259 * (amount + 255)) / (255 * (259 - amount));
        r = f * (r - 128) + 128;
        g = f * (g - 128) + 128;
        b = f * (b - 128) + 128;
        break;
      }
      case 'exposure': {
        const f = 2 ** (amount / 20);
        r *= f;
        g *= f;
        b *= f;
        break;
      }
      case 'grayscale':
        r = g = b = lum;
        break;
      case 'invert':
        r = 255 - r;
        g = 255 - g;
        b = 255 - b;
        break;
      case 'threshold':
        r = g = b = lum >= amount ? 255 : 0;
        break;
      case 'posterize': {
        const n = Math.max(2, Math.round(amount));
        r = (Math.round((r / 255) * (n - 1)) / (n - 1)) * 255;
        g = (Math.round((g / 255) * (n - 1)) / (n - 1)) * 255;
        b = (Math.round((b / 255) * (n - 1)) / (n - 1)) * 255;
        break;
      }
      case 'saturation':
      case 'vibrance': {
        const factor =
          1 +
          (amount / 100) *
            (type === 'vibrance' ? 1 - (Math.max(r, g, b) - Math.min(r, g, b)) / 255 : 1);
        r = lum + (r - lum) * factor;
        g = lum + (g - lum) * factor;
        b = lum + (b - lum) * factor;
        break;
      }
      case 'hue': {
        let [hh, s, l] = hsl(r, g, b);
        [r, g, b] = rgb((hh + amount / 360 + 1) % 1, s, l);
        break;
      }
      case 'warmth':
        r += amount;
        b -= amount;
        break;
      case 'sepia':
        r = 0.393 * src[i] + 0.769 * src[i + 1] + 0.189 * src[i + 2];
        g = 0.349 * src[i] + 0.686 * src[i + 1] + 0.168 * src[i + 2];
        b = 0.272 * src[i] + 0.534 * src[i + 1] + 0.131 * src[i + 2];
        break;
      case 'noise': {
        const n = (Math.random() - 0.5) * amount;
        r += n;
        g += n;
        b += n;
        break;
      }
      case 'solarize':
        r = r > 128 ? 255 - r : r;
        g = g > 128 ? 255 - g : g;
        b = b > 128 ? 255 - b : b;
        break;
      case 'levels': {
        const black = Math.max(0, Math.min(100, amount)),
          f = 255 / (255 - 2 * black);
        r = (r - black) * f;
        g = (g - black) * f;
        b = (b - black) * f;
        break;
      }
      case 'gamma': {
        const gamma = Math.max(0.1, amount / 100);
        r = 255 * (r / 255) ** (1 / gamma);
        g = 255 * (g / 255) ** (1 / gamma);
        b = 255 * (b / 255) ** (1 / gamma);
        break;
      }
      case 'redEye':
        if (r > g * 1.4 && r > b * 1.4) r = (g + b) / 2;
        break;
      case 'enhance': {
        const f = 1.12;
        r = (r - 128) * f + 133;
        g = (g - 128) * f + 133;
        b = (b - 128) * f + 133;
        break;
      }
    }
    out[i] = clamp(r);
    out[i + 1] = clamp(g);
    out[i + 2] = clamp(b);
  }
  return out;
}
