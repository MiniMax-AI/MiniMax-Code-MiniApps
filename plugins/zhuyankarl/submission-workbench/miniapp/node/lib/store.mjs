// @ts-check
/**
 * Durable state for the Mini App: the working draft, uploaded assets and the
 * generated listing packages. Everything lives under the Host-owned dataDir and
 * is written atomically so a reclaimed process never leaves a half-written file.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   role: 'icon' | 'screenshot' | 'skill' | 'mcp' | 'app' | 'doc',
 *   size: number,
 *   mime: string,
 *   createdAt: string,
 * }} Asset
 */

/**
 * @typedef {{
 *   id: string,
 *   fileName: string,
 *   createdAt: string,
 *   size: number,
 *   sha256: string,
 *   entries: { path: string, size: number }[],
 *   manifest: Record<string, unknown> | null,
 * }} PackageRecord
 */

/**
 * Every id in this store is produced by `randomUUID()`, so a legitimate id is a
 * canonical v4 UUID. Anything else never reaches the filesystem.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Raised when a caller-supplied id is not a server-generated id, or when the
 * path it would produce leaves the directory it belongs to.
 */
export class InvalidIdError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'InvalidIdError';
  }
}

/**
 * Resolve `<id><suffix>` inside `directory`, or refuse.
 *
 * Two independent checks: the id must look like a server-generated UUID, and
 * the resolved path must still sit inside `directory`. The first one keeps
 * separators out of the path at all; the second one is the check that actually
 * closes the hole, so it stays even if the id format ever changes.
 *
 * @param {string} directory
 * @param {string} id
 * @param {string} suffix
 * @returns {string}
 */
function resolveInside(directory, id, suffix) {
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
    throw new InvalidIdError('id 不是服务端生成的 UUID。');
  }
  const base = resolve(directory);
  const target = resolve(base, `${id}${suffix}`);
  const inside = relative(base, target);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
    throw new InvalidIdError('id 指向了目录之外。');
  }
  return target;
}

/**
 * @param {string} file
 * @param {string | Buffer} content
 */
async function writeAtomic(file, content) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, content);
  await rename(temporary, file);
}

export class Store {
  /** @param {string} dataDir */
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.draftFile = join(dataDir, 'draft.json');
    this.assetsDir = join(dataDir, 'assets');
    this.packagesDir = join(dataDir, 'packages');
  }

  async init() {
    await mkdir(this.dataDir, { recursive: true });
    await mkdir(this.assetsDir, { recursive: true });
    await mkdir(this.packagesDir, { recursive: true });
  }

  /**
   * @template T
   * @param {string} file
   * @param {T} fallback
   * @returns {Promise<T>}
   */
  async readJson(file, fallback) {
    try {
      const raw = await readFile(file, 'utf8');
      return JSON.parse(raw);
    } catch (error) {
      const code = /** @type {NodeJS.ErrnoException} */ (error).code;
      if (code === 'ENOENT') return fallback;
      throw error;
    }
  }

  /**
   * @param {unknown} draft
   */
  async saveDraft(draft) {
    await writeAtomic(this.draftFile, JSON.stringify(draft, null, 2));
  }

  /** @returns {Promise<unknown>} */
  async loadDraft() {
    return this.readJson(this.draftFile, null);
  }

  /**
   * @param {Asset} asset
   * @param {Buffer} bytes
   */
  async saveAsset(asset, bytes) {
    await writeAtomic(resolveInside(this.assetsDir, asset.id, '.bin'), bytes);
    const list = await this.listAssets();
    const next = list.filter((item) => item.id !== asset.id);
    next.push(asset);
    await writeAtomic(join(this.assetsDir, 'index.json'), JSON.stringify(next, null, 2));
    return asset;
  }

  /** @returns {Promise<Asset[]>} */
  async listAssets() {
    return this.readJson(join(this.assetsDir, 'index.json'), []);
  }

  /**
   * @param {string} id
   * @returns {Promise<Buffer | null>}
   */
  async readAssetBytes(id) {
    try {
      return await readFile(resolveInside(this.assetsDir, id, '.bin'));
    } catch (error) {
      const code = /** @type {NodeJS.ErrnoException} */ (error).code;
      if (code === 'ENOENT') return null;
      throw error;
    }
  }

  /** @param {string} id */
  async deleteAsset(id) {
    const file = resolveInside(this.assetsDir, id, '.bin');
    const list = await this.listAssets();
    const next = list.filter((item) => item.id !== id);
    await writeAtomic(join(this.assetsDir, 'index.json'), JSON.stringify(next, null, 2));
    await rm(file, { force: true });
  }

  /**
   * @param {PackageRecord} record
   * @param {Buffer} bytes
   */
  async savePackage(record, bytes) {
    await writeAtomic(resolveInside(this.packagesDir, record.id, '.zip'), bytes);
    const list = await this.listPackages();
    const next = list.filter((item) => item.id !== record.id);
    next.unshift(record);
    await writeAtomic(join(this.packagesDir, 'index.json'), JSON.stringify(next, null, 2));
    return record;
  }

  /** @returns {Promise<PackageRecord[]>} */
  async listPackages() {
    return this.readJson(join(this.packagesDir, 'index.json'), []);
  }

  /**
   * @param {string} id
   * @returns {Promise<Buffer | null>}
   */
  async readPackageBytes(id) {
    try {
      return await readFile(resolveInside(this.packagesDir, id, '.zip'));
    } catch (error) {
      const code = /** @type {NodeJS.ErrnoException} */ (error).code;
      if (code === 'ENOENT') return null;
      throw error;
    }
  }

  /** @param {string} id */
  async deletePackage(id) {
    const file = resolveInside(this.packagesDir, id, '.zip');
    const list = await this.listPackages();
    await writeAtomic(
      join(this.packagesDir, 'index.json'),
      JSON.stringify(list.filter((item) => item.id !== id), null, 2),
    );
    await rm(file, { force: true });
  }
}

/**
 * @param {Buffer} bytes
 * @returns {string}
 */
export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * @param {string} directory
 * @returns {Promise<number>}
 */
export async function directorySize(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(full);
    } else {
      const info = await stat(full);
      total += info.size;
    }
  }
  return total;
}
