// @ts-check

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';

import { runMatch, runReplace } from './regex-engine.mjs';

/**
 * @typedef {import('./regex-engine.mjs').MatchInfo} MatchInfo
 * @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext
 * @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle
 */

/**
 * Build the HTTP request handler. Kept separate from start() so tests can
 * exercise the full request path without a Host-provided context.
 * @param {{ html: Buffer | string }} params
 */
export function createHandler({ html }) {
  return async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://miniapp.local');
    const route = url.pathname;
    try {
      if (request.method === 'GET' && route === '/dashboard') {
        sendHtml(response, 200, html);
        return;
      }
      if (request.method === 'POST' && (route === '/api/match' || route === '/api/replace')) {
        const body = await readJsonBody(request);
        const text = String(body?.text ?? '');
        const pattern = String(body?.pattern ?? '');
        const flags = String(body?.flags ?? '');
        const payload =
          route === '/api/match'
            ? runMatch(text, pattern, flags)
            : runReplace(text, pattern, flags, String(body?.replacement ?? ''));
        sendJson(response, 200, payload);
        return;
      }
      sendJson(response, 404, { error: 'not_found' });
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  };
}

/**
 * Node entry point: serve the static page and the JSON API.
 * @param {MiniAppContext} context
 * @returns {Promise<MiniAppLifecycle>}
 */
export async function start(context) {
  const html = await readFile(join(context.pluginRoot, 'miniapp/client/index.html'));
  const server = createServer(createHandler({ html }));

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

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function sendHtml(response, status, body) {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  response.end(body);
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
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
