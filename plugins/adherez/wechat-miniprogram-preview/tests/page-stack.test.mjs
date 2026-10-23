import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { componentFiles, runtimeProject } from './helpers/runtime-dom.mjs';

const baseStyles = await readFile(new URL('../miniapp/client/sim-base.css', import.meta.url), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));
const page = (name) => `Page({data:{value:0},onLoad(q){this.query=q;getApp().audit.push('${name}:load')},onShow(){getApp().audit.push('${name}:show')},onReady(){getApp().audit.push('${name}:ready')},onHide(){getApp().audit.push('${name}:hide')},onUnload(){getApp().audit.push('${name}:unload')}});`;
const fixture = {
  'app.json': JSON.stringify({ pages: ['pages/index', 'pages/detail', 'pages/third'] }),
  'app.js': 'App({audit:[]});',
  'pages/index.js': page('index'),
  'pages/index.wxml': '<input id="draft"/><textarea id="notes"/><input id="bound" value="{{value}}"/><scroll-view id="nested" scroll-y="true"><view>nested</view></scroll-view><text id="value">{{value}}</text>',
  'pages/detail.js': page('detail'), 'pages/detail.wxml': '<text>detail</text>',
  'pages/third.js': page('third'), 'pages/third.wxml': '<text>third</text>',
};

test('back reveals the original page, native drafts and components without reloading or detaching it', async (t) => {
  const env = await runtimeProject(t, {
    ...fixture,
    'pages/index.json': '{"usingComponents":{"counter":"/components/counter"}}',
    'pages/index.wxml': fixture['pages/index.wxml'] + '<counter id="counter"/>',
    ...componentFiles('counter', {
      script: 'Component({data:{count:0},lifetimes:{attached(){getApp().audit.push("counter:attached")},detached(){getApp().audit.push("counter:detached")}},pageLifetimes:{show(){getApp().audit.push("counter:show")},hide(){getApp().audit.push("counter:hide")}}});',
      template: '<text>{{count}}</text>',
    }),
  }, { beforeRuntime(win) {
    const style = win.document.createElement('style'); style.textContent = baseStyles;
    win.document.head.prepend(style);
  } });
  await env.flush();
  const { win } = env;
  const first = env.page(), firstEl = env.node('wx-page');
  const counter = first.selectComponent('#counter');
  const draft = env.node('#draft input'), notes = env.node('#notes textarea');
  draft.value = 'unfinished input'; notes.value = 'unfinished notes';
  firstEl.scrollTop = 420; env.node('#nested').scrollTop = 140;
  first.setData({ value: 7 }); counter.setData({ count: 3 }); await env.flush();
  const audit = win.getApp().audit; audit.length = 0;

  await win.wx.navigateTo({ url: '/pages/detail?id=second' });
  await env.flush();
  assert.equal(win.getCurrentPages().length, 2);
  assert.equal(win.getCurrentPages()[0], first);
  assert.equal(firstEl.isConnected, true);
  assert.equal(firstEl.hasAttribute('inert'), true);
  assert.equal(firstEl.getAttribute('aria-hidden'), 'true');
  assert.notEqual(win.getComputedStyle(firstEl).display, 'none');
  assert.equal(win.getComputedStyle(firstEl).visibility, 'hidden');
  assert.deepEqual(plain(audit), ['index:hide', 'counter:hide', 'detail:load', 'detail:show', 'detail:ready']);

  // Timers and async callbacks may still update a covered Page.
  first.setData({ value: 8 }); await env.flush();
  await win.wx.navigateBack(); await env.flush();
  assert.equal(env.page(), first);
  assert.equal(env.node('wx-page'), firstEl);
  assert.equal(env.node('#draft input'), draft);
  assert.equal(draft.value, 'unfinished input');
  assert.equal(notes.value, 'unfinished notes');
  assert.equal(env.node('#bound input').value, '8');
  assert.equal(first.selectComponent('#counter'), counter);
  assert.equal(counter.data.count, 3);
  assert.equal(firstEl.scrollTop, 420);
  assert.equal(env.node('#nested').scrollTop, 140);
  assert.equal(firstEl.hasAttribute('inert'), false);
  assert.equal(firstEl.hasAttribute('aria-hidden'), false);
  assert.equal(win.getComputedStyle(firstEl).visibility, 'visible');
  assert.deepEqual(plain(audit.slice(-3)), ['detail:unload', 'index:show', 'counter:show']);
  assert.equal(audit.includes('index:load'), false);
  assert.equal(audit.includes('counter:detached'), false);
});

test('repeated routes have independent entries; back delta unloads only popped pages', async (t) => {
  const env = await runtimeProject(t, fixture); await env.flush();
  const first = env.page(), { win } = env;
  await win.wx.navigateTo({ url: '/pages/index?copy=second' }); await env.flush();
  const second = win.getCurrentPages()[1]; second.setData({ value: 20 });
  await win.wx.navigateTo({ url: '/pages/third' }); await env.flush();
  assert.notEqual(first, second);
  assert.equal(first.data.value, 0); assert.equal(second.query.copy, 'second');
  const audit = win.getApp().audit; audit.length = 0;
  await win.wx.navigateBack({ delta: 2 }); await env.flush();
  assert.deepEqual(plain(audit), ['third:unload', 'index:unload', 'index:show']);
  assert.equal(win.getCurrentPages().length, 1); assert.equal(env.page(), first);
  assert.equal(env.win.document.querySelectorAll('wx-page').length, 1);
  assert.equal(second.__alive, false);
  second.setData({ value: 99 }); await env.flush();
  assert.equal(first.data.value, 0);
});

test('redirect replaces only the top while relaunch destroys the old stack', async (t) => {
  const env = await runtimeProject(t, fixture); await env.flush();
  const first = env.page(), { win } = env;
  await win.wx.navigateTo({ url: '/pages/detail' }); await env.flush();
  const detail = win.getCurrentPages()[1];
  await win.wx.redirectTo({ url: '/pages/third' }); await env.flush();
  assert.equal(win.getCurrentPages().length, 2);
  assert.equal(win.getCurrentPages()[0], first);
  assert.equal(detail.__alive, false);
  await win.wx.navigateBack(); await env.flush();
  assert.equal(env.page(), first);
  await win.wx.reLaunch({ url: '/pages/index' }); await env.flush();
  assert.notEqual(env.page(), first);
  assert.equal(first.__alive, false);
  assert.equal(win.getCurrentPages().length, 1);
});

test('tab pages are retained and do not receive duplicate hide when closing their detail', async (t) => {
  const env = await runtimeProject(t, { ...fixture,
    'app.json': JSON.stringify({ pages: ['pages/index', 'pages/detail', 'pages/third'], tabBar: { list: [{ pagePath: 'pages/index', text: 'One' }, { pagePath: 'pages/third', text: 'Two' }] } }),
  });
  await env.flush();
  const first = env.page(), { win } = env;
  first.setData({ value: 4 });
  await win.wx.navigateTo({ url: '/pages/detail' }); await env.flush();
  await win.wx.switchTab({ url: '/pages/third' }); await env.flush();
  await win.wx.switchTab({ url: '/pages/index' }); await env.flush();
  assert.equal(env.page(), first); assert.equal(first.data.value, 4);
  const audit = plain(win.getApp().audit);
  assert.equal(audit.filter((e) => e === 'index:hide').length, 1);
  assert.equal(audit.filter((e) => e === 'index:load').length, 1);
  assert.equal(audit.filter((e) => e === 'detail:unload').length, 1);
  assert.equal(audit.includes('index:unload'), false);
  assert.equal(env.win.document.querySelectorAll('wx-page[inert]').length, 1);
});

test('a page covered before ready gets ready once when first revealed again', async (t) => {
  const env = await runtimeProject(t, fixture);
  await env.win.wx.navigateTo({ url: '/pages/detail' }); await env.flush();
  assert.equal(env.win.getApp().audit.includes('index:ready'), false);
  await env.win.wx.navigateBack(); await env.flush();
  await env.win.wx.navigateTo({ url: '/pages/detail' }); await env.win.wx.navigateBack(); await env.flush();
  assert.equal(env.win.getApp().audit.filter((e) => e === 'index:ready').length, 1);
});

test('invalid routes and stack overflow leave the current live stack intact', async (t) => {
  const env = await runtimeProject(t, fixture); await env.flush();
  const { win } = env, first = env.page();
  const audit = win.getApp().audit; audit.length = 0;
  await assert.rejects(win.wx.navigateTo({ url: '/missing' }));
  assert.equal(env.page(), first); assert.deepEqual(plain(audit), []);
  for (let i = 0; i < 9; i++) await win.wx.navigateTo({ url: '/pages/detail?n=' + i });
  const top = win.getCurrentPages().at(-1);
  await assert.rejects(win.wx.navigateTo({ url: '/pages/third' }));
  assert.equal(win.getCurrentPages().length, 10); assert.equal(win.getCurrentPages().at(-1), top);
  await win.wx.navigateBack({ delta: 99 });
  assert.equal(win.getCurrentPages().length, 1); assert.equal(env.page(), first);
});

test('covered pages keep their own viewport metrics when the next route has custom navigation', async (t) => {
  const env = await runtimeProject(t, { ...fixture, 'pages/detail.json': '{"navigationStyle":"custom"}' });
  const firstEl = env.node('wx-page');
  await env.win.wx.navigateTo({ url: '/pages/detail' });
  assert.equal(firstEl.style.getPropertyValue('--wx-vh'), '7.53px');
  assert.equal(env.win.document.documentElement.style.getPropertyValue('--wx-vh'), '8.44px');
  await env.win.wx.navigateBack();
  assert.equal(firstEl.style.getPropertyValue('--wx-vh'), '');
  assert.equal(env.win.document.documentElement.style.getPropertyValue('--wx-vh'), '7.53px');
});
