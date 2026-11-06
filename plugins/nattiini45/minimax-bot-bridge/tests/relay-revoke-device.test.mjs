import assert from 'node:assert/strict';
import test from 'node:test';

import { RelayClient } from '../miniapp/node/relay-client.mjs';

const OPTIONS = { url: 'https://relay.example', accountId: 'room /%', bridgeId: 'desktop', token: 'owner-proof' };

for (const deviceId of ['.', '..', '%2e', '%2e%2e', '/', '\\', '%', 'phone/slash', 'phone space', 'me', '手机-雪']) {
  test(`owner revocation transports exact device ID ${JSON.stringify(deviceId)} outside the URL`, async (t) => {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      calls += 1;
      assert.equal(new URL(url).pathname, '/r/room%20%2F%25/devices/revoke');
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.authorization, 'Bearer owner-proof');
      assert.equal(init.headers['content-type'], 'application/json');
      assert.deepEqual(JSON.parse(init.body), { deviceId });
      return new Response('{"revoked":true}', { status: 200 });
    });
    const client = new RelayClient(OPTIONS);
    assert.equal(await client.revokeDevice(deviceId), true);
    assert.equal(calls, 1);
  });
}

test('unconfigured revocation does not issue a request', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('must not fetch'); });
  assert.equal(await new RelayClient().revokeDevice('.'), false);
});

for (const status of [401, 404, 500]) {
  test(`owner revocation reports relay failure ${status}`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status }));
    assert.equal(await new RelayClient(OPTIONS).revokeDevice('.'), false);
  });
}
