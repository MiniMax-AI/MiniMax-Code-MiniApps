import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Bridge } from '../miniapp/node/bridge.mjs';
import { loadConfig, saveConfig } from '../miniapp/node/config.mjs';
import { start } from '../miniapp/node/server.mjs';

// The scratch root lives in the operating system's temporary directory, so the suite
// runs the same way in the workspace, in a published package and in an installed one.
const ROOT = join(tmpdir(), 'minimax-bot-bridge-tests', 'bridge-config');
const A = { relayUrl: 'https://relay-a.example', accountId: 'room-a', bridgeId: 'bridge-a', bridgeToken: 'TOKEN_A', bridgeName: 'Desk' };
const B = { relayUrl: 'https://relay-b.example', accountId: 'room-b', bridgeId: 'bridge-b', bridgeToken: 'TOKEN_B', bridgeName: 'Desk B' };
const settle = () => new Promise(setImmediate);
function deferred() {
  /** @type {(value?: any) => void} */
  let resolve = () => {};
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

// Exercise the actual start() wiring and route, replacing only Host/socket and I/O boundaries.
async function session(t) {
  await fs.mkdir(ROOT, { recursive: true });
  const dataDir = await fs.mkdtemp(join(ROOT, 'config-'));
  await saveConfig(dataDir, A);
  const logs = [];
  const logger = { info: (...args) => logs.push(args), warn: (...args) => logs.push(args), error: (...args) => logs.push(args), debug() {} };
  /** @type {Bridge} */
  let bridge;
  /** @type {(request: any, response: any) => void} */
  let listener;
  t.mock.method(Bridge.prototype, 'start', async function () { bridge = this; });
  t.mock.method(http, 'createServer', (callback) => {
    listener = callback;
    return { once() {}, off() {}, listen(_port, _host, done) { done(); }, close() {} };
  });
  syncBuiltinESMExports();
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 404 }));
  const originalSocket = globalThis.WebSocket;
  globalThis.WebSocket = /** @type {any} */ (class {
    readyState = 0;
    addEventListener() {}
    close() {}
  });
  const app = await start({ dataDir, logger, listen: { host: '127.0.0.1', port: 54321 }, signal: new AbortController().signal });
  bridge.ledger.persist = async () => {};
  const tokens = [];
  bridge.onToken = (token) => { tokens.push(token); };
  t.after(() => {
    app.dispose();
    globalThis.WebSocket = originalSocket;
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const call = async (method, path, body = null, secret = null) => {
    const done = deferred();
    const request = {
      method, url: path,
      headers: { host: '127.0.0.1:54321', 'content-type': 'application/json', 'x-bridge-secret': secret },
      async *[Symbol.asyncIterator]() { if (body !== null) yield Buffer.from(JSON.stringify(body)); },
    };
    const response = { status: 0, writeHead(status) { this.status = status; }, end(raw) { done.resolve({ status: this.status, body: JSON.parse(raw) }); } };
    listener(request, response);
    return done.promise;
  };
  const { body: sessionBody } = await call('GET', '/api/session');
  return { bridge, dataDir, logs, tokens, post: (body) => call('POST', '/api/config', body, sessionBody.secret) };
}

function blockNextSave(t, dataDir) {
  const entered = deferred();
  const release = deferred();
  const write = fs.writeFile;
  let blocked = false;
  t.mock.method(fs, 'writeFile', async (path, contents, options) => {
    if (!blocked && String(path) === join(dataDir, 'bridge-config.json')) {
      blocked = true;
      entered.resolve();
      await release.promise;
    }
    return write(path, contents, options);
  });
  syncBuiltinESMExports();
  t.after(() => release.resolve());
  return { entered: entered.promise, release: () => release.resolve() };
}
function pendingRotation(t) {
  const pending = deferred();
  t.mock.method(globalThis, 'fetch', async (url) => String(url).endsWith('/bridge/token')
    ? pending.promise : new Response('{}', { status: 404 }));
  return () => pending.resolve(new Response(JSON.stringify({ token: 'ROTATED_A' })));
}
function outcome(promise) {
  return promise.then((token) => ({ token, error: null }), (error) => ({ token: null, error }));
}
async function assertB(state) {
  assert.equal(state.bridge.config.relayUrl, B.relayUrl);
  assert.equal(state.bridge.config.bridgeToken, 'TOKEN_B');
  assert.equal(state.bridge.relay.token, 'TOKEN_B');
  const stored = await loadConfig(state.dataDir);
  assert.equal(stored.relayUrl, B.relayUrl);
  assert.equal(stored.accountId, 'room-b');
  assert.equal(stored.bridgeToken, 'TOKEN_B');
}

test('rotation A completed after accepted configuration B cannot change memory, disk, or notify success', async (t) => {
  const state = await session(t);
  const complete = pendingRotation(t);
  const rotating = outcome(state.bridge.rotateToken());
  assert.equal((await state.post(B)).status, 200);
  complete();
  const result = await rotating;
  await assertB(state);
  assert.match(result.error?.message ?? '', /configuration changed|stale/i);
  assert.deepEqual(state.tokens, []);
  assert.ok(!JSON.stringify(state.logs).includes('the bridge token was rotated'));
  assert.ok(!JSON.stringify(state.logs).includes('ROTATED_A'));
  assert.equal(state.bridge.ledger.entries.filter((entry) => entry.kind === 'access').length, 0);
});

test('rotation A finishing while server B persistence is blocked cannot commit under B', async (t) => {
  const state = await session(t);
  const complete = pendingRotation(t);
  const rotating = outcome(state.bridge.rotateToken());
  const gate = blockNextSave(t, state.dataDir);
  const configuring = state.post(B);
  await gate.entered;
  complete();
  await settle();
  gate.release();
  assert.equal((await configuring).status, 200);
  const result = await rotating;
  await assertB(state);
  assert.match(result.error?.message ?? '', /configuration changed|stale/i);
  assert.deepEqual(state.tokens, []);
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push({ url: String(url), authorization: init.headers.authorization });
    return new Response('{}', { status: 404 });
  });
  await state.bridge.relay.fetchTicket();
  assert.deepEqual(requests, [{ url: 'https://relay-b.example/r/room-b/ws-ticket', authorization: 'Bearer TOKEN_B' }]);
});

test('a queued surface rename derives from the latest committed identity rather than reverting B', async (t) => {
  const state = await session(t);
  const gate = blockNextSave(t, state.dataDir);
  const first = state.post(B);
  await gate.entered;
  const second = state.post({ bridgeName: 'Latest name' });
  await settle();
  gate.release();
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 200);
  await assertB(state);
  assert.equal((await loadConfig(state.dataDir)).bridgeName, 'Latest name');
});

test('a bot-mode write queued during surface persistence preserves B and the preference', async (t) => {
  const state = await session(t);
  const gate = blockNextSave(t, state.dataDir);
  const configuring = state.post(B);
  await gate.entered;
  const mode = state.bridge.setBotMode({ botId: 'bot-1', mode: 'hosted' });
  await settle();
  gate.release();
  await Promise.all([configuring, mode]);
  await assertB(state);
  assert.equal(state.bridge.config.botModes['bot-1'], 'hosted');
  assert.equal((await loadConfig(state.dataDir)).botModes['bot-1'], 'hosted');
});

test('surface B and bot-mode writes queued behind rotation persistence do not restore A', async (t) => {
  const state = await session(t);
  const complete = pendingRotation(t);
  const gate = blockNextSave(t, state.dataDir);
  const rotating = outcome(state.bridge.rotateToken());
  complete();
  await gate.entered;
  const configuring = state.post(B);
  const mode = state.bridge.setBotMode({ botId: 'bot-2', mode: 'team' });
  await settle();
  gate.release();
  await Promise.all([rotating, configuring, mode]);
  await assertB(state);
  assert.equal((await loadConfig(state.dataDir)).botModes['bot-2'], 'team');
});

test('a queued target change without its own token is revalidated against the latest identity', async (t) => {
  const state = await session(t);
  const gate = blockNextSave(t, state.dataDir);
  const configuring = state.post(B);
  await gate.entered;
  const stale = state.post({ relayUrl: A.relayUrl, accountId: A.accountId });
  await settle();
  gate.release();
  assert.equal((await configuring).status, 200);
  assert.equal((await stale).status, 400);
  await assertB(state);
});

test('stop during rotation persistence restores the prior token and suppresses success callbacks', async (t) => {
  const state = await session(t);
  const complete = pendingRotation(t);
  const gate = blockNextSave(t, state.dataDir);
  const rotating = outcome(state.bridge.rotateToken());
  complete();
  await gate.entered;
  state.bridge.stop();
  state.bridge.relay.start();
  gate.release();
  const result = await rotating;
  assert.match(result.error?.message ?? '', /configuration changed|stale/i);
  assert.equal(state.bridge.config.bridgeToken, 'TOKEN_A');
  assert.equal(state.bridge.relay.token, 'TOKEN_A');
  assert.equal((await loadConfig(state.dataDir)).bridgeToken, 'TOKEN_A');
  assert.deepEqual(state.tokens, []);
});

test('a failed config write does not update memory or poison the following config commit', async (t) => {
  const state = await session(t);
  const write = fs.writeFile;
  let fail = true;
  t.mock.method(fs, 'writeFile', async (path, contents, options) => {
    if (fail && String(path) === join(state.dataDir, 'bridge-config.json')) {
      fail = false;
      throw new Error('simulated disk failure');
    }
    return write(path, contents, options);
  });
  syncBuiltinESMExports();
  assert.equal((await state.post(B)).status, 500);
  assert.equal(state.bridge.config.bridgeToken, 'TOKEN_A');
  assert.equal(state.bridge.relay.token, 'TOKEN_A');
  assert.equal((await state.post(B)).status, 200);
  await assertB(state);
});

test('same-identity proactive renewal still persists the token and keeps concurrent preferences', async (t) => {
  const state = await session(t);
  const complete = pendingRotation(t);
  t.mock.method(state.bridge.relay, 'tokenExpiresAt', () => Date.now() + 1000);
  const rotating = state.bridge.rotateTokenIfExpiring();
  await state.bridge.setBotMode({ botId: 'bot-3', mode: 'hosted' });
  complete();
  assert.equal(await rotating, true);
  assert.equal(state.bridge.config.bridgeToken, 'ROTATED_A');
  assert.equal(state.bridge.relay.token, 'ROTATED_A');
  const stored = await loadConfig(state.dataDir);
  assert.equal(stored.bridgeToken, 'ROTATED_A');
  assert.equal(stored.botModes['bot-3'], 'hosted');
  assert.deepEqual(state.tokens, ['ROTATED_A']);
});
