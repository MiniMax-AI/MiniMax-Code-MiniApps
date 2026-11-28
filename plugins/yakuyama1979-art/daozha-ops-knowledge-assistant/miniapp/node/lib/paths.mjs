// Write-scope guard. AI code editing is confined to the directories the user allows.

import { realpath } from 'node:fs/promises';
import path from 'node:path';

/** Text formats the patch engine may rewrite. Binary assets are left untouched. */
export const EDITABLE_EXTENSIONS = [
  '.html', '.htm', '.css', '.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx',
  '.py', '.md', '.markdown', '.txt', '.json', '.yml', '.yaml', '.xml', '.sql',
  '.sh', '.ps1', '.bat', '.cmd', '.ini', '.conf', '.vue', '.php', '.java', '.go',
];

/**
 * The directories AI code editing may write to. The Mini App sets these from the
 * user's saved settings, so nothing is assumed about the machine it runs on.
 */
let writeRoots = [];

export function configureWriteRoots(roots) {
  writeRoots = (Array.isArray(roots) ? roots : [])
    .map((root) => String(root || '').trim())
    .filter(Boolean)
    .map((root) => path.resolve(root));
}

export function getWriteRoots() {
  return [...writeRoots];
}

export function normalizePath(target) {
  return path.resolve(String(target || '').trim());
}

export function isUnder(target, root) {
  const resolved = path.resolve(target).toLowerCase();
  const base = path.resolve(root).toLowerCase();
  const relative = path.relative(base, resolved);
  if (relative === '') return true;
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function findWriteRoot(target) {
  return writeRoots.find((root) => isUnder(target, root)) || null;
}

/**
 * Validates that a target file may be written.
 * @param {string} targetPath
 * @returns {Promise<{ path:string, root:string, extension:string }>}
 */
export async function assertWritable(targetPath) {
  const raw = String(targetPath || '').trim();
  if (!raw) throw new Error('target_path_required');
  if (!path.isAbsolute(raw)) throw new Error('target_path_must_be_absolute');
  if (!writeRoots.length) {
    throw new Error('write_roots_not_configured: 请先在「路由与设置」里填写允许写入的目录');
  }

  const resolved = normalizePath(raw);
  const root = findWriteRoot(resolved);
  if (!root) {
    throw new Error(`target_outside_allowed_roots: 只允许写入 ${writeRoots.join(' 与 ')}`);
  }

  const extension = path.extname(resolved).toLowerCase();
  if (!EDITABLE_EXTENSIONS.includes(extension)) {
    throw new Error(`target_extension_not_editable: ${extension || '无扩展名'}`);
  }

  // A symlink could point outside the approved roots; compare the real path too.
  const real = await realpath(resolved).catch(() => null);
  if (real) {
    const realRoot = findWriteRoot(real);
    if (!realRoot) throw new Error('target_outside_allowed_roots: 目标真实路径超出允许目录');
    return { path: real, root: realRoot, extension };
  }

  // The file does not exist yet: validate its parent directory instead.
  const parent = path.dirname(resolved);
  const realParent = await realpath(parent).catch(() => null);
  if (!realParent) throw new Error(`target_directory_unavailable:${path.basename(parent)}`);
  if (!findWriteRoot(realParent)) throw new Error('target_outside_allowed_roots: 目标目录超出允许范围');
  return { path: resolved, root, extension };
}

/** Reads a file that may live in the configured reference folders. */
export function isUnderAny(target, roots) {
  return (roots || []).some((root) => isUnder(target, root));
}
