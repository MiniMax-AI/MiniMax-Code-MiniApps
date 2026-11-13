import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../miniapp/node/store.mjs';
import { MemoryStore } from '../miniapp/node/memory.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'bot-storage-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  const memory = new MemoryStore(dir);
  await store.init();
  await memory.init();
  return { dir, store, memory, chat: store.chatIds()[0] };
}

const journalRows = async (memory) => (await readFile(memory.journal, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
const unavailable = () => Object.assign(new Error('storage unavailable'), { code: 'EIO' });

test('history beyond 600 messages survives append/restart and stable pages do not skip concurrent arrivals', async (t) => {
  const { dir, store, chat } = await fixture(t);
  const old = Array.from({ length: 605 }, (_, i) => ({ id: `msg_history${i}`, chatId: chat, role: 'user', text: `History ${i}`, ts: i, status: 'done' }));
  await writeFile(store.messagePath(chat), JSON.stringify(old));
  const restored = new Store(dir);
  await restored.init();
  const sent = await restored.appendMessage(chat, { role: 'user', text: 'Latest' });
  const latest = await restored.listMessagesPage(chat, { limit: 200 });
  assert.equal(latest.messages.length, 200);
  assert.equal(latest.messages.at(-1).id, sent.id);
  assert.equal(latest.hasMore, true);
  await restored.appendMessage(chat, { role: 'user', text: 'Arrived during pagination' });
  const previous = await restored.listMessagesPage(chat, { before: latest.nextBefore, limit: 500 });
  assert.equal(previous.messages.length, 406);
  assert.equal(previous.messages[0].id, old[0].id);
  assert.equal(previous.hasMore, false);
  assert.equal(previous.nextBefore, null);
  assert.equal(new Set([...previous.messages, ...latest.messages].map((m) => m.id)).size, 606);
  await assert.rejects(restored.listMessagesPage(chat, { before: 'msg_gone' }), { code: 'not_found' });
  const afterRestart = new Store(dir);
  await afterRestart.init();
  assert.equal((await afterRestart.getMessages(chat)).length, 607);
  assert.equal((await afterRestart.getMessages(chat))[0].text, 'History 0');
});

test('failed append/update publish no rejected changes, preserve object identity, and permit retry', async (t) => {
  const { dir, store, chat } = await fixture(t);
  const message = (await store.getMessages(chat))[0];
  const original = store.messagePath.bind(store);
  const before = await readFile(original(chat), 'utf8');
  store.messagePath = () => join(dir, 'missing', 'messages.json');
  await assert.rejects(store.appendMessage(chat, { role: 'user', text: 'Rejected send' }), { code: 'ENOENT' });
  await assert.rejects(store.updateMessage(chat, message.id, { text: 'Rejected edit' }), { code: 'ENOENT' });
  assert.equal((await store.getMessages(chat)).length, 1);
  assert.notEqual(message.text, 'Rejected edit');
  assert.equal(await readFile(original(chat), 'utf8'), before);
  store.messagePath = original;
  await store.updateMessage(chat, message.id, { text: 'Accepted edit' });
  assert.equal((await store.getMessages(chat))[0], message);
  assert.equal(message.text, 'Accepted edit');
  const sent = await store.appendMessage(chat, { role: 'user', text: 'Retry accepted' });
  assert.equal(sent.seq, message.seq + 1);
  const restored = new Store(dir);
  await restored.init();
  assert.deepEqual((await restored.getMessages(chat)).map((m) => m.text), ['Accepted edit', 'Retry accepted']);
});

test('concurrent appends and reactions retain every update and assign unique ordered sequences', async (t) => {
  const { dir, store, chat } = await fixture(t);
  const greeting = (await store.getMessages(chat))[0];
  const additions = Array.from({ length: 8 }, (_, i) => store.appendMessage(chat, { role: 'user', text: `Send ${i}` }));
  await Promise.all([...additions, store.setUserReaction(chat, greeting.id, '👍', true), store.setUserReaction(chat, greeting.id, '🎉', true)]);
  const rows = await store.getMessages(chat);
  assert.equal(rows.length, 9);
  assert.deepEqual(rows.map((m) => m.seq), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const restored = new Store(dir);
  await restored.init();
  assert.deepEqual((await restored.getMessages(chat))[0].userReactions, ['🎉']);
  await restored.deleteChat(chat);
  const afterReset = await restored.appendMessage(chat, { role: 'user', text: 'New conversation' });
  assert.equal(afterReset.seq, 1);
  assert.equal((await restored.getMessages(chat)).length, 1);
});

test('a reset that cannot be saved leaves the transcript on disk instead of emptying it', async (t) => {
  const { dir, store, chat } = await fixture(t);
  const kept = await store.appendMessage(chat, { role: 'user', text: 'Worth keeping' });
  await store.writeChain;

  // Put a directory where state.json belongs so the state write fails, and record what the
  // transcript looked like before the reset was attempted.
  const statePath = join(dir, 'state.json');
  await rm(statePath, { force: true });
  await mkdir(statePath, { recursive: true });

  await assert.rejects(store.deleteChat(chat));
  // The chat is still listed because its state never reached disk, so its history has to survive
  // too: emptying the transcript first is what made a failed reset destroy the conversation.
  const onDisk = JSON.parse(await readFile(store.messagePath(chat), 'utf8'));
  assert.equal(onDisk.filter((message) => message.id === kept.id).length, 1);
});

test('legacy sequence migration preserves text/tool order and stable cursors across restarts', async (t) => {
  const { dir, store, chat } = await fixture(t);
  const parts = [{ type: 'text', text: 'The current conclusion: ' }, { type: 'tool', name: 'build', state: 'ok' }, { type: 'text', text: 'The current conclusion: publish after the build passes.' }];
  const historical = [
    { id: 'msg_first', chatId: chat, role: 'bot', text: 'Unchanged historical text', parts, ts: 10, status: 'done' },
    { id: 'msg_second', chatId: chat, role: 'user', text: 'Later record with an earlier clock', ts: 5, status: 'done' },
  ];
  await writeFile(store.messagePath(chat), JSON.stringify(historical));
  const restored = new Store(dir);
  await restored.init();
  const rows = await restored.getMessages(chat);
  assert.deepEqual(rows.map((m) => m.seq), [1, 2]);
  assert.deepEqual(rows[0].parts, parts);
  assert.equal(rows[0].text, historical[0].text);
  const once = await readFile(restored.messagePath(chat), 'utf8');
  const again = new Store(dir);
  await again.init();
  assert.equal(await readFile(again.messagePath(chat), 'utf8'), once);
  assert.equal((await again.appendMessage(chat, { role: 'user', text: 'New' })).seq, 3);
});

test('journal failure leaves prior memory visible on disk and restart completes the same audited operation once', async (t) => {
  const { dir, memory } = await fixture(t);
  await memory.remember('team', { text: 'Old preference', key: 'preference' });
  const before = await readFile(memory.pathFor('team'), 'utf8');
  memory.log = async () => { throw unavailable(); };
  await assert.rejects(memory.remember('team', { text: 'New preference', key: 'preference' }),
    (error) => error.code === 'memory_pending' && error.details.retryable && Boolean(error.details.operationId));
  assert.equal(await readFile(memory.pathFor('team'), 'utf8'), before);
  await assert.rejects(memory.list('team'), { code: 'memory_pending' });
  const restored = new MemoryStore(dir);
  await restored.init();
  assert.equal((await restored.list('team'))[0].text, 'New preference');
  assert.equal((await restored.remember('team', { text: 'New preference', key: 'preference' })).unchanged, true);
  const rows = await journalRows(restored);
  assert.deepEqual(rows.map((row) => row.after), ['Old preference', 'New preference']);
  assert.equal(new Set(rows.map((row) => row.operationId)).size, 2);
  await assert.rejects(readFile(restored.pendingPath), { code: 'ENOENT' });
});

test('failure after journal commit recovers the document without a duplicate journal entry', async (t) => {
  const { dir, memory } = await fixture(t);
  await memory.remember('team', { text: 'Old', key: 'topic' });
  const before = await readFile(memory.pathFor('team'), 'utf8');
  const stagedPath = memory.stagedPath.bind(memory);
  let calls = 0;
  memory.stagedPath = (transaction) => ++calls === 1 ? stagedPath(transaction) : join(dir, 'missing', 'prepared');
  await assert.rejects(memory.remember('team', { text: 'Committed', key: 'topic' }), { code: 'memory_pending' });
  assert.equal(await readFile(memory.pathFor('team'), 'utf8'), before);
  const journal = await readFile(memory.journal, 'utf8');
  assert.equal((await journalRows(memory)).length, 2);
  const restored = new MemoryStore(dir);
  await restored.init();
  assert.equal((await restored.list('team'))[0].text, 'Committed');
  assert.equal(await readFile(restored.journal, 'utf8'), journal);
});

test('recovery after document publication and pending cleanup failure does not duplicate the audit', async (t) => {
  const { dir, memory } = await fixture(t);
  await memory.remember('team', { text: 'Before', key: 'topic' });
  const pendingPath = memory.pendingPath;
  const log = memory.log.bind(memory);
  memory.log = async (entry) => {
    await log(entry);
    memory.pendingPath = join(dir, 'missing', 'pending.json');
  };
  await assert.rejects(memory.remember('team', { text: 'Published', key: 'topic' }), { code: 'memory_pending' });
  assert.match(await readFile(memory.pathFor('team'), 'utf8'), /Published/);
  assert.ok(await readFile(pendingPath, 'utf8'));
  const journal = await readFile(memory.journal, 'utf8');
  const restored = new MemoryStore(dir);
  await restored.init();
  assert.equal((await restored.list('team'))[0].text, 'Published');
  assert.equal(await readFile(restored.journal, 'utf8'), journal);
  await assert.rejects(readFile(restored.pendingPath), { code: 'ENOENT' });
});

test('a torn journal append is preserved and recovery appends one complete receipt', async (t) => {
  const { dir, memory } = await fixture(t);
  await memory.remember('team', { text: 'First', key: 'first' });
  memory.log = async () => {
    await appendFile(memory.journal, '{"operationId":');
    throw unavailable();
  };
  await assert.rejects(memory.remember('team', { text: 'Second', key: 'second' }), { code: 'memory_pending' });
  const restored = new MemoryStore(dir);
  await restored.init();
  const raw = await readFile(restored.journal, 'utf8');
  assert.ok(raw.includes('\n{"operationId":\n'));
  assert.deepEqual((await restored.list('team')).map((entry) => entry.text), ['First', 'Second']);
  const valid = raw.trim().split('\n').flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
  assert.equal(valid.filter((entry) => entry.after === 'Second').length, 1);
});

test('a pending deletion recovers and the original deletion can be retried after restart', async (t) => {
  const { dir, memory } = await fixture(t);
  const saved = await memory.remember('team', { text: 'Remove this', key: 'remove' });
  memory.log = async () => { throw unavailable(); };
  await assert.rejects(memory.forget('team', saved.entry.id, 'User'), { code: 'memory_pending' });
  const restored = new MemoryStore(dir);
  await restored.init();
  const receipt = await restored.forget('team', saved.entry.id, 'User');
  assert.equal(receipt.id, saved.entry.id);
  assert.deepEqual(await restored.list('team'), []);
  assert.equal((await journalRows(restored)).filter((row) => row.op === 'remove').length, 1);
  await assert.rejects(restored.forget('team', 'deadbeef', 'User'), { code: 'memory_invalid' });
});

test('delivery transitions commit a complete batch or leave every message unchanged on disk failure', async (t) => {
  const { dir, store, chat } = await fixture(t);
  const first = await store.appendMessage(chat, { role: 'user', text: 'One', dispatchState: 'pending' });
  const second = await store.appendMessage(chat, { role: 'user', text: 'Two', dispatchState: 'pending' });
  const path = store.messagePath.bind(store);
  store.messagePath = () => join(dir, 'missing-parent', 'messages.json');
  await assert.rejects(store.updateMessages(chat, [first.id, second.id], { dispatchState: 'adjusting' }));
  assert.equal(first.dispatchState, 'pending');
  assert.equal(second.dispatchState, 'pending');
  store.messagePath = path;
  await store.updateMessages(chat, [first.id, second.id], { dispatchState: 'delivered' });
  const restored = new Store(dir); await restored.init();
  const saved = (await restored.getMessages(chat)).filter((message) => message.role === 'user');
  assert.deepEqual(saved.map((message) => message.dispatchState), ['delivered', 'delivered']);
  assert.deepEqual(saved.map((message) => message.dispatchRevision), [1, 1]);
});
