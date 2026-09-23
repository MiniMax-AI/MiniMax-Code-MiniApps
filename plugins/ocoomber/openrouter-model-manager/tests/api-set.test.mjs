import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { start } from '../miniapp/node/server.mjs';

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

test('POST /api/set toggles one model', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mm-api-set-'));
  const dataDir = join(root, 'a', 'b', 'c', 'openrouter-model-manager');
  const configPath = join(root, 'config.yaml');
  const controller = new AbortController();
  let runtime;

  try {
    await mkdir(dataDir, { recursive: true });
    await writeFile(configPath, [
      'providers:',
      '  openrouter:',
      '    models:',
      '      openai/gpt-4o:',
      '        enabled: true',
      '        name: GPT-4o',
      '',
    ].join('\n'), 'utf8');

    const port = await reservePort();
    runtime = await start({
      dataDir,
      pluginRoot,
      listen: { host: '127.0.0.1', port },
      signal: controller.signal,
      logger: { info() {}, error() {} },
    });

    const response = await fetch(`http://127.0.0.1:${port}/api/set`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 0, model: 'openai/gpt-4o', enabled: false }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { changed: true });
    assert.match(await readFile(configPath, 'utf8'), /enabled: false/);
  } finally {
    controller.abort();
    await runtime?.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
