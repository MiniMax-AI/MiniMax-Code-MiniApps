import assert from 'node:assert/strict';
import test from 'node:test';
import { componentFiles, runtimeProject } from './helpers/runtime-dom.mjs';

test('isolated input/textarea placeholders with the same class retain separate owners through prop changes and removal', async (t) => {
  const component = (color) => ({
    config: { styleIsolation: 'isolated' },
    script: 'Component({properties:{hintClass:String,hintStyle:String,label:String,value:String,disabled:Boolean}});',
    template: '<input class="field" placeholder="{{label}}" placeholder-class="{{hintClass}}" placeholder-style="{{hintStyle}}" value="{{value}}" disabled="{{disabled}}"/><textarea class="area" placeholder="{{label}}" placeholder-class="{{hintClass}}" placeholder-style="{{hintStyle}}" value="{{value}}" disabled="{{disabled}}"/>',
    css: `.same{color:${color};font-size:20px}.alternate{color:rgb(50,60,70);font-size:25px}`,
  });
  const env = await runtimeProject(t, {
    'pages/index.json': '{"usingComponents":{"field-a":"/components/a","field-b":"/components/b"}}',
    'pages/index.js': 'Page({data:{showA:true,showB:true,aClass:"same",bClass:"same",aStyle:"",bStyle:"",aLabel:"A hint",bLabel:"B hint",aValue:"",aDisabled:false}});',
    'pages/index.wxml': '<field-a id="a" wx:if="{{showA}}" hint-class="{{aClass}}" hint-style="{{aStyle}}" label="{{aLabel}}" value="{{aValue}}" disabled="{{aDisabled}}"/><field-b id="b" wx:if="{{showB}}" hint-class="{{bClass}}" hint-style="{{bStyle}}" label="{{bLabel}}"/>',
    'pages/index.wxss': '.same{color:rgb(0,200,0)}',
    ...componentFiles('a', component('rgb(200,10,20)')),
    ...componentFiles('b', component('rgb(10,20,200)')),
  });
  const controls = () => [...env.win.document.querySelectorAll('input,textarea')];
  const sheets = () => [...env.win.document.querySelectorAll('style[data-wx-placeholder-sheet]')];
  const signatures = () => sheets().map((sheet) => sheet.getAttribute('data-wx-placeholder-sheet'));
  assert.equal(controls().length, 4);
  assert.equal(new Set(controls().map((control) => control.getAttribute('data-wx-placeholder'))).size, 4);
  assert.equal(sheets().length, 4);
  const aScope = env.node('#a [data-wx-placeholder-mirror]').getAttribute('data-wx-style-scope');
  const bScope = env.node('#b [data-wx-placeholder-mirror]').getAttribute('data-wx-style-scope');
  assert.match(aScope, /component:/);
  assert.match(bScope, /component:/);
  assert.notEqual(aScope, bScope);
  const bRules = sheets().slice(2).map((sheet) => sheet.textContent);
  const initial = signatures();
  env.page().setData({ aClass: 'alternate', aStyle: 'color:rgb(90,80,70);font-size:30rpx', aLabel: 'A updated', aValue: 'typed', aDisabled: true });
  await env.flush();
  assert.deepEqual(signatures(), initial);
  assert.equal(env.node('#a textarea').placeholder, 'A updated');
  assert.equal(env.node('#a textarea').value, 'typed');
  assert.equal(env.node('#a textarea').disabled, true);
  assert.match(sheets()[0].textContent, /rgb\(90, 80, 70\)/);
  assert.deepEqual(sheets().slice(2).map((sheet) => sheet.textContent), bRules);
  env.page().setData({ aClass: '', aStyle: '', aLabel: '', aValue: '', aDisabled: false });
  await env.flush();
  assert.equal(env.node('#a textarea').placeholder, '');
  assert.equal(env.node('#a textarea').value, '');
  assert.equal(env.node('#a textarea').disabled, false);
  assert.doesNotMatch(sheets()[0].textContent, /rgb\(90, 80, 70\)/);
  assert.deepEqual(sheets().slice(2).map((sheet) => sheet.textContent), bRules);
  env.page().setData({ showA: false }); await env.flush();
  assert.equal(sheets().length, 2);
  assert.equal(controls().length, 2);
  assert.ok([...env.win.document.querySelectorAll('[data-wx-placeholder-mirror]')].every((mirror) => mirror.className === 'same'));
  env.page().setData({ showB: false }); await env.flush();
  assert.equal(sheets().length, 0);
  assert.equal(env.win.document.querySelectorAll('[data-wx-placeholder-mirror]').length, 0);
});

test('all button state combinations block disabled activation but loading alone remains actionable', async (t) => {
  const buttons = [];
  for (const type of ['default', 'primary', 'warn']) for (const mini of [false, true]) for (const plain of [false, true]) for (const disabled of [false, true]) for (const loading of [false, true]) {
    buttons.push({ id: 'button-' + buttons.length, type, size: mini ? 'mini' : 'default', plain, disabled, loading });
  }
  const env = await runtimeProject(t, {
    'pages/index.js': `Page({data:{buttons:${JSON.stringify(buttons)},taps:[]},tap(e){this.setData({taps:this.data.taps.concat(e.currentTarget.id)})}});`,
    'pages/index.wxml': '<button wx:for="{{buttons}}" wx:key="id" id="{{item.id}}" type="{{item.type}}" size="{{item.size}}" plain="{{item.plain}}" disabled="{{item.disabled}}" loading="{{item.loading}}" bindtap="tap">state</button>',
  });
  for (const button of buttons) {
    const node = env.node('#' + button.id);
    assert.equal(node.getAttribute('aria-disabled'), String(button.disabled));
    assert.equal(node.tabIndex, button.disabled ? -1 : 0);
    env.click('#' + button.id);
  }
  await env.flush();
  assert.deepEqual([...env.page().data.taps], buttons.filter((button) => !button.disabled).map((button) => button.id));
  const first = buttons.find((button) => button.disabled);
  const index = buttons.indexOf(first);
  env.page().setData({ [`buttons[${index}].disabled`]: false }); await env.flush();
  env.click('#' + first.id); await env.flush();
  assert.equal(env.page().data.taps.at(-1), first.id);
});
