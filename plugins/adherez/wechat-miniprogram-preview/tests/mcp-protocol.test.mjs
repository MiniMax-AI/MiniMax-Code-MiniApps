import test from 'node:test';
import assert from 'node:assert/strict';
import { createMcpHandler, errorPayload, validateArguments } from '../miniapp/node/mcp.mjs';
import { scopeAssetUrl, scopeCssAssets } from '../miniapp/node/preview-assets.mjs';

const schema = { type: 'object', properties: { preview_id: { type: 'string', pattern: '^[\\w-]+$', maxLength: 100 },
  limit: { type: 'integer', minimum: 1, maximum: 200 }, query: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean'] } } }, additionalProperties: false };

function rpc(handler, input) {
  const response = { writeHead(status, headers) { this.status = status; this.headers = headers; return this; }, end(body) { this.body = body ? JSON.parse(body) : null; } };
  return handler({ method: 'POST' }, response, async () => input).then(() => response);
}

test('advertised MCP schema rejects coercion, unknown fields, unsafe keys and malformed args', () => {
  assert.doesNotThrow(() => validateArguments({ preview_id: 'pv_1', limit: 5, query: { a: true } }, schema));
  for (const args of [null, [], { preview_id: '/a' }, { limit: '5' }, { limit: 201 }, { query: { a: {} } }, { userAction: true }, JSON.parse('{"__proto__":{}}')]) {
    assert.throws(() => validateArguments(args, schema), { code: 'INVALID_ARGUMENTS' });
  }
});

test('MCP business failures retain stable structured codes and no raw stack or internal IO path', async () => {
  let calls = 0;
  const handler = createMcpHandler({ name: 'preview', version: 'test', tools: [{ name: 'status', inputSchema: schema,
    async handler() { calls++; throw Object.assign(new Error('请选择预览'), { code: 'AMBIGUOUS_PREVIEW_CONTEXT', details: { currentRevision: 7, token: 'secret' } }); } }] });
  const invalid = await rpc(handler, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'status', arguments: { limit: 0 } } });
  assert.equal(invalid.body.result.structuredContent.code, 'INVALID_ARGUMENTS'); assert.equal(calls, 0);
  const nullArgs = await rpc(handler, { jsonrpc: '2.0', id: 'null', method: 'tools/call', params: { name: 'status', arguments: null } });
  assert.equal(nullArgs.body.result.structuredContent.code, 'INVALID_ARGUMENTS'); assert.equal(calls, 0);
  const failure = await rpc(handler, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'status', arguments: {} } });
  assert.equal(failure.body.result.isError, true);
  assert.deepEqual(failure.body.result.structuredContent, JSON.parse(failure.body.result.content[0].text));
  assert.equal(failure.body.result.structuredContent.code, 'AMBIGUOUS_PREVIEW_CONTEXT');
  assert.deepEqual(failure.body.result.structuredContent.details, { currentRevision: 7 });
  assert.doesNotMatch(JSON.stringify(errorPayload(Object.assign(new Error('/private/user/secret'), { code: 'ENOENT' }))), /private|secret|ENOENT/);
  const kind = errorPayload(Object.assign(new Error('choose a project type'), { code: 'PROJECT_KIND_MISMATCH', choices: ['miniprogram', 'minigame'], requestedKind: 'miniprogram', configuredKind: 'minigame', token: 'never-return' }));
  assert.deepEqual(kind.details, { choices: ['miniprogram', 'minigame'], requestedKind: 'miniprogram', configuredKind: 'minigame' });
});

test('MCP limits batches, skips notification side effects and negotiates a supported protocol', async () => {
  let calls = 0;
  const handler = createMcpHandler({ name: 'preview', version: 'test', tools: [{ name: 'x', inputSchema: schema, async handler() { calls++; return { ok: true }; } }] });
  assert.equal((await rpc(handler, [])).status, 400);
  assert.equal((await rpc(handler, Array.from({ length: 17 }, () => ({})))).status, 400);
  assert.equal((await rpc(handler, { jsonrpc: '2.0', method: 'tools/call', params: { name: 'x' } })).status, 202);
  assert.equal(calls, 0);
  const init = await rpc(handler, { jsonrpc: '2.0', id: 3, method: 'initialize', params: { protocolVersion: 'unknown' } });
  assert.equal(init.body.result.protocolVersion, '2025-06-18');
});

test('build-scoped CSS assets carry preview identity without rewriting strings, comments or remote URLs', () => {
  const css = '.x{background:url("asset/a b.png#t");mask:url(asset/m.svg?x=1)} .y{content:"url(asset/not-a-request)"} /* url(asset/comment) */ .z{background:url(https://example.com/a.png)}';
  const scoped = scopeCssAssets(css, 'pv_123');
  assert.match(scoped, /a b\.png\?previewId=pv_123#t/);
  assert.match(scoped, /m\.svg\?x=1&previewId=pv_123/);
  assert.match(scoped, /content:"url\(asset\/not-a-request\)"/);
  assert.match(scoped, /\/\* url\(asset\/comment\) \*\//);
  assert.match(scoped, /url\(https:\/\/example\.com\/a\.png\)/);
  assert.equal(scopeCssAssets(scoped, 'pv_123'), scoped);
  assert.equal(scopeAssetUrl('asset/a?previewId=old', 'new'), 'asset/a?previewId=new');
  assert.equal(scopeCssAssets(String.raw`.a{background:url("asset/a\20 b.png")}`, 'pv'), '.a{background:url("asset/a b.png?previewId=pv")}');
  assert.equal(scopeCssAssets(String.raw`.a{background:url(asset/a\)b.png)}`, 'pv'), '.a{background:url("asset/a)b.png?previewId=pv")}');
});
