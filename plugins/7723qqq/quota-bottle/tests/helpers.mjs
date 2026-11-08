import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageRoot = fileURLToPath(new URL('..', import.meta.url));

export async function tempDir(prefix) {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function disposeTemp(dir) {
  await rm(dir, { recursive: true, force: true });
}

export async function writeJson(path, value) {
  await mkdir(join(path, '..'), { recursive: true }).catch(() => {});
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export function fakeContext(root, { port = 0, signal = new AbortController().signal } = {}) {
  const logs = [];
  const logger = {
    debug: (...args) => logs.push(args),
    info: (...args) => logs.push(args),
    warn: (...args) => logs.push(args),
    error: (...args) => logs.push(args),
  };
  return {
    pluginId: 'quota-bottle',
    pluginRoot: packageRoot,
    dataDir: join(root, 'data'),
    listen: { host: '127.0.0.1', port },
    signal,
    logger,
    logs,
  };
}

export async function freePort() {
  const { createServer } = await import('node:http');
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
