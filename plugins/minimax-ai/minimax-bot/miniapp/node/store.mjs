// @ts-check
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { userReaction } from '../client/emoji-data.js';

import { resolveLocale, setLocale, t } from './i18n.mjs';
import { ReactionError, validateReaction } from './reactions.mjs';

export const DEFAULT_MESSAGE_PAGE_SIZE = 100;
export const MAX_MESSAGE_PAGE_SIZE = 500;
/** Octopus gradient palettes; the client owns the actual colors. */
export const BOT_COLORS = [
  'ocean', 'sky', 'teal', 'green', 'lime', 'yellow', 'orange', 'red', 'pink', 'violet', 'indigo', 'graphite',
];
export const BOT_FACES = ['none', 'dots', 'happy', 'wink', 'sleepy', 'shades'];
const LEGACY_COLORS = { blue: 'ocean', purple: 'violet', gray: 'graphite' };

export const normalizeColor = (color) => {
  const value = LEGACY_COLORS[color] ?? color;
  return BOT_COLORS.includes(value) ? value : undefined;
};
export const normalizeFace = (face) => (BOT_FACES.includes(face) ? face : undefined);

/**
 * Bot looks: one rendered image each (`client/skins/<id>.png`). The palette next to each is the
 * text color for that Bot's name and mentions, so it stays readable and matches the image.
 */
export const SKIN_INK = {
  fuzzy: 'ocean',
  bubble: 'ocean',
  glass: 'pink',
  gold: 'yellow',
  jade: 'green',
  plush: 'violet',
  waffle: 'orange',
  pixel: 'sky',
  smiley: 'yellow',
  toys: 'red',
  moon: 'graphite',
};
export const BOT_SKINS = Object.keys(SKIN_INK);
export const normalizeSkin = (skin) => (BOT_SKINS.includes(skin) ? skin : undefined);
/** The look closest to an old palette color, for Bots made before looks were images. */
const COLOR_SKIN = {
  ocean: 'bubble',
  sky: 'pixel',
  teal: 'pixel',
  green: 'jade',
  lime: 'jade',
  yellow: 'gold',
  orange: 'waffle',
  red: 'toys',
  pink: 'glass',
  violet: 'plush',
  indigo: 'plush',
  graphite: 'moon',
};
export const skinForColor = (color) => COLOR_SKIN[normalizeColor(color) ?? ''] ?? undefined;

/**
 * A Bot's own model, in the shape the Host's `agent.run({ model })` takes. `undefined` when the
 * value is not a usable selection; whether the model is still enabled is checked by the Host.
 * @returns {{ providerId: string, modelId: string, variant?: string, thinking?: { effort: string } } | undefined}
 */
export function normalizeModel(value) {
  if (!value || typeof value !== 'object') return undefined;
  const providerId = typeof value.providerId === 'string' ? value.providerId.trim() : '';
  const modelId = typeof value.modelId === 'string' ? value.modelId.trim() : '';
  if (!providerId || !modelId || providerId.length > 200 || modelId.length > 200) return undefined;
  /** @type {{ providerId: string, modelId: string, variant?: string, thinking?: { effort: string } }} */
  const model = { providerId, modelId };
  // `variant: ''` means thinking is off and must survive, unlike an absent variant.
  if (typeof value.variant === 'string' && value.variant.length <= 64) model.variant = value.variant;
  const effort = value.thinking?.effort;
  if (typeof effort === 'string' && effort && effort.length <= 32) model.thinking = { effort };
  return model;
}

/** A reasoning effort as the Bot stores it: a short level name, or 'off' for thinking off. */
export function normalizeEffort(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-z][a-z0-9_-]{0,31}$/.test(text) ? text : undefined;
}

/** The efforts a catalog model offers, plus 'off' when it can run with thinking turned off. */
export function effortOptions(entry) {
  const levels = Array.isArray(entry?.thinking?.efforts) ? entry.thinking.efforts.filter((e) => typeof e === 'string') : [];
  return entry?.variants?.includes('') ? [...levels, 'off'] : levels;
}

/**
 * The selection that runs catalog model `entry` at `effort` ('off' = thinking off), as the
 * composer would pick it; `undefined` when the model does not offer that effort.
 */
export function withEffort(entry, effort) {
  if (!entry || !effortOptions(entry).includes(effort)) return undefined;
  if (effort === 'off') return { providerId: entry.providerId, modelId: entry.modelId, variant: '' };
  return {
    providerId: entry.providerId,
    modelId: entry.modelId,
    ...(entry.variants?.includes('thinking') ? { variant: 'thinking' } : {}),
    thinking: { effort },
  };
}

/** The effort a selection runs at: 'off', a level, or `undefined` for the model's own default. */
export const effortOf = (model) => (model?.variant === '' ? 'off' : model?.thinking?.effort);

/** Identity of a model selection, for telling whether a session already runs on it. */
export const modelKey = (model) =>
  model ? [model.providerId, model.modelId, model.variant ?? '*', model.thinking?.effort ?? '*'].join('\u0000') : '';

/** @returns {string} */
export function newId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

/** Writes JSON atomically so a crash never leaves a half-written file. */
async function writeJsonAtomic(path, value) {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

function defaultState() {
  return {
    version: 2,
    rosterRev: 1,
    bots: [],
    groups: [],
    /** sessions[chatId][botId] = { sessionId, stamp, lastSeen } */
    sessions: {},
    schedules: [],
    /** Background helpers: queued / running ones and the most recent finished ones. */
    helpers: [],
    taskBatches: [],
    /** `language`: 'auto' (follow the OS) | 'zh' | 'en' */
    settings: { language: 'auto', userName: '' },
    /** OS language last reported by the page, used to resolve `auto`. */
    systemLocale: undefined,
  };
}

/** Plain one-line preview of a message for the sidebar. */
function previewOf(message, nameOf) {
  const flat = (text) =>
    String(text ?? '')
      .replace(/```[\s\S]*?```/g, t('preview.code'))
      // Delivered files read as their caption or file name, not as markup.
      .replace(/<\/?deliver-assets\b[^>]*>/gi, ' ')
      .replace(/<media\b([^>]*?)\/?>(?:\s*<\/media>)?/gi, (_, attrs) => {
        const caption = /caption\s*=\s*"([^"]*)"/.exec(attrs)?.[1];
        const src = /src\s*=\s*"([^"]*)"/.exec(attrs)?.[1] ?? '';
        return ` [${caption || src.split(/[\\/]/).pop() || 'file'}] `;
      })
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, ' [$1] ')
      .replace(/[#>*_`~|-]+/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  // Greetings and notices carry a key so the preview follows the current language.
  const body = message.key ? t(message.key, message.params) : message.text;
  switch (message.role) {
    case 'user': {
      const files = (message.attachments ?? []).map((a) => (a.kind === 'image' ? t('preview.image') : `[${a.name}]`));
      return t('preview.you', { text: [flat(body), ...files].filter(Boolean).join(' ') });
    }
    case 'bot': {
      const text = flat(body) || (message.question ? t('preview.asked') : '');
      if (!text) return '';
      return message.chatId.startsWith('group:') ? t('preview.speaker', { name: nameOf(message.botId), text }) : text;
    }
    case 'relay': {
      // A post in a group is a speaker line like any other; a private hand-off keeps its
      // "message from" preview because the text belongs to the other Bot's chat, not this one.
      if (!message.chatId.startsWith('group:')) return t('preview.relay', { name: message.fromName ?? 'Bot' });
      const text = flat(body);
      return text ? t('preview.speaker', { name: message.fromName ?? 'Bot', text }) : '';
    }
    case 'schedule':
      return t('preview.schedule', { name: message.scheduleName ?? '' });
    case 'helper':
      return t(`preview.helper.${message.helperStatus}`, { name: message.title ?? '' });
    default:
      return flat(body);
  }
}

/** The text a stored turn had produced by the time it was cut off. */
function knownText(message) {
  if (typeof message.text === 'string' && message.text) return message.text;
  return (message.parts ?? [])
    .filter((part) => part.type === 'text' && part.text)
    .map((part) => part.text)
    .join('\n\n');
}

export class Store {
  /** @param {string} dataDir */
  constructor(dataDir) {
    this.dir = dataDir;
    this.statePath = join(dataDir, 'state.json');
    this.messagesDir = join(dataDir, 'messages');
    this.usagePath = join(dataDir, 'usage.jsonl');
    /** @type {ReturnType<typeof defaultState>} */
    this.state = defaultState();
    /** @type {Map<string, any[]>} */
    this.messageCache = new Map();
    /** @type {Map<string, Promise<any[]>>} cold chats being read from disk */
    this.messageLoads = new Map();
    /** Turn ids already in the ledger, so a recovered turn is never counted twice. */
    /** @type {Set<string>} */
    this.usageIds = new Set();
    /** @type {Promise<void> | undefined} */
    this.usageIdsReady = undefined;
    /** @type {Promise<void>} */
    this.writeChain = Promise.resolve();
  }

  async init() {
    await mkdir(this.messagesDir, { recursive: true });
    this.state = { ...defaultState(), ...(await readJson(this.statePath, defaultState())) };
    this.state.settings = { ...defaultState().settings, ...(this.state.settings ?? {}) };
    setLocale(resolveLocale(this.state));
    let migrated = false;
    // A helper's Agent run does not survive the Mini App process; one left running was cut off.
    this.state.helpers = Array.isArray(this.state.helpers) ? this.state.helpers : [];
    for (const helper of this.state.helpers) {
      if (helper.status === 'queued' || helper.status === 'running') {
        const wasQueued = helper.status === 'queued';
        helper.status = 'interrupted';
        helper.endedAt = helper.endedAt ?? Date.now();
        migrated = true;
        // The run was cut off, so the model never reported how long it took: the ledger row
        // says "aborted" with no duration rather than inventing one.
        await this.recordUsageOnce({
          ts: helper.startedAt ?? helper.createdAt ?? helper.endedAt,
          turnId: helper.id,
          botId: helper.botId,
          botName: this.getBot(helper.botId)?.name ?? '',
          chatId: helper.chatId,
          kind: 'helper-run',
          status: 'aborted',
          durationMs: null,
          chars: 0,
          tools: helper.turnTools ?? 0,
          // A queued job never reached the model; a running one had already called it.
          attempts: wasQueued ? 0 : 1,
        });
      }
    }
    this.state.taskBatches = Array.isArray(this.state.taskBatches) ? this.state.taskBatches : [];
    for (const batch of this.state.taskBatches) {
      for (const task of batch.tasks ?? []) {
        if (task.status === 'running') { task.status = 'unknown'; migrated = true; }
      }
      if (batch.notification === 'delivering') { batch.notification = 'unknown'; migrated = true; }
    }
    for (const bot of this.state.bots) {
      const color = normalizeColor(bot.color) ?? 'ocean';
      const face = normalizeFace(bot.face) ?? 'none';
      if (color !== bot.color || face !== bot.face) migrated = true;
      bot.color = color;
      bot.face = face;
      // Looks became images: pick the one closest to the old color, and take its text color.
      const skin = normalizeSkin(bot.skin) ?? skinForColor(color) ?? 'bubble';
      if (skin !== bot.skin || SKIN_INK[skin] !== bot.color) {
        bot.skin = skin;
        bot.color = SKIN_INK[skin];
        migrated = true;
      }
      // Older Bots delegate by default; only a Bot explicitly turned off does it itself.
      if (bot.autoHelper === undefined) {
        bot.autoHelper = true;
        migrated = true;
      }
    }
    if (this.state.bots.length === 0) {
      const now = Date.now();
      const chief = {
        id: newId('bot'),
        name: 'Chief',
        // Seeded in the current language; Team.applyLocale() swaps them while left unedited.
        role: t('chief.role'),
        instructions: t('chief.instructions'),
        color: 'ocean',
        face: 'none',
        // The plugin's own mascot: a newly seeded main Bot wears it.
        skin: 'fuzzy',
        autoHelper: true,
        isMain: true,
        pinned: false,
        rev: 1,
        createdAt: now,
        updatedAt: now,
      };
      this.state.bots.push(chief);
      migrated = true;
      await this.appendMessage(`bot:${chief.id}`, {
        role: 'bot',
        botId: chief.id,
        // Rendered from the key at display time, so it follows later language changes.
        key: 'greeting.chief',
        text: t('greeting.chief'),
        parts: [{ type: 'text', text: t('greeting.chief') }],
        kind: 'greeting',
      });
    }
    if (migrated) await this.save();
    // Warm every chat so the sidebar can show previews without extra requests.
    await Promise.all(this.chatIds().map((chatId) => this.getMessages(chatId)));
  }

  chatIds() {
    return [
      ...this.state.bots.map((bot) => `bot:${bot.id}`),
      ...this.state.groups.map((group) => `group:${group.id}`),
    ];
  }

  /** Serialises every disk write. */
  enqueue(task) {
    const next = this.writeChain.then(task, task);
    this.writeChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  save() {
    return this.enqueue(() => writeJsonAtomic(this.statePath, this.state));
  }

  // ---------- bots ----------
  getBot(ref) {
    if (!ref) return undefined;
    const key = String(ref).trim().replace(/^@/, '');
    return (
      this.state.bots.find((bot) => bot.id === key) ??
      this.state.bots.find((bot) => bot.name.toLowerCase() === key.toLowerCase())
    );
  }

  getGroup(ref) {
    if (!ref) return undefined;
    const key = String(ref).trim();
    return (
      this.state.groups.find((group) => group.id === key) ??
      this.state.groups.find((group) => group.name.toLowerCase() === key.toLowerCase())
    );
  }

  bumpRoster() {
    this.state.rosterRev = (this.state.rosterRev ?? 1) + 1;
  }

  // ---------- sessions ----------
  getSession(chatId, botId) {
    return this.state.sessions[chatId]?.[botId];
  }

  async setSession(chatId, botId, patch) {
    // A turn that outlives its Bot or group (deleted mid-run) must not bring the session back.
    if (!this.getBot(botId)) return;
    if (chatId.startsWith('group:') && !this.getGroup(chatId.slice(6))) return;
    const chat = (this.state.sessions[chatId] ??= {});
    chat[botId] = { ...(chat[botId] ?? {}), ...patch };
    await this.save();
  }

  async clearSession(chatId, botId) {
    if (this.state.sessions[chatId]) delete this.state.sessions[chatId][botId];
    await this.save();
  }

  // ---------- messages ----------
  messagePath(chatId) {
    return join(this.messagesDir, `${chatId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
  }

  getMessages(chatId) {
    const cached = this.messageCache.get(chatId);
    if (cached) return Promise.resolve(cached);
    // Concurrent callers on a cold chat must share one load: two separate reads would each
    // install their own array and the later one would silently drop the other's writes.
    let loading = this.messageLoads.get(chatId);
    if (!loading) {
      loading = this.loadMessages(chatId).finally(() => this.messageLoads.delete(chatId));
      this.messageLoads.set(chatId, loading);
    }
    return loading;
  }

  async loadMessages(chatId) {
    let list = await readJson(this.messagePath(chatId), []);
    // deleteChat() may have installed an empty list while the read was in flight; it wins.
    const installed = this.messageCache.get(chatId);
    if (installed) return installed;
    if (!Array.isArray(list)) list = [];
    let dirty = false;
    let lastSeq = 0;
    for (const message of list) {
      // Old records have no sequence. Preserve valid stored order and give every record a
      // stable cursor, independent of timestamps and of when an Agent finishes its turn.
      if (!Number.isSafeInteger(message.seq) || message.seq <= lastSeq) {
        message.seq = lastSeq + 1;
        dirty = true;
      }
      lastSeq = message.seq;
      if (message.userReactions?.length > 1) {
        message.userReactions = [userReaction(message)];
        dirty = true;
      }
      // A process restart interrupts streaming turns; never show them as still running.
      if (message.status === 'streaming') {
        message.status = 'interrupted';
        message.live = undefined;
        dirty = true;
        // The turn the model was in the middle of is real work: it belongs in the ledger.
        // The run died, so its duration is unknown and stays null.
        if (message.role === 'bot') {
          await this.recordUsageOnce({
            ts: message.startedAt ?? message.ts,
            turnId: message.id,
            botId: message.botId,
            botName: this.getBot(message.botId)?.name ?? '',
            chatId,
            kind: message.kind ?? 'private',
            status: 'aborted',
            durationMs: null,
            chars: knownText(message).length,
            tools: (message.parts ?? []).filter((part) => part.type === 'tool').length,
            // The model was already answering; a turn that never reached it is not streaming.
            attempts: message.modelCalls ?? 1,
          });
        }
      }
      if (message.role === 'user' && ['adjusting', 'processing'].includes(message.dispatchState)) {
        message.dispatchState = message.dispatchState === 'adjusting' ? 'held'
          : list.some((reply) => reply.sourceMessageId === message.id || reply.sourceMessageIds?.includes(message.id)) ? 'uncertain' : 'pending';
        message.dispatchRevision = (message.dispatchRevision ?? 0) + 1;
        dirty = true;
      }
      // 0.1.x greetings were stored as plain text; give them the key so they can be translated.
      if (message.kind === 'greeting' && !message.key && message.role === 'bot') {
        message.key = 'greeting.chief';
        dirty = true;
      }
      // An answer in flight when the process stopped: let the user submit it again.
      if (message.answering) {
        delete message.answering;
        dirty = true;
      }
    }
    // Only metadata compatibility is migrated. Text and tool ordering are historical
    // records: matching prefixes do not prove that two assistant messages are duplicates.
    if (dirty) await this.enqueue(() => writeJsonAtomic(this.messagePath(chatId), list));
    this.messageCache.set(chatId, list);
    return list;
  }

  /** Newest page, or the page strictly before a message ID; each page is chronological. */
  async listMessagesPage(chatId, { before, limit = DEFAULT_MESSAGE_PAGE_SIZE } = {}) {
    const list = await this.getMessages(chatId);
    const size = Number.isFinite(Number(limit))
      ? Math.max(1, Math.min(MAX_MESSAGE_PAGE_SIZE, Math.trunc(Number(limit))))
      : DEFAULT_MESSAGE_PAGE_SIZE;
    const index = before === undefined ? list.length : list.findIndex((message) => message.id === before);
    if (index < 0) {
      const error = new Error('Message page cursor no longer exists');
      error.code = 'not_found';
      throw error;
    }
    const start = Math.max(0, index - size);
    const messages = list.slice(start, index);
    return { messages, hasMore: start > 0, nextBefore: start > 0 ? messages[0].id : null };
  }

  async appendMessage(chatId, partial) {
    await this.getMessages(chatId);
    return this.enqueue(async () => {
      const list = this.messageCache.get(chatId) ?? [];
      // Durable task receipts/results may be retried after a lost observer or process restart.
      if (partial.id) {
        const existing = list.find((message) => message.id === partial.id);
        if (existing) return existing;
      }
      const message = {
        id: newId('msg'), chatId, ts: Date.now(), status: 'done', ...partial,
        seq: (list.at(-1)?.seq ?? 0) + 1,
      };
      // Retention is independent of the UI page size. A failed write must not publish a
      // message that the caller was told did not send, or consume its sequence number.
      await writeJsonAtomic(this.messagePath(chatId), [...list, message]);
      list.push(message);
      this.messageCache.set(chatId, list);
      return message;
    });
  }

  async updateMessage(chatId, messageId, patch, { persist = true } = {}) {
    await this.getMessages(chatId);
    const update = async () => {
      const list = this.messageCache.get(chatId) ?? [];
      const message = list.find((item) => item.id === messageId);
      if (!message) return undefined;
      const next = Object.hasOwn(patch, 'dispatchState') ? { ...patch, dispatchRevision: (message.dispatchRevision ?? 0) + 1 } : patch;
      if (persist) {
        await writeJsonAtomic(this.messagePath(chatId), list.map((item) => item === message ? { ...item, ...next } : item));
      }
      // Engine retains the object returned by appendMessage while streaming. Commit into
      // that object only after persistence, rather than replacing it with a detached clone.
      Object.assign(message, next);
      return message;
    };
    return persist ? this.enqueue(update) : update();
  }

  /** Commit one inbox batch atomically, preserving streaming message object identity. */
  async updateMessages(chatId, messageIds, patch) {
    await this.getMessages(chatId);
    const ids = new Set(messageIds);
    return this.enqueue(async () => {
      const list = this.messageCache.get(chatId) ?? [];
      const selected = list.filter((message) => ids.has(message.id));
      const patches = new Map(selected.map((message) => [message.id, Object.hasOwn(patch, 'dispatchState')
        ? { ...patch, dispatchRevision: (message.dispatchRevision ?? 0) + 1 } : patch]));
      await writeJsonAtomic(this.messagePath(chatId), list.map((message) => ids.has(message.id) ? { ...message, ...patches.get(message.id) } : message));
      for (const message of selected) Object.assign(message, patches.get(message.id));
      return selected;
    });
  }

  persistMessages(chatId) {
    return this.enqueue(() => writeJsonAtomic(this.messagePath(chatId), this.messageCache.get(chatId) ?? []));
  }

  /** Idempotent single selection; serialize writes so the last selection wins across windows. */
  async setUserReaction(chatId, messageId, emoji, selected) {
    await this.getMessages(chatId);
    return this.enqueue(async () => {
      if (!this.chatIds().includes(chatId)) throw new ReactionError('not_found', 'err.reactionMessageGone');
      const list = this.messageCache.get(chatId) ?? [];
      const message = list.find((item) => item.id === messageId);
      validateReaction(message, emoji, selected);
      const current = userReaction(message);
      // A delayed cancellation of an old emoji must not remove a newer selection.
      const next = selected ? emoji : current === emoji ? undefined : current;
      const patch = {
        userReactions: next ? [next] : [],
        reactionsRevision: (message.reactionsRevision ?? 0) + 1,
      };
      // Publish to memory only after a successful write; disk errors leave the old selection intact.
      await writeJsonAtomic(this.messagePath(chatId), list.map((item) => item === message ? { ...item, ...patch } : item));
      // Reset/delete can run while the write is pending; never resurrect a removed message.
      if (this.messageCache.get(chatId) !== list || !list.includes(message)) {
        throw new ReactionError('not_found', 'err.reactionMessageGone');
      }
      Object.assign(message, patch);
      return { messageId, ...patch };
    });
  }

  async deleteChat(chatId) {
    await this.getMessages(chatId);
    await this.enqueue(async () => {
      await writeJsonAtomic(this.messagePath(chatId), []);
      this.messageCache.set(chatId, []);
      delete this.state.sessions[chatId];
    });
    await this.save();
  }

  /** Sidebar summary of one chat, read from the warm cache. */
  summary(chatId) {
    const list = this.messageCache.get(chatId) ?? [];
    const nameOf = (id) => this.getBot(id)?.name ?? 'Bot';
    let preview = '';
    let lastTs = 0;
    let lastRole = '';
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const message = list[i];
      if (message.status === 'pass') continue;
      const text = previewOf(message, nameOf);
      if (!lastTs) {
        lastTs = message.ts;
        lastRole = message.role;
      }
      if (text) {
        preview = text.slice(0, 120);
        break;
      }
    }
    const pending = list.some((message) => message.question && !message.answered);
    return { preview, lastTs, lastRole, pending, count: list.length };
  }

  summaries() {
    return Object.fromEntries(this.chatIds().map((chatId) => [chatId, this.summary(chatId)]));
  }

  // ---------- usage ----------
  recordUsage(entry) {
    return this.enqueue(async () => {
      await appendFile(this.usagePath, `${JSON.stringify(entry)}\n`, 'utf8');
      if (entry.turnId) this.usageIds.add(entry.turnId);
    });
  }

  /**
   * Writes a row only when the turn has none yet. A restart recovers the turns that were in
   * flight; a turn the engine already metered must not be counted a second time.
   * @param {Record<string, any>} entry
   * @returns {Promise<boolean>} whether a row was written
   */
  async recordUsageOnce(entry) {
    await this.loadUsageIds();
    if (entry.turnId && this.usageIds.has(entry.turnId)) return false;
    await this.recordUsage(entry);
    return true;
  }

  /** The turn ids the ledger already holds, read once per process. */
  async loadUsageIds() {
    this.usageIdsReady ??= (async () => {
      for (const row of await this.readUsage(0)) if (row.turnId) this.usageIds.add(row.turnId);
    })();
    await this.usageIdsReady;
    return this.usageIds;
  }

  async readUsage(sinceTs) {
    let raw = '';
    try {
      raw = await readFile(this.usagePath, 'utf8');
    } catch {
      return [];
    }
    const rows = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (row.ts >= sinceTs) rows.push(row);
      } catch {
        /* skip a torn line */
      }
    }
    return rows;
  }
}
