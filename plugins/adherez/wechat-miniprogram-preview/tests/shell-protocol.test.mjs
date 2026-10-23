import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createPreviewShells } from '../miniapp/node/preview-shells.mjs';

const client = (file) => readFile(new URL('../miniapp/client/' + file, import.meta.url), 'utf8');
const [html, shell, devices] = await Promise.all(['index.html', 'shell.js', 'device-config.js'].map(client));
const clone = (value) => JSON.parse(JSON.stringify(value));
const response = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
const error = (code, message = code, details) => response({ ok: false, code, message, details }, 409);
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve)); };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

async function setup(t, { selected = 'pv_one', owner = false, intercept, autoQuiesce = true, game = false, deviceId = '390x844', gameOrientation = 'landscape', autoDispose = true, realRecovery = false } = {}) {
  const dom = new JSDOM(html, { url: 'http://preview.test/preview' + (selected ? '?previewId=' + selected : ''), runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  t.after(() => dom.window.close());
  const win = dom.window, get = (id) => win.document.getElementById(id), requests = [], messages = [], streams = [], confirms = [], exports = [], timers = [];
  const projects = [{ id: 'aaaaaaaaaaaa', name: 'Project A', revocable: true }, { id: 'bbbbbbbbbbbb', name: 'Project B', revocable: true }];
  const contexts = new Map(['pv_one', 'pv_two'].map((id, index) => [id, { ok: true, previewId: id, projectId: projects[index].id, activeId: projects[index].id, activeProject: projects[index], projects,
    serverEpoch: 'epoch-one', leaseEpoch: owner && index === 0 ? 1 : 0, lease: owner && index === 0 ? { clientId: 'other', instanceId: 'other-instance', buildId: 'build-one', leaseEpoch: 1 } : null,
    route: '', deviceId, build: { status: 'ok', buildId: 'build-one', manifest: { pages: ['pages/index', 'pages/detail'], entryPage: 'pages/index' }, warnings: [], errors: [] }, runtime: { status: 'waiting', details: [] } }]));
  if (game) {
    projects[0].projectKind = 'minigame';
    const ctx = contexts.get('pv_one'); ctx.projectKind = 'minigame';
    ctx.build.manifest = { projectKind: 'minigame', pages: [], entryPage: null, game: { deviceOrientation: gameOrientation } };
  }
  const saved = new Map(projects.map((p) => [p.id, { revision: 0, data: {} }]));
  const operations = new Map();
  const channels = new Map();
  const registry = realRecovery ? createPreviewShells({ snapshot(id) {
    const context = contexts.get(id);
    if (!context) throw Object.assign(new Error('closed'), { code: 'PREVIEW_CONTEXT_NOT_FOUND' });
    return clone(context);
  } }) : null;
  t.after(() => registry?.dispose());
  const realTimer = win.setTimeout.bind(win);
  const realClear = win.clearTimeout.bind(win);
  win.setTimeout = (fn, delay, ...args) => { if ([800, 2000, 4000, 8000, 10000].includes(delay)) { const handle = realTimer(() => {}, 60000); timers.push({ fn, delay, handle, active: true }); return handle; } return realTimer(fn, delay, ...args); };
  win.clearTimeout = (handle) => { const timer = timers.find((entry) => entry.handle === handle); if (timer) timer.active = false; realClear(handle); };
  win.matchMedia = () => ({ matches: false, addEventListener() {} }); win.ResizeObserver = class { observe() {} };
  win.TextEncoder = TextEncoder;
  win.confirm = (text) => { confirms.push(text); return true; };
  win.URL.createObjectURL = (blob) => { exports.push(blob); return 'blob:storage'; }; win.URL.revokeObjectURL = () => {};
  win.HTMLAnchorElement.prototype.click = function () { exports.push({ name: this.download, url: this.href }); };
  win.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  win.HTMLDialogElement.prototype.close = function () { if (!this.open) return; this.open = false; this.dispatchEvent(new win.Event('close')); };
  win.EventSource = class {
    constructor(url) {
      this.url = url; this.events = new Map(); this.closed = false; streams.push(this);
      const channelId = /^\/api\/shells\/([^/]+)\/events$/.exec(url)?.[1];
      if (registry && channelId) this.disconnect = registry.subscribe(channelId, (name, data) => this.events.get(name)?.({ data: JSON.stringify(data) }));
    }
    addEventListener(name, callback) { this.events.set(name, callback); }
    close() { this.closed = true; this.disconnect?.(); }
  };
  let instanceCounter = 0;
  const prepare = (iframe) => {
    iframe.runtimeStorage = {};
    const contentWindow = { close() {}, postMessage(message) {
      messages.push(clone(message));
      if (message.type === 'init') iframe.runtimeStorage = clone(message.storage);
      if (message.type === 'quiesce-storage' && autoQuiesce) queueMicrotask(() => send({ type: 'storage-flushed', requestId: message.requestId, storage: iframe.runtimeStorage }, { iframe }));
      if (message.type === 'dispose' && autoDispose) queueMicrotask(() => send({ type: 'game-disposed', requestId: message.requestId }, { iframe }));
    } };
    Object.defineProperty(iframe, 'contentWindow', { configurable: true, value: contentWindow });
    const originalReplace = iframe.replaceWith.bind(iframe);
    iframe.replaceWith = (replacement) => { prepare(replacement); originalReplace(replacement); };
  };
  prepare(get('simulator'));
  const list = () => ({ ok: true, serverEpoch: 'epoch-one', previews: [...contexts.values()].map((c) => ({ previewId: c.previewId, projectId: c.projectId, name: c.activeProject.name, connected: !!c.lease, surfacePath: '/preview?previewId=' + c.previewId })) });
  const identity = (ctx) => ({ ...ctx.lease, previewId: ctx.previewId, projectId: ctx.projectId, serverEpoch: ctx.serverEpoch });
  const isOwner = (ctx, body) => ctx.lease && Object.entries(identity(ctx)).every(([key, value]) => body[key] === value);
  async function backend(request) {
    const { url, body } = request;
    if (url === '/api/shells') {
      let result;
      try { result = registry?.register(body); } catch (cause) { return error(cause.code, cause.message); }
      const channelId = result?.channelId || 'channel-' + channels.size;
      if (!channels.has(channelId)) channels.set(channelId, { previewId: body.previewId, clientId: body.clientId, serverEpoch: body.serverEpoch, reports: [], acks: [] });
      return response({ ok: true, channelId });
    }
    const channelMatch = /^\/api\/shells\/([^/]+)\/(state|ack)$/.exec(url);
    if (channelMatch) {
      try { if (registry) registry[channelMatch[2] === 'state' ? 'report' : 'acknowledge'](channelMatch[1], body); }
      catch (cause) { return error(cause.code, cause.message); }
      const channel = channels.get(channelMatch[1]); channel[channelMatch[2] === 'state' ? 'reports' : 'acks'].push(clone(body)); return response({ ok: true });
    }
    if (url === '/api/previews' && !body) return response(list());
    if (url === '/api/previews' && body) {
      const project = projects.find((p) => p.id === body.projectId) || projects[0];
      const next = clone(contexts.get('pv_one') || { serverEpoch: 'epoch-one', build: { status: 'ok', buildId: 'build-one', manifest: { pages: ['pages/index'] } }, projects });
      Object.assign(next, { previewId: 'pv_new' + ++instanceCounter, projectId: project.id, activeId: project.id, activeProject: project, lease: null, leaseEpoch: 0, route: '' }); contexts.set(next.previewId, next); return response(clone(next));
    }
    if (url === '/api/projects/open') return response({ ok: true, projectId: projects[1].id, project: { id: projects[1].id, name: projects[1].name } });
    if (url === '/api/projects/revoke') return response({ ok: true });
    const match = /^\/api\/previews\/([^/]+)\/(.*)$/.exec(url);
    if (!match) return error('UNKNOWN_ROUTE');
    const [, id, actionQuery] = match;
    const action = actionQuery.split('?')[0];
    if (action.startsWith('operations/')) return response(operations.has(action.split('/')[1]) ? { ok: true, status: 'committed', result: clone(operations.get(action.split('/')[1])) } : { ok: true, status: 'unknown', committed: false });
    const ctx = contexts.get(id); if (!ctx) return error('PREVIEW_CONTEXT_NOT_FOUND');
    if (action === 'document') {
      const target = identity(ctx);
      return response({ ok: true, identity: target, html: '<!doctype html><meta charset="utf-8"><script type="application/json" id="frame">' + JSON.stringify(target) + '</script><p>isolated preview</p>' });
    }
    if (action === 'state') return response(clone(ctx));
    if (action === 'logs' && !body) return response({ entries: [] });
    if (action === 'storage' && !body) {
      const params = new URL(url, 'http://preview.test').searchParams;
      const expected = params.size ? { projectId: params.get('projectId'), serverEpoch: params.get('serverEpoch') } : null;
      if (expected && (expected.projectId !== ctx.projectId || expected.serverEpoch !== ctx.serverEpoch)) return error('STALE_FRAME');
      return response({ ok: true, ...clone(saved.get(ctx.projectId)), ...(expected ? { ...expected, previewId: ctx.previewId } : {}) });
    }
    if (action === 'frame') {
      if (operations.has(body.operationId)) return response(clone(operations.get(body.operationId)));
      if (body.expectedLeaseEpoch !== ctx.leaseEpoch) return error('STALE_FRAME');
      if (body.action === 'attach' && ctx.lease) return error('PREVIEW_IN_USE');
      if (body.action === 'reload' && !isOwner(ctx, body.previous)) return error('STALE_FRAME');
      const value = saved.get(ctx.projectId);
      if (body.dirty) { if (body.baseRevision !== value.revision) return error('STORAGE_CONFLICT', 'conflict', { revision: value.revision }); value.data = clone(body.data); value.revision++; }
      ctx.leaseEpoch++; ctx.lease = { ...body.next, leaseEpoch: ctx.leaseEpoch };
      const result = { ok: true, operationId: body.operationId, identity: identity(ctx), storage: clone(value) }; operations.set(body.operationId, result); return response(clone(result));
    }
    if (action === 'storage') {
      if (operations.has(body.operationId)) return response(clone(operations.get(body.operationId)));
      if (!isOwner(ctx, body)) return error('STALE_FRAME');
      const value = saved.get(ctx.projectId); if (body.baseRevision !== value.revision) return error('STORAGE_CONFLICT', 'Storage conflict', { revision: value.revision });
      value.data = clone(body.data); value.revision++; const result = { ok: true, operationId: body.operationId, committedRevision: value.revision, changed: true }; operations.set(body.operationId, result); return response(result);
    }
    if (['close', 'detach', 'project'].includes(action)) {
      if (ctx.lease && !isOwner(ctx, body)) return error('STALE_FRAME');
      const value = saved.get(ctx.projectId); if (body.dirty) { if (body.baseRevision !== value.revision) return error('STORAGE_CONFLICT'); value.data = clone(body.data); value.revision++; }
      ctx.leaseEpoch++; ctx.lease = null;
      if (action === 'close') contexts.delete(id);
      if (action === 'project') { ctx.projectId = body.targetProjectId; ctx.activeId = ctx.projectId; ctx.activeProject = projects.find((p) => p.id === ctx.projectId); ctx.route = ''; }
      const result = { ok: true, operationId: body.operationId, closed: action === 'close', detached: action === 'detach', storage: clone(value), state: clone(ctx) }; operations.set(body.operationId, result); return response(result);
    }
    if (action === 'force-close') { contexts.delete(id); const result = { ok: true, closed: true, saved: false }; operations.set(body.operationId, result); return response(result); }
    if (action === 'device') { ctx.deviceId = body.deviceId; return response(clone(ctx)); }
    if (action === 'game-control') {
      if (!isOwner(ctx, body)) return error('STALE_FRAME');
      ctx.command = { ...identity(ctx), seq: (ctx.command?.seq || 0) + 1, type: body.action === 'restart' ? 'reload' : 'game-control', ...(body.action === 'restart' ? {} : { url: body.action }) };
      emit('command', ctx.command, id);
      return response({ ok: true, accepted: true, previewId: id, commandSeq: ctx.command.seq });
    }
    if (action === 'rebuild') return response(clone(ctx));
    if (action === 'route') { ctx.route = body.route; return response({ ok: true }); }
    return response({ ok: true });
  }
  win.fetch = async (url, options) => { const request = { url, body: options?.body ? JSON.parse(options.body) : undefined, headers: options?.headers, signal: options?.signal }; requests.push(request); const custom = await intercept?.(request, backend); return custom || backend(request); };
  function send(data, { iframe = get('simulator'), origin = 'null', source = iframe.contentWindow } = {}) {
    const url = iframe.src ? new URL(iframe.src, 'http://preview.test') : null;
    const documentText = iframe.src?.startsWith('data:') ? Buffer.from(iframe.src.split(',')[1], 'base64').toString('utf8') : '';
    const meta = /id="frame">([^<]+)<\/script>/.exec(documentText);
    const frameIdentity = meta ? JSON.parse(meta[1]) : null;
    if (data.type === 'storage') iframe.runtimeStorage = clone(data.data);
    win.dispatchEvent(new win.MessageEvent('message', { origin, source, data: { source: 'wx-sim', ...frameIdentity, projectId: frameIdentity?.projectId || url?.pathname.split('/')[2] || '', instanceId: frameIdentity?.instanceId || url?.searchParams.get('instance') || '', ...data } }));
  }
  function emit(name, data, id = selected || 'pv_one') {
    const stream = streams.filter((s) => !s.closed && channels.get(/^\/api\/shells\/([^/]+)\/events$/.exec(s.url)?.[1])?.previewId === id).at(-1);
    stream?.events.get(name)?.({ data: JSON.stringify({ previewId: id, projectId: contexts.get(id)?.projectId, serverEpoch: 'epoch-one', ...data }) });
  }
  win.eval(devices); win.eval(shell); await tick();
  return { win, get, requests, messages, streams, contexts, saved, operations, channels, registry, confirms, exports, timers, backend, send, emit,
    async expire(delay) { const timer = timers.findLast((entry) => entry.active && entry.delay === delay); assert.ok(timer, `expected active ${delay}ms timer`); timer.active = false; timer.fn(); await tick(); },
    async recoverThroughRegistry(action, { confirmed, requestId, ...overrides } = {}) {
      await tick(); const entry = registry.list(selected).find((item) => item.connected), channel = [...channels.values()].find((item) => item.clientId === entry.clientId);
      const accepted = registry.request({ preview_id: selected, client_id: entry.clientId, state_revision: entry.state.revision, action, confirmed, ...(requestId ? { request_id: requestId } : {}), ...overrides });
      await tick(); return { accepted, channel, result: registry.list(selected).find((item) => item.clientId === entry.clientId) };
    },
    async recover(action, overrides = {}) {
      await tick(); const [channelId, channel] = [...channels].at(-1); const report = channel.reports.at(-1);
      const command = { requestId: 'recover-' + channel.acks.length, action, ...channel, stateRevision: report.revision, contextLeaseEpoch: report.contextLeaseEpoch, identity: report.identity, ...overrides };
      delete command.reports; delete command.acks;
      streams.find((stream) => stream.url === '/api/shells/' + channelId + '/events').events.get('recovery-command')({ data: JSON.stringify(command) }); await tick();
      return { channel, command };
    },
    async start() { send({ type: 'ready' }); send({ type: 'started' }); send({ type: 'preview-status', status: 'rendered', details: [] }); await tick(); },
    async click(id) { get(id).click(); await tick(); },
    async change(id, value) { get(id).value = value; get(id).dispatchEvent(new win.Event('change')); await tick(); },
  };
}

test('no-id shell stays empty and does not discover, select or create any project', async (t) => {
  const e = await setup(t, { selected: '' });
  assert.equal(e.requests.length, 0);
  assert.equal(e.streams.length, 0);
  assert.equal(e.get('refresh-preview').disabled, true);
  assert.equal(e.get('simulator').getAttribute('src'), null);
  await e.click('refresh-preview'); assert.equal(e.requests.length, 0);
});

test('device notch belongs to the screen overlay in programs and games, and is absent on non-notched devices', async (t) => {
  for (const deviceId of ['390x844', '375x667']) {
    for (const options of [{ game: false }, { game: true, gameOrientation: 'portrait' }, { game: true, gameOrientation: 'landscape' }]) {
      const e = await setup(t, { deviceId, ...options }); await e.start();
      const notch = e.win.document.querySelector('.phone-notch');
      const screen = e.win.document.querySelector('.phone-screen');
      assert.equal(notch.parentElement, screen);
      assert.equal(notch.hidden, deviceId === '375x667');
      assert.equal(notch.getAttribute('aria-hidden'), 'true');
      assert.equal(notch.querySelectorAll('a,button,[tabindex]').length, 0);
      assert.equal(e.messages.findLast((message) => message.type === 'init').device, deviceId);
      assert.equal(e.requests.some((request) => request.url.endsWith('/device')), false);
      const iframe = e.get('simulator');
      if (!options.game) { e.send({ type: 'route', route: 'pages/detail' }); await tick(); }
      assert.equal(e.win.document.querySelector('.phone-notch'), notch);
      assert.equal(e.get('simulator'), iframe);
    }
  }
});

test('in-frame forward/back route reports do not reload the iframe or feed a navigation command back', async (t) => {
  const e = await setup(t); await e.start();
  const iframe = e.get('simulator');
  const framesBefore = e.requests.filter((r) => r.url.endsWith('/frame')).length;
  const documentsBefore = e.requests.filter((r) => r.url.includes('/document?')).length;
  const messagesBefore = e.messages.length;
  for (const route of ['pages/detail?id=2', 'pages/index']) {
    e.send({ type: 'route', route, title: route }); await tick();
    e.emit('state', clone(e.contexts.get('pv_one'))); await tick();
    assert.equal(e.get('simulator'), iframe);
    assert.equal(e.contexts.get('pv_one').route, route);
  }
  assert.equal(e.requests.filter((r) => r.url.endsWith('/frame')).length, framesBefore);
  assert.equal(e.requests.filter((r) => r.url.includes('/document?')).length, documentsBefore);
  assert.equal(e.messages.slice(messagesBefore).some((m) => ['init', 'navigate', 'quiesce-storage', 'dispose'].includes(m.type)), false);
});

for (const game of [false, true]) test(`${game ? 'game' : 'program'} refresh rebuilds first and consumes the raced reload command in one safe transition`, async (t) => {
  let env;
  const e = await setup(t, { game, intercept: async (request, backend) => {
    if (!request.url.endsWith('/rebuild')) return;
    const ctx = env.contexts.get('pv_one'); ctx.build.buildId = 'build-two';
    ctx.command = { ...ctx.lease, previewId: ctx.previewId, projectId: ctx.projectId, serverEpoch: ctx.serverEpoch, type: 'reload', seq: 1, buildId: 'build-two' };
    env.emit('build', { build: clone(ctx.build) }); env.emit('command', ctx.command);
    return response(clone(ctx));
  } });
  env = e; await e.start();
  assert.equal(e.get('refresh-preview').hidden, false);
  assert.equal(e.win.document.querySelectorAll('button').length, 1);
  e.send({ type: 'storage', data: { score: 42 } }); await tick();
  const old = e.get('simulator'); await e.click('refresh-preview'); await e.start();
  assert.notEqual(e.get('simulator'), old);
  const frames = e.requests.filter((request) => request.url.endsWith('/frame'));
  assert.equal(frames.length, 2);
  assert.equal(frames[1].body.dirty, false);
  assert.equal(frames[1].body.next.buildId, 'build-two');
  assert.equal(e.requests.filter((request) => request.url.endsWith('/rebuild')).length, 1);
  assert.deepEqual(e.messages.findLast((message) => message.type === 'init').storage, { score: 42 });
  assert.equal(e.requests.some((request) => request.url.endsWith('/device')), false);
  if (game) assert.ok(e.messages.some((message) => message.type === 'dispose'));
});

test('failed rebuild keeps the old iframe, game layout and data; the single refresh can retry compilation', async (t) => {
  let e; let fail = true;
  e = await setup(t, { game: true, intercept: (request) => {
    if (!request.url.endsWith('/rebuild')) return;
    const ctx = e.contexts.get('pv_one'); ctx.build.status = fail ? 'error' : 'ok';
    ctx.build.errors = fail ? [{ message: 'Syntax error' }] : [];
    if (!fail) ctx.build.buildId = 'fixed';
    return response(clone(ctx));
  } });
  await e.start(); const old = e.get('simulator');
  await e.click('refresh-preview');
  assert.equal(e.get('simulator'), old);
  assert.equal(e.messages.some((message) => message.type === 'quiesce-storage'), false);
  assert.equal(e.get('refresh-preview').disabled, false);
  assert.match(e.get('preview-status').textContent, /构建未通过/);
  assert.equal(e.get('phone-frame').dataset.landscape, 'true');
  fail = false; await e.click('refresh-preview'); assert.notEqual(e.get('simulator'), old);
});

test('storage conflict preserves the local snapshot and supports chat export then explicitly confirmed discard', async (t) => {
  const e = await setup(t); await e.start(); const old = e.get('simulator');
  e.saved.set('aaaaaaaaaaaa', { revision: 1, data: { other: 7 } });
  e.send({ type: 'storage', data: { local: 9 } }); await tick();
  assert.equal(e.get('simulator'), old); assert.equal(e.get('refresh-preview').disabled, true);
  let result = await e.recover('export_local');
  assert.equal(result.channel.acks.at(-1).status, 'export_requested');
  assert.equal(e.exports.length, 2); assert.equal(e.get('simulator'), old);
  result = await e.recover('discard_local');
  assert.equal(result.channel.acks.at(-1).status, 'completed');
  assert.equal(e.confirms.length, 1); assert.notEqual(e.get('simulator'), old);
  await e.start(); assert.deepEqual(e.messages.findLast((message) => message.type === 'init').storage, { other: 7 });
});

test('stale or foreign recovery commands fail before action and repeated requests never duplicate downloads', async (t) => {
  const e = await setup(t); await e.start();
  let r = await e.recover('export_local', { clientId: 'foreign' });
  assert.equal(r.channel.acks.at(-1).status, 'failed'); assert.equal(e.exports.length, 0);
  r = await e.recover('export_local', { stateRevision: 0 });
  assert.equal(r.channel.acks.at(-1).status, 'failed'); assert.equal(e.exports.length, 0);
  r = await e.recover('export_local', { requestId: 'export-once' });
  assert.equal(e.exports.length, 2);
  await e.recover('export_local', { requestId: 'export-once' }); assert.equal(e.exports.length, 2);
  assert.equal(r.channel.acks.at(-1).status, 'export_requested');
  assert.ok(r.channel.reports.every((report) => !Object.hasOwn(report, 'data')));
});

test('closed shell keeps its single recovery channel for local export and never resurrects itself', async (t) => {
  const e = await setup(t); await e.start();
  e.get('simulator').runtimeStorage = { local: 4 };
  e.send({ type: 'storage', data: { local: 4 } }); await tick();
  e.emit('closed', {}); await tick();
  assert.equal(e.get('refresh-preview').disabled, true);
  assert.equal(e.streams.some((stream) => stream.url.includes('/api/previews/')), false);
  const recoveryStream = e.streams.find((stream) => stream.url.includes('/api/shells/'));
  assert.equal(recoveryStream.closed, false);
  const before = e.requests.filter((request) => request.url.endsWith('/frame')).length;
  const result = await e.recover('export_local');
  assert.equal(result.channel.acks.at(-1).status, 'export_requested');
  assert.equal(e.requests.filter((request) => request.url.endsWith('/frame')).length, before);
});

test('quiesce timeout rejects forged snapshots, keeps the old frame and chat retry remains safe', async (t) => {
  const e = await setup(t, { autoQuiesce: false }); await e.start(); const old = e.get('simulator');
  const pending = e.click('refresh-preview'); await tick();
  const flush = e.messages.findLast((message) => message.type === 'quiesce-storage');
  e.send({ type: 'storage-flushed', requestId: flush.requestId, data: { forged: 1 } }, { source: {} });
  e.timers.findLast((timer) => timer.delay === 2000).fn(); await pending; await tick();
  assert.equal(e.get('simulator'), old); assert.ok(e.messages.some((message) => message.type === 'resume-storage'));
  const report = [...e.channels.values()][0].reports.at(-1); assert.equal(report.status, 'storage_timeout');
  assert.equal(e.saved.get('aaaaaaaaaaaa').data.forged, undefined);
});

test('response loss retries the exact operation and a chat reconciliation uses its original request', async (t) => {
  let uncertain = false;
  const e = await setup(t, { intercept: async (request, backend) => {
    if (uncertain && request.url.endsWith('/storage') && request.body) { await backend(request); throw new Error('response lost'); }
    if (uncertain && request.url.includes('/operations/')) return response({ ok: true, status: 'unknown', committed: false });
  } });
  await e.start(); uncertain = true;
  e.send({ type: 'storage', data: { score: 42 } }); await tick();
  const writes = e.requests.filter((r) => r.url.endsWith('/storage') && r.body);
  assert.equal(writes.length, 2); assert.equal(writes[0].body.operationId, writes[1].body.operationId);
  uncertain = false; const result = await e.recover('retry');
  assert.equal(result.channel.acks.at(-1).status, 'completed');
  assert.equal(e.saved.get('aaaaaaaaaaaa').revision, 1);
  assert.equal(e.get('refresh-preview').disabled, false);
});

test('takeover only happens through a current chat command with confirmation; existing owner is never auto replaced', async (t) => {
  const e = await setup(t, { owner: true });
  assert.equal(e.requests.some((r) => r.url.endsWith('/frame')), false);
  assert.equal(e.get('refresh-preview').disabled, true);
  const result = await e.recover('takeover');
  assert.equal(result.channel.acks.at(-1).status, 'completed'); assert.equal(e.confirms.length, 1);
  assert.equal(e.requests.findLast((r) => r.url.endsWith('/frame')).body.action, 'takeover');
});

test('document-transfer failure never resumes an already-replaced lease and chat retry reloads only the committed identity', async (t) => {
  let failing = false;
  const e = await setup(t, { intercept: (request) => { if (failing && request.url.includes('/document?')) throw new Error('document dropped'); } });
  await e.start(); const old = e.get('simulator'); failing = true;
  await e.click('refresh-preview'); assert.equal(e.get('simulator'), old);
  assert.equal(e.messages.some((m) => m.type === 'resume-storage'), false);
  assert.equal([...e.channels.values()][0].reports.at(-1).status, 'document_failed');
  const count = e.requests.filter((r) => r.url.endsWith('/frame')).length;
  failing = false; const result = await e.recover('retry');
  assert.equal(result.channel.acks.at(-1).status, 'completed'); assert.notEqual(e.get('simulator'), old);
  assert.equal(e.requests.filter((r) => r.url.endsWith('/frame')).length, count);
});

test('foreign iframe and delayed old-lease commands cannot navigate or overwrite the active preview', async (t) => {
  const e = await setup(t); await e.start();
  e.send({ type: 'route', route: 'pages/detail' }, { source: {} });
  e.emit('command', { type: 'navigate', seq: 10, url: 'pages/detail', buildId: 'build-one', leaseEpoch: 0 });
  await tick(); assert.equal(e.messages.some((m) => m.type === 'navigate'), false);
  assert.equal(e.requests.some((r) => r.body?.route === 'pages/detail'), false);
});

test('game Agent commands remain supported without game controls and disposal waits before replacement', async (t) => {
  const e = await setup(t, { game: true, autoDispose: false }); await e.start(); const old = e.get('simulator');
  e.emit('command', { type: 'game-control', seq: 1, url: 'pause', buildId: 'build-one', leaseEpoch: 1 }); await tick();
  const command = e.messages.findLast((m) => m.type === 'game-control'); assert.equal(command.action, 'pause');
  e.send({ type: 'game-state', paused: true, reason: 'user', requestId: command.requestId }); await tick();
  assert.ok(e.requests.some((r) => r.url.endsWith('/game-state') && r.body.paused));
  const pending = e.click('refresh-preview'); await tick();
  const dispose = e.messages.findLast((m) => m.type === 'dispose'); assert.ok(dispose);
  assert.equal(e.get('simulator'), old);
  e.send({ type: 'game-disposed', requestId: dispose.requestId }, { iframe: old }); await pending; await tick();
  assert.notEqual(e.get('simulator'), old);
  assert.equal(e.win.document.querySelectorAll('button').length, 1);
});

test('rapid writes use each ack revision, while clean refresh reads the latest persisted snapshot without a data CAS', async (t) => {
  const gate = deferred(); let count = 0;
  const e = await setup(t, { intercept: async (request) => { if (request.url.endsWith('/storage') && request.body && ++count === 1) await gate.promise; } }); await e.start();
  e.send({ type: 'storage', data: { count: 1 } }); e.send({ type: 'storage', data: { count: 2 } }); await tick();
  assert.equal(e.requests.filter((r) => r.url.endsWith('/storage') && r.body).length, 1);
  gate.resolve(); await tick();
  assert.deepEqual(e.requests.filter((r) => r.url.endsWith('/storage') && r.body).map((r) => r.body.baseRevision), [0, 1]);
  e.saved.set('aaaaaaaaaaaa', { revision: 3, data: { remote: true } });
  await e.click('refresh-preview'); const input = e.requests.findLast((r) => r.url.endsWith('/frame')).body;
  assert.equal(input.dirty, false); assert.equal(Object.hasOwn(input, 'data'), false); assert.equal(Object.hasOwn(input, 'baseRevision'), false);
  await e.start(); assert.deepEqual(e.messages.findLast((m) => m.type === 'init').storage, { remote: true });
});

test('game refresh rejects old or partial disposal and flush identities and falls back to destroying on timeout', async (t) => {
  const e = await setup(t, { game: true, autoDispose: false }); await e.start(); const old = e.get('simulator');
  await e.click('refresh-preview'); const disposal = e.messages.findLast((m) => m.type === 'dispose');
  e.send({ type: 'game-disposed', requestId: disposal.requestId, leaseEpoch: 0 }, { iframe: old }); await tick();
  assert.equal(e.get('simulator'), old);
  e.timers.findLast((timer) => timer.delay === 800).fn(); await tick();
  assert.notEqual(e.get('simulator'), old);
  assert.equal(old.getAttribute('src'), null);
});

test('same-build failed game startup does not loop, but refresh and a changed successful build can recover', async (t) => {
  const e = await setup(t, { game: true });
  e.send({ type: 'ready' }); e.send({ type: 'startup-error' }); await tick();
  const old = e.get('simulator'), ctx = e.contexts.get('pv_one');
  e.emit('build', { build: clone(ctx.build) }); await tick(); assert.equal(e.get('simulator'), old);
  assert.equal(e.get('refresh-preview').disabled, false);
  await e.click('refresh-preview'); assert.notEqual(e.get('simulator'), old);
  e.send({ type: 'ready' }); e.send({ type: 'startup-error' }); await tick();
  const failed = e.get('simulator'); ctx.build.buildId = 'game-fixed';
  e.emit('build', { build: clone(ctx.build) }); await tick(); assert.notEqual(e.get('simulator'), failed);
});

test('failed export and failed discard fetch preserve conflicting local data and the current frame', async (t) => {
  let failRead = false;
  const e = await setup(t, { intercept: (r) => { if (failRead && r.url.endsWith('/storage') && !r.body) throw new Error('read failed'); } }); await e.start();
  e.saved.set('aaaaaaaaaaaa', { revision: 2, data: { remote: 2 } }); e.send({ type: 'storage', data: { mine: 9 } }); await tick();
  const old = e.get('simulator'); const url = old.src;
  const create = e.win.URL.createObjectURL; e.win.URL.createObjectURL = () => { throw new Error('download failed'); };
  let r = await e.recover('export_local'); assert.equal(r.channel.acks.at(-1).status, 'failed'); assert.equal(old.src, url);
  e.win.URL.createObjectURL = create; failRead = true; r = await e.recover('discard_local');
  assert.equal(r.channel.acks.at(-1).status, 'failed'); assert.equal(e.get('simulator'), old);
  assert.deepEqual(old.runtimeStorage, { mine: 9 });
});

test('late recovery execution revalidates the report revision instead of applying an action to a new state', async (t) => {
  const e = await setup(t); await e.start();
  const channel = [...e.channels.values()][0], channelId = [...e.channels.keys()][0], report = channel.reports.at(-1);
  const command = { requestId: 'queued-old', action: 'export_local', previewId: channel.previewId, serverEpoch: channel.serverEpoch, clientId: channel.clientId,
    identity: report.identity, contextLeaseEpoch: report.contextLeaseEpoch, stateRevision: report.revision };
  e.send({ type: 'storage', data: { changed: true } });
  e.streams.find((s) => s.url === '/api/shells/' + channelId + '/events').events.get('recovery-command')({ data: JSON.stringify(command) });
  await tick();
  assert.equal(channel.acks.at(-1).status, 'failed'); assert.equal(e.exports.length, 0);
});

test('server restart creates a new metadata recovery channel while preserving export and requiring confirmed clean attachment', async (t) => {
  const e = await setup(t); await e.start();
  e.send({ type: 'storage', data: { saved: 3 } }); await tick();
  const ctx = e.contexts.get('pv_one'), frameCount = e.requests.filter((r) => r.url.endsWith('/frame')).length;
  ctx.serverEpoch = 'epoch-two'; ctx.lease = null; ctx.leaseEpoch = 0;
  e.emit('state', clone(ctx)); await tick();
  assert.equal(e.channels.size, 2);
  assert.equal(e.requests.filter((r) => r.url.endsWith('/frame')).length, frameCount);
  let r = await e.recover('export_local'); assert.equal(r.channel.acks.at(-1).status, 'export_requested');
  r = await e.recover('takeover'); assert.equal(r.channel.acks.at(-1).status, 'completed');
  const latest = e.requests.findLast((request) => request.url.endsWith('/frame')).body;
  assert.equal(latest.action, 'attach'); assert.equal(latest.dirty, false); assert.equal(Object.hasOwn(latest, 'previous'), false);
  assert.ok(e.confirms.length > 0);
});

test('lease-bound commands run once after startup and changed build updates preserve confirmed data automatically', async (t) => {
  const e = await setup(t);
  const ctx = e.contexts.get('pv_one');
  const command = { ...ctx.lease, previewId: ctx.previewId, projectId: ctx.projectId, serverEpoch: ctx.serverEpoch, seq: 1, type: 'navigate', url: 'pages/detail' };
  e.emit('command', command); await tick(); assert.equal(e.messages.some((m) => m.type === 'navigate'), false);
  await e.start(); e.emit('command', command); await tick();
  assert.equal(e.messages.filter((m) => m.type === 'navigate').length, 1);
  e.send({ type: 'storage', data: { safe: 1 } }); await tick();
  const old = e.get('simulator'); ctx.build = { ...ctx.build, buildId: 'watch-build' }; e.emit('build', { build: clone(ctx.build) }); await tick();
  assert.notEqual(e.get('simulator'), old); await e.start(); assert.deepEqual(e.messages.findLast((m) => m.type === 'init').storage, { safe: 1 });
});

test('real recovery registry admits document retry and lost transition reconciliation without a second handoff', async (t) => {
  let drop = false, dropDocument = false;
  const e = await setup(t, { realRecovery: true, intercept: async (r, backend) => {
    if (drop && r.url.endsWith('/frame') && r.body.action === 'reload') { await backend(r); throw new Error('lost frame response'); }
    if (drop && r.url.includes('/operations/')) return response({ ok: true, status: 'unknown', committed: false });
    if (dropDocument && r.url.includes('/document?')) throw new Error('document offline');
  } });
  await e.start(); const old = e.get('simulator'); drop = true;
  await e.click('refresh-preview');
  let entry = e.registry.list('pv_one')[0];
  assert.equal(entry.state.status, 'outcome_unknown'); assert.ok(entry.availableActions.includes('retry'));
  assert.equal(entry.state.contextLeaseEpoch, 1); assert.equal(e.contexts.get('pv_one').leaseEpoch, 2);
  const frames = e.requests.filter((r) => r.url.endsWith('/frame')).length;
  drop = false; dropDocument = true;
  let recovery = await e.recoverThroughRegistry('retry');
  assert.equal(recovery.result.lastCommand.status, 'failed');
  assert.equal(recovery.result.state.status, 'document_failed'); assert.ok(recovery.result.availableActions.includes('retry'));
  assert.equal(e.get('simulator'), old);
  dropDocument = false; recovery = await e.recoverThroughRegistry('retry');
  assert.equal(recovery.result.lastCommand.status, 'completed'); assert.notEqual(e.get('simulator'), old);
  assert.equal(e.requests.filter((r) => r.url.endsWith('/frame')).length, frames);
  const privateRegistration = e.requests.find((r) => r.url === '/api/shells').body.registrationId;
  assert.match(privateRegistration, /^shell-registration-/);
  assert.ok(!JSON.stringify(e.registry.list('pv_one')).includes(privateRegistration));
  assert.ok(!JSON.stringify(e.messages).includes(privateRegistration));
});

test('lost recovery acknowledgments retry their exact receipt and duplicate delivery never repeats the download', async (t) => {
  let drops = 2;
  const e = await setup(t, { realRecovery: true, intercept: (r) => { if (r.url.endsWith('/ack') && drops-- > 0) throw new Error('ack dropped'); } });
  await e.start();
  const first = await e.recoverThroughRegistry('export_local', { requestId: 'export-once-live' });
  assert.equal(e.exports.length, 2); assert.equal(first.result.lastCommand.status, 'pending');
  const initial = e.requests.filter((r) => r.url.endsWith('/ack'));
  assert.equal(initial.length, 2); assert.deepEqual(initial[0].body, initial[1].body);
  const second = await e.recoverThroughRegistry('export_local', { requestId: 'export-once-live' });
  assert.equal(second.accepted.replayed, true); assert.equal(second.result.lastCommand.status, 'export_requested');
  assert.equal(e.exports.length, 2);
  assert.throws(() => e.registry.request({ preview_id: 'pv_one', client_id: second.result.clientId,
    state_revision: second.result.state.revision, request_id: 'export-once-live', action: 'close', confirmed: true }), { code: 'OPERATION_ID_REUSED' });
});

test('recovery connected resends an unacknowledged receipt without changing state revision or repeating its action', async (t) => {
  let drops = true;
  const e = await setup(t, { realRecovery: true, intercept: (r) => { if (r.url.endsWith('/ack') && drops) throw new Error('offline'); } });
  await e.start(); await e.recoverThroughRegistry('export_local');
  const revision = e.registry.list('pv_one')[0].state.revision;
  drops = false; e.streams.find((s) => s.url.includes('/api/shells/')).events.get('connected')(); await tick();
  assert.equal(e.registry.list('pv_one')[0].lastCommand.status, 'export_requested');
  assert.equal(e.registry.list('pv_one')[0].state.revision, revision); assert.equal(e.exports.length, 2);
});

test('registration response loss uses the same private key and does not strand an already registered shell', async (t) => {
  let drops = 1;
  const e = await setup(t, { realRecovery: true, intercept: async (r, backend) => {
    if (r.url === '/api/shells' && drops-- > 0) { await backend(r); throw new Error('registration response dropped'); }
  } });
  await e.start();
  const registrations = e.requests.filter((r) => r.url === '/api/shells');
  assert.equal(registrations.length, 2); assert.deepEqual(registrations[0].body, registrations[1].body);
  assert.equal(e.registry.list('pv_one').length, 1); assert.equal(e.registry.list('pv_one')[0].state.status, 'ready');
  assert.equal(e.requests.filter((r) => r.url.endsWith('/frame')).length, 1);
});

test('storage timeout retry performs exactly one safe transition and never rebuilds again', async (t) => {
  const e = await setup(t, { realRecovery: true, autoQuiesce: false }); await e.start();
  const old = e.get('simulator'); await e.click('refresh-preview');
  e.timers.findLast((timer) => timer.delay === 2000).fn(); await tick();
  assert.equal(e.registry.list('pv_one')[0].state.status, 'storage_timeout');
  const recovery = await e.recoverThroughRegistry('retry');
  const flush = e.messages.findLast((m) => m.type === 'quiesce-storage');
  e.send({ type: 'storage-flushed', requestId: flush.requestId, storage: { final: 7 } }, { iframe: old }); await tick();
  assert.equal(e.registry.list('pv_one')[0].lastCommand.requestId, recovery.accepted.requestId);
  assert.equal(e.registry.list('pv_one')[0].lastCommand.status, 'completed');
  assert.equal(e.requests.filter((r) => r.url.endsWith('/rebuild')).length, 1);
  assert.equal(e.requests.filter((r) => r.url.endsWith('/frame')).length, 2);
  assert.deepEqual(e.saved.get('aaaaaaaaaaaa').data, { final: 7 });
});

test('disconnected recovery reconnects the stream without changing lease and waits for its actual open event', async (t) => {
  const e = await setup(t, { realRecovery: true }); await e.start();
  const old = e.get('simulator'), stream = e.streams.find((s) => s.url.includes('/api/shells/'));
  stream.events.get('error')(); await tick();
  assert.equal(e.registry.list('pv_one')[0].state.status, 'disconnected');
  const result = await e.recoverThroughRegistry('retry');
  assert.equal(result.result.lastCommand.status, 'completed'); assert.equal(stream.closed, true);
  assert.equal(e.get('refresh-preview').disabled, true);
  assert.equal(e.get('simulator'), old); assert.equal(e.requests.filter((r) => r.url.endsWith('/frame')).length, 1);
  e.streams.filter((s) => s.url.includes('/api/shells/')).at(-1).events.get('open')(); await tick();
  assert.equal(e.registry.list('pv_one')[0].state.status, 'ready'); assert.equal(e.get('refresh-preview').disabled, false);
});

for (const action of ['discard_local', 'takeover', 'close']) test(`${action} revalidates after confirmation and does not mutate a changed lease`, async (t) => {
  const e = await setup(t, { owner: action === 'takeover', realRecovery: true });
  if (action !== 'takeover') await e.start();
  if (action === 'discard_local') { e.saved.set('aaaaaaaaaaaa', { revision: 1, data: { remote: 1 } }); e.send({ type: 'storage', data: { local: 1 } }); await tick(); }
  e.win.confirm = () => {
    const ctx = e.contexts.get('pv_one'); ctx.leaseEpoch++; ctx.lease = { clientId: 'new-owner', instanceId: 'new-instance', buildId: 'build-one', leaseEpoch: ctx.leaseEpoch };
    e.emit('state', clone(ctx)); return true;
  };
  const frameCount = e.requests.filter((r) => r.url.endsWith('/frame')).length;
  const result = await e.recoverThroughRegistry(action, { confirmed: true });
  assert.equal(result.result.lastCommand.status, 'failed');
  assert.equal(e.requests.filter((r) => r.url.endsWith('/frame')).length, frameCount);
  assert.equal(e.requests.some((r) => r.url.endsWith('/close')), false);
});

test('discard refuses late data changes while fetching the latest saved snapshot', async (t) => {
  const gate = deferred(); let wait = false;
  const e = await setup(t, { realRecovery: true, intercept: async (r) => { if (wait && r.url.endsWith('/storage') && !r.body) await gate.promise; } });
  await e.start(); e.saved.set('aaaaaaaaaaaa', { revision: 1, data: { remote: 1 } }); e.send({ type: 'storage', data: { mine: 1 } }); await tick();
  const old = e.get('simulator'); wait = true;
  await e.recoverThroughRegistry('discard_local', { confirmed: true });
  e.send({ type: 'storage', data: { mine: 2 } }); gate.resolve(); await tick();
  assert.equal(e.registry.list('pv_one')[0].lastCommand.status, 'failed'); assert.equal(e.get('simulator'), old);
  assert.deepEqual(old.runtimeStorage, { mine: 2 }); assert.deepEqual(e.saved.get('aaaaaaaaaaaa').data, { remote: 1 });
});

test('cross-project state retires the old shell binding but keeps its original title, channel and exportable data', async (t) => {
  const e = await setup(t, { realRecovery: true }); await e.start();
  e.send({ type: 'storage', data: { original: 8 } }); await tick();
  const old = e.get('simulator'), channelId = [...e.channels.keys()][0], ctx = e.contexts.get('pv_one');
  Object.assign(ctx, { projectId: 'bbbbbbbbbbbb', activeId: 'bbbbbbbbbbbb', activeProject: { id: 'bbbbbbbbbbbb', name: 'Project B' }, lease: null, leaseEpoch: 2 });
  e.emit('state', clone(ctx)); await tick();
  const report = e.registry.list('pv_one')[0];
  assert.equal(report.projectId, 'aaaaaaaaaaaa'); assert.equal(report.state.identity.projectId, 'aaaaaaaaaaaa');
  assert.deepEqual(report.availableActions, ['export_local']);
  assert.equal(e.get('project-name').textContent, 'Project A'); assert.equal(e.get('simulator'), old);
  assert.deepEqual([...e.channels.keys()], [channelId]);
  assert.equal(e.streams.find((s) => s.url.includes('/api/shells/')).closed, false);
  const exportResult = await e.recoverThroughRegistry('export_local'); assert.equal(exportResult.result.lastCommand.status, 'export_requested');
  const blob = e.exports[0]; const text = await new Promise((resolve) => { const reader = new e.win.FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(blob); });
  assert.deepEqual(JSON.parse(text), { original: 8 });
  assert.equal(e.requests.filter((r) => r.url.endsWith('/frame')).length, 1);
});

test('restored server epoch accepts new runtime and build events while rejecting old epoch traffic', async (t) => {
  const e = await setup(t); await e.start();
  const ctx = e.contexts.get('pv_one'); ctx.serverEpoch = 'epoch-two'; ctx.lease = null; ctx.leaseEpoch = 0;
  e.emit('state', clone(ctx)); await tick(); await e.recover('takeover'); await e.start();
  const current = e.get('simulator');
  e.emit('build', { serverEpoch: 'epoch-one', build: { ...ctx.build, buildId: 'stale-build' } }); await tick(); assert.equal(e.get('simulator'), current);
  ctx.build.buildId = 'new-epoch-build'; e.emit('build', { serverEpoch: 'epoch-two', build: clone(ctx.build) }); await tick();
  assert.notEqual(e.get('simulator'), current);
  assert.equal(e.requests.findLast((r) => r.url.endsWith('/frame')).body.serverEpoch, 'epoch-two');
});

test('committed recovery without its old build preserves snapshots until an explicit clean reconnect', async (t) => {
  let staged = null, recoveryReady = false, e;
  e = await setup(t, { realRecovery: true, intercept: async (r) => {
    if (r.url.endsWith('/frame') && r.body.action === 'reload') {
      staged = r.body; const ctx = e.contexts.get('pv_one'); ctx.recovering = { targetClientId: staged.next.clientId, operationId: staged.operationId };
      return error('PREVIEW_RECOVERING', 'committed but incomplete', { committed: true });
    }
    if (r.url.includes('/operations/') && staged) {
      if (r.url.endsWith('/recover')) {
        const ctx = e.contexts.get('pv_one'); ctx.leaseEpoch += 2; ctx.lease = null; ctx.recovering = null;
        ctx.reconnectTarget = { clientId: staged.next.clientId, operationId: staged.operationId };
        return response({ ok: true, status: 'reconnect_required', committed: true, operationId: staged.operationId, state: clone(ctx) });
      }
      return response({ ok: true, status: recoveryReady ? 'recovering' : 'unknown', committed: true });
    }
  } });
  await e.start(); const old = e.get('simulator'); await e.click('refresh-preview');
  assert.match(e.registry.list('pv_one')[0].state.message, /数据已经提交/);
  recoveryReady = true; await e.recoverThroughRegistry('retry');
  assert.equal(e.registry.list('pv_one')[0].state.status, 'reconnect_required'); assert.equal(e.get('simulator'), old);
  e.win.confirm = () => false;
  let r = await e.recoverThroughRegistry('retry'); assert.equal(r.result.lastCommand.status, 'failed'); assert.equal(e.get('simulator'), old);
  e.win.confirm = () => true;
  r = await e.recoverThroughRegistry('retry'); assert.equal(r.result.lastCommand.status, 'completed'); assert.notEqual(e.get('simulator'), old);
  const final = e.requests.findLast((request) => request.url.endsWith('/frame')).body;
  assert.equal(final.action, 'attach'); assert.equal(final.dirty, false); assert.equal(Object.hasOwn(final, 'previous'), false);
});

test('expired committed transition only refreshes metadata and requires a separately confirmed takeover', async (t) => {
  let lose = false;
  const e = await setup(t, { realRecovery: true, intercept: async (r, backend) => {
    if (lose && r.url.endsWith('/frame') && r.body.action === 'reload') { await backend(r); throw new Error('lost response'); }
    if (lose && r.url.includes('/operations/')) return response({ ok: true, status: 'unknown', committed: true });
  } });
  await e.start(); const old = e.get('simulator'); lose = true; await e.click('refresh-preview');
  const frames = e.requests.filter((r) => r.url.endsWith('/frame')).length;
  let r = await e.recoverThroughRegistry('retry');
  assert.equal(r.result.lastCommand.status, 'failed'); assert.equal(r.result.state.status, 'ownership_lost');
  assert.equal(r.result.state.contextLeaseEpoch, 2); assert.ok(r.result.availableActions.includes('takeover'));
  assert.equal(e.get('simulator'), old); assert.equal(e.requests.filter((r) => r.url.endsWith('/frame')).length, frames);
  assert.equal(e.messages.some((m) => m.type === 'resume-storage'), false);
  lose = false; r = await e.recoverThroughRegistry('takeover', { confirmed: true });
  assert.equal(r.result.lastCommand.status, 'completed'); assert.notEqual(e.get('simulator'), old);
  assert.equal(e.requests.findLast((request) => request.url.endsWith('/frame')).body.dirty, false);
});

test('a close whose responses were lost can reconcile its tombstone without reopening or replaying saved data', async (t) => {
  let lose = true, e;
  e = await setup(t, { realRecovery: true, intercept: async (r, backend) => {
    if (r.url.endsWith('/close') && lose) {
      if (!e.operations.has(r.body.operationId)) { await backend(r); e.emit('closed', {}); }
      throw new Error('close response lost');
    }
    if (r.url.includes('/operations/') && lose) throw new Error('operation unavailable');
  } });
  await e.start(); e.send({ type: 'storage', data: { saved: 1 } }); await tick();
  let r = await e.recoverThroughRegistry('close', { confirmed: true });
  assert.equal(r.result.lastCommand.status, 'failed'); assert.equal(r.result.state.status, 'outcome_unknown');
  assert.match(r.result.state.message, /预览已关闭.*待确认/); assert.ok(r.result.availableActions.includes('retry'));
  assert.equal(e.contexts.has('pv_one'), false);
  lose = false; r = await e.recoverThroughRegistry('retry');
  assert.equal(r.result.lastCommand.status, 'completed'); assert.equal(r.result.state.status, 'closed');
  assert.deepEqual(r.result.availableActions, ['export_local']);
  assert.equal(e.requests.filter((request) => request.url.endsWith('/frame')).length, 1);
  assert.deepEqual(e.saved.get('aaaaaaaaaaaa').data, { saved: 1 });
});

test('JSON response deadline reconciles one storage write while a failed read never discards local data', async (t) => {
  let hangWrite = true, hangRead = false;
  const e = await setup(t, { realRecovery: true, intercept: async (request, backend) => {
    if (request.url.endsWith('/storage') && ((request.body && hangWrite) || (!request.body && hangRead))) {
      if (request.body) await backend(request);
      return { ok: true, status: 200, json: () => new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(new Error('AbortError')), { once: true })) };
    }
  } });
  await e.start(); e.send({ type: 'storage', data: { savedOnce: true } }); await tick();
  await e.expire(8000); await e.expire(8000);
  assert.equal(e.saved.get('aaaaaaaaaaaa').revision, 1); assert.equal(e.registry.list('pv_one')[0].state.status, 'ready');
  hangWrite = false; e.saved.set('aaaaaaaaaaaa', { revision: 2, data: { remote: true } });
  e.send({ type: 'storage', data: { local: true } }); await tick();
  const old = e.get('simulator'); hangRead = true; await e.recoverThroughRegistry('discard_local', { confirmed: true });
  await e.expire(8000);
  assert.equal(e.get('simulator'), old); assert.equal(e.registry.list('pv_one')[0].lastCommand.status, 'failed');
  assert.deepEqual(old.runtimeStorage, { local: true }); assert.deepEqual(e.saved.get('aaaaaaaaaaaa').data, { remote: true });
});

for (const game of [false, true]) for (const terminal of ['takeover', 'closed']) test(`${game ? 'game' : 'program'} ${terminal} waits for final storage, then permits export without writing its retired lease`, async (t) => {
  const e = await setup(t, { game, realRecovery: true, autoQuiesce: false }); await e.start();
  const old = e.get('simulator'), ctx = e.contexts.get('pv_one');
  if (terminal === 'closed') { e.contexts.delete('pv_one'); e.emit('closed', {}); }
  else {
    ctx.leaseEpoch++; ctx.lease = { clientId: 'other', instanceId: 'other-frame', buildId: 'build-one', leaseEpoch: ctx.leaseEpoch };
    e.emit('frame-active', { ...ctx.lease });
  }
  await tick(); const flush = e.messages.findLast((m) => m.type === 'quiesce-storage');
  assert.ok(flush); assert.ok(old.src);
  e.send({ type: 'storage-flushed', requestId: flush.requestId, storage: { finalHideSave: 7 } }, { iframe: old }); await tick();
  if (game) assert.equal(old.getAttribute('src'), null);
  assert.equal(e.requests.some((r) => r.body?.data?.finalHideSave), false);
  const r = await e.recoverThroughRegistry('export_local'); assert.equal(r.result.lastCommand.status, 'export_requested');
  const contents = await new Promise((resolve) => { const reader = new e.win.FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(e.exports[0]); });
  assert.deepEqual(JSON.parse(contents), { finalHideSave: 7 });
});

test('server restart ends pending old operations without replay, preserves export and permits a clean explicit attach', async (t) => {
  let failDocument = false;
  const e = await setup(t, { intercept: (r) => { if (failDocument && r.url.includes('/document?')) throw new Error('document unavailable'); } });
  await e.start(); e.send({ type: 'storage', data: { saved: 5 } }); await tick();
  failDocument = true; await e.click('refresh-preview'); assert.equal([...e.channels.values()][0].reports.at(-1).status, 'document_failed');
  const ctx = e.contexts.get('pv_one'); Object.assign(ctx, { serverEpoch: 'epoch-two', lease: null, leaseEpoch: 0 });
  e.emit('state', clone(ctx)); await tick();
  const current = [...e.channels.values()].at(-1); assert.equal(current.reports.at(-1).status, 'ownership_lost');
  let r = await e.recover('export_local'); assert.equal(r.channel.acks.at(-1).status, 'export_requested');
  failDocument = false; r = await e.recover('takeover'); assert.equal(r.channel.acks.at(-1).status, 'completed');
  const last = e.requests.findLast((request) => request.url.endsWith('/frame')).body;
  assert.equal(last.serverEpoch, 'epoch-two'); assert.equal(last.action, 'attach'); assert.equal(last.dirty, false);
});

test('a delayed document cannot resurrect an externally closed preview', async (t) => {
  const gate = deferred(); let delay = false;
  const e = await setup(t, { realRecovery: true, intercept: async (r, backend) => {
    if (delay && r.url.includes('/document?')) { const value = await backend(r); await gate.promise; return value; }
  } });
  await e.start(); const old = e.get('simulator'); delay = true;
  await e.click('refresh-preview'); e.contexts.delete('pv_one'); e.emit('closed', {}); gate.resolve(); await tick();
  assert.equal(e.get('simulator'), old);
  assert.equal(e.registry.list('pv_one')[0].state.status, 'closed');
  assert.deepEqual(e.registry.list('pv_one')[0].availableActions, ['export_local']);
  assert.equal(e.get('refresh-preview').disabled, true);
});

test('one Shell uses one event stream for preview updates and recovery, reserving HTTP connections for mutations', async (t) => {
  const e = await setup(t, { realRecovery: true }); await e.start();
  assert.equal(e.streams.length, 1); assert.match(e.streams[0].url, /^\/api\/shells\/[^/]+\/events$/);
  const before = e.get('simulator'), ctx = e.contexts.get('pv_one');
  ctx.build = { ...ctx.build, buildId: 'single-stream-build', generation: 2 };
  e.emit('build', { build: clone(ctx.build) }); await tick(); await e.start();
  assert.notEqual(e.get('simulator'), before); assert.equal(e.streams.length, 1);
  const recovery = await e.recoverThroughRegistry('export_local'); assert.equal(recovery.result.lastCommand.status, 'export_requested');
  e.win.dispatchEvent(new e.win.Event('pagehide')); assert.equal(e.streams[0].closed, true);
});

test('a newer startup build received while registration settles is not overwritten by the initial GET snapshot', async (t) => {
  const gate = deferred(); let hold = true;
  const e = await setup(t, { intercept: async (r) => { if (hold && /\/shells\/[^/]+\/state$/.test(r.url)) await gate.promise; } });
  assert.equal(e.requests.some((request) => request.url.endsWith('/frame')), false);
  const ctx = e.contexts.get('pv_one'); ctx.build = { ...ctx.build, buildId: 'startup-latest', generation: 2 };
  e.emit('state', clone(ctx)); await tick(); hold = false; gate.resolve(); await tick();
  const frames = e.requests.filter((request) => request.url.endsWith('/frame'));
  assert.equal(frames.length, 1); assert.equal(frames[0].body.next.buildId, 'startup-latest');
  assert.equal(e.streams.length, 1);
});

test('a stale state snapshot cannot roll back a newer build announced on the combined stream', async (t) => {
  const e = await setup(t); await e.start();
  const ctx = e.contexts.get('pv_one'); ctx.build = { ...ctx.build, buildId: 'announced-latest', generation: 3 };
  e.emit('build', { build: clone(ctx.build) }); await tick(); await e.start();
  const current = e.get('simulator');
  e.emit('state', { ...clone(ctx), build: { ...ctx.build, buildId: 'stale-snapshot', generation: 2 } }); await tick();
  assert.equal(e.get('simulator'), current);
  assert.equal(e.requests.filter((request) => request.url.endsWith('/frame')).length, 2);
});

test('late building snapshot from the same generation cannot undo a terminal build or disable refresh', async (t) => {
  const e = await setup(t); await e.start();
  const ctx = e.contexts.get('pv_one'); ctx.build = { ...ctx.build, generation: 2 };
  e.emit('build', { build: clone(ctx.build) }); await tick();
  const current = e.get('simulator');
  e.emit('state', { ...clone(ctx), build: { ...ctx.build, status: 'building' } }); await tick();
  assert.equal(e.get('simulator'), current); assert.equal(e.get('refresh-preview').disabled, false);
  assert.doesNotMatch(e.get('preview-status').textContent, /正在构建/);
  ctx.build = { ...ctx.build, status: 'building', generation: 3 };
  e.emit('state', clone(ctx)); await tick();
  assert.equal(e.get('refresh-preview').disabled, true); assert.match(e.get('preview-status').textContent, /正在构建/);
});
