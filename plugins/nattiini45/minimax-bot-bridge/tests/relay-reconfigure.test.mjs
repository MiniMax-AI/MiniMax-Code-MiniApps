import assert from 'node:assert/strict';
import test from 'node:test';

import { RelayClient } from '../miniapp/node/relay-client.mjs';

/**
 * Changing the relay configuration.
 *
 * The desktop can be pointed at another relay. The socket that was open against the
 * old address has to be closed on purpose, and its close event must not be allowed to
 * clear the socket that replaced it.
 */

const LOGGER = { info() {}, warn() {}, error() {}, debug() {} };

/** A socket the test drives by hand. */
class FakeSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 1;
    this.closed = false;
    this.listeners = new Map();
  }

  addEventListener(name, handler) {
    this.listeners.set(name, handler);
  }

  send() {}

  close() {
    this.closed = true;
    this.readyState = 3;
  }

  /** Fires the event, the way the socket would. */
  fire(name, event = {}) {
    this.listeners.get(name)?.(event);
  }
}

/**
 * Installs a fake WebSocket and a fetch that offers no ticket.
 *
 * @returns {{sockets: FakeSocket[], restore: () => void}}
 */
function withFakeSockets() {
  const originalWebSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;
  const sockets = [];

  globalThis.WebSocket = /** @type {any} */ (
    class extends FakeSocket {
      constructor(url) {
        super(url);
        sockets.push(this);
      }
    }
  );
  globalThis.fetch = async () => new Response('nope', { status: 404 });

  return {
    sockets,
    restore() {
      globalThis.WebSocket = originalWebSocket;
      globalThis.fetch = originalFetch;
    },
  };
}

/** Lets the client's promises settle. */
async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

test('the old socket close event cannot clear the socket that replaced it', async () => {
  const { sockets, restore } = withFakeSockets();
  try {
    const statuses = [];
    const client = new RelayClient({
      url: 'https://old.example.workers.dev',
      accountId: 'default',
      bridgeId: 'bridge-1',
      token: 'tok',
      logger: LOGGER,
      onStatus: (connected) => statuses.push(connected),
    });
    client.start();
    await settle();

    const old = sockets[0];
    old.fire('open');

    // The desktop points the client at another relay, the way it always did.
    client.url = 'https://new.example.workers.dev';
    client.accountId = 'default';
    client.bridgeId = 'bridge-1';
    client.token = 'tok';
    client.name = 'Desk';
    client.start();
    await settle();

    const live = sockets[1];
    live.fire('open');
    assert.equal(client.socket, live);

    // The old socket's close event arrives late, after the new one is live.
    old.fire('close');

    // The live socket is still the live socket.
    assert.equal(client.socket, live);
    assert.equal(client.connected, true);
    // The client did not report itself as offline.
    assert.equal(statuses[statuses.length - 1], true);
    // And it did not open a third connection.
    assert.equal(sockets.length, 2);

    client.stop();
  } finally {
    restore();
  }
});

test('the socket against the old address is closed when the configuration changes', async () => {
  const { sockets, restore } = withFakeSockets();
  try {
    const client = new RelayClient({
      url: 'https://old.example.workers.dev',
      accountId: 'default',
      bridgeId: 'bridge-1',
      token: 'tok',
      logger: LOGGER,
    });
    client.start();
    await settle();

    assert.equal(sockets.length, 1);
    const old = sockets[0];

    client.reconfigure({
      url: 'https://new.example.workers.dev',
      accountId: 'default',
      bridgeId: 'bridge-1',
      token: 'tok',
      name: 'Desk',
    });
    await settle();

    // The old socket was closed on purpose.
    assert.equal(old.closed, true);
    // And the new connection is against the new address.
    assert.equal(sockets.length, 2);
    assert.match(sockets[1].url, /new\.example\.workers\.dev/);

    client.stop();
  } finally {
    restore();
  }
});

test('a configuration change does not leave the old socket open', async () => {
  const { sockets, restore } = withFakeSockets();
  try {
    const client = new RelayClient({
      url: 'https://old.example.workers.dev',
      accountId: 'default',
      bridgeId: 'bridge-1',
      token: 'tok',
      logger: LOGGER,
    });
    client.start();
    await settle();
    sockets[0].fire('open');

    client.reconfigure({
      url: 'https://new.example.workers.dev',
      accountId: 'default',
      bridgeId: 'bridge-1',
      token: 'tok',
      name: 'Desk',
    });
    await settle();

    assert.equal(sockets[0].closed, true);
    client.stop();
  } finally {
    restore();
  }
});
