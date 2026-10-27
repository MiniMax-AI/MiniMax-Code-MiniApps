// @ts-check
// MiniMax Pet — bundled + imported pet catalog, import, delete, normalization.

import { randomBytes } from 'node:crypto';
import { lstat, mkdir, open, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';

import { HEADER_BYTES, atlasVersionFromSize, readImageHeader } from './image-header.mjs';

export const PET_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const SPRITE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.(webp|png)$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const DISPLAY_NAME_MAX = 80;
const DESCRIPTION_MAX = 300;
const STAGING_DIR = '.staging';
const REPLACEMENT_NAME_PATTERN = /^replace-([a-z0-9][a-z0-9._-]{0,79})-\d+-[a-f0-9]{12}$/;
const DISPOSABLE_STAGE_PATTERN = /^(import|delete)-\d+-[a-f0-9]{12}$/;

export class PetError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message
   */
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {string} s */
function charLength(s) {
  return [...s].length;
}

/**
 * @typedef {{ id: string, displayName: string, description: string, spritesheetPath: string, version: 1 | 2 }} NormalizedPet
 * @typedef {{ id: string, displayName: string, description: string, version: 1 | 2, source: 'bundled' | 'imported', petJsonUrl: string }} PetSummary
 */

/**
 * Validates pet.json shape (not the image). Throws PetError.
 * @param {unknown} raw
 * @returns {NormalizedPet}
 */
export function normalizePetJson(raw) {
  if (!isPlainObject(raw)) throw new PetError(400, 'invalid_pet_json', 'pet.json must be an object');
  const { id, displayName, description, spritesheetPath, spriteVersionNumber } = raw;
  if (typeof id !== 'string' || !PET_ID_PATTERN.test(id)) {
    throw new PetError(400, 'invalid_id', 'id must match ^[a-z0-9][a-z0-9._-]{0,79}$');
  }
  if (typeof displayName !== 'string') {
    throw new PetError(400, 'invalid_pet_json', 'displayName must be a string');
  }
  const name = displayName.trim();
  if (charLength(name) < 1 || charLength(name) > DISPLAY_NAME_MAX) {
    throw new PetError(400, 'invalid_pet_json', `displayName must be 1-${DISPLAY_NAME_MAX} characters`);
  }
  if (description !== undefined && typeof description !== 'string') {
    throw new PetError(400, 'invalid_pet_json', 'description must be a string');
  }
  const desc = (description ?? '').trim();
  if (charLength(desc) > DESCRIPTION_MAX) {
    throw new PetError(400, 'invalid_pet_json', `description must be at most ${DESCRIPTION_MAX} characters`);
  }
  if (spriteVersionNumber !== undefined && spriteVersionNumber !== 1 && spriteVersionNumber !== 2) {
    throw new PetError(400, 'invalid_pet_json', 'spriteVersionNumber must be 1 or 2 when present');
  }
  if (typeof spritesheetPath !== 'string') {
    throw new PetError(400, 'invalid_pet_json', 'spritesheetPath must be a string');
  }
  if (!SPRITE_NAME_PATTERN.test(spritesheetPath)) {
    throw new PetError(
      400,
      'invalid_sprite_name',
      'spritesheetPath must be a plain *.webp or *.png file name without directories',
    );
  }
  return {
    id,
    displayName: name,
    description: desc,
    spritesheetPath,
    version: spriteVersionNumber === 2 ? 2 : 1,
  };
}

/** @param {NormalizedPet} pet */
function toStoredJson(pet) {
  /** @type {Record<string, unknown>} */
  const out = {
    id: pet.id,
    displayName: pet.displayName,
    description: pet.description,
    spritesheetPath: pet.spritesheetPath,
  };
  if (pet.version === 2) out.spriteVersionNumber = 2;
  return out;
}

/**
 * Validates decoded image header against the pet's extension and declared version. Throws PetError.
 * @param {Buffer} header
 * @param {NormalizedPet} pet
 */
function checkSprite(header, pet) {
  const info = readImageHeader(header);
  if (!info) throw new PetError(400, 'sprite_format_invalid', 'spritesheet is not a PNG or WebP image');
  const ext = pet.spritesheetPath.slice(pet.spritesheetPath.lastIndexOf('.') + 1);
  if (info.format !== ext) {
    throw new PetError(400, 'sprite_format_invalid', `spritesheet content is ${info.format}, extension is .${ext}`);
  }
  const version = atlasVersionFromSize(info.width, info.height);
  if (version === null) {
    throw new PetError(
      400,
      'sprite_size_invalid',
      `spritesheet is ${info.width}x${info.height}; expected 1536x1872 (v1) or 1536x2288 (v2)`,
    );
  }
  if (version !== pet.version) {
    throw new PetError(
      400,
      'sprite_version_mismatch',
      `spritesheet size matches v${version} but pet.json declares v${pet.version}`,
    );
  }
}

/** @param {string} value */
function decodeBase64Strict(value) {
  if (value.length === 0 || value.length % 4 !== 0 || !BASE64_PATTERN.test(value)) {
    throw new PetError(400, 'sprite_format_invalid', 'spritesheet.base64 is not valid base64');
  }
  const buf = Buffer.from(value, 'base64');
  if (buf.toString('base64') !== value) {
    throw new PetError(400, 'sprite_format_invalid', 'spritesheet.base64 is not canonical base64');
  }
  return buf;
}

/** @param {string} path */
async function readHeaderBytes(path) {
  const handle = await open(path, 'r');
  try {
    const buf = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(buf, 0, HEADER_BYTES, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** @param {unknown} error */
function errnoCode(error) {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown';
}

/**
 * Reads and fully validates a pet directory (pet.json + sprite header). Throws PetError or fs errors.
 * @param {string} dir
 * @param {string} expectedId
 * @returns {Promise<NormalizedPet>}
 */
async function loadPetDir(dir, expectedId) {
  const petJsonPath = join(dir, 'pet.json');
  const st = await lstat(petJsonPath);
  if (!st.isFile()) throw new PetError(500, 'pet_json_unreadable', 'pet.json is not a regular file');
  let raw;
  try {
    raw = JSON.parse(await readFile(petJsonPath, 'utf8'));
  } catch {
    throw new PetError(500, 'invalid_pet_json', 'pet.json is not valid JSON');
  }
  const pet = normalizePetJson(raw);
  if (pet.id !== expectedId) throw new PetError(500, 'invalid_id', 'pet.json id does not match directory');
  const spritePath = join(dir, pet.spritesheetPath);
  const spriteStat = await lstat(spritePath);
  if (!spriteStat.isFile()) throw new PetError(500, 'sprite_unreadable', 'spritesheet is not a regular file');
  checkSprite(await readHeaderBytes(spritePath), pet);
  return pet;
}

/** @param {string} child @param {string} parent */
function isInside(child, parent) {
  return child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/** @param {string} name */
function contentTypeForPetFile(name) {
  if (name.endsWith('.json')) return 'application/json; charset=utf-8';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.png')) return 'image/png';
  return null;
}

/**
 * @typedef {{ debug(m: string, f?: object): void, info(m: string, f?: object): void, warn(m: string, f?: object): void, error(m: string, f?: object): void }} Logger
 * @param {{ clientRoot: string, dataDir: string, logger: Logger }} options
 */
export function createPetStore({ clientRoot, dataDir, logger }) {
  const bundledRoot = join(clientRoot, 'pets');
  const petsDir = join(dataDir, 'pets');
  const stagingRoot = join(dataDir, STAGING_DIR);

  /** @type {{ pets: PetSummary[], ids: Set<string> } | null} */
  let bundledCache = null;
  /** @type {Promise<unknown>} */
  let queueTail = Promise.resolve();

  /**
   * @template T
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  function enqueue(task) {
    const run = queueTail.then(task, task);
    queueTail = run.catch(() => {});
    return run;
  }

  async function getBundled() {
    if (bundledCache) return bundledCache;
    const entries = await readdir(bundledRoot, { withFileTypes: true });
    /** @type {PetSummary[]} */
    const pets = [];
    const ids = new Set();
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      ids.add(entry.name);
      if (!PET_ID_PATTERN.test(entry.name)) {
        logger.warn('pet.catalog.bundled_invalid', { reason: 'invalid_id' });
        continue;
      }
      try {
        const pet = await loadPetDir(join(bundledRoot, entry.name), entry.name);
        pets.push(toSummary(pet, 'bundled'));
      } catch (error) {
        logger.warn('pet.catalog.bundled_invalid', {
          reason: error instanceof PetError ? error.code : errnoCode(error),
        });
      }
    }
    pets.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    bundledCache = { pets, ids };
    return bundledCache;
  }

  /**
   * @param {NormalizedPet} pet
   * @param {'bundled' | 'imported'} source
   * @returns {PetSummary}
   */
  function toSummary(pet, source) {
    return {
      id: pet.id,
      displayName: pet.displayName,
      description: pet.description,
      version: pet.version,
      source,
      petJsonUrl: source === 'bundled' ? `/assets/pets/${pet.id}/pet.json` : `/imported/${pet.id}/pet.json`,
    };
  }

  async function listImported() {
    let entries;
    try {
      entries = await readdir(petsDir, { withFileTypes: true });
    } catch (error) {
      if (errnoCode(error) === 'ENOENT') return [];
      throw error;
    }
    /** @type {PetSummary[]} */
    const pets = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !PET_ID_PATTERN.test(entry.name)) continue;
      try {
        pets.push(toSummary(await loadPetDir(join(petsDir, entry.name), entry.name), 'imported'));
      } catch (error) {
        logger.warn('pet.catalog.imported_invalid', {
          reason: error instanceof PetError ? error.code : errnoCode(error),
        });
      }
    }
    pets.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return pets;
  }

  /** @returns {Promise<PetSummary[]>} */
  async function listPets() {
    return enqueue(async () => {
      await recoverStaging();
      let bundled = [];
      try {
        bundled = (await getBundled()).pets;
      } catch (error) {
        logger.error('pet.catalog.bundled_unreadable', { errno: errnoCode(error) });
      }
      return [...bundled, ...(await listImported())];
    });
  }

  /**
   * Resolves an allowed imported pet file; returns null when not allowed / not found.
   * @param {string} id
   * @param {string} file
   */
  async function resolveImportedFile(id, file) {
    if (!PET_ID_PATTERN.test(id)) return null;
    return enqueue(async () => {
      await recoverStaging();
      return resolveImportedFileNow(id, file);
    });
  }

  /** @param {string} id @param {string} file */
  async function resolveImportedFileNow(id, file) {
    const dir = join(petsDir, id);
    let pet;
    try {
      pet = await loadPetDir(dir, id);
    } catch {
      return null;
    }
    if (file !== 'pet.json' && file !== pet.spritesheetPath) return null;
    const contentType = contentTypeForPetFile(file);
    if (!contentType) return null;
    const path = join(dir, file);
    try {
      const st = await lstat(path);
      if (!st.isFile()) return null;
      const [realFile, realPets] = await Promise.all([realpath(path), realpath(petsDir)]);
      if (!isInside(realFile, realPets)) return null;
      return { path: realFile, contentType };
    } catch {
      return null;
    }
  }

  /** @param {string} dir */
  async function requireDirectory(dir) {
    if (!(await lstat(dir)).isDirectory()) {
      throw new PetError(500, 'pet_storage_unreadable', 'pet storage must use regular directories');
    }
  }

  // A replacement backup's name records its destination before the atomic move.
  // Unlike delete-* and import-*, it must never be swept before recovery succeeds.
  // Run under the same queue as reads/writes so an active replacement is not recovered early.
  async function recoverStaging() {
    let entries;
    try {
      await requireDirectory(stagingRoot);
      entries = await readdir(stagingRoot, { withFileTypes: true });
    } catch (error) {
      if (errnoCode(error) === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const stagedPath = join(stagingRoot, entry.name);
      const replacement = REPLACEMENT_NAME_PATTERN.exec(entry.name);
      if (replacement) {
        if (!entry.isDirectory()) {
          throw new PetError(500, 'pet_recovery_failed', 'replacement backup must be a regular directory');
        }
        const id = replacement[1];
        const finalDir = join(petsDir, id);
        await mkdir(petsDir, { recursive: true });
        await requireDirectory(petsDir);
        const finalExists = await lstat(finalDir).then(
          () => true,
          (error) => {
            if (errnoCode(error) === 'ENOENT') return false;
            throw error;
          },
        );
        if (finalExists) {
          await requireDirectory(finalDir);
          await loadPetDir(finalDir, id);
          await rm(stagedPath, { recursive: true, force: true });
        } else {
          await loadPetDir(stagedPath, id);
          await rename(stagedPath, finalDir);
          logger.info('pet.import.recovered');
        }
      } else if (DISPOSABLE_STAGE_PATTERN.test(entry.name)) {
        await rm(stagedPath, { recursive: true, force: true });
      } else {
        // Old trash-* could mean an interrupted replacement OR an intentional delete.
        // Preserve it rather than guessing and either losing data or resurrecting a pet.
        logger.warn('pet.staging.unrecognized_preserved');
      }
    }
  }

  function stagingName(prefix) {
    return join(stagingRoot, `${prefix}-${Date.now()}-${randomBytes(6).toString('hex')}`);
  }

  /**
   * @param {unknown} body parsed JSON request body
   * @returns {Promise<PetSummary>}
   */
  async function importPet(body) {
    if (!isPlainObject(body)) throw new PetError(400, 'invalid_json', 'request body must be a JSON object');
    const pet = normalizePetJson(body.petJson);
    const { spritesheet, replace } = body;
    if (
      !isPlainObject(spritesheet) ||
      typeof spritesheet.fileName !== 'string' ||
      typeof spritesheet.base64 !== 'string'
    ) {
      throw new PetError(400, 'invalid_json', 'spritesheet must be { fileName: string, base64: string }');
    }
    if (replace !== undefined && typeof replace !== 'boolean') {
      throw new PetError(400, 'invalid_json', 'replace must be a boolean');
    }
    if (spritesheet.fileName !== pet.spritesheetPath) {
      throw new PetError(400, 'invalid_sprite_name', 'spritesheet.fileName must equal petJson.spritesheetPath');
    }
    const sprite = decodeBase64Strict(spritesheet.base64);
    checkSprite(sprite, pet);

    return enqueue(async () => {
      await recoverStaging();
      const bundled = await getBundled();
      if (bundled.ids.has(pet.id)) {
        throw new PetError(409, 'bundled_conflict', 'a bundled pet already uses this id');
      }
      const finalDir = join(petsDir, pet.id);
      const exists = await lstat(finalDir).then(
        () => true,
        (error) => {
          if (errnoCode(error) === 'ENOENT') return false;
          throw error;
        },
      );
      if (exists && replace !== true) {
        throw new PetError(409, 'pet_exists', 'an imported pet with this id exists; set replace to overwrite');
      }

      await mkdir(stagingRoot, { recursive: true });
      await requireDirectory(stagingRoot);
      const stage = stagingName('import');
      try {
        await mkdir(stage);
        await writeFile(join(stage, 'pet.json'), `${JSON.stringify(toStoredJson(pet), null, 2)}\n`);
        await writeFile(join(stage, pet.spritesheetPath), sprite);
        await mkdir(petsDir, { recursive: true });
        await requireDirectory(petsDir);
        if (exists) {
          const backup = stagingName(`replace-${pet.id}`);
          await rename(finalDir, backup);
          try {
            await rename(stage, finalDir);
          } catch (error) {
            // If rollback also fails, leave the named backup for the next recovery.
            await rename(backup, finalDir);
            throw error;
          }
          await rm(backup, { recursive: true, force: true });
        } else {
          await rename(stage, finalDir);
        }
      } finally {
        await rm(stage, { recursive: true, force: true }).catch(() => {});
      }
      logger.info('pet.import.completed', { version: pet.version, replaced: exists });
      return toSummary(pet, 'imported');
    });
  }

  /** @param {string} id */
  async function deletePet(id) {
    if (!PET_ID_PATTERN.test(id)) throw new PetError(400, 'invalid_id', 'invalid pet id');
    return enqueue(async () => {
      await recoverStaging();
      const bundled = await getBundled();
      if (bundled.ids.has(id)) throw new PetError(403, 'bundled_read_only', 'bundled pets cannot be deleted');
      const dir = join(petsDir, id);
      try {
        const st = await lstat(dir);
        if (!st.isDirectory()) throw new PetError(404, 'pet_not_found', 'pet not found');
      } catch (error) {
        if (error instanceof PetError) throw error;
        if (errnoCode(error) === 'ENOENT') throw new PetError(404, 'pet_not_found', 'pet not found');
        throw error;
      }
      await mkdir(stagingRoot, { recursive: true });
      await requireDirectory(stagingRoot);
      const trash = stagingName('delete');
      await rename(dir, trash);
      await rm(trash, { recursive: true, force: true });
      logger.info('pet.delete.completed');
    });
  }

  return { listPets, resolveImportedFile, importPet, deletePet };
}
