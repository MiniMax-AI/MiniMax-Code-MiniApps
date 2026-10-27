import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { createPanelNavigation } from '../miniapp/client/panel-navigation.mjs';
import { taskStatus } from '../miniapp/client/compact-pet-view.mjs';

const { JSDOM } = createRequire(import.meta.url)('jsdom');
const source = await readFile(new URL('../miniapp/client/pet-app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
const select = source.slice(source.indexOf('function selectSession('), source.indexOf('// Window', source.indexOf('function selectSession(')));
const detail = source.slice(source.indexOf('function renderDetail()'), source.indexOf('function initWorkbench()'));
const navigate = source.slice(source.indexOf('function focusFullPanel('), source.indexOf('function openFullPanel('));
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };
const settle = () => new Promise((resolve) => setImmediate(resolve));
function harness(t, patch = {}) {
  const dom = new JSDOM(html), doc = dom.window.document;
  const nav = createPanelNavigation({ panel: doc.getElementById('panel') });
  const els = Object.fromEntries(['detailTitle', 'detailStatus', 'detailTime', 'detailError', 'detailReply', 'detailNote'].map((name) => [name, doc.getElementById(name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`))]));
  const app = { mode: 'inline', source: 'real', availability: 'ready', sessions: [], selectedSessionId: null, detail: null, ...patch };
  const selected = [], reports = [], compact = [], pending = deferred();
  const context = vm.createContext({
    app, els, document: doc, panelNavigation: nav, panelDetailId: null, disposed: false, canAppend: true, taskStatus,
    activitySource: { selectSession: (id) => { selected.push(id); return pending.promise; } },
    openTaskPreview: (id) => compact.push(id), callBridge: (callback) => Promise.resolve(callback()),
    setMsg: (_element, text) => reports.push(text), availabilityText: () => '连接不可用',
    STATUS_LABEL: { idle: '空闲', completed: '本次完成', running: '工作中', error: '异常' },
  });
  vm.runInContext(`${select}\n${detail}\n${navigate}\nglobalThis.handlers = { selectSession, renderDetail, focusFullPanel };`, context);
  t.after(() => { nav.dispose(); dom.window.close(); });
  return { app, nav, els, doc, context, selected, reports, compact, pending, ...context.handlers };
}

test('selecting an inline task reveals its detail immediately; its delayed result never changes the new tab', async (t) => {
  const h = harness(t); h.nav.showTab('settings');
  h.selectSession('a');
  assert.deepEqual(h.selected, ['a']);
  assert.equal(h.nav.getState().tab, 'tasks'); assert.equal(h.nav.getState().taskDetail, true);
  h.nav.showTab('appearance'); h.pending.resolve(); await settle();
  assert.equal(h.nav.getState().tab, 'appearance');
});

test('desktop task selection stays in the compact window and does not navigate the inline panel', (t) => {
  const h = harness(t, { mode: 'window' }); h.nav.showTab('settings'); h.selectSession('a');
  assert.deepEqual(h.compact, ['a']); assert.deepEqual(h.selected, []);
  assert.equal(h.nav.getState().tab, 'settings');
});

test('explicit panel entries map tasks and original-chat draft to their real pages', (t) => {
  const h = harness(t); h.focusFullPanel('draft');
  assert.equal(h.nav.getState().tab, 'settings'); assert.equal(h.nav.getState().settingsView, 'draft');
  assert.equal(h.doc.activeElement.id, 'talk-text');
  h.focusFullPanel('detail'); assert.equal(h.nav.getState().tab, 'tasks'); assert.equal(h.nav.getState().taskDetail, true);
  h.focusFullPanel('tasks'); assert.equal(h.nav.getState().taskDetail, false);
});

test('an environment without append capability cannot enter the draft from a panel action', (t) => {
  const h = harness(t); h.context.canAppend = false; h.focusFullPanel('draft');
  assert.equal(h.nav.getState().tab, 'appearance'); assert.equal(h.nav.getState().settingsView, 'main');
});

test('explicit task navigation focuses the detail heading and returns to the selected row', (t) => {
  const h = harness(t), button = h.doc.createElement('button');
  button.dataset.sessionId = 'a'; button.textContent = '任务A'; h.doc.getElementById('session-list').append(button);
  h.nav.showTab('tasks'); h.nav.setTaskFilter('all'); button.focus(); h.nav.showTaskDetail();
  assert.equal(h.doc.activeElement.id, 'detail-title');
  h.nav.showTaskList();
  assert.equal(h.doc.activeElement, button); assert.equal(h.nav.getState().taskFilter, 'all');
});

test('background details retain reply content and scroll; only a different task resets the reading position', (t) => {
  const h = harness(t, { selectedSessionId: 'a', sessions: [{ sessionId: 'a', status: 'idle', liveCompleted: true }],
    detail: { sessionId: 'a', title: '任务A', status: 'idle', updatedAtMs: 1, lastAssistantText: '完整任务回复'.repeat(200) } });
  h.renderDetail(); const node = h.els.detailReply.firstChild; h.els.detailReply.scrollTop = 180;
  h.app.detailLoading = true; h.nav.showTab('settings'); h.renderDetail();
  assert.equal(h.els.detailReply.firstChild, node); assert.equal(h.els.detailReply.scrollTop, 180);
  assert.equal(h.els.detailStatus.textContent, '本次完成'); assert.equal(h.nav.getState().tab, 'settings');
  h.app.selectedSessionId = 'b'; h.app.detail = null; h.renderDetail(); assert.equal(h.els.detailReply.scrollTop, 0);
});

test('live ask replaces the old reply in the formal task detail without navigating', (t) => {
  const h = harness(t, { selectedSessionId: 'a', sessions: [{ sessionId: 'a', status: 'running', needsAnswer: true }],
    detail: { sessionId: 'a', title: '任务A', status: 'running', updatedAtMs: 1, lastAssistantText: '上一轮旧回复' } });
  h.nav.showTab('appearance'); h.renderDetail();
  assert.equal(h.els.detailStatus.textContent, '需要你回答'); assert.equal(h.els.detailReply.textContent, '需要你回答');
  assert.equal(h.nav.getState().tab, 'appearance');
});
