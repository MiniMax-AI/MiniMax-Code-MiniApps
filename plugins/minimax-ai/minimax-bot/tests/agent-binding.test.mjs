import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../miniapp/node/store.mjs';
import { MemoryStore } from '../miniapp/node/memory.mjs';
import { Engine } from '../miniapp/node/engine.mjs';
import { setLocale } from '../miniapp/node/i18n.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'bot-agent-binding-'));
  const store = new Store(dir);
  const memory = new MemoryStore(dir);
  await store.init();
  await memory.init();
  setLocale('en');
  const warnings = [];
  const engine = new Engine({
    store,
    memory,
    logger: { warn(message, detail) { warnings.push({ message, detail }); } },
    broadcast() {},
    retryDelaysMs: [],
  });
  t.after(async () => {
    engine.dispose();
    await store.writeChain;
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, store, memory, engine, warnings };
}

/** The Host could not bind a session to the Agent it was asked for. */
function bindFailure() {
  return Object.assign(new Error('Mini App Agent session is unavailable'), { code: 'AGENT_UNAVAILABLE', retryable: false });
}

function turnStarted(options, sessionId) {
  options.onEvent({ type: 'turn.started', sessionId, turnId: `turn-${sessionId}` });
  return { sessionId, turnId: `turn-${sessionId}` };
}

test('a new session names an Agent the Host can bind when the default one cannot be bound', async (t) => {
  const { engine, store, warnings } = await fixture(t);
  const bot = { id: 'bot_a', name: 'Alice', role: 'Writer' };
  store.state.bots = [bot];
  const calls = [];
  engine.agent = {
    async agents() {
      return { agents: [
        { name: 'mavis', displayName: 'Mavis', primary: true },
        { name: 'general', displayName: 'General', primary: false },
      ] };
    },
    async run(input, options) {
      calls.push(input);
      // The Host cannot bind the primary: it stores it under the legacy `main` alias and
      // rejects that alias, so the session never opens.
      if (!input.agent || input.agent === 'mavis') throw bindFailure();
      return { ...turnStarted(options, 'session-general'), status: 'finished', text: 'Done' };
    },
  };
  const result = await engine.runBotTurn({ bot, chatId: `bot:${bot.id}`, text: 'Hello', kind: 'private' });
  assert.equal(result.status, 'done');
  // The default first, then the offered Agents, primary first.
  assert.deepEqual(calls.map((call) => call.agent), [undefined, 'mavis', 'general']);
  assert.ok(warnings.some((warning) => warning.message === 'minimax_bot.agent_bound' && warning.detail.agent === 'general'));
});

test('the Agent that worked is used for the next new session without probing again', async (t) => {
  const { engine, store } = await fixture(t);
  const first = { id: 'bot_a', name: 'Alice', role: 'Writer' };
  const second = { id: 'bot_b', name: 'Bob', role: 'Reviewer' };
  store.state.bots = [first, second];
  const calls = [];
  let session = 0;
  engine.agent = {
    async agents() {
      return { agents: [
        { name: 'mavis', displayName: 'Mavis', primary: true },
        { name: 'general', displayName: 'General', primary: false },
      ] };
    },
    async run(input, options) {
      calls.push(input);
      // Only a new session can fail to bind: a continued one keeps the Agent it was created with.
      if (!input.sessionId && (!input.agent || input.agent === 'mavis')) throw bindFailure();
      session += 1;
      return { ...turnStarted(options, `session-${session}`), status: 'finished', text: 'Done' };
    },
  };
  await engine.runBotTurn({ bot: first, chatId: `bot:${first.id}`, text: 'First', kind: 'private' });
  await engine.runBotTurn({ bot: second, chatId: `bot:${second.id}`, text: 'Second', kind: 'private' });
  // The second Bot opens its own session and goes straight to the Agent that worked.
  assert.deepEqual(calls.map((call) => call.agent), [undefined, 'mavis', 'general', 'general']);
});

test('a continued session never names an Agent', async (t) => {
  const { engine, store } = await fixture(t);
  const bot = { id: 'bot_a', name: 'Alice', role: 'Writer' };
  store.state.bots = [bot];
  const chatId = `bot:${bot.id}`;
  await store.setSession(chatId, bot.id, { sessionId: 'session-1' });
  const calls = [];
  engine.agent = {
    async agents() { return { agents: [{ name: 'mavis', displayName: 'Mavis', primary: true }] }; },
    async run(input, options) {
      calls.push(input);
      return { ...turnStarted(options, 'session-1'), status: 'finished', text: 'Done' };
    },
  };
  const result = await engine.runBotTurn({ bot, chatId, text: 'Continue', kind: 'private' });
  assert.equal(result.status, 'done');
  assert.equal(calls.length, 1);
  assert.equal('agent' in calls[0], false);
});

test('a Host that cannot list Agents keeps the Host failure', async (t) => {
  const { engine, store } = await fixture(t);
  const bot = { id: 'bot_a', name: 'Alice', role: 'Writer' };
  store.state.bots = [bot];
  const chatId = `bot:${bot.id}`;
  let calls = 0;
  engine.agent = {
    async run() { calls += 1; throw bindFailure(); },
  };
  const result = await engine.runBotTurn({ bot, chatId, text: 'Hello', kind: 'private' });
  assert.equal(result.status, 'error');
  assert.equal(calls, 1);
  const messages = await store.getMessages(chatId);
  assert.equal(messages.at(-1).errorCode, 'AGENT_UNAVAILABLE');
});

test('a failure that is not a bind failure is never retried with another Agent', async (t) => {
  const { engine, store } = await fixture(t);
  const bot = { id: 'bot_a', name: 'Alice', role: 'Writer' };
  store.state.bots = [bot];
  const calls = [];
  engine.agent = {
    async agents() { return { agents: [{ name: 'general', displayName: 'General', primary: false }] }; },
    async run(input) {
      calls.push(input);
      throw Object.assign(new Error('The Agent turn failed'), { code: 'AGENT_OUTCOME_UNKNOWN' });
    },
  };
  const result = await engine.runBotTurn({ bot, chatId: `bot:${bot.id}`, text: 'Hello', kind: 'private' });
  assert.equal(result.status, 'error');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].agent, undefined);
});
