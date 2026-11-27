// @ts-check

/**
 * Local file paths handed to a publish interface.
 *
 * An interface that uploads images is given paths on this machine, so every
 * path the app hands out has to be one the app wrote itself. Two sources are
 * not trusted for that:
 *
 *   - the state file, which the user can edit — an `assetId` of `../secret`
 *     must not turn into a path outside `assets/`;
 *   - the draft body, which can already carry `file:///...` lines pasted from
 *     somewhere else.
 *
 * An asset path is therefore built only from a plain id under `assets/` and
 * checked to resolve inside it, and an image reference found in the body is
 * only kept when it resolves inside the same directory.
 */

import { join } from 'node:path';

/** An id the app itself writes: `randomUUID()`, and nothing with a separator. */
const ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** The extensions the renderer writes. */
const ASSET_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/**
 * A path with `/` separators, `.` and `..` collapsed, a Windows drive letter
 * lowered, and a leading `/` kept for absolute POSIX paths.
 *
 * `..` that would climb above the start is kept as a segment, so a path that
 * tries to escape simply stops being inside any root.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizePath(value) {
  const raw = String(value ?? '').replace(/\\/g, '/');
  const segments = [];
  for (const segment of raw.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      const last = segments[segments.length - 1];
      if (segments.length && last !== '..') segments.pop();
      else segments.push('..');
      continue;
    }
    segments.push(segment);
  }
  if (segments.length && /^[A-Za-z]:$/.test(segments[0])) {
    segments[0] = segments[0].toLowerCase();
  }
  const joined = segments.join('/');
  return /^\//.test(raw) && joined ? `/${joined}` : joined;
}

/**
 * Whether `candidate` is a file inside `root` — not the directory itself and
 * not a sibling whose name merely starts with the same characters.
 *
 * @param {unknown} root
 * @param {unknown} candidate
 * @returns {boolean}
 */
export function isInside(root, candidate) {
  let base = normalizePath(root).replace(/\/+$/, '');
  let target = normalizePath(candidate);
  if (!base || !target) return false;
  if (target === base) return false;
  // A Windows path is case-insensitive; a POSIX path is not.
  if (/^[a-z]:\//.test(base)) {
    base = base.toLowerCase();
    target = target.toLowerCase();
  }
  return target.startsWith(`${base}/`);
}

/**
 * The local file of one rendered asset, or `''` when the record does not name
 * a file inside `assetsDir`.
 *
 * @param {string} assetsDir
 * @param {any} asset
 * @returns {string}
 */
export function assetFilePath(assetsDir, asset) {
  const id = String(asset?.assetId ?? '');
  const ext = String(asset?.ext ?? '.jpg').toLowerCase();
  if (!ASSET_ID.test(id)) return '';
  if (!ASSET_EXTENSIONS.has(ext)) return '';
  const path = join(assetsDir, `${id}${ext}`);
  return isInside(assetsDir, path) ? path : '';
}

/**
 * The local path of every rendered asset of one draft.
 *
 * An interface that uploads images takes file paths, not media ids, so the
 * app has to be able to say where the rendered file is on this machine.
 * Assets whose record does not name a file inside `assetsDir` are left out
 * and reported, so the caller can refuse instead of publishing a draft with
 * a silent hole in it.
 *
 * @param {string} assetsDir
 * @param {any} draft
 * @returns {{ cover: string, illustrations: Record<string, string>, rejected: string[] }}
 */
export function collectAssetPaths(assetsDir, draft) {
  const assets = draft?.assets || {};
  /** @type {Record<string, string>} */
  const illustrations = {};
  /** @type {string[]} */
  const rejected = [];

  for (const [slotId, asset] of Object.entries(assets.illustrations || {})) {
    if (!asset?.assetId) continue;
    const path = assetFilePath(assetsDir, asset);
    if (path) illustrations[slotId] = path;
    else rejected.push(slotId);
  }

  let cover = '';
  if (assets.cover?.assetId) {
    cover = assetFilePath(assetsDir, assets.cover);
    if (!cover) rejected.push('cover');
  }

  return { cover, illustrations, rejected };
}

/**
 * The local file an image reference names, or `''` when it names none.
 *
 * `file:///C:/x.png`, `C:\x.png`, `/x.png` and `\\host\share\x.png` all become
 * a path; `https:`, `data:` and anything relative stay `''`, because they are
 * not files this machine can hand to an interface.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function localImagePath(value) {
  let target = String(value ?? '').trim();
  if (!target) return '';
  if (/^<.*>$/.test(target)) target = target.slice(1, -1).trim();
  if (!target) return '';
  if (/^(https?|data|ftp|mailto|tel):/i.test(target)) return '';
  if (target.startsWith('//') && !target.startsWith('///')) {
    // A UNC path is a real file; a protocol-relative URL is not.
    if (!/^\/\/[^/]+\/[^/]+/.test(target)) return '';
  }
  if (/^file:/i.test(target)) {
    target = target.replace(/^file:(\/\/)?/i, '');
    // `file:///C:/x` keeps a leading slash that is not part of the path.
    if (/^\/[A-Za-z]:[\\/]/.test(target)) target = target.slice(1);
    if (!target) return '';
  }
  try {
    target = decodeURIComponent(target);
  } catch {
    // An undecodable escape leaves the reference unusable.
    return '';
  }
  const absolute =
    /^[A-Za-z]:[\\/]/.test(target) || target.startsWith('/') || /^\\\\/.test(target);
  if (!absolute) return '';
  return target;
}