// @ts-check
//
// Regression tests for the durable state.
//
// A state file that cannot be read must never be overwritten: its bytes have
// to survive under their own name, and the notice about it has to reach the
// page.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createStore } from '../miniapp/node/store.mjs';

/**
 * @returns {Promise<string>}
 */
async function tempDir() {
  return mkdtemp(join(tmpdir(), 'wechat-studio-store-'));
}

test('a damaged state file is kept under its own name and never overwritten', async () => {
  const dir = await tempDir();
  const statePath = join(dir, 'state.json');
  const damaged = '{ "drafts": [ broken';
  await writeFile(statePath, damaged, 'utf8');

  const store = createStore(dir);
  await store.init();

  // The notice is set and names the preserved copy.
  assert.match(String(store.state.notice), /原文件已完整保留/);
  assert.ok(store.corruptBackupPath.endsWith('.json'));

  // The original bytes are still there, unchanged.
  const kept = await readFile(store.corruptBackupPath, 'utf8');
  assert.equal(kept, damaged);

  // The damaged file is not left in place, so a later write cannot clobber it.
  const entries = await readdir(dir);
  assert.ok(!entries.includes('state.json'), 'state.json is free for a fresh state');

  // Writing after the recovery leaves the preserved copy untouched.
  await store.mutate((state) => {
    state.drafts.push({ id: 'd1' });
  });
  const keptAfter = await readFile(store.corruptBackupPath, 'utf8');
  assert.equal(keptAfter, damaged);
  const fresh = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(fresh.drafts.length, 1);
});

test('a damaged state file keeps its notice after the first write', async () => {
  const dir = await tempDir();
  await writeFile(join(dir, 'state.json'), 'not json at all', 'utf8');
  const store = createStore(dir);
  await store.init();
  await store.mutate(() => {});
  const written = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'));
  assert.match(String(written.notice), /原文件已完整保留/);
});

test('a good state file is kept, and the previous one is backed up', async () => {
  const dir = await tempDir();
  const statePath = join(dir, 'state.json');
  await writeFile(statePath, JSON.stringify({ version: 1, drafts: [{ id: 'keep' }], styles: [], publishChecks: {} }), 'utf8');

  const store = createStore(dir);
  await store.init();
  assert.equal(store.state.drafts.length, 1);
  assert.equal(store.state.notice, '');

  await store.mutate((state) => {
    state.drafts.push({ id: 'second' });
  });

  const current = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(current.drafts.length, 2);

  const backup = JSON.parse(await readFile(join(dir, 'state.backup.json'), 'utf8'));
  assert.equal(backup.drafts.length, 1);
  assert.equal(backup.drafts[0].id, 'keep');
});

test('a missing state file is not an error', async () => {
  const dir = await tempDir();
  const store = createStore(dir);
  await store.init();
  assert.equal(store.state.drafts.length, 0);
  assert.equal(store.state.notice, '');
});
