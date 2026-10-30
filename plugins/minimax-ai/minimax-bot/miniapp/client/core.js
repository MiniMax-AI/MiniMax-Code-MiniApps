// @ts-check
// Shared state, API, icons and helpers for the MiniMax Bot client.
import { PALETTES, botMark, groupMark, inkOf } from './octopus.js';
import { localeTag, setLocale, systemLocale, t } from './i18n.js';

export { t };

/** @typedef {import('./client-api.js').McodeClientAPI} McodeClientAPI */

// ------------------------------------------------------------------ prefs (view preferences only)
const PREF_KEY = 'minimax-bot.prefs.v1';
export const prefs = (() => {
  const base = { theme: 'system', accent: 'ocean', motion: 'normal', lastRead: {}, lastChat: '' };
  try {
    return { ...base, ...JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') };
  } catch {
    return base;
  }
})();
export function savePrefs() {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable */
  }
}

export function applyAppearance() {
  const root = document.documentElement;
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = prefs.theme === 'system' ? (dark ? 'dark' : 'light') : prefs.theme;
  root.dataset.motion = prefs.motion;
  root.style.setProperty('--accent', inkOf(PALETTES[prefs.accent] ? prefs.accent : 'ocean'));
}

// ------------------------------------------------------------------ state
export const state = {
  /** @type {any[]} */ bots: [],
  /** @type {any[]} */ groups: [],
  /** @type {any[]} */ schedules: [],
  /** @type {any[]} */ helpers: [],
  /** @type {any[]} */ tasks: [],
  /** @type {Set<string>} */ busy: new Set(),
  /** @type {{ chatId: string, botId: string }[]} */ turns: [],
  /** @type {Record<string, any>} */ chats: {},
  /** @type {Map<string, any>} */ approvals: new Map(),
  /** @type {Record<string, Record<string, string | null>>} */ sessions: {},
  agentAvailable: true,
  current: '',
  /** @type {Map<string, any[]>} */ messages: new Map(),
  /** @type {Map<string, { hasMore: boolean, nextBefore: string | null, loaded: boolean }>} */ messagePages: new Map(),
  connection: { status: 'connecting', lastConnectedAt: 0 },
  drawer: { open: false, view: 'overview', memTab: 'self', dirty: false },
  /** @type {null | Record<string, any>} */ overlay: null,
  /** @type {{ chatId: string, until: number } | null} */ memoryNotice: null,
  /** @type {null | { text: string, name: string }} */ quote: null,
  /** Server-owned preference; `auto` follows the operating system. */
  settings: { language: 'auto', userName: '' },
  /** `name` shown on the avatar (setting, else the OS account name); `systemName` is the OS one. */
  user: { name: '', systemName: '' },
  /** Effective language resolved by the server. */
  locale: systemLocale(),
  /** Limits the server applies to a group note; `null` until the server states them. */
  /** @type {{ entries: number, chars: number } | null} */
  noteLimits: null,
};

/** Navigation callbacks registered by app.js so panels can drive the main view. */
export const nav = {
  /** @type {(chatId: string) => void} */ openChat: () => {},
  /** @type {(chatId: string, messageId: string) => Promise<void>} */ revealMessage: async () => {},
  /** @type {(chatId: string) => Promise<void>} */ loadEarlier: async () => {},
  /** @type {() => void} */ renderAll: () => {},
  /** @type {() => void} */ renderSidebar: () => {},
  /** @type {() => void} */ renderDrawer: () => {},
  /** @type {() => void} */ renderOverlay: () => {},
  /** @type {() => void} */ refreshChrome: () => {},
  /** @type {(text: string) => void} */ setDraft: () => {},
};

// ------------------------------------------------------------------ dom helpers
/**
 * @param {string} tag
 * @param {Record<string, any> | null} [attrs]
 * @param {...any} children
 * @returns {HTMLElement}
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'html') el.innerHTML = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const ICONS = {
  smile: '<circle cx="12" cy="12" r="8"/><path d="M8 13a4 4 0 0 0 8 0M9 8.5v1M15 8.5v1"/>',
  hand: '<path d="M8 13V5a1.5 1.5 0 0 1 3 0v6-8a1.5 1.5 0 0 1 3 0v8-6a1.5 1.5 0 0 1 3 0v7-4a1.5 1.5 0 0 1 3 0v6a7 7 0 0 1-12 5l-4-5a1.5 1.5 0 0 1 2-2z"/>',
  heart: '<path d="M20 5.5c-2-2-5-1.5-8 1-3-2.5-6-3-8-1s-2 5 0 7l8 8 8-8c2-2 2-5 0-7z"/>',
  reaction: '<circle cx="11" cy="11" r="8"/><path d="M7.5 12.5a4 4 0 0 0 7 0M8 8.5v1M14 8.5v1M19 16v6M16 19h6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  share: '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2.2" fill="currentColor" stroke="none"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  reply: '<path d="M10 8L5 12.5 10 17"/><path d="M5 12.5h9a5 5 0 0 1 5 5V19"/>',
  panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M14.5 4.5v15"/>',
  memory: '<path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10.5a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5z"/><path d="M9.5 12h5M9.5 15.5h5"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4.2l2.8 1.8"/>',
  gauge: '<path d="M4.5 16.5a8 8 0 1 1 15 0"/><path d="M12 13l3.5-3.5"/>',
  users: '<circle cx="9" cy="9" r="3.2"/><path d="M3.5 19c.4-3 2.8-5 5.5-5s5.1 2 5.5 5"/><circle cx="17" cy="9.5" r="2.5"/><path d="M16 14.2c2.4-.2 4.2 1.6 4.5 4.3"/>',
  chat: '<path d="M5 18.5V7a2.5 2.5 0 0 1 2.5-2.5h9A2.5 2.5 0 0 1 19 7v6.5a2.5 2.5 0 0 1-2.5 2.5H9z"/>',
  chats: '<path d="M5 18.5V7a2.5 2.5 0 0 1 2.5-2.5h9A2.5 2.5 0 0 1 19 7v6.5a2.5 2.5 0 0 1-2.5 2.5H9z"/><path d="M9 10.5h.01M12 10.5h.01M15 10.5h.01" stroke-width="2.2"/>',
  unread: '<path d="M19 12v1.5a2.5 2.5 0 0 1-2.5 2.5H9l-4 2.5V7a2.5 2.5 0 0 1 2.5-2.5H13"/><circle cx="18" cy="6" r="2.6" fill="currentColor" stroke="none"/>',
  person: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5.5 19.5c.5-3.6 3.2-6 6.5-6s6 2.4 6.5 6"/>',
  sliders: '<path d="M5 7h9M18 7h1M5 17h3M12 17h7"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  pin: '<path d="M9 4h6l-1 5 3 3H7l3-3zM12 12v8"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5"/>',
  clip: '<path d="M20.5 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9"/>',
  file: '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5"/>',
  eraser: '<path d="M4 20h16M7.5 15.5l8-8 4 4-8 8h-4z"/>',
  edit: '<path d="M4.5 19.5l1-4.2L15.8 5a1.8 1.8 0 0 1 2.6 0l.6.6a1.8 1.8 0 0 1 0 2.6L8.7 18.5z"/>',
  bot: '<rect x="4.5" y="7.5" width="15" height="11" rx="3"/><path d="M12 3.5v4M9.5 12.5h.01M14.5 12.5h.01"/>',
};

/** @param {keyof typeof ICONS} name */
export function icon(name, size = 18) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(size));
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', 'currentColor');
  el.setAttribute('stroke-width', '1.8');
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = ICONS[name] ?? '';
  return /** @type {any} */ (el);
}

// ------------------------------------------------------------------ format
const pad = (n) => String(n).padStart(2, '0');
export function clockLabel(ts) {
  const d = new Date(ts);
  const now = new Date();
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return t('time.today', { time: hm });
  if (diff === 1) return t('time.yesterday', { time: hm });
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = new Intl.DateTimeFormat(localeTag(), sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' }).format(d);
  return sameYear ? t('time.dateTime', { date, time: hm }) : date;
}
export const fmtNum = (n) => new Intl.NumberFormat(localeTag(), { notation: (n ?? 0) >= 100000 ? 'compact' : 'standard' }).format(n ?? 0);
export function fmtDuration(ms) {
  const s = Math.round((ms ?? 0) / 1000);
  if (s < 60) return t('duration.s', { s });
  const m = Math.floor(s / 60);
  if (m < 60) return t('duration.ms', { m, s: s % 60 });
  return t('duration.hm', { h: Math.floor(m / 60), m: m % 60 });
}

// ------------------------------------------------------------------ lookups
export const botById = (id) => state.bots.find((b) => b.id === id);
export const groupById = (id) => state.groups.find((g) => g.id === id);
export const botByName = (name) => state.bots.find((b) => b.name.toLowerCase() === String(name).toLowerCase());
export function targetOf(chatId) {
  if (chatId.startsWith('bot:')) return { kind: 'bot', bot: botById(chatId.slice(4)), group: undefined };
  return { kind: 'group', bot: undefined, group: groupById(chatId.slice(6)) };
}
export const chatName = (chatId) => {
  const t = targetOf(chatId);
  return t.bot?.name ?? t.group?.name ?? '';
};
export const membersOf = (group) =>
  [group.adminId, ...group.memberIds.filter((id) => id !== group.adminId)].map(botById).filter(Boolean);
export const mainBots = () => state.bots.filter((b) => b.isMain);
export const tileBot = () => mainBots().sort((a, b) => a.createdAt - b.createdAt)[0];

/** Live state of a Bot: waiting for an answer beats working beats idle. */
export function botStateOf(botId, chatId) {
  const privateChat = `bot:${botId}`;
  if (!chatId || chatId === privateChat) {
    if (state.chats[privateChat]?.pending) return 'alert';
  }
  const working = state.turns.some((t) => t.botId === botId && (!chatId || t.chatId === chatId));
  return working ? 'working' : 'idle';
}

/** @param {any} bot @param {{ size?: number, chatId?: string, star?: boolean, label?: string, state?: string }} [opts] */
export function markOf(bot, opts = {}) {
  return botMark(bot, {
    size: opts.size ?? 28,
    state: /** @type {any} */ (opts.state ?? (bot ? botStateOf(bot.id, opts.chatId) : 'idle')),
    star: opts.star,
    label: opts.label,
  });
}
export const groupMarkOf = (group, size = 36) => groupMark(group ? membersOf(group) : [], size);
export const chatMark = (chatId, size = 28) => {
  const t = targetOf(chatId);
  return t.kind === 'bot' ? markOf(t.bot, { size, star: true }) : groupMarkOf(t.group, size);
};

export function unreadOf(chatId) {
  const summary = state.chats[chatId];
  if (!summary || chatId === state.current) return false;
  return summary.lastTs > (prefs.lastRead[chatId] ?? 0) && summary.lastRole !== 'user';
}

export function markRead(chatId) {
  const ts = state.chats[chatId]?.lastTs ?? Date.now();
  if ((prefs.lastRead[chatId] ?? 0) >= ts) return;
  prefs.lastRead[chatId] = ts;
  savePrefs();
}

export const host = () => /** @type {McodeClientAPI | undefined} */ (/** @type {any} */ (window).mcode);

// ------------------------------------------------------------------ api
export async function api(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await response.json();
  } catch {
    /* empty body */
  }
  if (!response.ok) {
    const message =
      /** @type {any} */ (data).message ?? (response.status === 401 ? t('error.sessionExpired') : t('error.requestFailed'));
    throw Object.assign(new Error(message), { status: response.status, code: /** @type {any} */ (data).code ?? /** @type {any} */ (data).error });
  }
  return /** @type {any} */ (data);
}

/**
 * The note limits as the server states them, or `null` when it does not state a usable pair:
 * the panel then says nothing at all rather than half a line.
 * @param {any} limits
 * @returns {{ entries: number, chars: number } | null}
 */
function noteLimitsOf(limits) {
  if (!limits || typeof limits !== 'object') return null;
  const { entries, chars } = limits;
  if (!Number.isFinite(entries) || !Number.isFinite(chars)) return null;
  return { entries, chars };
}

export async function loadState() {
  const data = await api('GET', '/api/state');
  state.bots = data.bots;
  state.groups = data.groups;
  state.schedules = data.schedules;
  state.helpers = data.helpers ?? [];
  state.tasks = data.tasks ?? [];
  state.busy = new Set(data.busyChats);
  state.turns = data.turns ?? [];
  state.chats = data.chats ?? {};
  state.approvals = new Map(data.approvals.map((a) => [a.requestId, a]));
  state.sessions = data.sessions;
  state.agentAvailable = data.agentAvailable;
  state.settings = data.settings ?? state.settings;
  state.user = data.user ?? state.user;
  state.locale = data.locale ?? state.locale;
  // The server owns the note limits: the panel states them instead of writing down numbers of
  // its own, which would drift from the ones the plugin actually applies.
  state.noteLimits = noteLimitsOf(data.noteLimits);
  setLocale(state.locale);
  if (!state.current || !chatExists(state.current)) {
    const remembered = prefs.lastChat && chatExists(prefs.lastChat) ? prefs.lastChat : '';
    const main = tileBot() ?? state.bots[0];
    state.current = remembered || (main ? `bot:${main.id}` : '');
  }
}

/**
 * Tell the server which language the OS prefers, so `auto` resolves the same on both sides and
 * server-written text (errors, notices, Bot context) matches the page.
 */
export async function reportSystemLocale() {
  await api('POST', '/api/locale', { system: systemLocale() });
}

/** Change the language preference (`auto`, `zh` or `en`) and redraw everything. */
export async function setLanguage(language) {
  await api('PUT', '/api/settings', { language });
  await loadState();
  nav.renderAll();
}

export const chatExists = (chatId) => Boolean(targetOf(chatId).bot ?? targetOf(chatId).group);

const messageLoads = new Map();
const messageEpochs = new Map();
const messageUpdates = new Map();
const reactionUpdates = new Map();
let updateSequence = 0;

export const messageCacheEpoch = (chatId) => messageEpochs.get(chatId) ?? 0;

/** Reaction revisions are independent of message/history snapshots, including unloaded pages. */
function mergeMessageReactions(message, remember = true) {
  const updates = reactionUpdates.get(message.chatId) ?? new Map();
  const current = updates.get(message.id);
  if (current && current.reactionsRevision > (message.reactionsRevision ?? 0)) return { ...message, ...current };
  if (remember && Number.isSafeInteger(message.reactionsRevision) && message.reactionsRevision >= 0) {
    updates.set(message.id, { userReactions: message.userReactions ?? [], reactionsRevision: message.reactionsRevision });
    reactionUpdates.set(message.chatId, updates);
  }
  return message;
}

/** Remember reactions even before their message arrives; never create an incomplete message. */
export function cacheReactionUpdate(event) {
  if (!Number.isSafeInteger(event.reactionsRevision) || event.reactionsRevision < 0 || !Array.isArray(event.userReactions)) return;
  const message = state.messages.get(event.chatId)?.find((item) => item.id === event.messageId);
  if (message) mergeMessageReactions(message);
  const updates = reactionUpdates.get(event.chatId) ?? new Map();
  if ((updates.get(event.messageId)?.reactionsRevision ?? -1) > event.reactionsRevision) return;
  const patch = { userReactions: event.userReactions, reactionsRevision: event.reactionsRevision };
  updates.set(event.messageId, patch);
  reactionUpdates.set(event.chatId, updates);
  if (message) Object.assign(message, patch);
  return message;
}

/** Store a live update even while the first history request is still on its way. */
export function cacheMessage(message) {
  const chatId = message.chatId;
  const list = state.messages.get(chatId) ?? [];
  const index = list.findIndex((item) => item.id === message.id);
  if (index >= 0) {
    mergeMessageReactions(list[index]);
    const previous = list[index];
    // The POST receipt can arrive after a newer SSE delivery update.
    if (message.role === 'user' && (previous.dispatchRevision ?? 0) > (message.dispatchRevision ?? 0)) {
      message = { ...message, dispatchState: previous.dispatchState, dispatchRevision: previous.dispatchRevision };
    }
  }
  message = mergeMessageReactions(message);
  if (index < 0) list.push(message);
  else list[index] = message;
  state.messages.set(chatId, list);
  const updates = messageUpdates.get(chatId) ?? new Map();
  updates.set(message.id, { sequence: ++updateSequence, message });
  messageUpdates.set(chatId, updates);
  return message;
}

/** Invalidates pending responses as well as the cache, so a reset cannot resurrect old history. */
export function clearMessages(chatId) {
  const ids = chatId ? [chatId] : new Set([...state.messages.keys(), ...messageLoads.keys(), ...messageEpochs.keys(), ...reactionUpdates.keys()]);
  for (const id of ids) {
    messageEpochs.set(id, (messageEpochs.get(id) ?? 0) + 1);
    messageLoads.delete(id);
    messageUpdates.delete(id);
    reactionUpdates.delete(id);
    state.messages.delete(id);
    state.messagePages.delete(id);
  }
}

export async function loadMessages(chatId, force = false) {
  if (!force && state.messages.has(chatId) && state.messagePages.get(chatId)?.loaded) return state.messages.get(chatId);
  if (messageLoads.has(chatId)) return messageLoads.get(chatId);
  for (const message of state.messages.get(chatId) ?? []) mergeMessageReactions(message);
  const epoch = messageEpochs.get(chatId) ?? 0;
  const sequence = updateSequence;
  const pending = (async () => {
    const data = await api('GET', `/api/chats/${chatId}/messages?limit=200`);
    if ((messageEpochs.get(chatId) ?? 0) !== epoch) return state.messages.get(chatId) ?? [];
    const merged = new Map(data.messages.map((m) => [m.id, m]));
    for (const { sequence: updatedAt, message } of messageUpdates.get(chatId)?.values() ?? []) {
      if (updatedAt > sequence) merged.set(message.id, message);
    }
    const messages = [...merged.values()].map((message) => mergeMessageReactions(message)).sort((a, b) => a.ts - b.ts);
    state.messages.set(chatId, messages);
    state.messagePages.set(chatId, { loaded: true, hasMore: Boolean(data.hasMore), nextBefore: data.nextBefore ?? (data.hasMore ? data.messages[0]?.id : null) });
    return messages;
  })();
  messageLoads.set(chatId, pending);
  try { return await pending; }
  finally { if (messageLoads.get(chatId) === pending) messageLoads.delete(chatId); }
}

/** Fetch an older page and keep newer live/cache versions of any overlapping message. */
export async function loadEarlierMessages(chatId) {
  const page = state.messagePages.get(chatId);
  if (!page?.hasMore || !page.nextBefore) return state.messages.get(chatId) ?? [];
  const epoch = messageEpochs.get(chatId) ?? 0;
  const data = await api('GET', `/api/chats/${chatId}/messages?limit=200&before=${encodeURIComponent(page.nextBefore)}`);
  if ((messageEpochs.get(chatId) ?? 0) !== epoch) return state.messages.get(chatId) ?? [];
  const merged = new Map(data.messages.map((m) => [m.id, m]));
  for (const message of state.messages.get(chatId) ?? []) merged.set(message.id, message);
  const messages = [...merged.values()].map((message) => mergeMessageReactions(message)).sort((a, b) => a.ts - b.ts);
  state.messages.set(chatId, messages);
  state.messagePages.set(chatId, { loaded: true, hasMore: Boolean(data.hasMore), nextBefore: data.nextBefore ?? (data.hasMore ? data.messages[0]?.id : null) });
  return messages;
}

/** Export reads every page without changing the visible history window or scroll position. */
export async function fetchAllMessages(chatId) {
  const messages = new Map();
  let order = [];
  const seen = new Set();
  let before = '';
  for (;;) {
    const data = await api('GET', `/api/chats/${chatId}/messages?limit=200${before ? `&before=${encodeURIComponent(before)}` : ''}`);
    const older = [];
    for (const message of data.messages) {
      if (messages.has(message.id)) continue;
      messages.set(message.id, message);
      older.push(message.id);
    }
    order = [...older, ...order];
    if (!data.hasMore) break;
    const next = data.nextBefore ?? data.messages[0]?.id;
    if (!next || seen.has(next)) throw new Error(t('error.requestFailed'));
    seen.add(next);
    before = next;
  }
  return order.map((id) => mergeMessageReactions(messages.get(id), false));
}

// ------------------------------------------------------------------ feedback
let toastTimer = 0;
export function toast(text, kind = '') {
  let el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.className = `toast ${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    if (el) el.hidden = true;
  }, kind === 'error' ? 5000 : 2400);
}

export async function confirmAction(title, text, okLabel = t('common.confirm')) {
  const dialog = /** @type {HTMLDialogElement} */ (document.getElementById('confirm'));
  /** @type {HTMLElement} */ (document.getElementById('confirm-title')).textContent = title;
  /** @type {HTMLElement} */ (document.getElementById('confirm-text')).textContent = text;
  /** @type {HTMLElement} */ (document.getElementById('confirm-ok')).textContent = okLabel;
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
  });
}

export const guard =
  (fn) =>
  async (...args) => {
    try {
      await fn(...args);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error');
    }
  };

export async function openSession(sessionId) {
  try {
    await host()?.miniapp?.agent?.open(sessionId);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    toast(
      code === 'not_permitted'
        ? t('session.openNeedsChat')
        : code === 'session_not_found'
          ? t('session.gone')
          : t('session.openFailed'),
      'error',
    );
  }
}

export const canOpenSession = () => typeof host()?.miniapp?.agent?.open === 'function';

/** The conversation as Markdown, for “share”. */
export function transcriptMarkdown(chatId, list = state.messages.get(chatId) ?? []) {
  const lines = [`# ${chatName(chatId)}`, ''];
  for (const m of list) {
    if (m.role === 'user') lines.push(`**${t('transcript.you')}** ${m.text}`, '');
    else if (m.role === 'bot' && m.text && m.status !== 'pass') lines.push(`**${t('transcript.speaker', { name: botById(m.botId)?.name ?? 'Bot' })}**`, '', m.text, '');
    else if (m.role === 'relay') lines.push(`> ${t('transcript.from', { name: m.fromName ?? 'Bot' })}${m.text}`, '');
  }
  return lines.join('\n');
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = h('textarea', { style: { position: 'fixed', opacity: '0' } });
    /** @type {HTMLTextAreaElement} */ (area).value = text;
    document.body.append(area);
    /** @type {HTMLTextAreaElement} */ (area).select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}
