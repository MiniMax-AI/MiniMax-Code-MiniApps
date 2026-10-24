// @ts-check

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */
/** @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle */

/** 允许被访问的静态资源白名单。 */
const ASSETS = {
  'index.html': 'text/html; charset=utf-8',
  'styles.css': 'text/css; charset=utf-8',
  'cities.js': 'text/javascript; charset=utf-8',
  'time.js': 'text/javascript; charset=utf-8',
  'app.js': 'text/javascript; charset=utf-8',
};

/**
 * 启动 Mini App 的 Node 入口。
 *
 * 页面本身是纯静态 Client：所有时区计算都在浏览器里用 Intl 完成，
 * 这里只负责把 surface.path 和它的静态资源挂到 Host 分配的端口上。
 *
 * @param {MiniAppContext} context
 * @returns {Promise<MiniAppLifecycle>}
 */
export async function start(context) {
  const clientDir = join(context.pluginRoot, 'miniapp/client');

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://miniapp.local');

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, {
        'content-type': 'application/json; charset=utf-8',
        allow: 'GET, HEAD',
      });
      response.end(JSON.stringify({ error: 'method_not_allowed' }));
      return;
    }

    // surface.path 与静态资源共用同一份 Client 目录。
    // 去掉尾部斜杠，宿主用 /dashboard 或 /dashboard/ 请求都能命中。
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    const name = pathname === '/' || pathname === '/dashboard'
      ? 'index.html'
      : pathname.split('/').filter(Boolean).pop() || '';

    const contentType = ASSETS[name];
    if (!contentType) {
      response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'not_found' }));
      return;
    }

    readFile(join(clientDir, name)).then(
      (body) => {
        response.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' });
        response.end(request.method === 'HEAD' ? undefined : body);
      },
      () => {
        response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'asset_unreadable' }));
      },
    );
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(context.listen.port, context.listen.host, () => {
      server.off('error', onError);
      resolve();
    });
  });

  context.logger.info('miniapp.runtime.listening');

  let disposal;
  const dispose = () => {
    if (disposal) return disposal;
    context.signal.removeEventListener('abort', onAbort);
    disposal = new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    return disposal;
  };
  const onAbort = () => {
    void dispose().catch(() => undefined);
  };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  return { dispose };
}
