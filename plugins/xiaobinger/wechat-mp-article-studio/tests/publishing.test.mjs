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
