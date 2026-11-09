// @ts-check

import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { normalizeRegion, parseConfigFile } from './config.mjs';

/**
 * OAuth credentials written by the panel's device-code login belong to this
 * package, not to the user's CLI configuration. The file lives under
 * context.dataDir and only ever holds the `oauth` object and its region.
 */
const FILE_NAME = 'credentials.json';

/** @type {Map<string, Promise<void>>} */
const writeQueues = new Map();

/** @param {string} dataDir */
export function credentialsPath(dataDir) {
  return join(dataDir, FILE_NAME);
}

/** @param {string} path @param {() => Promise<void>} task */
async function withLock(path, task) {
  const previous = writeQueues.get(path) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  const settled = next.catch(() => {});
  writeQueues.set(path, settled);
  try {
    return await next;
  } finally {
    if (writeQueues.get(path) === settled) writeQueues.delete(path);
  }
}

/**
 * Read the credential file this package owns. A missing file is not an error:
 * it means the panel login has not run yet.
 * @param {string} dataDir
 * @returns {Promise<{ ok: true, oauth: Record<string, unknown> | null, region: 'cn' | 'global' | null } | { ok: false, code: string }>}
 */
export async function readCredentials(dataDir) {
  let text;
  try {
    text = await readFile(credentialsPath(dataDir), 'utf8');
  } catch (error) {
    if (/** @type {any} */ (error)?.code === 'ENOENT') return { ok: true, oauth: null, region: null };
    return { ok: false, code: 'config_unreadable' };
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, code: 'config_invalid' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, code: 'config_invalid' };
  const parsed = parseConfigFile(raw);
  const oauth = parsed.oauth ? /** @type {Record<string, unknown>} */ (parsed.oauth) : null;
  return {
    ok: true,
    oauth,
    region: normalizeRegion(raw.region) ?? normalizeRegion(oauth?.region),
  };
}

/**
 * Write OAuth credentials into this package's data directory. Only the
 * credential file changes; no CLI or Host file is touched.
 * @param {string} dataDir
 * @param {Record<string, unknown>} oauth
 */
export async function saveCredentials(dataDir, oauth) {
  if (typeof oauth?.access_token !== 'string' || !oauth.access_token) throw new Error('credentials');
  const path = credentialsPath(dataDir);
  return withLock(path, async () => {
    const region = normalizeRegion(oauth.region);
    const payload = { oauth: region ? { ...oauth, region } : oauth, region };
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await chmod(tmp, 0o600);
      await rename(tmp, path);
    } catch (error) {
      await unlink(tmp).catch(() => {});
      throw error;
    }
  });
}
