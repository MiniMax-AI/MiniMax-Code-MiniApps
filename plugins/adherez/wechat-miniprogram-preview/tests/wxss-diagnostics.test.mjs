import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { compileProject, COMPILER_VERSION, COMPILER_FINGERPRINT } from '../miniapp/node/compiler.mjs';
import { compileWxss } from '../miniapp/node/wxss.mjs';

const compile = (source, extra = {}) => compileWxss({ source, file: 'components/card.wxss', scope: { kind: 'component', id: 'components/card' }, resolveImport: () => null, rewriteUrl: (value) => value, ...extra });

test('simple selectors, quoted pseudo-text, comments and URL payloads do not produce unsupported-CSS warnings', () => {
  const result = compile(`/* @scope (.fake) { :has(.bad){} } */
    .card:not(.disabled) > text:is(.a, .b), view:where([data-label="a > b"], .safe) {
      content: "@keyframes :has(.one .two) { }";
      background-image: url("data:image/svg+xml;@scope{.a:has(.b){}}");
    }
    @media (min-width: 200px) { .card + view:hover { color:red; } }
    @font-face { font-family:"@scope fake"; src:url("font.woff"); }
  `);
  assert.deepEqual(result.warnings, []);
  assert.match(result.css, /wx-text/);
});

test('functional relational selectors and nested at-rules produce stable deduplicated diagnostics', () => {
  const result = compile(`
    .a:is(.parent .child) { color:red; }
    .b:where(.parent > .child), .c:not(.first + .second), .d:has(.child) { color:blue; }
    @supports (display:grid) { @media (min-width:1px) { .e:has(> .other) { color:green; } } }
    @scope (.card) { .deep { color:purple; } }
    @starting-style { .card { opacity:0; } }
    .card { & > text { color:blue; } @media (min-width:1px) { & .deep { color:red; } } }
  `);
  assert.deepEqual(result.warnings.map((item) => item.code), ['WXSS_COMPLEX_SELECTOR', 'WXSS_UNSUPPORTED_AT_RULE', 'WXSS_NESTED_RULE']);
  assert.deepEqual(result.warnings.map((item) => item.file), Array(3).fill('components/card.wxss'));
  assert.equal(result.warnings[0].line, 2);
  assert.equal(result.warnings[0].column, 7);
  assert.match(result.css, /@scope/);
  assert.match(result.css, /:has\(/);
});

test('global keyframes warn without treating percentages/from/to as component selectors', () => {
  const result = compile('/* 你好 */\n@keyframes pulse { from { opacity:0 } 50% { opacity:.5 } to { opacity:1 } }\n@-webkit-keyframes pulse {0%{opacity:0}100%{opacity:1}}');
  assert.deepEqual(result.warnings.map((item) => item.code), ['WXSS_GLOBAL_KEYFRAMES']);
  assert.deepEqual([result.warnings[0].line, result.warnings[0].column], [2, 1]);
  assert.match(result.css, /50% \{ opacity:\.5 \}/);
  assert.doesNotMatch(result.css, /(?:50%|from|to):where/);
  assert.match(result.css, /@-webkit-keyframes pulse/);
});

test('imported files keep their own positions and warning counts stay bounded', () => {
  const source = Array.from({ length: 120 }, (_, index) => `@import "part${index}.wxss";`).join('\n');
  const result = compile(source, { resolveImport: (spec) => ({ file: 'shared/' + spec, source: '\n\n.a:has(.child) {color:red}' }) });
  assert.equal(result.warnings.length, 100);
  assert.deepEqual([result.warnings[0].file, result.warnings[0].line, result.warnings[0].column], ['shared/part0.wxss', 3, 3]);
  assert.equal(new Set(result.warnings.map((item) => item.file + item.code)).size, 100);
});

test('actual project warning facts reach Shell diagnostics as limited feedback without blocking compilation', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wxss-warning-project-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const files = {
    'app.json': '{"pages":["index"],"lazyCodeLoading":"requiredComponents"}', 'app.js': 'App({});',
    'index.js': 'Page({});', 'index.wxml': '<view class="card">preview</view>',
    'index.wxss': '@import "shared.wxss"; .card { animation:pulse 1s; }',
    'app.wxss': '@import "shared.wxss";',
    'shared.wxss': '@keyframes pulse{0%{opacity:0}100%{opacity:1}}\n.card:has(.item){color:red}',
  };
  for (const [file, source] of Object.entries(files)) await writeFile(path.join(directory, file), source);
  const build = await compileProject(directory);
  assert.equal(build.compilerFingerprint, COMPILER_FINGERPRINT);
  assert.equal(build.compilerFingerprint.split(':')[0], COMPILER_VERSION);
  assert.deepEqual(build.errors, []);
  assert.equal(build.warnings.length, 2);
  assert.equal(new Set(build.warnings.map((item) => item.code)).size, 2);
  const [html, shell, devices] = await Promise.all(['index.html', 'shell.js', 'device-config.js'].map((file) => readFile(new URL('../miniapp/client/' + file, import.meta.url), 'utf8')));
  const dom = new JSDOM(html, { url: 'http://preview.test/preview?previewId=pv_css', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const win = dom.window;
  win.TextEncoder = TextEncoder;
  win.matchMedia = () => ({ matches: false, addEventListener() {} });
  win.ResizeObserver = class { observe() {} };
  const listeners = new Map();
  win.EventSource = class { addEventListener(name, handler) { listeners.set(name, handler); } close() {} };
  const state = { ok: true, previewId: 'pv_css', projectId: 'project', serverEpoch: 'epoch', leaseEpoch: 0,
    lease: null,
    projects: [{ id: 'project', name: 'CSS fixture' }], activeProject: { name: 'CSS fixture' }, route: 'index', deviceId: '390x844',
    build: { status: 'ok', buildId: build.buildId, manifest: build.manifest, errors: build.errors, warnings: build.warnings },
    preview: { status: 'rendered', details: [] },
  };
  let frameIdentity;
  win.fetch = async (url, options) => {
    let result = url === '/api/previews' ? { previews: [] } : url.includes('/logs') ? { entries: [] } : state;
    if (url.endsWith('/frame')) {
      const request = JSON.parse(options.body);
      frameIdentity = { ...request.next, previewId: request.previewId, projectId: request.projectId, serverEpoch: request.serverEpoch, leaseEpoch: request.expectedLeaseEpoch + 1 };
      result = { ok: true, operationId: request.operationId, identity: frameIdentity, storage: { revision: 0, data: {} } };
    } else if (url.includes('/document?')) result = { ok: true, identity: frameIdentity, html: '<!doctype html><html><body>preview</body></html>' };
    return { ok: true, status: 200, json: async () => result };
  };
  win.eval(devices); win.eval(shell);
  await new Promise((resolve) => setImmediate(resolve));
  for (const data of [{ type: 'ready' }, { type: 'started' }, { type: 'preview-status', status: 'rendered', details: [] }]) {
    win.dispatchEvent(new win.MessageEvent('message', { origin: 'null', source: win.document.getElementById('simulator').contentWindow,
      data: { source: 'wx-sim', projectId: frameIdentity.projectId, instanceId: frameIdentity.instanceId, ...data } }));
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(win.document.getElementById('diagnostic-list').textContent, /WXSS_GLOBAL_KEYFRAMES/);
  assert.match(win.document.getElementById('diagnostic-list').textContent, /WXSS_COMPLEX_SELECTOR/);
  assert.match(win.document.getElementById('diagnostic-list').textContent, /shared.wxss:1:1/);
  assert.equal(win.document.getElementById('diagnostic-count').textContent, '2');
  assert.equal(win.document.getElementById('build-status').textContent, '构建成功');
  assert.equal(win.document.getElementById('preview-status').dataset.status, 'limited');
  assert.equal(win.document.getElementById('preview-status').hidden, false);
});
