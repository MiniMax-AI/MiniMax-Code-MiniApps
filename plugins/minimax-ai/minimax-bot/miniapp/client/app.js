// @ts-check
import { unresolvedMemoryFailures } from './tool-feedback.js';
import { executionNeedsAttention } from './execution-records.js';
import { reconcileChild, reconcileChildren } from './view-state.js';
import { renderMarkdown } from './markdown.js';
import { mediaNode, splitMedia } from './media.js';
import { installOctopusDefs, inkOf, botMark } from './octopus.js';
import {
  api,
  applyAppearance,
  botById,
  botByName,
  cacheMessage,
  canOpenSession,
  chatExists,
  chatMark,
  clearMessages,
  clockLabel,
  copyText,
  groupById,
  groupMarkOf,
  guard,
  h,
  icon,
  loadMessages,
  loadEarlierMessages,
  loadState,
  markOf,
  markRead,
  nav,
  openSession,
  prefs,
  reportSystemLocale,
  savePrefs,
  state,
  t,
  targetOf,
  tileBot,
  toast,
  unreadOf,
} from './core.js';
import { openContextMenu, openExecutionRecords, openOverlay, renderDrawer, renderOverlay, wireOverlayKeys } from './panels.js';
import { locale, translateDom } from './i18n.js';
import { applyReactionUpdate, closeDetachedReactionPicker, closeReactionPicker, reactionBar, reactionButton, updateBubbleReactions } from './reactions.js';

const TEAM_TOOLS = new Set([
  'list_team', 'message_bot', 'remember', 'forget', 'recall', 'create_bot', 'update_bot', 'delete_bot',
  'create_group', 'update_group', 'delete_group', 'create_schedule', 'list_schedules', 'delete_schedule',
  'dispatch_tasks', 'get_tasks', 'cancel_tasks', 'post_group', 'start_helper', 'list_helpers', 'stop_helper',
]);
const TOOL_PHRASES = [
  [/ask_user|question/i, 'tool.askUser'],
  [/tool_search/i, 'tool.toolSearch'],
  [/mcp_invoke|connector/i, 'tool.connector'],
  [/web_?search|search_web/i, 'tool.webSearch'],
  [/web_?fetch|fetch_url|browse|browser/i, 'tool.webFetch'],
  [/apply_patch|str_replace|edit/i, 'tool.edit'],
  [/write|create_file/i, 'tool.write'],
  [/^(read|read_file|view|cat)$/i, 'tool.readFile'],
  [/read/i, 'tool.read'],
  [/grep|glob|find|search/i, 'tool.find'],
  [/bash|shell|exec|command|terminal|run/i, 'tool.shell'],
  [/^task$|agent|delegate/i, 'tool.task'],
  [/todo/i, 'tool.todo'],
  [/skill/i, 'tool.skill'],
  [/image|video|audio|music|speech/i, 'tool.media'],
];
const baseToolName = (name) => String(name ?? '').replace(/^mcp__.*?__/, '');
const isTeamTool = (name) => String(name).includes('minimax-bot') || TEAM_TOOLS.has(baseToolName(name));
/** What a tool call does, in words; `bare` drops the "use" wrapper for unknown tools. */
const toolPhrase = (name, bare = false) => {
  const key = TOOL_PHRASES.find(([re]) => /** @type {RegExp} */ (re).test(baseToolName(name)))?.[1];
  if (key) return t(/** @type {string} */ (key));
  return bare ? baseToolName(name) : t('tool.use', { name: baseToolName(name) });
};
/** A localised string, or `fallback` when the dictionary has no entry for `key`. */
const tOr = (key, params, fallback) => {
  const value = t(key, params);
  return value === key ? fallback : value;
};

const sideList = /** @type {HTMLElement} */ (document.getElementById('side-list'));
const rail = /** @type {HTMLElement} */ (document.getElementById('rail'));
const main = /** @type {HTMLElement} */ (document.getElementById('main'));

// ================================================================== sidebar
/** Sidebar filters: id, icon, label key. */
const SIDE_FILTERS = [
  ['all', 'chats', 'side.filter.all'],
  ['unread', 'unread', 'side.filter.unread'],
  ['groups', 'users', 'side.filter.groups'],
  ['direct', 'person', 'side.filter.direct'],
];
/** Chats read while the Unread filter was on; they stay listed until the filter changes. */
const readUnderUnread = new Set();
const sideFilter = () => (SIDE_FILTERS.some(([id]) => id === prefs.sideFilter) ? prefs.sideFilter : 'all');

/** Whether a chat shows under `filter`. */
function passesFilter(filter, kind, chatId) {
  if (filter === 'groups') return kind === 'group';
  if (filter === 'direct') return kind === 'bot';
  if (filter === 'unread') return unreadOf(chatId) || readUnderUnread.has(chatId);
  return true;
}

function setSideFilter(id) {
  if (sideFilter() === id) return;
  prefs.sideFilter = id;
  readUnderUnread.clear();
  savePrefs();
  renderSidebar();
  sideList.scrollTop = 0;
}

/** The icon rail; badges count unread chats in each filter. */
function renderRail(all) {
  const unread = all.filter((e) => unreadOf(e.chatId));
  const counts = {
    unread: unread.length,
    groups: unread.filter((e) => e.kind === 'group').length,
    direct: unread.filter((e) => e.kind === 'bot').length,
  };
  const current = sideFilter();
  rail.replaceChildren(
    ...SIDE_FILTERS.map(([id, ic, label]) => {
      const n = counts[/** @type {keyof typeof counts} */ (id)] ?? 0;
      return h(
        'button',
        {
          type: 'button',
          class: 'rail-btn',
          'aria-pressed': id === current ? 'true' : 'false',
          'aria-label': n ? `${t(label)}${t('a11y.sep')}${t('side.filter.unreadCount', { n })}` : t(label),
          title: t(label),
          onclick: () => setSideFilter(id),
        },
        icon(/** @type {any} */ (ic), 20),
        n ? h('span', { class: 'rail-badge', 'aria-hidden': 'true' }, n > 99 ? '99+' : String(n)) : null,
      );
    }),
  );
}

/** First character of a name for an avatar: a CJK character as is, a letter upper-cased. */
export function initialOf(name) {
  const first = Array.from(String(name ?? '').trim())[0] ?? '';
  return first.toLocaleUpperCase();
}

/** The user's avatar at the bottom of the rail; it opens Settings. */
function renderMe() {
  const name = state.user?.name || '';
  const button = /** @type {HTMLElement} */ (document.getElementById('me-btn'));
  const label = name ? t('side.me', { name }) : t('side.settings');
  button.setAttribute('aria-label', label);
  button.title = label;
  /** @type {HTMLElement} */ (document.getElementById('me-initial')).textContent = initialOf(name) || '?';
}

function renderSidebar() {
  renderMe();
  const tile = tileBot();
  const all = [
    ...(tile ? [{ kind: 'bot', item: tile, chatId: `bot:${tile.id}`, tile: true }] : []),
    ...state.bots.filter((b) => b.id !== tile?.id).map((b) => ({ kind: 'bot', item: b, chatId: `bot:${b.id}` })),
    ...state.groups.map((g) => ({ kind: 'group', item: g, chatId: `group:${g.id}` })),
  ];
  renderRail(all);
  const filter = sideFilter();
  // The main Bot's big tile heads the full list only. Under a filter it is listed as a normal
  // row, so a filtered list never looks empty while the main Bot is the chat that matches.
  const showTile = Boolean(tile) && filter === 'all';
  const entries = all
    .filter((entry) => !(entry.tile && showTile) && passesFilter(filter, entry.kind, entry.chatId))
    .map((entry) => ({ ...entry, at: state.chats[entry.chatId]?.lastTs || entry.item.createdAt }));
  entries.sort((a, b) => Number(Boolean(b.item.pinned)) - Number(Boolean(a.item.pinned)) || b.at - a.at);

  const nodes = [];
  if (tile && showTile) {
    const chatId = `bot:${tile.id}`;
    const tileUnread = unreadOf(chatId);
    nodes.push(
      h(
        'div',
        { class: 'tile-wrap' },
        h(
          'button',
          {
            type: 'button',
            class: tileUnread ? 'tile is-unread' : 'tile',
            'aria-current': state.current === chatId ? 'page' : null,
            'aria-label': [tile.name, t('a11y.mainBot'), tileUnread ? t('a11y.unread') : ''].filter(Boolean).join(t('a11y.sep')),
            title: state.chats[chatId]?.preview || tile.name,
            onclick: () => openChat(chatId),
            oncontextmenu: (e) => rowMenu(e, chatId),
          },
          // Same unread dot as the rows, on the avatar's free corner (the star sits bottom-right).
          h('span', { class: 'tile-mark' }, markOf(tile, { size: 60, star: true }), tileUnread ? h('span', { class: 'tile-unread', 'aria-hidden': 'true' }) : null),
          h('span', { class: 'tile-name' }, tile.name),
        ),
      ),
    );
  }
  for (const entry of entries) nodes.push(sideRow(entry));
  if (!entries.length) {
    const name = tile?.name ?? t('a11y.mainBot');
    if (filter === 'all') nodes.push(h('p', { class: 'side-hint' }, t('side.hint', { name })));
    else nodes.push(h('p', { class: 'side-hint', role: 'status' }, t(`side.empty.${filter}`, { name })));
  }
  sideList.replaceChildren(...nodes);
}

function sideRow({ kind, item, chatId }) {
  const summary = state.chats[chatId] ?? {};
  const working = state.busy.has(chatId);
  const unread = unreadOf(chatId);
  const preview = working ? t('side.replying') : summary.preview || '';
  return h(
    'button',
    {
      type: 'button',
      class: 'row',
      'aria-current': state.current === chatId ? 'page' : null,
      'aria-label': [item.name, item.isMain ? t('a11y.mainBot') : '', item.pinned ? t('a11y.pinned') : '', working ? t('a11y.replying') : '', unread ? t('a11y.unread') : '']
        .filter(Boolean)
        .join('，'),
      onclick: () => openChat(chatId),
      oncontextmenu: (e) => rowMenu(e, chatId),
    },
    kind === 'bot' ? markOf(item, { size: 36, star: true }) : groupMarkOf(item, 36),
    h(
      'span',
      { class: 'row-body' },
      h('span', { class: 'row-name' }, h('span', { class: 'row-title' }, item.name), item.pinned ? h('span', { class: 'pin' }, icon('pin', 12)) : null),
      preview ? h('span', { class: `row-preview ${working ? 'working' : ''}` }, preview) : null,
    ),
    unread ? h('span', { class: 'unread', 'aria-hidden': 'true' }) : null,
  );
}

function rowMenu(event, chatId) {
  event.preventDefault();
  openContextMenu(event.clientX, event.clientY, chatId);
}

// ================================================================== chat mount
/** @type {Record<string, any>} */
const ui = {};
const drafts = new Map();
const submissions = new Map();
let mounted = '';
let mountRevision = 0;
let revealRevision = 0;
let mountingChat = Promise.resolve();

function saveDraft() {
  if (mounted && ui.input) drafts.set(mounted, ui.input.value);
}

function openChat(chatId) {
  if (!chatExists(chatId)) return;
  revealRevision++;
  saveDraft();
  // Opened from the Unread filter: keep it listed there after it is read.
  if (sideFilter() === 'unread' && unreadOf(chatId)) readUnderUnread.add(chatId);
  state.current = chatId;
  state.quote = null;
  prefs.lastChat = chatId;
  markRead(chatId);
  savePrefs();
  if (state.drawer.view !== 'overview') state.drawer.view = 'overview';
  state.drawer.dirty = false;
  renderAll();
}

/** A task result may live on an older page. Stop as soon as its message is available. */
async function revealMessage(chatId, messageId) {
  if (!chatExists(chatId)) return;
  if (mounted !== chatId || state.current !== chatId) openChat(chatId);
  const request = ++revealRevision;
  const revision = mountRevision;
  const current = () => mounted === chatId && state.current === chatId && mountRevision === revision && revealRevision === request;
  try {
    // Let the ordinary mount finish before moving focus away from the composer.
    await mountingChat;
    if (!current()) return;
    let messages = await loadMessages(chatId);
    while (current() && !messages.some((message) => message.id === messageId) && state.messagePages.get(chatId)?.hasMore) {
      const before = state.messagePages.get(chatId)?.nextBefore;
      messages = await loadEarlierMessages(chatId);
      if (state.messagePages.get(chatId)?.hasMore && state.messagePages.get(chatId)?.nextBefore === before) throw new Error(t('error.requestFailed'));
    }
    if (!current()) return;
    renderFeed(messages, false);
    const target = [...ui.feedInner.children].find((node) => node.dataset.mid === messageId);
    if (!target) { toast(t('feed.messageGone'), 'error'); return; }
    target.setAttribute('tabindex', '-1');
    target.scrollIntoView({ block: 'center', behavior: 'auto' });
    target.focus({ preventScroll: true });
  } catch (error) {
    if (current()) toast(error instanceof Error ? error.message : String(error), 'error');
  }
}

/** Language the visible UI was last built in; a change rebuilds everything that holds text. */
let renderedLocale = '';

function renderAll() {
  renderConnection();
  closeReactionPicker();
  if (renderedLocale !== locale()) {
    renderedLocale = locale();
    translateDom();
    // Composer, feed and chrome carry text: rebuild the open chat, keeping its draft.
    if (mounted && ui.input) drafts.set(mounted, ui.input.value);
    mounted = '';
    if (state.overlay) renderOverlay();
  }
  renderSidebar();
  renderMain();
  renderDrawer();
}

/** Live activity of a running turn: the server sends `{ key, params }` (older builds: text). */
function liveLabel(m) {
  if (!m.live) return '';
  if (typeof m.live === 'string') return m.live;
  return tOr(m.live.key, m.live.params, '');
}

/** Text of a stored message; greetings and notices carry a key so they follow the language. */
function displayText(m) {
  const params = m.key === 'greeting.chief' ? { ...m.params, name: botById(m.botId)?.name ?? tileBot()?.name ?? t('a11y.mainBot') } : m.params;
  return m.key ? tOr(m.key, params, m.text ?? '') : m.text ?? '';
}

function renderMain() {
  const chatId = state.current;
  if (!chatId || !chatExists(chatId)) {
    mounted = '';
    main.replaceChildren(h('p', { class: 'loading' }, t('main.noBots')));
    return;
  }
  if (mounted !== chatId) mountingChat = mountChat(chatId);
  else refreshChrome();
}

/**
 * Files waiting to be sent with the next message, per chat. Each upload starts as soon as the file
 * is added, so sending only waits for the ones still on their way.
 * @type {Map<string, { key: string, name: string, size: number, kind: string, status: 'uploading' | 'done' | 'error', id?: string, preview?: string, error?: string }[]>}
 */
const pendingFiles = new Map();
const MAX_PENDING_FILES = 10;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const IMAGE_FILE_RE = /\.(png|jpe?g|gif|webp|bmp|avif|svg|heic)$/i;

const filesOf = (chatId) => pendingFiles.get(chatId) ?? [];

function fileSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Adds files to the next message of `chatId` and uploads each right away. */
function addFiles(chatId, files) {
  const list = [...filesOf(chatId)];
  for (const file of files) {
    if (list.length >= MAX_PENDING_FILES) {
      toast(t('attach.tooMany', { n: MAX_PENDING_FILES }), 'error');
      break;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast(t('attach.tooLarge', { name: file.name }), 'error');
      continue;
    }
    // A pasted screenshot has a generic name; give it one that says what it is.
    const name = file.name && file.name !== 'image.png' ? file.name : `screenshot-${Date.now()}.${(file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`;
    const kind = file.type.startsWith('image/') || IMAGE_FILE_RE.test(name) ? 'image' : 'file';
    const entry = {
      key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name,
      size: file.size,
      kind,
      status: /** @type {'uploading'} */ ('uploading'),
      preview: kind === 'image' ? URL.createObjectURL(file) : undefined,
    };
    list.push(entry);
    void (async () => {
      try {
        const response = await fetch(`/api/uploads?name=${encodeURIComponent(name)}`, {
          method: 'POST',
          headers: { 'content-type': file.type || 'application/octet-stream' },
          body: file,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message ?? t('error.requestFailed'));
        Object.assign(entry, { status: 'done', id: data.upload.id });
      } catch (error) {
        Object.assign(entry, { status: 'error', error: error instanceof Error ? error.message : String(error) });
        toast(t('attach.failed', { name }), 'error');
      }
      if (mounted === chatId) {
        renderAttachBar();
        syncSend();
      }
    })();
  }
  pendingFiles.set(chatId, list);
  renderAttachBar();
  syncSend();
}

function removeFile(chatId, key) {
  const list = filesOf(chatId).filter((f) => {
    if (f.key === key && f.preview) URL.revokeObjectURL(f.preview);
    return f.key !== key;
  });
  pendingFiles.set(chatId, list);
  renderAttachBar();
  syncSend();
}

/** The files waiting above the input: a thumbnail or a file chip each, with a remove button. */
function renderAttachBar() {
  if (!ui.attachBar) return;
  const list = filesOf(mounted);
  ui.attachBar.hidden = !list.length;
  ui.attachBar.replaceChildren(
    ...list.map((f) =>
      h(
        'div',
        { class: `attach-item ${f.kind} ${f.status}`, title: f.error ?? `${f.name} · ${fileSize(f.size)}` },
        f.kind === 'image' && f.preview
          ? h('img', { src: f.preview, alt: f.name })
          : h('span', { class: 'attach-file' }, icon('file', 16), h('span', { class: 'attach-name' }, f.name), h('small', null, fileSize(f.size))),
        f.status === 'uploading' ? h('span', { class: 'attach-state', 'aria-label': t('attach.uploading') }, '…') : null,
        f.status === 'error' ? h('span', { class: 'attach-state error', 'aria-label': t('attach.failedShort') }, '!') : null,
        h('button', { type: 'button', class: 'attach-remove', 'aria-label': t('attach.remove', { name: f.name }), onclick: () => removeFile(mounted, f.key) }, icon('close', 12)),
      ),
    ),
  );
}

async function mountChat(chatId) {
  const revision = ++mountRevision;
  closeReactionPicker();
  mounted = chatId;
  helpersExpanded = false;
  const target = targetOf(chatId);
  ui.pillBar = h('div', { class: 'pill-bar' });
  ui.feedInner = h('div', { class: 'feed-inner' });
  ui.earlier = h('button', { type: 'button', class: 'btn sm load-earlier', hidden: true, onclick: () => void loadEarlier(chatId) }, t('feed.earlier'));
  ui.feed = h('div', { class: 'feed', role: 'log', 'aria-label': t('a11y.messages'), 'aria-live': 'polite' }, ui.earlier, ui.feedInner);
  ui.feed.addEventListener('scroll', () => updateJump());
  ui.jump = h('button', { type: 'button', class: 'btn sm jump', hidden: true, onclick: () => scrollBottom(true) }, icon('down', 14), t('feed.jump'));
  ui.approvals = h('section', { class: 'approvals', 'aria-label': t('a11y.approvals') });
  ui.helpers = h('section', { class: 'helpers', 'aria-label': t('helper.strip') });
  ui.input = /** @type {HTMLTextAreaElement} */ (
    h('textarea', { rows: 1, 'aria-label': t('compose.label'), placeholder: target.kind === 'group' ? t('compose.placeholderGroup', { name: target.group?.name }) : t('compose.placeholderBot', { name: target.bot?.name }) })
  );
  ui.input.value = drafts.get(chatId) ?? '';
  ui.mention = h('ul', { class: 'mention-pop', role: 'listbox', 'aria-label': t('compose.mentionList'), hidden: true });
  ui.quoting = h('div', { class: 'quoting', hidden: true });
  ui.send = h('button', { type: 'submit', class: 'send', 'aria-label': t('compose.send') }, icon('up', 18));
  ui.attachBar = h('div', { class: 'attach-bar', hidden: true });
  // Visually hidden, not `hidden`: it stays in the document so assistive tech and automation can reach it.
  const fileInput = /** @type {HTMLInputElement} */ (
    h('input', { type: 'file', multiple: true, class: 'file-input', tabindex: '-1', 'aria-label': t('attach.add') })
  );
  fileInput.addEventListener('change', () => {
    if (fileInput.files?.length) addFiles(chatId, [...fileInput.files]);
    fileInput.value = '';
  });
  const attachBtn = h(
    'button',
    { type: 'button', class: 'tool-btn attach-btn', title: t('attach.add'), 'aria-label': t('attach.add'), onclick: () => fileInput.click() },
    icon('clip', 18),
  );
  const card = h(
    'div',
    { class: 'compose-card' },
    ui.mention,
    ui.quoting,
    ui.attachBar,
    h('div', { class: 'compose-row' }, attachBtn, ui.input, ui.send),
    fileInput,
  );
  // Paste a screenshot or drop files straight into the composer.
  ui.input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    addFiles(chatId, files);
  });
  card.addEventListener('dragover', (e) => {
    if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
    e.preventDefault();
    card.classList.add('dropping');
  });
  card.addEventListener('dragleave', () => card.classList.remove('dropping'));
  card.addEventListener('drop', (e) => {
    card.classList.remove('dropping');
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    addFiles(chatId, files);
  });
  const form = h('form', { class: 'composer', onsubmit: (e) => { e.preventDefault(); void submit(); } }, card);
  wireComposer(chatId);
  renderAttachBar();
  main.replaceChildren(ui.pillBar, ui.feed, ui.jump, ui.helpers, ui.approvals, form);
  refreshChrome();
  ui.feedInner.replaceChildren(h('p', { class: 'loading', role: 'status' }, t('feed.loading')));
  try {
    const messages = await loadMessages(chatId);
    if (mounted !== chatId || revision !== mountRevision) return;
    renderFeed(messages);
  } catch (error) {
    if (mounted !== chatId || revision !== mountRevision) return;
    ui.feedInner.replaceChildren(h('p', { class: 'loading', role: 'alert' }, t('feed.loadFailed', { error: error instanceof Error ? error.message : String(error) })));
  }
  autosize();
  ui.input.focus();
}

function syncEarlier() {
  if (ui.earlier) ui.earlier.hidden = !state.messagePages.get(mounted)?.hasMore;
}

async function loadEarlier(chatId) {
  if (mounted !== chatId || ui.earlier.disabled) return;
  const revision = mountRevision;
  const button = ui.earlier;
  const feed = ui.feed;
  const height = feed.scrollHeight;
  const top = feed.scrollTop;
  button.disabled = true;
  button.textContent = t('feed.earlierLoading');
  try {
    const messages = await loadEarlierMessages(chatId);
    if (mounted !== chatId || revision !== mountRevision) return;
    renderFeed(messages, false);
    feed.scrollTop = top + feed.scrollHeight - height;
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    button.disabled = false;
    button.textContent = t('feed.earlier');
  }
}

function refreshChrome() {
  if (!mounted) return;
  renderPill();
  renderHelpers();
  renderApprovals();
  syncSend();
  renderQuoting();
}

function renderPill() {
  const chatId = mounted;
  const target = targetOf(chatId);
  const name = target.bot?.name ?? target.group?.name ?? '';
  const notice = state.memoryNotice && state.memoryNotice.chatId === chatId && state.memoryNotice.until > Date.now();
  ui.pillBar.replaceChildren(
    h(
      'button',
      {
        type: 'button',
        class: 'pill',
        'aria-expanded': state.drawer.open ? 'true' : 'false',
        'aria-label': notice ? t('pill.memoryUpdatedLabel', { name }) : t('pill.detailsLabel', { name }),
        onclick: () => {
          if (notice) {
            state.drawer = { ...state.drawer, open: true, view: 'memory' };
            state.memoryNotice = null;
          } else {
            state.drawer = { ...state.drawer, open: !state.drawer.open, view: 'overview' };
          }
          renderDrawer();
          renderPill();
        },
      },
      target.kind === 'bot' ? markOf(target.bot, { size: 26 }) : groupMarkOf(target.group, 26),
      h('span', { class: 'pill-name' }, name),
      notice ? h('span', { class: 'pill-note' }, t('pill.memoryUpdated')) : null,
      h('span', { class: 'pill-chev' }, icon(state.drawer.open ? 'right' : 'left', 14)),
    ),
    h('button', {
      type: 'button', class: 'execution-toggle',
      'aria-label': t(executionNeedsAttention(state.messages.get(chatId) ?? []) ? 'execution.attention' : 'execution.title'),
      'aria-expanded': state.drawer.open && state.drawer.view === 'execution' ? 'true' : 'false',
      'aria-controls': 'drawer', onclick: () => openExecutionRecords(),
    }, icon('clock', 16), h('span', null, t('execution.title')),
      executionNeedsAttention(state.messages.get(chatId) ?? []) ? h('span', { class: 'execution-dot', 'aria-hidden': 'true' }) : null),
  );
}

// ================================================================== feed
function nearBottom() {
  return ui.feed.scrollHeight - ui.feed.scrollTop - ui.feed.clientHeight < 140;
}
function scrollBottom(smooth = false) {
  ui.feed.scrollTo({ top: ui.feed.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  ui.jump.hidden = true;
}
function updateJump() {
  if (nearBottom()) ui.jump.hidden = true;
}

function renderFeed(messages, toBottom = true) {
  syncEarlier();
  refreshExecutionRecords();
  closeReactionPicker();
  if (!messages.length) {
    ui.feedInner.replaceChildren(emptyState());
    return;
  }
  // A rebuild (names or colors changed, a schedule fired…) must not wipe an answer the user
  // is still typing into a questionnaire.
  const kept = captureForms(ui.feedInner);
  const presentation = presentationKey();
  reconcileChildren(ui.feedInner, messages.map((m, i) => messageView(m, messages[i - 1], presentation)));
  restoreForms(ui.feedInner, kept);
  if (toBottom) scrollBottom();
}

/** Unsubmitted questionnaire input, keyed by message id. */
function captureForms(scope) {
  /** @type {Map<string, any[]>} */
  const kept = new Map();
  for (const form of scope.querySelectorAll('form.qcard')) {
    const mid = /** @type {HTMLElement | null} */ (form.closest('[data-mid]'))?.dataset.mid;
    if (!mid) continue;
    const fields = [...form.querySelectorAll('input')].map((el) => {
      const input = /** @type {HTMLInputElement} */ (el);
      return { name: input.name, value: input.value, checked: input.checked, text: input.type === 'text', focused: document.activeElement === input, start: input.selectionStart, end: input.selectionEnd };
    });
    kept.set(mid, fields);
  }
  return kept;
}

function restoreForms(scope, kept) {
  for (const [mid, fields] of kept) {
    const host = scope.dataset?.mid === mid ? scope : scope.querySelector(`[data-mid="${mid}"]`);
    const form = host?.querySelector('form.qcard');
    if (!form) continue;
    for (const field of fields) {
      for (const el of form.querySelectorAll('input')) {
        const input = /** @type {HTMLInputElement} */ (el);
        if (input.name !== field.name) continue;
        if (field.text && input.value !== field.value) input.value = field.value;
        else if (input.value === field.value) input.checked = field.checked;
        if (field.focused && !input.disabled) {
          input.focus({ preventScroll: true });
          if (field.text && field.start !== null) input.setSelectionRange(field.start, field.end);
        }
      }
    }
  }
}

function emptyState() {
  const target = targetOf(mounted);
  const starters =
    target.kind === 'bot'
      ? target.bot?.isMain
        ? [t('starter.main1'), t('starter.main2'), t('starter.main3')]
        : [t('starter.bot1'), t('starter.bot2'), t('starter.bot3')]
      : [t('starter.group1'), t('starter.group2')];
  return h(
    'div',
    { class: 'empty-chat' },
    target.kind === 'bot' ? markOf(target.bot, { size: 88 }) : groupMarkOf(target.group, 88),
    h('h2', null, target.bot?.name ?? target.group?.name),
    h('p', null, target.kind === 'bot' ? target.bot?.role || t('empty.bot') : target.group?.notice || t('empty.group')),
    h(
      'div',
      { class: 'starters' },
      starters.map((text) =>
        h('button', { type: 'button', class: 'btn', onclick: () => { ui.input.value = text; autosize(); ui.input.focus(); } }, text),
      ),
    ),
  );
}

function presentationKey() {
  return JSON.stringify([locale(), state.bots.map((bot) => [bot.id, bot.name, bot.color, bot.skin, bot.avatar, bot.isMain]), state.groups.map((group) => [group.id, group.name, group.adminId, group.memberIds])]);
}

function messageView(message, prev, presentation) {
  return {
    key: message.id,
    signature: JSON.stringify([message, prev?.ts, presentation, deliveryActions.has(`${message.chatId}:${message.id}`)]),
    create: () => renderItem(message, prev),
    update: (node) => renderItem(message, prev, node),
  };
}

function refreshExecutionRecords() {
  if (!mounted) return;
  // Keep the entry button mounted while its state changes, including keyboard focus.
  const button = ui.pillBar?.querySelector('.execution-toggle');
  if (button) {
    const attention = executionNeedsAttention(state.messages.get(mounted) ?? []);
    button.setAttribute('aria-label', t(attention ? 'execution.attention' : 'execution.title'));
    const dot = button.querySelector('.execution-dot');
    if (attention && !dot) button.append(h('span', { class: 'execution-dot', 'aria-hidden': 'true' }));
    if (!attention) dot?.remove();
  }
  if (state.drawer.open && state.drawer.view === 'execution') renderDrawer();
}

function upsertMessage(message) {
  if (mounted !== message.chatId || !ui.feedInner) return;
  const list = state.messages.get(message.chatId) ?? [];
  const index = list.findIndex((m) => m.id === message.id);
  const stick = nearBottom();
  const kept = captureForms(ui.feedInner);
  ui.feedInner.querySelector('.empty-chat')?.remove();
  ui.feedInner.querySelector('.loading')?.remove();
  const { created } = reconcileChild(ui.feedInner, messageView(message, list[index - 1], presentationKey()));
  restoreForms(ui.feedInner, kept);
  if (stick) scrollBottom();
  else if (created) ui.jump.hidden = false;
  refreshExecutionRecords();
}

/** One feed item, with a time separator when the gap is long. */
function renderItem(message, prev, existing) {
  const wrap = existing ?? h('div', { dataset: { mid: message.id } });
  const gap = !prev || message.ts - prev.ts > 10 * 60 * 1000 || new Date(prev.ts).toDateString() !== new Date(message.ts).toDateString();
  const separator = wrap.querySelector(':scope > .time-sep');
  if (gap) {
    if (separator) separator.textContent = clockLabel(message.ts);
    else wrap.prepend(h('div', { class: 'time-sep', role: 'separator' }, clockLabel(message.ts)));
  } else separator?.remove();
  const old = [...wrap.children].find((child) => !child.classList.contains('time-sep'));
  const body = renderMessage(message, old);
  if (old && old !== body) old.replaceWith(body);
  else if (!old) wrap.append(body);
  return wrap;
}

function renderMessage(m, existing) {
  switch (m.role) {
    case 'user':
      return h(
        'article',
        { class: 'msg user', 'aria-label': t('a11y.yourMessage') },
        h(
          'div',
          { class: 'bubble-wrap' },
          m.attachments?.length ? userAttachments(m.attachments) : null,
          m.text ? h('div', { class: 'bubble' }, userText(m.text)) : null,
          userDelivery(m),
          msgTools(m.text, null),
        ),
      );
    case 'system':
      // Server notices carry a key so they follow the current language; older ones are plain text.
      return h('div', { class: `event ${m.status === 'error' ? 'error' : ''}`, role: m.status === 'error' ? 'alert' : null }, m.key ? tOr(m.key, m.params, m.text) : m.text);
    case 'relay':
      return relayItem(m);
    case 'helper':
      return h(
        'div',
        { class: `event ${m.helperStatus === 'failed' ? 'error' : ''}` },
        icon('clock', 14),
        t(`event.helper.${m.helperStatus}`, { name: botById(m.botId)?.name ?? 'Bot', title: m.title ?? '' }),
      );
    case 'schedule':
      return h(
        'div',
        null,
        h('div', { class: 'event' }, icon('clock', 14), t('event.schedule', { name: m.scheduleName ?? '' })),
        h('div', { class: 'quote-card' }, m.text),
      );
    case 'bot':
      return botMessage(m, existing);
    default:
      return h('div');
  }
}

/** Delivery status belongs to the user input, independently of the streamed reply. */
function userDelivery(message) {
  const status = message.dispatchState;
  if (!status || status === 'processing' || status === 'delivered') return null;
  const key = `${message.chatId}:${message.id}`;
  const button = status === 'held' ? h('button', {
    type: 'button', class: 'btn sm', disabled: deliveryActions.has(key),
    onclick: async (event) => {
      if (deliveryActions.has(key)) return;
      deliveryActions.add(key);
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await api('POST', `/api/chats/${message.chatId}/resume-pending`);
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        deliveryActions.delete(key);
        button.disabled = false;
        // Resolve the latest object: a stream event may already have changed its status.
        const latest = state.messages.get(message.chatId)?.find((item) => item.id === message.id);
        if (latest) upsertMessage(latest);
      }
    },
  }, t('delivery.resume')) : null;
  return h('div', { class: 'message-delivery', role: 'status' },
    h('span', null, tOr(`delivery.${status}`, undefined, '')), button);
}
const deliveryActions = new Set();

function relayItem(m) {
  const from = botById(m.fromBotId);
  // In a group the post is the task itself, so show it in full; a private relay stays a
  // collapsed quote so a long hand-off does not bury the reply that follows it.
  if (m.chatId?.startsWith('group:')) {
    return h(
      'article',
      { class: 'gmsg', 'aria-label': t('a11y.groupPost', { name: m.fromName ?? 'Bot' }) },
      h(
        'div',
        { class: 'gmsg-head' },
        h(
          'div',
          { class: 'gmsg-who' },
          from ? markOf(from, { size: 24, chatId: m.chatId }) : null,
          h('span', { class: 'gmsg-name' }, m.fromName ?? from?.name ?? 'Bot'),
        ),
        h('span', { class: 'chip' }, t('group.postedBy')),
      ),
      h('div', { class: 'gmsg-body' }, h('div', { class: 'bubble-wrap' }, h('div', { class: 'bubble' }, markdownNode(m.text, m.chatId)))),
    );
  }
  const card = h('div', { class: 'quote-card', hidden: true }, m.text);
  const button = h(
    'button',
    {
      type: 'button',
      'aria-expanded': 'false',
      onclick: () => {
        card.hidden = !card.hidden;
        button.setAttribute('aria-expanded', card.hidden ? 'false' : 'true');
      },
    },
    t('relay.before'),
    from ? markOf(from, { size: 16, state: 'idle' }) : null,
    h('span', { class: 'ev-name' }, m.fromName ?? from?.name ?? 'Bot'),
    t('relay.after'),
    icon('down', 12),
  );
  return h('div', null, h('div', { class: 'event' }, button), card);
}

/** User text with @mentions of known Bots turned into colored chips. */
/** What the user attached to a message: image thumbnails and file chips that open the file. */
function userAttachments(list) {
  return h(
    'div',
    { class: 'user-attachments' },
    ...list.map((a) => {
      const url = `/api/uploads/${encodeURIComponent(a.id)}`;
      if (a.kind === 'image') {
        return h('a', { class: 'user-image', href: url, target: '_blank', rel: 'noopener noreferrer', title: a.name }, h('img', { src: url, alt: a.name, loading: 'lazy' }));
      }
      return h(
        'a',
        { class: 'media-file', href: url, download: a.name, target: '_blank', rel: 'noopener noreferrer', title: a.name },
        h('span', { class: 'media-file-name' }, a.name),
        h('span', { class: 'media-file-hint' }, fileSize(a.size ?? 0)),
      );
    }),
  );
}

function userText(text) {
  const names = state.bots.map((b) => b.name).sort((a, b) => b.length - a.length);
  if (!names.length) return text;
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`@(${escaped.join('|')})`, 'gi');
  const out = [];
  let last = 0;
  for (const match of String(text).matchAll(re)) {
    out.push(text.slice(last, match.index));
    const bot = botByName(match[1]);
    out.push(bot ? mentionChip(bot) : match[0]);
    last = /** @type {number} */ (match.index) + match[0].length;
  }
  out.push(text.slice(last));
  return out;
}

function mentionChip(bot) {
  return h('span', { class: 'mention', style: { color: inkOf(bot.color) } }, botMark(bot, { size: 16 }), bot.name);
}

/**
 * Markdown with @mentions of known Bots decorated and delivered files (`<media>` tags, Markdown
 * images) shown inline. `chatId` is the chat the text belongs to; local files load only with it.
 */
function markdownNode(text, chatId, existing) {
  const node = existing ?? h('div', { class: 'md' });
  const views = [];
  const mediaCounts = new Map();
  let textIndex = 0;
  for (const segment of splitMedia(text)) {
    if (segment.kind === 'media') {
      const occurrence = mediaCounts.get(segment.src) ?? 0;
      mediaCounts.set(segment.src, occurrence + 1);
      views.push({ key: `media:${segment.src}:${occurrence}`, signature: JSON.stringify(segment), create: () => mediaNode(segment, chatId) });
    } else {
      const holder = h('div', { html: renderMarkdown(segment.text) });
      for (const span of holder.querySelectorAll('span.mention')) {
        const bot = botByName((span.textContent ?? '').slice(1));
        if (bot) span.replaceWith(mentionChip(bot));
        else span.classList.remove('mention');
      }
      for (const child of holder.children) {
        const block = /** @type {HTMLElement} */ (child);
        views.push({ key: `text:${textIndex++}`, signature: block.outerHTML, create: () => block });
      }
    }
  }
  reconcileChildren(node, views);
  return node;
}

function legacyParts(m) {
  const parts = [];
  for (const t of m.tools ?? []) parts.push({ type: 'tool', name: t.name, state: t.state });
  if (m.text) parts.push({ type: 'text', text: m.text });
  return parts;
}

/**
 * One reply is one bubble. The Host opens a new text part for every assistant turn between two
 * tool calls, so a reply that ran a dozen tools used to paint a bubble per part and pushed the
 * conversation above it off the screen. The parts are joined the way the server joins them when
 * it stores the text of a message; the event lines keep their place in the order.
 */
function partViews(m, inGroup) {
  const parts = m.key ? [{ type: 'text', text: displayText(m) }] : m.parts ?? legacyParts(m);
  const texts = parts.filter((part) => part.type === 'text' && part.text?.trim());
  const joined = texts.map((part) => part.text).join('\n\n');
  const views = [];
  const presentation = presentationKey();
  let bubblePlaced = false;
  parts.forEach((part, index) => {
    if (part.type === 'text' && part.text?.trim()) {
      if (bubblePlaced) return;
      bubblePlaced = true;
      views.push({
        key: 'bubble',
        signature: JSON.stringify([joined, presentation, [m.status, m.userReactions, m.reactionsRevision, displayText(m), m.sessionId, botById(m.botId)?.name]]),
        create: () => updateBubbleControls(h('div', { class: 'bubble' }, markdownNode(joined, m.chatId)), m),
        update: (bubble) => {
          markdownNode(joined, m.chatId, bubble.firstElementChild);
          return updateBubbleControls(bubble, m);
        },
      });
    } else if (part.type === 'event') {
      const node = eventLine(part, m);
      if (node) views.push({ key: `event:${index}`, signature: JSON.stringify([part, presentation]), create: () => node });
    }
  });
  if (!texts.length) views.push({ key: 'reactions', signature: JSON.stringify([m.status, m.userReactions, m.reactionsRevision, locale()]), create: () => reactionBar(m) });
  if (m.status === 'streaming') {
    const running = [...parts].reverse().find((p) => p.type === 'tool' && p.state === 'running');
    const lastText = parts.at(-1)?.type === 'text' && parts.at(-1)?.live;
    const label = liveLabel(m) || (running ? (isTeamTool(running.name) ? t('live.team') : t('live.tool', { action: toolPhrase(running.name) })) : lastText ? '' : inGroup ? t('live.typing') : t('live.thinking'));
    if (label) views.push({ key: 'activity', signature: label, create: () => h('div', { class: 'shimmer', role: 'status' }, h('span', { class: 'shimmer-text' }, label)) });
  }
  return views;
}

/** The bubble carries the reply text and the reaction badge; the action row lives below it. */
function updateBubbleControls(bubble, m) {
  updateBubbleReactions(bubble, m);
  return bubble;
}

function eventLine(part, m) {
  const chip = (bot) => [markOf(bot, { size: 16, state: 'idle' }), h('span', { class: 'ev-name' }, bot.name)];
  const go = (chatId, ...content) => h('div', { class: 'event' }, h('button', { type: 'button', onclick: () => openChat(chatId) }, ...content));
  switch (part.kind) {
    case 'bot_created':
    case 'bot_updated': {
      const bot = botById(part.botId);
      if (!bot) return null;
      return go(`bot:${bot.id}`, part.kind === 'bot_created' ? t('event.created') : t('event.updated'), ...chip(bot));
    }
    case 'group_created':
    case 'group_updated': {
      const group = groupById(part.groupId);
      if (!group) return null;
      return go(`group:${group.id}`, part.kind === 'group_created' ? t('event.groupCreated') : t('event.groupUpdated'), groupMarkOf(group, 18), h('span', { class: 'ev-name' }, group.name));
    }
    case 'group_posted': {
      const group = groupById(part.groupId);
      if (!group) return null;
      return go(`group:${group.id}`, t('event.groupPosted'), groupMarkOf(group, 18), h('span', { class: 'ev-name' }, group.name));
    }
    case 'schedule_created': {
      const bot = botById(part.botId);
      const when = part.scheduleKind === 'once' ? t('event.scheduleOnce', { time: clockLabel(part.runAt) }) : part.scheduleKind === 'interval' ? t('event.scheduleEvery', { n: part.everyMinutes }) : t('event.scheduleDaily', { time: part.time });
      return h('div', { class: 'event' }, h('button', { type: 'button', onclick: () => openOverlay({ kind: 'settings', page: 'schedules' }) }, icon('clock', 14), t('event.scheduleCreated', { name: part.name, when, bot: bot?.name ?? 'Bot' })));
    }
    case 'helper_started':
      return h('div', { class: 'event' }, icon('clock', 14), t('event.helperStarted', { title: part.title ?? '' }));
    case 'schedule_deleted':
      return h('div', { class: 'event' }, icon('clock', 14), t('event.scheduleDeleted', { name: part.name }));
    case 'bot_deleted':
      return h('div', { class: 'event' }, t('event.deleted', { name: part.name }));
    case 'group_deleted':
      return h('div', { class: 'event' }, t('event.groupDeleted', { name: part.name }));
    case 'asked': {
      const bot = botById(part.botId);
      if (!bot) return null;
      return h('div', { class: 'event' }, h('button', { type: 'button', title: part.reply ?? '', onclick: () => openChat(`bot:${bot.id}`) }, t('event.asked'), ...chip(bot), h('span', null, part.waiting ? t('event.askedWaiting') : t('event.askedDone'))));
    }
    case 'memory': {
      const self = botById(m.botId);
      const label = part.scope === 'team' ? t('event.teamMemory') : part.scope === self?.id ? t('event.memory') : t('event.otherMemory', { name: botById(part.scope)?.name ?? 'Bot' });
      return h(
        'div',
        { class: 'event' },
        h(
          'button',
          {
            type: 'button',
            title: `${part.removed ? t('event.memoryRemoved') : ''}${part.text ?? ''}`,
            onclick: () => {
              const scopeBot = part.scope === 'team' ? self : botById(part.scope) ?? self;
              if (scopeBot && `bot:${scopeBot.id}` !== state.current) openChat(`bot:${scopeBot.id}`);
              state.drawer = { ...state.drawer, open: true, view: 'memory', memTab: part.scope === 'team' ? 'team' : 'self' };
              renderDrawer();
              renderPill();
            },
          },
          icon('memory', 14),
          label,
        ),
      );
    }
    default:
      return null;
  }
}

function botMessage(m, existing) {
  const bot = botById(m.botId);
  const name = bot?.name ?? t('bot.deleted');
  const inGroup = m.chatId.startsWith('group:');
  if (m.status === 'pass') return h('div', { class: 'event' }, t('event.pass', { name }));
  const views = partViews(m, inGroup);
  const notes = [];
  if (m.status === 'error') {
    notes.push(
      h(
        'div',
        { class: 'note turn-failed', role: 'status' },
        h('span', null, t('execution.turnFailed')),
        h('button', { type: 'button', class: 'soft', onclick: () => openExecutionRecords(m.id) }, t('execution.details')),
        m.retryable
          ? h(
              'button',
              {
                type: 'button',
                class: 'btn sm',
                onclick: guard(async (e) => {
                  /** @type {HTMLButtonElement} */ (e.currentTarget).disabled = true;
                  await api('POST', `/api/chats/${m.chatId}/messages/${m.id}/retry`);
                }),
              },
              t('note.retry'),
            )
          : null,
      ),
    );
  }
  const memoryFailures = unresolvedMemoryFailures(m);
  if (memoryFailures.length) notes.push(h('div', { class: 'note turn-failed', role: 'status' },
    h('span', null, t('execution.memoryUnconfirmed')),
    h('button', { type: 'button', class: 'soft', onclick: () => openExecutionRecords(m.id) }, t('execution.details')),
    h('button', { type: 'button', class: 'soft', onclick: () => openOverlay({ kind: 'settings', page: 'memory', scope: memoryFailures[0].issue?.scope ?? m.botId }) }, t('event.manageMemory')),
  ));
  if (m.status === 'aborted') notes.push(h('p', { class: 'note warn' }, t('note.aborted')));
  if (m.status === 'interrupted') notes.push(h('p', { class: 'note warn' }, t('note.interrupted')));
  if (m.status === 'done' && !m.text && !m.question && !(m.parts ?? []).some((p) => p.type === 'event')) {
    notes.push(h('p', { class: 'note' }, t('note.empty')));
  }
  notes.forEach((node, index) => views.push({ key: `note:${index}`, signature: node.outerHTML, create: () => node }));
  if (m.question) views.push({ key: 'question', signature: JSON.stringify([m.question, m.answering, locale()]), create: () => questionCard(m) });
  if (m.answerSummary?.length) views.push({ key: 'answers', signature: JSON.stringify(m.answerSummary), create: () => h('dl', { class: 'answered' }, m.answerSummary.map((a) => [h('dt', null, a.question), h('dd', null, a.answer)])) });
  // The action row hangs below the reply, at its bottom-left. Anchoring it to the bubble's
  // top pushed the buttons off-screen as soon as the reply grew past the viewport.
  if (m.status !== 'streaming') views.push({ key: 'tools', signature: JSON.stringify([displayText(m), m.sessionId, name, locale()]), create: () => msgTools(displayText(m), m) });
  const compatible = existing?.matches(inGroup ? 'article.gmsg' : 'article.msg');
  const article = compatible ? existing : h('article', { class: inGroup ? 'gmsg' : 'msg' });
  article.setAttribute('aria-label', t('a11y.reply', { name }));
  let content = article.querySelector('.bubble-wrap');
  if (!content) {
    content = h('div', { class: 'bubble-wrap' });
    article.append(inGroup ? h('div', { class: 'gmsg-body' }, content) : content);
  }
  if (inGroup) {
    const group = groupById(m.chatId.slice(6));
    const signature = JSON.stringify([name, bot?.color, bot?.skin, bot?.avatar, group?.adminId, locale()]);
    const oldHead = article.querySelector('.gmsg-head');
    if (oldHead?.dataset.signature !== signature) {
      const head = h('div', { class: 'gmsg-head', dataset: { signature } },
        h('button', { type: 'button', class: 'gmsg-who', 'aria-label': t('a11y.openDm', { name }), title: t('a11y.openDm', { name }), onclick: () => bot && openChat(`bot:${bot.id}`), style: { color: bot ? inkOf(bot.color) : 'var(--muted)' } }, markOf(bot, { size: 24, chatId: m.chatId }), h('span', { class: 'gmsg-name' }, name)),
        group?.adminId === m.botId ? h('span', { class: 'chip' }, t('group.admin')) : null);
      if (oldHead) oldHead.replaceWith(head);
      else article.prepend(head);
    }
  }
  reconcileChildren(content, views);
  closeDetachedReactionPicker();
  return article;
}

function msgTools(text, m) {
  const copyBtn = h('button', {
    type: 'button',
    class: 'tool-btn',
    title: t('msg.copy'),
    'aria-label': t('msg.copy'),
    onclick: guard(async () => {
      if (await copyText(text)) {
        copyBtn.replaceChildren(icon('check', 15));
        setTimeout(() => copyBtn.replaceChildren(icon('copy', 15)), 1200);
      }
    }),
  }, icon('copy', 15));
  const bot = m ? botById(m.botId) : undefined;
  return h(
    'div',
    { class: 'msg-tools' },
    m ? reactionButton(m) : null,
    text ? copyBtn : null,
    m && text
      ? h('button', {
          type: 'button',
          class: 'tool-btn',
          title: t('msg.quote'),
          'aria-label': t('msg.quote'),
          onclick: () => {
            state.quote = { text, name: bot?.name ?? 'Bot' };
            renderQuoting();
            ui.input.focus();
          },
        }, icon('reply', 15))
      : null,
    m?.sessionId && canOpenSession()
      ? h('button', { type: 'button', class: 'tool-btn', title: t('msg.openSession'), 'aria-label': t('msg.openSessionLabel'), onclick: () => openSession(m.sessionId) }, icon('panel', 15))
      : null,
  );
}

function questionCard(m) {
  const request = m.question.request ?? {};
  const bot = botById(m.botId);
  const form = /** @type {HTMLFormElement} */ (h('form', { class: 'card qcard', 'aria-label': request.title ?? t('question.label', { name: bot?.name ?? 'Bot' }) }));
  if (request.title) form.append(h('strong', null, request.title));
  // The Host freezes the Plan under modePayload.planReview; keep reading the flat field too.
  const planMarkdown = request.modePayload?.planReview?.markdown ?? request.modePayload?.markdown;
  if (m.question.mode === 'plan' && planMarkdown) form.append(h('div', { class: 'plan-body' }, markdownNode(String(planMarkdown))));
  for (const step of request.steps ?? []) {
    const type = step.selectionMode === 'multiple' ? 'checkbox' : 'radio';
    const fs = h('fieldset', { dataset: { step: step.id } }, h('legend', null, step.question));
    if (step.description) fs.append(h('p', { class: 'hint' }, step.description));
    for (const option of step.options ?? []) {
      fs.append(
        h('label', { class: 'qopt' }, h('input', { type, name: `q-${m.id}-${step.id}`, value: option.id }), h('span', null, option.label, option.description ? h('small', null, option.description) : null)),
      );
    }
    const otherInput = /** @type {HTMLInputElement} */ (
      h('input', { class: 'input', type: 'text', name: `other-${step.id}`, placeholder: t('question.other'), 'aria-label': t('question.otherLabel', { question: step.question }) })
    );
    fs.append(otherInput);
    if (type === 'radio') {
      // The Host rejects a single-choice answer that has both an option and "other" text, and a
      // checked radio cannot be unchecked, so the two replace each other as the user goes.
      otherInput.addEventListener('input', () => {
        if (!otherInput.value.trim()) return;
        for (const radio of fs.querySelectorAll('input[type="radio"]')) /** @type {HTMLInputElement} */ (radio).checked = false;
      });
      fs.addEventListener('change', (event) => {
        if (/** @type {HTMLInputElement} */ (event.target).type === 'radio') otherInput.value = '';
      });
    }
    form.append(fs);
  }
  const submitBtn = h('button', { type: 'submit', class: 'btn primary' }, m.answering ? t('question.submitting') : t('question.submit'));
  if (m.answering) {
    // The Host has not settled this answer yet; the card unlocks again if it is rejected.
    submitBtn.setAttribute('disabled', '');
    for (const input of form.querySelectorAll('input')) input.setAttribute('disabled', '');
  }
  form.append(h('div', { class: 'row-end' }, submitBtn));
  form.addEventListener(
    'submit',
    guard(async (event) => {
      event.preventDefault();
      const answers = [];
      for (const fs of form.querySelectorAll('fieldset[data-step]')) {
        const stepId = /** @type {HTMLElement} */ (fs).dataset.step;
        const other = /** @type {HTMLInputElement} */ (fs.querySelector(`input[name="other-${stepId}"]`)).value.trim();
        const single = Boolean(fs.querySelector('input[type="radio"]'));
        // Single choice: the typed answer wins over a radio left checked (see the listeners above).
        const selected = single && other ? [] : [...fs.querySelectorAll('input:checked')].map((i) => /** @type {HTMLInputElement} */ (i).value);
        if (!selected.length && !other) throw new Error(t('question.required'));
        answers.push({ stepId, selectedOptionIds: selected, selectedOther: Boolean(other), ...(other ? { otherText: other } : {}) });
      }
      submitBtn.setAttribute('disabled', '');
      try {
        await api('POST', `/api/chats/${m.chatId}/messages/${m.id}/answer`, { answers });
      } catch (error) {
        submitBtn.removeAttribute('disabled');
        throw error;
      }
    }),
  );
  return form;
}

/** Elapsed time of a helper, e.g. "3 min", for the strip above the composer. */
function helperElapsed(helper) {
  const minutes = Math.floor((Date.now() - (helper.startedAt ?? helper.createdAt)) / 60000);
  return minutes < 1 ? t('helper.justStarted') : t('helper.minutes', { n: minutes });
}

/** The phase a helper is in. The rows are ordered by it: what runs, then what waits, then the queue. */
function helperPhase(helper) {
  if (helper.status === 'waiting_for_tasks') return 'waiting';
  if (helper.status === 'queued') return 'queued';
  return 'running';
}

const HELPER_PHASE_ORDER = { running: 0, waiting: 1, queued: 2 };
/** How many queued tasks stay visible before the queue folds into one line. */
const HELPER_QUEUE_PREVIEW = 3;
let helpersExpanded = false;

/** Background helpers working for this chat: the task on top, its owner and state below. */
function renderHelpers() {
  if (!ui.helpers) return;
  const items = [...state.helpers, ...state.tasks]
    .filter((x) => [x.chatId, x.originChatId, x.resultChatId].includes(mounted) && ['queued', 'running', 'waiting_for_tasks'].includes(x.status))
    .sort((a, b) => HELPER_PHASE_ORDER[helperPhase(a)] - HELPER_PHASE_ORDER[helperPhase(b)]);
  const queued = items.filter((x) => x.status === 'queued');
  const shown = helpersExpanded ? queued : queued.slice(0, HELPER_QUEUE_PREVIEW);
  const hidden = queued.length - shown.length;
  ui.helpers.replaceChildren(
    ...[...items.filter((x) => x.status !== 'queued'), ...shown].map((helper) => {
      const bot = botById(helper.botId);
      const phase = helperPhase(helper);
      return h(
        'div',
        { class: `helper-row is-${phase}`, title: helper.task },
        h('span', { class: 'helper-dot', 'aria-hidden': 'true' }),
        h(
          'span',
          { class: 'helper-main' },
          h('span', { class: 'helper-title' }, helper.title || helper.task || ''),
          h(
            'span',
            { class: 'helper-meta' },
            h('span', { class: 'helper-who' }, bot?.name ?? 'Bot'),
            h('span', { class: 'helper-state' }, t(`helper.state.${phase}`)),
            helper.status === 'queued' ? null : h('span', { class: 'helper-time' }, helperElapsed(helper)),
          ),
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'helper-stop',
            title: t('helper.stop'),
            'aria-label': t('helper.stop'),
            onclick: guard(async () => {
              await api('POST', `/api/${helper.batchId ? 'tasks' : 'helpers'}/${helper.id}/stop`);
            }),
          },
          t('helper.stop'),
        ),
      );
    }),
    hidden > 0 || (helpersExpanded && queued.length > HELPER_QUEUE_PREVIEW)
      ? h(
          'button',
          {
            type: 'button',
            class: 'helper-more soft',
            'aria-expanded': String(helpersExpanded),
            onclick: () => {
              helpersExpanded = !helpersExpanded;
              renderHelpers();
            },
          },
          hidden > 0 ? t('helper.more', { n: hidden }) : t('helper.collapse'),
        )
      : null,
  );
}
setInterval(() => {
  if (mounted && state.helpers.some((x) => x.chatId === mounted && x.status === 'running')) renderHelpers();
}, 30000);

function renderApprovals() {
  const items = [...state.approvals.values()].filter((a) => a.chatId === mounted);
  ui.approvals.replaceChildren(
    ...items.map((approval) => {
      const bot = botById(approval.botId);
      const decide = (decision) =>
        guard(async () => {
          await api('POST', `/api/approvals/${encodeURIComponent(approval.requestId)}`, { decision });
          state.approvals.delete(approval.requestId);
          renderApprovals();
        });
      return h(
        'div',
        { class: 'card approval', role: 'alertdialog', 'aria-label': t('approval.title', { name: bot?.name ?? 'Bot', tool: approval.toolName }) },
        markOf(bot, { size: 30, state: 'alert' }),
        h(
          'div',
          { class: 'approval-body' },
          h('strong', null, t(approval.helperTitle ? 'approval.helperTitle' : 'approval.title', { name: bot?.name ?? 'Bot', tool: approval.toolName, title: approval.helperTitle })),
          approval.reason ? h('p', { class: 'hint' }, approval.reason) : null,
          approval.toolInput ? h('pre', null, approval.toolInput) : null,
          h('div', { class: 'row-end' }, h('button', { type: 'button', class: 'btn', onclick: decide('deny') }, t('approval.deny')), h('button', { type: 'button', class: 'btn primary', onclick: decide('allowOnce') }, t('approval.allowOnce'))),
        ),
      );
    }),
  );
}

// ================================================================== composer
function autosize() {
  if (!ui.input) return;
  ui.input.style.height = 'auto';
  ui.input.style.height = `${Math.min(220, ui.input.scrollHeight)}px`;
  syncSend();
}

function syncSend() {
  if (!ui.send) return;
  const busy = state.busy.has(mounted);
  const files = filesOf(mounted);
  const uploading = files.some((f) => f.status === 'uploading');
  const empty = !ui.input.value.trim() && !files.some((f) => f.status === 'done');
  const stop = busy && empty && !uploading;
  ui.send.classList.toggle('stop', stop);
  ui.send.setAttribute('aria-label', stop ? t('compose.stop') : t('compose.send'));
  ui.send.title = stop ? t('compose.stop') : t('compose.send');
  ui.send.replaceChildren(icon(stop ? 'stop' : 'up', 18));
  /** @type {HTMLButtonElement} */ (ui.send).disabled = (!stop && empty) || uploading || Boolean(submissions.get(mounted)?.inFlight);
}

function renderQuoting() {
  if (!ui.quoting) return;
  if (!state.quote) {
    ui.quoting.hidden = true;
    return;
  }
  ui.quoting.hidden = false;
  ui.quoting.replaceChildren(
    icon('reply', 14),
    h('span', null, t('compose.quoting', { name: state.quote.name, text: state.quote.text.replace(/\s+/g, ' ').slice(0, 80) })),
    h('button', { type: 'button', class: 'tool-btn', 'aria-label': t('compose.cancelQuote'), onclick: () => { state.quote = null; renderQuoting(); } }, icon('close', 13)),
  );
}

async function submit() {
  const chatId = mounted;
  if (!chatId || submissions.get(chatId)?.inFlight) return;
  const raw = ui.input.value.trim();
  const files = filesOf(chatId);
  if (files.some((f) => f.status === 'uploading')) return;
  const ready = files.filter((f) => f.status === 'done');
  if (!raw && !ready.length) {
    if (state.busy.has(chatId)) await guard(() => api('POST', `/api/chats/${chatId}/cancel`))();
    return;
  }
  const quote = state.quote;
  const quoted = quote ? `> ${t('compose.quotePrefix', { name: quote.name })}${quote.text.replace(/\n+/g, ' ').slice(0, 400)}\n\n` : '';
  const body = { text: quoted + raw, ...(ready.length ? { attachments: ready.map((f) => f.id) } : {}) };
  const fingerprint = JSON.stringify(body);
  const previous = submissions.get(chatId);
  // An HTTP failure can happen after the server accepted the message. Retrying the same
  // submission keeps its ID; editing the message creates a new submission.
  const submission = previous?.fingerprint === fingerprint ? previous : {
    fingerprint,
    clientMessageId: globalThis.crypto?.randomUUID?.() ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };
  submission.inFlight = true;
  submissions.set(chatId, submission);
  ui.send.setAttribute('disabled', '');
  // The request may settle after the user has switched chats or typed on: only clear what
  // still belongs to this send.
  const stillHere = () => mounted === chatId && ui.input;
  try {
    const result = await api('POST', `/api/chats/${chatId}/messages`, { ...body, clientMessageId: submission.clientMessageId });
    if (result.message?.id && result.message.chatId === chatId) upsertMessage(cacheMessage(result.message));
    submissions.delete(chatId);
    // A file added while the POST was pending belongs to the next send.
    const sentKeys = new Set(ready.map((file) => file.key));
    for (const f of ready) if (f.preview) URL.revokeObjectURL(f.preview);
    pendingFiles.set(chatId, filesOf(chatId).filter((file) => !sentKeys.has(file.key)));
    if (mounted === chatId) renderAttachBar();
    if (stillHere()) {
      if (ui.input.value.trim() === raw) {
        ui.input.value = '';
        autosize();
      }
      if (state.quote === quote) state.quote = null;
      renderQuoting();
      scrollBottom();
    }
    if ((drafts.get(chatId) ?? '').trim() === raw) drafts.delete(chatId);
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    submission.inFlight = false;
    syncSend();
  }
}

function wireComposer(chatId) {
  const input = ui.input;
  const pop = ui.mention;
  const target = targetOf(chatId);
  let composing = false;
  let index = 0;
  /** @type {any[]} */
  let candidates = [];
  const close = () => {
    pop.hidden = true;
    candidates = [];
    input.removeAttribute('aria-activedescendant');
  };
  const query = () => {
    const before = input.value.slice(0, input.selectionStart ?? input.value.length);
    const match = /(?:^|\s)@([^\s@]*)$/.exec(before);
    return match ? match[1] : null;
  };
  const show = () => {
    if (target.kind !== 'group' || !target.group) return;
    const q = query();
    if (q === null) return close();
    candidates = target.group.memberIds.map(botById).filter((b) => b && b.name.toLowerCase().includes(q.toLowerCase()));
    if (!candidates.length) return close();
    index = Math.min(index, candidates.length - 1);
    pop.replaceChildren(
      ...candidates.map((bot, i) =>
        h(
          'li',
          { id: `mention-${bot.id}`, role: 'option', 'aria-selected': i === index ? 'true' : 'false', onmousedown: (e) => { e.preventDefault(); pick(bot); } },
          markOf(bot, { size: 22, state: 'idle' }),
          h('span', null, bot.name),
          target.group.adminId === bot.id ? h('span', { class: 'chip' }, t('group.admin')) : h('small', null, bot.role),
        ),
      ),
    );
    pop.hidden = false;
    input.setAttribute('aria-activedescendant', `mention-${candidates[index].id}`);
  };
  const pick = (bot) => {
    const pos = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, pos).replace(/@([^\s@]*)$/, `@${bot.name} `);
    input.value = before + input.value.slice(pos);
    input.setSelectionRange(before.length, before.length);
    close();
    autosize();
  };
  input.addEventListener('compositionstart', () => (composing = true));
  input.addEventListener('compositionend', () => (composing = false));
  input.addEventListener('input', () => {
    drafts.set(chatId, input.value);
    autosize();
    show();
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (event) => {
    if (!pop.hidden && candidates.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        index = (index + (event.key === 'ArrowDown' ? 1 : -1) + candidates.length) % candidates.length;
        show();
        return;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && !composing) {
        event.preventDefault();
        pick(candidates[index]);
        return;
      }
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !composing && !event.isComposing) {
      event.preventDefault();
      void submit();
    }
  });
}

// ================================================================== live updates
let source;
let connectionRevision = 0;
let reconnectTimer = 0;
let reloadTimer = 0;

function renderConnection() {
  const banner = document.getElementById('connection-status');
  if (!banner) return;
  const status = state.connection.status;
  banner.dataset.state = status;
  banner.hidden = status === 'connected';
  banner.textContent = status === 'connected' ? '' : t(`connection.${status}`);
}

function connectionStatus(status) {
  state.connection.status = status;
  if (status === 'connected') state.connection.lastConnectedAt = Date.now();
  renderConnection();
}

async function refreshConnection(revision) {
  try {
    await loadState();
    if (revision !== connectionRevision) return;
    const chatId = state.current;
    const visibleCount = state.messages.get(chatId)?.length ?? 200;
    clearMessages();
    let messages = chatId ? await loadMessages(chatId) : [];
    // Restore the history window the user had expanded before the interruption. Re-read
    // pages instead of retaining stale rows, since a reset may have happened while offline.
    while (revision === connectionRevision && messages.length < visibleCount && state.messagePages.get(chatId)?.hasMore) {
      const before = state.messagePages.get(chatId)?.nextBefore;
      messages = await loadEarlierMessages(chatId);
      if (state.messagePages.get(chatId)?.hasMore && state.messagePages.get(chatId)?.nextBefore === before) throw new Error('history_page_not_advanced');
    }
    if (revision !== connectionRevision) return;
    // Reconcile the visible conversation in place. Drafts, questionnaire answers, selection
    // and media are owned by the page, and a transient transport failure must not reset them.
    saveDraft();
    if (mounted === chatId && renderedLocale === locale()) {
      renderFeed(messages, nearBottom());
      renderSidebar();
      refreshChrome();
      if (!state.drawer.dirty) renderDrawer();
      if (state.overlay?.kind === 'settings') renderOverlay({ preserveEdits: true });
    } else renderAll();
    connectionStatus('connected');
  } catch {
    if (revision !== connectionRevision) return;
    connectionStatus(navigator.onLine === false ? 'offline' : 'reconnecting');
    reconnectTimer = window.setTimeout(() => void refreshConnection(revision), 2000);
  }
}

function connect() {
  source?.close();
  clearTimeout(reconnectTimer);
  connectionStatus(navigator.onLine === false ? 'offline' : 'connecting');
  source = new EventSource('/api/events');
  source.onmessage = (event) => {
    try {
      handleEvent(JSON.parse(event.data));
    } catch {
      /* ignore malformed frames */
    }
  };
  source.onopen = () => {
    clearTimeout(reconnectTimer);
    void refreshConnection(++connectionRevision);
  };
  source.onerror = () => {
    connectionRevision++;
    clearTimeout(reconnectTimer);
    connectionStatus(navigator.onLine === false ? 'offline' : 'reconnecting');
  };
}

function handleEvent(event) {
  switch (event.type) {
    case 'message.reactions':
      applyReactionUpdate(event);
      break;
    case 'message.upsert': {
      upsertMessage(cacheMessage(event.message));
      break;
    }
    case 'chat.summary':
      state.chats[event.chatId] = event.summary;
      if (event.chatId === state.current) markRead(event.chatId);
      renderSidebar();
      break;
    case 'chat.busy':
      if (event.busy) state.busy.add(event.chatId);
      else state.busy.delete(event.chatId);
      if (event.turns) state.turns = event.turns;
      renderSidebar();
      if (mounted) {
        renderPill();
        syncSend();
      }
      if (state.drawer.open && state.drawer.view === 'overview') nav.renderDrawer();
      break;
    case 'tasks.changed':
      state.tasks = event.tasks ?? [];
      if (mounted) renderHelpers();
      if (state.overlay?.kind === 'settings' && state.overlay.page === 'tasks') renderOverlay({ preserveEdits: true });
      break;
    case 'helpers.changed':
      state.helpers = event.helpers ?? [];
      if (mounted) renderHelpers();
      if (state.overlay?.kind === 'settings' && state.overlay.page === 'tasks') renderOverlay({ preserveEdits: true });
      break;
    case 'approval.added':
      state.approvals.set(event.approval.requestId, event.approval);
      if (mounted === event.approval.chatId) renderApprovals();
      else toast(t('approval.toast', { name: botById(event.approval.botId)?.name ?? 'Bot' }));
      if (state.overlay?.kind === 'settings' && state.overlay.page === 'tasks') renderOverlay({ preserveEdits: true });
      break;
    case 'approval.removed':
      state.approvals.delete(event.requestId);
      if (mounted) renderApprovals();
      if (state.overlay?.kind === 'settings' && state.overlay.page === 'tasks') renderOverlay({ preserveEdits: true });
      break;
    case 'chat.reset':
      clearMessages(event.chatId);
      state.messages.set(event.chatId, []);
      state.messagePages.set(event.chatId, { loaded: true, hasMore: false, nextBefore: null });
      if (mounted === event.chatId) { mountRevision++; renderFeed([]); }
      break;
    case 'memory.changed': {
      const chatId = event.scope === 'team' ? state.current : `bot:${event.scope}`;
      if (chatId === state.current && !(state.drawer.open && state.drawer.view === 'memory')) {
        state.memoryNotice = { chatId, until: Date.now() + 6000 };
        if (mounted) renderPill();
        setTimeout(() => mounted && renderPill(), 6100);
      }
      if (state.drawer.open) nav.renderDrawer();
      if (state.overlay?.kind === 'settings') renderOverlay({ preserveEdits: true });
      break;
    }
    case 'state.changed':
      clearTimeout(reloadTimer);
      reloadTimer = window.setTimeout(guard(async () => {
        await loadState();
        renderSidebar();
        if (mounted && mounted !== state.current) mounted = '';
        renderMain();
        if (!state.drawer.dirty) renderDrawer();
        if (state.overlay?.kind === 'settings') renderOverlay({ preserveEdits: true });
        if (mounted) {
          // Names and colors may have changed; refresh rendered messages.
          const list = state.messages.get(mounted);
          if (list) renderFeed(list, nearBottom());
        }
      }), 150);
      break;
    case 'usage.changed':
      if (state.overlay?.kind === 'settings' && state.overlay.page === 'usage') renderOverlay({ preserveEdits: true });
      break;
    default:
      break;
  }
}

// ================================================================== boot
function wireChrome() {
  /** @type {HTMLElement} */ (document.getElementById('search-btn')).addEventListener('click', () => openOverlay({ kind: 'palette', mode: 'search' }));
  /** @type {HTMLElement} */ (document.getElementById('new-btn')).addEventListener('click', () => openOverlay({ kind: 'palette', mode: 'new' }));
  /** @type {HTMLElement} */ (document.getElementById('me-btn')).addEventListener('click', () => openOverlay({ kind: 'settings', page: 'general' }));
  document.getElementById('tasks-btn')?.addEventListener('click', () => openOverlay({ kind: 'settings', page: 'tasks' }));
  window.addEventListener('offline', () => connectionStatus('offline'));
  window.addEventListener('online', () => {
    connectionStatus('reconnecting');
    if (source?.readyState === 1) void refreshConnection(++connectionRevision);
  });
  const side = /** @type {HTMLElement} */ (document.getElementById('side'));
  side.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.key.length !== 1 || event.key === ' ' || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
    if (event.target instanceof Element && event.target.closest('input,textarea')) return;
    event.preventDefault();
    openOverlay({ kind: 'palette', mode: 'search', query: event.key });
  });
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openOverlay({ kind: 'palette', mode: 'search' });
    }
  });
  wireOverlayKeys();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyAppearance);
}

async function boot() {
  installOctopusDefs();
  applyAppearance();
  const brand = document.getElementById('brand-mark');
  brand?.replaceWith(botMark({ skin: 'fuzzy' }, { size: 24 }));
  Object.assign(nav, { openChat, revealMessage, loadEarlier, renderAll, renderSidebar, renderDrawer, renderOverlay, refreshChrome, setDraft: (text) => { if (ui.input) { ui.input.value = text; autosize(); } } });
  translateDom();
  wireChrome();
  try {
    // Before the first state load, so the server resolves `auto` to this OS language.
    await reportSystemLocale().catch(() => undefined);
    await loadState();
  } catch (error) {
    main.replaceChildren(h('p', { class: 'loading', role: 'alert' }, t('boot.failed', { error: error instanceof Error ? error.message : String(error) })));
    return;
  }
  if (!state.agentAvailable) toast(t('boot.noAgent'), 'error');
  markRead(state.current);
  renderAll();
  connect();
}

void boot();
