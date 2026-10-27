// @ts-check
import { execFile } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import { createServer } from 'node:http';
import { extname, isAbsolute, join } from 'node:path';

import { createHash } from 'node:crypto';
import { Engine, EngineError, UPLOAD_NAME_RE } from './engine.mjs';
import { NOTE_MAX_CHARS, NOTE_MAX_ENTRIES, noteEntries } from './group-note.mjs';
import { createMcpHandler } from './mcp.mjs';
import { LANGUAGE_PREFS, locale, matchLocale, t } from './i18n.mjs';
import { memoryBudget, MemoryError, MemoryStore } from './memory.mjs';
import { MEMORY_CONTEXT_MAX } from './memory-context.mjs';
import { Store } from './store.mjs';
import { Team } from './team.mjs';
import { ReactionError } from './reactions.mjs';
import { markdownDocument, HTML_PREVIEW_CSP, MARKDOWN_PREVIEW_CSP } from './document-preview.mjs';

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */

export const USER_NAME_MAX = 24;

/**
 * The account's display name: the macOS full name (`id -F`), otherwise the login name. The Host
 * exposes no user identity to Mini Apps, so this is the best default; the user can override it.
 * @returns {Promise<string>}
 */
function osUserName() {
  let login = '';
  try {
    login = userInfo().username;
  } catch {
    /* no passwd entry */
  }
  if (process.platform !== 'darwin') return Promise.resolve(login);
  return new Promise((resolve) => {
    execFile('id', ['-F'], { timeout: 1500 }, (error, stdout) => {
      const full = String(stdout ?? '').trim();
      resolve(!error && full ? full : login);
    });
  });
}
/** @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle */

const STATIC_TYPES = {
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
};
/** Maps a page path to a client file; only flat, known-extension names are served. */
function staticFile(path) {
  if (path === '/bot' || path === '/bot/') return ['index.html', 'text/html; charset=utf-8'];
  const skin = /^\/bot\/skins\/([a-z]+)\.png$/.exec(path);
  if (skin) return [`skins/${skin[1]}.png`, STATIC_TYPES.png];
  const match = /^\/bot\/([a-z0-9-]+)\.(js|css|svg)$/.exec(path);
  return match ? [`${match[1]}.${match[2]}`, STATIC_TYPES[match[2]]] : undefined;
}
const MAX_BODY = 1024 * 1024;

/** Types the page can show inline; anything else is offered as a download. */
const MEDIA_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.flac': 'audio/flac',
  '.pdf': 'application/pdf',
};
const MAX_MEDIA_BYTES = 1024 * 1024 * 1024;
/** One attached file. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** A file name safe to keep on disk and show back: no path parts, controls or leading dots. */
function safeUploadName(raw) {
  const base = String(raw ?? '').split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').replace(/^\.+/, '').trim().slice(0, 140);
  return clean || 'file';
}

/** Whether a Bot (or a relay) in this chat named `src` in its text — the only files /api/media serves. */
function chatReferences(messages, src) {
  return messages.some((m) => {
    if (m.role !== 'bot' && m.role !== 'relay') return false;
    if (typeof m.text === 'string' && m.text.includes(src)) return true;
    return (m.parts ?? []).some((part) => typeof part?.text === 'string' && part.text.includes(src));
  });
}

/**
 * @param {MiniAppContext} context
 * @returns {Promise<MiniAppLifecycle>}
 */
export async function start(context) {
  const clientDir = join(context.pluginRoot, 'miniapp/client');
  const store = new Store(context.dataDir);
  const memory = new MemoryStore(context.dataDir);
  await store.init();
  await memory.init();
  const systemUserName = (await osUserName()).slice(0, USER_NAME_MAX);

  /** @type {Set<import('node:http').ServerResponse>} */
  const clients = new Set();
  const broadcast = (event) => {
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of clients) {
      try {
        client.write(frame);
      } catch {
        clients.delete(client);
      }
    }
  };

  const engine = new Engine({ store, memory, agent: context.agent, logger: context.logger, broadcast });
  const team = new Team({ store, memory, engine, broadcast });
  const handleMcp = createMcpHandler({ team, engine });

  const json = (response, status, value) => {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(JSON.stringify(value));
  };

  const snapshot = () => ({
    bots: store.state.bots,
    // A group's note is shown in the panel exactly as the Bots get it: the cleaned and bounded
    // list, not whatever the state file happens to hold.
    groups: store.state.groups.map((group) => (
      Array.isArray(group.noteEntries) ? { ...group, noteEntries: noteEntries(group) } : group
    )),
    // The limits of a group note, so the panel can state them instead of writing down numbers
    // that would drift away from the ones the plugin uses.
    noteLimits: { entries: NOTE_MAX_ENTRIES, chars: NOTE_MAX_CHARS },
    schedules: store.state.schedules,
    helpers: engine.helpersList(),
    tasks: engine.tasks.uiList(),
    busyChats: engine.busyChats(),
    turns: engine.turnsList(),
    chats: Object.fromEntries(
      Object.entries(store.summaries()).map(([chatId, summary]) => [
        chatId,
        { ...summary, pending: summary.pending || [...engine.approvals.values()].some((a) => a.chatId === chatId) },
      ]),
    ),
    approvals: [...engine.approvals.values()],
    sessions: Object.fromEntries(
      Object.entries(store.state.sessions).map(([chatId, bots]) => [
        chatId,
        Object.fromEntries(Object.entries(bots).map(([botId, s]) => [botId, s.sessionId ?? null])),
      ]),
    ),
    agentAvailable: Boolean(context.agent),
    settings: store.state.settings,
    // Shown as the avatar that opens Settings; `systemName` is the placeholder for the setting.
    user: { name: store.state.settings.userName || systemUserName, systemName: systemUserName },
    // Effective language, so the page and the server always render the same one.
    locale: locale(),
  });

  const memoryView = async (scope) => {
    const entries = await memory.list(scope);
    return { scope, entries, chars: memoryBudget(entries).used, budget: memoryBudget(entries), contextBudget: { limit: MEMORY_CONTEXT_MAX, unit: 'characters' } };
  };

  const usage = async (days) => {
    const hourly = days <= 1;
    const span = hourly ? 24 : Math.max(1, Math.min(90, days));
    const pad = (n) => String(n).padStart(2, '0');
    const start = new Date();
    if (hourly) {
      start.setMinutes(0, 0, 0);
      start.setHours(start.getHours() - 23);
    } else {
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - (span - 1));
    }
    const rows = await store.readUsage(start.getTime());
    const keyOf = (ts) => {
      const d = new Date(ts);
      return hourly
        ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:00`
        : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    /** @type {Record<string, any>} */
    const buckets = {};
    for (let i = 0; i < span; i += 1) {
      const d = new Date(start);
      if (hourly) d.setHours(start.getHours() + i);
      else d.setDate(start.getDate() + i);
      const key = keyOf(d.getTime());
      buckets[key] = {
        key,
        label: hourly ? `${pad(d.getHours())}:00` : `${d.getMonth() + 1}/${d.getDate()}`,
        turns: 0,
        bots: {},
      };
    }
    /** @type {Record<string, any>} */
    const byBot = {};
    const totals = { turns: 0, chars: 0, tools: 0, durationMs: 0, errors: 0 };
    for (const row of rows) {
      const bucket = buckets[keyOf(row.ts)];
      const live = store.getBot(row.botId);
      const bot = (byBot[row.botId] ??= {
        botId: row.botId,
        name: live?.name ?? row.botName ?? t('bot.deleted'),
        color: live?.color ?? 'graphite',
        face: live?.face ?? 'none',
        role: live?.role ?? '',
        deleted: !live,
        turns: 0,
        chars: 0,
        tools: 0,
        durationMs: 0,
        errors: 0,
      });
      if (bucket) {
        bucket.turns += 1;
        bucket.bots[row.botId] = (bucket.bots[row.botId] ?? 0) + 1;
      }
      for (const target of [bot, totals]) {
        target.turns += 1;
        target.chars += row.chars ?? 0;
        target.tools += row.tools ?? 0;
        target.durationMs += row.durationMs ?? 0;
      }
      if (row.status === 'error') {
        bot.errors += 1;
        totals.errors += 1;
      }
    }
    return {
      days: hourly ? 1 : span,
      hourly,
      totals,
      buckets: Object.values(buckets),
      byBot: Object.values(byBot).sort((a, b) => b.turns - a.turns),
    };
  };

  /** @param {import('node:http').IncomingMessage} request */
  const readBody = (request) =>
    new Promise((resolve, reject) => {
      let size = 0;
      /** @type {Buffer[]} */
      const chunks = [];
      request.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) {
          reject(new EngineError('too_large', t('err.tooLarge')));
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on('end', () => {
        if (chunks.length === 0) return resolve({});
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(new EngineError('invalid', t('err.badJson')));
        }
      });
      request.on('error', reject);
    });

  /**
   * A local file a Bot delivered in a chat (`<media src>` / `![](path)`). Serves only an absolute
   * path that a Bot message of that chat contains, so the page cannot read arbitrary files.
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:http').ServerResponse} response
   * @param {URL} url
   */
  const serveMedia = async (request, response, url) => {
    const chatId = url.searchParams.get('chat') ?? '';
    const src = url.searchParams.get('src') ?? '';
    const notFound = () => json(response, 404, { error: 'not_found', message: t('err.fileNotFound') });
    if (!/^(?:bot|group):[a-zA-Z0-9_]+$/.test(chatId) || !src || src.length > 4096) return notFound();
    const expanded = src.startsWith('~/') ? join(homedir(), src.slice(2)) : src;
    if (!isAbsolute(expanded) || !chatReferences(await store.getMessages(chatId), src)) return notFound();
    let file;
    let info;
    try {
      file = await realpath(expanded);
      info = await stat(file);
    } catch {
      return notFound();
    }
    if (!info.isFile() || info.size > MAX_MEDIA_BYTES) return notFound();
    const extension = extname(file).toLowerCase();
    const markdown = extension === '.md' || extension === '.markdown';
    const html = extension === '.html' || extension === '.htm';
    // Large Markdown remains readable as streaming plain text without blocking the server.
    const renderDocument = markdown && info.size <= 2 * 1024 * 1024;
    const type = html || renderDocument ? 'text/html; charset=utf-8' : markdown ? 'text/plain; charset=utf-8' : MEDIA_TYPES[extension];
    const headers = {
      'content-type': type ?? 'application/octet-stream',
      'x-content-type-options': 'nosniff',
      // Opened directly (e.g. an SVG in its own tab) it must not run in the page's origin.
      'content-security-policy': html ? HTML_PREVIEW_CSP : markdown ? MARKDOWN_PREVIEW_CSP : "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      'cache-control': html || markdown ? 'no-store' : 'private, max-age=60',
      'accept-ranges': 'bytes',
      ...(type ? {} : { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.split(/[\\/]/).pop() ?? 'file')}` }),
    };
    if (renderDocument) {
      // Markdown is transformed before responding, so file byte ranges do not apply.
      const content = markdownDocument(await readFile(file, 'utf8'), file.split(/[\\/]/).pop() ?? 'Markdown');
      response.writeHead(200, { ...headers, 'accept-ranges': 'none', 'content-length': Buffer.byteLength(content) });
      response.end(content);
      return;
    }
    // Video and audio seek with Range requests.
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(request.headers.range ?? ''));
    if (range && (range[1] || range[2]) && info.size > 0) {
      const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
      if (start > end || start >= info.size) {
        response.writeHead(416, { 'content-range': `bytes */${info.size}` });
        response.end();
        return;
      }
      response.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${info.size}`, 'content-length': end - start + 1 });
      createReadStream(file, { start, end }).on('error', () => response.destroy()).pipe(response);
      return;
    }
    response.writeHead(200, { ...headers, 'content-length': info.size });
    createReadStream(file).on('error', () => response.destroy()).pipe(response);
  };

  const uploadsDir = join(context.dataDir, 'uploads');

  /**
   * A file the user attaches to a message. The body is the raw file, `?name=` its name. It is
   * stored as `<content hash>-<name>` so the same file attached twice is one file on disk.
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:http').ServerResponse} response
   * @param {URL} url
   */
  const receiveUpload = async (request, response, url) => {
    const name = safeUploadName(url.searchParams.get('name'));
    const declared = Number(request.headers['content-length'] ?? 0);
    if (declared > MAX_UPLOAD_BYTES) {
      request.resume();
      return json(response, 413, { error: 'too_large', message: t('err.uploadTooLarge', { max: '50MB' }) });
    }
    await mkdir(uploadsDir, { recursive: true });
    const temp = join(uploadsDir, `.part-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const hash = createHash('sha256');
    let size = 0;
    let tooLarge = false;
    let broken = false;
    await new Promise((resolve, reject) => {
      const out = createWriteStream(temp);
      request.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_UPLOAD_BYTES) {
          tooLarge = true;
          request.destroy();
          out.destroy();
          resolve(undefined);
          return;
        }
        hash.update(chunk);
        out.write(chunk);
      });
      request.on('end', () => out.end(() => resolve(undefined)));
      request.on('error', reject);
      out.on('error', reject);
    }).catch(() => {
      // The page went away or the disk write failed: drop the partial file.
      broken = true;
    });
    if (tooLarge || broken || size === 0) {
      await rm(temp, { force: true });
      if (broken && !tooLarge) return json(response, 400, { error: 'invalid', message: t('err.uploadEmpty') });
      return json(response, tooLarge ? 413 : 400, {
        error: tooLarge ? 'too_large' : 'invalid',
        message: tooLarge ? t('err.uploadTooLarge', { max: '50MB' }) : t('err.uploadEmpty'),
      });
    }
    const id = `${hash.digest('hex').slice(0, 12)}-${name}`;
    await rename(temp, join(uploadsDir, id));
    const kind = /\.(png|jpe?g|gif|webp|bmp|avif|svg|heic)$/i.test(name) ? 'image' : 'file';
    return json(response, 200, { upload: { id, name, size, kind } });
  };

  /**
   * An attached file, for the page to show back. Only names this Mini App stored are served.
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:http').ServerResponse} response
   * @param {string} id
   */
  const serveUpload = async (request, response, id) => {
    const notFound = () => json(response, 404, { error: 'not_found', message: t('err.fileNotFound') });
    if (!UPLOAD_NAME_RE.test(id) || id.includes('..')) return notFound();
    const file = join(uploadsDir, id);
    const info = await stat(file).catch(() => undefined);
    if (!info?.isFile()) return notFound();
    const type = MEDIA_TYPES[extname(file).toLowerCase()];
    response.writeHead(200, {
      'content-type': type ?? 'application/octet-stream',
      'content-length': info.size,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      // Names carry a content hash, so a cached copy never goes stale.
      'cache-control': 'private, max-age=31536000, immutable',
      ...(type ? {} : { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(id.slice(13))}` }),
    });
    createReadStream(file).on('error', () => response.destroy()).pipe(response);
  };

  /**
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:http').ServerResponse} response
   */
  const route = async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://miniapp.local');
    const path = url.pathname;
    const method = request.method ?? 'GET';

    const asset = method === 'GET' ? staticFile(path) : undefined;
    if (asset) {
      const [file, type] = asset;
      let content;
      try {
        content = await readFile(join(clientDir, file));
      } catch {
        return json(response, 404, { error: 'not_found', message: t('err.fileNotFound') });
      }
      response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      response.end(content);
      return;
    }

    if (method === 'GET' && path === '/api/media') return serveMedia(request, response, url);

    if (method === 'POST' && path === '/api/uploads') return receiveUpload(request, response, url);
    const upload = method === 'GET' ? /^\/api\/uploads\/([^/]+)$/.exec(path) : null;
    if (upload) return serveUpload(request, response, decodeURIComponent(upload[1]));

    if (method === 'GET' && path === '/api/avatars') {
      return json(response, 200, { avatars: await team.listAvatars() });
    }
    if (method === 'POST' && path === '/api/avatars') {
      const body = await readBody(request);
      return json(response, 200, { avatar: await team.importAvatar(body?.avatar) });
    }

    const avatar = method === 'GET' ? /^\/api\/avatars\/([a-zA-Z0-9_-]+\.(png|jpe?g|webp|gif))$/.exec(path) : null;
    if (avatar) {
      let content;
      try {
        content = await readFile(join(context.dataDir, 'avatars', avatar[1]));
      } catch {
        return json(response, 404, { error: 'not_found', message: t('err.fileNotFound') });
      }
      const type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }[avatar[2]];
      // File names carry a content hash, so a changed avatar is a new URL.
      response.writeHead(200, { 'content-type': type, 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=31536000, immutable' });
      response.end(content);
      return;
    }

    if (path === '/mcp/minimax-bot') {
      const body = method === 'POST' ? await readBody(request) : undefined;
      await handleMcp(request, response, body);
      return;
    }

    if (method === 'GET' && path === '/api/events') {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      response.write(`data: ${JSON.stringify({ type: 'hello' })}\n\n`);
      clients.add(response);
      const keepAlive = setInterval(() => response.write(': ping\n\n'), 20_000);
      request.on('close', () => {
        clearInterval(keepAlive);
        clients.delete(response);
      });
      return;
    }

    if (method === 'GET' && path === '/api/state') return json(response, 200, snapshot());

    // The page reports the OS language (navigator.languages); it resolves `auto`.
    if (method === 'POST' && path === '/api/locale') {
      const body = await readBody(request);
      const system = matchLocale(body.system) ?? 'en';
      if (store.state.systemLocale !== system) {
        store.state.systemLocale = system;
        await team.applyLocale();
      }
      return json(response, 200, { locale: locale() });
    }

    if (method === 'PUT' && path === '/api/settings') {
      const body = await readBody(request);
      const next = { ...store.state.settings };
      if (body.language !== undefined) {
        if (!LANGUAGE_PREFS.includes(body.language)) throw new EngineError('invalid', t('err.badLanguage'));
        next.language = body.language;
      }
      if (body.userName !== undefined) {
        const name = String(body.userName ?? '').replace(/\s+/g, ' ').trim();
        if (name.length > USER_NAME_MAX) throw new EngineError('invalid', t('err.userNameTooLong', { max: USER_NAME_MAX }));
        next.userName = name;
      }
      store.state.settings = next;
      if (body.language !== undefined) await team.applyLocale();
      else {
        await store.save();
        broadcast({ type: 'state.changed' });
      }
      return json(response, 200, { settings: store.state.settings, locale: locale() });
    }

    let match = /^\/api\/chats\/((?:bot|group):[a-zA-Z0-9_]+)(\/.*)?$/.exec(path);
    if (match) {
      const chatId = match[1];
      const rest = match[2] ?? '';
      if (method === 'GET' && rest === '/messages') {
        const limit = Number(url.searchParams.get('limit') ?? 200);
        if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new EngineError('invalid', 'limit must be an integer from 1 to 500');
        try {
          const page = await store.listMessagesPage(chatId, { limit, before: url.searchParams.get('before') || undefined });
          return json(response, 200, { chatId, ...page });
        } catch (error) {
          if (error.code === 'not_found') throw new EngineError('not_found', error.message);
          throw error;
        }
      }
      if (method === 'POST' && rest === '/messages') {
        const body = await readBody(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new EngineError('invalid', 'Expected a message object');
        const message = await engine.sendUserMessage(chatId, body.text, body.attachments, body.clientMessageId);
        return json(response, 200, { message });
      }
      if (method === 'POST' && rest === '/cancel') {
        return json(response, 200, { cancelled: engine.cancelChat(chatId) });
      }
      if (method === 'POST' && rest === '/reset') {
        if (engine.isBusy(chatId)) throw new EngineError('busy', t('err.stopFirst'));
        await store.deleteChat(chatId);
        broadcast({ type: 'chat.reset', chatId });
        engine.broadcastSummary(chatId);
        broadcast({ type: 'state.changed' });
        return json(response, 200, { ok: true });
      }
      if (method === 'POST' && rest === '/resume-pending') return json(response, 200, await engine.inbox.resume(chatId));
      const retry = /^\/messages\/(msg_[a-zA-Z0-9]+)\/retry$/.exec(rest);
      const reaction = /^\/messages\/(msg_[a-zA-Z0-9]+)\/reactions$/.exec(rest);
      if (method === 'PUT' && reaction) {
        const body = await readBody(request);
        const result = await store.setUserReaction(chatId, reaction[1], body?.emoji, body?.selected);
        broadcast({ type: 'message.reactions', chatId, ...result });
        return json(response, 200, result);
      }
      if (method === 'POST' && retry) return json(response, 200, await engine.retryMessage(chatId, retry[1]));
      const answer = /^\/messages\/(msg_[a-zA-Z0-9]+)\/answer$/.exec(rest);
      if (method === 'POST' && answer) {
        const body = await readBody(request);
        if (!Array.isArray(body.answers)) throw new EngineError('invalid', t('err.noAnswers'));
        await engine.answerQuestion(chatId, answer[1], body.answers);
        return json(response, 200, { ok: true });
      }
    }

    match = /^\/api\/approvals\/([^/]+)$/.exec(path);
    if (match && method === 'POST') {
      const body = await readBody(request);
      await engine.replyApproval(decodeURIComponent(match[1]), body.decision);
      return json(response, 200, { ok: true });
    }

    if (method === 'GET' && path === '/api/models') {
      // `supported: false` on a Host whose runs cannot pick a model; the page then hides the picker.
      const catalog = await engine.modelCatalog({ fresh: true });
      if (!catalog) return json(response, 200, { supported: false, models: [] });
      return json(response, 200, { supported: true, models: catalog.models ?? [], default: catalog.default });
    }

    match = /^\/api\/tasks\/(task_[a-zA-Z0-9]+)\/stop$/.exec(path);
    if (match && method === 'POST') return json(response, 200, await engine.tasks.cancel(undefined, { task_id: match[1] }));

    match = /^\/api\/helpers\/(hlp_[a-zA-Z0-9]+)\/stop$/.exec(path);
    if (match && method === 'POST') return json(response, 200, engine.stopHelper(undefined, match[1]));

    if (path === '/api/bots' && method === 'POST') {
      return json(response, 200, { bot: await team.createBot(undefined, await readBody(request)) });
    }
    match = /^\/api\/bots\/(bot_[a-zA-Z0-9]+)$/.exec(path);
    if (match && method === 'PATCH') {
      return json(response, 200, { bot: await team.updateBot(undefined, match[1], await readBody(request)) });
    }
    if (match && method === 'DELETE') {
      return json(response, 200, await team.deleteBot(undefined, match[1]));
    }

    if (path === '/api/groups' && method === 'POST') {
      return json(response, 200, { group: await team.createGroup(undefined, await readBody(request)) });
    }
    match = /^\/api\/groups\/(grp_[a-zA-Z0-9]+)$/.exec(path);
    if (match && method === 'PATCH') {
      return json(response, 200, { group: await team.updateGroup(undefined, match[1], await readBody(request)) });
    }
    if (match && method === 'DELETE') {
      return json(response, 200, await team.deleteGroup(undefined, match[1]));
    }

    match = /^\/api\/memory\/(team|bot_[a-zA-Z0-9]+)$/.exec(path);
    if (match && method === 'GET') return json(response, 200, await memoryView(match[1]));
    if (match && method === 'POST') {
      const body = await readBody(request);
      const scope = match[1] === 'team' ? 'team' : 'bot';
      const result = await team.remember(undefined, { text: body.text, key: body.key, scope, targetBot: match[1], source: t('memory.manualSource'), replaceId: body.replaceId, pinned: body.pinned, expectedRevision: body.expectedRevision, requireRevision: true });
      return json(response, 200, { ...await memoryView(match[1]), entry: result.entry, unchanged: result.unchanged });
    }
    match = /^\/api\/memory\/(team|bot_[a-zA-Z0-9]+)\/([a-f0-9]{8})$/.exec(path);
    if (match && method === 'DELETE') {
      const scope = match[1] === 'team' ? 'team' : 'bot';
      await team.forget(undefined, { id: match[2], scope, targetBot: match[1] });
      return json(response, 200, await memoryView(match[1]));
    }

    if (path === '/api/schedules' && method === 'POST') {
      return json(response, 200, { schedule: await team.saveSchedule(await readBody(request)) });
    }
    match = /^\/api\/schedules\/(sch_[a-zA-Z0-9]+)\/run$/.exec(path);
    if (match && method === 'POST') {
      const schedule = store.state.schedules.find((s) => s.id === match?.[1]);
      if (!schedule) throw new EngineError('not_found', t('err.scheduleNotFound', { id: match[1] }));
      await engine.fireSchedule(schedule);
      return json(response, 200, { ok: true });
    }
    match = /^\/api\/schedules\/(sch_[a-zA-Z0-9]+)$/.exec(path);
    if (match && method === 'DELETE') {
      await team.deleteSchedule(match[1]);
      return json(response, 200, { ok: true });
    }

    if (method === 'GET' && path === '/api/usage') {
      return json(response, 200, await usage(Number(url.searchParams.get('days') ?? 7)));
    }

    json(response, 404, { error: 'not_found', message: t('err.routeNotFound') });
  };

  const server = createServer((request, response) => {
    route(request, response).catch((error) => {
      const known = error instanceof EngineError || error instanceof MemoryError || error instanceof ReactionError;
      const status = !known
        ? 500
        : error.code === 'not_found'
          ? 404
          : error.code === 'forbidden'
            ? 403
            : error.code === 'busy' || error.code === 'delivery_uncertain' || error.code === 'memory_conflict'
              ? 409
              : 400;
      if (!known) context.logger.error('minimax_bot.request_failed', { path: (request.url ?? '').split('?')[0] });
      if (response.headersSent) {
        response.end();
        return;
      }
      json(response, status, {
        error: known ? error.code ?? 'invalid' : 'internal',
        message: known ? error.message : t('err.internal'),
      });
    });
  });
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(context.listen.port, context.listen.host, () => {
      server.off('error', reject);
      resolve(undefined);
    });
  });
  engine.startScheduler();
  engine.tasks.start();
  context.logger.info('minimax_bot.listening', { agent: Boolean(context.agent) });

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    context.signal.removeEventListener('abort', onAbort);
    engine.dispose();
    for (const client of clients) client.end();
    clients.clear();
    await store.writeChain;
    await memory.chain;
    const closed = new Promise((resolve) => server.close(() => resolve(undefined)));
    server.closeAllConnections?.();
    await closed;
  };
  const onAbort = () => void dispose();
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();
  return { dispose };
}
