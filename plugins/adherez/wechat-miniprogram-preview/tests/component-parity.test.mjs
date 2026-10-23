import test from 'node:test';
import assert from 'node:assert/strict';
import { componentFiles, runtimeProject } from './helpers/runtime-dom.mjs';

const plain = (value) => JSON.parse(JSON.stringify(value));
const pageComponents = (names) => JSON.stringify({ usingComponents: Object.fromEntries(names.map((name) => [name, `/components/${name}`])) });

async function componentProject(t, component, files = {}) {
  const env = await runtimeProject(t, {
    'app.js': 'App({}); window.audit = [];',
    'pages/index.json': pageComponents(['subject']),
    'pages/index.wxml': '<subject id="subject"/>',
    ...componentFiles('subject', component),
    ...files,
  });
  await env.flush();
  return env;
}

test('C01 initial property assignment runs both observer forms once with the declared old value', async (t) => {
  const env = await componentProject(t, {
    script: `Component({
      properties: { count: { type: Number, value: 0, observer(value, oldValue) {
        window.audit.push(['property', value, oldValue]);
      } } },
      observers: { count(value) { window.audit.push(['observer', value]); } }
    });`,
    template: '<text id="value">{{count}}</text>',
  }, { 'pages/index.wxml': '<subject id="subject" count="{{5}}"/>' });

  assert.equal(env.page().selectComponent('#subject').data.count, 5);
  assert.equal(env.node('#value').textContent, '5');
  assert.deepEqual(plain(env.win.audit), [['observer', 5], ['property', 5, 0]]);
});

test('C01 initial string-named property observer runs once with the declared old value', async (t) => {
  const env = await componentProject(t, {
    script: `Component({properties:{count:{type:Number,value:0,observer:'countChanged'}},
      methods:{countChanged(value,previous){window.audit.push(['property',value,previous]);}},
      observers:{count(value){window.audit.push(['observer',value]);}}});`,
    template: '<text id="value">{{count}}</text>',
  }, { 'pages/index.wxml': '<subject id="subject" count="{{5}}"/>' });
  assert.equal(env.node('#value').textContent, '5');
  assert.deepEqual(plain(env.win.audit), [['observer', 5], ['property', 5, 0]]);
});

test('C02 component setData on a property runs its property observer and updates the visible value', async (t) => {
  const env = await componentProject(t, {
    script: `Component({
      properties: { count: { type: Number, value: 0, observer: 'countChanged' } },
      methods: { countChanged(value, oldValue) { window.audit.push(['property', value, oldValue]); } },
      observers: { count(value) { window.audit.push(['observer', value]); } }
    });`,
    template: '<text id="value">{{count}}</text>',
  });
  env.win.audit.length = 0;
  env.page().selectComponent('#subject').setData({ count: 2 });
  await env.flush();

  assert.equal(env.node('#value').textContent, '2');
  assert.deepEqual(plain(env.win.audit), [['observer', 2], ['property', 2, 0]]);
});

test('C03 property declarations normalize invalid numbers, numeric strings and truthy boolean input', async (t) => {
  const env = await componentProject(t, {
    script: 'Component({properties:{numeric:Number,text:String,flag:Boolean}});',
    template: '<text id="value">{{numeric}}/{{text}}/{{flag}}</text>',
  }, {
    'pages/index.js': 'Page({data:{numeric:"oops",text:42,flag:"false"}});',
    'pages/index.wxml': '<subject id="subject" numeric="{{numeric}}" text="{{text}}" flag="{{flag}}"/>',
  });

  const { numeric, text, flag } = env.page().selectComponent('#subject').data;
  assert.deepEqual({ numeric, text, flag }, { numeric: 0, text: '42', flag: true });
  assert.equal(env.node('#value').textContent, '0/42/true');
});

test('C03 adapter public coercion rules cover null, undefined, finite/nonfinite, optional types and structured input', async (t) => {
  const env = await componentProject(t, {
    script: `Component({properties:{
      numeric:{type:Number,value:7},text:{type:String,value:'fallback'},flag:Boolean,
      list:{type:Array,value:[5]},object:{type:Object,value:{fallback:true}},
      optional:{type:Number,optionalTypes:[String,Boolean],value:9},any:null
    }});`,
    template: '<text>coercion fixture</text>',
  }, {
    'pages/index.js': 'Page({data:{incoming:1}});',
    'pages/index.wxml': '<subject id="subject" numeric="{{incoming}}" text="{{incoming}}" flag="{{incoming}}" list="{{incoming}}" object="{{incoming}}" optional="{{incoming}}" any="{{incoming}}"/>',
  });
  // Expectations follow glass-easel 1.2.0 convertValueToType, not browser input coercion.
  const cases = [
    ['null', 0, '', false, [], null, 0],
    ['undefined', 0, '', false, [], null, 0],
    ['""', 0, '', false, [], null, ''],
    ['"  "', 0, '  ', true, [], null, '  '],
    ['"12.5"', 12.5, '12.5', true, [], null, '12.5'],
    ['false', 0, 'false', false, [], null, false],
    ['true', 1, 'true', true, [], null, true],
    ['NaN', 0, 'NaN', false, [], null, 0],
    ['Infinity', 0, 'Infinity', true, [], null, 0],
    ['[]', 0, '', true, [], [], 0],
    ['({count:2})', 0, '[object Object]', true, [], { count: 2 }, 0],
  ];
  for (const [source, numeric, text, flag, list, object, optional] of cases) {
    env.win.eval(`getCurrentPages()[0].setData({incoming:${source}});`);
    await env.flush();
    const data = env.page().selectComponent('#subject').data;
    assert.deepEqual(plain({ numeric: data.numeric, text: data.text, flag: data.flag, list: data.list, object: data.object, optional: data.optional }),
      { numeric, text, flag, list, object, optional }, source);
    const input = env.win.eval(source);
    if (typeof input === 'object' && input !== null) {
      assert.deepEqual(plain(data.any), plain(input), source);
      assert.notEqual(data.any, env.page().data.incoming, 'structured Any property is copied');
    } else assert.ok(Object.is(data.any, input === undefined ? null : input), source + ' Any preserves values except undefined fallback');
  }
});

test('C09 virtualHost public component and selector queries work without a host element', async (t) => {
  const env = await virtualHostProject(t);
  const first = env.page().selectComponent('#card-a');
  assert.equal(first.id, 'card-a');
  assert.equal(env.page().selectAllComponents('#card-a, #card-b').length, 2);
  const selected = await new Promise((resolve) => first.createSelectorQuery().select('#label-a').fields({ id: true, dataset: true }).exec(resolve));
  assert.equal(selected[0].id, 'label-a');
  const missing = await new Promise((resolve) => first.createSelectorQuery().select('#label-b').boundingClientRect().exec(resolve));
  assert.equal(missing[0], null);
  const fromPage = await new Promise((resolve) => env.page().createSelectorQuery().in(first).select('#label-a').fields({ id: true }).exec(resolve));
  assert.equal(fromPage[0].id, 'label-a');
  const outside = await new Promise((resolve) => env.page().createSelectorQuery().in(first).select('#label-b').fields({ id: true }).exec(resolve));
  assert.equal(outside[0], null);
});

test('C09 virtualHost does not create a :host box and forwards class/style only when explicitly declared', async (t) => {
  const env = await componentProject(t, {
    script: 'Component({options:{virtualHost:true},externalClasses:["class"],properties:{style:String}});',
    template: '<view id="inner" class="class" style="{{style}}">content</view>',
    css: ':host{padding:99px;background:rgb(200,0,0)}',
  }, {
    'pages/index.wxss': '.theme{color:rgb(10,20,30)}',
    'pages/index.wxml': '<view id="parent"><subject id="subject" class="theme" style="margin-left:7px"/></view>',
  });
  assert.equal(env.node('#subject'), null);
  assert.equal(env.node('#inner').parentElement, env.node('#parent'));
  const style = env.win.getComputedStyle(env.node('#inner'));
  assert.equal(style.color, 'rgb(10, 20, 30)');
  assert.equal(style.marginLeft, '7px');
  assert.notEqual(style.paddingTop, '99px');
  assert.notEqual(style.backgroundColor, 'rgb(200, 0, 0)');
  assert.ok(env.page().selectComponent('#subject'));
});

test('C04 nested object properties do not leak child mutations into their parent data', async (t) => {
  const env = await componentProject(t, {
    config: { usingComponents: { child: '/components/child' } },
    script: 'Component({data:{item:{count:1,nested:{value:"parent"}}}});',
    template: '<text id="parent-value">{{item.count}}/{{item.nested.value}}</text><child id="child" item="{{item}}"/>',
  }, {
    ...componentFiles('child', {
      script: `Component({properties:{item:Object}, methods:{mutate(){
        this.data.item.count = 9;
        this.data.item.nested.value = 'child';
      }}});`,
      template: '<text>{{item.count}}</text>',
    }),
  });
  const parent = env.page().selectComponent('#subject');
  const child = parent.selectComponent('#child');
  child.mutate();

  assert.deepEqual(plain(child.data.item), { count: 9, nested: { value: 'child' } });
  assert.deepEqual(plain(parent.data.item), { count: 1, nested: { value: 'parent' } });
  assert.equal(env.node('#parent-value').textContent, '1/parent');
  assert.equal(env.status().status, 'rendered');
});

test('C04 property templates wait for initial parent values but still diagnose a genuinely null value', async (t) => {
  const env = await componentProject(t, {
    script: 'Component({properties:{item:Object}});',
    template: '<text id="value">{{item.count}}</text>',
  }, {
    'pages/index.js': 'Page({data:{item:{count:1}}});',
    'pages/index.wxml': '<subject id="subject" item="{{item}}"/>',
  });
  assert.equal(env.node('#value').textContent, '1');
  assert.equal(env.status().status, 'rendered');
  env.page().setData({ item: null });
  await env.flush();
  assert.equal(env.status().status, 'limited');
  assert.ok(env.status().details.some((entry) => entry.message.includes('item.count')));
});

test('C05 Behavior observers and the component observer all execute in declaration order', async (t) => {
  const env = await componentProject(t, {
    script: `const first = Behavior({observers:{count(value){window.audit.push(['first',value]);}}});
      const second = Behavior({observers:{count(value){window.audit.push(['second',value]);}}});
      Component({behaviors:[first,second],data:{count:0},
        observers:{count(value){window.audit.push(['component',value]);}}});`,
    template: '<text id="value">{{count}}</text>',
  });
  env.win.audit.length = 0;
  env.page().selectComponent('#subject').setData({ count: 2 });
  await env.flush();

  assert.equal(env.node('#value').textContent, '2');
  assert.deepEqual(plain(env.win.audit), [['first', 2], ['second', 2], ['component', 2]]);
});

test('C06 a directly and transitively reused Behavior attaches and detaches only once', async (t) => {
  const env = await componentProject(t, {
    script: `const shared = Behavior({lifetimes:{
        attached(){window.audit.push('shared-attached');},
        detached(){window.audit.push('shared-detached');}
      }});
      const nested = Behavior({behaviors:[shared],lifetimes:{
        attached(){window.audit.push('nested-attached');},
        detached(){window.audit.push('nested-detached');}
      }});
      Component({behaviors:[shared,nested],lifetimes:{
        attached(){window.audit.push('component-attached');},
        detached(){window.audit.push('component-detached');}
      }});`,
  }, {
    'pages/index.js': 'Page({data:{shown:true}});',
    'pages/index.wxml': '<subject wx:if="{{shown}}" id="subject"/>',
  });

  assert.deepEqual(plain(env.win.audit), ['shared-attached', 'nested-attached', 'component-attached']);
  env.win.audit.length = 0;
  env.page().setData({ shown: false });
  await env.flush();
  assert.equal(env.page().selectComponent('#subject'), null);
  assert.deepEqual(plain(env.win.audit).sort(), ['component-detached', 'nested-detached', 'shared-detached']);
});

test('C07 Behavior definitionFilter changes the final component definition before instantiation', async (t) => {
  const env = await componentProject(t, {
    script: `const definition = Behavior({definitionFilter(definition){
        definition.data.value = 42;
        definition.methods = {readValue(){return this.data.value;}};
      }});
      Component({behaviors:[definition],data:{value:1}});`,
    template: '<text id="value">{{value}}</text>',
  });

  const subject = env.page().selectComponent('#subject');
  assert.equal(subject.data.value, 42);
  assert.equal(subject.readValue(), 42);
  assert.equal(env.node('#value').textContent, '42');
});

const relationComponents = (parentTemplate = '<slot/>') => ({
  ...componentFiles('relation-parent', {
    config: { usingComponents: { 'relation-child': '/components/relation-child' } },
    script: `Component({relations:{'./relation-child':{
      type:'child',
      linked(child){window.audit.push(['parent-linked',child.data.value]);},
      unlinked(child){window.audit.push(['parent-unlinked',child.data.value]);}
    }}});`,
    template: parentTemplate,
  }),
  ...componentFiles('relation-child', {
    script: `Component({data:{value:'child'},relations:{'./relation-parent':{
      type:'parent',
      linked(){window.audit.push(['child-linked']);},
      unlinked(){window.audit.push(['child-unlinked']);}
    }}});`,
    template: '<text id="child-value">{{value}}</text>',
  }),
});

test('C08 same-owner slotted relations link, expose public callers, and unlink when the child is removed', async (t) => {
  const env = await runtimeProject(t, {
    'app.js': 'App({}); window.audit = [];',
    'pages/index.json': pageComponents(['relation-parent', 'relation-child']),
    'pages/index.js': 'Page({data:{shown:true}});',
    'pages/index.wxml': '<relation-parent id="parent"><relation-child wx:if="{{shown}}" id="child"/></relation-parent>',
    ...relationComponents(),
  });
  await env.flush();
  const parent = env.page().selectComponent('#parent');
  const child = env.page().selectComponent('#child');
  assert.ok(child);
  assert.deepEqual(plain(env.win.audit), [['parent-linked', 'child'], ['child-linked']]);
  assert.equal(parent.getRelationNodes('./relation-child').length, 1);
  assert.equal(parent.getRelationNodes('./relation-child')[0], child);
  assert.equal(child.getRelationNodes('./relation-parent').length, 1);
  assert.equal(child.getRelationNodes('./relation-parent')[0], parent);

  env.win.audit.length = 0;
  env.page().setData({ shown: false });
  await env.flush();
  assert.equal(parent.getRelationNodes('./relation-child').length, 0);
  assert.equal(env.page().selectComponent('#child'), null);
  assert.equal(env.node('#child-value'), null);
  assert.deepEqual(plain(env.win.audit).sort((a, b) => a[0].localeCompare(b[0])), [['child-unlinked'], ['parent-unlinked', 'child']]);
});

test('C08 relations do not cross a component shadow boundary just because DOM nodes are nested', async (t) => {
  const env = await runtimeProject(t, {
    'app.js': 'App({}); window.audit = [];',
    'pages/index.json': pageComponents(['relation-parent']),
    'pages/index.wxml': '<relation-parent id="parent"/>',
    ...relationComponents('<relation-child id="private-child"/>'),
  });
  await env.flush();
  const parent = env.page().selectComponent('#parent');
  const child = parent.selectComponent('#private-child');
  assert.ok(child);
  assert.equal(env.node('#child-value').textContent, 'child');
  assert.equal(parent.getRelationNodes('./relation-child').length, 0);
  assert.equal(child.getRelationNodes('./relation-parent').length, 0);
  assert.deepEqual(plain(env.win.audit), []);
});

async function virtualHostProject(t) {
  return runtimeProject(t, {
    'app.js': 'App({}); window.audit = [];',
    'pages/index.json': pageComponents(['virtual-card']),
    'pages/index.js': `Page({data:{items:[{id:'a'},{id:'b'}]},events:[],
      selected(event){this.events.push(event.detail);}});`,
    'pages/index.wxml': '<view id="layout" style="display:flex"><virtual-card wx:for="{{items}}" wx:key="id" id="card-{{item.id}}" label="{{item.id}}" bindselected="selected"/></view>',
    ...componentFiles('virtual-card', {
      script: `Component({options:{virtualHost:true},properties:{label:String},data:{hits:0},
        methods:{select(){
          this.setData({hits:this.data.hits+1});
          this.triggerEvent('selected',{label:this.data.label,hits:this.data.hits});
        }},lifetimes:{detached(){window.audit.push(['detached',this.data.label]);}}});`,
      template: '<text id="label-{{label}}">{{label}}/{{hits}}</text><button id="button-{{label}}" bindtap="select">select {{label}}</button>',
    }),
  });
}

test('C09 virtualHost renders each root directly into its layout parent with no replacement wrapper', async (t) => {
  const env = await virtualHostProject(t);
  await env.flush();
  const layout = env.node('#layout');

  assert.deepEqual([...layout.children].map((node) => node.id), ['label-a', 'button-a', 'label-b', 'button-b']);
  for (const id of ['#label-a', '#button-a', '#label-b', '#button-b']) assert.equal(env.node(id).parentElement, layout);
  assert.ok(env.page().selectComponent('#card-a'));
  assert.ok(env.page().selectComponent('#card-b'));
});

test('C09 virtualHost keeps public query, events, keyed multi-root moves and disposal working without a host element', async (t) => {
  const env = await virtualHostProject(t);
  await env.flush();
  const first = env.page().selectComponent('#card-a');
  const label = env.node('#label-a');
  const button = env.node('#button-a');
  env.click('#button-a');
  await env.flush();
  assert.equal(first.data.hits, 1);
  assert.equal(label.textContent, 'a/1');
  assert.deepEqual(plain(env.page().events), [{ label: 'a', hits: 1 }]);

  env.page().setData({ items: [{ id: 'b' }, { id: 'a' }] });
  await env.flush();
  assert.equal(env.page().selectComponent('#card-a'), first);
  assert.equal(env.node('#label-a'), label);
  assert.equal(env.node('#button-a'), button);
  assert.deepEqual([...env.node('#layout').children].map((node) => node.id), ['label-b', 'button-b', 'label-a', 'button-a']);

  env.page().setData({ items: [{ id: 'b' }] });
  await env.flush();
  assert.equal(env.page().selectComponent('#card-a'), null);
  assert.equal(env.node('#label-a'), null);
  assert.equal(env.node('#button-a'), null);
  assert.deepEqual(plain(env.win.audit), [['detached', 'a']]);
  assert.deepEqual([...env.node('#layout').children].map((node) => node.id), ['label-b', 'button-b']);
});

test('C10 pureDataPattern fields remain available to business logic but never enter template data', async (t) => {
  const env = await componentProject(t, {
    script: `Component({options:{pureDataPattern:/^_/},data:{_private:1,shown:1},
      observers:{_private(value){window.audit.push(value);}},
      methods:{readPrivate(){return this.data._private;}}});`,
    template: '<text id="private">{{_private}}</text><text id="shown">{{shown}}</text>',
  });
  const subject = env.page().selectComponent('#subject');
  assert.equal(subject.readPrivate(), 1);
  assert.equal(env.node('#private').textContent, '');
  assert.equal(env.node('#shown').textContent, '1');

  env.win.audit.length = 0;
  subject.setData({ _private: 2 });
  await env.flush();
  assert.equal(subject.readPrivate(), 2);
  assert.deepEqual(plain(env.win.audit), [2]);
  assert.equal(env.node('#private').textContent, '');
  assert.equal(env.node('#shown').textContent, '1');

  subject.setData({ shown: 3 });
  await env.flush();
  assert.equal(env.node('#private').textContent, '');
  assert.equal(env.node('#shown').textContent, '3');
});

test('Component-declared pages use component property defaults, observers, Behavior deduplication and pure-data semantics', async (t) => {
  const env = await runtimeProject(t, {
    'app.js': 'App({}); window.audit = [];',
    'pages/index.json': JSON.stringify({ component: true }),
    'pages/index.js': `const shared = Behavior({
        lifetimes:{attached(){window.audit.push(['attached']);}}
      });
      const observer = Behavior({observers:{count(value){window.audit.push(['behavior',value]);}}});
      const nested = Behavior({behaviors:[shared]});
      Component({behaviors:[shared,nested,observer],options:{pureDataPattern:/^_/},data:{_private:'secret'},
        properties:{count:{type:Number,value:1,observer(value,oldValue){window.audit.push(['property',value,oldValue]);}}},
        observers:{count(value){window.audit.push(['page',value]);}},
        methods:{increment(){this.setData({count:this.data.count+1});}}
      });`,
    'pages/index.wxml': '<text id="count">{{count}}</text><text id="private">{{_private}}</text><button id="increment" bindtap="increment">increment</button>',
  });
  await env.flush();
  assert.equal(env.page().data.count, 1);
  assert.equal(env.node('#count').textContent, '1');
  assert.equal(env.node('#private').textContent, '');
  assert.equal(env.win.audit.filter((entry) => entry[0] === 'attached').length, 1);

  env.win.audit.length = 0;
  env.click('#increment');
  await env.flush();
  assert.equal(env.page().data.count, 2);
  assert.equal(env.node('#count').textContent, '2');
  assert.equal(env.page().data._private, 'secret');
  assert.deepEqual(plain(env.win.audit), [['behavior', 2], ['page', 2], ['property', 2, 1]]);
});
