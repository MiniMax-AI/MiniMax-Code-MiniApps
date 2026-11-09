import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { saveOauth } from '../miniapp/node/auth/auth.mjs';
import { credentialsPath, readCredentials, saveCredentials } from '../miniapp/node/auth/credentials.mjs';
import { disposeTemp, readJson, tempDir, writeJson } from './helpers.mjs';

const EXPIRES = '2030-01-01T00:00:00.000Z';

test('the panel login writes the plugin store and leaves the CLI config byte for byte', async () => {
  const dir = await tempDir('quota-credentials-');
  const previous = process.env.MMX_CONFIG_DIR;
  try {
    const dataDir = join(dir, 'data');
    const cliFile = join(dir, 'mmx', 'config.json');
    process.env.MMX_CONFIG_DIR = join(dir, 'mmx');
    await writeJson(cliFile, {
      api_key: 'keep-me',
      base_url: 'https://api.minimaxi.com',
      region: 'cn',
      future_field: { keep: true },
    });
    const before = await readFile(cliFile, 'utf8');

    await saveOauth(dataDir, 'cn', {
      access_token: 'access',
      refresh_token: 'refresh',
      expires_at: EXPIRES,
    });

    assert.equal(await readFile(cliFile, 'utf8'), before);
    const stored = await readJson(credentialsPath(dataDir));
    assert.equal(stored.oauth.access_token, 'access');
    assert.equal(stored.oauth.region, 'cn');
    assert.equal(stored.region, 'cn');
    if (process.platform !== 'win32') {
      assert.equal((await stat(credentialsPath(dataDir))).mode & 0o777, 0o600);
    }
  } finally {
    if (previous === undefined) delete process.env.MMX_CONFIG_DIR;
    else process.env.MMX_CONFIG_DIR = previous;
    await disposeTemp(dir);
  }
});

test('a missing credential file is not an error and a corrupt one is named', async () => {
  const dir = await tempDir('quota-credentials-read-');
  try {
    assert.deepEqual(await readCredentials(dir), { ok: true, oauth: null, region: null });
    await writeFile(credentialsPath(dir), '{', 'utf8');
    assert.deepEqual(await readCredentials(dir), { ok: false, code: 'config_invalid' });
  } finally {
    await disposeTemp(dir);
  }
});

test('a credential without an access token is refused before it reaches disk', async () => {
  const dir = await tempDir('quota-credentials-empty-');
  try {
    await assert.rejects(saveCredentials(dir, { access_token: '' }), /credentials/u);
    assert.deepEqual(await readCredentials(dir), { ok: true, oauth: null, region: null });
  } finally {
    await disposeTemp(dir);
  }
});

test('concurrent writes leave one valid credential file', async () => {
  const dir = await tempDir('quota-credentials-concurrent-');
  try {
    await Promise.all([
      saveCredentials(dir, { access_token: 'one', refresh_token: 'r1', expires_at: EXPIRES, region: 'cn' }),
      saveCredentials(dir, { access_token: 'two', refresh_token: 'r2', expires_at: EXPIRES, region: 'global' }),
    ]);
    const stored = await readCredentials(dir);
    assert.equal(stored.ok, true);
    assert.ok(stored.oauth.access_token === 'one' || stored.oauth.access_token === 'two');
    assert.ok(stored.region === 'cn' || stored.region === 'global');
  } finally {
    await disposeTemp(dir);
  }
});
