// LRU budget includes retained source/mask pixels as well as the rendered output.
// Pixel edits must invalidate the source; immutable canvas replacements miss automatically.
export function createRenderCache(budget = 64 * 1024 * 1024) {
  const entries = new Map();
  let bytes = 0,
    hits = 0,
    misses = 0;
  function invalidate(source) {
    const entry = entries.get(source);
    if (entry) {
      bytes -= entry.bytes;
      entries.delete(source);
    }
  }
  return {
    invalidate,
    clear() {
      entries.clear();
      bytes = 0;
    },
    stats() {
      return { bytes, entries: entries.size, hits, misses, budget };
    },
    get(source, mask, styles, render) {
      const entry = entries.get(source);
      if (entry && entry.mask === mask && entry.styles === styles) {
        hits++;
        entries.delete(source);
        entries.set(source, entry);
        return entry.result;
      }
      misses++;
      invalidate(source);
      const result = render();
      const pixels = new Set([source, mask, result.image]);
      let cost = 0;
      for (const image of pixels) if (image) cost += image.width * image.height * 4;
      if (cost <= budget) {
        while (bytes + cost > budget && entries.size) invalidate(entries.keys().next().value);
        entries.set(source, { mask, styles, result, bytes: cost });
        bytes += cost;
      }
      return result;
    },
  };
}
