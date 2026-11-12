import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { createPanelNavigation } from '../miniapp/client/panel-navigation.mjs';
import { taskStatus } from '../miniapp/client/compact-pet-view.mjs';
import { renderMarkdown } from '../miniapp/client/markdown.mjs';
import { localeFor, t, translate } from '../miniapp/client/i18n.mjs';

const { JSDOM } = createRequire(import.meta.url)('jsdom');
const source = await readFile(new URL('../miniapp/client/pet-app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
const select = source.slice(source.indexOf('function selectSession('), source.indexOf('// Window', source.indexOf('function selectSession(')));
const detail = source.slice(source.indexOf('function renderDetail()'), source.indexOf('function initWorkbench()'));
const navigate = source.slice(source.indexOf('function focusFullPanel('), source.indexOf('async function openWorkbench('));
const hostOpen = source.slice(source.indexOf('function describeOpenError('), source.indexOf('// The Host reports the resolved theme'));
// Only the subscription itself: applyLanguage belongs to the page and is stubbed in the test.
const hostUi = source.slice(source.indexOf('function hostTag('), source.indexOf('function setLanguagePreference('));
const errCode = source.slice(source.indexOf('function errCode('), source.indexOf('function logError('));
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };
const settle = () => new Promise((resolve) => setImmediate(resolve));
function harness(t, patch = {}) {
  const dom = new JSDOM(html), doc = dom.window.document;
  const nav = createPanelNavigation({ panel: doc.getElementById('panel') });
  const els = Object.fromEntries(['detailTitle', 'detailStatus', 'detailTime', 'detailError', 'detailReply', 'detailNote',
    'detailActions', 'detailOpen', 'detailOpenMsg'].map((name) => [name, doc.getElementById(name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`))]));
  const app = { mode: 'inline', source: 'real', availability: 'ready', sessions: [], selectedSessionId: null, detail: null, ...patch };
  const selected = [], reports = [], compact = [], opens = [], warnings = [], pending = deferred();
  const hostNavigation = { open: (target) => { opens.push(target); return patch.openResult ? patch.openResult(target) : Promise.resolve({ status: 'opened' }); } };
  const context = vm.createContext({
    app, els, document: doc, panelNavigation: nav, panelDetailId: null, disposed: false, taskStatus,
    canOpenSession: patch.canOpenSession ?? true, hostNavigation, detailOpenToken: 0, detailOpenSessionId: null,
    activitySource: { selectSession: (id) => { selected.push(id); return pending.promise; } },
    openTaskPreview: (id) => compact.push(id),
    callBridge: (callback) => { try { return Promise.resolve(callback()); } catch (error) { return Promise.reject(error); } },
    setMsg: (element, text, kind = 'info') => { reports.push(text); if (element) { element.textContent = text || ''; element.dataset.kind = kind; } },
    availabilityText: () => '连接不可用', console: { warn: (...args) => warnings.push(args) }, renderMarkdown,
    t: translate, localeFor, prefs: { language: 'auto' },
    statusLabel: (status) => translate(({ idle: 'status.idle', completed: 'status.completed', running: 'status.running', error: 'status.error' })[status] ?? 'desk.toView'),
    // The panel shows "本次完成" for an observed completion, which the shared label does not know.
    taskStatusLabel: (status) => (status === 'completed' ? '本次完成' : translate(({ idle: 'status.idle', running: 'status.running', error: 'status.error' })[status] ?? 'desk.toView')),
    statusText: () => '',
  });
  vm.runInContext(`${errCode}\n${select}\n${detail}\n${navigate}\n${hostOpen}\nglobalThis.handlers = { selectSession, renderDetail, focusFullPanel, openSelectedSession, openSessionInHost };`, context);
  t.after(() => { nav.dispose(); dom.window.close(); });
  return { app, nav, els, doc, context, selected, reports, compact, opens, warnings, pending, ...context.handlers };
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

test('explicit panel entries map tasks and task detail to their real pages', (t) => {
  const h = harness(t); h.nav.showTab('settings');
  h.focusFullPanel('detail'); assert.equal(h.nav.getState().tab, 'tasks'); assert.equal(h.nav.getState().taskDetail, true);
  h.focusFullPanel('tasks'); assert.equal(h.nav.getState().taskDetail, false);
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
  assert.equal(h.els.detailStatus.textContent, '已完成'); assert.equal(h.nav.getState().tab, 'settings');
  h.app.selectedSessionId = 'b'; h.app.detail = null; h.renderDetail(); assert.equal(h.els.detailReply.scrollTop, 0);
});

test('live ask replaces the old reply in the formal task detail without navigating', (t) => {
  const h = harness(t, { selectedSessionId: 'a', sessions: [{ sessionId: 'a', status: 'running', needsAnswer: true }],
    detail: { sessionId: 'a', title: '任务A', status: 'running', updatedAtMs: 1, lastAssistantText: '上一轮旧回复' } });
  h.nav.showTab('appearance'); h.renderDetail();
  assert.equal(h.els.detailStatus.textContent, '需要你回答'); assert.equal(h.els.detailReply.textContent, '需要你回答');
  assert.equal(h.nav.getState().tab, 'appearance');
});

const readySelection = (needsAnswer = false) => ({ selectedSessionId: 'a',
  sessions: [{ sessionId: 'a', title: '任务A', status: 'running', needsAnswer }],
  detail: { sessionId: 'a', title: '任务A', status: 'running', updatedAtMs: 1, lastAssistantText: '回复' } });

test('the detail offers to open the selected conversation, or to answer it, only when the Host can navigate', (t) => {
  const h = harness(t, readySelection());
  h.renderDetail();
  assert.equal(h.els.detailActions.hidden, false); assert.equal(h.els.detailOpen.textContent, '打开对话');
  h.app.sessions = [{ ...h.app.sessions[0], needsAnswer: true }]; h.renderDetail();
  assert.equal(h.els.detailOpen.textContent, '去回答');
  for (const patch of [{ availability: 'unavailable' }, { availability: 'ready', selectedSessionId: null }, { source: 'demo', selectedSessionId: 'a' }]) {
    Object.assign(h.app, patch); h.renderDetail(); assert.equal(h.els.detailActions.hidden, true, JSON.stringify(patch));
  }
  const old = harness(t, { ...readySelection(), canOpenSession: false });
  old.renderDetail(); assert.equal(old.els.detailActions.hidden, true);
  assert.deepEqual(h.opens, []);
});

test('opening calls the Host synchronously with the local session and reports the outcome', async (t) => {
  const open = deferred();
  const h = harness(t, { ...readySelection(), openResult: () => open.promise });
  h.renderDetail(); h.openSelectedSession();
  assert.equal(JSON.stringify(h.opens), JSON.stringify([{ id: 'session', sessionId: 'a', source: 'local' }]));
  assert.equal(h.els.detailOpen.disabled, true); assert.equal(h.els.detailOpenMsg.textContent, '正在打开对话…');
  open.resolve({ status: 'opened' }); await settle();
  assert.equal(h.els.detailOpen.disabled, false); assert.equal(h.els.detailOpenMsg.dataset.kind, 'ok');
  assert.match(h.els.detailOpenMsg.textContent, /已在 MiniMax Code 主窗口打开/);
  assert.equal(h.nav.getState().tab, 'appearance');
});

test('a brief disconnect hides the button without dropping a pending open', async (t) => {
  const open = deferred();
  const h = harness(t, { ...readySelection(), openResult: () => open.promise });
  h.renderDetail(); h.openSelectedSession();
  h.app.availability = 'unavailable'; h.renderDetail(); assert.equal(h.els.detailActions.hidden, true);
  h.app.availability = 'ready'; h.renderDetail();
  assert.equal(h.els.detailActions.hidden, false); assert.equal(h.els.detailOpen.disabled, true);
  open.resolve({ status: 'opened' }); await settle();
  assert.equal(h.els.detailOpen.disabled, false); assert.equal(h.els.detailOpenMsg.dataset.kind, 'ok');
});

test('a late open result for a previous task never lands on the newly selected one', async (t) => {
  const open = deferred();
  const h = harness(t, { ...readySelection(), openResult: () => open.promise });
  h.renderDetail(); h.openSelectedSession();
  h.app.selectedSessionId = 'b'; h.app.detail = null; h.renderDetail();
  assert.equal(h.els.detailOpen.disabled, false); assert.equal(h.els.detailOpenMsg.textContent, '');
  open.resolve({ status: 'opened' }); await settle();
  assert.equal(h.els.detailOpenMsg.textContent, '');
});

test('cancellations and Host errors are explained once and never retried', async (t) => {
  const outcomes = [
    [() => Promise.resolve({ status: 'cancelled', reason: 'user_cancelled' }), 'info', /已取消/],
    [() => Promise.resolve({ status: 'cancelled', reason: 'superseded' }), 'info', /取代/],
    [() => Promise.reject({ code: 'target_unavailable', message: 'gone' }), 'error', /target_unavailable/],
    [() => Promise.reject({ code: 'unsupported_source', message: 'remote' }), 'error', /不在本机/],
    [() => Promise.reject({ code: 'result_unknown', message: 'timeout' }), 'error', /result_unknown/],
    [() => { throw { code: 'not_permitted', message: 'gesture' }; }, 'error', /直接点击/],
    [() => Promise.reject({ code: 'brand_new', message: '' }), 'error', /brand_new/],
  ];
  for (const [openResult, kind, text] of outcomes) {
    const h = harness(t, { ...readySelection(), openResult });
    h.renderDetail(); h.openSelectedSession(); await settle();
    assert.equal(h.opens.length, 1); assert.equal(h.els.detailOpenMsg.dataset.kind, kind);
    assert.match(h.els.detailOpenMsg.textContent, text); assert.equal(h.els.detailOpen.disabled, false);
  }
});

test('an older Host without navigation answers without calling anything', async (t) => {
  const h = harness(t, { canOpenSession: false });
  assert.equal(JSON.stringify(await h.openSessionInHost('a')), JSON.stringify({ kind: 'error', text: '当前 MiniMax Code 版本不能从桌宠打开对话。' }));
  assert.deepEqual(h.opens, []);
});

test('the page follows the Host theme and disposes its subscription', () => {
  const root = { dataset: {} }, disposers = [], listeners = [];
  let disposed = 0;
  const ui = { subscribe: (listener, options) => { listeners.push([listener, options]); return { dispose: () => { disposed++; } }; } };
  const context = vm.createContext({
    host: { host: { ui } }, root, disposers, console: { warn() {} }, prefs: { language: 'auto' }, preferencesReady: true,
    // applyLanguage is exercised by the page, not here; the Host listener only forwards the tag.
    applyLanguage: () => { applied.push(root.dataset.hostLanguage); },
  });
  const applied = [];
  vm.runInContext(`${errCode}\n${hostUi}\ninitHostUi();`, context);
  assert.equal(listeners.length, 1);
  const [listener, { onError }] = listeners[0];
  listener({ theme: 'dark', language: 'zh-Hans' }); assert.equal(root.dataset.theme, 'dark');
  listener({ theme: 'sepia', language: 'en' }); assert.equal(root.dataset.theme, 'dark');
  listener({ theme: 'light', language: 'en' }); assert.equal(root.dataset.theme, 'light');
  // The first Host state pins the language; a later change reaches applyLanguage again.
  assert.deepEqual(applied, ['zh-Hans', 'en'], 'the Host language reaches applyLanguage while the preference is auto');
  onError({ code: 'host_unavailable', message: '' }); assert.equal(root.dataset.theme, 'light');
  for (const dispose of disposers) dispose();
  assert.equal(disposed, 1);
  const absent = vm.createContext({ host: {}, root: { dataset: {} }, disposers: [], console: { warn() {} } });
  vm.runInContext(`${errCode}\n${hostUi}\ninitHostUi();`, absent);
  assert.deepEqual(absent.disposers, []); assert.equal(absent.root.dataset.theme, undefined);
});

test('a Host language that arrives before the stored preference is only recorded', () => {
  const root = { dataset: {} }, disposers = [], listeners = [], applied = [];
  const ui = { subscribe: (listener) => { listeners.push(listener); return { dispose() {} }; } };
  const context = vm.createContext({
    host: { host: { ui } }, root, disposers, console: { warn() {} }, prefs: { language: 'auto' }, preferencesReady: false,
    applyLanguage: () => applied.push(root.dataset.hostLanguage),
  });
  vm.runInContext(`${errCode}\n${hostUi}\ninitHostUi();`, context);
  listeners[0]({ theme: 'dark', language: 'en' });
  // Painting here would run before the stored 'zh-Hans' preference loads and flash the wrong copy.
  assert.deepEqual(applied, []);
  assert.equal(root.dataset.hostLanguage, 'en', 'the tag is kept for the boot-time paint');
  context.preferencesReady = true;
  listeners[0]({ language: 'zh-Hans' });
  assert.deepEqual(applied, ['zh-Hans']);
});
