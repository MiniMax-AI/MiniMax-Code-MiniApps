/* ═══════════════════════════════════════════════════════════════════════════
   The /api/frame render cache (analysis/frames/) — bounded, oldest-first.

   Every distinct combination of source + arguments renders its own JPEG, so an
   unbounded cache is a disk-fill primitive: varying w, q or t mints a new file
   each time, and a hostile page could do exactly that through the endpoint.
   (The header gate on ?path= keeps strangers out; this keeps friends honest.)
   Each entry is a .jpg plus its .json sidecar; pruning removes both, oldest
   mtime first, until the directory is back under both limits.

   Pure filesystem logic, no ffmpeg — unit-tested directly in frame-cache.test.js.
   ═══════════════════════════════════════════════════════════════════════════ */
"use strict";
const fs = require("fs");
const path = require("path");

/* Generous enough that a real editing session never notices: a few hundred
   grabs at ~100 KB each is tens of megabytes. */
const DEFAULT_MAX_FILES = 500;
const DEFAULT_MAX_BYTES = 128 * 1024 * 1024;

/** Delete oldest entries until dir holds ≤ maxFiles JPEGs and ≤ maxBytes.
 *  Returns {files, bytes, pruned}. Never throws — a prune failure must not
 *  fail the request that triggered it. */
function pruneCache(dir, { maxFiles = DEFAULT_MAX_FILES, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return { files: 0, bytes: 0, pruned: 0 }; }
  const entries = [];
  for (const name of names) {
    if (!name.endsWith(".jpg")) continue;
    try {
      const st = fs.statSync(path.join(dir, name));
      if (st.isFile()) entries.push({ name, size: st.size, mtime: st.mtimeMs });
    } catch { /* vanished mid-sweep — someone else pruned it */ }
  }
  entries.sort((a, b) => a.mtime - b.mtime); // oldest first
  let bytes = entries.reduce((s, e) => s + e.size, 0);
  let pruned = 0;
  while ((entries.length > maxFiles || bytes > maxBytes) && entries.length) {
    const victim = entries.shift();
    bytes -= victim.size;
    pruned++;
    try { fs.rmSync(path.join(dir, victim.name)); } catch {}
    try { fs.rmSync(path.join(dir, victim.name.replace(/\.jpg$/, ".json"))); } catch {}
  }
  return { files: entries.length, bytes, pruned };
}

module.exports = { pruneCache, DEFAULT_MAX_FILES, DEFAULT_MAX_BYTES };
