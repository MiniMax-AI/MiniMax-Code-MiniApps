import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createPreviewService } from '../miniapp/node/preview-service.mjs';

const pluginRoot = fileURLToPath(new URL('../', import.meta.url));
let sequence = 0;
const operation = () => 'game-operation-' + ++sequence;
async function setup(t, options) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'game-service-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const context = { pluginRoot, dataDir: path.join(root, 'state') };
  const service = await createPreviewService(context, options);
  t.after(() => service.dispose());
  return { root, context, service };
}
async function attach(service, state, clientId, previous) {
  return service.transition({ action: previous ? 'reload' : 'attach', previewId: state.previewId, projectId: state.projectId,
    serverEpoch: state.serverEpoch, expectedLeaseEpoch: previous?.leaseEpoch ?? state.leaseEpoch, operationId: operation(),
    next: { buildId: state.build.buildId, clientId, instanceId: operation() }, ...(previous ? { previous } : {}), dirty: false });
}

test('a Mini Program and both bundled Mini Games coexist without shared control, route, diagnostics or ownership', async (t) => {
  const { service } = await setup(t);
  const program = await service.demo({ create_new: true });
  const game2d = await service.demo({ example: 'minigame-2d', create_new: true });
  const game3d = await service.demo({ example: 'minigame-webgl', create_new: true });
  for (const state of [program, game2d, game3d]) assert.equal(state.build.status, 'ok', JSON.stringify(state.build.errors));
  assert.equal(program.projectKind, 'miniprogram'); assert.equal(game2d.projectKind, 'minigame'); assert.equal(game3d.projectKind, 'minigame');
  assert.equal(game2d.capabilities.pageNavigation, false); assert.equal(game2d.capabilities.gameControls, true);
  assert.equal(service.list().previews.length, 3);
  assert.equal(service.list().previews.every((preview) => ['miniprogram', 'minigame'].includes(preview.projectKind)), true);
  const p = await attach(service, program, 'program'); const a = await attach(service, game2d, 'game2d'); const b = await attach(service, game3d, 'game3d');
  await service.route(p.identity, 'pages/detail/detail');
  await service.controlGame(game2d.previewId, 'pause', { ...a.identity, action: 'pause' });
  await service.gameState(a.identity, { paused: true, reason: 'user', framesPerSecond: 30 });
  assert.equal(service.snapshot(game2d.previewId).gameState.paused, true);
  assert.equal(service.snapshot(game3d.previewId).gameState, null);
  assert.equal(service.snapshot(program.previewId).gameState, null);
  assert.equal(service.snapshot(game2d.previewId).command.type, 'game-control');
  assert.equal(service.snapshot(game3d.previewId).command, null);
  assert.equal(service.snapshot(program.previewId).route, 'pages/detail/detail');
  await service.appendLogs(b.identity, [{ level: 'warn', message: 'only WebGL game' }]);
  assert.equal(service.logs(game2d.previewId).entries.length, 0);
  assert.equal(service.logs(program.previewId).entries.length, 0);
  assert.equal(service.logs(game3d.previewId).entries.length, 1);
  await assert.rejects(service.navigate(game2d.previewId, 'pages/index/index'), { code: 'UNSUPPORTED_PROJECT_ACTION' });
  await assert.rejects(service.route(a.identity, 'pages/index/index'), { code: 'UNSUPPORTED_PROJECT_ACTION' });
  await assert.rejects(service.controlGame(program.previewId, 'pause'), { code: 'UNSUPPORTED_PROJECT_ACTION' });
  await assert.rejects(service.gameState(p.identity, { paused: true }), { code: 'UNSUPPORTED_PROJECT_ACTION' });
});

test('game controls and state reject wrong instance, project, build, lease and server epoch', async (t) => {
  const { service } = await setup(t);
  const opened = await service.demo({ example: 'minigame-2d' });
  await assert.rejects(service.controlGame(opened.previewId, 'pause'), { code: 'NO_ACTIVE_FRAME' });
  const first = await attach(service, opened, 'game');
  for (const patch of [{ instanceId: 'old-instance' }, { clientId: 'other-client' }, { projectId: 'wrong-project' }, { buildId: 'wrong-build' }, { leaseEpoch: 0 }, { serverEpoch: 'previous-process' }]) {
    await assert.rejects(service.controlGame(opened.previewId, 'resume', { ...first.identity, ...patch }), { code: 'STALE_FRAME' });
    await assert.rejects(service.gameState({ ...first.identity, ...patch }, { paused: false }), { code: 'STALE_FRAME' });
  }
  await service.gameState(first.identity, { paused: true, reason: 'user' });
  await service.controlGame(opened.previewId, 'restart', first.identity);
  assert.equal(service.snapshot(opened.previewId).command.type, 'reload');
  const second = await attach(service, service.snapshot(opened.previewId), 'game', first.identity);
  assert.equal(service.snapshot(opened.previewId).gameState, null);
  await assert.rejects(service.gameState(first.identity, { paused: true }), { code: 'STALE_FRAME' });
  await service.gameState(second.identity, { paused: false });
  await service.drain({ ...second.identity, operationId: operation(), dirty: false }, { detach: true });
  assert.equal(service.snapshot(opened.previewId).gameState, null);
  await assert.rejects(service.controlGame(opened.previewId, 'resume'), { code: 'NO_ACTIVE_FRAME' });
});

test('latest build guards also apply to Agent game controls while old frame may only drain Storage', async (t) => {
  const { service, root } = await setup(t);
  const project = path.join(root, 'game'); await cp(path.join(pluginRoot, 'miniapp/node/demo-game-2d'), project, { recursive: true });
  const opened = await service.openProject({ project_path: project, ...{ project_kind: 'minigame' } });
  const first = await attach(service, opened, 'game');
  await writeFile(path.join(project, 'game.js'), (await readFile(path.join(project, 'game.js'), 'utf8')) + '\n// new build');
  const rebuilt = await service.rebuild(opened.previewId);
  assert.notEqual(rebuilt.build.buildId, first.identity.buildId);
  await assert.rejects(service.controlGame(opened.previewId, 'pause'), { code: 'STALE_BUILD' });
  await assert.rejects(service.controlGame(opened.previewId, 'pause', first.identity), { code: 'STALE_BUILD' });
  await assert.rejects(service.gameState(first.identity, { paused: false }), { code: 'STALE_BUILD' });
  await assert.rejects(service.commitStorage({ ...first.identity, operationId: operation(), baseRevision: 0, data: { score: 1 } }), { code: 'STALE_BUILD' });
  const saved = await service.commitStorage({ ...first.identity, operationId: operation(), baseRevision: 0, data: { score: 2 }, drain: true });
  assert.equal(saved.committedRevision, 1);
});

test('same-root game/program retain old program IDs, partition builds, share canonical Storage and restore kinds', async (t) => {
  const { service, root, context } = await setup(t);
  const project = path.join(root, 'dual'); await mkdir(project);
  const sources = { 'app.json': '{"pages":["index"],"lazyCodeLoading":"requiredComponents"}', 'app.js': 'App({});', 'index.js': 'Page({});', 'index.wxml': '<text>program</text>', 'game.json': '{}', 'game.js': 'GameGlobal.kind="game";' };
  for (const [name, source] of Object.entries(sources)) await writeFile(path.join(project, name), source);
  await assert.rejects(service.registerProjectResult(project), { code: 'AMBIGUOUS_PROJECT_KIND' });
  assert.deepEqual(await service.access.list(), []);
  const program = await service.openProject({ project_path: project, ...{ create_new: true, project_kind: 'miniprogram' } });
  const game = await service.openProject({ project_path: project, create_new: true, project_kind: 'minigame' });
  assert.equal(program.projectId, createHash('sha1').update(project).digest('hex').slice(0, 12));
  assert.equal(game.projectId, createHash('sha1').update(project + '\0minigame').digest('hex').slice(0, 12));
  assert.notEqual(program.build.buildId, game.build.buildId);
  assert.equal((await service.artifact(game.previewId, game.projectId, game.build.buildId).catch(() => null)), null);
  const a = await attach(service, program, 'program'); const b = await attach(service, game, 'game');
  await service.commitStorage({ ...a.identity, operationId: operation(), baseRevision: 0, data: { shared: 'canonical-root' } });
  await assert.rejects(service.commitStorage({ ...b.identity, operationId: operation(), baseRevision: 0, data: { stale: true } }), { code: 'STORAGE_CONFLICT' });
  const restored = await attach(service, service.snapshot(game.previewId), 'game', b.identity);
  assert.deepEqual(restored.storage.data, { shared: 'canonical-root' });
  await service.dispose();
  const restarted = await createPreviewService(context); t.after(() => restarted.dispose());
  assert.equal(restarted.snapshot(program.previewId).projectKind, 'miniprogram');
  assert.equal(restarted.snapshot(game.previewId).projectKind, 'minigame');
  assert.equal(restarted.snapshot(game.previewId).lease, null);
  assert.equal(restarted.snapshot(game.previewId).gameState, null);
  const fresh = await restarted.openProject({ preview_id: game.previewId, project_id: game.projectId });
  assert.equal(fresh.build.projectKind, 'minigame');
});

test('program-to-game and game-to-program handoffs clear stale route commands and game state', async (t) => {
  const { service } = await setup(t);
  const program = await service.demo({ create_new: true }); const game = await service.demo({ example: 'minigame-2d', create_new: true });
  const a = await attach(service, program, 'client'); await service.navigate(program.previewId, 'pages/detail/detail');
  const switched = await service.drain({ ...a.identity, operationId: operation(), dirty: false }, { nextProjectId: game.projectId });
  assert.equal(switched.state.projectKind, 'minigame'); assert.equal(switched.state.route, ''); assert.equal(switched.state.requestedRoute, null);
  const b = await attach(service, switched.state, 'client'); await service.gameState(b.identity, { paused: true });
  const back = await service.drain({ ...b.identity, operationId: operation(), dirty: false }, { nextProjectId: program.projectId });
  assert.equal(back.state.projectKind, 'miniprogram'); assert.equal(back.state.gameState, null); assert.equal(back.state.route, ''); assert.equal(back.state.requestedRoute, null);
});

test('legacy project descriptors without kind stay miniprogram and cannot be rebound to game under the old ID', async (t) => {
  const { service, context, root } = await setup(t);
  const project = path.join(root, 'old-program'); await cp(path.join(pluginRoot, 'miniapp/node/demo'), project, { recursive: true });
  const opened = await service.openProject({ project_path: project });
  await service.dispose();
  const file = path.join(context.dataDir, 'preview-state-v2.json');
  const stored = JSON.parse(await readFile(file, 'utf8'));
  for (const item of stored.projects) delete item.projectKind;
  await writeFile(file, JSON.stringify(stored));
  const restored = await createPreviewService(context); t.after(() => restored.dispose());
  assert.equal(restored.snapshot(opened.previewId).projectKind, 'miniprogram');
  assert.equal(restored.snapshot(opened.previewId).projectId, opened.projectId);
  await assert.rejects(restored.previews.registerProject({ ...restored.previews.project(opened.projectId), projectKind: 'minigame' }), { code: 'PROJECT_CHANGED' });
  assert.throws(() => restored.builds.register({ ...restored.previews.project(opened.projectId), projectKind: 'minigame' }), { code: 'PROJECT_CHANGED' });
  const build = await restored.openProject({ project_id: opened.projectId, preview_id: opened.previewId });
  assert.equal(build.build.manifest.projectKind, 'miniprogram');
});

test('an Agent game command queued behind takeover cannot acquire the new frame identity implicitly', async (t) => {
  const { service } = await setup(t);
  const opened = await service.demo({ example: 'minigame-2d' });
  const first = await attach(service, opened, 'original');
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const hold = service.previews.queue(opened.previewId, () => waiting);
  const takeover = service.transition({ action: 'takeover', previewId: opened.previewId, projectId: opened.projectId, serverEpoch: opened.serverEpoch,
    expectedLeaseEpoch: first.identity.leaseEpoch, operationId: operation(), next: { buildId: first.identity.buildId, clientId: 'new-owner', instanceId: 'new-frame' }, dirty: false });
  const stale = service.controlGame(opened.previewId, 'pause');
  const denied = assert.rejects(stale, { code: 'STALE_FRAME' });
  release(); await hold; await takeover; await denied;
  assert.equal(service.snapshot(opened.previewId).command, null);
  assert.equal((await service.controlGame(opened.previewId, 'pause')).accepted, true);
});
