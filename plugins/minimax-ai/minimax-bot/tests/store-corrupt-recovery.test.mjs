import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../miniapp/node/store.mjs';

// A state.json or chat file that cannot be parsed must not keep the Mini App from starting:
// the unreadable file is kept as *.corrupt-<time> and the store starts from defaults.

test('a 0-byte state.json is quarantined so the plugin still starts', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bot-corrupt-state-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const seed = new Store(dir);
  await seed.init();
  await seed.save();
  await writeFile(join(dir, 'state.json'), '', 'utf8'); // what a crash after rename-without-fsync leaves
  const store = new Store(dir);
  await store.init(); // red on baseline: throws SyntaxError, the whole Mini App refuses to start
  assert.equal(store.state.bots.length, 1, 'the store reseeds its Chief');
  assert.ok((await readdir(dir)).some((name) => name.includes('corrupt')), 'the unreadable file is kept as evidence');
});

test('one truncated chat file does not take every chat down', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bot-corrupt-chat-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const seed = new Store(dir);
  await seed.init();
  const chat = seed.chatIds()[0];
  await seed.appendMessage(chat, { role: 'user', text: 'keep me' });
  // A second chat with a healthy file: it must still load.
  const other = 'bot:bot_other';
  await writeFile(seed.messagePath(other), JSON.stringify([{ id: 'msg_other', role: 'user', text: 'other chat', ts: 1, status: 'done' }]));
  await writeFile(seed.messagePath(chat), '{"id":"msg_x","text":"hal', 'utf8');
  const store = new Store(dir);
  await store.init(); // red on baseline: one bad chat file kills the whole warm-up
  assert.deepEqual(await store.getMessages(chat), [], 'the unreadable chat starts empty');
  assert.equal((await store.getMessages(other)).length, 1, 'the other chat loads normally');
  assert.ok((await readdir(join(dir, 'messages'))).some((name) => name.includes('corrupt')), 'the truncated file is kept as evidence');
});

test('a state.json whose sessions is null starts, and setSession does not throw', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bot-shape-sessions-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const seed = new Store(dir);
  await seed.init();
  await seed.save();
  const state = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'));
  state.sessions = null;
  await writeFile(join(dir, 'state.json'), JSON.stringify(state));
  const store = new Store(dir);
  await store.init();
  const botId = store.state.bots[0].id;
  await store.setSession(`bot:${botId}`, botId, { sessionId: 's-shape' }); // red on baseline: TypeError on null
  assert.equal(store.getSession(`bot:${botId}`, botId)?.sessionId, 's-shape');
});