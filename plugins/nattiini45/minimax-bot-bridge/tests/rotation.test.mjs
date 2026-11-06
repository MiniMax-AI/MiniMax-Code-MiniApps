import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Bridge } from '../miniapp/node/bridge.mjs';
import { saveConfig } from '../miniapp/node/config.mjs';

const LOGGER = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * A context with just enough of the Host for the bridge to start.
 *
 * @param {string} dataDir
 * @param {Record<string, unknown>} [extra]
 */
function fakeContext(dataDir, extra = {}) {
  return {
    dataDir,
    logger: LOGGER,
    listen: { host: '127.0.0.1', port: 0 },
    signal: new AbortController().signal,
    ...extra,
  };
}

test('a rotated bridge token is written down', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bridge-rotate-'));
  try {
    const stored = {
      relayUrl: 'https://relay.example.workers.dev',
      accountId: 'default',
      bridgeId: 'bridge-1',
      bridgeToken: 'the-old-token',
      bridgeName: 'Desktop',
    };
    await saveConfig(dataDir, stored);

    const bridge = new Bridge(fakeContext(dataDir), { config: stored, logger: LOGGER });

    // The relay is not reachable, so the rotation fails — and nothing may be
    // written, so the token on disk is still the one that works.
    await assert.rejects(() => bridge.rotateToken());

    const onDisk = await readFile(join(dataDir, 'bridge-token'), 'utf8');
    assert.equal(onDisk.trim(), 'the-old-token');
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('a rotation that succeeds replaces the token on disk', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bridge-rotate-'));
  try {
    const bridge = new Bridge(fakeContext(dataDir), {
      config: {
        relayUrl: 'https://relay.example.workers.dev',
        accountId: 'default',
        bridgeId: 'bridge-1',
        bridgeToken: 'the-old-token',
        bridgeName: 'Desktop',
      },
      logger: LOGGER,
    });

    // A relay that answers with a token of its own.
    bridge.relay.rotateToken = async () => {
      bridge.relay.token = 'the-new-token';
      return 'the-new-token';
    };

    const token = await bridge.rotateToken();

    assert.equal(token, 'the-new-token');
    assert.equal(bridge.config.bridgeToken, 'the-new-token');

    // The token has to be on disk as well: the bridge can rotate while it starts,
    // before anything else has had a chance to listen, and a rotation that was
    // not written down would leave the desktop holding a revoked token.
    const stored = await readFile(join(dataDir, 'bridge-token'), 'utf8');
    assert.equal(stored.trim(), 'the-new-token');
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('the bridge reads its own expiry from the token it holds', () => {
  const payload = {
    v: 1,
    sub: 'bridge-1',
    role: 'bridge',
    exp: 1234567890000,
    jti: 'x',
    acc: 'default',
  };
  const token = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

  const bridge = new Bridge(fakeContext('/tmp'), {
    config: {
      relayUrl: 'https://relay.example.workers.dev',
      accountId: 'default',
      bridgeId: 'bridge-1',
      bridgeToken: token,
      bridgeName: 'Desktop',
    },
    logger: LOGGER,
  });

  // The token is signed, not encrypted: the payload can be read, so the bridge
  // can tell that the token is about to run out.
  const expiresAt = bridge.relay.tokenExpiresAt();
  assert.equal(expiresAt, 1234567890000);
  assert.equal(expiresAt > Date.now(), false);
});

test('a token it cannot read has no expiry', () => {
  const bridge = new Bridge(fakeContext('/tmp'), {
    config: {
      relayUrl: 'https://relay.example.workers.dev',
      accountId: 'default',
      bridgeId: 'bridge-1',
      bridgeToken: 'not-a-token',
      bridgeName: 'Desktop',
    },
    logger: LOGGER,
  });

  assert.equal(bridge.relay.tokenExpiresAt(), null);
});
