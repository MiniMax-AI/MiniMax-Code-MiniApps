// @ts-check
// The "@" of a mention when the keyboard writes it full-width.
//
// A Chinese IME writes the full-width "＠" (U+FF20), and the small commercial "﹫" (U+FE6B)
// is the same sign in a smaller box. Both stand where the ASCII "@" stands, so a mention that
// starts with one has to reach the member like any other. A name may not carry the sign either:
// a mention is found by its "@", so a name with one in it would be unreachable.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Store } from '../miniapp/node/store.mjs';
import { MemoryStore } from '../miniapp/node/memory.mjs';
import { Engine } from '../miniapp/node/engine.mjs';
import { Team } from '../miniapp/node/team.mjs';
import { setLocale } from '../miniapp/node/i18n.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'bot-mention-wide-'));
  const store = new Store(dir);
  const memory = new MemoryStore(dir);
  await store.init();
  await memory.init();
  setLocale('en');
  const engine = new Engine({
    store, memory, logger: { warn() {} }, broadcast: () => {}, retryDelaysMs: [],
  });
  const team = new Team({ store, memory, engine, broadcast() {} });
  t.after(async () => {
    engine.dispose();
    await rm(dir, { recursive: true, force: true });
  });
  store.state.bots = [
    { id: 'chief', name: 'Chief', isMain: true },
    { id: 'designer', name: '设计师' },
    { id: 'alice', name: 'Alice' },
    { id: 'bob', name: 'Bob' },
  ];
  const group = {
    id: 'grp_g', name: 'Team', adminId: 'bob',
    memberIds: ['designer', 'alice', 'bob'], replyMode: 'admin',
  };
  store.state.groups = [group];
  await store.save();
  return { store, engine, team, group };
}

test('the full-width "＠" reaches the member like the ASCII "@"', async (t) => {
  const { engine, group } = await fixture(t);
  // What a Chinese IME types: the full-width sign and a Chinese name.
  assert.deepEqual(engine.mentionsIn('＠设计师 帮忙', group), ['designer']);
  assert.deepEqual(engine.groupQueue(group, '＠设计师 帮忙'), ['designer']);
  // The small commercial sign of the same kind.
  assert.deepEqual(engine.mentionsIn('﹫alice hi', group), ['alice']);
  // The sign may stand right against a word, as the ASCII one does.
  assert.deepEqual(engine.mentionsIn('请＠设计师', group), ['designer']);
  assert.deepEqual(engine.mentionsIn('界＠alice', group), ['alice']);
  // Two mentions in one text are both found.
  assert.deepEqual(engine.mentionsIn('＠设计师 帮忙 @alice', group), ['designer', 'alice']);
  // The ASCII form still works the same way.
  assert.deepEqual(engine.mentionsIn('@设计师 帮忙', group), ['designer']);
});

test('the address forms stay silent with the full-width "@"', async (t) => {
  const { engine, group } = await fixture(t);
  assert.deepEqual(engine.mentionsIn('mail＠alice.com', group), []);
  assert.deepEqual(engine.mentionsIn('josé＠alice', group), []);
  assert.deepEqual(engine.mentionsIn('＠alicex', group), []);
  assert.deepEqual(engine.mentionsIn('1＠alice', group), []);
});

test('a name may not carry the full-width "@"', async (t) => {
  const { team, store } = await fixture(t);
  const chief = store.getBot('chief');
  await assert.rejects(
    () => team.createBot(chief, { name: '＠Bot' }),
    (error) => error.code === 'invalid' && /@/.test(error.message),
  );
  await assert.rejects(
    () => team.createBot(chief, { name: 'Bo﹫t' }),
    (error) => error.code === 'invalid' && /@/.test(error.message),
  );
  await assert.rejects(
    () => team.createGroup(chief, { name: '＠Team', members: ['alice'] }),
    (error) => error.code === 'invalid' && /@/.test(error.message),
  );
  // The ASCII sign was already refused, and a plain name still works.
  await assert.rejects(
    () => team.createBot(chief, { name: 'Bad@Name' }),
    (error) => error.code === 'invalid',
  );
  const bot = await team.createBot(chief, { name: 'Carol' });
  assert.equal(bot.name, 'Carol');
});
