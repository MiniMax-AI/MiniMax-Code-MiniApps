import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as reservePort } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { start } from '../miniapp/node/server.mjs';

const pluginRoot = fileURLToPath(new URL('../', import.meta.url));
let serial = 0;
const operation = () => `game-http-${++serial}`;
async function launch(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'minigame-http-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const reserve = reservePort();
  await new Promise((resolve, reject) => { reserve.once('error', reject); reserve.listen(0, '127.0.0.1', resolve); });
  const port = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  const lifecycle = await start({ pluginRoot, dataDir: path.join(directory, 'data'), listen: { host: '127.0.0.1', port }, signal: new AbortController().signal, logger: { info() {}, warn() {}, error() {} } });
  t.after(() => lifecycle.dispose());
  const origin = `http://127.0.0.1:${port}`;
  const request = (route, body, headers = {}) => fetch(origin + route, body === undefined ? { headers } : { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const value = async (...args) => { const response = await request(...args); const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result; };
  const rpc = async (name, args = {}) => (await value('/mcp/preview', { jsonrpc: '2.0', id: operation(), method: 'tools/call', params: { name, arguments: args } })).result;
  const attach = (state, clientId, previous) => value(`/api/previews/${state.previewId}/frame`, { action: previous ? 'reload' : 'attach', serverEpoch: state.serverEpoch,
    projectId: state.projectId, expectedLeaseEpoch: previous?.leaseEpoch ?? state.leaseEpoch, operationId: operation(), dirty: false,
    next: { buildId: state.build.buildId, clientId, instanceId: operation() }, ...(previous ? { previous } : {}) });
  const document = (identity) => value(`/api/previews/${identity.previewId}/document?` + new URLSearchParams(Object.fromEntries(['serverEpoch', 'buildId', 'clientId', 'instanceId', 'leaseEpoch'].map((key) => [key, String(identity[key])]))));
  return { directory, origin, request, value, rpc, attach, document };
}

test('game documents contain only bootstrap/device/game scripts, create no duplicate canvas, and refuse old sim debug routes', async (t) => {
  const app = await launch(t);
  const program = await app.value('/api/previews', { demo: true, create_new: true });
  const games = [];
  for (const example of ['minigame-2d', 'minigame-webgl']) {
    const state = await app.value('/api/previews', { demo: true, example, create_new: true });
    games.push(state);
    assert.equal(state.projectKind, 'minigame'); assert.equal(state.build.status, 'ok');
    const { identity } = await app.attach(state, example);
    const document = await app.document(identity);
    const scripts = [...document.html.matchAll(/<script>([^]*?)<\/script>/g)].map((match) => match[1]);
    assert.equal(scripts.length, 3);
    const escaped = (source) => source.replace(/<\/script/gi, (match) => match.replace('/', '\\/'));
    assert.equal(scripts[1], escaped(await readFile(path.join(pluginRoot, 'miniapp/client/device-config.js'), 'utf8')));
    assert.equal(scripts[2], escaped(await readFile(path.join(pluginRoot, 'miniapp/client/game-runtime.js'), 'utf8')));
    const dom = new JSDOM(document.html.split('<script')[0]);
    try {
      const capsule = dom.window.document.querySelector('#wx-capsule');
      assert.ok(capsule);
      assert.equal(capsule.parentElement, dom.window.document.body);
      assert.equal(capsule.textContent, '');
      assert.ok(capsule.querySelector('.wx-capsule-menu'));
      assert.ok(capsule.querySelector('.wx-capsule-exit'));
      assert.equal(capsule.querySelectorAll('button,a').length, 0);
      assert.equal(dom.window.document.querySelectorAll('#wx-capsule').length, 1);
    } finally { dom.window.close(); }
    assert.doesNotMatch(document.html.split('<body>')[1].split('<script')[0], /canvas|main|game-message/);
    const data = JSON.parse(document.html.match(/<script type="application\/json" id="wx-preview-document">([^]*?)<\/script>/)[1]);
    assert.equal(data.build.projectKind, 'minigame'); assert.equal(data.build.entryModule, 'game.js');
    assert.equal(Object.hasOwn(data.build, 'componentStyles'), false);
    const policy = document.html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
    for (const source of scripts) assert.match(policy, new RegExp('sha256-' + createHash('sha256').update(source).digest('base64').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(policy, /allow-same-origin|unsafe-inline.*script-src/);
    for (const resource of ['index.html', 'bundle.js', 'app.css', 'asset/anything.png']) {
      const refused = await app.request(`/sim/${state.projectId}/${state.build.buildId}/${resource}?previewId=${state.previewId}`);
      assert.equal(refused.status, 400); assert.equal((await refused.json()).code, 'UNSUPPORTED_PROJECT_ACTION');
    }
  }
  const p = await app.attach(program, 'program'); const programDocument = await app.document(p.identity);
  assert.equal([...programDocument.html.matchAll(/<script>([^]*?)<\/script>/g)].length, 4);
  assert.match(programDocument.html, /id="wx-viewport"/);
  assert.equal((await app.value('/api/previews')).previews.length, 3);
  assert.equal(games[0].build.manifest.game.deviceOrientation, 'portrait');
  assert.equal(games[1].build.manifest.game.deviceOrientation, 'landscape');
});

test('direct-open MCP tools retain kind ambiguity and reject removed authorization routes', async (t) => {
  const app = await launch(t);
  const tools = await app.value('/mcp/preview', { jsonrpc: '2.0', id: operation(), method: 'tools/list' });
  assert.equal(tools.result.tools.length, 9);
  const gameControl = tools.result.tools.find((tool) => tool.name === 'preview_game_control');
  assert.deepEqual(gameControl.inputSchema.properties.action.enum, ['pause', 'resume', 'restart']);
  assert.deepEqual(tools.result.tools.find((tool) => tool.name === 'preview_open_project').inputSchema.properties.project_kind.enum, ['miniprogram', 'minigame']);
  for (const args of [{ action: 'resume', extra: true }, { action: 'reset' }, { action: 1 }]) assert.equal((await app.rpc('preview_game_control', args)).structuredContent.code, 'INVALID_ARGUMENTS');
  const dual = path.join(app.directory, 'dual'); await mkdir(dual);
  for (const [file, content] of Object.entries({ 'app.json': '{"pages":["index"],"lazyCodeLoading":"requiredComponents"}', 'app.js': 'App({});', 'index.js': 'Page({});', 'index.wxml': '<view/>', 'game.json': '{}', 'game.js': 'GameGlobal.ok=true;' })) await writeFile(path.join(dual, file), content);
  const removed = await app.request('/api/projects/open', { projectPath: dual, confirmAccess: true }, { origin: app.origin, 'x-preview-user-action': 'authorize-project' });
  assert.equal(removed.status, 404);
  const registered = (await app.rpc('preview_open_project', { project_path: dual, project_kind: 'minigame', create_new: true })).structuredContent;
  assert.equal(registered.projectKind, 'minigame'); assert.equal(registered.build.status, 'ok');
  assert.equal(registered.hostOpenAction.pluginId, 'wechat-miniprogram-preview');
  const mcpAmbiguous = await app.rpc('preview_open_project', { project_path: dual, create_new: true });
  assert.equal(mcpAmbiguous.isError, true); assert.equal(mcpAmbiguous.structuredContent.code, 'AMBIGUOUS_PROJECT_KIND');
  assert.deepEqual(mcpAmbiguous.structuredContent.details.choices, ['miniprogram', 'minigame']);
  await writeFile(path.join(dual, 'project.config.json'), '{"compileType":"game"}');
  const mismatch = (await app.rpc('preview_open_project', { project_path: dual, project_kind: 'miniprogram', create_new: true })).structuredContent;
  assert.equal(mismatch.code, 'PROJECT_KIND_MISMATCH'); assert.equal(mismatch.details.requestedKind, 'miniprogram'); assert.equal(mismatch.details.configuredKind, 'minigame');
  for (const body of [{ example: 'minigame-2d' }, { project_id: registered.projectId, example: 'minigame-2d' }, { demo: false, example: 'minigame-2d', project_id: registered.projectId }, { demo: true, project_id: registered.projectId }]) {
    assert.equal((await app.request('/api/previews', body)).status, 400);
  }
  const wrongExample = await app.request('/api/previews', { demo: true, example: 'minigame-2d', project_kind: 'miniprogram' });
  assert.equal(wrongExample.status, 400); assert.equal((await wrongExample.json()).code, 'PROJECT_KIND_MISMATCH');
  const game = await app.value('/api/previews', { project_id: registered.projectId, create_new: true });
  assert.equal((await app.rpc('preview_navigate', { preview_id: game.previewId, page: 'index' })).structuredContent.code, 'UNSUPPORTED_PROJECT_ACTION');
  assert.equal((await app.rpc('preview_open_project', { project_path: dual, project_kind: 'minigame', create_new: true, page: 'index' })).structuredContent.code, 'UNSUPPORTED_PROJECT_ACTION');
  assert.equal((await app.rpc('preview_open_project', { project_path: dual, project_kind: 'minigame', create_new: true, query: {} })).structuredContent.code, 'UNSUPPORTED_PROJECT_ACTION');
});

test('HTTP game control/state enforce full frame identity and same-game contexts use independent CAS', async (t) => {
  const app = await launch(t);
  const first = await app.value('/api/previews', { demo: true, example: 'minigame-2d', create_new: true });
  const second = await app.value('/api/previews', { project_id: first.projectId, create_new: true });
  const a = await app.attach(first, 'first'); const b = await app.attach(second, 'second');
  const target = `/api/previews/${first.previewId}`;
  assert.equal((await app.request(target + '/game-control', { action: 'pause' })).status, 400);
  for (const patch of [{ leaseEpoch: a.identity.leaseEpoch + 1 }, { instanceId: 'stale' }, { buildId: 'old' }, { serverEpoch: 'old-epoch' }, { clientId: 'different' }]) {
    const control = await app.request(target + '/game-control', { ...a.identity, ...patch, action: 'pause' });
    assert.equal(control.status, 409); assert.equal((await control.json()).code, 'STALE_FRAME');
    assert.equal((await app.request(target + '/game-state', { ...a.identity, ...patch, paused: true })).status, 409);
  }
  assert.equal((await app.request(target + '/game-state', { ...a.identity, paused: true, framesPerSecond: 900 })).status, 400);
  await app.value(target + '/game-control', { ...a.identity, action: 'pause' });
  await app.value(target + '/game-state', { ...a.identity, paused: true, reason: 'user', framesPerSecond: 30 });
  assert.equal((await app.value(target + '/state')).gameState.paused, true);
  assert.equal((await app.value(`/api/previews/${second.previewId}/state`)).gameState, null);
  const write = await app.value(target + '/storage', { ...a.identity, baseRevision: 0, operationId: operation(), data: { score: 9 } });
  assert.equal(write.committedRevision, 1);
  const conflict = await app.request(`/api/previews/${second.previewId}/storage`, { ...b.identity, baseRevision: 0, operationId: operation(), data: { score: 100 } });
  assert.equal(conflict.status, 409); assert.equal((await conflict.json()).code, 'STORAGE_CONFLICT');
  const restart = await app.rpc('preview_game_control', { preview_id: first.previewId, action: 'restart' });
  assert.equal(restart.structuredContent.accepted, true);
  const fresh = await app.attach(await app.value(target + '/state'), 'first', a.identity);
  assert.deepEqual(fresh.storage.data, { score: 9 });
  assert.equal((await app.value(target + '/state')).gameState, null);
  assert.equal((await app.request(target + '/game-state', { ...a.identity, paused: true })).status, 409);
});
