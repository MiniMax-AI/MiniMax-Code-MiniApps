import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { isHtmlFile, relativeToRoot, resolveUnderRoot, shouldSkipDir } from './paths.mjs';

export const MAX_FILES = 80;
export const MAX_DEPTH = 8;
export const MAX_BYTES = 1_500_000;

/**
 * @param {string} root
 * @param {{ signal?: AbortSignal }} [options]
 */
export async function discoverHtmlFiles(root, options = {}) {
  /** @type {string[]} */
  const skipped = [];
  const found = await walk(root, root, 0, options.signal, skipped);
  const truncated = found.length > MAX_FILES;
  const files = found.slice(0, MAX_FILES);

  files.sort((a, b) => {
    const ra = relativeToRoot(root, a);
    const rb = relativeToRoot(root, b);
    const ia = /(?:^|\/)index\.html?$/i.test(ra) ? 0 : 1;
    const ib = /(?:^|\/)index\.html?$/i.test(rb) ? 0 : 1;
    if (ia !== ib) return ia - ib;
    return ra.localeCompare(rb);
  });

  return { files, truncated, skipped: [...new Set(skipped)].slice(0, 20) };
}

/**
 * @param {string} dir
 * @param {string} root
 * @param {number} depth
 * @param {AbortSignal | undefined} signal
 * @param {string[]} skipped
 */
async function walk(dir, root, depth, signal, skipped) {
  if (signal?.aborted) throw new Error('aborted');
  if (depth > MAX_DEPTH) return [];
  /** @type {string[]} */
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    skipped.push(relativeToRoot(root, dir) || '.');
    return out;
  }
  for (const entry of entries) {
    if (signal?.aborted) throw new Error('aborted');
    if (entry.name === '.' || entry.name === '..') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) continue;
      out.push(...(await walk(full, root, depth + 1, signal, skipped)));
      continue;
    }
    if (!entry.isFile() || !isHtmlFile(entry.name)) continue;
    try {
      await resolveUnderRoot(root, full);
    } catch {
      continue;
    }
    out.push(full);
  }
  return out;
}

/**
 * @param {string} root
 * @param {string} filePath
 */
export async function readHtmlFile(root, filePath) {
  const real = await resolveUnderRoot(root, filePath);
  const info = await stat(real);
  if (!info.isFile()) throw new Error('not_file');
  if (info.size > MAX_BYTES) {
    return { path: real, relative: relativeToRoot(root, real), html: '', skipped: 'too_large', bytes: info.size };
  }
  const html = await readFile(real, 'utf8');
  return { path: real, relative: relativeToRoot(root, real), html, skipped: '', bytes: info.size };
}
