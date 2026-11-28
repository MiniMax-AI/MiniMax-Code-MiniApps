// @ts-check

import { createServer } from 'node:http';
import { join } from 'node:path';

import { createApiHandler } from './api.js';
import { createStaticHandler } from './static.js';
import { setDataDir } from './config.js';

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */
/** @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle */

/**
 * Mini App 的 Node 运行时入口。
 *
 * 复用独立版 Postman Lite 的同一套后端逻辑（api / proxy / static / store），
 * 差别只有两点：
 *   1. 集合数据写进 Host 分配的数据目录，而不是仓库里的 data/
 *   2. 静态资源来自 Mini App 自己的 client/ 产物
 *
 * @param {MiniAppContext} context
 * @returns {Promise<MiniAppLifecycle>}
 */
export async function start(context) {
  // 集合数据落在 Host 分配的数据目录
  setDataDir(context.dataDir);

  const clientDir = join(context.pluginRoot, 'miniapp/client');
  const apiHandler = createApiHandler();
  const staticHandler = createStaticHandler(clientDir);

  const server = createServer((request, response) => {
    // /api/* 交给业务接口，其余路径交给静态资源
    apiHandler(request, response, () => {
      staticHandler(request, response, () => {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('404 Not Found');
      });
    });
  });

  await listen(server, context.listen.host, context.listen.port);
  context.logger.info('miniapp.runtime.listening', { port: context.listen.port });

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    context.signal.removeEventListener('abort', onAbort);
    await close(server);
  };
  const onAbort = () => {
    void dispose();
  };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  return { dispose };
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
