import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { saveCredentials } from '../miniapp/node/auth/credentials.mjs';
import { fetchQuota } from '../miniapp/node/auth/quota.mjs';
import { disposeTemp, tempDir, writeJson } from './helpers.mjs';

const CN_HOST = 'https://api.minimaxi.com/v1/token_plan/remains';
const GLOBAL_HOST = 'https://api.minimax.io/v1/token_plan/remains';

async function withConfig(config, run) {
  const dir = await tempDir('quota-fetch-');
  const previous = {
    configDir: process.env.MMX_CONFIG_DIR,
    baseUrl: process.env.MINIMAX_BASE_URL,
    region: process.env.MINIMAX_REGION,
  };
  try {
    await mkdir(dir, { recursive: true });
    await writeJson(join(dir, 'config.json'), config);
    process.env.MMX_CONFIG_DIR = dir;
    delete process.env.MINIMAX_BASE_URL;
    delete process.env.MINIMAX_REGION;
    const dataDir = join(dir, 'data');
    await mkdir(dataDir, { recursive: true });
    return await run(dataDir);
  } finally {
    if (previous.configDir === undefined) delete process.env.MMX_CONFIG_DIR;
    else process.env.MMX_CONFIG_DIR = previous.configDir;
    if (previous.baseUrl === undefined) delete process.env.MINIMAX_BASE_URL;
    else process.env.MINIMAX_BASE_URL = previous.baseUrl;
    if (previous.region === undefined) delete process.env.MINIMAX_REGION;
    else process.env.MINIMAX_REGION = previous.region;
    await disposeTemp(dir);
  }
}

function stubFetch(responses) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const answer = responses[url];
    if (!answer) throw new Error(`unexpected host ${url}`);
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: async () => answer.body,
    };
  };
  return { impl, calls };
}

const okBody = {
  base_resp: { status_code: 0 },
  model_remains: [{ model_name: 'm', current_interval_total_count: 100, current_interval_usage_count: 10 }],
};

test('the region decides the first host, not the global default', async () => {
  await withConfig({ region: 'cn', api_key: 'sk-cp-test' }, async (dataDir) => {
    const { impl, calls } = stubFetch({ [CN_HOST]: { status: 200, body: okBody } });
    const payload = await fetchQuota(dataDir, undefined, { fetchImpl: impl });
    assert.equal(payload.base_resp.status_code, 0);
    assert.deepEqual(calls, [CN_HOST]);
  });
});

test('a host that refuses the credential does not hide a host that accepts it', async () => {
  await withConfig({ region: 'cn', api_key: 'sk-cp-test' }, async (dataDir) => {
    const { impl, calls } = stubFetch({
      [CN_HOST]: { status: 200, body: { base_resp: { status_code: 2049, status_msg: 'invalid api key' } } },
      [GLOBAL_HOST]: { status: 200, body: okBody },
    });
    const payload = await fetchQuota(dataDir, undefined, { fetchImpl: impl });
    assert.equal(payload.base_resp.status_code, 0);
    assert.deepEqual(calls, [CN_HOST, GLOBAL_HOST]);
  });
});

test('a rejected credential is reported as a credential problem, not a generic refusal', async () => {
  await withConfig({ region: 'cn', api_key: 'sk-cp-test' }, async (dataDir) => {
    const { impl } = stubFetch({
      [CN_HOST]: { status: 200, body: { base_resp: { status_code: 2049, status_msg: 'invalid api key' } } },
      [GLOBAL_HOST]: { status: 200, body: { base_resp: { status_code: 2049, status_msg: 'invalid api key' } } },
    });
    await assert.rejects(fetchQuota(dataDir, undefined, { fetchImpl: impl }), (error) => error.code === 'invalid_credential');
  });
});

test('the actionable failure wins when two hosts disagree', async () => {
  await withConfig({ region: 'cn', api_key: 'sk-cp-test' }, async (dataDir) => {
    const { impl } = stubFetch({
      [CN_HOST]: { status: 200, body: { base_resp: { status_code: 2049, status_msg: 'invalid api key' } } },
      [GLOBAL_HOST]: { status: 500, body: {} },
    });
    await assert.rejects(fetchQuota(dataDir, undefined, { fetchImpl: impl }), (error) => error.code === 'invalid_credential');
  });
});

test('an HTTP 401 stays unauthorized and a missing secret key is its own code', async () => {
  await withConfig({ region: 'global', api_key: 'sk-cp-test' }, async (dataDir) => {
    const unauthorized = stubFetch({ [GLOBAL_HOST]: { status: 401, body: {} } });
    await assert.rejects(fetchQuota(dataDir, undefined, { fetchImpl: unauthorized.impl }), (error) => error.code === 'unauthorized');

    const missing = stubFetch({ [GLOBAL_HOST]: { status: 200, body: { base_resp: { status_code: 1004, status_msg: 'no secret key' } } } });
    await assert.rejects(fetchQuota(dataDir, undefined, { fetchImpl: missing.impl }), (error) => error.code === 'missing_credential');
  });
});

test('an account-balance key is refused before any request is sent', async () => {
  await withConfig({ region: 'cn', api_key: 'sk-api-balance' }, async (dataDir) => {
    const { impl, calls } = stubFetch({});
    await assert.rejects(fetchQuota(dataDir, undefined, { fetchImpl: impl }), (error) => error.code === 'balance_credential');
    assert.deepEqual(calls, []);
  });
});

test('a transport failure stops the walk instead of retrying every host', async () => {
  await withConfig({ region: 'cn', api_key: 'sk-cp-test' }, async (dataDir) => {
    const calls = [];
    const impl = async (url) => {
      calls.push(url);
      throw new Error('offline');
    };
    await assert.rejects(fetchQuota(dataDir, undefined, { fetchImpl: impl }), (error) => error.code === 'network');
    assert.deepEqual(calls, [CN_HOST]);
  });
});

test('the plugin login is used before the CLI API key', async () => {
  await withConfig({ region: 'cn', api_key: 'sk-cp-cli' }, async (dataDir) => {
    await saveCredentials(dataDir, {
      access_token: 'plugin-token',
      refresh_token: 'plugin-refresh',
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      region: 'cn',
    });
    const calls = [];
    const impl = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return { ok: true, status: 200, json: async () => okBody };
    };
    await fetchQuota(dataDir, undefined, { fetchImpl: impl });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, CN_HOST);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer plugin-token');
  });
});
