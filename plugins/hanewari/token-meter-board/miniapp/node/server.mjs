// @ts-check
// token-meter-board Mini App Node entry.
//
// Serves the dashboard page and a read-only JSON API. Every number the page
// shows is derived from the runtime's own session records
// (`<dataRoot>/v2/sessions/**/messages.jsonl`), read by lib/sessions.mjs.
//
// The runtime's internal database, its observability logs and its Host
// configuration are NOT opened: a community Mini App must not touch
// Host-internal stores. The consequence is honest and visible on the page:
// the session records carry token counts, model ids and stop reasons, but no
// durations and no workspace paths, so this board shows neither a token rate
// nor a path.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensureScanned,
  queryCalls,
  queryDaily,
  queryHealth,
  queryModels,
  querySessions,
  queryTurns,
  queryWindow,
  resetStore,
  saveStore,
} from './lib/queries.mjs';

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */
/** @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * The Host header must name this machine (a DNS-rebound name is refused), and
 * a browser Origin, when sent, must be this listener: http, a loopback host
 * and our port. The page itself is same-origin.
 * @param {import('node:http').IncomingMessage} request
 * @param {number} port
 */
function isLoopbackRequest(request, port) {
  const host = request.headers.host;
  if (host !== undefined && !LOOPBACK_HOSTS.has(hostnameOf(host))) return false;
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false; // includes "null" (sandboxed iframes, file://)
  }
  const originPort = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(hostnameOf(url.host)) && originPort === port;
}

/** @param {string} hostHeader */
function hostnameOf(hostHeader) {
  const h = hostHeader.trim().toLowerCase();
  const bracketed = /^\[([^\]]*)\]/.exec(h);
  if (bracketed) return bracketed[1];
  const colon = h.lastIndexOf(':');
  return colon === -1 ? h : h.slice(0, colon);
}

/**
 * Strip anything that looks like an absolute path out of a message that is
 * about to be sent to the page. The Host logger keeps the original, so
 * diagnostics are not lost — only the page sees the redacted form.
 * @param {string} message
 */
export function redactPaths(message) {
  return message
    .replace(/\b[A-Za-z]:[\\/][^\s"'`)]*/g, '<path>')
    .replace(/\/(?:[\w.-]+\/)+[\w.-]*/g, '<path>')
    .slice(0, 200);
}

/**
 * Query parameters are an ALLOW-LIST, not a pass-through: a crafted query
 * string can never reach the query layer with a key it does not expect.
 * @type {Record<string, string[]>}
 */
const API_PARAMS = {
  window: ['startAt', 'endAt', 'days', 'bucket'],
  trend: ['startAt', 'endAt', 'days', 'bucket'],
  summary: ['startAt', 'endAt', 'days'],
  models: ['startAt', 'endAt', 'days'],
  sessions: ['startAt', 'endAt', 'days', 'limit'],
  daily: ['startAt', 'endAt', 'days'],
  turns: ['startAt', 'endAt', 'days', 'limit'],
  calls: ['startAt', 'endAt', 'days', 'limit'],
};

/**
 * @param {MiniAppContext} context
 * @returns {Promise<MiniAppLifecycle>}
 */
export async function start(context) {
  const clientEntry = await fs.promises.readFile(
    path.join(context.pluginRoot, 'miniapp', 'client', 'index.html'),
  );
  const chartJs = await fs.promises.readFile(
    path.join(context.pluginRoot, 'miniapp', 'client', 'vendor', 'chart.umd.min.js'),
  );

  const server = http.createServer((request, response) => {
    void (async () => {
      try {
        if (!isLoopbackRequest(request, context.listen.port)) {
          response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: 'forbidden' }));
          return;
        }
        const url = new URL(request.url ?? '/', 'http://miniapp.local');
        if (request.method !== 'GET') {
          response.writeHead(405, { 'content-type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: 'method_not_allowed' }));
          return;
        }
        if (url.pathname === '/' || url.pathname === '/index.html') {
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
          response.end(clientEntry);
          return;
        }
        if (url.pathname === '/vendor/chart.umd.min.js') {
          response.writeHead(200, {
            'content-type': 'application/javascript; charset=utf-8',
            'cache-control': 'public, max-age=86400',
          });
          response.end(chartJs);
          return;
        }

        const now = Date.now();
        if (url.pathname === '/api/health') {
          const body = await queryHealth(context, now);
          response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          response.end(JSON.stringify(body));
          return;
        }

        /** @type {Record<string, (args: any) => Promise<any>>} */
        const handlers = {
          window: (args) => queryWindow(context, args, now),
          trend: async (args) => (await queryWindow(context, args, now)).trend,
          summary: async (args) => (await queryWindow(context, args, now)).summary,
          models: (args) => queryModels(context, args, now),
          sessions: (args) => querySessions(context, args, now),
          daily: (args) => queryDaily(context, args, now),
          turns: (args) => queryTurns(context, args, now),
          calls: (args) => queryCalls(context, args, now),
        };
        const handler = handlers[url.pathname.replace(/^\/api\//, '')];
        if (!handler) {
          response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: 'not_found' }));
          return;
        }

        const allowed = API_PARAMS[url.pathname.replace(/^\/api\//, '')] ?? [];
        /** @type {Record<string, string>} */
        const params = {};
        for (const key of allowed) {
          if (!url.searchParams.has(key)) continue;
          params[key] = url.searchParams.get(key) ?? '';
        }
        const body = await handler(params);
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        response.end(JSON.stringify(body));
      } catch (err) {
        const message = String(err?.message || err);
        context.logger.warn('token_meter_board.request_error', { reason: message.slice(0, 120) });
        if (!response.headersSent) {
          response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: redactPaths(message) }));
        } else {
          response.end();
        }
      }
    })();
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(context.listen.port, context.listen.host, () => {
      server.off('error', onError);
      resolve(undefined);
    });
  });
  context.logger.info('token_meter_board.listening');

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    context.signal.removeEventListener('abort', onAbort);
    // Persist the scan cursor so the next start resumes instead of re-reading
    // every transcript.
    try {
      await ensureScanned(context, Date.now());
      await saveStore(true);
    } catch {
      // the cursor is a cache; losing it only costs a full rescan
    }
    resetStore();
    server.closeIdleConnections?.();
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  };
  const onAbort = () => {
    void dispose();
  };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  return { dispose };
}
