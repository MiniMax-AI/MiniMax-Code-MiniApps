import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { start } from '../miniapp/node/server.mjs';
import { disposeTemp, fakeContext, freePort, tempDir } from './helpers.mjs';

function nodeRequest(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function boot(root) {
  const controller = new AbortController();
  const port = await freePort();
  const context = fakeContext(root, { port, signal: controller.signal });
  await mkdir(context.dataDir, { recursive: true });
  process.env.MMX_CONFIG_DIR = join(root, 'mmx');
  process.env.MINIMAX_BASE_URL = '';
  delete process.env.MINIMAX_REGION;
  // A test must not borrow the developer's real desktop session: point the
  // lease at a capability file that cannot exist, so the manual path is what
  // this server is actually exercising.
  process.env.MCODE_AUTH_BROKER_ENDPOINT = join(root, 'no-broker.sock');
  process.env.MCODE_AUTH_BROKER_CAPABILITY_FILE = join(root, 'no-broker.cap');
  const lifecycle = await start(context);
  return { context, controller, port, lifecycle };
}

test('serves the page, rejects foreign Host/Origin, and reads a saved manual total', async () => {
  const dir = await tempDir('quota-server-');
  const { context, controller, port, lifecycle } = await boot(dir);
  const base = `http://127.0.0.1:${port}`;
  try {
    const page = await fetch(`${base}/bottle`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Quota Bottle/);
    assert.equal(page.headers.get('content-security-policy')?.includes("default-src 'none'"), true);

    const hostileHost = await nodeRequest(port, '/api/state', { host: 'attacker.example' });
    assert.equal(hostileHost.status, 403);
    const hostileOrigin = await fetch(`${base}/api/state`, { headers: { origin: 'http://attacker.example' } });
    assert.equal(hostileOrigin.status, 403);

    const saved = await fetch(`${base}/api/quota`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ total: 1000 }),
    });
    assert.equal(saved.status, 200);
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.total, 1000);
    assert.ok(state.mode === 'manual' || state.mode === 'unset');
  } finally {
    await lifecycle.dispose();
    controller.abort();
    await disposeTemp(dir);
  }
});

test('JSON writes require the right content type and a bounded body', async () => {
  const dir = await tempDir('quota-server-body-');
  const { context, controller, port, lifecycle } = await boot(dir);
  const base = `http://127.0.0.1:${port}`;
  try {
    const wrongType = await fetch(`${base}/api/quota`, { method: 'POST', body: '{}' });
    assert.equal(wrongType.status, 415);
    const tooLarge = await fetch(`${base}/api/quota`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ total: 1, pad: 'x'.repeat(5000) }),
    });
    assert.equal(tooLarge.status, 413);
  } finally {
    await lifecycle.dispose();
    controller.abort();
    await disposeTemp(dir);
  }
});

test('dispose frees the listener and closes the server', async () => {
  const dir = await tempDir('quota-server-dispose-');
  const { context, controller, port, lifecycle } = await boot(dir);
  try {
    await lifecycle.dispose();
    const listener = await fetch(`http://127.0.0.1:${port}/bottle`).catch((error) => error);
    assert.ok(listener instanceof Error);
  } finally {
    controller.abort();
    await disposeTemp(dir);
  }
});
