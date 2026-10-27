import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateText, notificationItems, notificationText, createAnimationGate } from '../miniapp/client/pet-presentation.mjs';


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
