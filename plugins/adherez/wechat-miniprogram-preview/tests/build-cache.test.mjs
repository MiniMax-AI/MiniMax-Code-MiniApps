import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createBuildCache } from '../miniapp/node/build-cache.mjs';
import { createProjectBuilds } from '../miniapp/node/project-builds.mjs';
import { collectProjectSnapshot, compileProject, COMPILER_FINGERPRINT } from '../miniapp/node/compiler.mjs';

const hash = (text) => createHash('sha256').update(text).digest('hex');
const artifact = (marker = 1) => ({ buildId: `build-${marker}`, payload: { marker }, css: 'view{}', errors: [], warnings: [], assets: [], manifest: { pages: ['index'] } });
async function setup(t, options = {}) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'preview-build-cache-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectPath = path.join(root, 'project');
  const dataDir = path.join(root, 'data');
  await mkdir(projectPath);
  const request = { projectPath, compilerFingerprint: 'compiler-1:engine-1:bridge-1', sourceHash: hash('source') };
  const cache = await createBuildCache(dataDir, options);
  t.after(() => cache.dispose());
  const file = async (value = request) => path.join(dataDir, 'build-cache', ...(await cache.key(value)).key.split('/'), 'artifact.json');
  return { root, projectPath, dataDir, cache, request, file };
}

test('K01: cache hit persists across restart and returns detached compile artifacts', async (t) => {
  const f = await setup(t);
  assert.equal((await f.cache.lookup(f.request)).status, 'miss');
  assert.equal((await f.cache.store(f.request, artifact())).status, 'stored');
  const first = await f.cache.lookup(f.request);
  assert.equal(first.status, 'hit');
  first.artifact.payload.marker = 99;
  assert.equal((await f.cache.lookup(f.request)).artifact.payload.marker, 1);
  const restarted = await createBuildCache(f.dataDir);
  t.after(() => restarted.dispose());
  assert.equal((await restarted.lookup(f.request)).status, 'hit');
  assert.equal(restarted.inspect().hits, 1);
  assert.equal(restarted.inspect().entries.length, 1);
});

test('K02: compiler, engine, bridge, and source fingerprints invalidate independently', async (t) => {
  const f = await setup(t);
  await f.cache.store(f.request, artifact());
  for (const compilerFingerprint of ['compiler-2:engine-1:bridge-1', 'compiler-1:engine-2:bridge-1', 'compiler-1:engine-1:bridge-2']) {
    assert.equal((await f.cache.lookup({ ...f.request, compilerFingerprint })).status, 'invalidated');
  }
  assert.equal((await f.cache.lookup({ ...f.request, sourceHash: hash('updated-source') })).status, 'miss');
  assert.equal((await f.cache.lookup(f.request)).status, 'hit');
  assert.equal(f.cache.inspect().invalidated, 3);
});

test('K02: corrupt artifact content is rejected, removed, and can be compiled again', async (t) => {
  const f = await setup(t);
  await f.cache.store(f.request, artifact());
  const file = await f.file();
  const corrupted = JSON.parse(await readFile(file, 'utf8'));
  corrupted.artifact.payload.marker = 999;
  await writeFile(file, JSON.stringify(corrupted));
  assert.equal((await f.cache.lookup(f.request)).status, 'corrupt');
  assert.equal((await f.cache.lookup(f.request)).status, 'miss');
  assert.equal((await f.cache.store(f.request, artifact(2))).status, 'stored');
  assert.equal((await f.cache.lookup(f.request)).artifact.payload.marker, 2);
});

test('K03: LRU evicts unreferenced cache entries but active pins can fill the quota', async (t) => {
  const f = await setup(t, { maxEntries: 2 });
  const second = { ...f.request, sourceHash: hash('second') };
  const third = { ...f.request, sourceHash: hash('third') };
  const firstStored = await f.cache.store(f.request, artifact(1));
  const secondStored = await f.cache.store(second, artifact(2));
  f.cache.pin(firstStored.key, 'preview-old');
  f.cache.pin(secondStored.key, 'preview-current');
  assert.equal((await f.cache.store(third, artifact(3))).status, 'capacity');
  assert.equal((await f.cache.lookup(f.request)).status, 'hit');
  f.cache.unpin('preview-current');
  assert.equal((await f.cache.store(third, artifact(3))).status, 'stored');
  assert.equal((await f.cache.lookup(f.request)).status, 'hit');
  assert.equal((await f.cache.lookup(second)).status, 'miss');
  assert.equal((await f.cache.lookup(third)).status, 'hit');
  assert.equal(f.cache.inspect().entries.length, 2);
});

test('K03: byte quota rejects an oversized entry without deleting existing cached builds', async (t) => {
  const f = await setup(t, { maxBytes: 1200 });
  await f.cache.store(f.request, artifact());
  const huge = artifact(2); huge.payload.text = 'x'.repeat(1500);
  assert.equal((await f.cache.store({ ...f.request, sourceHash: hash('huge') }, huge)).status, 'capacity');
  assert.equal((await f.cache.lookup(f.request)).status, 'hit');
  const restarted = await createBuildCache(f.dataDir, { maxBytes: 10 });
  t.after(() => restarted.dispose());
  assert.equal(restarted.inspect().entries.length, 0);
});

test('cache never follows substituted directories or files and does not touch business state', async (t) => {
  const f = await setup(t);
  await f.cache.store(f.request, artifact());
  const file = await f.file();
  const outside = path.join(f.root, 'outside.json');
  const content = await readFile(file);
  await writeFile(outside, content);
  await rm(file); await symlink(outside, file);
  assert.equal((await f.cache.lookup(f.request)).status, 'corrupt');
  assert.deepEqual(await readFile(outside), content);
  const stateFile = path.join(f.dataDir, 'project-access.json');
  await writeFile(stateFile, '{"preserve":"business-state"}');
  const cacheRoot = path.join(f.dataDir, 'build-cache');
  await rename(cacheRoot, path.join(f.root, 'old-cache'));
  await symlink(path.join(f.root, 'old-cache'), cacheRoot, 'dir');
  assert.equal((await f.cache.lookup(f.request)).status, 'unavailable');
  assert.equal((await f.cache.store(f.request, artifact())).status, 'unavailable');
  assert.equal(await readFile(stateFile, 'utf8'), '{"preserve":"business-state"}');
});

test('cache removes interrupted temporary entries and rejects project-containing artifacts', async (t) => {
  const f = await setup(t);
  await f.cache.store(f.request, artifact());
  const parent = path.dirname(path.dirname(await f.file()));
  const temporary = path.join(parent, `.tmp-${randomUUID()}`);
  await mkdir(temporary); await writeFile(path.join(temporary, 'artifact.json'), '{broken');
  const restarted = await createBuildCache(f.dataDir);
  t.after(() => restarted.dispose());
  assert.equal((await restarted.lookup(f.request)).status, 'hit');
  assert.equal(restarted.inspect().entries.length, 1);
  assert.equal((await restarted.store({ ...f.request, sourceHash: hash('private') }, { ...artifact(), project: { path: '/private' } })).status, 'unavailable');
  assert.ok(!(await readdir(parent)).some((name) => name.startsWith('.tmp-')));
});

async function nativeProject(root) {
  await mkdir(path.join(root, 'pages'), { recursive: true });
  await writeFile(path.join(root, 'app.json'), JSON.stringify({ pages: ['pages/index'], lazyCodeLoading: 'requiredComponents' }));
  await writeFile(path.join(root, 'app.js'), 'App({})');
  await writeFile(path.join(root, 'pages/index.js'), 'Page({data:{count:1}})');
  await writeFile(path.join(root, 'pages/index.wxml'), '<view>{{count}}</view><image src="/image.png"/>');
  await writeFile(path.join(root, 'image.png'), 'image-one');
}

test('K01/K02 integration: lookup skips expensive transform, survives restart, and image changes miss', async (t) => {
  const f = await setup(t);
  await nativeProject(f.projectPath);
  let transforms = 0;
  const compile = async (...args) => { transforms++; return compileProject(...args); };
  const options = { dataDir: f.dataDir, collectSnapshot: collectProjectSnapshot, compile };
  const builds = createProjectBuilds(options);
  t.after(() => builds.dispose());
  builds.register({ id: 'project', path: f.projectPath, name: 'Cache project' });
  const cold = await builds.rebuild('project');
  assert.equal(cold.status, 'ok');
  assert.equal(cold.cache.status, 'miss');
  assert.equal(cold.cache.storeStatus, 'stored');
  const warm = await builds.rebuild('project');
  assert.equal(warm.cache.status, 'hit');
  assert.equal(transforms, 1);
  assert.equal(warm.buildId, cold.buildId);
  await builds.dispose();
  const restarted = createProjectBuilds(options);
  t.after(() => restarted.dispose());
  restarted.register({ id: 'project', path: f.projectPath, name: 'Cache project' });
  assert.equal((await restarted.rebuild('project')).cache.status, 'hit');
  assert.equal(transforms, 1);
  restarted.pin('project', cold.buildId, 'old-preview');
  await writeFile(path.join(f.projectPath, 'image.png'), 'image-two');
  const updated = await restarted.rebuild('project');
  assert.equal(updated.cache.status, 'miss');
  assert.notEqual(updated.buildId, cold.buildId);
  assert.equal(transforms, 2);
  assert.equal(restarted.asset('project', cold.buildId, 'image.png').toString(), 'image-one');
  assert.equal(restarted.asset('project', updated.buildId, 'image.png').toString(), 'image-two');
});

test('K03 integration: cache capacity cannot evict a live frame, even when memory has space', async (t) => {
  const f = await setup(t);
  await nativeProject(f.projectPath);
  const builds = createProjectBuilds({ dataDir: f.dataDir, cacheMaxEntries: 1 });
  t.after(() => builds.dispose());
  builds.register({ id: 'a', path: f.projectPath, name: 'A' });
  const first = await builds.rebuild('a');
  builds.pin('a', first.buildId, 'old-frame');
  assert.equal(builds.inspect().cache.entries[0].pins, 1);
  await writeFile(path.join(f.projectPath, 'pages/index.js'), 'Page({data:{count:2}})');
  const next = await builds.rebuild('a');
  assert.equal(next.status, 'ok');
  assert.equal(next.cache.storeStatus, 'capacity');
  assert.equal(builds.inspect().cache.entries.length, 1);
  assert.ok(builds.artifact('a', first.buildId));
  builds.unpin('old-frame');
  assert.equal((await builds.rebuild('a')).cache.storeStatus, 'stored');
  assert.equal(builds.inspect().cache.entries[0].pins, 0);
});

test('a corrupted on-disk cache recompiles without reading altered executable output', async (t) => {
  const f = await setup(t);
  await nativeProject(f.projectPath);
  let transforms = 0;
  const builds = createProjectBuilds({ dataDir: f.dataDir, collectSnapshot: collectProjectSnapshot, compile: async (...args) => { transforms++; return compileProject(...args); } });
  t.after(() => builds.dispose());
  builds.register({ id: 'a', path: f.projectPath, name: 'A' });
  await builds.rebuild('a');
  const key = builds.inspect().cache.entries[0].key;
  const file = path.join(f.dataDir, 'build-cache', ...key.split('/'), 'artifact.json');
  await writeFile(file, '{broken-cache');
  const recovered = await builds.rebuild('a');
  assert.equal(recovered.status, 'ok');
  assert.equal(recovered.cache.status, 'corrupt');
  assert.equal(recovered.cache.storeStatus, 'stored');
  assert.equal(transforms, 2);
  assert.equal(builds.inspect().cache.corrupt, 1);
  assert.equal((await builds.rebuild('a')).cache.status, 'hit');
});

test('version invalidation recompiles and inaccessible cache stays optional to project builds', async (t) => {
  const f = await setup(t);
  await nativeProject(f.projectPath);
  const first = createProjectBuilds({ dataDir: f.dataDir });
  first.register({ id: 'a', path: f.projectPath, name: 'A' });
  await first.rebuild('a'); await first.dispose();
  const next = createProjectBuilds({ dataDir: f.dataDir, compilerFingerprint: `${COMPILER_FINGERPRINT}:changed` });
  t.after(() => next.dispose());
  next.register({ id: 'a', path: f.projectPath, name: 'A' });
  assert.equal((await next.rebuild('a')).cache.status, 'invalidated');
  const cacheRoot = path.join(f.dataDir, 'build-cache');
  await rename(cacheRoot, path.join(f.root, 'previous-cache'));
  await symlink(path.join(f.root, 'previous-cache'), cacheRoot, 'dir');
  const withoutCache = createProjectBuilds({ dataDir: f.dataDir });
  t.after(() => withoutCache.dispose());
  withoutCache.register({ id: 'a', path: f.projectPath, name: 'A' });
  const built = await withoutCache.rebuild('a');
  assert.equal(built.status, 'ok');
  assert.equal(built.cache.status, 'unavailable');
});

test('a missing cache artifact is recovered after restart instead of becoming a permanent exists entry', async (t) => {
  const f = await setup(t);
  await f.cache.store(f.request, artifact());
  await rm(await f.file());
  const restarted = await createBuildCache(f.dataDir);
  t.after(() => restarted.dispose());
  assert.equal((await restarted.lookup(f.request)).status, 'corrupt');
  assert.equal((await restarted.store(f.request, artifact())).status, 'stored');
  assert.equal((await restarted.lookup(f.request)).status, 'hit');
});

test('warm lookup still rechecks project access and cannot bypass a changed project directory', async (t) => {
  const f = await setup(t);
  await nativeProject(f.projectPath);
  let allowed = true;
  const builds = createProjectBuilds({ dataDir: f.dataDir, assertProjectAccess: async () => {
    if (!allowed) throw Object.assign(new Error('Project directory identity changed.'), { code: 'PROJECT_ACCESS_CHANGED' });
  } });
  t.after(() => builds.dispose());
  builds.register({ id: 'a', path: f.projectPath, name: 'A' });
  assert.equal((await builds.rebuild('a')).status, 'ok');
  allowed = false;
  const blocked = await builds.rebuild('a');
  assert.equal(blocked.status, 'error');
  assert.equal(blocked.errors[0].code, 'PROJECT_ACCESS_CHANGED');
  assert.equal(builds.inspect().cache.hits, 0);
});

test('a live build pins only one equivalent disk entry across unrelated source-file edits', async (t) => {
  const f = await setup(t);
  await nativeProject(f.projectPath);
  const builds = createProjectBuilds({ dataDir: f.dataDir, cacheMaxEntries: 2 });
  t.after(() => builds.dispose());
  builds.register({ id: 'a', path: f.projectPath, name: 'A' });
  const initial = await builds.rebuild('a');
  builds.pin('a', initial.buildId, 'unchanged-frame');
  for (let n = 0; n < 4; n++) {
    await writeFile(path.join(f.projectPath, 'unused.js'), `const value = ${n}`);
    const latest = await builds.rebuild('a');
    assert.equal(latest.status, 'ok');
    assert.equal(latest.buildId, initial.buildId);
    assert.equal(latest.cache.storeStatus, 'stored');
  }
  assert.equal(builds.inspect().cache.entries.length, 2);
  assert.equal(builds.inspect().cache.entries.reduce((total, value) => total + value.pins, 0), 1);
  assert.equal(builds.inspect().artifacts.length, 1);
});

test('cache-hit artifacts are rejected when the collected source root identity changes before lookup completes', async (t) => {
  const f = await setup(t);
  await nativeProject(f.projectPath);
  let replace = false;
  const builds = createProjectBuilds({ dataDir: f.dataDir, collectSnapshot: async (projectPath) => {
    const snapshot = await collectProjectSnapshot(projectPath);
    if (replace) {
      await rename(projectPath, `${projectPath}-old`);
      await cp(`${projectPath}-old`, projectPath, { recursive: true });
    }
    return snapshot;
  } });
  t.after(() => builds.dispose());
  builds.register({ id: 'a', path: f.projectPath, name: 'A' });
  const initial = await builds.rebuild('a');
  assert.equal(initial.status, 'ok');
  builds.pin('a', initial.buildId, 'old-frame');
  replace = true;
  const result = await builds.rebuild('a');
  assert.equal(result.status, 'error'); assert.equal(result.errors[0].code, 'PROJECT_CHANGED');
  assert.ok(builds.artifact('a', initial.buildId));
  assert.equal(builds.inspect().artifacts[0].pins, 1);
});

test('same source root miniprogram and minigame builds have distinct reusable cache entries and no payload crossover', async (t) => {
  const f = await setup(t);
  await nativeProject(f.projectPath);
  await writeFile(path.join(f.projectPath, 'game.json'), '{"deviceOrientation":"landscape"}');
  await writeFile(path.join(f.projectPath, 'game.js'), 'GameGlobal.score=1;');
  const builds = createProjectBuilds({ dataDir: f.dataDir }); t.after(() => builds.dispose());
  builds.register({ id: 'program', path: f.projectPath, name: 'Program', projectKind: 'miniprogram' });
  builds.register({ id: 'game', path: f.projectPath, name: 'Game', projectKind: 'minigame' });
  const program = await builds.rebuild('program'), game = await builds.rebuild('game');
  assert.equal(program.status, 'ok'); assert.equal(game.status, 'ok');
  assert.equal(program.projectKind, 'miniprogram'); assert.equal(game.projectKind, 'minigame');
  assert.notEqual(program.buildId, game.buildId);
  assert.equal(builds.artifact('program', program.buildId).payload.projectKind, 'miniprogram');
  assert.equal(builds.artifact('game', game.buildId).payload.entryModule, 'game.js');
  assert.equal((await builds.rebuild('program')).cache.status, 'hit');
  assert.equal((await builds.rebuild('game')).cache.status, 'hit');
  assert.equal(builds.inspect().cache.entries.length, 2);
  assert.throws(() => builds.register({ id: 'program', path: f.projectPath, name: 'Rebound', projectKind: 'minigame' }), { code: 'PROJECT_CHANGED' });
});
