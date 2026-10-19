// Coverage mask for a sampled-color brush swept along a line segment.
export function backgroundEraseMask(
  data,
  width,
  height,
  originX,
  originY,
  from,
  to,
  radius,
  sampled,
  tolerance,
) {
  const mask = new Uint8ClampedArray(data.length);
  const dx = to.x - from.x,
    dy = to.y - from.y,
    length2 = dx * dx + dy * dy;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (
        !data[i + 3] ||
        Math.max(
          Math.abs(data[i] - sampled[0]),
          Math.abs(data[i + 1] - sampled[1]),
          Math.abs(data[i + 2] - sampled[2]),
        ) > tolerance
      )
        continue;
      const px = originX + x + 0.5,
        py = originY + y + 0.5;
      const t = length2
        ? Math.max(0, Math.min(1, ((px - from.x) * dx + (py - from.y) * dy) / length2))
        : 0;
      const distance = Math.hypot(px - from.x - t * dx, py - from.y - t * dy);
      mask[i + 3] = 255 * Math.max(0, Math.min(1, radius + 0.5 - distance));
    }
  return mask;
}
