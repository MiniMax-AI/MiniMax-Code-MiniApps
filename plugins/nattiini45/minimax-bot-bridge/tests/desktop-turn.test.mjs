import assert from 'node:assert/strict';
import test from 'node:test';

import { desktopMessage, desktopTurn } from '../miniapp/node/desktop-turn.mjs';

/**
 * The desktop's own record of a turn.
 *
 * The shape is the one the desktop writes: one record for the whole turn, holding the
 * parts it drew — what the Bot said while it worked, which tools it used, and the
 * answer it ended with. The record's own text is only that answer.
 */
function record(overrides = {}) {
  return {
    id: 'msg_9b651f7988f2',
    chatId: 'bot:bot_b1',
    ts: 1793708397828,
    status: 'done',
    role: 'bot',
    botId: 'bot_b1',
    taskId: 'task_a5ffe76a214e',
    text: 'The answer.',
    parts: [
      { type: 'text', text: 'Working on it.' },
      { type: 'tool', name: 'bash', state: 'ok' },
      { type: 'tool', name: 'read', state: 'failed' },
      { type: 'text', text: 'The answer.' },
    ],
    ...overrides,
  };
}

test('every part the desktop draws as a bubble becomes a message', () => {
  const { messages } = desktopTurn(record());

  assert.equal(messages.length, 2);
  assert.equal(messages[0].messageId, 'msg_9b651f7988f2#p0');
  assert.equal(messages[0].text, 'Working on it.');
  assert.equal(messages[0].role, 'assistant');
  assert.equal(messages[0].authorId, 'bot_b1');
  assert.equal(messages[0].ts, 1793708397828);
});

test('the answer keeps the record’s own id, so a reaction still belongs to it', () => {
  const { messages } = desktopTurn(record());

  assert.equal(messages[1].messageId, 'msg_9b651f7988f2');
  assert.equal(messages[1].text, 'The answer.');
  // Every message of the turn carries the turn's own name.
  for (const message of messages) assert.equal(message.turnId, 'task_a5ffe76a214e');
});

test('a turn of eight narrations and fifty-seven tools keeps all of them', () => {
  const parts = [];
  for (let index = 0; index < 8; index += 1) parts.push({ type: 'text', text: `Narration ${index}.` });
  for (let index = 0; index < 57; index += 1) parts.push({ type: 'tool', name: 'bash', state: 'ok' });
  parts.push({ type: 'text', text: 'The answer.' });

  const { messages, activity } = desktopTurn(record({ parts }));

  assert.equal(messages.length, 9);
  assert.equal(activity.length, 57);
  assert.equal(messages[0].text, 'Narration 0.');
  assert.equal(messages[8].messageId, 'msg_9b651f7988f2');
  assert.equal(messages[8].text, 'The answer.');
  // The ids are unique, so no two parts can land on the same message.
  assert.equal(new Set(messages.map((message) => message.messageId)).size, messages.length);
  assert.equal(new Set(activity.map((entry) => entry.callId)).size, activity.length);
});

test('the tool calls of a turn carry their name and how they ended', () => {
  const { activity } = desktopTurn(record());

  assert.equal(activity.length, 2);
  assert.deepEqual(activity[0], {
    turnId: 'task_a5ffe76a214e',
    callId: 'msg_9b651f7988f2#t1',
    toolName: 'bash',
    status: 'ok',
  });
  assert.equal(activity[1].toolName, 'read');
  assert.equal(activity[1].status, 'failed');
});

test('a call the desktop never saw report back is not a failure', () => {
  const { activity } = desktopTurn(
    record({ parts: [{ type: 'tool', name: 'bash', state: 'unknown' }] }),
  );

  assert.equal(activity[0].status, 'unknown');
});

test('a call with no state is unknown rather than a guess', () => {
  const { activity } = desktopTurn(record({ parts: [{ type: 'tool', name: 'bash' }] }));

  assert.equal(activity[0].status, 'unknown');
});

test('the answer is the record’s own text even when no part holds it', () => {
  const { messages } = desktopTurn(
    record({ parts: [{ type: 'text', text: 'Working on it.' }], text: 'A different answer.' }),
  );

  assert.equal(messages.length, 2);
  assert.equal(messages[1].messageId, 'msg_9b651f7988f2');
  assert.equal(messages[1].text, 'A different answer.');
});

test('a record without parts still gives the answer', () => {
  const { messages, activity } = desktopTurn(record({ parts: undefined }));

  assert.equal(messages.length, 1);
  assert.equal(messages[0].messageId, 'msg_9b651f7988f2');
  assert.equal(messages[0].text, 'The answer.');
  assert.equal(activity.length, 0);
});

test('the desktop’s own bookkeeping is left out', () => {
  const { messages, activity } = desktopTurn(
    record({
      parts: [
        { type: 'event', kind: 'bot_created', botId: 'bot_b1' },
        { type: 'text', text: 'The answer.' },
      ],
    }),
  );

  assert.equal(messages.length, 1);
  assert.equal(activity.length, 0);
});

test('a part that holds nothing is left out, as the desktop leaves it out', () => {
  const { messages } = desktopTurn(
    record({ parts: [{ type: 'text', text: '   ' }, { type: 'text', text: 'The answer.' }] }),
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0].messageId, 'msg_9b651f7988f2');
});

test('a turn without a task is named after its own record', () => {
  const { messages } = desktopTurn(record({ taskId: undefined, parts: [{ type: 'text', text: 'Hi.' }] }));

  assert.equal(messages[0].turnId, 'msg_9b651f7988f2');
});

test('a message typed on the desktop is marked as coming from there', () => {
  const message = desktopMessage(
    { id: 'msg_typed', chatId: 'bot:bot_b1', ts: 10, role: 'user', text: 'Hello' },
    'bot:bot_b1',
  );

  assert.equal(message.role, 'user');
  assert.equal(message.origin, 'desktop');
});

test('a message that arrived from the phone is the user’s own', () => {
  const message = desktopMessage(
    { id: 'msg_task_1', chatId: 'bot:bot_b1', ts: 10, role: 'relay', fromName: 'the phone', text: 'Hello' },
    'bot:bot_b1',
  );

  assert.equal(message.role, 'user');
  assert.equal(message.origin, undefined);
});
