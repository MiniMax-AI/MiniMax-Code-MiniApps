import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Bridge } from '../miniapp/node/bridge.mjs';
import { createFakeTeam, TEAM_TOOL_DESCRIPTORS } from './fake-team.mjs';

/**
 * The state a client can make the bridge hold.
 *
 * Every map the bridge keeps is keyed by something a phone chose: a chat id, a message
 * id, an operation id. A phone that keeps inventing new ones makes the desktop's
 * memory grow, and the desktop is the one that pays for it. These tests pin the
 * ceilings.
 */

/**
 * @param {{agent?: boolean}} options
 */
async function makeBridge({ agent = false } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'bridge-bounds-'));
  const team = createFakeTeam({
    // A roster wide enough for a client that keeps inventing conversations.
    bots: Array.from({ length: 80 }, (_, index) => ({
      bot_id: `bot_${index}`,
      name: `Bot ${index}`,
      role: '',
      main: false,
      model: 'default',
      effort: 'default',
    })),
    resolveUnknown: true,
  });
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

  if (agent) {
    let counter = 0;
    context.agent = {
      async run() {
        counter += 1;
        return { sessionId: `sess-${counter}`, turnId: `turn-${counter}`, status: 'finished', text: 'Hello' };
      },
      async reply() {},
      async answer() {
        return { sessionId: 'sess-1', status: 'finished' };
      },
    };
  }

  const bridge = new Bridge(context, {
    config: { bridgeId: 'bridge-1', accountId: 'default', bridgeToken: '', relayUrl: '', bridgeName: 'Desk' },
    logger: context.logger,
  });
  bridge.relay.send = () => true;

  await bridge.start();

  return {
    bridge,
    async dispose() {
      bridge.stop();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

test('the bridge keeps a bounded number of reacted messages', async () => {
  const { bridge, dispose } = await makeBridge();
  try {
    for (let i = 0; i < 600; i += 1) {
      bridge.react({ messageId: `m${i}`, emoji: '👍' });
    }
    assert.equal(bridge.reactions.size, 500);
    // The oldest reaction is the one that goes: it is the one least likely to be read.
    assert.equal(bridge.reactions.has('m0'), false);
    assert.equal(bridge.reactions.has('m599'), true);
  } finally {
    await dispose();
  }
});

test('a reaction may not carry an unbounded emoji', async () => {
  const { bridge, dispose } = await makeBridge();
  try {
    // The emoji is stored verbatim and broadcast to every device in the room.
    assert.throws(() => bridge.react({ messageId: 'm1', emoji: 'x'.repeat(64) }), /emoji/i);
    // A short one still works.
    assert.equal(bridge.react({ messageId: 'm1', emoji: '👍' }).reaction.emoji, '👍');
  } finally {
    await dispose();
  }
});

test('the bridge keeps a bounded number of chat histories', async () => {
  const { bridge, dispose } = await makeBridge();
  try {
    for (let i = 0; i < 80; i += 1) {
      bridge.pushHistory(`chat-${i}`, {
        messageId: `m${i}`,
        chatId: `chat-${i}`,
        role: 'user',
        text: 'hi',
        ts: i,
      });
    }
    assert.equal(bridge.history.size, 50);
    assert.equal(bridge.history.has('chat-0'), false);
    assert.equal(bridge.history.has('chat-79'), true);
  } finally {
    await dispose();
  }
});

test('the operation dedupe cache is bounded', async () => {
  const { bridge, dispose } = await makeBridge();
  try {
    for (let i = 0; i < 600; i += 1) {
      await bridge.handleFrame({
        v: 1,
        id: `f${i}`,
        ts: Date.now(),
        type: 'op.list_history',
        source: 'app',
        payload: { chatId: 'c' },
        opId: `op-${i}`,
      });
    }
    // The time to live alone does not bound it: the key is built from an operation id
    // the client chose.
    assert.equal(bridge.opCache.size, 500);
  } finally {
    await dispose();
  }
});

test('the runner keeps a bounded number of Bot sessions', async () => {
  const { bridge, dispose } = await makeBridge({ agent: true });
  try {
    // The team owns the conversations; the bridge only remembers which session
    // answered last, and the chat id is chosen by the phone.
    for (let i = 0; i < 80; i += 1) {
      await bridge.runner.run({ chatId: `bot:bot_${i}`, text: 'hi' });
    }
    assert.equal(bridge.runner.sessions.size, 50);
  } finally {
    await dispose();
  }
});
