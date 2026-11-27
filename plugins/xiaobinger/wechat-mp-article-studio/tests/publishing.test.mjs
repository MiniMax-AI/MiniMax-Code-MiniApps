// @ts-check
//
// Regression tests for the publish gate.
//
// The gate must classify a tool by its *identity* only, and it must judge a
// publish call by what the interface actually answered.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPublishArguments,
  classify,
  interpretPublishResult,
  publishViaInterface,
  tokenize,
} from '../miniapp/node/publishing.mjs';
/**
 * @param {string} name
 * @param {string} tool
 * @param {string} [server]
 * @param {string} [description]
 * @returns {any}
 */
function mcpTool(name, tool, server = 'notes', description = '') {
  return { name, kind: 'mcp', server, tool, description, inputSchema: { type: 'object', properties: {} } };
}

test('tokenize splits camel case and keeps Chinese together', () => {
  assert.deepEqual(tokenize('freePublish'), ['free', 'publish']);
  assert.deepEqual(tokenize('wechat_mp'), ['wechat', 'mp']);
  assert.deepEqual(tokenize('公众号发布'), ['公众号发布']);
});

test('a description that mentions WeChat and a draft is not a publish interface', () => {
  const inventory = [
    mcpTool('mcp__notes__search', 'search', 'notes', 'Search the WeChat official account draft notes.'),
  ];
  const found = classify(inventory);
  assert.deepEqual(found.interface, []);
  assert.deepEqual(found.wechatTools, []);
});

test('a tool whose description names WeChat and publishing is not a publish interface', () => {
  const inventory = [
    mcpTool('mcp__notes__search', 'search', 'notes', 'Search notes. WeChat Publish is not supported here.'),
  ];
  const found = classify(inventory);
  assert.deepEqual(found.interface, []);
});

test('the word immediate is not the word media', () => {
  const inventory = [
    { name: 'connector__matrix__generate_image', kind: 'connector', provider: 'matrix', tool: 'immediate' },
  ];
  const found = classify(inventory);
  assert.deepEqual(found.material, []);
});

test('a real 公众号 interface is classified by its identity', () => {
  const inventory = [
    mcpTool('mcp__wechat__publish_article', 'publish_article', 'wechat'),
    mcpTool('mcp__wechat__add_material', 'add_material', 'wechat'),
    mcpTool('mcp__wechat__get_account_info', 'get_account_info', 'wechat'),
  ];
  const found = classify(inventory);
  assert.deepEqual(
    found.interface.map((item) => item.name),
    ['mcp__wechat__publish_article'],
  );
  assert.deepEqual(
    found.material.map((item) => item.name),
    ['mcp__wechat__add_material'],
  );
  assert.deepEqual(
    found.account.map((item) => item.name),
    ['mcp__wechat__get_account_info'],
  );
});

test('a draft interface is not a publish interface', () => {
  const inventory = [mcpTool('mcp__wechat__draft_add', 'draft_add', 'wechat')];
  const found = classify(inventory);
  assert.deepEqual(found.interface, []);
});

test('an operation that names WeChat itself is still recognised', () => {
  const inventory = [mcpTool('mcp__notes__wechat_publish', 'wechat_publish', 'notes')];
  const found = classify(inventory);
  assert.deepEqual(
    found.interface.map((item) => item.name),
    ['mcp__notes__wechat_publish'],
  );
});

test('an interface payload with a non-zero errcode is a failure', () => {
  const verdict = interpretPublishResult({
    invocationId: 'x',
    kind: 'connector',
    value: { errcode: 40001, errmsg: 'invalid credential' },
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /40001/);
});

test('a successful connector payload is accepted', () => {
  const verdict = interpretPublishResult({
    invocationId: 'x',
    kind: 'connector',
    value: { code: 0, message: 'ok', success_items: [{ node_id: '1' }], failed_items: [] },
  });
  assert.equal(verdict.ok, true);
});

test('an MCP tool that reports its own failure is a failure', () => {
  const verdict = interpretPublishResult({
    invocationId: 'x',
    kind: 'mcp',
    isError: true,
    content: [{ type: 'text', text: 'publish rejected' }],
  });
  assert.equal(verdict.ok, false);
});

test('an MCP tool that answers with an error code inside structuredContent is a failure', () => {
  const verdict = interpretPublishResult({
    invocationId: 'x',
    kind: 'mcp',
    isError: false,
    content: [],
    structuredContent: { errcode: 40001 },
  });
  assert.equal(verdict.ok, false);
});

test('an MCP tool that answers with an error code inside a text block is a failure', () => {
  const verdict = interpretPublishResult({
    invocationId: 'x',
    kind: 'mcp',
    isError: false,
    content: [{ type: 'text', text: '{"errcode":40001}' }],
  });
  assert.equal(verdict.ok, false);
});

test('a tool that cannot carry the article body is never given the article', () => {
  const searchTool = {
    name: 'mcp__notes__search',
    kind: 'mcp',
    server: 'notes',
    tool: 'search',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  };
  const args = buildPublishArguments(searchTool, { title: 't', exportHtml: '<p>x</p>' });
  assert.equal(args, null);
});

test('only the fields a publish interface declares are sent', () => {
  const publishTool = {
    name: 'mcp__wechat__publish_article',
    kind: 'mcp',
    server: 'wechat',
    tool: 'publish_article',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
        thumb_media_id: { type: 'string' },
        query: { type: 'string' },
      },
    },
  };
  const args = buildPublishArguments(publishTool, {
    title: '标题',
    exportHtml: '<p>正文</p>',
    assets: { cover: { mediaId: 'm-1' } },
  });
  assert.ok(args);
  assert.deepEqual(Object.keys(args).sort(), ['content', 'thumb_media_id', 'title']);
  assert.equal(args.content, '<p>正文</p>');
  assert.equal(args.thumb_media_id, 'm-1');
});

test('publishing never calls a tool that is not a publish interface', async () => {
  /** @type {any[]} */
  const calls = [];
  const inventory = [
    {
      name: 'mcp__notes__search',
      kind: 'mcp',
      server: 'notes',
      tool: 'search',
      description: 'WeChat official account draft search',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    },
  ];
  const context = {
    tool: {
      list: async () => ({ tools: inventory, partial: false }),
      call: async (/** @type {string} */ name, /** @type {any} */ args) => {
        calls.push({ name, args });
        return { invocationId: 'x', kind: 'mcp', isError: false, content: [] };
      },
    },
  };
  const checks = {
    account: { key: 'account', label: '公众号账号授权', status: 'confirmed', detected: ['a'], note: '', confirmedBy: 'interface', confirmedAt: '' },
    material: { key: 'material', label: '素材访问范围', status: 'confirmed', detected: ['m'], note: '', confirmedBy: 'interface', confirmedAt: '' },
    interface: { key: 'interface', label: '可用发布接口', status: 'confirmed', detected: ['p'], note: '', confirmedBy: 'interface', confirmedAt: '' },
  };

  const outcome = await publishViaInterface(context, checks, { title: 't', exportHtml: '<p>x</p>' });
  assert.equal(outcome.ok, false);
  assert.deepEqual(calls, [], 'no tool may be called when none is a publish interface');
});

test('a failing publish answer leaves the draft unchanged', async () => {
  const inventory = [
    {
      name: 'mcp__wechat__publish_article',
      kind: 'mcp',
      server: 'wechat',
      tool: 'publish_article',
      inputSchema: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' } } },
    },
  ];
  const context = {
    tool: {
      list: async () => ({ tools: inventory, partial: false }),
      call: async () => ({
        invocationId: 'x',
        kind: 'mcp',
        isError: false,
        content: [{ type: 'text', text: '{"errcode":40001,"errmsg":"invalid"}' }],
      }),
    },
  };
  const checks = {
    account: { key: 'account', label: '公众号账号授权', status: 'confirmed', detected: ['a'], note: '', confirmedBy: 'interface', confirmedAt: '' },
    material: { key: 'material', label: '素材访问范围', status: 'confirmed', detected: ['m'], note: '', confirmedBy: 'interface', confirmedAt: '' },
    interface: { key: 'interface', label: '可用发布接口', status: 'confirmed', detected: ['p'], note: '', confirmedBy: 'interface', confirmedAt: '' },
  };

  const outcome = await publishViaInterface(context, checks, { title: 't', exportHtml: '<p>x</p>' });
  assert.equal(outcome.ok, false);
  assert.match(outcome.message, /40001/);
});

test('a publish interface is called with the article and only its own fields', async () => {
  /** @type {any[]} */
  const calls = [];
  const inventory = [
    {
      name: 'mcp__wechat__publish_article',
      kind: 'mcp',
      server: 'wechat',
      tool: 'publish_article',
      inputSchema: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' } } },
    },
  ];
  const context = {
    tool: {
      list: async () => ({ tools: inventory, partial: false }),
      call: async (/** @type {string} */ name, /** @type {any} */ args) => {
        calls.push({ name, args });
        return { invocationId: 'x', kind: 'mcp', isError: false, content: [{ type: 'text', text: '{"errcode":0}' }] };
      },
    },
  };
  const checks = {
    account: { key: 'account', label: '公众号账号授权', status: 'confirmed', detected: ['a'], note: '', confirmedBy: 'interface', confirmedAt: '' },
    material: { key: 'material', label: '素材访问范围', status: 'confirmed', detected: ['m'], note: '', confirmedBy: 'interface', confirmedAt: '' },
    interface: { key: 'interface', label: '可用发布接口', status: 'confirmed', detected: ['p'], note: '', confirmedBy: 'interface', confirmedAt: '' },
  };

  const outcome = await publishViaInterface(context, checks, { title: '标题', exportHtml: '<p>正文</p>' });
  assert.equal(outcome.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'mcp__wechat__publish_article');
  assert.deepEqual(calls[0].args, { title: '标题', content: '<p>正文</p>' });
});

/* ------------------------------------------------------------------ *
 * The result code decides, not the status string next to it.
 * ------------------------------------------------------------------ */

test('a success errcode wins over a non-empty errmsg', () => {
  // 公众号 answers a successful publish with exactly this shape.
  const verdict = interpretPublishResult({
    invocationId: 'x',
    kind: 'connector',
    value: { errcode: 0, errmsg: 'ok' },
  });
  assert.equal(verdict.ok, true);
});

test('a success code wins over a non-empty errmsg in a nested payload', () => {
  const verdict = interpretPublishResult({
    invocationId: 'x',
    kind: 'connector',
    value: { data: { errcode: 0, errmsg: 'ok' }, msg_id: '2247483647' },
  });
  assert.equal(verdict.ok, true);
});

test('a success code wins over a non-empty errmsg in an MCP text block', () => {
  const verdict = interpretPublishResult({
    invocationId: 'x',
    kind: 'mcp',
    isError: false,
    content: [{ type: 'text', text: '{"errcode":0,"errmsg":"ok"}' }],
  });
  assert.equal(verdict.ok, true);
});

test('a success code still fails when the payload reports failed items', () => {
  const verdict = interpretPublishResult({
    invocationId: 'x',
    kind: 'connector',
    value: { errcode: 0, errmsg: 'ok', failed_items: [{ reason: '内容审核未通过' }] },
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /失败项/);
});

test('a payload that reports success=false fails even with a zero code', () => {
  const verdict = interpretPublishResult({
    invocationId: 'x',
    kind: 'connector',
    value: { errcode: 0, errmsg: 'ok', success: false },
  });
  assert.equal(verdict.ok, false);
});

test('a non-zero errcode is a failure whatever the errmsg says', () => {
  const verdict = interpretPublishResult({
    invocationId: 'x',
    kind: 'connector',
    value: { errcode: 40001, errmsg: 'invalid credential' },
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /40001/);
});

test('an errmsg without any result code is still an error', () => {
  const verdict = interpretPublishResult({
    invocationId: 'x',
    kind: 'connector',
    value: { errmsg: 'invalid credential' },
  });
  assert.equal(verdict.ok, false);
});

test('an explicit error field is a failure even beside a zero code', () => {
  const verdict = interpretPublishResult({
    invocationId: 'x',
    kind: 'connector',
    value: { code: 0, error: 'quota exceeded' },
  });
  assert.equal(verdict.ok, false);
});

/* ------------------------------------------------------------------ *
 * The publish role is read from the operation name only.
 * ------------------------------------------------------------------ */

test('submit is not a publish interface', () => {
  const inventory = [mcpTool('mcp__wechat__submit', 'submit', 'wechat')];
  const found = classify(inventory);
  assert.deepEqual(found.interface, []);
});

test('a submit operation with a payload word is not a publish interface either', () => {
  const inventory = [mcpTool('mcp__wechat__submit_article', 'submit_article', 'wechat')];
  const found = classify(inventory);
  assert.deepEqual(found.interface, []);
});

test('freepublish is a publish interface', () => {
  const inventory = [mcpTool('mcp__wechat__freepublish', 'freepublish', 'wechat')];
  const found = classify(inventory);
  assert.deepEqual(
    found.interface.map((item) => item.name),
    ['mcp__wechat__freepublish'],
  );
});

/* ------------------------------------------------------------------ *
 * Several publish interfaces: the user picks one, the app never does.
 * ------------------------------------------------------------------ */

/**
 * @param {any[]} extraTools
 * @returns {any[]}
 */
function twoPublishTools(extraTools = []) {
  return [
    {
      name: 'mcp__wechat__publish_article',
      kind: 'mcp',
      server: 'wechat',
      tool: 'publish_article',
      inputSchema: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' } } },
    },
    {
      name: 'mcp__wechat__freepublish',
      kind: 'mcp',
      server: 'wechat',
      tool: 'freepublish',
      inputSchema: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' } } },
    },
    ...extraTools,
  ];
}

/**
 * @param {string} [chosen]
 * @returns {any}
 */
function gates(chosen = '') {
  return {
    account: {
      key: 'account',
      label: '公众号账号授权',
      status: 'confirmed',
      detected: ['a'],
      detectedNames: ['a'],
      note: '',
      confirmedBy: 'interface',
      confirmedAt: '',
    },
    material: {
      key: 'material',
      label: '素材访问范围',
      status: 'confirmed',
      detected: ['m'],
      detectedNames: ['m'],
      note: '',
      confirmedBy: 'interface',
      confirmedAt: '',
    },
    interface: {
      key: 'interface',
      label: '可用发布接口',
      status: 'confirmed',
      detected: ['wechat / publish_article', 'wechat / freepublish'],
      detectedNames: ['mcp__wechat__publish_article', 'mcp__wechat__freepublish'],
      chosen,
      note: '',
      confirmedBy: 'interface',
      confirmedAt: '',
    },
  };
}

test('two publish interfaces and no choice publish nothing', async () => {
  /** @type {any[]} */
  const calls = [];
  const context = {
    tool: {
      list: async () => ({ tools: twoPublishTools(), partial: false }),
      call: async (/** @type {string} */ name, /** @type {any} */ args) => {
        calls.push({ name, args });
        return { invocationId: 'x', kind: 'mcp', isError: false, content: [] };
      },
    },
  };

  const outcome = await publishViaInterface(context, gates(), { title: '标题', exportHtml: '<p>正文</p>' });
  assert.equal(outcome.ok, false);
  assert.deepEqual(calls, [], 'no interface may be called before one is chosen');
  assert.match(outcome.message, /请先在页面上选择一个/);
});

test('the chosen interface is the one that is called', async () => {
  /** @type {any[]} */
  const calls = [];
  const context = {
    tool: {
      list: async () => ({ tools: twoPublishTools(), partial: false }),
      call: async (/** @type {string} */ name, /** @type {any} */ args) => {
        calls.push({ name, args });
        return { invocationId: 'x', kind: 'mcp', isError: false, content: [] };
      },
    },
  };

  const outcome = await publishViaInterface(
    context,
    gates('mcp__wechat__freepublish'),
    { title: '标题', exportHtml: '<p>正文</p>' },
  );
  assert.equal(outcome.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'mcp__wechat__freepublish');
  assert.match(outcome.interfaceName, /freepublish/);
});

test('a chosen interface that cannot carry the body is not swapped for another one', async () => {
  /** @type {any[]} */
  const calls = [];
  const tools = twoPublishTools([
    {
      name: 'mcp__wechat__publish_meta',
      kind: 'mcp',
      server: 'wechat',
      tool: 'publish_meta',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    },
  ]);
  const context = {
    tool: {
      list: async () => ({ tools, partial: false }),
      call: async (/** @type {string} */ name, /** @type {any} */ args) => {
        calls.push({ name, args });
        return { invocationId: 'x', kind: 'mcp', isError: false, content: [] };
      },
    },
  };

  const checks = gates('mcp__wechat__publish_meta');
  const outcome = await publishViaInterface(context, checks, { title: '标题', exportHtml: '<p>正文</p>' });
  assert.equal(outcome.ok, false);
  assert.deepEqual(calls, [], 'the article must not go to a different tool');
  assert.match(outcome.message, /没有声明可承载正文的参数/);
});

test('a chosen interface that vanished from the inventory publishes nothing', async () => {
  /** @type {any[]} */
  const calls = [];
  const context = {
    tool: {
      list: async () => ({ tools: twoPublishTools(), partial: false }),
      call: async (/** @type {string} */ name, /** @type {any} */ args) => {
        calls.push({ name, args });
        return { invocationId: 'x', kind: 'mcp', isError: false, content: [] };
      },
    },
  };

  const outcome = await publishViaInterface(
    context,
    gates('mcp__wechat__gone'),
    { title: '标题', exportHtml: '<p>正文</p>' },
  );
  assert.equal(outcome.ok, false);
  assert.deepEqual(calls, []);
  assert.match(outcome.message, /不可用/);
});

/* ------------------------------------------------------------------ *
 * The arguments follow the interface that was detected, not one
 * particular interface.
 * ------------------------------------------------------------------ */

/**
 * An interface that builds the article itself: a title, a cover file and a
 * body, and it may publish what it built.
 *
 * @param {Record<string, any>} [properties]
 * @returns {any}
 */
function buildingInterface(properties = {}) {
  return {
    name: 'mcp__wechat__publish_material',
    kind: 'mcp',
    server: 'wechat',
    tool: 'publish_material',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['tietu', 'article'] },
        title: { type: 'string', minLength: 1, maxLength: 64 },
        content: { type: 'string', maxLength: 20000, default: '' },
        cover: { type: 'string', default: '' },
        images: { type: 'array', maxItems: 20, default: [] },
        digest: { type: 'string', maxLength: 500, default: '' },
        action: { type: 'string', enum: ['draft', 'publish'], default: 'draft' },
        confirm: { type: 'boolean', default: false },
        wait_publish_s: { type: 'integer', minimum: 0, maximum: 900, default: 180 },
        ...properties,
      },
      required: ['kind', 'title'],
    },
  };
}

/**
 * @returns {any}
 */
function buildingDraft() {
  return {
    title: '标题',
    exportHtml: `<section style="font-size:15px;"><p>正文</p></section>${'x'.repeat(40000)}`,
    plainBody: '正文\n\n![](C:\\assets\\one.jpg)',
    derived: { digest: '摘要' },
    assets: { cover: { assetId: 'c-1' } },
    assetPaths: {
      cover: 'C:\\assets\\cover.jpg',
      illustrations: { 'illustration-1': 'C:\\assets\\one.jpg' },
    },
  };
}

test('an interface that builds the article itself gets the plain body and the local files', () => {
  const args = buildPublishArguments(buildingInterface(), buildingDraft());
  assert.ok(args);
  assert.equal(args.title, '标题');
  assert.equal(args.digest, '摘要');
  assert.equal(args.cover, 'C:\\assets\\cover.jpg');
  assert.equal(args.kind, 'article');
  assert.equal(args.action, 'publish');
  assert.equal(args.confirm, true);
  assert.equal(args.wait_publish_s, 180);
  // The images are named inside the body, so they are not sent a second time.
  assert.equal(args.images, undefined);
});

test('the body an interface receives never exceeds the limit the interface declares', () => {
  const args = buildPublishArguments(buildingInterface(), buildingDraft());
  assert.ok(args);
  assert.equal(typeof args.content, 'string');
  assert.ok(args.content.length <= 20000, `body was ${args.content.length} characters`);
  // The styled HTML does not fit, so the plain body is used instead.
  assert.equal(args.content, buildingDraft().plainBody);
});

test('another interface vocabulary is filled with its own argument names', () => {
  const tool = {
    name: 'mcp__other__post',
    kind: 'mcp',
    server: 'other',
    tool: 'post',
    inputSchema: {
      type: 'object',
      properties: {
        art_title: { type: 'string' },
        article_content: { type: 'string' },
        desc: { type: 'string' },
        cover_image: { type: 'string' },
        image_list: { type: 'array' },
        message_type: { type: 'string', enum: ['article', 'note'] },
        mode: { type: 'string', enum: ['publish', 'preview'] },
        confirmed: { type: 'boolean' },
        wait_seconds: { type: 'integer' },
      },
      required: ['art_title', 'article_content'],
    },
  };
  const args = buildPublishArguments(tool, buildingDraft());
  assert.ok(args);
  assert.deepEqual(Object.keys(args).sort(), [
    'art_title',
    'article_content',
    'confirmed',
    'cover_image',
    'desc',
    'message_type',
    'mode',
    'wait_seconds',
  ]);
  assert.equal(args.art_title, '标题');
  assert.equal(args.desc, '摘要');
  assert.equal(args.cover_image, 'C:\\assets\\cover.jpg');
  assert.equal(args.message_type, 'article');
  assert.equal(args.mode, 'publish');
  assert.equal(args.confirmed, true);
  assert.equal(args.wait_seconds, 180);
});

test('an interface that only takes a body still gets the styled HTML', () => {
  const tool = {
    name: 'mcp__wechat__publish_article',
    kind: 'mcp',
    server: 'wechat',
    tool: 'publish_article',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string' }, content: { type: 'string' } },
      required: ['title'],
    },
  };
  const args = buildPublishArguments(tool, buildingDraft());
  assert.ok(args);
  assert.equal(args.content, buildingDraft().exportHtml);
});

test('an interface that asks for something this draft cannot provide is not called', async () => {
  /** @type {any[]} */
  const calls = [];
  // The interface can take a body, but it can only publish a draft that
  // already exists in the console — this app has no such id.
  const tool = {
    name: 'mcp__wechat__publish_draft',
    kind: 'mcp',
    server: 'wechat',
    tool: 'publish_draft',
    inputSchema: {
      type: 'object',
      properties: { content: { type: 'string' }, appmsgid: { type: 'integer' }, confirm: { type: 'boolean' } },
      required: ['content', 'appmsgid'],
    },
  };
  const context = {
    tool: {
      list: async () => ({ tools: [tool], partial: false }),
      call: async (/** @type {string} */ name, /** @type {any} */ args) => {
        calls.push({ name, args });
        return { invocationId: 'x', kind: 'mcp', isError: false, content: [] };
      },
    },
  };

  const checks = singleInterfaceGates();
  checks.interface.detected = ['wechat / publish_draft'];
  checks.interface.detectedNames = ['mcp__wechat__publish_draft'];
  checks.interface.chosen = 'mcp__wechat__publish_draft';

  const outcome = await publishViaInterface(context, checks, buildingDraft());
  assert.equal(outcome.ok, false);
  assert.deepEqual(calls, [], 'an interface that needs a draft id must not be called');
  assert.match(outcome.message, /appmsgid/);
});

/**
 * @returns {any}
 */
function singleInterfaceGates() {
  const checks = gates('mcp__wechat__publish_material');
  checks.interface.detected = ['wechat / publish_material'];
  checks.interface.detectedNames = ['mcp__wechat__publish_material'];
  return checks;
}
