import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileProject, resolveAsset, resolveProject } from '../miniapp/node/compiler.mjs';
import { parseWxml } from '../miniapp/node/wxml.mjs';
import { compileWxss } from '../miniapp/node/wxss.mjs';
import { transformEsm } from '../miniapp/node/esm.mjs';
import { createProjectAccess, isWithin } from '../miniapp/node/project-access.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const demo = path.join(root, 'miniapp/node/demo');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'wechat-preview-service-'));
test.after(() => rm(scratch, { recursive: true, force: true }));

function evaluate(source, modules = {}) {
  const exports = {};
  const context = { exports, require: (id) => modules[id], __wxInteropDefault: (value) => value?.__esModule ? value.default : value, __wxExportStar: (target, value) => Object.assign(target, value) };
  vm.runInNewContext(transformEsm(source), context);
  return exports;
}

test('WXML keeps comparisons, quoted attributes, directives, explicit empty components, includes and WXS', () => {
  const ast = parseWxml('<view wx:if="{{ a < b }}"><image src="x.png"></image><text>{{ a < b ? "yes" : "no" }} &amp; &#x1f600;</text><wxs module="m">module.exports = { x: 1 < 2 };</wxs></view>');
  assert.equal(ast[0].a['wx:if'], '{{ a < b }}');
  assert.equal(ast[0].c[0].n, 'image');
  assert.match(ast[0].c[1].c[0].v, /😀/);
  assert.match(ast[0].c[2].code, /1 < 2/);
  assert.throws(() => parseWxml('<view><text></view>'), /unexpected closing/);
  assert.throws(() => parseWxml('<view>'), /unclosed/);
});

test('WXSS resolves imported asset URLs against original file and scopes selectors', () => {
  const result = compileWxss({ source: '@import "../shared.wxss"; page { padding: 32rpx; } view.card { width:750rpx; }', file: 'pages/index.wxss', scope: { kind: 'page', id: 'pages/index' }, resolveImport: () => ({ file: 'shared.wxss', source: '.image { background: url(./images/a.png); }' }), rewriteUrl: (raw, file) => 'asset/' + path.posix.join(path.posix.dirname(file), raw) });
  assert.match(result.css, /asset\/images\/a.png/);
  assert.match(result.css, /calc\(32 \* var\(--wx-rpx\)\)/);
  assert.match(result.css, /wx-page\[data-wx-route="pages\/index"\]/);
  assert.match(result.css, /wx-view.card/);
});

test('ESM imports and named/default exports execute expected module values', () => {
  const result = evaluate('import value, { extra as y } from "./util";\nimport * as ns from "./other";\nexport const total = value + y + ns.n;\nexport default total;\nexport { y as alias };', { './util': { __esModule: true, default: 2, extra: 3 }, './other': { n: 4 } });
  assert.equal(result.total, 9); assert.equal(result.default, 9); assert.equal(result.alias, 3);
  assert.equal(evaluate('export { value as other } from "./util";', { './util': { value: 7 } }).other, 7);
  assert.equal(evaluate('export * from "./util";', { './util': { value: 8 } }).value, 8);
  assert.equal(evaluate("import value from './util';\nexport default value;", { './util': 6 }).default, 6);
});

test('ESM does not rewrite templates/comments and exports all declared bindings', () => {
  const result = evaluate('/*\nexport default notCode;\n*/\nconst text = `hello\\nexport default noChange;`;\nexport const a = 1, b = [1,2].length;\nexport default text;');
  assert.equal(result.a, 1); assert.equal(result.b, 2);
  assert.equal(result.default, 'hello\nexport default noChange;');
});

test('native demo compiles components, tabBar, three pages and rpx without executing project JavaScript', async () => {
  const build = await compileProject(demo);
  assert.deepEqual(build.errors, []);
  assert.equal(build.manifest.pages.length, 3);
  assert.equal(build.manifest.componentCount, 1);
  assert.equal(build.payload.tabBar.list.length, 2);
  assert.match(build.css, /var\(--wx-rpx\)/);
  const again = await compileProject(demo);
  assert.equal(build.buildId, again.buildId);
});

test('project roots reject escapes and symlink escapes; asset server refuses source files', async () => {
  assert.equal(isWithin('/workspace', '/workspace-other'), false);
  const access = await createProjectAccess(root);
  assert.equal(await access(demo), await import('node:fs/promises').then((fs) => fs.realpath(demo)));
  await assert.rejects(access(os.homedir()), { code: 'PROJECT_PATH_FORBIDDEN' });
  assert.equal(await resolveAsset(path.join(demo, 'miniprogram'), 'app.js'), null);
  assert.equal(await resolveAsset(path.join(demo, 'miniprogram'), '../app.png'), null);
  const project = path.join(scratch, 'escape'); await mkdir(project);
  await writeFile(path.join(project, 'project.config.json'), JSON.stringify({ miniprogramRoot: '/Applications' }));
  await assert.rejects(resolveProject(project), /escapes/);
  await symlink('/Applications', path.join(project, 'linked'));
  await writeFile(path.join(project, 'project.config.json'), JSON.stringify({ miniprogramRoot: 'linked' }));
  await assert.rejects(resolveProject(project), /not found|escapes/);
});
