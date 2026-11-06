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
const ROOT = join(tmpdir(), 'minimax-bot-bridge-tests', 'bridge-authority');
const A = { relayUrl: 'https://relay-a.example', accountId: 'a', bridgeId: 'desktop', bridgeToken: 'OLD', bridgeName: 'Desk' };
const B = { ...A, relayUrl: 'https://relay-b.example', accountId: 'b', bridgeToken: 'B' };
const settle = () => new Promise(setImmediate);
function deferred() {
  /** @type {(value?: any) => void} */ let resolve = () => {};
  const promise = new Promise(done => { resolve = done; }); return { promise, resolve };
}
async function session(t) {
  await fs.mkdir(ROOT, { recursive: true });
  const dataDir = await fs.mkdtemp(join(ROOT, 'http-')); await saveConfig(dataDir, A);
  /** @type {Bridge | undefined} */
  let bridge;
  let listener, starts = 0;
  const realStart = Bridge.prototype.start;
  t.mock.method(Bridge.prototype, 'start', async function () { bridge = this; starts += 1; return realStart.call(this); });
  t.mock.method(http, 'createServer', callback => { listener = callback;
    return { once() {}, off() {}, listen(_port, _host, done) { done(); }, close() {} }; });
  syncBuiltinESMExports();
  const sockets = [];
  const oldSocket = globalThis.WebSocket;
  globalThis.WebSocket = /** @type {any} */ (class {
    readyState = 0;
    constructor(url) { this.url = url; sockets.push(this); }
    addEventListener() {} close() {}
  });
  const rotation = deferred(), requested = deferred();
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url).endsWith('/bridge/token')) { requested.resolve(); return rotation.promise; }
    return new Response('{}', { status: 404 });
  });
  const app = await start({ dataDir, logger: { info() {}, warn() {}, error() {}, debug() {} },
    listen: { host: '127.0.0.1', port: 54321 }, signal: new AbortController().signal,
    tool: { list: async () => ({ tools: [] }) } });
  await settle(); assert.equal(starts, 1); assert.equal(sockets.length, 1);
  assert.ok(bridge, 'the real start() must capture its live Bridge instance');
  t.after(() => { app.dispose(); globalThis.WebSocket = oldSocket; t.mock.restoreAll(); syncBuiltinESMExports(); });
  const tokens = []; bridge.onToken = token => { tokens.push(token); };
  const call = async (method, path, body = null, secret = undefined) => {
    const done = deferred();
    const request = { method, url: path, headers: { host: '127.0.0.1:54321', 'content-type': 'application/json', 'x-bridge-secret': secret },
      async *[Symbol.asyncIterator]() { if (body !== null) yield Buffer.from(JSON.stringify(body)); } };
    const response = { status: 0, writeHead(status) { this.status = status; }, end(raw) { done.resolve({ status: this.status, body: JSON.parse(raw) }); } };
    listener(request, response); return done.promise;
  };
  const secret = (await call('GET', '/api/session')).body.secret;
  return { bridge, dataDir, tokens, sockets, requested: requested.promise,
    complete: () => rotation.resolve(new Response(JSON.stringify({ token: 'NEW' }))),
    post: body => call('POST', '/api/config', body, secret), rotate: () => call('POST', '/api/rotate-token', {}, secret) };
}
/** @type {Array<[string, Partial<typeof A>]>} */
const sameAuthoritySaves = [
  ['unchanged complete configuration', A],
  ['name-only configuration', { bridgeName: 'Renamed' }],
  ['equivalent WebSocket-scheme configuration', { relayUrl: 'wss://relay-a.example/' }],
];
for (const [name, update] of sameAuthoritySaves) {
  test(`real start and HTTP ${name} save preserve a valid same-authority rotation`, async t => {
    const state = await session(t);
    const epoch = state.bridge.relay.epoch;
    const rotating = state.rotate(); await state.requested;
    assert.equal((await state.post(update)).status, 200);
    await state.bridge.setBotMode({ botId: 'bot', mode: 'hosted' });
    state.complete();
    assert.equal((await rotating).status, 200);
    assert.equal(state.bridge.relay.epoch, epoch);
    assert.equal(state.bridge.config.bridgeToken, 'NEW'); assert.equal(state.bridge.relay.token, 'NEW');
    const saved = await loadConfig(state.dataDir);
    assert.equal(saved.bridgeToken, 'NEW'); assert.equal(saved.botModes.bot, 'hosted');
    assert.deepEqual(state.tokens, ['NEW']);
    assert.equal(state.sockets.length, 1, 'cosmetic saves do not reconnect or promise an immediate remote rename');
    state.bridge.relay.start(); await settle();
    assert.equal(new URL(state.sockets.at(-1).url).searchParams.get('name'), update.bridgeName ?? A.bridgeName);
  });
}

test('a queued unchanged token field cannot roll a completed rotation back to its revoked predecessor', async t => {
  const state = await session(t);
  const entered = deferred(), release = deferred();
  const write = fs.writeFile; let blocked = false;
  t.mock.method(fs, 'writeFile', async (path, contents, options) => {
    if (!blocked && String(path) === join(state.dataDir, 'bridge-config.json')) {
      blocked = true; entered.resolve(); await release.promise;
    }
    return write(path, contents, options);
  });
  syncBuiltinESMExports(); t.after(() => release.resolve());
  const rotating = state.rotate(); await state.requested; state.complete(); await entered.promise;
  const saving = state.post({ ...A, bridgeName: 'Queued name' });
  await settle(); release.resolve();
  assert.equal((await rotating).status, 200); assert.equal((await saving).status, 200);
  const saved = await loadConfig(state.dataDir);
  assert.equal(saved.bridgeToken, 'NEW'); assert.equal(saved.bridgeName, 'Queued name');
});

test('an explicit same-room credential replacement still fences an older pending rotation', async t => {
  const state = await session(t);
  const rotating = state.rotate(); await state.requested;
  assert.equal((await state.post({ bridgeToken: 'EXPLICIT' })).status, 200);
  state.complete(); assert.equal((await rotating).status, 502);
  assert.equal(state.bridge.config.bridgeToken, 'EXPLICIT');
  assert.equal(state.bridge.relay.token, 'EXPLICIT');
  assert.equal((await loadConfig(state.dataDir)).bridgeToken, 'EXPLICIT');
  assert.deepEqual(state.tokens, []);
});

test('real HTTP A to B to A still invalidates the original rotation and preserves the final authority', async t => {
  const state = await session(t);
  const rotating = state.rotate(); await state.requested;
  assert.equal((await state.post(B)).status, 200); assert.equal((await state.post(A)).status, 200);
  state.complete();
  assert.equal((await rotating).status, 502);
  assert.equal((await loadConfig(state.dataDir)).bridgeToken, 'OLD');
  assert.deepEqual(state.tokens, []);
});
