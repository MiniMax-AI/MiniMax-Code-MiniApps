// @ts-check

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Local usage is a read of MiniMax Code's own SQLite state, which depends on
 * an unpublished Host schema. It stays off until the user turns it on.
 */
export const DEFAULT_SETTINGS = Object.freeze({ usageScan: false });

/** @param {string} dataDir */
export function settingsPath(dataDir) {
  return join(dataDir, 'settings.json');
}

/** @param {unknown} raw */
export function normalizeSettings(raw) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? /** @type {Record<string, unknown>} */ (raw)
    : {};
  return { usageScan: value.usageScan === true };
}

/**
 * A missing or unreadable settings file means the safe default: no host read.
 * @param {string} dataDir
 */
export async function readSettings(dataDir) {
  try {
    return normalizeSettings(JSON.parse(await readFile(settingsPath(dataDir), 'utf8')));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** @param {string} dataDir @param {{ usageScan: boolean }} settings */
export async function writeSettings(dataDir, settings) {
  const normalized = normalizeSettings(settings);
  const file = settingsPath(dataDir);
  await mkdir(dataDir, { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(normalized)}\n`, 'utf8');
  await rename(tmp, file);
  return normalized;
}
