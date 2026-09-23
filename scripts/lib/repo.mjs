import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { readText } from './fs.mjs';
import { readPackageName } from './package.mjs';
import { createReport } from './report.mjs';

const ROOT_READMES = ['README.md', 'README.zh-CN.md'];

export async function discoverPackages(rootDir) {
  const packages = [];
  for (const author of await listDirs(path.join(rootDir, 'plugins'))) {
    for (const id of await listDirs(path.join(rootDir, 'plugins', author))) {
      packages.push({ dir: path.join(rootDir, 'plugins', author, id), kind: 'plugin', label: `plugins/${author}/${id}` });
    }
  }
  for (const id of await listDirs(path.join(rootDir, 'examples'))) {
    packages.push({ dir: path.join(rootDir, 'examples', id), kind: 'example', label: `examples/${id}` });
  }
  return packages;
}

export async function validateRepository(rootDir, packages) {
  const report = createReport();
  const owners = new Map();
  for (const pkg of packages) {
    const name = await readPackageName(pkg.dir);
    if (name === undefined) continue;
    const owner = owners.get(name);
    if (owner !== undefined && owner !== pkg.label) {
      report.error('REPO_DUPLICATE_NAME', `plugin name "${name}" is used by both ${owner} and ${pkg.label}; plugin IDs must be unique across the repository`);
    } else {
      owners.set(name, pkg.label);
    }
  }
  const texts = await Promise.all(ROOT_READMES.map((file) => readText(path.join(rootDir, file))));
  for (const pkg of packages) {
    if (pkg.kind !== 'plugin') continue;
    ROOT_READMES.forEach((file, index) => {
      const text = texts[index];
      if (text !== undefined && !text.includes(`${pkg.label}/`)) {
        report.error('REPO_README_LINK_MISSING', `${file} has no link to ${pkg.label}/; add a row to its MiniApps table`, file);
      }
    });
  }
  return report.diagnostics;
}

async function listDirs(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
}
