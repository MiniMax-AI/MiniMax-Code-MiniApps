// @ts-check
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { DataError, listConversations, readFlow, readTaskDetail } from './data.mjs';

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */

function send(response, status, body, type = 'application/json; charset=utf-8') {
  response.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

/** @param {MiniAppContext} context */
export async function start(context) {
  const client = join(context.pluginRoot, 'miniapp', 'client');
  const [html, css, js] = await Promise.all([
    readFile(join(client, 'index.html')),
    readFile(join(client, 'app.css')),
    readFile(join(client, 'app.js')),
  ]);
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://miniapp.local');
      if (request.method !== 'GET') return send(response, 405, JSON.stringify({ error: 'method_not_allowed' }));
      if (url.pathname === '/dashboard') return send(response, 200, html, 'text/html; charset=utf-8');
      if (url.pathname === '/app.css') return send(response, 200, css, 'text/css; charset=utf-8');
      if (url.pathname === '/app.js') return send(response, 200, js, 'text/javascript; charset=utf-8');
      try {
        if (url.pathname === '/api/sessions') {
          return send(response, 200, JSON.stringify({
            ...await listConversations(undefined, Number(url.searchParams.get('limit') || 40), url.searchParams.get('pin')),
            selection: 'inferred-most-recent',
          }));
        }
        if (url.pathname === '/api/flow') {
          return send(response, 200, JSON.stringify(await readFlow(url.searchParams.get('id') ?? '')));
        }
        if (url.pathname === '/api/task') {
          return send(response, 200, JSON.stringify(await readTaskDetail(
            url.searchParams.get('id') ?? '', url.searchParams.get('task') ?? '',
          )));
        }
      } catch (error) {
        const known = error instanceof DataError;
        return send(response, known ? 400 : 500, JSON.stringify({
          error: known ? error.code : 'INTERNAL_ERROR',
          message: known ? error.message : '读取本机记录时发生错误。',
        }));
      }
      return send(response, 404, JSON.stringify({ error: 'not_found' }));
    })();
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(context.listen.port, context.listen.host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  context.logger.info('agent-flow.runtime.listening');

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    context.signal.removeEventListener('abort', onAbort);
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  };
  const onAbort = () => { void dispose(); };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();
  return { dispose };
}
