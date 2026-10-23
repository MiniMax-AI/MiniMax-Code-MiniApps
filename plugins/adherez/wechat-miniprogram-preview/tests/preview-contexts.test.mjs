import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPreviewContexts } from '../miniapp/node/preview-contexts.mjs';

async function setup(t, options) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'preview-contexts-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await createPreviewContexts(directory, options);
  t.after(() => store.dispose());
  const project = { id: 'project-a', path: directory, name: 'Project A', addedAt: 1 };
  await store.registerProject(project);
  return { store, directory, project };
}

function attach(store, ctx, overrides = {}) {
  const input = { serverEpoch: store.serverEpoch, expectedLeaseEpoch: ctx.leaseEpoch, clientId: 'client-a', instanceId: 'instance-a', buildId: 'build-a', ...overrides };
  store.assertExpectedLease(ctx, input);
  return store.installLease(ctx, input);
}

test('P01/P02: different preview contexts isolate commands, logs and runtime status, even for one project', async (t) => {
  const { store, directory } = await setup(t);
  await store.registerProject({ id: 'project-b', path: path.join(directory, 'b'), name: 'B' });
  const a = await store.create('project-a');
  const b = await store.create('project-b');
  const sibling = await store.create('project-a');
  const aMessages = [], bMessages = [], siblingMessages = [];
  store.subscribe(a.previewId, (type, data) => aMessages.push({ type, data }));
  store.subscribe(b.previewId, (type, data) => bMessages.push({ type, data }));
  store.subscribe(sibling.previewId, (type, data) => siblingMessages.push({ type, data }));
  const lease = attach(store, a);
  store.appendLogs(lease, [{ message: 'Only A', level: 'warn' }]);
  store.reportStatus(lease, 'error', [{ code: 'example', message: 'A failed' }]);
  store.command(a.previewId, 'navigate', 'pages/detail');
  assert.equal(store.snapshot(a.previewId).command.seq, 1);
  assert.equal(store.snapshot(b.previewId).command, null);
  assert.equal(store.snapshot(sibling.previewId).runtime.status, 'waiting');
  assert.deepEqual(store.logs(b.previewId), []);
  assert.equal(bMessages.length, 0);
  assert.equal(siblingMessages.length, 0);
  store.emitProject('project-a', 'build', { buildId: 'build-b' });
  assert.equal(aMessages.at(-1).type, 'build');
  assert.equal(siblingMessages.at(-1).type, 'build');
  assert.equal(bMessages.length, 0);
  assert.equal(siblingMessages.at(-1).data.previewId, sibling.previewId);
});

test('P05: implicit selection works only for a single context and never falls back from an unknown explicit id', async (t) => {
  const { store } = await setup(t);
  assert.throws(() => store.resolve(), { code: 'NO_PREVIEW_CONTEXT' });
  const a = await store.create('project-a');
  assert.equal(store.resolve(), a);
  const b = await store.create('project-a');
  assert.throws(() => store.resolve(), (error) => error.code === 'AMBIGUOUS_PREVIEW_CONTEXT' && error.details.previews.length === 2);
  assert.equal(store.resolve(a.previewId), a);
  assert.equal(store.resolve(b.previewId), b);
  assert.throws(() => store.resolve('not-found'), { code: 'PREVIEW_CONTEXT_NOT_FOUND' });
});

test('P03/P06: takeover replaces only its preview lease; late frame, lease and server-epoch reports are refused', async (t) => {
  const { store } = await setup(t);
  const a = await store.create('project-a');
  const b = await store.create('project-a');
  const first = attach(store, a);
  const unrelated = attach(store, b, { clientId: 'client-b' });
  // The service validates action=takeover; the context primitive only compares epochs.
  const replacement = attach(store, a, { clientId: 'client-c', instanceId: 'new-frame' });
  assert.equal(replacement.leaseEpoch, first.leaseEpoch + 1);
  assert.throws(() => store.assertLease(first), { code: 'STALE_FRAME' });
  assert.throws(() => store.assertLease({ ...replacement, serverEpoch: 'old-process' }), { code: 'STALE_FRAME' });
  assert.throws(() => store.assertExpectedLease(a, { ...replacement, expectedLeaseEpoch: first.leaseEpoch }), { code: 'STALE_FRAME' });
  assert.equal(store.assertLease(unrelated), b);
  assert.equal(store.assertLease(replacement), a);
});

test('P08: descriptors recover after restart without a lease, runtime status, pending command or invented grants', async (t) => {
  const { store, directory } = await setup(t);
  const ctx = await store.create('project-a', { route: 'pages/start?x=1', deviceId: '375x667' });
  const lease = attach(store, ctx);
  store.reportStatus(lease, 'rendered', []);
  store.command(ctx.previewId, 'navigate', 'pages/pending');
  await store.saveDescriptor(ctx, { route: 'pages/confirmed' });
  const recovered = await createPreviewContexts(directory, { validateProject: async (target) => target });
  t.after(() => recovered.dispose());
  const state = recovered.snapshot(ctx.previewId);
  assert.equal(state.route, 'pages/confirmed');
  assert.equal(state.deviceId, '375x667');
  assert.equal(state.lease, null);
  assert.equal(state.command, null);
  assert.equal(state.runtime.status, 'waiting');
  assert.notEqual(state.serverEpoch, store.serverEpoch);
  assert.throws(() => recovered.assertLease(lease), { code: 'STALE_FRAME' });
  const revoked = await createPreviewContexts(directory, { validateProject: async () => { throw new Error('revoked'); } });
  t.after(() => revoked.dispose());
  assert.deepEqual(revoked.list(), []);
});

test('v1 metadata migrates once, preserves original file and does not restore a revoked engineering scope', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'preview-migration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const legacy = { activeId: 'old-project', projects: [{ id: 'old-project', path: directory, name: 'Legacy' }] };
  const legacyFile = path.join(directory, 'state.json');
  await writeFile(legacyFile, JSON.stringify(legacy));
  const a = await createPreviewContexts(directory, { validateProject: async (target) => target });
  const oldId = a.list()[0].previewId;
  assert.equal(a.list()[0].projectId, 'old-project');
  await a.dispose();
  await writeFile(legacyFile, JSON.stringify({ ...legacy, activeId: 'changed-later' }));
  const b = await createPreviewContexts(directory);
  t.after(() => b.dispose());
  assert.equal(b.list()[0].previewId, oldId);
  assert.equal(JSON.parse(await readFile(legacyFile, 'utf8')).activeId, 'changed-later');
});

test('capacity and operation replay are bounded, and a failed mutation does not poison the next operation', async (t) => {
  const { store } = await setup(t, { maxPreviews: 1 });
  const ctx = await store.create('project-a');
  await assert.rejects(store.create('project-a'), { code: 'PREVIEW_CAPACITY_REACHED' });
  await assert.rejects(store.queue(ctx.previewId, () => { throw new Error('intentional'); }), /intentional/);
  assert.equal(await store.queue(ctx.previewId, () => 42), 42);
  store.rememberOperation(ctx, 'op1', 'hash1', { accepted: true });
  assert.deepEqual(store.operation(ctx, 'op1', 'hash1'), { accepted: true });
  assert.throws(() => store.operation(ctx, 'op1', 'different'), { code: 'OPERATION_ID_REUSED' });
  await store.close(ctx.previewId);
  assert.throws(() => store.get(ctx.previewId), { code: 'PREVIEW_CONTEXT_NOT_FOUND' });
  assert.ok(await store.create('project-a'));
});

test('invalid v2 state and replaced data directories fail closed', async (t) => {
  const { store, directory } = await setup(t);
  await writeFile(path.join(directory, 'preview-state-v2.json'), '{broken');
  await assert.rejects(createPreviewContexts(directory), { code: 'PREVIEW_STATE_INVALID' });
  const displaced = directory + '-old';
  t.after(() => rm(displaced, { recursive: true, force: true }));
  await rename(directory, displaced);
  await mkdir(directory);
  await assert.rejects(store.create('project-a'), { code: 'PREVIEW_STATE_INVALID' });
});

test('explicit log cursors page forward without losing a disconnect backlog; no cursor keeps latest entries', async (t) => {
  const { store } = await setup(t);
  const ctx = await store.create('project-a');
  const identity = attach(store, ctx);
  for (let batch = 0; batch < 4; batch++) store.appendLogs(identity, Array.from({ length: 100 }, (_, index) => ({
    message: `message-${batch * 100 + index + 1}`, route: 'pages/detail',
  })));
  const latest = store.logs(ctx.previewId, { limit: 200 });
  assert.equal(latest[0].seq, 201); assert.equal(latest.at(-1).seq, 400);
  const first = store.logs(ctx.previewId, { limit: 200, afterSeq: 0 });
  const second = store.logs(ctx.previewId, { limit: 200, afterSeq: first.at(-1).seq });
  assert.equal(first[0].seq, 1); assert.equal(first.at(-1).seq, 200);
  assert.equal(second[0].seq, 201); assert.equal(second.at(-1).seq, 400);
  assert.deepEqual([...first, ...second].map((item) => item.seq), Array.from({ length: 400 }, (_, index) => index + 1));
  assert.equal(first[0].route, 'pages/detail');
  store.appendLogs(identity, [{ message: 'bounded-route', route: 'a'.repeat(3000) }]);
  assert.equal(store.logs(ctx.previewId, { limit: 1 })[0].route.length, 2048);
});
