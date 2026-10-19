// @ts-check
// Page Designer Node entry: serves the page, its API, a server-sent event stream for live
// progress, and the MCP endpoint the Agent writes pages through.
//
// The publish_design, edit_design and read_design tool descriptions are adapted from fx0 by
// Vercel Labs, lib/tools.ts (https://github.com/vercel-labs/fx0, commit e584782, Apache-2.0).
// Changes: the tools take a project_id, read_design pages by character offset instead of
// fx0's read_tool_result, and list_designs is new.
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { applyDesignEdits, prepareDesignHtml, validateDesignHtml } from './artifact.mjs';
import { createMcpEndpoint } from './mcp.mjs';
import { MCP_INSTRUCTIONS } from './prompts.mjs';
import { MAX_MESSAGE_CHARS, answersFrom, createRunManager, errorCode, selectionFrom } from './runs.mjs';
import { StudioError, cleanText, createStore } from './store.mjs';
import { MAX_STYLE_CHARS, STYLE_PRESETS, presetById } from './styles.mjs';

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */
/** @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle */
/** @typedef {import('node:http').IncomingMessage} IncomingMessage */
/** @typedef {import('node:http').ServerResponse} ServerResponse */

export const SURFACE_PATH = '/studio';
export const MCP_PATH = '/mcp/page-designer';
const VERSION = '1.0.0';
const MAX_JSON_BODY = 256 * 1024;
const MAX_MCP_BODY = 4 * 1024 * 1024;
const READ_LIMIT = 60_000;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/** @type {Record<string, number>} */
const STATUS_BY_CODE = {
  invalid: 400,
  forbidden: 403,
  not_found: 404,
  busy: 409,
  question_pending: 409,
  too_many_versions: 409,
  too_large: 413,
  unsupported: 415,
  invalid_design: 422,
  agent_unavailable: 503,
};

const HTML_HEADERS = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

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
  // The port requests must name in their Origin; replaced by the bound port once listening.
  let listenPort = context.listen.port;

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

  const runs = createRunManager({ agent: context.agent, store, publish, logger: context.logger });

  /** @param {unknown} value */
  const projectIdFrom = (value) => (typeof value === 'string' && value ? value : null);

  /** @param {string} id @param {string} html @param {'publish' | 'edit'} via @param {string} [title] */
  async function saveVersion(id, html, via, title) {
    const { version, changed } = await store.addVersion(id, html, { via, runId: runs.liveRunId(id), title });
    publish({ type: 'project', id });
    publish({ type: 'projects' });
    return { ok: true, project_id: id, revision: version.n, changed, open_path: `${SURFACE_PATH}?p=${id}` };
  }

  const mcp = createMcpEndpoint({
    name: 'page-designer',
    version: VERSION,
    instructions: MCP_INSTRUCTIONS,
    onError: (error) => context.logger.warn(`page_designer.mcp_failed ${errorCode(error)}`),
    tools: [
      {
        name: 'publish_design',
        description:
          'Publish one complete self-contained HTML document as the new version of a Page Designer page. ' +
          'Inline CSS and JavaScript, Canvas, animation and event handlers are supported inside the sandboxed preview. ' +
          'It must include doctype, html, head and body; keep scripts inline; use only embedded data: assets, local fragments, ' +
          'or <a href="https://..."> links; and do not add HTML comments, external assets, forms, scripted navigation or nested frames. ' +
          'Use it for the first version or a broad rewrite and edit_design for localized changes. ' +
          'Omit project_id to start a new page. A rejected document returns the validation error and publishes nothing.',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: { type: 'string', description: 'The Page Designer project id, for example p-1a2b3c4d. Omit to start a new page.' },
            html: { type: 'string', description: 'The complete self-contained HTML document (at most 512 KiB).' },
            title: { type: 'string', description: "Short page title in the user's language. Pass it with the first version." },
          },
          required: ['html'],
          additionalProperties: false,
        },
        handler: async (args) => {
          const html = typeof args.html === 'string' ? args.html : '';
          let id = projectIdFrom(args.project_id);
          if (id) store.find(id);
          else {
            // A new page is created only for HTML that will become its first version.
            const validation = validateDesignHtml(html);
            if (!validation.ok) throw new StudioError('invalid_design', `${validation.error} (nothing was published)`);
            id = (await store.create({ title: cleanText(args.title, 80), origin: 'mcp' })).id;
            publish({ type: 'projects' });
          }
          return saveVersion(id, html, 'publish', cleanText(args.title, 80));
        },
      },
      {
        name: 'edit_design',
        description:
          'Apply one or more exact replacements to the current version of a Page Designer page in a single call, without republishing the whole document. ' +
          "Put every change a request needs into one call: they apply in order and publish once, atomically, as one version. " +
          'Each old_string must match exactly once in the document as it stands after the edits before it.',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: { type: 'string', description: 'The Page Designer project id.' },
            edits: {
              type: 'array',
              minItems: 1,
              maxItems: 20,
              description: 'Replacements, applied in order.',
              items: {
                type: 'object',
                properties: {
                  old_string: { type: 'string', description: 'Exact current HTML, CSS or JavaScript text to replace once.' },
                  new_string: { type: 'string', description: 'Replacement text.' },
                },
                required: ['old_string', 'new_string'],
                additionalProperties: false,
              },
            },
          },
          required: ['project_id', 'edits'],
          additionalProperties: false,
        },
        handler: async (args) => {
          const id = projectIdFrom(args.project_id);
          if (!id) throw new StudioError('invalid', 'project_id is required.');
          const { html } = await store.latestHtml(id);
          if (html == null) throw new StudioError('invalid', 'No version has been published yet; call publish_design first.');
          const edited = applyDesignEdits(html, args.edits);
          if (!edited.ok) throw new StudioError('invalid', edited.error);
          return saveVersion(id, edited.html, 'edit');
        },
      },
      {
        name: 'read_design',
        description:
          'Read the current HTML of a Page Designer page. Returns null before the first publish. ' +
          'Long documents come in pages: pass the returned next_offset to read the rest.',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: { type: 'string', description: 'The Page Designer project id.' },
            offset: { type: 'number', description: 'Character offset to start from. Defaults to 0.' },
          },
          required: ['project_id'],
          additionalProperties: false,
        },
        handler: async (args) => {
          const id = projectIdFrom(args.project_id);
          if (!id) throw new StudioError('invalid', 'project_id is required.');
          const { html, revision } = await store.latestHtml(id);
          if (html == null) return { project_id: id, revision: 0, html: null };
          const offset = Math.max(0, Math.min(Number.isFinite(args.offset) ? Math.floor(Number(args.offset)) : 0, html.length));
          const end = Math.min(html.length, offset + READ_LIMIT);
          return {
            project_id: id,
            revision,
            total_chars: html.length,
            offset,
            html: html.slice(offset, end),
            ...(end < html.length ? { next_offset: end } : {}),
          };
        },
      },
      {
        name: 'list_designs',
        description: 'List Page Designer pages with their project id, title, latest version number and last change (Unix ms).',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: async () =>
          store.list().map((item) => ({ project_id: item.id, title: item.title, revision: item.versions, updated_at: item.updatedAt })),
      },
    ],
  });

  /** @param {string} id */
  function projectView(id) {
    const project = store.find(id);
    return {
      id: project.id,
      title: project.title,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      sessionId: project.sessionId,
      model: project.model,
      style: project.style ? { id: project.style.id, name: project.style.name } : null,
      messages: project.messages,
      versions: project.versions,
      pendingQuestion: project.pendingQuestion ? { mode: project.pendingQuestion.mode, request: project.pendingQuestion.request } : null,
      live: runs.live(id),
    };
  }

  /** @param {unknown} value */
  function styleFrom(value) {
    if (!value || typeof value !== 'object') return null;
    const raw = /** @type {Record<string, any>} */ (value);
    if (typeof raw.preset === 'string') {
      const preset = presetById(raw.preset);
      if (!preset) throw new StudioError('invalid', 'Unknown style.');
      return { id: preset.id, name: preset.name.en, text: preset.text };
    }
    const text = cleanText(raw.text, MAX_STYLE_CHARS + 1);
    if (!text) throw new StudioError('invalid', 'The design.md file is empty.');
    if (text.length > MAX_STYLE_CHARS) throw new StudioError('too_large', 'The design.md file is too long.');
    return { id: 'custom', name: cleanText(raw.name, 80) || 'design.md', text };
  }

  /** @param {unknown} value */
  function messageFrom(value) {
    if (typeof value === 'string' && value.length > MAX_MESSAGE_CHARS) throw new StudioError('too_large', 'The message is too long.');
    const text = cleanText(value, MAX_MESSAGE_CHARS);
    if (!text) throw new StudioError('invalid', 'Write what you want first.');
    return text;
  }

  /** @param {IncomingMessage} request @param {ServerResponse} response */
  async function route(request, response) {
    const url = new URL(request.url ?? '/', 'http://miniapp.local');
    const path = url.pathname;
    const method = request.method ?? 'GET';

    // Every route, the MCP endpoint included: the Host header must name this machine, so a page
    // whose hostname was re-pointed at 127.0.0.1 (DNS rebinding) cannot reach anything.
    if (!isLocalRequest(request, listenPort)) throw new StudioError('forbidden', 'Only this computer can use Page Designer.');

    if (path === MCP_PATH) {
      const body = method === 'POST' ? await readBody(request, MAX_MCP_BODY) : '';
      await mcp.handle(request, response, body);
      return;
    }
    if (method === 'GET' && path === '/') return redirect(response, SURFACE_PATH);
    if (method === 'GET' && path === SURFACE_PATH) return send(response, 200, 'text/html; charset=utf-8', indexHtml, HTML_HEADERS);
    if (method === 'GET' && path === '/assets/app.js') return send(response, 200, 'text/javascript; charset=utf-8', appJs);
    if (method === 'GET' && path === '/assets/app.css') return send(response, 200, 'text/css; charset=utf-8', appCss);

    if (!path.startsWith('/api/')) throw new StudioError('not_found', 'Not found.');
    if (method !== 'GET' && !sameSite(request)) throw new StudioError('forbidden', 'Cross-origin requests are not accepted.');

    if (method === 'GET' && path === '/api/events') {
      response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
      response.write(': connected\n\n');
      subscribers.add(response);
      request.on('close', () => subscribers.delete(response));
      return;
    }
    if (method === 'GET' && path === '/api/state') {
      const running = new Set(runs.activeIds());
      return json(response, 200, {
        agentAvailable: !!context.agent,
        projects: store.list().map((item) => ({ ...item, running: running.has(item.id) })),
        styles: STYLE_PRESETS.map(({ id, name, description, swatches }) => ({ id, name, description, swatches })),
      });
    }
    if (method === 'GET' && path === '/api/models') {
      if (!context.agent) throw new StudioError('agent_unavailable', 'Page Designer has no permission to run the Agent.');
      return json(response, 200, await context.agent.models());
    }
    if (method === 'POST' && path === '/api/projects') {
      const body = await readJson(request);
      if (!context.agent) throw new StudioError('agent_unavailable', 'Page Designer has no permission to run the Agent.');
      const text = messageFrom(body.text);
      const style = styleFrom(body.style);
      const model = selectionFrom(body.model);
      const firstLine = text.split('\n').find((line) => line.trim()) ?? '';
      const project = await store.create({ title: firstLine.slice(0, 48), style, model, origin: 'page' });
      publish({ type: 'projects' });
      await runs.start(project.id, { kind: 'message', text, model });
      return json(response, 201, { id: project.id });
    }

    const match = /^\/api\/projects\/(p-[0-9a-f]{8})(?:\/([a-z]+)(?:\/(\d{1,6}))?)?$/.exec(path);
    if (!match) throw new StudioError('not_found', 'Not found.');
    const [, id, action, number] = match;

    if (!action) {
      if (method === 'GET') return json(response, 200, projectView(id));
      if (method === 'PATCH') {
        const body = await readJson(request);
        const title = cleanText(body.title, 80);
        if (!title) throw new StudioError('invalid', 'The title cannot be empty.');
        await store.update(id, (project) => {
          project.title = title;
        });
        publish({ type: 'project', id });
        publish({ type: 'projects' });
        return json(response, 200, { ok: true });
      }
      if (method === 'DELETE') {
        if (runs.live(id)) throw new StudioError('busy', 'Stop the running request before deleting this page.');
        await store.remove(id);
        publish({ type: 'projects' });
        return json(response, 200, { ok: true });
      }
    }
    if (method === 'POST' && action === 'messages') {
      const body = await readJson(request);
      await runs.start(id, { kind: 'message', text: messageFrom(body.text), model: selectionFrom(body.model) });
      return json(response, 202, { ok: true });
    }
    if (method === 'POST' && action === 'answer') {
      const body = await readJson(request);
      await runs.start(id, { kind: 'answer', answers: answersFrom(body.answers), model: selectionFrom(body.model) });
      return json(response, 202, { ok: true });
    }
    if (method === 'POST' && action === 'cancel') {
      await readJson(request);
      runs.cancel(id);
      return json(response, 202, { ok: true });
    }
    if (method === 'POST' && action === 'permissions') {
      const body = await readJson(request);
      const decision = body.decision === 'allowOnce' ? 'allowOnce' : body.decision === 'deny' ? 'deny' : null;
      if (!decision || typeof body.requestId !== 'string') throw new StudioError('invalid', 'Choose allow or deny.');
      await runs.reply(id, body.requestId, decision);
      return json(response, 200, { ok: true });
    }
    if (method === 'GET' && action === 'preview' && number) {
      const n = Number(number);
      const token = randomBytes(12).toString('hex');
      const html = await store.readVersion(id, n);
      return json(response, 200, { n, token, html: prepareDesignHtml(html, token) });
    }
    if (method === 'GET' && action === 'versions' && number) {
      const html = await store.readVersion(id, Number(number));
      // A direct visit must never run the design with this page's origin.
      return send(response, 200, 'text/html; charset=utf-8', html, {
        ...HTML_HEADERS,
        'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      });
    }
    throw new StudioError('not_found', 'Not found.');
  }

  const server = createServer((request, response) => {
    route(request, response).catch((error) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof StudioError) {
        json(response, STATUS_BY_CODE[error.code] ?? 400, { error: error.code, message: error.message });
        return;
      }
      const code = errorCode(error);
      if (code !== 'UNKNOWN') {
        // A Host Agent error (BUSY, AGENT_UNAVAILABLE, ...): the page localizes the code.
        json(response, code === 'BUSY' ? 409 : 503, { error: code });
        return;
      }
      context.logger.error(`page_designer.request_failed ${error instanceof Error ? error.name : 'error'}`);
      json(response, 500, { error: 'internal', message: 'Something went wrong.' });
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(context.listen.port, context.listen.host, () => {
      server.off('error', reject);
      const address = server.address();
      if (address && typeof address === 'object') listenPort = address.port;
      resolve(undefined);
    });
  });
  context.logger.info('page_designer.listening');

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    context.signal.removeEventListener('abort', onAbort);
    clearInterval(heartbeat);
    runs.dispose();
    for (const response of subscribers) response.end();
    subscribers.clear();
    await new Promise((resolve) => {
      server.close(() => resolve(undefined));
      server.closeAllConnections?.();
    });
  };
  const onAbort = () => void dispose();
  context.signal.addEventListener('abort', onAbort, { once: true });
  return { dispose };
}

/**
 * The Host header must name this machine (a DNS-rebound hostname is refused), and an Origin, when
 * a browser sends one, must be this listener: a loopback name and this port. The Host's MCP
 * client is a Node process and sends no Origin. A sandboxed preview sends "null" and is refused.
 * @param {IncomingMessage} request
 * @param {number} port
 */
export function isLocalRequest(request, port) {
  const host = request.headers.host;
  if (host !== undefined && !LOOPBACK_HOSTS.has(hostnameOf(host))) return false;
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(hostnameOf(url.host)) && Number(url.port || 80) === port;
}

/** @param {string} hostHeader */
function hostnameOf(hostHeader) {
  const value = hostHeader.trim().toLowerCase();
  const bracketed = /^\[([^\]]*)\]/.exec(value);
  if (bracketed) return bracketed[1];
  const colon = value.lastIndexOf(':');
  return colon === -1 ? value : value.slice(0, colon);
}

/**
 * Writes also need the browser's own verdict: anything it marks as coming from another site,
 * such as a page the preview navigated to, is refused.
 * @param {IncomingMessage} request
 */
function sameSite(request) {
  const site = request.headers['sec-fetch-site'];
  return typeof site !== 'string' || site === 'same-origin' || site === 'none';
}

/** @param {IncomingMessage} request @param {number} limit @returns {Promise<string>} */
function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    request.on('data', (/** @type {Buffer} */ chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new StudioError('too_large', 'The request is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

/** @param {IncomingMessage} request @returns {Promise<Record<string, any>>} */
async function readJson(request) {
  const type = String(request.headers['content-type'] ?? '');
  if (!/^application\/json\b/i.test(type)) throw new StudioError('unsupported', 'Send JSON.');
  const raw = await readBody(request, MAX_JSON_BODY);
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    throw new StudioError('invalid', 'The request is not valid JSON.');
  }
}

/** @param {ServerResponse} response @param {number} status @param {unknown} value */
function json(response, status, value) {
  send(response, status, 'application/json; charset=utf-8', JSON.stringify(value));
}

/**
 * @param {ServerResponse} response @param {number} status @param {string} type
 * @param {string | Buffer} body @param {Record<string, string>} [headers]
 */
function send(response, status, type, body, headers = { 'cache-control': 'no-store' }) {
  response.writeHead(status, { 'content-type': type, ...headers });
  response.end(body);
}

/** @param {ServerResponse} response @param {string} location */
function redirect(response, location) {
  response.writeHead(302, { location });
  response.end();
}
