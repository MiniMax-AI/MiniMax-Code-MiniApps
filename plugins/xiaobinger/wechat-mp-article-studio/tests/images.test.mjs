// @ts-check
//
// Regression tests for the image download.
//
// The signed URL comes from a tool, so the host it names is checked before
// anything is requested, and every redirect hop is checked the same way.

import test from 'node:test';
import assert from 'node:assert/strict';

import { assertAllowedAssetUrl, isAllowedAssetHost } from '../miniapp/node/images.mjs';

test('the Matrix Drive object storage host is allowed', () => {
  assert.equal(isAllowedAssetHost('matrix-internal-cn.oss-cn-shanghai.aliyuncs.com'), true);
  assert.equal(isAllowedAssetHost('matrix-internal-cn.oss-cn-shanghai.aliyuncs.com.'), true);
});

test('a loopback or link-local address is not allowed', () => {
  assert.equal(isAllowedAssetHost('127.0.0.1'), false);
  assert.equal(isAllowedAssetHost('localhost'), false);
  assert.equal(isAllowedAssetHost('169.254.169.254'), false);
  assert.equal(isAllowedAssetHost('10.0.0.5'), false);
  assert.equal(isAllowedAssetHost('192.168.1.10'), false);
  assert.equal(isAllowedAssetHost('0.0.0.0'), false);
});

test('an unrelated host is not allowed', () => {
  assert.equal(isAllowedAssetHost('evil.example'), false);
  assert.equal(isAllowedAssetHost('aliyuncs.com.evil.example'), false);
  assert.equal(isAllowedAssetHost('matrix-internal-cn.oss-cn-shanghai.aliyuncs.com.evil.example'), false);
  assert.equal(isAllowedAssetHost('internal.service.local'), false);
});

test('the userinfo trick does not smuggle another host through', () => {
  assert.throws(
    () => assertAllowedAssetUrl('https://matrix-internal-cn.oss-cn-shanghai.aliyuncs.com@127.0.0.1/image.jpg'),
    /不在允许范围内/,
  );
});

test('a non-HTTPS address is refused', () => {
  assert.throws(
    () => assertAllowedAssetUrl('http://matrix-internal-cn.oss-cn-shanghai.aliyuncs.com/image.jpg'),
    /HTTPS/,
  );
});

test('an allowed address passes', () => {
  const parsed = assertAllowedAssetUrl(
    'https://matrix-internal-cn.oss-cn-shanghai.aliyuncs.com/Mavis/1/image.jpg?Expires=1&Signature=x',
  );
  assert.equal(parsed.hostname, 'matrix-internal-cn.oss-cn-shanghai.aliyuncs.com');
});
