import { readFile, stat } from 'node:fs/promises';

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
