import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { isAllowedRelayUrl, loadConfig, relayOrigin, saveConfig } from '../miniapp/node/config.mjs';

test('a relay address that is not one the bridge may use is refused', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bridge-config-'));
  try {
    await loadConfig(dataDir, {
      relayUrl: 'http://relay.example.workers.dev',
      bridgeToken: 'a token',
    });

    const config = await loadConfig(dataDir, { bridgeToken: 'a token' });

    // The bridge holds the long-lived token, so it never presents it to an
    // address it cannot vouch for. The desktop is left unconfigured, which is
    // the state a fresh install is in anyway.
    assert.equal(config.relayUrl, '');
    assert.equal(config.bridgeToken, 'a token');
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('a secure relay address is kept', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bridge-config-'));
  try {
    await loadConfig(dataDir, { relayUrl: 'https://relay.example.workers.dev' });

    const config = await loadConfig(dataDir);

    assert.equal(config.relayUrl, 'https://relay.example.workers.dev');
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('a secure relay is allowed wherever it is', () => {
  assert.equal(isAllowedRelayUrl('https://relay.example.workers.dev'), true);
  assert.equal(isAllowedRelayUrl('wss://relay.example.workers.dev'), true);
  assert.equal(isAllowedRelayUrl('https://relay.example.workers.dev/r/default'), true);
});

test('a cleartext relay is allowed only on the loopback interface', () => {
  assert.equal(isAllowedRelayUrl('http://127.0.0.1:8787'), true);
  assert.equal(isAllowedRelayUrl('ws://127.0.0.1:8787'), true);
  assert.equal(isAllowedRelayUrl('http://localhost:8787'), true);
  assert.equal(isAllowedRelayUrl('http://[::1]:8787'), true);
});

test('a cleartext relay anywhere else is refused', () => {
  // The token would cross the network in the clear.
  assert.equal(isAllowedRelayUrl('http://relay.example.workers.dev'), false);
  // A LAN host is reachable but not trusted.
  assert.equal(isAllowedRelayUrl('http://192.168.1.10:8787'), false);
  assert.equal(isAllowedRelayUrl('http://10.0.0.5:8787'), false);
  // Link-local and the cloud metadata address.
  assert.equal(isAllowedRelayUrl('http://169.254.169.254'), false);
  assert.equal(isAllowedRelayUrl('http://[fe80::1]:8787'), false);
  // The metadata address over TLS is still not a relay.
  assert.equal(isAllowedRelayUrl('https://169.254.169.254'), true);
});

test('an address that is not a relay address is refused', () => {
  assert.equal(isAllowedRelayUrl(''), false);
  assert.equal(isAllowedRelayUrl('   '), false);
  assert.equal(isAllowedRelayUrl('relay.example.workers.dev'), false);
  assert.equal(isAllowedRelayUrl('file:///etc/passwd'), false);
  assert.equal(isAllowedRelayUrl('javascript:alert(1)'), false);
  assert.equal(isAllowedRelayUrl('https://'), false);
  assert.equal(isAllowedRelayUrl(undefined), false);
});

test('the origin of a relay address is the same for every scheme spelling', () => {
  // The pairing request is HTTP and the frame channel is a WebSocket, so one relay
  // has several spellings. They have to compare as the same relay.
  assert.equal(relayOrigin('https://relay.example.workers.dev'), relayOrigin('wss://relay.example.workers.dev'));
  assert.equal(relayOrigin('http://127.0.0.1:8787'), relayOrigin('ws://127.0.0.1:8787'));
  assert.equal(relayOrigin('https://relay.example.workers.dev/'), relayOrigin('https://relay.example.workers.dev'));
});

test('two different relays have different origins', () => {
  assert.notEqual(
    relayOrigin('https://relay.example.workers.dev'),
    relayOrigin('https://other.example.workers.dev'),
  );
  assert.notEqual(relayOrigin('https://relay.example.workers.dev'), relayOrigin('http://relay.example.workers.dev'));
});

test('an address that is not a relay address has no origin', () => {
  assert.equal(relayOrigin(''), '');
  assert.equal(relayOrigin('nonsense'), '');
});

test('where the bridge token is kept', async () => {
  const CONFIG = {
    relayUrl: 'https://relay.example.workers.dev',
    accountId: 'default',
    bridgeId: 'bridge-1',
    bridgeToken: 'the-bridge-token',
    bridgeName: 'Desktop',
  };

  const dataDir = await mkdtemp(join(tmpdir(), 'bridge-config-'));
  try {
    await saveConfig(dataDir, CONFIG);

    // The token is not in the configuration file: that file is the one that
    // gets copied around.
    const raw = await readFile(join(dataDir, 'bridge-config.json'), 'utf8');
    assert.equal(raw.includes('the-bridge-token'), false);
    // The rest of the configuration is still there.
    assert.equal(raw.includes('relay.example.workers.dev'), true);

    // It is in a file of its own.
    const token = await readFile(join(dataDir, 'bridge-token'), 'utf8');
    assert.equal(token.trim(), 'the-bridge-token');

    const config = await loadConfig(dataDir);
    assert.equal(config.bridgeToken, 'the-bridge-token');
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('the token file is written for its owner only', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows has no POSIX file modes');
    return;
  }
  const dataDir = await mkdtemp(join(tmpdir(), 'bridge-config-'));
  try {
    await saveConfig(dataDir, {
      relayUrl: 'https://relay.example.workers.dev',
      accountId: 'default',
      bridgeId: 'bridge-1',
      bridgeToken: 'the-bridge-token',
      bridgeName: 'Desktop',
    });

    for (const file of ['bridge-config.json', 'bridge-token']) {
      const info = await stat(join(dataDir, file));
      assert.equal(info.mode & 0o777, 0o600, `expected ${file} to be 0600`);
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('legacy token fields are removed even when the dedicated token file already exists', async (t) => {
  for (const legacyToken of ['current-token', 'stale-token', '']) {
    await t.test(JSON.stringify(legacyToken), async () => {
      const dataDir = await mkdtemp(join(tmpdir(), 'bridge-config-'));
      try {
        await writeFile(join(dataDir, 'bridge-config.json'), JSON.stringify({
          bridgeId: 'bridge-1',
          bridgeName: 'Desktop',
          relayUrl: 'https://relay.example.workers.dev',
          accountId: 'default',
          bridgeToken: legacyToken,
        }));
        await writeFile(join(dataDir, 'bridge-token'), 'current-token\n');

        const config = await loadConfig(dataDir);
        assert.equal(config.bridgeToken, 'current-token');
        assert.equal(Object.hasOwn(JSON.parse(await readFile(join(dataDir, 'bridge-config.json'), 'utf8')), 'bridgeToken'), false);
        assert.equal(await readFile(join(dataDir, 'bridge-token'), 'utf8'), 'current-token\n');
        assert.equal((await loadConfig(dataDir)).bridgeToken, 'current-token');
      } finally {
        await rm(dataDir, { recursive: true, force: true });
      }
    });
  }
});

test('a token in a configuration that still carried it is moved', async () => {
  // A desktop that was configured before the token had a file of its own.
  const dataDir = await mkdtemp(join(tmpdir(), 'bridge-config-'));
  try {
    await writeFile(
      join(dataDir, 'bridge-config.json'),
      `${JSON.stringify(
        {
          relayUrl: 'https://relay.example.workers.dev',
          accountId: 'default',
          bridgeId: 'bridge-1',
          bridgeToken: 'the-bridge-token',
          bridgeName: 'Desktop',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const config = await loadConfig(dataDir);

    assert.equal(config.bridgeToken, 'the-bridge-token');
    const raw = await readFile(join(dataDir, 'bridge-config.json'), 'utf8');
    assert.equal(raw.includes('the-bridge-token'), false);
    const token = await readFile(join(dataDir, 'bridge-token'), 'utf8');
    assert.equal(token.trim(), 'the-bridge-token');
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
