import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertSnapshotIdentity, collectProjectSnapshot, compileProject, COMPILER_FINGERPRINT } from '../miniapp/node/compiler.mjs';
import { analyzeModuleRequests } from '../miniapp/node/vendor/js-transform.mjs';

async function fixture(t, sources = {}) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'wechat-graph-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (file, source) => {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), source);
  };
  for (const [file, source] of Object.entries({
    'app.json': '{"pages":["pages/index"],"lazyCodeLoading":"requiredComponents"}',
    'app.js': 'App({});', 'pages/index.js': 'Page({});', 'pages/index.wxml': '<view/>', ...sources,
  })) await put(file, source);
  return { root, put };
}

test('static dependency collection follows actual parser tokens and respects shadowed require', () => {
  const source = `
    // require('./comment')
    const regular = /require('regex')/;
    const string = 'require("text")';
    const object = {require() {}, value: 1}; object.require('./method');
    function local(require) { require('./shadowed'); }
    { let require = local; require('./block-shadowed'); }
    const nested = \`outer \${\`inner \${require('./nested')}\`}\`;
    require('./hex\\x2ejs'); require(\`./literal\`);
    const named = require('./folder/' + name); const alias = require; const spread = {require};
    requ\\u0069re('./unicode-identifier');
  `;
  const requests = analyzeModuleRequests(source);
  assert.deepEqual(requests.map((request) => request.spec), ['./nested', './hex.js', './literal', null, null, null, './unicode-identifier']);
  assert.equal(requests.every((request) => request.line > 0 && request.column > 0), true);
  assert.deepEqual(analyzeModuleRequests('const require = fn; require("local");'), []);
  assert.equal(analyzeModuleRequests('require("./\\141");')[0].spec, './a');
});

test('only reachable modules compile, while static imports and cyclic dependencies remain complete', async (t) => {
  const f = await fixture(t, {
    'app.js': 'import { value } from "./a"; App({globalData:value});',
    'a.js': 'exports.value = 1; exports.cycle = require("./b");',
    'b.js': 'module.exports = require("./a").value;',
    'pages/index.js': 'import("../async").then(x=>x.default); Page({});',
    'async.ts': 'export default "loaded";',
    'unused.js': 'const broken = ;', 'unused.json': '{bad', 'unused.ts': 'const invalid: = 0;',
  });
  const build = await compileProject(f.root);
  assert.deepEqual(build.errors, []);
  assert.deepEqual(Object.keys(build.payload.modules).sort(), ['a.js', 'app.js', 'async.js', 'async.ts', 'b.js', 'pages/index.js']);
  assert.equal(build.dependencyFiles.includes('unused.js'), false);
  const before = build.buildId;
  await f.put('unused.js', 'still not valid !');
  assert.equal((await compileProject(f.root)).buildId, before);
  await f.put('a.js', 'exports.value = 2; exports.cycle = require("./b");');
  assert.notEqual((await compileProject(f.root)).buildId, before);
});

test('missing static imports, reachable syntax failures, WXML and WXSS imports fail the build', async (t) => {
  const f = await fixture(t, {
    'app.js': 'import "./missing"; App({});',
    'pages/index.js': 'require("../bad"); Page({});',
    'bad.js': 'const invalid = ;',
    'pages/index.wxml': '<include src="../absent.wxml"/>',
    'pages/index.wxss': '@import "../absent.wxss";',
  });
  const build = await compileProject(f.root);
  assert.equal(build.errors.some((error) => error.file === 'app.js' && error.code === 'MISSING_MODULE'), true);
  assert.equal(build.errors.some((error) => error.file === 'bad.js' && error.code === 'MODULE_SYNTAX_ERROR'), true);
  assert.equal(build.errors.some((error) => error.file === 'pages/index.wxml' && /not found/.test(error.message)), true);
  assert.equal(build.errors.some((error) => error.file === 'pages/index.wxss' && error.code === 'MISSING_STYLE'), true);
});

test('retains imported templates, inline/file WXS, prebuilt npm, TS component and subpackage entries', async (t) => {
  const f = await fixture(t, {
    'app.json': '{"pages":["pages/index"],"subPackages":[{"root":"subpackage","pages":["detail"]}],"lazyCodeLoading":"requiredComponents"}',
    'pages/index.wxml': '<import src="../templates/row.wxml"/><template is="row"/><include src="../templates/include.wxml"/><wxs module="inline">module.exports=require("../wxs/value.wxs");</wxs><child/>',
    'pages/index.json': '{"usingComponents":{"child":"../components/child"}}',
    'pages/index.js': 'const data=require("@demo/lib"); Page({data});',
    'pages/index.wxss': '@import "../shared/theme.wxss"; view { color: red; }',
    'templates/row.wxml': '<template name="row"><text>row</text></template>',
    'templates/include.wxml': '<wxs module="file" src="../wxs/format.wxs"/><text>{{file.value}}</text>',
    'shared/theme.wxss': '@import "./base.wxss"; .theme { margin: 10rpx; }',
    'shared/base.wxss': '.base { color: blue; }',
    'wxs/format.wxs': 'module.exports=require("./value.wxs");',
    'wxs/value.wxs': 'module.exports={value:1};',
    'miniprogram_npm/@demo/lib/index.js': 'module.exports=require("./value.json");',
    'miniprogram_npm/@demo/lib/value.json': '{/* npm */"label":"ok"}',
    'components/child.json': '{"component":true}',
    'components/child.ts': 'const value: number=1; Component({data:{value}});',
    'components/child.wxml': '<text>{{value}}</text>',
    'subpackage/detail.js': 'Page({});', 'subpackage/detail.wxml': '<text>sub</text>',
  });
  const build = await compileProject(f.root);
  assert.deepEqual(build.errors, []);
  assert.deepEqual(build.manifest.pages, ['pages/index', 'subpackage/detail']);
  assert.equal(build.payload.units['components/child'].js, 'components/child.ts');
  for (const id of ['wxs/value.wxs', 'wxs/format.wxs', 'pages/index.wxml#wxs:inline', 'miniprogram_npm/@demo/lib/index.js', 'miniprogram_npm/@demo/lib/value.json']) {
    assert.equal(typeof build.payload.modules[id], 'string', id);
  }
  assert.equal(Object.hasOwn(build.payload.templates, 'templates/row'), true);
  for (const file of ['templates/include.wxml', 'shared/base.wxss', 'shared/theme.wxss']) assert.equal(build.dependencyFiles.includes(file), true);
  assert.match(build.css, /color:\s*blue/);
});

test('computed require conservatively includes bounded sources and advertises its imprecision', async (t) => {
  const f = await fixture(t, {
    'pages/index.js': 'const choice="one"; Page({data:require("../choices/" + choice)});',
    'choices/one.js': 'module.exports={value:1};', 'choices/two.ts': 'export const value:number=2;',
    'project.private.config.json': '{"privateSetting":"not runtime input"}',
  });
  const build = await compileProject(f.root);
  assert.deepEqual(build.errors, []);
  assert.equal(build.warnings.some((warning) => warning.code === 'DYNAMIC_DEPENDENCY' && warning.file === 'pages/index.js'), true);
  for (const file of ['choices/one.js', 'choices/two.js', 'choices/two.ts']) assert.equal(Object.hasOwn(build.payload.modules, file), true);
  assert.equal(Object.hasOwn(build.payload.modules, 'project.private.config.json'), false);
  await f.put('choices/two.ts', 'const invalid: = 0;');
  assert.equal((await compileProject(f.root)).errors.some((error) => error.file === 'choices/two.ts'), true);
});

test('dynamic collection over quota fails explicitly instead of shipping an incomplete green build', async (t) => {
  const f = await fixture(t, { 'pages/index.js': 'const alias=require; Page({data:alias("./" + name)});' });
  await Promise.all(Array.from({ length: 257 }, (_, index) => f.put(`choices/${index}.js`, 'module.exports=1;')));
  const build = await compileProject(f.root);
  assert.equal(build.errors.some((error) => error.code === 'DYNAMIC_DEPENDENCY_LIMIT'), true);
  assert.equal(build.warnings.some((warning) => warning.code === 'DYNAMIC_DEPENDENCY'), true);
  assert.ok(Object.keys(build.payload.modules).length < 10);
});

test('content fingerprint detects same-length asset edits with unchanged mtime and is path independent', async (t) => {
  const f = await fixture(t, { 'image.png': 'first', 'project.config.json': '{"projectname":"Demo"}' });
  const image = path.join(f.root, 'image.png');
  await utimes(image, 1600000000, 1600000000);
  const info = await stat(image);
  const before = await compileProject(f.root);
  assert.equal(before.compilerFingerprint, COMPILER_FINGERPRINT);
  assert.deepEqual(before.assets, [{ path: 'image.png', bytes: 5, sha256: createHash('sha256').update('first').digest('hex') }]);
  await f.put('image.png', 'other');
  await utimes(image, info.atime, info.mtime);
  assert.equal((await stat(image)).mtimeMs, info.mtimeMs);
  const after = await compileProject(f.root);
  assert.notEqual(before.buildId, after.buildId);
  const copy = await fixture(t);
  await cp(f.root, copy.root, { recursive: true });
  const cloned = await compileProject(copy.root);
  assert.equal(cloned.buildId, after.buildId);
  assert.equal(JSON.stringify(cloned.payload).includes(copy.root), false);
  assert.deepEqual(cloned.assets, after.assets);
  await f.put('project.config.json', '{"projectname":"Renamed"}');
  assert.notEqual((await compileProject(f.root)).buildId, after.buildId);
  assert.equal(await readFile(image, 'utf8'), 'other');
});

test('snapshot enables pre-transform cache lookup and compilation consumes the same captured source', async (t) => {
  const f = await fixture(t, { 'unused.js': 'const ignored = ;' });
  const snapshot = await collectProjectSnapshot(f.root);
  const first = await compileProject(f.root, { snapshot });
  assert.deepEqual(first.errors, []);
  assert.equal(snapshot.compilerFingerprint, COMPILER_FINGERPRINT);
  assert.equal(typeof snapshot.sourceHash, 'string');
  await f.put('pages/index.js', 'const invalid = ;');
  const captured = await compileProject(f.root, { snapshot });
  assert.deepEqual(captured.errors, []);
  assert.equal(captured.buildId, first.buildId);
  assert.equal((await compileProject(f.root)).errors.some((error) => error.file === 'pages/index.js'), true);
  await f.put('pages/index.js', 'Page({});');
  await f.put('unused.js', 'another ignored syntax error !');
  const second = await collectProjectSnapshot(f.root);
  assert.notEqual(second.sourceHash, snapshot.sourceHash);
  assert.equal((await compileProject(f.root, { snapshot: second })).buildId, first.buildId);
});

test('replaced project/source directory rejects a captured build even with identical contents; fresh capture succeeds', async (t) => {
  const f = await fixture(t, { 'project.config.json': '{"miniprogramRoot":"source"}',
    'source/app.json': '{"pages":["index"],"lazyCodeLoading":"requiredComponents"}',
    'source/app.js': 'App({});', 'source/index.js': 'Page({});', 'source/index.wxml': '<text/>',
  });
  const captured = await collectProjectSnapshot(f.root);
  const first = await compileProject(f.root, { snapshot: captured });
  const moved = path.join(f.root, 'old-source');
  await rename(path.join(f.root, 'source'), moved);
  await cp(moved, path.join(f.root, 'source'), { recursive: true });
  await assert.rejects(assertSnapshotIdentity(captured), { code: 'PROJECT_CHANGED' });
  await assert.rejects(compileProject(f.root, { snapshot: captured }), { code: 'PROJECT_CHANGED' });
  const next = await collectProjectSnapshot(f.root);
  assert.notEqual(next.identities[1].ino, captured.identities[1].ino);
  assert.equal((await compileProject(f.root, { snapshot: next })).buildId, first.buildId);
  const copied = path.join(path.dirname(f.root), path.basename(f.root) + '-moved');
  await rename(f.root, copied);
  t.after(() => rm(copied, { recursive: true, force: true }));
  await cp(copied, f.root, { recursive: true });
  await assert.rejects(assertSnapshotIdentity(next), { code: 'PROJECT_CHANGED' });
  assert.deepEqual((await compileProject(f.root)).errors, []);
});
