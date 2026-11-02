// @ts-check
// The "@" of a mention when a letter of another script stands in front of it.
//
// Chinese, Japanese kana and Korean write a word right up against the "@" ("请@某人"), so a
// character of those scripts does not swallow the mention. A letter of any other script is
// still the local part of an address: "josé@alice" is an address and calls nobody, the same
// way "mail@alice.com" does not. The name itself still has to end at the "@", so "@alicex" is
// not Alice either.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Store } from '../miniapp/node/store.mjs';
import { MemoryStore } from '../miniapp/node/memory.mjs';
import { Engine } from '../miniapp/node/engine.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'bot-mention-nonascii-'));
  const store = new Store(dir);
  const memory = new MemoryStore(dir);
  await store.init();
  await memory.init();
  const engine = new Engine({
    store, memory, logger: { warn() {} }, broadcast: () => {}, retryDelaysMs: [],
  });
  t.after(async () => {
    engine.dispose();
    await rm(dir, { recursive: true, force: true });
  });
  store.state.bots = [
    { id: 'alice', name: 'Alice' },
    { id: 'bob', name: 'Bob' },
  ];
  return { store, engine, group: { memberIds: ['alice', 'bob'] } };
}

test('a letter of a script that writes with spaces makes an address, not a mention', async (t) => {
  const { engine, group } = await fixture(t);
  // Accented Latin letters, in both compositions.
  assert.deepEqual(engine.mentionsIn('josé@alice', group), []);
  assert.deepEqual(engine.mentionsIn('José@alice', group), []);
  assert.deepEqual(engine.mentionsIn('jose\u0301@alice', group), []);
  // Greek and Cyrillic letters.
  assert.deepEqual(engine.mentionsIn('Παύλος@alice', group), []);
  assert.deepEqual(engine.mentionsIn('Привет@alice', group), []);
  // A mention later in the same text is still found.
  assert.deepEqual(engine.mentionsIn('josé@alice @bob', group), ['bob']);
});

test('Chinese, Japanese and Korean write up against the "@" and still reach the member', async (t) => {
  const { engine, group } = await fixture(t);
  assert.deepEqual(engine.mentionsIn('请@alice', group), ['alice']);
  assert.deepEqual(engine.mentionsIn('（@alice）', group), ['alice']);
  assert.deepEqual(engine.mentionsIn('，@alice', group), ['alice']);
  assert.deepEqual(engine.mentionsIn('@alice', group), ['alice']);
  assert.deepEqual(engine.mentionsIn('日本語@alice', group), ['alice']);
  assert.deepEqual(engine.mentionsIn('カタカナ@alice', group), ['alice']);
  assert.deepEqual(engine.mentionsIn('한국어@alice', group), ['alice']);
});

test('the address forms stay silent', async (t) => {
  const { engine, group } = await fixture(t);
  assert.deepEqual(engine.mentionsIn('mail@alice.com', group), []);
  assert.deepEqual(engine.mentionsIn('@alicex', group), []);
  assert.deepEqual(engine.mentionsIn('1@alice', group), []);
  assert.deepEqual(engine.mentionsIn('_@alice', group), []);
});
