import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { ASSET_EXTENSIONS, collectProjectSnapshot, compileProject, COMPILER_FINGERPRINT, GAME_RUNTIME_VERSION, resolveProject } from '../miniapp/node/compiler.mjs';

async function fixture(t, files = {}) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'minigame-compiler-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (file, source) => { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), source); };
  for (const [file, source] of Object.entries(files)) await put(file, source);
  return { root, put };
}
const nativeProgram = { 'app.json': '{"pages":["index"],"lazyCodeLoading":"requiredComponents"}', 'app.js': 'App({});', 'index.js': 'Page({});', 'index.wxml': '<view>mini program</view>' };
const nativeGame = { 'game.json': '{}', 'game.js': 'GameGlobal.marker = "game";' };

function load(build, globals = {}) {
  const context = vm.createContext(globals), cache = new Map();
  const require = (id) => {
    if (cache.has(id)) return cache.get(id).exports;
    const module = { exports: {} }; cache.set(id, module);
    assert.equal(typeof build.payload.modules[id], 'string', id);
    const local = (spec) => {
      const relative = path.posix.normalize(path.posix.join(path.posix.dirname(id), spec));
      const bases = spec.startsWith('/') ? [spec.slice(1)] : spec.startsWith('.') ? [relative] : [relative, spec, 'miniprogram_npm/' + spec];
      const target = bases.flatMap((base) => [base, base + '.js', base + '.wxs', base + '.json', base + '/index.js']).find((name) => Object.hasOwn(build.payload.modules, name));
      assert.ok(target, 'missing ' + spec); return require(target);
    };
    vm.runInContext(`(function(require,module,exports){${build.payload.modules[id]}\n})`, context)(local, module, module.exports);
    return module.exports;
  };
  return { require, context };
}

test('game.json discovery compiles a real dependency graph and exposes a discriminated game payload', async (t) => {
  const f = await fixture(t, {
    'game.json': '{/* local config */"deviceOrientation":"landscape"}',
    'game.js': 'import {value} from "./lib/value"; const data=require("./data.json"); GameGlobal.result=value+data.offset;',
    'lib/value.js': 'export const value=2;', 'data.json': '{"offset":3}',
    'unused.js': 'invalid code !!!!!', 'art.png': 'image',
  });
  const project = await resolveProject(f.root);
  assert.equal(project.projectKind, 'minigame');
  const build = await compileProject(f.root);
  assert.deepEqual(build.errors, []);
  assert.equal(build.payload.projectKind, 'minigame');
  assert.equal(build.payload.runtimeVersion, GAME_RUNTIME_VERSION);
  assert.equal(build.payload.entryModule, 'game.js');
  assert.deepEqual(build.payload.game, { deviceOrientation: 'landscape' });
  assert.deepEqual(build.manifest, { projectKind: 'minigame', projectName: path.basename(f.root), pages: [], entryPage: null, game: { deviceOrientation: 'landscape' }, componentCount: 0 });
  assert.equal(build.css, '');
  assert.equal(Object.hasOwn(build.payload, 'units'), false);
  assert.equal(Object.hasOwn(build.payload.modules, 'unused.js'), false);
  assert.equal(build.warnings.some((warning) => warning.code === 'NONSTANDARD_JSON_COMMENT'), true);
  const runtime = load(build, { GameGlobal: {} }); runtime.require(build.payload.entryModule);
  assert.equal(runtime.context.GameGlobal.result, 5);
  assert.deepEqual(build.assets.map((asset) => asset.path), ['art.png']);
});

test('TypeScript game entry aliases once and explicit/extensionless TS imports share one module instance', async (t) => {
  const f = await fixture(t, {
    'game.json': '{}',
    'game.ts': 'import type {NoRuntime} from "./unavailable-type"; import {state} from "./shared"; import {state as same} from "./shared.ts"; const npm=require("lib"); GameGlobal.result={value:state.value+ npm, shared:state===same};',
    'shared.ts': 'export const state: {value:number}={value:4};',
    'types.d.ts': 'declare const ignored: true;', 'miniprogram_npm/lib/index.js': 'module.exports=5;',
  });
  const build = await compileProject(f.root);
  assert.deepEqual(build.errors, []);
  assert.equal(build.payload.entryModule, 'game.js');
  assert.match(build.payload.modules['game.js'], /require\("\.\/game.ts"\)/);
  assert.equal(Object.hasOwn(build.payload.modules, 'types.d.ts'), false);
  const runtime = load(build, { GameGlobal: {} }); runtime.require('game.js');
  assert.equal(runtime.context.GameGlobal.result.value, 9);
  assert.equal(runtime.context.GameGlobal.result.shared, true);
  assert.equal(runtime.require('shared.js'), runtime.require('shared.ts'));
});

test('auto respects explicit compileType; both marker files require a kind hint and conflicting hints fail', async (t) => {
  const f = await fixture(t, { ...nativeProgram, ...nativeGame });
  await assert.rejects(resolveProject(f.root), (error) => error.code === 'AMBIGUOUS_PROJECT_KIND' && error.choices.join(',') === 'miniprogram,minigame');
  assert.equal((await resolveProject(f.root, { projectKind: 'miniprogram' })).projectKind, 'miniprogram');
  assert.equal((await resolveProject(f.root, { projectKind: 'minigame' })).projectKind, 'minigame');
  await f.put('project.config.json', '{"compileType":"game"}');
  assert.equal((await resolveProject(f.root)).projectKind, 'minigame');
  await assert.rejects(resolveProject(f.root, { projectKind: 'miniprogram' }), { code: 'PROJECT_KIND_MISMATCH', configuredKind: 'minigame' });
  await f.put('project.config.json', '{"compileType":"miniprogram"}');
  assert.equal((await resolveProject(f.root)).projectKind, 'miniprogram');
  await f.put('project.config.json', '{"compileType":"plugin"}');
  await assert.rejects(resolveProject(f.root), { code: 'UNSUPPORTED_PROJECT_KIND' });
});

test('explicit-kind marker mismatch does not silently find an unrelated child project', async (t) => {
  const f = await fixture(t, { ...nativeProgram, 'child/game.json': '{}', 'child/game.js': 'GameGlobal.ok=true;' });
  await assert.rejects(resolveProject(f.root, { projectKind: 'minigame' }), { code: 'PROJECT_KIND_MISMATCH', choices: ['miniprogram'] });
  for (const projectKind of ['game', '', {}, ['minigame'], null]) await assert.rejects(resolveProject(f.root, { projectKind }), { code: 'INVALID_PROJECT_KIND' });
  const gameOnly = await fixture(t, nativeGame);
  await gameOnly.put('project.config.json', '{"compileType":"miniprogram"}');
  await assert.rejects(resolveProject(gameOnly.root), { code: 'PROJECT_KIND_MISMATCH' });
});

test('configured root, unique direct child and safe fallback support games without broadening discovery', async (t) => {
  const f = await fixture(t, { 'project.config.json': '{"compileType":"game","miniprogramRoot":"games/current"}', 'games/current/game.json': '{}', 'games/current/game.js': 'GameGlobal.ok=true;' });
  assert.equal((await resolveProject(f.root)).sourceRoot, path.join(f.root, 'games/current'));
  const child = await fixture(t, { 'child/game.json': '{}', 'child/game.js': 'GameGlobal.ok=true;' });
  assert.equal((await resolveProject(child.root)).sourceRoot, path.join(child.root, 'child'));
  await child.put('project.config.json', '{"compileType":"game","miniprogramRoot":"missing"}');
  const build = await compileProject(child.root);
  assert.equal(build.warnings.some((warning) => warning.code === 'PROJECT_ROOT_FALLBACK'), true);
  assert.equal(await readFile(path.join(child.root, 'project.config.json'), 'utf8'), '{"compileType":"game","miniprogramRoot":"missing"}');
  await child.put('other/app.json', nativeProgram['app.json']);
  await assert.rejects(resolveProject(child.root, { projectKind: 'minigame' }), { code: 'AMBIGUOUS_PROJECT_ROOT', candidateCount: 2 });
});

test('game roots and markers retain symlink, escape and sensitive-directory rejection', async (t) => {
  const outside = await fixture(t, nativeGame), f = await fixture(t, { ...nativeGame, 'project.config.json': JSON.stringify({ compileType: 'game', miniprogramRoot: outside.root }) });
  await assert.rejects(resolveProject(f.root), /escapes/);
  await symlink(outside.root, path.join(f.root, 'linked'), 'dir');
  await f.put('project.config.json', '{"compileType":"game","miniprogramRoot":"linked"}');
  await assert.rejects(resolveProject(f.root), /escapes/);
  await f.put('project.config.json', '{"compileType":"game","miniprogramRoot":".ssh"}');
  await assert.rejects(resolveProject(f.root), { code: 'PROJECT_PATH_FORBIDDEN' });
  const marker = await fixture(t); await symlink(path.join(outside.root, 'game.json'), path.join(marker.root, 'game.json'));
  await assert.rejects(resolveProject(marker.root), { code: 'INVALID_PROJECT' });
});

test('game config remains strict, missing entry and reachable dependency failures are build errors', async (t) => {
  const f = await fixture(t, { 'game.json': '{"deviceOrientation":"upside-down"}' });
  let build = await compileProject(f.root);
  assert.equal(build.errors.some((error) => error.file === 'game.json' && error.code === 'INVALID_CONFIG'), true);
  assert.equal(build.errors.some((error) => error.file === 'game.js' && error.code === 'MISSING_MODULE'), true);
  await f.put('game.json', 'null'); build = await compileProject(f.root);
  assert.equal(build.errors.some((error) => error.file === 'game.json' && error.code === 'INVALID_CONFIG'), true);
  await f.put('game.json', '{\n/*comment*/\n"deviceOrientation":"portrait",\n}'); build = await compileProject(f.root);
  assert.equal(build.errors.some((error) => error.code === 'INVALID_JSON' && error.line === 4), true);
  await f.put('game.json', '{}'); await f.put('game.js', 'require("./missing");'); build = await compileProject(f.root);
  assert.equal(build.errors.some((error) => error.code === 'MISSING_MODULE' && error.file === 'game.js'), true);
  await f.put('missing.js', 'export const broken = ;'); build = await compileProject(f.root);
  assert.equal(build.errors.some((error) => error.code === 'MODULE_SYNTAX_ERROR' && error.file === 'missing.js'), true);
});

test('subpackage, worker, open-data, WASM and plugin configs report limits without claiming they execute', async (t) => {
  const f = await fixture(t, { ...nativeGame,
    'game.json': JSON.stringify({ subpackages: [{ root: 'sub', name: 'sub' }], workers: 'worker', openDataContext: 'open', wasm: true, plugins: {}, showStatusBar: true }),
    'worker/index.js': 'const broken = ;', 'open/index.js': 'invalid() !', 'sub/game.js': 'invalid() !',
    'module.wasm': 'not a wasm', 'private.bin': 'not a supported asset',
  });
  const build = await compileProject(f.root);
  assert.deepEqual(build.errors, []);
  assert.deepEqual(build.warnings.map((warning) => warning.code), ['MINIGAME_SUBPACKAGES_UNSUPPORTED', 'MINIGAME_WORKERS_UNSUPPORTED', 'MINIGAME_OPEN_DATA_UNSUPPORTED', 'MINIGAME_WASM_UNSUPPORTED', 'MINIGAME_PLUGINS_UNSUPPORTED', 'MINIGAME_STATUS_BAR_LIMITED']);
  assert.equal(build.payload.game.showStatusBar, true);
  assert.deepEqual(Object.keys(build.payload.modules), ['game.js']);
  assert.equal(ASSET_EXTENSIONS.has('.wasm'), false); assert.equal(ASSET_EXTENSIONS.has('.bin'), false);
  assert.deepEqual(build.assets, []);
});

test('game compilation never executes project code and preserves bounded dynamic dependency policy', async (t) => {
  const f = await fixture(t, { ...nativeGame, 'game.js': 'while(true){}; const alias=require; GameGlobal.x=alias("./"+name);', 'data.ts': 'export const x: number=1;' });
  const build = await compileProject(f.root);
  assert.deepEqual(build.errors, []);
  assert.equal(build.warnings.some((warning) => warning.code === 'DYNAMIC_DEPENDENCY'), true);
  assert.equal(typeof build.payload.modules['data.ts'], 'string');
  assert.match(build.payload.modules['game.js'], /while\(true\)/);
});

test('kind and game runtime version partition source/build identities while rc2 mini-program fields are preserved', async (t) => {
  const f = await fixture(t, { ...nativeProgram, ...nativeGame, 'image.png': 'first' });
  const programSnapshot = await collectProjectSnapshot(f.root, { projectKind: 'miniprogram' });
  const gameSnapshot = await collectProjectSnapshot(f.root, { projectKind: 'minigame' });
  assert.notEqual(programSnapshot.sourceHash, gameSnapshot.sourceHash);
  assert.ok(COMPILER_FINGERPRINT.includes(`game-runtime@${GAME_RUNTIME_VERSION}`));
  const program = await compileProject(f.root, { snapshot: programSnapshot, projectKind: 'miniprogram' });
  const game = await compileProject(f.root, { snapshot: gameSnapshot, projectKind: 'minigame' });
  assert.notEqual(program.buildId, game.buildId);
  assert.equal(program.payload.projectKind, 'miniprogram');
  assert.deepEqual(program.payload.pages, ['index']); assert.equal(program.payload.entryPage, 'index');
  assert.equal(program.manifest.componentCount, 0); assert.equal(program.manifest.projectKind, 'miniprogram');
  assert.ok(program.payload.units.index); assert.ok(program.payload.templates.index); assert.equal(program.payload.tabBar, null);
  await assert.rejects(compileProject(f.root, { snapshot: gameSnapshot, projectKind: 'miniprogram' }), { code: 'PROJECT_KIND_MISMATCH' });
  const asset = path.join(f.root, 'image.png'); await utimes(asset, 1600000000, 1600000000); const before = await compileProject(f.root, { projectKind: 'minigame' });
  const info = await stat(asset); await f.put('image.png', 'other'); await utimes(asset, info.atime, info.mtime);
  const after = await compileProject(f.root, { projectKind: 'minigame' }); assert.notEqual(after.buildId, before.buildId);
});
