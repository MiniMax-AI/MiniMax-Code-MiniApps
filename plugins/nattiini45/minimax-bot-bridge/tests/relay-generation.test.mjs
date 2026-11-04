import assert from 'node:assert/strict';
import test from 'node:test';

import { RelayClient } from '../miniapp/node/relay-client.mjs';

const A = { url: 'https://relay-a.example', accountId: 'room-a', bridgeId: 'bridge-a', token: 'TOKEN_A', name: 'Desk' };
const B = { url: 'https://relay-b.example', accountId: 'room-b', bridgeId: 'bridge-b', token: 'TOKEN_B', name: 'Desk' };
const LOGGER = { info() {}, warn() {}, error() {}, debug() {} };
const settle = () => new Promise(setImmediate);
function deferred() {
  /** @type {(value?: any) => void} */
  let resolve = () => {};
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
class Socket {
  static all = [];
  constructor(url) {
    this.url = String(url);
    this.readyState = 0;
    this.listeners = new Map();
    this.sent = [];
    Socket.all.push(this);
  }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  fire(type, event = {}) { this.listeners.get(type)?.(event); }
  open() { this.readyState = 1; this.fire('open'); }
  send(raw) { this.sent.push(raw); }
  close() { this.readyState = 3; }
}
function network(t) {
  Socket.all = [];
  const original = globalThis.WebSocket;
  globalThis.WebSocket = /** @type {any} */ (Socket);
  t.after(() => { globalThis.WebSocket = original; });
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 404 }));
}

for (const lifecycle of ['A to B', 'A to B to A', 'stop then start']) {
  test(`a pending ticket cannot open a socket after ${lifecycle}`, async (t) => {
    network(t);
    const pending = deferred();
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls += 1;
      return calls === 1 ? pending.promise : new Response(JSON.stringify({ ticket: `CURRENT_${calls}` }));
    });
    const client = new RelayClient({ ...A, logger: LOGGER });
    t.after(() => client.stop());
    client.start();
    if (lifecycle === 'stop then start') { client.stop(); client.start(); }
    else { client.reconfigure(B); if (lifecycle === 'A to B to A') client.reconfigure(A); }
    await settle();
    const live = client.socket;
    const count = Socket.all.length;
    pending.resolve(new Response(JSON.stringify({ ticket: 'STALE_TICKET_A' })));
    await settle();
    assert.equal(Socket.all.length, count, 'stale completion must not construct a socket');
    assert.equal(client.socket, live);
    assert.ok(Socket.all.every((socket) => !socket.url.includes('STALE_TICKET_A')));
  });
}

test('a ticket response body that finishes after reconfigure is also stale', async (t) => {
  network(t);
  const body = deferred();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1
    ? { ok: true, json: () => body.promise }
    : new Response('{}', { status: 404 }));
  const client = new RelayClient({ ...A, logger: LOGGER });
  t.after(() => client.stop());
  client.start();
  await settle();
  client.reconfigure(B);
  await settle();
  body.resolve({ ticket: 'STALE_BODY_A' });
  await settle();
  assert.equal(Socket.all.length, 1);
  assert.match(Socket.all[0].url, /relay-b\.example/);
});

test('old socket open/message/close callbacks are inert, including ticket fallback', async (t) => {
  network(t);
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ ticket: 'ticket' })));
  const statuses = [];
  const frames = [];
  const client = new RelayClient({ ...A, logger: LOGGER, onStatus: (value) => statuses.push(value), onFrame: (frame) => frames.push(frame) });
  t.after(() => client.stop());
  client.start();
  await settle();
  const old = Socket.all[0];
  client.reconfigure(B);
  await settle();
  const live = Socket.all.at(-1);
  client.send({ private: 'B_ONLY' });
  const before = statuses.length;
  old.fire('open');
  old.fire('message', { data: JSON.stringify({ private: 'A_ONLY' }) });
  old.fire('close');
  assert.equal(statuses.length, before, 'stale open must not report online');
  assert.deepEqual(frames, [], 'stale messages must not reach the bridge');
  assert.deepEqual(live.sent, [], 'stale open must not flush the current queue');
  assert.equal(client.socket, live);
  assert.equal(Socket.all.length, 2, 'stale close must not trigger token fallback');
  live.open();
  assert.deepEqual(live.sent, [JSON.stringify({ private: 'B_ONLY' })]);
});

for (const changed of [{ url: B.url }, { accountId: B.accountId }, { bridgeId: B.bridgeId }]) {
  test(`offline frames are discarded on ${Object.keys(changed)[0]} identity change`, async (t) => {
    network(t);
    const client = new RelayClient({ ...A, logger: LOGGER });
    t.after(() => client.stop());
    client.send({ private: 'A_ONLY' });
    client.reconfigure({ ...A, ...changed });
    await settle();
    Socket.all[0].open();
    assert.deepEqual(Socket.all[0].sent, []);
  });
}

test('same-identity token refresh and stop/start preserve offline frames', async (t) => {
  network(t);
  const client = new RelayClient({ ...A, logger: LOGGER });
  t.after(() => client.stop());
  client.send({ private: 'KEEP' });
  client.reconfigure({ ...A, url: 'wss://relay-a.example/', token: 'REFRESHED_A' });
  client.stop();
  client.start();
  await settle();
  const live = Socket.all.at(-1);
  live.open();
  assert.deepEqual(live.sent, [JSON.stringify({ private: 'KEEP' })]);
});

test('reconfigure clears the retry timer and an already-queued old callback is inert', async (t) => {
  network(t);
  const timers = [];
  t.mock.method(globalThis, 'setTimeout', (fn) => {
    const timer = { fn, unref() {} };
    timers.push(timer);
    return timer;
  });
  const cleared = [];
  t.mock.method(globalThis, 'clearTimeout', (timer) => cleared.push(timer));
  const client = new RelayClient({ ...A, logger: LOGGER });
  t.after(() => client.stop());
  client.scheduleReconnect();
  const old = timers[0];
  client.reconfigure(B);
  await settle();
  const live = client.socket;
  old.fn();
  await settle();
  assert.ok(cleared.includes(old));
  assert.equal(Socket.all.length, 1);
  assert.equal(client.socket, live);
});

test('a malformed rotation response cannot expose credentials in its error', async (t) => {
  network(t);
  t.mock.method(globalThis, 'fetch', async () => new Response('TOKEN_A is not JSON'));
  const client = new RelayClient({ ...A, logger: LOGGER });
  t.after(() => client.stop());
  await assert.rejects(client.rotateToken(), (error) => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes('TOKEN_A'));
    return true;
  });
});

for (const lifecycle of ['A to B', 'A to B to A', 'stop then start']) {
  test(`a pending rotation cannot replace credentials after ${lifecycle}`, async (t) => {
    network(t);
    const rotation = deferred();
    const seen = [];
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      seen.push({ url: String(url), authorization: init.headers.authorization });
      return String(url).endsWith('/bridge/token') ? rotation.promise : new Response('{}', { status: 404 });
    });
    const client = new RelayClient({ ...A, logger: LOGGER });
    t.after(() => client.stop());
    const result = assert.rejects(client.rotateToken(), /configuration changed|stale/i);
    if (lifecycle === 'stop then start') { client.stop(); client.start(); }
    else { client.reconfigure(B); if (lifecycle === 'A to B to A') client.reconfigure(A); }
    rotation.resolve(new Response(JSON.stringify({ token: 'ROTATED_A' })));
    await result;
    await settle();
    const expected = lifecycle === 'A to B' ? 'TOKEN_B' : 'TOKEN_A';
    assert.equal(client.token, expected);
    client.connect();
    await settle();
    assert.ok(seen.every((request) => !request.url.includes('relay-b.example') || request.authorization === 'Bearer TOKEN_B'));
    assert.ok(Socket.all.every((socket) => !socket.url.includes('ROTATED_A')));
  });
}
