import assert from 'node:assert/strict';
import test from 'node:test';
import { createActivitySource, normalizeSession } from '../miniapp/client/activity.mjs';
const settle = () => new Promise((resolve) => setImmediate(resolve));
const row = (id, status = 'idle', updatedAtMs = 1) => ({ sessionId: id, title: `任务 ${id}`, status, updatedAtMs });
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function harness({ list, detail, origin = row('a') } = {}) {
  const changes = [], streams = [], cancelled = [], calls = [];
  let serial = 0;
  const agent = {
    sessions: () => list ? list() : Promise.resolve({ sessions: [row('a'), row('b')] }),
    session: (id) => { calls.push(id); return detail ? detail(id) : Promise.resolve(id ? { ...row(id), lastAssistantText: '最后回复', workspaceDir: '/not-exposed' } : origin); },
    observe(input, options) { const end = deferred(); streams.push({ input, options, end }); return end.promise; },
    cancel(id) { cancelled.push(id); streams.find((s) => s.input.requestId === id)?.end.resolve(); },
  };
  const source = createActivitySource({ agent, onChange: (value) => changes.push(value), pollIntervalMs: 0, now: () => 100, makeRequestId: () => `observer-${++serial}` });
  return { source, agent, changes, streams, cancelled, calls, latest: () => changes.at(-1), emit: (event, stream = streams.at(-1)) => stream.options.onEvent(event) };
}

test('public sessions/session snapshot defaults to origin and only retains narrow display fields', async () => {
  const h = harness({ list: async () => ({ sessions: [{ ...row('a', 'running'), workspaceDir: '/private', transcript: 'secret' }, row('b')] }) });
  await h.source.start(); await settle();
  assert.deepEqual(h.streams[0].input, { all: true, requestId: 'observer-1' });
  assert.equal(h.latest().selectedSessionId, 'a');
  assert.equal(h.latest().originSession.sessionId, 'a');
  assert.equal(h.latest().sessions[0].workspaceDir, undefined);
  assert.equal(h.latest().detail.lastAssistantText, '最后回复');
  assert.equal(h.latest().detail.workspaceDir, undefined);
  h.source.dispose(); assert.deepEqual(h.cancelled, ['observer-1']);
});

test('live start/finished/error/aborted use real event outcomes, not history or inferred waits/unread', async () => {
  const h = harness(); await h.source.start();
  assert.equal(h.latest().sessions.find((s) => s.sessionId === 'a').liveCompleted, false);
  h.emit({ type: 'turn.started', sessionId: 'a', turnId: 't1' });
  assert.equal(h.latest().sessions[0].status, 'running');
  h.emit({ type: 'turn.finished', sessionId: 'a', turnId: 't1', status: 'finished' });
  assert.equal(h.latest().sessions[0].liveCompleted, true);
  await h.source.refresh();
  assert.equal(h.latest().sessions.find((s) => s.sessionId === 'a').liveCompleted, true);
  h.emit({ type: 'turn.started', sessionId: 'a', turnId: 't2' });
  assert.equal(h.latest().sessions[0].liveCompleted, false);
  h.emit({ type: 'turn.finished', sessionId: 'a', turnId: 't2', status: 'error' });
  assert.equal(h.latest().sessions[0].status, 'error');
  h.emit({ type: 'turn.finished', sessionId: 'a', turnId: 't3', status: 'aborted' });
  assert.equal(h.latest().sessions[0].status, 'aborted');
  h.emit({ type: 'permission.requested', sessionId: 'a' });
  assert.equal(h.latest().sessions[0].status, 'aborted');
  h.source.dispose();
});

test('events received during initial list fetch win over older rows and new events are not dropped', async () => {
  const list = deferred(); const h = harness({ list: () => list.promise });
  const starting = h.source.start();
  h.emit({ type: 'turn.started', sessionId: 'a', title: '新标题', turnId: 'one' });
  h.emit({ type: 'turn.finished', sessionId: 'new-task', title: '新任务', status: 'finished' });
  list.resolve({ sessions: [row('a')] }); await starting;
  assert.equal(h.latest().sessions.find((s) => s.sessionId === 'a').status, 'running');
  assert.equal(h.latest().sessions.find((s) => s.sessionId === 'new-task').liveCompleted, true);
  h.source.dispose();
});

test('resolved stream clears data, fences delayed callbacks and snapshot, then reconnects without resurrecting completion', async () => {
  const list = deferred(); let first = true;
  const h = harness({ list: () => first ? list.promise : Promise.resolve({ sessions: [row('a')] }) });
  const starting = h.source.start(); const old = h.streams[0];
  h.emit({ type: 'turn.finished', sessionId: 'a', status: 'finished' });
  old.end.resolve(); await settle();
  assert.equal(h.latest().availability, 'unavailable');
  assert.deepEqual(h.latest().sessions, []);
  h.emit({ type: 'turn.started', sessionId: 'late-private' }, old);
  list.resolve({ sessions: [row('late-private')] }); await starting;
  assert.deepEqual(h.latest().sessions, []);
  first = false; await h.source.refresh();
  assert.equal(h.streams.length, 2);
  assert.equal(h.latest().availability, 'ready');
  assert.equal(h.latest().sessions[0].liveCompleted, false);
  assert.equal(h.latest().sessions.some((s) => s.sessionId === 'late-private'), false);
  h.source.dispose();
});

test('observer rejection and read revocation clear data and permit bounded manual recovery', async () => {
  let permitted = true;
  const h = harness({ list: async () => { if (!permitted) throw { message: 'not_permitted' }; return { sessions: [row('a')] }; } });
  await h.source.start(); await settle();
  h.streams[0].end.reject({ message: 'not_permitted' }); await settle();
  assert.equal(h.latest().availability, 'not_permitted');
  assert.deepEqual(h.latest().sessions, []);
  assert.equal(h.latest().detail, null);
  permitted = false; await h.source.refresh();
  assert.equal(h.latest().availability, 'not_permitted');
  permitted = true; await h.source.refresh();
  assert.equal(h.latest().availability, 'ready');
  h.source.dispose();
});

test('reconnect waits for cancelled global settlement before taking a slot beside three detailed observers', async () => {
  let readable = true;
  const h = harness({ list: async () => {
    if (!readable) throw { code: 'runtime_unavailable' };
    return { sessions: [row('a', 'running')] };
  } });
  const occupied = new Set(['detail-a', 'detail-b', 'detail-c']);
  const originalObserve = h.agent.observe;
  let peak = occupied.size;
  h.agent.observe = (input, options) => {
    assert.equal(h.latest().availability, 'connecting');
    assert.ok(occupied.size < 4, 'the old global must release its Host slot first');
    occupied.add(input.requestId); peak = Math.max(peak, occupied.size);
    return originalObserve(input, options).finally(() => occupied.delete(input.requestId));
  };
  // An acknowledgement does not settle the cancelled observe request.
  h.agent.cancel = (id) => { h.cancelled.push(id); return Promise.resolve(); };
  await h.source.start();
  const old = h.streams[0];
  readable = false; await h.source.refresh();
  assert.equal(h.latest().availability, 'unavailable');
  readable = true;
  const reconnect = h.source.refresh();
  assert.equal(h.source.refresh(), reconnect);
  await settle();
  assert.equal(h.streams.length, 1);
  assert.equal(h.latest().availability, 'connecting');
  assert.equal(occupied.size, 4);
  h.emit({ type: 'turn.started', sessionId: 'stale-private' }, old);
  assert.deepEqual(h.latest().sessions, []);
  old.end.reject({ code: 'cancelled' });
  await reconnect;
  assert.equal(h.streams.length, 2);
  assert.equal(h.latest().availability, 'ready');
  assert.equal(h.latest().sessions.some((session) => session.sessionId === 'stale-private'), false);
  assert.equal(peak, 4);
  assert.deepEqual(h.cancelled, ['observer-1']);
  h.source.dispose(); h.streams[1].end.resolve(); await settle();
});

test('dispose ends a pending reconnect without assuming that a failed cancellation released its slot', async () => {
  for (const cancelFailure of ['throw', 'reject']) {
    let readable = true;
    const h = harness({ list: async () => {
      if (!readable) throw { code: 'runtime_unavailable' };
      return { sessions: [row('a')] };
    } });
    h.agent.cancel = (id) => {
      h.cancelled.push(id);
      if (cancelFailure === 'throw') throw new Error('cancel_failed');
      return Promise.reject(new Error('cancel_failed'));
    };
    await h.source.start();
    readable = false; await h.source.refresh(); readable = true;
    const reconnect = h.source.refresh();
    await settle();
    assert.equal(h.streams.length, 1);
    h.source.dispose(); h.source.dispose();
    await reconnect;
    const count = h.changes.length;
    h.streams[0].end.resolve(); await settle();
    assert.equal(h.streams.length, 1);
    assert.equal(h.changes.length, count);
    assert.deepEqual(h.cancelled, ['observer-1', 'observer-1', 'observer-1']);
  }
});

test('refresh retries a failed cancellation and still waits for actual observer settlement', async () => {
  for (const cancelFailure of ['throw', 'reject']) {
    let readable = true;
    const h = harness({ list: async () => {
      if (!readable) throw { code: 'runtime_unavailable' };
      return { sessions: [row('a')] };
    } });
    h.agent.cancel = (id) => {
      h.cancelled.push(id);
      if (h.cancelled.length > 1) return Promise.resolve();
      if (cancelFailure === 'throw') throw new Error('cancel_failed');
      return Promise.reject(new Error('cancel_failed'));
    };
    await h.source.start();
    readable = false; await h.source.refresh(); readable = true;
    const reconnect = h.source.refresh(); await settle();
    assert.equal(h.streams.length, 1);
    assert.equal(h.source.refresh(), reconnect);
    await settle();
    assert.deepEqual(h.cancelled, ['observer-1', 'observer-1']);
    assert.equal(h.streams.length, 1);
    h.streams[0].end.resolve(); await reconnect;
    assert.equal(h.latest().availability, 'ready');
    assert.equal(h.streams.length, 2);
    h.source.dispose(); h.streams[1].end.resolve(); await settle();
  }
});

test('a synchronous global admission failure never publishes ready and can recover on the next refresh', async () => {
  const h = harness();
  const originalObserve = h.agent.observe;
  h.agent.observe = () => { throw { code: 'BUSY' }; };
  await h.source.start();
  assert.equal(h.latest().availability, 'unavailable');
  assert.equal(h.latest().error, 'BUSY');
  assert.equal(h.changes.some((snapshot) => snapshot.availability === 'ready'), false);
  h.agent.observe = originalObserve;
  await h.source.refresh();
  assert.equal(h.latest().availability, 'ready');
  assert.equal(h.streams.length, 1);
  h.source.dispose();
});

test('selected detail responses are fenced on selection change and origin remains the original chat', async () => {
  const a = deferred(), b = deferred();
  const h = harness({ detail: (id) => id === undefined ? Promise.resolve(row('a')) : id === 'a' ? a.promise : b.promise });
  await h.source.start();
  const select = h.source.selectSession('b');
  b.resolve({ ...row('b'), lastAssistantText: '<script>data, never markup</script>', error: { message: '<b>error</b>' }, workspaceDir: '/hidden' });
  await select;
  a.resolve({ ...row('a'), lastAssistantText: 'stale' }); await settle();
  assert.equal(h.latest().detail.sessionId, 'b');
  assert.equal(h.latest().detail.lastAssistantText, '<script>data, never markup</script>');
  assert.equal(h.latest().originSession.sessionId, 'a');
  assert.equal(h.latest().detail.workspaceDir, undefined);
  h.source.dispose();
});

test('background refresh keeps the matching reply while loading and replaces it only with the next valid detail', async () => {
  const pending = deferred(), previous = '原来的长回复\n'.repeat(100);
  let refreshDetail = false;
  const h = harness({ detail: (id) => id === undefined ? Promise.resolve(row('a'))
    : refreshDetail ? pending.promise : Promise.resolve({ ...row(id), lastAssistantText: previous }) });
  await h.source.start(); await settle();
  assert.equal(h.latest().detail.lastAssistantText, previous);
  const before = h.changes.length;
  refreshDetail = true; await h.source.refresh();
  assert.equal(h.latest().selectedSessionId, 'a'); assert.equal(h.latest().detailLoading, true);
  assert.equal(h.latest().detail.lastAssistantText, previous);
  assert.equal(h.changes.slice(before).every((snapshot) => snapshot.detail?.lastAssistantText === previous), true);
  pending.resolve({ ...row('a'), lastAssistantText: '新回复' }); await settle();
  assert.equal(h.latest().detailLoading, false); assert.equal(h.latest().detail.lastAssistantText, '新回复');
  h.source.dispose();
});

test('switching the selected task immediately clears the previous reply until the new task is read', async () => {
  const next = deferred();
  const h = harness({ detail: (id) => id === 'b' ? next.promise : Promise.resolve(id === undefined ? row('a') : { ...row(id), lastAssistantText: '任务 a 的完整回复' }) });
  await h.source.start(); await settle();
  assert.equal(h.latest().detail.sessionId, 'a');
  const before = h.changes.length, selected = h.source.selectSession('b');
  assert.equal(h.latest().selectedSessionId, 'b'); assert.equal(h.latest().detailLoading, true);
  assert.equal(h.latest().detail, null);
  assert.equal(h.changes.slice(before).every((snapshot) => snapshot.selectedSessionId === 'b' && snapshot.detail === null), true);
  next.resolve({ ...row('b'), lastAssistantText: '任务 b 的回复' }); await selected;
  assert.equal(h.latest().detail.sessionId, 'b'); assert.equal(h.latest().detail.lastAssistantText, '任务 b 的回复');
  h.source.dispose();
});

test('failed or invalid background detail refresh clears the retained reply rather than showing stale content', async () => {
  for (const failure of ['read_failed', 'invalid_request']) {
    let refreshDetail = false;
    const pending = deferred();
    const h = harness({ detail: (id) => id === undefined ? Promise.resolve(row('a'))
      : refreshDetail ? pending.promise : Promise.resolve({ ...row(id), lastAssistantText: '原回复' }) });
    await h.source.start(); await settle(); refreshDetail = true; await h.source.refresh();
    assert.equal(h.latest().detail.lastAssistantText, '原回复'); assert.equal(h.latest().detailLoading, true);
    if (failure === 'read_failed') pending.reject({ code: failure });
    else pending.resolve({ ...row('wrong-task'), lastAssistantText: '其他任务回复' });
    await settle();
    assert.equal(h.latest().detail, null); assert.equal(h.latest().detailLoading, false);
    assert.equal(h.latest().detailError, failure); assert.equal(h.latest().selectedSessionId, 'a');
    h.source.dispose();
  }
});

test('visibility loss clears the removed task reply in the same snapshot that chooses the fallback task', async () => {
  let listed = [row('a'), row('b')], waitForFallback = false;
  const fallback = deferred();
  const h = harness({ list: async () => ({ sessions: listed }), detail: (id) => {
    if (id === undefined) return Promise.resolve(row('a'));
    if (id === 'a' && waitForFallback) return fallback.promise;
    return Promise.resolve({ ...row(id), lastAssistantText: `任务 ${id} 的回复` });
  } });
  await h.source.start(); await settle(); await h.source.selectSession('b');
  assert.equal(h.latest().detail.sessionId, 'b');
  const before = h.changes.length; listed = [row('a')]; waitForFallback = true;
  await h.source.refresh();
  assert.equal(h.latest().selectedSessionId, 'a'); assert.equal(h.latest().detail, null);
  assert.equal(h.changes.slice(before).some((snapshot) => snapshot.selectedSessionId === 'a' && snapshot.detail?.sessionId === 'b'), false);
  fallback.resolve({ ...row('a'), lastAssistantText: '恢复后的任务 a' }); await settle();
  assert.equal(h.latest().detail.sessionId, 'a'); h.source.dispose();
});

test('revocation or deletion during a background detail refresh removes retained reply and ignores late results', async () => {
  for (const code of ['not_permitted', 'runtime_unavailable', 'session_not_found']) {
    let refreshDetail = false;
    const pending = deferred();
    const h = harness({ detail: (id) => id === undefined ? Promise.resolve(row('a'))
      : refreshDetail ? pending.promise : Promise.resolve({ ...row(id), lastAssistantText: '不可继续保留的旧回复' }) });
    await h.source.start(); await settle(); refreshDetail = true; await h.source.refresh();
    assert.equal(h.latest().detailLoading, true); assert.equal(h.latest().detail.sessionId, 'a');
    pending.reject({ code }); await settle();
    assert.equal(h.latest().detail, null); assert.equal(h.latest().selectedSessionId, null);
    assert.equal(h.latest().detailLoading, false);
    if (code !== 'session_not_found') assert.equal(h.latest().sessions.length, 0);
    else assert.equal(h.latest().sessions.some((session) => session.sessionId === 'a'), false);
    h.source.dispose();
  }
});

test('missing/invalid public API is explicit unavailable; session DTO rejects invented statuses', async () => {
  for (const status of ['needs_input', 'ready', 'constructor', 'toString']) assert.throws(() => normalizeSession(row('a', status)), { code: 'invalid_request' });
  assert.throws(() => normalizeSession(row('a', 'idle', NaN)), { code: 'invalid_request' });
  const values = [];
  const source = createActivitySource({ agent: {}, pollIntervalMs: 0, onChange: (s) => values.push(s) });
  await source.start();
  assert.equal(values.at(-1).availability, 'unavailable');
  assert.deepEqual(values.at(-1).sessions, []);
  source.dispose();
});

test('dispose cancels requestId and fences every late read/event/stream settlement', async () => {
  const list = deferred(); const h = harness({ list: () => list.promise });
  const starting = h.source.start(); const stream = h.streams[0];
  h.source.dispose(); h.source.dispose(); const count = h.changes.length;
  h.emit({ type: 'turn.started', sessionId: 'late' }, stream);
  list.resolve({ sessions: [row('late')] }); await starting; await settle();
  assert.equal(h.changes.length, count);
  assert.deepEqual(h.cancelled, ['observer-1']);
});

test('aggregate covers simultaneous tasks with mutually exclusive counts and selection only changes detail', async () => {
  const h = harness({ list: async () => ({ sessions: [row('a'), row('b', 'running', 20), row('c', 'running', 30), row('d', 'aborted', 40)] }) });
  await h.source.start(); await settle();
  assert.deepEqual(h.latest().aggregate.counts, { total: 4, idle: 1, running: 2, error: 0, aborted: 1, completed: 0 });
  assert.equal(h.latest().aggregate.status, 'running');
  assert.equal(h.latest().aggregate.primarySession.sessionId, 'c');
  const key = h.latest().aggregate.animationKey;
  await h.source.selectSession('d');
  assert.equal(h.latest().selectedSessionId, 'd');
  assert.equal(h.latest().detail.sessionId, 'd');
  assert.equal(h.latest().aggregate.primarySession.sessionId, 'c');
  assert.equal(h.latest().aggregate.animationKey, key);
  h.source.dispose();
});

test('aggregate priority is error, local completion, running, aborted, then idle; completion can be cleared', async () => {
  let listed = [row('a'), row('b', 'running'), row('c', 'aborted')];
  const h = harness({ list: async () => ({ sessions: listed }) });
  await h.source.start();
  h.emit({ type: 'turn.finished', sessionId: 'c', turnId: 'c1', status: 'finished' });
  assert.equal(h.latest().aggregate.status, 'completed');
  assert.deepEqual(h.latest().aggregate.counts, { total: 3, idle: 1, running: 1, error: 0, aborted: 0, completed: 1 });
  h.emit({ type: 'turn.finished', sessionId: 'a', turnId: 'a1', status: 'error' });
  assert.equal(h.latest().aggregate.status, 'error');
  assert.equal(h.latest().aggregate.primarySession.sessionId, 'a');
  h.source.clearCompleted();
  assert.equal(h.latest().aggregate.counts.completed, 0);
  assert.equal(h.latest().sessions.find((s) => s.sessionId === 'c').status, 'idle');
  assert.equal(h.latest().aggregate.status, 'error');
  listed = [row('a'), row('b', 'running'), row('c')];
  await h.source.refresh();
  assert.equal(h.latest().aggregate.status, 'running');
  listed = [row('a'), row('b', 'aborted'), row('c')]; await h.source.refresh();
  assert.equal(h.latest().aggregate.status, 'aborted');
  listed = [row('a'), row('b'), row('c')]; await h.source.refresh();
  assert.equal(h.latest().aggregate.status, 'idle');
  h.source.dispose();
});

test('same-state polls and duplicate/retired turn events do not replay animations, but a new turn does', async () => {
  const h = harness({ list: async () => ({ sessions: [row('a', 'running')] }) });
  await h.source.start();
  const initial = h.latest().aggregate.animationKey;
  await h.source.refresh();
  assert.equal(h.latest().aggregate.animationKey, initial);
  h.emit({ type: 'turn.started', sessionId: 'a', turnId: 'one' });
  const one = h.latest().aggregate.animationKey;
  assert.notEqual(one, initial);
  h.emit({ type: 'turn.started', sessionId: 'a', turnId: 'one' });
  assert.equal(h.latest().aggregate.animationKey, one);
  await h.source.refresh();
  assert.equal(h.latest().aggregate.animationKey, one);
  h.emit({ type: 'turn.started', sessionId: 'a', turnId: 'two' });
  const two = h.latest().aggregate.animationKey;
  assert.notEqual(two, one);
  h.emit({ type: 'turn.finished', sessionId: 'a', turnId: 'one', status: 'error' });
  assert.equal(h.latest().aggregate.animationKey, two);
  assert.equal(h.latest().aggregate.status, 'running');
  h.emit({ type: 'turn.finished', sessionId: 'a', turnId: 'two', status: 'finished' });
  const done = h.latest().aggregate.animationKey;
  h.emit({ type: 'turn.finished', sessionId: 'a', turnId: 'two', status: 'finished' });
  h.emit({ type: 'turn.started', sessionId: 'a', turnId: 'two' });
  assert.equal(h.latest().aggregate.animationKey, done);
  assert.equal(h.latest().aggregate.status, 'completed');
  h.source.dispose();
});

test('same-class primary uses most recent activity and stable id ordering for historical ties', async () => {
  const h = harness({ list: async () => ({ sessions: [row('z', 'error', 1), row('a', 'error', 1)] }), origin: null });
  await h.source.start();
  assert.equal(h.latest().aggregate.primarySession.sessionId, 'a');
  h.emit({ type: 'turn.finished', sessionId: 'a', turnId: 'one', status: 'error' });
  h.emit({ type: 'turn.finished', sessionId: 'z', turnId: 'two', status: 'error' });
  assert.equal(h.latest().aggregate.primarySession.sessionId, 'z');
  await h.source.refresh();
  assert.equal(h.latest().aggregate.primarySession.sessionId, 'z');
  h.source.dispose();
});

test('observed roots outside the latest list survive refresh while deleted/hidden roots are removed', async () => {
  let visible = true;
  const h = harness({ detail: async (id) => {
    if (id === undefined) return row('a');
    if (id === 'outside' && !visible) throw { code: 'session_not_found' };
    return { ...row(id, id === 'outside' ? 'running' : 'idle'), lastAssistantText: 'private reply', workspaceDir: '/private' };
  } });
  await h.source.start();
  h.emit({ type: 'turn.started', sessionId: 'outside', turnId: 'one', text: 'never retain' });
  await h.source.refresh();
  assert.equal(h.latest().sessions.some((s) => s.sessionId === 'outside'), true);
  assert.equal(h.latest().aggregate.counts.running, 1);
  const outside = h.latest().sessions.find((s) => s.sessionId === 'outside');
  assert.equal(outside.lastAssistantText, undefined);
  assert.equal(outside.workspaceDir, undefined);
  assert.equal(outside.text, undefined);
  visible = false; await h.source.refresh();
  assert.equal(h.latest().sessions.some((s) => s.sessionId === 'outside'), false);
  assert.equal(h.latest().aggregate.counts.total, 2);
  h.source.dispose();
});

test('snapshot-only roots fall out of the rolling list and cleared off-list completion is released', async () => {
  let listed = [row('a'), row('old', 'aborted')];
  const h = harness({ list: async () => ({ sessions: listed }), detail: async (id) => row(id ?? 'a') });
  await h.source.start();
  listed = [row('a')];
  h.emit({ type: 'turn.finished', sessionId: 'outside', turnId: 'one', status: 'finished' });
  await h.source.refresh();
  assert.equal(h.latest().sessions.some((s) => s.sessionId === 'old'), false);
  assert.equal(h.latest().aggregate.counts.completed, 1);
  h.source.clearCompleted();
  assert.equal(h.latest().sessions.some((s) => s.sessionId === 'outside'), false);
  const reads = h.calls.filter((id) => id === 'outside').length;
  await h.source.refresh();
  assert.equal(h.calls.filter((id) => id === 'outside').length, reads);
  h.source.dispose();
});

test('off-list validations have at most four concurrent reads and late events win over their old answers', async () => {
  const pending = [], waiting = new Map();
  let active = 0, peak = 0;
  const h = harness({ detail: (id) => {
    if (!id?.startsWith('out')) return Promise.resolve(row(id ?? 'a'));
    active++; peak = Math.max(peak, active);
    const result = deferred(); waiting.set(id, result); pending.push(id);
    return result.promise.finally(() => active--);
  } });
  await h.source.start();
  for (let i = 0; i < 7; i++) h.emit({ type: 'turn.started', sessionId: `out${i}`, turnId: 'one' });
  const refreshing = h.source.refresh(); await settle();
  assert.equal(pending.length, 4);
  h.emit({ type: 'turn.finished', sessionId: 'out0', turnId: 'one', status: 'finished' });
  for (let i = 0; i < 4; i++) waiting.get(`out${i}`).resolve(row(`out${i}`, 'running'));
  await settle();
  assert.equal(pending.length, 7);
  for (let i = 4; i < 7; i++) waiting.get(`out${i}`).resolve(row(`out${i}`, 'running'));
  await refreshing;
  assert.equal(peak, 4);
  assert.equal(h.latest().sessions.find((s) => s.sessionId === 'out0').liveCompleted, true);
  assert.equal(h.latest().aggregate.counts.running, 6);
  h.source.dispose();
});

test('off-list read revocation clears every aggregate and delayed worker results cannot repopulate it', async () => {
  const late = deferred();
  const h = harness({ detail: (id) => {
    if (id === 'out-a') return Promise.reject({ code: 'not_permitted' });
    if (id === 'out-b') return late.promise;
    return Promise.resolve(row(id ?? 'a'));
  } });
  await h.source.start();
  for (const id of ['out-a', 'out-b']) h.emit({ type: 'turn.started', sessionId: id, turnId: 'one' });
  await h.source.refresh();
  assert.equal(h.latest().availability, 'not_permitted');
  assert.equal(h.latest().aggregate.status, null);
  assert.deepEqual(h.latest().aggregate.counts, { total: 0, idle: 0, running: 0, error: 0, aborted: 0, completed: 0 });
  late.resolve(row('out-b', 'running')); await settle();
  assert.deepEqual(h.latest().sessions, []);
  h.source.dispose();
});

test('a selected root proven missing during an older snapshot is not resurrected by that snapshot', async () => {
  let delayedList = null, missing = false;
  const h = harness({ list: () => delayedList?.promise ?? Promise.resolve({ sessions: [row('a'), row('b')] }), detail: async (id) => {
    if (id === 'b' && missing) throw { code: 'session_not_found' };
    return row(id ?? 'a');
  } });
  await h.source.start(); await settle();
  delayedList = deferred();
  const refreshing = h.source.refresh();
  missing = true; await h.source.selectSession('b');
  assert.equal(h.latest().sessions.some((s) => s.sessionId === 'b'), false);
  delayedList.resolve({ sessions: [row('a'), row('b')] });
  await refreshing;
  assert.equal(h.latest().sessions.some((s) => s.sessionId === 'b'), false);
  assert.equal(h.latest().selectedSessionId, 'a');
  h.source.dispose();
});

test('missing original chat does not prevent global activity and an empty ready scope is distinct from disconnect', async () => {
  const h = harness({ list: async () => ({ sessions: [] }), detail: async () => { throw { code: 'session_not_found' }; } });
  await h.source.start();
  assert.equal(h.latest().availability, 'ready');
  assert.equal(h.latest().aggregate.status, 'idle');
  assert.equal(h.latest().aggregate.primarySession, null);
  assert.equal(h.latest().aggregate.counts.total, 0);
  h.emit({ type: 'turn.started', sessionId: 'visible-root', turnId: 'one' });
  assert.equal(h.latest().aggregate.status, 'running');
  assert.equal(h.latest().selectedSessionId, null);
  h.streams[0].end.resolve(); await settle();
  assert.equal(h.latest().aggregate.status, null);
  assert.equal(h.latest().aggregate.primarySession, null);
  h.source.dispose();
});

test('ask followers receive only an observed turn identity and snapshots never invent it', async () => {
  const h = harness({ list: async () => ({ sessions: [row('a', 'running')] }) });
  await h.source.start();
  assert.equal(h.latest().sessions[0].observedTurnId, null);
  h.emit({ type: 'turn.started', sessionId: 'a', turnId: 'actual-turn' });
  assert.equal(h.latest().sessions[0].observedTurnId, 'actual-turn');
  await h.source.refresh();
  assert.equal(h.latest().sessions[0].observedTurnId, 'actual-turn');
  h.source.dispose();
});
