// Every path the scanner opens is resolved and kept under the root the user
// chose. The Host data directory and filesystem roots are refused.

import { homedir } from 'node:os';
import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';

export class PathError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'PathError';
    this.code = code;
  }
}

const SKIP_DIRS = new Set([
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  '.cache',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  '.minimax',
  '.mavis',
]);

/**
 * @param {string} input
 * @param {{ home?: string, minimaxDataDir?: string }} [options]
 */
export async function assertProjectRoot(input, options = {}) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new PathError('path_required', 'Choose a project folder first.');
  if (raw.includes('\0')) throw new PathError('path_invalid', 'That path is not usable.');

  let resolved;
  try {
    resolved = await realpath(path.resolve(raw));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new PathError('path_missing', 'That folder does not exist.');
    }
    throw new PathError('path_invalid', 'That path could not be opened.');
  }

  const info = await stat(resolved);
  if (!info.isDirectory()) throw new PathError('path_not_directory', 'Point Site QA at a folder, not a file.');

  const home = await safeReal(options.home ?? homedir());
  if (home && samePath(resolved, home)) {
    throw new PathError('path_too_broad', 'The home folder is too broad. Open the site project folder instead.');
  }
  if (isFilesystemRoot(resolved)) {
    throw new PathError('path_too_broad', 'A drive root is too broad. Open the site project folder instead.');
  }

  const dataDir = options.minimaxDataDir ? await safeReal(options.minimaxDataDir) : await safeReal(path.join(home || '', '.minimax'));
  if (dataDir && (samePath(resolved, dataDir) || isInside(resolved, dataDir))) {
    throw new PathError('path_forbidden', 'Site QA does not scan MiniMax data directories. Pick the site project instead.');
  }

  return resolved;
}

/**
 * @param {string} root
 * @param {string} candidate
 */
export async function resolveUnderRoot(root, candidate) {
  const absolute = path.resolve(root, candidate);
  let real;
  try {
    real = await realpath(absolute);
  } catch {
    // The path may not exist yet for a planned write; still confine the string form.
    if (!isInside(absolute, root) && !samePath(absolute, root)) {
      throw new PathError('path_escape', 'That file is outside the project folder.');
    }
    return absolute;
  }
  if (!isInside(real, root) && !samePath(real, root)) {
    throw new PathError('path_escape', 'That file is outside the project folder.');
  }
  return real;
}

/** @param {string} name */
export function shouldSkipDir(name) {
  return SKIP_DIRS.has(name) || name.startsWith('.');
}

/** @param {string} filePath */
export function isHtmlFile(filePath) {
  return /\.html?$/i.test(filePath);
}

/** @param {string} root @param {string} filePath */
export function relativeToRoot(root, filePath) {
  const rel = path.relative(root, filePath);
  return rel.split(path.sep).join('/');
}

/** @param {string} a @param {string} b */
export function samePath(a, b) {
  return path.resolve(a) === path.resolve(b);
}

/** @param {string} child @param {string} parent */
export function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** @param {string} dir */
function isFilesystemRoot(dir) {
  const parsed = path.parse(dir);
  return samePath(dir, parsed.root);
}

/** @param {string} candidate */
async function safeReal(candidate) {
  if (!candidate) return '';
  try {
    return await realpath(candidate);
  } catch {
    return path.resolve(candidate);
  }
}
