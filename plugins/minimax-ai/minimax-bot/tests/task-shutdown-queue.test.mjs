// @ts-check
// What a graceful shutdown does to the work that is still held.
//
// The README promises that work that never started stays queued and runs again after a
// restart. A shutdown used to write `unknown` for every task it was holding, even for the ones
// whose turn never reached the Host: those did no work at all, so they were lost — and
// `unknown` cannot be cancelled either, so the batch could never be cleaned up. A task whose
// result is already there settles by that result instead of being thrown away.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Store } from '../miniapp/node/store.mjs';
import { MemoryStore } from '../miniapp/node/memory.mjs';
import { Engine } from '../miniapp/node/engine.mjs';
import { setLocale } from '../miniapp/node/i18n.mjs';

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

async function until(predicate, label = 'condition', tries = 1600) {
  for (let i = 0; i < tries; i++) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const idle = (engine) =>
  !engine.tasks.runs.size && !engine.tasks.deliveries.size && !engine.tickets.size;

function agentResult(input, options, text = 'Complete') {
  const ids = {
    sessionId: input.sessionId ?? `session-${String(input.text).slice(-16)}`,
    turnId: 'turn',
  };
  options.onEvent({ type: 'turn.started', ...ids });
  return { ...ids, status: 'finished', text };
}

async function fixture(t, { retryDelaysMs = [] } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'bot-shutdown-queue-'));
  const store = new Store(dir);
  await store.init();
  const memory = new MemoryStore(dir);
  await memory.init();
  setLocale('en');
  store.state.bots = [
    { id: 'bot_a', name: 'Alice', isMain: true },
    { id: 'bot_b', name: 'Bob' },
    { id: 'bot_c', name: 'Carol' },
    { id: 'bot_d', name: 'Dave' },
    { id: 'bot_e', name: 'Eve' },
  ];
  await store.save();
  const engine = new Engine({
    store, memory, logger: { warn() {} }, broadcast() {}, retryDelaysMs,
  });
  t.after(async () => {
    engine.dispose();
    await until(() => idle(engine), 'idle after dispose');
    await store.writeChain;
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, store, memory, engine };
}

test('a task whose turn never started stays queued and runs again after a restart', async (t) => {
  const { dir, store, memory, engine } = await fixture(t);
  const gate = deferred();
  const calls = [];
  engine.agent = {
    async run(input, options) {
      calls.push(String(input.text));
      const result = agentResult(input, options, 'blocked-turn');
      if (String(input.text).includes('BLOCK')) await gate.promise;
      return result;
    },
  };
  // Fill every top-level slot, so the tasks below cannot start.
  const blockers = ['bot_a', 'bot_b', 'bot_c'].map((id) =>
    engine.runBotTurn({ bot: store.getBot(id), chatId: `bot:${id}`, kind: 'private', text: 'BLOCK' }));
  await until(() => engine.activeSlots === 3, 'slots saturated');
  const receipt = await engine.tasks.dispatch(undefined, {
    request_id: 'never-started',
    tasks: [
      { to: 'bot_d', message: 'TASK-D' },
      { to: 'bot_e', message: 'TASK-E' },
    ],
  });
  await until(() => engine.tasks.tasks.every((task) => task.status === 'running'), 'tasks admitted');
  // Wait until the tasks' turns are really with the engine (they wait for a free slot there).
  await until(() => engine.tickets.size >= 5, 'task turns admitted');
  // The Host never saw the work: the tasks were still waiting for a slot.
  assert.equal(calls.filter((text) => /TASK-D|TASK-E/.test(text)).length, 0);

  engine.dispose();
  gate.resolve();
  await Promise.allSettled(blockers);
  await until(() => idle(engine), 'idle after dispose');
  await store.writeChain;

  // The work never started, so it stays queued: in memory and on disk.
  assert.deepEqual(engine.tasks.tasks.map((task) => task.status), ['queued', 'queued']);
  // It never ran, so it has no running time to show either.
  assert.deepEqual(engine.tasks.tasks.map((task) => task.startedAt), [undefined, undefined]);
  const onDisk = JSON.parse(await readFile(store.statePath, 'utf8'));
  const batch = onDisk.taskBatches.find((item) => item.id === receipt.batch_id);
  assert.deepEqual(batch.tasks.map((task) => task.status), ['queued', 'queued']);

  // Restart: the queued work runs again, and it runs to the end this time.
  let resumed = 0;
  const recoveredStore = new Store(dir);
  await recoveredStore.init();
  const recovered = new Engine({
    store: recoveredStore, memory, logger: { warn() {} }, broadcast() {}, retryDelaysMs: [],
    agent: {
      async run(input, options) {
        if (/TASK-D|TASK-E/.test(String(input.text))) resumed += 1;
        return agentResult(input, options, 'resumed');
      },
    },
  });
  t.after(async () => {
    recovered.dispose();
    await until(() => idle(recovered), 'idle recovered dispose');
    await recoveredStore.writeChain;
  });
  recovered.tasks.start();
  await until(
    () => recovered.tasks.tasks.every((task) => task.status === 'done') && idle(recovered),
    'tasks resumed',
  );
  assert.equal(resumed, 2);
  assert.deepEqual(
    recovered.tasks.tasks.map((task) => task.result),
    ['resumed', 'resumed'],
  );
});

test('a task whose result is already there settles by that result', async (t) => {
  const { dir, store, memory, engine } = await fixture(t);
  engine.agent = {
    async run(input, options) {
      const result = agentResult(input, options, 'COMPLETED_TEXT');
      if (String(input.text).endsWith('Finish and stop')) engine.dispose();
      return result;
    },
  };
  const receipt = await engine.tasks.dispatch(undefined, {
    request_id: 'finish-stop',
    tasks: [{ to: 'bot_b', message: 'Finish and stop' }],
  });
  await until(() => idle(engine), 'idle');
  await store.writeChain;
  const task = engine.tasks.task(receipt.tasks[0].task_id);
  // The answer is known, so the task is done: a shutdown does not throw it away.
  assert.equal(task.status, 'done');
  assert.equal(task.result, 'COMPLETED_TEXT');

  // After a restart the finished task is still finished, with its answer.
  const recoveredStore = new Store(dir);
  await recoveredStore.init();
  const recovered = new Engine({
    store: recoveredStore, memory, logger: { warn() {} }, broadcast() {}, retryDelaysMs: [],
    agent: { async run(input, options) { return agentResult(input, options, 'SUMMARY'); } },
  });
  t.after(async () => {
    recovered.dispose();
    await until(() => idle(recovered), 'idle recovered dispose');
    await recoveredStore.writeChain;
  });
  recovered.tasks.start();
  await until(() => idle(recovered), 'idle recovered');
  const recoveredTask = recovered.tasks.task(receipt.tasks[0].task_id);
  assert.equal(recoveredTask.status, 'done');
  assert.equal(recoveredTask.result, 'COMPLETED_TEXT');
});

test('a turn the Host had already taken is not put back in the queue', async (t) => {
  const { dir, store, memory, engine } = await fixture(t, { retryDelaysMs: [30] });
  engine.agent = {
    async run(input, options) {
      // The Host has the message now, and then the host goes away: the turn is retried.
      options.onEvent({ type: 'turn.started', sessionId: 's1' });
      throw Object.assign(new Error('Unavailable'), { code: 'AGENT_UNAVAILABLE', retryable: true });
    },
  };
  // The retry is stopped while the brief is built: the Host had the message already, so the
  // outcome of that turn is nobody's to observe.
  const buildBrief = engine.buildMemoryBrief.bind(engine);
  let briefs = 0;
  engine.buildMemoryBrief = async (...args) => {
    briefs += 1;
    const brief = await buildBrief(...args);
    if (briefs === 2) engine.dispose();
    return brief;
  };
  const receipt = await engine.tasks.dispatch(undefined, {
    request_id: 'host-took-it',
    tasks: [{ to: 'bot_b', message: 'WORK' }],
  });
  await until(() => idle(engine), 'idle');
  await store.writeChain;
  const task = engine.tasks.task(receipt.tasks[0].task_id);
  // The Host took it, so the outcome is unknown and the work is not replayed.
  assert.equal(task.status, 'unknown');

  // After a restart it stays unknown and the model is not called again.
  let replayed = 0;
  const recoveredStore = new Store(dir);
  await recoveredStore.init();
  const recovered = new Engine({
    store: recoveredStore, memory, logger: { warn() {} }, broadcast() {}, retryDelaysMs: [],
    agent: {
      async run(input, options) {
        replayed += 1;
        return agentResult(input, options, 'REPLAYED');
      },
    },
  });
  t.after(async () => {
    recovered.dispose();
    await until(() => idle(recovered), 'idle recovered dispose');
    await recoveredStore.writeChain;
  });
  recovered.tasks.start();
  await until(() => idle(recovered), 'idle recovered');
  assert.equal(replayed, 0, 'the work the Host had taken must not be replayed');
  assert.equal(recovered.tasks.task(receipt.tasks[0].task_id).status, 'unknown');
});

test('a turn that ended in a question stays answerable after a shutdown', async (t) => {
  const { dir, store, memory, engine } = await fixture(t);
  engine.agent = {
    async run(input, options) {
      const ids = { sessionId: 's1', turnId: 't1' };
      options.onEvent({ type: 'turn.started', ...ids });
      // The Host asks the user a question, and the app shuts down right after.
      engine.dispose();
      return {
        ...ids,
        status: 'finished',
        text: 'Choose',
        pendingQuestion: {
          requestId: 'q1',
          mode: 'single',
          request: { prompt: 'pick', steps: [{ id: 's1', question: 'pick?' }] },
        },
      };
    },
  };
  const receipt = await engine.tasks.dispatch(undefined, {
    request_id: 'questionnaire',
    tasks: [{ to: 'bot_b', message: 'QUESTION' }],
  });
  await until(() => idle(engine), 'idle');
  await store.writeChain;
  const task = engine.tasks.task(receipt.tasks[0].task_id);
  // The question is in the chat and the user can still answer it: the task waits for the user
  // instead of being written off as an unknown outcome.
  assert.equal(task.status, 'waiting_for_user');

  // After a restart it is still waiting for the answer, and the model is not called again.
  let replayed = 0;
  const recoveredStore = new Store(dir);
  await recoveredStore.init();
  const recovered = new Engine({
    store: recoveredStore, memory, logger: { warn() {} }, broadcast() {}, retryDelaysMs: [],
    agent: {
      async run(input, options) {
        replayed += 1;
        return agentResult(input, options, 'REPLAYED');
      },
    },
  });
  t.after(async () => {
    recovered.dispose();
    await until(() => idle(recovered), 'idle recovered dispose');
    await recoveredStore.writeChain;
  });
  recovered.tasks.start();
  await until(() => idle(recovered), 'idle recovered');
  assert.equal(replayed, 0, 'a task waiting for an answer must not run again');
  assert.equal(recovered.tasks.task(receipt.tasks[0].task_id).status, 'waiting_for_user');
});

test('a task the user cancelled stays cancelled, even when the app shuts down', async (t) => {
  const { dir, store, memory, engine } = await fixture(t);
  const gate = deferred();
  const calls = [];
  engine.agent = {
    async run(input, options) {
      calls.push(String(input.text));
      const result = agentResult(input, options, 'blocked-turn');
      if (String(input.text).includes('BLOCK')) await gate.promise;
      return result;
    },
  };
  // Fill every top-level slot, so the task below cannot start.
  const blockers = ['bot_a', 'bot_b', 'bot_c'].map((id) =>
    engine.runBotTurn({ bot: store.getBot(id), chatId: `bot:${id}`, kind: 'private', text: 'BLOCK' }));
  await until(() => engine.activeSlots === 3, 'slots saturated');
  const receipt = await engine.tasks.dispatch(undefined, {
    request_id: 'cancelled-by-user',
    tasks: [{ to: 'bot_d', message: 'TASK-CANCEL' }],
  });
  await until(() => engine.tasks.tasks.every((task) => task.status === 'running'), 'task admitted');
  // Wait until the task's turn is really with the engine (it waits for a free slot there).
  await until(() => engine.tickets.size >= 4, 'task turn admitted');
  // The user stops it while it is still waiting for a slot, and the app shuts down right
  // after: the cancellation must outlive the shutdown.
  const cancelling = engine.tasks.cancel(undefined, { batch_id: receipt.batch_id });
  engine.dispose();
  await cancelling;
  gate.resolve();
  await Promise.allSettled(blockers);
  await until(() => idle(engine), 'idle after dispose');
  await store.writeChain;

  const task = engine.tasks.task(receipt.tasks[0].task_id);
  assert.equal(task.status, 'cancelled', 'a shutdown does not undo the cancellation');

  // After a restart the cancelled task is not run again.
  let replayed = 0;
  const recoveredStore = new Store(dir);
  await recoveredStore.init();
  const recovered = new Engine({
    store: recoveredStore, memory, logger: { warn() {} }, broadcast() {}, retryDelaysMs: [],
    agent: {
      async run(input, options) {
        replayed += 1;
        return agentResult(input, options, 'REPLAYED');
      },
    },
  });
  t.after(async () => {
    recovered.dispose();
    await until(() => idle(recovered), 'idle recovered dispose');
    await recoveredStore.writeChain;
  });
  recovered.tasks.start();
  await until(() => idle(recovered), 'idle recovered');
  assert.equal(replayed, 0, 'a cancelled task must not run again');
  assert.equal(recovered.tasks.task(receipt.tasks[0].task_id).status, 'cancelled');
});
