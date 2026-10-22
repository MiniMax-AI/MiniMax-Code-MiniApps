// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import { createHandler, start } from '../miniapp/node/server.mjs';

function startServer(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function postJson(server, path, body) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

test('POST /api/match returns matches with named and numbered groups', async () => {
  const server = await startServer(createHandler({ html: '<html></html>' }));
  const { status, data } = await postJson(server, '/api/match', {
    pattern: '(?<year>\\d{4})-(\\d{2})',
    flags: 'g',
    text: '2024-01 and 2025-12',
  });
  assert.equal(status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.count, 2);
  assert.equal(data.matches[0].namedGroups.year, '2024');
  assert.equal(data.matches[0].groups[1].value, '01');
  server.close();
});

test('POST /api/match reports an invalid regex', async () => {
  const server = await startServer(createHandler({ html: '' }));
  const { status, data } = await postJson(server, '/api/match', { pattern: '(', flags: '', text: 'x' });
  assert.equal(status, 200);
  assert.equal(data.ok, false);
  assert.ok(typeof data.error === 'string' && data.error.length > 0);
  server.close();
});

test('POST /api/replace applies a named-group replacement', async () => {
  const server = await startServer(createHandler({ html: '' }));
  const { status, data } = await postJson(server, '/api/replace', {
    pattern: '(?<y>\\d{4})',
    flags: 'g',
    text: 'y2024 y2025',
    replacement: '[$<y>]',
  });
  assert.equal(status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.result, 'y[2024] y[2025]');
  server.close();
});

test('GET /dashboard serves the html body', async () => {
  const server = await startServer(createHandler({ html: '<html>hi</html>' }));
  const res = await fetch(`http://127.0.0.1:${server.address().port}/dashboard`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '<html>hi</html>');
  server.close();
});

test('unknown route returns 404 json', async () => {
  const server = await startServer(createHandler({ html: '' }));
  const res = await fetch(`http://127.0.0.1:${server.address().port}/nope`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'not_found');
  server.close();
});

test('start() reads the page, logs readiness, and disposes without error', async () => {
  const pluginRoot = fileURLToPath(new URL('..', import.meta.url));
  let logged = '';
  const controller = new AbortController();
  const lifecycle = await start({
    pluginRoot,
    listen: { host: '127.0.0.1', port: 0 },
    logger: { info: (message) => { logged = message; } },
    signal: controller.signal,
  });
  assert.ok(typeof lifecycle.dispose === 'function');
  assert.equal(logged, 'miniapp.runtime.listening');
  await assert.doesNotReject(lifecycle.dispose());
});
