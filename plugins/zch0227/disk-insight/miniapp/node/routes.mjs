// @ts-check
// 路由：只提供契约里的接口和页面白名单，其他一律 404。
import { readJSON, sendError, sendJSON, serveStatic } from './http.mjs';
import { HttpError } from './util.mjs';

/**
 * @param {ReturnType<typeof import('./app.mjs').createApp>} app
 * @param {{ fs: any, pluginRoot: string, logger: import('./miniapp-api.js').MiniAppLogger, now?: () => number }} o
 */
export function createRouter(app, o) {
  const now = o.now || (() => Date.now());

  /** @type {Record<string, (req: import('node:http').IncomingMessage, url: URL, res: import('node:http').ServerResponse) => Promise<any>>} */
  const routes = {
    'GET /api/state': async () => {
      await app.ensureLoaded();
      await Promise.all([app.refreshDisks(), app.refreshFda(), app.refreshPlaces()]);
      return app.stateJSON();
    },
    'GET /api/events': async (req, _url, res) => {
      await app.ensureLoaded();
      await Promise.all([app.refreshDisks(), app.refreshFda(), app.refreshPlaces()]);
      app.hub.add(req, res, [['state', app.stateJSON()]]);
      return undefined;
    },
    'POST /api/scan': async (req) => {
      await app.startScan(await readJSON(req));
      return [202, { ok: true }];
    },
    'POST /api/scan/cancel': async (req) => {
      await readJSON(req);
      return app.cancelScan();
    },
    'POST /api/rescan': async (req) => {
      await app.startRescan(await readJSON(req));
      return [202, { ok: true }];
    },
    'GET /api/junk': async (_req, url) => {
      await app.ensureLoaded();
      return app.views.junkJSON(url.searchParams);
    },
    'GET /api/large': async (_req, url) => {
      await app.ensureLoaded();
      return app.views.largeJSON(url.searchParams, now());
    },
    'GET /api/duplicates': async () => {
      await app.ensureLoaded();
      return app.views.duplicatesJSON();
    },
    'POST /api/duplicates/keep-newest': async (req) => {
      await readJSON(req);
      return app.keepNewest();
    },
    'GET /api/tree': async (_req, url) => {
      await app.ensureLoaded();
      const q = url.searchParams;
      return app.views.treeJSON(q.get('id'), q.get('rootId'), q.get('diskId'), q.get('depth'));
    },
    'GET /api/types': async (_req, url) => {
      await app.ensureLoaded();
      return app.views.typesJSON(url.searchParams.get('diskId'), url.searchParams.get('rootId'));
    },
    'GET /api/denied': async () => {
      await app.ensureLoaded();
      return app.views.deniedJSON();
    },
    'GET /api/item': async (_req, url) => {
      await app.ensureLoaded();
      const e = app.views.resolve(url.searchParams.get('id'));
      if (!e) throw new HttpError(404, 'not_found', '找不到这个条目，请重新扫描');
      return app.views.itemDetail(e);
    },
    'GET /api/ask-context': async (_req, url) => app.askContext(url.searchParams.get('id')),
    'GET /api/selection': async () => {
      await app.ensureLoaded();
      return app.getSelection();
    },
    'POST /api/selection': async (req) => app.updateSelection(await readJSON(req)),
    'POST /api/clean': async (req) => [202, await app.startClean(await readJSON(req))],
    'GET /api/clean': async (_req, url) => {
      await app.ensureLoaded();
      return app.getClean(url.searchParams.get('jobId'));
    },
    'GET /api/history': async () => {
      await app.ensureLoaded();
      return app.history();
    },
    'POST /api/reveal': async (req) => app.reveal(await readJSON(req)),
    'POST /api/system-action': async (req) => app.systemAction(await readJSON(req)),
    'POST /api/validate-path': async (req) => app.validatePath(await readJSON(req)),
    'POST /api/pick-folder': async (req) => {
      await readJSON(req);
      return app.pickFolder();
    },
    'POST /api/ignore': async (req) => app.addIgnore(await readJSON(req)),
    'GET /api/ignore': async () => app.listIgnore(),
    'POST /api/ignore/remove': async (req) => app.removeIgnore(await readJSON(req)),
    'POST /api/preview': async (req) => app.preview(await readJSON(req)),
    'GET /api/repos': async (_req, url) => app.reposJSON(url.searchParams),
    'GET /api/repos/worktrees': async (_req, url) => app.worktreesJSON(url.searchParams.get('id')),
    'POST /api/repos/check-status': async (req) => {
      await app.checkRepoStatus(await readJSON(req));
      return [202, { ok: true }];
    },
    'POST /api/repos/select-deps': async (req) => app.selectRepoDeps(await readJSON(req)),
    'GET /api/repos/stale': async (_req, url) => app.repoStaleJSON(url.searchParams.get('id')),
    'POST /api/repos/prune': async (req) => app.pruneRepo(await readJSON(req)),
  };
  const known = new Set(Object.keys(routes).map((k) => k.split(' ')[1]));

  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
  return async function handle(req, res) {
    let url;
    try {
      url = new URL(req.url || '/', 'http://miniapp.local');
    } catch {
      sendJSON(res, 400, { error: 'bad_request', message: '地址不正确' });
      return;
    }
    try {
      if (req.method === 'GET' && (await serveStatic(o.fs, o.pluginRoot, url.pathname, res))) return;
      const fn = routes[`${req.method} ${url.pathname}`];
      if (!fn) {
        if (known.has(url.pathname)) throw new HttpError(405, 'method_not_allowed', '不支持这个请求方法');
        throw new HttpError(404, 'not_found', '没有这个接口');
      }
      const out = await fn(req, url, res);
      if (out === undefined) return;
      if (Array.isArray(out)) sendJSON(res, out[0], out[1]);
      else sendJSON(res, 200, out);
    } catch (e) {
      if (e instanceof HttpError) {
        sendError(res, e);
        return;
      }
      o.logger.error('request.failed', { code: /** @type {any} */ (e).code || /** @type {any} */ (e).name || 'error' });
      sendJSON(res, 500, { error: 'internal', message: '服务出错，请稍后重试' });
    }
  };
}
