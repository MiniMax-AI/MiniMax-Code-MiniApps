import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_PREFERENCES, validatePreferences } from '../client/preferences.mjs';

export class PreferenceError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

export function createPreferenceStore({ dataDir, fs = { lstat, mkdir, open, readFile, rename, rm } }) {
  const target = join(dataDir, 'preferences.json');
  let pending = Promise.resolve();
  function serialize(operation) {
    const result = pending.then(operation);
    pending = result.catch(() => {});
    return result;
  }
  async function read() {
    try {
      if (!(await fs.lstat(target)).isFile()) throw new Error('not a regular file');
      const body = JSON.parse(await fs.readFile(target, 'utf8'));
      if (body.version !== 1) throw new Error('unknown version');
      return { preferences: validatePreferences(body.preferences), persisted: true };
    } catch (error) {
      if (error.code === 'ENOENT') return { preferences: { ...DEFAULT_PREFERENCES }, persisted: false };
      throw new PreferenceError(500, 'preferences_unreadable');
    }
  }
  async function write(raw, { onlyIfUnpersisted = false } = {}) {
    let patch;
    try { patch = validatePreferences(raw, { partial: true }); } catch { throw new PreferenceError(400, 'invalid_preferences'); }
    const current = await read();
    if (onlyIfUnpersisted && current.persisted) throw new PreferenceError(412, 'preferences_exists');
    const preferences = { ...current.preferences, ...patch };
    await fs.mkdir(dataDir, { recursive: true });
    const temporary = join(dataDir, `.preferences-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ version: 1, preferences }) + '\n');
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.rename(temporary, target);
      return { preferences, persisted: true };
    } catch { throw new PreferenceError(500, 'preferences_write_failed'); }
    finally { await handle?.close().catch(() => {}); await fs.rm(temporary, { force: true }).catch(() => {}); }
  }
  return { get: () => serialize(read), patch: (raw, options) => serialize(() => write(raw, options)) };
}
