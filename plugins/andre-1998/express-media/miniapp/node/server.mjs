// @ts-check
//
// 急件 · 平台限制速查 —— Mini App 的 Node 入口。
//
// 只做一件事：把插件自带的平台限制表读出来交给页面渲染。
// 数据来自插件根目录的 data/platforms.json —— 与 skill、CLI 用的是同一份表，
// 全程本机读取，不发任何网络请求，也不需要任何设备权限。
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */
/** @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle */

const SURFACE_PATH = '/limits';
const API_PATH = '/api/platforms';

/**
 * 启动 Mini App 的本地服务。
 * @param {MiniAppContext} context
 * @returns {Promise<MiniAppLifecycle>}
 */
export async function start(context) {
  const clientHtml = await readFile(join(context.pluginRoot, 'miniapp/client/index.html'));
  const table = await loadTable(context);
  const payload = JSON.stringify(table);

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://miniapp.local');
    if (request.method === 'GET' && url.pathname === SURFACE_PATH) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(clientHtml);
      return;
    }
    if (request.method === 'GET' && url.pathname === API_PATH) {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(payload);
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'not_found' }));
  });

  await listen(server, context.listen.host, context.listen.port);
  context.logger.info('express-media.miniapp.listening', { platforms: table.targets.length });

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

/**
 * 读插件自带的平台限制表。读不到就返回空表，让页面说明原因，而不是让 Mini App 起不来。
 * @param {MiniAppContext} context
 */
async function loadTable(context) {
  const file = join(context.pluginRoot, 'data', 'platforms.json');
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.targets)) return parsed;
    context.logger.error('express-media.miniapp.table_shape', { path: 'data/platforms.json' });
  } catch (error) {
    context.logger.error('express-media.miniapp.table_missing', { path: 'data/platforms.json' });
  }
  return { schema: 1, updatedAt: null, targets: [] };
}

/**
 * @param {import('node:http').Server} server
 * @param {string} host
 * @param {number} port
 */
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

/**
 * @param {import('node:http').Server} server
 */
function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}