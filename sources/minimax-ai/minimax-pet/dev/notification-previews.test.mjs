import assert from 'node:assert/strict';
import test from 'node:test';
import { createNotificationPreviews } from '../miniapp/client/notification-previews.mjs';

const settle = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const reminder = (sessionId, key = 'turn-one', displayStatus = 'completed') => ({ sessionId, title: `任务 ${sessionId}`, status: displayStatus === 'completed' ? 'idle' : displayStatus, displayStatus, reminderKey: `${sessionId}:${key}` });

test('reads terminal notifications among the current top three, without reading running or retaining other detail fields', async () => {
  const calls = [], changes = [];
  const previews = createNotificationPreviews({ agent: { session: async (id) => { calls.push(id); return { sessionId: id, lastAssistantText: `<b>${id} reply</b>`, workspaceDir: '/private', transcript: 'not retained' }; } }, onChange: (state) => changes.push(state) });
  previews.update({ availability: 'ready', items: [reminder('a'), reminder('b', 'one', 'running'), reminder('c', 'one', 'error'), reminder('d')] });
  assert.deepEqual(calls, []);
  await settle();
  assert.deepEqual(calls, ['a', 'c']);
  assert.deepEqual(previews.getState(), { previews: { a: '<b>a reply</b>', c: '<b>c reply</b>' } });
  assert.equal(changes.length, 1);
  previews.dispose();
});

test('unchanged five-second snapshots read only once, a new turn clears the old reply and reads again', async () => {
  let calls = 0;
  const second = deferred();
  const previews = createNotificationPreviews({ agent: { session: async (id) => ++calls === 1 ? { sessionId: id, lastAssistantText: 'first reply' } : second.promise } });
  const input = { availability: 'ready', items: [reminder('a')] };
  previews.update(input); await settle();
  for (let i = 0; i < 5; i++) previews.update({ ...input, items: input.items.map((item) => ({ ...item })) });
  await settle();
  assert.equal(calls, 1);
  previews.update({ availability: 'ready', items: [reminder('a', 'turn-two')] });
  assert.deepEqual(previews.getState(), { previews: {} });
  await settle();
  assert.equal(calls, 2);
  second.resolve({ sessionId: 'a', lastAssistantText: 'second reply' }); await settle();
  assert.deepEqual(previews.getState(), { previews: { a: 'second reply' } });
  previews.dispose();
});

test('newer turn wins when old detail arrives late, and mismatched session responses are ignored', async () => {
  const old = deferred(), fresh = deferred(); let calls = 0;
  const previews = createNotificationPreviews({ agent: { session: () => ++calls === 1 ? old.promise : fresh.promise } });
  previews.update({ availability: 'ready', items: [reminder('a', 'old')] }); await settle();
  previews.update({ availability: 'ready', items: [reminder('a', 'new')] }); await settle();
  fresh.resolve({ sessionId: 'a', lastAssistantText: 'new' }); await settle();
  old.resolve({ sessionId: 'a', lastAssistantText: 'old' }); await settle();
  assert.deepEqual(previews.getState(), { previews: { a: 'new' } });
  previews.update({ availability: 'ready', items: [reminder('b')] }); await settle();
  assert.deepEqual(previews.getState(), { previews: {} });
  previews.dispose();
});

test('expiry, mute, deletion, or cancellation removes the current item and fences its pending response', async () => {
  for (const replacement of [[], [reminder('a', 'one', 'aborted')], [reminder('a', 'one', 'running')]]) {
    const result = deferred();
    const previews = createNotificationPreviews({ agent: { session: () => result.promise } });
    previews.update({ availability: 'ready', items: [reminder('a')] }); await settle();
    previews.update({ availability: 'ready', items: replacement });
    result.resolve({ sessionId: 'a', lastAssistantText: 'late reply' }); await settle();
    assert.deepEqual(previews.getState(), { previews: {} });
    previews.dispose();
  }
});

test('disconnect clears snippets and reconnect may reread the same identity; an old connection cannot overwrite it', async () => {
  const old = deferred(), fresh = deferred(); let calls = 0;
  const previews = createNotificationPreviews({ agent: { session: () => ++calls === 1 ? old.promise : fresh.promise } });
  const items = [reminder('a')];
  previews.update({ availability: 'ready', items }); await settle();
  previews.update({ availability: 'not_permitted', items });
  previews.update({ availability: 'ready', items }); await settle();
  assert.equal(calls, 2);
  old.resolve({ sessionId: 'a', lastAssistantText: 'previous connection' }); await settle();
  assert.deepEqual(previews.getState(), { previews: {} });
  fresh.resolve({ sessionId: 'a', lastAssistantText: 'current connection' }); await settle();
  assert.deepEqual(previews.getState(), { previews: { a: 'current connection' } });
  previews.update({ availability: 'unavailable', items });
  assert.deepEqual(previews.getState(), { previews: {} });
  previews.dispose();
});

test('failed optional reads do not throw or retry on identical snapshots and error snippets prefer the current error', async () => {
  let calls = 0;
  const previews = createNotificationPreviews({ agent: { session: async (id) => { calls++; if (id === 'bad') throw { code: 'not_permitted' }; return { sessionId: id, error: { message: 'current failure' }, lastAssistantText: 'previous successful turn' }; } } });
  const input = { availability: 'ready', items: [reminder('bad'), { sessionId: 'failed', status: 'error', animationKey: 'failure-turn' }] };
  previews.update(input); await settle();
  assert.deepEqual(previews.getState(), { previews: { failed: 'current failure' } });
  previews.update(input); await settle();
  assert.equal(calls, 2);
  previews.dispose();
});

test('public state is copied, bounded to 4000 text characters and only retains the current top three', async () => {
  const previews = createNotificationPreviews({ agent: { session: async (id) => ({ sessionId: id, lastAssistantText: 'x'.repeat(5000) }) } });
  previews.update({ availability: 'ready', items: [reminder('a'), reminder('b'), reminder('c')] }); await settle();
  const state = previews.getState();
  assert.equal(state.previews.a.length, 4000);
  state.previews.a = 'outside mutation';
  assert.equal(previews.getState().previews.a.length, 4000);
  previews.update({ availability: 'ready', items: [reminder('d'), reminder('e'), reminder('f'), reminder('a')] }); await settle();
  assert.deepEqual(Object.keys(previews.getState().previews), ['d', 'e', 'f']);
  previews.dispose();
});

test('onChange is asynchronous and cannot loop when rendering resubmits the same reminders', async () => {
  const input = { availability: 'ready', items: [reminder('a')] };
  let updates = 0;
  const previews = createNotificationPreviews({ agent: { session: async (id) => ({ sessionId: id, lastAssistantText: 'reply' }) }, onChange: () => { updates++; previews.update(input); } });
  previews.update(input);
  assert.equal(updates, 0);
  await settle();
  assert.equal(updates, 1);
  previews.dispose();
});

test('dispose fences pending reads and notifications, including work not dispatched yet', async () => {
  let calls = 0, changes = 0;
  const pending = deferred();
  const previews = createNotificationPreviews({ agent: { session: () => { calls++; return pending.promise; } }, onChange: () => changes++ });
  previews.update({ availability: 'ready', items: [reminder('a')] }); await settle();
  previews.dispose(); previews.dispose();
  pending.resolve({ sessionId: 'a', lastAssistantText: 'late' }); await settle();
  previews.update({ availability: 'ready', items: [reminder('b')] });
  assert.equal(calls, 1);
  assert.equal(changes, 0);
  assert.deepEqual(previews.getState(), { previews: {} });
  const immediate = createNotificationPreviews({ agent: { session: () => { calls++; return Promise.resolve({}); } } });
  immediate.update({ availability: 'ready', items: [reminder('a')] }); immediate.dispose(); await settle();
  assert.equal(calls, 1);
});

test('unsupported API, missing identity, invalid ids and blank replies yield no snippet', async () => {
  const unsupported = createNotificationPreviews({ agent: {} });
  unsupported.update({ availability: 'ready', items: [reminder('a')] }); await settle();
  assert.deepEqual(unsupported.getState(), { previews: {} }); unsupported.dispose();
  const calls = [];
  const previews = createNotificationPreviews({ agent: { session: async (id) => { calls.push(id); return { sessionId: id, lastAssistantText: '  ' }; } } });
  previews.update({ availability: 'ready', items: [{ sessionId: 'no-key', displayStatus: 'completed' }, reminder(''), reminder('blank')] }); await settle();
  assert.deepEqual(calls, ['blank']);
  assert.deepEqual(previews.getState(), { previews: {} }); previews.dispose();
});
