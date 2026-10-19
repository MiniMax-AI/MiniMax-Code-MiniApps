// @ts-check
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { clipText, createDomain, DomainError, localDate } from './domain.mjs';
import {
  CARE_TEXT, chatPrompt, letterPrompt, needsCare, parseChat, parseLetter, parseReply, replyPrompt, templateLetter,
} from './companion.mjs';

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */
/** @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle */
/** @typedef {import('./miniapp-api.js').MiniAppAgentClient} MiniAppAgentClient */

const MAX_BODY = 16 * 1024;
/** 每天最多和小屿聊多少句、心情回应最多几次：控制用户模型额度的消耗。 */
const CHAT_PER_DAY = 20;
const REPLIES_PER_DAY = 3;
const TIMEOUT = { letter: 240_000, chat: 120_000, reply: 90_000 };

/** 页面上显示的失败原因（不含任何内部细节）。 */
const FRIENDLY = /** @type {Record<string, string>} */ ({
  NO_AGENT: '这个版本的 MiniMax Code 还没把 Agent 能力开放给心屿。',
  NOT_PERMITTED: '心屿没有拿到运行 Agent 的权限。',
  BUSY: '小屿那边有点忙，等一下再试试。',
  AGENT_UNAVAILABLE: '小屿那边有点忙，等一下再试试。',
  INVALID_ARGUMENTS: 'MiniMax Code 里好像还没有可用的默认模型。',
  TIMEOUT: '小屿想得太久了，先歇一下，等会儿再试。',
  TOOL: '小屿刚才想去翻别的东西，被心屿拦下了。再说一次试试？',
  PARSE: '小屿这次没组织好语言，再说一次试试？',
  RUN_ERROR: '模型这次没有回应，稍后再试试。',
  AGENT_OUTCOME_UNKNOWN: '没能确认小屿有没有回完，再说一次试试？',
});

const STATIC = {
  '/dashboard': ['index.html', 'text/html; charset=utf-8'],
  '/assets/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/assets/app.js': ['app.js', 'text/javascript; charset=utf-8'],
};

const failure = (code) => Object.assign(new Error(code), { code });
const codeOf = (error) => (error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN');
/** logger 的 fields 只有键名会离开进程，诊断值要写进消息；只放枚举形态的短标识，不带任何文本。 */
const logToken = (v) => (typeof v === 'string' && /^[A-Za-z0-9_.-]{1,40}$/.test(v) ? v : 'OTHER');
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * @param {MiniAppContext} context
 * @returns {Promise<MiniAppLifecycle>}
 */
export async function start(context) {
  const clientDir = join(context.pluginRoot, 'miniapp/client');
  /** @type {Map<string, Buffer>} */
  const files = new Map();
  for (const [, [name]] of Object.entries(STATIC)) {
    files.set(name, await readFile(join(clientDir, name)));
  }

  /** @type {Set<import('node:http').ServerResponse>} */
  const sseClients = new Set();
  const domain = await createDomain({
    dataDir: context.dataDir,
    onChange: (version) => {
      const payload = `event: changed\ndata: ${JSON.stringify({ version })}\n\n`;
      for (const res of sseClients) res.write(payload);
    },
    onWarn: (message) => context.logger.warn(message),
  });

  const heartbeat = setInterval(() => {
    for (const res of sseClients) res.write(': ping\n\n');
  }, 25000);

  // ---------- 小屿陪伴：Agent 编排 ----------
  // 所有 Agent 调用排成一队、共用当天的一个会话；“正在写信 / 正在回复”只放在内存里，通过 SSE 告诉页面。
  const rt = {
    pending: { letter: 0, chat: 0, reply: 0 },
    queue: /** @type {Promise<unknown>} */ (Promise.resolve()),
    /** @type {Set<AbortController>} */
    controllers: new Set(),
    /** @type {Map<string, number>} */
    replies: new Map(),
    closed: false,
  };
  /** @returns {MiniAppAgentClient | undefined} */
  const agentClient = () => /** @type {any} */ (context).agent;

  /** @param {'letter'|'chat'|'reply'} kind @param {number} delta */
  function busy(kind, delta) {
    rt.pending[kind] = Math.max(0, rt.pending[kind] + delta);
    domain.touch();
  }

  /** @param {() => Promise<void>} fn */
  function enqueue(fn) {
    const run = rt.queue.then(() => (rt.closed ? undefined : fn()));
    rt.queue = run.catch(() => undefined);
    return run;
  }

  function abortAll() {
    for (const c of rt.controllers) c.abort();
  }

  function fullSnapshot() {
    const s = domain.snapshot();
    const said = s.companion.chat.filter((m) => m.role === 'me').length;
    return {
      ...s,
      companion: {
        ...s.companion,
        available: Boolean(agentClient()),
        busy: { letter: rt.pending.letter > 0, chat: rt.pending.chat > 0, reply: rt.pending.reply > 0 },
        chatLeft: Math.max(0, CHAT_PER_DAY - said),
      },
    };
  }

  /**
   * 在当天的会话里跑一轮。会话不可用就开新会话；build(fresh) 生成提示词，新会话需要带完整素材。
   * @param {(fresh: boolean) => string} build @param {number} timeoutMs
   */
  async function runAgent(build, timeoutMs) {
    const agent = agentClient();
    if (!agent) throw failure('NO_AGENT');
    const s = domain.companionSession();
    const sessionId = s && s.date === localDate() ? s.id : undefined;
    try {
      return await runTurn(agent, build(!sessionId), sessionId, timeoutMs);
    } catch (error) {
      if (!sessionId) throw error;
      // 出过错的会话不再续用；会话丢了就换新会话重试一次
      await domain.setCompanionSession(null);
      if (codeOf(error) !== 'SESSION_NOT_FOUND') throw error;
      return runTurn(agent, build(true), undefined, timeoutMs);
    }
  }

  /**
   * @param {MiniAppAgentClient} agent @param {string} text @param {string | undefined} sessionId @param {number} timeoutMs
   */
  async function runTurn(agent, text, sessionId, timeoutMs) {
    const ctl = new AbortController();
    rt.controllers.add(ctl);
    let reason = '';
    const stop = (why) => {
      if (!reason) reason = why;
      ctl.abort();
    };
    const timer = setTimeout(() => stop('TIMEOUT'), timeoutMs);
    // 心屿只要文字：Agent 一旦想调用工具、申请权限或弹出提问，就中止这一轮。从不替用户批准任何东西。
    const onEvent = (event) => {
      const type = event?.type;
      if (type === 'tool.started' || type === 'permission.requested' || type === 'question.requested') stop('TOOL');
    };
    try {
      const result = await agent.run({ text, ...(sessionId ? { sessionId } : {}) }, { signal: ctl.signal, onEvent });
      if (reason) throw failure(reason);
      if (result.status !== 'finished') throw failure('RUN_ERROR');
      if (result.pendingQuestion) throw failure('TOOL');
      // 只在开了新会话时记下它；续用的会话若在这一轮期间被作废（记事本变了、出错），不再写回
      if (!sessionId && result.sessionId) {
        await domain.setCompanionSession({ date: localDate(), id: result.sessionId });
      }
      return String(result.text ?? '');
    } catch (error) {
      if (reason) throw failure(reason);
      throw error;
    } finally {
      clearTimeout(timer);
      rt.controllers.delete(ctl);
    }
  }

  const logFail = (kind, error) => context.logger.warn(`xinyu.companion.failed kind=${kind} code=${logToken(codeOf(error))}`);

  /** 准备今天的信：开着陪伴就请小屿写，否则（或写失败时）放一张离线便条。 */
  async function ensureLetter({ retry = false } = {}) {
    const enabled = domain.companionEnabled();
    if (enabled === null) return { started: false };
    const today = localDate();
    const cur = domain.letterOf(today);
    if (enabled !== true || !agentClient()) {
      if (!cur) await domain.putLetter({ date: today, text: templateLetter(domain.companionData()), by: 'note' });
      return { started: false };
    }
    if (cur && !(cur.by === 'note' && (!cur.fallback || retry))) return { started: false };
    if (rt.pending.letter) return { started: true };
    const epoch = domain.epoch();
    busy('letter', 1);
    void enqueue(async () => {
      try {
        const data = domain.companionData();
        const parsed = parseLetter(await runAgent(() => letterPrompt(data), TIMEOUT.letter));
        if (!parsed) throw failure('PARSE');
        if (rt.closed || domain.epoch() !== epoch) return;
        if (domain.companionEnabled() !== true) {
          // 写信途中关掉了陪伴：不用模型写的信，改放一张离线便条
          if (!domain.letterOf(today)) await domain.putLetter({ date: today, text: templateLetter(domain.companionData()), by: 'note' });
          return;
        }
        await domain.putLetter({ date: today, text: parsed.letter, by: 'ai' });
        if (parsed.notes.length) await domain.replaceAiMemory(parsed.notes);
      } catch (error) {
        logFail('letter', error);
        if (rt.closed || domain.epoch() !== epoch) return;
        const existing = domain.letterOf(today);
        if (existing?.by === 'ai') return;
        if (existing) await domain.markLetterFallback(today);
        else await domain.putLetter({ date: today, text: templateLetter(domain.companionData()), by: 'note', fallback: true });
      } finally {
        busy('letter', -1);
      }
    });
    return { started: true };
  }

  /** 贴完心情贴纸后，请小屿回一句。 */
  function startMoodReply(date) {
    if (domain.companionEnabled() !== true || !agentClient()) return;
    const ck = domain.checkinOf(date);
    if (!ck) return;
    const n = rt.replies.get(date) ?? 0;
    if (n >= REPLIES_PER_DAY) return;
    rt.replies.set(date, n + 1);
    const { at } = ck;
    const epoch = domain.epoch();
    busy('reply', 1);
    void enqueue(async () => {
      try {
        const now = domain.checkinOf(date);
        if (!now || now.at !== at) return; // 已经换了贴纸，交给新的那次回应
        const data = domain.companionData();
        const reply = parseReply(await runAgent((fresh) => replyPrompt(data, now, { fresh }), TIMEOUT.reply));
        if (!reply) throw failure('PARSE');
        if (rt.closed || domain.epoch() !== epoch || domain.companionEnabled() !== true) return;
        await domain.setMoodReply(date, reply, at);
      } catch (error) {
        logFail('reply', error);
      } finally {
        busy('reply', -1);
      }
    });
  }

  async function chat(body) {
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) throw new DomainError(400, 'invalid_argument', '先说点什么吧');
    if ([...text].length > 200) throw new DomainError(400, 'invalid_argument', '一次最多说 200 个字');
    if (domain.companionEnabled() !== true) throw new DomainError(409, 'companion_off', '先打开小屿陪伴，才能和小屿聊天');
    if (!agentClient()) throw new DomainError(503, 'agent_unavailable', FRIENDLY.NO_AGENT);
    if (rt.pending.chat) throw new DomainError(409, 'busy', '小屿还在想上一句呢');
    const today = localDate();
    const before = domain.chatOf(today);
    if (before.filter((m) => m.role === 'me').length >= CHAT_PER_DAY) {
      throw new DomainError(429, 'too_many', '今天聊得够多啦，小屿有点困了，明天再聊吧');
    }
    const history = before
      .filter((m) => !m.kind)
      .slice(-10)
      .map((m) => ({ who: m.role === 'me' ? 'me' : 'xiaoyu', text: clipText(m.text, 100) }));
    const epoch = domain.epoch();
    busy('chat', 1);
    try {
      await domain.appendChat(today, { role: 'me', text });
      if (needsCare(text)) await domain.appendChat(today, { role: 'xiaoyu', kind: 'care', text: CARE_TEXT });
    } catch (error) {
      busy('chat', -1);
      throw error;
    }
    void enqueue(async () => {
      try {
        const data = domain.companionData();
        const parsed = parseChat(await runAgent((fresh) => chatPrompt(data, text, { fresh, history }), TIMEOUT.chat), text);
        if (!parsed) throw failure('PARSE');
        if (rt.closed || domain.epoch() !== epoch || domain.companionEnabled() !== true) return;
        await domain.appendChat(today, { role: 'xiaoyu', text: parsed.text });
        if (parsed.remember && (await domain.rememberFromChat(parsed.remember))) {
          await domain.appendChat(today, { role: 'xiaoyu', kind: 'memo', text: parsed.remember });
        }
      } catch (error) {
        logFail('chat', error);
        if (rt.closed || domain.epoch() !== epoch) return;
        await domain.appendChat(today, { role: 'xiaoyu', kind: 'error', text: FRIENDLY[codeOf(error)] ?? FRIENDLY.RUN_ERROR });
      } finally {
        busy('chat', -1);
      }
    });
    return { started: true };
  }

  const server = createServer((request, response) => {
    handle(request, response).catch((error) => {
      if (error instanceof DomainError) {
        sendJson(response, error.status, { error: error.code, message: error.message });
        return;
      }
      context.logger.error(`xinyu.request.failed name=${logToken(/** @type {any} */ (error)?.name)}`);
      sendJson(response, 500, { error: 'internal', message: '出了点小问题，请稍后再试' });
    });
  });

  /**
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:http').ServerResponse} response
   */
  async function handle(request, response) {
    // 每个路由都只接受本机心屿页面的请求：Host 必须是回环地址（挡住 DNS rebinding），浏览器带了 Origin
    // 就必须是这个监听地址本身。3.1.2 起宿主会给端口加凭据；更早的客户端没有那层保护，靠这里兜住。
    if (!isLoopbackRequest(request, context.listen.port)) {
      request.resume();
      return sendJson(response, 403, { error: 'forbidden', message: '只接受本机心屿页面的请求' });
    }
    const url = new URL(request.url ?? '/', 'http://miniapp.local');
    const path = url.pathname;
    const method = request.method ?? 'GET';
    // 写请求只收 JSON：跨站表单和 text/plain 这类不经预检的请求进不了处理函数
    if (method !== 'GET' && method !== 'HEAD' && !String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      request.resume();
      return sendJson(response, 415, { error: 'json_required', message: '请求格式不正确' });
    }

    if (method === 'GET' && path in STATIC) {
      const [name, type] = STATIC[/** @type {keyof typeof STATIC} */ (path)];
      response.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
      response.end(files.get(name));
      return;
    }

    if (method === 'GET' && path === '/api/events') {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      response.write(`event: hello\ndata: ${JSON.stringify({ version: domain.snapshot().version })}\n\n`);
      sseClients.add(response);
      request.on('close', () => sseClients.delete(response));
      return;
    }

    if (method === 'GET' && path === '/api/state') {
      return sendJson(response, 200, fullSnapshot());
    }

    const routes = {
      'PUT /api/profile': async () => domain.updateProfile(await readJson(request)),
      'POST /api/checkin': async () => {
        const body = await readJson(request);
        await domain.checkin(body);
        startMoodReply(localDate());
        return { care: needsCare(body?.note) };
      },
      'POST /api/card/draw': async () => domain.drawCard(await readJson(request)),
      'PUT /api/about': async () => domain.setAbout(await readJson(request)),
      'POST /api/secrets': async () => domain.discover(await readJson(request)),
      'POST /api/flags': async () => domain.setFlag(await readJson(request)),
      'POST /api/joys': async () => domain.addJoy(await readJson(request)),
      'POST /api/answers': async () => domain.ask(await readJson(request)),
      'DELETE /api/answers': async () => domain.clearAnswers(),
      'POST /api/quiz': async () => domain.submitQuiz(await readJson(request)),
      'POST /api/companion/enable': async () => {
        await domain.setCompanionEnabled(await readJson(request));
        return ensureLetter();
      },
      'POST /api/companion/letter': async () => ensureLetter({ retry: (await readJson(request))?.retry === true }),
      'POST /api/companion/chat': async () => chat(await readJson(request)),
      'POST /api/companion/memory': async () => domain.addMemory(await readJson(request)),
      'POST /api/reset': async () => {
        abortAll();
        rt.replies.clear();
        return domain.resetAll();
      },
    };
    const key = `${method} ${path}`;
    if (key in routes) {
      const result = await routes[/** @type {keyof typeof routes} */ (key)]();
      return sendJson(response, 200, { ok: true, result: result ?? null, state: fullSnapshot() });
    }

    let m;
    if (method === 'DELETE' && (m = /^\/api\/checkin\/(\d{4}-\d{2}-\d{2})$/.exec(path))) {
      await domain.removeCheckin(m[1]);
      return sendJson(response, 200, { ok: true, state: fullSnapshot() });
    }
    if (method === 'POST' && (m = /^\/api\/card\/(\d{4}-\d{2}-\d{2})\/favorite$/.exec(path))) {
      const result = await domain.toggleFavorite(m[1]);
      return sendJson(response, 200, { ok: true, result, state: fullSnapshot() });
    }
    if (method === 'DELETE' && (m = /^\/api\/joys\/([0-9a-f-]{36})$/.exec(path))) {
      await domain.removeJoy(m[1]);
      return sendJson(response, 200, { ok: true, state: fullSnapshot() });
    }
    if (method === 'POST' && (m = /^\/api\/companion\/letter\/(\d{4}-\d{2}-\d{2})\/read$/.exec(path))) {
      const result = await domain.markLetterRead(m[1]);
      return sendJson(response, 200, { ok: true, result, state: fullSnapshot() });
    }
    if (method === 'DELETE' && (m = /^\/api\/companion\/memory\/([0-9a-f-]{36})$/.exec(path))) {
      await domain.forgetMemory(m[1]);
      return sendJson(response, 200, { ok: true, state: fullSnapshot() });
    }

    sendJson(response, 404, { error: 'not_found', message: '页面不存在' });
  }

  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(context.listen.port, context.listen.host, () => {
      server.off('error', onError);
      resolve(undefined);
    });
  });
  context.logger.info('xinyu.runtime.listening');

  /** @type {Promise<void> | undefined} */
  let disposal;
  const dispose = () => {
    if (disposal) return disposal;
    context.signal.removeEventListener('abort', onAbort);
    rt.closed = true;
    abortAll();
    clearInterval(heartbeat);
    for (const res of sseClients) res.end();
    sseClients.clear();
    disposal = (async () => {
      // 已经中止了进行中的 Agent 调用；最多等 3 秒让它们收尾
      await Promise.race([rt.queue, new Promise((r) => setTimeout(r, 3000).unref?.())]);
      await domain.flush();
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve(undefined)));
        server.closeAllConnections?.();
      });
    })();
    return disposal;
  };
  const onAbort = () => {
    void dispose().catch(() => undefined);
  };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  return { dispose };
}

/** @param {import('node:http').ServerResponse} res */
function sendJson(res, status, body) {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/**
 * Host 必须是本机；浏览器带了 Origin 时，必须是 http://<回环地址>:<本应用端口>。
 * 不带 Origin 的请求（同源 GET、本机的非浏览器客户端）只看 Host。
 * @param {import('node:http').IncomingMessage} request @param {number} port
 */
function isLoopbackRequest(request, port) {
  const host = request.headers.host;
  if (host !== undefined && !LOOPBACK_HOSTS.has(hostnameOf(host))) return false;
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false; // 包括 "null"（沙箱 iframe、file://）
  }
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(hostnameOf(url.host)) && Number(url.port || 80) === port;
}

/** 去掉端口，IPv6 去掉方括号：'[::1]:8080' -> '::1'。 @param {string} hostHeader */
function hostnameOf(hostHeader) {
  const h = hostHeader.trim().toLowerCase();
  const bracketed = /^\[([^\]]*)\]/.exec(h);
  if (bracketed) return bracketed[1];
  const colon = h.lastIndexOf(':');
  return colon === -1 ? h : h.slice(0, colon);
}

/** @param {import('node:http').IncomingMessage} req */
async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new DomainError(413, 'too_large', '内容太长了');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new DomainError(400, 'invalid_json', '请求格式不正确');
  }
}
