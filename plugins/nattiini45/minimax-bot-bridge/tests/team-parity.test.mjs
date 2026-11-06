import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Bridge } from '../miniapp/node/bridge.mjs';
import { TEAM_TOOL_DESCRIPTORS, createFakeTeam } from './fake-team.mjs';

/**
 * The desktop's own record of a turn.
 *
 * The shape is the one the desktop writes: one record for the whole turn, holding what
 * the Bot said while it worked, which tools it used, and the answer it ended with.
 */
function desktopTurnRecord() {
  return {
    id: 'msg_reply_1',
    chatId: 'bot:bot_b1',
    ts: 1_793_708_397_828,
    status: 'done',
    role: 'bot',
    botId: 'bot_b1',
    taskId: 'task_1',
    text: 'The answer.',
    parts: [
      { type: 'text', text: 'Working on it.' },
      { type: 'tool', name: 'bash', state: 'ok' },
      { type: 'tool', name: 'read', state: 'failed' },
      { type: 'text', text: 'The answer.' },
    ],
  };
}

/**
 * A bridge on a desktop that holds one conversation.
 *
 * The runtime keeps one directory per Mini App, so the bridge's data and the Bot app's
 * data are siblings under one root, and the conversation is a file of its own.
 *
 * @param {{ records?: Array<object>, replies?: Record<string, string> }} options
 */
async function makeBridge({ records = [desktopTurnRecord()], replies = { bot_b1: 'The answer.' } } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'bridge-parity-'));
  const dataDir = join(root, 'plugin-data', 'liveboards', 'minimax-bot-bridge');
  const botDir = join(root, 'plugin-data', 'liveboards', 'minimax-bot');
  await mkdir(dataDir, { recursive: true });
  await mkdir(join(botDir, 'messages'), { recursive: true });
  await writeFile(
    join(botDir, 'state.json'),
    JSON.stringify({
      bots: [{ id: 'bot_b1', name: 'Writer', role: 'Drafting', isMain: true }],
      groups: [],
      sessions: {},
    }),
    'utf8',
  );
  await writeFile(join(botDir, 'messages', 'bot_bot_b1.json'), JSON.stringify(records), 'utf8');

  const team = createFakeTeam({ replies });
  const sent = [];
  const context = {
    pluginId: 'minimax-bot-bridge',
    pluginRoot: '.',
    dataDir,
    listen: { host: '127.0.0.1', port: 0 },
    signal: new AbortController().signal,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    tool: {
      async list() {
        return { tools: TEAM_TOOL_DESCRIPTORS, partial: false };
      },
      async call(name, args) {
        return team.call(name, args);
      },
    },
  };

  const bridge = new Bridge(context, {
    config: { bridgeId: 'bridge-1', accountId: 'default', bridgeToken: '', relayUrl: '', bridgeName: 'Desk' },
    logger: context.logger,
  });
  bridge.relay.send = (frame) => {
    sent.push(frame);
    return true;
  };
  await bridge.start();

  return {
    bridge,
    sent,
    events: (type) => sent.filter((frame) => frame.type === type).map((frame) => frame.payload),
    async dispose() {
      bridge.stop();
      await rm(root, { recursive: true, force: true });
    },
  };
}

/**
 * The messages a set of frames committed, in the order they were committed.
 *
 * @param {any[]} frames the payloads of `evt.message_committed`
 */
function committed(frames) {
  return frames.map((payload) => payload.message);
}

test('a team turn publishes the whole exchange the desktop recorded', async () => {
  const { bridge, events, dispose } = await makeBridge();

  await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'Do the thing' });

  const messages = committed(events('evt.message_committed')).filter((message) => message.role === 'assistant');
  assert.equal(messages.length, 2);
  assert.equal(messages[0].messageId, 'msg_reply_1#p0');
  assert.equal(messages[0].text, 'Working on it.');
  assert.equal(messages[1].messageId, 'msg_reply_1');
  assert.equal(messages[1].text, 'The answer.');
  await dispose();
});

test('the tool calls of a team turn are published as calls', async () => {
  const { bridge, events, dispose } = await makeBridge();

  await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'Do the thing' });

  const started = events('evt.tool_started');
  const finished = events('evt.tool_finished');
  assert.equal(started.length, 2);
  assert.equal(finished.length, 2);
  assert.equal(started[0].toolName, 'bash');
  assert.equal(started[0].callId, 'msg_reply_1#t1');
  assert.equal(finished[0].ok, true);
  assert.equal(finished[1].ok, false);
  await dispose();
});

test('everything a team turn publishes belongs to the same turn', async () => {
  const { bridge, events, dispose } = await makeBridge();

  await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'Do the thing' });

  const turnId = events('evt.turn_started')[0].turnId;
  for (const message of committed(events('evt.message_committed'))) {
    if (message.role === 'assistant') assert.equal(message.turnId, turnId);
  }
  for (const event of events('evt.tool_started')) assert.equal(event.turnId, turnId);
  for (const event of events('evt.tool_finished')) assert.equal(event.turnId, turnId);
  await dispose();
});

test('a turn says when it started, so the phone can show how long it runs', async () => {
  const { bridge, events, dispose } = await makeBridge();

  await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'Do the thing' });

  const started = events('evt.turn_started')[0];
  assert.equal(typeof started.startedAt, 'number');
  assert.ok(started.startedAt > 0);
  await dispose();
});

test('the thread a phone reads back is the thread it was shown', async () => {
  const { bridge, events, dispose } = await makeBridge();

  await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'Do the thing' });
  const shown = committed(events('evt.message_committed')).filter((message) => message.role === 'assistant');

  const history = /** @type {any} */ (await bridge.dispatch('op.list_history', { chatId: 'bot:bot_b1' }));
  const read = history.messages.filter((message) => message.role === 'assistant');

  assert.deepEqual(
    read.map((message) => message.messageId),
    shown.map((message) => message.messageId),
  );
  assert.deepEqual(
    read.map((message) => message.text),
    shown.map((message) => message.text),
  );
  await dispose();
});

test('the calls a phone reads back are the calls it was shown', async () => {
  const { bridge, events, dispose } = await makeBridge();

  await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'Do the thing' });
  const shown = events('evt.tool_started').map((event) => event.callId);

  const history = /** @type {any} */ (await bridge.dispatch('op.list_history', { chatId: 'bot:bot_b1' }));

  assert.deepEqual(
    history.activity.map((entry) => entry.callId),
    shown,
  );
  assert.equal(history.activity[0].toolName, 'bash');
  await dispose();
});

test('a team turn is not streamed, because there is nothing to stream', async () => {
  const { bridge, events, dispose } = await makeBridge();

  await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'Do the thing' });

  assert.equal(events('evt.message_chunk').length, 0);
  await dispose();
});

test('an answer is still given when the desktop’s record cannot be read', async () => {
  const { bridge, events, dispose } = await makeBridge({ records: [] });

  await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'Do the thing' });

  const messages = committed(events('evt.message_committed')).filter((message) => message.role === 'assistant');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, 'The answer.');
  // The turn still ends, so the phone is not left waiting for an answer that never
  // comes.
  assert.equal(events('evt.turn_finished').length, 1);
  await dispose();
});

test('a message typed on the desktop is marked as coming from there', async () => {
  const { bridge, dispose } = await makeBridge({
    records: [
      {
        id: 'msg_typed',
        chatId: 'bot:bot_b1',
        ts: 10,
        status: 'done',
        role: 'user',
        text: 'Typed on the desktop',
      },
    ],
  });

  const history = /** @type {any} */ (await bridge.dispatch('op.list_history', { chatId: 'bot:bot_b1' }));

  assert.equal(history.messages[0].origin, 'desktop');
  assert.equal(history.messages[0].role, 'user');
  await dispose();
});

test('a turn that used many tools keeps every one of them', async () => {
  // A real turn of the desktop's own engine used fifty-seven tools. A limit that
  // counts calls rather than turns would drop the turn itself, and the phone would
  // show the answer with none of the work behind it.
  const tools = Array.from({ length: 57 }, () => ({ type: 'tool', name: 'bash', state: 'ok' }));
  const { bridge, dispose } = await makeBridge({
    records: [
      {
        ...desktopTurnRecord(),
        parts: [{ type: 'text', text: 'Working on it.' }, ...tools, { type: 'text', text: 'The answer.' }],
      },
    ],
  });

  const history = /** @type {any} */ (await bridge.dispatch('op.list_history', { chatId: 'bot:bot_b1' }));

  assert.equal(history.activity.length, 57);
  assert.equal(history.activity[0].turnId, 'task_1');
  assert.equal(history.activity[0].toolName, 'bash');
  await dispose();
});

test('the calls of a turn the thread does not show are not sent', async () => {
  // A call whose turn has no messages is a call of a turn the reader cannot see.
  const { bridge, dispose } = await makeBridge({ records: [] });

  bridge.history.set('bot:bot_b1', [
    { messageId: 'm1', chatId: 'bot:bot_b1', role: 'assistant', text: 'Hello.', ts: 1, turnId: 'task_1' },
  ]);
  bridge.activity.set('bot:bot_b1', [
    { turnId: 'task_gone', callId: 'call_gone', toolName: 'bash', status: 'ok' },
    { turnId: 'task_1', callId: 'call_1', toolName: 'read', status: 'ok' },
  ]);

  const history = /** @type {any} */ (await bridge.dispatch('op.list_history', { chatId: 'bot:bot_b1' }));

  assert.deepEqual(
    history.activity.map((entry) => entry.callId),
    ['call_1'],
  );
  await dispose();
});
