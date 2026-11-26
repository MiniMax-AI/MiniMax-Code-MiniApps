// @ts-check
//
// Regression tests for the image download.
//
// The signed URL comes from a tool, so the host it names is checked before
// anything is requested, and every redirect hop is checked the same way.

import test from 'node:test';
import assert from 'node:assert/strict';

import { assertAllowedAssetUrl, downloadAsset, isAllowedAssetHost, isSameAssetHost } from '../miniapp/node/images.mjs';

test('the Matrix Drive object storage host is allowed', () => {
  assert.equal(isAllowedAssetHost('matrix-internal-cn.oss-cn-shanghai.aliyuncs.com'), true);
  assert.equal(isAllowedAssetHost('matrix-internal-cn.oss-cn-shanghai.aliyuncs.com.'), true);
});

test('only the pinned bucket is allowed, not any bucket on that domain', () => {
  assert.equal(isAllowedAssetHost('other-bucket.oss-cn-shanghai.aliyuncs.com'), false);
  assert.equal(isAllowedAssetHost('attacker.oss-cn-hangzhou.aliyuncs.com'), false);
  assert.equal(isAllowedAssetHost('oss-cn-shanghai.aliyuncs.com'), false);
});

test('a redirect may not move the request to another host', () => {
  assert.equal(isSameAssetHost('matrix-internal-cn.oss-cn-shanghai.aliyuncs.com', 'matrix-internal-cn.oss-cn-shanghai.aliyuncs.com'), true);
  assert.equal(isSameAssetHost('matrix-internal-cn.oss-cn-beijing.aliyuncs.com', 'matrix-internal-cn.oss-cn-shanghai.aliyuncs.com'), false);
  assert.equal(isSameAssetHost('other-bucket.oss-cn-shanghai.aliyuncs.com', 'matrix-internal-cn.oss-cn-shanghai.aliyuncs.com'), false);
  assert.equal(isSameAssetHost('', 'matrix-internal-cn.oss-cn-shanghai.aliyuncs.com'), false);
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

/* ------------------------------------------------------------------ *
 * The download follows redirects by hand, and a redirect may not leave
 * the host the signed URL named.
 * ------------------------------------------------------------------ */

/**
 * Run `body` with `fetch` replaced by a stub.
 *
 * The stub answers the first request with a redirect to `location` and every
 * request after it with the image itself, so one redirect is followed.
 *
 * @param {string | null} location
 * @param {() => Promise<unknown>} body
 */
async function withStubbedFetch(location, body) {
  const original = globalThis.fetch;
  /** @type {string[]} */
  const requested = [];
  globalThis.fetch = /** @type {any} */ (
    async (/** @type {string} */ url) => {
      requested.push(String(url));
      const first = requested.length === 1;
      const redirecting = location !== null && first;
      return {
        status: redirecting ? 302 : 200,
        ok: !redirecting,
        headers: { get: () => (redirecting ? location : null) },
        arrayBuffer: async () => new ArrayBuffer(8),
      };
    }
  );
  try {
    await body();
  } finally {
    globalThis.fetch = original;
  }
}

test('a redirect to another host of the same bucket is refused', async () => {
  await withStubbedFetch(
    'https://matrix-internal-cn.oss-cn-beijing.aliyuncs.com/image.jpg',
    async () => {
      await assert.rejects(
        () => downloadAsset('https://matrix-internal-cn.oss-cn-shanghai.aliyuncs.com/image.jpg'),
        /另一个主机/,
      );
    },
  );
});

test('a redirect to another bucket is refused', async () => {
  await withStubbedFetch('https://other-bucket.oss-cn-shanghai.aliyuncs.com/image.jpg', async () => {
    await assert.rejects(
      () => downloadAsset('https://matrix-internal-cn.oss-cn-shanghai.aliyuncs.com/image.jpg'),
      /不在允许范围内/,
    );
  });
});

test('a redirect that stays on the host is followed', async () => {
  await withStubbedFetch(
    'https://matrix-internal-cn.oss-cn-shanghai.aliyuncs.com/other/image.jpg',
    async () => {
      const bytes = await downloadAsset('https://matrix-internal-cn.oss-cn-shanghai.aliyuncs.com/image.jpg');
      assert.equal(bytes.length, 8);
    },
  );
});

test('a signed URL that names another bucket is refused before any request', async () => {
  await withStubbedFetch(null, async () => {
    await assert.rejects(
      () => downloadAsset('https://other-bucket.oss-cn-shanghai.aliyuncs.com/image.jpg'),
      /不在允许范围内/,
    );
  });
});
