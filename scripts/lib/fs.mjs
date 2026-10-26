import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const BOM = '\uFEFF';

export async function readJsonFile(absolutePath) {
  let text;
  try {
    text = await readFile(absolutePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return { ok: false, reason: 'missing', detail: 'file not found' };
    throw error;
  }
  if (text.startsWith(BOM)) {
    return { ok: false, reason: 'bom', detail: 'starts with a UTF-8 BOM; save the file without a BOM' };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, reason: 'parse', detail: `invalid JSON: ${error.message}` };
  }
}

export async function pathExists(absolutePath, kind) {
  try {
    const info = await stat(absolutePath);
    if (kind === 'file') return info.isFile();
    if (kind === 'directory') return info.isDirectory();
    return true;
  } catch {
    return false;
  }
}

export async function readText(absolutePath) {
  try {
    return await readFile(absolutePath, 'utf8');
  } catch {
    return undefined;
  }
}

export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Package-relative paths of the files under `roots` (directories or single files) whose
// extension is in `extensions`, skipping node_modules. Sorted and unique.
export async function collectPayloadFiles(packageDir, roots, extensions) {
  const files = new Set();
  for (const root of roots) {
    const absolute = path.join(packageDir, ...root.split('/'));
    if (await pathExists(absolute, 'directory')) {
      for (const file of await walk(absolute, root, extensions)) files.add(file);
    } else if (extensions.has(path.extname(root)) && (await pathExists(absolute, 'file'))) {
      files.add(root);
    }
  }
  return [...files].sort();
}

async function walk(absoluteDir, relativeDir, extensions) {
  const files = [];
  for (const dirent of await readdir(absoluteDir, { withFileTypes: true })) {
    const relativePath = `${relativeDir}/${dirent.name}`;
    if (dirent.isDirectory()) {
      if (dirent.name.toLowerCase() === 'node_modules') continue;
      files.push(...(await walk(path.join(absoluteDir, dirent.name), relativePath, extensions)));
    } else if (dirent.isFile() && extensions.has(path.extname(dirent.name))) {
      files.push(relativePath);
    }
  }
  return files;
}
