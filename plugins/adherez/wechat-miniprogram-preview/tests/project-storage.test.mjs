import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, renameSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createProjectStorage, createVersionedProjectStorage, MAX_STORAGE_BYTES,
  MAX_STORAGE_METADATA_BYTES, MAX_STORAGE_OPERATIONS, MAX_STORAGE_OPERATION_VALUE_BYTES, ProjectStorageError,
} from '../miniapp/node/project-storage.mjs';

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'wechat-project-storage-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'data');
  const first = path.join(root, 'first');
  const second = path.join(root, 'second');
  await Promise.all([mkdir(first), mkdir(second)]);
  return { root, dataDir, first, second, store: await createProjectStorage(dataDir) };
}

function errorCode(code) {
  return (error) => error instanceof ProjectStorageError && error.code === code;
}

function savedFile(dataDir, projectPath) {
  return path.join(dataDir, 'project-storage', `${createHash('sha256').update(projectPath).digest('hex')}.json`);
}

function versionedFile(dataDir, projectPath) {
  return path.join(dataDir, 'project-storage-v2', `${createHash('sha256').update(projectPath).digest('hex')}.json`);
}

async function versionedFixture(t) {
  const f = await fixture(t);
  return { ...f, legacy: f.store, store: await createVersionedProjectStorage(f.dataDir) };
}

test('JSON storage survives restart, remains project-scoped, and clears only the selected project', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await f.store.read(f.first), {});
  const value = { counter: 7, form: { text: 'hello', enabled: false, options: [null, 1, '2'] } };
  assert.deepEqual(await f.store.write(f.first, value), value);
  await f.store.write(f.second, { counter: 3 });
  const restarted = await createProjectStorage(f.dataDir);
  const restored = await restarted.read(f.first);
  assert.deepEqual(restored, value);
  restored.form.text = 'changed caller object';
  assert.equal((await restarted.read(f.first)).form.text, 'hello');
  await restarted.clear(f.first);
  assert.deepEqual(await restarted.read(f.first), {});
  assert.deepEqual(await restarted.read(f.second), { counter: 3 });
});

test('accepted writes and reads serialize; caller mutation does not change the queued snapshot', async (t) => {
  const f = await fixture(t);
  const initial = { count: 1 };
  const firstWrite = f.store.write(f.first, initial);
  initial.count = 999;
  const readAfterFirst = f.store.read(f.first);
  const writes = Array.from({ length: 20 }, (_, index) => f.store.write(f.first, { count: index + 2 }));
  await firstWrite;
  assert.deepEqual(await readAfterFirst, { count: 1 });
  await Promise.all(writes);
  assert.deepEqual(await f.store.read(f.first), { count: 21 });
  assert.deepEqual((await readdir(path.join(f.dataDir, 'project-storage'))).filter((file) => file.endsWith('.tmp')), []);
});

test('quota counts UTF-8 bytes and rejected snapshots preserve the prior storage', async (t) => {
  const f = await fixture(t);
  await f.store.write(f.first, { keep: true });
  await assert.rejects(f.store.write(f.first, { text: 'x'.repeat(MAX_STORAGE_BYTES) }), errorCode('STORAGE_QUOTA_EXCEEDED'));
  await assert.rejects(f.store.write(f.first, { text: '\u4e2d'.repeat(Math.ceil(MAX_STORAGE_BYTES / 3)) }), errorCode('STORAGE_QUOTA_EXCEEDED'));
  assert.deepEqual(await f.store.read(f.first), { keep: true });
  const exact = { text: 'x'.repeat(MAX_STORAGE_BYTES - Buffer.byteLength(JSON.stringify({ text: '' }))) };
  await f.store.write(f.first, exact);
  assert.equal((await readFile(savedFile(f.dataDir, f.first))).byteLength, MAX_STORAGE_BYTES);
  assert.deepEqual(await f.store.read(f.first), exact);
});

test('prototype pollution, non-JSON data, accessors, cycles, and excessive nesting are rejected', async (t) => {
  const f = await fixture(t);
  let getterRan = false;
  const getter = {};
  Object.defineProperty(getter, 'value', { enumerable: true, get() { getterRan = true; return 1; } });
  const cycle = {}; cycle.self = cycle;
  const deep = {}; let cursor = deep;
  for (let i = 0; i < 70; i++) { cursor.next = {}; cursor = cursor.next; }
  const sparse = []; sparse[2] = 1;
  class CustomArray extends Array {}
  for (const value of [
    JSON.parse('{"__proto__":{"polluted":true}}'),
    JSON.parse('{"nested":{"constructor":{"prototype":{"polluted":true}}}}'),
    { nested: [{ prototype: 1 }] }, { toJSON() { return {}; } },
    { date: new Date() }, { value: undefined }, { value: Infinity }, { value: 1n },
    { value: () => 1 }, { value: Symbol('x') }, { value: sparse }, { value: new CustomArray(1, 2) }, getter, cycle, deep, [], null,
  ]) await assert.rejects(f.store.write(f.first, value), errorCode('STORAGE_INVALID_VALUE'));
  assert.equal(getterRan, false);
  assert.equal({}.polluted, undefined);
  await f.store.write(f.first, { safe: true });
  assert.deepEqual(await f.store.read(f.first), { safe: true });
});

test('invalid saved data fails closed and can be explicitly cleared', async (t) => {
  const f = await fixture(t);
  const file = savedFile(f.dataDir, f.first);
  for (const content of ['{bad', '{"__proto__":{"polluted":true}}', '[]', 'x'.repeat(MAX_STORAGE_BYTES + 1)]) {
    await writeFile(file, content);
    await assert.rejects(f.store.read(f.first), errorCode('STORAGE_STATE_INVALID'));
    await f.store.clear(f.first);
    assert.deepEqual(await f.store.read(f.first), {});
  }
});

test('symbolic storage files and a relocated storage directory cannot read or overwrite outside files', async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.root, 'outside.json');
  await writeFile(outside, '{"keep":true}');
  await symlink(outside, savedFile(f.dataDir, f.first), 'file');
  await assert.rejects(f.store.read(f.first), errorCode('STORAGE_STATE_INVALID'));
  await assert.rejects(f.store.write(f.first, { keep: false }), errorCode('STORAGE_STATE_INVALID'));
  await assert.rejects(f.store.clear(f.first), errorCode('STORAGE_STATE_INVALID'));
  assert.equal(await readFile(outside, 'utf8'), '{"keep":true}');
  const storageRoot = path.join(f.dataDir, 'project-storage');
  const moved = path.join(f.root, 'moved-storage');
  await rename(storageRoot, moved);
  await symlink(moved, storageRoot, 'dir');
  await assert.rejects(f.store.write(f.second, { value: 1 }), errorCode('STORAGE_STATE_INVALID'));
  await assert.rejects(createProjectStorage(f.dataDir), errorCode('STORAGE_STATE_INVALID'));
});

test('project aliases share canonical storage and relative or missing project paths are rejected', async (t) => {
  const f = await fixture(t);
  const alias = path.join(f.root, 'alias');
  await symlink(f.first, alias, 'dir');
  await f.store.write(alias, { value: 5 });
  assert.deepEqual(await f.store.read(f.first), { value: 5 });
  for (const candidate of ['../first', '', path.join(f.root, 'missing'), null]) {
    await assert.rejects(f.store.read(candidate), errorCode('STORAGE_INVALID_PROJECT'));
  }
});

test('versioned storage: concurrent windows use CAS rather than silently overwriting each other', async (t) => {
  const f = await versionedFixture(t);
  assert.deepEqual(await f.store.read(f.first), { revision: 0, data: {} });
  const writes = await Promise.allSettled([
    f.store.commit(f.first, { baseRevision: 0, operationId: 'window-a:1', data: { count: 1 } }),
    f.store.commit(f.first, { baseRevision: 0, operationId: 'window-b:1', data: { count: 2 } }),
  ]);
  assert.deepEqual(writes[0], { status: 'fulfilled', value: { committedRevision: 1, changed: true, replayed: false } });
  assert.equal(writes[1].status, 'rejected');
  assert.equal(writes[1].reason.code, 'STORAGE_CONFLICT');
  assert.equal(writes[1].reason.currentRevision, 1);
  assert.deepEqual(writes[1].reason.details, { currentRevision: 1 });
  const restarted = await createVersionedProjectStorage(f.dataDir);
  assert.deepEqual(await restarted.read(f.first), { revision: 1, data: { count: 1 } });
  assert.deepEqual(await restarted.read(f.second), { revision: 0, data: {} });
});

test('versioned storage: same-operation retries return the original ack after newer writes and restart', async (t) => {
  const f = await versionedFixture(t);
  const first = { baseRevision: 0, operationId: 'epoch:preview:handoff-1', data: { count: 1 }, metadata: { expectedLease: 2 }, result: { leaseEpoch: 3 } };
  await f.store.commit(f.first, first);
  await f.store.commit(f.first, { baseRevision: 1, operationId: 'newer-write', data: { count: 2 } });
  const restarted = await createVersionedProjectStorage(f.dataDir);
  assert.deepEqual(await restarted.commit(f.first, { ...first, result: { leaseEpoch: 999 } }), {
    committedRevision: 1, changed: true, replayed: true, result: { leaseEpoch: 3 },
  });
  for (const request of [
    { ...first, baseRevision: 1 }, { ...first, data: { count: 999 } }, { ...first, metadata: { expectedLease: 1 } },
  ]) await assert.rejects(restarted.commit(f.first, request), errorCode('STORAGE_OPERATION_CONFLICT'));
  const operation = await restarted.getOperation(f.first, first.operationId);
  assert.equal(operation.baseRevision, 0);
  assert.equal(operation.committedRevision, 1);
  assert.deepEqual(operation.result, { leaseEpoch: 3 });
  assert.deepEqual(await restarted.read(f.first), { revision: 2, data: { count: 2 } });
});

test('versioned storage: unchanged snapshots do not increment revision but an outdated base never rebases', async (t) => {
  const f = await versionedFixture(t);
  await f.store.commit(f.first, { baseRevision: 0, operationId: 'initial', data: { first: 1, second: 2 } });
  const unchanged = { baseRevision: 1, operationId: 'noop', data: { second: 2, first: 1 } };
  assert.deepEqual(await f.store.commit(f.first, unchanged), { committedRevision: 1, changed: false, replayed: false });
  assert.deepEqual(await f.store.commit(f.first, unchanged), { committedRevision: 1, changed: false, replayed: true });
  await assert.rejects(f.store.commit(f.first, { ...unchanged, operationId: 'outdated-noop', baseRevision: 0 }), errorCode('STORAGE_CONFLICT'));
  assert.equal((await f.store.read(f.first)).revision, 1);
  await f.store.withProjectTransaction(f.first, (tx) => {
    const latest = tx.read();
    const ack = tx.commit({ baseRevision: latest.revision, operationId: 'clean-frame-handoff', data: latest.data, result: { leaseEpoch: 4 } });
    assert.equal(ack.changed, false);
    assert.equal(ack.committedRevision, 1);
  });
});

test('versioned storage: a fast single instance advances from each ack and captures queued snapshots immutably', async (t) => {
  const f = await versionedFixture(t);
  const first = { counter: 1 };
  const firstWrite = f.store.commit(f.first, { baseRevision: 0, operationId: 'initial', data: first });
  first.counter = 999;
  const firstRead = f.store.read(f.first);
  let ack = await firstWrite;
  assert.deepEqual(await firstRead, { revision: 1, data: { counter: 1 } });
  for (let count = 2; count <= 12; count++) {
    ack = await f.store.commit(f.first, { baseRevision: ack.committedRevision, operationId: `seq-${count}`, data: { counter: count } });
  }
  assert.deepEqual(await f.store.read(f.first), { revision: 12, data: { counter: 12 } });
  assert.deepEqual((await readdir(path.join(f.dataDir, 'project-storage-v2'))).filter((file) => file.endsWith('.tmp')), []);
});

test('versioned storage: handoff effects execute only after atomic rename, before another project operation', async (t) => {
  const f = await versionedFixture(t);
  let lease = 1;
  const events = [];
  const handoff = f.store.withProjectTransaction(f.first, (tx) => {
    assert.equal(lease, 1);
    const ack = tx.commit({ baseRevision: 0, operationId: 'handoff', data: { final: true }, result: { leaseEpoch: 2 } });
    tx.afterCommit(() => { lease = 2; events.push('owner-2'); });
    assert.equal(lease, 1);
    return { ack, snapshot: tx.read() };
  });
  const next = f.store.withProjectTransaction(f.first, (tx) => {
    events.push('next');
    assert.equal(lease, 2);
    assert.deepEqual(tx.read(), { revision: 1, data: { final: true } });
  });
  assert.deepEqual((await handoff).snapshot, { revision: 1, data: { final: true } });
  await next;
  assert.deepEqual(events, ['owner-2', 'next']);
  assert.equal(JSON.parse(await readFile(versionedFile(f.dataDir, f.first), 'utf8')).revision, 1);
});

test('versioned storage: failed authorization or CAS leaves both committed data and owner unchanged', async (t) => {
  const f = await versionedFixture(t);
  await f.store.commit(f.first, { baseRevision: 0, operationId: 'first', data: { count: 1 } });
  const original = await readFile(versionedFile(f.dataDir, f.first), 'utf8');
  let changedOwner = false;
  const forbidden = Object.assign(new Error('lease expired'), { code: 'STALE_LEASE' });
  await assert.rejects(f.store.withProjectTransaction(f.first, (tx) => {
    tx.commit({ baseRevision: 1, operationId: 'aborted', data: { count: 2 } });
    tx.afterCommit(() => { changedOwner = true; });
    throw forbidden;
  }), (error) => error === forbidden);
  await assert.rejects(f.store.withProjectTransaction(f.first, (tx) => {
    tx.afterCommit(() => { changedOwner = true; });
    tx.commit({ baseRevision: 0, operationId: 'stale', data: { count: 2 } });
  }), errorCode('STORAGE_CONFLICT'));
  assert.equal(changedOwner, false);
  assert.equal(await readFile(versionedFile(f.dataDir, f.first), 'utf8'), original);
  assert.equal(await f.store.getOperation(f.first, 'aborted'), null);
});

test('versioned storage: asynchronous or nested transactions are rejected rather than deadlocking', async (t) => {
  const f = await versionedFixture(t);
  let ran = false;
  await assert.rejects(f.store.withProjectTransaction(f.first, async () => { ran = true; }), errorCode('STORAGE_ASYNC_TRANSACTION'));
  assert.equal(ran, false);
  await assert.rejects(f.store.withProjectTransaction(f.first, (tx) => {
    tx.commit({ baseRevision: 0, operationId: 'not-persisted', data: { count: 1 } });
    return Promise.resolve('not allowed');
  }), errorCode('STORAGE_ASYNC_TRANSACTION'));
  await assert.rejects(f.store.withProjectTransaction(f.first, () => f.store.read(f.first)), errorCode('STORAGE_TRANSACTION_REENTRY'));
  await assert.rejects(f.store.withProjectTransaction(f.first, (tx) => tx.afterCommit(async () => {})), errorCode('STORAGE_ASYNC_TRANSACTION'));
  let leaked;
  await f.store.withProjectTransaction(f.first, (tx) => { leaked = tx; });
  assert.throws(() => leaked.read(), errorCode('STORAGE_TRANSACTION_CLOSED'));
  assert.deepEqual(await f.store.read(f.first), { revision: 0, data: {} });
});

test('versioned storage: an invalid after-commit callback reports committed state instead of a rollback', async (t) => {
  const f = await versionedFixture(t);
  await assert.rejects(f.store.withProjectTransaction(f.first, (tx) => {
    tx.commit({ baseRevision: 0, operationId: 'handoff-error', data: { keep: true } });
    tx.afterCommit(() => { throw new Error('broken caller effect'); });
  }), (error) => error.code === 'STORAGE_AFTER_COMMIT_FAILED' && error.details.committed === true && error.currentRevision === 1);
  assert.deepEqual(await f.store.read(f.first), { revision: 1, data: { keep: true } });
  assert.equal((await f.store.getOperation(f.first, 'handoff-error')).committedRevision, 1);
});

test('versioned storage: operation records are bounded and expired IDs cannot overwrite a later revision', async (t) => {
  const f = await versionedFixture(t);
  const first = { baseRevision: 0, operationId: 'first', data: { n: 1 } };
  await f.store.commit(f.first, first);
  for (let n = 2; n <= MAX_STORAGE_OPERATIONS + 2; n++) {
    await f.store.commit(f.first, { baseRevision: n - 1, operationId: `step-${n}`, data: { n } });
  }
  assert.equal(await f.store.getOperation(f.first, 'first'), null);
  await assert.rejects(f.store.commit(f.first, first), errorCode('STORAGE_CONFLICT'));
  let saved = JSON.parse(await readFile(versionedFile(f.dataDir, f.first), 'utf8'));
  assert.equal(saved.operations.length, MAX_STORAGE_OPERATIONS);
  for (let n = 0; n < 12; n++) {
    await f.store.commit(f.first, {
      baseRevision: saved.revision, operationId: `large-meta-${n}`, data: saved.data,
      metadata: { text: 'm'.repeat(7000) }, result: { text: 'r'.repeat(7000) },
    });
  }
  saved = JSON.parse(await readFile(versionedFile(f.dataDir, f.first), 'utf8'));
  assert.ok(saved.operations.length < 12);
  assert.ok(Buffer.byteLength(JSON.stringify(saved)) - Buffer.byteLength(JSON.stringify(saved.data)) <= MAX_STORAGE_METADATA_BYTES);
  assert.equal((await f.store.read(f.first)).revision, MAX_STORAGE_OPERATIONS + 2);
});

test('versioned storage: UTF-8 data quota remains separate from bounded envelope metadata', async (t) => {
  const f = await versionedFixture(t);
  await f.store.commit(f.first, { baseRevision: 0, operationId: 'safe', data: { keep: true } });
  const base = { baseRevision: 1, operationId: 'quota' };
  for (const text of ['x'.repeat(MAX_STORAGE_BYTES), '\u4e2d'.repeat(Math.ceil(MAX_STORAGE_BYTES / 3))]) {
    await assert.rejects(f.store.commit(f.first, { ...base, data: { text } }), errorCode('STORAGE_QUOTA_EXCEEDED'));
  }
  for (const name of ['metadata', 'result']) {
    await assert.rejects(f.store.commit(f.first, { ...base, data: {}, [name]: { value: 'x'.repeat(MAX_STORAGE_OPERATION_VALUE_BYTES) } }), errorCode('STORAGE_INVALID_OPERATION'));
  }
  const exact = { text: 'x'.repeat(MAX_STORAGE_BYTES - Buffer.byteLength(JSON.stringify({ text: '' }))) };
  await f.store.commit(f.first, { ...base, data: exact });
  assert.deepEqual(await f.store.read(f.first), { revision: 2, data: exact });
  assert.ok((await readFile(versionedFile(f.dataDir, f.first))).byteLength > MAX_STORAGE_BYTES);
});

test('versioned storage: dangerous JSON, invalid operations, and excess depth or node count preserve prior data', async (t) => {
  const f = await versionedFixture(t);
  await f.store.commit(f.first, { baseRevision: 0, operationId: 'safe', data: { keep: true } });
  const deep = {}; let cursor = deep;
  for (let i = 0; i < 65; i++) { cursor.next = {}; cursor = cursor.next; }
  const cycle = {}; cycle.self = cycle;
  let getterRan = false;
  const accessor = {};
  Object.defineProperty(accessor, 'x', { enumerable: true, get() { getterRan = true; return 1; } });
  for (const data of [
    JSON.parse('{"__proto__":{"polluted":true}}'), { nested: { constructor: {} } }, { nested: { prototype: 1 } },
    { value: undefined }, { value: new Date() }, { value: Infinity }, { value: 1n }, { value: Symbol('s') },
    deep, cycle, accessor, { values: Array(100000).fill(null) }, [], null,
  ]) await assert.rejects(f.store.commit(f.first, { baseRevision: 1, operationId: 'unsafe', data }), errorCode('STORAGE_INVALID_VALUE'));
  for (const request of [
    { baseRevision: -1, operationId: 'id' }, { baseRevision: 0.5, operationId: 'id' },
    { baseRevision: Number.MAX_SAFE_INTEGER + 1, operationId: 'id' }, { baseRevision: 1, operationId: '' },
    { baseRevision: 1, operationId: 'bad\0id' }, { baseRevision: 1, operationId: 'a'.repeat(257) },
  ]) await assert.rejects(f.store.commit(f.first, { ...request, data: {} }), errorCode('STORAGE_INVALID_OPERATION'));
  assert.equal(getterRan, false);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(await f.store.read(f.first), { revision: 1, data: { keep: true } });
});

test('versioned storage: corrupt envelopes fail closed for reads and writes, never silently becoming empty', async (t) => {
  const f = await versionedFixture(t);
  await f.store.commit(f.first, { baseRevision: 0, operationId: 'safe', data: { keep: true } });
  const file = versionedFile(f.dataDir, f.first);
  const valid = JSON.parse(await readFile(file, 'utf8'));
  for (const content of [
    '{bad', '[]', JSON.stringify({ ...valid, revision: -1 }), JSON.stringify({ ...valid, data: JSON.parse('{"__proto__":{}}') }),
    JSON.stringify({ ...valid, operations: [...valid.operations, valid.operations[0]] }),
    JSON.stringify({ ...valid, operations: [] }),
    JSON.stringify({ ...valid, operations: [{ ...valid.operations[0], operationId: 123 }] }),
    JSON.stringify({ ...valid, revision: 2, operations: [valid.operations[0], { ...valid.operations[0], operationId: 'out-of-order' }] }),
    JSON.stringify({ ...valid, operations: [{ ...valid.operations[0], committedRevision: 99 }] }),
    'x'.repeat(MAX_STORAGE_BYTES + MAX_STORAGE_METADATA_BYTES + 1),
    Buffer.concat([Buffer.from('{"invalid":"'), Buffer.from([0xff]), Buffer.from('"}')]),
  ]) {
    await writeFile(file, content);
    await assert.rejects(f.store.read(f.first), errorCode('STORAGE_STATE_INVALID'));
    await assert.rejects(f.store.commit(f.first, { baseRevision: 1, operationId: 'must-not-write', data: {} }), errorCode('STORAGE_STATE_INVALID'));
    assert.deepEqual(await readFile(file), Buffer.from(content));
  }
});

test('versioned storage: project aliases share one canonical revision and relative or missing roots are rejected', async (t) => {
  const f = await versionedFixture(t);
  const alias = path.join(f.root, 'versioned-alias');
  await symlink(f.first, alias, 'dir');
  await f.store.commit(alias, { baseRevision: 0, operationId: 'alias', data: { alias: true } });
  assert.deepEqual(await f.store.read(f.first), { revision: 1, data: { alias: true } });
  await assert.rejects(f.store.commit(f.first, { baseRevision: 0, operationId: 'same-project', data: {} }), errorCode('STORAGE_CONFLICT'));
  for (const candidate of ['../first', '', path.join(f.root, 'missing'), null]) {
    await assert.rejects(f.store.read(candidate), errorCode('STORAGE_INVALID_PROJECT'));
  }
});

test('versioned storage: symbolic files and replaced data directories cannot redirect reads or commits', async (t) => {
  const f = await versionedFixture(t);
  const outside = path.join(f.root, 'outside-v2.json');
  await writeFile(outside, '{"keep":true}');
  await symlink(outside, versionedFile(f.dataDir, f.first), 'file');
  await assert.rejects(f.store.read(f.first), errorCode('STORAGE_STATE_INVALID'));
  await assert.rejects(f.store.commit(f.first, { baseRevision: 0, operationId: 'blocked', data: {} }), errorCode('STORAGE_STATE_INVALID'));
  assert.equal(await readFile(outside, 'utf8'), '{"keep":true}');
  const oldRoot = path.join(f.root, 'old-data');
  await rename(f.dataDir, oldRoot);
  await mkdir(f.dataDir);
  await rename(path.join(oldRoot, 'project-storage-v2'), path.join(f.dataDir, 'project-storage-v2'));
  await assert.rejects(f.store.read(f.second), errorCode('STORAGE_STATE_INVALID'));
});

test('versioned storage: replacing only its directory or the configured dataDir alias fails closed', async (t) => {
  const f = await versionedFixture(t);
  const storageRoot = path.join(f.dataDir, 'project-storage-v2');
  await rename(storageRoot, path.join(f.root, 'moved-v2'));
  await mkdir(storageRoot);
  await assert.rejects(f.store.read(f.first), errorCode('STORAGE_STATE_INVALID'));
  await rm(storageRoot, { recursive: true });
  await symlink(path.join(f.root, 'moved-v2'), storageRoot, 'dir');
  await assert.rejects(createVersionedProjectStorage(f.dataDir), errorCode('STORAGE_STATE_INVALID'));
  const alias = path.join(f.root, 'data-alias');
  const other = path.join(f.root, 'other-data');
  await mkdir(other);
  await symlink(other, alias, 'dir');
  const aliasStore = await createVersionedProjectStorage(alias);
  await rm(alias);
  await symlink(f.dataDir, alias, 'dir');
  await assert.rejects(aliasStore.read(f.first), errorCode('STORAGE_STATE_INVALID'));
});

test('versioned storage: an invalid commit target does not transfer an owner or leave temporary files', async (t) => {
  const f = await versionedFixture(t);
  await f.store.read(f.first);
  let effectRan = false;
  const file = versionedFile(f.dataDir, f.first);
  const backup = `${file}.backup`;
  await assert.rejects(f.store.withProjectTransaction(f.first, (tx) => {
    tx.commit({ baseRevision: 0, operationId: 'no-owner', data: { shouldNotCommit: true } });
    tx.afterCommit(() => { effectRan = true; });
    renameSync(file, backup);
    mkdirSync(file);
  }), errorCode('STORAGE_STATE_INVALID'));
  assert.equal(effectRan, false);
  assert.equal(JSON.parse(await readFile(backup, 'utf8')).revision, 0);
  assert.deepEqual((await readdir(path.join(f.dataDir, 'project-storage-v2'))).filter((name) => name.endsWith('.tmp')), []);
});

test('versioned storage: handoff result lookup and snapshots do not expose mutable stored values', async (t) => {
  const f = await versionedFixture(t);
  const result = { lease: { epoch: 2 } };
  const metadata = { lease: { expected: 1 } };
  const ack = await f.store.commit(f.first, { baseRevision: 0, operationId: 'isolated-ack', data: { nested: { count: 1 } }, metadata, result });
  result.lease.epoch = 99;
  metadata.lease.expected = 99;
  ack.result.lease.epoch = 99;
  const operation = await f.store.getOperation(f.first, 'isolated-ack');
  assert.deepEqual(operation.result, { lease: { epoch: 2 } });
  assert.deepEqual(operation.metadata, { lease: { expected: 1 } });
  operation.result.lease.epoch = 88;
  const snapshot = await f.store.read(f.first);
  snapshot.data.nested.count = 88;
  assert.deepEqual((await f.store.getOperation(f.first, 'isolated-ack')).result, { lease: { epoch: 2 } });
  assert.deepEqual(await f.store.read(f.first), { revision: 1, data: { nested: { count: 1 } } });
});

test('versioned storage: project failures do not poison subsequent transactions or another project', async (t) => {
  const f = await versionedFixture(t);
  await f.store.read(f.first);
  await writeFile(versionedFile(f.dataDir, f.first), '{bad-data');
  const [bad, good] = await Promise.allSettled([
    f.store.commit(f.first, { baseRevision: 0, operationId: 'bad', data: { x: 1 } }),
    f.store.commit(f.second, { baseRevision: 0, operationId: 'good', data: { x: 2 } }),
  ]);
  assert.equal(bad.status, 'rejected');
  assert.equal(bad.reason.code, 'STORAGE_STATE_INVALID');
  assert.equal(good.status, 'fulfilled');
  assert.equal(good.value.committedRevision, 1);
  await assert.rejects(f.store.commit(f.second, { baseRevision: 0, operationId: 'stale', data: {} }), errorCode('STORAGE_CONFLICT'));
  await f.store.commit(f.second, { baseRevision: 1, operationId: 'after-conflict', data: { x: 3 } });
  assert.deepEqual(await f.store.read(f.second), { revision: 2, data: { x: 3 } });
});

test('versioned storage: exactly 64 nested levels and a safe final revision remain representable', async (t) => {
  const f = await versionedFixture(t);
  const deep = {}; let cursor = deep;
  for (let n = 0; n < 64; n++) { cursor.next = {}; cursor = cursor.next; }
  await f.store.commit(f.first, { baseRevision: 0, operationId: 'depth-limit', data: deep });
  assert.deepEqual((await f.store.read(f.first)).data, deep);
  const file = versionedFile(f.dataDir, f.first);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  saved.revision = Number.MAX_SAFE_INTEGER;
  saved.operations[0].baseRevision = Number.MAX_SAFE_INTEGER - 1;
  saved.operations[0].committedRevision = Number.MAX_SAFE_INTEGER;
  await writeFile(file, JSON.stringify(saved));
  await assert.rejects(f.store.commit(f.first, { baseRevision: Number.MAX_SAFE_INTEGER, operationId: 'overflow', data: { different: true } }), errorCode('STORAGE_REVISION_EXHAUSTED'));
  const noop = await f.store.commit(f.first, { baseRevision: Number.MAX_SAFE_INTEGER, operationId: 'safe-noop', data: deep });
  assert.equal(noop.committedRevision, Number.MAX_SAFE_INTEGER);
  assert.equal(noop.changed, false);
  assert.equal((await f.store.read(f.first)).revision, Number.MAX_SAFE_INTEGER);
});
