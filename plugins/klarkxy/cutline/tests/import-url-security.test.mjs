// @ts-check
// A remote download must go to the address that was checked. A name that
// answers differently the second time it is asked cannot move the connection
// to a private address, and every redirect is checked and pinned on its own.
//
// Nothing here talks to the network: the resolver is stubbed, the connections
// go to servers on 127.0.0.1, and the names used are never resolved for real.

import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { createRequire } from 'node:module';

import { fixtureDir } from './helpers.mjs';

const require = createRequire(import.meta.url);
const { downloadImportUrl, parseImportUrl, isBlockedIp } =
  require('../miniapp/node/vendor/fablecut/import-url.js');

/** Where a download would put its file. Nothing is ever written there. */
const DEST = fixtureDir('import-url-security');

/* Public addresses that are never contacted: the tests that use them stop
   before a connection is made. */
const PUBLIC = '93.184.216.34';
const OTHER_PUBLIC = '203.0.113.10';

/**
 * Replaces the resolver the download uses to check a name.
 *
 * @param {Record<string, {address: string, family: number}[]>} answers
 */
function stubResolver(answers) {
  const original = dns.promises.lookup;
  /** @type {{host: string, options: any}[]} */
  const calls = [];
  dns.promises.lookup = async (/** @type {string} */ host, /** @type {any} */ options) => {
    calls.push({ host, options });
    const list = answers[host];
    if (!list) throw Object.assign(new Error(`no answer for ${host}`), { code: 'ENOTFOUND' });
    return list.map((entry) => ({ ...entry }));
  };
  return {
    calls,
    /** @param {string} host @param {{address: string, family: number}[]} list */
    set(host, list) { answers[host] = list; },
    restore() { dns.promises.lookup = original; },
  };
}

/**
 * Watches the resolver the socket itself would use. The download must never
 * reach it: the address it was given is the one it connects to.
 *
 * @param {string} address the answer a rebinding name would give
 */
function watchSocketResolver(address) {
  const original = dns.lookup;
  /** @type {string[]} */
  const calls = [];
  dns.lookup = function (/** @type {string} */ host, /** @type {any} */ options, /** @type {any} */ callback) {
    calls.push(host);
    const cb = typeof options === 'function' ? options : callback;
    if (options && options.all) return cb(null, [{ address, family: 4 }]);
    cb(null, address, 4);
  };
  return {
    calls,
    restore() { dns.lookup = original; },
  };
}

/**
 * Replaces the request the download makes over HTTPS.
 *
 * @param {(options: any, call: number) => any} handler
 */
function stubHttpsRequest(handler) {
  const original = https.request;
  /** @type {any[]} */
  const calls = [];
  https.request = function (/** @type {any} */ options, /** @type {any} */ callback) {
    calls.push(options);
    const response = handler(options, calls.length);
    const request = {
      on() { return this; },
      setTimeout() { return this; },
      end() { return this; },
      destroy() {},
    };
    process.nextTick(() => callback(response));
    return request;
  };
  return {
    calls,
    restore() { https.request = original; },
  };
}

/**
 * A response the download can read without a server behind it.
 *
 * @param {number} statusCode
 * @param {Record<string, string>} [headers]
 */
function fakeResponse(statusCode, headers = {}) {
  return { statusCode, headers, resume() {} };
}

/**
 * Asks a resolver the way the socket does.
 *
 * @param {(host: string, options: any, callback: any) => void} lookup
 * @param {string} host
 * @param {any} options
 */
function callLookup(lookup, host, options) {
  return new Promise((resolve, reject) => {
    lookup(host, options, (/** @type {any} */ err, /** @type {any} */ addresses, /** @type {any} */ family) => {
      if (err) reject(err);
      else resolve(options && options.all ? addresses : { address: addresses, family });
    });
  });
}

/**
 * A server on 127.0.0.1 that answers with a redirect.
 *
 * @param {string} location
 */
async function startRedirector(location) {
  /** @type {string[]} */
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url || '');
    res.writeHead(302, { location });
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    hits,
    port: /** @type {any} */ (server.address()).port,
    close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
  };
}

/**
 * A server that counts the connections it gets. It stands in for the private
 * address a redirect must never reach.
 *
 * @param {string} host
 */
async function startCounter(host) {
  /** @type {any[]} */
  const connections = [];
  const server = net.createServer((socket) => {
    connections.push(socket);
    socket.on('error', () => {});
  });
  await new Promise((resolve) => server.listen(0, host, resolve));
  return {
    connections,
    port: /** @type {any} */ (server.address()).port,
    close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
  };
}

test('the connection goes to the address that was checked, not to a later answer', async () => {
  const resolver = stubResolver({ 'media.example.com': [{ address: PUBLIC, family: 4 }] });
  const socketResolver = watchSocketResolver('127.0.0.1');
  const requests = stubHttpsRequest(() => fakeResponse(404));

  try {
    await assert.rejects(
      () => downloadImportUrl('https://media.example.com/clip.mp4', DEST),
      /download failed: HTTP 404/,
    );

    assert.equal(resolver.calls.length, 1, 'the name was resolved once');
    assert.equal(socketResolver.calls.length, 0, 'the socket never asked the resolver again');

    const options = requests.calls[0];
    assert.equal(options.hostname, 'media.example.com', 'the name is kept for the request');
    assert.equal(options.servername, 'media.example.com', 'the name is kept for the TLS handshake');

    const pinned = await callLookup(options.lookup, 'media.example.com', { all: true });
    assert.deepEqual(pinned, [{ address: PUBLIC, family: 4 }], 'the socket is pinned to the checked address');

    // The name answers differently now. The pinned address does not move.
    resolver.set('media.example.com', [{ address: '127.0.0.1', family: 4 }]);
    const afterChange = await callLookup(options.lookup, 'media.example.com', { all: true });
    assert.deepEqual(afterChange, [{ address: PUBLIC, family: 4 }], 'a changed answer does not move the socket');

    const single = await callLookup(options.lookup, 'media.example.com', {});
    assert.deepEqual(single, { address: PUBLIC, family: 4 }, 'the resolver also answers a single address');

    await assert.rejects(
      () => callLookup(options.lookup, 'other.example.com', {}),
      /another host/,
      'the resolver refuses to answer for another name',
    );
  } finally {
    resolver.restore();
    socketResolver.restore();
    requests.restore();
  }
});

test('the name stays in the Host header and in the certificate check', async () => {
  const resolver = stubResolver({ 'media.example.com': [{ address: PUBLIC, family: 4 }] });
  const requests = stubHttpsRequest(() => fakeResponse(404));

  try {
    await assert.rejects(
      () => downloadImportUrl('https://media.example.com/clip.mp4', DEST),
      /download failed: HTTP 404/,
    );

    const options = requests.calls[0];
    assert.equal(options.hostname, 'media.example.com', 'the request is made for the name');
    assert.equal(options.servername, 'media.example.com', 'the TLS server name is the name');
    assert.equal(options.rejectUnauthorized, undefined, 'the certificate check is left on');
    assert.equal(options.checkServerIdentity, undefined, 'the certificate identity check is left on');
    assert.equal(options.agent, false, 'no socket is reused between hops');

    // What Node itself puts in the Host header for these options.
    const agent = new http.Agent({ keepAlive: false });
    agent.createSocket = (/** @type {any} */ _req, /** @type {any} */ _options, /** @type {any} */ cb) => {
      cb(null, new net.Socket());
    };
    const request = http.request({
      protocol: 'http:',
      hostname: options.hostname,
      path: options.path,
      agent,
    });
    request.on('error', () => {});
    assert.equal(request.getHeader('host'), 'media.example.com', 'the Host header carries the name');
    request.destroy();
  } finally {
    resolver.restore();
    requests.restore();
  }
});

test('a redirect to a private address is refused before anything is sent', async () => {
  // The counter listens on an address every platform has. It need not bind the
  // advertised target: a correct downloader never connects there, and the
  // request stub independently proves that no request was attempted.
  const privateTarget = await startCounter('127.0.0.1');
  const redirector = await startRedirector(`https://127.0.0.2:${privateTarget.port}/secret.mp4`);
  const requests = stubHttpsRequest(() => fakeResponse(200));

  try {
    await assert.rejects(
      () => downloadImportUrl(`http://127.0.0.1:${redirector.port}/clip.mp4`, DEST, { allowLoopback: true }),
      /blocked/,
    );
    assert.equal(redirector.hits.length, 1, 'the first hop was made');
    assert.equal(privateTarget.connections.length, 0, 'the private address was never contacted');
    assert.equal(requests.calls.length, 0, 'no request was made to the private address');
  } finally {
    requests.restore();
    await redirector.close();
    await privateTarget.close();
  }
});

test('a redirect to a name that answers privately is refused before anything is sent', async () => {
  const redirector = await startRedirector('https://cdn.example.com/clip.mp4');
  const resolver = stubResolver({ 'cdn.example.com': [{ address: '127.0.0.1', family: 4 }] });
  const requests = stubHttpsRequest(() => fakeResponse(200));

  try {
    await assert.rejects(
      () => downloadImportUrl(`http://127.0.0.1:${redirector.port}/clip.mp4`, DEST, { allowLoopback: true }),
      /private address/,
    );
    assert.equal(resolver.calls.length, 1, 'the name of the redirect was resolved');
    assert.equal(requests.calls.length, 0, 'nothing was sent to it');
  } finally {
    requests.restore();
    resolver.restore();
    await redirector.close();
  }
});

test('every redirect is resolved and pinned on its own', async () => {
  const redirector = await startRedirector('https://cdn.example.com/one.mp4');
  const resolver = stubResolver({
    'cdn.example.com': [{ address: OTHER_PUBLIC, family: 4 }],
    'files.example.net': [{ address: '198.51.100.20', family: 4 }],
  });
  const socketResolver = watchSocketResolver('127.0.0.1');
  const requests = stubHttpsRequest((_options, call) => (
    call === 1
      ? fakeResponse(302, { location: 'https://files.example.net/two.mp4' })
      : fakeResponse(404)
  ));

  try {
    await assert.rejects(
      () => downloadImportUrl(`http://127.0.0.1:${redirector.port}/clip.mp4`, DEST, { allowLoopback: true }),
      /download failed: HTTP 404/,
    );

    assert.equal(requests.calls.length, 2, 'both hops were made');
    assert.equal(resolver.calls.length, 2, 'each name was resolved on its own');
    assert.equal(socketResolver.calls.length, 0, 'the socket never asked the resolver again');

    const first = requests.calls[0];
    const second = requests.calls[1];
    assert.equal(first.hostname, 'cdn.example.com');
    assert.equal(second.hostname, 'files.example.net');
    assert.deepEqual(
      await callLookup(first.lookup, 'cdn.example.com', { all: true }),
      [{ address: OTHER_PUBLIC, family: 4 }],
      'the first hop is pinned to its own answer',
    );
    assert.deepEqual(
      await callLookup(second.lookup, 'files.example.net', { all: true }),
      [{ address: '198.51.100.20', family: 4 }],
      'the second hop is pinned to its own answer',
    );
  } finally {
    requests.restore();
    resolver.restore();
    socketResolver.restore();
    await redirector.close();
  }
});

test('a name that answers with a private address among public ones is refused', async () => {
  const answers = [
    [{ address: PUBLIC, family: 4 }, { address: '127.0.0.1', family: 4 }],
    [{ address: '127.0.0.1', family: 4 }, { address: PUBLIC, family: 4 }],
    [{ address: '2606:4700:4700::1111', family: 6 }, { address: '::ffff:10.0.0.1', family: 6 }],
  ];

  for (const list of answers) {
    const resolver = stubResolver({ 'media.example.com': list });
    const requests = stubHttpsRequest(() => fakeResponse(200));
    try {
      await assert.rejects(
        () => downloadImportUrl('https://media.example.com/clip.mp4', DEST),
        /private address/,
        `a name that answers ${JSON.stringify(list)} is refused`,
      );
      assert.equal(requests.calls.length, 0, 'nothing was sent to it');
    } finally {
      requests.restore();
      resolver.restore();
    }
  }
});

test('a name with two public answers is pinned to both of them', async () => {
  const resolver = stubResolver({
    'media.example.com': [
      { address: PUBLIC, family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ],
  });
  const requests = stubHttpsRequest(() => fakeResponse(404));

  try {
    await assert.rejects(
      () => downloadImportUrl('https://media.example.com/clip.mp4', DEST),
      /download failed: HTTP 404/,
    );
    assert.deepEqual(
      await callLookup(requests.calls[0].lookup, 'media.example.com', { all: true }),
      [{ address: PUBLIC, family: 4 }, { address: '2606:4700:4700::1111', family: 6 }],
      'both checked addresses are pinned',
    );
    assert.deepEqual(
      await callLookup(requests.calls[0].lookup, 'media.example.com', { all: true, family: 6 }),
      [{ address: '2606:4700:4700::1111', family: 6 }],
      'the socket that asks for one family gets that family only',
    );
    assert.deepEqual(
      await callLookup(requests.calls[0].lookup, 'media.example.com', { family: 4 }),
      { address: PUBLIC, family: 4 },
      'a single answer keeps the family it was asked for',
    );
  } finally {
    requests.restore();
    resolver.restore();
  }
});

test('an address literal is checked before it is used', () => {
  const blocked = [
    '127.0.0.1', '127.0.0.53', '10.1.2.3', '172.16.0.1', '172.31.255.254',
    '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1',
    '255.255.255.255', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1',
    'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1',
    '::ffff:169.254.169.254', '::127.0.0.1', '::7f00:1',
  ];
  for (const ip of blocked) {
    assert.equal(isBlockedIp(ip), true, `${ip} is not public`);
    assert.throws(
      () => parseImportUrl(`https://${ip.includes(':') ? `[${ip}]` : ip}/clip.mp4`),
      /blocked/,
      `${ip} is refused as a URL`,
    );
  }

  const publicAddresses = [
    '93.184.216.34', '8.8.8.8', '2606:4700:4700::1111', '::ffff:8.8.8.8',
  ];
  for (const ip of publicAddresses) {
    assert.equal(isBlockedIp(ip), false, `${ip} is public`);
    assert.doesNotThrow(
      () => parseImportUrl(`https://${ip.includes(':') ? `[${ip}]` : ip}/clip.mp4`),
      `${ip} is allowed as a URL`,
    );
  }
});
