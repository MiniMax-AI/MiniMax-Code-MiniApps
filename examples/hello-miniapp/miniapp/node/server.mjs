// @ts-check

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */
/** @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle */

/**
 * Serve the routes declared in miniapp.json. Replace `/dashboard` with your surface path.
 * @param {MiniAppContext} context
 * @returns {Promise<MiniAppLifecycle>}
 */
export async function start(context) {
  const clientEntry = await readFile(join(context.pluginRoot, 'miniapp/client/index.html'));
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://miniapp.local');
    if (request.method === 'GET' && url.pathname === '/dashboard') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(clientEntry);
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'not_found' }));
  });

  await listen(server, context.listen.host, context.listen.port);
  context.logger.info('miniapp.runtime.listening');

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
