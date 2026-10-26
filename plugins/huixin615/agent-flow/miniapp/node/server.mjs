// @ts-check
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */

function send(response, status, body, type = 'application/json; charset=utf-8') {
  response.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
function loopbackName(value) {
  return value.replace(/^\[|\]$/g, '').toLowerCase();
}

function localRequest(request, port) {
  if (!request.headers.host) return false;
  try {
    const host = new URL(`http://${request.headers.host}`);
    if (!LOOPBACK.has(loopbackName(host.hostname)) || Number(host.port) !== port
      || host.pathname !== '/' || host.search || host.hash || host.username || host.password) return false;
    if (request.headers.origin === undefined) return true;
    const origin = new URL(request.headers.origin);
    return origin.protocol === 'http:' && origin.origin === host.origin;
  } catch { return false; }
}

/** @param {MiniAppContext} context */
export async function start(context) {
  const client = join(context.pluginRoot, 'miniapp', 'client');
  const [html, css, js, flow] = await Promise.all([
    readFile(join(client, 'index.html')),
    readFile(join(client, 'app.css')),
    readFile(join(client, 'app.js')),
    readFile(join(client, 'flow.mjs')),
  ]);
  const server = createServer((request, response) => {
    if (!localRequest(request, context.listen.port)) return send(response, 403, JSON.stringify({ error: 'forbidden' }));
    if (request.method !== 'GET') return send(response, 405, JSON.stringify({ error: 'method_not_allowed' }));
    const url = new URL(request.url ?? '/', 'http://miniapp.local');
    if (url.pathname === '/dashboard') return send(response, 200, html, 'text/html; charset=utf-8');
    if (url.pathname === '/app.css') return send(response, 200, css, 'text/css; charset=utf-8');
    if (url.pathname === '/app.js') return send(response, 200, js, 'text/javascript; charset=utf-8');
    if (url.pathname === '/flow.mjs') return send(response, 200, flow, 'text/javascript; charset=utf-8');
    return send(response, 404, JSON.stringify({ error: 'not_found' }));
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
