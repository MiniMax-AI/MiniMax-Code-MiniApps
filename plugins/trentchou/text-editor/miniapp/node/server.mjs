// @ts-check
// Node entry of the text editor Mini App: static Client, JSON API, SSE events and the MCP endpoint.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { EditorError, EditorService, FOLLOW_WINDOW_MS, mapFsError, MAX_FILE_BYTES } from './editor-service.mjs';
import { createMcpHandler } from './mcp.mjs';

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */
/** @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle */

const VERSION = '1.3.1';
const SURFACE_PATH = '/editor';
const MCP_PATH = '/mcp/editor';
const SMALL_BODY = 1024 * 1024;
const LARGE_BODY = MAX_FILE_BYTES * 2 + SMALL_BODY;
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

/**
 * @param {MiniAppContext} context
 * @returns {Promise<MiniAppLifecycle>}
 */
export async function start(context) {
  const clientDir = join(context.pluginRoot, 'miniapp/client');
  const service = new EditorService({ dataDir: context.dataDir, pluginId: context.pluginId, logger: context.logger, signal: context.signal });
  await service.init();
  const handleMcp = createMcpHandler(service, 'text-editor', { version: VERSION });

  /** @type {Set<import('node:http').ServerResponse>} */
  const pages = new Set();
  const unsubscribe = service.subscribe((event) => {
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    for (const page of pages) page.write(frame);
  });
  const allowedHosts = new Set([`127.0.0.1:${context.listen.port}`, `localhost:${context.listen.port}`]);

  /** @param {import('node:http').IncomingMessage} req */
  function crossSite(req) {
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') return true;
    const host = req.headers.host;
    return !!host && !allowedHosts.has(host);
  }

  /** Browsers always send Origin; reject MCP calls coming from any other web page. @param {string|undefined} origin */
  function foreignOrigin(origin) {
    if (!origin) return false;
    try {
      return !allowedHosts.has(new URL(origin).host);
    } catch {
      return true;
    }
  }


  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
  async function route(req, res) {
    const url = new URL(req.url ?? '/', 'http://editor.local');
    const { pathname } = url;
    const method = req.method ?? 'GET';

    if (method === 'GET' && (pathname === '/' || pathname === SURFACE_PATH)) {
      if (pathname === '/') {
        res.writeHead(302, { location: `${SURFACE_PATH}${url.search}` });
        res.end();
        return;
      }
      service.pageOpenedAt = Date.now();
      await service.followWorkspace().catch(() => undefined);
      return sendFile(res, join(clientDir, 'index.html'));
    }
    if (method === 'GET' && pathname.startsWith('/static/')) {
      let rel;
      try {
        rel = normalize(decodeURIComponent(pathname.slice('/static/'.length)));
      } catch {
        throw new EditorError('NOT_FOUND', '资源不存在', 404);
      }
      const file = join(clientDir, rel);
      if (rel.startsWith('..') || !file.startsWith(clientDir + sep)) throw new EditorError('NOT_FOUND', '资源不存在', 404);
      return sendFile(res, file);
    }

    if (pathname === MCP_PATH) {
      if (crossSite(req) || foreignOrigin(req.headers.origin)) throw new EditorError('FORBIDDEN', 'Forbidden', 403);
      if (method !== 'POST') {
        res.writeHead(405, { allow: 'POST' });
        res.end();
        return;
      }
      const result = await handleMcp(await readJson(req, LARGE_BODY));
      if (result.status === 202) {
        res.writeHead(202);
        res.end();
        return;
      }
      return sendJson(res, result.status, result.payload);
    }

    if (!pathname.startsWith('/api/')) throw new EditorError('NOT_FOUND', '页面不存在', 404);
    if (crossSite(req)) throw new EditorError('FORBIDDEN', '拒绝跨站请求', 403);

    if (method === 'GET') {
      switch (pathname) {
        case '/api/events':
          return openEvents(req, res);
        case '/api/state':
          return sendJson(res, 200, service.snapshot());
        case '/api/list':
          return sendJson(res, 200, await service.listDir(url.searchParams.get('path')));
        case '/api/quick-open':
          return sendJson(res, 200, await service.fileIndex(url.searchParams.get('folder')));
        case '/api/doc/pull':
          return sendJson(res, 200, service.pullUpdates(url.searchParams.get('path'), Number(url.searchParams.get('version'))));
        case '/api/highlights':
          return sendJson(res, 200, service.highlightsPayload(url.searchParams.get('path')));
        default:
          throw new EditorError('NOT_FOUND', '接口不存在', 404);
      }
    }
    if (method !== 'POST') throw new EditorError('METHOD', '不支持的请求方法', 405);
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
      throw new EditorError('UNSUPPORTED', '请求必须是 JSON', 415);
    }
    const large = pathname === '/api/doc/push' || pathname === '/api/fs/create';
    const body = await readJson(req, large ? LARGE_BODY : SMALL_BODY);
    switch (pathname) {
      case '/api/folders/add':
        return sendJson(res, 200, await service.addFolder(body.path, { top: body.top === true }));
      case '/api/folders/remove':
        await service.removeFolder(body.path);
        return sendJson(res, 200, { ok: true });
      case '/api/doc/open': {
        const doc = await service.openDoc(body.path, { tab: body.tab !== false, focus: body.focus === true });
        return sendJson(res, 200, service.docPayload(doc));
      }
      case '/api/doc/push':
        return sendJson(res, 200, service.pushUpdates(body.path, body.version, body.updates));
      case '/api/doc/save':
        return sendJson(res, 200, await service.saveDoc(body.path, { overwrite: body.overwrite === true }));
      case '/api/doc/revert':
        await service.revertDoc(body.path);
        return sendJson(res, 200, { ok: true });
      case '/api/tabs/activate':
        await service.activateTab(body.path);
        return sendJson(res, 200, { ok: true });
      case '/api/tabs/close':
        await service.closeTab(body.path, { discard: body.discard === true });
        return sendJson(res, 200, { ok: true });
      case '/api/fs/create':
        return sendJson(res, 200, await service.createEntry({
          dir: body.dir, name: body.name, kind: body.kind, content: body.content ?? '',
          unique: body.unique === true, open: body.open !== false, focus: body.focus !== false,
        }));
      case '/api/settings':
        return sendJson(res, 200, await service.updateSettings(body.patch));
      case '/api/highlights/remove':
        return sendJson(res, 200, { removed: service.clearHighlights(body) });
      case '/api/view':
        service.setView(body);
        return sendJson(res, 200, { ok: true });
      default:
        throw new EditorError('NOT_FOUND', '接口不存在', 404);
    }
  }

  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
  function openEvents(req, res) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });
    res.write('retry: 2000\n\n');
    res.write(`data: ${JSON.stringify({ type: 'hello' })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'state', state: service.snapshot() })}\n\n`);
    pages.add(res);
    service.pageCount = pages.size;
    req.on('close', () => {
      pages.delete(res);
      service.pageCount = pages.size;
    });
  }

  const server = createServer((req, res) => {
    route(req, res).catch((raw) => {
      const error = mapFsError(raw);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof EditorError) {
        sendJson(res, error.status, { error: { code: error.code, message: error.message, ...(error.extra ? { extra: error.extra } : {}) } });
        return;
      }
      context.logger.error('editor.request.failed', { code: String(error?.code ?? error?.name ?? 'unknown') });
      sendJson(res, 500, { error: { code: 'INTERNAL', message: '编辑器服务内部错误' } });
    });
  });

  await new Promise((resolve, reject) => {
    const onError = (/** @type {Error} */ error) => reject(error);
    server.once('error', onError);
    server.listen(context.listen.port, context.listen.host, () => {
      server.off('error', onError);
      resolve(undefined);
    });
  });

  const pollTimer = setInterval(() => {
    service.pollDisk().catch((error) => context.logger.warn('editor.poll.failed', { code: String(error?.code ?? 'unknown') }));
    if (Date.now() - service.pageOpenedAt < FOLLOW_WINDOW_MS) service.followWorkspace().catch(() => undefined);
  }, 1500);
  const keepAlive = setInterval(() => {
    for (const page of pages) page.write(': keep-alive\n\n');
  }, 20_000);
  context.logger.info('editor.runtime.listening');

  /** @type {Promise<void>|undefined} */
  let disposal;
  const dispose = () => {
    if (disposal) return disposal;
    context.signal.removeEventListener('abort', onAbort);
    disposal = (async () => {
      clearInterval(pollTimer);
      clearInterval(keepAlive);
      unsubscribe();
      for (const page of pages) page.end();
      pages.clear();
      await service.flushAll().catch(() => undefined);
      await new Promise((resolve) => {
        server.close(() => resolve(undefined));
        server.closeAllConnections();
      });
    })();
    return disposal;
  };
  const onAbort = () => {
    void dispose().catch(() => undefined);
  };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  return { dispose };
}

/** @param {import('node:http').ServerResponse} res @param {number} status @param {unknown} payload */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

/** @param {import('node:http').ServerResponse} res @param {string} file */
async function sendFile(res, file) {
  const data = await readFile(file).catch(() => {
    throw new EditorError('NOT_FOUND', '资源不存在', 404);
  });
  const type = CONTENT_TYPES[/** @type {keyof typeof CONTENT_TYPES} */ (extname(file))] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
  res.end(data);
}

/** @param {import('node:http').IncomingMessage} req @param {number} limit @returns {Promise<any>} */
function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    /** @type {Buffer[]} */
    const chunks = [];
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        reject(new EditorError('TOO_LARGE', '请求内容过大', 413));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new EditorError('BAD_JSON', '请求格式错误', 400));
      }
    });
    req.on('error', (error) => {
      if (!failed) reject(error);
    });
  });
}
