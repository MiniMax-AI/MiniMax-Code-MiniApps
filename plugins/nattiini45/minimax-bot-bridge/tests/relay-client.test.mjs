import assert from 'node:assert/strict';
import test from 'node:test';

import { RelayClient } from '../miniapp/node/relay-client.mjs';

const LOGGER = { info() {}, warn() {}, error() {}, debug() {} };

test('a relay address given as http is used as ws for the socket', () => {
  const client = new RelayClient({
    url: 'http://127.0.0.1:8787',
    accountId: 'default',
    bridgeId: 'bridge-1',
    token: 'tok',
    logger: LOGGER,
  });
  assert.equal(client.wsUrl(), 'ws://127.0.0.1:8787');
  assert.equal(client.httpUrl(), 'http://127.0.0.1:8787');
});

test('a relay address given as wss is used as https for the pairing request', () => {
  const client = new RelayClient({
    url: 'wss://relay.example.workers.dev',
    accountId: 'default',
    bridgeId: 'bridge-1',
    token: 'tok',
    logger: LOGGER,
  });
  assert.equal(client.wsUrl(), 'wss://relay.example.workers.dev');
  assert.equal(client.httpUrl(), 'https://relay.example.workers.dev');
});

test('a trailing slash never doubles up in the endpoint', () => {
  const client = new RelayClient({
    url: 'http://127.0.0.1:8787/',
    accountId: 'default',
    bridgeId: 'bridge-1',
    token: 'tok',
    logger: LOGGER,
  });
  assert.match(client.endpoint(), /^ws:\/\/127\.0\.0\.1:8787\/r\/default\/ws\?/);
  assert.equal(client.endpoint().includes('8787//'), false);
});

test('the endpoint carries the role, the subject and the token', () => {
  const client = new RelayClient({
    url: 'http://127.0.0.1:8787',
    accountId: 'default',
    bridgeId: 'bridge-1',
    token: 'a token',
    logger: LOGGER,
  });
  const url = new URL(client.endpoint());
  assert.equal(url.pathname, '/r/default/ws');
  assert.equal(url.searchParams.get('role'), 'bridge');
  assert.equal(url.searchParams.get('subject'), 'bridge-1');
  assert.equal(url.searchParams.get('token'), 'a token');
});

test('the endpoint carries a ticket instead of the token when there is one', () => {
  const client = new RelayClient({
    url: 'http://127.0.0.1:8787',
    accountId: 'default',
    bridgeId: 'bridge-1',
    token: 'a token',
    logger: LOGGER,
  });
  const url = new URL(client.endpoint('the-ticket'));
  assert.equal(url.searchParams.get('ticket'), 'the-ticket');
  // The token itself does not travel in the URL.
  assert.equal(url.searchParams.get('token'), null);
});

test('the ticket is asked for over a request that can carry a header', async () => {
  const seen = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), init });
    return new Response(JSON.stringify({ ticket: 'the-ticket' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const client = new RelayClient({
      url: 'https://relay.example.workers.dev',
      accountId: 'default',
      bridgeId: 'bridge-1',
      token: 'tok',
      logger: LOGGER,
    });

    const ticket = await client.fetchTicket();

    assert.equal(ticket, 'the-ticket');
    assert.equal(seen[0].url, 'https://relay.example.workers.dev/r/default/ws-ticket');
    assert.equal(seen[0].init.headers.authorization, 'Bearer tok');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a relay that does not offer tickets leaves the token where it was', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('nope', { status: 404 });

  try {
    const client = new RelayClient({
      url: 'https://relay.example.workers.dev',
      accountId: 'default',
      bridgeId: 'bridge-1',
      token: 'tok',
      logger: LOGGER,
    });

    assert.equal(await client.fetchTicket(), null);
    assert.equal(new URL(client.endpoint(null)).searchParams.get('token'), 'tok');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the pairing request is sent over http even when the relay is addressed as ws', async () => {
  const seen = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), init });
    return new Response(JSON.stringify({ code: '123456', expiresAt: Date.now() + 60000 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const client = new RelayClient({
      url: 'ws://127.0.0.1:8787',
      accountId: 'default',
      bridgeId: 'bridge-1',
      token: 'tok',
      logger: LOGGER,
    });
    const result = await client.createPairingCode();
    assert.equal(result.code, '123456');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, 'http://127.0.0.1:8787/r/default/pair/code');
    assert.equal(seen[0].init.method, 'POST');
    assert.equal(seen[0].init.headers.authorization, 'Bearer tok');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a bridge with no token refuses to ask for a pairing code', async () => {
  const client = new RelayClient({
    url: 'http://127.0.0.1:8787',
    accountId: 'default',
    bridgeId: 'bridge-1',
    token: '',
    logger: LOGGER,
  });
  assert.equal(client.configured, false);
  await assert.rejects(() => client.createPairingCode(), /not configured/i);
});
