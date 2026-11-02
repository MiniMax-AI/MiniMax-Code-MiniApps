import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { ROUTES, buildRequest, testConnection } from '../miniapp/node/openviking.mjs';

const q = (o = {}) => new URLSearchParams(o);
import { start } from '../miniapp/node/server.mjs';

const pluginRoot = join(import.meta.dirname, '..');
const KEY = 'secret-key-123';
let dataDir;
let lifecycle;
let base;
const calls = [];

const fakeFetch = async (url, init) => {
  calls.push({ url: String(url), init });
  const u = new URL(url);
  if (u.pathname === '/health') return new Response('{"status":"ok"}', { headers: { 'content-type': 'application/json', 'set-cookie': 'x=1' } });
  const result = u.pathname === '/api/v1/fs/ls'
    ? [{ name: 'resources', isDir: true, uri: 'viking://resources' }]
    : u.pathname === '/api/v1/search/find'
      ? { memories: [], resources: [{ uri: 'viking://resources/a.md', score: 0.9 }], skills: [] }
      : u.pathname === '/api/v1/content/read' ? 'hello' : { ok: true };
  return new Response(JSON.stringify({ status: 'ok', result }), { headers: { 'content-type': 'application/json' } });
};

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'ov-miniapp-test-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const noop = () => {};
  lifecycle = await start({
    pluginId: 'mini-studio', pluginRoot, dataDir,
    listen: { host: '127.0.0.1', port }, signal: new AbortController().signal,
    logger: { debug: noop, info: noop, warn: noop, error: noop },
  }, { fetch: fakeFetch });
  base = `http://127.0.0.1:${port}`;
});
after(async () => {
  await lifecycle.dispose();
  await rm(dataDir, { recursive: true, force: true });
});

const put = (body) => fetch(`${base}/ov/connection`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('serves the page and only bundled static files', async () => {
  const page = await fetch(`${base}/context`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  const html = await page.text();
  const assets = [...html.matchAll(/(?:src|href)="\.\/(static\/assets\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(assets.some((a) => a.endsWith('.js')) && assets.some((a) => a.endsWith('.css')), 'built assets are referenced');
  for (const a of assets) assert.equal((await fetch(`${base}/${a}`)).status, 200, a);
  assert.doesNotMatch(html, /<script>(?!<\/script>)/, 'no inline scripts (CSP)');
  assert.doesNotMatch(html, /https?:\/\//, 'no CDN references');
  assert.equal((await fetch(`${base}/`)).status, 404);
  assert.equal((await fetch(`${base}/static/../node/server.mjs`)).status, 404);
  assert.equal((await fetch(`${base}/static/%2e%2e/node/server.mjs`)).status, 404);
});

test('reports not_configured before setup', async () => {
  const res = await fetch(`${base}/ov-api/api/v1/fs/ls?uri=viking://`);
  assert.equal(res.status, 409);
});

test('stores the key in dataDir and never returns it', async () => {
  const res = await put({ baseUrl: 'https://ov.example.com/', apiKey: KEY, account: 'acme' });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes(KEY));
  assert.equal(JSON.parse(text).hasApiKey, true);
  assert.ok(!(await (await fetch(`${base}/ov/connection`)).text()).includes(KEY));
  const saved = JSON.parse(await readFile(join(dataDir, 'connection.json'), 'utf8'));
  assert.equal(saved.apiKey, KEY);
  assert.equal(saved.baseUrl, 'https://ov.example.com');
  if (process.platform !== 'win32') assert.equal((await stat(join(dataDir, 'connection.json'))).mode & 0o077, 0);
  // Saving without a key keeps the stored one.
  await put({ baseUrl: 'https://ov.example.com' });
  assert.equal(JSON.parse(await readFile(join(dataDir, 'connection.json'), 'utf8')).apiKey, KEY);
});

test('rejects bad connection input', async () => {
  assert.equal((await put({ baseUrl: 'file:///etc/passwd' })).status, 400);
  assert.equal((await put({ baseUrl: 'https://u:p@ov.example.com' })).status, 400);
  assert.equal((await put({ baseUrl: 'https://ov.example.com', studioUrl: 'javascript:alert(1)' })).status, 400);
});

test('allowlisted routes reach the configured server with the stored key', async () => {
  await put({ baseUrl: 'https://ov.example.com', apiKey: KEY, account: 'acme' });
  calls.length = 0;
  const health = await fetch(`${base}/ov-api/health`);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('set-cookie'), null);
  assert.equal((await fetch(`${base}/ov-api/api/v1/fs/ls?uri=${encodeURIComponent('viking://resources')}&output=agent`)).status, 200);
  const find = await fetch(`${base}/ov-api/api/v1/search/find`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'q', target_uri: 'viking://resources', limit: 5 }) });
  assert.equal(find.status, 200);
  const read = await (await fetch(`${base}/ov-api/api/v1/content/read?uri=${encodeURIComponent('viking://resources/a.md')}`)).json();
  assert.equal(read.result, 'hello');
  assert.equal(calls.length, 4);
  for (const c of calls) {
    const u = new URL(c.url);
    assert.equal(u.origin, 'https://ov.example.com');
    assert.ok(ROUTES.has(`${c.init.method} ${u.pathname}`), u.pathname);
    assert.equal(c.init.headers.authorization, `Bearer ${KEY}`);
    assert.equal(c.init.headers['x-openviking-account'], 'acme');
    assert.equal(c.init.redirect, 'error');
  }
});

test('everything else is refused before any upstream call', async () => {
  calls.length = 0;
  const refused = [
    ['POST', '/ov-api/api/v1/sessions'],
    ['POST', '/ov-api/api/v1/resources'],
    ['DELETE', '/ov-api/api/v1/fs/ls'],
    ['POST', '/ov-api/api/v1/fs/ls'],
    ['GET', '/ov-api/api/v1/admin/accounts'],
    ['GET', '/ov-api/mcp'],
    ['GET', '/ov-api/api/v1/fs/ls/../../admin/accounts'],
    ['GET', '/ov-api/api/v1/content/write'],
  ];
  for (const [method, path] of refused) {
    assert.equal((await fetch(`${base}${path}`, { method })).status, 404, `${method} ${path}`);
  }
  assert.equal((await fetch(`${base}/ov-api/api/v1/fs/ls?uri=${encodeURIComponent('http://evil')}`)).status, 400);
  assert.equal((await fetch(`${base}/ov-api/api/v1/fs/ls?uri=viking://&callback=x`)).status, 400);
  const badBody = await fetch(`${base}/ov-api/api/v1/search/grep`, { method: 'POST', body: JSON.stringify({ uri: 'file:///etc', pattern: 'x' }) });
  assert.equal(badBody.status, 400);
  assert.equal(calls.length, 0);
  assert.throws(() => buildRequest({ baseUrl: 'https://x' }, 'POST', '/api/v1/sessions', q()), /route_not_allowed/);
});

const postTest = (body) => fetch(`${base}/ov/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('test connection checks /health then the root listing, with the stored key, without saving', async () => {
  await put({ baseUrl: 'https://ov.example.com', apiKey: KEY });
  calls.length = 0;
  const res = await postTest({ baseUrl: 'https://other.example.com' });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.deepEqual(JSON.parse(text), { ok: true });
  assert.ok(!text.includes(KEY));
  assert.deepEqual(calls.map((c) => new URL(c.url).pathname), ['/health', '/api/v1/fs/ls']);
  assert.equal(new URL(calls[0].url).origin, 'https://other.example.com');
  assert.equal(calls[0].init.headers.authorization, `Bearer ${KEY}`);
  // Not saved.
  assert.equal(JSON.parse(await readFile(join(dataDir, 'connection.json'), 'utf8')).baseUrl, 'https://ov.example.com');
  assert.equal((await postTest({ baseUrl: 'file:///etc/passwd' })).status, 400);
});

test('test connection reports clear errors', async () => {
  const stored = { baseUrl: 'https://ov.example.com', apiKey: KEY, account: '', user: '', studioUrl: '' };
  const status = (code) => async () => new Response('{}', { status: code });
  assert.match((await testConnection(stored, {}, status(401))).error, /API key was rejected \(HTTP 401\)/);
  assert.match((await testConnection(stored, {}, status(500))).error, /Health check failed: HTTP 500/);
  let n = 0;
  const lsFails = async () => (n++ === 0 ? new Response('{}') : new Response('{}', { status: 403 }));
  assert.match((await testConnection(stored, {}, lsFails)).error, /rejected \(HTTP 403\)/);
  const down = async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }); };
  const r = await testConnection(stored, {}, down);
  assert.equal(r.ok, false);
  assert.match(r.error, /Cannot reach https:\/\/ov\.example\.com: ECONNREFUSED/);
  assert.ok(!r.error.includes(KEY));
  assert.match((await testConnection({ ...stored, baseUrl: '' }, {}, down)).error, /server URL/);
});
