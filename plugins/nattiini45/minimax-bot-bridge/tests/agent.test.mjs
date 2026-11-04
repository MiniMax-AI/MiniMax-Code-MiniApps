import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentRunner } from '../miniapp/node/agent.mjs';
import { BotRouter } from '../miniapp/node/bot-router.mjs';
import { PendingSet } from '../miniapp/node/pending.mjs';

const chatId = 'bot:bot_b1';
const turnId = 'turn_hosted';
const sessionId = 'sess_hosted';

function makeRunner(run) {
  const events = [];
  const finished = [];
  const pending = new PendingSet();
  const context = {
    agent: {
      run,
      async answer(input) {
        return { sessionId: input.sessionId, status: 'finished' };
      },
    },
  };
  const router = new BotRouter(context, {
    roster: async () => ({ bots: [{ botId: 'bot_b1', name: 'Writer' }] }),
  });
  const runner = new AgentRunner(context, {
    router,
    pending,
    onEvent: (type, payload) => events.push({ type, ...payload }),
    onTurnFinished: (info) => finished.push(info),
  });
  return { runner, pending, events, finished };
}

function question() {
  return {
    requestId: 'question_1',
    turnId,
    mode: 'questionnaire',
    request: { title: 'Which one?', steps: [{ stepId: 'step_1', title: 'Pick one', options: [] }] },
  };
}

function assertClean(runner) {
  assert.equal(runner.activeRuns, 0);
  assert.equal(runner.aborts.size, 0);
  assert.equal(runner.toolCalls.size, 0);
}

test('a hosted result-only question is registered, emitted in its chat, and answerable', async () => {
  const pendingQuestion = question();
  const { runner, pending, events } = makeRunner(async () => ({
    sessionId, turnId, status: 'waiting_for_user', pendingQuestion,
  }));

  await runner.run({ chatId, text: 'Ask me' });

  assert.equal(pending.size, 1);
  const item = pending.get(pendingQuestion.requestId);
  assert.equal(item.kind, 'question');
  assert.equal(item.sessionId, sessionId);
  assert.deepEqual(item.request, {
    requestId: pendingQuestion.requestId,
    sessionId,
    turnId,
    chatId,
    mode: pendingQuestion.mode,
    title: pendingQuestion.request.title,
    steps: pendingQuestion.request.steps,
  });
  assert.deepEqual(events.filter((event) => event.type === 'evt.question_requested'), [
    { type: 'evt.question_requested', request: item.request },
  ]);
  await runner.answer(pendingQuestion.requestId, []);
  assert.equal(pending.size, 0);
});

test('a result-only question supplies the turn id when the Host omits it from the result', async () => {
  const { runner, pending, events } = makeRunner(async () => ({
    sessionId, status: 'waiting_for_user', pendingQuestion: question(),
  }));

  const result = await runner.run({ chatId, text: 'Ask me' });

  assert.equal(result.turnId, turnId);
  assert.equal(pending.get('question_1').request.turnId, turnId);
  assert.equal(events.find((event) => event.type === 'evt.turn_finished').turnId, turnId);
});

test('a hosted question reported by event and result is emitted and registered only once', async () => {
  const pendingQuestion = question();
  const { runner, pending, events } = makeRunner(async (_input, { onEvent }) => {
    onEvent({ type: 'question.requested', sessionId, ...pendingQuestion });
    return { sessionId, turnId, status: 'waiting_for_user', pendingQuestion };
  });
  let added = 0;
  const add = pending.add.bind(pending);
  pending.add = (...args) => {
    added += 1;
    return add(...args);
  };

  await runner.run({ chatId, text: 'Ask me' });

  assert.equal(added, 1);
  assert.equal(events.filter((event) => event.type === 'evt.question_requested').length, 1);
});

test('a hosted rejection cleans event-keyed state and finishes the observed turn', async () => {
  const failure = new Error('Host disconnected');
  const { runner, events, finished } = makeRunner(async (_input, { onEvent }) => {
    onEvent({ type: 'turn.started', turnId });
    onEvent({ type: 'tool.started', turnId, name: 'bash' });
    throw failure;
  });

  await assert.rejects(runner.run({ chatId, text: 'Work' }), (error) => error === failure);

  assertClean(runner);
  const ended = events.filter((event) => event.type === 'evt.turn_finished');
  assert.equal(ended.length, 1);
  assert.equal(ended[0].turnId, turnId);
  assert.equal(ended[0].chatId, chatId);
  assert.equal(ended[0].status, 'error');
  assert.equal(ended[0].error.message, failure.message);
  assert.equal(finished.length, 1);
  assert.equal(finished[0].error, failure);
});

test('a hosted success without a result turn id cleans and finishes the event turn', async () => {
  const { runner, events } = makeRunner(async (_input, { onEvent }) => {
    onEvent({ type: 'turn.started', turnId });
    onEvent({ type: 'tool.started', turnId, name: 'bash' });
    return { sessionId, status: 'finished', text: 'Done' };
  });

  const result = await runner.run({ chatId, text: 'Work' });

  assertClean(runner);
  assert.equal(result.turnId, turnId);
  const ended = events.filter((event) => event.type === 'evt.turn_finished');
  assert.equal(ended.length, 1);
  assert.equal(ended[0].turnId, turnId);
  assert.equal(ended[0].status, 'finished');
});

test('aborting a hosted turn aborts its signal, cleans tools, and finishes as aborted', { timeout: 2_000 }, async () => {
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  /** @type {AbortSignal | undefined} */
  let signal;
  const { runner, events } = makeRunner(async (_input, options) => {
    signal = options.signal;
    options.onEvent({ type: 'turn.started', turnId });
    options.onEvent({ type: 'tool.started', turnId, name: 'bash' });
    started();
    await new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true });
    });
  });

  const running = runner.run({ chatId, text: 'Work' });
  const rejected = assert.rejects(running, { name: 'AbortError' });
  await ready;
  assert.equal(await runner.abort(turnId), true);
  assert.ok(signal);
  assert.equal(signal.aborted, true);
  await rejected;

  assertClean(runner);
  const ended = events.filter((event) => event.type === 'evt.turn_finished');
  assert.equal(ended.length, 1);
  assert.equal(ended[0].turnId, turnId);
  assert.equal(ended[0].status, 'aborted');
  assert.equal(ended[0].reason, 'cancelled');
  assert.equal(await runner.abort(turnId), false);
});

test('a hosted CANCELLED rejection is reported as aborted with the observed turn id', async () => {
  const failure = Object.assign(new Error('Stopped'), { code: 'CANCELLED' });
  const { runner, events } = makeRunner(async (_input, { onEvent }) => {
    onEvent({ type: 'turn.started', turnId });
    throw failure;
  });

  await assert.rejects(runner.run({ chatId, text: 'Work' }), (error) => error === failure);

  assertClean(runner);
  const ended = events.find((event) => event.type === 'evt.turn_finished');
  assert.equal(ended.turnId, turnId);
  assert.equal(ended.status, 'aborted');
});

test('a hosted terminal event is not emitted again when the Host subsequently rejects', async () => {
  const failure = new Error('Host disconnected');
  const { runner, events } = makeRunner(async (_input, { onEvent }) => {
    onEvent({ type: 'turn.started', turnId });
    onEvent({ type: 'turn.finished', turnId, status: 'error', error: { message: failure.message } });
    throw failure;
  });

  await assert.rejects(runner.run({ chatId, text: 'Work' }), (error) => error === failure);

  assertClean(runner);
  assert.equal(events.filter((event) => event.type === 'evt.turn_finished').length, 1);
});

test('a hosted failure before events releases its slot without inventing a turn id', async () => {
  const failure = new Error('Host unavailable');
  const { runner, events, finished } = makeRunner(async () => { throw failure; });

  await assert.rejects(runner.run({ chatId, text: 'Work' }), (error) => error === failure);

  assertClean(runner);
  assert.equal(events.find((event) => event.type === 'evt.turn_finished').turnId, undefined);
  assert.equal(finished.length, 1);
});
