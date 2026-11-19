import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Store } from './lib/store.mjs';
import { Shelf } from './lib/service.mjs';
import { createMcp } from './lib/mcp.mjs';
import { AppError, readJsonBody } from './lib/util.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'; base-uri 'none'; form-action 'none'";
const MCP_PATH = '/mcp/github-star-shelf';

function compile(pattern) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([a-z]+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  return { re, keys };
}

/** options.envCtx 只给测试用（注入假环境）；宿主只传 context */
export async function start(context, options = {}) {
  const store = new Store(context.dataDir, context.logger);
  await store.load();
  const shelf = new Shelf(context, store, options);
  shelf.init();
  const mcp = createMcp(shelf);
  const clientDir = join(context.pluginRoot, 'miniapp', 'client');
  const staticFiles = new Set((await readdir(clientDir)).filter((f) => /^[A-Za-z0-9_.-]+$/.test(f) && MIME[extname(f)]));

  const routes = [];
  const route = (method, pattern, handler) => routes.push({ method, ...compile(pattern), handler });
  const bool = (v) => v === '1' || v === 'true';

  // ---- 状态与列表 ----
  route('GET', '/api/state', () => shelf.stateView());
  route('GET', '/api/projects', ({ query }) =>
    shelf.list({
      q: query.get('q') || '',
      collection: query.get('collection') || 'all',
      scopes: { name: query.get('name') !== '0', readme: query.get('readme') !== '0', notes: query.get('notes') !== '0' },
      language: query.get('language') || '',
      status: query.get('status') || 'all',
      sort: query.get('sort') || 'starred',
      offset: Number(query.get('offset')) || 0,
      limit: Number(query.get('limit')) || 50,
    }),
  );
  route('GET', '/api/projects/:key', async ({ params }) => {
    await shelf.hub.verifyCache(params.key); // 缓存文件夹没了就别说「已缓存」
    return shelf.detail(params.key);
  });
  route('GET', '/api/projects/:key/readme', ({ params, query }) => shelf.getReadme(params.key, { force: bool(query.get('force')) }));
  route('POST', '/api/projects/add', async ({ body }) => {
    const ids = body.collection ? [shelf.resolveCollection(body.collection)?.id].filter(Boolean) : [];
    const p = await shelf.addProject(String(body.url ?? ''), ids);
    return shelf.card(p);
  });
  route('DELETE', '/api/projects/:key', ({ params }) => shelf.removeProject(params.key));
  route('POST', '/api/projects/:key/collections', ({ params, body }) =>
    shelf.setMembership(params.key, { add: Array.isArray(body.add) ? body.add.map(String) : [], remove: Array.isArray(body.remove) ? body.remove.map(String) : [] }),
  );

  // ---- 备注 ----
  route('POST', '/api/projects/:key/notes', ({ params, body }) => shelf.addNote(params.key, body.text, 'user'));
  route('PATCH', '/api/projects/:key/notes/:id', ({ params, body }) => shelf.updateNote(params.key, params.id, body.text));
  route('DELETE', '/api/projects/:key/notes/:id', ({ params }) => shelf.deleteNote(params.key, params.id));

  // ---- AI ----
  route('POST', '/api/projects/:key/explain', ({ params, body }) => shelf.hub.explain(params.key, body.mode, { force: Boolean(body.force) }));
  route('POST', '/api/projects/:key/message', ({ params, body }) => shelf.hub.sendMessage(params.key, body.text, { whenBusy: body.whenBusy }));
  route('POST', '/api/projects/:key/ai-notes', ({ params }) => shelf.hub.askAiNotes(params.key));
  route('POST', '/api/projects/:key/cancel', ({ params }) => shelf.hub.cancel(params.key));
  route('POST', '/api/projects/:key/session/reset', ({ params }) => shelf.hub.resetSession(params.key));
  route('POST', '/api/projects/:key/permission', ({ params, body }) => shelf.hub.replyPermission(params.key, { requestId: String(body.requestId ?? ''), decision: body.decision }));
  route('DELETE', '/api/projects/:key/cache', async ({ params }) => {
    shelf.project(params.key);
    await shelf.hub.removeProjectCache(params.key);
    return { ok: true };
  });
  route('GET', '/api/manager', () => ({ chat: shelf.state.manager.chat.slice(-30), session: Boolean(shelf.state.manager.session), calls: shelf.hub.callViews('__manager__') }));
  route('POST', '/api/manager/message', ({ body }) => shelf.hub.managerSend(body.text));
  route('POST', '/api/manager/cancel', () => shelf.hub.cancel('__manager__'));
  route('POST', '/api/manager/session/reset', () => shelf.hub.resetSession('__manager__'));
  route('GET', '/api/models', () => shelf.hub.modelsView());

  // ---- 收藏夹 ----
  route('POST', '/api/collections', ({ body }) => shelf.createCollection({ name: body.name, description: body.description }));
  route('PATCH', '/api/collections/:id', ({ params, body }) => shelf.updateCollection(params.id, { name: body.name, description: body.description }));
  route('DELETE', '/api/collections/:id', ({ params }) => shelf.deleteCollection(params.id));

  // ---- 导入、缓存、设置、导出 ----
  route('POST', '/api/import', ({ body }) => shelf.startImport({ user: typeof body.user === 'string' ? body.user : undefined }));
  route('POST', '/api/import/cancel', () => shelf.cancelImport());
  route('POST', '/api/prefetch', () => shelf.startPrefetch());
  route('POST', '/api/prefetch/cancel', () => shelf.cancelPrefetch());
  route('GET', '/api/cache', () => shelf.hub.cacheSummary());
  route('POST', '/api/github/recheck', () => shelf.recheckGithub());
  route('DELETE', '/api/cache', () => shelf.hub.clearAllCache());
  route('POST', '/api/settings', ({ body }) => shelf.updateSettings(body));
  route('GET', '/api/export', ({ query }) => ({ markdown: shelf.exportMarkdown(query.get('collection') || 'all') }));

  // ---- 实时推送 ----
  const sseClients = new Set();
  function openEvents(request, response) {
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    response.write('retry: 3000\n\n');
    const send = (evt) => {
      let out = evt;
      if (evt.type === 'import') out = { ...evt, view: shelf.importView() };
      else if (evt.type === 'prefetch') out = { ...evt, view: shelf.prefetchView() };
      response.write('data: ' + JSON.stringify(out) + '\n\n');
    };
    const unsubscribe = shelf.subscribe(send);
    const beat = setInterval(() => response.write(': ping\n\n'), 25000);
    sseClients.add(response);
    request.on('close', () => {
      clearInterval(beat);
      unsubscribe();
      sseClients.delete(response);
    });
    send({ type: 'hello', rev: store.rev });
  }

  async function serveStatic(response, name) {
    if (!staticFiles.has(name)) return false;
    const data = await readFile(join(clientDir, name));
    const headers = { 'content-type': MIME[extname(name)], 'cache-control': 'no-cache' };
    if (name.endsWith('.html')) headers['content-security-policy'] = CSP;
    response.writeHead(200, headers);
    response.end(data);
    return true;
  }

  const sendJson = (response, status, value) => {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(JSON.stringify(value));
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://miniapp.local');
    const path = url.pathname;
    try {
      if (path === MCP_PATH) {
        const body = request.method === 'POST' ? await readJsonBody(request, 1048576) : {};
        return await mcp(request, response, body);
      }
      if (request.method === 'GET' && (path === '/dashboard' || path === '/')) {
        await serveStatic(response, 'index.html');
        return;
      }
      if (request.method === 'GET' && path === '/api/events') return openEvents(request, response);
      if (path.startsWith('/api/')) {
        for (const r of routes) {
          if (r.method !== request.method) continue;
          const m = r.re.exec(path);
          if (!m) continue;
          const params = {};
          r.keys.forEach((k, i) => {
            try {
              params[k] = decodeURIComponent(m[i + 1]);
            } catch {
              params[k] = '';
            }
          });
          const body = request.method === 'GET' || request.method === 'DELETE' ? {} : await readJsonBody(request);
          const result = await r.handler({ params, query: url.searchParams, body });
          return sendJson(response, 200, result ?? { ok: true });
        }
        return sendJson(response, 404, { error: { code: 'not_found', message: '没有这个接口' } });
      }
      if (request.method === 'GET' && (await serveStatic(response, path.slice(1)))) return;
      sendJson(response, 404, { error: { code: 'not_found', message: '没有这个页面' } });
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      if (error instanceof AppError) return sendJson(response, error.status || 400, { error: { code: error.code, message: error.message } });
      context.logger.error('shelf.http.error', { path: path.slice(0, 60), code: error?.code });
      sendJson(response, 500, { error: { code: 'internal', message: '出错了，请稍后再试' } });
    }
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(context.listen.port, context.listen.host, () => {
      server.off('error', onError);
      resolve();
    });
  });
  context.logger.info('shelf.runtime.listening');

  let disposal;
  const dispose = () => {
    if (disposal) return disposal;
    context.signal.removeEventListener('abort', onAbort);
    disposal = (async () => {
      for (const res of sseClients) res.end();
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(() => resolve()));
      await shelf.dispose();
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
