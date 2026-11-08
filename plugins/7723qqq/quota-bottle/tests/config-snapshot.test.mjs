import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { configFromRaw, loadQuotaConfig, readRawConfig } from '../miniapp/node/auth/config.mjs';
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

test('loadQuotaConfig exposes credentials and API key from the same read', async () => {
  const dir = await tempDir('quota-config-snapshot-');
  try {
    process.env.MMX_CONFIG_DIR = dir;
    await mkdir(dir, { recursive: true });
    await writeJson(join(dir, 'config.json'), {
      api_key: 'key',
      oauth: { access_token: 'access', refresh_token: 'refresh', expires_at: '2030-01-01T00:00:00.000Z', region: 'cn' },
    });
    const snapshot = await loadQuotaConfig();
    assert.equal(snapshot.ok, true);
    assert.equal(snapshot.apiKey, 'key');
    assert.equal(snapshot.credentials?.access_token, 'access');
    assert.equal(snapshot.credentials?.configPath, join(dir, 'config.json'));
  } finally {
    delete process.env.MMX_CONFIG_DIR;
    await disposeTemp(dir);
  }
});

test('loadQuotaConfig reports corrupt JSON instead of silently using no credentials', async () => {
  const dir = await tempDir('quota-config-corrupt-snapshot-');
  try {
    process.env.MMX_CONFIG_DIR = dir;
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'config.json'), '{', 'utf8');
    assert.deepEqual(await loadQuotaConfig(), { ok: false, code: 'config_invalid' });
    const raw = await readRawConfig(join(dir, 'config.json'));
    assert.equal(raw.ok, false);
  } finally {
    delete process.env.MMX_CONFIG_DIR;
    await disposeTemp(dir);
  }
});

test('resolveCredentialFromSnapshot uses only the supplied credential', async () => {
  const result = await resolveCredentialFromSnapshot({ oauth: null, apiKey: 'plain-key' });
  assert.deepEqual(result, { token: 'plain-key', method: 'api-key' });
  await assert.rejects(resolveCredentialFromSnapshot({ oauth: null }), (error) => error.code === 'no_credential');
});
