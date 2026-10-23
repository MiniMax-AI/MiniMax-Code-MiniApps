// @ts-check
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { BOT_SKINS, SKIN_INK, effortOf, newId, normalizeEffort, normalizeFace, normalizeModel, normalizeSkin, skinForColor } from './store.mjs';
import { EngineError, nextRun } from './engine.mjs';
import { hopLimit } from './relay-guard.mjs';
import { MemoryError, TOPIC_KEY_RE, storageBudget } from './memory.mjs';
import { MEMORY_CONTEXT_MAX } from './memory-context.mjs';
import { isDefaultText, resolveLocale, setLocale, t } from './i18n.mjs';

/** @typedef {import('./store.mjs').Store} Store */
/** @typedef {import('./memory.mjs').MemoryStore} MemoryStore */
/** @typedef {import('./engine.mjs').Engine} Engine */

/** An uploaded avatar the page already scaled down; data URLs above this are refused. */
const MAX_AVATAR_BYTES = 512 * 1024;
/** An image file a Bot names by path; it is stored as-is, so it must already be small. */
const MAX_AVATAR_FILE_BYTES = 2 * 1024 * 1024;
const AVATAR_NAME_RE = /^[a-zA-Z0-9_-]+\.(png|jpe?g|webp|gif)$/;

/** The image type from its first bytes, so a renamed file of another kind is refused. */
function imageExt(buffer) {
  if (buffer.length >= 8 && buffer.readUInt32BE(0) === 0x89504e47) return 'png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.length >= 12 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.toString('latin1', 0, 6))) return 'gif';
  return undefined;
}

/** Caller is `undefined` for the user (page or the user's own MiniMax Code chat). */
export class Team {
  /**
   * @param {{ store: Store, memory: MemoryStore, engine: Engine, broadcast: (e: Record<string, unknown>) => void }} deps
   */
  constructor(deps) {
    this.store = deps.store;
    this.memory = deps.memory;
    this.engine = deps.engine;
    this.broadcast = deps.broadcast;
  }

  changed() {
    this.broadcast({ type: 'state.changed' });
  }

  /** @param {string} action key under `action.*` */
  requireMain(caller, action) {
    if (caller && !caller.isMain) {
      throw new EngineError('forbidden', t('err.mainOnly', { action: t(`action.${action}`) }));
    }
  }

  resolveBot(ref) {
    const bot = this.store.getBot(ref);
    if (!bot) throw new EngineError('not_found', t('err.botNotFound', { ref }));
    return bot;
  }

  resolveGroup(ref) {
    const group = this.store.getGroup(ref);
    if (!group) throw new EngineError('not_found', t('err.groupNotFound', { ref }));
    return group;
  }

  /** @param {'bot' | 'group'} kindKey */
  validateName(name, kindKey, selfId) {
    const value = String(name ?? '').trim();
    const kind = t(`kind.${kindKey}`);
    if (!value) throw new EngineError('invalid', t('err.nameEmpty', { kind }));
    if (value.length > 24) throw new EngineError('invalid', t('err.nameTooLong', { kind }));
    if (/[@\n\r]/.test(value)) throw new EngineError('invalid', t('err.nameChars', { kind }));
    const list = kindKey === 'bot' ? this.store.state.bots : this.store.state.groups;
    if (list.some((item) => item.id !== selfId && item.name.toLowerCase() === value.toLowerCase())) {
      throw new EngineError('invalid', t('err.nameTaken', { name: value, kind, kindKey }));
    }
    return value;
  }

  /**
   * Re-resolve the effective language after the preference or the reported OS language
   * changed. Chief's seeded role and instructions follow along while the user has not edited
   * them. Returns whether the language changed.
   */
  async applyLocale() {
    const changed = setLocale(resolveLocale(this.store.state));
    let touched = false;
    for (const bot of this.store.state.bots) {
      if (!bot.isMain) continue;
      for (const [field, key] of [['role', 'chief.role'], ['instructions', 'chief.instructions']]) {
        if (isDefaultText(key, bot[field]) && bot[field] !== t(key)) {
          bot[field] = t(key);
          touched = true;
        }
      }
    }
    if (touched) this.store.bumpRoster();
    await this.store.save();
    if (changed || touched) this.changed();
    return changed;
  }

  /** Least-used palette, so new Bots are easy to tell apart. */
  nextSkin() {
    const counts = new Map(BOT_SKINS.map((skin) => [skin, 0]));
    for (const bot of this.store.state.bots) counts.set(bot.skin, (counts.get(bot.skin) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[1] - b[1])[0][0];
  }

  /** The look a create/update asks for: `skin`, or an old palette `color` mapped to its closest look. */
  skinOf(input) {
    return normalizeSkin(input.skin) ?? (input.color !== undefined ? skinForColor(input.color) : undefined);
  }

  // ---------------------------------------------------------------- bots
  async createBot(caller, input) {
    this.requireMain(caller, 'createBot');
    const model = this.modelPatch(input.model);
    // With a model of its own the effort lives in that selection; `effort` is only for the default model.
    const effort = model ? undefined : this.effortPatch(input.effort);
    const avatar = await this.avatarImage(input.avatar);
    const now = Date.now();
    const bot = {
      id: newId('bot'),
      name: this.validateName(input.name, 'bot'),
      role: String(input.role ?? '').trim().slice(0, 60),
      instructions: String(input.instructions ?? '').trim().slice(0, 4000),
      ...(() => {
        const skin = this.skinOf(input) ?? this.nextSkin();
        return { skin, color: SKIN_INK[skin] };
      })(),
      face: normalizeFace(input.face) ?? 'none',
      autoHelper: input.autoHelper === undefined ? true : Boolean(input.autoHelper),
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      isMain: Boolean(input.isMain),
      pinned: false,
      rev: 1,
      createdAt: now,
      updatedAt: now,
    };
    if (avatar) bot.avatar = await this.saveAvatar(avatar);
    this.store.state.bots.push(bot);
    this.store.bumpRoster();
    await this.store.save();
    this.changed();
    return bot;
  }

  async updateBot(caller, ref, patch) {
    this.requireMain(caller, 'updateBot');
    const bot = this.resolveBot(ref);
    // Validate the whole patch on a draft first: a rejected request must leave no trace, or a
    // later unrelated save() would persist the half-applied change.
    const draft = { ...bot };
    if (patch.name !== undefined) draft.name = this.validateName(patch.name, 'bot', bot.id);
    if (patch.role !== undefined) draft.role = String(patch.role).trim().slice(0, 60);
    if (patch.instructions !== undefined) draft.instructions = String(patch.instructions).trim().slice(0, 4000);
    const skin = this.skinOf(patch);
    if (skin) {
      draft.skin = skin;
      draft.color = SKIN_INK[skin];
    }
    if (patch.face !== undefined && normalizeFace(patch.face)) draft.face = normalizeFace(patch.face);
    if (patch.autoHelper !== undefined) draft.autoHelper = Boolean(patch.autoHelper);
    if (patch.pinned !== undefined) draft.pinned = Boolean(patch.pinned);
    // `null` puts the Bot back on the default model; JSON drops the undefined key on save.
    if (patch.model !== undefined) draft.model = this.modelPatch(patch.model);
    if (patch.effort !== undefined) draft.effort = this.effortPatch(patch.effort);
    // A Bot's own model carries its effort; the separate field is only for the default model.
    if (draft.model) draft.effort = undefined;
    // Read and checked with the rest of the patch; written only once the whole patch is valid.
    const avatar = patch.avatar === undefined ? undefined : await this.avatarImage(patch.avatar);
    if (patch.isMain !== undefined) {
      draft.isMain = Boolean(patch.isMain);
      if (!draft.isMain && bot.isMain && this.store.state.bots.filter((b) => b.isMain).length <= 1) {
        throw new EngineError('invalid', t('err.needMain'));
      }
    }
    if (patch.avatar !== undefined) draft.avatar = avatar ? await this.saveAvatar(avatar) : undefined;
    Object.assign(bot, draft, { rev: bot.rev + 1, updatedAt: Date.now() });
    this.store.bumpRoster();
    await this.store.save();
    this.changed();
    return bot;
  }

  /**
   * The image an `avatar` value names: a `data:image/...;base64,` upload from the page, or an
   * existing gallery file name, or absolute path to a local image (how a Bot sets one). `null` / `''` / `default` mean "back to
   * the octopus" and return `undefined`. Anything unreadable or not an image is refused.
   * @returns {Promise<{ buffer: Buffer, ext: string, name?: string } | undefined>}
   */
  async avatarImage(value) {
    if (value === undefined || value === null) return undefined;
    const text = String(value).trim();
    if (!text || /^(default|none|默认)$/i.test(text)) return undefined;
    let buffer;
    let name;
    if (text.startsWith('data:')) {
      const match = /^data:image\/(?:png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(text);
      if (!match) throw new EngineError('invalid', t('err.badAvatar'));
      buffer = Buffer.from(match[1], 'base64');
      if (buffer.length > MAX_AVATAR_BYTES) throw new EngineError('invalid', t('err.avatarTooLarge', { max: '512KB' }));
    } else if (AVATAR_NAME_RE.test(text)) {
      name = text;
      // Gallery selections are file names, never paths outside this Mini App's data directory.
      const path = join(this.store.dir, 'avatars', text);
      const info = await stat(path).catch(() => undefined);
      if (!info?.isFile() || info.size > MAX_AVATAR_FILE_BYTES) throw new EngineError('invalid', t('err.badAvatar'));
      buffer = await readFile(path);
    } else {
      const path = text.startsWith('~/') ? join(process.env.HOME ?? '', text.slice(2)) : text;
      if (!isAbsolute(path)) throw new EngineError('invalid', t('err.badAvatar'));
      const info = await stat(path).catch(() => undefined);
      if (!info?.isFile()) throw new EngineError('invalid', t('err.avatarNotFound', { path: text }));
      if (info.size > MAX_AVATAR_FILE_BYTES) throw new EngineError('invalid', t('err.avatarTooLarge', { max: '2MB' }));
      buffer = await readFile(path);
    }
    const ext = imageExt(buffer);
    if (!ext) throw new EngineError('invalid', t('err.badAvatar'));
    return { buffer, ext, ...(name ? { name } : {}) };
  }

  /** Existing per-Bot images are also gallery entries; switching/deleting a Bot keeps them. */
  async listAvatars() {
    const entries = await readdir(join(this.store.dir, 'avatars'), { withFileTypes: true }).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    return entries.filter((entry) => entry.isFile() && AVATAR_NAME_RE.test(entry.name)).map((entry) => entry.name).sort();
  }

  /** A browser import saves one scaled image immediately, independently of any Bot form. */
  async importAvatar(value) {
    if (typeof value !== 'string' || !value.startsWith('data:')) throw new EngineError('invalid', t('err.badAvatar'));
    const image = await this.avatarImage(value);
    return this.saveAvatar(image);
  }

  /** Content-addressed, atomic files deduplicate repeated imports and survive interrupted writes. */
  async saveAvatar({ buffer, ext, name: existingName }) {
    if (existingName) return existingName;
    const dir = join(this.store.dir, 'avatars');
    await mkdir(dir, { recursive: true });
    const name = `avatar-${createHash('sha256').update(buffer).digest('hex')}.${ext}`;
    const temp = join(dir, `.part-${randomUUID()}`);
    try {
      await writeFile(temp, buffer);
      await rename(temp, join(dir, name));
    } finally {
      await rm(temp, { force: true });
    }
    return name;
  }

  /** `null` / `''` / `default` clear the effort (the model's own default); else a level or 'off'. */
  effortPatch(value) {
    if (value === undefined || value === null || value === '' || value === 'default') return undefined;
    const effort = normalizeEffort(value);
    if (!effort) throw new EngineError('invalid', t('err.effortInvalid'));
    return effort;
  }

  /**
   * `null` / `''` clear a Bot's model (it follows the default); anything else must be a model
   * selection, or the whole request is rejected.
   */
  modelPatch(value) {
    if (value === undefined || value === null || value === '') return undefined;
    const model = normalizeModel(value);
    if (!model) throw new EngineError('invalid', t('err.badModel'));
    return model;
  }

  async deleteBot(caller, ref) {
    this.requireMain(caller, 'deleteBot');
    const bot = this.resolveBot(ref);
    if (caller && caller.id === bot.id) throw new EngineError('invalid', t('err.mainDeleteSelf'));
    if (bot.isMain && this.store.state.bots.filter((b) => b.isMain).length <= 1) {
      throw new EngineError('invalid', t('err.lastMain'));
    }
    // Queued turns of this Bot (in its chat or any group) are dropped before they start; the
    // engine also re-checks that the Bot still exists right before running a turn.
    this.engine.cancelBot(bot.id);
    this.engine.cancelChat(`bot:${bot.id}`);
    const state = this.store.state;
    state.bots = state.bots.filter((b) => b.id !== bot.id);
    for (const group of [...state.groups]) {
      if (!group.memberIds.includes(bot.id)) continue;
      group.memberIds = group.memberIds.filter((id) => id !== bot.id);
      if (state.sessions[`group:${group.id}`]) delete state.sessions[`group:${group.id}`][bot.id];
      if (group.memberIds.length === 0) {
        state.groups = state.groups.filter((g) => g.id !== group.id);
        await this.store.deleteChat(`group:${group.id}`);
      } else if (group.adminId === bot.id) {
        group.adminId = group.memberIds[0];
      }
    }
    state.schedules = state.schedules.filter((s) => s.botId !== bot.id);
    this.store.bumpRoster();
    await this.store.deleteChat(`bot:${bot.id}`);
    await this.memory.archive(bot.id);
    await this.store.save();
    this.changed();
    return { deleted: bot.name };
  }

  // ---------------------------------------------------------------- groups
  memberList(ids) {
    const result = [];
    for (const ref of ids ?? []) {
      const bot = this.resolveBot(ref);
      if (!result.includes(bot.id)) result.push(bot.id);
    }
    return result;
  }

  async createGroup(caller, input) {
    this.requireMain(caller, 'createGroup');
    const memberIds = this.memberList(input.members);
    if (memberIds.length === 0) throw new EngineError('invalid', t('err.groupNeedsMember'));
    const adminId = input.admin ? this.resolveBot(input.admin).id : memberIds[0];
    if (!memberIds.includes(adminId)) memberIds.unshift(adminId);
    const group = {
      id: newId('grp'),
      name: this.validateName(input.name, 'group'),
      notice: String(input.notice ?? '').trim().slice(0, 500),
      adminId,
      memberIds,
      replyMode: input.replyMode === 'all' ? 'all' : 'admin',
      pinned: false,
      createdAt: Date.now(),
      // F7 · the relay guardrails. The hop limit counts how many Bots may speak in one relay
      // chain; 0 means "no limit", which is the baseline behaviour. The hand-over carries the
      // conclusion of the previous hop into the next one. Both are off unless the group asks.
      maxHops: hopLimit({ maxHops: input.maxHops }),
      handover: input.handover === true,
    };
    this.store.state.groups.push(group);
    this.store.bumpRoster();
    await this.store.save();
    const welcome = await this.store.appendMessage(`group:${group.id}`, {
      role: 'system',
      key: 'notice.groupCreated',
      params: { admin: this.store.getBot(adminId)?.name },
      text: t('notice.groupCreated', { admin: this.store.getBot(adminId)?.name }),
    });
    this.broadcast({ type: 'message.upsert', chatId: `group:${group.id}`, message: welcome });
    this.engine.broadcastSummary(`group:${group.id}`);
    this.changed();
    return group;
  }

  async updateGroup(caller, ref, patch) {
    const group = this.resolveGroup(ref);
    if (caller && !caller.isMain && group.adminId !== caller.id) {
      throw new EngineError('forbidden', t('err.groupEditForbidden'));
    }
    if (patch.admin !== undefined && caller && !caller.isMain) {
      throw new EngineError('forbidden', t('err.adminChangeForbidden'));
    }
    // Same as updateBot: build and check the result before touching the live group.
    const draft = { ...group, memberIds: [...group.memberIds] };
    if (patch.name !== undefined) draft.name = this.validateName(patch.name, 'group', group.id);
    if (patch.notice !== undefined) draft.notice = String(patch.notice).trim().slice(0, 500);
    if (patch.replyMode !== undefined) draft.replyMode = patch.replyMode === 'all' ? 'all' : 'admin';
    if (patch.pinned !== undefined) draft.pinned = Boolean(patch.pinned);
    // The relay guardrails: absent leaves the group's own setting alone. 0 = no limit.
    if (patch.maxHops !== undefined) draft.maxHops = hopLimit({ maxHops: patch.maxHops });
    if (patch.handover !== undefined) draft.handover = Boolean(patch.handover);
    if (patch.members !== undefined) {
      const members = this.memberList(patch.members);
      if (members.length === 0) throw new EngineError('invalid', t('err.groupNeedsMember'));
      draft.memberIds = members;
    }
    if (patch.admin !== undefined) draft.adminId = this.resolveBot(patch.admin).id;
    if (!draft.memberIds.includes(draft.adminId)) {
      if (patch.admin !== undefined) draft.memberIds.unshift(draft.adminId);
      else draft.adminId = draft.memberIds[0];
    }
    Object.assign(group, draft);
    this.store.bumpRoster();
    await this.store.save();
    this.changed();
    return group;
  }

  async deleteGroup(caller, ref) {
    this.requireMain(caller, 'deleteGroup');
    const group = this.resolveGroup(ref);
    this.engine.cancelChat(`group:${group.id}`);
    this.store.state.groups = this.store.state.groups.filter((g) => g.id !== group.id);
    this.store.bumpRoster();
    await this.store.deleteChat(`group:${group.id}`);
    await this.store.save();
    this.changed();
    return { deleted: group.name };
  }

  // ---------------------------------------------------------------- memory
  /**
   * Resolve which memory file a caller may touch.
   * @param {any} caller
   * @param {'self'|'team'|'bot'} scope
   * @param {string | undefined} targetBot
   * @param {boolean} write
   */
  memoryScope(caller, scope, targetBot, write) {
    if (scope === 'team') {
      if (write && caller && !caller.isMain && !this.store.state.groups.some((g) => g.adminId === caller.id)) {
        throw new EngineError('forbidden', t('err.teamMemoryForbidden'));
      }
      return 'team';
    }
    if (scope === 'bot' || (!caller && scope === 'self')) {
      if (!targetBot) throw new EngineError('invalid', t('err.targetBotRequired'));
      const target = this.resolveBot(targetBot);
      if (caller && caller.id !== target.id && !caller.isMain) {
        throw new EngineError('forbidden', t('err.otherMemoryForbidden'));
      }
      return target.id;
    }
    return caller.id;
  }

  async remember(caller, input) {
    const scope = this.memoryScope(caller, input.scope ?? 'self', input.targetBot, true);
    try {
      if (input.requireTopic && !input.key && !input.replaceId) {
        throw new MemoryError(t('memory.err.topicRequired'), 'memory_topic_required');
      }
      const result = await this.memory.remember(scope, {
        text: input.text, key: input.key, source: input.source,
        by: caller?.name ?? t('who.user'), replaceId: input.replaceId,
        pinned: input.pinned, expectedRevision: input.expectedRevision,
        requireRevision: input.requireRevision,
      });
      if (!result.unchanged) this.broadcast({ type: 'memory.changed', scope });
      return { scope, ...result };
    } catch (error) {
      if (error instanceof MemoryError) error.details = {
        ...error.details, scope,
        ...(typeof input.key === 'string' && TOPIC_KEY_RE.test(input.key) ? { key: input.key } : {}),
        ...(typeof input.replaceId === 'string' && /^[a-f0-9]{8}$/.test(input.replaceId) ? { entryId: input.replaceId } : {}),
      };
      throw error;
    }
  }

  async forget(caller, input) {
    const scope = this.memoryScope(caller, input.scope ?? 'self', input.targetBot, true);
    const removed = await this.memory.forget(scope, input.id, caller?.name ?? t('who.user'));
    this.broadcast({ type: 'memory.changed', scope });
    return { scope, removed };
  }

  async recall(caller, input) {
    let scopes;
    if (input.scope === 'team') scopes = ['team'];
    else if (input.scope === 'bot' || (!caller && input.targetBot)) {
      scopes = [this.memoryScope(caller, 'bot', input.targetBot, false)];
    } else if (input.scope === 'self') scopes = [this.memoryScope(caller, 'self', input.targetBot, false)];
    else if (caller) scopes = [caller.id, 'team'];
    else scopes = ['team'];
    const offset = input.offset ?? 0, limit = input.limit ?? 10, textOffset = input.textOffset ?? 0;
    if (![offset, limit, textOffset].every(Number.isSafeInteger) || offset < 0 || limit < 1 || limit > 20 || textOffset < 0 || (textOffset && !input.entryId)) {
      throw new EngineError('invalid', t('memory.err.page'));
    }
    if (input.key !== undefined && (typeof input.key !== 'string' || !TOPIC_KEY_RE.test(input.key))) throw new MemoryError(t('memory.err.key'));
    const terms = String(input.query ?? '').toLowerCase().trim().split(/\s+/).filter(Boolean);
    const storage = [], matches = [];
    for (const scope of scopes) {
      const entries = await this.memory.list(scope);
      storage.push({ scope, budget: storageBudget(entries) });
      for (const entry of entries) {
        if (input.key !== undefined && entry.key !== input.key) continue;
        if (input.entryId !== undefined && entry.id !== input.entryId) continue;
        const hay = `${entry.key ?? ''} ${entry.text}`.toLowerCase();
        if (terms.length && !terms.some((term) => hay.includes(term))) continue;
        matches.push({ ...entry, scope, scopeName: scope === 'team' ? t('scope.team') : this.store.getBot(scope)?.name ?? scope });
      }
    }
    // Bound tool output separately from prompt injection. Legacy oversized entries can be read
    // losslessly in text chunks via entry_id + text_offset; these chunks must never be upserted.
    const result = { entries: [], total: matches.length, nextOffset: offset, storage, contextBudget: { limit: MEMORY_CONTEXT_MAX, unit: 'characters' } };
    for (const entry of matches.slice(offset, offset + limit)) {
      if (textOffset >= entry.text.length && textOffset !== 0) throw new EngineError('invalid', t('memory.err.page'));
      const viewFor = (length) => {
        const text = entry.text.slice(textOffset, textOffset + length);
        const nextTextOffset = textOffset + text.length < entry.text.length ? textOffset + text.length : null;
        return { ...entry, text, textOffset, nextTextOffset, textComplete: textOffset === 0 && nextTextOffset === null };
      };
      let view = viewFor(2000);
      const fits = (candidate) => JSON.stringify({ ...result, entries: [...result.entries, candidate], nextOffset: offset + result.entries.length + 1 < matches.length ? offset + result.entries.length + 1 : null }).length <= MEMORY_CONTEXT_MAX;
      if (!fits(view)) {
        if (result.entries.length) break;
        // JSON escaping can expand a legacy body beyond its raw length. Find a fitting
        // first chunk so pagination always advances and the original can be reconstructed.
        let low = 1, high = Math.min(2000, entry.text.length - textOffset), best = 0;
        while (low <= high) {
          const mid = Math.floor((low + high) / 2);
          if (fits(viewFor(mid))) { best = mid; low = mid + 1; } else high = mid - 1;
        }
        if (!best) throw new EngineError('invalid', t('memory.err.page'));
        view = viewFor(best);
      }
      result.entries.push(view);
    }
    result.nextOffset = offset + result.entries.length < matches.length ? offset + result.entries.length : null;
    return result;
  }

  // ---------------------------------------------------------------- schedules (user only)
  /** @param {{ id?: string, botId: string, prompt: string, name?: string, kind?: string, time?: string, everyMinutes?: number|string, inMinutes?: number|string, enabled?: boolean }} input */
  async saveSchedule(input) {
    const bot = this.resolveBot(input.botId);
    const prompt = String(input.prompt ?? '').trim();
    if (!prompt) throw new EngineError('invalid', t('err.schedulePrompt'));
    const list = this.store.state.schedules;
    const existing = input.id ? list.find((s) => s.id === input.id) : undefined;
    const kind = ['interval', 'once'].includes(String(input.kind)) ? String(input.kind) : 'daily';
    const time = String(input.time ?? '09:00');
    if (kind === 'daily' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      throw new EngineError('invalid', t('err.scheduleTime'));
    }
    const everyMinutes = Math.max(5, Math.min(7 * 24 * 60, Number(input.everyMinutes) || 60));
    let runAt = existing?.kind === 'once' ? existing.runAt : undefined;
    if (kind === 'once' && input.inMinutes !== undefined) {
      const minutes = Number(input.inMinutes);
      if (!Number.isFinite(minutes) || minutes < 1 || minutes > 7 * 24 * 60) {
        throw new EngineError('invalid', t('err.scheduleInMinutes'));
      }
      runAt = Date.now() + Math.round(minutes) * 60_000;
    }
    if (kind === 'once' && !runAt) throw new EngineError('invalid', t('err.scheduleInMinutes'));
    const schedule = existing ?? { id: newId('sch'), createdAt: Date.now() };
    if (!existing) list.push(schedule);
    Object.assign(schedule, {
      name: String(input.name ?? '').trim().slice(0, 40) || prompt.slice(0, 20),
      botId: bot.id,
      prompt: prompt.slice(0, 4000),
      kind,
      time,
      everyMinutes,
      runAt: kind === 'once' ? runAt : undefined,
      enabled: input.enabled !== false,
    });
    schedule.nextRunAt = nextRun(schedule, Date.now());
    await this.store.save();
    this.changed();
    return schedule;
  }

  /**
   * Which Bot a caller may schedule for: itself, or anyone if it is a main Bot (or the user).
   * @returns {any} bot
   */
  scheduleTarget(caller, targetBot) {
    if (!targetBot) {
      if (!caller) throw new EngineError('invalid', t('err.scheduleTargetRequired'));
      return caller;
    }
    const target = this.resolveBot(targetBot);
    if (caller && caller.id !== target.id && !caller.isMain) {
      throw new EngineError('forbidden', t('err.scheduleOthersForbidden'));
    }
    return target;
  }

  /** Schedules a caller may see or manage: its own; all of them for a main Bot or the user. */
  visibleSchedules(caller) {
    const all = this.store.state.schedules;
    return !caller || caller.isMain ? all : all.filter((s) => s.botId === caller.id);
  }

  async createScheduleFor(caller, input) {
    const bot = this.scheduleTarget(caller, input.targetBot);
    return this.saveSchedule({ ...input, id: undefined, botId: bot.id });
  }

  async deleteScheduleFor(caller, id) {
    const schedule = this.visibleSchedules(caller).find((s) => s.id === id);
    if (!schedule) throw new EngineError('not_found', t('err.scheduleNotFound', { id }));
    await this.deleteSchedule(id);
    return schedule;
  }

  async deleteSchedule(id) {
    this.store.state.schedules = this.store.state.schedules.filter((s) => s.id !== id);
    await this.store.save();
    this.changed();
  }

  // ---------------------------------------------------------------- read models
  teamSummary() {
    const { bots, groups } = this.store.state;
    return {
      bots: bots.map((bot) => ({
        bot_id: bot.id,
        name: bot.name,
        role: bot.role,
        main: bot.isMain,
        model: bot.model ? `${bot.model.providerId}/${bot.model.modelId}` : 'default',
        effort: (bot.model ? effortOf(bot.model) : bot.effort) ?? 'default',
      })),
      groups: groups.map((group) => ({
        group_id: group.id,
        name: group.name,
        notice: group.notice,
        admin: this.store.getBot(group.adminId)?.name,
        members: group.memberIds.map((id) => this.store.getBot(id)?.name).filter(Boolean),
        reply_mode: group.replyMode,
      })),
    };
  }
}
