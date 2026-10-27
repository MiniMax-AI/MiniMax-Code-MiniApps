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

// A background job is an Agent turn like any other: it runs on the same model, spends the same
// time and calls the same tools. The usage ledger must say so, or the panel counts fewer turns
// than the model actually ran.

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function until(predicate) {
  for (let i = 0; i < 400; i += 1) {
    if (await predicate()) return;
    await new Promise((done) => setTimeout(done, 5));
  }
  throw new Error('The expected state did not arrive');
}

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'bot-helper-usage-'));
  const store = new Store(dir);
  const memory = new MemoryStore(dir);
  await store.init();
  await memory.init();
  setLocale('en');
  const engine = new Engine({ store, memory, logger: { warn() {} }, broadcast() {}, retryDelaysMs: [] });
  t.after(async () => {
    engine.dispose();
    await until(() => engine.running.size === 0 && engine.helperRuns.size === 0);
    await store.writeChain;
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, store, memory, engine };
}

const HELPER_PROMPT = '<minimax-bot-helper>';

test('a background job\'s own turn is metered like every other turn', async (t) => {
  const { store, engine } = await fixture(t);
  const bot = { id: 'bot_a', name: 'Alice', role: 'Writer' };
  store.state.bots = [bot];
  const chatId = `bot:${bot.id}`;
  const helperDone = deferred();
  const calls = [];
  engine.agent = { async run(input, options) {
    calls.push(input.text);
    const ids = { sessionId: `session-${calls.length}`, turnId: `turn-${calls.length}` };
    options.onEvent({ type: 'turn.started', ...ids });
    if (input.text.startsWith(HELPER_PROMPT)) {
      options.onEvent({ type: 'tool.started', name: 'read_file' });
      options.onEvent({ type: 'tool.started', name: 'read_file' });
      options.onEvent({ type: 'tool.finished', name: 'read_file', ok: true });
      options.onEvent({ type: 'tool.finished', name: 'read_file', ok: true });
      await helperDone.promise;
      return { ...ids, status: 'finished', text: 'BACKGROUND_ANSWER' };
    }
    if (input.text.endsWith('START_BACKGROUND')) {
      await engine.startHelper(bot, { task: 'Look this up' });
      return { ...ids, status: 'finished', text: 'Started' };
    }
    return { ...ids, status: 'finished', text: 'Relay' };
  } };
  const turn = engine.runBotTurn({ bot, chatId, text: 'START_BACKGROUND', kind: 'private' });
  await turn;
  helperDone.resolve();
  await until(async () => (await store.readUsage(0)).length === 3);
  const rows = await store.readUsage(0);
  // Three model calls: the user's turn, the background job's turn and the turn that relays it.
  assert.equal(calls.length, 3);
  assert.equal(rows.length, calls.length);
  const background = rows.find((row) => row.kind === 'helper-run');
  assert.ok(background, 'the background job left no row in the ledger');
  assert.equal(background.botId, bot.id);
  assert.equal(background.chatId, chatId);
  assert.equal(background.status, 'done');
  assert.equal(background.tools, 2);
  assert.equal(background.chars, 'BACKGROUND_ANSWER'.length);
  assert.ok(background.durationMs >= 0);
  assert.ok(Number.isFinite(background.ts));
});

test('a background job that failed is metered as an error, not as a missing turn', async (t) => {
  const { store, engine } = await fixture(t);
  const bot = { id: 'bot_a', name: 'Alice', role: 'Writer' };
  store.state.bots = [bot];
  const chatId = `bot:${bot.id}`;
  const calls = [];
  engine.agent = { async run(input, options) {
    calls.push(input.text);
    const ids = { sessionId: `session-${calls.length}`, turnId: `turn-${calls.length}` };
    options.onEvent({ type: 'turn.started', ...ids });
    if (input.text.startsWith(HELPER_PROMPT)) throw new Error('The Agent turn failed.');
    if (input.text.endsWith('START_BACKGROUND')) {
      await engine.startHelper(bot, { task: 'Look this up' });
      return { ...ids, status: 'finished', text: 'Started' };
    }
    return { ...ids, status: 'finished', text: 'Relay' };
  } };
  await engine.runBotTurn({ bot, chatId, text: 'START_BACKGROUND', kind: 'private' });
  await until(async () => (await store.readUsage(0)).length === 3);
  const rows = await store.readUsage(0);
  const background = rows.find((row) => row.kind === 'helper-run');
  assert.ok(background);
  assert.equal(background.status, 'error');
  assert.equal(background.chars, 0);
  assert.equal(background.tools, 0);
  assert.equal(rows.length, calls.length);
});

test('a background job that was stopped is metered as aborted, and it relays nothing', async (t) => {
  const { store, engine } = await fixture(t);
  const bot = { id: 'bot_a', name: 'Alice', role: 'Writer' };
  store.state.bots = [bot];
  const chatId = `bot:${bot.id}`;
  const helperDone = deferred();
  const calls = [];
  engine.agent = { async run(input, options) {
    calls.push(input.text);
    const ids = { sessionId: `session-${calls.length}`, turnId: `turn-${calls.length}` };
    options.onEvent({ type: 'turn.started', ...ids });
    if (input.text.startsWith(HELPER_PROMPT)) {
      await helperDone.promise;
      return { ...ids, status: 'finished', text: 'BACKGROUND_ANSWER' };
    }
    if (input.text.endsWith('START_BACKGROUND')) {
      await engine.startHelper(bot, { task: 'Look this up' });
      return { ...ids, status: 'finished', text: 'Started' };
    }
    return { ...ids, status: 'finished', text: 'Relay' };
  } };
  await engine.runBotTurn({ bot, chatId, text: 'START_BACKGROUND', kind: 'private' });
  await until(() => store.state.helpers[0]?.status === 'running');
  engine.stopHelper(null, store.state.helpers[0].id);
  helperDone.resolve();
  await until(async () => (await store.readUsage(0)).length === 2);
  const rows = await store.readUsage(0);
  const background = rows.find((row) => row.kind === 'helper-run');
  assert.ok(background);
  assert.equal(background.status, 'aborted');
  // A stopped job relays nothing, so no third turn ran and no third row exists.
  assert.equal(calls.length, 2);
  assert.equal(rows.length, 2);
});

test('the usage panel counts every model call, background jobs included', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bot-helper-usage-http-'));
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const helperDone = deferred();
  const botTurnDone = deferred();
  const calls = [];
  let base = '';
  const agent = { async run(input, options) {
    calls.push(input.text);
    const ids = { sessionId: `session-${calls.length}`, turnId: `turn-${calls.length}` };
    options.onEvent({ type: 'turn.started', ...ids });
    if (input.text.startsWith(HELPER_PROMPT)) {
      options.onEvent({ type: 'tool.started', name: 'read_file' });
      await helperDone.promise;
      return { ...ids, status: 'finished', text: 'BACKGROUND_ANSWER' };
    }
    if (input.text.endsWith('START_BACKGROUND')) {
      const reply = await fetch(`${base}/mcp/minimax-bot`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'tools/call',
          params: { name: 'start_helper', arguments: { caller_bot_id: botId, task: 'Look this up' } },
        }),
      });
      assert.equal(reply.status, 200);
      await botTurnDone.promise;
      return { ...ids, status: 'finished', text: 'Started' };
    }
    return { ...ids, status: 'finished', text: 'Relay' };
  } };
  let botId = '';
  const app = await start({
    pluginRoot: resolve(import.meta.dirname, '..'),
    dataDir,
    listen: { host: '127.0.0.1', port },
    signal: new AbortController().signal,
    logger: { info() {}, warn() {}, error() {} },
    agent,
  });
  t.after(async () => { await app.dispose(); await rm(dataDir, { recursive: true, force: true }); });
  base = `http://127.0.0.1:${port}`;
  const state = await (await fetch(`${base}/api/state`)).json();
  botId = state.bots[0].id;
  const chat = `bot:${botId}`;
  const sent = await fetch(`${base}/api/chats/${chat}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'START_BACKGROUND', clientMessageId: 'helper-usage-1' }),
  });
  assert.equal(sent.status, 200);
  await until(() => calls.length === 2);
  botTurnDone.resolve();
  helperDone.resolve();
  await until(async () => {
    const usage = await (await fetch(`${base}/api/usage?days=1`)).json();
    return usage.totals.turns === 3;
  });
  const usage = await (await fetch(`${base}/api/usage?days=1`)).json();
  // The panel says three turns because the model ran three turns.
  assert.equal(calls.length, 3);
  assert.equal(usage.totals.turns, calls.length);
  assert.equal(usage.byBot[0].turns, calls.length);
  assert.equal(usage.totals.tools, 1);
  assert.ok(usage.totals.durationMs > 0);
});
