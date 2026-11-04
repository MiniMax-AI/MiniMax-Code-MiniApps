import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Bridge } from '../miniapp/node/bridge.mjs';

/**
 * What the room is told when something goes wrong.
 *
 * The diagnostics travel with the team snapshot to every phone in the account. The
 * Host's own error text can name internal paths, tool identifiers and host-side detail
 * that the phone's users did not need to see, so the room gets a fixed sentence and the
 * desktop keeps the detail.
 */

const SECRET = '/Users/local-user/.minimax/plugins/minimax-bot-bridge/tools.json';

/**
 * @param {{toolList?: () => Promise<unknown>, toolCall?: () => Promise<unknown>}} options
 */
async function makeBridge({ toolList, toolCall } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'bridge-errors-'));
  const sent = [];
  const logged = [];

  const context = {
    pluginId: 'minimax-bot-bridge',
    pluginRoot: '.',
    dataDir,
    listen: { host: '127.0.0.1', port: 0 },
    signal: new AbortController().signal,
    logger: {
      info() {},
      warn(message, detail) {
        logged.push({ message, detail });
      },
      error() {},
      debug() {},
    },
    tool: {
      async list() {
        if (toolList) return toolList();
        return { tools: [], partial: false };
      },
      async call() {
        if (toolCall) return toolCall();
        return { kind: 'mcp', isError: false, content: [] };
      },
    },
    agent: {
      async run() {
        return { sessionId: 'sess-1', turnId: 'turn-1', status: 'finished' };
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
  sent.length = 0;

  return {
    bridge,
    sent,
    logged,
    async dispose() {
      bridge.stop();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

/** Every piece of text in a frame, as one string. */
function frameText(frame) {
  return JSON.stringify(frame);
}

test('the room is told a sentence, not the Host error text', async () => {
  const { bridge, sent, logged, dispose } = await makeBridge({
    toolList: async () => {
      throw new Error(`cannot read ${SECRET}: mcp__minimax-bot__message_bot is not registered`);
    },
  });
  try {
    await bridge.tools.refresh();

    // The room's diagnostics carry a sentence.
    const reason = bridge.diagnostics().reason;
    assert.ok(reason);
    assert.equal(reason.includes('mcp__minimax-bot'), false);
    assert.equal(reason.includes(SECRET), false);

    // The desktop keeps the detail.
    assert.equal(bridge.desktopDiagnostics().detail.includes(SECRET), true);
    // And it was written down on the desktop.
    assert.ok(logged.some((entry) => JSON.stringify(entry).includes(SECRET)));

    // And nothing that goes to the room carries it.
    for (const frame of sent) {
      assert.equal(frameText(frame).includes(SECRET), false);
      assert.equal(frameText(frame).includes('mcp__minimax-bot'), false);
    }
  } finally {
    await dispose();
  }
});

test('a roster that cannot be read is a sentence to the room as well', async () => {
  const { bridge, sent, logged, dispose } = await makeBridge();
  try {
    // The roster cannot be read.
    bridge.readTeam = async () => {
      throw new Error(`team tool failed: ${SECRET} is not readable`);
    };

    await bridge.publishTeamSnapshot();

    const reason = bridge.diagnostics().reason;
    assert.ok(reason);
    assert.equal(reason.includes(SECRET), false);

    assert.equal(bridge.desktopDiagnostics().detail.includes(SECRET), true);
    assert.ok(logged.some((entry) => JSON.stringify(entry).includes(SECRET)));

    for (const frame of sent) {
      assert.equal(frameText(frame).includes(SECRET), false);
    }
  } finally {
    await dispose();
  }
});

test('direct roster request exceptions stay on the desktop for Error and non-Error failures', async (t) => {
  for (const failure of [new Error(`cannot read ${SECRET}`), `cannot read ${SECRET}`]) {
    await t.test(typeof failure, async () => {
      const { bridge, sent, logged, dispose } = await makeBridge({
        toolList: async () => ({ tools: [{ name: 'mcp__minimax-bot__list_team', server: 'minimax-bot', tool: 'list_team' }] }),
        toolCall: async () => { throw failure; },
      });
      try {
        const request = { type: 'op.list_team', id: 'roster-frame', opId: 'roster-op', from: 'phone-1', payload: {} };
        await Promise.all([bridge.handleFrame(request), bridge.handleFrame(request)]);
        assert.equal(sent.filter(frame => frame.type === 'err').length, 2);
        for (const frame of sent) {
          assert.equal(frameText(frame).includes(SECRET), false);
        }
        assert.ok(logged.some(entry => JSON.stringify(entry).includes(SECRET)));
        assert.equal(bridge.desktopDiagnostics().detail.includes(SECRET), true);
      } finally {
        await dispose();
      }
    });
  }
});

test('an unavailable roster rejects with a fixed public error, never an empty successful roster', async () => {
  const { bridge, sent, logged, dispose } = await makeBridge({
    toolList: async () => {
      throw new Error(`cannot read ${SECRET}`);
    },
  });
  const message = 'The team roster could not be read. Open MiniMax Bot on this desktop to try again.';
  try {
    await assert.rejects(() => bridge.dispatch('op.list_team', {}), error => {
      const publicError = /** @type {any} */ (error);
      assert.equal(publicError.code, 'TEAM_ROSTER_UNREADABLE');
      assert.equal(publicError.message, message);
      // Error.message is not enumerable: serialize the actual public fields,
      // rather than accepting a vacuous JSON.stringify(Error) === '{}'.
      assert.equal(JSON.stringify({ code: publicError.code, message: publicError.message, details: publicError.details }).includes(SECRET), false);
      return true;
    });
    assert.equal(bridge.diagnostics().reason, message);
    // The catalogue failure remains in the desktop's private tool diagnostic and
    // log even though the public roster failure has its own fixed sentence.
    assert.equal(bridge.tools.detail.includes(SECRET), true);
    assert.ok(logged.some(entry => JSON.stringify(entry).includes(SECRET)));

    await bridge.handleFrame({ type: 'op.list_team', id: 'unavailable-frame', opId: 'unavailable-op', from: 'phone-1', payload: {} });
    const failures = sent.filter(frame => frame.type === 'err');
    assert.equal(failures.length, 1);
    assert.deepEqual(failures[0].payload, {
      opId: 'unavailable-op', code: 'TEAM_ROSTER_UNREADABLE', message, retryable: false,
    });
    assert.equal(sent.some(frame => frame.type === 'ack' || frame.type === 'evt.team_snapshot'), false);
    assert.equal(JSON.stringify(sent).includes(SECRET), false);
    assert.equal(JSON.stringify(bridge.diagnostics()).includes(SECRET), false);
  } finally {
    await dispose();
  }
});
