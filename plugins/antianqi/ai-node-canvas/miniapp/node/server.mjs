// HTTP surface for the AI Node Canvas MiniApp.
//
// Layering:
//   presentation  -> miniapp/client/*   (the page)
//   application   -> this file + store.mjs + agent-runner.mjs
// The Host authenticates the loopback port, so this file never implements any
// auth logic and never forwards the Host credential anywhere.
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import { homedir } from 'node:os';

import { templateFromCanvas } from '../client/actions.mjs';
import { createActionQueue } from './action-queue.mjs';
import { createAgentRunner } from './agent-runner.mjs';
import { palette } from './capabilities.mjs';
import { decodeHostConnectorValue } from './host-connector-value.mjs';
import { handleMcp, MCP_PATH } from './mcp.mjs';
import { createMediaRunner } from './media-runner.mjs';
import { createCanvasStore } from './store.mjs';
import { readTemplates, removeTemplate, saveTemplate } from './templates.mjs';

// Keep in sync with `surface.path` in miniapp/miniapp.json.
const SURFACE_PATH = '/canvas';

const CLIENT_FILES = new Map([
  ['/app.js', { file: 'app.js', type: 'text/javascript; charset=utf-8' }],
  ['/mention.mjs', { file: 'mention.mjs', type: 'text/javascript; charset=utf-8' }],
  ['/tools.mjs', { file: 'tools.mjs', type: 'text/javascript; charset=utf-8' }],
  ['/forms.mjs', { file: 'forms.mjs', type: 'text/javascript; charset=utf-8' }],
  ['/actions.mjs', { file: 'actions.mjs', type: 'text/javascript; charset=utf-8' }],
  ['/styles.css', { file: 'styles.css', type: 'text/css; charset=utf-8' }],
]);

// The fingerprint covers the client code only, so injecting it into the page
// cannot change the fingerprint.
const FINGERPRINT_FILES = ['app.js', 'mention.mjs', 'tools.mjs', 'forms.mjs', 'actions.mjs', 'styles.css'];

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 256 * 1024 * 1024;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload ?? null);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function sendText(res, status, body, type) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

/**
 * The folder a file may be put in, or looked for.
 *
 * It is the folder the user named, and it has to be a folder that is there:
 * the runtime does not make one on the way, and a path that is not a folder
 * is refused rather than guessed at.
 */
async function folderOf(asked) {
  const folder = String(asked ?? '').trim() || join(homedir(), 'Downloads');
  if (!isAbsolute(folder)) return { error: '这个位置不是一个完整的路径' };
  let info = null;
  try {
    info = await stat(folder);
  } catch {
    info = null;
  }
  if (!info?.isDirectory()) return { error: '这个位置不是一个文件夹' };
  return { folder };
}

/**
 * Send a file, as an attachment when the caller asks for one.
 *
 * The `download` attribute of a link only works for a same-origin address, so
 * the runtime says it in the headers as well: then the file is saved even
 * when it is opened on its own, and the name the user gets is the one the
 * page asked for.
 */
function sendFile(res, file, downloadName = '') {
  const headers = {
    'content-type': file.mimeType,
    'content-length': file.data.length,
    'cache-control': 'no-store',
  };
  if (downloadName) {
    const safe = String(downloadName).replace(/[\r\n"\\]/g, '').trim();
    if (safe) {
      headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(safe)}`;
    }
  }
  res.writeHead(200, headers);
  res.end(file.data);
}

/** The name the caller asked the file to be saved under. */
function downloadNameOf(req) {
  const url = new URL(req.url ?? '/', 'http://miniapp.local');
  return url.searchParams.get('download') ?? '';
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('请求体过大'), { code: 'INVALID_ARGUMENTS' });
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('请求体不是合法 JSON'), { code: 'INVALID_ARGUMENTS' });
  }
}

// The raw bytes of an uploaded file. The name travels in the query string,
// so the body is exactly the file and nothing has to be parsed.
async function readRawBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      throw Object.assign(new Error('文件超过上传上限'), { code: 'INVALID_ARGUMENTS' });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function start(context) {
  const store = createCanvasStore(context);
  const runner = createAgentRunner(context);
  const media = createMediaRunner(context);
  // The queue is how a change from the Agent reaches a canvas. The page is
  // the only writer; the runtime only writes a canvas nobody has open.
  const queue = createActionQueue({ store, runner, logger: context.logger, signal: context.signal });
  // A run that was still waiting on the provider when the runtime stopped is
  // picked up again, so a long video is never paid for twice.
  await runner.restore();
  const assetCache = new Map();

  // Client assets are re-read whenever the file changes on disk, so a plugin
  // update takes effect on the next page load without restarting the runtime.
  async function readAsset(name) {
    const path = join(context.pluginRoot, 'miniapp', 'client', name);
    const info = await stat(path);
    const cached = assetCache.get(name);
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
      return cached.data;
    }
    const data = await readFile(path);
    assetCache.set(name, { mtimeMs: info.mtimeMs, size: info.size, data });
    return data;
  }

  // A short fingerprint of the client code. The page compares it with the
  // server's copy and reloads itself when the plugin has been updated.
  let buildPromise = null;
  async function clientBuild() {
    if (!buildPromise) {
      buildPromise = (async () => {
        const hash = createHash('sha256');
        for (const name of FINGERPRINT_FILES) {
          hash.update(name);
          hash.update(await readFile(join(context.pluginRoot, 'miniapp', 'client', name)));
        }
        return hash.digest('hex').slice(0, 12);
      })().catch(() => 'unknown');
    }
    return buildPromise;
  }

  async function pluginVersion() {
    try {
      const raw = await readFile(join(context.pluginRoot, '.minimax-plugin', 'plugin.json'), 'utf8');
      return JSON.parse(raw)?.version ?? '';
    } catch {
      return '';
    }
  }

  /**
   * Which node holds which asset.
   *
   * The library is the folder, and the canvases are what point into it. The
   * map says who uses a file, so the panel can name it and so a file that is
   * still in use is not deleted by accident.
   */
  async function libraryNames(store) {
    const named = new Map();
    for (const item of await store.list()) {
      const doc = await store.get(item.id);
      for (const node of doc?.nodes ?? []) {
        for (const media of node.metadata?.output?.media ?? []) {
          const url = String(media?.url ?? '');
          if (!url || named.has(url)) continue;
          named.set(url, { title: node.title || '', canvasId: doc.id || '' });
        }
      }
    }
    return named;
  }

  async function renderPage() {
    const build = await clientBuild();
    const html = (await readAsset('index.html')).toString('utf8');
    return html
      .replace(
        '</head>',
        `  <script>window.__NXC_BUILD__=${JSON.stringify(build)};window.__NXC_VERSION__=${JSON.stringify(
          await pluginVersion(),
        )};</script>\n  </head>`,
      )
      .replace('/app.js"', `/app.js?v=${build}"`)
      .replace('/styles.css"', `/styles.css?v=${build}"`);
  }

  async function handleApi(req, res, path) {
    // /api/canvases ...
    if (path === '/api/bootstrap' && req.method === 'GET') {
      const [catalog, canvases] = await Promise.all([runner.modelCatalog(), store.list()]);
      return sendJson(res, 200, {
        agentAvailable: Boolean(context.agent),
        models: catalog.items ?? [],
        defaultModelKey: catalog.defaultKey ?? null,
        connectorTools: await runner.connectorTools(),
        clientBuild: await clientBuild(),
        pluginVersion: await pluginVersion(),
        canvases,
      });
    }

    if (path === '/api/canvases' && req.method === 'GET') {
      return sendJson(res, 200, { canvases: await store.list() });
    }

    if (path === '/api/canvases' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const created = await store.save({
        id: `cv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        title: typeof body.title === 'string' && body.title.trim() ? body.title : '未命名画布',
        nodes: [],
        connections: [],
        backgroundMode: 'lines',
        viewport: { x: 80, y: 60, k: 1 },
      });
      return sendJson(res, 200, { canvas: created });
    }

    const canvasMatch = /^\/api\/canvases\/([A-Za-z0-9._-]+)$/.exec(path);
    if (canvasMatch) {
      const id = canvasMatch[1];
      if (req.method === 'GET') {
        const canvas = await store.get(id);
        return canvas ? sendJson(res, 200, { canvas }) : sendJson(res, 404, { error: 'not_found' });
      }
      if (req.method === 'PUT') {
        const body = await readJsonBody(req);
        const saved = await store.save({ ...body, id });
        return sendJson(res, 200, { canvas: saved });
      }
      if (req.method === 'DELETE') {
        await store.remove(id);
        return sendJson(res, 200, { ok: true });
      }
    }

    if (path === '/api/palette' && req.method === 'GET') {
      const catalog = await runner.modelCatalog();
      return sendJson(res, 200, {
        ...palette(),
        agentAvailable: Boolean(context.agent),
        models: catalog.items ?? [],
        defaultModelKey: catalog.defaultKey ?? null,
        // The table says what this MiniApp knows how to drive; the Host
        // decides what it granted. The inventory is read fresh here: right
        // after the runtime starts it is not complete yet.
        connectorTools: await runner.connectorTools({ fresh: true }),
      });
    }

    if (path === '/api/templates' && req.method === 'GET') {
      const list = await readTemplates(context.dataDir);
      return sendJson(res, 200, {
        templates: list.map((item) => ({
          id: item.id,
          title: item.title,
          description: item.description ?? '',
          // The group is what the panel tells the templates apart by.
          group: item.group ?? '',
          own: Boolean(item.own),
          steps: item.actions?.length ?? 0,
          // The steps themselves: the page puts a template on the canvas
          // with them.
          actions: item.actions ?? [],
        })),
      });
    }

    // The template files that lie on this machine.
    //
    // The file the page shares is written into the Downloads folder, so the
    // file somebody sends to this machine lands there too. Each one is read
    // by the one rule that reads a template, so a file that is something else
    // is not offered at all.

    // The folders a file may be put in.
    //
    // The page asks where a file should go, and the answer is a path on this
    // machine. The runtime names the ones a person looks in, so the page does
    // not have to guess a home directory.
    if (path === '/api/places' && req.method === 'GET') {
      const home = homedir();
      return sendJson(res, 200, {
        home,
        downloads: join(home, 'Downloads'),
        desktop: join(home, 'Desktop'),
        documents: join(home, 'Documents'),
        // The separator of this machine: the page joins a folder and a file
        // name with it, so the path it shows is one the machine understands.
        sep,
      });
    }

    // Write a file of the page's own into a folder of this machine, so it can be
    // sent to another machine.
    //
    // The browser's own download cannot be trusted to finish here: the file
    // stays a temporary name and never arrives under the name the page asked
    // for. The runtime writes it instead and says where it went.
    if (path === '/api/export' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const asked = String(body.path ?? '').trim();
      if (!asked) {
        return sendJson(res, 400, { error: 'bad_name', message: '这个文件还没有名字' });
      }
      if (body.document === undefined || body.document === null) {
        return sendJson(res, 400, { error: 'empty', message: '这个文件是空的' });
      }
      // The path is the one the user named: where the file goes and what it is
      // called. The folder has to be a folder that is there, and the name has
      // to be one plain name — a name that walks out of the folder is refused,
      // not tidied up into something that looks safe.
      const folder = dirname(asked);
      const name = basename(asked);
      if (!name || name === '.' || name === '..') {
        return sendJson(res, 400, { error: 'bad_name', message: '这个文件名用不了' });
      }
      const where = await folderOf(folder);
      if (where.error) {
        return sendJson(res, 400, { error: 'bad_folder', message: where.error });
      }
      const text = typeof body.document === 'string'
        ? body.document
        : `${JSON.stringify(body.document, null, 2)}\n`;
      const saved = await media.store.writeToFolder(name, text, where.folder);
      if (!saved.ok) {
        return sendJson(res, 400, { error: saved.reason, message: '这个文件名用不了' });
      }
      return sendJson(res, 200, { ok: true, path: saved.path, name: saved.name, bytes: saved.bytes });
    }

    // Take a template of the user's own away.
    //
    // The built-in templates are not in this folder, so they cannot be taken
    // away by an id: only the ones the user kept are.
    if (path.startsWith('/api/templates/') && req.method === 'DELETE') {
      const id = decodeURIComponent(path.slice('/api/templates/'.length));
      const removed = await removeTemplate(context.dataDir, id);
      if (!removed) {
        return sendJson(res, 404, { error: 'not_found', message: '没有这个模板' });
      }
      return sendJson(res, 200, { ok: true, id });
    }

    // Keep a template of the user's own: the skeleton of the canvas that is
    // open now. The steps are taken from the canvas; the results and the
    // material somebody picked are left behind.
    //
    // A template that came from another machine arrives with its steps in it,
    // so the same place keeps both kinds of template by the same rule.
    if (path === '/api/templates' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const id = String(body.id ?? '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64);
      if (!id) {
        return sendJson(res, 400, { error: 'bad_id', message: '这个模板还没有名字' });
      }
      let template = null;
      if (Array.isArray(body.actions)) {
        template = {
          id,
          title: String(body.title ?? id),
          description: String(body.description ?? ''),
          actions: body.actions,
        };
      } else {
        const canvas = body.canvas ?? (body.canvasId ? await store.get(body.canvasId) : null);
        if (!canvas) {
          return sendJson(res, 404, { error: 'not_found', message: '没有这张画布' });
        }
        template = templateFromCanvas(canvas, { id, title: String(body.title ?? id) });
      }
      if (!template.actions.length) {
        return sendJson(res, 400, {
          error: 'empty',
          message: '这张画布上没有能存成模板的步骤（结果和素材不算步骤）',
        });
      }
      await saveTemplate(context.dataDir, template);
      return sendJson(res, 200, {
        ok: true,
        template: { id, title: template.title, steps: template.actions.length },
      });
    }

    if (path === '/api/tasks' && req.method === 'GET') {
      return sendJson(res, 200, { tasks: runner.listActive() });
    }

    // The actions the Agent asked for, for the canvas the page has open.
    // Asking for them is also the heartbeat that keeps the claim alive.
    if (path === '/api/actions' && req.method === 'GET') {
      const url = new URL(req.url ?? '/', 'http://miniapp.local');
      const canvasId = url.searchParams.get('canvas') ?? '';
      if (!canvasId) return sendJson(res, 400, { error: 'INVALID_ARGUMENTS', message: '缺少画布 id' });
      queue.touch(canvasId);
      const actions = queue.pending(canvasId).map((action) => ({
        id: action.id,
        type: action.type,
        args: action.args,
        createdAt: action.createdAt,
      }));
      return sendJson(res, 200, { actions });
    }

    // The page takes the canvas before it reads it: from here on the runtime
    // does not write it, and the page applies the changes itself.
    if (path === '/api/actions/claim' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const canvasId = String(body.canvasId ?? '');
      if (!canvasId) {
        return sendJson(res, 400, { error: 'INVALID_ARGUMENTS', message: '缺少画布 id' });
      }
      const claimed = await queue.claim(canvasId);
      return sendJson(res, 200, claimed);
    }

    // The page answers an action: it applied it, or it could not.
    if (path === '/api/actions/ack' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const id = String(body.id ?? '');
      if (!id) {
        return sendJson(res, 400, { error: 'INVALID_ARGUMENTS', message: '缺少动作 id' });
      }
      const known = queue.ack(id, {
        ok: body.ok === true,
        error: body.error ?? '',
        info: body.info ?? null,
      });
      return sendJson(res, 200, { ok: true, known });
    }

    // The page let the canvas go: it shows another one now.
    if (path === '/api/actions/release' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const canvasId = String(body.canvasId ?? '');
      if (canvasId) queue.release(canvasId);
      return sendJson(res, 200, { ok: true });
    }

    if (path === '/api/voices' && req.method === 'GET') {
      // The voice catalogue is live data: the Node service reads it from the
      // connector instead of shipping a made-up list. The Host grants the
      // provider through `hostConnectorAccess`, and the connector is called
      // from request handling, never while the entry is starting up.
      const payload = await listVoices(context);
      return sendJson(res, 200, payload);
    }

    // The capability surface of one mode, with the selected model's limits
    // folded in. The page reads the same resolution from the palette, so
    // there is one rule for "what does this model offer" in this codebase.
    if (path === '/api/capabilities' && req.method === 'GET') {
      const url = new URL(req.url ?? '/', 'http://miniapp.local');
      const mode = url.searchParams.get('mode') ?? 'image';
      const model = url.searchParams.get('model');
      return sendJson(res, 200, { capabilities: runner.capabilities(mode, model) });
    }

    // Whether the local media tools can run. The page uses this to unlock the
    // tool buttons and to explain what is missing when they cannot.
    if (path === '/api/media/status' && req.method === 'GET') {
      const state = await media.status();
      return sendJson(res, 200, { media: state });
    }

    // The local library: everything this runtime produced and everything the
    // user picked from their machine. The page shows it as a panel, so an
    // asset that is on no canvas can still be brought back into a flow.
    if (path === '/api/library' && req.method === 'GET') {
      const assets = await media.store.listLibrary();
      const named = await libraryNames(store);
      return sendJson(res, 200, {
        assets: assets.map((asset) => ({
          ...asset,
          // The node that holds it, when one does. The title is the name the
          // user knows the asset by.
          title: named.get(asset.url)?.title ?? '',
          canvasId: named.get(asset.url)?.canvasId ?? '',
          inUse: named.has(asset.url),
        })),
      });
    }

    // Put the file where the user can find it. The runtime keeps the file in
    // its own folder, which is not somewhere a person looks for a picture,
    // so saving copies it into the Downloads folder under the name the user
    // knows it by.
    const saveMatch = /^\/api\/library\/([\w.\-]+)\/save$/.exec(path);
    if (saveMatch && req.method === 'POST') {
      const body = await readJsonBody(req);
      // The name is cleaned and judged inside the store, so one rule decides
      // what a file may be called and where it may land.
      const saved = await media.store.saveToDownloads(saveMatch[1], String(body.name ?? ''));
      if (!saved.ok) {
        if (saved.reason === 'bad_name') {
          return sendJson(res, 400, { error: 'bad_name', message: '这个名字不能用，换一个普通的文件名试试' });
        }
        return sendJson(res, 404, { error: 'not_found', message: '库里没有这个素材' });
      }
      return sendJson(res, 200, { ok: true, path: saved.path, name: saved.name, bytes: saved.bytes });
    }

    // Remove one asset from the library. An asset that a canvas still points
    // at is kept: deleting the file would leave a broken card behind.
    const libraryMatch = /^\/api\/library\/([\w.\-]+)$/.exec(path);
    if (libraryMatch && req.method === 'DELETE') {
      const name = libraryMatch[1];
      const named = await libraryNames(store);
      const asset = (await media.store.listLibrary()).find((item) => item.name === name);
      if (!asset) return sendJson(res, 404, { error: 'not_found', message: '库里没有这个素材' });
      if (named.has(asset.url)) {
        return sendJson(res, 409, {
          error: 'IN_USE',
          message: `这张素材还被画布「${named.get(asset.url).title}」上的节点用着，先把它从画布上拿掉`,
        });
      }
      const removed = await media.store.removeAsset(name);
      return sendJson(res, 200, { ok: true, removed });
    }

    // Clear the files that no canvas points at any more. The folder grows with
    // every run, and this is what keeps it from growing for ever.
    if (path === '/api/library/gc' && req.method === 'POST') {
      const canvases = await store.list();
      // Without a canvas there is nothing that says which files belong to
      // whom, and the cleanup would take every file on this machine. A
      // canvas that is gone for a moment must not cost the user their
      // pictures.
      if (!canvases.length) {
        return sendJson(res, 409, {
          error: 'NO_CANVAS',
          message: '这台机器上还没有画布，不能清理：清理会把它不知道归属的素材都删掉',
        });
      }
      const named = await libraryNames(store);
      const removed = [];
      for (const asset of await media.store.listLibrary()) {
        if (named.has(asset.url)) continue;
        if (await media.store.removeAsset(asset.name)) removed.push(asset.name);
      }
      return sendJson(res, 200, { ok: true, removed });
    }

    // Run a local media tool. The Node service owns the whole path: it
    // downloads the source, runs ffmpeg and publishes the result.
    if (path === '/api/tools/run' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const result = await media.run({
        tool: String(body.tool ?? ''),
        sources: Array.isArray(body.sources) ? body.sources : [],
        params: body.params && typeof body.params === 'object' ? body.params : {},
      });
      return sendJson(res, 200, result);
    }

    // Publish a picture the page drew into this runtime's own asset folder.
    //
    // The tools that work in the browser (宫格切分 / 剪裁) hand their bytes
    // over. A data URL would live inside the canvas and nowhere else: it could
    // not be saved, it would not show up in the library and it would bloat
    // every save of the canvas. The runtime publishes it like any other
    // produced file, so the result is a real file on this machine.
    if (path === '/api/media/publish' && req.method === 'POST') {
      const url = new URL(req.url ?? '/', 'http://miniapp.local');
      const name = url.searchParams.get('name') ?? '';
      const body = await readRawBody(req, MAX_UPLOAD_BYTES);
      if (!body?.length) {
        return sendJson(res, 400, { error: 'INVALID_ARGUMENTS', message: '没有拿到图片内容' });
      }
      const match = /\.[A-Za-z0-9]{2,5}$/.exec(name);
      const ext = match ? match[0].toLowerCase() : '.png';
      if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
        return sendJson(res, 400, { error: 'INVALID_ARGUMENTS', message: '只能发布图片' });
      }
      const published = await media.store.publishBytes(body, ext);
      return sendJson(res, 200, published);
    }

    // Store a file the user picked from their machine. The file is served
    // from this runtime, so it can be used by the media tools; whether the
    // provider can read it is answered by the upload command.
    if (path === '/api/uploads' && req.method === 'POST') {
      const url = new URL(req.url ?? '/', 'http://miniapp.local');
      const name = url.searchParams.get('name') ?? '';
      // The kind of the input node the file was picked for: an input node
      // holds one kind of material, so the wrong file is refused.
      const kind = url.searchParams.get('kind') ?? '';
      const body = await readRawBody(req, MAX_UPLOAD_BYTES);
      const saved = await media.store.saveUpload(name, body, kind);
      return sendJson(res, 200, {
        url: saved.url,
        name: saved.name,
        originalName: saved.originalName,
        kind: saved.kind,
        bytes: saved.bytes,
        mimeType: saved.mimeType,
      });
    }

    // Ask the provider about a media file. The provider only reads assets it
    // holds itself, so the media is downloaded and uploaded before the
    // question is asked.
    if (path === '/api/tools/understand' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const url = String(body.url ?? '').trim();
      if (!url) {
        return sendJson(res, 400, { error: 'INVALID_ARGUMENTS', message: '缺少素材地址' });
      }
      const providerUrl = await media.prepareForProvider({ url });
      const result = await runner.understand({
        kind: body.kind === 'image' || body.kind === 'audio' ? body.kind : 'video',
        url: providerUrl,
        prompt: body.prompt ?? '',
      });
      return sendJson(res, 200, result);
    }

    if (path === '/api/runs' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const record = await runner.startRun({
        nodeId: body.nodeId ?? null,
        mode: body.mode ?? 'image',
        // The mode the node is in: some modes need the material read first.
        nodeMode: body.nodeMode ?? '',
        segments: body.segments ?? [],
        prompt: body.prompt ?? '',
        mentions: body.mentions ?? [],
        params: body.params ?? {},
        modelKey: body.modelKey ?? null,
        sessionId: body.sessionId ?? null,
        // How many assets this run asks for. The runtime clamps it.
        count: body.count ?? 1,
        references: body.references ?? [],
        // Which request the provider is asked for, and the pictures that are
        // plugged straight into this node. The three picture-to-video requests
        // are different requests, so the runtime needs both.
        path: body.path ?? '',
        frames: body.frames ?? [],
      });
      return sendJson(res, 202, { run: record });
    }

    const runMatch = /^\/api\/runs\/([A-Za-z0-9_-]+)$/.exec(path);
    if (runMatch && req.method === 'GET') {
      const record = runner.get(runMatch[1]);
      return record ? sendJson(res, 200, { run: record }) : sendJson(res, 404, { error: 'not_found' });
    }

    const permissionMatch = /^\/api\/runs\/([A-Za-z0-9_-]+)\/permission$/.exec(path);
    if (permissionMatch && req.method === 'POST') {
      const body = await readJsonBody(req);
      const record = await runner.replyPermission(permissionMatch[1], {
        requestId: body.requestId ?? null,
        sessionId: body.sessionId ?? null,
        decision: body.decision === 'allowOnce' ? 'allowOnce' : 'deny',
      });
      return sendJson(res, 200, { run: record });
    }

    const answerMatch = /^\/api\/runs\/([A-Za-z0-9_-]+)\/answer$/.exec(path);
    if (answerMatch && req.method === 'POST') {
      const body = await readJsonBody(req);
      const record = await runner.answer(answerMatch[1], {
        requestId: body.requestId ?? null,
        sessionId: body.sessionId ?? null,
        answers: body.answers ?? [],
      });
      return sendJson(res, 200, { run: record });
    }

    // Stop one run. Every run owns its own call, so cancelling one leaves
    // the other runs alone.
    const cancelMatch = /^\/api\/runs\/([A-Za-z0-9_-]+)\/cancel$/.exec(path);
    if (cancelMatch && req.method === 'POST') {
      const record = await runner.cancelRun(cancelMatch[1]);
      return sendJson(res, 200, { run: record });
    }

    return sendJson(res, 404, { error: 'not_found' });
  }

  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];

    const run = async () => {
      if (path.startsWith('/api/')) return handleApi(req, res, path);

      // The hosted MCP server. The Host rewrites the address it connects to
      // and authenticates the port, so this only speaks the protocol.
      if (path === MCP_PATH) {
        return handleMcp(req, res, {
          store,
          queue,
          serverInfo: { name: 'ai-node-canvas', version: await pluginVersion() },
          json: sendJson,
          templates: () => readTemplates(context.dataDir),
        });
      }

      if (req.method === 'GET' && path === SURFACE_PATH) {
        return sendText(res, 200, await renderPage(), 'text/html; charset=utf-8');
      }

      const asset = CLIENT_FILES.get(path);
      if (req.method === 'GET' && asset) {
        const data = await readAsset(asset.file);
        return sendText(res, 200, data, asset.type);
      }

      // A produced media file. The name is sanitised inside the store, so a
      // path cannot escape the asset folder.
      if (req.method === 'GET' && path.startsWith('/assets/')) {
        const name = path.slice('/assets/'.length);
        const file = await media.store.readAsset(name);
        if (!file) return sendJson(res, 404, { error: 'not_found' });
        return sendFile(res, file, downloadNameOf(req));
      }

      // A file the user uploaded from their machine.
      if (req.method === 'GET' && path.startsWith('/uploads/')) {
        const name = path.slice('/uploads/'.length);
        const file = await media.store.readUpload(name);
        if (!file) return sendJson(res, 404, { error: 'not_found' });
        return sendFile(res, file, downloadNameOf(req));
      }

      if (req.method === 'GET' && path === '/') {
        res.writeHead(302, { location: SURFACE_PATH });
        return res.end();
      }

      return sendJson(res, 404, { error: 'not_found' });
    };

    run().catch((error) => {
      context.logger.error('nxc.request.failed', { path });
      if (res.headersSent) {
        res.end();
        return;
      }
      const code = error?.code ?? 'internal_error';
      const status =
        code === 'INVALID_ARGUMENTS' ? 400
        : code === 'BUSY' ? 409
        : code === 'CONFLICT' ? 409
        : code === 'REQUEST_NOT_FOUND' ? 404
        : code === 'FFMPEG_UNAVAILABLE' ? 503
        : 500;
      sendJson(res, status, {
        error: code,
        message: String(error?.message ?? error),
      });
    });
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(context.listen.port, context.listen.host, () => {
      server.off('error', onError);
      resolve();
    });
  });
  // The port the server actually got. When the caller asks for port 0 the
  // kernel picks a free one, which is the only way to be sure of it.
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : context.listen.port;
  context.logger.info('nxc.runtime.listening', { surface: SURFACE_PATH, port });

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    context.signal.removeEventListener('abort', onAbort);
    // A tool that is still encoding is a child process of this runtime, so it
    // is stopped here instead of outliving the board.
    media.dispose();
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
  };
  const onAbort = () => {
    void dispose();
  };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  return { dispose, port };
}

// Read the TTS voice catalogue from the connector.
//
// The list is live data, so the Node service owns the read: the Host grants
// the provider through `hostConnectorAccess`, and the call happens while
// handling a request, never during start-up.
async function listVoices(context) {
  const connector = context.hostConnector;
  if (!connector) {
    return { voices: [], source: 'no-connector', error: '当前客户端未授予连接器访问权限。' };
  }
  try {
    const inventory = await connector.list();
    // The Host names connector tools `<provider>_<tool>` inside the inventory
    // (the CLI shows the same tool as `connector__<provider>__<tool>`), so the
    // provider prefix cannot be assumed.
    const tool =
      inventory.tools.find((item) => item.provider === 'matrix' && /get_voice_list$/.test(item.name ?? ''))
      ?? inventory.tools.find((item) => /(^|_)get_voice_list$/.test(item.name ?? ''));
    if (!tool) {
      const available = inventory.tools
        .map((item) => `${item.provider ?? '?'}::${item.name ?? '?'}`)
        .slice(0, 20);
      return {
        voices: [],
        source: 'tool-missing',
        error: `当前连接器没有提供音色清单（可用工具：${available.join('、') || '无'}）。`,
      };
    }
    const result = await connector.call(tool.toolRef, {}, { signal: context.signal });
    const value = decodeHostConnectorValue(result.value);
    const list = Array.isArray(value?.available_voices) ? value.available_voices : [];
    return {
      voices: list
        .filter((item) => item && typeof item.voice_id === 'string')
        .map((item) => ({ value: item.voice_id, label: item.voice_name ?? item.voice_id })),
      source: 'connector',
    };
  } catch (error) {
    return {
      voices: [],
      source: 'error',
      error: `读取音色清单失败：${error?.message ?? error}`,
      code: error?.code ?? null,
    };
  }
}
