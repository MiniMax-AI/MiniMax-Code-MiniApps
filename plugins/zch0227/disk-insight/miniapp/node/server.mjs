// @ts-check
// 入口：start 里只装路由、开始监听，不做扫描和业务读取。
import { execFile, spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './app.mjs';
import { createRunner } from './exec.mjs';
import { createRouter } from './routes.mjs';

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */
/** @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle */

/**
 * MiniMax Code 的数据目录：dataDir 往上第一个以 .minimax 开头的目录，找不到时用 ~/.minimax。
 * @param {string} dataDir @param {string} home
 */
export function findMcodeDataDir(dataDir, home) {
  let cur = path.resolve(dataDir);
  for (;;) {
    if (path.basename(cur).startsWith('.minimax')) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return path.join(home, '.minimax');
}

/**
 * @param {MiniAppContext} context
 * @returns {Promise<MiniAppLifecycle>}
 */
export async function start(context) {
  const home = os.homedir();
  const exec = createRunner({ spawn, execFile, logger: context.logger });
  const app = createApp({
    platform: process.platform,
    env: process.env,
    home,
    tmpdir: process.env.TMPDIR || os.tmpdir(),
    fs: fsp,
    exec,
    dataDir: context.dataDir,
    logger: context.logger,
    mcodeDataDir: findMcodeDataDir(context.dataDir, home),
  });
  const handle = createRouter(app, { fs: fsp, pluginRoot: context.pluginRoot, logger: context.logger });
  const server = createServer((req, res) => {
    void handle(req, res);
  });

  await new Promise((resolve, reject) => {
    const onError = (/** @type {Error} */ error) => reject(error);
    server.once('error', onError);
    server.listen(context.listen.port, context.listen.host, () => {
      server.off('error', onError);
      resolve(undefined);
    });
  });
  context.logger.info('miniapp.runtime.listening');

  /** @type {Promise<void> | null} */
  let disposal = null;
  const dispose = () => {
    if (disposal) return disposal;
    context.signal.removeEventListener('abort', onAbort);
    disposal = (async () => {
      await app.dispose();
      await new Promise((resolve) => {
        server.close(() => resolve(undefined));
        /** @type {any} */ (server).closeAllConnections?.();
      });
    })();
    return disposal;
  };
  const onAbort = () => {
    void dispose().catch(() => undefined);
  };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  return { dispose };
}
