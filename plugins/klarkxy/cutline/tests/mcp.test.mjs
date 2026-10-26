// @ts-check
// The Streamable HTTP MCP endpoint: protocol, identity, tools, sessions.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mcpRaw, mcpSession, mcpTool, startApp } from './helpers.mjs';

const app = await startApp();

const EXPECTED_TOOLS = [
  'fablecut_status',
  'fablecut_docs',
  'fablecut_get_project',
  'fablecut_patch_project',
  'fablecut_set_project',
  'fablecut_frame',
  'fablecut_analyze_reference',
  'fablecut_import_media',
  'fablecut_encode_profiles',
  'fablecut_normalize_audio',
  'fablecut_auto_duck',
  'fablecut_silence',
  'fablecut_denoise',
  'fablecut_projects',
  'fablecut_versions',
  'fablecut_proxy',
  'fablecut_export',
  'fablecut_scopes',
  'fablecut_track',
  'fablecut_import_project',
  'cutline_export',
];

test('initialize answers with the cutline identity and a session id', async () => {
  const reply = await mcpRaw(app.base, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
  });
  assert.equal(reply.status, 200);
  assert.equal(reply.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(reply.json.jsonrpc, '2.0');
  assert.equal(reply.json.id, 1);
  assert.equal(reply.json.result.serverInfo.name, 'cutline');
  assert.equal(reply.json.result.serverInfo.version, '1.16.0');
  assert.equal(reply.json.result.protocolVersion, '2025-06-18');
  assert.ok(reply.json.result.capabilities.tools, 'the server offers tools');
  assert.ok(reply.headers.get('mcp-session-id'), 'a session id is returned');
});

test('browser-origin MCP calls cannot acquire local file capabilities', async () => {
  for (const headers of [
    { origin: app.base },
    { origin: 'https://example.invalid' },
    { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' },
    { 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate' },
  ]) {
    const reply = await mcpRaw(app.base, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18' },
    }, { headers });
    assert.equal(reply.status, 403);
    assert.equal(reply.headers.get('mcp-session-id'), null);
  }
});

test('initialize negotiates a version the client did not ask for', async () => {
  const reply = await mcpRaw(app.base, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '1999-01-01' },
  });
  assert.equal(reply.status, 200);
  assert.equal(reply.json.result.protocolVersion, '2025-11-25');
});

test('tools/list returns the upstream tools and the project import', async () => {
  const { sessionId } = await mcpSession(app.base);
  const reply = await mcpRaw(
    app.base,
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { headers: { 'mcp-session-id': sessionId } },
  );
  assert.equal(reply.status, 200);
  const tools = reply.json.result.tools;
  assert.equal(tools.length, 21);
  assert.deepEqual(
    tools.map((/** @type {any} */ tool) => tool.name),
    EXPECTED_TOOLS,
  );
  for (const tool of tools) {
    assert.ok(tool.description, `${tool.name} has a description`);
    assert.equal(tool.inputSchema?.type, 'object', `${tool.name} has an object schema`);
  }
});

test('tools/call runs a tool against the editor in-process', async () => {
  const { sessionId } = await mcpSession(app.base);
  const { reply, text } = await mcpTool(app.base, sessionId, 'fablecut_status');
  assert.equal(reply.status, 200);
  assert.equal(reply.json.result.isError, undefined);
  assert.match(text, /Editor server: RUNNING/);
  // The tool must not point the user at a loopback URL it cannot open.
  assert.doesNotMatch(text, /http:\/\/(?:localhost|127\.0\.0\.1):\d+/);
});

test('tools/call reports an unknown tool as a tool error', async () => {
  const { sessionId } = await mcpSession(app.base);
  const reply = await mcpRaw(
    app.base,
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fablecut_nope', arguments: {} } },
    { headers: { 'mcp-session-id': sessionId } },
  );
  assert.equal(reply.status, 200);
  assert.equal(reply.json.result.isError, true);
  assert.match(reply.json.result.content[0].text, /Unknown tool/);
});

test('an unknown session id is refused', async () => {
  const reply = await mcpRaw(
    app.base,
    { jsonrpc: '2.0', id: 4, method: 'tools/list' },
    { headers: { 'mcp-session-id': 'fablecut_not_a_session' } },
  );
  assert.equal(reply.status, 404);
  assert.equal(reply.json.error.code, -32001);
});

test('DELETE ends a session', async () => {
  const { sessionId } = await mcpSession(app.base);
  const ended = await mcpRaw(app.base, null, { method: 'DELETE', headers: { 'mcp-session-id': sessionId } });
  assert.equal(ended.status, 204);
  const afterwards = await mcpRaw(
    app.base,
    { jsonrpc: '2.0', id: 5, method: 'tools/list' },
    { headers: { 'mcp-session-id': sessionId } },
  );
  assert.equal(afterwards.status, 404);
});

test('a batch is answered with an array, in order', async () => {
  const { sessionId } = await mcpSession(app.base);
  const reply = await mcpRaw(
    app.base,
    [
      { jsonrpc: '2.0', id: 10, method: 'ping' },
      { jsonrpc: '2.0', id: 11, method: 'tools/list' },
    ],
    { headers: { 'mcp-session-id': sessionId } },
  );
  assert.equal(reply.status, 200);
  assert.ok(Array.isArray(reply.json));
  assert.equal(reply.json.length, 2);
  assert.equal(reply.json[0].id, 10);
  assert.equal(reply.json[1].id, 11);
});

test('null, a scalar and an empty batch are invalid requests, not crashes', async () => {
  for (const body of [null, 42, 'hello', [], [null]]) {
    const reply = await mcpRaw(app.base, body);
    assert.equal(reply.status, 400, `body ${JSON.stringify(body)} is refused`);
    assert.equal(reply.json.error.code, -32600);
    assert.equal(reply.json.id, null);
  }
});

test('a body that is not JSON is refused', async () => {
  const response = await fetch(`${app.base}/mcp/cutline`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not json',
  });
  assert.equal(response.status, 400);
  const json = await response.json();
  assert.equal(json.error.code, -32700);
});

test('GET is not offered: the server sends no notifications', async () => {
  const reply = await mcpRaw(app.base, null, { method: 'GET' });
  assert.equal(reply.status, 405);
  assert.equal(reply.headers.get('allow'), 'POST, DELETE');
});

test('ping answers', async () => {
  const { sessionId } = await mcpSession(app.base);
  const reply = await mcpRaw(
    app.base,
    { jsonrpc: '2.0', id: 6, method: 'ping' },
    { headers: { 'mcp-session-id': sessionId } },
  );
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.json.result, {});
});

test('fablecut_set_project asks for the base revision of the document', async () => {
  const { sessionId } = await mcpSession(app.base);
  const reply = await mcpRaw(
    app.base,
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { headers: { 'mcp-session-id': sessionId } },
  );
  const tool = reply.json.result.tools.find((/** @type {any} */ t) => t.name === 'fablecut_set_project');
  assert.ok(tool, 'the tool is offered');
  assert.deepEqual(tool.inputSchema.required.sort(), ['baseRevision', 'project']);
  assert.equal(tool.inputSchema.properties.baseRevision.type, 'integer');
  assert.match(tool.description, /baseRevision/);
});

test.after(async () => {
  await app.dispose();
});
