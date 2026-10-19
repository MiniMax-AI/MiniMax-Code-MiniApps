// @ts-check
// 已选清单：合计大小只算最外层。

/**
 * 去掉被其他条目包含的条目，只留最外层。
 * @template {{ path: string }} T
 * @param {T[]} entries @param {import('./util.mjs').PathOps} pathOps
 * @returns {{ outer: T[], inner: { entry: T, outer: T }[] }}
 */
export function outermost(entries, pathOps) {
  /** @type {Map<string, T>} */
  const byKey = new Map();
  for (const e of entries) {
    const k = pathOps.key(e.path);
    if (!byKey.has(k)) byKey.set(k, e);
  }
  /** @type {T[]} */
  const outer = [];
  /** @type {{ entry: T, outer: T }[]} */
  const inner = [];
  for (const [k, e] of byKey) {
    let cur = k;
    /** @type {T | null} */
    let container = null;
    for (;;) {
      const parent = pathOps.key(pathOps.dirname(cur));
      if (parent === cur) break;
      const hit = byKey.get(parent);
      if (hit) container = hit;
      cur = parent;
    }
    if (container) inner.push({ entry: e, outer: container });
    else outer.push(e);
  }
  return { outer, inner };
}

/**
 * @param {{ path: string, releasableBytes: number }[]} entries @param {import('./util.mjs').PathOps} pathOps
 */
export function selectionTotals(entries, pathOps) {
  const { outer } = outermost(entries, pathOps);
  let bytes = 0;
  for (const e of outer) bytes += e.releasableBytes || 0;
  return { count: entries.length, bytes };
}
