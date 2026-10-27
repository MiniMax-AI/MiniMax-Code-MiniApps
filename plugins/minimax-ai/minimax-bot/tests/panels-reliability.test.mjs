import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<div class="app"><button id="trigger">Settings</button><main id="main"><textarea></textarea></main><aside id="drawer"></aside></div><div id="overlay-root"></div><div id="toast" hidden></div>', { url: 'http://localhost/bot' });
for (const key of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Node', 'FormData']) Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
window.matchMedia = () => ({ matches: false });
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
const { state, nav } = await import('../miniapp/client/core.js');
const { setLocale } = await import('../miniapp/client/i18n.js');
const { openOverlay, closeOverlay, renderOverlay, renderDrawer } = await import('../miniapp/client/panels.js');
setLocale('en');
state.bots = [{ id: 'b1', name: 'Rob', role: 'Coordinator', skin: 'bubble', isMain: true }];
state.current = 'bot:b1';
let requests = [];
let revision = 1;
let entries = [{ id: 'm1', key: 'project.status', text: 'The original memory', source: 'User', added: '2026-10-15', revision: 'v1', pinned: false }];
globalThis.fetch = async (url, options = {}) => {
  requests.push({ url, method: options.method ?? 'GET', body: options.body ? JSON.parse(options.body) : undefined });
  if (url.includes('/api/memory/')) {
    let entry;
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      const index = entries.findIndex((item) => item.id === body.replaceId);
      entry = { ...(entries[index] ?? { id: `m${entries.length + 1}` }), text: body.text, ...(body.key ? { key: body.key } : {}), pinned: body.pinned, revision: `v${++revision}` };
      if (index >= 0) entries = entries.map((item, i) => i === index ? entry : item);
      else entries = [...entries, entry];
    }
    return { ok: true, json: async () => ({ entries, entry, chars: 80, budget: { used: 80, limit: 100000, remaining: 99920, entryMax: 1200, entryOverhead: 0, entryCount: entries.length, entryLimit: 1000, unit: 'characters' }, contextBudget: { limit: 6000, unit: 'characters' } }) };
  }
  if (url.includes('/api/usage')) return { ok: true, json: async () => ({ byBot: [] }) };
  return { ok: true, json: async () => ({}) };
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('background state refresh keeps the schedule form, its draft, selection and focus', () => {
  openOverlay({ kind: 'settings', page: 'schedules' });
  const form = document.querySelector('.set-body form');
  const input = form.elements.namedItem('prompt');
  input.value = 'Send the draft later'; input.focus(); input.setSelectionRange(3, 9);
  state.schedules = [{ id: 's1', name: 'A schedule', botId: 'b1', kind: 'once', runAt: Date.now(), enabled: true, prompt: 'Task' }];
  renderOverlay({ preserveEdits: true });
  assert.equal(document.querySelector('.set-body form'), form);
  assert.equal(input.value, 'Send the draft later');
  assert.equal(document.activeElement, input);
  assert.equal(input.selectionStart, 3); assert.equal(input.selectionEnd, 9);
  assert.match(document.querySelector('.set-body').textContent, /A schedule/);
  assert.ok(form.elements.namedItem('kind').querySelector('[value="once"]'));
  closeOverlay();
});

test('memory editing survives background updates and saves the topic, pin and expected revision', async () => {
  requests = [];
  openOverlay({ kind: 'settings', page: 'memory', scope: 'b1' }); await tick();
  [...document.querySelectorAll('.mem-list button')].find((b) => b.textContent === 'Edit').click();
  const editor = document.querySelector('.mem-list textarea'); editor.value = 'The edited memory';
  const key = editor.form.elements.namedItem('key');
  assert.equal(key.value, 'project.status'); assert.equal(key.readOnly, true);
  editor.form.elements.namedItem('pinned').checked = true;
  editor.dispatchEvent(new window.Event('input', { bubbles: true }));
  renderOverlay({ preserveEdits: true });
  assert.equal(document.querySelector('.mem-list textarea'), editor);
  editor.form.dispatchEvent(new window.Event('submit', { cancelable: true })); await tick();
  assert.deepEqual(requests.find((r) => r.method === 'POST').body, { text: 'The edited memory', replaceId: 'm1', key: 'project.status', pinned: true, expectedRevision: 'v1' });
  assert.match(document.querySelector('.mem-list').textContent, /The edited memory/);
  assert.equal(document.querySelector('.mem-list textarea'), null);
  closeOverlay();
});

test('task view flags approvals and opens the task owning chat', () => {
  state.helpers = [{ id: 'hlp_1', botId: 'b1', chatId: 'group:g1', title: 'Research', task: 'Check sources', status: 'running', sessionId: 's1', createdAt: Date.now() }];
  state.approvals.set('a1', { sessionId: 's1' });
  let opened; nav.openChat = (id) => { opened = id; };
  openOverlay({ kind: 'settings', page: 'tasks' });
  assert.match(document.querySelector('.task-card').textContent, /Awaiting approval/);
  [...document.querySelectorAll('.task-card button')].find((b) => b.textContent === 'Review approval').click();
  assert.equal(opened, 'group:g1');
  assert.equal(state.overlay, null);
  state.approvals.clear();
});

test('overlays use modal dialogs and restore the invoking control; empty usage has no null text', async () => {
  const trigger = document.getElementById('trigger'); trigger.focus();
  openOverlay({ kind: 'settings', page: 'general' });
  assert.equal(document.querySelector('dialog.overlay').open, true);
  closeOverlay(); assert.equal(document.activeElement, trigger);
  state.drawer = { open: true, view: 'overview', memTab: 'self', dirty: false };
  renderDrawer(); await tick();
  assert.doesNotMatch(document.getElementById('drawer').textContent, /null/);
});

test('edits typed during memory and schedule saves survive the earlier response', async () => {
  const originalFetch = globalThis.fetch;
  let release;
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'POST') await new Promise((resolve) => { release = resolve; });
    return originalFetch(url, options);
  };
  try {
    openOverlay({ kind: 'settings', page: 'memory', scope: 'b1' }); await tick();
    document.querySelector('.mem-list .btn').click();
    const memory = document.querySelector('.mem-list textarea');
    memory.value = 'Submit this'; memory.form.dispatchEvent(new window.Event('submit', { cancelable: true }));
    memory.value = 'Keep this later draft'; memory.dispatchEvent(new window.Event('input', { bubbles: true }));
    release(); await tick();
    assert.equal(document.querySelector('.mem-list textarea'), memory);
    assert.equal(memory.value, 'Keep this later draft');
    const savedRevision = entries[0].revision;
    requests = [];
    memory.form.dispatchEvent(new window.Event('submit', { cancelable: true }));
    release(); await tick();
    assert.equal(requests.find((request) => request.method === 'POST').body.expectedRevision, savedRevision);
    closeOverlay();
    openOverlay({ kind: 'settings', page: 'schedules' });
    const form = document.querySelector('.set-body form');
    form.elements.namedItem('prompt').value = 'Submit this'; form.dispatchEvent(new window.Event('submit', { cancelable: true }));
    form.elements.namedItem('prompt').value = 'Keep the next task'; release(); await tick();
    assert.equal(form.elements.namedItem('prompt').value, 'Keep the next task');
    closeOverlay();
  } finally { globalThis.fetch = originalFetch; }
});

test('invalid timing fields in an inactive schedule mode cannot block submission', () => {
  openOverlay({ kind: 'settings', page: 'schedules' });
  const form = document.querySelector('.set-body form');
  const kind = form.elements.namedItem('kind');
  kind.value = 'once'; kind.dispatchEvent(new window.Event('change'));
  form.elements.namedItem('inMinutes').value = '0'; form.elements.namedItem('prompt').value = 'Task';
  assert.equal(form.checkValidity(), false);
  kind.value = 'daily'; kind.dispatchEvent(new window.Event('change'));
  assert.equal(form.checkValidity(), true);
  assert.equal(new FormData(form).has('inMinutes'), false);
  closeOverlay();
});

test('memory events keep an active drawer editor, including a newer draft typed during save', async () => {
  const originalFetch = globalThis.fetch;
  let release;
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'POST') await new Promise((resolve) => { release = resolve; });
    return originalFetch(url, options);
  };
  try {
    state.drawer = { open: true, view: 'memory', memTab: 'self', dirty: false };
    renderDrawer(); await tick();
    document.querySelector('#drawer .mem-list .btn').click();
    const input = document.querySelector('#drawer .mem-list textarea');
    input.value = 'First saved version'; input.form.dispatchEvent(new window.Event('submit', { cancelable: true }));
    input.value = 'The later unsaved draft'; input.dispatchEvent(new window.Event('input', { bubbles: true }));
    renderDrawer();
    assert.equal(document.querySelector('#drawer .mem-list textarea'), input);
    release(); await tick(); renderDrawer();
    assert.equal(document.querySelector('#drawer .mem-list textarea'), input);
    assert.equal(input.value, 'The later unsaved draft');
    state.drawer.memTab = 'team'; renderDrawer(); await tick();
    assert.equal(input.isConnected, false, 'explicitly changing scope opens that scope');
  } finally { globalThis.fetch = originalFetch; }
});

test('memory storage and shared per-turn context have distinct character limits in both languages', async () => {
  for (const [language, storage, shared, searchable] of [
    ['en', /Long-term storage/, /shared by Bot and team memory/, /fully stored and searchable/],
    ['zh', /长期存储/, /Bot 与团队共享/, /仍完整保存且可检索/],
  ]) {
    setLocale(language);
    openOverlay({ kind: 'settings', page: 'memory', scope: 'b1' }); await tick();
    const budget = document.querySelector('.set-body .memory-budget');
    assert.match(budget.textContent, storage);
    assert.match(budget.textContent, /100,000/); assert.match(budget.textContent, /6,000/);
    assert.match(budget.textContent, shared); assert.match(budget.textContent, searchable);
    assert.doesNotMatch(budget.textContent, /4,000|token|每条另计/);
    assert.equal(document.querySelector('.set-body textarea').maxLength, 1200);
    closeOverlay();
  }
  setLocale('en');
});

test('manual memory creation accepts an optional stable key and preserves key/pin-only drafts', async () => {
  requests = [];
  openOverlay({ kind: 'settings', page: 'memory', scope: 'b1' }); await tick();
  const form = document.querySelector('.set-body .memory-editor');
  const key = form.elements.namedItem('key');
  const pinned = form.elements.namedItem('pinned');
  assert.equal(key.required, false);
  key.value = 'reply.preferences'; key.dispatchEvent(new window.Event('input', { bubbles: true }));
  pinned.checked = true; pinned.dispatchEvent(new window.Event('change', { bubbles: true }));
  renderOverlay({ preserveEdits: true });
  assert.equal(document.querySelector('.set-body .memory-editor'), form);
  form.elements.namedItem('text').value = 'Keep replies short';
  form.dispatchEvent(new window.Event('submit', { cancelable: true })); await tick();
  assert.deepEqual(requests.find((r) => r.method === 'POST').body, { text: 'Keep replies short', key: 'reply.preferences', pinned: true });
  assert.match(document.querySelector('.set-body').textContent, /inclusion in every turn is not guaranteed/);
  closeOverlay();
});

test('a conflicting edit keeps its draft, reads the latest saved content and retries with that revision', async () => {
  const originalFetch = globalThis.fetch;
  const oldRevision = entries[0].revision;
  let posts = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (url.includes('/api/memory/') && options.method === 'POST' && posts++ === 0) {
      const body = JSON.parse(options.body);
      assert.equal(body.expectedRevision, oldRevision);
      entries = entries.map((entry, i) => i === 0 ? { ...entry, text: 'New content saved by another writer', revision: 'server-v2' } : entry);
      return { ok: false, status: 409, json: async () => ({ error: 'memory_conflict', message: 'conflict' }) };
    }
    return originalFetch(url, options);
  };
  try {
    openOverlay({ kind: 'settings', page: 'memory', scope: 'b1' }); await tick();
    document.querySelector('.set-body .mem-list .btn').click();
    const input = document.querySelector('.set-body .mem-list textarea');
    const form = input.form;
    input.value = 'My unsaved draft'; input.dispatchEvent(new window.Event('input', { bubbles: true }));
    form.elements.namedItem('pinned').checked = false;
    form.dispatchEvent(new window.Event('submit', { cancelable: true })); await tick();
    renderOverlay({ preserveEdits: true });
    assert.equal(document.querySelector('.set-body .mem-list textarea'), input);
    assert.equal(input.value, 'My unsaved draft');
    assert.match(form.textContent, /Your draft is preserved/);
    form.dispatchEvent(new window.Event('submit', { cancelable: true })); await tick();
    assert.equal(posts, 1, 'a conflict must be reviewed before another write');
    [...form.querySelectorAll('button')].find((button) => button.textContent === 'Read latest version').click(); await tick();
    assert.equal(input.value, 'My unsaved draft');
    assert.equal(form.elements.namedItem('pinned').checked, false);
    assert.match(form.textContent, /New content saved by another writer/);
    form.dispatchEvent(new window.Event('submit', { cancelable: true })); await tick();
    const saved = requests.filter((request) => request.method === 'POST').at(-1).body;
    assert.equal(saved.expectedRevision, 'server-v2');
    assert.equal(saved.text, 'My unsaved draft'); assert.equal(saved.key, 'project.status'); assert.equal(saved.pinned, false);
    closeOverlay();
  } finally { globalThis.fetch = originalFetch; }
});

test('legacy long memories can keep their text while changing priority, shorten above the new limit and reload the latest bound', async () => {
  const originalFetch = globalThis.fetch;
  const originalEntries = entries;
  const text = '旧'.repeat(1500);
  entries = [{ id: 'legacy1', text, key: 'legacy.topic', pinned: false, revision: 'legacy-v1' }];
  requests = [];
  try {
    openOverlay({ kind: 'settings', page: 'memory', scope: 'b1' }); await tick();
    document.querySelector('.set-body .mem-list .btn').click();
    const input = document.querySelector('.set-body .mem-list textarea');
    assert.equal(input.value, text); assert.equal(input.maxLength, 1500);
    assert.equal(input.form.checkValidity(), true);
    assert.match(input.form.textContent, /1500 \/ 1500 characters/);
    assert.match(input.form.textContent, /keep its text or shorten it/);
    input.form.elements.namedItem('pinned').checked = true;
    input.form.dispatchEvent(new window.Event('submit', { cancelable: true })); await tick();
    const saved = requests.find((request) => request.method === 'POST').body;
    assert.equal(saved.text, text); assert.equal(saved.pinned, true); assert.equal(saved.expectedRevision, 'legacy-v1');
    document.querySelector('.set-body .mem-list .btn').click();
    const shortening = document.querySelector('.set-body .mem-list textarea');
    shortening.value = text.slice(0, 1400); shortening.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(shortening.form.checkValidity(), true);
    shortening.form.dispatchEvent(new window.Event('submit', { cancelable: true })); await tick();
    assert.equal(requests.filter((request) => request.method === 'POST').at(-1).body.text.length, 1400);
    document.querySelector('.set-body .mem-list .btn').click();
    const conflicted = document.querySelector('.set-body .mem-list textarea');
    assert.equal(conflicted.maxLength, 1400);
    globalThis.fetch = async (url, options = {}) => {
      if (url.includes('/api/memory/') && options.method === 'POST') {
        entries = [{ ...entries[0], text: text.slice(0, 1300), revision: 'latest-v3' }];
        return { ok: false, status: 409, json: async () => ({ error: 'memory_conflict', message: 'conflict' }) };
      }
      return originalFetch(url, options);
    };
    conflicted.form.dispatchEvent(new window.Event('submit', { cancelable: true })); await tick();
    [...conflicted.form.querySelectorAll('button')].find((button) => button.textContent === 'Read latest version').click(); await tick();
    assert.equal(conflicted.value.length, 1400, 'reading the new baseline must not truncate the draft');
    assert.equal(conflicted.maxLength, 1300);
    assert.match(conflicted.form.textContent, /1400 \/ 1300 characters/);
    closeOverlay();
  } finally { globalThis.fetch = originalFetch; entries = originalEntries; }
});

test('durable task cards distinguish paused, unconfirmed and waiting states without exposing a separate resume workflow', async () => {
  state.helpers = [];
  state.tasks = [
    { id:'task_paused',batchId:'batch_1',chatId:'group:g1',title:'Discussion',task:'Discuss',status:'paused',pauseReason:'no_progress',createdAt:1 },
    { id:'task_unknown',batchId:'batch_2',chatId:'bot:b1',title:'Unconfirmed',task:'Check',status:'unknown',createdAt:2 },
    { id:'task_dependencies',batchId:'batch_4',chatId:'bot:b1',title:'Research',task:'Read sources',status:'waiting_for_tasks',createdAt:4 },
    { id:'task_answer',batchId:'batch_3',chatId:'bot:b1',title:'Question',task:'Choose',status:'waiting_for_user',createdAt:3 },
  ];
  requests=[];openOverlay({kind:'settings',page:'tasks'});
  const cards=[...document.querySelectorAll('.task-card')];
  const paused=cards.find(card=>card.textContent.includes('Discussion'));
  assert.match(paused.textContent,/Awaiting input/);
  assert.ok(!paused.textContent.includes('Resume discussion'));
  assert.ok([...paused.querySelectorAll('button')].some(button=>button.textContent==='Open owning chat'));
  const unknown=cards.find(card=>card.textContent.includes('Unconfirmed'));
  assert.match(unknown.textContent,/Outcome unconfirmed/);assert.ok(!unknown.textContent.includes('Resume discussion'));
  assert.match(cards.find(card=>card.textContent.includes('Question')).textContent,/Awaiting answer/);
  const dependencies=cards.find(card=>card.textContent.includes('Research'));
  assert.match(dependencies.textContent,/Awaiting dependencies/);
  assert.ok([...dependencies.querySelectorAll('button')].some(button=>button.textContent==='Stop task'));
  openOverlay({kind:'settings',page:'tasks',taskFilter:'active'});
  assert.match(document.querySelector('.task-list').textContent,/Research/);
  closeOverlay();state.tasks=[];
});

test('the group note record stays visible and clearable while the switch is off', async () => {
  requests = [];
  state.groups = [{
    id: 'g1', name: 'Team', notice: '', adminId: 'b1', memberIds: ['b1'], replyMode: 'admin',
    notes: false, noteEntries: [{ speaker: 'Rob', text: 'we go with plan B' }],
  }];
  state.current = 'group:g1';
  state.drawer = { open: true, view: 'overview', memTab: 'self', dirty: false };
  renderDrawer(); await tick();
  const drawer = document.getElementById('drawer');
  // The record is shown even though the switch is off: what was recorded has to stay readable.
  assert.match(drawer.textContent, /we go with plan B/);
  assert.match(drawer.textContent, /neither added to nor read by the Bots/);
  // And it can still be cleared.
  const clear = [...drawer.querySelectorAll('button')].find((button) => button.textContent.includes('Clear the note'));
  assert.ok(clear, 'the record can still be cleared');
  clear.click(); await tick();
  const cleared = requests.find((r) => r.url.includes('/api/groups/g1') && r.method === 'PATCH');
  assert.ok(cleared, 'clearing goes to the group API');
  assert.deepEqual(cleared.body, { clearNotes: true });
  // With the switch on, the panel does not claim the record is kept.
  state.groups[0].notes = true;
  renderDrawer(); await tick();
  assert.doesNotMatch(document.getElementById('drawer').textContent, /neither added to nor read/);
  state.groups = []; state.current = 'bot:b1';
});

test('the panel states the limits the server sends, not numbers of its own', async () => {
  state.groups = [{
    id: 'g1', name: 'Team', notice: '', adminId: 'b1', memberIds: ['b1'], replyMode: 'admin',
    notes: true, noteEntries: [{ speaker: 'Rob', text: 'we go with plan B' }],
  }];
  state.current = 'group:g1';
  state.drawer = { open: true, view: 'overview', memTab: 'self', dirty: false };
  state.noteLimits = { entries: 6, chars: 1200 };
  renderDrawer(); await tick();
  assert.match(document.getElementById('drawer').textContent, /6 entries and 1200 characters/);
  // Different limits, different text: the panel reads them, it does not write them down.
  state.noteLimits = { entries: 3, chars: 400 };
  renderDrawer(); await tick();
  assert.match(document.getElementById('drawer').textContent, /3 entries and 400 characters/);
  delete state.noteLimits;
  renderDrawer(); await tick();
  assert.doesNotMatch(document.getElementById('drawer').textContent, /entries and/);
  state.groups = []; state.current = 'bot:b1';
});
