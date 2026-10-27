// @ts-check
// MiniMax Pet — Codex Pet Mini App Node entry. Serves the pet page, static client assets, and the pet API.

import { open, readFile, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { PET_ID_PATTERN, PetError, createPetStore } from './pet-store.mjs';
import { PreferenceError, createPreferenceStore } from './preferences-store.mjs';

/**
 * @typedef {{ debug(m: string, f?: object): void, info(m: string, f?: object): void, warn(m: string, f?: object): void, error(m: string, f?: object): void }} Logger
 * @typedef {{ pluginId: string, pluginRoot: string, dataDir: string, listen: { host: string, port: number }, signal: AbortSignal, logger: Logger }} MiniAppContext
 * @typedef {import('node:http').IncomingMessage} Req
 * @typedef {import('node:http').ServerResponse} Res
 */

const BODY_LIMIT = 12 * 1024 * 1024;
const DRAIN_LIMIT = 4 * BODY_LIMIT;

const ASSET_MIME = /** @type {Record<string, string>} */ ({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
});

class HttpError extends Error {
  /** @param {number} status @param {string} code @param {string} message @param {Record<string, string>} [headers] */
  constructor(status, code, message, headers) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

/**
 * @param {MiniAppContext} context
 * @returns {Promise<{ dispose(): Promise<void> }>}
 */
export async function start(context) {
  const clientRoot = resolve(context.pluginRoot, 'miniapp', 'client');
  const logger = context.logger;
  const store = createPetStore({ clientRoot, dataDir: context.dataDir, logger });
  const preferences = createPreferenceStore({ dataDir: context.dataDir });
  /** @type {string | null} */
  let clientRootReal = null;

  async function getClientRootReal() {
    if (!clientRootReal) clientRootReal = await realpath(clientRoot);
    return clientRootReal;
  }

  const server = createServer((request, response) => {
    handle(request, response).catch((error) => {
      if (error instanceof HttpError || error instanceof PetError || error instanceof PreferenceError) {
        const headers = error instanceof HttpError ? error.headers : undefined;
        sendError(response, error.status, error.code, error.message, headers);
        return;
      }
      logger.error('pet.http.internal_error', { errno: errnoCode(error) });
      sendError(response, 500, 'internal_error', 'internal error');
    });
  });

  /** @param {Req} request @param {Res} response */
  async function handle(request, response) {
    const rawUrl = request.url ?? '';
    if (!rawUrl.startsWith('/')) throw new HttpError(400, 'bad_request', 'invalid request target');
    const queryAt = rawUrl.indexOf('?');
    const path = queryAt === -1 ? rawUrl : rawUrl.slice(0, queryAt);
    const method = request.method ?? 'GET';

    if (path === '/pet') {
      requireMethod(method, ['GET']);
      return servePage(response);
    }
    if (path.startsWith('/assets/')) {
      requireMethod(method, ['GET']);
      return serveAsset(response, path.slice('/assets/'.length));
    }
    if (path === '/api/preferences') {
      requireMethod(method, ['GET', 'PATCH']);
      if (method === 'GET') return sendJson(response, 200, await preferences.get());
      // This local API stores preferences only. Reject explicit cross-origin browser writes.
      const origin = request.headers.origin;
      if (origin && origin !== `http://${request.headers.host}`) throw new HttpError(403, 'origin_not_allowed', 'cross-origin write not allowed');
      const condition = request.headers['if-none-match'];
      if (condition !== undefined && condition !== '*') throw new HttpError(400, 'invalid_preferences_condition', 'only If-None-Match: * is supported');
      return sendJson(response, 200, await preferences.patch(await readJsonBody(request, 16 * 1024), { onlyIfUnpersisted: condition === '*' }));
    }
    if (path === '/api/pets') {
      requireMethod(method, ['GET', 'POST']);
      if (method === 'GET') {
        return sendJson(response, 200, { pets: await store.listPets() });
      }
      const body = await readJsonBody(request);
      const pet = await store.importPet(body);
      return sendJson(response, 201, { pet });
    }
    if (path.startsWith('/api/pets/')) {
      const segments = splitSegments(path.slice('/api/pets/'.length));
      if (!segments || segments.length !== 1) throw notFound();
      requireMethod(method, ['DELETE']);
      await store.deletePet(segments[0]);
      response.writeHead(204, { 'cache-control': 'no-store' });
      response.end();
      return;
    }
    if (path.startsWith('/imported/')) {
      const segments = splitSegments(path.slice('/imported/'.length));
      if (!segments || segments.length !== 2) throw notFound();
      requireMethod(method, ['GET']);
      const [id, file] = segments;
      if (!PET_ID_PATTERN.test(id)) throw notFound();
      const resolved = await store.resolveImportedFile(id, file);
      if (!resolved) throw notFound();
      return sendFile(response, resolved.path, resolved.contentType);
    }
    throw notFound();
  }

  /** @param {Res} response */
  async function servePage(response) {
    let html;
    try {
      html = await readFile(join(clientRoot, 'index.html'));
    } catch (error) {
      if (errnoCode(error) === 'ENOENT') {
        throw new HttpError(503, 'client_missing', 'client index.html is not available');
      }
      throw error;
    }
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': String(html.length),
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    response.end(html);
  }

  /** @param {Res} response @param {string} rawRest */
  async function serveAsset(response, rawRest) {
    const segments = splitSegments(rawRest);
    if (!segments) throw notFound();
    const contentType = ASSET_MIME[extname(segments[segments.length - 1]).toLowerCase()];
    if (!contentType) throw notFound();
    const candidate = resolve(clientRoot, ...segments);
    if (!isInside(candidate, clientRoot)) throw notFound();
    let real;
    let rootReal;
    try {
      [real, rootReal] = await Promise.all([realpath(candidate), getClientRootReal()]);
    } catch {
      throw notFound();
    }
    if (!isInside(real, rootReal)) throw notFound();
    return sendFile(response, real, contentType);
  }

  await listen(server, context.listen.host, context.listen.port);
  logger.info('pet.runtime.listening');

  /** @type {Promise<void> | null} */
  let disposing = null;
  const dispose = () => {
    disposing ??= (async () => {
      context.signal.removeEventListener('abort', onAbort);
      server.closeAllConnections();
      await close(server);
      logger.info('pet.runtime.disposed');
    })();
    return disposing;
  };
  const onAbort = () => {
    void dispose();
  };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  return { dispose };
}

/**
 * Splits a raw path remainder into decoded segments. Returns null when any segment is empty, `.`, `..`,
 * contains a backslash, NUL, or `/` after decoding, or fails percent-decoding.
 * @param {string} raw
 * @returns {string[] | null}
 */
function splitSegments(raw) {
  if (raw.length === 0 || raw.includes('\\')) return null;
  /** @type {string[]} */
  const out = [];
  for (const part of raw.split('/')) {
    let decoded;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      return null;
    }
    if (
      decoded.length === 0 ||
      decoded === '.' ||
      decoded === '..' ||
      decoded.includes('/') ||
      decoded.includes('\\') ||
      decoded.includes('\0')
    ) {
      return null;
    }
    out.push(decoded);
  }
  return out;
}

/** @param {string} child @param {string} parent */
function isInside(child, parent) {
  return child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/** @param {string} method @param {string[]} allowed */
function requireMethod(method, allowed) {
  if (!allowed.includes(method)) {
    throw new HttpError(405, 'method_not_allowed', `method ${method} not allowed`, { allow: allowed.join(', ') });
  }
}

function notFound() {
  return new HttpError(404, 'not_found', 'not found');
}

/** @param {unknown} error */
function errnoCode(error) {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown';
}

/** @param {Res} response @param {number} status @param {unknown} payload @param {Record<string, string>} [headers] */
function sendJson(response, status, payload, headers) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  response.end(body);
}

/** @param {Res} response @param {number} status @param {string} code @param {string} message @param {Record<string, string>} [headers] */
function sendError(response, status, code, message, headers) {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  sendJson(response, status, { error: code, message }, headers);
}

/** @param {Res} response @param {string} path @param {string} contentType */
async function sendFile(response, path, contentType) {
  let handle;
  try {
    handle = await open(path, 'r');
  } catch {
    throw notFound();
  }
  try {
    const st = await handle.stat();
    if (!st.isFile()) throw notFound();
    response.writeHead(200, {
      'content-type': contentType,
      'content-length': String(st.size),
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    const stream = handle.createReadStream({ autoClose: false });
    try {
      await pipeline(stream, response);
    } catch {
      response.destroy();
    }
  } finally {
    await handle.close().catch(() => {});
  }
}

/**
 * @param {Req} request
 * @param {number} [limit]
 * @returns {Promise<unknown>}
 */
function readJsonBody(request, limit = BODY_LIMIT) {
  const mediaType = String(request.headers['content-type'] ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (mediaType !== 'application/json') {
    return Promise.reject(new HttpError(415, 'unsupported_media_type', 'content-type must be application/json'));
  }
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) {
    drainOrDestroy(request, 0);
    return Promise.reject(tooLarge(limit));
  }
  return new Promise((resolvePromise, rejectPromise) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    const onData = (/** @type {Buffer} */ chunk) => {
      size += chunk.length;
      if (size > limit) {
        cleanup();
        drainOrDestroy(request, size);
        rejectPromise(tooLarge(limit));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks, size).toString('utf8')));
      } catch {
        rejectPromise(new HttpError(400, 'invalid_json', 'request body is not valid JSON'));
      }
    };
    const onError = () => {
      cleanup();
      rejectPromise(new HttpError(400, 'bad_request', 'request body could not be read'));
    };
    const cleanup = () => {
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
    };
    request.on('data', onData);
    request.on('end', onEnd);
    request.on('error', onError);
  });
}

function tooLarge(limit = BODY_LIMIT) {
  return new HttpError(413, 'payload_too_large', `request body exceeds ${limit} bytes`);
}

/**
 * Stops buffering an oversized body. Remaining bytes are discarded so the 413 response reaches the
 * client; the connection is destroyed if the client keeps sending far past the limit.
 * @param {Req} request
 * @param {number} alreadyRead
 */
function drainOrDestroy(request, alreadyRead) {
  let drained = alreadyRead;
  request.on('data', (/** @type {Buffer} */ chunk) => {
    drained += chunk.length;
    if (drained > DRAIN_LIMIT) request.destroy();
  });
  request.on('error', () => {});
  request.resume();
}

/** @param {import('node:http').Server} server @param {string} host @param {number} port */
function listen(server, host, port) {
  return new Promise((resolvePromise, rejectPromise) => {
    /** @param {Error} error */
    const onError = (error) => rejectPromise(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolvePromise(undefined);
    });
  });
}

/** @param {import('node:http').Server} server */
function close(server) {
  return new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => (error ? rejectPromise(error) : resolvePromise(undefined)));
  });
}
