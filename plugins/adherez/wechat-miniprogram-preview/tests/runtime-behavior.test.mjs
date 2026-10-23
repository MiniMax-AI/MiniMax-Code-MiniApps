import test from 'node:test';
import assert from 'node:assert/strict';
import { componentFiles, runtimeProject } from './helpers/runtime-dom.mjs';

const pageComponents = (components) => JSON.stringify({ usingComponents: Object.fromEntries(components.map((name) => [name, `/components/${name}`])) });
const plain = (value) => JSON.parse(JSON.stringify(value));

test('default component styles stay isolated; apply-shared and shared exchange only their allowed styles', async (t) => {
  const env = await runtimeProject(t, {
    'app.wxss': '.from-app { background-color: rgb(1, 2, 3); }',
    'pages/index.json': pageComponents(['isolated', 'apply', 'shared']),
    'pages/index.wxss': '.from-page { color: rgb(11, 22, 33); }',
    'pages/index.wxml': '<view id="page" class="outbound from-private">page</view><isolated/><apply/><shared/>',
    ...componentFiles('isolated', { template: '<view id="isolated" class="from-app from-page outbound">isolated</view>' }),
    ...componentFiles('apply', {
      config: { styleIsolation: 'apply-shared' },
      css: '.from-private { border-top: 4px solid red; }',
      template: '<view id="apply" class="from-app from-page outbound">apply</view>',
    }),
    ...componentFiles('shared', {
      script: 'Component({options:{styleIsolation:"shared"}});',
      css: '.outbound { padding-top: 17px; }',
      template: '<view id="shared" class="from-app from-page outbound">shared</view>',
    }),
  });
  const style = (id) => env.win.getComputedStyle(env.node(id));
  assert.notEqual(style('#isolated').backgroundColor, 'rgb(1, 2, 3)');
  assert.notEqual(style('#isolated').color, 'rgb(11, 22, 33)');
  assert.notEqual(style('#isolated').paddingTop, '17px');
  for (const id of ['#apply', '#shared']) {
    assert.equal(style(id).backgroundColor, 'rgb(1, 2, 3)');
    assert.equal(style(id).color, 'rgb(11, 22, 33)');
    assert.equal(style(id).paddingTop, '17px');
  }
  assert.equal(style('#page').paddingTop, '17px');
  assert.notEqual(style('#page').borderTopWidth, '4px');
});

test('component hosts, external classes and slots keep the parent style scope without exposing private children', async (t) => {
  const env = await runtimeProject(t, {
    'pages/index.json': pageComponents(['card']),
    'pages/index.wxss': '.public { color: rgb(3, 4, 5); } .private { background-color: rgb(8, 9, 10); } .host { padding-top: 13px; }',
    'pages/index.wxml': '<card id="host" class="host" accent="public"><view id="slot" class="public private">slot</view></card>',
    ...componentFiles('card', {
      script: 'Component({externalClasses:["accent"]});',
      css: '.private { padding-top: 7px; } :host { display: block; }',
      template: '<view id="external" class="accent private">external</view><view id="private" class="public">private</view><slot/>',
    }),
  });
  const style = (id) => env.win.getComputedStyle(env.node(id));
  assert.equal(style('#host').paddingTop, '13px');
  assert.equal(style('#host').display, 'block');
  assert.equal(style('#external').color, 'rgb(3, 4, 5)');
  assert.equal(style('#external').paddingTop, '7px');
  assert.notEqual(style('#external').backgroundColor, 'rgb(8, 9, 10)');
  assert.notEqual(style('#private').color, 'rgb(3, 4, 5)');
  assert.equal(style('#slot').color, 'rgb(3, 4, 5)');
  assert.equal(style('#slot').backgroundColor, 'rgb(8, 9, 10)');
  assert.notEqual(style('#slot').paddingTop, '7px');
});

test('recursive instances cannot match an ancestor from another instance of the same component', async (t) => {
  const env = await runtimeProject(t, {
    'pages/index.json': pageComponents(['recursive']),
    'pages/index.wxml': '<recursive depth="{{1}}"/>',
    ...componentFiles('recursive', {
      config: { usingComponents: { recursive: '/components/recursive' } },
      script: 'Component({properties:{depth:Number}});',
      css: '.outer .target { background-color: rgb(30, 40, 50); }',
      template: '<view wx:if="{{depth}}" class="outer"><view id="owned" class="target">own</view><recursive depth="{{0}}"/></view><view wx:else id="nested" class="target">nested</view>',
    }),
  });
  assert.equal(env.win.getComputedStyle(env.node('#owned')).backgroundColor, 'rgb(30, 40, 50)');
  assert.notEqual(env.win.getComputedStyle(env.node('#nested')).backgroundColor, 'rgb(30, 40, 50)');
});

test('shared stylesheet scopes follow component attachment/removal and forwarded external classes', async (t) => {
  const env = await runtimeProject(t, {
    'pages/index.json': pageComponents(['outer', 'shared']),
    'pages/index.js': 'Page({data:{show:true}});',
    'pages/index.wxss': '.theme { background-color: rgb(6, 7, 8); }',
    'pages/index.wxml': '<view id="page" class="theme">page</view><outer accent="theme"/><shared wx:if="{{show}}"/>',
    ...componentFiles('outer', {
      config: { usingComponents: { inner: '/components/inner' } },
      script: 'Component({externalClasses:["accent"]});',
      template: '<inner accent="accent"/>',
    }),
    ...componentFiles('inner', {
      script: 'Component({externalClasses:["accent"]});',
      template: '<view id="forwarded" class="accent">forwarded</view>',
    }),
    ...componentFiles('shared', { config: { styleIsolation: 'shared' }, css: '.theme { padding-top: 19px; }' }),
  });
  const style = (id) => env.win.getComputedStyle(env.node(id));
  assert.equal(style('#forwarded').backgroundColor, 'rgb(6, 7, 8)');
  assert.equal(style('#forwarded').paddingTop, '19px');
  assert.equal(style('#page').paddingTop, '19px');
  env.page().setData({ show: false });
  await env.flush();
  assert.notEqual(style('#forwarded').paddingTop, '19px');
  assert.notEqual(style('#page').paddingTop, '19px');
  env.page().setData({ show: true });
  await env.flush();
  assert.equal(style('#forwarded').paddingTop, '19px');
});

test('capture handlers run root-to-target, bubble handlers run target-to-root, and capture-catch stops traversal', async (t) => {
  const env = await runtimeProject(t, {
    'pages/index.js': 'Page({calls:[], outer(){this.calls.push("outer-capture")}, inner(){this.calls.push("inner-capture")}, tap(){this.calls.push("tap")}, bubble(){this.calls.push("bubble")}, stop(){this.calls.push("stop")}});',
    'pages/index.wxml': '<view capture-bind:tap="outer" bindtap="bubble"><view id="normal" capture-bind:tap="inner" bindtap="tap">tap</view><view capture-catch:tap="stop"><view id="stopped" bindtap="tap">stop</view></view></view>',
  });
  env.click('#normal');
  assert.deepEqual(plain(env.page().calls), ['outer-capture', 'inner-capture', 'tap', 'bubble']);
  env.page().calls.length = 0;
  env.click('#stopped');
  assert.deepEqual(plain(env.page().calls), ['outer-capture', 'stop']);
});

test('custom events default to host-only and honor capturePhase, bubbles and composed across component boundaries', async (t) => {
  const env = await runtimeProject(t, {
    'pages/index.json': pageComponents(['wrapper']),
    'pages/index.js': 'Page({calls:[], outer(e){this.calls.push(["outer",e.target.id,e.currentTarget.id,e.detail.value])}, capture(e){this.calls.push(["capture",e.target.id,e.currentTarget.id,e.detail.value])}, boundary(e){this.calls.push(["boundary",e.target.id,e.currentTarget.id,e.detail.value])}});',
    'pages/index.wxml': '<view id="outer" capture-bind:change="capture" bindchange="outer"><wrapper id="boundary" bindchange="boundary"/></view>',
    ...componentFiles('wrapper', {
      config: { usingComponents: { child: '/components/child' } },
      script: 'Component({methods:{host(e){getCurrentPages()[0].calls.push(["host",e.target.id,e.currentTarget.id,e.detail.value])}, middle(e){getCurrentPages()[0].calls.push(["middle",e.target.id,e.currentTarget.id,e.detail.value])}}});',
      template: '<view id="middle" bindchange="middle"><child id="child" bindchange="host"/></view>',
    }),
    ...componentFiles('child'),
  });
  const child = env.page().selectComponent('#boundary').selectComponent('#child');
  child.triggerEvent('change', { value: 5 });
  assert.deepEqual(plain(env.page().calls), [['host', 'child', 'child', 5]]);
  env.page().calls.length = 0;
  child.triggerEvent('change', { value: 6 }, { bubbles: true });
  assert.deepEqual(plain(env.page().calls), [['host', 'child', 'child', 6], ['middle', 'child', 'middle', 6]]);
  env.page().calls.length = 0;
  child.triggerEvent('change', { value: 7 }, { bubbles: true, composed: true, capturePhase: true });
  assert.deepEqual(plain(env.page().calls), [
    ['capture', 'boundary', 'outer', 7], ['host', 'child', 'child', 7], ['middle', 'child', 'middle', 7],
    ['boundary', 'boundary', 'boundary', 7], ['outer', 'boundary', 'outer', 7],
  ]);
});

test('tap events preserve a projected slot target while retargeting private component children to their host', async (t) => {
  const env = await runtimeProject(t, {
    'pages/index.json': pageComponents(['card']),
    'pages/index.js': 'Page({calls:[],record(e){this.calls.push([e.target.id,e.currentTarget.id])}});',
    'pages/index.wxml': '<view id="outer" bindtap="record"><card id="host" bindtap="record"><view id="slot" bindtap="record">slot</view></card></view>',
    ...componentFiles('card', {
      script: 'Component({methods:{record(e){getCurrentPages()[0].calls.push([e.target.id,e.currentTarget.id])}}});',
      template: '<view id="wrapper" bindtap="record"><view id="private">private</view><slot/></view>',
    }),
  });
  env.click('#slot');
  assert.deepEqual(plain(env.page().calls), [['slot', 'slot'], ['slot', 'wrapper'], ['slot', 'host'], ['slot', 'outer']]);
  env.page().calls.length = 0;
  env.click('#private');
  assert.deepEqual(plain(env.page().calls), [['private', 'wrapper'], ['host', 'host'], ['host', 'outer']]);
});

test('preview status distinguishes render, unsupported calls, and runtime failure without advertising cloud or stubs', async (t) => {
  const env = await runtimeProject(t, { 'pages/index.js': 'Page({explode(){throw new Error("event failed")}});', 'pages/index.wxml': '<view id="tap" bindtap="explode">tap</view>' });
  assert.equal(env.status().status, 'rendered');
  assert.equal(env.status().instanceId, 'behavior');
  assert.equal(env.status().projectId, '123456789abc');
  for (const api of ['cloud', 'cloud.callFunction', 'request', 'downloadFile', 'createAnimation', 'createVideoContext', 'requestSubscribeMessage', 'getFileSystemManager', 'showNavigationBarLoading', 'imaginaryApi', 'getSystemInfo.imaginaryOption']) assert.equal(env.win.wx.canIUse(api), false, api);
  for (const api of ['navigateTo', 'setData', 'getStorageSync']) assert.equal(env.win.wx.canIUse(api), api !== 'setData', api);
  await assert.rejects(env.win.wx.request({ url: 'https://example.invalid' }), (error) => /not supported/.test(error.errMsg));
  assert.equal(env.status().status, 'limited');
  assert.match(env.status().details[0].code, /request/);
  env.click('#tap');
  assert.equal(env.status().status, 'error');
  assert.ok(env.status().details.some((entry) => entry.message === 'event failed'));
});

test('missing unsupported tags and component/module startup failures are visible diagnostics', async (t) => {
  const limited = await runtimeProject(t, { 'pages/index.wxml': '<map id="native"/>' });
  assert.equal(limited.status().status, 'limited');
  assert.ok(limited.status().details.some((entry) => entry.code === 'tag:map'));
  const broken = await runtimeProject(t, { 'pages/index.js': 'throw new Error("page failed"); Page({});' });
  assert.equal(broken.status().status, 'error');
  assert.ok(broken.status().details.some((entry) => entry.message === 'page failed'));
});

test('TypeScript app/page and imported named default declarations execute in the preview browser runtime', async (t) => {
  const env = await runtimeProject(t, {
    'app.js': null, 'pages/index.js': null,
    'app.ts': 'App({globalData:{answer:41 as number}});',
    'pages/index.ts': 'import answer from "../answer"; Page({data:{value:answer()}});',
    'answer.ts': 'export default function answer():number {return getApp().globalData.answer+1;} export const alias=answer;',
    'pages/index.wxml': '<view id="answer">{{value}}</view>',
  });
  assert.equal(env.node('#answer').textContent, '42');
  assert.equal(env.status().status, 'rendered');
});

test('storage publishes immediately, rejects invalid or oversized values before mutation, and answers refresh flushes', async (t) => {
  const env = await runtimeProject(t);
  env.win.eval('wx.setStorageSync("saved", {value:42});');
  assert.deepEqual(env.messages.at(-1).data, { saved: { value: 42 } });
  assert.equal(env.messages.at(-1).type, 'storage');
  assert.equal(env.win.wx.getStorageInfoSync().limitSize, 1024);
  for (const source of [
    'wx.setStorageSync("saved", "\u4e2d".repeat(350000));',
    'wx.setStorageSync("saved", JSON.parse(\'{"__proto__":{"polluted":true}}\'));',
    'wx.setStorageSync("__proto__", 1);',
    'wx.setStorageSync("saved", {value:NaN});',
    'wx.setStorageSync("saved", new Date());',
    'wx.setStorageSync("saved", {get value(){throw new Error("must not execute")}});',
  ]) {
    assert.throws(() => env.win.eval(source), /storage:fail/);
    assert.deepEqual(plain(env.win.wx.getStorageSync('saved')), { value: 42 });
  }
  assert.equal(env.win.wx.getStorageSync('missing'), '');
  env.win.dispatchEvent(new env.win.MessageEvent('message', {
    source: env.win,
    data: { source: 'wx-shell', type: 'flush-storage', requestId: 'refresh-1', instanceId: 'behavior' },
  }));
  assert.deepEqual(env.messages.at(-1), {
    type: 'storage-flushed', requestId: 'refresh-1', data: { saved: { value: 42 } },
    source: 'wx-sim', projectId: '123456789abc', instanceId: 'behavior',
  });
});

test('quiesce returns a final storage snapshot, blocks UI and all programmatic mutations, and resumes explicitly', async (t) => {
  const env = await runtimeProject(t, {
    'pages/index.js': 'Page({data:{count:0},tap(){this.setData({count:this.data.count+1});wx.setStorageSync("count",this.data.count);}});',
    'pages/index.wxml': '<button id="tap" bindtap="tap">{{count}}</button>',
  });
  env.click('#tap');
  const message = (data) => env.win.dispatchEvent(new env.win.MessageEvent('message', {
    source: env.win.parent, data: { source: 'wx-shell', instanceId: 'behavior', ...data },
  }));
  message({ type: 'quiesce-storage', requestId: 'transition-1' });
  assert.equal(env.messages.at(-1).type, 'storage-flushed');
  assert.deepEqual(env.messages.at(-1).storage, { count: 1 });
  assert.ok(env.node('[data-wx-quiescing]'));
  assert.equal(env.node('#wx-viewport').inert, true);
  env.click('#tap');
  assert.equal(env.page().data.count, 1);
  for (const source of ['wx.setStorageSync("count",2)', 'wx.removeStorageSync("count")', 'wx.clearStorageSync()']) {
    assert.throws(() => env.win.eval(source), /temporarily unavailable/);
  }
  await assert.rejects(env.win.wx.setStorage({ key: 'count', data: 3 }), (error) => /temporarily unavailable/.test(error.errMsg));
  assert.equal(env.win.wx.getStorageSync('count'), 1);
  message({ type: 'resume-storage', requestId: 'stale-transition' });
  assert.ok(env.node('[data-wx-quiescing]'));
  message({ type: 'resume-storage', requestId: 'transition-1' });
  assert.equal(env.node('[data-wx-quiescing]'), null);
  env.click('#tap');
  assert.equal(env.win.wx.getStorageSync('count'), 2);
});

test('unsupported component options and animation APIs report limited on their owning page', async (t) => {
  const env = await runtimeProject(t, {
    'pages/index.json': pageComponents(['subject']),
    'pages/index.wxml': '<subject id="subject"/>',
    ...componentFiles('subject', { script: 'Component({options:{dynamicSlots:true,unknownOption:true}});' }),
  });
  const subject = env.page().selectComponent('#subject');
  assert.equal(subject.getPageId(), env.page().__pageId);
  assert.equal(env.status().status, 'limited');
  assert.ok(env.status().details.some((detail) => detail.message.includes('dynamicSlots')));
  subject.animate();
  subject.clearAnimation();
  assert.ok(env.status().details.some((detail) => detail.code === 'component-animate'));
  assert.ok(env.status().details.every((detail) => detail.route === 'pages/index'));
});

test('self-contained frames use explicit identity and immutable asset data without network fallback', async (t) => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const env = await runtimeProject(t, {
    'pages/index.js': `Page({data:{rich:[{name:'img',attrs:{src:'/image.png'}}]}});`,
    'pages/index.wxml': '<image id="image" src="/image.png"/><rich-text id="rich" nodes="{{rich}}"/><image id="missing" src="/missing.png"/><view id="background" style="background-image:url(\'/image.png\')"/>',
  }, { beforeRuntime(win) {
    win.__WX_PREVIEW_FRAME__ = { projectId: 'abcdefabcdef', previewId: 'pv-self-contained', instanceId: 'self-contained', assets: { 'image.png': png } };
  } });
  assert.equal(env.node('#image img').src, png);
  assert.equal(env.node('#rich img').src, png);
  assert.ok(env.node('#background').style.backgroundImage.includes(png));
  assert.equal(env.node('#missing img').getAttribute('src'), null);
  assert.equal(env.status().status, 'limited');
  assert.equal(env.status().projectId, 'abcdefabcdef');
  assert.equal(env.status().instanceId, 'self-contained');
  await env.win.wx.previewImage({ urls: ['/image.png'] });
  assert.equal(env.node('.wx-image-preview img').src, png);
});
