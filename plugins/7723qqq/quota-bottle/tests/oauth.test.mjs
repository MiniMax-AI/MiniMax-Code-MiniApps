import assert from 'node:assert/strict';
import test from 'node:test';

import { pollDeviceLogin } from '../miniapp/node/auth/oauth.mjs';
import { ensureFreshToken } from '../miniapp/node/auth/auth.mjs';
import { normalizeFlexibleExpiry } from '../miniapp/node/urls.mjs';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function pendingFlow(overrides = {}) {
  return {
    region: 'cn',
    verifier: 'verifier',
    userCode: 'ABCD-1234',
    expiresAt: Date.now() + 10 * 60 * 1000,
    intervalMs: 0,
    lastPollAt: 0,
    status: 'pending',
    ...overrides,
  };
}

test('a granted token is recognized by the token itself', async () => {
  const flow = pendingFlow();
  const result = await pollDeviceLogin(flow, undefined, {
    fetchImpl: async () => jsonResponse(200, {
      base_resp: { status_code: 0, status_msg: 'success' },
      access_token: 'granted-token',
      refresh_token: 'refresh',
      expired_in: Date.now() + 3600 * 1000,
    }),
  });
  assert.equal(result.status, 'success');
  assert.equal(result.credentials.access_token, 'granted-token');
  assert.equal(result.credentials.region, 'cn');
  assert.ok(new Date(result.credentials.expires_at).getTime() > Date.now());
});

test('a status field of success still works', async () => {
  const flow = pendingFlow();
  const result = await pollDeviceLogin(flow, undefined, {
    fetchImpl: async () => jsonResponse(200, {
      status: 'success',
      access_token: 'granted-token',
      refresh_token: 'refresh',
      expired_in: Date.now() + 3600 * 1000,
    }),
  });
  assert.equal(result.status, 'success');
});

test('an expiry given as a lifetime in seconds is usable', async () => {
  const flow = pendingFlow();
  const result = await pollDeviceLogin(flow, undefined, {
    fetchImpl: async () => jsonResponse(200, {
      access_token: 'granted-token',
      expired_in: 3600,
    }),
  });
  assert.equal(result.status, 'success');
  const expiry = new Date(result.credentials.expires_at).getTime();
  assert.ok(expiry > Date.now() + 3000 * 1000);
  assert.ok(expiry < Date.now() + 3600 * 1000 + 5000);
});

test('a pending grant stays pending, including the RFC 8628 refusal', async () => {
  const pending200 = pendingFlow();
  const ok = await pollDeviceLogin(pending200, undefined, {
    fetchImpl: async () => jsonResponse(200, { status: 'pending' }),
  });
  assert.equal(ok.status, 'pending');
  assert.equal(pending200.status, 'pending');

  const pending400 = pendingFlow();
  const refused = await pollDeviceLogin(pending400, undefined, {
    fetchImpl: async () => jsonResponse(400, { error: 'authorization_pending' }),
  });
  assert.equal(refused.status, 'pending');
  assert.equal(pending400.status, 'pending');
});

test('a refused grant ends the flow', async () => {
  const flow = pendingFlow();
  const result = await pollDeviceLogin(flow, undefined, {
    fetchImpl: async () => jsonResponse(400, { error: 'invalid_grant', error_description: 'invalid or expired code' }),
  });
  assert.equal(result.status, 'error');
  assert.equal(flow.status, 'error');
});

test('a refresh that answers with a token succeeds without a status field', async () => {
  const creds = {
    access_token: 'old',
    refresh_token: 'refresh',
    expires_at: '2020-01-01T00:00:00.000Z',
    region: 'cn',
  };
  const token = await ensureFreshToken(creds, undefined, {
    fetchImpl: async () => jsonResponse(200, {
      base_resp: { status_code: 0, status_msg: 'success' },
      access_token: 'fresh-token',
      refresh_token: 'fresh-refresh',
      expired_in: Date.now() + 3600 * 1000,
    }),
  });
  assert.equal(token, 'fresh-token');
});

test('normalizeFlexibleExpiry reads both a timestamp and a lifetime', () => {
  const now = Date.now();
  assert.equal(normalizeFlexibleExpiry(now + 60_000), now + 60_000);
  assert.ok(Math.abs(normalizeFlexibleExpiry(600) - (now + 600_000)) < 2000);
  assert.equal(normalizeFlexibleExpiry(0), null);
  assert.equal(normalizeFlexibleExpiry('nope'), null);
});
