import assert from 'node:assert/strict';
import test from 'node:test';
import { PendingSet } from '../miniapp/node/pending.mjs';
import { AgentRunner } from '../miniapp/node/agent.mjs';

test('a duplicate request preserves its first payload, expiry and in-flight decision', () => {
  let now = 0;
  const pending = new PendingSet({ ttlMs: 100, now: () => now });
  pending.add('permission', { requestId: 'p', toolName: 'first' }, 's1');
  const item = pending.claim('p');
  now = 50;
  pending.add('permission', { requestId: 'p', toolName: 'different' }, 's2');
  assert.equal(pending.claim('p'), undefined);
  assert.equal(pending.get('p'), item);
  assert.equal(item.request.toolName, 'first');
  assert.equal(item.expiresAt, 100);
  pending.resolve('p');
  pending.add('permission', { requestId: 'p' }, 's2');
  assert.equal(pending.claim('p'), undefined);
  pending.add('question', { requestId: 'next' }, 's1');
  assert.ok(pending.claim('next'));
});

test('expiry at claim refuses Host work and emits a resolution exactly once', async () => {
  let now = 0;
  let calls = 0;
  const events = [];
  const pending = new PendingSet({ ttlMs: 100, now: () => now });
  const runner = new AgentRunner({ agent: { reply: async () => { calls += 1; } } }, {
    pending, onEvent: (type, payload) => events.push({ type, ...payload }),
  });
  runner.handleAgentEvent('bot:b', { type: 'permission.requested', requestId: 'p', turnId: 't', sessionId: 's', toolName: 'shell' }, new AbortController());
  now = 100;
  await assert.rejects(runner.reply('p', 'deny'), { code: 'REQUEST_NOT_FOUND' });
  pending.expire();
  assert.equal(calls, 0);
  assert.equal(events.filter(e => e.type === 'evt.permission_resolved' && e.requestId === 'p').length, 1);
});

test('expiry publishes resolution even without another client lookup', async () => {
  const pending = new PendingSet({ ttlMs: 15 });
  const events = [];
  new AgentRunner({}, { pending, onEvent: (type, payload) => events.push({ type, ...payload }) });
  pending.add('permission', { requestId: 'timer' }, 's');
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(events.filter(event => event.type === 'evt.permission_resolved' && event.requestId === 'timer').length, 1);
});

test('a Host questionnaire expiry cannot be extended by the bridge retention window', () => {
  let now = 0;
  const pending = new PendingSet({ ttlMs: 100, now: () => now });
  pending.add('question', { requestId: 'q', expiresAt: 20 }, 's');
  now = 20;
  assert.equal(pending.claim('q'), undefined);
});

test('a terminal run clears its requests but a waiting questionnaire survives its turn finish', async () => {
  for (const status of ['finished', 'aborted', 'error', 'waiting_for_user']) {
    const pending = new PendingSet();
    const question = { requestId: 'q', turnId: 't', mode: 'questionnaire', request: { schemaVersion: 2, id: 'question-q', steps: [] } };
    const context = { agent: {} };
    const runner = new AgentRunner(context, { pending, router: /** @type {any} */ ({
      route: () => ({ kind: 'bot' }),
      hosted: async ({ onEvent }) => {
        onEvent({ type: 'question.requested', sessionId: 's', ...question });
        const hostStatus = status === 'waiting_for_user' ? 'finished' : status;
        onEvent({ type: 'turn.finished', turnId: 't', status: hostStatus });
        return { sessionId: 's', turnId: 't', status: hostStatus, ...(status === 'waiting_for_user' ? { pendingQuestion: question } : {}) };
      },
    }) });
    await runner.run({ chatId: 'bot:b', text: 'work' });
    assert.equal(pending.size, status === 'waiting_for_user' ? 1 : 0, status);
  }
});
