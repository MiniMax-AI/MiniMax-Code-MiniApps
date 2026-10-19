// Separable Gaussian convolution in premultiplied RGBA avoids colored fringes at transparent edges.
export function gaussianBlur(data, width, height, sigma) {
  if (!Number.isFinite(sigma) || sigma < 0 || sigma > 30)
    throw Error('高斯模糊半径须在 0–30 范围内');
  if (sigma === 0) return new Uint8ClampedArray(data);
  const radius = Math.ceil(3 * sigma),
    weights = new Float64Array(radius * 2 + 1);
  let total = 0;
  for (let i = -radius; i <= radius; i++) {
    weights[i + radius] = Math.exp(-(i * i) / (2 * sigma * sigma));
    total += weights[i + radius];
  }
  for (let i = 0; i < weights.length; i++) weights[i] /= total;
  const horizontal = new Float32Array(data.length),
    out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      for (let k = -radius; k <= radius; k++) {
        const source = (y * width + Math.max(0, Math.min(width - 1, x + k))) * 4,
          weight = weights[k + radius],
          alpha = data[source + 3] / 255;
        for (let c = 0; c < 3; c++) horizontal[offset + c] += data[source + c] * alpha * weight;
        horizontal[offset + 3] += alpha * weight;
      }
    }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4,
        sum = [0, 0, 0, 0];
      for (let k = -radius; k <= radius; k++) {
        const source = (Math.max(0, Math.min(height - 1, y + k)) * width + x) * 4,
          weight = weights[k + radius];
        for (let c = 0; c < 4; c++) sum[c] += horizontal[source + c] * weight;
      }
      out[offset + 3] = sum[3] * 255;
      if (sum[3] > 1e-8) for (let c = 0; c < 3; c++) out[offset + c] = sum[c] / sum[3];
    }
  return out;
}
