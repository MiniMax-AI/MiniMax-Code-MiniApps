import assert from 'node:assert/strict';
import test from 'node:test';
import { createAskObserver } from '../miniapp/client/ask-observer.mjs';

const settle = () => new Promise((resolve) => setImmediate(resolve));
const row = (sessionId, observedTurnId = 't1', updatedAtMs = 1, status = 'running') => ({ sessionId, observedTurnId, updatedAtMs, status });
function deferred() {
  let resolve, reject, settled = false;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return {
    promise,
    resolve(value) { settled = true; resolve(value); },
    reject(error) { settled = true; reject(error); },
    get settled() { return settled; },
  };
}
function harness(t, options = {}) {
  const streams = [], changes = [], cancelled = [];
  const agent = {
    observe(input, callbacks) {
      const end = deferred(); streams.push({ input, callbacks, end }); return end.promise;
    },
    cancel(id) {
      cancelled.push(id);
      if (!options.holdCancellation) streams.find((stream) => stream.input.requestId === id)?.end.resolve();
    },
  };
  const observer = createAskObserver({ ...options, agent, onChange(state) { changes.push(state); options.onChange?.(state, observer); } });
  const update = (sessions = [row('a')], patch = {}) => observer.update({ availability: 'ready', sessions, ...patch });
  const streamFor = (id) => streams.findLast((stream) => stream.input.sessionId === id);
  const event = (type, { id = 'a', turnId = 't1', name = 'ask_user', stream = streamFor(id), ...extra } = {}) => {
    stream.callbacks.onEvent({ type, sessionId: id, turnId, name, ...extra });
  };
  t.after(() => observer.dispose());
  return { observer, streams, changes, cancelled, update, event, streamFor, state: () => observer.getState() };
}

test('only ready running sessions are watched, and observation alone never invents an ask', async (t) => {
  const h = harness(t);
  h.update([row('a'), row('b', 't1', 2, 'idle')], { availability: 'connecting' });
  assert.deepEqual(h.state(), { needsAnswerIds: [], watchingIds: [], runningCount: 0 });
  h.update([row('a'), row('b', 't1', 2, 'idle')]);
  assert.equal(h.streams.length, 1);
  assert.deepEqual(h.state(), { needsAnswerIds: [], watchingIds: ['a'], runningCount: 1 });
  assert.deepEqual(Object.keys(h.streams[0].input).sort(), ['requestId', 'sessionId']);
  assert.equal(h.changes.length, 0, 'onChange is never synchronous with update');
  await settle(); assert.equal(h.changes.length, 1);
});

test('selected running session wins a slot; recent order fills only the bounded remainder', (t) => {
  const h = harness(t);
  h.update([row('a', 't1', 1), row('b', 't1', 2), row('c', 't1', 3), row('d', 't1', 4)], { selectedSessionId: 'a' });
  assert.deepEqual(h.state(), { needsAnswerIds: [], watchingIds: ['a', 'd', 'c'], runningCount: 4 });
});

test('live ask becomes visible after the delay and stays visible through running snapshots', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t);
  h.update(); h.event('tool.started');
  t.mock.timers.tick(119); assert.deepEqual(h.state().needsAnswerIds, []);
  t.mock.timers.tick(1); assert.deepEqual(h.state().needsAnswerIds, ['a']);
  h.update(); assert.deepEqual(h.state().needsAnswerIds, ['a']);
  await settle(); assert.deepEqual(h.changes.at(-1).needsAnswerIds, ['a']);
  h.event('tool.finished', { ok: true });
  assert.deepEqual(h.state().needsAnswerIds, [], 'clear immediately, without waiting for a timer');
});

test('same-tick finished and failed asks never flash a pending label', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t); h.update();
  h.event('tool.started'); h.event('tool.finished', { ok: true });
  h.event('tool.started'); h.event('tool.finished', { ok: false });
  t.mock.timers.tick(1000); await settle();
  assert.deepEqual(h.state().needsAnswerIds, []);
  assert.ok(h.changes.every((change) => change.needsAnswerIds.length === 0));
});

test('other tools do not clear an ask, and concurrent same-name calls require both finishes', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t); h.update();
  h.event('tool.started'); h.event('tool.started');
  h.event('tool.started', { name: 'bash' }); h.event('tool.finished', { name: 'bash', ok: true });
  t.mock.timers.tick(120);
  h.event('tool.finished', { ok: true }); assert.deepEqual(h.state().needsAnswerIds, ['a']);
  h.event('tool.finished', { ok: false }); assert.deepEqual(h.state().needsAnswerIds, []);
  h.event('tool.finished', { ok: true }); assert.deepEqual(h.state().needsAnswerIds, []);
});

test('turn terminal clears waiting and rejects late tools in that turn', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t); h.update(); h.event('tool.started'); t.mock.timers.tick(120);
  h.event('turn.finished', { status: 'finished' });
  h.event('tool.started'); h.event('turn.started'); t.mock.timers.tick(120);
  assert.deepEqual(h.state().needsAnswerIds, []);
});

test('new snapshot turn clears waiting and fences delayed old tools and terminals', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t); h.update(); h.event('tool.started'); t.mock.timers.tick(120);
  h.update([row('a', 't2')]); assert.deepEqual(h.state().needsAnswerIds, []);
  h.event('tool.started'); t.mock.timers.tick(120); assert.deepEqual(h.state().needsAnswerIds, []);
  h.event('tool.started', { turnId: 't2' }); t.mock.timers.tick(120);
  h.event('turn.finished', { status: 'finished' }); h.event('tool.finished', { ok: true });
  assert.deepEqual(h.state().needsAnswerIds, ['a']);
});

test('live new turn is not rolled back by a lagging snapshot of its retired predecessor', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t); h.update();
  h.event('turn.started', { turnId: 't2' }); h.event('tool.started', { turnId: 't2' });
  t.mock.timers.tick(120); h.update([row('a', 't1')]);
  assert.deepEqual(h.state().needsAnswerIds, ['a']);
  h.event('turn.started', { turnId: 't1' }); h.event('turn.finished', { status: 'finished' });
  assert.deepEqual(h.state().needsAnswerIds, ['a']);
});

test('unknown snapshot turn can learn its first live tool turn; known turn rejects mismatches', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t); h.update([row('a', null)]);
  h.event('tool.started', { turnId: 'known' }); t.mock.timers.tick(120);
  assert.deepEqual(h.state().needsAnswerIds, ['a']);
  h.update([row('a', 'known')]);
  h.event('tool.finished', { turnId: 'other', ok: true });
  h.event('tool.finished', { id: 'wrong', stream: h.streamFor('a'), turnId: 'known', ok: true });
  assert.deepEqual(h.state().needsAnswerIds, ['a']);
});

test('snapshot non-running or removal clears and cancels, without retaining facts privately', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t); h.update(); h.event('tool.started'); t.mock.timers.tick(120);
  const old = h.streamFor('a'); h.update([row('a', 't1', 2, 'idle')]);
  assert.deepEqual(h.state(), { needsAnswerIds: [], watchingIds: [], runningCount: 0 });
  h.event('tool.started', { stream: old }); t.mock.timers.tick(120);
  assert.equal(h.cancelled.length, 1); await settle();
  h.update(); assert.equal(h.streams.length, 2, 'a removed and re-entered row may watch again');
});

test('disconnect clears waiting, fences late callbacks, and explicit reconnection permits a new tail', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t); h.update(); h.event('tool.started'); t.mock.timers.tick(120);
  const old = h.streamFor('a'); h.update([row('a')], { availability: 'unavailable' });
  h.event('tool.started', { stream: old }); t.mock.timers.tick(120);
  assert.deepEqual(h.state().needsAnswerIds, []); await settle();
  h.update(); assert.equal(h.streams.length, 2);
  assert.deepEqual(h.state().needsAnswerIds, [], 'reconnecting never infers an old unanswered question');
});

test('failed observers do not retry on repeated same-turn snapshots; new turn retries once', async (t) => {
  const h = harness(t); h.update(); h.streamFor('a').end.reject(new Error('runtime_unavailable'));
  await settle();
  for (let i = 0; i < 5; i++) h.update();
  assert.equal(h.streams.length, 1); assert.deepEqual(h.state().watchingIds, []);
  h.update([row('a', 't2')]); assert.equal(h.streams.length, 2);
  h.streamFor('a').end.resolve(); await settle(); h.update([row('a', 't2')]);
  assert.equal(h.streams.length, 2, 'unexpected EOF also blocks same-turn retry');
  h.update([]); h.update([row('a', 't2')]); assert.equal(h.streams.length, 3);
});

test('same-turn failure remains blocked when the lifecycle snapshot catches up to live turn', async (t) => {
  const h = harness(t); h.update(); h.event('turn.started', { turnId: 't2' });
  h.streamFor('a').end.reject(new Error('gone')); await settle();
  h.update([row('a', 't2')]); assert.equal(h.streams.length, 1);
  h.update([row('a', 't3')]); assert.equal(h.streams.length, 2);
});

test('pending asks keep their slots while selected session preempts another stable watcher', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t); const rows = [row('a', 't1', 4), row('b', 't1', 3), row('c', 't1', 2), row('d', 't1', 1)];
  h.update(rows); h.event('tool.started', { id: 'a' });
  h.update(rows, { selectedSessionId: 'd' }); await settle();
  assert.deepEqual(h.state().watchingIds, ['a', 'b', 'd']);
  assert.equal(h.cancelled[0], h.streams.find((stream) => stream.input.sessionId === 'c').input.requestId);
  t.mock.timers.tick(120); assert.deepEqual(h.state().needsAnswerIds, ['a']);
});

test('replacement admission waits for cancelled stream to settle and never exceeds its quota', async (t) => {
  const h = harness(t, { maxSubscriptions: 1, holdCancellation: true });
  const rows = [row('a', 't1', 3), row('b', 't1', 2)];
  h.update(rows); const old = h.streamFor('a');
  h.update(rows, { selectedSessionId: 'b' });
  assert.deepEqual(h.state().watchingIds, []); assert.equal(h.streams.length, 1);
  h.update(rows, { selectedSessionId: 'b' }); assert.equal(h.streams.length, 1);
  old.end.resolve(); await settle();
  assert.deepEqual(h.state().watchingIds, ['b']); assert.equal(h.streams.length, 2);
});

test('inactive and removed sessions release slots for waiting active sessions after cancellation settles', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t, { holdCancellation: true });
  h.update([row('a', 't1', 5), row('b', 't1', 4), row('c', 't1', 3), row('d', 't1', 2), row('e', 't1', 1)]);
  const oldA = h.streamFor('a'), oldB = h.streamFor('b');
  h.event('tool.started', { id: 'a' }); t.mock.timers.tick(120);
  const active = [row('a', 't1', 6, 'idle'), row('c', 't1', 3), row('d', 't1', 2), row('e', 't1', 1)];
  h.update(active);
  assert.deepEqual(h.state(), { needsAnswerIds: [], watchingIds: ['c'], runningCount: 3 });
  assert.deepEqual(new Set(h.cancelled), new Set([oldA.input.requestId, oldB.input.requestId]));
  h.update(active); assert.equal(h.streams.length, 3, 'cancel acknowledgement alone cannot admit a replacement');
  h.event('tool.started', { id: 'a', stream: oldA }); t.mock.timers.tick(120);
  assert.deepEqual(h.state().needsAnswerIds, [], 'late callbacks from an inactive session remain fenced');
  oldA.end.resolve(); await settle();
  assert.deepEqual(h.state().watchingIds, ['c', 'd']);
  assert.equal(h.streams.filter((stream) => !stream.end.settled).length, 3);
  oldB.end.resolve(); await settle();
  assert.deepEqual(h.state().watchingIds, ['c', 'd', 'e']);
  assert.equal(h.streams.filter((stream) => !stream.end.settled).length, 3);
});

test('three pending asks retain their slots when a fourth active session becomes selected', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t);
  const rows = [row('a', 't1', 4), row('b', 't1', 3), row('c', 't1', 2), row('d', 't1', 1)];
  h.update(rows);
  for (const id of ['a', 'b', 'c']) h.event('tool.started', { id });
  h.update(rows, { selectedSessionId: 'd' }); t.mock.timers.tick(120);
  assert.deepEqual(h.state().watchingIds, ['a', 'b', 'c']);
  assert.deepEqual(h.state().needsAnswerIds, ['a', 'b', 'c']);
  assert.deepEqual(h.cancelled, []);
});

test('immediate reconnection keeps retiring streams in the three-slot budget until each ends', async (t) => {
  const h = harness(t, { holdCancellation: true });
  const rows = [row('a', 't1', 4), row('b', 't1', 3), row('c', 't1', 2), row('d', 't1', 1)];
  h.update(rows);
  const previous = [...h.streams];
  h.update(rows, { availability: 'unavailable' });
  h.update(rows, { selectedSessionId: 'd' });
  assert.deepEqual(h.state().watchingIds, []); assert.equal(h.streams.length, 3);
  for (let i = 0; i < previous.length; i++) {
    previous[i].end.resolve(); await settle();
    assert.equal(h.streams.filter((stream) => !stream.end.settled).length, 3,
      'with the separate global observer, at most four Host slots are occupied');
    assert.equal(h.state().watchingIds.length, i + 1);
  }
  assert.deepEqual(h.state().watchingIds, ['d', 'a', 'b']);
  assert.equal(new Set(h.streams.slice(3).map((stream) => stream.input.requestId)).size, 3);
});

test('stable watchers are retained when only recent timestamps change', (t) => {
  const h = harness(t); h.update([row('a', 't1', 4), row('b', 't1', 3), row('c', 't1', 2), row('d', 't1', 1)]);
  h.update([row('a', 't1', 1), row('b', 't1', 2), row('c', 't1', 3), row('d', 't1', 99)]);
  assert.deepEqual(h.state().watchingIds, ['a', 'b', 'c']); assert.equal(h.streams.length, 3);
});

test('onChange may synchronously feed update without recursion or duplicate subscriptions', async (t) => {
  const h = harness(t, { onChange(_state, observer) { observer.update({ availability: 'ready', sessions: [row('a')] }); } });
  h.update(); await settle(); await settle();
  assert.equal(h.changes.length, 1); assert.equal(h.streams.length, 1);
});

test('dispose cancels timers and streams and emits no delayed or terminal callbacks', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t); h.update(); h.event('tool.started'); await settle();
  const count = h.changes.length, old = h.streamFor('a'); h.observer.dispose();
  h.event('tool.started', { stream: old }); t.mock.timers.tick(1000); await settle();
  h.update(); assert.equal(h.changes.length, count); assert.equal(h.cancelled.length, 1);
  assert.deepEqual(h.state(), { needsAnswerIds: [], watchingIds: [], runningCount: 0 });
});

test('unsupported API and zero quota do not create observations', (t) => {
  const h = harness(t, { maxSubscriptions: 0 }); h.update();
  assert.deepEqual(h.state(), { needsAnswerIds: [], watchingIds: [], runningCount: 1 });
  const unsupported = createAskObserver({ agent: {}, onChange() {} });
  unsupported.update({ availability: 'ready', sessions: [row('a')] });
  assert.deepEqual(unsupported.getState(), { needsAnswerIds: [], watchingIds: [], runningCount: 0 });
  unsupported.dispose();
});

test('configured quota watches three active sessions and leaves one Host slot for global lifecycle', (t) => {
  const h = harness(t, { maxSubscriptions: 100 });
  h.update([row('a'), row('b'), row('c'), row('d')]);
  assert.equal(h.streams.length, 3);
  assert.equal(h.state().runningCount, 4);
});

test('a synchronous observe failure is fenced and only explicit reconnection permits same-turn retry', async (t) => {
  let calls = 0;
  const changes = [];
  const observer = createAskObserver({
    agent: { observe() { calls++; throw new Error('runtime_unavailable'); }, cancel() {} },
    onChange(state) { changes.push(state); },
  });
  t.after(() => observer.dispose());
  const snapshot = { availability: 'ready', sessions: [row('a')] };
  observer.update(snapshot); await settle();
  observer.update(snapshot); await settle();
  assert.equal(calls, 1); assert.deepEqual(observer.getState().watchingIds, []);
  observer.update({ availability: 'connecting', sessions: [] });
  observer.update(snapshot); await settle();
  assert.equal(calls, 2);
  assert.ok(changes.every((state) => !state.needsAnswerIds.length));
});
