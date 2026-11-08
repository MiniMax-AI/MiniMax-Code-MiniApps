import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeAbsoluteExpiry,
  normalizeHttpsUrl,
  normalizePollInterval,
  normalizeUserCode,
  normalizeVerificationUrl,
  oauthRegionForUrl,
} from '../miniapp/node/urls.mjs';

test('normalizeHttpsUrl accepts MiniMax HTTPS hosts and explicit loopback test hosts', () => {
  assert.equal(normalizeHttpsUrl('https://api.minimaxi.com/', { purpose: 'api' }), 'https://api.minimaxi.com');
  assert.equal(normalizeHttpsUrl('http://127.0.0.1:8787/stub', { purpose: 'api', allowHttpLoopback: true }), 'http://127.0.0.1:8787/stub');
  assert.equal(normalizeHttpsUrl('https://account.minimax.io/oauth2', { purpose: 'account' }), 'https://account.minimax.io/oauth2');
});

test('normalizeHttpsUrl rejects plain HTTP, userinfo, queries, fragments, and unrelated hosts', () => {
  for (const value of [
    'http://api.minimaxi.com',
    'https://user:pass@api.minimaxi.com',
    'https://api.minimaxi.com/?token=secret',
    'https://api.minimaxi.com/#x',
    'https://attacker.example/v1/token_plan/remains',
    'javascript:alert(1)',
    'https://api.minimaxi.com.evil.example',
  ]) {
    assert.equal(normalizeHttpsUrl(value, { purpose: 'api' }), null, value);
  }
});

test('normalizeVerificationUrl accepts only the region verification origins', () => {
  assert.equal(normalizeVerificationUrl('https://account.minimaxi.com/device?user_code=ABCD', 'cn'), 'https://account.minimaxi.com/device?user_code=ABCD');
  assert.equal(normalizeVerificationUrl('https://platform.minimaxi.com/oauth-authorize?user_code=ABCD', 'cn'), 'https://platform.minimaxi.com/oauth-authorize?user_code=ABCD');
  assert.equal(normalizeVerificationUrl('https://platform.minimax.io/oauth-authorize?user_code=ABCD', 'global'), 'https://platform.minimax.io/oauth-authorize?user_code=ABCD');
  assert.equal(normalizeVerificationUrl('https://attacker.example/device', 'cn'), null);
  assert.equal(normalizeVerificationUrl('http://account.minimaxi.com/device', 'cn'), null);
  // Another region's page is never a valid target.
  assert.equal(normalizeVerificationUrl('https://platform.minimax.io/oauth-authorize?user_code=ABCD', 'cn'), null);
  assert.equal(normalizeVerificationUrl('https://platform.minimaxi.com/oauth-authorize?user_code=ABCD', 'global'), null);
});

test('oauthRegionForUrl reads the region from either verification origin', () => {
  assert.equal(oauthRegionForUrl('https://account.minimaxi.com/device'), 'cn');
  assert.equal(oauthRegionForUrl('https://platform.minimaxi.com/oauth-authorize?user_code=ABCD'), 'cn');
  assert.equal(oauthRegionForUrl('https://platform.minimax.io/oauth-authorize?user_code=ABCD'), 'global');
});

test('normalizeUserCode and timing fields reject malformed network responses', () => {
  assert.equal(normalizeUserCode('ABCD-1234'), 'ABCD-1234');
  assert.equal(normalizeUserCode('javascript:alert(1)'), null);
  assert.equal(normalizePollInterval(0), null);
  assert.equal(normalizePollInterval(3000), 3000);
  const expiresAt = Date.now() + 10 * 60 * 1000;
  assert.equal(normalizeAbsoluteExpiry(expiresAt), expiresAt);
  assert.equal(normalizeAbsoluteExpiry(Date.now() - 1000), null);
  assert.equal(normalizeAbsoluteExpiry(Date.now() + 48 * 60 * 60 * 1000), null);
});
