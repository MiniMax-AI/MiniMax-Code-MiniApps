// Shape-preserving cubic interpolation: a monotone segment cannot overshoot its endpoints.
export function curveLUT(points) {
  if (!Array.isArray(points) || points.length < 2 || points.length > 32)
    throw Error('曲线需要 2–32 个控制点');
  const p = points.map((point) => {
    if (
      !Array.isArray(point) ||
      point.length !== 2 ||
      !point.every((v) => Number.isFinite(v) && v >= 0 && v <= 255)
    )
      throw Error('曲线控制点须在 0–255 范围内');
    return [...point];
  });
  if (p[0][0] !== 0 || p.at(-1)[0] !== 255 || p.some((v, i) => i && v[0] <= p[i - 1][0]))
    throw Error('曲线输入须从 0 到 255 严格递增');
  const widths = p.slice(1).map((v, i) => v[0] - p[i][0]);
  const slopes = widths.map((w, i) => (p[i + 1][1] - p[i][1]) / w);
  const tangent = [slopes[0]];
  for (let i = 1; i < p.length - 1; i++) {
    const a = slopes[i - 1],
      b = slopes[i];
    const w1 = 2 * widths[i] + widths[i - 1],
      w2 = widths[i] + 2 * widths[i - 1];
    tangent.push(a * b <= 0 ? 0 : (w1 + w2) / (w1 / a + w2 / b));
  }
  tangent.push(slopes.at(-1));
  const table = new Uint8ClampedArray(256);
  let segment = 0;
  for (let x = 0; x < 256; x++) {
    while (segment < p.length - 2 && x > p[segment + 1][0]) segment++;
    const h = widths[segment],
      t = (x - p[segment][0]) / h,
      t2 = t * t,
      t3 = t2 * t;
    table[x] =
      (2 * t3 - 3 * t2 + 1) * p[segment][1] +
      (t3 - 2 * t2 + t) * h * tangent[segment] +
      (-2 * t3 + 3 * t2) * p[segment + 1][1] +
      (t3 - t2) * h * tangent[segment + 1];
  }
  return table;
}
export function applyCurves(data, curves) {
  if (!curves || typeof curves !== 'object') throw Error('缺少曲线参数');
  const identity = [
      [0, 0],
      [255, 255],
    ],
    master = curveLUT(curves.rgb || identity);
  const channels = ['red', 'green', 'blue'].map((name) => curveLUT(curves[name] || identity));
  const out = new Uint8ClampedArray(data);
  for (let i = 0; i < out.length; i += 4)
    for (let c = 0; c < 3; c++) out[i + c] = channels[c][master[data[i + c]]];
  return out;
}
