// Exact squared Euclidean distance transform, two linear passes.
// Values refer to pixel centers. Callers add a transparent border for inside distances.
export function distanceMap(alpha, width, height, toOpaque) {
  const count = width * height;
  if (alpha.length !== count) throw Error('透明度尺寸不匹配');
  const result = new Float32Array(count);
  const size = Math.max(width, height);
  const f = new Float64Array(size),
    d = new Float64Array(size);
  const vertices = new Int32Array(size),
    breaks = new Float64Array(size + 1);
  function transform(n) {
    let k = 0;
    vertices[0] = 0;
    breaks[0] = -Infinity;
    breaks[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let cross;
      do {
        const p = vertices[k];
        cross = (f[q] + q * q - (f[p] + p * p)) / (2 * (q - p));
        if (cross > breaks[k]) break;
        k--;
      } while (k >= 0);
      k++;
      vertices[k] = q;
      breaks[k] = cross;
      breaks[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (breaks[k + 1] < q) k++;
      d[q] = (q - vertices[k]) ** 2 + f[vertices[k]];
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = alpha[y * width + x] >= 128 === toOpaque ? 0 : 1e12;
    transform(height);
    for (let y = 0; y < height; y++) result[y * width + x] = d[y];
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = result[y * width + x];
    transform(width);
    for (let x = 0; x < width; x++) result[y * width + x] = d[x];
  }
  return result;
}
export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

export function strokePixels(alpha, width, height, effect) {
  const outer = effect.position !== 'inside' ? distanceMap(alpha, width, height, true) : null;
  const inner = effect.position !== 'outside' ? distanceMap(alpha, width, height, false) : null;
  const size = effect.position === 'center' ? effect.size / 2 : effect.size;
  const color = rgb(effect.color),
    out = new Uint8ClampedArray(alpha.length * 4);
  for (let i = 0; i < alpha.length; i++) {
    const a = alpha[i] / 255;
    const coverage =
      (outer ? clamp01(size + 0.5 - Math.sqrt(outer[i])) * (1 - a) : 0) +
      (inner ? clamp01(size + 0.5 - Math.sqrt(inner[i])) * a : 0);
    out.set(color, i * 4);
    out[i * 4 + 3] = coverage * effect.opacity * 255;
  }
  return out;
}

export function bevelPixels(alpha, width, height, effect) {
  const distances = distanceMap(alpha, width, height, false);
  const azimuth = (effect.angle * Math.PI) / 180,
    elevation = (effect.elevation * Math.PI) / 180;
  const light = [
    Math.cos(azimuth) * Math.cos(elevation),
    -Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
  ];
  const highlight = rgb(effect.color),
    shadow = rgb(effect.endColor);
  const out = new Uint8ClampedArray(alpha.length * 4);
  const heightAt = (x, y) =>
    Math.min(
      effect.size,
      Math.sqrt(
        distances[
          Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))
        ],
      ),
    ) * effect.depth;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!alpha[i]) continue;
      const nx = (heightAt(x - 1, y) - heightAt(x + 1, y)) / 2;
      const ny = (heightAt(x, y - 1) - heightAt(x, y + 1)) / 2;
      const lighting =
        (nx * light[0] + ny * light[1] + light[2]) / Math.hypot(nx, ny, 1) - light[2];
      out.set(lighting >= 0 ? highlight : shadow, i * 4);
      out[i * 4 + 3] = clamp01(Math.abs(lighting)) * alpha[i] * effect.opacity;
    }
  return out;
}
