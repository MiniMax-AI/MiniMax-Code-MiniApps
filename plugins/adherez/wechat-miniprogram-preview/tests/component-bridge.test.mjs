import test from 'node:test';
import assert from 'node:assert/strict';
import { componentFiles, runtimeProject } from './helpers/runtime-dom.mjs';

const plain = (value) => JSON.parse(JSON.stringify(value));

test('N01 runtime errors belong to their page; returning restores its diagnosis and reLaunch starts healthy', async (t) => {
  const env = await runtimeProject(t, {
    'app.json': JSON.stringify({ pages: ['pages/index', 'pages/healthy'] }),
    'pages/index.js': 'Page({onLoad(){throw new Error("page-specific failure");}});',
    'pages/index.wxml': '<text>failing page</text>',
    'pages/healthy.js': 'Page({});',
    'pages/healthy.wxml': '<text id="healthy">healthy</text>',
  });
  assert.equal(env.status().status, 'error');
  assert.equal(env.status().details[0].route, 'pages/index');
  await env.win.wx.navigateTo({ url: '/pages/healthy' });
  assert.equal(env.node('#healthy').textContent, 'healthy');
  assert.equal(env.status().status, 'rendered');
  assert.deepEqual(env.status().details, []);
  await env.win.wx.navigateBack();
  assert.equal(env.status().status, 'error');
  await env.win.wx.reLaunch({ url: '/pages/healthy' });
  assert.equal(env.status().status, 'rendered');
});

test('N01 app errors stay visible across pages while a hidden component error does not poison the current page', async (t) => {
  const env = await runtimeProject(t, {
    'app.json': JSON.stringify({ pages: ['pages/index', 'pages/healthy'] }),
    'pages/index.json': JSON.stringify({ usingComponents: { subject: '/components/subject' } }),
    'pages/index.wxml': '<subject id="subject"/>',
    ...componentFiles('subject', { script: 'Component({methods:{fail(){throw new Error("hidden component");}}});', template: '<button id="hidden-failure" bindtap="fail">fail</button>' }),
    'pages/healthy.js': 'Page({});',
    'pages/healthy.wxml': '<text>healthy</text>',
  });
  await env.win.wx.navigateTo({ url: '/pages/healthy' });
  env.click('#hidden-failure');
  assert.equal(env.status().status, 'rendered');
  await env.win.wx.navigateBack();
  assert.equal(env.status().status, 'error');
  assert.equal(env.status().details[0].route, 'pages/index');

  const appError = await runtimeProject(t, {
    'app.json': JSON.stringify({ pages: ['pages/index', 'pages/healthy'] }),
    'app.js': 'App({onLaunch(){throw new Error("app-wide failure");}});',
    'pages/healthy.js': 'Page({});',
    'pages/healthy.wxml': '<text>healthy</text>',
  });
  assert.equal(appError.status().status, 'error');
  await appError.win.wx.navigateTo({ url: '/pages/healthy' });
  assert.equal(appError.status().status, 'error');
  assert.ok(appError.status().details.some((entry) => entry.route === '' && entry.message === 'app-wide failure'));
});

test('N02 asynchronous redirect during onLoad never triggers ready after the old page unloads', async (t) => {
  const env = await runtimeProject(t, {
    'app.js': 'App({}); window.audit=[];',
    'app.json': JSON.stringify({ pages: ['pages/index', 'pages/healthy'] }),
    'pages/index.js': `Page({
      onLoad(){window.audit.push('old-load');wx.redirectTo({url:'/pages/healthy'});},
      onShow(){window.audit.push('old-show');},onReady(){window.audit.push('old-ready');},
      onUnload(){window.audit.push('old-unload');}
    });`,
    'pages/index.wxml': '<text id="stale">stale</text>',
    'pages/healthy.js': `Page({onLoad(){window.audit.push('new-load');},
      onShow(){window.audit.push('new-show');},onReady(){window.audit.push('new-ready');}});`,
    'pages/healthy.wxml': '<text id="healthy">healthy</text>',
  });
  await env.flush();
  assert.equal(env.page().route, 'pages/healthy');
  assert.equal(env.node('#stale'), null);
  assert.equal(env.node('#healthy').textContent, 'healthy');
  assert.deepEqual(plain(env.win.audit), ['old-load', 'old-show', 'old-unload', 'new-load', 'new-show', 'new-ready']);
});

test('detaching a component cancels queued ready and native events; later instances get independent lifecycle state', async (t) => {
  const env = await runtimeProject(t, {
    'app.js': 'App({}); window.audit=[];',
    'pages/index.js': 'Page({data:{shown:true}});',
    'pages/index.json': JSON.stringify({ usingComponents: { subject: '/components/subject' } }),
    'pages/index.wxml': '<subject wx:if="{{shown}}" id="subject"/>',
    ...componentFiles('subject', {
      script: `Component({lifetimes:{ready(){window.audit.push('ready');},detached(){window.audit.push('detached');}},
        methods:{tap(){window.audit.push('tap');}}});`,
      template: '<button id="button" bindtap="tap">tap</button>',
    }),
  });
  const detachedButton = env.node('#button');
  env.page().setData({ shown: false });
  await env.flush();
  detachedButton.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(plain(env.win.audit), ['detached']);
  env.page().setData({ shown: true });
  await env.flush();
  env.click('#button');
  assert.deepEqual(plain(env.win.audit), ['detached', 'ready', 'tap']);
});

test('bridge preserves TS components, named templates, imported templates and approximate inline/external WXS', async (t) => {
  const env = await runtimeProject(t, {
    'app.js': null,
    'app.ts': 'App({globalData:{base:20 as number}});',
    'pages/index.json': JSON.stringify({ usingComponents: { subject: '/components/subject' } }),
    'pages/index.wxml': '<subject id="subject"/>',
    ...componentFiles('subject', {
      script: null,
      template: '<import src="../templates/label.wxml"/><wxs module="inline">module.exports={value:2};</wxs><wxs module="external" src="../format.wxs"/><template is="label" data="{{value:count+inline.value+external.value}}"/><include src="../templates/footer.wxml"/>',
    }),
    'components/subject.ts': 'const base:number=getApp().globalData.base; Component({data:{count:base}});',
    'templates/label.wxml': '<template name="label"><text id="label">{{value}}</text></template>',
    'templates/footer.wxml': '<text id="footer">footer</text>',
    'format.wxs': 'module.exports={value:3};',
  });
  assert.equal(env.node('#label').textContent, '25');
  assert.equal(env.node('#footer').textContent, 'footer');
  env.page().selectComponent('#subject').setData({ count: 30 });
  await env.flush();
  assert.equal(env.node('#label').textContent, '35');
});

test('bridge preserves prebuilt npm modules, dynamic import, subpackage routing and selector picker interaction', async (t) => {
  const env = await runtimeProject(t, {
    'app.json': JSON.stringify({ pages: ['pages/index'], subPackages: [{ root: 'extra', pages: ['detail'] }] }),
    'pages/index.js': 'const value=require("answer"); Page({data:{answer:value,choice:"none"},choose(e){this.setData({choice:e.detail.value});},async later(){this.setData({answer:(await import("../later")).default});}});',
    'pages/index.wxml': '<text id="answer">{{answer}}</text><text id="choice">{{choice}}</text><picker id="picker" range="{{[\'A\',\'B\']}}" bindchange="choose"><text>pick</text></picker>',
    'miniprogram_npm/answer/index.js': 'module.exports=42;',
    'later.js': 'export default 43;',
    'extra/detail.js': 'Page({});',
    'extra/detail.wxml': '<text id="detail">subpackage</text>',
  });
  assert.equal(env.node('#answer').textContent, '42');
  await env.page().later();
  await env.flush();
  assert.equal(env.node('#answer').textContent, '43');
  env.click('#picker');
  const choices = env.win.document.querySelectorAll('[role="menuitem"]');
  assert.equal(choices.length, 2);
  choices[1].click();
  await env.flush();
  assert.equal(env.node('#choice').textContent, '1');
  await env.win.wx.navigateTo({ url: '/extra/detail' });
  assert.equal(env.node('#detail').textContent, 'subpackage');
});

test('swiper keeps its logical template children inside its private track after keyed updates', async (t) => {
  const env = await runtimeProject(t, {
    'pages/index.js': 'Page({data:{items:[{id:"a"},{id:"b"}],current:0},changes:[],change(e){this.changes.push(e.detail.current);}});',
    'pages/index.wxml': '<swiper id="swiper" current="{{current}}" bindchange="change"><swiper-item wx:for="{{items}}" wx:key="id" id="item-{{item.id}}">{{item.id}}</swiper-item></swiper>',
  });
  const first = env.node('#item-a');
  assert.equal(first.parentElement, env.node('#item-b').parentElement);
  assert.equal(first.parentElement.parentElement, env.node('#swiper'));
  env.page().setData({ items: [{ id: 'b' }, { id: 'a' }], current: 1 });
  await env.flush();
  assert.equal(env.node('#item-a'), first);
  assert.deepEqual([...first.parentElement.children].map((node) => node.id), ['item-b', 'item-a']);
  env.node('#swiper').dispatchEvent(new env.win.MouseEvent('pointerdown', { clientX: 100, clientY: 0 }));
  env.node('#swiper').dispatchEvent(new env.win.MouseEvent('pointerup', { clientX: 200, clientY: 0 }));
  assert.deepEqual(plain(env.page().changes), [0]);
});

test('unrelated parent renders do not reassign object properties or rerun their observers', async (t) => {
  const env = await runtimeProject(t, {
    'app.js': 'App({}); window.audit=[];',
    'pages/index.js': 'Page({data:{item:{count:1},other:0}});',
    'pages/index.json': JSON.stringify({ usingComponents: { subject: '/components/subject' } }),
    'pages/index.wxml': '<subject id="subject" item="{{item}}"/><text>{{other}}</text>',
    ...componentFiles('subject', {
      script: 'Component({properties:{item:{type:Object,observer(){window.audit.push("item");}}}});',
      template: '<text id="count">{{item.count}}</text>',
    }),
  });
  assert.deepEqual(plain(env.win.audit), ['item']);
  env.win.audit.length = 0;
  env.page().setData({ other: 1 });
  await env.flush();
  assert.deepEqual(plain(env.win.audit), []);
  env.page().setData({ 'item.count': 2 });
  await env.flush();
  assert.deepEqual(plain(env.win.audit), ['item']);
  assert.equal(env.node('#count').textContent, '2');
});

test('named slot projection retains its owner, updates content and stays separate from the default slot', async (t) => {
  const env = await runtimeProject(t, {
    'pages/index.js': 'Page({data:{title:"first",body:"body"}});',
    'pages/index.json': JSON.stringify({ usingComponents: { card: '/components/card' } }),
    'pages/index.wxml': '<card id="card"><text slot="title" id="title">{{title}}</text><text id="body">{{body}}</text></card>',
    ...componentFiles('card', {
      script: 'Component({options:{multipleSlots:true}});',
      template: '<view id="header"><slot name="title"/></view><view id="content"><slot/></view>',
    }),
  });
  assert.equal(env.node('#title').parentElement, env.node('#header'));
  assert.equal(env.node('#body').parentElement, env.node('#content'));
  env.page().setData({ title: 'second', body: 'changed' });
  await env.flush();
  assert.equal(env.node('#header').textContent, 'second');
  assert.equal(env.node('#content').textContent, 'changed');
});

test('disposed component controls and a late setData callback do not execute against the next page', async (t) => {
  const env = await runtimeProject(t, {
    'app.js': 'App({}); window.audit=[];',
    'app.json': JSON.stringify({ pages: ['pages/index', 'pages/healthy'] }),
    'pages/index.json': JSON.stringify({ usingComponents: { subject: '/components/subject' } }),
    'pages/index.wxml': '<subject id="subject"/>',
    ...componentFiles('subject', {
      script: `Component({data:{value:''},methods:{
        input(){window.audit.push('input');},
        change(){this.setData({value:'saved'},()=>window.audit.push('callback'));}
      }});`,
      template: '<input id="input" value="{{value}}" bindinput="input"/>',
    }),
    'pages/healthy.js': 'Page({});',
    'pages/healthy.wxml': '<text>healthy</text>',
  });
  const control = env.node('#input input');
  env.page().selectComponent('#subject').change();
  await env.win.wx.reLaunch({ url: '/pages/healthy' });
  await env.flush();
  control.dispatchEvent(new env.win.Event('input', { bubbles: true }));
  assert.deepEqual(plain(env.win.audit), []);
});

test('propertyEarlyInit passes normalized properties before created and initial template rendering', async (t) => {
  const env = await runtimeProject(t, {
    'app.js': 'App({}); window.audit=[];',
    'pages/index.json': JSON.stringify({ usingComponents: { subject: '/components/subject' } }),
    'pages/index.wxml': '<subject id="subject" count="{{5}}"/>',
    ...componentFiles('subject', {
      script: `Component({options:{propertyEarlyInit:true},properties:{count:Number},
        lifetimes:{created(){window.audit.push(this.data.count);}}});`,
      template: '<text id="count">{{count}}</text>',
    }),
  });
  assert.deepEqual(plain(env.win.audit), [5]);
  assert.equal(env.page().selectComponent('#subject').data.count, 5);
  assert.equal(env.node('#count').textContent, '5');
});

test('relation linkChanged follows keyed reordering without relinking or replacing the public callers', async (t) => {
  const env = await runtimeProject(t, {
    'app.js': 'App({}); window.audit=[];',
    'pages/index.js': 'Page({data:{items:[{id:"a"},{id:"b"}]}});',
    'pages/index.json': JSON.stringify({ usingComponents: { group: '/components/group', item: '/components/item' } }),
    'pages/index.wxml': '<group id="group"><item wx:for="{{items}}" wx:key="id" id="item-{{item.id}}" label="{{item.id}}"/></group>',
    ...componentFiles('group', { script: 'Component({relations:{"./item":{type:"child",linked(child){window.audit.push(["linked",child.data.label]);},linkChanged(child){window.audit.push(["changed",child.data.label]);}}}});', template: '<slot/>' }),
    ...componentFiles('item', { script: 'Component({properties:{label:String},relations:{"./group":{type:"parent"}}});', template: '<text>{{label}}</text>' }),
  });
  const group = env.page().selectComponent('#group');
  const first = env.page().selectComponent('#item-a');
  const second = env.page().selectComponent('#item-b');
  assert.deepEqual(plain(group.getRelationNodes('./item').map((item) => item.id)), ['item-a', 'item-b']);
  env.win.audit.length = 0;
  env.page().setData({ items: [{ id: 'b' }, { id: 'a' }] });
  await env.flush();
  const related = group.getRelationNodes('./item');
  assert.equal(related[0], second);
  assert.equal(related[1], first);
  assert.ok(env.win.audit.some((entry) => entry[0] === 'changed'));
  assert.equal(env.win.audit.some((entry) => entry[0] === 'linked'), false);
});

test('definitionFilter can change component options and an untyped property distinguishes objects from JSON strings', async (t) => {
  const env = await runtimeProject(t, {
    'pages/index.js': 'Page({data:{value:{count:1}}});',
    'pages/index.json': JSON.stringify({ usingComponents: { subject: '/components/subject' } }),
    'pages/index.wxml': '<view id="layout"><subject id="subject" value="{{value}}"/></view>',
    ...componentFiles('subject', {
      script: `const config=Behavior({definitionFilter(def){def.options={virtualHost:true};}});
        Component({behaviors:[config],properties:{value:null}});`,
      template: '<text id="value">{{value}}</text>',
    }),
  });
  const component = env.page().selectComponent('#subject');
  assert.equal(env.node('#value').parentElement, env.node('#layout'));
  assert.deepEqual(plain(component.data.value), { count: 1 });
  env.page().setData({ value: '{"count":1}' });
  await env.flush();
  assert.equal(component.data.value, '{"count":1}');
  assert.equal(env.node('#value').textContent, '{"count":1}');
});

for (const declaration of ['Page', 'Component']) {
  test(`N01 ${declaration} errors remain instance-local when the same route appears twice in the navigation stack`, async (t) => {
    const methods = `onLoad(query){this.setData({label:query.label||'original'});},fail(){throw new Error(this.data.label+' failure');}`;
    const env = await runtimeProject(t, {
      'pages/index.js': declaration === 'Page' ? `Page({data:{label:''},${methods}});` : `Component({data:{label:''},methods:{${methods}}});`,
      'pages/index.json': declaration === 'Component' ? '{"component":true}' : '{}',
      'pages/index.wxml': '<text id="label">{{label}}</text><button id="fail" bindtap="fail">fail</button>',
    });
    const first = env.page();
    env.click('#fail');
    assert.equal(env.status().status, 'error');
    await env.win.wx.navigateTo({ url: '/pages/index?label=second' });
    const second = env.win.getCurrentPages().at(-1);
    assert.notEqual(second, first);
    assert.equal(env.status().status, 'rendered');
    assert.equal(second.data.label, 'second');
    await env.win.wx.navigateBack();
    assert.equal(env.win.getCurrentPages().at(-1), first);
    assert.equal(env.status().status, 'error');
    assert.ok(env.status().details.some((item) => item.message === 'original failure'));
    await env.win.wx.reLaunch({ url: '/pages/index?label=restarted' });
    assert.equal(env.status().status, 'rendered');
    assert.equal(env.page().data.label, 'restarted');
    assert.notEqual(env.page(), first);
  });
}

test('N02 Component-declared page redirect cancels page ready and nested component ready after unload', async (t) => {
  const env = await runtimeProject(t, {
    'app.js': 'App({});window.audit=[];',
    'app.json': '{"pages":["pages/index","pages/healthy"]}',
    'pages/index.json': '{"component":true,"usingComponents":{"child":"/components/child"}}',
    'pages/index.js': `Component({lifetimes:{ready(){window.audit.push('root-ready');},detached(){window.audit.push('root-detached');}},methods:{
      onLoad(){window.audit.push('old-load');wx.redirectTo({url:'/pages/healthy'});},
      onUnload(){window.audit.push('old-unload');},onReady(){window.audit.push('page-ready');}
    }});`,
    'pages/index.wxml': '<child/>',
    ...componentFiles('child', { script: `Component({lifetimes:{ready(){window.audit.push('child-ready');},detached(){window.audit.push('child-detached');}}});` }),
    'pages/healthy.js': `Page({onReady(){window.audit.push('new-ready');}});`,
    'pages/healthy.wxml': '<text>healthy</text>',
  });
  await env.flush();
  assert.equal(env.page().route, 'pages/healthy');
  assert.deepEqual(plain(env.win.audit), ['old-load', 'old-unload', 'child-detached', 'root-detached', 'new-ready']);
});

test('N02 ordinary Page queued setData callback cannot execute after onUnload', async (t) => {
  const env = await runtimeProject(t, {
    'app.js': 'App({});window.audit=[];',
    'app.json': '{"pages":["pages/index","pages/healthy"]}',
    'pages/index.js': `Page({data:{value:0},onUnload(){window.audit.push('unload');this.setData({value:1},()=>window.audit.push('stale-callback'));}});`,
    'pages/healthy.js': 'Page({});', 'pages/healthy.wxml': '<text>healthy</text>',
  });
  await env.win.wx.reLaunch({ url: '/pages/healthy' });
  await env.flush();
  assert.deepEqual(plain(env.win.audit), ['unload']);
  assert.equal(env.page().route, 'pages/healthy');
});

test('page handle and runtime disposal can repeat without duplicate detach, observers or late callbacks', async (t) => {
  let runtime;
  let pageHandle;
  const env = await runtimeProject(t, {
    'app.js': 'App({});window.audit=[];',
    'pages/index.json': '{"usingComponents":{"child":"/components/child"}}',
    'pages/index.wxml': '<child id="child"/>',
    ...componentFiles('child', { script: `Component({data:{value:0},observers:{value(){window.audit.push('observer');}},lifetimes:{
      detached(){window.audit.push('detached');},ready(){window.audit.push('ready');}
    }});` }),
  }, { afterComponents(win) {
    const create = win.WxComponentRuntime.createRuntime;
    win.WxComponentRuntime = { ...win.WxComponentRuntime, createRuntime(host) {
      runtime = create(host); const page = runtime.createPageRoot.bind(runtime);
      runtime.createPageRoot = (input) => { pageHandle = page(input); return pageHandle; };
      return runtime;
    } };
  } });
  const child = env.page().selectComponent('#child');
  pageHandle.dispose(); pageHandle.dispose(); runtime.dispose(); runtime.dispose();
  child.setData({ value: 1 }, () => env.win.audit.push('callback'));
  child.updateData({ value: 2 });
  child.applyDataUpdates();
  await env.flush();
  assert.deepEqual(plain(env.win.audit), ['detached']);
  assert.equal(env.node('[data-wx-comp]'), null);
});

test('a failed update cleans only newly allocated nodes and preserves the mounted sibling component', async (t) => {
  const intervals = new Set();
  let fail = true;
  const env = await runtimeProject(t, {
    'app.js': 'App({});window.audit=[];',
    'pages/index.js': 'Page({data:{shown:false}});',
    'pages/index.json': '{"usingComponents":{"stable":"/components/stable","pending":"/components/pending"}}',
    'pages/index.wxml': '<stable id="stable"/><pending wx:if="{{shown}}" id="pending"/>',
    ...componentFiles('stable', { script: `Component({data:{count:0},lifetimes:{detached(){window.audit.push('stable-detached');}},methods:{tap(){this.setData({count:this.data.count+1})}}});`, template: '<button id="stable-button" bindtap="tap">{{count}}</button>' }),
    ...componentFiles('pending', { template: '<swiper autoplay="{{true}}"><swiper-item>pending</swiper-item></swiper><view-crash/>', css: 'view{color:red}' }),
  }, { beforeRuntime(win) {
    const set = win.setInterval.bind(win), clear = win.clearInterval.bind(win), create = win.document.createElement.bind(win.document);
    win.setInterval = (callback, delay) => { const id = set(callback, delay); intervals.add(id); return id; };
    win.clearInterval = (id) => { intervals.delete(id); return clear(id); };
    win.document.createElement = (tag, options) => {
      if (tag === 'wx-view-crash' && fail) throw new Error('failed pending render');
      return create(tag, options);
    };
  } });
  const stable = env.page().selectComponent('#stable');
  const button = env.node('#stable-button');
  env.page().setData({ shown: true });
  await env.flush();
  assert.equal(env.status().status, 'error');
  assert.equal(env.page().selectComponent('#stable'), stable);
  assert.equal(env.node('#stable-button'), button);
  assert.deepEqual(plain(env.win.audit), []);
  assert.equal(intervals.size, 0);
  env.click('#stable-button');
  assert.equal(stable.data.count, 1);
  fail = false;
  env.page().setData({ shown: true });
  await env.flush();
  assert.ok(env.page().selectComponent('#pending'));
  assert.equal(intervals.size, 1);
  env.page().setData({ shown: false });
  await env.flush();
  assert.equal(intervals.size, 0);
  assert.equal(env.page().selectComponent('#stable'), stable);
});

for (const declaration of ['Page', 'Component']) {
  test(`partial ${declaration} render failure releases created native timers, placeholder rules and component styles`, async (t) => {
    const intervals = new Set();
    let crashed = false;
    const env = await runtimeProject(t, {
      'app.json': '{"pages":["pages/index","pages/healthy"]}',
      'pages/index.json': '{"component":true,"usingComponents":{"child":"/components/child"}}',
      'pages/index.js': declaration + '({});',
      'pages/index.wxml': '<child/>',
      ...componentFiles('child', {
        template: '<swiper autoplay="{{true}}" interval="10000"><swiper-item>A</swiper-item><swiper-item>B</swiper-item></swiper><input placeholder="hint"/><view-crash/>',
        css: 'view{color:red}',
      }),
      'pages/healthy.js': 'Page({});', 'pages/healthy.wxml': '<text>healthy</text>',
    }, { beforeRuntime(win) {
      const set = win.setInterval.bind(win), clear = win.clearInterval.bind(win), create = win.document.createElement.bind(win.document);
      win.setInterval = (callback, delay) => { const id = set(callback, delay); intervals.add(id); return id; };
      win.clearInterval = (id) => { intervals.delete(id); return clear(id); };
      win.document.createElement = (tag, options) => {
        if (tag === 'wx-view-crash' && !crashed) { crashed = true; throw new Error('intentional native construction failure'); }
        return create(tag, options);
      };
    } });
    assert.equal(env.status().status, 'error');
    assert.ok(env.status().details.some((item) => item.message.includes('intentional native construction failure')));
    assert.equal(intervals.size, 0);
    assert.equal(env.win.document.querySelectorAll('style[data-wx-placeholder-sheet]').length, 0);
    assert.equal([...env.win.document.querySelectorAll('style')].filter((sheet) => sheet.textContent.includes(':instance-')).length, 0);
    await env.win.wx.reLaunch({ url: '/pages/healthy' });
    await env.flush();
    assert.equal(env.status().status, 'rendered');
    assert.equal(intervals.size, 0);
  });
}

test('generics and Component-page virtualHost limitations are reported with their owning route', async (t) => {
  const env = await runtimeProject(t, {
    'pages/index.js': 'Component({options:{virtualHost:true}});',
    'pages/index.json': '{"component":true,"usingComponents":{"subject":"/components/subject"}}',
    'pages/index.wxml': '<subject/>',
    ...componentFiles('subject', { config: { componentGenerics: { content: true } } }),
  });
  assert.equal(env.status().status, 'limited');
  for (const hint of ['virtualHost on a Component-declared page', 'componentGenerics']) {
    assert.ok(env.status().details.some((item) => item.message.includes(hint) && item.route === 'pages/index'), hint);
  }
});
