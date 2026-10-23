import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { compileWxss, convertUnits } from '../miniapp/node/wxss.mjs';
import { convertStyleValues } from '../miniapp/client/style-values.mjs';
import { componentFiles, runtimeProject } from './helpers/runtime-dom.mjs';
import { rewriteCssUrls } from '../miniapp/client/css-urls.mjs';

const source = await readFile(new URL('../miniapp/client/device-config.js', import.meta.url), 'utf8');
const context = vm.createContext({ window: {} });
vm.runInContext(source, context);
const devices = context.window.__WX_PREVIEW_DEVICES__;

test('styles share logical viewport, rpx and device safe-area conversions', () => {
  const style = 'height:100vh; min-height:50svh; max-height:75lvh; top:-.5dvh; padding:24rpx 0rpx env(safe-area-inset-bottom); margin:constant(safe-area-inset-top, 0px);';
  const expected = 'height:calc(100 * var(--wx-vh)); min-height:calc(50 * var(--wx-vh)); max-height:calc(75 * var(--wx-vh)); top:calc(-.5 * var(--wx-vh)); padding:calc(24 * var(--wx-rpx)) 0 var(--wx-safe-area-inset-bottom); margin:var(--wx-safe-area-inset-top);';
  assert.equal(convertStyleValues(style), expected);
  assert.equal(convertUnits(style), expected);
  assert.equal(convertStyleValues('padding:ENV( safe-area-inset-left , calc(2px + 1px)) CONSTANT(safe-area-inset-right);'),
    'padding:var(--wx-safe-area-inset-left) var(--wx-safe-area-inset-right);');
  assert.equal(convertStyleValues('height:calc(100dvh - 20rpx);'), 'height:calc(calc(100 * var(--wx-vh)) - calc(20 * var(--wx-rpx)));');
});

test('value conversion does not corrupt strings, comments, URLs or identifiers', () => {
  const untouched = `content:"100vh env(safe-area-inset-bottom)";font-family:'24rpx';/* 75lvh */background:url("/100vh)file.png");mask:URL(data:image/svg+xml;payload=100vh\\)24rpx);--identifier100vh:1px;--rpx20rpx:2px;`;
  assert.equal(convertStyleValues(untouched), untouched);
  assert.equal(convertStyleValues('width:var(--width-100vh); content:"\\\"30rpx";'), 'width:var(--width-100vh); content:"\\\"30rpx";');
  assert.equal(convertStyleValues('padding:env(unknown-custom-inset, 10vh);'), 'padding:env(unknown-custom-inset, 10vh);');
  assert.equal(convertStyleValues('padding:env(safe-area-inset-bottom'), 'padding:env(safe-area-inset-bottom');
});

test('page and component imported WXSS consume the same conversions as inline style values', () => {
  for (const kind of ['page', 'component']) {
    const result = compileWxss({
      source: '@import "shared.wxss"; view { height:100dvh; padding-bottom:env(safe-area-inset-bottom); }',
      file: 'pages/index.wxss', scope: { kind, id: 'pages/index' },
      resolveImport: () => ({ source: 'text { margin-top:constant(safe-area-inset-top); font-size:30rpx; }', file: 'pages/shared.wxss' }),
      rewriteUrl: (raw) => raw,
    });
    assert.deepEqual(result.warnings, []);
    assert.match(result.css, /height:calc\(100 \* var\(--wx-vh\)\)/);
    assert.match(result.css, /padding-bottom:var\(--wx-safe-area-inset-bottom\)/);
    assert.match(result.css, /margin-top:var\(--wx-safe-area-inset-top\)/);
    assert.match(result.css, /font-size:calc\(30 \* var\(--wx-rpx\)\)/);
  }
});

test('each device preserves content and safe-area geometry for default/custom navigation and both tab positions', () => {
  for (const id of devices.ids) {
    const device = devices.get(id);
    for (const customNavigation of [false, true]) {
      const navigation = customNavigation ? 0 : device.statusBarHeight + device.navHeight;
      for (const tabBarPosition of ['top', 'bottom']) for (const tabBarVisible of [false, true]) {
        const metrics = devices.metrics(id, { customNavigation, tabBarVisible, tabBarPosition });
        const top = navigation + (tabBarVisible && tabBarPosition === 'top' ? 49 : 0);
        const reservedBottom = tabBarVisible && tabBarPosition === 'bottom' ? 49 + device.safeAreaBottom : 0;
        assert.equal(metrics.contentTop, top);
        assert.equal(metrics.contentHeight, device.height - top - reservedBottom);
        assert.equal(metrics.contentTop + metrics.contentHeight + reservedBottom, device.height);
        assert.equal(metrics.windowHeight, metrics.contentHeight);
        assert.equal(metrics.screenTop, metrics.contentTop);
        assert.equal(metrics.safeAreaInsets.bottom, reservedBottom ? 0 : device.safeAreaBottom);
        assert.equal(metrics.safeAreaInsets.top, Math.max(0, device.statusBarHeight - top));
        assert.equal(parseFloat(metrics.cssVariables['--wx-vh']) * 100, metrics.contentHeight);
        assert.equal(metrics.cssVariables['--wx-safe-area-inset-bottom'], `${metrics.safeAreaInsets.bottom}px`);
        assert.equal(metrics.safeArea.bottom, device.height - device.safeAreaBottom);
      }
    }
  }
  assert.equal(devices.metrics('390x844').contentHeight, 753);
  assert.equal(devices.metrics('390x844', { customNavigation: true }).contentHeight, 844);
});

test('actual unscaled content measurements are the shared CSS/API source and invalid measurements fall back', () => {
  const measured = devices.metrics('390x844', { contentTop: 110, contentHeight: 620 });
  assert.equal(measured.screenTop, 110);
  assert.equal(measured.contentHeight, 620);
  assert.equal(measured.windowHeight, 620);
  assert.equal(measured.cssVariables['--wx-vh'], '6.2px');
  assert.equal(measured.safeAreaInsets.bottom, 0);
  const collapsed = devices.metrics('390x844', { contentTop: 0, contentHeight: 0 });
  assert.equal(collapsed.contentHeight, 0);
  const fallback = devices.metrics('390x844', { contentTop: NaN, contentHeight: Infinity });
  assert.equal(fallback.contentTop, 91);
  assert.equal(fallback.contentHeight, 753);
  const bounded = devices.metrics('390x844', { contentTop: 800, contentHeight: 1000 });
  assert.equal(bounded.contentHeight, 44);
});

test('runtime uses the shared viewport conversion and page route changes refresh CSS/API metrics together', async (t) => {
  const env = await runtimeProject(t, {
    'app.json': JSON.stringify({ pages: ['pages/index', 'pages/custom'], style: 'v2' }),
    'pages/index.wxml': '<view id="height" style="height:100vh;padding-bottom:env(safe-area-inset-bottom)"/>',
    'pages/custom.json': '{"navigationStyle":"custom"}',
    'pages/custom.js': 'Page({});', 'pages/custom.wxml': '<text>custom</text>',
  });
  assert.match(env.node('#height').getAttribute('style'), /var\(--wx-vh\)/);
  assert.equal(env.win.wx.getWindowInfo().windowHeight, 753);
  assert.equal(env.win.document.documentElement.style.getPropertyValue('--wx-vh'), '7.53px');
  assert.equal(env.win.document.body.hasAttribute('data-style-v2'), true);
  await env.win.wx.navigateTo({ url: '/pages/custom' });
  assert.equal(env.win.wx.getWindowInfo().windowHeight, 844);
  assert.equal(env.win.document.documentElement.style.getPropertyValue('--wx-safe-area-inset-top'), '47px');
});

test('placeholder rules target real controls, retain scoped classes and update or disappear with their component', async (t) => {
  const env = await runtimeProject(t, {
    'pages/index.json': JSON.stringify({ usingComponents: { subject: '/components/subject' } }),
    'pages/index.js': 'Page({data:{shown:true}});',
    'pages/index.wxml': '<subject wx:if="{{shown}}" id="subject"/>',
    ...componentFiles('subject', {
      script: 'Component({data:{color:"red",label:"hint"}});',
      template: '<input id="input" placeholder="value" placeholder-class="{{label}}" placeholder-style="color:{{color}};font-size:30rpx"/><textarea id="textarea" placeholder="other" placeholder-class="other"/>',
      css: '.hint{color:blue}.other{color:green}',
    }),
  });
  const count = () => env.win.document.querySelectorAll('style[data-wx-placeholder-sheet]').length;
  assert.equal(count(), 2);
  assert.ok(env.node('#input input').getAttribute('data-wx-placeholder'));
  assert.match(env.node('#input [data-wx-placeholder-mirror]').getAttribute('data-wx-style-scope'), /component:/);
  const css = () => [...env.win.document.querySelectorAll('style[data-wx-placeholder-sheet]')].map((sheet) => sheet.textContent).join('');
  assert.match(css(), /::placeholder\{/);
  assert.match(css(), /color: red/);
  env.page().selectComponent('#subject').setData({ color: 'orange', label: 'other' });
  await env.flush();
  assert.equal(count(), 2);
  assert.match(css(), /color: orange/);
  assert.doesNotMatch(css(), /color: red/);
  env.page().setData({ shown: false });
  await env.flush();
  assert.equal(count(), 0);
});

test('CSS URL mapping decodes escapes once and leaves comments, content strings and unchanged remote URLs intact', () => {
  const seen = [];
  const source = '.a{a:url("asset/a\\20 b.png");b:url(asset/a\\)b.png);c:url("asset/a\\\"b.png");d:url(https://example.com/a)} .b{content:"url(asset/not)"}/*url(asset/comment)*/';
  const result = rewriteCssUrls(source, (url) => { seen.push(url); return url.startsWith('asset/') ? 'data:image/png;base64,YQ==' : url; });
  assert.deepEqual(seen, ['asset/a b.png', 'asset/a)b.png', 'asset/a"b.png', 'https://example.com/a']);
  assert.equal((result.match(/data:image\/png;base64,YQ==/g) || []).length, 3);
  assert.match(result, /url\(https:\/\/example.com\/a\)/);
  assert.match(result, /content:"url\(asset\/not\)"/);
  assert.match(result, /\/\*url\(asset\/comment\)\*\//);
  assert.equal(rewriteCssUrls(source, (url) => url), source);
});

test('preview chrome and buttons use their own box model without forcing it on business content or text inputs', async (t) => {
  const baseStyles = await readFile(new URL('../miniapp/client/sim-base.css', import.meta.url), 'utf8');
  const env = await runtimeProject(t, {
    'pages/index.wxml': '<view id="ordinary"/><view id="override"/><input id="input"/><textarea id="area"/><button id="button">button</button>',
    'pages/index.wxss': '#override{box-sizing:border-box}',
  }, { beforeRuntime(win) {
    const sheet = win.document.createElement('style'); sheet.textContent = baseStyles;
    win.document.head.prepend(sheet);
  } });
  const box = (selector) => env.win.getComputedStyle(env.node(selector)).boxSizing || 'content-box';
  assert.equal(box('#ordinary'), 'content-box');
  assert.equal(box('#override'), 'border-box');
  assert.equal(box('#input'), 'content-box');
  assert.equal(box('#input input'), 'content-box');
  assert.equal(box('#area textarea'), 'content-box');
  assert.equal(box('#button'), 'border-box');
  assert.equal(box('#wx-nav'), 'border-box');
  assert.equal(box('#wx-tabbar'), 'border-box');
});
