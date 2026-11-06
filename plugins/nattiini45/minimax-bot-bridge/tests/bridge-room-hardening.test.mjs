import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Bridge } from '../miniapp/node/bridge.mjs';
import { BotRouter } from '../miniapp/node/bot-router.mjs';
import { AgentRunner, MAX_CONCURRENT_RUNS } from '../miniapp/node/agent.mjs';
import { saveConfig } from '../miniapp/node/config.mjs';
import { TEAM_TOOL_DESCRIPTORS, createFakeTeam } from './fake-team.mjs';

// The scratch root lives in the operating system's temporary directory, so the suite
// runs the same way in the workspace, in a published package and in an installed one.
const ROOT = join(tmpdir(), 'minimax-bot-bridge-tests', 'bridge-rooms');
const A = { relayUrl: 'https://a.example', accountId: 'a', bridgeId: 'desktop', bridgeToken: 'A', bridgeName: 'Desk' };
const B = { ...A, relayUrl: 'https://b.example', accountId: 'b', bridgeToken: 'B' };
const settle = () => new Promise(setImmediate);
function deferred() {
  /** @type {(value?: any) => void} */ let resolve = () => {};
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
class Socket {
  static instances = [];
  readyState = 0;
  sent = [];
  handlers = new Map();
  constructor(url) { this.url = url; Socket.instances.push(this); }
  addEventListener(type, callback) { this.handlers.set(type, callback); }
  send(raw) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.handlers.get('close')?.({}); }
  open() { this.readyState = 1; this.handlers.get('open')?.({}); }
}
async function fixture(t, agent = {}) {
  await mkdir(ROOT, { recursive: true });
  const root = await mkdtemp(join(ROOT, 'room-'));
  const dataDir = join(root, 'minimax-bot-bridge');
  await saveConfig(dataDir, A);
  Socket.instances = [];
  const oldSocket = globalThis.WebSocket;
  globalThis.WebSocket = /** @type {any} */ (Socket);
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 404 }));
  const team = createFakeTeam();
  const context = { dataDir, agent, logger: { info() {}, warn() {}, error() {}, debug() {} },
    tool: { list: async () => ({ tools: TEAM_TOOL_DESCRIPTORS }), call: team.call } };
  const bridge = new Bridge(context, { config: { ...A } });
  await bridge.start(); await settle();
  Socket.instances.at(-1).open(); await settle();
  t.after(() => { bridge.stop(); globalThis.WebSocket = oldSocket; });
  const switchRoom = async (config) => {
    await bridge.commitConfig(() => ({ ...config }), { reconfigure: true });
    await settle(); Socket.instances.at(-1).open(); await settle();
    return Socket.instances.at(-1);
  };
  return { bridge, dataDir, root, switchRoom, team };
}
function frame(type, payload = {}, opId = type) { return { type, payload, id: opId, opId, from: 'same-phone' }; }

test('A operations and callbacks cannot emit results or approvals into B, and B cannot claim A requests', async t => {
  const finish = deferred(), started = deferred();
  /** @type {{signal: AbortSignal, onEvent: (event: unknown) => void} | undefined} */
  let options;
  let starts = 0;
  const replies = [];
  const { bridge, switchRoom } = await fixture(t, {
    run: async (_input, callbacks) => {
      options = callbacks;
      starts += 1;
      callbacks.onEvent({ type: 'turn.started', sessionId: 'A-session', turnId: 'A-turn' });
      callbacks.onEvent({ type: 'permission.requested', sessionId: 'A-child', turnId: 'A-child-turn', requestId: 'A-permission', toolName: 'shell', reason: 'A-private' });
      started.resolve(); await finish.promise;
      callbacks.onEvent({ type: 'permission.requested', sessionId: 'A-session', turnId: 'A-turn', requestId: 'A-late', toolName: 'shell', reason: 'A-private' });
      callbacks.onEvent({ type: 'message.committed', sessionId: 'A-session', turnId: 'A-turn', text: 'A-private answer' });
      return { sessionId: 'A-session', turnId: 'A-turn', status: 'finished', text: 'A-private answer' };
    }, reply: async input => { replies.push(input); },
  });
  await bridge.setBotMode({ botId: 'bot_b1', mode: 'hosted' });
  const oldRunner = bridge.runner;
  const running = bridge.handleFrame(frame('op.send_message', { chatId: 'bot:bot_b1', text: 'A-private work' }, 'A-op'));
  await started.promise;
  const queued = bridge.handleFrame(frame('op.send_message', { chatId: 'bot:bot_b1', text: 'A-private queued work' }, 'A-queued'));
  const socketB = await switchRoom(B);
  assert.ok(options);
  assert.equal(options.signal.aborted, true);
  assert.notEqual(bridge.runner, oldRunner);
  assert.equal(bridge.pending.size, 0);
  await bridge.handleFrame(frame('op.respond_permission', { requestId: 'A-permission', decision: 'allowOnce' }, 'B-answer'));
  assert.deepEqual(replies, []);
  assert.equal(socketB.sent.find(f => f.type === 'err' && f.payload.opId === 'B-answer')?.payload.code, 'REQUEST_NOT_FOUND');
  const returnedA = await switchRoom(A);
  finish.resolve(); await Promise.all([running, queued]);
  assert.equal(starts, 1, 'an old queued turn cannot start even after returning to the same room');
  bridge.replayPending(); await settle();
  assert.equal(returnedA.sent.some(f => f.payload?.opId === 'A-op' || f.payload?.opId === 'A-queued'), false);
  assert.equal(JSON.stringify(socketB.sent).includes('A-private'), false);
  assert.equal(socketB.sent.some(f => f.payload?.opId === 'A-op' || f.payload?.request?.requestId === 'A-late'), false);
  assert.equal(bridge.runner.sessions.size, 0);
  assert.equal(bridge.router.phoneSessions.size, 0);
});

test('room ledgers, batches, history, reactions and dedupe are partitioned, including late tool persistence and A to B to A', async t => {
  const { bridge, switchRoom, dataDir } = await fixture(t);
  bridge.pushHistory('bot:bot_b1', { messageId: 'A-message', chatId: 'bot:bot_b1', role: 'assistant', text: 'A-private', ts: 1 });
  bridge.react({ messageId: 'A-message', emoji: 'yes' });
  bridge.ledger.recordPermission({ requestId: 'A-permission', toolName: 'shell', deviceId: 'phone', decision: 'deny' });
  bridge.ledger.rememberBatch('A-batch'); await bridge.ledger.persist();
  const ledgerA = bridge.ledger;
  const ready = deferred(), finish = deferred(); let calls = 0;
  const originalCall = bridge.tools.call.bind(bridge.tools);
  bridge.tools.call = async (name, payload) => {
    if (name !== 'create_schedule') return originalCall(name, payload);
    calls += 1; ready.resolve(); await finish.promise;
    return { ok: true, structuredContent: { private: 'A-private result', batch_id: 'A-late-batch' } };
  };
  const running = bridge.handleFrame(frame('op.create_schedule', {}, 'shared-key'));
  await ready.promise;
  const socketB = await switchRoom(B);
  assert.notEqual(bridge.ledger, ledgerA);
  assert.equal(bridge.ledger.report().totals.tools, 0);
  assert.deepEqual(bridge.ledger.batches(), []);
  assert.equal(bridge.history.size, 0); assert.equal(bridge.reactions.size, 0); assert.equal(bridge.opCache.size, 0);
  finish.resolve(); await running;
  assert.equal(bridge.ledger.report().totals.tools, 0);
  assert.equal(JSON.stringify(socketB.sent).includes('A-private'), false);
  bridge.tools.call = async (name, payload) => {
    if (name !== 'create_schedule') return originalCall(name, payload);
    calls += 1; return { ok: true, structuredContent: { id: 'B-result' } };
  };
  await bridge.handleFrame(frame('op.create_schedule', {}, 'shared-key'));
  assert.equal(calls, 2, 'the same device/key in B must not reuse A results');
  assert.equal(bridge.ledger.report().totals.tools, 1);
  await switchRoom(A);
  assert.ok(bridge.ledger.entries.some(entry => entry.requestId === 'A-permission'));
  assert.ok(bridge.ledger.batches().includes('A-late-batch'));
  assert.equal(bridge.pending.size, 0);
  assert.equal(bridge.opCache.size, 0);
  await bridge.ledger.persist();
  bridge.stop();
  const restarted = new Bridge({ ...bridge.context, dataDir }, { config: A });
  await restarted.ledger.init();
  assert.ok(restarted.ledger.entries.some(entry => entry.requestId === 'A-permission'));
  restarted.stop();
});

test('late A persistence after A to B to A cannot overwrite records newly admitted in A', async t => {
  const { bridge, switchRoom, dataDir } = await fixture(t);
  const ready = deferred(), finish = deferred();
  const originalCall = bridge.tools.call.bind(bridge.tools);
  bridge.tools.call = async (name, payload) => {
    if (name !== 'create_schedule') return originalCall(name, payload);
    ready.resolve(); await finish.promise;
    return { ok: true, structuredContent: { id: 'old-A-private result' } };
  };
  const old = bridge.handleFrame(frame('op.create_schedule', {}, 'old-A'));
  await ready.promise; await switchRoom(B); const returnedA = await switchRoom(A);
  bridge.ledger.recordPermission({ requestId: 'new-A-record', toolName: 'shell', deviceId: 'phone', decision: 'deny' });
  await bridge.ledger.persist();
  finish.resolve(); await old;
  assert.equal(returnedA.sent.some(f => f.payload?.opId === 'old-A'), false);
  const reopened = new Bridge({ ...bridge.context, dataDir }, { config: A });
  await reopened.ledger.init();
  assert.ok(reopened.ledger.entries.some(entry => entry.requestId === 'new-A-record'));
  assert.equal(reopened.ledger.report().totals.tools, 1);
  reopened.stop();
});

test('explicit team idempotency keys stay stable within a room without adopting another room\'s cached receipt', async t => {
  const { bridge, switchRoom } = await fixture(t);
  bridge.tools.catalog.push({ name: 'mcp__minimax-bot__dispatch_tasks', server: 'minimax-bot', tool: 'dispatch_tasks' });
  const call = bridge.context.tool.call;
  const receipts = new Map(); const requests = [];
  bridge.context.tool.call = async (name, args) => {
    if (!name.endsWith('__dispatch_tasks')) return call(name, args);
    requests.push(args.request_id);
    assert.match(args.request_id, /^[\w.-]{1,128}$/);
    // The official dispatcher keys its retained receipts by caller + request_id,
    // not relay room. Keep that actual shared-Desktop contract in this control.
    if (!receipts.has(args.request_id)) receipts.set(args.request_id, {
      batch_id: `batch-${receipts.size + 1}`, request_id: args.request_id,
      tasks: [{ task_id: `task-${receipts.size + 1}`, status: 'done', bot_id: 'bot_b1' }],
    });
    return { kind: 'mcp', structuredContent: { value: receipts.get(args.request_id) } };
  };
  const payload = { botIds: ['bot_b1'], prompt: 'same work', requestId: 'same-client-key' };
  const first = await bridge.dispatch('op.dispatch', payload);
  const retry = await bridge.dispatch('op.dispatch', payload);
  assert.equal(first.batchId, retry.batchId);
  await switchRoom(B);
  const other = await bridge.dispatch('op.dispatch', payload);
  assert.notEqual(other.batchId, first.batchId, 'B cannot adopt the globally cached A receipt');
  await switchRoom(A);
  const again = await bridge.dispatch('op.dispatch', payload);
  assert.equal(again.batchId, first.batchId);
  assert.equal(requests[0], requests[1]); assert.equal(requests[0], requests[3]);
  assert.notEqual(requests[0], requests[2]);
});

test('token-only and cosmetic saves keep valid same-room work, pending claims, session maps and caches', async t => {
  const { bridge } = await fixture(t);
  const original = { runner: bridge.runner, ledger: bridge.ledger, epoch: bridge.lifecycleEpoch, relayEpoch: bridge.relay.epoch };
  bridge.pending.add('permission', { requestId: 'same-room' }, 'same-session');
  bridge.runner.rememberSession('bot:bot_b1', 'same-session');
  bridge.opCache.set('same-key', { promise: Promise.resolve({ ok: true, value: 'same-room' }), expiresAt: Date.now() + 10000 });
  await bridge.commitConfig(current => ({ ...current, bridgeName: 'Renamed' }), { reconfigure: true });
  assert.equal(bridge.relay.epoch, original.relayEpoch, 'renaming must not reset the authority connection');
  await bridge.commitConfig(current => ({ ...current, bridgeToken: 'A-renewed' }), { reconfigure: true });
  assert.equal(bridge.runner, original.runner); assert.equal(bridge.ledger, original.ledger);
  assert.equal(bridge.lifecycleEpoch, original.epoch);
  assert.ok(bridge.pending.get('same-room')); assert.ok(bridge.opCache.has('same-key'));
  assert.equal(bridge.runner.sessionFor('bot:bot_b1'), 'same-session');
});

test('simultaneous first hosted messages in one chat reuse one session within the declared four-run Host cap', async () => {
  const first = deferred(), finish = deferred(); const calls = []; let active = 0;
  const router = new BotRouter({ agent: { run: async (input, { onEvent }) => {
    calls.push(input); active += 1; assert.ok(active <= 4);
    const sessionId = input.sessionId ?? `session-${calls.length}`;
    const turnId = `turn-${calls.length}`;
    onEvent?.({ type: 'turn.started', sessionId, turnId });
    if (calls.length === 1) { first.resolve(); await finish.promise; }
    active -= 1;
    return { sessionId, turnId, status: 'finished' };
  } } }, { roster: async () => ({ bots: [{ botId: 'b', name: 'Bot' }] }) });
  const one = router.hosted({ chatId: 'bot:b', botId: 'b', text: 'first' });
  await first.promise;
  const two = router.hosted({ chatId: 'bot:b', botId: 'b', text: 'second' });
  try {
    await settle(); assert.equal(calls.length, 1, 'the second blank-chat run must wait for session establishment');
  } finally { finish.resolve(); await Promise.all([one, two]); }
  assert.equal(calls[0].sessionId, undefined); assert.equal(calls[1].sessionId, 'session-1');
  assert.equal(router.phoneSessions.get('bot:b'), 'session-1');
  assert.equal(router.hostedQueues.size, 0);
});

test('different hosted chats may run in parallel while per-chat waiting work is bounded and cannot start after stop', async () => {
  const finish = deferred(); const calls = [];
  const router = new BotRouter({ agent: { run: async input => {
    calls.push(input); await finish.promise;
    return { sessionId: input.sessionId ?? `session-${calls.length}`, status: 'finished' };
  } } }, { roster: async () => ({ bots: [{ botId: 'b', name: 'Bot' }, { botId: 'other', name: 'Other' }] }) });
  const runner = new AgentRunner(router.context, { router });
  const work = [runner.run({ chatId: 'bot:b', text: 'first' }), runner.run({ chatId: 'bot:other', text: 'parallel' })];
  await settle(); assert.equal(calls.length, 2);
  for (let i = 2; i < MAX_CONCURRENT_RUNS; i += 1) work.push(runner.run({ chatId: 'bot:b', text: `queued ${i}` }));
  await assert.rejects(runner.run({ chatId: 'bot:b', text: 'overflow' }), { code: 'BUSY' });
  runner.stop(); finish.resolve(); await Promise.allSettled(work);
  assert.equal(calls.length, 2, 'stale queued runs must never call Host');
  assert.equal(router.hostedQueues.size, 0); assert.equal(runner.activeRuns, 0);
});

test('configured paired rooms read existing Desktop messages and activity without bridge admission records', async t => {
  const { bridge, root, switchRoom } = await fixture(t);
  await mkdir(join(root, 'minimax-bot', 'messages'), { recursive: true });
  const path = join(root, 'minimax-bot', 'messages', 'bot_bot_b1.json');
  const transcript = JSON.stringify([
    { id: 'desktop-user', chatId: 'bot:bot_b1', role: 'user', text: 'Existing Desktop question', ts: 1 },
    { id: 'desktop-reply', chatId: 'bot:bot_b1', role: 'bot', taskId: 'desktop-task', text: 'Existing Desktop answer', ts: 2,
      parts: [{ type: 'tool', name: 'read', state: 'ok' }, { type: 'text', text: 'Existing Desktop answer' }] },
  ]);
  await writeFile(path, transcript, 'utf8');
  assert.equal(bridge.ledger.historyRefs.length, 0);
  const first = await bridge.historyFor('bot:bot_b1');
  assert.deepEqual(first.messages.map(message => message.messageId), ['desktop-user', 'desktop-reply']);
  assert.equal(first.messages[0].origin, 'desktop');
  assert.equal(first.activity.length, 1);
  assert.equal(first.activity[0].toolName, 'read');
  assert.equal(first.activity[0].turnId, 'desktop-task');

  bridge.ledger.rememberTurn({ chatId: 'bot:bot_b1', taskId: 'desktop-task' });
  const readback = await bridge.dispatch('op.list_history', { chatId: 'bot:bot_b1' });
  assert.deepEqual(readback.messages, first.messages, 'registering a task must not hide the Desktop user message');
  assert.deepEqual(readback.activity, first.activity);
  bridge.pushHistory('bot:bot_b1', { messageId: 'private-hosted', chatId: 'bot:bot_b1', role: 'assistant', text: 'A-private hosted reply', ts: 3 });
  assert.equal((await bridge.historyFor('bot:bot_b1')).messages.length, 3);
  await switchRoom(B);
  const nextRoom = await bridge.historyFor('bot:bot_b1');
  assert.deepEqual(nextRoom.messages, first.messages, 'pairing authorizes the same official Desktop history');
  assert.deepEqual(nextRoom.activity, first.activity);
  assert.equal(nextRoom.messages.some(message => message.messageId === 'private-hosted'), false);
  assert.equal(await readFile(path, 'utf8'), transcript, 'Desktop history remains read-only');
});

test('configured team history uses the official Desktop user record once, without a cached optimistic duplicate', async t => {
  const { bridge, root } = await fixture(t);
  const text = 'The current phone message';
  await bridge.sendMessage({ chatId: 'bot:bot_b1', text });
  await mkdir(join(root, 'minimax-bot', 'messages'), { recursive: true });
  await writeFile(join(root, 'minimax-bot', 'messages', 'bot_bot_b1.json'), JSON.stringify([
    { id: 'desktop-incoming', chatId: 'bot:bot_b1', role: 'relay', text, ts: 1 },
  ]), 'utf8');
  const history = await bridge.historyFor('bot:bot_b1');
  assert.deepEqual(history.messages.filter(message => message.text === text).map(message => message.messageId), ['desktop-incoming']);
});

test('explicit Desktop task selectors reach Host authorization while automatic known-batch reconstruction stays room-scoped', async t => {
  const { bridge, team, switchRoom } = await fixture(t);
  team.seedTask({ task_id: 'desktop-one', batch_id: 'desktop-batch-one', status: 'running' });
  team.seedTask({ task_id: 'desktop-two', batch_id: 'desktop-batch-two', status: 'running' });
  const originalCall = bridge.context.tool.call;
  const calls = [];
  bridge.context.tool.call = async (name, args) => { calls.push({ name, args }); return originalCall(name, args); };
  assert.deepEqual((await bridge.dispatch('op.list_tasks', {})).tasks, []);
  assert.equal(calls.filter(call => call.name.endsWith('__get_tasks')).length, 0);

  const one = await bridge.dispatch('op.list_tasks', { taskId: 'desktop-one' });
  assert.equal(one.tasks[0].taskId, 'desktop-one');
  const two = await bridge.dispatch('op.list_tasks', { batchId: 'desktop-batch-two' });
  assert.equal(two.tasks[0].taskId, 'desktop-two');
  const cancelledOne = await bridge.dispatch('op.cancel_task', { taskId: 'desktop-one' });
  assert.equal(cancelledOne.tasks[0].state, 'cancelled');
  assert.ok(calls.some(call => call.name.endsWith('__cancel_tasks') && call.args.task_id === 'desktop-one'));
  assert.ok((await bridge.dispatch('op.list_tasks', {})).tasks.length > 0);

  await switchRoom(B);
  const before = calls.filter(call => call.name.endsWith('__get_tasks')).length;
  assert.deepEqual((await bridge.dispatch('op.list_tasks', {})).tasks, []);
  assert.equal(calls.filter(call => call.name.endsWith('__get_tasks')).length, before);
  assert.equal((await bridge.dispatch('op.list_tasks', { taskId: 'desktop-two' })).tasks[0].taskId, 'desktop-two');
  const cancelledTwo = await bridge.dispatch('op.cancel_task', { batchId: 'desktop-batch-two' });
  assert.equal(cancelledTwo.tasks[0].state, 'cancelled');
  assert.ok(calls.some(call => call.name.endsWith('__cancel_tasks') && call.args.batch_id === 'desktop-batch-two'));
  await assert.rejects(bridge.dispatch('op.cancel_task', { taskId: 'missing-desktop-task' }), {
    code: 'TOOL_REPORTED_ERROR', message: 'no such task',
  });
  assert.ok(calls.some(call => call.name.endsWith('__cancel_tasks') && call.args.task_id === 'missing-desktop-task'));
});

test('unattributed legacy bridge audit records remain private and are never assigned to a newly configured room', async t => {
  const { bridge, dataDir, switchRoom } = await fixture(t);
  const legacy = JSON.stringify({ entries: [{ kind: 'permission', requestId: 'legacy-private' }], batchIds: ['legacy-batch'] });
  await writeFile(join(dataDir, 'ledger.json'), legacy, 'utf8');
  await switchRoom(B);
  assert.equal(bridge.ledger.entries.some(entry => entry.requestId === 'legacy-private'), false);
  assert.deepEqual(bridge.ledger.batches(), []);
  assert.equal(await readFile(join(dataDir, 'ledger.json'), 'utf8'), legacy);
  await switchRoom(A);
  assert.equal(bridge.ledger.entries.some(entry => entry.requestId === 'legacy-private'), false);
  assert.equal(await readFile(join(dataDir, 'ledger.json'), 'utf8'), legacy);
});
