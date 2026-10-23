import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProjectBuilds } from '../miniapp/node/project-builds.mjs';

const delay = (time) => new Promise((resolve) => setTimeout(resolve, time));
async function eventually(predicate, diagnostics) {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) { if (predicate()) return; await delay(10); }
  assert.ok(predicate(), 'Expected preview state did not arrive before the deadline.' + (diagnostics ? `\n${JSON.stringify(diagnostics(), null, 2)}` : ''));
}
async function setup(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'preview-builds-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let revision = 0;
  let calls = 0;
  let activeCompiles = 0;
  let maxActiveCompiles = 0;
  let compileWait = 0;
  const events = [];
  const compilationInputs = [];
  const { contentAddressed = false, ...buildOptions } = options;
  const compile = async (root) => {
    calls++;
    maxActiveCompiles = Math.max(maxActiveCompiles, ++activeCompiles);
    const selectedRevision = revision;
    const bytes = await readFile(path.join(root, 'asset.png'));
    const assetHash = createHash('sha256').update(bytes).digest('hex');
    compilationInputs.push({ revision: selectedRevision, bytes: bytes.length, sha256: assetHash, watching: builds.inspect().projects[0].watching });
    if (compileWait) await delay(compileWait);
    activeCompiles--;
    return { project: { projectDir: root, sourceRoot: root }, buildId: contentAddressed ? `build-${selectedRevision}-${assetHash.slice(0, 16)}` : `build-${selectedRevision}`,
      payload: { marker: selectedRevision }, css: '', errors: [], warnings: [], manifest: { pages: ['index'] },
      assets: [{ path: 'asset.png', bytes: bytes.length, sha256: assetHash }] };
  };
  await writeFile(path.join(directory, 'asset.png'), 'first');
  const builds = createProjectBuilds({ compile, onEvent: (projectId, state) => events.push({ projectId, state }), releaseGraceMs: 20, debounceMs: 10, ...buildOptions });
  builds.register({ id: 'a', path: directory, name: 'A' });
  t.after(() => builds.dispose());
  return { directory, builds, events, compilationInputs, calls: () => calls, maxActiveCompiles: () => maxActiveCompiles, change: () => revision++, wait: (value) => { compileWait = value; } };
}

test('P02/P07: previews share a project watcher and release only their own reference', async (t) => {
  const env = await setup(t);
  await env.builds.acquire('a', 'preview-1');
  await env.builds.acquire('a', 'preview-2');
  assert.equal(env.maxActiveCompiles(), 1);
  assert.equal(env.builds.inspect().projects[0].watcherCount, 1);
  assert.equal(env.builds.inspect().projects[0].references, 2);
  env.builds.release('a', 'preview-1');
  await delay(30);
  assert.equal(env.builds.inspect().projects[0].watching, true);
  env.builds.release('a', 'preview-2');
  await delay(30);
  assert.equal(env.builds.inspect().projects[0].watching, false);
});

test('P09: pinned older builds keep immutable assets across repeated writes and recompile', async (t) => {
  const env = await setup(t);
  await env.builds.rebuild('a');
  env.builds.pin('a', 'build-0', 'preview-A');
  await writeFile(path.join(env.directory, 'asset.png'), 'second'); env.change();
  await env.builds.rebuild('a');
  env.builds.pin('a', 'build-1', 'preview-B');
  await writeFile(path.join(env.directory, 'asset.png'), 'third'); env.change();
  await env.builds.rebuild('a');
  assert.equal(env.builds.asset('a', 'build-0', 'asset.png').toString(), 'first');
  assert.equal(env.builds.asset('a', 'build-1', 'asset.png').toString(), 'second');
  assert.equal(env.builds.asset('a', 'build-2', 'asset.png').toString(), 'third');
  assert.equal(env.builds.asset('a', 'build-0', '../asset.png'), null);
});

test('P09: capacity refuses a new build rather than evicting active frames; releasing a pin permits recovery', async (t) => {
  const env = await setup(t, { maxBuilds: 2 });
  await env.builds.rebuild('a'); env.builds.pin('a', 'build-0', 'old'); env.change();
  await env.builds.rebuild('a'); env.builds.pin('a', 'build-1', 'current'); env.change();
  assert.equal((await env.builds.rebuild('a')).errors[0].code, 'BUILD_CAPACITY_REACHED');
  assert.ok(env.builds.artifact('a', 'build-0'));
  assert.ok(env.builds.artifact('a', 'build-1'));
  env.builds.unpin('old');
  assert.equal((await env.builds.rebuild('a')).status, 'ok');
  assert.ok(env.builds.artifact('a', 'build-2'));
});

test('a change admitted during a build triggers a subsequent build and one project cannot consume another project reference', async (t) => {
  const env = await setup(t, { maxProjects: 1 });
  env.wait(20);
  const first = env.builds.rebuild('a');
  await delay(5); env.change();
  await env.builds.rebuild('a'); await first;
  assert.equal(env.calls(), 2);
  assert.equal(env.builds.snapshot('a').buildId, 'build-1');
  await env.builds.acquire('a', 'preview-a');
  const second = path.join(env.directory, 'second'); await mkdir(second); await writeFile(path.join(second, 'asset.png'), 'second');
  env.builds.register({ id: 'b', path: second, name: 'B' });
  await assert.rejects(env.builds.acquire('b', 'preview-b'), { code: 'PROJECT_CAPACITY_REACHED' });
  assert.equal(env.builds.inspect().projects.find((item) => item.projectId === 'a').references, 1);
});

test('assets changed after compilation are not installed as immutable build content', async (t) => {
  const env = await setup(t);
  env.wait(25);
  const build = env.builds.rebuild('a');
  await delay(10); await writeFile(path.join(env.directory, 'asset.png'), 'replaced');
  const result = await build;
  assert.equal(result.status, 'error');
  assert.equal(result.errors[0].code, 'PROJECT_CHANGED');
  assert.throws(() => env.builds.artifact('a', 'build-0'), { code: 'BUILD_NOT_AVAILABLE' });
});

test('P07: reconnect after grace rebuilds changed files and restarts the shared watcher', async (t) => {
  const env = await setup(t);
  await env.builds.acquire('a', 'preview-a');
  env.builds.release('a', 'preview-a');
  await eventually(() => !env.builds.inspect().projects[0].watching);
  await writeFile(path.join(env.directory, 'asset.png'), 'while-detached'); env.change();
  const state = await env.builds.acquire('a', 'preview-a');
  assert.equal(state.status, 'ok');
  assert.equal(state.buildId, 'build-1');
  assert.equal(env.builds.asset('a', 'build-1', 'asset.png').toString(), 'while-detached');
  assert.equal(env.builds.inspect().projects[0].watching, true);
});

test('P02: simultaneous subscribers await a single build and file changes trigger one shared rebuild', async (t) => {
  const env = await setup(t, { contentAddressed: true });
  const diagnostic = () => ({ calls: env.calls(), inputs: env.compilationInputs, inspect: env.builds.inspect(), state: env.builds.snapshot('a'), events: env.events });
  env.wait(25);
  const states = await Promise.all([env.builds.acquire('a', 'preview-a'), env.builds.acquire('a', 'preview-b')]);
  assert.ok(states.every((state) => state.status === 'ok'));
  assert.equal(states[0].generation, states[1].generation);
  assert.equal(env.maxActiveCompiles(), 1);
  assert.equal(env.builds.inspect().projects[0].watcherCount, 1);
  assert.equal(env.compilationInputs[0].watching, true, 'The shared watcher must exist before the initial compiler reads the source snapshot.');
  env.wait(0); env.change();
  await writeFile(path.join(env.directory, 'asset.png'), 'watch-update');
  const buildId = `build-1-${createHash('sha256').update('watch-update').digest('hex').slice(0, 16)}`;
  await eventually(() => env.builds.snapshot('a').buildId === buildId && env.builds.snapshot('a').status === 'ok', diagnostic);
  assert.equal(env.builds.asset('a', buildId, 'asset.png').toString(), 'watch-update');
  assert.ok(env.calls() >= 2);
  assert.equal(env.builds.inspect().projects[0].references, 2);
});

test('P02: truncate and final-write events use distinct content fingerprints and recover to final bytes', async (t) => {
  const env = await setup(t, { contentAddressed: true });
  const diagnostic = () => ({ calls: env.calls(), inputs: env.compilationInputs, inspect: env.builds.inspect(), state: env.builds.snapshot('a'), events: env.events });
  await Promise.all([env.builds.acquire('a', 'preview-a'), env.builds.acquire('a', 'preview-b')]);
  env.change();
  const file = await open(path.join(env.directory, 'asset.png'), 'w');
  try {
    // Holding the empty file makes the intermediate watch event observable,
    // rather than assuming writeFile emits just one final-content event.
    await eventually(() => env.compilationInputs.some((input) => input.revision === 1 && input.bytes === 0), diagnostic);
    await file.writeFile('watch-update');
  } finally { await file.close(); }
  const expected = `build-1-${createHash('sha256').update('watch-update').digest('hex').slice(0, 16)}`;
  await eventually(() => env.builds.snapshot('a').status === 'ok' && env.builds.snapshot('a').buildId === expected, diagnostic);
  assert.equal(env.builds.asset('a', expected, 'asset.png').toString(), 'watch-update');
  assert.ok(!env.events.some((event) => event.state.errors?.some((error) => error.code === 'BUILD_ID_COLLISION')));
  assert.equal(env.builds.inspect().projects[0].references, 2);
});

test('P09: external callers cannot mutate a pinned artifact or its resource bytes', async (t) => {
  const env = await setup(t);
  await env.builds.rebuild('a'); env.builds.pin('a', 'build-0', 'active');
  const result = env.builds.artifact('a', 'build-0');
  result.payload.marker = 99; result.assets[0].sha256 = 'bad';
  const bytes = env.builds.asset('a', 'build-0', 'asset.png');
  bytes.fill(0);
  assert.equal(env.builds.artifact('a', 'build-0').payload.marker, 0);
  assert.equal(env.builds.asset('a', 'build-0', 'asset.png').toString(), 'first');
});

test('P09: an inconsistent compiler cannot replace an already pinned build under the same ID', async (t) => {
  const env = await setup(t);
  await env.builds.rebuild('a'); env.builds.pin('a', 'build-0', 'active');
  await writeFile(path.join(env.directory, 'asset.png'), 'different-but-same-id');
  const result = await env.builds.rebuild('a');
  assert.equal(result.errors[0].code, 'BUILD_ID_COLLISION');
  assert.equal(env.builds.asset('a', 'build-0', 'asset.png').toString(), 'first');
  assert.equal(env.builds.inspect().artifacts[0].pins, 1);
});

test('P09: payload-only builds and excessive asset counts cannot bypass per-build quotas', async (t) => {
  const base = { project: {}, buildId: 'payload', payload: { text: 'x'.repeat(500) }, css: '', errors: [], warnings: [], manifest: {} };
  const env = await setup(t, { maxBuildBytes: 400, compile: async (root) => ({ ...base, project: { sourceRoot: root }, assets: [] }) });
  assert.equal((await env.builds.rebuild('a')).errors[0].code, 'BUILD_TOO_LARGE');
  assert.equal(env.builds.inspect().artifacts.length, 0);
  const another = await setup(t, { maxAssets: 1, compile: async (root) => ({ ...base, project: { sourceRoot: root }, assets: [{ path: 'a' }, { path: 'b' }] }) });
  assert.equal((await another.builds.rebuild('a')).errors[0].code, 'BUILD_TOO_LARGE');
});

test('P09: failed capacity admission does not delete unrelated unpinned builds', async (t) => {
  const env = await setup(t, { maxBytes: 1800 });
  await env.builds.rebuild('a'); env.change(); await env.builds.rebuild('a');
  assert.equal(env.builds.inspect().artifacts.length, 2);
  await writeFile(path.join(env.directory, 'asset.png'), 'x'.repeat(2000)); env.change();
  assert.equal((await env.builds.rebuild('a')).errors[0].code, 'BUILD_CAPACITY_REACHED');
  assert.equal(env.builds.inspect().artifacts.length, 2);
  assert.ok(env.builds.artifact('a', 'build-0'));
  assert.ok(env.builds.artifact('a', 'build-1'));
});

test('snapshot refuses linked assets or source roots outside the registered project', async (t) => {
  const env = await setup(t);
  const external = path.join(env.directory, 'external.png');
  await writeFile(external, 'first');
  await rm(path.join(env.directory, 'asset.png'));
  await symlink(external, path.join(env.directory, 'asset.png'));
  assert.equal((await env.builds.rebuild('a')).errors[0].code, 'INVALID_BUILD_ASSET');
  assert.equal(env.builds.inspect().artifacts.length, 0);
  const other = await setup(t, { compile: async () => ({ project: { sourceRoot: os.tmpdir() }, buildId: 'outside', payload: {}, css: '', errors: [], warnings: [], assets: [], manifest: {} }) });
  assert.equal((await other.builds.rebuild('a')).errors[0].code, 'INVALID_BUILD_ASSET');
});

test('dispose awaits in-flight compilation and does not resurrect watchers or artifacts', async (t) => {
  const env = await setup(t);
  env.wait(25);
  const result = env.builds.rebuild('a');
  await delay(5);
  await env.builds.dispose(); await result;
  assert.equal(env.builds.inspect().artifacts.length, 0);
  assert.equal(env.builds.inspect().projects.length, 0);
  await assert.rejects(env.builds.acquire('a', 'preview-a'), { code: 'PREVIEW_STOPPING' });
  assert.throws(() => env.builds.register({ id: 'b', path: env.directory }), { code: 'PREVIEW_STOPPING' });
});

test('reconnecting during grace keeps one watcher and removes the pending release timer', async (t) => {
  const env = await setup(t, { releaseGraceMs: 80 });
  await env.builds.acquire('a', 'first');
  env.builds.release('a', 'first');
  await env.builds.acquire('a', 'second');
  await delay(100);
  assert.equal(env.builds.inspect().projects[0].watching, true);
  assert.equal(env.builds.inspect().projects[0].references, 1);
});

test('removing a project during a late failing build neither resurrects it nor emits to an absent record', async (t) => {
  const env = await setup(t, { compile: async () => { await delay(20); throw new Error('late failure'); } });
  const pending = env.builds.rebuild('a');
  await delay(5);
  env.builds.remove('a');
  await env.builds.dispose();
  await pending;
  assert.equal(env.builds.inspect().projects.length, 0);
  assert.equal(env.builds.inspect().artifacts.length, 0);
});

test('one preview pin may move to a new build without releasing another preview pin', async (t) => {
  const env = await setup(t);
  await env.builds.rebuild('a');
  env.builds.pin('a', 'build-0', 'preview-a'); env.builds.pin('a', 'build-0', 'preview-b');
  env.change(); await env.builds.rebuild('a');
  env.builds.pin('a', 'build-1', 'preview-a');
  const old = env.builds.inspect().artifacts.find((value) => value.key === 'a/build-0');
  const current = env.builds.inspect().artifacts.find((value) => value.key === 'a/build-1');
  assert.equal(old.pins, 1); assert.equal(current.pins, 1);
  env.builds.unpin('preview-b');
  assert.equal(env.builds.inspect().artifacts.find((value) => value.key === 'a/build-0').pins, 0);
  assert.equal(env.builds.inspect().artifacts.find((value) => value.key === 'a/build-1').pins, 1);
});

test('automatic rebuild diagnostics preserve bounded ambiguous-root candidates and counts', async (t) => {
  const candidates = Array.from({ length: 25 }, (_, index) => `/fixture/candidate-${index}`);
  const env = await setup(t, { compile: async () => { throw Object.assign(new Error('Choose a project root.'), {
    code: 'AMBIGUOUS_PROJECT_ROOT', file: 'project.config.json', line: 2, column: 3, candidates, candidateCount: 40, truncated: true,
  }); } });
  const state = await env.builds.rebuild('a');
  assert.equal(state.status, 'error');
  assert.deepEqual(state.errors[0].candidates, candidates.slice(0, 20));
  assert.equal(state.errors[0].candidateCount, 40); assert.equal(state.errors[0].truncated, true);
  assert.equal(state.errors[0].line, 2); assert.equal(state.errors[0].column, 3);
});
