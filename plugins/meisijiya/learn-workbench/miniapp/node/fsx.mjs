import { mkdir, readFile, rename, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { WORKBENCH_DIR } from './policy.mjs';

/** Read JSON; `fallback` on missing or (unless strict) unparsable files. */
export async function readJson(file, fallback, { strict = false } = {}) {
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return fallback;
    throw error;
  }
  if (!raw.trim()) return fallback;
  try {
    return JSON.parse(raw);
  } catch (error) {
    if (strict) throw new Error(`invalid_json:${path.basename(file)}`);
    return fallback;
  }
}

/** Read JSON and report parse failure without throwing. */
export async function readJsonChecked(file, fallback) {
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return { value: fallback, missing: true, error: null };
    return { value: fallback, missing: false, error: 'read_failed' };
  }
  if (!raw.trim()) return { value: fallback, missing: false, error: null };
  try {
    return { value: JSON.parse(raw), missing: false, error: null };
  } catch {
    return { value: fallback, missing: false, error: 'invalid_json' };
  }
}

export async function readText(file, fallback = '') {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return fallback;
    throw error;
  }
}

export async function writeText(file, text) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text, 'utf8');
}

/** Atomic JSON write: temp file in the same directory, then rename over the target. */
export async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
}

/** Write a text file only when it does not exist yet. */
export async function writeTextOnce(file, text) {
  if (existsSync(file)) return false;
  await writeText(file, text);
  return true;
}

export function resolveInside(root, relative) {
  const clean = String(relative ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  const target = path.resolve(root, clean);
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    const error = new Error('path_outside_workspace');
    error.code = 'PATH_OUTSIDE';
    throw error;
  }
  return target;
}

export function isInside(root, candidate) {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function toPosix(value) {
  return String(value).replace(/\\/g, '/');
}

export async function listFiles(dir, { extensions = null, max = 400 } = {}) {
  const out = [];
  async function walk(current, prefix) {
    if (out.length >= max) return;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= max) return;
      if (entry.name.startsWith('.') && entry.name !== WORKBENCH_DIR) continue;
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        await walk(abs, `${prefix}${entry.name}/`);
        continue;
      }
      if (!entry.isFile()) continue;
      if (extensions && !extensions.includes(path.extname(entry.name).toLowerCase())) continue;
      out.push(`${prefix}${entry.name}`);
    }
  }
  await walk(dir, '');
  return out;
}

export async function fileMeta(root, relative) {
  try {
    const info = await stat(resolveInside(root, relative));
    if (!info.isFile()) return null;
    return { rel: toPosix(relative), size: info.size, mtime: info.mtimeMs };
  } catch {
    return null;
  }
}

export function platformRoots() {
  const roots = [];
  if (process.platform === 'win32') {
    for (let code = 65; code <= 90; code += 1) {
      const drive = `${String.fromCharCode(code)}:\\`;
      if (existsSync(drive)) roots.push(drive);
    }
  } else {
    roots.push('/');
  }
  return roots;
}

export function homeDir() {
  try {
    return os.homedir();
  } catch {
    return process.platform === 'win32' ? 'C:\\' : '/';
  }
}

export function parentOf(target) {
  const parent = path.dirname(path.resolve(target));
  if (parent === path.resolve(target)) return null;
  return parent;
}

export function slugify(value, fallback = 'study') {
  const stripped = String(value ?? '')
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 48);
  return stripped || fallback;
}
