import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { runtimeProject } from './helpers/runtime-dom.mjs';

const source = async (name) => readFile(new URL('../miniapp/client/' + name, import.meta.url), 'utf8');
const deviceSource = await source('device-config.js');
const plain = (value) => JSON.parse(JSON.stringify(value));

function element() {
  const listeners = new Map();
  const attributes = new Map();
  const properties = new Map();
  const classes = new Set();
  return {
    dataset: {}, children: [], hidden: false, disabled: false, value: '', textContent: '',
    style: { setProperty(key, value) { properties.set(key, value); }, getPropertyValue(key) { return properties.get(key); } },
    classList: { add(key) { classes.add(key); }, toggle(key, force) { if (force) classes.add(key); else classes.delete(key); }, contains(key) { return classes.has(key); } },
    addEventListener(name, callback) { listeners.set(name, callback); },
    dispatch(name, event = {}) { return listeners.get(name)?.(event); },
    showModal() { this.open = true; },
    close() { if (!this.open) return; this.open = false; this.dispatch('close'); },
    focus() { this.focused = true; },
    append(...items) { this.children.push(...items); },
    appendChild(item) { this.append(item); item.parentNode = this; },
    get childNodes() { return this.children; },
    querySelectorAll() { return []; },
    insertBefore(item, before) { const index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index, 0, item); item.parentNode = this; },
    replaceChildren(...items) { this.children = items; },
    setAttribute(key, value) { attributes.set(key, value); },
    getAttribute(key) { return attributes.get(key); },
    removeAttribute(key) { attributes.delete(key); if (key === 'src') this.src = ''; },
    cloneNode() { const copy = element(); for (const [key, value] of attributes) copy.setAttribute(key, value); return copy; },
  };
}
function environment() {
  const nodes = new Map();
  const events = new Map();
  const messages = [];
  const timers = new Map();
  let timerId = 0;
  const get = (id) => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
  const document = {
    getElementById: get, documentElement: element(), body: element(), activeElement: null,
    createElement: element, createTextNode: (text) => ({ textContent: text }), addEventListener() {},
  };
  const context = vm.createContext({ document, location: { pathname: '/sim/123456789abc/build/index.html' },
    setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); }, requestAnimationFrame(callback) { callback(); },
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    URL, URLSearchParams, AbortController, Promise,
  });
  context.window = context;
  context.parent = { postMessage(message) { messages.push(plain(message)); } };
  context.addEventListener = (name, callback) => events.set(name, callback);
  vm.runInContext(deviceSource, context);
  return { context, get, nodes, events, messages, timers };
}
const flush = async () => { await new Promise((resolve) => setImmediate(resolve)); };

test('three device profiles expose coherent window, safe-area, capsule and DPR values', () => {
  const { context } = environment();
  const devices = context.__WX_PREVIEW_DEVICES__;
  for (const id of devices.ids) {
    const device = devices.get(id);
    const normal = devices.metrics(id, { tabBarVisible: true });
    assert.equal(normal.windowHeight + normal.screenTop + 49 + device.safeAreaBottom, device.height);
    assert.equal(normal.screenTop, device.statusBarHeight + device.navHeight);
    assert.equal(normal.menu.bottom - normal.menu.top, device.capsule.height);
    assert.equal(normal.menu.right - normal.menu.left, device.capsule.width);
    assert.equal(normal.safeArea.bottom, device.height - device.safeAreaBottom);
    const custom = devices.metrics(id, { customNavigation: true });
    assert.equal(custom.screenTop, 0);
    assert.equal(custom.windowHeight, device.height);
  }
  assert.equal(devices.get('375x667').pixelRatio, 2);
  assert.equal(devices.get('375x667').safeAreaBottom, 0);
  assert.equal(devices.get('untrusted').id, devices.defaultId);
  assert.equal(devices.get('__proto__').id, devices.defaultId);
  const copy = devices.get(devices.defaultId); copy.capsule.width = 999;
  assert.equal(devices.get(devices.defaultId).capsule.width, 87);
});

test('runtime uses the selected device before project startup and custom navigation fills the window', async (t) => {
  for (const custom of [false, true]) {
    const env = await runtimeProject(t, {
      'app.json': JSON.stringify({ pages: ['pages/index'], window: { navigationStyle: custom ? 'custom' : 'default' } }),
      'app.js': 'App({onLaunch(){this.globalData.device=wx.getSystemInfoSync().model;}});',
    }, { embedded: true });
    const context = env.win;
    env.init({ device: '375x667' });
    const info = context.wx.getSystemInfoSync();
    assert.equal(info.model, 'iPhone SE (H5 preview)');
    assert.equal(info.pixelRatio, 2);
    assert.equal(info.statusBarHeight, 20);
    assert.equal(info.windowWidth, 375);
    assert.equal(info.windowHeight, custom ? 667 : 603);
    assert.equal(info.screenTop, custom ? 0 : 64);
    assert.equal(context.wx.getMenuButtonBoundingClientRect().top, 24);
    assert.equal(context.document.documentElement.style.getPropertyValue('--wx-status-height'), '20px');
    assert.equal(context.getApp().globalData.device, 'iPhone SE (H5 preview)');
    assert.equal(env.status().status, 'rendered');
  }
});

test('default capsule follows navigation text style and only changes when frontColor changes', async (t) => {
  const env = await runtimeProject(t, {
    'app.json': JSON.stringify({
      pages: ['pages/index', 'pages/other'],
      window: { navigationBarBackgroundColor: '#000000', navigationBarTextStyle: 'white' },
      tabBar: { list: [{ pagePath: 'pages/index', text: 'Index' }, { pagePath: 'pages/other', text: 'Other' }] },
    }),
    'pages/other.js': 'Page({});', 'pages/other.wxml': '<view>other</view>',
  }, { embedded: true });
  const { win } = env;
  env.init();

  const capsule = env.node('#wx-capsule');
  assert.ok(capsule);
  assert.equal(capsule.parentElement, win.document.body);
  assert.equal(capsule.getAttribute('aria-hidden'), 'true');
  assert.equal(capsule.querySelectorAll('svg').length, 0);
  assert.equal(capsule.textContent, '');
  assert.ok(capsule.querySelector('.wx-capsule-menu'));
  assert.ok(capsule.querySelector('.wx-capsule-exit'));
  assert.deepEqual({ ...win.wx.getMenuButtonBoundingClientRect() }, {
    width: 87, height: 32, top: 51, bottom: 83, left: 296, right: 383,
  });
  assert.equal(capsule.dataset.tone, 'light');

  await win.wx.hideTabBar();
  await win.wx.setBackgroundColor({ backgroundColor: '#ffffff' });
  assert.equal(win.document.getElementById('wx-viewport').style.background, 'rgb(255, 255, 255)');
  assert.equal(capsule.dataset.tone, 'light');
  assert.equal(env.node('#wx-tabbar').hidden, true);

  await win.wx.setNavigationBarColor({ backgroundColor: '#ffffff' });
  assert.equal(capsule.dataset.tone, 'light');
  await win.wx.setNavigationBarColor({ backgroundColor: '#ffffff', frontColor: '#000000' });
  assert.equal(capsule.dataset.tone, 'dark');
});

test('custom capsule ignores scrolling backgrounds and restores each page navigation text style', async (t) => {
  const env = await runtimeProject(t, {
    'app.json': JSON.stringify({ pages: ['pages/index', 'pages/light'], window: { navigationStyle: 'custom', navigationBarTextStyle: 'black', backgroundColor: '#05070f' } }),
    'pages/index.js': 'Page({ data: { color: "#05070f" } });',
    'pages/index.wxml': '<scroll-view id="scroller" scroll-y="true"><view id="heading" style="background:{{color}}">content</view></scroll-view>',
    'pages/light.json': '{"navigationBarTextStyle":"white"}',
    'pages/light.js': 'Page({});', 'pages/light.wxml': '<view>next page</view>',
  });
  const { win } = env;
  const capsule = env.node('#wx-capsule');
  const menu = { ...win.wx.getMenuButtonBoundingClientRect() };
  const scroll = () => {
    env.node('wx-page').dispatchEvent(new win.Event('scroll'));
    env.node('#scroller').dispatchEvent(new win.Event('scroll'));
  };
  assert.equal(capsule.dataset.tone, 'dark');
  env.page().setData({ color: '#ffffff' });
  await win.wx.setBackgroundColor({ backgroundColor: '#ffffff' });
  scroll(); await env.flush();
  assert.equal(capsule.dataset.tone, 'dark');
  await win.wx.setNavigationBarColor({ frontColor: '#ffffff' });
  assert.equal(capsule.dataset.tone, 'light');
  env.node('#heading').style.backgroundImage = 'linear-gradient(#000,#fff)';
  scroll(); await env.flush();
  assert.equal(capsule.dataset.tone, 'light');
  assert.equal(capsule.hasAttribute('data-backdrop'), false);
  assert.deepEqual({ ...win.wx.getMenuButtonBoundingClientRect() }, menu);
  await win.wx.navigateTo({ url: '/pages/light' });
  assert.equal(capsule.dataset.tone, 'light');
  await win.wx.setNavigationBarColor({ frontColor: '#000000' });
  assert.equal(capsule.dataset.tone, 'dark');
  await win.wx.navigateBack();
  assert.equal(capsule.dataset.tone, 'light');
  assert.equal(capsule.parentElement, win.document.body);
});

test('omitted navigation colors use DevTools white chrome, while page overrides and dynamic changes stay local', async (t) => {
  for (const navigationStyle of ['default', 'custom']) {
    const env = await runtimeProject(t, {
      'app.json': JSON.stringify({ pages: ['pages/index', 'pages/black', 'pages/inherited'], window: { navigationStyle, backgroundColor: '#05070f' } }),
      'pages/index.wxml': '<view>same omitted-color config as ai-hotspot-mp</view>',
      'pages/black.json': '{"navigationBarTextStyle":"black","navigationBarBackgroundColor":"#ffffff"}',
      'pages/black.js': 'Page({});', 'pages/black.wxml': '<view>explicit black</view>',
      'pages/inherited.js': 'Page({});', 'pages/inherited.wxml': '<view>inherited default</view>',
    });
    const { win } = env, capsule = env.node('#wx-capsule');
    assert.equal(env.build.payload.window.navigationBarTextStyle, 'white');
    assert.equal(env.build.manifest.window.navigationBarTextStyle, 'white');
    assert.equal(env.build.payload.window.navigationBarBackgroundColor, '#000000');
    assert.equal(capsule.dataset.tone, 'light');
    assert.equal(win.getComputedStyle(env.node('#wx-status')).color, 'rgb(255, 255, 255)');
    await win.wx.navigateTo({ url: '/pages/black' });
    assert.equal(capsule.dataset.tone, 'dark');
    await win.wx.navigateTo({ url: '/pages/inherited' });
    assert.equal(capsule.dataset.tone, 'light');
    await win.wx.setNavigationBarColor({ frontColor: '#000000' });
    assert.equal(capsule.dataset.tone, 'dark');
    await win.wx.navigateBack({ delta: 2 });
    assert.equal(capsule.dataset.tone, 'light');
  }
});

test('explicit app-level black navigation is inherited until the page overrides it', async (t) => {
  const env = await runtimeProject(t, {
    'app.json': JSON.stringify({ pages: ['pages/index', 'pages/white'], window: { navigationStyle: 'custom', navigationBarTextStyle: 'black' } }),
    'pages/white.json': '{"navigationBarTextStyle":"white"}',
    'pages/white.js': 'Page({});', 'pages/white.wxml': '<view>white</view>',
  });
  assert.equal(env.node('#wx-capsule').dataset.tone, 'dark');
  await env.win.wx.navigateTo({ url: '/pages/white' });
  assert.equal(env.node('#wx-capsule').dataset.tone, 'light');
  await env.win.wx.navigateBack();
  assert.equal(env.node('#wx-capsule').dataset.tone, 'dark');
});

test('runtime mounts requested page and reports started without waiting for animation callbacks', async (t) => {
  const env = await runtimeProject(t, {
    'app.js': 'App({onLaunch(options){this.globalData.launch=options;}});',
    'pages/index.js': 'Page({onLoad(options){this.received=options;}});',
    'pages/index.wxml': '<text id="mounted">Mounted content</text>',
  }, { embedded: true, beforeRuntime(win) { win.requestAnimationFrame = () => {}; } });
  const { win: context, messages } = env;
  env.init({ device: '375x667', route: 'pages/index?from=startup' });
  assert.equal(messages.some((message) => message.type === 'started'), true);
  assert.equal(messages.some((message) => message.type === 'startup-error'), false);
  assert.equal(env.node('#mounted').textContent, 'Mounted content');
  assert.equal(context.getCurrentPages()[0].received.from, 'startup');
  assert.equal(context.getApp().globalData.launch.query.from, 'startup');
  assert.equal(context.wx.getSystemInfoSync().pixelRatio, 2);
});

test('embedded runtime never silently boots with defaults before parent init and ignores old init messages', async (t) => {
  const timers = [];
  const env = await runtimeProject(t, {
    'pages/index.wxml': '<text id="mounted">Mounted content</text>',
  }, { embedded: true, beforeRuntime(win) {
    const original = win.setTimeout.bind(win);
    win.setTimeout = (callback, delay) => { timers.push(delay); return original(callback, delay); };
  } });
  const { win: context, messages } = env;
  assert.deepEqual(messages.at(-1), { source: 'wx-sim', type: 'ready', projectId: '123456789abc', instanceId: 'behavior' });
  assert.equal(timers.includes(1500), false);
  env.init({ device: '375x667', instanceId: 'old-frame' });
  assert.equal(env.node('#wx-viewport').children.length, 0);
  env.init({ device: '375x667' });
  assert.equal(context.wx.getSystemInfoSync().pixelRatio, 2);
  assert.equal(env.node('#mounted').textContent, 'Mounted content');
  assert.equal(messages.some((message) => message.type === 'startup-error'), false);
  assert.equal(messages.filter((message) => message.type === 'started').length, 1);
  env.init({ device: '430x932' });
  assert.equal(context.wx.getSystemInfoSync().pixelRatio, 2);
  assert.equal(messages.filter((message) => message.type === 'started').length, 1);
});
