/**
 * The desktop's own Bot data.
 *
 * The team tools answer with a summary: an id, a name, a role, a model. That is
 * enough to list a team, but not to *show* one — the look a Bot wears, its face, its
 * own picture and the artwork behind that look all live in the MiniMax Bot app's own
 * files on this desktop.
 *
 * So this module reads them there, read-only: the desktop keeps the only copy of the
 * team, and the phone shows the very same Bot the desktop shows. Nothing is copied
 * into the app; the picture is asked for over the link and travels as bytes.
 *
 * Every lookup fails soft. A desktop without the Bot app, an older layout, a missing
 * picture — all of them mean "no picture", never a broken screen.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { desktopMessage, desktopTurn } from './desktop-turn.mjs';

/** The plugin id of the MiniMax Bot app. */
const BOT_PLUGIN_ID = 'minimax-bot';

/** The name of the Bot app's own state file. */
const STATE_FILE = 'state.json';

/** Where the Bot app keeps the pictures its Bots uploaded themselves. */
const AVATAR_DIR = 'avatars';

/**
 * A look id, e.g. `fuzzy`.
 *
 * The id names a file on the desktop, so it is restricted to a plain word: nothing
 * that could walk out of the skins folder.
 */
const SKIN_ID = /^[a-z][a-z0-9_-]{0,31}$/;

/** The name of an uploaded picture. */
const AVATAR_FILE = /^[A-Za-z0-9_-]+\.(?:png|jpe?g|webp|gif)$/i;

/**
 * The Bot app's data directory: the sibling of this bridge's own directory.
 *
 * The runtime keeps one directory per Mini App, named after the plugin, so the Bot
 * app's data sits next to ours rather than inside it.
 */
export function botDataDir(context) {
  return resolve(context.dataDir, '..', BOT_PLUGIN_ID);
}

/**
 * The name of the file a conversation is kept in.
 *
 * The Bot app names a conversation's file after the conversation, with everything that
 * is not a plain word character turned into an underscore. The same rule is used here,
 * so that the phone reads the very file the desktop writes.
 */
function messageFile(chatId) {
  return `${chatId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
}

/**
 * The conversation the desktop holds, in the protocol's shape.
 *
 * The desktop's own transcript is the record of what was said: it survives a restart of
 * anything, and it is the same conversation the desktop shows. The phone reads it
 * read-only — the desktop's copy is never touched — and a turn the bridge runs on the
 * desktop itself is not in it, which is why the two are read together.
 *
 * A Bot's turn is one record on the desktop that holds the whole exchange, so it
 * reaches the phone as the messages and the tool calls that record holds.
 *
 * @param {any} context the Mini App context
 * @param {string} chatId `bot:<botId>` or `group:<groupId>`
 * @returns {Promise<{messages: Array<import('./contracts.d.ts').ChatMessage>, activity: Array<import('./contracts.d.ts').TurnActivity>}>}
 */
export async function desktopMessages(context, chatId) {
  const records = await readDesktopRecords(context, chatId);
  const messages = [];
  const activity = [];
  for (const record of records) {
    if (record?.role === 'bot') {
      const turn = desktopTurn(record);
      messages.push(...turn.messages);
      activity.push(...turn.activity);
      continue;
    }
    const message = desktopMessage(record, chatId);
    if (message.messageId) messages.push(message);
  }
  return { messages, activity };
}

/**
 * One turn of the desktop's own transcript, by the id of its record.
 *
 * A turn the team ran is written into the desktop's transcript, and the id of that
 * record comes back with the turn's receipt, so the exact exchange the desktop shows
 * can be read back and shown on the phone.
 *
 * @param {any} context the Mini App context
 * @param {string} chatId `bot:<botId>` or `group:<groupId>`
 * @param {string} messageId the id of the record the turn wrote
 * @returns {Promise<{messages: Array<import('./contracts.d.ts').ChatMessage>, activity: Array<import('./contracts.d.ts').TurnActivity>} | undefined>}
 */
export async function desktopTurnById(context, chatId, messageId) {
  if (typeof messageId !== 'string' || !messageId) return undefined;
  const records = await readDesktopRecords(context, chatId);
  const record = records.find((entry) => entry?.id === messageId);
  if (!record) return undefined;
  return desktopTurn(record);
}

/**
 * One turn of the desktop's own transcript, by the task it ran under.
 *
 * A turn can be written as more than one record — a group can have more than one Bot
 * answer — and those records share the task the turn ran under, so the task finds the
 * whole exchange of that turn.
 *
 * @param {any} context the Mini App context
 * @param {string} chatId `bot:<botId>` or `group:<groupId>`
 * @param {string} taskId the task the turn ran under
 * @returns {Promise<{messages: Array<import('./contracts.d.ts').ChatMessage>, activity: Array<import('./contracts.d.ts').TurnActivity>} | undefined>}
 */
export async function desktopTurnsByTask(context, chatId, taskId) {
  if (typeof taskId !== 'string' || !taskId) return undefined;
  const records = await readDesktopRecords(context, chatId);
  const mine = records.filter((entry) => entry?.role === 'bot' && entry?.taskId === taskId);
  if (mine.length === 0) return undefined;
  const messages = [];
  const activity = [];
  for (const record of mine) {
    const turn = desktopTurn(record);
    messages.push(...turn.messages);
    activity.push(...turn.activity);
  }
  return { messages, activity };
}

/**
 * The records the desktop keeps for one conversation.
 *
 * Every read fails soft: a desktop without the Bot app, a conversation that was never
 * had, an older layout — all of them mean "nothing to read", never a broken screen.
 */
async function readDesktopRecords(context, chatId) {
  if (typeof chatId !== 'string' || !chatId) return [];
  try {
    const raw = await readFile(join(botDataDir(context), 'messages', messageFile(chatId)), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * The Bot app's live team state, or `undefined` when it cannot be read.
 *
 * The state is the desktop's own record of the team: who is on it, what each one is
 * for, and what each one looks like.
 */
export async function readDesktopState(context) {
  try {
    const raw = await readFile(join(botDataDir(context), STATE_FILE), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The team as the desktop holds it, in the protocol's shape.
 *
 * Only the fields the phone shows are carried over: the look, the face, the colour,
 * the Bot's own picture and what it is for.
 */
export function desktopBots(state) {
  const bots = Array.isArray(state?.bots) ? state.bots : [];
  return bots
    .map((bot) => ({
      botId: typeof bot?.id === 'string' ? bot.id : '',
      name: typeof bot?.name === 'string' ? bot.name : '',
      role: typeof bot?.role === 'string' && bot.role ? bot.role : undefined,
      instructions: typeof bot?.instructions === 'string' && bot.instructions ? bot.instructions : undefined,
      skin: typeof bot?.skin === 'string' && bot.skin ? bot.skin : undefined,
      color: typeof bot?.color === 'string' && bot.color ? bot.color : undefined,
      face: typeof bot?.face === 'string' && bot.face ? bot.face : undefined,
      avatar: typeof bot?.avatar === 'string' && bot.avatar ? bot.avatar : undefined,
      isMain: bot?.isMain === true,
    }))
    .filter((bot) => bot.botId);
}

/**
 * The Host session a Bot last answered in, for one conversation.
 *
 * The desktop keeps a session per chat and Bot: it is what lets a Bot remember what it
 * was told. Reading it here is read-only.
 *
 * The bridge does not run a phone's turn in this session. That session belongs to
 * whatever the user was doing on the desktop — a coding conversation, most of the time —
 * and a phone message dropped into it is answered in the middle of that conversation.
 *
 * @param {any} state the desktop's state
 * @param {string} chatId `bot:<botId>` or `group:<groupId>`
 * @param {string} botId
 * @returns {string | undefined}
 */
export function desktopBotSession(state, chatId, botId) {
  const sessions = state?.sessions;
  if (!sessions || typeof sessions !== 'object') return undefined;
  const forChat = sessions[chatId];
  if (!forChat || typeof forChat !== 'object') return undefined;
  const sessionId = forChat[botId];
  return typeof sessionId === 'string' && sessionId ? sessionId : undefined;
}

/**
 * The groups as the desktop holds them, in the protocol's shape.
 *
 * The desktop knows the members by id; the phone needs those ids to open a group
 * chat, so they are carried over as they are.
 */
export function desktopGroups(state) {
  const groups = Array.isArray(state?.groups) ? state.groups : [];
  return groups
    .map((group) => ({
      groupId: typeof group?.id === 'string' ? group.id : '',
      name: typeof group?.name === 'string' ? group.name : '',
      admin: typeof group?.adminId === 'string' ? group.adminId : undefined,
      memberIds: Array.isArray(group?.memberIds)
        ? group.memberIds.filter((id) => typeof id === 'string')
        : [],
      notice: typeof group?.notice === 'string' && group.notice ? group.notice : undefined,
      replyMode: group?.replyMode === 'all' || group?.replyMode === 'admin' ? group.replyMode : undefined,
    }))
    .filter((group) => group.groupId);
}

/**
 * The picture of the Bot app's client files.
 *
 * The Bot app renders every look from its own artwork, so the file that matches a
 * look is the picture the desktop shows.
 */
async function findSkinFile(context, skin) {
  if (!SKIN_ID.test(skin)) return undefined;

  // The runtime's cache of official plugins, one directory per plugin version.
  const cache = resolve(context.dataDir, '..', '..', '..', 'plugin-cache', 'official');
  let entries;
  try {
    entries = await readdir(cache, { withFileTypes: true });
  } catch {
    return undefined;
  }

  let best;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const root = join(cache, entry.name);
    const file = join(root, 'miniapp', 'client', 'skins', `${skin}.png`);
    const info = await stat(file).catch(() => undefined);
    if (!info?.isFile()) continue;
    // Only the Bot app's own artwork counts: another plugin may carry a file with
    // the same name for a different picture.
    if (!(await isBotPlugin(root))) continue;
    const mtime = (await stat(root).catch(() => undefined))?.mtimeMs ?? 0;
    if (!best || mtime > best.mtime) best = { file, mtime };
  }
  return best?.file;
}

/** Whether a cached plugin directory holds the MiniMax Bot app. */
async function isBotPlugin(root) {
  try {
    const manifest = JSON.parse(await readFile(join(root, 'miniapp', 'miniapp.json'), 'utf8'));
    const servers = Array.isArray(manifest?.mcpEndpoints)
      ? manifest.mcpEndpoints.map((endpoint) => endpoint?.server)
      : [];
    if (servers.includes(BOT_PLUGIN_ID)) return true;
    return manifest?.surface?.path === `/${BOT_PLUGIN_ID}`;
  } catch {
    return false;
  }
}

/** The kind of image the bytes hold, from the bytes themselves. */
export function mimeOf(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return 'application/octet-stream';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer.subarray(0, 3).toString('latin1') === 'GIF') return 'image/gif';
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  return 'application/octet-stream';
}

/**
 * The picture a Bot shows, read from the desktop.
 *
 * A Bot that has a picture of its own shows that. A Bot that wears a look shows the
 * artwork of that look. A Bot with neither has no picture, and the phone draws its
 * octopus instead.
 */
export async function readBotPicture(context, bot) {
  if (!bot) return undefined;

  // The Bot's own picture, uploaded on the desktop.
  const avatarName = typeof bot.avatar === 'string' ? bot.avatar : '';
  if (AVATAR_FILE.test(avatarName)) {
    const file = join(botDataDir(context), AVATAR_DIR, avatarName);
    const buffer = await readFile(file).catch(() => undefined);
    if (buffer?.length) return { buffer, mime: mimeOf(buffer), source: 'avatar' };
  }

  // The artwork of the look the Bot wears.
  const skin = typeof bot.skin === 'string' ? bot.skin : '';
  if (!skin) return undefined;
  const file = await findSkinFile(context, skin);
  if (!file) return undefined;
  const buffer = await readFile(file).catch(() => undefined);
  if (!buffer?.length) return undefined;
  return { buffer, mime: mimeOf(buffer), source: 'skin' };
}
