// @ts-check

import { mkdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, parse } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Resolve the active Host data root. context.dataDir may live beneath that
 * root, so a bounded ancestor walk is preferred over guessing a home path.
 * @param {MiniAppContext} context
 * @param {NodeJS.ProcessEnv} [env]
 */
export function dataRoot(context, env = process.env) {
  const fromDataDir = findDataRoot(context.dataDir);
  if (fromDataDir) return fromDataDir;
  const explicit = env.MINIMAX_DATA_DIR?.trim();
  if (explicit) return explicit;
  const mavis = env.MAVIS_HOME?.trim();
  if (mavis) return mavis;
  return join(homedir(), '.minimax');
}

/** @param {MiniAppContext} context @param {NodeJS.ProcessEnv} [env] */
export function usageDbPath(context, env) {
  return join(dataRoot(context, env), 'v2', 'sqlite', 'runtime-state.sqlite');
}

/** @param {string} dataDir */
function findDataRoot(dataDir) {
  if (!dataDir) return null;
  let dir = dataDir;
  for (let i = 0; i < 12; i += 1) {
    if (parse(dir).root === dir) break;
    if (basename(dir) === 'v2') return dirname(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function basename(value) {
  return value.split(/[\\/]/).pop() ?? '';
}

/** @param {Date} [now] */
export function monthWindow(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
  return {
    startMs: start.getTime(),
    endMs: end.getTime(),
    label: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
  };
}

/**
 * Sum the runtime's token counters inside the local calendar month. The
 * database is copied into a fresh snapshot node:sqlite can open read-only,
 * including any WAL side files; the plugin never writes to the Host database.
 * @param {{ startMs: number, endMs: number }} window
 * @param {MiniAppContext} context
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ sqlite?: any, now?: () => number }} [deps]
 */
export async function readUsedTokens({ startMs, endMs }, context, env = process.env, deps = {}) {
  const file = usageDbPath(context, env);
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return { ok: false, code: 'db_missing' };

  let sqlite = deps.sqlite;
  if (!sqlite) {
    try {
      sqlite = await import('node:sqlite');
    } catch {
      return { ok: false, code: 'sqlite_unavailable' };
    }
  }

  const stamp = (deps.now ?? Date.now)();
  const tempDir = join(context.dataDir, `.usage-${stamp}-${randomUUID()}`);
  await mkdir(tempDir, { recursive: true, mode: 0o700 });
  const snapshot = join(tempDir, 'snapshot.sqlite');
  /** @type {any} */
  let source;
  /** @type {any} */
  let db;
  try {
    source = new sqlite.DatabaseSync(file, { readOnly: true });
    source.prepare('VACUUM INTO ?').run(snapshot);
    source.close();
    source = null;
    db = new sqlite.DatabaseSync(snapshot, { readOnly: true });
    const schema = db.prepare(`
      SELECT 1 FROM sqlite_master
      WHERE type = 'table' AND name = 'local_runtime_token_usage'
    `).get();
    if (!schema) return { ok: false, code: 'db_schema' };
    const columns = new Set(db.prepare('PRAGMA table_info(local_runtime_token_usage)').all().map((row) => String(row.name)));
    for (const required of ['ts', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens']) {
      if (!columns.has(required)) return { ok: false, code: 'db_schema' };
    }
    const row = db.prepare(`
      SELECT
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
        COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
        COUNT(*) AS rows
      FROM local_runtime_token_usage
      WHERE ts >= ? AND ts < ?
    `).get(startMs, endMs);
    const used = ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens']
      .reduce((sum, key) => sum + Number(row[key] ?? 0), 0);
    if (!Number.isFinite(used) || used < 0) return { ok: false, code: 'db_query_failed' };
    return { ok: true, used, rows: Number(row.rows) };
  } catch {
    return { ok: false, code: 'db_unreadable' };
  } finally {
    try { source?.close(); } catch {}
    try { db?.close(); } catch {}
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */
