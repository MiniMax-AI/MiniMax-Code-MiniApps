import assert from 'node:assert/strict';
import { chmod, mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { parseConfigFile, readRawConfig, updateConfigFile } from '../miniapp/node/auth/config.mjs';
import { disposeTemp, readJson, tempDir, writeJson } from './helpers.mjs';

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

test('updateConfigFile preserves unknown fields and serializes concurrent writes', async () => {
  const dir = await tempDir('quota-config-');
  try {
    const file = join(dir, 'nested', 'config.json');
    await mkdir(join(dir, 'nested'), { recursive: true });
    await writeJson(file, { future_field: { nested: true }, region: 'cn', oauth: { access_token: 'old', refresh_token: 'r', expires_at: '2030-01-01' } });
    await chmod(file, 0o640);
    await Promise.all([
      updateConfigFile((raw) => { raw.first = 1; }, file),
      updateConfigFile((raw) => { raw.second = 2; }, file),
    ]);
    const result = await readJson(file);
    assert.equal(result.future_field.nested, true);
    assert.equal(result.region, 'cn');
    assert.equal(result.first, 1);
    assert.equal(result.second, 2);
    assert.ok((await stat(file)).size > 0);
  } finally {
    await disposeTemp(dir);
  }
});

test('readRawConfig distinguishes a missing file from invalid JSON', async () => {
  const dir = await tempDir('quota-config-read-');
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

test('updateConfigFile refuses a corrupt config and leaves it untouched', async () => {
  const dir = await tempDir('quota-config-corrupt-');
  try {
    const file = join(dir, 'config.json');
    await writeFile(file, '{ broken', 'utf8');
    await assert.rejects(updateConfigFile((raw) => { raw.oauth = {}; }, file), /config_invalid/);
    assert.equal(await (await import('node:fs/promises')).readFile(file, 'utf8'), '{ broken');
  } finally {
    await disposeTemp(dir);
  }
});
