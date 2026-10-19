import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Each browser workspace owns its own snapshots. Revisions reject stale writers.
export async function createRecoveryStore(dataDir) {
  const root = join(dataDir, 'recovery');
  await mkdir(root, { recursive: true });
  const locks = new Map();
  const path = id => {
    if (!/^(assistant|document)-[a-f0-9-]{36}$/.test(id)) throw Error('Invalid snapshot ID');
    return join(root, id + '.json');
  };
  async function get(id) {
    try { return JSON.parse(await readFile(path(id), 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return { revision: 0, value: null }; throw e; }
  }
  return {
    get,
    async list() {
      const values = [];
      for (const file of await readdir(root)) {
        if (!/^document-[a-f0-9-]{36}\.json$/.test(file)) continue;
        const id = file.slice(0, -5), record = await get(id);
        values.push({ id, revision: record.revision, name: record.value.name, updatedAt: record.updatedAt });
      }
      return values.sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async put(id, input) {
      path(id);
      const previous = locks.get(id) || Promise.resolve();
      const next = previous.catch(() => {}).then(async () => {
        const old = await get(id);
        if (!Number.isSafeInteger(input.revision) || input.revision !== old.revision)
          throw Object.assign(Error('Snapshot changed in another window'), { status: 409 });
        const v = input.value;
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('Invalid snapshot');
        if (id.startsWith('document-') && (typeof v.name !== 'string' || v.name.length > 300 ||
          typeof v.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(v.data))) throw Error('Invalid project');
        if (id.startsWith('assistant-') && (typeof v.draft !== 'string' || v.draft.length > 8000 ||
          typeof v.reply !== 'string' || v.reply.length > 60000)) throw Error('Invalid conversation');
        const record = { revision: old.revision + 1, updatedAt: Date.now(), value: v };
        const temp = path(id) + '.' + randomUUID() + '.tmp';
        await writeFile(temp, JSON.stringify(record));
        await rename(temp, path(id));
        return record;
      });
      locks.set(id, next);
      try { return await next; } finally { if (locks.get(id) === next) locks.delete(id); }
    },
  };
}
