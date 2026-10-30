import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { start } from './miniapp/node/server.mjs';

const abort = new AbortController();
const port = Number(process.env.PORT || 4317);
const write = (level, message) => {
  process.stderr.write(`[${level}] ${message}\n`);
};

const lifecycle = await start({
  pluginId: 'openviking-context-workspace',
  pluginRoot: import.meta.dirname,
  dataDir: process.env.OV_MINIAPP_DATA_DIR || join(tmpdir(), 'openviking-context-workspace-dev'),
  listen: { host: '127.0.0.1', port },
  signal: abort.signal,
  logger: {
    debug: (message) => write('debug', message),
    info: (message) => write('info', message),
    warn: (message) => write('warn', message),
    error: (message) => write('error', message),
  },
});

process.stderr.write(`OpenViking MiniApp preview: http://127.0.0.1:${port}/context\n`);

const shutdown = async () => {
  abort.abort();
  await lifecycle?.dispose?.().catch(() => {});
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
