// @ts-check
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { createDomain, DomainError } from './domain.mjs';

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */
/** @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle */

const MAX_BODY = 16 * 1024;

const STATIC = {
  '/dashboard': ['index.html', 'text/html; charset=utf-8'],
  '/assets/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/assets/app.js': ['app.js', 'text/javascript; charset=utf-8'],
};

/**
 * @param {MiniAppContext} context
 * @returns {Promise<MiniAppLifecycle>}
 */
export async function start(context) {
  const clientDir = join(context.pluginRoot, 'miniapp/client');
  /** @type {Map<string, Buffer>} */
  const files = new Map();
  for (const [, [name]] of Object.entries(STATIC)) {
    files.set(name, await readFile(join(clientDir, name)));
  }

  /** @type {Set<import('node:http').ServerResponse>} */
  const sseClients = new Set();
  const domain = await createDomain({
    dataDir: context.dataDir,
    onChange: (version) => {
      const payload = `event: changed\ndata: ${JSON.stringify({ version })}\n\n`;
      for (const res of sseClients) res.write(payload);
    },
  });

  const heartbeat = setInterval(() => {
    for (const res of sseClients) res.write(': ping\n\n');
  }, 25000);

  const server = createServer((request, response) => {
    handle(request, response).catch((error) => {
      if (error instanceof DomainError) {
        sendJson(response, error.status, { error: error.code, message: error.message });
        return;
      }
      context.logger.error('xinyu.request.failed', { name: /** @type {any} */ (error)?.name });
      sendJson(response, 500, { error: 'internal', message: '出了点小问题，请稍后再试' });
    });
  });

  /**
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:http').ServerResponse} response
   */
  async function handle(request, response) {
    const url = new URL(request.url ?? '/', 'http://miniapp.local');
    const path = url.pathname;
    const method = request.method ?? 'GET';

    if (method === 'GET' && path in STATIC) {
      const [name, type] = STATIC[/** @type {keyof typeof STATIC} */ (path)];
      response.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
      response.end(files.get(name));
      return;
    }

    if (method === 'GET' && path === '/api/events') {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      response.write(`event: hello\ndata: ${JSON.stringify({ version: domain.snapshot().version })}\n\n`);
      sseClients.add(response);
      request.on('close', () => sseClients.delete(response));
      return;
    }

    if (method === 'GET' && path === '/api/state') {
      return sendJson(response, 200, domain.snapshot());
    }

    const routes = {
      'PUT /api/profile': async () => domain.updateProfile(await readJson(request)),
      'POST /api/checkin': async () => domain.checkin(await readJson(request)),
      'POST /api/card/draw': async () => domain.drawCard(await readJson(request)),
      'PUT /api/about': async () => domain.setAbout(await readJson(request)),
      'POST /api/secrets': async () => domain.discover(await readJson(request)),
      'POST /api/flags': async () => domain.setFlag(await readJson(request)),
      'POST /api/joys': async () => domain.addJoy(await readJson(request)),
      'POST /api/answers': async () => domain.ask(await readJson(request)),
      'DELETE /api/answers': async () => domain.clearAnswers(),
      'POST /api/quiz': async () => domain.submitQuiz(await readJson(request)),
      'POST /api/reset': async () => domain.resetAll(),
    };
    const key = `${method} ${path}`;
    if (key in routes) {
      const result = await routes[/** @type {keyof typeof routes} */ (key)]();
      return sendJson(response, 200, { ok: true, result: result ?? null, state: domain.snapshot() });
    }

    let m;
    if (method === 'DELETE' && (m = /^\/api\/checkin\/(\d{4}-\d{2}-\d{2})$/.exec(path))) {
      await domain.removeCheckin(m[1]);
      return sendJson(response, 200, { ok: true, state: domain.snapshot() });
    }
    if (method === 'POST' && (m = /^\/api\/card\/(\d{4}-\d{2}-\d{2})\/favorite$/.exec(path))) {
      const result = await domain.toggleFavorite(m[1]);
      return sendJson(response, 200, { ok: true, result, state: domain.snapshot() });
    }
    if (method === 'DELETE' && (m = /^\/api\/joys\/([0-9a-f-]{36})$/.exec(path))) {
      await domain.removeJoy(m[1]);
      return sendJson(response, 200, { ok: true, state: domain.snapshot() });
    }

    sendJson(response, 404, { error: 'not_found', message: '页面不存在' });
  }

  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(context.listen.port, context.listen.host, () => {
      server.off('error', onError);
      resolve(undefined);
    });
  });
  context.logger.info('xinyu.runtime.listening');

  /** @type {Promise<void> | undefined} */
  let disposal;
  const dispose = () => {
    if (disposal) return disposal;
    context.signal.removeEventListener('abort', onAbort);
    clearInterval(heartbeat);
    for (const res of sseClients) res.end();
    sseClients.clear();
    disposal = (async () => {
      await domain.flush();
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve(undefined)));
        server.closeAllConnections?.();
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

/** @param {import('node:http').ServerResponse} res */
function sendJson(res, status, body) {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** @param {import('node:http').IncomingMessage} req */
async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new DomainError(413, 'too_large', '内容太长了');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new DomainError(400, 'invalid_json', '请求格式不正确');
  }
}
