import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPreviewService } from '../miniapp/node/preview-service.mjs';

const pluginRoot = fileURLToPath(new URL('../', import.meta.url));
async function setup(t, options) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'preview-service-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const context = { pluginRoot, dataDir: path.join(directory, 'data') };
  const service = await createPreviewService(context, options);
  t.after(() => service.dispose());
  const project = path.join(directory, 'project'); await cp(path.join(pluginRoot, 'miniapp/node/demo'), project, { recursive: true });
  const opened = await service.openProject({ project_path: project });
  assert.equal(opened.build.status, 'ok', JSON.stringify(opened.build.errors));
  return { directory, project, service, opened, context };
}
function registration(service, state, changes = {}) {
  const next = { buildId: state.build.buildId, clientId: changes.clientId ?? state.lease?.clientId ?? 'client-a', instanceId: changes.instanceId ?? 'frame-a' };
  const identity = state.lease ? { ...state.lease, serverEpoch: service.serverEpoch, previewId: state.previewId, projectId: state.projectId } : undefined;
  const { clientId, instanceId, previousInstanceId, previousBuildId, takeover, ...rest } = changes;
  const action = takeover ? 'takeover' : identity ? 'reload' : 'attach';
  return { previewId: state.previewId, projectId: state.projectId, serverEpoch: service.serverEpoch,
    expectedLeaseEpoch: state.leaseEpoch, next, action, ...(action === 'reload' ? { previous: identity } : {}),
    operationId: 'register-a', dirty: false, ...rest };
}

test('P01-P06: explicit preview contexts coexist, old tool calls reject ambiguity and operations stay in their context', async (t) => {
  const { service, opened, project, directory } = await setup(t);
  const secondProject = path.join(directory, 'second'); await cp(project, secondProject, { recursive: true });
  const other = await service.openProject({ project_path: secondProject, ...{ create_new: true } });
  const sibling = await service.openProject({ project_path: project, create_new: true });
  await assert.rejects(service.navigate(undefined, 'pages/index/index'), { code: 'AMBIGUOUS_PREVIEW_CONTEXT' });
  assert.throws(() => service.snapshot('missing'), { code: 'PREVIEW_CONTEXT_NOT_FOUND' });
  const a = await service.transition(registration(service, opened));
  const b = await service.transition(registration(service, other, { clientId: 'client-b', instanceId: 'frame-b', operationId: 'register-b' }));
  const c = await service.transition(registration(service, sibling, { clientId: 'client-c', instanceId: 'frame-c', operationId: 'register-c' }));
  await service.status(a.identity, 'error', [{ message: 'Only A failed' }]);
  await service.appendLogs(a.identity, [{ level: 'error', message: 'Only A log' }]);
  const command = await service.navigate(opened.previewId, 'pages/detail/detail', { from: 'A' });
  assert.equal(command.accepted, true);
  assert.equal(service.snapshot(other.previewId).command, null);
  assert.equal(service.snapshot(sibling.previewId).preview.status, 'starting');
  assert.deepEqual(service.logs(other.previewId).entries, []);
  await service.route(b.identity, 'pages/index/index');
  await service.route(c.identity, 'pages/index/index');
  const takeover = await service.transition(registration(service, service.snapshot(opened.previewId), { clientId: 'new-client', instanceId: 'new-frame', operationId: 'takeover', takeover: true }));
  await assert.rejects(service.status(a.identity, 'rendered', []), { code: 'STALE_FRAME' });
  await service.status(c.identity, 'rendered', []);
  assert.equal(service.snapshot(sibling.previewId).preview.status, 'rendered');
  assert.equal(takeover.identity.leaseEpoch, a.identity.leaseEpoch + 1);
});

test('direct open returns a fixed Host open action without creating, updating or importing legacy grants', async (t) => {
  const { service, opened, context, directory, project } = await setup(t);
  const legacy = path.join(context.dataDir, 'project-access.json');
  await assert.rejects(readFile(legacy), { code: 'ENOENT' });
  assert.equal(opened.capabilityVersion, 4);
  assert.equal(opened.nextStep, 'open_miniapp');
  assert.deepEqual(opened.hostOpenAction, { action: 'open', pluginId: 'wechat-miniprogram-preview', path: opened.surfacePath });
  assert.equal(opened.surfacePath, `/preview?previewId=${encodeURIComponent(opened.previewId)}`);
  assert.equal(Object.hasOwn(opened.activeProject, 'revocable'), false);
  const grants = '{not valid JSON and intentionally ignored';
  await writeFile(legacy, grants);
  const game = path.join(directory, 'direct-game'); await mkdir(game);
  await writeFile(path.join(game, 'game.json'), '{}'); await writeFile(path.join(game, 'game.js'), 'GameGlobal.x=1;');
  const next = await service.openProject({ project_path: game, project_kind: 'minigame', create_new: true });
  assert.equal(next.build.status, 'ok'); assert.equal(next.projectKind, 'minigame');
  assert.equal(await readFile(legacy, 'utf8'), grants);
  const before = service.list().projects.length;
  const unopened = path.join(directory, 'unopened'); await cp(project, unopened, { recursive: true });
  await writeFile(legacy, JSON.stringify({ version: 1, grants: [{ path: unopened, dev: '1', ino: '1', grantedAt: 1 }] }));
  assert.equal(service.list().projects.length, before);
  assert.equal(service.list().projects.some((item) => item.path === unopened), false);
});

test('nextStep distinguishes build errors, connected running pages and pending recovery without exposing Storage', async (t) => {
  const { service, opened, project } = await setup(t);
  const connection = await service.subscribe(opened.previewId, () => {}); t.after(() => connection.dispose());
  const frame = await service.transition(registration(service, service.snapshot(opened.previewId)));
  assert.equal(service.snapshot(opened.previewId).nextStep, 'wait_for_render');
  await service.status(frame.identity, 'rendered', []);
  assert.equal(service.snapshot(opened.previewId).nextStep, 'preview_ready');
  await service.commitStorage({ ...frame.identity, operationId: 'private-state', baseRevision: 0, data: { shouldNotLeak: 'secret-value' } });
  assert.doesNotMatch(JSON.stringify(service.snapshot(opened.previewId)), /secret-value|shouldNotLeak/);
  await writeFile(path.join(project, 'miniprogram/app.js'), 'const broken = ;');
  const failed = await service.rebuild(opened.previewId);
  assert.equal(failed.nextStep, 'inspect_build');
  assert.equal(failed.build.status, 'error');
  assert.deepEqual(failed.hostOpenAction, opened.hostOpenAction);
});

test('direct path opening preserves explicit-context ambiguity and capacity without takeover or cleanup', async (t) => {
  const { service, opened, directory, project } = await setup(t, { contexts: { maxPreviews: 2 } });
  const original = await service.transition(registration(service, opened));
  const second = await service.openProject({ project_path: project, create_new: true });
  const other = path.join(directory, 'other'); await cp(project, other, { recursive: true });
  await assert.rejects(service.openProject({ project_path: other }), { code: 'AMBIGUOUS_PREVIEW_CONTEXT' });
  await assert.rejects(service.openProject({ project_path: other, create_new: true }), { code: 'PREVIEW_CAPACITY_REACHED' });
  await assert.rejects(service.openProject({ project_path: other, preview_id: opened.previewId }), { code: 'PREVIEW_REQUIRES_DRAIN' });
  assert.equal(service.list().previews.length, 2);
  assert.equal(service.snapshot(opened.previewId).lease.instanceId, original.identity.instanceId);
  assert.equal(service.snapshot(second.previewId).lease, null);
});

test('active-project capacity failure leaves an idle selected context on its original project with unchanged refs', async (t) => {
  const { service, opened, directory, project } = await setup(t, { builds: { maxProjects: 1 } });
  const connection = await service.subscribe(opened.previewId, () => {}); t.after(() => connection.dispose());
  const before = service.snapshot(opened.previewId);
  const candidate = path.join(directory, 'target'); await cp(project, candidate, { recursive: true });
  await assert.rejects(service.openProject({ preview_id: opened.previewId, project_path: candidate }), (error) => {
    assert.equal(error.code, 'PROJECT_CAPACITY_REACHED');
    assert.equal(error.details.resource, 'active_projects'); assert.equal(error.details.limit, 1); assert.equal(error.details.current, 1);
    assert.equal(error.details.previews[0].previewId, opened.previewId);
    assert.doesNotMatch(JSON.stringify(error.details), new RegExp(directory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    return true;
  });
  const after = service.snapshot(opened.previewId);
  assert.equal(after.projectId, before.projectId); assert.equal(after.route, before.route); assert.equal(after.build.buildId, before.build.buildId);
  assert.equal(service.builds.inspect().projects.find((item) => item.projectId === opened.projectId).references, 1);
  assert.ok(service.builds.inspect().projects.filter((item) => item.projectId !== opened.projectId).every((item) => item.references === 0));
  const count = service.list().previews.length;
  await assert.rejects(service.openProject({ project_path: candidate, create_new: true }), { code: 'PROJECT_CAPACITY_REACHED' });
  assert.equal(service.list().previews.length, count);
});

test('target syntax errors may be selected for diagnostics but metadata write failure preserves original context', async (t) => {
  const { service, opened, directory, project } = await setup(t);
  const target = path.join(directory, 'target'); await cp(project, target, { recursive: true });
  await writeFile(path.join(target, 'miniprogram/app.js'), 'const broken = ;');
  const result = await service.openProject({ preview_id: opened.previewId, project_path: target });
  assert.equal(result.build.status, 'error'); assert.equal(result.nextStep, 'inspect_build');
  const previousId = result.projectId;
  const connection = await service.subscribe(opened.previewId, () => {}); t.after(() => connection.dispose());
  const originalSave = service.previews.saveDescriptor;
  service.previews.saveDescriptor = async () => { throw Object.assign(new Error('cannot save metadata'), { code: 'PREVIEW_STATE_INVALID' }); };
  await assert.rejects(service.openProject({ preview_id: opened.previewId, project_path: project }), { code: 'PREVIEW_STATE_INVALID' });
  service.previews.saveDescriptor = originalSave;
  assert.equal(service.snapshot(opened.previewId).projectId, previousId);
  assert.equal(service.builds.inspect().projects.find((item) => item.projectId === previousId).references, 1);
  assert.equal(service.builds.inspect().projects.find((item) => item.projectId === opened.projectId).references, 0);
});

test('explicit closeIdle frees ownerless context capacity without reading Storage or stopping active previews', async (t) => {
  const { service, opened, project } = await setup(t, { contexts: { maxPreviews: 2 } });
  const active = await service.transition(registration(service, opened));
  const idle = await service.openProject({ project_path: project, create_new: true });
  await assert.rejects(service.closeIdle(idle.previewId, { serverEpoch: service.serverEpoch, expectedLeaseEpoch: idle.leaseEpoch, confirmed: false }), { code: 'INVALID_ARGUMENTS' });
  await assert.rejects(service.closeIdle(opened.previewId, { serverEpoch: service.serverEpoch, expectedLeaseEpoch: active.identity.leaseEpoch, confirmed: true }), { code: 'PREVIEW_REQUIRES_DRAIN' });
  await assert.rejects(service.closeIdle(idle.previewId, { serverEpoch: service.serverEpoch, expectedLeaseEpoch: 99, confirmed: true }), { code: 'STALE_FRAME' });
  const read = service.storage.read; service.storage.read = async () => { throw new Error('Storage must not be read for an idle close'); };
  const closed = await service.closeIdle(idle.previewId, { serverEpoch: service.serverEpoch, expectedLeaseEpoch: idle.leaseEpoch, confirmed: true });
  service.storage.read = read;
  assert.deepEqual(closed, { ok: true, previewId: idle.previewId, closed: true, storageTouched: false });
  assert.equal(service.snapshot(opened.previewId).lease.instanceId, active.identity.instanceId);
  assert.equal(service.list().previews.length, 1);
  assert.equal((await service.openProject({ project_path: project, create_new: true })).build.status, 'ok');
});

test('S01/S02/S04: project-shared CAS refuses stale data and stale owners without rolling back newer values', async (t) => {
  const { service, opened, project } = await setup(t);
  const sibling = await service.openProject({ project_path: project, create_new: true });
  const a = await service.transition(registration(service, opened));
  const b = await service.transition(registration(service, sibling, { clientId: 'b', instanceId: 'b', operationId: 'b' }));
  const writeA = { ...a.identity, operationId: 'write-a', baseRevision: 0, data: { count: 1 } };
  assert.equal((await service.commitStorage(writeA)).committedRevision, 1);
  assert.equal((await service.commitStorage(writeA)).replayed, true);
  await assert.rejects(service.commitStorage({ ...b.identity, operationId: 'write-b', baseRevision: 0, data: { count: 2 } }), { code: 'STORAGE_CONFLICT' });
  assert.deepEqual(await service.storage.read(project), { revision: 1, data: { count: 1 } });
  const replace = registration(service, service.snapshot(opened.previewId), { instanceId: 'new-a', operationId: 'new-a', dirty: true, baseRevision: 1, data: { count: 3 }, previousInstanceId: a.identity.instanceId, previousBuildId: a.identity.buildId });
  const next = await service.transition(replace);
  assert.deepEqual(next.storage.data, { count: 3 });
  assert.equal(next.storage.revision, 2);
  assert.deepEqual(await service.transition(replace), next);
  await assert.rejects(service.commitStorage({ ...a.identity, operationId: 'late-a', baseRevision: 2, data: { count: 0 } }), { code: 'STALE_FRAME' });
});

test('P04/S03/S08: clean simultaneous refreshes do not create revisions; conflict keeps the old frame lease', async (t) => {
  const { service, opened, project } = await setup(t);
  const sibling = await service.openProject({ project_path: project, create_new: true });
  const a = await service.transition(registration(service, opened));
  const b = await service.transition(registration(service, sibling, { clientId: 'b', instanceId: 'b', operationId: 'b' }));
  const [a2, b2] = await Promise.all([
    service.transition(registration(service, service.snapshot(opened.previewId), { instanceId: 'a2', operationId: 'a2' })),
    service.transition(registration(service, service.snapshot(sibling.previewId), { clientId: 'b', instanceId: 'b2', operationId: 'b2' })),
  ]);
  assert.equal(a2.storage.revision, 0); assert.equal(b2.storage.revision, 0);
  await service.commitStorage({ ...a2.identity, operationId: 'new-data', baseRevision: 0, data: { from: 'A' } });
  const conflicting = registration(service, service.snapshot(sibling.previewId), { clientId: 'b', instanceId: 'b3', operationId: 'b3', dirty: true, baseRevision: 0, data: { from: 'B' }, previousInstanceId: b2.identity.instanceId, previousBuildId: b2.identity.buildId });
  await assert.rejects(service.transition(conflicting), { code: 'STORAGE_CONFLICT' });
  await service.status(b2.identity, 'rendered', []);
  assert.equal(service.snapshot(sibling.previewId).lease.instanceId, 'b2');
  const acknowledgement = await service.commitStorage({ ...a2.identity, operationId: 'a-next', baseRevision: 1, data: { from: 'A', second: true } });
  assert.equal(acknowledgement.committedRevision, 2);
});

test('P09: old frame resources stay immutable while new builds become available', async (t) => {
  const { service, opened, project } = await setup(t);
  await writeFile(path.join(project, 'miniprogram/asset.png'), 'original');
  await service.rebuild(opened.previewId);
  const before = service.snapshot(opened.previewId);
  const frame = await service.transition(registration(service, before));
  await writeFile(path.join(project, 'miniprogram/asset.png'), 'new');
  await service.rebuild(opened.previewId);
  assert.notEqual(service.snapshot(opened.previewId).build.buildId, frame.identity.buildId);
  assert.ok(await service.artifact(opened.previewId, opened.projectId, frame.identity.buildId));
  assert.equal(service.builds.asset(opened.projectId, frame.identity.buildId, 'asset.png').toString(), 'original');
  await assert.rejects(service.status(frame.identity, 'rendered', []), { code: 'STALE_BUILD' });
  await service.commitStorage({ ...frame.identity, operationId: 'draining-old', drain: true, baseRevision: 0, data: { saved: true } });
});

test('P08/S07: restart preserves descriptors and project data but old process messages never restore a lease', async (t) => {
  const { service, opened, context, project } = await setup(t);
  const frame = await service.transition(registration(service, opened));
  await service.commitStorage({ ...frame.identity, operationId: 'save', baseRevision: 0, data: { revision: 'user-key', schemaVersion: 'user-schema' } });
  await service.route(frame.identity, 'pages/detail/detail');
  const legacyGrantFile = path.join(context.dataDir, 'project-access.json');
  const malformedLegacyGrant = '{legacy grant is deliberately invalid';
  await writeFile(legacyGrantFile, malformedLegacyGrant);
  await service.dispose();
  const restarted = await createPreviewService(context); t.after(() => restarted.dispose());
  const restored = restarted.snapshot(opened.previewId);
  assert.equal(restored.route, 'pages/detail/detail');
  assert.equal(restored.lease, null);
  assert.notEqual(restarted.serverEpoch, service.serverEpoch);
  assert.equal(restored.build.status, 'idle');
  await assert.rejects(restarted.commitStorage({ ...frame.identity, operationId: 'late', baseRevision: 1, data: {} }), { code: 'STALE_FRAME' });
  assert.deepEqual(await restarted.storage.read(project), { revision: 1, data: { revision: 'user-key', schemaVersion: 'user-schema' } });
  assert.equal(await readFile(legacyGrantFile, 'utf8'), malformedLegacyGrant);
});

test('frame protocol refuses implicit takeover, old flat fields and dirty-false snapshots', async (t) => {
  const { service, opened } = await setup(t);
  const request = registration(service, opened);
  const first = await service.transition(request);
  await assert.rejects(service.transition({ ...registration(service, service.snapshot(opened.previewId)), action: 'attach', previous: undefined, operationId: 'implicit' }), { code: 'PREVIEW_IN_USE' });
  await assert.rejects(service.transition({ ...request, operationId: 'flat', clientId: 'extra' }), { code: 'INVALID_ARGUMENTS' });
  await assert.rejects(service.transition({ ...registration(service, service.snapshot(opened.previewId)), operationId: 'dirty-false', data: {}, baseRevision: 0 }), { code: 'INVALID_ARGUMENTS' });
  await assert.rejects(service.transition({ ...registration(service, service.snapshot(opened.previewId)), operationId: 'foreign-previous', previous: { ...first.identity, clientId: 'other' } }), { code: 'STALE_FRAME' });
  assert.equal(service.snapshot(opened.previewId).lease.instanceId, first.identity.instanceId);
});

test('close is exactly replayable via a tombstone and never recreates the closed preview', async (t) => {
  const { service, opened, project } = await setup(t);
  const frame = await service.transition(registration(service, opened));
  const input = { ...frame.identity, operationId: 'close-frame', dirty: true, baseRevision: 0, data: { saved: 'final' } };
  const closed = await service.drain(input, { close: true });
  assert.equal(closed.closed, true); assert.equal(closed.saved, true);
  assert.deepEqual(await service.drain(input, { close: true }), closed);
  assert.deepEqual((await service.operation(opened.previewId, input.operationId)).result, closed);
  assert.deepEqual(await service.storage.read(project), { revision: 1, data: { saved: 'final' } });
  assert.throws(() => service.snapshot(opened.previewId), { code: 'PREVIEW_CONTEXT_NOT_FOUND' });
  assert.deepEqual(service.list().previews, []);
  await assert.rejects(service.drain({ ...input, data: {} }, { close: true }), { code: 'OPERATION_ID_REUSED' });
  assert.equal(service.builds.inspect().artifacts[0].pins, 0);
});

test('force-close requires confirmation and expected lease, rejects late data, and reports saved=false', async (t) => {
  const { service, opened, project } = await setup(t);
  const frame = await service.transition(registration(service, opened));
  const input = { serverEpoch: service.serverEpoch, previewId: opened.previewId, projectId: opened.projectId, expectedLeaseEpoch: frame.identity.leaseEpoch, operationId: 'force', confirmed: true };
  await assert.rejects(service.forceClose({ ...input, confirmed: false }), { code: 'INVALID_ARGUMENTS' });
  await assert.rejects(service.forceClose({ ...input, expectedLeaseEpoch: 0 }), { code: 'STALE_FRAME' });
  const closed = await service.forceClose(input);
  assert.equal(closed.saved, false); assert.equal(closed.closed, true);
  assert.deepEqual(await service.forceClose(input), closed);
  assert.deepEqual((await service.operation(opened.previewId, 'force')).result, closed);
  await assert.rejects(service.commitStorage({ ...frame.identity, baseRevision: 0, operationId: 'late', data: { lost: true } }), { code: 'PREVIEW_CONTEXT_NOT_FOUND' });
  assert.deepEqual(await service.storage.read(project), { revision: 0, data: {} });
});

test('detach commits once and retains route/context for safe later attach', async (t) => {
  const { service, opened, project } = await setup(t);
  const frame = await service.transition(registration(service, opened));
  await service.route(frame.identity, 'pages/detail/detail');
  const input = { ...frame.identity, operationId: 'detach', dirty: true, baseRevision: 0, data: { pending: true } };
  const result = await service.drain(input, { detach: true });
  assert.equal(result.detached, true); assert.equal(result.closed, false);
  assert.equal(service.snapshot(opened.previewId).lease, null);
  assert.equal(service.snapshot(opened.previewId).route, 'pages/detail/detail');
  assert.deepEqual(await service.drain(input, { detach: true }), result);
  const attached = await service.transition(registration(service, service.snapshot(opened.previewId), { operationId: 'reattach', instanceId: 'new' }));
  assert.deepEqual(attached.storage, { revision: 1, data: { pending: true } });
  assert.deepEqual(await service.storage.read(project), attached.storage);
});

test('switching project preflights target and never writes the original snapshot into the target', async (t) => {
  const { service, opened, project, directory } = await setup(t);
  const target = path.join(directory, 'target'); await cp(project, target, { recursive: true });
  const registered = await service.registerProjectResult(target);
  assert.equal(service.list().previews.length, 1);
  const frame = await service.transition(registration(service, opened));
  const input = { ...frame.identity, operationId: 'switch', dirty: true, baseRevision: 0, data: { onlyOriginal: true }, targetProjectId: registered.projectId };
  const result = await service.drain(input, { nextProjectId: registered.projectId });
  assert.equal(result.state.projectId, registered.projectId);
  assert.equal(result.state.lease, null);
  assert.deepEqual(await service.storage.read(project), { revision: 1, data: { onlyOriginal: true } });
  assert.deepEqual(await service.storage.read(target), { revision: 0, data: {} });
  assert.deepEqual(await service.drain(input, { nextProjectId: registered.projectId }), result);
});

test('target compile failure preserves the original lease and dirty snapshot without committing it', async (t) => {
  const { service, opened, project, directory } = await setup(t);
  const target = path.join(directory, 'broken'); await cp(project, target, { recursive: true });
  const registered = await service.registerProjectResult(target);
  await writeFile(path.join(target, 'miniprogram/pages/index/index.js'), 'Page({');
  const frame = await service.transition(registration(service, opened));
  await assert.rejects(service.drain({ ...frame.identity, operationId: 'bad-target', dirty: true, baseRevision: 0, data: { pending: true } }, { nextProjectId: registered.projectId }), { code: 'TARGET_BUILD_FAILED' });
  assert.equal(service.snapshot(opened.previewId).lease.instanceId, frame.identity.instanceId);
  assert.deepEqual(await service.storage.read(project), { revision: 0, data: {} });
});

test('afterCommit failure blocks all old writes until the recorded target completes controlled recovery', async (t) => {
  let failures = 0;
  const { service, opened, project } = await setup(t, { afterStorageCommit: () => { if (failures++ === 1) throw new Error('injected handoff failure'); } });
  const first = await service.transition(registration(service, opened));
  const request = registration(service, service.snapshot(opened.previewId), { operationId: 'recover', instanceId: 'target-frame', dirty: true, baseRevision: 0, data: { durable: true } });
  await assert.rejects(service.transition(request), (error) => error.code === 'PREVIEW_RECOVERING' && error.details.committed);
  assert.deepEqual(await service.storage.read(project), { revision: 1, data: { durable: true } });
  await assert.rejects(service.commitStorage({ ...first.identity, operationId: 'must-block', baseRevision: 1, data: {} }), { code: 'PREVIEW_RECOVERING' });
  await assert.rejects(service.transition({ ...request, action: 'takeover', previous: undefined, dirty: false, data: undefined, baseRevision: undefined, operationId: 'must-not-takeover' }), { code: 'PREVIEW_RECOVERING' });
  assert.equal((await service.operation(opened.previewId, request.operationId)).status, 'recovering');
  await assert.rejects(service.recover({ serverEpoch: service.serverEpoch, previewId: opened.previewId, operationId: request.operationId, clientId: 'other' }), { code: 'STALE_FRAME' });
  const recovered = await service.recover({ serverEpoch: service.serverEpoch, previewId: opened.previewId, operationId: request.operationId, clientId: request.next.clientId });
  assert.equal(recovered.identity.instanceId, 'target-frame');
  assert.deepEqual(recovered.storage, { revision: 1, data: { durable: true } });
  assert.deepEqual(await service.transition(request), recovered);
  await assert.rejects(service.commitStorage({ ...first.identity, operationId: 'old', baseRevision: 1, data: {} }), { code: 'STALE_FRAME' });
});

for (const finish of ['reconnect', 'close']) test(`a pending reconnect stays on its project until explicit ${finish}, without losing saved data`, async (t) => {
  let commits = 0;
  const { service, opened, project, directory } = await setup(t, { afterStorageCommit: () => {
    if (++commits === 2) throw new Error('injected handoff failure');
  } });
  await service.transition(registration(service, opened));
  const request = registration(service, service.snapshot(opened.previewId), {
    operationId: 'pending-reconnect', instanceId: 'target-frame', dirty: true, baseRevision: 0, data: { durable: true },
  });
  await assert.rejects(service.transition(request), { code: 'PREVIEW_RECOVERING' });
  const artifact = service.builds.artifact;
  service.builds.artifact = () => { throw Object.assign(new Error('target artifact unavailable'), { code: 'BUILD_NOT_AVAILABLE' }); };
  let recovered;
  try {
    recovered = await service.recover({ serverEpoch: service.serverEpoch, previewId: opened.previewId,
      operationId: request.operationId, clientId: request.next.clientId });
  } finally { service.builds.artifact = artifact; }
  assert.equal(recovered.status, 'reconnect_required');
  assert.equal(recovered.state.nextStep, 'recover_preview');
  assert.equal(recovered.state.lease, null);
  const reconnectTarget = recovered.state.reconnectTarget;
  const target = path.join(directory, 'other-project'); await cp(project, target, { recursive: true });
  await assert.rejects(service.openProject({ preview_id: opened.previewId, project_path: target }), { code: 'PREVIEW_REQUIRES_DRAIN' });
  const unchanged = service.snapshot(opened.previewId);
  assert.equal(unchanged.projectId, opened.projectId);
  assert.deepEqual(unchanged.reconnectTarget, reconnectTarget);
  assert.equal(unchanged.leaseEpoch, recovered.state.leaseEpoch);
  assert.deepEqual(await service.storage.read(project), { revision: 1, data: { durable: true } });
  assert.equal((await service.openProject({ preview_id: opened.previewId, project_path: project })).nextStep, 'recover_preview');
  if (finish === 'reconnect') {
    await assert.rejects(service.transition(registration(service, service.snapshot(opened.previewId), {
      operationId: 'foreign-reconnect', clientId: 'foreign-client', instanceId: 'foreign-frame',
    })), { code: 'PREVIEW_IN_USE' });
    const attached = await service.transition(registration(service, service.snapshot(opened.previewId), {
      operationId: 'confirmed-reconnect', clientId: request.next.clientId, instanceId: 'reconnected-frame',
    }));
    assert.deepEqual(attached.storage, { revision: 1, data: { durable: true } });
    assert.equal(service.snapshot(opened.previewId).reconnectTarget, null);
  } else {
    const closed = await service.closeIdle(opened.previewId, { serverEpoch: service.serverEpoch,
      expectedLeaseEpoch: unchanged.leaseEpoch, confirmed: true });
    assert.equal(closed.storageTouched, false);
    const next = await service.openProject({ project_path: target, create_new: true });
    assert.notEqual(next.previewId, opened.previewId);
    assert.notEqual(next.projectId, opened.projectId);
    assert.deepEqual(await service.storage.read(project), { revision: 1, data: { durable: true } });
  }
});

test('expired exact responses and later takeovers never rebase snapshots or return an old lease as current', async (t) => {
  const { service, opened } = await setup(t, { contexts: { maxOperations: 1 } });
  const firstRequest = registration(service, opened);
  const first = await service.transition(firstRequest);
  const secondRequest = registration(service, service.snapshot(opened.previewId), { operationId: 'second', instanceId: 'second' });
  const second = await service.transition(secondRequest);
  await assert.rejects(service.transition(firstRequest), (error) => error.code === 'TRANSITION_OUTCOME_UNKNOWN' && error.details.committed);
  const expired = await service.operation(opened.previewId, firstRequest.operationId);
  assert.equal(expired.status, 'unknown'); assert.equal(expired.committed, true);
  assert.equal(expired.currentIdentity.instanceId, 'second');
  const takeover = await service.transition(registration(service, service.snapshot(opened.previewId), { takeover: true, clientId: 'other', instanceId: 'third', operationId: 'third' }));
  const old = await service.operation(opened.previewId, secondRequest.operationId);
  assert.equal(old.currentIdentity.clientId, 'other');
  assert.notEqual(old.currentIdentity.leaseEpoch, first.identity.leaseEpoch);
  assert.equal(service.snapshot(opened.previewId).lease.leaseEpoch, takeover.identity.leaseEpoch);
  assert.equal(second.identity.instanceId, 'second');
});

test('normal storage acknowledgements can be reconciled without replaying a new snapshot', async (t) => {
  const { service, opened } = await setup(t);
  const frame = await service.transition(registration(service, opened));
  const write = { ...frame.identity, operationId: 'write', baseRevision: 0, data: { value: 1 } };
  await service.commitStorage(write);
  const found = await service.operation(opened.previewId, 'write');
  assert.equal(found.status, 'committed');
  assert.equal(found.result.committedRevision, 1);
  assert.equal(found.result.replayed, true);
  assert.equal(Object.hasOwn(found.result, 'data'), false);
  await assert.rejects(service.commitStorage({ ...write, data: {} }), { code: 'STORAGE_OPERATION_CONFLICT' });
});

test('device changes require the current owner, persist, and do not touch another preview', async (t) => {
  const { service, opened, project } = await setup(t);
  const sibling = await service.openProject({ project_path: project, create_new: true });
  const frame = await service.transition(registration(service, opened));
  await assert.rejects(service.setDevice(opened.previewId, { deviceId: '375x667', serverEpoch: service.serverEpoch, expectedLeaseEpoch: frame.identity.leaseEpoch, clientId: 'other' }), { code: 'STALE_FRAME' });
  const changed = await service.setDevice(opened.previewId, { deviceId: '375x667', serverEpoch: service.serverEpoch, expectedLeaseEpoch: frame.identity.leaseEpoch, clientId: frame.identity.clientId });
  assert.equal(changed.deviceId, '375x667');
  assert.equal(service.snapshot(sibling.previewId).deviceId, '390x844');
});

test('close metadata failure stays recovering and completes without a second storage commit', async (t) => {
  const { service, opened, context, project } = await setup(t);
  const frame = await service.transition(registration(service, opened));
  const statePath = path.join(context.dataDir, 'preview-state-v2.json');
  const moved = `${statePath}.saved`;
  await rename(statePath, moved); await mkdir(statePath);
  const input = { ...frame.identity, operationId: 'close-recover', dirty: true, baseRevision: 0, data: { final: true } };
  await assert.rejects(service.drain(input, { close: true }), (error) => error.code === 'PREVIEW_RECOVERING' && error.details.committed);
  await assert.rejects(service.commitStorage({ ...frame.identity, operationId: 'late', baseRevision: 1, data: {} }), { code: 'PREVIEW_RECOVERING' });
  assert.equal((await service.operation(opened.previewId, input.operationId)).status, 'recovering');
  await rm(statePath, { recursive: true }); await rename(moved, statePath);
  const result = await service.recover({ serverEpoch: service.serverEpoch, previewId: opened.previewId, operationId: input.operationId, clientId: frame.identity.clientId });
  assert.equal(result.closed, true);
  assert.deepEqual(await service.storage.read(project), { revision: 1, data: { final: true } });
  assert.deepEqual((await service.operation(opened.previewId, input.operationId)).result, result);
});

test('evicted close tombstones return not found and cannot be replayed as a fresh context', async (t) => {
  const { service, opened, project } = await setup(t, { contexts: { maxTombstones: 1 } });
  const first = await service.transition(registration(service, opened));
  await service.drain({ ...first.identity, operationId: 'closed-first', dirty: false }, { close: true });
  const second = await service.openProject({ project_path: project, create_new: true });
  await service.drain({ serverEpoch: service.serverEpoch, previewId: second.previewId, projectId: second.projectId, expectedLeaseEpoch: 0, operationId: 'closed-second', dirty: false }, { close: true });
  await assert.rejects(service.operation(opened.previewId, 'closed-first'), { code: 'PREVIEW_CONTEXT_NOT_FOUND' });
  await assert.rejects(service.transition(registration(service, opened, { operationId: 'reanimate' })), { code: 'PREVIEW_CONTEXT_NOT_FOUND' });
  assert.deepEqual(service.list().previews, []);
});

test('detach replay after a new attachment is a committed stale result, never a new detach', async (t) => {
  const { service, opened } = await setup(t);
  const frame = await service.transition(registration(service, opened));
  const input = { ...frame.identity, operationId: 'once-detach', dirty: false };
  await service.drain(input, { detach: true });
  const attached = await service.transition(registration(service, service.snapshot(opened.previewId), { operationId: 'later-attach', instanceId: 'current' }));
  await assert.rejects(service.drain(input, { detach: true }), (error) => error.code === 'STALE_FRAME' && error.details.committed);
  assert.equal(service.snapshot(opened.previewId).lease.instanceId, attached.identity.instanceId);
  const prior = await service.operation(opened.previewId, 'once-detach');
  assert.equal(prior.result.detached, true);
  assert.equal(prior.currentIdentity.instanceId, 'current');
});

test('replaced project identity prevents reading a previously closed result containing project data', async (t) => {
  const { service, opened, project } = await setup(t);
  const frame = await service.transition(registration(service, opened));
  const input = { ...frame.identity, operationId: 'close-with-data', dirty: true, baseRevision: 0, data: { privateValue: true } };
  await service.drain(input, { close: true });
  await rename(project, project + '-previous'); await mkdir(project);
  await assert.rejects(service.operation(opened.previewId, input.operationId), { code: 'PROJECT_ACCESS_CHANGED' });
  await assert.rejects(service.drain(input, { close: true }), { code: 'PROJECT_ACCESS_CHANGED' });
});

test('an operation awaiting the project queue revalidates directory identity before committing', async (t) => {
  const { service, opened, project } = await setup(t);
  const frame = await service.transition(registration(service, opened));
  let unblock;
  let entered;
  const ready = new Promise((resolve) => { entered = resolve; });
  const blocked = service.storage.withProjectTransaction(project, (tx) => tx.read(), { validate: async () => {
    entered(); await new Promise((resolve) => { unblock = resolve; });
  } });
  await ready;
  const pending = service.commitStorage({ ...frame.identity, operationId: 'queued', baseRevision: 0, data: { denied: true } });
  await new Promise((resolve) => setTimeout(resolve, 15));
  await rename(project, project + '-previous'); await mkdir(project); unblock();
  await blocked;
  await assert.rejects(pending, { code: 'PROJECT_ACCESS_CHANGED' });
  assert.deepEqual(await service.storage.read(project), { revision: 0, data: {} });
});

test('watch references stop after the last SSE leaves while the unresolved frame pin remains', async (t) => {
  const { service, opened } = await setup(t, { builds: { releaseGraceMs: 10 } });
  const frame = await service.transition(registration(service, opened));
  const first = await service.subscribe(opened.previewId, () => {});
  const second = await service.subscribe(opened.previewId, () => {});
  first.dispose();
  assert.equal(service.snapshot(opened.previewId).connected, true);
  second.dispose(); second.dispose();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(service.builds.inspect().projects[0].references, 0);
  assert.equal(service.builds.inspect().projects[0].watching, false);
  assert.equal(service.builds.inspect().artifacts.find((item) => item.key.endsWith(frame.identity.buildId)).pins, 1);
  assert.ok(await service.artifact(opened.previewId, opened.projectId, frame.identity.buildId));
});

test('confirmed force-close can terminate a recovering preview without replaying the failed handoff', async (t) => {
  const { service, opened, project } = await setup(t, { afterStorageCommit: () => { throw new Error('handoff fault'); } });
  await assert.rejects(service.transition(registration(service, opened)), { code: 'PREVIEW_RECOVERING' });
  const state = service.snapshot(opened.previewId);
  const result = await service.forceClose({ serverEpoch: service.serverEpoch, previewId: opened.previewId, projectId: opened.projectId, expectedLeaseEpoch: state.leaseEpoch, operationId: 'abort-recovery', confirmed: true });
  assert.equal(result.closed, true); assert.equal(result.saved, false);
  assert.ok(service.builds.inspect().artifacts.every((item) => item.pins === 0));
  assert.deepEqual(await service.storage.read(project), { revision: 0, data: {} });
});

test('legacy storage changes are visible without overwriting authoritative v2 data', async (t) => {
  const { service, opened, project, context } = await setup(t);
  const { createProjectStorage } = await import('../miniapp/node/project-storage.mjs');
  const legacy = await createProjectStorage(context.dataDir);
  await legacy.write(project, { before: true });
  const first = await service.transition(registration(service, opened));
  assert.deepEqual(first.storage.data, { before: true });
  await legacy.write(project, { afterDowngrade: true });
  const data = await service.readStorage(opened.previewId);
  assert.deepEqual(data.data, { before: true });
  assert.equal(data.warnings[0].code, 'LEGACY_STORAGE_DIVERGED');
});

test('authenticated document snapshots keep a pinned old build immutable and reject other frame identities', async (t) => {
  const { service, opened, project } = await setup(t);
  await writeFile(path.join(project, 'miniprogram/document.png'), 'old-bytes');
  await service.rebuild(opened.previewId);
  const frame = await service.transition(registration(service, service.snapshot(opened.previewId)));
  await writeFile(path.join(project, 'miniprogram/document.png'), 'new-bytes');
  await service.rebuild(opened.previewId);
  const document = await service.snapshotDocument(frame.identity);
  assert.equal(document.artifact.buildId, frame.identity.buildId);
  assert.equal(document.assets.find((item) => item.path === 'document.png').bytes.toString(), 'old-bytes');
  document.assets[0].bytes.fill(0);
  assert.equal((await service.snapshotDocument(frame.identity)).assets.find((item) => item.path === 'document.png').bytes.toString(), 'old-bytes');
  await assert.rejects(service.snapshotDocument({ ...frame.identity, clientId: 'foreign-window' }), { code: 'STALE_FRAME' });
  await assert.rejects(service.rebuild(opened.previewId, { serverEpoch: 'old-epoch' }), { code: 'STALE_FRAME' });
  assert.equal(service.snapshot(opened.previewId).lease.instanceId, frame.identity.instanceId);
});

test('switching a preview does not erase an unavailable previous project identity or affect the healthy target', async (t) => {
  const { service, opened, project, directory } = await setup(t);
  const nextPath = path.join(directory, 'still-available'); await cp(project, nextPath, { recursive: true });
  const target = await service.registerProjectResult(nextPath);
  const frame = await service.transition(registration(service, opened));
  await service.drain({ ...frame.identity, operationId: 'switch-before-replacement', dirty: false }, { nextProjectId: target.projectId });
  await rename(project, project + '-previous'); await mkdir(project);
  await assert.rejects(service.access(project), { code: 'PROJECT_ACCESS_CHANGED' });
  assert.equal(service.snapshot(opened.previewId).projectId, target.projectId);
  assert.equal(service.list().previews.length, 1);
  const attached = await service.transition(registration(service, service.snapshot(opened.previewId), { operationId: 'target-open', instanceId: 'target' }));
  assert.equal(attached.identity.projectId, target.projectId);
  assert.equal(service.revoke, undefined);
});

test('force-close cannot reuse a storage or frame operation ID with a different action', async (t) => {
  const { service, opened } = await setup(t);
  const frame = await service.transition(registration(service, opened));
  await service.commitStorage({ ...frame.identity, operationId: 'already-written', baseRevision: 0, data: { saved: true } });
  const request = { serverEpoch: service.serverEpoch, previewId: opened.previewId, projectId: opened.projectId, expectedLeaseEpoch: frame.identity.leaseEpoch, confirmed: true };
  await assert.rejects(service.forceClose({ ...request, operationId: 'already-written' }), { code: 'OPERATION_ID_REUSED' });
  await assert.rejects(service.forceClose({ ...request, operationId: 'register-a' }), { code: 'OPERATION_ID_REUSED' });
  assert.equal(service.snapshot(opened.previewId).lease.instanceId, frame.identity.instanceId);
  assert.equal((await service.operation(opened.previewId, 'already-written')).result.committedRevision, 1);
  const closed = await service.forceClose({ ...request, operationId: 'new-force-close' });
  assert.equal(closed.closed, true);
  assert.deepEqual(await service.forceClose({ ...request, operationId: 'new-force-close' }), closed);
});

test('storage operation identities remain reserved across project switches and include the drain behavior', async (t) => {
  const { service, opened, project, directory } = await setup(t);
  const frame = await service.transition(registration(service, opened));
  const write = { ...frame.identity, operationId: 'original-storage', baseRevision: 0, data: { saved: true } };
  await service.commitStorage(write);
  await assert.rejects(service.commitStorage({ ...write, drain: true }), { code: 'STORAGE_OPERATION_CONFLICT' });
  const nextPath = path.join(directory, 'next'); await cp(project, nextPath, { recursive: true });
  const next = await service.registerProjectResult(nextPath);
  await service.drain({ ...frame.identity, operationId: 'change-project', dirty: false }, { nextProjectId: next.projectId });
  const state = service.snapshot(opened.previewId);
  await assert.rejects(service.transition(registration(service, state, { operationId: 'original-storage', instanceId: 'must-not-open' })), { code: 'OPERATION_ID_REUSED' });
  await assert.rejects(service.forceClose({ previewId: state.previewId, projectId: state.projectId, serverEpoch: service.serverEpoch, expectedLeaseEpoch: state.leaseEpoch, operationId: 'original-storage', confirmed: true }), { code: 'OPERATION_ID_REUSED' });
  assert.equal((await service.operation(opened.previewId, 'original-storage')).result.committedRevision, 1);
  const newFrame = await service.transition(registration(service, state, { operationId: 'new-target-frame', instanceId: 'new-target' }));
  await assert.rejects(service.commitStorage({ ...newFrame.identity, operationId: 'original-storage', baseRevision: 0, data: {} }), { code: 'STORAGE_OPERATION_CONFLICT' });
});

test('force-close releases a replaced or deleted project without accessing its business storage', async (t) => {
  const { service, opened, project, context } = await setup(t);
  const frame = await service.transition(registration(service, opened));
  await service.commitStorage({ ...frame.identity, operationId: 'before-replacement', baseRevision: 0, data: { keepPrivate: true } });
  await rename(project, `${project}-old`); await cp(`${project}-old`, project, { recursive: true });
  await assert.rejects(service.readStorage(opened.previewId), { code: 'PROJECT_ACCESS_CHANGED' });
  const storageDir = path.join(context.dataDir, 'project-storage-v2');
  await rename(storageDir, `${storageDir}-old`); await mkdir(storageDir);
  const input = { serverEpoch: service.serverEpoch, previewId: opened.previewId, projectId: opened.projectId, expectedLeaseEpoch: frame.identity.leaseEpoch, operationId: 'management-close', confirmed: true };
  await assert.rejects(service.forceClose({ ...input, operationId: 'before-replacement' }), { code: 'OPERATION_ID_REUSED' });
  const result = await service.forceClose(input);
  assert.equal(result.closed, true); assert.equal(result.saved, false); assert.equal(Object.hasOwn(result, 'storage'), false);
  assert.deepEqual(await service.forceClose(input), result);
  assert.deepEqual((await service.operation(opened.previewId, input.operationId)).result, result);
  assert.ok(service.builds.inspect().artifacts.every((item) => item.pins === 0));
});

test('log sequence stays monotonic across project switches while old project entries are discarded', async (t) => {
  const { service, opened, project, directory } = await setup(t);
  const frame = await service.transition(registration(service, opened));
  await service.appendLogs(frame.identity, [{ message: 'old-one' }, { message: 'old-two' }]);
  const cursor = service.logs(opened.previewId).lastSeq;
  const nextPath = path.join(directory, 'new-log-project'); await cp(project, nextPath, { recursive: true });
  const target = await service.registerProjectResult(nextPath);
  await service.drain({ ...frame.identity, operationId: 'switch-logs', dirty: false }, { nextProjectId: target.projectId });
  const next = await service.transition(registration(service, service.snapshot(opened.previewId), { operationId: 'new-logs', instanceId: 'new-logs' }));
  await service.appendLogs(next.identity, [{ message: 'new-only' }]);
  const recovered = service.logs(opened.previewId, { afterSeq: cursor });
  assert.equal(recovered.entries.length, 1); assert.equal(recovered.entries[0].message, 'new-only');
  assert.ok(recovered.entries[0].seq > cursor);
  assert.equal(service.logs(opened.previewId).entries.length, 1);
});

test('confirmed storage exports bind the selected project and server epoch without flushing or writing', async (t) => {
  const { service, opened, project, directory } = await setup(t);
  const frame = await service.transition(registration(service, opened));
  await service.commitStorage({ ...frame.identity, operationId: 'export-saved', baseRevision: 0, data: { confirmed: 1 } });
  const expected = { projectId: opened.projectId, serverEpoch: service.serverEpoch };
  const exported = await service.readStorage(opened.previewId, undefined, expected);
  assert.deepEqual(exported, { ok: true, revision: 1, data: { confirmed: 1 }, previewId: opened.previewId, ...expected });
  assert.equal(service.snapshot(opened.previewId).leaseEpoch, frame.identity.leaseEpoch);
  await assert.rejects(service.readStorage(opened.previewId, undefined, { ...expected, serverEpoch: 'old' }), { code: 'STALE_FRAME' });
  const targetPath = path.join(directory, 'export-target'); await cp(project, targetPath, { recursive: true });
  const target = await service.registerProjectResult(targetPath);
  await service.drain({ ...frame.identity, operationId: 'export-switch', dirty: false }, { nextProjectId: target.projectId });
  await assert.rejects(service.readStorage(opened.previewId, undefined, expected), { code: 'STALE_FRAME' });
  assert.deepEqual(await service.readStorage(opened.previewId), { ok: true, revision: 0, data: {} });
});
