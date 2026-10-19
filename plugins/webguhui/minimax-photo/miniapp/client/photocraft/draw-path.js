// SVG-style absolute curve commands, converted to actual brush samples.
// One path is one continuous stroke; use another stroke for a disconnected path.
export function pathPoints(path, pressure = 1) {
  if (!Array.isArray(path) || !path.length || path.length > 128)
    throw Error('path requires 1..128 M/L/Q/C/Z commands');
  if (!Number.isFinite(pressure) || pressure < 0 || pressure > 1)
    throw Error('pressure must be between 0 and 1');
  const points = [];
  let current, start;
  const append = (p) => {
    if (points.length >= 4096) throw Error('path exceeds 4096 samples; split into strokes');
    points.push([p[0], p[1], pressure]);
    current = p;
  };
  for (const row of path) {
    const length = { M: 3, L: 3, Q: 5, C: 7, Z: 1 }[row?.[0]];
    if (!Array.isArray(row) || row.length !== length || !row.slice(1).every(Number.isFinite))
      throw Error('Use absolute M x y, L x y, Q cx cy x y, C c1x c1y c2x c2y x y, Z');
    const [kind, ...v] = row;
    if (kind === 'M') {
      if (start) throw Error('One M per stroke; use separate strokes for disconnected paths');
      start = v;
      append(v);
      continue;
    }
    if (!current) throw Error('path must start with M');
    if (kind === 'L' || kind === 'Z') { append(kind === 'Z' ? start : v); continue; }
    const controls = [current];
    for (let i = 0; i < v.length; i += 2) controls.push(v.slice(i, i + 2));
    const lengthPx = controls.slice(1).reduce((n, p, i) => n + Math.hypot(p[0]-controls[i][0],p[1]-controls[i][1]), 0);
    const steps = Math.max(2, Math.min(1024, Math.ceil(lengthPx / 3)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      let work = controls.map(p => [...p]);
      while (work.length > 1) work = work.slice(1).map((p, j) => [
        work[j][0] * (1-t) + p[0] * t, work[j][1] * (1-t) + p[1] * t,
      ]);
      append(work[0]);
    }
  }
  return points;
}

export function brushParameters(stroke) {
  if (!stroke || typeof stroke !== 'object') throw Error('Each stroke must be an object');
  if (stroke.path !== undefined && stroke.points !== undefined)
    throw Error('Choose path or points, not both');
  const { path, pressure, ...params } = stroke;
  if (pressure !== undefined && (!Number.isFinite(pressure) || pressure < 0 || pressure > 1))
    throw Error('pressure must be between 0 and 1');
  if (path !== undefined) params.points = pathPoints(path, pressure);
  if (!Array.isArray(params.points) || !params.points.length)
    throw Error('Each stroke requires points or a path');
  if (path === undefined && pressure !== undefined) {
    params.points = params.points.map(point => {
      if (Array.isArray(point)) {
        const sample = [...point];
        if (sample[2] == null) sample[2] = pressure;
        return sample;
      }
      if (point && typeof point === 'object')
        return { ...point, pressure: point.pressure ?? pressure };
      return point;
    });
  }
  return params;
}
