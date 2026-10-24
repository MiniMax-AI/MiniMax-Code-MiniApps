// Engine-level checks of when a failed turn is retried automatically. Every case drives the real
// `Engine#runBotTurn` with a fake Agent and counts how many times the Agent was invoked.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../miniapp/node/store.mjs';
import { MemoryStore } from '../miniapp/node/memory.mjs';
import { Engine } from '../miniapp/node/engine.mjs';
import { setLocale } from '../miniapp/node/i18n.mjs';

/** Three short retries: a turn that is retried every time runs 4 times. */
const SHORT_DELAYS = [1, 1, 1];

async function fixture(t, run) {
  const dir = await mkdtemp(join(tmpdir(), 'bot-turn-retry-'));
  const store = new Store(dir);
  const memory = new MemoryStore(dir);
  await store.init();
  await memory.init();
  setLocale('en');
  const engine = new Engine({ store, memory, logger: { warn() {} }, broadcast() {}, retryDelaysMs: SHORT_DELAYS });
  const calls = { count: 0 };
  engine.agent = {
    async run(input, options) {
      calls.count += 1;
      return run(calls.count, input, options);
    },
  };
  t.after(async () => {
    engine.dispose();
    await store.writeChain;
    await rm(dir, { recursive: true, force: true });
  });
  const bot = store.state.bots[0];
  const chatId = `bot:${bot.id}`;
  const turn = () => engine.runBotTurn({ bot, chatId, text: 'Hello', kind: 'private' });
  return { store, engine, calls, turn, chatId };
}

function agentError(fields) {
  return Object.assign(new Error(fields.message), fields);
}

test('a thrown AGENT_OUTCOME_UNKNOWN with retryable:false is not retried even if its text names a timeout', async (t) => {
  const { calls, turn } = await fixture(t, () => {
    throw agentError({ code: 'AGENT_OUTCOME_UNKNOWN', retryable: false, message: 'connect ETIMEDOUT 10.0.0.1:443' });
  });
  const result = await turn();
  assert.equal(calls.count, 1);
  assert.equal(result.status, 'error');
});

test('a thrown error with retryable:false is not retried even if its text says "rate limit"', async (t) => {
  const { calls, turn } = await fixture(t, () => {
    throw agentError({ code: 'AGENT_UNAVAILABLE', retryable: false, message: 'rate limit: Token Plan quota' });
  });
  await turn();
  assert.equal(calls.count, 1);
});

test('a thrown AGENT_OUTCOME_UNKNOWN is never retried, even when it claims to be retryable', async (t) => {
  const { calls, turn } = await fixture(t, () => {
    throw agentError({ code: 'AGENT_OUTCOME_UNKNOWN', retryable: true, message: 'Abort not confirmed' });
  });
  await turn();
  assert.equal(calls.count, 1);
});

test('an error result with retryable:false is not retried even if its text names a 5xx', async (t) => {
  const { calls, turn } = await fixture(t, (n, input, options) => {
    options.onEvent({ type: 'turn.started', sessionId: 's1', turnId: `t${n}` });
    return { sessionId: 's1', turnId: `t${n}`, status: 'error', error: { code: 'LLM_UPSTREAM_ERROR', message: 'Internal server error (500)', retryable: false } };
  });
  await turn();
  assert.equal(calls.count, 1);
});

test('an error result coded AGENT_OUTCOME_UNKNOWN is not retried', async (t) => {
  const { calls, turn } = await fixture(t, (n, input, options) => {
    options.onEvent({ type: 'turn.started', sessionId: 's1', turnId: `t${n}` });
    return { sessionId: 's1', turnId: `t${n}`, status: 'error', error: { code: 'AGENT_OUTCOME_UNKNOWN', message: 'Outcome unknown' } };
  });
  await turn();
  assert.equal(calls.count, 1);
});

test('a thrown retryable error is retried, and the retry stops at the first success', async (t) => {
  const { calls, turn, store, chatId } = await fixture(t, (n, input, options) => {
    if (n < 3) throw agentError({ code: 'AGENT_UNAVAILABLE', retryable: true, message: 'Unavailable' });
    options.onEvent({ type: 'turn.started', sessionId: 's1', turnId: `t${n}` });
    return { sessionId: 's1', turnId: `t${n}`, status: 'finished', text: 'Done' };
  });
  const result = await turn();
  assert.equal(calls.count, 3);
  assert.equal(result.status, 'done');
  assert.equal((await store.getMessages(chatId)).at(-1).text, 'Done');
});

test('a failed result with no retry verdict is retried until the window runs out', async (t) => {
  const { calls, turn, store, chatId } = await fixture(t, (n, input, options) => {
    options.onEvent({ type: 'turn.started', sessionId: 's1', turnId: `t${n}` });
    return { sessionId: 's1', turnId: `t${n}`, status: 'error', error: { code: 'TURN_FAILED', message: 'The Agent turn failed.' } };
  });
  await turn();
  assert.equal(calls.count, SHORT_DELAYS.length + 1);
  assert.equal((await store.getMessages(chatId)).at(-1).retried, SHORT_DELAYS.length);
});

test('a failed result whose reason a retry cannot fix is not retried', async (t) => {
  const { calls, turn } = await fixture(t, (n, input, options) => {
    options.onEvent({ type: 'turn.started', sessionId: 's1', turnId: `t${n}` });
    return { sessionId: 's1', turnId: `t${n}`, status: 'error', error: { code: 'LLM_QUOTA', message: 'rate limit: quota used up', reason: 'quota' } };
  });
  await turn();
  assert.equal(calls.count, 1);
});
