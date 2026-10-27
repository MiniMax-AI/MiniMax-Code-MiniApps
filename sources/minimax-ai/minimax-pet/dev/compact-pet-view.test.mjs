import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { createCompactPetView } from '../miniapp/client/compact-pet-view.mjs';
import { createReminderStore } from '../miniapp/client/activity-reminders.mjs';

let JSDOM;
try { ({ JSDOM } = createRequire(import.meta.url)('jsdom')); } catch { /* Use the existing workspace DOM runtime. */ }
const domTest = JSDOM ? test : test.skip;
const task = (n, displayStatus = 'running') => ({ sessionId: `task-${n}`, title: `任务 ${n}`, displayStatus });
const selection = (n, text = `任务 ${n} 的回复`) => ({ availability: 'ready', selectedSessionId: `task-${n}`, session: task(n),
  detailLoading: false, detail: { sessionId: `task-${n}`, lastAssistantText: text } });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function harness(t, callbacks = {}) {
  const dom = new JSDOM('<!doctype html><div id="compact"></div>');
  const container = dom.window.document.getElementById('compact');
  const calls = [];
  const view = createCompactPetView({ container,
    onClose: () => { calls.push(['close']); },
    onSelectTask: (...args) => { calls.push(['select', ...args]); },
    ...callbacks,
  });
  t.after(() => { view.dispose(); dom.window.close(); });
  const button = (name, scope = container) => [...scope.querySelectorAll('button')].find((node) => node.textContent === name);
  const update = (patch = {}) => view.update({ reminders: { items: [] }, ...patch });
  return { dom, container, calls, view, button, update };
}

domTest('default is task notifications with no independent chat, form, draft or generic Host entry', (t) => {
  const h = harness(t, { onSubmit: () => assert.fail('No free request'), onDraftChange: () => assert.fail('No free draft') });
  assert.equal(h.view.opened, false); assert.equal(h.container.hidden, true);
  h.update({ draft: '旧的自由问答草稿', agentSnapshot: { text: '旧的独立聊天回复' } }); h.view.open();
  assert.equal(h.view.opened, true); assert.equal(h.view.view, 'tasks');
  assert.equal(h.container.querySelector('textarea,input,form,[role=tab],h1,h2,fieldset'), null);
  assert.deepEqual([...h.container.querySelectorAll('.compact-tasks .compact-footer button:not([hidden])')].map((node) => node.textContent), ['全部任务']);
  assert.equal(h.container.textContent.includes('旧的独立聊天回复'), false);
  for (const label of ['发送', '提问', '新对话', '主窗口', '点评这条会话', '查看点评详情', '停止点评']) assert.equal(h.button(label), undefined);
  assert.equal(h.view.open('agent'), false); assert.equal(h.view.open('review'), false); assert.equal(h.view.view, 'tasks');
  assert.deepEqual(h.calls, []);
});

domTest('tasks show the latest three reminders and selection stays beside the pet', async (t) => {
  const h = harness(t);
  h.update({ reminders: { items: [task(4, 'completed'), task(3, 'error'), task(2), task(1)] } }); h.view.open();
  assert.equal(h.container.querySelectorAll('.compact-task').length, 3);
  assert.deepEqual([...h.container.querySelectorAll('.compact-task-title')].map((node) => node.textContent), ['任务 4', '任务 3', '任务 2']);
  assert.deepEqual([...h.container.querySelectorAll('.compact-task-status')].map((node) => node.textContent), ['已完成', '异常', '进行中']);
  h.container.querySelectorAll('.compact-task-title')[1].click();
  await tick(); assert.deepEqual(h.calls, [['select', 'task-3']]);
  assert.equal(h.view.opened, true); assert.equal(h.view.view, 'tasks');
});

domTest('all tasks use the full supplied visible list and return from detail without opening Host', (t) => {
  const h = harness(t), allSessions = [task(6), task(5), task(4), task(3), task(2), task(1)];
  h.update({ reminders: { items: [task(6)] }, allSessions }); h.view.open(); h.button('全部任务').click();
  assert.equal(h.view.view, 'allTasks'); assert.equal(h.container.querySelectorAll('.compact-task').length, 6);
  assert.equal(h.container.querySelector('.compact-dismiss'), null);
  h.container.querySelectorAll('.compact-task-title')[5].click(); h.view.open('detail');
  assert.deepEqual(h.calls, [['select', 'task-1']]);
  h.button('返回任务', h.container.querySelector('.compact-detail')).click();
  assert.equal(h.view.view, 'allTasks'); assert.equal(h.view.opened, true);
  assert.deepEqual(h.calls, [['select', 'task-1']]);
});

domTest('an observed completed turn has the same status in reminders, all tasks and its detail', (t) => {
  const h = harness(t), session = { sessionId: 'task-1', title: '完成的任务', status: 'idle', liveCompleted: true, updatedAtMs: 1000 };
  const reminders = createReminderStore({ now: () => 1000 }).update([session]);
  h.update({ reminders, allSessions: [session], taskSelection: { availability: 'ready', selectedSessionId: session.sessionId, session,
    detail: { sessionId: session.sessionId, status: 'idle', lastAssistantText: '完整回复' } } });
  for (const pane of ['tasks', 'allTasks']) {
    h.view.open(pane);
    assert.equal(h.container.querySelector('.compact-task-status').textContent, '已完成');
    assert.equal(h.container.querySelector('.compact-task-status').dataset.status, 'completed');
  }
  h.view.open('detail');
  assert.equal(h.container.querySelector('.compact-detail-status').textContent, '已完成');
  assert.equal(h.container.querySelector('.compact-detail-status').dataset.status, 'completed');
  assert.equal(h.container.querySelector('.compact-detail-reply').textContent, '完整回复');
});

domTest('raw task facts override stale completion hints and only observed idle completion is promoted', (t) => {
  const h = harness(t);
  const cases = [
    [{ status: 'idle', liveCompleted: false, displayStatus: 'completed' }, '空闲', 'idle'],
    [{ status: 'idle' }, '空闲', 'idle'],
    [{ status: 'running', liveCompleted: true, displayStatus: 'completed' }, '进行中', 'running'],
    [{ status: 'error', liveCompleted: true, displayStatus: 'completed' }, '异常', 'error'],
    [{ status: 'aborted', liveCompleted: true, displayStatus: 'completed' }, '已停止', 'aborted'],
    [{ status: 'idle', liveCompleted: true, needsAnswer: true }, '需要你回答', 'needs_answer'],
    [{ status: 'running', needsAnswer: true }, '需要你回答', 'needs_answer'],
    [{ status: 'error', needsAnswer: true }, '需要你回答', 'needs_answer'],
  ];
  for (const [facts, label, status] of cases) {
    const session = { sessionId: 'task-1', title: '任务', ...facts };
    h.update({ allSessions: [session], taskSelection: { availability: 'ready', selectedSessionId: session.sessionId, session,
      detail: { sessionId: session.sessionId, status: 'idle', lastAssistantText: '旧回复' } } });
    h.view.open('allTasks');
    assert.equal(h.container.querySelector('.compact-task-status').textContent, label);
    assert.equal(h.container.querySelector('.compact-task-status').dataset.status, status);
    h.view.open('detail');
    assert.equal(h.container.querySelector('.compact-detail-status').textContent, label);
    assert.equal(h.container.querySelector('.compact-detail-status').dataset.status, status);
    if (facts.needsAnswer) assert.equal(h.container.querySelector('.compact-detail-reply').textContent, '需要你回答');
  }
});

domTest('duplicate and malformed task rows do not create duplicate controls', (t) => {
  const h = harness(t);
  h.update({ reminders: { items: [{ title: '无ID' }, task(1), task(1), task(2)] } }); h.view.open();
  assert.equal(h.container.querySelectorAll('.compact-task').length, 2);
  assert.deepEqual([...h.container.querySelectorAll('.compact-task-title')].map((node) => node.textContent), ['任务 1', '任务 2']);
});

domTest('task preview preserves all inert text so CSS can show five lines without data truncation', (t) => {
  const h = harness(t), previewText = '<script>not executable</script>\n第二行\n第三行\n第四行\n第五行\n第六行';
  h.update({ reminders: { items: [{ ...task(1), previewText }] } }); h.view.open();
  const preview = h.container.querySelector('.compact-task-preview');
  assert.equal(preview.textContent, previewText); assert.equal(preview.hidden, false); assert.equal(h.container.querySelector('script'), null);
  h.update({ reminders: { items: [{ ...task(1), previewText }] } }); assert.equal(h.container.querySelector('.compact-task-preview'), preview);
  h.update({ reminders: { items: [task(1)] } }); assert.equal(preview.hidden, true);
});

domTest('live ask overrides task status and old preview without losing its session target', (t) => {
  const h = harness(t);
  h.update({ reminders: { items: [{ ...task(1), needsAnswer: true, previewText: '旧回复' }] } }); h.view.open();
  assert.equal(h.container.querySelector('.compact-task-status').textContent, '需要你回答');
  assert.equal(h.container.querySelector('.compact-task-preview').textContent, '需要你回答');
  h.container.querySelector('.compact-task-title').click(); assert.deepEqual(h.calls, [['select', 'task-1']]);
  h.update({ reminders: { items: [{ ...task(1), needsAnswer: false, previewText: '回答后的新回复' }] } });
  assert.equal(h.container.querySelector('.compact-task-status').textContent, '进行中');
  assert.equal(h.container.querySelector('.compact-task-preview').textContent, '回答后的新回复');
});

domTest('detail loads complete inert text and retains the pet without additional actions', async (t) => {
  const h = harness(t), taskSelection = { ...selection(1), detail: null, detailLoading: true };
  h.update({ taskSelection }); h.view.open('detail');
  assert.equal(h.container.querySelector('.compact-detail-title').textContent, '任务 1');
  assert.equal(h.container.querySelector('.compact-detail-status').textContent, '进行中');
  assert.equal(h.container.querySelector('.compact-detail-reply').textContent, '正在读取任务…');
  assert.equal(h.container.querySelector('.compact-detail').getAttribute('aria-busy'), 'true');
  assert.deepEqual(h.calls, []);
  const text = '<img src=x onerror=alert(1)>\n第一行\n第二行\n第三行\n第四行\n第五行\n最后一行';
  h.update({ taskSelection: selection(1, text) });
  assert.equal(h.container.querySelector('.compact-detail-reply').textContent, text); assert.equal(h.container.querySelector('img'), null);
  assert.equal(h.container.querySelector('.compact-detail').getAttribute('aria-busy'), 'false');
  assert.deepEqual([...h.container.querySelector('.compact-detail .compact-footer').children].map((node) => node.textContent), ['返回任务']);
  assert.deepEqual(h.calls, []); assert.equal(h.view.opened, true);
});

domTest('matching details preserve scroll but mismatched late details clear it and reset for the new task', (t) => {
  const h = harness(t); h.update({ taskSelection: selection(1, '任务一旧回复') }); h.view.open('detail');
  const reply = h.container.querySelector('.compact-detail-reply'); reply.scrollTop = 50;
  for (let n = 0; n < 20; n++) h.update({ taskSelection: selection(1, '任务一旧回复') });
  assert.equal(reply.scrollTop, 50);
  h.update({ taskSelection: { ...selection(2), detail: { sessionId: 'task-1', lastAssistantText: '迟到的任务一回复' } } });
  assert.equal(reply.textContent, '正在读取任务…'); assert.equal(reply.scrollTop, 0);
  assert.equal(h.container.querySelector('.compact-detail-title').textContent, '任务 2');
  h.update({ taskSelection: selection(2, '任务二最新回复') }); assert.equal(reply.textContent, '任务二最新回复');
  assert.deepEqual(h.calls, []);
});

domTest('same-session background loading retains complete reply DOM and reading position', (t) => {
  const h = harness(t), text = Array.from({ length: 30 }, (_, n) => `第 ${n + 1} 行完整正文`).join('\n');
  const taskSelection = selection(1, text); h.update({ taskSelection }); h.view.open('detail');
  const reply = h.container.querySelector('.compact-detail-reply'), textNode = reply.firstChild;
  reply.scrollTop = 90;
  for (let n = 0; n < 5; n++) {
    h.update({ taskSelection: { ...taskSelection, detailLoading: true } });
    assert.equal(reply.textContent, text); assert.equal(reply.firstChild, textNode); assert.equal(reply.scrollTop, 90);
    assert.equal(h.container.querySelector('.compact-detail').getAttribute('aria-busy'), 'true');
    h.update({ taskSelection }); assert.equal(reply.firstChild, textNode); assert.equal(reply.scrollTop, 90);
  }
  h.update({ taskSelection: { ...selection(2), detail: null, detailLoading: true } });
  assert.equal(reply.textContent, '正在读取任务…'); assert.equal(reply.scrollTop, 0);
});

domTest('disconnect and removal clear prior task replies and stale ask indicators', (t) => {
  const h = harness(t), taskSelection = { ...selection(1), session: { ...task(1), needsAnswer: true } };
  h.update({ taskSelection }); h.view.open('detail');
  assert.equal(h.container.querySelector('.compact-detail-reply').textContent, '需要你回答');
  h.update({ taskSelection: { ...taskSelection, availability: 'disconnected' } });
  assert.equal(h.container.querySelector('.compact-detail-status').textContent, '暂不可用');
  assert.match(h.container.querySelector('.compact-detail-reply').textContent, /重新连接/);
  assert.equal(h.container.querySelector('.compact-detail-reply').textContent.includes('需要你回答'), false);
  h.update({ taskSelection: { availability: 'ready', selectedSessionId: null, detailError: 'session_not_found' } });
  assert.match(h.container.querySelector('.compact-detail-reply').textContent, /session_not_found/);
  assert.equal(h.view.opened, true); assert.deepEqual(h.calls, []);
});

domTest('a live detail ask beats old replies and its completion clears the exact prompt', (t) => {
  const h = harness(t), taskSelection = { ...selection(1, '旧回复不得盖住提问'), detailLoading: true, session: { ...task(1), needsAnswer: true } };
  h.update({ taskSelection }); h.view.open('detail');
  assert.equal(h.container.querySelector('.compact-detail-status').textContent, '需要你回答');
  assert.equal(h.container.querySelector('.compact-detail-reply').textContent, '需要你回答');
  assert.equal(h.container.querySelector('.compact-detail').getAttribute('aria-busy'), 'false');
  h.update({ taskSelection: { ...taskSelection, detailLoading: false, session: { ...task(1), needsAnswer: false } } });
  assert.equal(h.container.querySelector('.compact-detail-status').textContent, '进行中');
  assert.equal(h.container.querySelector('.compact-detail-reply').textContent, '旧回复不得盖住提问');
});

domTest('read failures and actual task errors replace old successful output', (t) => {
  const h = harness(t), taskSelection = { ...selection(1), session: task(1, 'error'),
    detail: { sessionId: 'task-1', status: 'error', error: '实际错误 <img src=x>', lastAssistantText: '前一轮成功回复' } };
  h.update({ taskSelection }); h.view.open('detail');
  assert.equal(h.container.querySelector('.compact-detail-reply').textContent, '实际错误 <img src=x>'); assert.equal(h.container.querySelector('img'), null);
  h.update({ taskSelection: { ...taskSelection, detailError: 'request_failed' } });
  assert.equal(h.container.querySelector('.compact-detail-reply').textContent, '无法读取任务（request_failed）。');
});

domTest('stable task updates retain focused controls and removal shows empty state', (t) => {
  const h = harness(t), items = [task(2), task(1)]; h.update({ reminders: { items } }); h.view.open();
  const control = h.container.querySelectorAll('.compact-task-title')[1]; control.focus();
  h.update({ reminders: { items: structuredClone(items) } });
  assert.equal(h.dom.window.document.activeElement, control); assert.equal(h.container.querySelectorAll('.compact-task-title')[1], control);
  h.update(); assert.equal(h.container.querySelectorAll('.compact-task').length, 0); assert.match(h.container.querySelector('.compact-empty').textContent, /暂无/);
});

domTest('legacy review state and callback arguments never create an entry or render results', (t) => {
  const noCall = () => assert.fail('Removed review callbacks must not be used.');
  const h = harness(t, { onReviewTask: noCall, onCancelReview: noCall, onOpenReview: noCall });
  h.update({ taskSelection: selection(1), reviewSnapshot: { target: { sessionId: 'task-1', title: '任务 1' }, text: '旧点评结果', busy: true, canOpen: true, canCancel: true } });
  h.view.open();
  assert.equal(h.container.querySelector('[class*=review]'), null);
  assert.equal(h.container.textContent.includes('点评'), false); assert.equal(h.container.textContent.includes('旧点评结果'), false);
  assert.equal(h.view.open('review'), false); assert.equal(h.view.view, 'tasks');
  h.view.open('detail');
  assert.equal(h.container.textContent.includes('点评'), false); assert.equal(h.container.querySelector('input,textarea,form'), null);
  assert.deepEqual(h.calls, []);
});

domTest('close callbacks are explicit and reopening defaults to tasks without hiding the pet owner', (t) => {
  const h = harness(t); h.update({ taskSelection: selection(1) }); h.view.open('detail'); h.view.close();
  assert.equal(h.view.opened, false); assert.deepEqual(h.calls, []);
  h.view.open(); assert.equal(h.view.view, 'tasks'); h.container.querySelector('.compact-close').click();
  assert.equal(h.view.opened, false); assert.deepEqual(h.calls, [['close']]);
  h.view.open(); assert.equal(h.view.opened, true); assert.equal(h.container.parentNode, h.dom.window.document.body);
});

domTest('disposal ignores detached controls, late callbacks, updates and all future opens', async (t) => {
  const request = deferred();
  const h = harness(t, { onSelectTask: () => request.promise });
  h.update({ reminders: { items: [task(1)] }, taskSelection: selection(1) }); h.view.open();
  const select = h.container.querySelector('.compact-task-title');
  select.click(); h.view.dispose(); request.reject(new Error('late')); await tick(); select.click();
  h.view.update({ taskSelection: selection(2) }); assert.equal(h.view.open(), false);
  assert.equal(h.container.childElementCount, 0); assert.equal(h.view.opened, false); assert.deepEqual(h.calls, []);
});


domTest('reminders and all tasks have no mark-as-seen action or callback', (t) => {
  const h = harness(t, { onDismissTask: () => assert.fail('The removed action must never run.') });
  const items = [task(1, 'completed'), { ...task(2), needsAnswer: true }];
  h.update({ reminders: { items }, allSessions: [...items, task(3, 'idle')] });
  for (const view of ['tasks', 'allTasks']) {
    h.view.open(view);
    assert.equal(h.container.querySelector('.compact-dismiss'), null);
    assert.equal([...h.container.querySelectorAll('button')].some((n) => /已看过/.test(n.textContent + n.getAttribute('aria-label'))), false);
    assert.equal(h.container.querySelectorAll('.compact-task').length, view === 'tasks' ? 2 : 3);
  }
  assert.deepEqual(h.calls, []);
});
