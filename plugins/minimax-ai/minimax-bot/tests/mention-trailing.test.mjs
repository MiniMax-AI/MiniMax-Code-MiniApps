// @ts-check
// A Chinese name stays open while more of the same script follows it.
//
// Chinese writes without spaces, so a name cannot be told apart from the words around it by
// whitespace alone: after "@某人", the next character could belong to the name or start a new
// word. The mention ends only at a character of another kind, which is what keeps "@设计师傅"
// from calling 设计师. The trade-off is that "@某人帮忙" is read as a name that is still going
// and calls nobody; a space or punctuation after the name calls the member.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Store } from '../miniapp/node/store.mjs';
import { MemoryStore } from '../miniapp/node/memory.mjs';
import { Engine } from '../miniapp/node/engine.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'bot-mention-trailing-'));
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
    { id: 'someone', name: '某人' },
    { id: 'designer', name: '设计师' },
  ];
  return { store, engine, group: { memberIds: ['someone', 'designer'] } };
}

test('a Chinese name that runs into more Chinese words is not a mention', async (t) => {
  const { engine, group } = await fixture(t);
  // The character after the name could still be part of it, so nobody is called.
  assert.deepEqual(engine.mentionsIn('@某人帮忙', group), []);
  assert.deepEqual(engine.mentionsIn('请@某人帮忙看一下', group), []);
  // The same boundary keeps a longer name from calling the shorter one it starts with.
  assert.deepEqual(engine.mentionsIn('@设计师傅', group), []);
  assert.deepEqual(engine.mentionsIn('请@设计师傅做', group), []);
});

test('a space or punctuation after the Chinese name calls the member', async (t) => {
  const { engine, group } = await fixture(t);
  assert.deepEqual(engine.mentionsIn('@某人 帮忙', group), ['someone']);
  assert.deepEqual(engine.mentionsIn('请@某人 帮忙', group), ['someone']);
  assert.deepEqual(engine.mentionsIn('@某人，帮忙', group), ['someone']);
  assert.deepEqual(engine.mentionsIn('请@某人。', group), ['someone']);
  assert.deepEqual(engine.mentionsIn('@设计师 看一下', group), ['designer']);
});
