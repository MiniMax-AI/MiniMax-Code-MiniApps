import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createPanelNavigation } from '../miniapp/client/panel-navigation.mjs';

let JSDOM;
try { ({ JSDOM } = createRequire(import.meta.url)('jsdom')); } catch { /* Supplied through the existing workspace NODE_PATH. */ }
const domTest = JSDOM ? test : test.skip;
const fixture = `<!doctype html><div id="panel">
  <nav id="panel-tabs" role="tablist" aria-label="桌宠">
    <button role="tab" data-panel-tab="appearance">外观</button>
    <button role="tab" data-panel-tab="tasks">任务</button>
    <button role="tab" data-panel-tab="settings">设置</button>
  </nav>
  <span id="panel-task-count" hidden></span><span id="connection-status"></span>
  <section data-panel-page="appearance">
    <div id="appearance-main"><button id="open-import">导入宠物</button><ul id="gallery"><li>宠物</li></ul></div>
    <section id="import-panel" hidden><button id="import-back">返回宠物</button><input id="import-input" type="file"></section>
  </section>
  <section data-panel-page="tasks" hidden>
    <button id="task-filter-recent">当前提醒</button><button id="task-filter-all">全部任务</button>
    <div id="recent-tasks"><ul id="reminder-list"><li>最近任务</li></ul></div>
    <div id="all-sessions" hidden><ul id="session-list"><li>任务一</li><li>任务二</li></ul></div>
    <section id="detail-card"><button id="task-detail-back">返回任务</button><pre id="detail-reply">完整回复</pre></section>
  </section>
  <section data-panel-page="settings" hidden>
    <div id="settings-main"><button id="open-draft">写入聊天草稿</button></div>
    <section id="draft-card" hidden><button id="draft-back">返回设置</button><textarea id="talk-text"></textarea></section>
  </section>
</div>`;
function harness(t, options = {}) {
  const dom = new JSDOM(fixture);
  const panel = dom.window.document.getElementById('panel');
  const nav = createPanelNavigation({ panel, ...options });
  t.after(() => { nav.dispose(); dom.window.close(); });
  const find = (selector) => panel.querySelector(selector);
  const tab = (name) => find(`[data-panel-tab="${name}"]`);
  const page = (name) => find(`[data-panel-page="${name}"]`);
  const key = (name, value) => {
    const event = new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true });
    tab(name).dispatchEvent(event); return event;
  };
  return { dom, panel, nav, find, tab, page, key };
}
const defaultState = { tab: 'appearance', appearanceView: 'pets', settingsView: 'main', taskFilter: 'recent', taskDetail: false };

function assertTab(h, active) {
  for (const name of ['appearance', 'tasks', 'settings']) {
    assert.equal(h.page(name).hidden, name !== active, `${name} page visibility`);
    assert.equal(h.tab(name).getAttribute('aria-selected'), String(name === active), `${name} selected`);
    assert.equal(h.tab(name).tabIndex, name === active ? 0 : -1, `${name} roving focus`);
  }
}

domTest('the panel starts on appearance with one keyboard-reachable tab', (t) => {
  const h = harness(t);
  assert.deepEqual(h.nav.getState(), defaultState);
  assertTab(h, 'appearance');
  assert.equal(h.find('#appearance-main').hidden, false);
  assert.equal(h.find('#import-panel').hidden, true);
  assert.equal(h.find('#settings-main').hidden, false);
  assert.equal(h.find('#draft-card').hidden, true);
  assert.equal(h.find('#recent-tasks').hidden, false);
  assert.equal(h.find('#all-sessions').hidden, true);
});

domTest('tab buttons switch pages and programmatic navigation only focuses when requested', (t) => {
  const h = harness(t);
  h.tab('appearance').focus();
  h.nav.showTab('tasks');
  assertTab(h, 'tasks');
  assert.equal(h.dom.window.document.activeElement, h.tab('appearance'));
  h.nav.showTab('settings', { focus: true });
  assertTab(h, 'settings');
  assert.equal(h.dom.window.document.activeElement, h.tab('settings'));
  h.tab('appearance').click(); assertTab(h, 'appearance');
});

domTest('arrow, Home and End keys activate and focus tabs with wraparound', (t) => {
  const h = harness(t);
  h.tab('appearance').focus();
  for (const [from, key, expected] of [
    ['appearance', 'ArrowLeft', 'settings'], ['settings', 'ArrowRight', 'appearance'],
    ['appearance', 'ArrowRight', 'tasks'], ['tasks', 'End', 'settings'], ['settings', 'Home', 'appearance'],
  ]) {
    assert.equal(h.key(from, key).defaultPrevented, true);
    assertTab(h, expected);
    assert.equal(h.dom.window.document.activeElement, h.tab(expected));
  }
  assert.equal(h.key('appearance', 'ArrowDown').defaultPrevented, false);
  assertTab(h, 'appearance');
});

domTest('unknown tab or task filter does not corrupt the current page', (t) => {
  const h = harness(t);
  h.nav.showTab('tasks'); h.nav.setTaskFilter('all');
  const state = h.nav.getState();
  h.nav.showTab('missing'); h.nav.setTaskFilter('missing');
  assert.deepEqual(h.nav.getState(), state);
  assertTab(h, 'tasks');
});

domTest('import is an appearance subpage and changing tabs preserves its selection controls', (t) => {
  const h = harness(t);
  h.nav.showTab('settings'); h.find('#open-import').click();
  assertTab(h, 'appearance'); assert.equal(h.nav.getState().appearanceView, 'import');
  assert.equal(h.find('#appearance-main').hidden, true); assert.equal(h.find('#import-panel').hidden, false);
  const input = h.find('#import-input');
  h.nav.showTab('tasks'); h.nav.showTab('appearance');
  assert.equal(h.nav.getState().appearanceView, 'import');
  assert.equal(h.find('#import-input'), input);
  h.find('#import-back').click();
  assert.equal(h.nav.getState().appearanceView, 'pets');
  assert.equal(h.find('#appearance-main').hidden, false); assert.equal(h.find('#import-panel').hidden, true);
});

domTest('a busy import can veto returning until the upload releases it', (t) => {
  let allowed = false, calls = 0;
  const h = harness(t, { beforeCloseImport: () => { calls++; return allowed; } });
  h.nav.showImport(); h.find('#import-back').click();
  assert.equal(calls, 1); assert.equal(h.nav.getState().appearanceView, 'import');
  allowed = true; h.nav.closeImport();
  assert.equal(calls, 2); assert.equal(h.nav.getState().appearanceView, 'pets');
});

domTest('a completed import returns to pets without changing the current page or calling user cancellation', (t) => {
  let cancellations = 0;
  const h = harness(t, { beforeCloseImport: () => { cancellations++; return false; } });
  h.nav.showImport(); h.nav.showTab('settings'); h.tab('settings').focus();
  h.nav.completeImport();
  assert.equal(h.nav.getState().appearanceView, 'pets'); assertTab(h, 'settings');
  assert.equal(h.dom.window.document.activeElement, h.tab('settings')); assert.equal(cancellations, 0);
  h.nav.showTab('appearance');
  assert.equal(h.find('#appearance-main').hidden, false); assert.equal(h.find('#import-panel').hidden, true);
});

domTest('draft entry focuses its text and leaving cancels recording once while retaining typed text', (t) => {
  let leaves = 0;
  const h = harness(t, { onLeaveDraft: () => { leaves++; } });
  h.find('#open-draft').click();
  assertTab(h, 'settings'); assert.equal(h.nav.getState().settingsView, 'draft');
  assert.equal(h.find('#settings-main').hidden, true); assert.equal(h.find('#draft-card').hidden, false);
  assert.equal(h.dom.window.document.activeElement, h.find('#talk-text'));
  h.find('#talk-text').value = '需要保留的原属聊天草稿';
  h.nav.showTab('tasks');
  assert.equal(leaves, 1); assert.equal(h.nav.getState().settingsView, 'main');
  h.nav.showTab('appearance'); assert.equal(leaves, 1);
  h.nav.showTab('settings');
  assert.equal(h.find('#settings-main').hidden, false); assert.equal(h.find('#draft-card').hidden, true);
  h.nav.showDraft();
  assert.equal(h.find('#talk-text').value, '需要保留的原属聊天草稿');
  h.find('#draft-back').click();
  assert.equal(leaves, 2); assertTab(h, 'settings'); assert.equal(h.nav.getState().settingsView, 'main');
});

domTest('entering a detail from another page switches to tasks and preserves the chosen list', (t) => {
  const h = harness(t);
  h.nav.setTaskFilter('all'); h.nav.showTab('appearance'); h.nav.showTaskDetail();
  assertTab(h, 'tasks'); assert.equal(h.nav.getState().taskDetail, true);
  assert.equal(h.nav.getState().taskFilter, 'all'); assert.equal(h.panel.dataset.taskDetail, 'open');
  h.nav.showTab('settings'); h.nav.showTab('tasks');
  assert.equal(h.nav.getState().taskDetail, true); assert.equal(h.nav.getState().taskFilter, 'all');
});

domTest('returning from a task keeps its list nodes, filter and reading position', (t) => {
  const h = harness(t);
  h.find('#task-filter-all').click();
  const list = h.find('#session-list'), row = list.firstElementChild;
  list.scrollTop = 120; h.find('#all-sessions').scrollTop = 80;
  h.nav.showTaskDetail(); h.find('#task-detail-back').click();
  assertTab(h, 'tasks'); assert.equal(h.nav.getState().taskDetail, false); assert.equal(h.nav.getState().taskFilter, 'all');
  assert.notEqual(h.panel.dataset.taskDetail, 'open');
  assert.equal(h.find('#session-list'), list); assert.equal(list.firstElementChild, row);
  assert.equal(list.scrollTop, 120); assert.equal(h.find('#all-sessions').scrollTop, 80);
  assert.equal(h.find('#all-sessions').hidden, false); assert.equal(h.find('#recent-tasks').hidden, true);
  h.find('#task-filter-recent').click();
  assert.equal(h.nav.getState().taskFilter, 'recent'); assert.equal(h.find('#recent-tasks').hidden, false);
  assert.equal(h.find('#all-sessions').hidden, true);
});

domTest('background connection and reminder updates do not switch pages or take keyboard focus', (t) => {
  const h = harness(t);
  h.nav.showDraft(); h.find('#talk-text').value = '尚未提交';
  const before = h.nav.getState();
  h.nav.update({ reminderCount: 3, availability: 'ready' });
  assert.deepEqual(h.nav.getState(), before);
  assert.equal(h.find('#panel-task-count').textContent, '3'); assert.equal(h.find('#panel-task-count').hidden, false);
  assert.equal(h.find('#connection-status').dataset.status, 'ready');
  assert.equal(h.find('#connection-status').textContent, '已连接');
  assert.equal(h.dom.window.document.activeElement, h.find('#talk-text')); assert.equal(h.find('#talk-text').value, '尚未提交');
  h.nav.update({ reminderCount: 0, availability: 'unavailable' });
  assert.equal(h.find('#panel-task-count').hidden, true);
  assert.equal(h.find('#connection-status').dataset.status, 'unavailable');
  assert.equal(h.find('#connection-status').textContent, '连接中断');
  assert.deepEqual(h.nav.getState(), before); assert.equal(h.dom.window.document.activeElement, h.find('#talk-text'));
});

domTest('connection labels describe each availability and large reminder counts stay compact', (t) => {
  const h = harness(t);
  for (const [availability, text] of [['ready', '已连接'], ['connecting', '连接中'], ['not_permitted', '未授权'], ['unavailable', '连接中断']]) {
    h.nav.update({ reminderCount: 101, availability });
    assert.equal(h.find('#connection-status').textContent, text);
    assert.equal(h.find('#connection-status').dataset.status, availability);
    assert.equal(h.find('#panel-task-count').textContent, '99+');
  }
  assertTab(h, 'appearance');
});

domTest('state snapshots cannot mutate the navigation state', (t) => {
  const h = harness(t);
  const snapshot = h.nav.getState(); snapshot.tab = 'tasks'; snapshot.taskDetail = true;
  assert.deepEqual(h.nav.getState(), defaultState); assertTab(h, 'appearance');
});

domTest('disposing disconnects controls and ignores late updates without invoking cleanup twice', (t) => {
  let leaves = 0, closes = 0;
  const h = harness(t, { onLeaveDraft: () => { leaves++; }, beforeCloseImport: () => { closes++; return true; } });
  h.nav.showDraft(); h.nav.dispose();
  const state = h.nav.getState(), calls = leaves, connection = h.find('#connection-status').textContent;
  h.tab('tasks').click(); h.find('#open-import').click(); h.find('#draft-back').click();
  h.key('settings', 'Home'); h.nav.update({ reminderCount: 4, availability: 'ready' });
  h.nav.showTab('appearance'); h.nav.showImport(); h.nav.closeImport(); h.nav.completeImport(); h.nav.showDraft(); h.nav.showTaskDetail(); h.nav.showTaskList(); h.nav.setTaskFilter('all'); h.nav.dispose();
  assert.deepEqual(h.nav.getState(), state); assert.equal(leaves, calls); assert.equal(closes, 0);
  assert.equal(h.find('#connection-status').textContent, connection);
});

domTest('the shipped page exposes all navigation targets and keeps the existing feature controls', async () => {
  const html = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html);
  try {
    const doc = dom.window.document;
    const ids = [...doc.querySelectorAll('[id]')].map((node) => node.id);
    assert.equal(new Set(ids).size, ids.length, 'IDs must remain unique');
    const panel = doc.getElementById('panel');
    assert.ok(panel); assert.equal(panel.querySelectorAll('#panel-tabs [role="tab"]').length, 3);
    for (const name of ['appearance', 'tasks', 'settings']) {
      assert.equal(panel.querySelectorAll(`[data-panel-tab="${name}"]`).length, 1);
      assert.equal(panel.querySelectorAll(`[data-panel-page="${name}"]`).length, 1);
    }
    const required = ['appearance-main', 'import-panel', 'settings-main', 'draft-card', 'open-import', 'import-back',
      'open-draft', 'draft-back', 'recent-tasks', 'all-sessions', 'task-filter-recent', 'task-filter-all',
      'task-detail-back', 'panel-task-count', 'connection-status', 'panel-stage', 'pet-sprite', 'wave-btn', 'jump-btn',
      'gallery', 'gallery-msg', 'dropzone', 'import-pick', 'import-input', 'import-preview', 'import-cancel', 'import-confirm',
      'aggregate-counts', 'reminder-list', 'muted-reminders', 'muted-list', 'session-list', 'activity-retry',
      'detail-card', 'detail-title', 'detail-status', 'detail-time', 'detail-reply', 'talk-form', 'talk-text', 'talk-btn',
      'draft-speech', 'speech-start', 'speech-stop', 'speech-cancel', 'scale-group'];
    for (const id of required) assert.ok(panel.querySelector(`#${id}`), `Missing existing or navigation control #${id}`);
    const nav = createPanelNavigation({ panel });
    try {
      assert.equal(nav.getState().tab, 'appearance');
      nav.showImport(); assert.equal(panel.querySelector('#import-panel').hidden, false);
      nav.showDraft(); assert.equal(panel.querySelector('#draft-card').hidden, false);
      nav.showTaskDetail(); assert.equal(panel.dataset.taskDetail, 'open');
      nav.showTaskList(); assert.equal(nav.getState().taskDetail, false);
    } finally { nav.dispose(); }
  } finally { dom.window.close(); }
});
