import { mkdtemp, mkdir, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { start } from '../miniapp/node/server.mjs';
const root = await mkdtemp(join(tmpdir(), 'retouch-render-check-'));
const port = Number(process.env.RETOUCH_CHECK_PORT || 43188);
let lifecycle;
try {
  await mkdir(join(root, 'miniapp'), { recursive: true });
  const client = join(root, 'miniapp/client');
  await cp(fileURLToPath(new URL('../miniapp/client', import.meta.url)), client, {
    recursive: true,
  });
  for (const file of [
    'cache-check.html',
    'cache-check.js',
    'blend-check.html',
    'blend-check.js',
    'psd-check.html',
    'psd-check.js',
  ])
    await cp(
      fileURLToPath(new URL('./browser-checks/' + file, import.meta.url)),
      join(client, file),
    );
  lifecycle = await start({
    pluginId: 'retouch-render-check',
    pluginRoot: root,
    dataDir: join(root, 'data'),
    listen: { host: '127.0.0.1', port },
    signal: new AbortController().signal,
    logger: console,
  });
  console.log(`浏览器渲染检查：http://127.0.0.1:${port}/cache-check.html`);
  console.log(`混合模式对照：http://127.0.0.1:${port}/blend-check.html`);
} catch (error) {
  await rm(root, { recursive: true, force: true });
  throw error;
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, async () => {
    await lifecycle.dispose();
    await rm(root, { recursive: true, force: true });
    process.exit(0);
  });
