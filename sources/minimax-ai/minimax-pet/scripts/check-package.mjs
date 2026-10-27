import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function inventory(directory, relative = '', files = new Map()) {
  for (const name of (await readdir(join(directory, relative))).sort()) {
    const path = relative ? `${relative}/${name}` : name;
    const stat = await lstat(join(directory, path));
    if (stat.isDirectory()) await inventory(directory, path, files);
    else if (stat.isFile()) {
      files.set(path, createHash('sha256').update(await readFile(join(directory, path))).digest('hex'));
    } else throw new Error(`Unsupported package entry (links are not allowed): ${path}`);
  }
  return files;
}

/** Compare every packaged file, including code, binary assets, metadata and licenses. */
export async function comparePackages(built, published) {
  const [expected, actual] = await Promise.all([inventory(built), inventory(published)]);
  const differences = [];
  for (const path of [...new Set([...expected.keys(), ...actual.keys()])].sort()) {
    if (!expected.has(path)) differences.push(`Unexpected published file: ${path}`);
    else if (!actual.has(path)) differences.push(`Missing published file: ${path}`);
    else if (expected.get(path) !== actual.get(path)) differences.push(`Content differs: ${path}`);
  }
  return { files: expected.size, differences };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const built = resolve(process.argv[2] ?? join(root, 'dist/package'));
  const published = resolve(process.argv[3] ?? join(root, '../../../plugins/minimax-ai/minimax-pet'));
  const result = await comparePackages(built, published);
  if (result.differences.length) {
    console.error(`Desktop pet package does not match a fresh source build:\n${result.differences.join('\n')}`);
    console.error('Rebuild/package sources/minimax-ai/minimax-pet and synchronize dist/package to plugins/minimax-ai/minimax-pet.');
    process.exitCode = 1;
  } else console.log(`Desktop pet package matches the source build: ${result.files} files, exact bytes, no exclusions.`);
}
