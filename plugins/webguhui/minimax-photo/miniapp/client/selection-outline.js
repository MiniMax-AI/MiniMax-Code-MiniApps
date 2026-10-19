// Return boundary segments of scanline selections; interior row edges are omitted.
export function runOutline(runs) {
  const rows = new Map(),
    edges = [];
  for (const [x, y, w] of runs) {
    if (w <= 0) continue;
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push([x, x + w]);
  }
  for (const [y, intervals] of rows) {
    intervals.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const interval of intervals) {
      const last = merged.at(-1);
      if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
      else merged.push([...interval]);
    }
    rows.set(y, merged);
  }
  function horizontal(start, end, y, neighbors) {
    let cursor = start;
    const row = neighbors || [];
    let low = 0,
      high = row.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (row[mid][1] <= cursor) low = mid + 1;
      else high = mid;
    }
    for (let i = low; i < row.length; i++) {
      const [a, b] = row[i];
      if (b <= cursor) continue;
      if (a >= end) break;
      if (a > cursor) edges.push([cursor, y, Math.min(a, end), y]);
      cursor = Math.max(cursor, b);
      if (cursor >= end) return;
    }
    if (cursor < end) edges.push([cursor, y, end, y]);
  }
  for (const [y, intervals] of rows)
    for (const [a, b] of intervals) {
      horizontal(a, b, y, rows.get(y - 1));
      horizontal(a, b, y + 1, rows.get(y + 1));
      edges.push([a, y, a, y + 1], [b, y, b, y + 1]);
    }
  return edges;
}
