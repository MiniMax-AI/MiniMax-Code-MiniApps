import assert from 'node:assert/strict';
import test from 'node:test';
import { createReminderStore } from '../miniapp/client/activity-reminders.mjs';

const HOUR = 60 * 60 * 1000;
const WEEK = 7 * 24 * HOUR;
function row(sessionId, status, updatedAtMs, { epoch = 1, turnId = null, revision = 0, liveCompleted = false, ...extra } = {}) {
  return { sessionId, title: sessionId, status, updatedAtMs, liveCompleted, activityRevision: revision, animationKey: JSON.stringify([epoch, sessionId, turnId, revision, liveCompleted ? 'completed' : status]), ...extra };
}

test('reminders choose the newest activity rather than permanently preferring an old error', () => {
  const store = createReminderStore({ now: () => 1000 });
  const rows = [row('old-error', 'error', 100), row('new-running', 'running', 300), row('completed', 'idle', 200, { liveCompleted: true }), row('idle', 'idle', 400), row('aborted', 'aborted', 500)];
  const copy = structuredClone(rows);
  const state = store.update(rows);
  assert.deepEqual(state.items.map((item) => item.sessionId), ['new-running', 'completed', 'old-error']);
  assert.equal(state.primary.displayStatus, 'running');
  assert.deepEqual(rows, copy);
  assert.equal(rows.filter((item) => item.status === 'error').length, 1);
});

test('error expires after one hour and live completion after seven days from persisted activity time', () => {
  let time = HOUR + 100;
  const store = createReminderStore({ now: () => time });
  store.update([row('expired-error', 'error', 100), row('error', 'error', 101), row('completion', 'idle', 0, { liveCompleted: true }), row('run', 'running', 0)]);
  assert.deepEqual(store.getState().items.map((item) => item.sessionId), ['error', 'completion', 'run']);
  assert.equal(store.getState().items.find((item) => item.sessionId === 'error').expiresAtMs, HOUR + 101);
  assert.equal(store.getState().items.find((item) => item.sessionId === 'completion').expiresAtMs, WEEK);
  assert.equal(store.getState().items.find((item) => item.sessionId === 'run').expiresAtMs, null);
  time = WEEK;
  assert.deepEqual(store.getState().items.map((item) => item.sessionId), ['run']);
});

test('historical idle is never inferred to be completed, including after an observer reconnect', () => {
  const store = createReminderStore({ now: () => 1000 });
  store.update([row('task', 'running', 100, { turnId: 'turn' })]);
  store.update([]);
  assert.equal(store.update([row('task', 'idle', 500, { epoch: 3 })]).items.length, 0);
});

test('identical poll snapshots and input reordering retain reminder and animation identities', () => {
  const store = createReminderStore({ now: () => 1000 });
  const a = row('a', 'running', 100, { turnId: 'one', revision: 1 });
  const b = row('b', 'error', 100);
  const first = store.update([b, a]);
  const second = store.update([a, b]);
  assert.equal(first.primary.sessionId, 'a');
  assert.deepEqual(second, first);
  for (let count = 0; count < 5; count++) assert.equal(store.update([a, b]).animationKey, first.animationKey);
});

test('dismissing a running round also suppresses its terminal result, but a known new turn returns', () => {
  const store = createReminderStore({ now: () => 1000 });
  const first = store.update([row('task', 'running', 100, { turnId: 'one', revision: 1 })]);
  store.dismiss('task');
  assert.equal(store.update([row('task', 'error', 200, { turnId: 'one', revision: 2 })]).items.length, 0);
  const second = store.update([row('task', 'running', 300, { turnId: 'two', revision: 3 })]);
  assert.equal(second.items.length, 1);
  assert.notEqual(second.primary.reminderKey, first.primary.reminderKey);
});

test('turn completion changes the pose identity without changing its dismissal identity', () => {
  const store = createReminderStore({ now: () => 1000 });
  const running = store.update([row('task', 'running', 100, { turnId: 'one', revision: 1 })]);
  const completed = store.update([row('task', 'idle', 200, { liveCompleted: true, turnId: 'one', revision: 2 })]);
  assert.equal(completed.primary.reminderKey, running.primary.reminderKey);
  assert.notEqual(completed.animationKey, running.animationKey);
});

test('epoch and revision resets alone cannot replay or revive a dismissed known turn', () => {
  const store = createReminderStore({ now: () => 1000 });
  const initial = store.update([row('task', 'running', 100, { turnId: 'one', revision: 8 })]);
  const reconnected = store.update([row('task', 'running', 110, { epoch: 3, revision: 0 })]);
  assert.equal(reconnected.animationKey, initial.animationKey);
  store.dismiss('task');
  store.update([]);
  assert.equal(store.update([row('task', 'error', 120, { epoch: 5 })]).items.length, 0);
  assert.equal(store.update([row('task', 'error', 120, { epoch: 5, turnId: 'one', revision: 1 })]).items.length, 0);
  assert.equal(store.update([row('task', 'running', 200, { epoch: 5, turnId: 'two', revision: 2 })]).items.length, 1);
});

test('unknown turn identities survive a reconnect conservatively despite a timestamp change', () => {
  const store = createReminderStore({ now: () => 1000 });
  store.update([row('error', 'error', 100)]);
  store.dismiss('error');
  store.update([]);
  assert.equal(store.update([row('error', 'error', 200, { epoch: 3 })]).items.length, 0);
  // A later persisted error update on this stable connection is new activity.
  assert.equal(store.update([row('error', 'error', 300, { epoch: 3 })]).items.length, 1);
});

test('a snapshot running round acquiring its observed turn does not revive a dismissal', () => {
  const store = createReminderStore({ now: () => 1000 });
  store.update([row('task', 'running', 100)]);
  store.dismiss('task');
  assert.equal(store.update([row('task', 'running', 200, { turnId: 'observed', revision: 1 })]).items.length, 0);
  assert.equal(store.update([row('task', 'error', 300, { turnId: 'observed', revision: 2 })]).items.length, 0);
});

test('a new snapshot run after a terminal or idle state can remind again without a turn ID', () => {
  const store = createReminderStore({ now: () => 1000 });
  store.update([row('task', 'error', 100)]);
  store.dismiss('task');
  assert.equal(store.update([row('task', 'running', 200)]).items.length, 1);
  store.dismiss('task');
  store.update([row('task', 'idle', 300)]);
  assert.equal(store.update([row('task', 'running', 400)]).items.length, 1);
});

test('mute follows a session across new turns and unmute restores only undismissed active reminders', () => {
  const store = createReminderStore({ now: () => 1000 });
  store.update([row('task', 'running', 100, { turnId: 'one' })]);
  assert.deepEqual(store.mute('task').mutedIds, ['task']);
  assert.equal(store.update([row('task', 'running', 200, { turnId: 'two' })]).items.length, 0);
  assert.equal(store.unmute('task').items.length, 1);
  store.dismiss('task');
  store.mute('task');
  assert.equal(store.unmute('task').items.length, 0);
});

test('dismissAll affects only currently active rounds and does not mute sessions or erase facts', () => {
  const store = createReminderStore({ now: () => 1000 });
  const rows = [row('a', 'running', 100, { turnId: 'one' }), row('b', 'error', 200), row('c', 'idle', 300)];
  store.update(rows);
  assert.equal(store.dismissAll().items.length, 0);
  assert.deepEqual(store.getState().mutedIds, []);
  assert.equal(store.update(rows).items.length, 0);
  assert.equal(store.update([...rows.slice(0, 2), row('c', 'running', 400, { turnId: 'new' })]).primary.sessionId, 'c');
});

test('removing or hiding a row removes its reminder without forgetting a same-round dismissal', () => {
  const store = createReminderStore({ now: () => 1000 });
  const task = row('task', 'error', 100, { turnId: 'one' });
  store.update([task]);
  store.dismiss('task');
  assert.equal(store.update([]).primary, null);
  assert.equal(store.update([task]).primary, null);
});

test('returned state cannot mutate the stores primitive row fields or mute set', () => {
  const store = createReminderStore({ now: () => 1000 });
  const state = store.update([row('task', 'running', 100)]);
  state.items[0].title = 'changed';
  state.primary.title = 'changed';
  state.mutedIds.push('task');
  assert.equal(store.getState().primary.title, 'task');
  assert.deepEqual(store.getState().mutedIds, []);
});

test('invalid rows cannot manufacture an active reminder and missing animation keys degrade safely', () => {
  const store = createReminderStore({ now: () => 1000 });
  const rows = [null, row('', 'error', 100), row('bad-time', 'error', NaN), row('bad-status', 'complete', 100), { sessionId: 'older', status: 'running', updatedAtMs: 100 }];
  assert.deepEqual(store.update(rows).items.map((item) => item.sessionId), ['older']);
  store.dismiss('older');
  assert.equal(store.update(rows).items.length, 0);
});

test('a live question outranks newer completion without changing the underlying running fact or turn identity', () => {
  const store = createReminderStore({ now: () => 1000 });
  const ask = row('ask', 'running', 100, { turnId: 'ask-turn' });
  const done = row('done', 'idle', 900, { liveCompleted: true });
  const before = store.update([ask, done]);
  assert.equal(before.primary.sessionId, 'done');
  const waiting = store.update([{ ...ask, needsAnswer: true }, done]);
  assert.equal(waiting.primary.sessionId, 'ask');
  assert.equal(waiting.primary.status, 'running');
  assert.equal(waiting.primary.displayStatus, 'running');
  assert.equal(waiting.items.find((item) => item.sessionId === 'ask').reminderKey, before.items.find((item) => item.sessionId === 'ask').reminderKey);
  const after = store.update([{ ...ask, needsAnswer: false }, done]);
  assert.equal(after.primary.sessionId, 'done');
  assert.notEqual(after.animationKey, waiting.animationKey);
});
