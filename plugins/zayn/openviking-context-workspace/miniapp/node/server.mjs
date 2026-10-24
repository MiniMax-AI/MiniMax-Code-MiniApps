// @ts-check

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, relative, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { resolveConnection } from './credentials.mjs';

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */
/** @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle */

const MAX_PROXY_BODY_BYTES = 64 * 1024 * 1024;
const MCP_PATH = '/mcp/openviking';
const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * Serve OpenViking Studio and fixed same-origin proxies for its REST and MCP APIs.
 * OpenViking credentials stay in this Node process and are never sent to the page.
 * @param {MiniAppContext} context
 * @returns {Promise<MiniAppLifecycle>}
 */
export async function start(context) {
  const clientRoot = join(context.pluginRoot, 'miniapp', 'client');
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://miniapp.local');

      if (url.pathname === '/miniapp-api/status') {
        if (request.method !== 'GET') return json(response, 405, { error: 'method_not_allowed' });
        const connection = resolveConnection('minimax-code', { rootKeyFallback: true });
        return json(response, 200, {
          configured: Boolean(connection.baseUrl),
          authenticated: connection.hasApiKey || connection.sendIdentityHeaders,
          credentialSource: connection.credentialSource,
        });
      }

      if (isProxyPath(url.pathname)) {
        await proxyOpenViking(request, response, url, context);
        return;
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json(response, 405, { error: 'method_not_allowed' });
      }

      if (url.pathname === '/') {
        response.writeHead(302, { location: '/workspace' });
        response.end();
        return;
      }

      await serveStudio(request, response, url.pathname, clientRoot);
    } catch (error) {
      context.logger.error('openviking.workspace.request_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      if (!response.headersSent) {
        const status = Number(error?.statusCode) || 500;
        json(response, status, { error: status === 413 ? 'request_body_too_large' : 'request_failed' });
      } else {
        response.destroy();
      }
    }
  });

  await listen(server, context.listen.host, context.listen.port);
  context.logger.info('openviking.workspace.listening');

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    context.signal.removeEventListener('abort', onAbort);
    await close(server);
  };
  const onAbort = () => void dispose();
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  return { dispose };
}

function isProxyPath(pathname) {
  return pathname === MCP_PATH
    || pathname === '/health'
    || pathname === '/ready'
    || pathname === '/openapi.json'
    || pathname.startsWith('/api/')
    || pathname.startsWith('/bot/');
}

async function proxyOpenViking(request, response, url, context) {
  const connection = resolveConnection('minimax-code', { rootKeyFallback: true });
  if (!connection.baseUrl) return json(response, 503, { error: 'openviking_not_configured' });

  const upstreamPath = url.pathname === MCP_PATH ? '/mcp' : url.pathname;
  const target = new URL(`${connection.baseUrl.replace(/\/+$/, '')}${upstreamPath}${url.search}`);
  const headers = new Headers();
  for (const name of ['accept', 'content-type', 'last-event-id', 'mcp-protocol-version', 'mcp-session-id']) {
    const value = request.headers[name];
    if (typeof value === 'string') headers.set(name, value);
  }
  if (connection.apiKey) {
    headers.set('authorization', `Bearer ${connection.apiKey}`);
  }
  if (connection.sendIdentityHeaders) {
    if (connection.account) headers.set('x-openviking-account', connection.account);
    if (connection.user) headers.set('x-openviking-user', connection.user);
  }
  if (connection.peerId) headers.set('x-openviking-actor-peer', connection.peerId);

  const body = ['GET', 'HEAD'].includes(request.method ?? 'GET')
    ? undefined
    : await readBody(request, MAX_PROXY_BODY_BYTES);
  const abort = new AbortController();
  const onAborted = () => abort.abort();
  request.once('aborted', onAborted);

  let upstream;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      redirect: 'manual',
      signal: abort.signal,
    });
  } catch (error) {
    context.logger.warn('openviking.workspace.upstream_unavailable', {
      error: error instanceof Error ? error.message : String(error),
    });
    request.off('aborted', onAborted);
    return json(response, 502, { error: 'openviking_unavailable' });
  }
  request.off('aborted', onAborted);

  const responseHeaders = {};
  for (const name of ['cache-control', 'content-type', 'etag', 'last-modified', 'mcp-session-id']) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders[name] = value;
  }
  response.writeHead(upstream.status, responseHeaders);
  if (!upstream.body || request.method === 'HEAD') {
    response.end();
    return;
  }
  await pipeline(upstream.body, response);
}

async function serveStudio(request, response, pathname, clientRoot) {
  if (pathname !== '/workspace' && !pathname.startsWith('/workspace/')) {
    return json(response, 404, { error: 'not_found' });
  }

  const requested = pathname === '/workspace' || pathname === '/workspace/'
    ? 'index.html'
    : decodeURIComponent(pathname.slice('/workspace/'.length));
  let file = safeJoin(clientRoot, requested);
  let info = file ? await stat(file).catch(() => null) : null;

  if ((!info || !info.isFile()) && !extname(requested)) {
    file = join(clientRoot, 'index.html');
    info = await stat(file).catch(() => null);
  }
  if (!file || !info?.isFile()) return json(response, 404, { error: 'not_found' });

  const headers = {
    'content-type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': String(info.size),
    'cache-control': file.endsWith(`${sep}index.html`) ? 'no-store' : 'public, max-age=31536000, immutable',
  };
  response.writeHead(200, headers);
  if (request.method === 'HEAD') response.end();
  else await pipeline(createReadStream(file), response);
}

function safeJoin(root, value) {
  const file = join(root, value);
  const child = relative(root, file);
  return child && !child.startsWith(`..${sep}`) && child !== '..' ? file : null;
}

function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('request_body_too_large'), { statusCode: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function json(response, status, value) {
  if (response.headersSent) return;
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(value));
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
