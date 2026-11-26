// @ts-check
//
// Regression tests for 「交给 Agent 润色」.
//
// The Host carries a questionnaire's `requestId` next to the questionnaire,
// not inside it, and Node names the questionnaire `requestId` when it answers.
// A turn that asked a question must save its result just like a turn that did
// not, and the page must only claim a version was saved when one was.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createPolisher } from '../miniapp/node/polisher.mjs';

const QUESTIONNAIRE = {
  schemaVersion: 2,
  id: 'q-1',
  title: '确认风格',
  mode: 'questionnaire',
  steps: [
    {
      id: 's1',
      question: '保持原有语气吗？',
      selectionMode: 'single',
      options: [{ id: 'yes', label: '保持' }],
      allowOther: true,
    },
  ],
};

/**
 * A fake Agent that pauses on a questionnaire and finishes after the answer.
 */
function fakeAgent(options = {}) {
  /** @type {any[]} */
  const answerCalls = [];
  /** @type {any[]} */
  const runCalls = [];
  const agent = {
    run: async (/** @type {any} */ input, /** @type {any} */ opts) => {
      runCalls.push(input);
      if (options.emitQuestionEvent && opts?.onEvent) {
        opts.onEvent({
          type: 'question.requested',
          sessionId: 'sess-1',
          requestId: 'req-1',
          mode: 'questionnaire',
          request: QUESTIONNAIRE,
        });
      }
      return {
        sessionId: 'sess-1',
        status: 'finished',
        text: 'pending',
        pendingQuestion: { requestId: 'req-1', mode: 'questionnaire', request: QUESTIONNAIRE },
      };
    },
    answer: async (/** @type {any} */ input) => {
      answerCalls.push(input);
      return { sessionId: 'sess-1', status: 'finished', text: '润色后的正文' };
    },
    reply: async () => {},
  };
  return { agent, answerCalls, runCalls };
}

/**
 * @returns {Promise<void>}
 */
async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('the questionnaire id is read beside the questionnaire, not inside it', async () => {
  const { agent } = fakeAgent();
  const polisher = createPolisher({ agent });
  const { callId } = polisher.start({ id: 'd1', topic: 't', body: 'b' }, '', async () => ({}));
  await tick();

  const record = polisher.read(callId);
  assert.equal(record.status, 'waiting_answer');
  assert.deepEqual(record.question, QUESTIONNAIRE);
  assert.equal(record.question.requestId, undefined, 'the questionnaire itself carries no id');
});

test('answering a questionnaire names it by requestId and saves a new version', async () => {
  const { agent, answerCalls } = fakeAgent();
  /** @type {any[]} */
  const commits = [];
  const polisher = createPolisher({ agent });
  const { callId } = polisher.start({ id: 'd1', topic: 't', body: 'b' }, '', async (draftId, body, source) => {
    commits.push({ draftId, body, source });
    return { version: 2 };
  });
  await tick();

  const outcome = await polisher.answerQuestion(callId, [{ stepId: 's1', selectedOptionIds: ['yes'] }]);
  assert.equal(outcome.ok, true);
  assert.equal(answerCalls.length, 1);
  assert.equal(answerCalls[0].requestId, 'req-1');
  assert.equal(answerCalls[0].questionId, undefined, 'Node uses requestId, not questionId');
  assert.equal(answerCalls[0].sessionId, 'sess-1');

  assert.equal(commits.length, 1, 'the polished body must become a new version');
  assert.equal(commits[0].body, '润色后的正文');
  assert.equal(commits[0].source, 'agent');

  const record = polisher.read(callId);
  assert.equal(record.status, 'done');
  assert.equal(record.committed, true);
  assert.equal(record.committedVersion, 2);
});

test('a questionnaire raised as an event is answered the same way', async () => {
  const { agent, answerCalls } = fakeAgent({ emitQuestionEvent: true });
  /** @type {any[]} */
  const commits = [];
  const polisher = createPolisher({ agent });
  const { callId } = polisher.start({ id: 'd1', topic: 't', body: 'b' }, '', async (draftId, body) => {
    commits.push({ draftId, body });
    return { version: 3 };
  });
  await tick();

  const outcome = await polisher.answerQuestion(callId, []);
  assert.equal(outcome.ok, true);
  assert.equal(answerCalls[0].requestId, 'req-1');
  assert.equal(commits.length, 1);
  assert.equal(polisher.read(callId).committedVersion, 3);
});

test('a failed save is reported and not claimed as a saved version', async () => {
  const { agent } = fakeAgent();
  const polisher = createPolisher({ agent });
  const { callId } = polisher.start({ id: 'd1', topic: 't', body: 'b' }, '', async () => {
    throw new Error('磁盘写入失败');
  });
  await tick();

  const outcome = await polisher.answerQuestion(callId, []);
  assert.equal(outcome.ok, false);
  const record = polisher.read(callId);
  assert.equal(record.status, 'failed');
  assert.equal(record.committed, false);
});

test('a turn without a questionnaire saves its version too', async () => {
  const agent = {
    run: async () => ({ sessionId: 'sess-2', status: 'finished', text: '直接润色后的正文' }),
    answer: async () => {
      throw new Error('answer must not be called');
    },
    reply: async () => {},
  };
  /** @type {any[]} */
  const commits = [];
  const polisher = createPolisher({ agent });
  const { callId } = polisher.start({ id: 'd1', topic: 't', body: 'b' }, '', async (draftId, body) => {
    commits.push({ draftId, body });
    return { version: 2 };
  });
  await tick();

  const record = polisher.read(callId);
  assert.equal(record.status, 'done');
  assert.equal(record.committed, true);
  assert.equal(commits.length, 1);
});
