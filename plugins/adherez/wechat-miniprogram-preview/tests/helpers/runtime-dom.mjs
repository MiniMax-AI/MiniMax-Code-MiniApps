import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { compileProject } from '../../miniapp/node/compiler.mjs';
import { capsuleMarkup } from '../../miniapp/node/preview-chrome.mjs';

const runtime = await readFile(new URL('../../miniapp/client/sim-runtime.js', import.meta.url), 'utf8');
const devices = await readFile(new URL('../../miniapp/client/device-config.js', import.meta.url), 'utf8');
const components = await readFile(new URL('../../miniapp/client/vendor/component-runtime.js', import.meta.url), 'utf8');

export async function runtimeProject(t, files = {}, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wx-preview-behavior-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [name, content] of Object.entries({
    'app.json': JSON.stringify({ pages: ['pages/index'] }),
    'app.js': 'App({});',
    'pages/index.js': 'Page({});',
    'pages/index.wxml': '<view>preview</view>',
    ...files,
  })) {
    if (content === null) continue;
    const target = path.join(directory, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  const build = await compileProject(directory);
  assert.deepEqual(build.errors, []);
  const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="wx-status"></div><div id="wx-nav"></div><div id="wx-title"></div><div id="wx-back"></div>${capsuleMarkup}<div id="wx-viewport"></div><div id="wx-tabbar"></div><div id="wx-overlay"></div></body></html>`, {
    url: 'http://preview.invalid/sim/123456789abc/build/index.html?instance=behavior',
    runScripts: 'outside-only',
    virtualConsole: new VirtualConsole(),
  });
  const win = dom.window;
  t.after(() => win.close());
  const messages = [];
  const post = (message) => messages.push(JSON.parse(JSON.stringify(message)));
  win.postMessage = post;
  if (options.embedded) Object.defineProperty(win, 'parent', { configurable: true, value: { postMessage: post } });
  win.__WX_BUILD__ = build.payload;
  const styles = win.document.createElement('style');
  styles.textContent = build.css;
  win.document.head.appendChild(styles);
  if (options.beforeRuntime) options.beforeRuntime(win);
  win.eval(devices);
  win.eval(components);
  if (options.afterComponents) options.afterComponents(win);
  win.eval(runtime);
  return {
    win, build, messages,
    page: () => win.getCurrentPages()[0],
    node: (selector) => win.document.querySelector(selector),
    click: (selector) => win.document.querySelector(selector).dispatchEvent(new win.MouseEvent('click', { bubbles: true })),
    flush: async () => { await new Promise((resolve) => win.setTimeout(resolve, 5)); },
    status: () => messages.filter((message) => message.type === 'preview-status').at(-1),
    init: (data = {}) => win.dispatchEvent(new win.MessageEvent('message', {
      source: win.parent,
      data: { source: 'wx-shell', type: 'init', instanceId: 'behavior', ...data },
    })),
  };
}

export function componentFiles(id, { script = 'Component({});', template = '<view>component</view>', css = '', config = {} } = {}) {
  return {
    [`components/${id}.json`]: JSON.stringify({ component: true, ...config }),
    [`components/${id}.js`]: script,
    [`components/${id}.wxml`]: template,
    [`components/${id}.wxss`]: css,
  };
}
