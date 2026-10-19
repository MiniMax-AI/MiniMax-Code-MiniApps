// Four-neighbor color selection, shared by the bucket, wand and magic eraser.
// One visit per pixel; no per-pixel array allocation.
export function floodRegion(data, width, height, x, y, tolerance) {
  const mask = new Uint8Array(width * height);
  if (x < 0 || y < 0 || x >= width || y >= height) return { mask, bounds: null };
  const seed = y * width + x,
    target = seed * 4;
  const r = data[target],
    g = data[target + 1],
    b = data[target + 2],
    a = data[target + 3];
  const queue = new Int32Array(width * height);
  let head = 0,
    tail = 1,
    minX = x,
    maxX = x,
    minY = y,
    maxY = y;
  queue[0] = seed;
  mask[seed] = 1;
  const visit = (index) => {
    if (!mask[index]) {
      mask[index] = 1;
      queue[tail++] = index;
    }
  };
  while (head < tail) {
    const index = queue[head++],
      offset = index * 4;
    if (
      Math.abs(data[offset] - r) > tolerance ||
      Math.abs(data[offset + 1] - g) > tolerance ||
      Math.abs(data[offset + 2] - b) > tolerance ||
      Math.abs(data[offset + 3] - a) > tolerance
    )
      continue;
    mask[index] = 2;
    const xx = index % width,
      yy = Math.floor(index / width);
    minX = Math.min(minX, xx);
    maxX = Math.max(maxX, xx);
    minY = Math.min(minY, yy);
    maxY = Math.max(maxY, yy);
    if (xx > 0) visit(index - 1);
    if (xx + 1 < width) visit(index + 1);
    if (yy > 0) visit(index - width);
    if (yy + 1 < height) visit(index + width);
  }
  return { mask, bounds: { minX, minY, maxX, maxY } };
}
