// @ts-check
// The identity files of a Bot. Each Bot owns a directory of its own; the files inside it are
// that Bot's standing instructions — who it is, what it may do, how it talks — and they travel
// into that Bot's own prompt and nowhere else.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { renameWithRetry } from './fs-retry.mjs';

/** The protocol marks the agent block opens and closes with. */
export const AGENT_BLOCK_MARK = '<minimax-bot-agent>';
export const AGENT_BLOCK_END = '</minimax-bot-agent>';

/** The files a Bot usually owns. Any other safe `.md` name is accepted as well. */
export const AGENT_FILES = Object.freeze(['AGENTS.md', 'IDENTITY.md', 'SOUL.md', 'USER.md', 'ENV.md']);

/** A file name the store accepts: letters, digits, dash, underscore, then `.md`. */
export const AGENT_FILE_RE = /^[A-Za-z0-9_-]{1,48}\.md$/;

/**
 * The line ending a body uses: CRLF when it has one, LF otherwise.
 * @param {string | undefined} text
 * @returns {'crlf' | 'lf'}
 */
export function eolOf(text) {
  return /\r\n/.test(String(text ?? '')) ? 'crlf' : 'lf';
}

/**
 * The body as it is written: the line ending the file already uses, CRLF for a file that does
 * not exist yet. A browser textarea hands back LF whatever the file holds, so without this a
 * save would rewrite the endings of a file the user never touched.
 * @param {string} text
 * @param {string | undefined} existing
 */
export function normalizeEol(text, existing) {
  const lf = String(text ?? '').replace(/\r\n/g, '\n');
  const style = existing === undefined ? 'crlf' : eolOf(existing);
  return style === 'lf' ? lf : lf.replace(/\n/g, '\r\n');
}

/**
 * A shared card may name the Bots it is written for. The names are the ones the runtime
 * knows the Bots by, so a card can be addressed to part of the team instead of all of it.
 * A card that names nobody is read by every Bot, as before.
 */
export const SHARED_AUDIENCE_RE = /<!--\s*audience\s*:\s*([^>]*?)\s*-->/i;

/** The Bots a shared card is written for, or null when it names none. */
export function sharedAudience(text) {
  const match = SHARED_AUDIENCE_RE.exec(String(text ?? '').slice(0, 4096));
  if (!match) return null;
  const names = match[1].split(/[,、\s]+/).map((one) => one.trim()).filter(Boolean);
  return names.length ? names : null;
}

/** One agent file may not grow past this. */
export const AGENT_FILE_MAX = 64 * 1024;

export class AgentFileError extends Error {
  constructor(message, code = 'agent_file_invalid', details = {}) {
    super(message);
    this.name = 'AgentFileError';
    this.code = code;
    this.details = details;
  }
}

export class AgentFileStore {
  /** @param {string} dataDir */
  constructor(dataDir) {
    this.dir = join(dataDir, 'agents');
    // The shared zone sits beside the Bot directories: the files every Bot carries are
    // written once there instead of once per Bot.
    this.sharedDir = join(dataDir, 'shared');
    // The common files sit beside them: the ENV and the USER every Bot reads, one copy
    // for the whole team.
    this.commonDir = join(dataDir, 'common');
  }

  async init() {
    await mkdir(this.dir, { recursive: true });
    await mkdir(this.sharedDir, { recursive: true });
    await mkdir(this.commonDir, { recursive: true });
  }

  /** The directory of one Bot. The id is checked, so it can never point outside the store. */
  dirFor(botId) {
    const id = String(botId ?? '');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      throw new AgentFileError('Invalid Bot id: ' + id, 'agent_file_bot');
    }
    return join(this.dir, id);
  }

  /** The path of one file. The name is checked too, so it can never leave the Bot's own directory. */
  filePath(botId, name) {
    const file = String(name ?? '');
    if (!AGENT_FILE_RE.test(file)) {
      throw new AgentFileError('Invalid agent file name: ' + file, 'agent_file_name');
    }
    return join(this.dirFor(botId), file);
  }

  /** The files a Bot owns, sorted. */
  async list(botId) {
    const entries = await readdir(this.dirFor(botId), { withFileTypes: true }).catch((error) => {
      if (error?.code === 'ENOENT') return [];
      throw error;
    });
    return entries
      .filter((entry) => entry.isFile() && AGENT_FILE_RE.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  }

  /** The content of one file, or `undefined` when the Bot does not own it. */
  async read(botId, name) {
    try {
      return await readFile(this.filePath(botId, name), 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  /** Every file of a Bot, with its content. */
  async readAll(botId) {
    const names = await this.list(botId);
    const files = [];
    for (const name of names) {
      const text = await this.read(botId, name);
      if (text !== undefined) files.push({ name, text });
    }
    return files;
  }

  /**
   * The body as it is written, and the two checks it has to pass.
   * @param {string} text
   * @param {string | undefined} existing
   */
  prepareBody(text, existing) {
    // The file keeps the line ending it already uses. The page hands the text back with LF
    // whatever the file holds, and a save that rewrote the endings would turn a CRLF file
    // into an LF one, which the tree's own checker calls a corruption.
    const body = normalizeEol(text, existing);
    if (!body.trim()) throw new AgentFileError('The agent file is empty', 'agent_file_empty');
    const bytes = Buffer.byteLength(body, 'utf8');
    if (bytes > AGENT_FILE_MAX) {
      throw new AgentFileError('The agent file is larger than ' + AGENT_FILE_MAX + ' bytes', 'agent_file_too_large');
    }
    return { body, bytes };
  }

  /** Writes a file. The write is atomic, so a reader never sees half a file. */
  async write(botId, name, text) {
    const path = this.filePath(botId, name);
    const existing = await this.read(botId, name);
    const { body, bytes } = this.prepareBody(text, existing);
    await mkdir(this.dirFor(botId), { recursive: true });
    // The temporary name carries a unique part: two writers of one file never share it.
    const temp = path + '.' + randomUUID() + '.tmp';
    await writeFile(temp, body, 'utf8');
    await renameWithRetry(temp, path);
    return { name, bytes };
  }

  /** The path of a common file: the team's own ENV and USER, one copy for every Bot. */
  commonPath(name) {
    const file = String(name ?? '');
    if (!AGENT_FILE_RE.test(file)) throw new AgentFileError('Invalid common file name: ' + file, 'agent_file_name');
    return join(this.commonDir, file);
  }

  /** The common files, sorted. */
  async listCommon() {
    const entries = await readdir(this.commonDir, { withFileTypes: true }).catch((error) => {
      if (error?.code === 'ENOENT') return [];
      throw error;
    });
    return entries
      .filter((entry) => entry.isFile() && AGENT_FILE_RE.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  }

  /** The content of one common file, or `undefined` when there is none. */
  async readCommon(name) {
    try {
      return await readFile(this.commonPath(name), 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  /** Whether a common file of that name exists. */
  async hasCommon(name) {
    return (await this.listCommon()).includes(String(name));
  }

  /** Every common file, with its content. */
  async readAllCommon() {
    const names = await this.listCommon();
    const files = [];
    for (const name of names) {
      const text = await this.readCommon(name);
      if (text !== undefined) files.push({ name, text });
    }
    return files;
  }

  /** Writes a common file. The write is atomic, like every other identity file. */
  async writeCommon(name, text) {
    const path = this.commonPath(name);
    const existing = await this.readCommon(name);
    const { body, bytes } = this.prepareBody(text, existing);
    await mkdir(this.commonDir, { recursive: true });
    const temp = path + '.' + randomUUID() + '.tmp';
    await writeFile(temp, body, 'utf8');
    await renameWithRetry(temp, path);
    return { name, bytes };
  }

  /** The shared zone lives beside the Bot directories, so it gets its own path check. */
  sharedPath(name) {
    const file = String(name ?? '');
    if (!AGENT_FILE_RE.test(file)) throw new AgentFileError('Invalid shared file name: ' + file, 'agent_file_name');
    return join(this.sharedDir, file);
  }

  /** The shared files, sorted. */
  async listShared() {
    const entries = await readdir(this.sharedDir, { withFileTypes: true }).catch((error) => {
      if (error?.code === 'ENOENT') return [];
      throw error;
    });
    return entries
      .filter((entry) => entry.isFile() && AGENT_FILE_RE.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  }

  /** The text of one shared file, or undefined when the zone does not carry it. */
  async readShared(name) {
    try {
      return await readFile(this.sharedPath(name), 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  /**
   * Every shared file, with its content. A card that names an audience is read only by
   * those Bots; a card that names none is read by every Bot, as before.
   *
   * @param {string[] | null} audience the names the caller is known by
   */
  async readAllShared(audience = null) {
    const names = await this.listShared();
    const wanted = Array.isArray(audience) ? audience.filter(Boolean) : [];
    const files = [];
    for (const name of names) {
      const text = await this.readShared(name);
      if (text === undefined) continue;
      const forWhom = sharedAudience(text);
      if (forWhom && wanted.length && !forWhom.some((who) => wanted.includes(who))) continue;
      files.push({ name, text });
    }
    return files;
  }

  /** Whether the zone carries a file under that name. */
  async hasShared(name) {
    return (await this.listShared()).includes(String(name));
  }

  /** Removes a file. Returns whether there was one. */
  async remove(botId, name) {
    try {
      await rm(this.filePath(botId, name));
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }
}
