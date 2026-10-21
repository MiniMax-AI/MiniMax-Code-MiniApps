import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const html = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/bot' });
for (const key of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Node', 'Element', 'FormData']) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
window.matchMedia = () => ({ matches: false, addEventListener() {} });
window.HTMLElement.prototype.scrollTo = function ({ top }) { this.scrollTop = top; };
window.HTMLElement.prototype.scrollIntoView = function () { this.dataset.revealed = 'true'; };
window.HTMLElement.prototype.showPopover = function () {};
window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
URL.createObjectURL = () => 'blob:test-preview';
URL.revokeObjectURL = () => {};
const intervals = [];
const setIntervalOriginal = globalThis.setInterval;
globalThis.setInterval = (...args) => { const id = setIntervalOriginal(...args); intervals.push(id); id.unref(); return id; };
class FakeEventSource {
  static current;
  readyState = 1;
  constructor() { FakeEventSource.current = this; }
  close() { this.readyState = 2; }
}
globalThis.EventSource = FakeEventSource;
const fixture = {
  bots: [{ id: 'bot_a', name: 'Rob', color: 'ocean', skin: 'fuzzy', isMain: true }, { id: 'bot_b', name: 'Writer', color: 'ocean', skin: 'fuzzy' }],
  groups: [], schedules: [], helpers: [], busyChats: [], turns: [], chats: {}, approvals: [], sessions: {}, agentAvailable: true,
  locale: 'en', settings: { language: 'en', userName: 'Test' }, user: { name: 'Test', systemName: 'Test' },
};
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
let route;
let history = [];
let uploadSequence = 0;
const calls = [];
globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(url, 'http://localhost');
  const request = { url, path: parsed.pathname, query: parsed.searchParams, options, body: options.body && typeof options.body === 'string' ? JSON.parse(options.body) : options.body };
  calls.push(request);
  const override = route?.(request);
  if (override !== undefined) return override;
  if (parsed.pathname === '/api/state') return response(structuredClone(fixture));
  if (parsed.pathname === '/api/locale') return response({});
  if (parsed.pathname === '/api/usage') return response({ byBot: [], totals: { turns: 0 } });
  if (parsed.pathname.startsWith('/api/memory/')) return response({ entries: [], budget: { used: 0, max: 4000, remaining: 4000 } });
  if (parsed.pathname === '/api/uploads') return response({ upload: { id: `upload-${++uploadSequence}` } });
  if (parsed.pathname.endsWith('/messages')) return response(options.method === 'POST' ? {} : { messages: structuredClone(parsed.pathname.includes('bot:bot_a') ? history : []) });
  throw new Error(`Unexpected request: ${url}`);
};
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = async () => { await tick(); await tick(); };
await import('../miniapp/client/app.js');
const { state, nav, clearMessages, loadMessages, fetchAllMessages, transcriptMarkdown } = await import('../miniapp/client/core.js');
const { closeOverlay } = await import('../miniapp/client/panels.js');
const { mediaNode } = await import('../miniapp/client/media.js');
const { reconcileChildren } = await import('../miniapp/client/view-state.js');
await settle();
const emit = (event) => FakeEventSource.current.onmessage({ data: JSON.stringify(event) });
const composer = () => document.querySelector('.composer textarea');
const type = (text) => { composer().value = text; composer().dispatchEvent(new window.Event('input')); };
const enter = () => composer().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
const postCalls = () => calls.filter((call) => call.path.endsWith('/messages') && call.options.method === 'POST');
const message = (id, text, extra = {}) => ({ id, chatId: 'bot:bot_a', botId: 'bot_a', role: 'bot', status: 'done', ts: 1000, text, ...extra });
async function reset(messages = []) {
  state.bots = structuredClone(fixture.bots);
  state.busy.clear();
  closeOverlay();
  route = undefined;
  history = messages;
  calls.length = 0;
  clearMessages();
  state.drawer = { open: false, view: 'overview', dirty: false };
  nav.openChat('bot:bot_b');
  await settle();
  nav.openChat('bot:bot_a');
  await settle();
  type('');
}
after(() => {
  for (const interval of intervals) clearInterval(interval);
  globalThis.setInterval = setIntervalOriginal;
  window.close();
});

test('pending Enter sends once; an uncertain retry keeps its ID and preserves a newer draft', async () => {
  await reset();
  let rejectFirst;
  route = ({ path, options }) => path.endsWith('/messages') && options.method === 'POST'
    ? new Promise((_, reject) => { rejectFirst = reject; }) : undefined;
  type('Send exactly once'); enter(); enter();
  assert.equal(postCalls().length, 1);
  const firstId = postCalls()[0].body.clientMessageId;
  assert.ok(firstId);
  rejectFirst(new Error('connection closed before response'));
  await settle();
  let accept;
  route = ({ path, options }) => path.endsWith('/messages') && options.method === 'POST'
    ? new Promise((resolve) => { accept = () => resolve(response({})); }) : undefined;
  enter();
  assert.equal(postCalls()[1].body.clientMessageId, firstId);
  type('Keep this next draft');
  accept(); await settle();
  assert.equal(composer().value, 'Keep this next draft');
  route = undefined;
  enter(); await settle();
  assert.notEqual(postCalls()[2].body.clientMessageId, firstId);
  assert.equal(composer().value, '');
});

test('an attachment added during a pending send belongs to the next message', async () => {
  await reset();
  let accept;
  route = ({ path, options }) => path.endsWith('/messages') && options.method === 'POST'
    ? new Promise((resolve) => { accept = () => resolve(response({})); }) : undefined;
  type('First message'); enter();
  const input = document.querySelector('input[type=file]');
  Object.defineProperty(input, 'files', { value: [new window.File(['next'], 'next.txt', { type: 'text/plain' })] });
  input.dispatchEvent(new window.Event('change'));
  await settle();
  accept(); await settle();
  assert.match(document.querySelector('.attach-bar').textContent, /next.txt/);
  assert.equal(document.querySelector('.send').disabled, false);
  route = undefined; enter(); await settle();
  assert.deepEqual(postCalls().at(-1).body.attachments, ['upload-1']);
});

test('reconnection preserves the composer and shows connection state until history is synchronized', async () => {
  await reset([message('one', 'Existing reply')]);
  type('Do not lose my work');
  FakeEventSource.current.onerror();
  assert.equal(state.connection.status, 'reconnecting');
  assert.equal(document.querySelector('#connection-status').hidden, false);
  FakeEventSource.current.onopen(); await settle();
  assert.equal(composer().value, 'Do not lose my work');
  assert.equal(state.connection.status, 'connected');
  assert.equal(document.querySelector('#connection-status').hidden, true);
  assert.match(document.querySelector('.feed-inner').textContent, /Existing reply/);
});

test('a failed old chat request cannot overwrite the newly selected conversation', async () => {
  await reset([message('one', 'Conversation A')]);
  clearMessages('bot:bot_b');
  let rejectOld;
  route = ({ path, options }) => path.includes('bot:bot_b') && path.endsWith('/messages') && options.method === 'GET'
    ? new Promise((_, reject) => { rejectOld = reject; }) : undefined;
  nav.openChat('bot:bot_b'); nav.openChat('bot:bot_a'); await settle();
  rejectOld(new Error('old B request failed')); await settle();
  assert.equal(document.querySelector('.pill-name').textContent, 'Rob');
  assert.match(document.querySelector('.feed-inner').textContent, /Conversation A/);
  assert.doesNotMatch(document.querySelector('.feed-inner').textContent, /old B request failed/);
});

test('a live message received during a history fetch wins over that older snapshot', async () => {
  await reset();
  clearMessages('bot:bot_a');
  let resolveHistory;
  route = ({ path, options }) => path.includes('bot:bot_a') && path.endsWith('/messages') && options.method === 'GET'
    ? new Promise((resolve) => { resolveHistory = resolve; }) : undefined;
  const loading = loadMessages('bot:bot_a');
  emit({ type: 'message.upsert', chatId: 'bot:bot_a', message: message('live', 'New live text') });
  resolveHistory(response({ messages: [message('live', 'Old snapshot')] }));
  assert.equal((await loading)[0].text, 'New live text');
});

test('a reaction received during history refresh survives the snapshot and later full-message frames', async () => {
  const original = message('reaction-race', 'Reply', { userReactions: [], reactionsRevision: 0 });
  await reset([original]);
  let resolveHistory;
  route = ({ path, options }) => path.includes('bot:bot_a') && path.endsWith('/messages') && options.method === 'GET'
    ? new Promise((resolve) => { resolveHistory = resolve; }) : undefined;
  const loading = loadMessages('bot:bot_a', true);
  emit({ type: 'message.reactions', chatId: original.chatId, messageId: original.id, userReactions: ['👍'], reactionsRevision: 2 });
  emit({ type: 'message.reactions', chatId: original.chatId, messageId: original.id, userReactions: ['❤️'], reactionsRevision: 1 });
  resolveHistory(response({ messages: [original] }));
  assert.equal((await loading)[0].reactionsRevision, 2);
  assert.equal(document.querySelector('.reaction-chip').dataset.emoji, '👍');
  emit({ type: 'message.upsert', chatId: original.chatId, message: { ...original, text: 'Reply with more text' } });
  assert.equal(document.querySelector('.reaction-chip').dataset.emoji, '👍');
  assert.equal(state.messages.get(original.chatId)[0].reactionsRevision, 2);
});

test('reconnect and unloaded older-page reactions are retained, while a chat reset discards old patches', async () => {
  const recent = message('reaction-recent', 'Recent reply', { userReactions: [], reactionsRevision: 0 });
  const older = message('reaction-older', 'Earlier reply', { ts: 500, userReactions: [], reactionsRevision: 0 });
  await reset([recent]);
  let resolveHistory;
  route = ({ path, query, options }) => path.includes('bot:bot_a') && path.endsWith('/messages') && options.method === 'GET'
    ? query.has('before') ? response({ messages: [older], hasMore: false }) : new Promise((resolve) => { resolveHistory = resolve; })
    : undefined;
  FakeEventSource.current.onerror(); FakeEventSource.current.onopen(); await settle();
  assert.equal(state.messages.has(recent.chatId), false);
  emit({ type: 'message.reactions', chatId: recent.chatId, messageId: recent.id, userReactions: ['👍'], reactionsRevision: 1 });
  emit({ type: 'message.reactions', chatId: recent.chatId, messageId: older.id, userReactions: ['❤️'], reactionsRevision: 3 });
  resolveHistory(response({ messages: [recent], hasMore: true, nextBefore: recent.id })); await settle();
  assert.equal(document.querySelector('.reaction-chip').dataset.emoji, '👍');
  document.querySelector('.load-earlier').click(); await settle();
  assert.deepEqual([...document.querySelectorAll('.reaction-chip')].map((node) => node.dataset.emoji), ['❤️', '👍']);
  emit({ type: 'chat.reset', chatId: recent.chatId });
  route = undefined;
  assert.equal((await loadMessages(recent.chatId, true))[0].reactionsRevision, 0);
  nav.openChat('bot:bot_b'); await settle(); nav.openChat(recent.chatId); await settle();
  assert.equal(document.querySelector('.reaction-chip'), null);
});

test('reactions stay on the final bubble while message parts change, preserving media and removal focus', async () => {
  let item = message('reaction-bubbles', 'First\nSecond', {
    parts: [{ type: 'text', text: '<media src="/tmp/demo.mp4" />\nFirst' }, { type: 'text', text: 'Second' }],
    userReactions: ['👍'], reactionsRevision: 1,
  });
  await reset([item]);
  const video = document.querySelector('video');
  const bubbles = document.querySelectorAll('.bubble');
  assert.equal(bubbles[0].querySelector('.reaction-bar'), null);
  assert.equal(bubbles[1].querySelector('.reaction-chip').dataset.emoji, '👍');
  document.querySelector('.reaction-trigger').click();
  document.querySelector('[aria-label="More emoji"]').click();
  item = { ...item, parts: [...item.parts, { type: 'text', text: 'Final' }] };
  emit({ type: 'message.upsert', chatId: item.chatId, message: item });
  assert.equal(document.querySelectorAll('.reaction-bar').length, 1);
  assert.match(document.querySelector('.reaction-bar').parentElement.textContent, /Final/);
  assert.equal(document.querySelector('video'), video);
  assert.equal(document.querySelector('.reaction-picker'), null);
  assert.equal(document.activeElement, document.querySelector('.reaction-trigger'));
  document.querySelector('.reaction-chip').focus();
  emit({ type: 'message.reactions', chatId: item.chatId, messageId: item.id, userReactions: [], reactionsRevision: 2 });
  assert.equal(document.activeElement, document.querySelector('.reaction-trigger'));
});

test('a long reply keeps every bubble in the open, one per recorded part', async () => {
  const parts = [];
  for (let index = 0; index < 12; index += 1) {
    parts.push({ type: 'text', text: `Step ${index}` }, { type: 'tool', name: 'read', state: 'done' });
  }
  parts.push({ type: 'text', text: 'The answer' });
  const item = message('m-long-reply', 'The answer', { parts, userReactions: ['👍'], reactionsRevision: 1 });
  await reset([item]);
  // The bubbles stay the ones the official build draws, in the order it draws them.
  assert.equal(document.querySelector('.bubble-fold'), null);
  const wrap = document.querySelector('article.msg .bubble-wrap');
  const open = [...wrap.children].filter((child) => child.classList.contains('bubble'));
  assert.equal(open.length, 13);
  assert.match(open[0].textContent, /Step 0/);
  assert.match(open[12].textContent, /The answer/);
  // The answer is the last bubble, so the reaction indicator sits on it.
  assert.equal(open[12].querySelector('.reaction-chip').dataset.emoji, '👍');
});

test('the bubbles of one reply keep a small gap between them', async () => {
  const css = await readFile(new URL('../miniapp/client/app.css', import.meta.url), 'utf8');
  const rule = css.match(/\n\.bubble-wrap \{[^}]*\}/)?.[0] ?? '';
  assert.ok(rule, 'the column of bubbles needs a rule of its own');
  // Without a gap the bubbles of one reply read as one block of text.
  assert.match(rule, /gap: 4px/);
});

test('a multi-line reply keeps its actions below the text and its reaction indicator above them', async () => {
  const text = 'First line\nSecond line\n\nThird paragraph\nFourth line';
  const item = message('m-multiline', text, {
    parts: [{ type: 'text', text }],
    userReactions: ['👍'], reactionsRevision: 1,
  });
  await reset([item]);
  const wrap = document.querySelector('article.msg .bubble-wrap');
  const bubble = wrap.querySelector('.bubble');
  const tools = wrap.querySelector('.msg-tools');
  // The action row is a sibling below the bubble, never a child of it: a reply that runs
  // over several lines must not push the buttons back to the top of the message.
  assert.equal(bubble.querySelector('.msg-tools'), null);
  assert.equal(tools.parentElement, wrap);
  assert.equal(wrap.lastElementChild, tools);
  assert.deepEqual([...wrap.children].map((child) => child.className), ['bubble', 'msg-tools']);
  // Every line of the reply belongs to that one bubble.
  assert.match(bubble.textContent, /First line/);
  assert.match(bubble.textContent, /Fourth line/);
  // The reaction indicator stays with the bubble it belongs to, so it renders above the row.
  assert.equal(bubble.querySelector('.reaction-chip').dataset.emoji, '👍');
  // The quote action still carries the whole reply, however many lines it has.
  tools.querySelector('[aria-label="Quote"]').click();
  await settle();
  assert.match(document.querySelector('.quoting').textContent, /First line/);
});

test('the reaction indicator is painted from the theme instead of a fixed brand colour', async () => {
  const css = await readFile(new URL('../miniapp/client/app.css', import.meta.url), 'utf8');
  const rule = css.match(/\n\.reaction-bar \{[^}]*\}/)?.[0] ?? '';
  assert.ok(rule, 'the reaction indicator needs a rule of its own');
  // The indicator sits on the bubble, so it follows the app's tag language: a themed
  // surface, a hairline border and muted ink. Both themes then read the same way.
  assert.match(rule, /background: var\(--tag\)/);
  assert.match(rule, /border: 1px solid var\(--line-strong\)/);
  assert.match(rule, /color: var\(--muted\)/);
  assert.doesNotMatch(rule, /var\(--accent\)/);
  assert.doesNotMatch(css, /--reaction-ink/);
});

test('history paging prepends in order, retains scroll position and exports every page separately', async () => {
  await reset();
  // Several messages can share the same millisecond; page order remains authoritative.
  const recent = message('recent', 'Latest message', { ts: 1000 });
  const older = message('older', 'Earlier message', { ts: 1000 });
  history = [recent];
  route = ({ path, query, options }) => path.includes('bot:bot_a') && path.endsWith('/messages') && options.method === 'GET'
    ? response(query.has('before') ? { messages: [older], hasMore: false, nextBefore: null } : { messages: [recent], hasMore: true, nextBefore: 'recent' }) : undefined;
  clearMessages('bot:bot_a');
  nav.openChat('bot:bot_b'); await settle(); nav.openChat('bot:bot_a'); await settle();
  const feed = document.querySelector('.feed');
  Object.defineProperty(feed, 'scrollHeight', { configurable: true, get: () => document.querySelectorAll('.feed-inner > [data-mid]').length * 100 });
  feed.scrollTop = 23;
  assert.equal(document.querySelector('.load-earlier').hidden, false);
  document.querySelector('.load-earlier').click(); await settle();
  assert.deepEqual([...document.querySelectorAll('.feed-inner > [data-mid]')].map((node) => node.dataset.mid), ['older', 'recent']);
  assert.equal(feed.scrollTop, 123);
  assert.equal(document.querySelector('.load-earlier').hidden, true);
  const visible = state.messages.get('bot:bot_a');
  const exported = await fetchAllMessages('bot:bot_a');
  assert.equal(state.messages.get('bot:bot_a'), visible);
  assert.match(transcriptMarkdown('bot:bot_a', exported), /Earlier message[\s\S]*Latest message/);
  assert.ok(calls.some((call) => call.query.get('limit') === '200' && call.query.get('before') === 'recent'));
});

test('keyed rendering handles changed content, removals, insertion and reordering together', () => {
  const parent = document.createElement('div');
  const view = (key, text) => ({ key, signature: text, create: () => {
    const node = document.createElement('p'); node.textContent = text; return node;
  } });
  reconcileChildren(parent, [view('a', 'A'), view('b', 'B'), view('c', 'C')]);
  const stable = parent.children[1];
  reconcileChildren(parent, [view('a', 'A changed'), view('b', 'B'), view('c', 'C')]);
  assert.deepEqual([...parent.children].map((node) => node.textContent), ['A changed', 'B', 'C']);
  reconcileChildren(parent, [view('c', 'C changed'), view('new', 'New'), view('b', 'B')]);
  assert.deepEqual([...parent.children].map((node) => node.textContent), ['C changed', 'New', 'B']);
  assert.equal(parent.lastChild, stable);
  reconcileChildren(parent, [view('b', 'B'), view('new', 'New again'), view('last', 'Last')]);
  assert.deepEqual([...parent.children].map((node) => node.textContent), ['B', 'New again', 'Last']);
  assert.equal(parent.firstChild, stable);
  reconcileChildren(parent, []);
  assert.equal(parent.children.length, 0);
});

test('successive stream frames update existing paragraphs and finish rendering the remaining parts', async () => {
  let item = message('frames', 'Hello', { status: 'streaming', parts: [{ type: 'text', text: 'Hello', live: true }] });
  await reset([item]);
  for (const text of ['Hello world', 'Hello world\n\nA second paragraph', 'Hello again\n\nA second paragraph changed']) {
    item = { ...item, text, parts: [{ type: 'text', text, live: true }, { type: 'text', text: `After: ${text.split('\n')[0]}` }] };
    emit({ type: 'message.upsert', chatId: item.chatId, message: item });
    const bubbles = [...document.querySelectorAll('.bubble')];
    assert.equal(bubbles.length, 2);
    assert.equal(bubbles[0].querySelector('p').textContent, text.split('\n')[0]);
    assert.equal(bubbles[1].textContent.trim(), `After: ${text.split('\n')[0]}`);
  }
  item = { ...item, status: 'done' };
  emit({ type: 'message.upsert', chatId: item.chatId, message: item });
  assert.ok(document.querySelector('.msg-tools'));
});

test('stream updates preserve media, questionnaire input and expanded failure details, without prefix dedupe', async () => {
  const firstText = 'The shared prefix starts here';
  let item = message('stream', '', { status: 'streaming', parts: [
    { type: 'text', text: '<media src="/tmp/demo.mp4" />\nThe shared prefix starts here' },
    { type: 'tool', name: 'remember', state: 'failed', issue: { code: 'memory_full', remaining: 2, needed: 50, scope: 'team', key: 'reply.preferences' } },
    { type: 'text', text: `${firstText} and this is a later message`, live: true },
  ], question: { mode: 'questionnaire', requestId: 'question-1', request: { steps: [{ id: 'step', question: 'What next?', selectionMode: 'single', options: [{ id: 'a', label: 'A' }] }] } } });
  await reset([item]);
  const video = document.querySelector('video');
  const input = document.querySelector('.qcard input[type=text]');
  assert.equal(document.querySelector('.feed-inner details.tool-feedback'), null);
  document.querySelector('.execution-toggle').click();
  const record = document.querySelector('.execution-record'); record.open = true;
  const group = document.querySelector('.execution-tool'); group.open = true;
  const details = document.querySelector('details.tool-feedback');
  details.open = true;
  input.value = 'An answer in progress'; input.focus(); input.setSelectionRange(3, 9);
  item = { ...item, parts: [...item.parts.slice(0, 2), { ...item.parts[2], text: `${item.parts[2].text} with more tokens` }] };
  emit({ type: 'message.upsert', chatId: item.chatId, message: item });
  assert.equal(document.querySelector('video'), video);
  assert.equal(document.querySelector('.qcard input[type=text]'), input);
  assert.equal(input.value, 'An answer in progress');
  assert.equal(document.activeElement, input);
  assert.equal(input.selectionStart, 3);
  assert.equal(document.querySelector('details.tool-feedback'), details);
  assert.equal(details.open, true);
  item = { ...item, parts: [{ ...item.parts[0], text: `${item.parts[0].text}\nA new paragraph after the player.` }, ...item.parts.slice(1)] };
  emit({ type: 'message.upsert', chatId: item.chatId, message: item });
  assert.equal(document.querySelector('video'), video);
  const bubbles = [...document.querySelectorAll('.bubble')].map((node) => node.textContent);
  assert.equal(bubbles.length, 2);
  assert.match(bubbles[0], /The shared prefix starts here/);
  assert.match(bubbles[1], /later message with more tokens/);
  details.querySelector('summary').focus();
  item = { ...item, parts: [...item.parts, { type: 'tool', name: 'remember', state: 'ok' }] };
  emit({ type: 'message.upsert', chatId: item.chatId, message: item });
  const updatedDetails = document.querySelector('details.tool-feedback');
  assert.equal(updatedDetails.open, true);
  assert.equal(document.activeElement, updatedDetails.querySelector('summary'));
  assert.match(updatedDetails.querySelector('summary').textContent, /a later call succeeded/);
  const manage = [...updatedDetails.parentElement.querySelectorAll('button')].find((button) => button.textContent === 'Manage memory');
  assert.equal(manage.closest('details'), group);
  manage.click();
  assert.equal(state.overlay.page, 'memory');
  assert.equal(state.overlay.scope, 'team');
  closeOverlay();
  item = { ...item, parts: item.parts.map((part, index) => index === item.parts.length - 1 ? { ...part, memoryReceipt: { scope: 'team', key: 'reply.preferences', entryId: 'abcd1234', revision: 'v2', outcome: 'updated' } } : part) };
  emit({ type: 'message.upsert', chatId: item.chatId, message: item });
  assert.equal(document.querySelector('details.tool-feedback summary').textContent, 'This topic was saved or updated in a later call');
  assert.equal(document.querySelector('details.tool-feedback').open, true);
});

test('a task result loads only the required older page and focuses that message', async () => {
  await reset();
  route = ({ path, query, options }) => path.includes('bot:bot_a') && path.endsWith('/messages') && options.method === 'GET'
    ? response(query.has('before')
      ? { messages: [message('task-result', 'Finished task result', { ts: 1000 })], hasMore: true, nextBefore: 'task-result' }
      : { messages: [message('recent-result', 'Recent', { ts: 2000 })], hasMore: true, nextBefore: 'recent-result' })
    : undefined;
  clearMessages('bot:bot_a');
  nav.openChat('bot:bot_b'); await settle();
  await nav.revealMessage('bot:bot_a', 'task-result');
  assert.equal(document.activeElement.dataset.mid, 'task-result');
  assert.equal(document.activeElement.dataset.revealed, 'true');
  assert.equal(calls.filter((call) => call.query.has('before')).length, 1);
  assert.equal(document.querySelector('.load-earlier').hidden, false);
});

test('leaving the chat while locating a result cannot redirect focus or replace the new feed', async () => {
  await reset();
  let acceptOlder;
  route = ({ path, query, options }) => path.includes('bot:bot_a') && path.endsWith('/messages') && options.method === 'GET'
    ? query.has('before')
      ? new Promise((resolve) => { acceptOlder = () => resolve(response({ messages: [message('old-task', 'Old task')], hasMore: false })); })
      : response({ messages: [message('recent-task', 'Recent')], hasMore: true, nextBefore: 'recent-task' })
    : undefined;
  clearMessages('bot:bot_a');
  const locating = nav.revealMessage('bot:bot_a', 'old-task');
  await settle();
  assert.equal(typeof acceptOlder, 'function');
  nav.openChat('bot:bot_b'); await settle();
  const focused = document.activeElement;
  acceptOlder(); await locating;
  assert.equal(state.current, 'bot:bot_b');
  assert.equal(document.activeElement, focused);
  assert.doesNotMatch(document.querySelector('.feed-inner').textContent, /Old task/);
});

test('local document cards load through their owning page and render an isolated preview', async () => {
  const sources = ['/tmp/avatar-picker.html', '/tmp/report.HTM', '/tmp/说明.md', '/tmp/notes.markdown', '/tmp/report#1?.MD'];
  await reset(sources.map((src, i) => message(`preview_${i}`, `<media src="${src}" caption="Preview ${i}" />`)));
  route = ({ path }) => path === '/api/media' ? new Response('<h1>Hello</h1><script>window.example = true</script>', { headers: { 'content-type': 'text/html' } }) : undefined;
  const cards = [...document.querySelectorAll('.media-file')];
  for (const [i, card] of cards.entries()) {
    assert.equal(card.tagName, 'BUTTON', sources[i]);
    card.focus(); card.click(); await settle();
    const request = calls.filter(call => call.path === '/api/media').at(-1);
    assert.equal(request.query.get('src'), sources[i]);
    assert.equal(request.query.get('chat'), 'bot:bot_a');
    const dialog = document.querySelector('dialog.document-preview[open]');
    const frame = dialog.querySelector('iframe');
    assert.match(frame.srcdoc, /<h1>Hello<\/h1>/);
    assert.match(frame.srcdoc, /Content-Security-Policy/);
    assert.doesNotMatch(frame.getAttribute('sandbox'), /allow-same-origin|allow-forms|allow-top-navigation/);
    assert.equal(frame.getAttribute('sandbox').includes('allow-scripts'), /\.html?$/i.test(sources[i]));
    dialog.querySelector('[aria-label="Close"]').click();
    assert.equal(document.querySelector('dialog.document-preview'), null);
    assert.equal(document.activeElement, card);
  }
  const archive = mediaNode({ src: '/tmp/archive.zip', caption: '', type: '' }, 'bot:bot_a').querySelector('a');
  assert.equal(archive.download, 'archive.zip');
  const remote = mediaNode({ src: 'https://example.com/demo.HTML?download=false#preview', caption: '', type: '' }, 'bot:bot_a').querySelector('a');
  assert.equal(remote.target, '_blank');
  assert.equal(remote.hasAttribute('download'), false);
});

test('document loading failures are visible and retry stays in the authenticated page', async () => {
  await reset([message('doc', '<media src="/tmp/report.md" />')]);
  let status = 401;
  route = ({ path }) => path === '/api/media' ? new Response(status === 200 ? '<p>Recovered</p>' : '', { status, headers: { 'content-type': 'text/html' } }) : undefined;
  document.querySelector('.media-file').click(); await settle();
  const dialog = document.querySelector('dialog.document-preview');
  assert.match(dialog.textContent, /401/);
  assert.equal(dialog.querySelector('iframe'), null);
  status = 200;
  [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Retry').click(); await settle();
  assert.match(dialog.querySelector('iframe').srcdoc, /Recovered/);
  dialog.querySelector('[aria-label="Close"]').click();
});

test('closing a document cancels its request and a late response cannot reopen it', async () => {
  await reset([message('doc', '<media src="/tmp/report.html" />')]);
  let resolve;
  route = ({ path }) => path === '/api/media' ? new Promise(done => { resolve = done; }) : undefined;
  document.querySelector('.media-file').click();
  const request = calls.filter(call => call.path === '/api/media').at(-1);
  document.querySelector('dialog.document-preview [aria-label="Close"]').click();
  assert.equal(request.options.signal.aborted, true);
  resolve(new Response('<h1>Late</h1>', { headers: { 'content-type': 'text/html' } })); await settle();
  assert.equal(document.querySelector('dialog.document-preview'), null);
});

test('plain-text document fallback escapes markup and oversized previews fail visibly', async () => {
  await reset([message('doc', '<media src="/tmp/report.md" />')]);
  route = ({ path }) => path === '/api/media' ? new Response('<script>alert(1)</script>', { headers: { 'content-type': 'text/plain' } }) : undefined;
  document.querySelector('.media-file').click(); await settle();
  let dialog = document.querySelector('dialog.document-preview');
  assert.match(dialog.querySelector('iframe').srcdoc, /&lt;script&gt;/);
  assert.doesNotMatch(dialog.querySelector('iframe').srcdoc, /<script>/);
  dialog.querySelector('[aria-label="Close"]').click();
  route = ({ path }) => path === '/api/media' ? new Response('large', { headers: { 'content-length': String(17 * 1024 * 1024) } }) : undefined;
  document.querySelector('.media-file').click(); await settle();
  dialog = document.querySelector('dialog.document-preview');
  assert.match(dialog.textContent, /16 MiB/);
  assert.equal(dialog.querySelector('iframe'), null);
  dialog.querySelector('[aria-label="Close"]').click();
});

test('literal percent filenames render and the welcome/sidebar use the renamed main Bot', async () => {
  await reset([message('welcome', '', { key: 'greeting.chief', kind: 'greeting' })]);
  for (const src of ['/tmp/100%.pdf', '/tmp/literal%20name.pdf', 'https://example.com/100%.pdf']) {
    const figure = mediaNode({ src, caption: 'Report', type: '' }, 'bot:bot_a');
    assert.ok(figure.querySelector('a'));
    assert.match(figure.textContent, /%/);
  }
  assert.match(document.querySelector('.feed-inner').textContent, /I'm Rob/);
  state.bots = state.bots.filter((bot) => bot.isMain);
  nav.renderSidebar();
  assert.match(document.querySelector('.side-hint').textContent, /Rob/);
  assert.doesNotMatch(document.querySelector('.side-hint').textContent, /Chief/);
});

test('sending while busy needs no adjustment control and delivery events preserve the next draft', async () => {
  await reset();
  const user = message('msg_pending', 'Only domestic', { role: 'user', dispatchState: 'pending' });
  emit({ type: 'chat.busy', chatId: user.chatId, busy: true, turns: [] });
  route = ({ path, options }) => path.endsWith('/messages') && options.method === 'POST'
    ? response({ message: user }) : undefined;
  type('Only domestic'); enter(); await settle();
  assert.equal(postCalls().length, 1);
  assert.equal(postCalls()[0].body.text, 'Only domestic');
  assert.match(document.querySelector('.message-delivery').textContent, /Waiting to be processed/);
  assert.equal(document.querySelector('.message-delivery button'), null);
  assert.equal(document.querySelector('.composer').textContent.trim(), '');
  type('Keep my draft');
  emit({ type: 'message.upsert', message: { ...user, dispatchState: 'adjusting' } });
  assert.match(document.querySelector('.message-delivery').textContent, /Adjusting/);
  assert.equal(document.querySelector('.message-delivery button'), null);
  emit({ type: 'message.upsert', message: { ...user, dispatchState: 'delivered' } });
  assert.equal(document.querySelector('.message-delivery'), null);
  assert.equal(composer().value, 'Keep my draft');
  assert.equal(calls.filter((call) => call.options.method === 'POST').length, 1);
});

test('held supplements require an explicit continuation and a failed action leaves them visible', async () => {
  const user = message('msg_held', 'Correction', { role: 'user', dispatchState: 'held' });
  await reset([user]);
  assert.match(document.querySelector('.message-delivery').textContent, /Check the full session/);
  const button = document.querySelector('.message-delivery button');
  assert.equal(button.textContent, 'Continue with follow-ups');
  assert.equal(calls.filter((call) => call.path.endsWith('/resume-pending')).length, 0);
  route = ({ path }) => path.endsWith('/resume-pending') ? response({ message: 'Still busy' }, 409) : undefined;
  button.click(); await settle();
  assert.equal(document.querySelector('.message-delivery button').disabled, false);
  assert.match(document.querySelector('.message-delivery').textContent, /Correction|Check the full session/);
  assert.equal(calls.filter((call) => call.path.endsWith('/resume-pending')).length, 1);
});

test('a delayed send receipt cannot restore an obsolete pending state after the live processing event', async () => {
  await reset();
  const user = message('msg_receipt', 'Request', { role: 'user', dispatchState: 'pending', dispatchRevision: 0 });
  let accept;
  route = ({ path, options }) => path.endsWith('/messages') && options.method === 'POST'
    ? new Promise((resolve) => { accept = () => resolve(response({ message: user })); }) : undefined;
  type('Request'); enter();
  emit({ type: 'message.upsert', message: { ...user, dispatchState: 'processing', dispatchRevision: 1 } });
  accept(); await settle();
  assert.equal(state.messages.get(user.chatId).find((item) => item.id === user.id).dispatchState, 'processing');
  assert.equal(document.querySelector('.message-delivery'), null);
  assert.match(document.querySelector('.feed-inner').textContent, /Request/);
  emit({ type: 'message.upsert', message: { ...user, dispatchState: 'delivered', dispatchRevision: 2 } });
  emit({ type: 'message.upsert', message: { ...user, dispatchState: 'pending', dispatchRevision: 0 } });
  assert.equal(document.querySelector('.message-delivery'), null);
});


test('tool failures leave the feed, group repeated calls in records and retain legacy tool history', async () => {
  const failed = { type: 'tool', name: 'message_bot', state: 'failed' };
  const item = message('quiet-tools', 'Here is the result', { parts: [failed, { type: 'text', text: 'Here is the result' }, { ...failed }, { type: 'tool', name: 'web_search', state: 'ok' }] });
  await reset([message('legacy', 'Older reply', { tools: [{ name: 'legacy_tool', state: 'failed' }] }), item]);
  assert.doesNotMatch(document.querySelector('.feed-inner').textContent, /message_bot|failed|host did not provide/);
  assert.equal(document.querySelector('.execution-dot'), null);
  const trigger = document.querySelector('.execution-toggle'); trigger.click();
  assert.equal(trigger.getAttribute('aria-controls'), 'drawer');
  const records = document.querySelectorAll('.execution-record');
  assert.equal(records.length, 2);
  assert.match(records[0].textContent, /message_bot · 2 call\(s\) · 2 failed/);
  assert.match(records[0].textContent, /web_search/);
  assert.match(records[1].textContent, /legacy_tool/);
  assert.equal(records[0].querySelectorAll('.tool-feedback').length, 2);
  assert.equal(document.querySelector('#drawer').hidden, false);
  document.querySelector('#drawer button[aria-label="Close details"]').click();
  assert.equal(document.querySelector('#drawer').hidden, true);
  assert.equal(document.activeElement, document.querySelector('.execution-toggle'));
});

test('a final failure keeps one outcome and retry action while technical details stay in the owning record', async () => {
  const item = message('failed-turn', 'Partial answer', { status: 'error', retryable: true, error: '<script>opaque transport failure</script>', retried: 2, sessionId: 'owned-session' });
  await reset([item]);
  assert.match(document.querySelector('.turn-failed').textContent, /This reply could not be completed/);
  assert.doesNotMatch(document.querySelector('.feed-inner').textContent, /opaque transport failure/);
  assert.ok(document.querySelector('.execution-dot'));
  document.querySelector('.turn-failed .soft').click();
  const record = document.querySelector('[data-record-id="failed-turn"]');
  assert.equal(record.open, true);
  assert.equal(document.activeElement, record.querySelector('summary'));
  assert.match(record.textContent, /Still failed after retrying 2/);
  assert.match(record.textContent, /opaque transport failure/);
  assert.equal(record.querySelector('script'), null);
  route = ({ path }) => path.endsWith('/retry') ? response({}) : undefined;
  document.querySelector('.turn-failed .btn').click(); await settle();
  assert.ok(calls.some((call) => call.path.endsWith('/failed-turn/retry')));
  emit({ type: 'message.upsert', message: message('next-turn', 'Now completed') });
  assert.equal(document.querySelector('.execution-dot'), null);
  assert.ok(document.querySelector('[data-record-id="failed-turn"]'));
});

test('only settled unconfirmed memory needs an inline action, and confirmed recovery removes it', async () => {
  const failed = { type: 'tool', name: 'remember', state: 'failed', issue: { code: 'memory_full', scope: 'team', key: 'writing.style', remaining: 2, needed: 50 } };
  let item = message('memory-result', 'Answer', { status: 'streaming', parts: [failed, { ...failed }] });
  await reset([item]);
  assert.equal(document.querySelector('.turn-failed'), null);
  item = { ...item, status: 'done', parts: [...item.parts, { type: 'tool', name: 'remember', state: 'ok' }] };
  emit({ type: 'message.upsert', message: item });
  assert.equal(document.querySelectorAll('.turn-failed').length, 1);
  assert.match(document.querySelector('.turn-failed').textContent, /Some memory saves remain unconfirmed/);
  assert.ok(document.querySelector('.execution-dot'));
  [...document.querySelectorAll('.turn-failed button')].find((button) => button.textContent === 'Manage memory').click();
  assert.equal(state.overlay.scope, 'team'); closeOverlay();
  item = { ...item, parts: [...item.parts, { type: 'tool', name: 'remember', state: 'ok', memoryReceipt: { scope: 'team', key: 'writing.style', entryId: 'm1', revision: 'v2', outcome: 'updated' } }] };
  emit({ type: 'message.upsert', message: item });
  assert.equal(document.querySelector('.turn-failed'), null);
  assert.equal(document.querySelector('.execution-dot'), null);
  document.querySelector('.execution-toggle').click();
  assert.equal(document.querySelectorAll('.tool-feedback').length, 2);
  assert.match(document.querySelector('.execution-list').textContent, /topic was saved or updated/);
});

test('execution records load older history, survive live updates and clear on reset or chat switch', async () => {
  const recent = message('recent-record', 'Recent', { parts: [{ type: 'tool', name: 'read', state: 'ok' }] });
  const older = message('older-record', 'Older', { ts: 500, parts: [{ type: 'tool', name: 'message_bot', state: 'failed' }] });
  await reset([recent]);
  state.messagePages.set(recent.chatId, { loaded: true, hasMore: true, nextBefore: 'recent-record' });
  route = ({ path, query, options }) => path.includes(recent.chatId) && options.method === 'GET' && query.has('before') ? response({ messages: [older], hasMore: false }) : undefined;
  document.querySelector('.execution-toggle').click();
  const record = document.querySelector('.execution-record'); record.open = true;
  const body = document.querySelector('.execution-body'); body.scrollTop = 83;
  const group = record.querySelector('.execution-tool'); group.open = true;
  group.querySelector('summary').focus();
  type('Keep my draft');
  emit({ type: 'message.upsert', message: { ...recent, text: 'Recent with more text' } });
  assert.equal(document.querySelector('.execution-record'), record);
  assert.equal(group.open, true);
  assert.equal(body.scrollTop, 83);
  assert.equal(composer().value, 'Keep my draft');
  document.querySelector('.execution-earlier').click(); await settle();
  assert.equal(document.querySelectorAll('.execution-record').length, 2);
  assert.equal(document.querySelector('.execution-earlier').hidden, true);
  assert.equal(record.open, true);
  emit({ type: 'chat.reset', chatId: recent.chatId });
  assert.equal(document.querySelectorAll('.execution-record').length, 0);
  assert.match(body.textContent, /No execution records/);
  nav.openChat('bot:bot_b'); await settle();
  document.querySelector('.execution-toggle').click();
  assert.doesNotMatch(document.querySelector('#drawer').textContent, /message_bot/);
});


test('group execution records keep each reply linked to its own session and participant', async () => {
  await reset();
  state.groups = [{ id: 'review', name: 'Review', memberIds: ['bot_a', 'bot_b'], adminId: 'bot_a' }];
  const chatId = 'group:review';
  const opened = [];
  window.mcode = { miniapp: { agent: { open: async (sessionId) => { opened.push(sessionId); } } } };
  route = ({ path, options }) => path.includes(chatId) && options.method === 'GET' ? response({ messages: [
    message('group-a', 'Partial', { chatId, status: 'error', sessionId: 'session-a', error: 'Original reason' }),
    message('group-b', 'Done', { chatId, botId: 'bot_b', sessionId: 'session-b', parts: [{ type: 'tool', name: 'read', state: 'ok' }] }),
  ] }) : undefined;
  try {
    nav.openChat(chatId); await settle();
    assert.ok(document.querySelector('.execution-dot'), 'another participant finishing must not erase the failure');
    document.querySelector('.execution-toggle').click();
    const records = [...document.querySelectorAll('.execution-record')];
    assert.match(records[0].textContent, /Writer/);
    assert.match(records[1].textContent, /Rob/);
    for (const record of records) {
      record.open = true;
      [...record.querySelectorAll('button')].find((button) => button.textContent === 'Open full conversation').click();
    }
    await settle();
    assert.deepEqual(opened, ['session-b', 'session-a']);
    document.querySelector('#drawer button[aria-label="Close details"]').click();
  } finally {
    delete window.mcode;
    state.groups = [];
    await reset();
  }
});

test('the background task strip keeps the official one line rows and folds a long queue', async () => {
  await reset();
  // Nothing is running: the strip stays empty instead of printing a stray "null".
  assert.equal(document.querySelector('.helpers').textContent, '');
  const chat = 'bot:bot_a';
  const queued = Array.from({ length: 5 }, (_, index) => ({
    id: `hlp_q${index}`, botId: 'bot_a', chatId: chat, title: `Queued task ${index + 1}`, task: `Queued task ${index + 1}`,
    status: 'queued', createdAt: Date.now(),
  }));
  emit({
    type: 'helpers.changed',
    helpers: [
      { id: 'hlp_run', botId: 'bot_a', chatId: chat, title: 'Rebuild the truth table', task: 'Rebuild the truth table in the verifier', status: 'running', startedAt: Date.now() - 60000 },
      { id: 'hlp_wait', botId: 'bot_b', chatId: chat, title: 'Collect the samples', task: 'Collect the samples', status: 'waiting_for_tasks', createdAt: Date.now() - 120000 },
      ...queued,
    ],
  });
  await settle();
  const strip = document.querySelector('.helpers');
  const rows = strip.querySelectorAll('.helper-row');
  // The rows are the ones the official build draws, in its order. The first three stay in the
  // open, the rest fold into one line.
  assert.equal(rows.length, 3);
  // A row is one line: who is doing what, then the elapsed time, then the stop button.
  const running = rows[0];
  assert.equal(running.className, 'helper-row');
  assert.match(running.querySelector('.helper-text').textContent, /Rob is working on "Rebuild the truth table"/);
  assert.ok(running.querySelector('.helper-time').textContent);
  assert.equal(running.querySelector('button').className, 'btn sm');
  assert.equal(running.querySelector('button').textContent, 'Stop');
  // The row carries the whole task as its hover hint.
  assert.equal(running.title, 'Rebuild the truth table in the verifier');
  // A queued job says so, and has no elapsed time yet.
  const queuedRow = rows[2];
  assert.match(queuedRow.querySelector('.helper-text').textContent, /Rob has this queued: "Queued task 1"/);
  assert.equal(queuedRow.querySelector('.helper-time').textContent, '');
  // The queue behind the third row folds into one line.
  const more = strip.querySelector('.helper-more');
  assert.match(more.textContent, /4 more tasks/);
  more.click();
  await settle();
  assert.equal(strip.querySelectorAll('.helper-row').length, 7);
  assert.equal(strip.querySelector('.helper-more').textContent, 'Collapse queue');
});