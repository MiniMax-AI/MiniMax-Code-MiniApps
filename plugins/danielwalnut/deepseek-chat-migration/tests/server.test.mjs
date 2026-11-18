import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { start } from '../miniapp/node/server.mjs';

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

test('serves the page and its assets, and nothing else', async (context) => {
  const port = await freePort();
  const controller = new AbortController();
  const runtime = await start({
    dataDir: '/nonexistent/never-touched',
    pluginRoot: PACKAGE,
    listen: { host: '127.0.0.1', port },
    signal: controller.signal,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  });
  context.after(async () => {
    await runtime.dispose();
    controller.abort();
  });
  const base = `http://127.0.0.1:${port}`;
  const page = await fetch(`${base}/deepseek-chat-migration`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Add to chat input/);
  for (const asset of ['app.js', 'handoff.js', 'deepseek.js', 'archive.js', 'styles.css', 'icon.png']) {
    assert.equal((await fetch(`${base}/assets/${asset}`)).status, 200, asset);
  }
  for (const [method, path] of [['GET', '/api/state'], ['GET', '/api/project'], ['POST', '/api/source'], ['POST', '/api/migration/plan'], ['POST', '/api/migration/apply'], ['GET', '/assets/../server.mjs']]) {
    assert.equal((await fetch(`${base}${path}`, { method })).status, 404, `${method} ${path}`);
  }
});

test('the runtime reads no Host files and spawns nothing', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../miniapp/node/server.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /child_process|homedir|\.minimax|sqlite/);
});
