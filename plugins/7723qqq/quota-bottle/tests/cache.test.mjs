import assert from 'node:assert/strict';
import test from 'node:test';

import { ValueCache } from '../miniapp/node/cache.mjs';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('ValueCache reuses a fresh result and shares one in-flight load', async () => {
  let calls = 0;
  let now = 0;
  const cache = new ValueCache(1000, () => now);
  const load = () => { calls += 1; return Promise.resolve(calls); };
  assert.equal(await cache.get(false, load, '2026-11'), 1);
  assert.equal(await cache.get(false, load, '2026-11'), 1);
  now = 2000;
  assert.equal(await cache.get(false, load, '2026-11'), 2);
  assert.equal(calls, 2);
});

test('ValueCache misses when the caller version changes', async () => {
  let calls = 0;
  const cache = new ValueCache(60_000, () => 0);
  const load = () => Promise.resolve(++calls);
  assert.equal(await cache.get(false, load, '2026-11'), 1);
  assert.equal(await cache.get(false, load, '2026-12'), 2);
});

test('a force refresh does not reuse a request from the previous generation', async () => {
  const oldLoad = deferred();
  const newLoad = deferred();
  const loads = [oldLoad, newLoad];
  const cache = new ValueCache(60_000, () => 0);
  const first = cache.get(false, () => oldLoad.promise, 'v1');
  const second = cache.get(true, () => newLoad.promise, 'v1');
  newLoad.resolve('new');
  oldLoad.resolve('old');
  assert.equal(await second, 'new');
  assert.equal(await first, 'old');
  assert.equal(await cache.get(false, () => Promise.resolve('unexpected'), 'v1'), 'new');
  assert.equal(loads.length, 2);
});

test('clear invalidates a result without changing the caller version', async () => {
  let calls = 0;
  const cache = new ValueCache(60_000, () => 0);
  const load = () => Promise.resolve(++calls);
  assert.equal(await cache.get(false, load, 'same'), 1);
  cache.clear();
  assert.equal(await cache.get(false, load, 'same'), 2);
});
