// @ts-check
// 规则修复：构建产物不在其他规则的目录和依赖安装目录里识别；__pycache__ 需要父目录有 .py 文件；新增 uv / pip / pnpm 缓存规则。
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../miniapp/node/app.mjs';
import { buildRuleIndex, buildRuleSpecs } from '../miniapp/node/rules.mjs';
import { CF } from '../miniapp/node/tree.mjs';
import { createPathOps } from '../miniapp/node/util.mjs';
import { fakeExec, fakeLogger, fakeRemove, makeTmp, removeTmp, writeFile } from './helpers.mjs';

/** @param {string} dir @param {(home: string) => Promise<void>} build */
async function scanFixture(dir, build) {
  const disk = path.join(dir, 'disk');
  const home = path.join(disk, 'home');
  await fsp.mkdir(home, { recursive: true });
  await build(home);
  const app = createApp({
    platform: 'darwin',
    env: {},
    home,
    tmpdir: path.join(disk, 'tmp'),
    fs: fsp,
    exec: fakeExec(),
    dataDir: path.join(dir, 'data'),
    logger: fakeLogger(),
    disks: async () => [{ id: 'mac-data', label: 'Fixture', mount: disk, totalBytes: 1e12, usedBytes: 1e9, freeBytes: 9e11, kind: 'internal', defaultScan: true, deletable: true }],
    remove: fakeRemove(),
    fullDiskAccess: async () => 'granted',
    runningApps: async () => new Set(),
    goModCache: async () => null,
    sizeOf: (st) => st.size,
  });
  await app.startScan({ diskIds: ['mac-data'] });
  await app.waitIdle();
  const items = [...(/** @type {any} */ (app.getModel())).items.values()];
  const rel = (/** @type {string} */ p) => path.relative(home, p);
  const byCat = (/** @type {string} */ c) => items.filter((it) => it.category === c).map((it) => rel(it.path)).sort();
  return { app, home, byCat };
}

test('构建产物不在其他规则命中的目录、node_modules、site-packages、.venv、venv 里单独成项', async (t) => {
  const dir = await makeTmp('artifacts-scope');
  t.after(() => removeTmp(dir));
  const { app, byCat } = await scanFixture(dir, async (home) => {
    const w = (/** @type {string} */ rel, /** @type {any} */ c = 'x') => writeFile(path.join(home, rel), c);
    // 新增的包管理器缓存：里面的 __pycache__ 都属于缓存本身
    await w('.cache/uv/archive-v0/abc/pkg/mod.py', 'x = 1');
    await w('.cache/uv/archive-v0/abc/pkg/__pycache__/mod.cpython-312.pyc', Buffer.alloc(30));
    await w('.cache/pip/http/x', Buffer.alloc(10));
    await w('.cache/pnpm/metadata/y', Buffer.alloc(10));
    // npx 临时包：里面的 node_modules 同级有 package.json，也不单独成项
    await w('.npm/_npx/1a2b/package.json', '{}');
    await w('.npm/_npx/1a2b/node_modules/cowsay/index.js', Buffer.alloc(30));
    // 应用缓存里的 target（同级有 Cargo.toml）
    await w('Library/Caches/com.foo/Cargo.toml', '[package]');
    await w('Library/Caches/com.foo/target/debug/app', Buffer.alloc(40));
    // 全局 node_modules：所在目录没有 package.json，它自己不算构建产物，但里面的 .next 和 __pycache__ 也不单独成项
    await w('.nvm/lib/node_modules/foo/package.json', '{}');
    await w('.nvm/lib/node_modules/foo/.next/cache/a', Buffer.alloc(20));
    await w('.nvm/lib/node_modules/foo/tools/x.py', 'x = 1');
    await w('.nvm/lib/node_modules/foo/tools/__pycache__/x.pyc', Buffer.alloc(20));
    // 项目里的 node_modules：本身是构建产物，里面的 __pycache__ 不单独成项
    await w('proj/package.json', '{}');
    await w('proj/node_modules/bar/gyp/a.py', 'x = 1');
    await w('proj/node_modules/bar/gyp/__pycache__/a.pyc', Buffer.alloc(20));
    // site-packages（不在虚拟环境里）
    await w('pyenv/lib/python3.12/site-packages/req/api.py', 'x = 1');
    await w('pyenv/lib/python3.12/site-packages/req/__pycache__/api.pyc', Buffer.alloc(20));
    // 没有 pyvenv.cfg 的 venv 目录，以及 .venv 虚拟环境
    await w('tool/venv/lib/m.py', 'x = 1');
    await w('tool/venv/lib/__pycache__/m.pyc', Buffer.alloc(20));
    await w('svc/.venv/pyvenv.cfg', 'home = /usr/bin');
    await w('svc/.venv/lib/x.py', 'x = 1');
    await w('svc/.venv/lib/__pycache__/x.pyc', Buffer.alloc(20));
    // 对照：普通 Python 项目里的 __pycache__ 照常识别
    await w('app/src/main.py', 'print(1)');
    await w('app/src/__pycache__/main.pyc', Buffer.alloc(20));
  });
  t.after(() => app.dispose());

  const pkg = byCat('pkg-cache');
  assert.ok(pkg.includes('.cache/uv'), 'uv 缓存归入包管理器缓存');
  assert.ok(pkg.includes('.cache/pip'));
  assert.ok(pkg.includes('.cache/pnpm'));
  assert.ok(pkg.includes('.npm/_npx'), 'npx 缓存归入包管理器缓存');
  assert.deepEqual(byCat('build-artifacts'), ['app/src/__pycache__', 'proj/node_modules'], '只剩项目自己的构建产物');
  assert.deepEqual(byCat('python-venv'), ['svc/.venv']);
  assert.ok(byCat('app-cache').includes('Library/Caches/com.foo'));
  const junk = app.views.junkJSON();
  const uv = junk.tiers[0].categories.find((/** @type {any} */ c) => c.id === 'pkg-cache').items.find((/** @type {any} */ i) => i.name === 'uv 缓存');
  assert.equal(uv.selected, true, '包管理器缓存默认勾选，整个 uv 缓存只算一项');
});

test('__pycache__ 只在父目录有 .py 文件时才算构建产物', async (t) => {
  const dir = await makeTmp('pycache');
  t.after(() => removeTmp(dir));
  const { app, byCat } = await scanFixture(dir, async (home) => {
    const w = (/** @type {string} */ rel, /** @type {any} */ c = 'x') => writeFile(path.join(home, rel), c);
    await w('a/m.py', 'x = 1');
    await w('a/__pycache__/m.pyc', Buffer.alloc(20));
    await w('b/notes.txt', 'no python here');
    await w('b/__pycache__/old.pyc', Buffer.alloc(20));
    await w('c/m.py/readme', 'm.py is a directory, not a file');
    await w('c/__pycache__/x.pyc', Buffer.alloc(20));
  });
  t.after(() => app.dispose());
  assert.deepEqual(byCat('build-artifacts'), ['a/__pycache__']);
});

test('ancestorCf：路径位于 node_modules / site-packages / venv 里时带 NO_PATTERN（重新扫描的根也适用）', () => {
  const po = createPathOps('posix');
  const specs = buildRuleSpecs({ platform: 'darwin', env: {}, home: '/Users/u', tmpdir: '/tmp/x', goModCache: null, pathOps: po });
  const idx = buildRuleIndex({ specs: specs.filter((s) => !s.path.includes('*')), pathOps: po, platform: 'darwin', protectedKeys: [] });
  assert.ok(idx.ancestorCf('/Users/u/p/node_modules/x') & CF.NO_PATTERN);
  assert.ok(idx.ancestorCf('/Users/u/l/site-packages/req/__pycache__') & CF.NO_PATTERN);
  assert.ok(idx.ancestorCf('/Users/u/t/venv/lib') & CF.NO_PATTERN);
  assert.equal(idx.ancestorCf('/Users/u/p/node_modules') & CF.NO_PATTERN, 0, 'node_modules 目录本身不受影响');
  assert.equal(idx.ancestorCf('/Users/u/p/src') & CF.NO_PATTERN, 0);
  assert.ok(idx.ancestorCf('/Users/u/.cache/uv/archive-v0') & CF.CLAIMED, 'uv 缓存里面属于已命中规则的目录');
});

test('~/.local/share/uv（Windows 是 %APPDATA%\\uv）当作容器目录，里面的 __pycache__ 不算构建产物', async (t) => {
  const { containerPaths } = await import('../miniapp/node/rules.mjs');
  const mac = createPathOps('posix');
  const win = createPathOps('win32');
  assert.deepEqual(containerPaths({ platform: 'darwin', env: {}, home: '/Users/u', pathOps: mac }), ['/Users/u/.local/share/uv']);
  assert.deepEqual(containerPaths({ platform: 'win32', env: { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, home: 'C:\\Users\\a', pathOps: win }), ['C:\\Users\\a\\AppData\\Roaming\\uv']);
  assert.deepEqual(containerPaths({ platform: 'win32', env: { USERPROFILE: 'C:\\Users\\b' }, home: 'C:\\x', pathOps: win }), ['C:\\Users\\b\\AppData\\Roaming\\uv'], '没有 APPDATA 时按 USERPROFILE 推出');
  const idx = buildRuleIndex({ specs: [], pathOps: win, platform: 'win32', protectedKeys: [], noPatternPaths: ['C:\\Users\\a\\AppData\\Roaming\\uv'] });
  assert.ok(idx.ancestorCf('c:\\users\\a\\appdata\\roaming\\UV\\python\\cpython-3.12\\Lib') & CF.NO_PATTERN, 'Windows 路径不区分大小写');

  const dir = await makeTmp('uv-container');
  t.after(() => removeTmp(dir));
  const { app, byCat } = await scanFixture(dir, async (home) => {
    const w = (/** @type {string} */ rel, /** @type {any} */ c = 'x') => writeFile(path.join(home, rel), c);
    await w('.local/share/uv/python/cpython-3.12/lib/python3.12/json/__init__.py', 'x = 1');
    await w('.local/share/uv/python/cpython-3.12/lib/python3.12/json/__pycache__/__init__.pyc', Buffer.alloc(30));
    await w('.local/share/uv/tools/ruff/lib/m.py', 'x = 1');
    await w('.local/share/uv/tools/ruff/lib/__pycache__/m.pyc', Buffer.alloc(30));
    await w('.local/share/other/tool/m.py', 'x = 1');
    await w('.local/share/other/tool/__pycache__/m.pyc', Buffer.alloc(30));
  });
  t.after(() => app.dispose());
  assert.deepEqual(byCat('build-artifacts'), ['.local/share/other/tool/__pycache__'], 'uv 目录里的都不算，旁边的普通目录照常识别');
});
