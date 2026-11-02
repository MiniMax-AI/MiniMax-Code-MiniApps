// @ts-check
// The "@" of a mention, read the way Chinese and English write it.
//
// A mention is "@" plus a member's name. Chinese has no spaces between words, so the character
// in front of the "@" is a word of its own ("请@某人") and must not swallow the mention the way
// it does in "mail@alice.com". What makes an "@" part of an address is a word character of a
// script that writes with spaces, so that is what the guard looks at. English keeps the old
// rule: an ASCII letter, digit or underscore in front of the "@" still ends the mention, and
// the address, the longer name and the name that runs into more words are all as they were.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Store } from '../miniapp/node/store.mjs';
import { MemoryStore } from '../miniapp/node/memory.mjs';
import { Engine } from '../miniapp/node/engine.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'bot-mention-'));
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
    { id: 'designer', name: '设计师' },
    { id: 'alice', name: 'Alice' },
    { id: 'alice_smith', name: 'Alice Smith' },
    { id: 'bob', name: 'Bob' },
  ];
  return { store, engine, group: { memberIds: ['designer', 'alice', 'alice_smith', 'bob'] } };
}

test('a mention works right after a Chinese word, the way Chinese is written', async (t) => {
  const { engine, group } = await fixture(t);
  assert.deepEqual(engine.mentionsIn('@设计师，请回答。', group), ['designer']);
  assert.deepEqual(engine.mentionsIn('请@设计师，请回答。', group), ['designer']);
  assert.deepEqual(engine.mentionsIn('好的@设计师', group), ['designer']);
  assert.deepEqual(engine.mentionsIn('麻烦@设计师 看一下', group), ['designer']);
  assert.deepEqual(engine.mentionsIn('请 @设计师', group), ['designer']);
  // The same rule in the other scripts that write without spaces.
  assert.deepEqual(engine.mentionsIn('日本語@alice', group), ['alice']);
  assert.deepEqual(engine.mentionsIn('한국어@alice', group), ['alice']);
});

test('a mention in English stays the way it was', async (t) => {
  const { engine, group } = await fixture(t);
  assert.deepEqual(engine.mentionsIn('@alice', group), ['alice']);
  assert.deepEqual(engine.mentionsIn('hi @alice', group), ['alice']);
  assert.deepEqual(engine.mentionsIn('@alice please review the plan', group), ['alice']);
  assert.deepEqual(engine.mentionsIn('(@alice)', group), ['alice']);
  assert.deepEqual(engine.mentionsIn('@alice.', group), ['alice']);
  assert.deepEqual(engine.mentionsIn('@alice!', group), ['alice']);
  assert.deepEqual(engine.mentionsIn('@alice @bob', group), ['alice', 'bob']);
  assert.deepEqual(engine.mentionsIn('@alice,@bob', group), ['alice', 'bob']);
  assert.deepEqual(engine.mentionsIn('@alice @alice', group), ['alice']);
  assert.deepEqual(engine.mentionsIn('@ALICE SMITH!', group), ['alice_smith']);
  // The longest name wins, and a name that runs into more words is not a mention.
  assert.deepEqual(engine.mentionsIn('@alice smith', group), ['alice_smith']);
  assert.deepEqual(engine.mentionsIn('@Alicex', group), []);
  assert.deepEqual(engine.mentionsIn('@alice_x', group), []);
});

test('an English address is still not a mention', async (t) => {
  const { engine, group } = await fixture(t);
  // An ASCII local part, so it ends the mention the way it always did.
  assert.deepEqual(engine.mentionsIn('mail@alice.com', group), []);
  assert.deepEqual(engine.mentionsIn('user.name@alice.com', group), []);
  assert.deepEqual(engine.mentionsIn('mail@设计师', group), []);
  assert.deepEqual(engine.mentionsIn('ok@alice ok', group), []);
  assert.deepEqual(engine.mentionsIn('2@alice', group), []);
  assert.deepEqual(engine.mentionsIn('mail@alice.com @ALICE SMITH! @Alice', group), ['alice_smith', 'alice']);
});

test('a name that runs into more words is still not a mention', async (t) => {
  const { engine, group } = await fixture(t);
  // "Alicex" is another word, not Alice.
  assert.deepEqual(engine.mentionsIn('@Alicex', group), []);
  // A full stop in Chinese prose ends a sentence; it is not a domain.
  assert.deepEqual(engine.mentionsIn('@Alice。然后呢', group), ['alice']);
  assert.deepEqual(engine.mentionsIn('@设计师傅', group), []);
});

test('the Bot that sent the message does not call itself', async (t) => {
  const { engine, group } = await fixture(t);
  assert.deepEqual(engine.mentionsIn('@alice @bob', group, 'alice'), ['bob']);
  assert.deepEqual(engine.mentionsIn('@alice @bob', group, 'bob'), ['alice']);
});
