import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createReservation } from 'node:net';
import { request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { start } from '../miniapp/node/server.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let sequence = 0;
const op = () => `http-op-${++sequence}`;

async function launch(dataDir) {
  const reserve = createReservation();
  await new Promise((resolve, reject) => { reserve.on('error', reject); reserve.listen(0, '127.0.0.1', resolve); });
  const port = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  const abort = new AbortController();
  const lifecycle = await start({ pluginRoot: root, dataDir, listen: { host: '127.0.0.1', port }, signal: abort.signal, logger: { info() {}, warn() {}, error() {} } });
  const origin = `http://127.0.0.1:${port}`;
  const request = (pathname, body, headers = {}) => fetch(origin + pathname, body === undefined ? { headers } : {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const value = async (pathname, body, headers) => {
    const response = await request(pathname, body, headers);
    const result = await response.json();
    assert.equal(response.status, 200, `${pathname}: ${JSON.stringify(result)}`);
    return result;
  };
  const rpc = async (name, args = {}) => (await value('/mcp/preview', { jsonrpc: '2.0', id: op(), method: 'tools/call', params: { name, arguments: args } })).result;
  const attach = async (state, clientId, previous) => value(`/api/previews/${state.previewId}/frame`, {
    action: previous ? 'reload' : 'attach', serverEpoch: state.serverEpoch, projectId: state.projectId,
    expectedLeaseEpoch: previous?.leaseEpoch ?? state.leaseEpoch, operationId: op(),
    next: { buildId: state.build.buildId, clientId, instanceId: op() }, ...(previous ? { previous } : {}), dirty: false,
  });
  return { origin, request, value, rpc, attach, dispose: lifecycle.dispose };
}

test('HTTP/MCP directly open safe projects while preserving Host and explicit context boundaries', async () => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'wx-http-identity-'));
  const app = await launch(path.join(scratch, 'state'));
  try {
    const shell = await app.request('/preview'); assert.equal(shell.status, 200); assert.match(await shell.text(), /微信小程序开发者/);
    const rebinding = await new Promise((resolve, reject) => {
      const req = httpRequest(app.origin + '/api/previews', { headers: { host: 'evil.example' } }, (response) => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
      req.on('error', reject); req.end();
    });
    assert.equal(rebinding, 403);
    for (const origin of ['null', 'https://evil.example']) assert.equal((await app.request('/api/demo', {}, { origin })).status, 403);
    assert.equal((await app.request('/mcp/preview', {}, { origin: app.origin })).status, 403);
    assert.equal((await app.rpc('preview_status')).structuredContent.code, 'NO_PREVIEW_CONTEXT');
    const tools = await app.value('/mcp/preview', { jsonrpc: '2.0', id: op(), method: 'tools/list' });
    assert.deepEqual(tools.result.tools.map((tool) => tool.name), ['preview_open_project', 'preview_status', 'preview_logs', 'preview_navigate', 'preview_rebuild', 'preview_list', 'preview_game_control', 'preview_recover', 'preview_close']);
    assert.deepEqual(tools.result.tools.find((tool) => tool.name === 'preview_game_control').inputSchema.properties.action.enum, ['pause', 'resume', 'restart']);
    assert.equal((await app.rpc('preview_logs', { limit: '3' })).structuredContent.code, 'INVALID_ARGUMENTS');
    assert.equal((await app.rpc('preview_status', { accidental: true })).isError, true);
    const a = await app.value('/api/previews', { demo: true, create_new: true });
    assert.equal(a.build.status, 'ok');
    assert.equal((await app.rpc('preview_status')).structuredContent.previewId, a.previewId);
    const b = await app.value('/api/previews', { demo: true, create_new: true });
    assert.notEqual(b.previewId, a.previewId);
    assert.equal((await app.rpc('preview_status')).structuredContent.code, 'AMBIGUOUS_PREVIEW_CONTEXT');
    assert.equal((await app.request('/api/state')).status, 409);
    const selected = (await app.rpc('preview_status', { preview_id: a.previewId })).structuredContent;
    assert.equal(selected.previewId, a.previewId);
    assert.equal((await app.request(`/api/previews/${a.previewId}/rebuild`, { previewId: b.previewId })).status, 400);
    const project = path.join(scratch, 'project'); await cp(path.join(root, 'miniapp/node/demo'), project, { recursive: true });
    const opened = await app.rpc('preview_open_project', { project_path: project, create_new: true });
    assert.equal(opened.isError, undefined);
    const c = opened.structuredContent;
    assert.equal(c.nextStep, 'open_miniapp');
    assert.deepEqual(c.hostOpenAction, { action: 'open', pluginId: 'wechat-miniprogram-preview', path: c.surfacePath });
    assert.equal((await app.request('/api/projects/open', { projectPath: project, confirmAccess: true }, { origin: app.origin, 'x-preview-user-action': 'authorize-project' })).status, 404);
    assert.equal(c.build.status, 'ok');
    const frame = await app.attach(c, 'test-client');
    const documentQuery = new URLSearchParams(Object.fromEntries(['serverEpoch', 'buildId', 'clientId', 'instanceId', 'leaseEpoch'].map((key) => [key, String(frame.identity[key])])));
    const previewDocument = await app.value(`/api/previews/${c.previewId}/document?${documentQuery}`);
    const dom = new JSDOM(previewDocument.html.split('<script')[0]);
    try {
      const capsule = dom.window.document.querySelector('#wx-capsule');
      assert.ok(capsule);
      assert.equal(capsule.parentElement, dom.window.document.body);
      assert.equal(capsule.getAttribute('aria-hidden'), 'true');
      assert.equal(capsule.textContent, '');
      assert.ok(capsule.querySelector('.wx-capsule-menu'));
      assert.ok(capsule.querySelector('.wx-capsule-exit'));
      assert.equal(capsule.querySelectorAll('button,a').length, 0);
      assert.equal(dom.window.document.querySelectorAll('#wx-capsule').length, 1);
    } finally { dom.window.close(); }
    const navigation = (await app.rpc('preview_navigate', { preview_id: c.previewId, page: 'pages/detail/detail' })).structuredContent;
    assert.equal(navigation.accepted, true); assert.equal(navigation.previewId, c.previewId);
    assert.notEqual((await app.value(`/api/previews/${a.previewId}/state`)).command?.seq, navigation.commandSeq);
    await app.value(`/api/previews/${c.previewId}/route`, { ...frame.identity, route: 'pages/detail/detail', title: '详情' });
    const log = { ...frame.identity, entries: [{ level: 'error', message: 'intentional HTTP diagnostic', source: 'runtime' }] };
    await app.value(`/api/previews/${c.previewId}/logs`, log);
    assert.equal((await app.rpc('preview_logs', { preview_id: c.previewId })).structuredContent.entries.at(-1).message, 'intentional HTTP diagnostic');
    assert.equal((await app.rpc('preview_logs', { preview_id: a.previewId })).structuredContent.entries.length, 0);
    const list = (await app.rpc('preview_list')).structuredContent;
    assert.equal(list.previews.length, 3);
    assert.doesNotMatch(JSON.stringify(list), new RegExp(scratch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal((await app.request('/api/projects/revoke', { projectId: c.projectId }, { origin: app.origin, 'x-preview-user-action': 'revoke-project' })).status, 404);
    const closeArgs = { preview_id: c.previewId, server_epoch: c.serverEpoch, expected_lease_epoch: frame.identity.leaseEpoch, confirmed: true };
    assert.equal((await app.rpc('preview_close', closeArgs)).structuredContent.code, 'PREVIEW_REQUIRES_DRAIN');
    const detached = await app.value(`/api/previews/${c.previewId}/detach`, { ...frame.identity, operationId: op(), dirty: false });
    const afterDetach = detached.state || await app.value(`/api/previews/${c.previewId}/state`);
    assert.equal((await app.rpc('preview_close', { ...closeArgs, expected_lease_epoch: afterDetach.leaseEpoch })).structuredContent.ok, true);
    assert.equal((await app.request(`/api/previews/${c.previewId}/state`)).status, 404);
    assert.equal((await app.rpc('preview_open_project', { project_path: project, create_new: true })).structuredContent.ok, true);
    assert.equal((await app.value(`/api/previews/${a.previewId}/state`)).previewId, a.previewId);
  } finally { await app.dispose(); await rm(scratch, { recursive: true, force: true }); }
});

test('same-project windows CAS independently, preserve pinned assets across builds, and reject stale owners', async () => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'wx-http-cas-'));
  const app = await launch(path.join(scratch, 'data'));
  try {
    const project = path.join(scratch, 'project'); await cp(path.join(root, 'miniapp/node/demo'), project, { recursive: true });
    await writeFile(path.join(project, 'miniprogram/a.svg'), '<svg>old</svg>');
    await writeFile(path.join(project, 'miniprogram/app.wxss'), '.asset{background:url(./a.svg)}');
    const first = (await app.rpc('preview_open_project', { project_path: project, create_new: true })).structuredContent;
    const second = await app.value('/api/previews', { project_id: first.projectId, create_new: true });
    const a = await app.attach(first, 'window-a'); const b = await app.attach(second, 'window-b');
    const documentQuery = new URLSearchParams(Object.fromEntries(['serverEpoch', 'buildId', 'clientId', 'instanceId', 'leaseEpoch'].map((key) => [key, String(a.identity[key])])));
    const document = await app.value(`/api/previews/${first.previewId}/document?${documentQuery}`);
    assert.deepEqual(document.identity, a.identity);
    assert.doesNotMatch(document.html, /<script src=|<link rel="stylesheet"/);
    const data = JSON.parse(document.html.match(/<script type="application\/json" id="wx-preview-document">([^]*?)<\/script>/)[1]);
    assert.equal(data.frame.projectId, first.projectId);
    assert.equal(data.frame.assets['a.svg'], 'data:image/svg+xml;base64,' + Buffer.from('<svg>old</svg>').toString('base64'));
    assert.match(data.css, /data:image\/svg\+xml;base64/);
    const parentPolicy = (await app.request('/preview')).headers.get('content-security-policy');
    for (const [, source] of document.html.matchAll(/<script>([^]*?)<\/script>/g)) {
      assert.ok(parentPolicy.includes(`sha256-${createHash('sha256').update(source).digest('base64')}`));
    }
    assert.doesNotMatch(parentPolicy.split('script-src ')[1].split(';')[0], /unsafe-inline/);
    documentQuery.set('clientId', 'forged');
    assert.equal((await app.request(`/api/previews/${first.previewId}/document?${documentQuery}`)).status, 409);
    const saved = await app.value(`/api/previews/${first.previewId}/storage`, { ...a.identity, operationId: op(), baseRevision: a.storage.revision, data: { count: 7 } });
    assert.equal(saved.committedRevision, 1);
    const exportQuery = new URLSearchParams({ projectId: first.projectId, serverEpoch: first.serverEpoch });
    const exported = await app.value(`/api/previews/${first.previewId}/storage?${exportQuery}`);
    assert.deepEqual(exported, { ok: true, revision: 1, data: { count: 7 }, previewId: first.previewId, projectId: first.projectId, serverEpoch: first.serverEpoch });
    const rejectedExport = new URLSearchParams({ projectId: first.projectId, serverEpoch: 'old-epoch' });
    assert.equal((await app.request(`/api/previews/${first.previewId}/storage?${rejectedExport}`)).status, 409);
    const failed = await app.request(`/api/previews/${second.previewId}/storage`, { ...b.identity, operationId: op(), baseRevision: b.storage.revision, data: { count: 99 } });
    assert.equal(failed.status, 409); assert.equal((await failed.json()).code, 'STORAGE_CONFLICT');
    const cleanA = await app.attach(await app.value(`/api/previews/${first.previewId}/state`), 'window-a', a.identity);
    const cleanB = await app.attach(await app.value(`/api/previews/${second.previewId}/state`), 'window-b', b.identity);
    assert.deepEqual(cleanA.storage, { revision: 1, data: { count: 7 } }); assert.deepEqual(cleanB.storage, cleanA.storage);
    assert.equal((await app.request(`/api/previews/${first.previewId}/storage`, { ...a.identity, operationId: op(), baseRevision: 1, data: { count: 1 } })).status, 409);
    const oldBase = `/sim/${first.projectId}/${first.build.buildId}`;
    const html = await app.request(`${oldBase}/index.html?previewId=${first.previewId}`);
    assert.equal(html.status, 200); assert.match(html.headers.get('content-security-policy'), /sandbox allow-scripts/);
    assert.doesNotMatch(html.headers.get('content-security-policy'), /allow-same-origin/);
    assert.match(await html.text(), /vendor\/component-runtime\.js/);
    const css = await (await app.request(`${oldBase}/app.css?previewId=${first.previewId}`)).text();
    assert.match(css, new RegExp(`a\\.svg\\?previewId=${first.previewId}`));
    const pageFile = path.join(project, 'miniprogram/pages/index/index.wxml');
    const original = await readFile(pageFile, 'utf8');
    for (let i = 0; i < 3; i++) {
      await writeFile(path.join(project, 'miniprogram/a.svg'), `<svg>new-${i}</svg>`);
      await writeFile(pageFile, original + `\n<text>build ${i}</text>`);
      await app.value(`/api/previews/${first.previewId}/rebuild`, {});
    }
    const oldAsset = await app.request(`${oldBase}/asset/a.svg?previewId=${first.previewId}`);
    assert.equal(oldAsset.status, 200); assert.equal(await oldAsset.text(), '<svg>old</svg>');
    assert.equal((await app.request(`${oldBase}/asset/app.js?previewId=${first.previewId}`)).status, 404);
    assert.equal((await app.request(`${oldBase}/asset/a.svg?previewId=missing`)).status, 404);
    assert.equal((await app.request(`/api/previews/${first.previewId}/route`, { ...cleanA.identity, route: 'pages/index/index' })).status, 409);
    const finalWrite = await app.value(`/api/previews/${first.previewId}/storage`, { ...cleanA.identity, operationId: op(), baseRevision: 1, data: { count: 8 }, drain: true });
    assert.equal(finalWrite.committedRevision, 2);
    const latest = await app.value(`/api/previews/${first.previewId}/state`);
    const transition = { action: 'reload', serverEpoch: latest.serverEpoch, projectId: latest.projectId, expectedLeaseEpoch: cleanA.identity.leaseEpoch,
      previous: cleanA.identity, operationId: op(), next: { buildId: latest.build.buildId, clientId: 'window-a', instanceId: op() }, dirty: false };
    const result = await app.value(`/api/previews/${first.previewId}/frame`, transition);
    assert.deepEqual(await app.value(`/api/previews/${first.previewId}/frame`, transition), result);
    assert.equal((await app.value(`/api/previews/${first.previewId}/operations/${transition.operationId}`)).status, 'committed');
    assert.equal((await app.request(`${oldBase}/asset/a.svg?previewId=${first.previewId}`)).status, 409);
    assert.equal((await app.request(`${oldBase}/asset/a.svg?previewId=${second.previewId}`)).status, 200);
    const forced = { serverEpoch: latest.serverEpoch, projectId: latest.projectId, expectedLeaseEpoch: result.identity.leaseEpoch, operationId: op(), confirmDiscard: true };
    assert.equal((await app.request(`/api/previews/${first.previewId}/force-close`, forced)).status, 403);
    const closed = await app.value(`/api/previews/${first.previewId}/force-close`, forced, { origin: app.origin, 'x-preview-user-action': 'force-close' });
    assert.equal(closed.saved, false); assert.equal(closed.closed, true);
    assert.deepEqual(await app.value(`/api/previews/${first.previewId}/force-close`, forced, { origin: app.origin, 'x-preview-user-action': 'force-close' }), closed);
    assert.equal((await app.value(`/api/previews/${first.previewId}/operations/${forced.operationId}`)).closed, true);
    assert.equal((await app.value(`/api/previews/${second.previewId}/storage`)).data.count, 8);
  } finally { await app.dispose(); await rm(scratch, { recursive: true, force: true }); }
});

test('SSE watch observes file changes and restart restores descriptors/data, not old leases', async () => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'wx-http-watch-'));
  const dataDir = path.join(scratch, 'data');
  let app = await launch(dataDir); let reader; const controller = new AbortController();
  try {
    const project = path.join(scratch, 'project'); await cp(path.join(root, 'miniapp/node/demo'), project, { recursive: true });
    const state = (await app.rpc('preview_open_project', { project_path: project, create_new: true })).structuredContent;
    const frame = await app.attach(state, 'window');
    await app.value(`/api/previews/${state.previewId}/storage`, { ...frame.identity, operationId: op(), baseRevision: 0, data: { durable: true } });
    const response = await fetch(app.origin + `/api/previews/${state.previewId}/events`, { signal: controller.signal });
    reader = response.body.getReader();
    await reader.read();
    const file = path.join(project, 'miniprogram/pages/index/index.wxml');
    const original = await readFile(file, 'utf8');
    await writeFile(file, original + '\n<text>watch evidence</text>');
    const deadline = Date.now() + 5000;
    let changed;
    while (Date.now() < deadline) {
      changed = await app.value(`/api/previews/${state.previewId}/state`);
      if (changed.build.status === 'ok' && changed.build.buildId !== state.build.buildId) break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.notEqual(changed.build.buildId, state.build.buildId, JSON.stringify(changed.build.warnings));
    await writeFile(file, '<view><text></view>');
    const broken = await app.value(`/api/previews/${state.previewId}/rebuild`, {});
    assert.equal(broken.build.status, 'error'); assert.match(broken.build.errors[0].message, /unexpected closing/);
    await writeFile(file, original);
    await app.value(`/api/previews/${state.previewId}/rebuild`, {});
    controller.abort(); await reader.cancel().catch(() => undefined); reader = null;
    await app.dispose(); app = await launch(dataDir);
    const resumed = await app.value(`/api/previews/${state.previewId}/state`);
    assert.notEqual(resumed.serverEpoch, state.serverEpoch); assert.equal(resumed.lease, null);
    assert.equal((await app.request(`/api/previews/${state.previewId}/storage`, { ...frame.identity, operationId: op(), baseRevision: 1, data: {} })).status, 409);
    assert.deepEqual((await app.value(`/api/previews/${state.previewId}/storage`)).data, { durable: true });
    const rebuilt = await app.value(`/api/previews/${state.previewId}/rebuild`, {});
    const newFrame = await app.attach(rebuilt, 'new-window');
    assert.deepEqual(newFrame.storage.data, { durable: true });
  } finally { controller.abort(); await reader?.cancel().catch(() => undefined); await app.dispose(); await rm(scratch, { recursive: true, force: true }); }
});

test('SSE admission counts pending connections and explicit close ends streams and frees capacity', async () => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'wx-http-sse-'));
  const app = await launch(path.join(scratch, 'data'));
  const controller = new AbortController();
  const readers = [];
  try {
    const state = await app.value('/api/previews', { demo: true, create_new: true });
    const responses = await Promise.all(Array.from({ length: 34 }, () => fetch(app.origin + `/api/previews/${state.previewId}/events`, { signal: controller.signal })));
    assert.equal(responses.filter((response) => response.status === 200).length, 32);
    assert.equal(responses.filter((response) => response.status === 409).length, 2);
    for (const response of responses) {
      if (response.status === 200) { const reader = response.body.getReader(); await reader.read(); readers.push(reader); }
      else assert.equal((await response.json()).code, 'PREVIEW_CAPACITY_REACHED');
    }
    await app.value(`/api/previews/${state.previewId}/close`, { serverEpoch: state.serverEpoch, projectId: state.projectId, expectedLeaseEpoch: state.leaseEpoch, operationId: op(), dirty: false });
    for (const reader of readers) {
      let text = '';
      while (true) { const chunk = await reader.read(); if (chunk.done) break; text += new TextDecoder().decode(chunk.value); }
      assert.match(text, /event: closed/);
    }
    const next = await app.value('/api/previews', { demo: true, create_new: true });
    const accepted = await fetch(app.origin + `/api/previews/${next.previewId}/events`, { signal: controller.signal });
    assert.equal(accepted.status, 200); await accepted.body.cancel();
  } finally { controller.abort(); await Promise.all(readers.map((reader) => reader.cancel().catch(() => undefined))); await app.dispose(); await rm(scratch, { recursive: true, force: true }); }
});
