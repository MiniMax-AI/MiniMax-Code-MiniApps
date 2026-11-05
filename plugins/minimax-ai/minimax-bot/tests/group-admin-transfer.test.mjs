// @ts-check
// Who may hand a group's admin over.
//
// Only the main Bot may change the admin of a group. The explicit `admin` field is refused for
// every other Bot, but the member list was a second door to the same change: a group admin who
// patched the member list and left themselves out moved the admin to the first member left.
// The rule is one rule, so both doors have to ask the same question.

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
  const dir = await mkdtemp(join(tmpdir(), 'bot-admin-transfer-'));
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
    { id: 'alice', name: 'Alice' },
    { id: 'bob', name: 'Bob' },
    { id: 'carol', name: 'Carol' },
  ];
  // Alice is the admin of the group, and she is not the main Bot.
  store.state.groups = [{
    id: 'grp_g', name: 'Team', adminId: 'alice',
    memberIds: ['alice', 'bob'], replyMode: 'admin',
  }];
  await store.save();
  return { store, engine, team };
}

test('a group admin cannot hand the admin over by patching the member list', async (t) => {
  const { team, store } = await fixture(t);
  const alice = store.getBot('alice');
  await assert.rejects(
    () => team.updateGroup(alice, 'grp_g', { members: ['bob'] }),
    (error) => error.code === 'forbidden' && /admin/i.test(error.message),
  );
  // Nothing changed: the same Bot is still the admin and still a member.
  const group = store.getGroup('grp_g');
  assert.equal(group.adminId, 'alice');
  assert.deepEqual(group.memberIds, ['alice', 'bob']);
});

test('the explicit admin field is refused for the same Bot', async (t) => {
  const { team, store } = await fixture(t);
  const alice = store.getBot('alice');
  await assert.rejects(
    () => team.updateGroup(alice, 'grp_g', { admin: 'bob' }),
    (error) => error.code === 'forbidden' && /admin/i.test(error.message),
  );
  assert.equal(store.getGroup('grp_g').adminId, 'alice');
});

test('a group admin may still change the member list as long as the admin stays', async (t) => {
  const { team, store } = await fixture(t);
  const alice = store.getBot('alice');
  await team.updateGroup(alice, 'grp_g', { members: ['alice', 'bob', 'carol'] });
  const group = store.getGroup('grp_g');
  assert.equal(group.adminId, 'alice');
  assert.deepEqual(group.memberIds, ['alice', 'bob', 'carol']);
});

test('the main Bot may still move the admin by patching the member list', async (t) => {
  const { team, store } = await fixture(t);
  const chief = store.getBot('chief');
  await team.updateGroup(chief, 'grp_g', { members: ['bob'] });
  const group = store.getGroup('grp_g');
  assert.equal(group.adminId, 'bob');
  assert.deepEqual(group.memberIds, ['bob']);
});
