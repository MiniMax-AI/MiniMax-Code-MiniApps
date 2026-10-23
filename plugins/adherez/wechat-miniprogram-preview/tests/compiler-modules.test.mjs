import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import { compileProject } from '../miniapp/node/compiler.mjs';
import { transformEsm } from '../miniapp/node/esm.mjs';

function evaluate(source, dependencies = {}, options = {}) {
  const module = { exports: {} };
  const context = vm.createContext({ module, exports: module.exports, require: (id) => dependencies[id] });
  vm.runInContext(transformEsm(source, options), context);
  return module.exports;
}

async function project(t, sources) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wechat-preview-modules-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [file, source] of Object.entries({
    'app.json': '{"pages":["pages/index"],"lazyCodeLoading":"requiredComponents"}',
    'pages/index.wxml': '<text>{{value}}</text>',
    ...sources,
  })) {
    const target = path.join(root, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, source);
  }
  return root;
}

function loadBuild(build, globals = {}) {
  const context = vm.createContext(globals);
  const cache = new Map();
  const load = (id) => {
    if (cache.has(id)) return cache.get(id).exports;
    assert.equal(typeof build.payload.modules[id], 'string', `missing module ${id}`);
    const module = { exports: {} };
    cache.set(id, module);
    const require = (spec) => {
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(id), spec));
      const candidate = [base, `${base}.js`, `${base}.wxs`, `${base}.json`, `${base}/index.js`]
        .find((name) => Object.hasOwn(build.payload.modules, name));
      assert.ok(candidate, `missing dependency ${spec} from ${id}`);
      return load(candidate);
    };
    const factory = vm.runInContext(`(function(require, module, exports) {\n${build.payload.modules[id]}\n})`, context);
    factory.call(module.exports, require, module, module.exports);
    return module.exports;
  };
  return load;
}

test('named default functions/classes retain local bindings and declarations can share a line', () => {
  const result = evaluate(`
    export default function answer() { return 42; } export const result = answer();
    export const {first, nested: {second}} = {first: 1, nested: {second: 2}};
  `);
  assert.equal(result.default(), 42);
  assert.equal(result.result, 42);
  assert.equal(result.first, 1);
  assert.equal(result.second, 2);
  const classResult = evaluate('export default class Answer { value() { return 7; } } export const result = new Answer().value();');
  assert.equal(classResult.result, 7);
  assert.equal(new classResult.default().value(), 7);
});

test('all variable exports retain declarations, initializer order, nested commas and live updates', () => {
  const result = evaluate(`
    export const first = 1, second = [first, 2].length, {item: third} = {item: 3};
    export let unset, changed = 1;
    export const callback = (x, y) => x + y + third, template = \`hello \${callback(1, 2)}\`;
    export function update() { unset = second; changed++; }
  `);
  assert.equal(result.first, 1);
  assert.equal(result.second, 2);
  assert.equal(result.third, 3);
  assert.equal(result.callback(1, 2), 6);
  assert.equal(result.callback.name, 'callback');
  assert.equal(result.template, 'hello 6');
  assert.equal(Object.hasOwn(result, 'unset'), true);
  assert.equal(result.unset, undefined);
  result.update();
  assert.equal(result.unset, 2);
  assert.equal(result.changed, 2);
});

test('TypeScript variable exports preserve type annotations, destructuring, ASI and final comments', () => {
  const result = evaluate(`
    export const tuple: [number, number] = [1, 2], {value}: {value: number} = {value: 3}
    export let unset: number | undefined, changed: number = 1 // keep comment
    export function update(): void { unset = value; changed++; }
    export const finalValue: number = tuple[0] + tuple[1] // no trailing semicolon
  `, {}, { fileName: 'modules/typed.ts' });
  assert.deepEqual([...result.tuple], [1, 2]);
  assert.equal(result.value, 3);
  assert.equal(result.finalValue, 3);
  assert.equal(Object.hasOwn(result, 'unset'), true);
  result.update();
  assert.equal(result.unset, 3);
  assert.equal(result.changed, 2);
});

test('re-exports and imports preserve live bindings, namespace exports and default interop', () => {
  const dependency = evaluate('export let count = 1; export function increment() { count++; } export default "value";');
  const result = evaluate(`
    import current, { count } from './counter'; export function read() { return current + count; }
    export { count as renamed, increment } from './counter';
    export * as counter from './counter'; export * from './counter';
  `, { './counter': dependency });
  assert.equal(result.read(), 'value1');
  result.increment();
  assert.equal(result.renamed, 2);
  assert.equal(result.count, 2);
  assert.equal(result.counter.count, 2);
  assert.equal(result.read(), 'value2');
  assert.equal(Object.hasOwn(result, 'default'), false);
  assert.equal(evaluate('import value from "./common"; export default value;', { './common': 9 }).default, 9);
});

test('module syntax in comments, regexp and nested templates is not rewritten', () => {
  const result = evaluate(`
    /* export default nope; */
    const expression = /export\\s+default/;
    const text = \`outer \${\`nested \${'import'}\`} export default\`;
    export const matched = expression.test(text); export default text;
  `);
  assert.equal(result.default, 'outer nested import export default');
  assert.equal(result.matched, true);
});

test('dynamic import resolves through the sandbox module loader instead of the Node host', async () => {
  const result = evaluate('export async function value() { return (await import("./local")).default; }', { './local': 12 });
  assert.equal(await result.value(), 12);
});

test('TypeScript app, page, component and relative dependencies compile alongside JSON, CJS and WXS', async (t) => {
  const root = await project(t, {
    'app.ts': 'import { state } from "./state"; App({globalData: state});',
    'state.ts': 'interface State { count: number } export const state: State = {count: 1};',
    'types.d.ts': 'declare const ignoredType: Readonly<{value: string}>;',
    'pages/index.json': '{"usingComponents":{"counter":"../components/counter"}}',
    'pages/index.ts': `
      import type {MissingType} from './type-only';
      import {state as plain} from '../state'; import {state as explicit} from '../state.ts';
      import {label} from '../helpers'; import config from '../data.json';
      const common = require('../common'); const wxs = require('../format.wxs');
      Page({data: {value: plain.count + config.offset + common + wxs.value, shared: plain === explicit, label}});
    `,
    'helpers/index.ts': 'export const label: string = "TypeScript directory";',
    'data.json': '{"offset":2}',
    'common.js': 'module.exports = 3;',
    'format.wxs': 'module.exports = {value: 4};',
    'components/counter.json': '{"component":true,"styleIsolation":"apply-shared","addGlobalClass":true}',
    'components/counter.wxml': '<text>{{value}}</text>',
    'components/counter.wxss': 'text { color: red; }',
    'components/counter.ts': 'const initial: number = 5; Component({data: {value: initial}});',
  });
  const build = await compileProject(root);
  assert.deepEqual(build.errors, []);
  assert.equal(build.payload.units['pages/index'].js, 'pages/index.ts');
  assert.equal(build.payload.units['components/counter'].js, 'components/counter.ts');
  assert.equal(build.payload.units['components/counter'].json.addGlobalClass, true);
  assert.match(build.payload.componentStyles['components/counter'], /color:\s*red/);
  assert.equal(Object.hasOwn(build.payload.modules, 'types.d.ts'), false);
  assert.equal(Object.hasOwn(build.payload.modules, 'types.d.js'), false);
  let app;
  let page;
  let component;
  const load = loadBuild(build, {
    App(value) { app = value; }, Page(value) { page = value; }, Component(value) { component = value; },
  });
  load('app.js');
  load(build.payload.units['pages/index'].js);
  load(build.payload.units['components/counter'].js);
  assert.equal(app.globalData.count, 1);
  assert.equal(page.data.value, 10);
  assert.equal(page.data.shared, true);
  assert.equal(page.data.label, 'TypeScript directory');
  assert.equal(component.data.value, 5);
  assert.equal(load('state.js'), load('state.ts'));
});

test('existing JavaScript output wins extensionless resolution when both .js and .ts are present', async (t) => {
  const root = await project(t, {
    'app.js': 'App({});',
    'app.ts': 'App({typescript: true});',
    'pages/index.js': 'const typed = require("../value.ts"); Page({data: require("../value"), typed});',
    'pages/index.ts': 'Page({data: {typescript: true}});',
    'value.js': 'module.exports = {source: "JavaScript"};',
    'value.ts': 'export const source: string = "TypeScript";',
  });
  const build = await compileProject(root);
  assert.deepEqual(build.errors, []);
  assert.equal(build.payload.units['pages/index'].js, 'pages/index.js');
  let page;
  const load = loadBuild(build, { Page(value) { page = value; } });
  load('pages/index.js');
  assert.equal(page.data.source, 'JavaScript');
  assert.equal(load('value.ts').source, 'TypeScript');
});

test('reachable syntax diagnostics retain original locations and unrelated broken scripts do not block', async (t) => {
  const root = await project(t, {
    'app.ts': 'App({});',
    'pages/index.ts': 'const valid: number = 1;\nexport const broken: = 2;',
    'invalid.js': 'export const broken = ;',
  });
  const build = await compileProject(root);
  const typed = build.errors.find((error) => error.file === 'pages/index.ts');
  const javascript = build.errors.find((error) => error.file === 'invalid.js');
  assert.ok(typed);
  assert.match(typed.message, /TypeScript syntax error/);
  assert.equal(typed.line, 2);
  assert.ok(typed.column > 0);
  assert.equal(javascript, undefined);
  assert.equal(build.errors.length, 1);
  assert.equal(Object.hasOwn(build.payload.modules, 'invalid.js'), false);
});

test('compilation does not execute app, page, dependencies or Node imports', async (t) => {
  const root = await project(t, {
    'app.ts': 'import fs from "node:fs"; fs.writeFileSync("/not-allowed", "bad"); throw new Error("never execute app");',
    'pages/index.js': 'throw new Error("never execute page");',
    'library.ts': 'while (true) {}',
  });
  const build = await compileProject(root);
  assert.equal(build.errors.length, 1);
  assert.equal(build.errors[0].code, 'MISSING_MODULE');
  assert.match(build.errors[0].message, /node:fs/);
  const repeat = await compileProject(root);
  assert.equal(build.buildId, repeat.buildId);
});

test('JSON modules preserve own __proto__ keys instead of interpreting them as object literal prototypes', async (t) => {
  const root = await project(t, {
    'app.js': 'App({});',
    'pages/index.js': 'Page({data:require("../data.json")});',
    'data.json': '{"__proto__":{"polluted":true},"value":3}',
  });
  const build = await compileProject(root);
  assert.deepEqual(build.errors, []);
  const value = loadBuild(build)('data.json');
  assert.equal(Object.hasOwn(value, '__proto__'), true);
  assert.equal(Object.getPrototypeOf(value).polluted, undefined);
  assert.equal(value.__proto__.polluted, true);
  assert.equal(value.value, 3);
});

test('bounded generic static config reaches the runtime diagnosis instead of silently disappearing', async (t) => {
  const generics = { item: true, body: { default: '/components/default-body' } };
  const root = await project(t, {
    'app.js': 'App({});', 'pages/index.js': 'Page({});',
    'pages/index.json': JSON.stringify({ componentGenerics: generics }),
  });
  const result = await compileProject(root);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.payload.units['pages/index'].json.componentGenerics, generics);
  for (const invalid of [false, [], { body: { default: '' } }, { body: { arbitrary: true } }, Object.fromEntries(Array.from({ length: 101 }, (_, index) => ['slot' + index, true]))]) {
    await writeFile(path.join(root, 'pages/index.json'), JSON.stringify({ componentGenerics: invalid }));
    const build = await compileProject(root);
    assert.equal(build.errors.some((error) => error.file === 'pages/index.json' && error.code === 'INVALID_CONFIG'), true);
    assert.equal(build.payload.units['pages/index'].json.componentGenerics, undefined);
  }
});
