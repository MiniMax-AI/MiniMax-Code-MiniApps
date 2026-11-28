// Durable state helpers. Every write is atomic: temporary file in the same directory,
// then a rename over the target, so a forced shutdown never leaves a half written file.

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function ensureDir(directory) {
  await mkdir(directory, { recursive: true });
}

export async function writeJsonAtomic(file, value) {
  await ensureDir(dirname(file));
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
}

export async function readJson(file, fallback = null) {
  try {
    const raw = await readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function writeFileAtomic(file, data) {
  await ensureDir(dirname(file));
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, data);
  await rename(temporary, file);
}

export async function readFileBuffer(file) {
  return readFile(file);
}

export async function removeIfExists(target) {
  await rm(target, { recursive: true, force: true });
}
