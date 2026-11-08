import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { fetchDesktopSessionQuota } from '../miniapp/node/desktop-session.mjs';
import { resolveLeaseEndpoint, resolveDesktopDataRoot } from '../miniapp/node/desktop-lease.mjs';
import { disposeTemp, tempDir } from './helpers.mjs';

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('the lease endpoint is derived from the desktop data root', () => {
  const endpoint = resolveLeaseEndpoint('C:\\Users\\Someone\\.minimax', 'win32');
  assert.equal(endpoint.transport, 'pipe');
  assert.match(endpoint.endpoint, /^\\\\\.\\pipe\\mcode-auth-lease-[a-f0-9]{16}$/u);
  assert.equal(endpoint.capabilityFile, join('C:\\Users\\Someone\\.minimax', 'run', 'mcode-auth-lease-v1.cap'));
});

test('the data root is the ancestor of the v2 directory', () => {
  const root = resolveDesktopDataRoot(join('C:\\Users\\Someone\\.minimax', 'v2', 'plugin-data', 'liveboards', 'quota-bottle'));
  assert.equal(root, join('C:\\Users\\Someone\\.minimax'));
});

test('without a desktop session the quota read reports it instead of guessing', async () => {
  const dir = await tempDir('quota-desktop-none-');
  try {
    const dataDir = join(dir, 'no-desktop', 'v2', 'plugin-data', 'quota-bottle');
    await mkdir(dataDir, { recursive: true });
    const result = await fetchDesktopSessionQuota({ dataDir }, {
      env: { MCODE_AUTH_BROKER_ENDPOINT: join(dir, 'missing.sock'), MCODE_AUTH_BROKER_CAPABILITY_FILE: join(dir, 'missing.cap') },
    }).then((value) => ({ ok: true, value }), (error) => ({ ok: false, code: error.code }));
    assert.equal(result.ok, false);
    assert.equal(result.code, 'desktop_unavailable');
  } finally {
    await disposeTemp(dir);
  }
});

test('a missing capability file is never mistaken for a usable session', async () => {
  const dir = await tempDir('quota-desktop-nocap-');
  try {
    const dataDir = join(dir, 'no-cap', 'v2', 'plugin-data', 'quota-bottle');
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dir, 'empty.cap'), 'not-a-capability', 'utf8');
    const result = await fetchDesktopSessionQuota({ dataDir }, {
      env: { MCODE_AUTH_BROKER_ENDPOINT: join(dir, 'missing.sock'), MCODE_AUTH_BROKER_CAPABILITY_FILE: join(dir, 'empty.cap') },
    }).then((value) => ({ ok: true, value }), (error) => ({ ok: false, code: error.code }));
    assert.equal(result.ok, false);
    assert.equal(result.code, 'desktop_unavailable');
  } finally {
    await disposeTemp(dir);
  }
});
