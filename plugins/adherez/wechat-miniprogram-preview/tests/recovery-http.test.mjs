import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { start } from '../miniapp/node/server.mjs';

const pluginRoot = fileURLToPath(new URL('../', import.meta.url));
let sequence = 0;
test('direct Agent open exposes one-button UI and metadata-only recovery with identity and origin checks', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wechat-recovery-http-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = path.join(root, 'new-project'); await cp(path.join(pluginRoot, 'miniapp/node/demo'), project, { recursive: true });
  const reservation = createServer(); await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
  const port = reservation.address().port; await new Promise((resolve) => reservation.close(resolve));
  const host = await start({ pluginRoot, dataDir: path.join(root, 'data'), listen: { host: '127.0.0.1', port }, signal: new AbortController().signal, logger: { info() {}, warn() {}, error() {} } });
  t.after(() => host.dispose());
  const origin = `http://127.0.0.1:${port}`;
  const post = async (route, body, headers = {}) => {
    const response = await fetch(origin + route, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const rpc = async (name, args) => (await post('/mcp/preview', { jsonrpc: '2.0', id: ++sequence, method: 'tools/call', params: { name, arguments: args } })).data.result;
  const opened = (await rpc('preview_open_project', { project_path: project, create_new: true })).structuredContent;
  assert.equal(opened.build.status, 'ok'); assert.equal(opened.nextStep, 'open_miniapp'); assert.equal(opened.capabilityVersion, 4);
  assert.deepEqual(opened.hostOpenAction, { action: 'open', pluginId: 'wechat-miniprogram-preview', path: opened.surfacePath });
  await assert.rejects(readFile(path.join(root, 'data/project-access.json')), { code: 'ENOENT' });
  const html = await (await fetch(origin + opened.surfacePath)).text();
  assert.equal((html.match(/<button\b/g) || []).length, 1); assert.match(html, /id="refresh-preview"/);
  assert.doesNotMatch(html, /<dialog|<select|id="open-project"|id="game-toggle"|id="advanced-panel"/);

  const registration = { previewId: opened.previewId, serverEpoch: opened.serverEpoch, clientId: 'client-test', registrationId: 'private-registration-test' };
  assert.equal((await post('/api/shells', registration)).status, 403);
  assert.equal((await post('/api/shells', registration, { origin: 'null' })).status, 403);
  const channel = (await post('/api/shells', registration, { origin })).data.channelId;
  assert.equal(typeof channel, 'string');
  assert.equal((await post('/api/shells', registration, { origin })).data.channelId, channel);
  const abort = new AbortController(); t.after(() => abort.abort());
  const stream = await fetch(origin + `/api/shells/${channel}/events`, { signal: abort.signal });
  const reader = stream.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: connected/);

  const firstFrame = (await post(`/api/previews/${opened.previewId}/frame`, { action: 'attach', serverEpoch: opened.serverEpoch,
    projectId: opened.projectId, expectedLeaseEpoch: 0, operationId: 'attach-operation', next: { buildId: opened.build.buildId, clientId: registration.clientId, instanceId: 'instance-one' }, dirty: false })).data;
  const state = { revision: 1, identity: firstFrame.identity, contextLeaseEpoch: 1, status: 'storage_conflict', dirty: true, exportAvailable: true };
  assert.equal((await post(`/api/shells/${channel}/state`, { ...state, data: { private: true } }, { origin })).status, 400);
  assert.equal((await post(`/api/shells/${channel}/state`, { ...state, identity: { ...state.identity, clientId: 'other' } }, { origin })).status, 409);
  assert.equal((await post(`/api/shells/${channel}/state`, state, { origin })).status, 200);
  const status = (await rpc('preview_status', { preview_id: opened.previewId })).structuredContent;
  assert.equal(status.recoveryShells.length, 1);
  assert.deepEqual(status.recoveryShells[0].availableActions, ['export_local', 'discard_local', 'close']);
  assert.doesNotMatch(JSON.stringify(status), new RegExp(channel + '|private-registration-test'));

  const recovery = { preview_id: opened.previewId, client_id: registration.clientId, state_revision: 1, action: 'discard_local' };
  assert.equal((await rpc('preview_recover', recovery)).structuredContent.code, 'CONFIRMATION_REQUIRED');
  const requested = (await rpc('preview_recover', { ...recovery, action: 'export_local', request_id: 'export-once' })).structuredContent;
  assert.equal(requested.accepted, true); assert.equal(requested.status, 'pending');
  let event = '';
  for (let i = 0; i < 12 && !event.includes('event: recovery-command'); i++) event += new TextDecoder().decode((await reader.read()).value);
  assert.match(event, /recovery-command/); assert.match(event, /export-once/);
  const ack = { requestId: 'export-once', stateRevision: 1, status: 'export_requested' };
  assert.equal((await post(`/api/shells/${channel}/ack`, ack, { origin: 'https://other.example' })).status, 403);
  assert.equal((await post(`/api/shells/${channel}/ack`, ack, { origin })).status, 200);
  const after = (await rpc('preview_status', { preview_id: opened.previewId })).structuredContent;
  assert.equal(after.recoveryShells[0].lastCommand.status, 'export_requested');
  assert.equal((await rpc('preview_recover', { ...recovery, action: 'export_local', request_id: 'export-once' })).structuredContent.replayed, true);
  abort.abort(); await reader.cancel().catch(() => {});
});
