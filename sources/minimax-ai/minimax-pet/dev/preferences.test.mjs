import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPreferenceStore } from '../miniapp/node/preferences-store.mjs';
import { DEFAULT_PREFERENCES, LEGACY_KEYS, loadPreferences } from '../miniapp/client/preferences.mjs';

async function directory(t) { const path = await fs.mkdtemp(join(tmpdir(), 'pet-preferences-test-')); t.after(() => fs.rm(path, { recursive: true, force: true })); return path; }

test('preferences persist across store instances and isolated dataDir keeps defaults', async (t) => {
  const dataDir = await directory(t);
  const store = createPreferenceStore({ dataDir });
  assert.deepEqual(await store.get(), { preferences: DEFAULT_PREFERENCES, persisted: false });
  await store.patch({ petId: 'my-pet', scale: 1 });
  assert.deepEqual(await createPreferenceStore({ dataDir }).get(), { preferences: { ...DEFAULT_PREFERENCES, petId: 'my-pet', scale: 1 }, persisted: true });
  assert.equal((await createPreferenceStore({ dataDir: await directory(t) }).get()).persisted, false);
});

test('invalid preferences cannot replace persisted data or inject session/runtime/draft fields', async (t) => {
  const dataDir = await directory(t);
  const store = createPreferenceStore({ dataDir });
  await store.patch({ petId: 'safe-pet' });
  const before = await fs.readFile(join(dataDir, 'preferences.json'), 'utf8');
  for (const patch of [null, [], {}, { scale: 2 }, { scale: '1' }, { petId: '../escape' }, { petId: '' }, { autoCycle: '1' }, { sessionId: 'a' }, { runId: 'x' }, { draft: 'hello' }, JSON.parse('{"__proto__":{}}')]) {
    await assert.rejects(store.patch(patch), { code: 'invalid_preferences' });
  }
  assert.equal(await fs.readFile(join(dataDir, 'preferences.json'), 'utf8'), before);
});

test('serialized patches keep independent changes and produce valid final JSON', async (t) => {
  const dataDir = await directory(t);
  const store = createPreferenceStore({ dataDir });
  await Promise.all([store.patch({ petId: 'pet-a' }), store.patch({ scale: 0.5 }), store.patch({ autoCycle: true }), store.patch({ petId: 'pet-b' })]);
  assert.deepEqual((await store.get()).preferences, { petId: 'pet-b', scale: 0.5, autoCycle: true, windowPosition: null });
  assert.deepEqual(JSON.parse(await fs.readFile(join(dataDir, 'preferences.json'), 'utf8')).preferences, (await store.get()).preferences);
});

test('window position persists with bounded integer coordinates; invalid patches cannot change it', async (t) => {
  const dataDir = await directory(t);
  const store = createPreferenceStore({ dataDir });
  await store.patch({ windowPosition: { x: -25, y: 401 } });
  assert.deepEqual((await createPreferenceStore({ dataDir }).get()).preferences.windowPosition, { x: -25, y: 401 });
  for (const position of [{ x: 100001, y: 0 }, { x: 1.5, y: 1 }, { x: 1 }, { x: 1, y: 2, screen: 'private' }, []]) await assert.rejects(store.patch({ windowPosition: position }), { code: 'invalid_preferences' });
  assert.deepEqual((await store.get()).preferences.windowPosition, { x: -25, y: 401 });
});

test('older stored preferences without windowPosition load safely and gain it on next write', async (t) => {
  const dataDir = await directory(t);
  await fs.writeFile(join(dataDir, 'preferences.json'), JSON.stringify({ version: 1, preferences: { petId: 'old', scale: 1, autoCycle: true } }));
  const store = createPreferenceStore({ dataDir });
  assert.equal((await store.get()).preferences.windowPosition, null);
  await store.patch({ windowPosition: { x: 1, y: 2 } });
  assert.equal((await store.get()).preferences.petId, 'old');
});

test('failed atomic rename preserves old data, removes temporary files and permits retry', async (t) => {
  const dataDir = await directory(t);
  const store = createPreferenceStore({ dataDir });
  await store.patch({ petId: 'old-pet' });
  let fail = true;
  const faulty = createPreferenceStore({ dataDir, fs: { ...fs, async rename(...args) { if (fail) throw new Error('injected disk failure'); return fs.rename(...args); } } });
  await assert.rejects(faulty.patch({ petId: 'new-pet' }), { code: 'preferences_write_failed' });
  assert.equal((await store.get()).preferences.petId, 'old-pet');
  assert.deepEqual(await fs.readdir(dataDir), ['preferences.json']);
  fail = false;
  await faulty.patch({ petId: 'new-pet' });
  assert.equal((await store.get()).preferences.petId, 'new-pet');
});

test('corrupt or symlinked preference file fails explicitly without overwriting its bytes', async (t) => {
  const dataDir = await directory(t);
  const target = join(dataDir, 'preferences.json');
  await fs.writeFile(target, '{broken');
  const store = createPreferenceStore({ dataDir });
  await assert.rejects(store.get(), { code: 'preferences_unreadable' });
  await assert.rejects(store.patch({ scale: 1 }), { code: 'preferences_unreadable' });
  assert.equal(await fs.readFile(target, 'utf8'), '{broken');
  await fs.rm(target);
  const outside = join(await directory(t), 'outside.json');
  await fs.writeFile(outside, JSON.stringify({ version: 1, preferences: DEFAULT_PREFERENCES }));
  await fs.symlink(outside, target);
  await assert.rejects(store.get(), { code: 'preferences_unreadable' });
});

function migrationHarness({ persisted = false, fail = false } = {}) {
  const values = new Map([[LEGACY_KEYS.petId, 'old-pet'], [LEGACY_KEYS.scale, '0.5'], [LEGACY_KEYS.autoCycle, '1']]);
  const requests = [];
  const storage = { getItem: (key) => values.get(key) ?? null, removeItem: (key) => values.delete(key) };
  const fetchImpl = async (_url, options) => {
    requests.push(options);
    if (options.method) {
      if (fail) return { ok: false, json: async () => ({ error: 'preferences_write_failed' }) };
      return { ok: true, json: async () => ({ persisted: true, preferences: { ...DEFAULT_PREFERENCES, ...JSON.parse(options.body) } }) };
    }
    return { ok: true, json: async () => ({ persisted, preferences: { ...DEFAULT_PREFERENCES, ...(persisted ? { petId: 'stable-pet' } : {}) } }) };
  };
  return { values, requests, storage, fetchImpl };
}

test('legacy preferences migrate only after successful persistence', async () => {
  const h = migrationHarness();
  assert.deepEqual(await loadPreferences(h.fetchImpl, h.storage), { persisted: true, preferences: { petId: 'old-pet', scale: 0.5, autoCycle: true, windowPosition: null } });
  assert.equal(h.values.size, 0);
  assert.equal(h.requests.length, 2);
});

test('persisted values win over old-origin localStorage without a write', async () => {
  const h = migrationHarness({ persisted: true });
  assert.equal((await loadPreferences(h.fetchImpl, h.storage)).preferences.petId, 'stable-pet');
  assert.equal(h.requests.length, 1);
  assert.equal(h.values.size, 3);
});

test('failed migration retains legacy values and exposes persistence failure', async () => {
  const h = migrationHarness({ fail: true });
  await assert.rejects(loadPreferences(h.fetchImpl, h.storage), /preferences_write_failed/);
  assert.equal(h.values.size, 3);
});

test('migration cannot overwrite a live preference write racing after the initial GET', async (t) => {
  const dataDir = await directory(t);
  const store = createPreferenceStore({ dataDir });
  const h = migrationHarness();
  let reads = 0;
  const fetchImpl = async (_url, options) => {
    if (!options.method) {
      const result = await store.get();
      if (++reads === 1) await store.patch({ petId: 'live-user-choice', scale: 1 });
      return { ok: true, status: 200, json: async () => result };
    }
    try {
      const result = await store.patch(JSON.parse(options.body), { onlyIfUnpersisted: options.headers['if-none-match'] === '*' });
      return { ok: true, status: 200, json: async () => result };
    } catch (error) {
      return { ok: false, status: error.status, json: async () => ({ error: error.code }) };
    }
  };
  const result = await loadPreferences(fetchImpl, h.storage);
  assert.equal(result.preferences.petId, 'live-user-choice');
  assert.equal(result.preferences.scale, 1);
  assert.equal((await store.get()).preferences.petId, 'live-user-choice');
  assert.equal(h.values.size, 0);
});
