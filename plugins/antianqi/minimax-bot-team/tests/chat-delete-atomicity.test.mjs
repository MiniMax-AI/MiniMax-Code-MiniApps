// @ts-check
// Deleting a chat must not lose its messages when the state write fails.
//
// The transcript is the one thing that cannot be rebuilt, so the state that forgets the
// chat goes to disk first. A failed write then leaves the chat and its messages both as
// they were, and the caller can simply try again. This file fails if that order flips
// back: the failure injection below replaces state.json with a directory of the same name,
// so every write to it fails.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Store } from '../miniapp/node/store.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'bot-delete-chat-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  await store.init();
  return { dir, store, chat: store.chatIds()[0] };
}

test('a failed state write leaves the chat and its messages untouched', async (t) => {
  const { dir, store, chat } = await fixture(t);
  await store.appendMessage(chat, { role: 'user', text: 'the greeting' });
  await store.appendMessage(chat, { role: 'bot', text: 'the answer' });
  store.state.sessions[chat] = { sessionId: 's_1', stamp: 1, lastSeen: 1 };
  await store.save();
  // The store seeds a greeting of its own, so the count is read, never assumed.
  const before = (await store.getMessages(chat)).length;
  assert.ok(before >= 2, 'the chat has a transcript to lose');

  // The state file becomes a directory: every write to it fails.
  const statePath = join(dir, 'state.json');
  const saved = await readFile(statePath, 'utf8');
  await rm(statePath, { force: true });
  await mkdir(statePath, { recursive: true });

  await assert.rejects(() => store.deleteChat(chat));

  // The transcript is still on disk, and the live state still knows the chat.
  const onDisk = JSON.parse(await readFile(store.messagePath(chat), 'utf8'));
  assert.equal(onDisk.length, before, 'the messages are still on disk');
  assert.ok(store.state.sessions[chat], 'the live state still knows the chat');

  // Put the state file back and restart: the chat is still there with its messages.
  await rm(statePath, { recursive: true, force: true });
  await writeFile(statePath, saved, 'utf8');
  const restarted = new Store(dir);
  await restarted.init();
  const messages = await restarted.getMessages(chat);
  assert.equal(messages.length, before, 'the messages survive the restart');
  assert.ok(messages.some((message) => message.text === 'the greeting'), 'the greeting is still there');
  assert.ok(restarted.state.sessions[chat], 'the session survives the restart');
});

test('a delete that succeeds clears the transcript and forgets the chat', async (t) => {
  const { dir, store, chat } = await fixture(t);
  await store.appendMessage(chat, { role: 'user', text: 'the greeting' });
  await store.appendMessage(chat, { role: 'bot', text: 'the answer' });
  store.state.sessions[chat] = { sessionId: 's_1', stamp: 1, lastSeen: 1 };
  await store.save();

  await store.deleteChat(chat);

  assert.equal((await store.getMessages(chat)).length, 0, 'the transcript is empty');
  assert.equal(store.state.sessions[chat], undefined, 'the chat is forgotten');
  const restarted = new Store(dir);
  await restarted.init();
  assert.equal((await restarted.getMessages(chat)).length, 0, 'the transcript stays empty');
  assert.equal(restarted.state.sessions[chat], undefined, 'the chat stays forgotten');
});
