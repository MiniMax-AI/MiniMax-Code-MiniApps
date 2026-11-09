import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { configFromRaw, readRawConfig } from '../miniapp/node/auth/config.mjs';
import { credentialsPath, saveCredentials } from '../miniapp/node/auth/credentials.mjs';
import { loadQuotaConfig } from '../miniapp/node/auth/snapshot.mjs';
import { resolveCredentialFromSnapshot } from '../miniapp/node/auth/auth.mjs';
import { disposeTemp, tempDir, writeJson } from './helpers.mjs';

test('configFromRaw derives region, base URL and API key from one snapshot', () => {
  const config = configFromRaw({
    region: 'cn',
    base_url: 'https://api.minimaxi.com/',
    api_key: 'token-key',
    custom: { keep: true },
  }, {});
  assert.equal(config.region, 'cn');
  assert.equal(config.baseUrl, 'https://api.minimaxi.com');
});

test('the region picks the quota host when no base URL is configured', () => {
  const config = configFromRaw({ region: 'cn', api_key: 'token-key' }, {});
  assert.equal(config.baseUrl, 'https://api.minimaxi.com');
  assert.deepEqual(config.baseUrls, ['https://api.minimaxi.com', 'https://api.minimax.io']);
});

test('an explicit base URL override replaces every candidate host', () => {
  const config = configFromRaw({ region: 'cn' }, { MINIMAX_BASE_URL: 'http://127.0.0.1:8787/stub' });
  assert.deepEqual(config.baseUrls, ['http://127.0.0.1:8787/stub']);
});

test('the plugin login outranks the CLI credential and supplies the region', async () => {
  const dir = await tempDir('quota-config-snapshot-');
  const previous = process.env.MMX_CONFIG_DIR;
  try {
    const dataDir = join(dir, 'data');
    const cliDir = join(dir, 'mmx');
    process.env.MMX_CONFIG_DIR = cliDir;
    await mkdir(cliDir, { recursive: true });
    await writeJson(join(cliDir, 'config.json'), {
      api_key: 'cli-key',
      region: 'cn',
      oauth: { access_token: 'cli-access', refresh_token: 'cli-refresh', expires_at: '2030-01-01T00:00:00.000Z', region: 'cn' },
    });
    await saveCredentials(dataDir, {
      access_token: 'plugin-access',
      refresh_token: 'plugin-refresh',
      expires_at: '2030-01-01T00:00:00.000Z',
      region: 'global',
    });

    const snapshot = await loadQuotaConfig(dataDir);
    assert.equal(snapshot.ok, true);
    assert.equal(snapshot.apiKey, 'cli-key');
    assert.equal(snapshot.credentials?.access_token, 'plugin-access');
    assert.equal(snapshot.credentials?.storePath, credentialsPath(dataDir));
    assert.equal(typeof snapshot.credentials?.persist, 'function');
    assert.equal(snapshot.config.region, 'global');
    assert.equal(snapshot.config.baseUrl, 'https://api.minimax.io');
  } finally {
    if (previous === undefined) delete process.env.MMX_CONFIG_DIR;
    else process.env.MMX_CONFIG_DIR = previous;
    await disposeTemp(dir);
  }
});

test('loadQuotaConfig reports corrupt CLI JSON instead of silently using no credentials', async () => {
  const dir = await tempDir('quota-config-corrupt-snapshot-');
  const previous = process.env.MMX_CONFIG_DIR;
  try {
    const dataDir = join(dir, 'data');
    process.env.MMX_CONFIG_DIR = dir;
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'config.json'), '{', 'utf8');
    assert.deepEqual(await loadQuotaConfig(dataDir), { ok: false, code: 'config_invalid' });
    const raw = await readRawConfig(join(dir, 'config.json'));
    assert.equal(raw.ok, false);
  } finally {
    if (previous === undefined) delete process.env.MMX_CONFIG_DIR;
    else process.env.MMX_CONFIG_DIR = previous;
    await disposeTemp(dir);
  }
});

test('a damaged plugin credential file does not block a CLI API key', async () => {
  const dir = await tempDir('quota-config-damaged-');
  const previous = process.env.MMX_CONFIG_DIR;
  try {
    const dataDir = join(dir, 'data');
    const cliDir = join(dir, 'mmx');
    process.env.MMX_CONFIG_DIR = cliDir;
    await mkdir(cliDir, { recursive: true });
    await writeJson(join(cliDir, 'config.json'), { api_key: 'cli-key' });
    await mkdir(dataDir, { recursive: true });
    await writeFile(credentialsPath(dataDir), '{', 'utf8');
    const snapshot = await loadQuotaConfig(dataDir);
    assert.equal(snapshot.ok, true);
    assert.equal(snapshot.credentials, null);
    assert.equal(snapshot.apiKey, 'cli-key');
  } finally {
    if (previous === undefined) delete process.env.MMX_CONFIG_DIR;
    else process.env.MMX_CONFIG_DIR = previous;
    await disposeTemp(dir);
  }
});

test('resolveCredentialFromSnapshot uses only the supplied credential', async () => {
  const result = await resolveCredentialFromSnapshot({ oauth: null, apiKey: 'plain-key' });
  assert.deepEqual(result, { token: 'plain-key', method: 'api-key' });
  await assert.rejects(resolveCredentialFromSnapshot({ oauth: null }), (error) => error.code === 'no_credential');
});

test('an expired CLI token falls back to the CLI API key instead of needing a login', async () => {
  const result = await resolveCredentialFromSnapshot({
    oauth: {
      access_token: 'expired',
      refresh_token: 'refresh',
      expires_at: '2020-01-01T00:00:00.000Z',
      region: 'cn',
    },
    apiKey: 'plain-key',
  });
  assert.deepEqual(result, { token: 'plain-key', method: 'api-key' });
});
