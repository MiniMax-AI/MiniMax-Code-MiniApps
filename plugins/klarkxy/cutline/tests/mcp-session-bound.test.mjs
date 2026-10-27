import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createMcpHttpHandler } from '../miniapp/node/adapters/mcp-http.mjs';

test('session cap preserves established clients and DELETE frees capacity', async () => {
  const handle = createMcpHttpHandler({ handleMessage: async (msg) => ({ jsonrpc: '2.0', id: msg.id, result: {} }) });
  const server = createServer((req, res) => void handle(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  const send = (method, session) => fetch(url, { method: 'POST', headers: {
    'content-type': 'application/json', ...(session ? { 'mcp-session-id': session } : {}),
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method }) });
  try {
    let first;
    for (let i = 0; i < 256; i++) {
      const res = await send('initialize');
      assert.equal(res.status, 200);
      first ||= res.headers.get('mcp-session-id');
      await res.text();
    }
    const rejected = await send('initialize');
    assert.equal(rejected.status, 503); await rejected.text();
    const existing = await send('ping', first);
    assert.equal(existing.status, 200); await existing.text();
    const removed = await fetch(url, { method: 'DELETE', headers: { 'mcp-session-id': first } });
    assert.equal(removed.status, 204);
    const replacement = await send('initialize');
    assert.equal(replacement.status, 200); await replacement.text();
  } finally {
    await new Promise((r) => { server.close(r); server.closeAllConnections(); });
  }
});
