// @ts-check

import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';

import { InputError, forward, loadConnection, publicView, saveConnection } from './openviking.mjs';

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */
/** @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle */

const SURFACE = '/context';
const MAX_BODY = 64 * 1024;
const API_PREFIX = '/ov-api';
const TYPES = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8' };
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'";

/** Load every Client file once; only these exact names are ever served. */
async function loadStatic(clientRoot) {
  const files = new Map();
  for (const dir of ['', 'vendor', 'build']) {
    for (const name of await readdir(join(clientRoot, dir))) {
      const type = TYPES[extname(name)];
      if (!type || name === 'index.html') continue;
      const rel = dir ? `${dir}/${name}` : name;
      files.set(`/static/${rel}`, { type, body: await readFile(join(clientRoot, rel)) });
    }
  }
  return files;
}

/**
 * Serve the Atlas page and an allowlisted, read-only proxy to the user's OpenViking server.
 * @param {MiniAppContext} context
 * @param {{ fetch?: typeof fetch }} [options] test seam
 * @returns {Promise<MiniAppLifecycle>}
 */
export async function start(context, options = {}) {
  const clientRoot = join(context.pluginRoot, 'miniapp', 'client');
  const page = await readFile(join(clientRoot, 'index.html'));
  const assets = await loadStatic(clientRoot);
  const fetchImpl = options.fetch ?? fetch;
  const { dataDir, logger } = context;

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://miniapp.local');
    const route = `${request.method} ${url.pathname}`;
    try {
      if (url.pathname.startsWith(`${API_PREFIX}/`)) {
        const connection = await loadConnection(dataDir);
        if (!connection.baseUrl) return json(response, 409, { error: 'not_configured' });
        const method = request.method ?? 'GET';
        const body = method === 'POST' ? await readBody(request) : undefined;
        const out = await forward(connection, {
          method, path: url.pathname.slice(API_PREFIX.length), query: url.searchParams, body,
        }, fetchImpl);
        response.writeHead(out.status, out.headers);
        response.end(out.body);
        return;
      }
      if (request.method === 'GET' && assets.has(url.pathname)) {
        const asset = assets.get(url.pathname);
        response.writeHead(200, { 'content-type': asset.type, 'cache-control': 'no-cache' });
        response.end(asset.body);
        return;
      }
      switch (route) {
        case `GET ${SURFACE}`:
          response.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'content-security-policy': CSP,
          });
          response.end(page);
          return;
        case 'GET /ov/connection':
          return json(response, 200, publicView(await loadConnection(dataDir)));
        case 'PUT /ov/connection': {
          const saved = await saveConnection(dataDir, parseJson(await readBody(request)));
          logger.info('openviking.connection.saved');
          return json(response, 200, publicView(saved));
        }
        default:
          return json(response, 404, { error: 'not_found' });
      }
    } catch (error) {
      if (error instanceof InputError) return json(response, error.message === 'route_not_allowed' ? 404 : 400, { error: error.message });
      logger.warn(`openviking.request_failed ${request.method} ${url.pathname} ${error?.name ?? 'Error'}`);
      return json(response, 502, { error: 'openviking_unavailable' });
    }
  });

  await listen(server, context.listen.host, context.listen.port);
  logger.info('openviking.workspace.listening');

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    context.signal.removeEventListener('abort', onAbort);
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  };
  const onAbort = () => void dispose();
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();
  return { dispose };
}

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

function parseJson(buffer) {
  try {
    return JSON.parse(buffer.toString('utf8') || '{}');
  } catch {
    throw new InputError('body_invalid');
  }
}

/** @returns {Promise<Buffer>} */
function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new InputError('body_too_large'));
        request.destroy();
      } else chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(undefined);
    });
  });
}
