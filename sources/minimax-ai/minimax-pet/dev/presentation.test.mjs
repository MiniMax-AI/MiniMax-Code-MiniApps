import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateText, noticeRemaining, notificationItems, notificationText, visibleNotices, createAnimationGate } from '../miniapp/client/pet-presentation.mjs';


test('live questions replace stale reply previews and outrank terminal notifications while ordinary running tasks stay quiet', () => {
  const items = [
    { sessionId: 'running', displayStatus: 'running' },
    { sessionId: 'finished', displayStatus: 'completed' },
    { sessionId: 'ask', displayStatus: 'running', needsAnswer: true },
    { sessionId: 'failed', displayStatus: 'error' },
  ];
  assert.deepEqual(notificationItems(items).map((item) => item.sessionId), ['ask', 'finished', 'failed']);
  assert.equal(notificationText(items[2], { ask: 'old response' }), '需要你回答');
  assert.equal(notificationText(items[1], { finished: 'new response' }), 'new response');
  assert.equal(notificationText(items[3]), '任务出现异常');
  assert.equal(items[0].sessionId, 'running');
});


test('a refreshed running snapshot does not replay after its pose has settled; a new turn does', () => {
  const calls = [];
  const player = { state: 'idle', pose: 'idle', play(state, options) { this.state = state; calls.push({ state, options }); return Promise.resolve(); } };
  const gate = createAnimationGate(player);
  assert.equal(gate.apply('running', 'turn-one'), true);
  player.pose = 'idle';
  assert.equal(gate.apply('running', 'turn-one'), false);
  assert.equal(gate.apply('running', 'turn-two'), true);
  gate.invalidate();
  assert.equal(gate.apply('running', 'turn-two'), true);
  assert.equal(calls.length, 3);
});


test('the aggregate status text includes every category and keeps local completion distinct', () => {
  assert.equal(aggregateText({ total: 5, running: 1, completed: 1, error: 1, aborted: 1, idle: 1 }), '5 个可见任务 · 1 运行中 · 1 本次完成 · 1 异常 · 1 已停止 · 1 空闲');
});

const notice = (n, extra = {}) => ({ sessionId: `s-${n}`, title: `任务 ${n}`, displayStatus: 'completed', ...extra });

test('a notification hides after its timeout and an answer request never does', () => {
  const items = [notice(1), notice(2, { needsAnswer: true })];
  const shownAt = new Map([['s-1', 1000], ['s-2', 1000]]);
  assert.deepEqual(visibleNotices(items, { shownAt, now: 5000, timeoutSeconds: 10 }).map((i) => i.sessionId), ['s-1', 's-2']);
  assert.deepEqual(visibleNotices(items, { shownAt, now: 11_000, timeoutSeconds: 10 }).map((i) => i.sessionId), ['s-2']);
  assert.deepEqual(visibleNotices(items, { shownAt, now: 999_999, timeoutSeconds: 0 }).map((i) => i.sessionId), ['s-1', 's-2']);
});

test('an unknown start counts as just shown and remaining time shrinks to zero', () => {
  const items = [notice(1), notice(2, { needsAnswer: true })];
  assert.equal(visibleNotices(items, { shownAt: new Map(), now: 1e9, timeoutSeconds: 3 }).length, 2);
  assert.equal(noticeRemaining(items[0], { shownAt: new Map(), now: 0, timeoutSeconds: 30 }), 30_000);
  const shownAt = new Map([['s-1', 0]]);
  assert.equal(noticeRemaining(items[0], { shownAt, now: 10_000, timeoutSeconds: 30 }), 20_000);
  assert.equal(noticeRemaining(items[0], { shownAt, now: 40_000, timeoutSeconds: 30 }), 0);
  assert.equal(noticeRemaining(items[1], { shownAt, now: 40_000, timeoutSeconds: 30 }), null);
  assert.equal(noticeRemaining(items[0], { shownAt, now: 40_000, timeoutSeconds: 0 }), null);
});

test('malformed input never throws', () => {
  for (const items of [undefined, null, 'x', [null, {}, { sessionId: 'a' }]]) {
    assert.doesNotThrow(() => visibleNotices(items, { now: 1, timeoutSeconds: 5 }));
  }
  assert.deepEqual(visibleNotices(null, { timeoutSeconds: 5 }), []);
});
