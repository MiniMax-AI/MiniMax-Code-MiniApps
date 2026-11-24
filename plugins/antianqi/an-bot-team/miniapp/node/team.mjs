// @ts-check
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BOT_SKINS, SKIN_INK, effortOf, newId, normalizeEffort, normalizeFace, normalizeModel, normalizeSkin, skinForColor } from './store.mjs';
import { EngineError, nextRun } from './engine.mjs';
import { hopLimit } from './relay-guard.mjs';
import { AgentFileStore, eolOf, normalizeEol } from './agent-file.mjs';
import { BRIEF_BYTES_MAX } from './brief-budget.mjs';
import { renameWithRetry } from './fs-retry.mjs';
import { isDefaultText, resolveLocale, setLocale, t } from './i18n.mjs';

/** @typedef {import('./store.mjs').Store} Store */
/** @typedef {import('./memory.mjs').MemoryStore} MemoryStore */
/** @typedef {import('./engine.mjs').Engine} Engine */

/** The memory scopes a request may name. The MCP catalogue declares the same list. */
export const MEMORY_SCOPES = /** @type {const} */ (['self', 'team', 'bot']);

/** An uploaded avatar the page already scaled down; data URLs above this are refused. */
const MAX_AVATAR_BYTES = 512 * 1024;
/** An image file a Bot names by path; it is stored as-is, so it must already be small. */
const MAX_AVATAR_FILE_BYTES = 2 * 1024 * 1024;
const AVATAR_NAME_RE = /^[a-zA-Z0-9_-]+\.(png|jpe?g|webp|gif)$/;

/**
 * The name of a shared file. The zone holds one copy of the files every Bot carries, so a
 * Bot that wrote its own file under one of these names would shadow the zone for itself
 * alone. The name is refused as well as the zone's contents: a Bot may not grow a shadow
 * copy, not even before the zone exists.
 */
const SHARED_NAME_RE = /^shared-[A-Za-z0-9_-]{1,44}\.md$/;

/**
 * The names the common zone owns: the ENV and the USER of the whole team. A Bot that wrote
 * its own copy of one would shadow the copy the other three read, and the two would drift
 * apart - so the name is refused even before the common file exists.
 */
const COMMON_NAME_RE = /^(ENV|USER)\.md$/i;

/** The kinds a scheduled task can have — the ones the catalogue offers. */
const SCHEDULE_KINDS = /** @type {readonly string[]} */ (['daily', 'interval', 'once']);
/** Who answers in a group: the admin alone, or every member. */
const REPLY_MODES = /** @type {readonly string[]} */ (['admin', 'all']);

/**
 * The kind of a scheduled task. A kind the catalogue does not offer is refused: any other kind
 * would quietly run at a time the user never asked for.
 * @param {unknown} value
 * @returns {'daily' | 'interval' | 'once'}
 */
function scheduleKindOf(value) {
  const kind = String(value);
  if (!SCHEDULE_KINDS.includes(kind)) {
    throw new EngineError('invalid', t('err.scheduleKind', { allowed: SCHEDULE_KINDS.join(', ') }));
  }
  return /** @type {'daily' | 'interval' | 'once'} */ (kind);
}

/**
 * Who answers in a group. A mode the catalogue does not offer is refused: the other mode would
 * quietly change who hears the Bots.
 * @param {unknown} value
 * @returns {'admin' | 'all'}
 */
function replyModeOf(value) {
  const mode = String(value);
  if (!REPLY_MODES.includes(mode)) {
    throw new EngineError('invalid', t('err.replyMode', { allowed: REPLY_MODES.join(', ') }));
  }
  return /** @type {'admin' | 'all'} */ (mode);
}

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
    this.agentFiles = deps.agentFiles ?? new AgentFileStore(this.store.dir);
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
   * existing gallery file name. `null` / `''` / `default` mean "back to
   * the octopus" and return `undefined`. Anything else is refused: a path on this computer is
   * not an avatar source, so no file outside this Mini App's data directory is ever read.
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
      // A file path is not an avatar source: the plugin only ever reads its own gallery, so a
      // path can neither pull a file in from elsewhere on this computer nor name one out loud.
      throw new EngineError('invalid', t('err.badAvatar'));
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
      // The name is the hash of the picture, so several imports of one picture land on one
      // file; the rename waits out the moment another writer holds it open.
      await renameWithRetry(temp, join(dir, name));
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
      replyMode: input.replyMode === undefined ? 'admin' : replyModeOf(input.replyMode),
      pinned: false,
      createdAt: Date.now(),
      // F7 · the relay guardrails. The hop limit counts how many Bots may speak in one relay
      // chain; 0 means "no limit", which is the baseline behaviour. The hand-over carries the
      // conclusion of the previous hop into the next one. Both are off unless the group asks.
      maxHops: hopLimit({ maxHops: input.maxHops }),
      handover: input.handover === true,
      // The group's note: a short record of what the Bots said at the end of the earlier rounds,
      // handed to every Bot of the group. It is off unless the operator asks for it, and only the
      // operator can ask for it — the MCP catalogue does not offer it.
      notes: input.notes === true,
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
    if (patch.replyMode !== undefined) draft.replyMode = replyModeOf(patch.replyMode);
    if (patch.pinned !== undefined) draft.pinned = Boolean(patch.pinned);
    // The relay guardrails: absent leaves the group's own setting alone. 0 = no limit.
    if (patch.maxHops !== undefined) draft.maxHops = hopLimit({ maxHops: patch.maxHops });
    if (patch.handover !== undefined) draft.handover = Boolean(patch.handover);
    // The group's note: the switch and the record are both the operator's. Switching it off
    // stops the recording and stops handing the record to the Bots; the record itself stays
    // until it is cleared. (The relay hand-over has its own switch, this one does not touch it.)
    if (patch.notes !== undefined) draft.notes = Boolean(patch.notes);
    if (patch.clearNotes === true) draft.noteEntries = [];
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

  // ---------------------------------------------------------------- agent files
  /**
   * Which Bot's identity files a caller may touch: its own, or anyone's for the user, a main
   * Bot or an external agent.
   */
  agentFileTarget(caller, ref) {
    if (!ref) {
      if (!caller || caller.external) throw new EngineError('invalid', t('err.agentFileTargetRequired'));
      return caller;
    }
    const target = this.resolveBot(ref);
    if (caller && !caller.isMain && caller.id !== target.id) {
      throw new EngineError('forbidden', t('err.otherAgentFileForbidden'));
    }
    return target;
  }

  /** Every Bot the roster knows. */
  bots() {
    return this.store.state.bots;
  }

  async listAgentFiles(caller, input) {
    const target = this.agentFileTarget(caller, input.bot);
    const files = await this.agentFiles.list(target.id);
    // The common files are the ones all four Bots read: one copy, listed for every Bot.
    const common = await this.agentFiles.listCommon();
    // The shared files are listed too: they are part of what this Bot reads.
    const shared = await this.agentFiles.listShared();
    return { bot_id: target.id, bot: target.name, files, common, shared };
  }

  async readAgentFile(caller, input) {
    const target = this.agentFileTarget(caller, input.bot);
    const text = await this.agentFiles.read(target.id, input.name);
    if (text !== undefined) return { bot_id: target.id, bot: target.name, name: input.name, text, eol: eolOf(text) };
    // The common files are one copy for the whole team, so every Bot reads the same one.
    const commonText = await this.agentFiles.readCommon(input.name);
    if (commonText !== undefined) {
      return { bot_id: target.id, bot: target.name, name: input.name, text: commonText, eol: eolOf(commonText), common: true };
    }
    // A shared file is readable by every Bot - it is one file for all of them.
    const sharedText = await this.agentFiles.readShared(input.name);
    if (sharedText !== undefined) {
      return { bot_id: target.id, bot: target.name, name: input.name, text: sharedText, eol: eolOf(sharedText), shared: true };
    }
    throw new EngineError('not_found', t('err.agentFileMissing', { name: input.name }));
  }

  /**
   * The bytes a Bot's agent port carries, measured with the engine that builds it: the files
   * on disk are not the prompt, the engine wraps them and adds the shared cards. The ceiling
   * covers this block, so the standing brief is not part of the number.
   * @param {any} bot
   * @returns {Promise<number>}
   */
  async briefBytes(bot) {
    if (!this.engine?.buildAgentBrief) return 0;
    const brief = await this.engine.buildAgentBrief(bot);
    return Buffer.byteLength(brief, 'utf8');
  }

  /**
   * A write that would push the Bot past its prompt ceiling is refused before it lands.
   * The ceiling is a fact about what the agent port carries, so it is enforced here - where
   * the write happens - and the page shows the same number, so the refusal is never a
   * surprise.
   * @param {any} bot
   * @param {string} name
   * @param {string} text
   */
  async refuseOverBudget(bot, name, text) {
    const before = await this.briefBytes(bot);
    if (!before) return;
    const old = await this.agentFiles.read(bot.id, name);
    const oldBytes = old === undefined ? 0 : Buffer.byteLength(old, 'utf8');
    // The bytes that will land are the ones the file keeps, so the ceiling is measured on the
    // text as it is written and not on the text as it is sent.
    const body = normalizeEol(text, old);
    const projected = before - oldBytes + Buffer.byteLength(body, 'utf8');
    if (projected > BRIEF_BYTES_MAX) {
      throw new EngineError('brief_over_budget', t('err.briefOverBudget', { used: projected, limit: BRIEF_BYTES_MAX }));
    }
  }

  async writeAgentFile(caller, input) {
    const target = this.agentFileTarget(caller, input.bot);
    // A shared file belongs to the host. A Bot that wrote its own copy would drift away
    // from the copy every other Bot reads - and its own copy would shadow the zone for
    // that Bot alone, so the name is refused as well as the zone's contents.
    if (SHARED_NAME_RE.test(String(input.name ?? '')) || await this.agentFiles.hasShared(input.name)) {
      throw new EngineError('forbidden', t('err.sharedFileWriteForbidden', { name: input.name }));
    }
    // The same goes for the common files: a Bot that wrote its own ENV.md or USER.md would
    // shadow the copy the other three read, and the two would drift apart.
    if (COMMON_NAME_RE.test(String(input.name ?? '')) || await this.agentFiles.hasCommon(input.name)) {
      throw new EngineError('forbidden', t('err.commonFileWriteForbidden', { name: input.name }));
    }
    // The ceiling is checked before the write, so a refused write leaves the file as it was.
    await this.refuseOverBudget(target, input.name, String(input.text ?? ''));
    const result = await this.agentFiles.write(target.id, input.name, input.text);
    this.changed();
    return { bot_id: target.id, bot: target.name, name: result.name, bytes: result.bytes };
  }

  /**
   * The common files: the ENV and the USER every Bot reads. One copy for the whole
   * team, so the page shows them under the common option and not under a Bot.
   */
  async listCommonFiles(caller) {
    const files = await this.agentFiles.listCommon();
    const shared = await this.agentFiles.listShared();
    return { scope: 'common', files, shared };
  }

  async readCommonFile(caller, input) {
    const text = await this.agentFiles.readCommon(input.name);
    if (text === undefined) throw new EngineError('not_found', t('err.agentFileMissing', { name: input.name }));
    return { scope: 'common', name: input.name, text, eol: eolOf(text) };
  }

  /**
   * A common file lands in every Bot's prompt, so the ceiling is checked for every Bot:
   * the tightest one decides whether the write goes through.
   * @param {string} name
   * @param {string} text
   */
  async refuseCommonOverBudget(name, text) {
    const old = await this.agentFiles.readCommon(name);
    const oldBytes = old === undefined ? 0 : Buffer.byteLength(old, 'utf8');
    const body = normalizeEol(text, old);
    const newBytes = Buffer.byteLength(body, 'utf8');
    let tightest = null;
    for (const bot of this.store.state.bots) {
      const before = await this.briefBytes(bot);
      if (!before) continue;
      const projected = before - oldBytes + newBytes;
      if (projected > BRIEF_BYTES_MAX) {
        throw new EngineError('brief_over_budget', t('err.briefOverBudgetCommon', { who: bot.name, used: projected, limit: BRIEF_BYTES_MAX }));
      }
      if (!tightest || projected > tightest.bytes) tightest = { bot: bot.name, bot_id: bot.id, bytes: projected };
    }
    return { body, tightest };
  }

  async writeCommonFile(caller, input) {
    const name = String(input.name ?? '');
    const { body, tightest } = await this.refuseCommonOverBudget(name, String(input.text ?? ''));
    const result = await this.agentFiles.writeCommon(name, body);
    this.changed();
    return { scope: 'common', name: result.name, bytes: result.bytes, tightest };
  }

  // ---------------------------------------------------------------- schedules (user only)
  /** @param {{ id?: string, botId: string, prompt: string, name?: string, kind?: string, time?: string, everyMinutes?: number|string, inMinutes?: number|string, enabled?: boolean }} input */
  async saveSchedule(input) {
    const bot = this.resolveBot(input.botId);
    const prompt = String(input.prompt ?? '').trim();
    if (!prompt) throw new EngineError('invalid', t('err.schedulePrompt'));
    const list = this.store.state.schedules;
    const existing = input.id ? list.find((s) => s.id === input.id) : undefined;
    // No kind at all is the daily default. A kind that is not one of the three is refused:
    // another kind would run at a time the user never asked for.
    const kind = input.kind === undefined ? 'daily' : scheduleKindOf(input.kind);
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
    // Only the user, or an outside agent acting for them, schedules. A Bot that may schedule
    // itself re-arms its own reminder and takes slots away from the work it was meant to serve.
    if (caller && !caller.external) throw new EngineError('forbidden', t('err.scheduleBotForbidden'));
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
