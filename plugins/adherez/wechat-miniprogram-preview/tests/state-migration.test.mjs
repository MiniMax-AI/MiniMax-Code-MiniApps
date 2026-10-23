import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProjectStorage, createVersionedProjectStorage, MAX_STORAGE_BYTES } from '../miniapp/node/project-storage.mjs';

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'wechat-storage-migration-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'data');
  const project = path.join(root, 'project');
  await mkdir(project);
  const key = createHash('sha256').update(project).digest('hex');
  const legacyFile = path.join(dataDir, 'project-storage', `${key}.json`);
  const file = path.join(dataDir, 'project-storage-v2', `${key}.json`);
  const marker = path.join(dataDir, 'project-storage-v2', `${key}.migration.json`);
  return { root, dataDir, project, key, legacyFile, file, marker, legacy: await createProjectStorage(dataDir) };
}

test('migration: v1 schemaVersion and revision keys remain user data and are imported once at revision zero', async (t) => {
  const f = await fixture(t);
  const data = { schemaVersion: 2, revision: 123, data: { user: true }, operations: ['business-data'] };
  await f.legacy.write(f.project, data);
  const original = await readFile(f.legacyFile);
  const store = await createVersionedProjectStorage(f.dataDir);
  assert.deepEqual(await readdir(path.join(f.dataDir, 'project-storage-v2')), []);
  assert.deepEqual(await store.read(f.project), { revision: 0, data });
  const saved = JSON.parse(await readFile(f.file, 'utf8'));
  assert.equal(saved.schemaVersion, 2);
  assert.equal(saved.migration.source, 'v1');
  assert.equal(saved.migration.sourceDigest, createHash('sha256').update(original).digest('hex'));
  const marker = JSON.parse(await readFile(f.marker, 'utf8'));
  assert.equal(marker.initialRevision, 0);
  assert.equal(marker.source, 'v1');
  assert.deepEqual(await readFile(f.legacyFile), original);
  await store.commit(f.project, { baseRevision: 0, operationId: 'new-v2-value', data: { v2: true } });
  await f.legacy.write(f.project, { lateV1: 'must not be imported' });
  const restarted = await createVersionedProjectStorage(f.dataDir);
  assert.deepEqual(await restarted.read(f.project), { revision: 1, data: { v2: true } });
});

test('migration: missing markers after interrupted migration are repaired from v2 without re-importing v1', async (t) => {
  const f = await fixture(t);
  await f.legacy.write(f.project, { version: 'v1' });
  const store = await createVersionedProjectStorage(f.dataDir);
  await store.read(f.project);
  await store.commit(f.project, { baseRevision: 0, operationId: 'v2-write', data: { version: 'v2' } });
  const before = await readFile(f.file);
  await rm(f.marker);
  await writeFile(f.legacyFile, '{now-invalid-v1');
  const restarted = await createVersionedProjectStorage(f.dataDir);
  assert.deepEqual(await restarted.read(f.project), { revision: 1, data: { version: 'v2' } });
  assert.deepEqual(await readFile(f.file), before);
  assert.equal(JSON.parse(await readFile(f.marker, 'utf8')).source, 'v1');
});

test('migration: bad legacy snapshots fail closed without creating v2 data or altering originals', async (t) => {
  const f = await fixture(t);
  const store = await createVersionedProjectStorage(f.dataDir);
  for (const content of ['{invalid', '{"__proto__":{"polluted":true}}', '[]', 'x'.repeat(MAX_STORAGE_BYTES + 1)]) {
    await writeFile(f.legacyFile, content);
    await assert.rejects(store.read(f.project), { code: 'STORAGE_STATE_INVALID' });
    await assert.rejects(store.commit(f.project, { baseRevision: 0, operationId: 'must-not-overwrite', data: {} }), { code: 'STORAGE_STATE_INVALID' });
    assert.equal(await readFile(f.legacyFile, 'utf8'), content);
    assert.deepEqual(await readdir(path.join(f.dataDir, 'project-storage-v2')), []);
  }
  assert.equal({}.polluted, undefined);
});

test('migration: dangling migrated data fails closed instead of resurrecting the old v1 snapshot', async (t) => {
  const f = await fixture(t);
  await f.legacy.write(f.project, { old: true });
  const store = await createVersionedProjectStorage(f.dataDir);
  await store.commit(f.project, { baseRevision: 0, operationId: 'new-data', data: { new: true } });
  await rm(f.file);
  const restarted = await createVersionedProjectStorage(f.dataDir);
  await assert.rejects(restarted.read(f.project), { code: 'STORAGE_STATE_INVALID' });
  await assert.rejects(readFile(f.file), { code: 'ENOENT' });
  assert.deepEqual(await f.legacy.read(f.project), { old: true });
});

test('migration: corrupt v2 takes precedence over valid v1 and cannot be reset implicitly', async (t) => {
  const f = await fixture(t);
  await f.legacy.write(f.project, { old: true });
  const store = await createVersionedProjectStorage(f.dataDir);
  await store.read(f.project);
  await writeFile(f.file, '{broken-v2');
  await assert.rejects(store.read(f.project), { code: 'STORAGE_STATE_INVALID' });
  await assert.rejects(store.commit(f.project, { baseRevision: 0, operationId: 'implicit-reset', data: {} }), { code: 'STORAGE_STATE_INVALID' });
  assert.equal(await readFile(f.file, 'utf8'), '{broken-v2');
  assert.deepEqual(await f.legacy.read(f.project), { old: true });
});

test('migration: legacy symbolic files and relocated legacy directories are never followed', async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.root, 'external-data.json');
  await writeFile(outside, '{"secret":true}');
  await symlink(outside, f.legacyFile, 'file');
  const store = await createVersionedProjectStorage(f.dataDir);
  await assert.rejects(store.read(f.project), { code: 'STORAGE_STATE_INVALID' });
  assert.deepEqual(await readdir(path.join(f.dataDir, 'project-storage-v2')), []);
  assert.equal(await readFile(outside, 'utf8'), '{"secret":true}');
  const legacyRoot = path.join(f.dataDir, 'project-storage');
  const moved = path.join(f.root, 'legacy-moved');
  await rename(legacyRoot, moved);
  await symlink(moved, legacyRoot, 'dir');
  await assert.rejects(store.read(f.project), { code: 'STORAGE_STATE_INVALID' });
  await assert.rejects(createVersionedProjectStorage(f.dataDir), { code: 'STORAGE_STATE_INVALID' });
});

test('migration: corrupt or symbolic completion markers reject writes without altering the v2 envelope', async (t) => {
  const f = await fixture(t);
  const store = await createVersionedProjectStorage(f.dataDir);
  await store.read(f.project);
  const original = await readFile(f.file);
  const validMarker = await readFile(f.marker);
  for (const bad of ['{bad', '{"schemaVersion":2,"source":"v1"}']) {
    await writeFile(f.marker, bad);
    await assert.rejects(store.commit(f.project, { baseRevision: 0, operationId: 'blocked', data: { wrong: true } }), { code: 'STORAGE_STATE_INVALID' });
    assert.deepEqual(await readFile(f.file), original);
  }
  await rm(f.marker);
  const outside = path.join(f.root, 'marker.json');
  await writeFile(outside, validMarker);
  await symlink(outside, f.marker, 'file');
  await assert.rejects(store.read(f.project), { code: 'STORAGE_STATE_INVALID' });
  assert.deepEqual(await readFile(f.file), original);
});

test('migration: clean projects record their empty origin and do not import legacy data added later', async (t) => {
  const f = await fixture(t);
  await rm(path.join(f.dataDir, 'project-storage'), { recursive: true });
  const store = await createVersionedProjectStorage(f.dataDir);
  assert.deepEqual(await store.read(f.project), { revision: 0, data: {} });
  assert.equal(JSON.parse(await readFile(f.marker, 'utf8')).source, 'empty');
  const legacy = await createProjectStorage(f.dataDir);
  await legacy.write(f.project, { appearedLater: true });
  const restarted = await createVersionedProjectStorage(f.dataDir);
  assert.deepEqual(await restarted.read(f.project), { revision: 0, data: {} });
});

test('migration: downgrading sees untouched v1 data; latest v2 must be exported explicitly', async (t) => {
  const f = await fixture(t);
  const oldData = { count: 1 };
  await f.legacy.write(f.project, oldData);
  const original = await readFile(f.legacyFile);
  const store = await createVersionedProjectStorage(f.dataDir);
  await store.commit(f.project, { baseRevision: 0, operationId: 'after-upgrade', data: { count: 10 } });
  const downgraded = await createProjectStorage(f.dataDir);
  assert.deepEqual(await downgraded.read(f.project), oldData);
  assert.deepEqual(await readFile(f.legacyFile), original);
  assert.deepEqual((await store.read(f.project)).data, { count: 10 });
  assert.equal((await store.migration(f.project)).legacyStatus, 'unchanged');
  await downgraded.write(f.project, { count: 2 });
  assert.equal((await store.migration(f.project)).legacyStatus, 'changed');
  assert.deepEqual((await store.read(f.project)).data, { count: 10 });
});
