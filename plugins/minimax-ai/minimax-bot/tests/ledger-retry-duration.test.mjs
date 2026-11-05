// @ts-check
// What the usage ledger says about a turn that had to be retried.
//
// The ledger records what the model really did. A retried turn waits between the attempts (the
// backoff), and that wait is not the model's time: it used to be counted as such, so a turn
// that waited half a minute between two attempts was written down as a turn of half a minute
// while the model had run for a fraction of a second — and the panel averaged that up. The
// duration is now the time the model really ran, and the wait is written down on its own.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

import { Store } from '../miniapp/node/store.mjs';
import { MemoryStore } from '../miniapp/node/memory.mjs';
import { Engine } from '../miniapp/node/engine.mjs';
import { start } from '../miniapp/node/server.mjs';
import { setLocale } from '../miniapp/node/i18n.mjs';

test('the ledger counts the time the model ran, not the wait between the attempts', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bot-ledger-duration-'));
  const store = new Store(dir);
  const memory = new MemoryStore(dir);
  await store.init();
  await memory.init();
  setLocale('en');
  const engine = new Engine({
    store, memory, logger: { warn() {} }, broadcast() {}, retryDelaysMs: [150, 150],
  });
  t.after(async () => {
    engine.dispose();
    await store.writeChain;
    await rm(dir, { recursive: true, force: true });
  });
  let calls = 0;
  /** How long the model really ran, measured by the model itself. */
  let modelMs = 0;
  engine.agent = {
    async run(input, options) {
      calls += 1;
      if (calls <= 2) {
        // A host that is not there yet: the turn is retried after a wait.
        throw Object.assign(new Error('Unavailable'), { code: 'AGENT_UNAVAILABLE', retryable: true });
      }
      const startedAt = Date.now();
      await new Promise((r) => setTimeout(r, 40));
      modelMs += Date.now() - startedAt;
      options.onEvent({ type: 'turn.started', sessionId: 's1' });
      return { sessionId: 's1', status: 'finished', text: 'Done' };
    },
  };
  const bot = store.state.bots[0];
  const wallStartedAt = Date.now();
  await engine.runBotTurn({ bot, chatId: `bot:${bot.id}`, text: 'Hello', kind: 'private' });
  const wallMs = Date.now() - wallStartedAt;
  await store.writeChain;

  const rows = await store.readUsage(0);
  assert.equal(rows.length, 1);
  const row = rows[0];
  // One turn, but the model was called three times.
  assert.equal(row.attempts, 3);
  // The duration is what the model really ran: it does not carry the two waits of 150 ms.
  assert.ok(
    row.durationMs >= modelMs - 20,
    `duration ${row.durationMs} is shorter than the ${modelMs} ms the model ran`,
  );
  assert.ok(
    wallMs - row.durationMs >= 250,
    `the turn took ${wallMs} ms and the ledger says ${row.durationMs} ms: the wait is still in it`,
  );
  // The wait is written down on its own.
  assert.ok(row.sleptMs >= 280, `sleptMs ${row.sleptMs} does not cover the two waits`);

  // The panel averages the same number, so it does not show the waiting time either.
  const probe = createServer();
  await new Promise((done) => probe.listen(0, '127.0.0.1', done));
  const port = probe.address().port;
  await new Promise((done) => probe.close(done));
  const app = await start({
    pluginRoot: resolve(import.meta.dirname, '..'),
    dataDir: dir,
    listen: { host: '127.0.0.1', port },
    signal: new AbortController().signal,
    logger: { info() {}, warn() {}, error() {} },
  });
  t.after(async () => { await app.dispose(); });
  const usage = await (await fetch(`http://127.0.0.1:${port}/api/usage?days=1`)).json();
  assert.equal(usage.totals.turns, 1);
  assert.equal(usage.totals.modelCalls, 3, 'the model really ran three times');
  // The panel shows what the ledger says, and that is not the waiting time either.
  assert.equal(usage.totals.avgDurationMs, row.durationMs, 'the panel shows what the ledger says');
  assert.ok(
    wallMs - usage.totals.avgDurationMs >= 250,
    `the panel averages ${usage.totals.avgDurationMs} ms, which is the wait and not the model`,
  );
});

test('a turn the model never ran has no duration and stays out of the average', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bot-ledger-no-model-'));
  const store = new Store(dir);
  const memory = new MemoryStore(dir);
  await store.init();
  await memory.init();
  setLocale('en');
  const engine = new Engine({
    store, memory, logger: { warn() {} }, broadcast() {}, retryDelaysMs: [],
  });
  t.after(async () => {
    engine.dispose();
    await store.writeChain;
    await rm(dir, { recursive: true, force: true });
  });
  const bot = store.state.bots[0];
  const chatId = `bot:${bot.id}`;
  let called = 0;
  engine.agent = { async run() { called += 1; return { sessionId: 's1', status: 'finished', text: 'ok' }; } };
  // The turn is stopped after the Bot's message is written but before the model is called.
  const appendMessage = store.appendMessage.bind(store);
  store.appendMessage = async (chat, message) => {
    const written = await appendMessage(chat, message);
    if (chat === chatId && message.role === 'bot') engine.cancelChat(chatId);
    return written;
  };
  await engine.runBotTurn({ bot, chatId, text: 'Hello', kind: 'private' });
  await store.writeChain;
  assert.equal(called, 0, 'the model was never called');

  const rows = await store.readUsage(0);
  assert.equal(rows.length, 1);
  // The turn is on the ledger, but it has no duration: it never ran the model.
  assert.equal(rows[0].durationMs, null);
  assert.equal(rows[0].attempts, 0);

  // The panel leaves it out of the average instead of counting it as zero seconds.
  const probe = createServer();
  await new Promise((done) => probe.listen(0, '127.0.0.1', done));
  const port = probe.address().port;
  await new Promise((done) => probe.close(done));
  const app = await start({
    pluginRoot: resolve(import.meta.dirname, '..'),
    dataDir: dir,
    listen: { host: '127.0.0.1', port },
    signal: new AbortController().signal,
    logger: { info() {}, warn() {}, error() {} },
  });
  t.after(async () => { await app.dispose(); });
  const usage = await (await fetch(`http://127.0.0.1:${port}/api/usage?days=1`)).json();
  assert.equal(usage.totals.turns, 1, 'the turn is still a turn');
  assert.equal(usage.totals.durationSamples, 0, 'a turn without a duration is not averaged');
  assert.equal(usage.totals.avgDurationMs, null, 'the panel does not show a zero-second average');
});
