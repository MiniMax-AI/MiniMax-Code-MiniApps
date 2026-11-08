import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { start } from '../miniapp/node/server.mjs';
import { manualState } from '../miniapp/node/quota.mjs';
import { usageDbPath } from '../miniapp/node/usage.mjs';
import { disposeTemp, fakeContext, freePort, tempDir } from './helpers.mjs';

test('a total above the usage is a state of its own, not an empty balance', () => {
  const state = manualState(1000, 4289389);
  assert.equal(state.mode, 'manual');
  assert.equal(state.overBudget, true);
  assert.equal(state.overBy, 4288389);
  assert.equal(state.remaining, 0);
  assert.equal(state.percent, 0);
});

test('the manual state keeps a usable total honest', () => {
  const under = manualState(1000, 400);
  assert.equal(under.overBudget, false);
  assert.equal(under.overBy, 0);
  assert.equal(under.remaining, 600);
  assert.equal(under.percent, 60);

  const unset = manualState(null, 400);
  assert.equal(unset.mode, 'unset');
  assert.equal(unset.total, null);
  assert.equal(unset.percent, null);

  const unknown = manualState(1000, null);
  assert.equal(unknown.mode, 'manual');
  assert.equal(unknown.used, null);
  assert.equal(unknown.remaining, null);
  assert.equal(unknown.overBudget, false);
});

async function boot(root, { withUsage = false } = {}) {
  const controller = new AbortController();
  const port = await freePort();
  const context = {
    ...fakeContext(root, { port, signal: controller.signal }),
    dataDir: join(root, 'root', 'v2', 'plugin-data', 'quota-bottle'),
  };
  await mkdir(context.dataDir, { recursive: true });
  if (withUsage) {
    await mkdir(join(root, 'root', 'v2', 'sqlite'), { recursive: true });
    const db = new DatabaseSync(usageDbPath(context, {}));
    db.exec(`
      CREATE TABLE local_runtime_token_usage (
        ts INTEGER, input_tokens INTEGER, output_tokens INTEGER,
        cache_read_tokens INTEGER, cache_write_tokens INTEGER
      );
    `);
    const now = Date.now();
    db.prepare('INSERT INTO local_runtime_token_usage VALUES (?, ?, ?, ?, ?)')
      .run(now, 4000000, 0, 0, 0);
    db.close();
  }
  process.env.MMX_CONFIG_DIR = join(root, 'mmx');
  process.env.MINIMAX_BASE_URL = '';
  delete process.env.MINIMAX_REGION;
  const lifecycle = await start(context);
  return { context, controller, port, lifecycle };
}

test('the state says a login is needed when no credential can read the quota', async () => {
  const dir = await tempDir('quota-state-login-');
  const { controller, port, lifecycle } = await boot(dir);
  try {
    const state = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
    assert.equal(state.needsLogin, true);
    assert.ok(state.problems.includes('no_credential'));
    assert.equal(state.mode, 'unset');
  } finally {
    await lifecycle.dispose();
    controller.abort();
    await disposeTemp(dir);
  }
});

test('usage above the saved total is reported as over budget, not as zero remaining', async () => {
  const dir = await tempDir('quota-state-over-');
  const { controller, port, lifecycle } = await boot(dir, { withUsage: true });
  try {
    const saved = await fetch(`http://127.0.0.1:${port}/api/quota`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ total: 1000 }),
    });
    assert.equal(saved.status, 200);
    const state = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
    assert.equal(state.mode, 'manual');
    assert.equal(state.total, 1000);
    assert.equal(state.used, 4000000);
    assert.equal(state.overBudget, true);
    assert.equal(state.overBy, 3999000);
    assert.equal(state.remaining, 0);
    assert.equal(state.percent, 0);
    assert.equal(state.needsLogin, true);
  } finally {
    await lifecycle.dispose();
    controller.abort();
    await disposeTemp(dir);
  }
});
