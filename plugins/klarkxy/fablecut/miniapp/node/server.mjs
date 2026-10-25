// @ts-check
// FableCut Mini App — Node entry.
//
// Serves two things on the one port the Host assigns:
//
//   /editor          the upstream FableCut web editor and its REST API
//   /mcp/fablecut    the 19 upstream MCP tools over Streamable HTTP
//
// Both run in this process. The tools never open a socket to the editor: they
// call the editor's own request handler in-process, so no credential, no port
// and no second server is involved.
//
// Durable state lives under context.dataDir (the upstream FABLECUT_DATA_DIR).
// stdout and stdin belong to the Host, so this entry logs through
// context.logger and never writes to a stream.

import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createLocalApi } from './adapters/local-api.mjs';
import { createMcpHttpHandler } from './adapters/mcp-http.mjs';

/** @typedef {import('./miniapp-api.ts').MiniAppContext} MiniAppContext */
/** @typedef {import('./miniapp-api.ts').MiniAppLifecycle} MiniAppLifecycle */

const require = createRequire(import.meta.url);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VENDOR_DIR = path.join(HERE, 'vendor', 'fablecut');
/** Where the editor page and its assets live. */
const CLIENT_DIR = path.join(HERE, '..', 'client');
/** The route the Host opens the Mini App on. */
const SURFACE_PATH = '/editor';
/** The route the Host's MCP client posts to. */
const MCP_PATH = '/mcp/fablecut';

/**
 * The upstream editor is a CommonJS module tree that reads its configuration
 * from the environment when it is first loaded, so the environment has to be
 * in place before the first require.
 *
 * @param {MiniAppContext} context
 */
function prepareEnvironment(context) {
  process.env.FABLECUT_DATA_DIR = context.dataDir;
  // The editor's static files live in the client payload, not next to the
  // server modules.
  process.env.FABLECUT_STATIC_DIR = CLIENT_DIR;
  // The Host's own loopback host has to be an allowed origin.
  process.env.FABLECUT_ALLOWED_HOSTS = [
    'localhost',
    '127.0.0.1',
    '[::1]',
    context.listen.host,
  ]
    .filter(Boolean)
    .join(',');
  // The Host may serve the page under a host name of its own choosing; the
  // Host's per-run credential already guards the port.
  process.env.FABLECUT_TRUST_HOST = '1';
  // The Host owns stdout, so upstream's warning goes through the logger.
  globalThis.__FABLECUT_LOG__ = {
    /** @param {string} message */
    warn: (message) => context.logger.warn(message),
    /** @param {string} message */
    error: (message) => context.logger.error(message),
  };
}

/**
 * @param {MiniAppContext} context
 * @returns {Promise<MiniAppLifecycle>}
 */
export async function start(context) {
  prepareEnvironment(context);

  /** @type {any} */
  const upstream = require(path.join(VENDOR_DIR, 'server.js'));
  const processes = require(path.join(VENDOR_DIR, 'processes.js'));
  /** @type {any} */
  const mcp = require(path.join(VENDOR_DIR, 'mcp-server.js'));

  const authority = `${context.listen.host}:${context.listen.port}`;
  const transport = createLocalApi({ handleRequest: upstream.handleRequest, authority });
  // From now on the MCP tools talk to the editor in-process.
  mcp.setTransport(transport);
  // The tools must not hand out a loopback URL the user cannot open: the
  // editor's page is this Mini App, and served files are relative to its own
  // origin.
  mcp.setEditorLocation({
    url: '',
    open: 'open the FableCut Mini App to watch edits live',
    where: 'the FableCut editor UI (if the Mini App is open)',
  });

  const handleMcp = createMcpHttpHandler({ handleMessage: mcp.handleMessage });

  /**
   * The editor page is served on the surface route; the upstream handler
   * serves files from the static root and treats "/" as index.html.
   *
   * @param {import('node:http').IncomingMessage} request
   */
  const toEditorPath = (request) => {
    const raw = request.url ?? '/';
    const query = raw.indexOf('?');
    const pathname = query === -1 ? raw : raw.slice(0, query);
    if (pathname !== SURFACE_PATH && pathname !== `${SURFACE_PATH}/`) return;
    const search = query === -1 ? '' : raw.slice(query);
    request.url = `/index.html${search}`;
  };

  const server = createServer((request, response) => {
    const pathname = (request.url ?? '/').split('?')[0];
    if (pathname === MCP_PATH) {
      handleMcp(request, response).catch((error) => {
        context.logger.error('fablecut.mcp_failed', {
          message: error instanceof Error ? error.message : String(error),
        });
        if (!response.headersSent) {
          response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
          response.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: null,
              error: { code: -32603, message: 'The MCP request could not be handled.' },
            }),
          );
        } else {
          response.end();
        }
      });
      return;
    }
    toEditorPath(request);
    upstream.handleRequest(request, response).catch((error) => {
      context.logger.error('fablecut.request_failed', {
        path: (request.url ?? '').split('?')[0],
        message: error instanceof Error ? error.message : String(error),
      });
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'internal error' }));
      } else {
        response.end();
      }
    });
  });

  // The editor holds long-lived connections (live reload, export uploads).
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;

  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(context.listen.port, context.listen.host, () => {
      server.off('error', fail);
      done(undefined);
    });
  }).catch(async (error) => {
    // A port collision must not leave upstream resources behind.
    upstream.shutdown();
    await processes.shutdown();
    mcp.setTransport(null);
    throw error;
  });

  context.logger.info('fablecut.listening', {
    surface: SURFACE_PATH,
    mcp: MCP_PATH,
    tools: mcp.TOOLS.length,
    client: existsSync(path.join(CLIENT_DIR, 'index.html')) ? 'ok' : 'missing',
  });

  let disposed = false;
  /** @type {() => void} */
  const onAbort = () => {
    void dispose();
  };

  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    context.signal.removeEventListener('abort', onAbort);
    // Closes the timers, the directory watchers, the export sessions and the
    // live-reload clients the upstream server started.
    upstream.shutdown();
    const stoppedProcesses = processes.shutdown();
    const closed = new Promise((done) => server.close(() => done(undefined)));
    server.closeAllConnections?.();
    await Promise.all([closed, stoppedProcesses]);
    mcp.setTransport(null);
  };

  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  return { dispose };
}
