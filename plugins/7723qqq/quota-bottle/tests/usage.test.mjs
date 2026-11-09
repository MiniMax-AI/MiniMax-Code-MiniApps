import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { dataRoot, monthWindow, readUsedTokens, usageDbPath } from '../miniapp/node/usage.mjs';
import { disposeTemp, tempDir } from './helpers.mjs';

async function makeDb(root, table = true) {
  const context = { dataDir: join(root, 'data') };
  const env = { MINIMAX_DATA_DIR: join(root, 'root') };
  await mkdir(join(root, 'root', 'v2', 'sqlite'), { recursive: true });
  await mkdir(context.dataDir, { recursive: true });
  const file = usageDbPath(env);
  const db = new DatabaseSync(file);
  if (table) {
    db.exec(`
      CREATE TABLE local_runtime_token_usage (
        ts INTEGER, input_tokens INTEGER, output_tokens INTEGER,
        cache_read_tokens INTEGER, cache_write_tokens INTEGER
      );
      INSERT INTO local_runtime_token_usage VALUES
        (100, 1, 2, 3, 4), (200, 10, 20, 30, 40), (400, 100, 100, 100, 100);
    `);
  } else {
    db.exec('CREATE TABLE other (a INTEGER);');
  }
  db.close();
  return { context, env };
}

test('dataRoot comes from explicit Host variables, never from dataDir', () => {
  assert.equal(dataRoot({ MINIMAX_DATA_DIR: join('G:', 'mimimaxcode', 'instance') }), join('G:', 'mimimaxcode', 'instance'));
  assert.equal(dataRoot({ MAVIS_HOME: join('G:', 'mavis') }), join('G:', 'mavis'));
  assert.equal(dataRoot({}), join(homedir(), '.minimax'));
});

test('monthWindow uses a half-open local calendar month', () => {
  const window = monthWindow(new Date(2026, 10, 7, 12));
  assert.equal(new Date(window.startMs).getMonth(), 10);
  assert.equal(new Date(window.endMs).getMonth(), 11);
  assert.equal(window.label, '2026-11');
});

test('readUsedTokens sums only rows inside the month window', async () => {
  const dir = await tempDir('quota-usage-');
  try {
    const { context, env } = await makeDb(dir);
    const result = await readUsedTokens({ startMs: 100, endMs: 300 }, context, env);
    assert.deepEqual(result, { ok: true, used: 110, rows: 2 });
  } finally {
    await disposeTemp(dir);
  }
});

test('readUsedTokens reports a missing table and a missing database', async () => {
  const dir = await tempDir('quota-usage-schema-');
  try {
    const noTable = await makeDb(dir, false);
    assert.deepEqual(await readUsedTokens({ startMs: 0, endMs: 999 }, noTable.context, noTable.env), { ok: false, code: 'db_schema' });
    const missing = {
      context: { dataDir: join(dir, 'missing-data') },
      env: { MINIMAX_DATA_DIR: join(dir, 'missing-root') },
    };
    assert.equal((await readUsedTokens({ startMs: 0, endMs: 999 }, missing.context, missing.env)).code, 'db_missing');
  } finally {
    await disposeTemp(dir);
  }
});
