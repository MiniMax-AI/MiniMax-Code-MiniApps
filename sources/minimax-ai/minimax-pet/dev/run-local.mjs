// MiniMax Pet — dev-only launcher. Not part of the runtime payload.
// Usage: node dev/run-local.mjs [--port N] [--data-dir PATH]

import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const { values } = parseArgs({
  options: {
    port: { type: 'string' },
    'data-dir': { type: 'string' },
  },
});

const port = values.port ? Number(values.port) : await freePort();
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error('invalid --port');
  process.exit(2);
}
const dataDir = resolve(values['data-dir'] ?? resolve(packageRoot, 'dev', '.data-local'));
await mkdir(dataDir, { recursive: true });

const controller = new AbortController();
const log = (level) => (message, fields) =>
  console.error(JSON.stringify({ level, message, ...(fields ? { fields } : {}) }));
const logger = { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') };

const { start } = await import(resolve(packageRoot, 'miniapp/node/server.mjs'));
const lifecycle = await start({
  pluginId: 'minimax-pet',
  pluginRoot: packageRoot,
  dataDir,
  listen: { host: '127.0.0.1', port },
  signal: controller.signal,
  logger,
});

console.log(`http://127.0.0.1:${port}/pet`);
console.log(`dataDir: ${dataDir}`);

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  controller.abort();
  await lifecycle?.dispose?.();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolvePort(typeof address === 'object' && address ? address.port : 0));
    });
  });
}
