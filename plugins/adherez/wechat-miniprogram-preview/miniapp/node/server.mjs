// @ts-check
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import path from 'node:path';
import { createMcpHandler, errorPayload, invalidArguments, validateArguments } from './mcp.mjs';
import { createPreviewService } from './preview-service.mjs';
import { createPreviewShells } from './preview-shells.mjs';
import { scopeCssAssets } from './preview-assets.mjs';
import { rewriteCssUrls } from '../client/css-urls.mjs';
import { capsuleMarkup } from './preview-chrome.mjs';

const STATIC_FILES = new Map([
  ['shell.js', 'text/javascript; charset=utf-8'], ['shell.css', 'text/css; charset=utf-8'],
  ['device-config.js', 'text/javascript; charset=utf-8'], ['icons.js', 'text/javascript; charset=utf-8'],
  ['preview-chrome.css', 'text/css; charset=utf-8'],
  ['sim-runtime.js', 'text/javascript; charset=utf-8'], ['sim-base.css', 'text/css; charset=utf-8'],
  ['game-runtime.js', 'text/javascript; charset=utf-8'], ['game-runtime.css', 'text/css; charset=utf-8'],
  ['vendor/component-runtime.js', 'text/javascript; charset=utf-8'],
]);
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
  '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
};
const MAX_BODY_BYTES = 1024 * 1024 + 65536;
const MAX_DOCUMENT_BYTES = 160 * 1024 * 1024;
const DOCUMENT_BOOTSTRAP = `(function(){'use strict';var node=document.getElementById('wx-preview-document');var data=JSON.parse(node.textContent);node.remove();window.__WX_BUILD__=data.build;window.__WX_PREVIEW_FRAME__=data.frame;var style=document.createElement('style');style.textContent=data.css;document.head.appendChild(style);}());`;
const id = { type: 'string', pattern: '^[\\w-]{1,100}$', maxLength: 100 };
const route = { type: 'string', minLength: 1, maxLength: 2048 };
const query = { type: 'object', maxProperties: 100, additionalProperties: { type: ['string', 'number', 'boolean'], maxLength: 2048 } };
const projectKind = { type: 'string', enum: ['miniprogram', 'minigame'] };
const example = { type: 'string', enum: ['miniprogram', 'minigame-2d', 'minigame-webgl'] };
const object = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const previewArg = { preview_id: id };
const identityProperties = { serverEpoch: id, previewId: id, projectId: id, buildId: id, clientId: id, instanceId: id,
  leaseEpoch: { type: 'integer', minimum: 1 } };
const frameIdentity = object(identityProperties, Object.keys(identityProperties));
const shellReport = object({ revision: { type: 'integer', minimum: 1 }, identity: { ...frameIdentity, type: ['object', 'null'] },
  contextLeaseEpoch: { type: 'integer', minimum: 0 }, status: { type: 'string', enum: ['ready', 'waiting', 'startup_error', 'storage_conflict', 'storage_timeout', 'outcome_unknown', 'document_failed', 'reconnect_required', 'disconnected', 'ownership_lost', 'closed'] },
  dirty: { type: 'boolean' }, exportAvailable: { type: 'boolean' }, operationId: id, message: { type: 'string', maxLength: 1000 } },
['revision', 'identity', 'contextLeaseEpoch', 'status', 'dirty', 'exportAvailable']);
const recoveryInput = object({ preview_id: id, client_id: id, state_revision: { type: 'integer', minimum: 1 }, request_id: id,
  action: { type: 'string', enum: ['retry', 'export_local', 'discard_local', 'takeover', 'close'] }, confirmed: { type: 'boolean' } },
['preview_id', 'client_id', 'state_revision', 'action']);
const storageData = { type: 'object', maxProperties: 100000 };
const drainProperties = { ...identityProperties, operationId: id, dirty: { type: 'boolean' }, baseRevision: { type: 'integer', minimum: 0 },
  data: storageData, expectedLeaseEpoch: { type: 'integer', minimum: 0 } };
const schemas = {
  frame: object({ action: { type: 'string', enum: ['attach', 'reload', 'takeover'] }, serverEpoch: id, previewId: id, projectId: id,
    expectedLeaseEpoch: { type: 'integer', minimum: 0 }, operationId: id, next: object({ buildId: id, clientId: id, instanceId: id }, ['buildId', 'clientId', 'instanceId']),
    previous: frameIdentity, dirty: { type: 'boolean' }, baseRevision: { type: 'integer', minimum: 0 }, data: storageData },
  ['action', 'serverEpoch', 'previewId', 'projectId', 'expectedLeaseEpoch', 'operationId', 'next', 'dirty']),
  storage: object({ ...identityProperties, operationId: id, baseRevision: { type: 'integer', minimum: 0 }, data: storageData, drain: { type: 'boolean' } },
    [...Object.keys(identityProperties), 'operationId', 'baseRevision', 'data']),
  route: object({ ...identityProperties, route, title: { type: 'string', maxLength: 200 } }, [...Object.keys(identityProperties), 'route']),
  'preview-status': object({ ...identityProperties, status: { type: 'string', enum: ['rendered', 'limited', 'error'] }, details: { type: 'array', maxItems: 100,
    items: object({ code: { type: 'string', maxLength: 100 }, message: { type: 'string', maxLength: 2000 }, route: { type: 'string', maxLength: 2048 } }, ['message']) } }, [...Object.keys(identityProperties), 'status', 'details']),
  logs: object({ ...identityProperties, entries: { type: 'array', maxItems: 100, items: object({ level: { type: 'string', enum: ['log', 'info', 'warn', 'error', 'debug'] },
    message: { type: 'string', maxLength: 4000 }, source: { type: 'string', enum: ['console', 'runtime', 'build'] }, route: { type: 'string', maxLength: 2048 } }, ['message']) } }, [...Object.keys(identityProperties), 'entries']),
  navigate: object({ previewId: id, page: route, query }, ['previewId', 'page']),
  rebuild: object({ previewId: id, serverEpoch: id }, ['previewId']),
  close: object(drainProperties, ['previewId', 'serverEpoch', 'projectId', 'operationId', 'dirty']),
  detach: object(drainProperties, ['previewId', 'serverEpoch', 'projectId', 'operationId', 'dirty']),
  project: object({ ...drainProperties, targetProjectId: id }, ['previewId', 'serverEpoch', 'projectId', 'operationId', 'dirty', 'targetProjectId']),
  'force-close': object({ previewId: id, projectId: id, serverEpoch: id, expectedLeaseEpoch: { type: 'integer', minimum: 0 }, operationId: id, confirmDiscard: { type: 'boolean', enum: [true] } },
    ['previewId', 'projectId', 'serverEpoch', 'expectedLeaseEpoch', 'operationId', 'confirmDiscard']),
  device: object({ previewId: id, serverEpoch: id, expectedLeaseEpoch: { type: 'integer', minimum: 0 }, clientId: id,
    deviceId: { type: 'string', enum: ['390x844', '375x667', '430x932'] } }, ['previewId', 'serverEpoch', 'expectedLeaseEpoch', 'deviceId']),
  'game-control': object({ ...identityProperties, action: { type: 'string', enum: ['pause', 'resume', 'restart'] } }, [...Object.keys(identityProperties), 'action']),
  'game-state': object({ ...identityProperties, paused: { type: 'boolean' }, reason: { type: 'string', maxLength: 100 }, framesPerSecond: { type: 'number', minimum: 1, maximum: 60 } }, [...Object.keys(identityProperties), 'paused']),
};

function httpStatus(code) {
  if (['FORBIDDEN', 'INVALID_HOST', 'CONFIRMATION_REQUIRED', 'PROJECT_ACCESS_REQUIRED', 'PROJECT_PATH_FORBIDDEN'].includes(code)) return 403;
  if (['NOT_FOUND', 'PREVIEW_CONTEXT_NOT_FOUND', 'PROJECT_NOT_FOUND', 'BUILD_NOT_AVAILABLE'].includes(code)) return 404;
  if (code === 'BODY_TOO_LARGE') return 413;
  if (code === 'INTERNAL_ERROR') return 500;
  if (/^(STALE_|STORAGE_CONFLICT|STORAGE_OPERATION_CONFLICT|OPERATION_ID_REUSED|TRANSITION_OUTCOME_UNKNOWN|PREVIEW_IN_USE|PREVIEW_RECOVERING|PREVIEW_REQUIRES_DRAIN|NO_PREVIEW_CONTEXT|AMBIGUOUS_PREVIEW_CONTEXT|BUILD_CAPACITY|PREVIEW_CAPACITY|PROJECT_CAPACITY|SHELL_|RECOVERY_)/.test(code)) return 409;
  return 400;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0; let oversized = false;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { oversized = true; chunks.length = 0; return; }
      if (!oversized) chunks.push(chunk);
    });
    request.on('end', () => {
      if (oversized) return reject(Object.assign(new Error('请求内容超出预览上限。'), { code: 'BODY_TOO_LARGE' }));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(invalidArguments('请求必须是有效 JSON。')); }
    });
    request.on('aborted', () => reject(invalidArguments('请求已中断。')));
    request.on('error', reject);
  });
}

/** The Host owns process identity/authentication; this entry owns only preview HTTP routing. */
export async function start(context) {
  if (!context.listen || !['127.0.0.1', '::1', 'localhost'].includes(context.listen.host)
    || !Number.isSafeInteger(context.listen.port) || context.listen.port < 1 || context.listen.port > 65535) throw invalidArguments('Mini App Host 必须提供有效的本地监听地址。');
  const clientRoot = path.join(context.pluginRoot, 'miniapp', 'client');
  const shellHtml = await readFile(path.join(clientRoot, 'index.html'));
  const metadata = JSON.parse(await readFile(path.join(context.pluginRoot, 'package.json'), 'utf8'));
  const scriptNames = ['device-config.js', 'vendor/component-runtime.js', 'sim-runtime.js', 'game-runtime.js'];
  const sources = new Map(await Promise.all(scriptNames.map(async (name) => [name, await readFile(path.join(clientRoot, name), 'utf8')])));
  const escapeScript = (source) => source.replace(/<\/script/gi, (match) => match.replace('/', '\\/'));
  const trustedScriptsByKind = {
    miniprogram: [DOCUMENT_BOOTSTRAP, sources.get('device-config.js'), sources.get('vendor/component-runtime.js'), sources.get('sim-runtime.js')].map(escapeScript),
    minigame: [DOCUMENT_BOOTSTRAP, sources.get('device-config.js'), sources.get('game-runtime.js')].map(escapeScript),
  };
  const trustedHashes = [...new Set(Object.values(trustedScriptsByKind).flat().map((source) => `'sha256-${createHash('sha256').update(source).digest('base64')}'`))].join(' ');
  const chromeStyles = await readFile(path.join(clientRoot, 'preview-chrome.css'), 'utf8');
  const stylesByKind = {
    miniprogram: chromeStyles + '\n' + await readFile(path.join(clientRoot, 'sim-base.css'), 'utf8'),
    minigame: chromeStyles + '\n' + await readFile(path.join(clientRoot, 'game-runtime.css'), 'utf8'),
  };
  const documentPolicy = `default-src 'none'; script-src ${trustedHashes} 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob: https:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  const service = await createPreviewService(context);
  const shells = createPreviewShells(service);
  const snapshot = (previewId) => {
    let value;
    try { value = service.snapshot(previewId); }
    catch (error) {
      if (error.code !== 'PREVIEW_CONTEXT_NOT_FOUND' || !previewId || !shells.list(previewId).length) throw error;
      value = { ok: true, previewId, closed: true, nextStep: 'recover_preview' };
    }
    return { ...value, recoveryShells: shells.list(value.previewId) };
  };
  const streams = new Set();
  const expectedHost = `${context.listen.host.includes(':') ? `[${context.listen.host}]` : context.listen.host}:${context.listen.port}`;
  const expectedOrigin = `http://${expectedHost}`;
  let disposed = false; let disposal;
  const send = (response, status, body, type = 'application/json; charset=utf-8', extra = {}) => {
    response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra });
    response.end(body);
  };
  const json = (response, value) => send(response, 200, JSON.stringify(value));
  const trusted = (request) => (!request.headers.origin || request.headers.origin === expectedOrigin)
    && (!request.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(request.headers['sec-fetch-site']));
  const confirm = (request, action) => {
    if (request.headers.origin !== expectedOrigin || request.headers['x-preview-user-action'] !== action) fail('CONFIRMATION_REQUIRED', '此操作需要在预览界面明确确认。');
  };
  const openSchema = object({ ...previewArg, create_new: { type: 'boolean' }, project_path: { type: 'string', minLength: 1, maxLength: 4096 },
    project_id: id, projectId: id, project_kind: projectKind, demo: { type: 'boolean' }, example, page: route, query });
  const mcp = createMcpHandler({ name: metadata.name, version: metadata.version, tools: [
    { name: 'preview_open_project', description: 'Load and compile the original WeChat Mini Program/Game project directly; no extra directory authorization. Select preview_id or create_new, and project_kind if ambiguous. This does not display a tab: execute returned hostOpenAction with miniapp, then verify status and the actual page. Never create a replacement HTML Mini App. Games reject page/query.',
      inputSchema: object({ ...previewArg, create_new: { type: 'boolean' }, project_path: openSchema.properties.project_path, project_kind: projectKind, page: route, query }, ['project_path']), handler: (args) => service.openProject(args) },
    { name: 'preview_status', description: 'Read build, actual connection/runtime, bounded diagnostics and Shell recovery metadata. Build success alone is not displayed preview success. An omitted ID is accepted only when one preview exists.', inputSchema: object(previewArg), handler: (args) => snapshot(args.preview_id) },
    { name: 'preview_logs', description: 'Read bounded console and runtime logs for one preview.', inputSchema: object({ ...previewArg, limit: { type: 'integer', minimum: 1, maximum: 200 },
      level: { type: 'string', enum: ['all', 'warn', 'error'] }, after_seq: { type: 'integer', minimum: 0 } }), handler: (args) => service.logs(args.preview_id, { limit: args.limit, level: args.level, afterSeq: args.after_seq }) },
    { name: 'preview_navigate', description: 'Request navigation in one preview. Accepted means queued, not rendered; read status to confirm.', inputSchema: object({ ...previewArg, page: route, query }, ['page']), handler: (args) => service.navigate(args.preview_id, args.page, args.query) },
    { name: 'preview_rebuild', description: 'Rebuild a preview project and request reload for the selected context. Storage conflicts keep the old frame.', inputSchema: object(previewArg), handler: (args) => service.rebuild(args.preview_id) },
    { name: 'preview_list', description: 'List bounded preview IDs and hostOpenAction paths; choose the requested project instead of guessing or taking over another window.', inputSchema: object(), handler: () => service.list() },
    { name: 'preview_game_control', description: 'Pause, resume or restart a selected Mini Game preview. Accepted means queued; read status to confirm. Mini Programs reject this action.', inputSchema: object({ ...previewArg, action: { type: 'string', enum: ['pause', 'resume', 'restart'] } }, ['action']), handler: (args) => service.controlGame(args.preview_id, args.action) },
    { name: 'preview_recover', description: 'Recover the specific live Shell named in preview_status.recoveryShells. Use its current clientId/state.revision and an available action. retry does not discard data; export_local requests a local download, not MCP data. discard_local/takeover/close require explicit user confirmation and confirmed=true. Accepted is not completion; reread status, never blindly repeat with a new request_id.', inputSchema: recoveryInput, handler: (args) => shells.request(args) },
    { name: 'preview_close', description: 'Close an idle preview only after user confirmation, using its current serverEpoch/leaseEpoch from preview_status. Never evicts an active page or deletes source/Storage. For a live Shell, use its available close recovery action to drain safely.',
      inputSchema: object({ preview_id: id, server_epoch: id, expected_lease_epoch: { type: 'integer', minimum: 0 }, confirmed: { type: 'boolean', enum: [true] } }, ['preview_id', 'server_epoch', 'expected_lease_epoch', 'confirmed']),
      handler: (args) => service.closeIdle(args.preview_id, { serverEpoch: args.server_epoch, expectedLeaseEpoch: args.expected_lease_epoch, confirmed: args.confirmed }) },
  ] });

  const shellEvents = async (channelId, request, response) => {
    if (streams.size >= 64) fail('PREVIEW_CAPACITY_REACHED', '页面连接数量已达到上限。');
    let subscription, previewSubscription, ping, ended = false, ready = false; const pending = [];
    const close = () => { if (ended) return; ended = true; clearInterval(ping); subscription?.(); previewSubscription?.dispose(); streams.delete(close); if (!response.writableEnded) response.end(); };
    const write = (event, data) => {
      if (ended) return;
      if (!ready) { if (pending.length < 100) pending.push([event, data]); return; }
      if (response.writableLength > MAX_BODY_BYTES) { close(); return; }
      response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      if (event === 'channel-retired') close();
    };
    const binding = shells.binding(channelId);
    subscription = shells.subscribe(channelId, write); streams.add(close); response.on('close', close);
    try {
      let state;
      try { state = service.snapshot(binding.previewId); }
      catch (error) { if (error.code !== 'PREVIEW_CONTEXT_NOT_FOUND') throw error; }
      if (state && state.projectId === binding.projectId && state.serverEpoch === binding.serverEpoch) {
        previewSubscription = await service.subscribe(binding.previewId, (event, data) => {
          write(event, data);
          if (event === 'closed' || event === 'state' && data.projectId !== binding.projectId) previewSubscription?.dispose();
        });
      }
    } catch (error) { subscription?.(); previewSubscription?.dispose(); streams.delete(close); response.off('close', close); throw error; }
    if (ended || disposed) { previewSubscription?.dispose(); close(); return; }
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-content-type-options': 'nosniff' });
    ready = true; write('connected', { ok: true });
    if (previewSubscription) write('state', previewSubscription.state);
    for (const [event, data] of pending) write(event, data);
    ping = setInterval(() => { if (!ended) response.write(': ping\n\n'); }, 20000); ping.unref?.();
  };

  const events = async (previewId, request, response) => {
    if (streams.size >= 32) fail('PREVIEW_CAPACITY_REACHED', '预览连接数量已达到上限。');
    let ended = false; let ready = false; const pending = [];
    let subscription; let ping;
    const close = () => { if (ended) return; ended = true; clearInterval(ping); subscription?.dispose(); streams.delete(close); if (!response.writableEnded) response.end(); };
    streams.add(close);
    response.on('close', close);
    const write = (event, data) => {
      if (ended) return;
      if (!ready) { if (pending.length < 100) pending.push([event, data]); return; }
      if (response.writableLength > MAX_BODY_BYTES) { close(); return; }
      response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      if (event === 'closed') close();
    };
    try { subscription = await service.subscribe(previewId, write); }
    catch (error) { streams.delete(close); response.off('close', close); throw error; }
    if (ended || disposed) { subscription.dispose(); close(); return; }
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-content-type-options': 'nosniff' });
    ready = true;
    write('state', subscription.state);
    for (const [event, data] of pending) write(event, data);
    if (ended) return;
    ping = setInterval(() => { if (!ended) response.write(': ping\n\n'); }, 20000);
    ping.unref?.();
  };

  const handle = async (request, response) => {
    if (disposed) fail('PREVIEW_STOPPING', '预览服务正在停止。');
    if (request.headers.host !== expectedHost) fail('INVALID_HOST', '请求地址无效。');
    const url = new URL(request.url ?? '/', expectedOrigin);
    const pathname = url.pathname;
    if (pathname === '/mcp/preview') {
      if (request.headers.origin || !trusted(request)) fail('FORBIDDEN', '页面不能直接调用 Agent 接口。');
      return mcp(request, response, readJsonBody);
    }
    if (request.method === 'GET' && ['/preview', '/preview/'].includes(pathname)) return send(response, 200, shellHtml, 'text/html; charset=utf-8', {
      'content-security-policy': `default-src 'self'; script-src 'self' ${trustedHashes} 'unsafe-eval'; style-src 'self' 'unsafe-inline'; frame-src 'self' data:; connect-src 'self'; img-src 'self' data: blob: https:; font-src 'self' data:; media-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'none'`,
    });
    if (request.method === 'GET' && pathname.startsWith('/static/')) {
      const name = pathname.slice(8); const type = STATIC_FILES.get(name);
      if (!type) fail('NOT_FOUND', '资源不存在。');
      return send(response, 200, await readFile(path.join(clientRoot, name)), type);
    }
    if (pathname.startsWith('/api/')) {
      if (!trusted(request)) fail('FORBIDDEN', '请求必须来自预览界面。');
      if (!['GET', 'POST'].includes(request.method)) { response.writeHead(405, { allow: 'GET, POST' }); response.end(); return; }
      let body;
      if (request.method === 'POST') {
        if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')) throw invalidArguments('请求需要 application/json。');
        body = await readJsonBody(request);
        validateArguments(body, { type: 'object' });
      }
      if (pathname === '/api/shells' && request.method === 'POST') {
        if (request.headers.origin !== expectedOrigin) fail('FORBIDDEN', '恢复通道只能由同源预览页面建立。');
        validateArguments(body, object({ previewId: id, clientId: id, serverEpoch: id, registrationId: { ...id, minLength: 16 } }, ['previewId', 'clientId', 'serverEpoch', 'registrationId']));
        return json(response, shells.register(body));
      }
      const shellRoute = pathname.match(/^\/api\/shells\/([\w-]{1,100})\/(events|state|ack)$/);
      if (shellRoute) {
        const [, channelId, action] = shellRoute;
        if (action === 'events' && request.method === 'GET') return shellEvents(channelId, request, response);
        if (request.method !== 'POST' || request.headers.origin !== expectedOrigin) fail('FORBIDDEN', '页面恢复操作需要同源请求。');
        if (action === 'state') { validateArguments(body, shellReport); return json(response, shells.report(channelId, body)); }
        if (action === 'ack') {
          validateArguments(body, object({ requestId: id, stateRevision: { type: 'integer', minimum: 1 }, status: { type: 'string', enum: ['completed', 'failed', 'export_requested'] }, message: { type: 'string', maxLength: 1000 } }, ['requestId', 'stateRevision', 'status']));
          return json(response, shells.acknowledge(channelId, body));
        }
        fail('NOT_FOUND', '恢复接口不存在。');
      }
      if (pathname === '/api/previews') {
        if (request.method === 'GET') return json(response, service.list());
        validateArguments(body, openSchema);
        if (body.projectId !== undefined) {
          if (body.project_id !== undefined) throw invalidArguments('工程标识重复。');
          body.project_id = body.projectId; delete body.projectId;
        }
        const choices = [body.demo === true, body.project_path !== undefined, body.project_id !== undefined].filter(Boolean).length;
        if (choices !== 1) throw invalidArguments('请选择一个工程或内置示例。');
        if (body.example !== undefined && body.demo !== true) throw invalidArguments('example 仅用于内置示例。');
        if (body.demo === true) { const { demo, ...options } = body; return json(response, await service.demo(options)); }
        return json(response, await service.openProject(body));
      }
      if (pathname === '/api/demo' && request.method === 'POST') {
        validateArguments(body, object({ ...previewArg, create_new: { type: 'boolean' }, example }));
        return json(response, await service.demo(body));
      }
      const scoped = pathname.match(/^\/api\/previews\/([\w-]{1,100})\/(state|events|logs|storage|frame|route|preview-status|navigate|rebuild|close|force-close|project|detach|device|operations|document|game-control|game-state)(?:\/([\w-]{1,100})(\/recover)?)?$/);
      const legacy = pathname.match(/^\/api\/(state|events|logs|storage|frame|route|preview-status|navigate|rebuild)$/);
      if (!scoped && !legacy) fail('NOT_FOUND', '接口不存在。');
      const previewId = scoped ? scoped[1] : service.snapshot().previewId;
      const action = scoped ? scoped[2] : legacy[1];
      const operationId = scoped?.[3];
      if (action !== 'operations' && operationId) fail('NOT_FOUND', '接口不存在。');
      if (request.method === 'GET') {
        if (action === 'state') return json(response, snapshot(previewId));
        if (action === 'document') {
          const queryFields = Object.fromEntries(url.searchParams);
          validateArguments(queryFields, object({ serverEpoch: id, buildId: id, clientId: id, instanceId: id, leaseEpoch: { type: 'string', pattern: '^\\d+$', maxLength: 16 } },
            ['serverEpoch', 'buildId', 'clientId', 'instanceId', 'leaseEpoch']));
          const state = service.snapshot(previewId);
          const input = { ...queryFields, previewId, projectId: state.projectId, leaseEpoch: Number(queryFields.leaseEpoch) };
          const snapshot = await service.snapshotDocument(input);
          const kind = snapshot.artifact.payload.projectKind ?? 'miniprogram';
          const trustedScripts = trustedScriptsByKind[kind];
          const baseStyles = stylesByKind[kind];
          if (!trustedScripts) fail('INVALID_BUILD_RESULT', '不支持的工程类型。');
          const assets = Object.fromEntries(snapshot.assets.map(({ path: name, bytes }) => [name, `data:${MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream'};base64,${bytes.toString('base64')}`]));
          let documentBytes = Buffer.byteLength(JSON.stringify(snapshot.artifact.payload)) + Buffer.byteLength(JSON.stringify(assets))
            + Buffer.byteLength(baseStyles) + Buffer.byteLength(snapshot.artifact.css) + trustedScripts.reduce((total, script) => total + Buffer.byteLength(script), 0);
          const reserveDocumentBytes = (bytes) => {
            documentBytes += bytes;
            if (documentBytes > MAX_DOCUMENT_BYTES) fail('BUILD_TOO_LARGE', '自包含预览文档超过大小上限。');
          };
          reserveDocumentBytes(0);
          const inlineAsset = (url) => {
            if (!url.startsWith('asset/')) return url;
            const hash = url.includes('#') ? url.slice(url.indexOf('#')) : '';
            const name = url.slice(6).split(/[?#]/)[0];
            if (!Object.hasOwn(assets, name)) return 'data:,';
            reserveDocumentBytes(assets[name].length + hash.length);
            return assets[name] + hash;
          };
          const build = kind === 'minigame' ? snapshot.artifact.payload
            : { ...snapshot.artifact.payload, componentStyles: Object.fromEntries(Object.entries(snapshot.artifact.payload.componentStyles ?? {}).map(([key, css]) => [key, rewriteCssUrls(css, inlineAsset)])) };
          const data = { build, frame: { ...snapshot.identity, assets }, css: baseStyles + '\n' + rewriteCssUrls(snapshot.artifact.css, inlineAsset) };
          const childHashes = trustedScripts.map((source) => `'sha256-${createHash('sha256').update(source).digest('base64')}'`).join(' ');
          const policy = documentPolicy.replace(trustedHashes, childHashes);
          const html = renderDocument(snapshot.artifact, previewId, data, policy, trustedScripts);
          if (Buffer.byteLength(html) > MAX_DOCUMENT_BYTES) fail('BUILD_TOO_LARGE', '自包含预览文档超过大小上限。');
          return json(response, { ok: true, identity: snapshot.identity, html });
        }
        if (action === 'events') return events(previewId, request, response);
        if (action === 'logs') {
          const options = { ...(url.searchParams.has('limit') ? { limit: Number(url.searchParams.get('limit')) } : {}),
            ...(url.searchParams.has('level') ? { level: url.searchParams.get('level') } : {}),
            ...(url.searchParams.has('after_seq') ? { afterSeq: Number(url.searchParams.get('after_seq')) } : {}) };
          validateArguments(options, object({ limit: { type: 'integer', minimum: 1, maximum: 200 }, level: { type: 'string', enum: ['all', 'warn', 'error'] }, afterSeq: { type: 'integer', minimum: 0 } }));
          return json(response, service.logs(previewId, options));
        }
        if (action === 'storage') {
          const expected = url.searchParams.size ? Object.fromEntries(url.searchParams) : undefined;
          if (expected) validateArguments(expected, object({ projectId: id, serverEpoch: id }, ['projectId', 'serverEpoch']));
          return json(response, await service.readStorage(previewId, undefined, expected));
        }
        if (action === 'operations' && operationId && !scoped[4]) return json(response, await service.operation(previewId, operationId));
        fail('NOT_FOUND', '接口不存在。');
      }
      if (body.previewId !== undefined && body.previewId !== previewId) throw invalidArguments('请求上下文与路径不一致。');
      body = { ...body, previewId };
      if (action === 'operations' && operationId && scoped[4]) {
        if (body.operationId !== undefined && body.operationId !== operationId) throw invalidArguments('操作标识不一致。');
        body.operationId = operationId;
        validateArguments(body, object({ serverEpoch: id, previewId: id, operationId: id, clientId: id }, ['serverEpoch', 'previewId', 'operationId', 'clientId']));
        return json(response, await service.recover(body));
      }
      if (!schemas[action]) fail('NOT_FOUND', '接口不存在。');
      validateArguments(body, schemas[action]);
      if (action === 'frame') return json(response, await service.transition(body));
      if (action === 'storage') return json(response, await service.commitStorage(body));
      if (action === 'route') return json(response, await service.route(body, body.route, body.title));
      if (action === 'preview-status') return json(response, await service.status(body, body.status, body.details));
      if (action === 'game-control') return json(response, await service.controlGame(previewId, body.action, body));
      if (action === 'game-state') return json(response, await service.gameState(body, body));
      if (action === 'logs') return json(response, await service.appendLogs(body, body.entries));
      if (action === 'navigate') return json(response, await service.navigate(previewId, body.page, body.query));
      if (action === 'rebuild') return json(response, await service.rebuild(previewId, { serverEpoch: body.serverEpoch }));
      if (action === 'device') return json(response, await service.setDevice(previewId, body));
      if (action === 'close') return json(response, await service.drain(body, { close: true }));
      if (action === 'detach') return json(response, await service.drain(body, { detach: true }));
      if (action === 'project') { const { targetProjectId, ...input } = body; return json(response, await service.drain(input, { nextProjectId: targetProjectId })); }
      if (action === 'force-close') {
        confirm(request, 'force-close');
        const { confirmDiscard, ...input } = body;
        return json(response, await service.forceClose({ ...input, confirmed: true }));
      }
    }
    const sim = pathname.match(/^\/sim\/([0-9a-f]{12})\/([\w-]{1,100})\/(.+)$/);
    if (sim && request.method === 'GET') {
      const [, projectId, buildId, rest] = sim;
      const previewId = url.searchParams.get('previewId') ?? service.snapshot().previewId;
      validateArguments(previewId, id);
      // Access is checked against the frame's pinned build, never a mutable latest build.
      const result = await service.artifact(previewId, projectId, buildId);
      if (result.payload.projectKind === 'minigame') fail('UNSUPPORTED_PROJECT_ACTION', '小游戏仅通过认证的自包含预览文档打开，不支持旧小程序调试资源路径。');
      if (rest === 'index.html') return send(response, 200, renderSimHtml(result, previewId), 'text/html; charset=utf-8', {
        'content-security-policy': "sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; media-src 'self' blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
        'referrer-policy': 'no-referrer',
      });
      if (rest === 'bundle.js') {
        const payload = { ...result.payload, componentStyles: Object.fromEntries(Object.entries(result.payload.componentStyles ?? {}).map(([name, css]) => [name, scopeCssAssets(css, previewId)])) };
        return send(response, 200, `window.__WX_BUILD__ = ${JSON.stringify(payload).replace(/</g, '\\u003c')};\n`, 'text/javascript; charset=utf-8');
      }
      if (rest === 'app.css') return send(response, 200, scopeCssAssets(result.css, previewId), 'text/css; charset=utf-8');
      if (rest.startsWith('asset/')) {
        let relative;
        try { relative = decodeURIComponent(rest.slice(6)); } catch { throw invalidArguments('资源路径编码无效。'); }
        const bytes = await service.asset(previewId, projectId, buildId, relative);
        if (!bytes) fail('NOT_FOUND', '资源不存在。');
        return send(response, 200, bytes, MIME[path.extname(relative).toLowerCase()] ?? 'application/octet-stream');
      }
    }
    fail('NOT_FOUND', '资源或接口不存在。');
  };
  const server = createServer((request, response) => {
    void handle(request, response).catch((error) => {
      const failure = errorPayload(error);
      context.logger.warn('preview.request.failed', { code: failure.code });
      if (!response.headersSent) send(response, httpStatus(failure.code), JSON.stringify(failure));
      else response.end();
    });
  });
  server.requestTimeout = 15000;
  const dispose = () => {
    if (disposal) return disposal;
    disposed = true; context.signal.removeEventListener('abort', onAbort);
    for (const close of [...streams]) close();
    shells.dispose();
    disposal = (async () => {
      await new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); });
      await service.dispose();
    })();
    return disposal;
  };
  const onAbort = () => { void dispose().catch(() => undefined); };
  try {
    await new Promise((resolve, reject) => {
      const onError = (error) => reject(error);
      server.once('error', onError);
      server.listen(context.listen.port, context.listen.host, () => { server.off('error', onError); resolve(); });
    });
  } catch (error) { shells.dispose(); await service.dispose(); throw error; }
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();
  context.logger.info('preview.runtime.listening');
  return { dispose };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
}


function renderDocument(result, previewId, data, policy, scripts) {
  const html = result.payload.projectKind === 'minigame'
    ? `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(result.manifest.projectName)}</title></head><body>${capsuleMarkup}</body></html>`
    : renderSimHtml(result, previewId).replace(/<link rel="stylesheet"[^>]*>\n/g, '').replace(/<script src="[^"]*"><\/script>\n/g, '');
  const encoded = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return html.replace('<meta charset="utf-8">', () => `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${escapeHtml(policy)}">`)
    .replace('</body>', () => `<script type="application/json" id="wx-preview-document">${encoded}</script>\n${scripts.map((script) => `<script>${script}</script>`).join('\n')}\n</body>`);
}

function renderSimHtml(result, previewId) {
  const search = `?previewId=${encodeURIComponent(previewId)}`;
  // Keep the decorative capsule at body level, like the native preview chrome.
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>${escapeHtml(result.manifest.projectName)}</title>
<link rel="stylesheet" href="../../../static/preview-chrome.css">
<link rel="stylesheet" href="../../../static/sim-base.css">
<link rel="stylesheet" href="app.css${search}">
</head>
<body${result.payload.styleV2 ? ' data-style-v2' : ''}>
<div id="wx-status" aria-hidden="true">
  <span class="wx-status-time">9:41</span>
  <span class="wx-status-icons">
    <svg class="wx-wifi" width="16" height="12" viewBox="0 0 16 12" fill="none" focusable="false"><path d="M1 3.6a10.2 10.2 0 0 1 14 0M3.7 6.4a6.3 6.3 0 0 1 8.6 0M6.4 9.1a2.3 2.3 0 0 1 3.2 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="11" r="1" fill="currentColor"/></svg>
    <svg class="wx-battery" width="25" height="12" viewBox="0 0 25 12" fill="none" focusable="false"><rect x=".5" y=".5" width="21" height="11" rx="2.5" stroke="currentColor" opacity=".4"/><rect x="2.5" y="2.5" width="17" height="7" rx="1" fill="currentColor"/><path d="M23 4v4a2 2 0 0 0 0-4Z" fill="currentColor" opacity=".4"/></svg>
  </span>
</div>
<header id="wx-nav">
  <button id="wx-back" type="button" aria-label="返回" hidden><svg width="24" height="24" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false"><path d="M10 4L6 8L10 12" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
  <h1 id="wx-title"></h1>
</header>
${capsuleMarkup}
<main id="wx-viewport"></main>
<nav id="wx-tabbar" role="tablist" hidden></nav>
<div id="wx-overlay"></div>
<script src="bundle.js${search}"></script>
<script src="../../../static/device-config.js"></script>
<script src="../../../static/vendor/component-runtime.js"></script>
<script src="../../../static/sim-runtime.js"></script>
</body>
</html>`;
}
