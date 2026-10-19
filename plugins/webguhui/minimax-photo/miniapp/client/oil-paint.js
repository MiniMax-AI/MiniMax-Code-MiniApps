// Dominant-luminance neighborhood painting. Sliding columns avoid rebuilding
// the entire square histogram for every pixel; transparent colors carry no weight.
export function oilPaint(source, width, height, value) {
  const radius = Math.max(1, Math.min(12, Math.round(Number(value) || 1)));
  const output = new Uint8ClampedArray(source);
  const bins = new Uint8Array(width * height);
  for (let i = 0; i < bins.length; i++)
    bins[i] = Math.min(
      15,
      Math.floor(
        (0.2126 * source[i * 4] + 0.7152 * source[i * 4 + 1] + 0.0722 * source[i * 4 + 2]) / 16,
      ),
    );
  const weights = new Float64Array(16),
    colors = new Float64Array(48);
  function column(x, y, direction) {
    x = Math.max(0, Math.min(width - 1, x));
    for (let dy = -radius; dy <= radius; dy++) {
      const yy = Math.max(0, Math.min(height - 1, y + dy)),
        p = yy * width + x,
        i = p * 4,
        b = bins[p],
        a = source[i + 3] * direction;
      weights[b] += a;
      for (let c = 0; c < 3; c++) colors[b * 3 + c] += source[i + c] * a;
    }
  }
  for (let y = 0; y < height; y++) {
    weights.fill(0);
    colors.fill(0);
    for (let x = -radius; x <= radius; x++) column(x, y, 1);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (source[i + 3]) {
        let dominant = 0;
        for (let b = 1; b < 16; b++) if (weights[b] > weights[dominant]) dominant = b;
        if (weights[dominant])
          for (let c = 0; c < 3; c++) output[i + c] = colors[dominant * 3 + c] / weights[dominant];
      }
      column(x - radius, y, -1);
      column(x + radius + 1, y, 1);
    }
  }
  return output;
}
