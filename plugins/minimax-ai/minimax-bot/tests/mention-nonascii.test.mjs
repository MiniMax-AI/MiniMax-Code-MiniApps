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

test('a full-width IME and the scripts that write up against the "@" still reach the member', async (t) => {
  const { engine, group } = await fixture(t);
  // A full-width IME writes full-width letters and digits.
  assert.deepEqual(engine.mentionsIn('ＯＫ@alice', group), ['alice']);
  assert.deepEqual(engine.mentionsIn('第２@alice', group), ['alice']);
  // Thai, Lao, Khmer and Myanmar write a word right up against the "@" as well.
  assert.deepEqual(engine.mentionsIn('\u0e02\u0e2d\u0e1a\u0e38\u0e19@alice', group), ['alice']);
  assert.deepEqual(engine.mentionsIn('\u0e82\u0eb2\u0e99@alice', group), ['alice']);
  assert.deepEqual(engine.mentionsIn('\u17e1\u179c\u17b7@alice', group), ['alice']);
  assert.deepEqual(engine.mentionsIn('\u1000\u103b\u102c\u1019\u1038@alice', group), ['alice']);
  // A letter of a script that writes with spaces still makes an address.
  assert.deepEqual(engine.mentionsIn('josé@alice', group), []);
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
