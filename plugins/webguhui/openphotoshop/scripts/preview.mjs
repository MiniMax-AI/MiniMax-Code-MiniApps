import { start } from '../miniapp/node/server.mjs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
const pluginRoot = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.RETOUCH_PREVIEW_PORT || 43187);
const controller = new AbortController();
const lifecycle = await start({
  pluginId: 'openphotoshop',
  pluginRoot,
  dataDir: resolve(process.env.RETOUCH_DATA_DIR || tmpdir(), 'openphotoshop-preview'),
  listen: { host: '127.0.0.1', port },
  signal: controller.signal,
  logger: { info: console.log, error: console.error },
});
console.log(`修图工作台预览：http://127.0.0.1:${port}`);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, async () => {
    await lifecycle.dispose();
    process.exit(0);
  });
