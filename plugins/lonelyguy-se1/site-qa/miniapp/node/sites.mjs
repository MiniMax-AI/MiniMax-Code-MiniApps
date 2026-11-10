import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { assertProjectRoot, isHtmlFile, relativeToRoot, shouldSkipDir } from './paths.mjs';

const PREFERRED = new Set(['public', 'dist', 'out', 'build', 'docs', 'www', 'site', 'static', '_site', 'html']);

/**
 * Suggest site roots under a workspace so the UI can offer a dropdown
 * instead of forcing a hand-typed path.
 *
 * @param {string} workspaceInput
 * @param {{ signal?: AbortSignal, home?: string, minimaxDataDir?: string }} [options]
 */
export async function discoverSiteRoots(workspaceInput, options = {}) {
  const workspace = await assertProjectRoot(workspaceInput, options);
  /** @type {Map<string, { path: string, label: string, reason: string, score: number }>} */
  const found = new Map();

  const add = (abs, reason, score) => {
    const key = path.resolve(abs);
    const current = found.get(key);
    if (current && current.score >= score) return;
    const rel = relativeToRoot(workspace, key) || '.';
    found.set(key, {
      path: key,
      label: rel === '.' ? 'Workspace root' : rel,
      reason,
      score,
    });
  };

  if (await hasHtml(workspace)) add(workspace, 'Contains HTML files', 10);

  const queue = [{ dir: workspace, depth: 0 }];
  while (queue.length) {
    if (options.signal?.aborted) throw new Error('aborted');
    const { dir, depth } = queue.shift();
    if (depth > 3) continue;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || shouldSkipDir(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const preferred = PREFERRED.has(entry.name.toLowerCase());
      const indexHtml = await hasIndexHtml(full);
      if (indexHtml) {
        add(full, preferred ? `Common site folder with index.html` : 'Folder with index.html', preferred ? 40 : 25);
      } else if (preferred && (await hasHtml(full))) {
        add(full, 'Common site folder with HTML', 30);
      }
      if (depth < 3 && (preferred || depth < 2)) {
        queue.push({ dir: full, depth: depth + 1 });
      }
    }
  }

  const sites = [...found.values()].sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  if (sites.length === 0) {
    sites.push({
      path: workspace,
      label: 'Workspace root',
      reason: 'No HTML folders found yet. Scan here or paste a path',
      score: 0,
    });
  }
  return { workspace, sites: sites.slice(0, 24) };
}

/** @param {string} dir */
async function hasIndexHtml(dir) {
  for (const name of ['index.html', 'index.htm', 'Index.html']) {
    try {
      const info = await stat(path.join(dir, name));
      if (info.isFile()) return true;
    } catch {
      // try next
    }
  }
  return false;
}

/** @param {string} dir */
async function hasHtml(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.isFile() && isHtmlFile(entry.name)) return true;
    if (entry.isDirectory() && !shouldSkipDir(entry.name)) {
      // shallow only
      try {
        const nested = await readdir(path.join(dir, entry.name), { withFileTypes: true });
        if (nested.some((item) => item.isFile() && isHtmlFile(item.name))) return true;
      } catch {
        // ignore
      }
    }
  }
  return false;
}
