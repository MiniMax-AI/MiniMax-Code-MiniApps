import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Bridge } from '../miniapp/node/bridge.mjs';
import { AgentRunner, MAX_CONCURRENT_RUNS } from '../miniapp/node/agent.mjs';
import { BotRouter } from '../miniapp/node/bot-router.mjs';
import { PendingSet } from '../miniapp/node/pending.mjs';
import { buildToolArguments } from '../miniapp/node/tools.mjs';
import { createFakeTeam, TEAM_TOOL_DESCRIPTORS } from './fake-team.mjs';

function deferred() {
  /** @type {(value?: any) => void} */
  let resolve = () => {};
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
/** @param {any} [agent] @param {Record<string, string>} [botModes] */
async function fixture(agent = {}, botModes = { b1: 'hosted' }) {
  // The scratch root lives in the operating system's temporary directory, so the suite
  // runs the same way in the workspace, in a published package and in an installed one.
  const root = join(tmpdir(), 'minimax-bot-bridge-tests', 'bridge-execution');
  await mkdir(root, { recursive: true });
  const frames = [], warnings = [];
  const context = { dataDir: await mkdtemp(join(root, 'bridge-')), agent,
    logger: { info() {}, debug() {}, error() {}, warn: (...args) => warnings.push(args) } };
  const bridge = new Bridge(context, { config: /** @type {any} */ ({ botModes }) });
  bridge.relay.send = f => { frames.push(f); return true; };
  bridge.ledger.persist = async () => {};
  bridge.router.roster = async () => ({ bots: [{ botId: 'b1', name: 'Writer' }] });
  return { bridge, context, frames, warnings };
}
function question(bridge, id = 'q1') {
  bridge.runner.rememberSession('bot:b1', 's1');
  bridge.pending.add('question', { requestId: id, chatId: 'bot:b1', turnId: 'original', steps: [] }, 's1');
}

test('questionnaire continuations share pending, permission, session, tool and terminal lifecycle', async () => {
  const { bridge, frames } = await fixture({
    answer: async (_input, { onEvent }) => {
      onEvent({ type: 'turn.started', sessionId: 's1', turnId: 'continued' });
      onEvent({ type: 'permission.requested', requestId: 'p2', sessionId: 's2', turnId: 'continued', toolName: 'shell' });
      onEvent({ type: 'tool.started', sessionId: 's1', name: 'read', turnId: 'continued' });
      onEvent({ type: 'tool.finished', sessionId: 's1', name: 'read', turnId: 'continued', ok: true });
      return { sessionId: 's2', turnId: 'continued', status: 'finished', pendingQuestion: {
        requestId: 'q2', mode: 'questionnaire', request: { schemaVersion: 2, id: 'question-q2', steps: [] },
      } };
    },
  });
  question(bridge);
  await bridge.runner.answer('q1', []);
  assert.equal(bridge.pending.get('q1'), undefined);
  assert.ok(bridge.pending.get('q2'));
  assert.ok(bridge.pending.get('p2'));
  assert.equal(bridge.runner.sessionFor('bot:b1'), 's2');
  assert.equal(bridge.router.phoneSessions.get('bot:b1'), 's2');
  assert.equal(bridge.runner.aborts.size, 0);
  assert.equal(bridge.runner.toolCalls.size, 0);
  assert.equal(bridge.ledger.report().totals.tools, 1);
  assert.ok(frames.some(f => f.type === 'evt.turn_finished'));
  assert.ok(frames.some(f => f.type === 'evt.question_requested' && f.payload.request.requestId === 'q2'));
  bridge.context.agent.answer = async (_input, { onEvent }) => {
    onEvent({ type: 'turn.started', sessionId: 's1', turnId: 'last' });
    onEvent({ type: 'message.committed', sessionId: 's1', turnId: 'last', text: 'done' });
    return { sessionId: 's3', turnId: 'last', status: 'finished', text: 'done' };
  };
  await bridge.runner.answer('q2', []);
  assert.ok((await bridge.historyFor('bot:b1')).messages.some(m => m.text === 'done'));
  bridge.stop();
});

test('continuation failure cleans watchers, records completed tools and failure, and does not reopen an accepted answer', async () => {
  const { bridge, frames } = await fixture({ answer: async (_input, { onEvent }) => {
    onEvent({ type: 'turn.started', sessionId: 's1', turnId: 'continued' });
    onEvent({ type: 'tool.started', sessionId: 's1', turnId: 'continued', name: 'read' });
    onEvent({ type: 'tool.finished', sessionId: 's1', turnId: 'continued', name: 'read', ok: false });
    throw new Error('poll failed');
  } });
  question(bridge);
  await assert.rejects(bridge.runner.answer('q1', []), /poll failed/);
  assert.equal(bridge.runner.aborts.size, 0);
  assert.equal(bridge.runner.toolCalls.size, 0);
  assert.equal(bridge.runner.activeRuns, 0);
  assert.equal(bridge.pending.size, 0);
  assert.ok(frames.some(f => f.type === 'evt.turn_finished' && f.payload.status === 'error'));
  assert.equal(bridge.ledger.report().totals.tools, 1);
  assert.equal(bridge.ledger.report().totals.errors, 2);
  bridge.stop();
});

test('answers and permission completions are admitted at the run creation ceiling', async () => {
  let replies = 0, answers = 0;
  const pending = new PendingSet();
  const runner = new AgentRunner({ agent: { reply: async () => { replies += 1; }, answer: async () => { answers += 1; return { status: 'finished' }; } } }, { pending });
  pending.add('permission', { requestId: 'p' }, 's');
  pending.add('question', { requestId: 'q', chatId: 'bot:b' }, 's');
  runner.activeRuns = MAX_CONCURRENT_RUNS;
  await runner.reply('p', 'deny');
  await runner.answer('q', []);
  assert.equal(replies, 1);
  assert.equal(answers, 1);
  assert.equal(runner.activeRuns, MAX_CONCURRENT_RUNS);
  await assert.rejects(runner.runHosted({ chatId: 'bot:b', text: 'new' }), { code: 'BUSY' });
});

test('remote cancel refusal or transport failure leaves the watcher and retry intact', async () => {
  const polled = deferred(), result = deferred();
  /** @type {AbortSignal} */
  let signal;
  let cancels = 0;
  const router = new BotRouter({}, { gateway: /** @type {any} */ ({ available: true, call: async (name, _input, options = {}) => {
    if (name === 'message_bot') return { ok: true, structuredContent: { value: { batch_id: 'batch', tasks: [{ task_id: 'task' }] } } };
    if (name === 'get_tasks') {
      signal = options.signal; polled.resolve();
      return result.promise;
    }
    if (name === 'cancel_tasks') {
      cancels += 1;
      if (cancels === 1) return { ok: true, isError: true, message: 'cancel refused' };
      if (cancels === 2) throw new Error('transport failure');
      return { ok: true, structuredContent: { value: { tasks: [{ task_id: 'task', status: 'cancelled' }] } } };
    }
  } }) });
  const runner = new AgentRunner({}, { router });
  const run = runner.run({ chatId: 'bot:b', text: 'work', mode: 'team' });
  await polled.promise;
  await assert.rejects(runner.abort('task'), /cancel refused/);
  assert.equal(signal.aborted, false);
  await assert.rejects(runner.abort('task'), /transport failure/);
  assert.equal(signal.aborted, false);
  assert.equal(await runner.abort('task'), true);
  assert.equal(signal.aborted, true);
  result.resolve({ ok: true, structuredContent: { tasks: [{ task_id: 'task', status: 'cancelled' }] } });
  await run;
  assert.equal(router.turns.size, 0);
});

test('assistant and tool history follow their run owner across both mode switches', async () => {
  const ready = deferred(), end = deferred();
  const { bridge } = await fixture({ run: async (_input, { onEvent }) => {
    onEvent({ type: 'turn.started', sessionId: 's1', turnId: 'hosted' }); ready.resolve(); await end.promise;
    onEvent({ type: 'tool.started', sessionId: 's1', turnId: 'hosted', name: 'read' });
    onEvent({ type: 'tool.finished', sessionId: 's1', turnId: 'hosted', name: 'read', ok: true });
    onEvent({ type: 'message.committed', sessionId: 's1', turnId: 'hosted', text: 'hosted answer' });
    return { sessionId: 's', turnId: 'hosted', status: 'finished' };
  } });
  const run = bridge.sendMessage({ chatId: 'bot:b1', text: 'work' });
  await ready.promise;
  await bridge.setBotMode({ botId: 'b1', mode: 'team' }); end.resolve(); await run;
  assert.ok((await bridge.historyFor('bot:b1')).messages.some(m => m.text === 'hosted answer'));
  assert.equal(bridge.activity.get('bot:b1').length, 1);
  bridge.runner.publishExchange('bot:b1', 'official', { messages: [{ role: 'assistant', messageId: 'official', chatId: 'bot:b1', ts: 1, text: 'team answer' }], activity: [] });
  await bridge.setBotMode({ botId: 'b1', mode: 'hosted' });
  bridge.runner.publishExchange('bot:b1', 'official2', { messages: [{ role: 'assistant', messageId: 'official2', chatId: 'bot:b1', ts: 2, text: 'another team answer' }], activity: [] });
  assert.equal(bridge.history.get('bot:b1').some(m => m.text.includes('team answer')), false);
  bridge.stop();
});

test('roster tool errors and malformed successful results cannot publish an empty success', async () => {
  const { bridge, frames } = await fixture();
  for (const response of [
    { ok: false, code: 'TOOL_NOT_AVAILABLE' },
    { ok: true, isError: true, message: 'Please open the team.' },
    { ok: true, structuredContent: { ok: false, error: 'Please open the team.' } },
    { ok: true, structuredContent: { unrelated: [] } },
  ]) {
    bridge.tools.call = async () => response;
    assert.equal(await bridge.publishTeamSnapshot(), false);
  }
  assert.equal(frames.some(f => f.type === 'evt.team_snapshot'), false);
  bridge.tools.call = async () => ({ ok: true, structuredContent: { bots: [], groups: [] } });
  assert.deepEqual(await bridge.readTeam(), { bots: [], groups: [] });
  bridge.stop();
});

test('hosted errors retain supplied result usage and completed tool errors without invented tokens', async () => {
  const { bridge } = await fixture({ run: async (_input, { onEvent }) => {
    onEvent({ type: 'turn.started', sessionId: 's1', turnId: 't' });
    onEvent({ type: 'tool.started', sessionId: 's1', turnId: 't', name: 'read' });
    onEvent({ type: 'tool.finished', sessionId: 's1', turnId: 't', name: 'read', ok: false });
    return { status: 'error', turnId: 't', usage: { totalTokens: 17 }, error: { message: 'failed' } };
  } });
  await bridge.runner.run({ chatId: 'bot:b1', text: 'work' });
  const entries = bridge.ledger.recent();
  assert.equal(entries.find(e => e.kind === 'turn').tokens, 17);
  assert.equal(entries.find(e => e.kind === 'tool').tokens, 0);
  assert.equal(bridge.ledger.report().totals.errors, 2);
  bridge.stop();
});

test('a successful remote mutation remains acknowledged when audit persistence fails', async () => {
  const { bridge, frames, warnings } = await fixture();
  let effects = 0;
  bridge.tools.call = async () => { effects += 1; return { ok: true, structuredContent: { id: 'created' } }; };
  bridge.ledger.persist = async () => { throw new Error('SECRET_PATH disk full'); };
  const frame = { type: 'op.create_schedule', id: 'f', opId: 'o', from: 'phone', payload: {} };
  await bridge.handleFrame(frame); await bridge.handleFrame(frame);
  assert.equal(effects, 1);
  assert.equal(frames.filter(f => f.type === 'ack').length, 2);
  assert.ok(frames.some(f => f.type === 'evt.schedule_updated'));
  assert.ok(warnings.length > 0);
  assert.equal(JSON.stringify(warnings).includes('SECRET_PATH'), false);
  bridge.stop();
});

test('fallback dispatch request ids are collision resistant and explicit keys survive', () => {
  const original = Date.now; Date.now = () => 123;
  try {
    const keys = Array.from({ length: 100 }, () => buildToolArguments({ botIds: ['b'], prompt: 'work' }, undefined, 'dispatch_tasks').request_id);
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(buildToolArguments({ botIds: ['b'], prompt: 'work', requestId: 'stable' }, undefined, 'dispatch_tasks').request_id, 'stable');
  } finally { Date.now = original; }
});

test('stop aborts owned watchers and blocks stale callbacks, retries and new work without remote team cancellation', async () => {
  const ready = deferred(), end = deferred();
  /** @type {AbortSignal} */
  let signal;
  const { bridge, frames } = await fixture({ run: async (_input, options) => {
    signal = options.signal; options.onEvent({ type: 'turn.started', sessionId: 's1', turnId: 't' }); ready.resolve(); await end.promise;
    options.onEvent({ type: 'message.committed', sessionId: 's1', turnId: 't', text: 'stale' });
    return { sessionId: 'stale-session', turnId: 't' };
  } });
  const running = bridge.runner.run({ chatId: 'bot:b1', text: 'work' });
  await ready.promise;
  bridge.scheduleSnapshotRetry();
  bridge.stop();
  const before = frames.length;
  end.resolve(); await running;
  assert.equal(signal.aborted, true);
  assert.equal(frames.length, before);
  assert.equal(bridge.snapshotTimer, undefined);
  assert.equal(bridge.runner.sessionFor('bot:b1'), undefined);
  assert.equal(bridge.router.phoneSessions.has('bot:b1'), false);
  await assert.rejects(bridge.runner.run({ chatId: 'bot:b1', text: 'new' }), { code: 'BRIDGE_STOPPED' });
});

test('invalid modes including null and omission are rejected before configuration writes', async () => {
  const { bridge } = await fixture();
  const original = bridge.config;
  for (const mode of [undefined, null, 'tean', 42]) {
    await assert.rejects(bridge.setBotMode(/** @type {any} */ ({ botId: 'b1', mode })), { code: 'INVALID_ARGUMENTS' });
    assert.equal(bridge.config, original);
  }
  bridge.stop();
});

test('a late permission completion from a stopped generation cannot emit into its replacement', async () => {
  const ready = deferred(), finish = deferred();
  const { bridge, frames } = await fixture({ reply: async () => { ready.resolve(); await finish.promise; } });
  bridge.pending.add('permission', { requestId: 'p', chatId: 'bot:b1' }, 's1');
  const replying = bridge.runner.reply('p', 'deny');
  await ready.promise;
  bridge.stop(); bridge.stopped = false; bridge.runner.stopped = false;
  const before = frames.length;
  finish.resolve(); await replying;
  assert.equal(frames.length, before);
  bridge.stop();
});

test('a mutation completing in an old stopped generation cannot publish or acknowledge into the replacement', async () => {
  const ready = deferred(), finish = deferred();
  const { bridge, frames } = await fixture();
  bridge.tools.call = async () => { ready.resolve(); await finish.promise; return { ok: true, structuredContent: { id: 'created' } }; };
  const running = bridge.handleFrame({ type: 'op.create_schedule', id: 'f', opId: 'old', from: 'phone', payload: {} });
  await ready.promise;
  bridge.stop(); bridge.stopped = false; bridge.runner.stopped = false;
  const before = frames.length;
  finish.resolve(); await running;
  assert.equal(frames.length, before);
  bridge.stop();
});

test('overlapping polls retain their router reference until the last poll settles', async () => {
  const entered = deferred(), finish = deferred(); let polls = 0;
  const router = new BotRouter({}, { gateway: /** @type {any} */ ({ available: true, call: async (name) => {
    if (name === 'message_bot') return { ok: true, structuredContent: { batch_id: 'b', tasks: [{ task_id: 't' }] } };
    polls += 1;
    if (polls === 2) { entered.resolve(); await finish.promise; }
    return { ok: true, structuredContent: { tasks: [{ task_id: 't', status: 'done', result: 'done' }] } };
  } }) });
  const turn = await router.send({ chatId: 'bot:b', text: 'work' });
  const first = router.wait(turn), second = router.wait(turn);
  await entered.promise; await first;
  assert.equal(router.turns.size, 1);
  finish.resolve(); await second;
  assert.equal(router.turns.size, 0);
});

test('cancelling an already completed remote task does not abort its result watcher', async () => {
  const ready = deferred(), finish = deferred();
  /** @type {AbortSignal} */
  let signal;
  const router = new BotRouter({}, { gateway: /** @type {any} */ ({ available: true, call: async (name, _payload, options = {}) => {
    if (name === 'message_bot') return { ok: true, structuredContent: { batch_id: 'b', tasks: [{ task_id: 't' }] } };
    if (name === 'cancel_tasks') return { ok: true, structuredContent: { tasks: [{ task_id: 't', status: 'done' }] } };
    signal = options.signal; ready.resolve(); await finish.promise;
    return { ok: true, structuredContent: { tasks: [{ task_id: 't', status: 'done', result: 'finished before cancel' }] } };
  } }) });
  const runner = new AgentRunner({}, { router });
  const running = runner.run({ chatId: 'bot:b', text: 'work', mode: 'team' });
  await ready.promise;
  assert.equal(await runner.abort('t'), false);
  assert.equal(signal.aborted, false);
  finish.resolve();
  assert.equal((await running).text, 'finished before cancel');
});

test('an accepted answer without a continuation does not invent a turn', async () => {
  const { bridge, frames } = await fixture({ answer: async () => ({ sessionId: 's1', status: 'finished' }) });
  question(bridge);
  await bridge.runner.answer('q1', []);
  assert.equal(bridge.ledger.report().totals.turns, 0);
  assert.equal(frames.filter(f => f.type === 'evt.turn_finished').length, 0);
  assert.equal(bridge.pending.size, 0);
  bridge.stop();
});

test('a pending request retains its owning chat after the session index evicts it', async () => {
  const { bridge } = await fixture({ answer: async (_input, { onEvent }) => {
    onEvent({ type: 'turn.started', sessionId: 's1', turnId: 'continued' });
    onEvent({ type: 'message.committed', sessionId: 's1', turnId: 'continued', text: 'right chat' });
    return { sessionId: 's1', turnId: 'continued', status: 'finished' };
  } });
  question(bridge);
  for (let i = 0; i < 60; i += 1) bridge.runner.rememberSession(`bot:other${i}`, `s${i + 2}`);
  assert.equal(bridge.runner.sessionFor('bot:b1'), undefined);
  await bridge.runner.answer('q1', []);
  assert.ok(bridge.history.get('bot:b1').some(m => m.text === 'right chat'));
  assert.equal(bridge.history.has('unknown'), false);
  bridge.stop();
});

test('stop while roster lookup is pending cannot start a new Host session', async () => {
  let calls = 0;
  const ready = deferred(), roster = deferred();
  const { bridge } = await fixture({ run: async () => { calls += 1; return { sessionId: 's', status: 'finished' }; } });
  bridge.router.roster = async () => { ready.resolve(); return roster.promise; };
  const running = bridge.runner.run({ chatId: 'bot:b1', text: 'work' });
  await ready.promise; bridge.stop();
  roster.resolve({ bots: [{ botId: 'b1', name: 'Bot' }] });
  await running.catch(() => {});
  assert.equal(calls, 0);
});

test('stop during group mention lookup does not dispatch new official team work', async () => {
  const ready = deferred(), finish = deferred(); let effects = 0;
  const router = new BotRouter({}, { gateway: /** @type {any} */ ({ available: true, call: async () => {
    effects += 1;
    return { ok: true, structuredContent: { batch_id: 'b', tasks: [{ task_id: 't', status: 'done' }] } };
  } }), roster: async () => { ready.resolve(); await finish.promise; return { bots: [{ botId: 'b', name: 'Bot' }] }; } });
  const runner = new AgentRunner({}, { router });
  const running = runner.run({ chatId: 'group:g', text: 'work', mentions: ['b'] });
  await ready.promise; runner.stop(); finish.resolve();
  await running.catch(() => {});
  assert.equal(effects, 0);
});

test('a terminal continuation clears stale asks from its chat without clearing another active run', async () => {
  const { bridge } = await fixture({ answer: async (_input, { onEvent }) => {
    onEvent({ type: 'turn.started', sessionId: 's1', turnId: 'last' });
    return { sessionId: 's1', turnId: 'last', status: 'finished' };
  } });
  question(bridge);
  bridge.pending.add('permission', { requestId: 'old-permission', chatId: 'bot:b1', turnId: 'older' }, 's1');
  bridge.pending.add('permission', { requestId: 'other', chatId: 'bot:other', turnId: 'elsewhere' }, 'other-session');
  await bridge.runner.answer('q1', []);
  assert.equal(bridge.pending.get('old-permission'), undefined);
  assert.ok(bridge.pending.get('other'));
  bridge.stop();
});

test('team message batches survive reconnect queries and settled router references are retired', async () => {
  const { bridge, context } = await fixture({}, {});
  const team = createFakeTeam();
  context.tool = { list: async () => ({ tools: TEAM_TOOL_DESCRIPTORS }), call: team.call };
  await bridge.tools.refresh();
  for (let i = 0; i < 5; i += 1) await bridge.sendMessage({ chatId: 'bot:bot_b1', text: 'work' });
  assert.equal(bridge.router.turns.size, 0);
  assert.equal(bridge.ledger.batches().length, 5);
  assert.equal((await bridge.listKnownTasks()).tasks.length, 5);
  bridge.stop();
});
