import assert from 'node:assert/strict';
import test from 'node:test';

import { Bridge } from '../miniapp/node/bridge.mjs';

const chatId = 'bot:bot_b1';

function makeBridge() {
  const bridge = new Bridge({
    dataDir: '.',
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
  // No runtime, disk writes, or relay connection is needed for in-memory retention.
  bridge.runModeFor = () => 'hosted';
  bridge.relay.send = () => true;
  return bridge;
}

function message(bridge, chat, turnId, ts = 0) {
  bridge.pushHistory(chat, { messageId: `msg_${turnId}`, chatId: chat, turnId, role: 'assistant', text: 'Done', ts });
}

function calls(bridge, chat, turnId, count, { finish = true } = {}) {
  for (let index = 0; index < count; index += 1) {
    const payload = { chatId: chat, turnId, callId: `${turnId}:${index}`, toolName: 'bash' };
    bridge.handleEvent('evt.tool_started', payload);
    if (finish) bridge.handleEvent('evt.tool_finished', { ...payload, ok: true });
  }
}

function turns(bridge, chat = chatId) {
  return [...new Set((bridge.activity.get(chat) ?? []).map((entry) => entry.turnId))];
}

test('stored activity drops whole oldest turns without waiting for a history read', () => {
  const bridge = makeBridge();
  for (let index = 1; index <= 3; index += 1) {
    message(bridge, chatId, `turn_${index}`, index);
    calls(bridge, chatId, `turn_${index}`, 160);
  }

  assert.equal(bridge.activity.get(chatId).length, 320);
  assert.deepEqual(turns(bridge), ['turn_2', 'turn_3']);
});

test('the newest oversized turn is retained whole, not sliced at the soft target', () => {
  const bridge = makeBridge();
  calls(bridge, chatId, 'old', 20);
  calls(bridge, chatId, 'newest', 450);

  assert.equal(bridge.activity.get(chatId).length, 450);
  assert.deepEqual(turns(bridge), ['newest']);
});

test('running turns stay whole above the target and are trimmed once they finish', () => {
  const bridge = makeBridge();
  const controller = new AbortController();
  bridge.runner.handleAgentEvent(chatId, { type: 'turn.started', turnId: 'running' }, controller);
  calls(bridge, chatId, 'running', 450);
  // All current tools finished, but the turn itself is still running.
  calls(bridge, chatId, 'newest', 450);

  assert.equal(bridge.activity.get(chatId).length, 900);
  bridge.runner.handleAgentEvent(chatId, { type: 'turn.finished', turnId: 'running', status: 'finished' }, controller);

  assert.equal(bridge.activity.get(chatId).length, 450);
  assert.deepEqual(turns(bridge), ['newest']);
});

test('history readback preserves the same running turns as stored activity', () => {
  const bridge = makeBridge();
  const controller = new AbortController();
  message(bridge, chatId, 'running', 1);
  bridge.runner.handleAgentEvent(chatId, { type: 'turn.started', turnId: 'running' }, controller);
  calls(bridge, chatId, 'running', 450);
  message(bridge, chatId, 'newest', 2);
  calls(bridge, chatId, 'newest', 450);

  const read = bridge.trimActivity(bridge.activity.get(chatId), bridge.history.get(chatId));

  assert.equal(read.length, 900);
  assert.deepEqual(read, bridge.activity.get(chatId));
});

test('a tool that never reports back is not pinned forever after its turn ends', () => {
  const bridge = makeBridge();
  calls(bridge, chatId, 'unfinished', 450, { finish: false });
  calls(bridge, chatId, 'newest', 450);
  assert.equal(bridge.activity.get(chatId).length, 900);

  bridge.handleEvent('evt.turn_finished', { chatId, turnId: 'unfinished', status: 'error' });

  assert.equal(bridge.activity.get(chatId).length, 450);
  assert.deepEqual(turns(bridge), ['newest']);
});

test('activity is evicted together with its chat history', () => {
  const bridge = makeBridge();
  for (let index = 0; index < 60; index += 1) {
    const chat = `bot:bot_${index}`;
    message(bridge, chat, `turn_${index}`);
    calls(bridge, chat, `turn_${index}`, 1);
  }

  assert.equal(bridge.history.size, 50);
  assert.equal(bridge.activity.size, 50);
  assert.deepEqual([...bridge.activity.keys()], [...bridge.history.keys()]);
  assert.equal(bridge.activity.has('bot:bot_0'), false);
});

test('activity-only chats share the same tracked-chat ceiling as history-only chats', () => {
  const bridge = makeBridge();
  for (let index = 0; index < 30; index += 1) {
    message(bridge, `bot:history_${index}`, `history_${index}`);
  }
  for (let index = 0; index < 60; index += 1) {
    calls(bridge, `bot:activity_${index}`, `activity_${index}`, 1);
  }

  const known = new Set([...bridge.history.keys(), ...bridge.activity.keys()]);
  assert.equal(known.size, 50);
  assert.equal(bridge.activity.has('bot:activity_0'), false);
  assert.equal(bridge.activity.has('bot:activity_59'), true);
});

test('chat eviction preserves an older running conversation over settled chats', () => {
  const bridge = makeBridge();
  const controller = new AbortController();
  message(bridge, chatId, 'running');
  bridge.runner.handleAgentEvent(chatId, { type: 'turn.started', turnId: 'running' }, controller);
  calls(bridge, chatId, 'running', 1);
  for (let index = 0; index < 60; index += 1) {
    message(bridge, `bot:other_${index}`, `other_${index}`);
    calls(bridge, `bot:other_${index}`, `other_${index}`, 1);
  }

  assert.equal(bridge.history.size, 50);
  assert.equal(bridge.history.has(chatId), true);
  assert.equal(bridge.activity.has(chatId), true);
  assert.deepEqual(turns(bridge), ['running']);
});

test('ending a turn settles missing tool finishes without changing reported successes', () => {
  const bridge = makeBridge();
  calls(bridge, chatId, 'turn_1', 1);
  bridge.handleEvent('evt.tool_started', { chatId, turnId: 'turn_1', callId: 'missing', toolName: 'read' });

  bridge.handleEvent('evt.turn_finished', { chatId, turnId: 'turn_1', status: 'finished' });

  assert.deepEqual(bridge.activity.get(chatId).map((entry) => entry.status), ['ok', 'unknown']);
});
