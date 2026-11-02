// @ts-check
// The note limits the server states, as the client shows them.
//
// The point of this file: the numbers in the group panel are the server's numbers. The server
// says how many entries and how many characters a group note keeps; the client carries those
// into the panel instead of writing down numbers of its own that would drift from the ones the
// plugin actually applies. A panel that states no numbers at all is better than a panel that
// states the wrong ones.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM(
  '<div class="app"><button id="trigger">Settings</button><main id="main"><textarea></textarea></main><aside id="drawer"></aside></div><div id="overlay-root"></div><div id="toast" hidden></div>',
  { url: 'http://localhost/bot' },
);
for (const key of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Node', 'FormData']) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
window.matchMedia = () => ({ matches: false });
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };

/** What the server sends on /api/state; the cases below change it. */
let serverState = {
  bots: [{ id: 'b1', name: 'Rob', role: 'Coordinator', skin: 'bubble', isMain: true }],
  groups: [{
    id: 'g1', name: 'Team', notice: '', adminId: 'b1', memberIds: ['b1'], replyMode: 'admin',
    notes: true, noteEntries: [],
  }],
  noteLimits: { entries: 6, chars: 1200 },
  schedules: [], helpers: [], tasks: [], busyChats: [], turns: [], chats: {}, approvals: [], sessions: {},
  agentAvailable: true, locale: 'en', settings: { language: 'en', userName: 'Test' }, user: { name: 'Test', systemName: 'Test' },
};

globalThis.fetch = async (url) => {
  if (String(url).includes('/api/state')) return { ok: true, status: 200, json: async () => structuredClone(serverState) };
  if (String(url).includes('/api/usage')) return { ok: true, status: 200, json: async () => ({ byBot: [] }) };
  return { ok: true, status: 200, json: async () => ({}) };
};

const { state, loadState } = await import('../miniapp/client/core.js');
const { setLocale } = await import('../miniapp/client/i18n.js');
const { renderDrawer } = await import('../miniapp/client/panels.js');

setLocale('en');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Open the panel of the group and hand back what it shows. */
async function groupPanel() {
  state.current = 'group:g1';
  state.drawer = { open: true, view: 'overview', memTab: 'self', dirty: false };
  renderDrawer();
  await tick();
  return document.getElementById('drawer').textContent;
}

test('the client keeps the note limits the server states', async () => {
  await loadState();
  assert.deepEqual(state.noteLimits, { entries: 6, chars: 1200 });
});

test('the group panel states the limits the server sent', async () => {
  await loadState();
  const text = await groupPanel();
  assert.match(text, /6 entries and 1200 characters/);
});

test('the panel follows the server, it does not write the numbers down itself', async () => {
  serverState = { ...serverState, noteLimits: { entries: 3, chars: 400 } };
  await loadState();
  assert.deepEqual(state.noteLimits, { entries: 3, chars: 400 });
  const text = await groupPanel();
  assert.match(text, /3 entries and 400 characters/);
  assert.doesNotMatch(text, /6 entries and 1200 characters/);
});

test('a server that states no limits leaves the panel without a limit line', async () => {
  const { noteLimits, ...withoutLimits } = serverState;
  serverState = withoutLimits;
  await loadState();
  assert.equal(state.noteLimits, null);
  const text = await groupPanel();
  assert.doesNotMatch(text, /entries and .* characters/);
});
