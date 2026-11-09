import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { parseConfigFile, readRawConfig } from '../miniapp/node/auth/config.mjs';
import { disposeTemp, tempDir, writeJson } from './helpers.mjs';

test('parseConfigFile rejects insecure API URLs and preserves safe fields', async () => {
  const parsed = parseConfigFile({
    base_url: 'http://attacker.example/path',
    oauth: { access_token: 'a', refresh_token: 'b', expires_at: '2030-01-01T00:00:00.000Z', resource_url: 'javascript:alert(1)' },
    future_field: 'keep me',
  });
  assert.equal(parsed.base_url, undefined);
  assert.equal(parsed.oauth.resource_url, undefined);
  assert.equal(parsed.future_field, undefined);
});

test('readRawConfig keeps every field it finds, so a reader never rewrites the file', async () => {
  const dir = await tempDir('quota-config-read-');
  try {
    const file = join(dir, 'nested', 'config.json');
    await mkdir(join(dir, 'nested'), { recursive: true });
    await writeJson(file, {
      api_key: 'keep-me',
      base_url: 'https://api.minimaxi.com',
      region: 'cn',
      future_field: { nested: true },
    });
    const result = await readRawConfig(file);
    assert.equal(result.ok, true);
    assert.deepEqual(result.raw.future_field, { nested: true });
    assert.equal(result.raw.api_key, 'keep-me');
  } finally {
    await disposeTemp(dir);
  }
});

test('readRawConfig distinguishes a missing file from invalid JSON', async () => {
  const dir = await tempDir('quota-config-read-missing-');
  try {
    const missing = join(dir, 'missing.json');
    assert.deepEqual(await readRawConfig(missing), { ok: true, raw: {} });
    const broken = join(dir, 'broken.json');
    await writeFile(broken, '{', 'utf8');
    assert.deepEqual(await readRawConfig(broken), { ok: false, code: 'config_invalid' });
  } finally {
    await disposeTemp(dir);
  }
});
