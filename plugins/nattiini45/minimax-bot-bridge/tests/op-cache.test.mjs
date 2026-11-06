import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Bridge } from '../miniapp/node/bridge.mjs';
import { createFakeTeam, TEAM_TOOL_DESCRIPTORS } from './fake-team.mjs';

/**
 * The operation cache.
 *
 * The bridge answers an operation once, even if the phone sends it twice: the result
 * is cached for ten minutes under a key built from the operation type and the
 * operation id. The key has to say which operation it is, or one frame poisons the
 * key for every other frame of its type.
 */

async function makeBridge() {
  const dataDir = await mkdtemp(join(tmpdir(), 'bridge-opcache-'));
  const sent = [];
  const team = createFakeTeam();
  /** The turns the team was asked to run. */
  const teamTurns = [];

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
        const result = await team.call(name, args);
        if (String(name).endsWith('message_bot')) teamTurns.push(args);
        return result;
      },
    },
    agent: {
      async run(input) {
        // A turn the bridge runs on the desktop.
        teamTurns.push(input);
        return { sessionId: 'sess-1', turnId: 'turn-1', status: 'finished', text: 'Hello' };
      },
      async reply() {},
      async answer() {
        return { sessionId: 'sess-1', status: 'finished' };
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
    teamTurns,
    async dispose() {
      bridge.stop();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

/** An operation frame as a phone sends it. */
function opFrame({ type = 'op.send_message', opId, from, payload = { chatId: 'bot:bot_b1', text: 'hello' } }) {
  const frame = { v: 1, id: opId, ts: Date.now(), type, source: 'app', payload };
  if (opId !== undefined) frame.opId = opId;
  if (from !== undefined) frame.from = from;
  return frame;
}

test('an operation without an id is refused instead of poisoning the cache', async () => {
  const { bridge, teamTurns, sent, dispose } = await makeBridge();
  try {
    // Neither an opId nor an id.
    await bridge.handleFrame({ v: 1, ts: Date.now(), type: 'op.send_message', source: 'app', payload: {} });

    // The operation did not run.
    assert.equal(teamTurns.length, 0);

    // And the cache holds no entry under a key that every later frame would share.
    assert.equal(bridge.opCache.size, 0);

    // The phone was told, rather than being left waiting.
    const errors = sent.filter((frame) => frame.type === 'err');
    assert.equal(errors.length, 1);
    assert.equal(errors[0].payload.code, 'INVALID_ARGUMENTS');
  } finally {
    await dispose();
  }
});

test('a later operation of the same type still runs', async () => {
  const { bridge, teamTurns, dispose } = await makeBridge();
  try {
    await bridge.handleFrame({ v: 1, ts: Date.now(), type: 'op.send_message', source: 'app', payload: {} });
    assert.equal(teamTurns.length, 0);

    await bridge.handleFrame(opFrame({ opId: 'op-1', from: 'phone_1' }));
    assert.equal(teamTurns.length, 1);
  } finally {
    await dispose();
  }
});

test('one device cannot swallow another device operation', async () => {
  const { bridge, teamTurns, dispose } = await makeBridge();
  try {
    // The same operation id, from two different phones.
    await bridge.handleFrame(opFrame({ opId: 'op-same', from: 'phone_1' }));
    await bridge.handleFrame(opFrame({ opId: 'op-same', from: 'phone_2' }));

    // Both ran. The second one is not answered with the first one's result.
    assert.equal(teamTurns.length, 2);
  } finally {
    await dispose();
  }
});

test('the same device repeating an operation still gets one answer', async () => {
  const { bridge, teamTurns, sent, dispose } = await makeBridge();
  try {
    await bridge.handleFrame(opFrame({ opId: 'op-1', from: 'phone_1' }));
    await bridge.handleFrame(opFrame({ opId: 'op-1', from: 'phone_1' }));

    // The operation ran once, and the phone was answered twice.
    assert.equal(teamTurns.length, 1);
    const acks = sent.filter((frame) => frame.type === 'ack');
    assert.equal(acks.length, 2);
  } finally {
    await dispose();
  }
});
