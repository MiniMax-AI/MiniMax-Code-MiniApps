// @ts-check
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { createExamples } from './examples.mjs';
import { createMcpEndpoint } from './mcp.mjs';
import { createRunManager, selectionFrom } from './runs.mjs';
import { GalleryError, cleanText, createStore } from './store.mjs';

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */
/** @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle */
/** @typedef {import('node:http').IncomingMessage} IncomingMessage */
/** @typedef {import('node:http').ServerResponse} ServerResponse */

const MAX_JSON_BODY = 64 * 1024;
const MAX_MCP_BODY = 256 * 1024;
const STATUS_BY_CODE = { invalid: 400, not_found: 404, busy: 409, agent_unavailable: 503, too_large: 413 };

/**
 * @param {MiniAppContext} context
 * @returns {Promise<MiniAppLifecycle>}
 */
export async function start(context) {
  const clientDir = join(context.pluginRoot, 'miniapp/client');
  const [indexHtml, appJs, appCss] = await Promise.all([
    readFile(join(clientDir, 'index.html')),
    readFile(join(clientDir, 'app.js')),
    readFile(join(clientDir, 'app.css')),
  ]);

  const store = createStore(context.dataDir);
  await store.load();
  const examples = createExamples(context.pluginRoot);

  /** @type {Set<ServerResponse>} */
  const subscribers = new Set();
  /** @param {object} event */
  const publish = (event) => {
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    for (const response of subscribers) {
      try {
        response.write(frame);
      } catch {
        subscribers.delete(response);
      }
    }
  };
  const heartbeat = setInterval(() => {
    for (const response of subscribers) {
      try {
        response.write(': keep-alive\n\n');
      } catch {
        subscribers.delete(response);
      }
    }
  }, 25_000);

  const runs = createRunManager({ agent: context.agent, store, publish, logger: context.logger, logDir: join(context.dataDir, 'runs'), pluginRoot: context.pluginRoot });

  const mcp = createMcpEndpoint({
    name: 'anatomy-gallery',
    version: '1.1.1',
    instructions:
      'Anatomy gallery: after building an anatomy figure, register each viewable version with register_figure_version. ' +
      'Use list_figures to find the figureId of an existing figure before registering a new version of it.',
    tools: [
      {
        name: 'register_figure_version',
        description:
          'Register a built anatomy figure page as a new version in the Anatomy gallery. Pass figureId to add a version ' +
          'to an existing figure; omit it to create a new gallery entry. Paths must be absolute. The page must be a ' +
          'standalone HTML page built by the anatomy kit. Returns the figureId and version number.',
        inputSchema: {
          type: 'object',
          properties: {
            figureId: { type: 'string', description: 'Existing gallery figure id, for example fig-1a2b3c4d.' },
            page: { type: 'string', description: 'Absolute path of the built dark (default) HTML page.' },
            lightPage: {
              type: 'string',
              description: 'Absolute path of the --light HTML page. Optional; a sibling <name>-light.html is detected automatically.',
            },
            preview: { type: 'string', description: 'Absolute path of a desktop screenshot of the dark page (PNG, WebP or JPEG).' },
            lightPreview: { type: 'string', description: 'Absolute path of a desktop screenshot of the light page (PNG, WebP or JPEG).' },
            note: { type: 'string', description: 'One short sentence, in the user language, describing this version.' },
            title: { type: 'string', description: 'Short figure title in the user language. Used when creating a figure or renaming it.' },
            prompt: { type: 'string', description: 'The original request, stored when creating a new figure.' },
            category: {
              type: 'string',
              description: 'Name of an existing gallery room to hang a new figure in. Unknown names use the default room. Ignored for an existing figure.',
            },
          },
          required: ['page'],
          additionalProperties: false,
        },
        handler: async (args) => {
          const { figure, version } = await store.addVersion({
            figureId: typeof args.figureId === 'string' && args.figureId ? args.figureId : undefined,
            page: String(args.page ?? ''),
            lightPage: typeof args.lightPage === 'string' && args.lightPage ? args.lightPage : undefined,
            preview: typeof args.preview === 'string' && args.preview ? args.preview : undefined,
            lightPreview: typeof args.lightPreview === 'string' && args.lightPreview ? args.lightPreview : undefined,
            note: typeof args.note === 'string' ? args.note : '',
            title: typeof args.title === 'string' ? args.title : '',
            prompt: typeof args.prompt === 'string' ? args.prompt : '',
            origin: 'agent',
            model: typeof args.figureId === 'string' ? runs.liveModel(args.figureId) : null,
            runId: typeof args.figureId === 'string' ? runs.liveRunId(args.figureId) : null,
            categoryId: store.categoryIdByName(args.category),
          });
          publish({ type: 'changed', figureId: figure.id });
          return JSON.stringify({
            figureId: figure.id,
            title: figure.title,
            version: version.n,
            hasLight: version.hasLight,
            hasPreview: !!version.previewExt,
            hasLightPreview: !!version.lightPreviewExt,
          });
        },
      },
      {
        name: 'list_figures',
        description: 'List figures in the Anatomy gallery with their id, title, room (category), latest version and source folder.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: async () => {
          const rooms = new Map(store.listCategories().map((item) => [item.id, item.name]));
          return JSON.stringify(
            store.list().map((item) => ({
              figureId: item.id,
              title: item.title,
              category: rooms.get(item.categoryId) ?? '默认',
              versions: item.versionCount,
              latestNote: item.latest?.note ?? '',
              sourceDir: store.find(item.id).sourceDir,
            })),
          );
        },
      },
    ],
  });

  /** @param {IncomingMessage} request @param {ServerResponse} response */
  async function route(request, response) {
    const url = new URL(request.url ?? '/', 'http://miniapp.local');
    const path = url.pathname;
    const method = request.method ?? 'GET';

    if (path === '/mcp/anatomy-gallery') {
      const body = method === 'POST' ? await readBody(request, MAX_MCP_BODY) : '';
      await mcp.handle(request, response, body);
      return;
    }
    if (method === 'GET' && (path === '/' || path === '/gallery')) {
      if (path === '/') return redirect(response, '/gallery');
      return send(response, 200, 'text/html; charset=utf-8', indexHtml, 'no-store');
    }
    if (method === 'GET' && path === '/assets/app.js') {
      return send(response, 200, 'text/javascript; charset=utf-8', appJs, 'no-store');
    }
    if (method === 'GET' && path === '/assets/app.css') {
      return send(response, 200, 'text/css; charset=utf-8', appCss, 'no-store');
    }

    if (method === 'GET' && path === '/api/events') {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      response.write(': connected\n\n');
      subscribers.add(response);
      request.on('close', () => subscribers.delete(response));
      return;
    }
    if (method === 'GET' && path === '/api/models') {
      if (!context.agent) throw new GalleryError('agent_unavailable', '这个画廊没有获得运行 Agent 的授权');
      return json(response, 200, await context.agent.models());
    }
    if (method === 'GET' && path === '/api/state') {
      return json(response, 200, {
        agentAvailable: !!context.agent,
        figures: store.list(),
        categories: store.listCategories(),
        examples: await examples.list(),
      });
    }

    const exampleMatch = /^\/api\/examples\/([a-z0-9-]+)\/(dark|light|preview)$/.exec(path);
    if (method === 'GET' && exampleMatch) {
      const example = await examples.get(exampleMatch[1]);
      const kind = exampleMatch[2];
      const file = example && (kind === 'dark' ? example.dark : kind === 'light' ? example.light : example.preview);
      if (!file) throw new GalleryError('not_found', '找不到这个示例文件');
      return sendFile(response, file, kind === 'preview' ? 'image/webp' : 'text/html; charset=utf-8', 'no-cache');
    }

    if (method === 'POST' && path === '/api/figures') {
      const body = await readJson(request);
      const prompt = cleanText(body.prompt, 4000);
      if (!prompt) throw new GalleryError('invalid', '请描述想讲清楚的内容');
      if (!context.agent) throw new GalleryError('agent_unavailable', '这个画廊没有获得运行 Agent 的授权');
      const example = typeof body.example === 'string' && body.example ? await examples.get(body.example) : null;
      const figure = await store.createFigure({
        title: cleanText(body.title, 80) || prompt.split('\n')[0].slice(0, 40),
        prompt,
        size: body.size === 'hero' ? 'hero' : 'figure',
        source: 'gallery',
        categoryId: body.categoryId,
      });
      publish({ type: 'changed', figureId: figure.id });
      await runs.start(figure.id, { kind: 'create', example: example?.name ?? null, model: selectionFrom(body.model) });
      return json(response, 201, { figureId: figure.id });
    }
    if (method === 'POST' && path === '/api/import') {
      const body = await readJson(request);
      const page = cleanText(body.page, 2000);
      if (!page) throw new GalleryError('invalid', '请填写页面的绝对路径');
      const { figure } = await store.addVersion({ page, origin: 'import', note: '导入', categoryId: body.categoryId });
      publish({ type: 'changed', figureId: figure.id });
      return json(response, 201, { figureId: figure.id });
    }

    if (path === '/api/categories' && method === 'POST') {
      const body = await readJson(request);
      const category = await store.createCategory(body.name);
      publish({ type: 'categories' });
      return json(response, 201, { category });
    }
    if (path === '/api/categories/order' && method === 'POST') {
      const body = await readJson(request);
      await store.reorderCategories(body.ids);
      publish({ type: 'categories' });
      return json(response, 200, { ok: true });
    }
    const categoryMatch = /^\/api\/categories\/(default|cat-[a-f0-9]{6})$/.exec(path);
    if (categoryMatch && method === 'PATCH') {
      const body = await readJson(request);
      const category = await store.renameCategory(categoryMatch[1], body.name);
      publish({ type: 'categories' });
      return json(response, 200, { category });
    }
    if (categoryMatch && method === 'DELETE') {
      const result = await store.deleteCategory(categoryMatch[1]);
      publish({ type: 'categories' });
      return json(response, 200, result);
    }

    const figureMatch = /^\/api\/figures\/(fig-[a-f0-9]{8})(?:\/(.+))?$/.exec(path);
    if (figureMatch) {
      const [, id, rest = ''] = figureMatch;
      if (method === 'GET' && rest === '') {
        const figure = store.find(id);
        return json(response, 200, { figure: publicFigure(figure), live: runs.live(id), agentAvailable: !!context.agent });
      }
      if (method === 'DELETE' && rest === '') {
        if (runs.isActive(id)) throw new GalleryError('busy', '这张图解还有运行在进行，先取消再删除');
        const runIds = store.find(id).runs.map((/** @type {any} */ run) => run.id);
        await store.remove(id);
        await runs.removeLogs(runIds);
        publish({ type: 'removed', figureId: id });
        return json(response, 200, { ok: true });
      }
      const fileMatch = /^versions\/(\d{1,4})\/(dark|light|preview|preview-light)$/.exec(rest);
      if (method === 'GET' && fileMatch) {
        const file = store.versionFile(id, Number(fileMatch[1]), /** @type {any} */ (fileMatch[2]));
        return sendFile(response, file.path, file.type ?? 'application/octet-stream', 'private, max-age=31536000, immutable');
      }
      if (method === 'POST' && rest === 'runs') {
        const body = await readJson(request);
        const kind = body.kind === 'create' ? 'create' : 'edit';
        await runs.start(id, { kind, instruction: body.instruction, model: selectionFrom(body.model) });
        return json(response, 202, { ok: true });
      }
      const logMatch = /^runs\/([0-9a-f-]{36})\/log$/.exec(rest);
      if (method === 'GET' && logMatch) {
        const figure = store.find(id);
        if (!figure.runs.some((/** @type {any} */ run) => run.id === logMatch[1])) throw new GalleryError('not_found', '找不到这次运行');
        const entries = await runs.readLog(logMatch[1]);
        return json(response, 200, { entries: entries ?? [], recorded: entries !== null });
      }
      if (method === 'POST' && rest === 'category') {
        const body = await readJson(request);
        await store.moveFigure(id, body.categoryId);
        publish({ type: 'changed', figureId: id });
        return json(response, 200, { ok: true });
      }
      if (method === 'POST' && rest === 'cancel') {
        runs.cancel(id);
        return json(response, 202, { ok: true });
      }
      const permissionMatch = /^permissions\/([A-Za-z0-9_.:-]{1,200})$/.exec(rest);
      if (method === 'POST' && permissionMatch) {
        const body = await readJson(request);
        const decision = body.decision === 'allowOnce' ? 'allowOnce' : 'deny';
        await runs.reply(id, permissionMatch[1], decision);
        return json(response, 200, { ok: true });
      }
    }

    throw new GalleryError('not_found', '没有这个页面');
  }

  /** @param {any} figure */
  function publicFigure(figure) {
    return {
      id: figure.id,
      title: figure.title,
      prompt: figure.prompt,
      size: figure.size,
      source: figure.source,
      createdAt: figure.createdAt,
      updatedAt: figure.updatedAt,
      sessionId: figure.sessionId,
      sourceDir: figure.sourceDir,
      categoryId: store.categoryOf(figure),
      versions: figure.versions.map((version) => ({
        n: version.n,
        createdAt: version.createdAt,
        note: version.note,
        origin: version.origin,
        hasLight: version.hasLight,
        hasPreview: !!version.previewExt,
        hasLightPreview: !!version.lightPreviewExt,
        model: version.model ?? null,
        runId: version.runId ?? null,
      })),
      runs: figure.runs.slice(-10).reverse(),
    };
  }

  const server = createServer((request, response) => {
    route(request, response).catch((error) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof GalleryError) {
        json(response, STATUS_BY_CODE[/** @type {keyof typeof STATUS_BY_CODE} */ (error.code)] ?? 400, {
          error: error.code,
          message: error.message,
        });
        return;
      }
      context.logger.error('anatomy_gallery.request_failed', { code: String(error?.code ?? 'unknown') });
      json(response, 500, { error: 'internal', message: '画廊服务出错，请重试' });
    });
  });

  await listen(server, context.listen.host, context.listen.port);
  context.logger.info('anatomy_gallery.listening');

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    context.signal.removeEventListener('abort', onAbort);
    clearInterval(heartbeat);
    runs.dispose();
    for (const response of subscribers) response.end();
    subscribers.clear();
    server.closeAllConnections?.();
    await close(server);
  };
  const onAbort = () => {
    void dispose();
  };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  return { dispose };
}

/** @param {IncomingMessage} request @param {number} limit */
function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    /** @type {Buffer[]} */
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new GalleryError('too_large', '请求内容过大'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

/** @param {IncomingMessage} request */
async function readJson(request) {
  const raw = await readBody(request, MAX_JSON_BODY);
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    throw new GalleryError('invalid', '请求格式不对');
  }
}

/** @param {ServerResponse} response @param {number} status @param {unknown} value */
function json(response, status, value) {
  send(response, status, 'application/json; charset=utf-8', JSON.stringify(value), 'no-store');
}

/** @param {ServerResponse} response @param {string} location */
function redirect(response, location) {
  response.writeHead(302, { location });
  response.end();
}

/**
 * @param {ServerResponse} response @param {number} status @param {string} type
 * @param {string | Buffer} body @param {string} cache
 */
function send(response, status, type, body, cache) {
  response.writeHead(status, {
    'content-type': type,
    'cache-control': cache,
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

/** @param {ServerResponse} response @param {string} path @param {string} type @param {string} cache */
function sendFile(response, path, type, cache) {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(path);
    stream.once('open', () => {
      response.writeHead(200, { 'content-type': type, 'cache-control': cache, 'x-content-type-options': 'nosniff' });
      stream.pipe(response);
    });
    stream.once('error', (error) => {
      if (response.headersSent) {
        response.destroy();
        resolve(undefined);
      } else {
        reject(/** @type {any} */ (error).code === 'ENOENT' ? new GalleryError('not_found', '文件不存在') : error);
      }
    });
    stream.once('end', () => resolve(undefined));
  });
}

/** @param {import('node:http').Server} server @param {string} host @param {number} port */
function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    /** @param {Error} error */
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve(undefined);
    });
  });
}

/** @param {import('node:http').Server} server */
function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve(undefined)));
  });
}
