// Independent pixel implementations. No original-site code or assets are used.
const bounded = (v, max) => Math.max(0, Math.min(max - 1, v));
const luminance = (data, i) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
export function artisticFilter(src, w, h, type, value) {
  const out = new Uint8ClampedArray(src);
  const amount = Number.isFinite(Number(value)) ? Number(value) : 1;
  if (type === 'halftone') {
    const size = Math.max(2, Math.min(64, Math.round(amount)));
    for (let by = 0; by < h; by += size)
      for (let bx = 0; bx < w; bx += size) {
        const right = Math.min(w, bx + size),
          bottom = Math.min(h, by + size);
        let weighted = 0,
          alpha = 0;
        for (let y = by; y < bottom; y++)
          for (let x = bx; x < right; x++) {
            const i = (y * w + x) * 4;
            weighted += luminance(src, i) * src[i + 3];
            alpha += src[i + 3];
          }
        const dark = alpha ? 1 - weighted / (255 * alpha) : 0;
        const radius = Math.sqrt((dark * (right - bx) * (bottom - by)) / Math.PI);
        const cx = (bx + right) / 2,
          cy = (by + bottom) / 2;
        for (let y = by; y < bottom; y++)
          for (let x = bx; x < right; x++) {
            const i = (y * w + x) * 4;
            const coverage =
              dark <= 0.001
                ? 0
                : dark >= 0.999
                  ? 1
                  : Math.max(0, Math.min(1, radius + 0.5 - Math.hypot(x + 0.5 - cx, y + 0.5 - cy)));
            out[i] = out[i + 1] = out[i + 2] = 255 * (1 - coverage);
          }
      }
    return out;
  }
  if (type === 'diffuse') {
    const radius = Math.max(1, Math.min(20, Math.round(amount)));
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        // Coordinate hash keeps repeated previews and exports reproducible.
        let hash = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263);
        hash = Math.imul(hash ^ (hash >>> 13), 1274126177) >>> 0;
        const sx = bounded(x + (hash % (2 * radius + 1)) - radius, w);
        const sy = bounded(y + ((hash >>> 16) % (2 * radius + 1)) - radius, h);
        const i = (y * w + x) * 4,
          j = (sy * w + sx) * 4;
        // Retain geometry/alpha and avoid importing hidden RGB from transparent pixels.
        if (src[j + 3]) for (let c = 0; c < 3; c++) out[i + c] = src[j + c];
      }
    return out;
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (type === 'traceContour') {
        const high = luminance(src, i) >= amount;
        let edge = false;
        for (const [dx, dy] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ]) {
          const j = (bounded(y + dy, h) * w + bounded(x + dx, w)) * 4;
          if (src[j + 3] && luminance(src, j) >= amount !== high) edge = true;
        }
        out[i] = out[i + 1] = out[i + 2] = edge ? 0 : 255;
      } else if (type === 'glowingEdges') {
        for (let c = 0; c < 3; c++) {
          let gx = 0,
            gy = 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const j = (bounded(y + dy, h) * w + bounded(x + dx, w)) * 4;
              const v = (src[j + c] * src[j + 3]) / 255;
              gx += v * dx * (dy === 0 ? 2 : 1);
              gy += v * dy * (dx === 0 ? 2 : 1);
            }
          out[i + c] = (Math.hypot(gx, gy) * Math.max(1, Math.min(10, amount))) / 4;
        }
      }
    }
  return out;
}
