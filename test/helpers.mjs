import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const EXAMPLE_DIR = path.join(REPO_ROOT, 'examples', 'hello-miniapp');

export async function makeTmpRoot() {
  return mkdtemp(path.join(tmpdir(), 'miniapps-check-'));
}

export async function copyExample(root, { author = 'tester', dirName = 'hello-miniapp' } = {}) {
  const dir = path.join(root, 'plugins', author, dirName);
  await cp(EXAMPLE_DIR, dir, { recursive: true });
  return { dir };
}

export async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

export async function editJson(file, mutate) {
  const value = await readJson(file);
  const next = mutate(value) ?? value;
  await writeJson(file, next);
}

export function codes(diagnostics, level) {
  return diagnostics.filter((d) => !level || d.level === level).map((d) => d.code);
}
