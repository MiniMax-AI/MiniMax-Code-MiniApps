import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError, atomicWrite, clamp, clip, isKey, newId, nowIso } from './util.mjs';
import { cloneOrUpdate, dirSizeKB } from './github.mjs';
import { checkWritableDir, isInside } from './env.mjs';

export const MANAGER_KEY = '__manager__';
const TERMINAL = new Set(['done', 'error', 'cancelled', 'timeout']);
const TIMEOUT_MS = { cloud: 8 * 60000, local: 15 * 60000, message: 10 * 60000, notes: 6 * 60000, manager: 10 * 60000 };
const PERMISSION_WAIT_MS = 30 * 60000;

// 发给 AI 的话尽量短：长规则都在 prompts/ 下的固定文件里
const cloudMsg = (p) => '【' + p.fullName + '】云讲解。规则：prompts/common.md、prompts/explain-cloud.md。资料：projects/' + p.key + '/';
const localMsg = (p) => '【' + p.fullName + '】本地讲解。规则：prompts/common.md、prompts/explain-local.md。代码：cache/repos/' + p.key + '/，资料：projects/' + p.key + '/';
const notesMsg = (p) => '【' + p.fullName + '】按 prompts/notes.md 记 3 条备注。资料：projects/' + p.key + '/';
const primeProject = (p) => '【' + p.fullName + '】规则见 prompts/common.md，资料在 projects/' + p.key + '/。\n';
const primeManager = '按 prompts/manage.md 整理收藏夹。\n';

// AI 中途提问时我们没法即时回答。不能用「全部跳过」：真实宿主会把它当成关闭问卷，续写不会开始，会话还会卡住。
// 用「其他 + 文字」回答，是宿主认可的真实回答，AI 会照文字继续。
const ASK_DEFAULT = '用户现在没法即时回答。请不要再提问，按最合理、最保守（可撤销）的默认做法直接继续，并在回答里用一句话说明你的假设。';
const ASK_FINAL = '请直接给出最终答案，不要再提问。';

function mapAgentError(error) {
  if (error instanceof AppError) return error;
  switch (error?.code) {
    case 'NOT_PERMITTED':
      return new AppError('agent_off', '「运行 Agent」的权限被关掉了，请在插件详情里重新打开', 403);
    case 'BUSY':
      return new AppError('busy', error.reason === 'session_busy' ? '这个项目的会话正忙，请稍后再试' : '请求太频繁了，请稍后再试', 429);
    case 'SESSION_NOT_FOUND':
      return new AppError('session_gone', '这个会话已经不存在了', 404);
    case 'AGENT_OUTCOME_UNKNOWN':
      return new AppError('unknown_outcome', '结果不确定，可以打开会话看看', 502);
    case 'AGENT_UNAVAILABLE':
      return new AppError('agent_unavailable', 'AI 服务暂时不可用，稍后再试', 503);
    case 'REQUEST_CANCELLED':
      return new AppError('cancelled', '已取消', 499);
    case 'REQUEST_NOT_FOUND':
      return new AppError('request_gone', '这个请求已经处理过了', 404);
    case 'INVALID_ARGUMENTS':
      return new AppError('bad_request', 'AI 请求不被接受：' + clip(error.message, 120), 400);
    default:
      return new AppError('agent_error', 'AI 出错了：' + clip(error?.message, 120), 502);
  }
}

function describeTool(name) {
  const n = String(name || '');
  if (/add_note|update_note|delete_note/.test(n)) return '写备注';
  if (/collection|list_projects|get_project|import_stars/.test(n)) return '操作收藏夹';
  if (/web_fetch|web_search|browser/.test(n)) return '联网查资料';
  if (/^(read|grep|glob)$/.test(n)) return '读文件';
  if (/^(write|edit)$/.test(n)) return '写文件';
  if (/bash|run_code/.test(n)) return '运行工具（读文件、查资料）';
  return '使用 ' + n;
}

/** 只计「AI 真正在干活」的时间：等用户确认权限的时候暂停 */
class ActiveTimer {
  constructor(ms, onTimeout) {
    this.left = ms;
    this.onTimeout = onTimeout;
    this.t = null;
    this.since = 0;
    this.start();
  }
  start() {
    this.since = Date.now();
    this.t = setTimeout(this.onTimeout, Math.max(1000, this.left));
  }
  pause() {
    if (!this.t) return;
    clearTimeout(this.t);
    this.t = null;
    this.left -= Date.now() - this.since;
  }
  resume() {
    if (!this.t && this.left > 0) this.start();
  }
  stop() {
    clearTimeout(this.t);
    this.t = null;
  }
}

async function isDir(p) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** 缓存文件夹必须长这样：…/cache/repos/<项目标识>。清理前用它核对，存盘的数据被改坏了也不会误删别处 */
function isCacheDirFor(dir, key) {
  if (!dir || !isKey(key)) return false;
  const parts = resolve(dir).split(sep);
  return parts.length >= 4 && parts[parts.length - 1] === key && parts[parts.length - 2] === 'repos' && parts[parts.length - 3] === 'cache';
}

/** 所有和 AI 会话有关的事：一个项目一个会话、云/本地讲解、追问、权限、缓存 */
export class AgentHub {
  constructor(shelf) {
    this.shelf = shelf;
    this.calls = new Map();
    this.queue = [];
    this.running = 0;
    this.modelCache = null;
    this.pushTimers = new Map();
    this.sessionLocks = new Map();
    this.dirBySession = new Map(); // 会话 → 它干活的文件夹（只在本次运行里记着，不落盘）
    this.promptsSrc = join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts');
  }

  get agent() {
    return this.shelf.ctx.agent;
  }
  get state() {
    return this.shelf.state;
  }
  resetModelCache() {
    this.modelCache = null;
  }
  status() {
    if (!this.agent) return { available: false, code: 'agent_off', reason: '这个 Mini App 没有获得「运行 Agent」的权限，AI 功能用不了' };
    // 要用到 agent.session（查 AI 的工作文件夹）和 whenBusy，都是 MiniMax Code 3.1.6 起才有；更早的版本连 capabilities 这个字段都没有
    const caps = this.shelf.ctx.capabilities;
    if (!caps || typeof caps.has !== 'function') return { available: false, code: 'host_too_old', reason: '当前的 MiniMax Code 版本太旧（需要 3.1.6 或更新），升级后才能用 AI 功能' };
    const missing = ['agent.run', 'agent.create', 'agent.session'].filter((n) => !caps.has(n));
    if (missing.length) return { available: false, code: 'host_too_old', reason: '当前的 MiniMax Code 版本太旧（缺少 ' + missing.join('、') + '），升级后才能用 AI 功能' };
    return { available: true, agentDir: this.state.settings.agentDir || '' };
  }
  #require() {
    const s = this.status();
    if (!s.available) throw new AppError(s.code, s.reason, 403);
  }
  async #call(fn) {
    try {
      return await fn();
    } catch (error) {
      throw mapAgentError(error);
    }
  }

  // ---------- 模型 ----------
  async #modelsRaw() {
    this.#require();
    if (this.modelCache && Date.now() - this.modelCache.at < 60000) return this.modelCache.value;
    const m = await this.#call(() => this.agent.models());
    const models = (m.models || []).map((x) => ({ key: x.providerId + '/' + x.modelId, providerId: x.providerId, modelId: x.modelId, label: x.displayName || x.modelId, variants: Array.isArray(x.variants) ? x.variants : [], efforts: Array.isArray(x.thinking?.efforts) ? x.thinking.efforts : [] }));
    const preferred = models.find((x) => /m3[.\-]?1/i.test(x.modelId) || /m3[.\-]?1/i.test(x.label)) || null;
    const value = { models, preferred, raw: m };
    this.modelCache = { at: Date.now(), value };
    return value;
  }
  async modelsView() {
    const v = await this.#modelsRaw();
    const def = v.raw.default ? v.raw.default.providerId + '/' + v.raw.default.modelId : '';
    const picked = this.state.settings.modelKey && v.models.some((x) => x.key === this.state.settings.modelKey) ? this.state.settings.modelKey : v.preferred ? v.preferred.key : def;
    return { models: v.models.map(({ key, label, efforts }) => ({ key, label, efforts })), defaultKey: def, preferredKey: v.preferred ? v.preferred.key : '', pickedKey: picked };
  }
  async #pickModel() {
    const v = await this.#modelsRaw();
    const want = this.state.settings.modelKey;
    const found = (want && v.models.find((x) => x.key === want)) || v.preferred;
    if (!found) return v.raw.default;
    const sel = { providerId: found.providerId, modelId: found.modelId };
    // 思考强度：默认取这个模型支持的最高档（用户偏好，也更利于讲清楚）；设置里可以降档。
    // 只使用宿主模型目录里声明过的值，不自己编。
    const level = this.state.settings.effort || 'max';
    if (level !== 'default' && found.efforts.length) {
      const order = ['max', 'xhigh', 'high', 'medium', 'low'];
      const pick = level === 'max' ? order.find((e) => found.efforts.includes(e)) : found.efforts.includes(level) ? level : '';
      if (pick) {
        if (found.variants.includes('thinking')) sel.variant = 'thinking';
        sel.thinking = { effort: pick };
      }
    }
    return sel;
  }

  // ---------- 会话与文件 ----------
  #holder(key) {
    return key === MANAGER_KEY ? this.state.manager : this.shelf.project(key);
  }
  #holderSafe(key) {
    try {
      return this.#holder(key);
    } catch {
      return null;
    }
  }

  /** 一个项目只有一个会话；会话被删了才会新建 */
  async #ensureSession(holder) {
    if (holder.session?.id) return holder.session.id;
    const lockKey = holder === this.state.manager ? MANAGER_KEY : holder.key;
    if (this.sessionLocks.has(lockKey)) return this.sessionLocks.get(lockKey);
    const task = (async () => {
      if (holder.session?.id) return holder.session.id;
      const r = await this.#call(() => this.agent.create());
      holder.session = { id: r.sessionId, createdAt: nowIso(), primed: false };
      this.shelf.store.touch();
      return r.sessionId;
    })().finally(() => this.sessionLocks.delete(lockKey));
    this.sessionLocks.set(lockKey, task);
    return task;
  }

  /**
   * AI 的工作文件夹：永远问宿主「这个会话在哪干活」（workspaceDir），不信存盘的旧路径。
   * 它跟着「这台电脑的数据目录、所选的 Agent」走，换了电脑、换了主 Agent 都会变。
   */
  async #agentDirFor(sessionId) {
    const known = this.dirBySession.get(sessionId);
    if (known && (await isDir(known))) return known;
    const info = await this.#call(() => this.agent.session(sessionId));
    const dir = info?.workspaceDir;
    if (!dir || typeof dir !== 'string') throw new AppError('no_agent_dir', '找不到 AI 的工作文件夹', 500);
    const ok = await checkWritableDir(dir);
    if (!ok.ok) throw new AppError('agent_dir_unusable', 'AI 的工作文件夹用不了：' + ok.reason + '（' + dir + '）', 500);
    this.dirBySession.set(sessionId, dir);
    const s = this.state.settings;
    if (s.agentDir !== dir) {
      if (s.agentDir) this.shelf.ctx.logger.info('shelf.agent_dir.changed');
      s.agentDir = dir; // 只用来在设置里显示「上次用的位置」，实际干活每次都问宿主
      this.shelf.store.touch();
    }
    return dir;
  }

  /** 会话 + 文件夹一起准备好；会话被删了就新建一个再来一次 */
  async #prepare(holder) {
    for (let attempt = 0; ; attempt += 1) {
      const sessionId = await this.#ensureSession(holder);
      try {
        return { sessionId, dir: await this.#agentDirFor(sessionId) };
      } catch (error) {
        if (error.code === 'session_gone' && attempt === 0) {
          holder.session = null;
          this.dirBySession.delete(sessionId);
          continue;
        }
        throw error;
      }
    }
  }

  async #writePrompts(dir) {
    const files = (await readdir(this.promptsSrc)).filter((f) => f.endsWith('.md'));
    const out = join(dir, 'prompts');
    await mkdir(out, { recursive: true });
    for (const f of files) {
      const src = await readFile(join(this.promptsSrc, f), 'utf8');
      let cur = null;
      try {
        cur = await readFile(join(out, f), 'utf8');
      } catch {
        /* 还没有 */
      }
      if (cur !== src) await writeFile(join(out, f), src);
    }
  }

  async #writeProjectFiles(dir, p, mode) {
    const d = join(dir, 'projects', p.key);
    await mkdir(d, { recursive: true });
    const names = new Map(this.state.collections.map((c) => [c.id, c.name]));
    const meta = {
      repo: p.fullName, url: p.url, description: p.description || '', language: p.language || '', stars: p.stars || 0, forks: p.forks || 0,
      topics: p.topics || [], license: p.license || '', homepage: p.homepage || '', pushedAt: p.pushedAt || '', defaultBranch: p.defaultBranch || '',
      sizeKB: p.sizeKB || 0, archived: Boolean(p.archived),
      collections: p.collections.map((id) => names.get(id)).filter(Boolean),
      notes: p.notes.map((n) => ({ by: n.author === 'ai' ? 'AI' : '用户', text: n.text })),
      localCode: mode === 'local' ? 'cache/repos/' + p.key : null,
    };
    await atomicWrite(join(d, 'meta.json'), JSON.stringify(meta, null, 2));
    const readme = await this.shelf.store.readReadme(p.key);
    await atomicWrite(join(d, 'README.md'), readme ?? '（没有取到这个项目的 README）\n');
  }

  // ---------- 任务（call）----------
  #newCall(key, kind, extra = {}) {
    const call = {
      id: newId('call'), key, kind, status: 'queued', createdAt: Date.now(), startedAt: 0, finishedAt: 0, phase: '', activity: '', liveText: '',
      toolCount: 0, toolFails: 0, model: '', error: null, pendingPermission: null, queuePosition: 0, timedOut: false, ctl: new AbortController(),
      timer: null, permTimer: null, ...extra,
    };
    const arr = this.calls.get(key) || [];
    arr.push(call);
    this.calls.set(key, arr.slice(-8));
    return call;
  }
  #view(c) {
    return {
      id: c.id, kind: c.kind, mode: c.mode || null, status: c.status, phase: c.phase, activity: c.activity, liveText: c.liveText.slice(-3000),
      toolCount: c.toolCount, toolFails: c.toolFails, model: c.model, queuePosition: c.queuePosition, startedAt: c.startedAt || c.createdAt,
      pendingPermission: c.pendingPermission, error: c.error,
    };
  }
  callViews(key) {
    return (this.calls.get(key) || []).filter((c) => !TERMINAL.has(c.status)).map((c) => this.#view(c));
  }
  busyKind(key) {
    const c = (this.calls.get(key) || []).find((x) => !TERMINAL.has(x.status));
    return c ? c.kind : null;
  }
  #active(key, kind) {
    return (this.calls.get(key) || []).find((c) => c.kind === kind && !TERMINAL.has(c.status));
  }
  #push(call, now = false) {
    const key = call.key;
    const fire = () => {
      this.pushTimers.delete(key);
      this.shelf.emit({ type: 'calls', key, calls: this.callViews(key) });
    };
    if (now) {
      clearTimeout(this.pushTimers.get(key));
      fire();
      return;
    }
    if (!this.pushTimers.has(key)) this.pushTimers.set(key, setTimeout(fire, 150));
  }
  #chatAdd(holder, role, text, extra = {}) {
    const item = { id: newId('m'), role, text: clamp(text, 20000), at: nowIso(), ...extra };
    holder.chat.push(item);
    if (holder.chat.length > 60) holder.chat.splice(0, holder.chat.length - 60);
    this.shelf.changed(holder === this.state.manager ? 'manager' : 'project', holder.key);
    return item;
  }
  #finish(call, status, error) {
    if (TERMINAL.has(call.status)) return;
    call.status = status;
    call.finishedAt = Date.now();
    call.error = error ? { code: error.code || 'error', message: error.message } : null;
    call.timer?.stop();
    clearTimeout(call.permTimer);
    call.pendingPermission = null;
    call.liveText = '';
    const holder = this.#holderSafe(call.key);
    if (holder && call.key !== MANAGER_KEY && call.kind !== 'message') {
      holder.lastCall = { kind: call.kind, mode: call.mode || null, status, error: call.error?.message || '', errorCode: call.error?.code || '', at: nowIso() };
    }
    this.shelf.changed(call.key === MANAGER_KEY ? 'manager' : 'project', call.key);
    this.#push(call, true);
  }
  #fail(call, error) {
    const e = mapAgentError(error);
    if (call.ctl.signal.aborted || e.code === 'cancelled') {
      this.#finish(call, call.timedOut ? 'timeout' : 'cancelled', new AppError(call.timedOut ? 'timeout' : 'cancelled', call.timedOut ? '用时太长，已停止' : '已取消'));
    } else {
      this.shelf.ctx.logger.warn('shelf.agent.failed', { code: e.code, kind: call.kind });
      this.#finish(call, 'error', e);
    }
  }

  #onEvent(call, holder, e) {
    switch (e.type) {
      case 'run.queued':
        call.queuePosition = e.position;
        call.activity = '排队中（第 ' + e.position + ' 位）';
        break;
      case 'turn.started':
        call.queuePosition = 0;
        call.model = e.model ? e.model.providerId + '/' + e.model.modelId : '';
        call.activity = 'AI 开始工作';
        break;
      case 'text.delta':
        call.liveText = (call.liveText + e.text).slice(-12000);
        break;
      case 'message.committed':
        call.liveText = '';
        break;
      case 'tool.started':
        call.toolCount += 1;
        call.activity = describeTool(e.name);
        break;
      case 'tool.finished':
        if (!e.ok) call.toolFails += 1;
        break;
      case 'message.pending':
        call.activity = '已送达，等 AI 读到';
        break;
      case 'message.steered':
        call.activity = 'AI 已经读到你的插话';
        break;
      case 'permission.requested':
        call.pendingPermission = { sessionId: e.sessionId, requestId: e.requestId, toolName: e.toolName, input: clip(e.toolInput, 600), reason: clip(e.reason, 200), at: nowIso() };
        call.prevStatus = call.status === 'waiting_permission' ? call.prevStatus : call.status;
        call.status = 'waiting_permission';
        call.timer?.pause();
        clearTimeout(call.permTimer);
        call.permTimer = setTimeout(() => {
          void this.replyPermission(call.key, { requestId: e.requestId, decision: 'deny' }).catch(() => {});
        }, PERMISSION_WAIT_MS);
        this.#push(call, true);
        return;
      default:
        break;
    }
    this.#push(call);
  }

  /** 跑一轮；AI 中途提问时，用「其他 + 文字」让它按默认继续，并在聊天里留一行说明 */
  async #runAgent(call, holder, { text, whenBusy }) {
    const model = await this.#pickModel().catch(() => undefined);
    call.timer = new ActiveTimer(call.timeoutMs, () => {
      call.timedOut = true;
      call.ctl.abort();
    });
    const onEvent = (e) => this.#onEvent(call, holder, e);
    try {
      let attempt = 0;
      let result;
      for (;;) {
        try {
          result = await this.agent.run(
            { text, sessionId: holder.session.id, ...(model ? { model } : {}), ...(whenBusy ? { whenBusy } : {}) },
            { signal: call.ctl.signal, onEvent },
          );
          break;
        } catch (error) {
          if (error?.code === 'SESSION_NOT_FOUND' && attempt === 0) {
            attempt += 1;
            holder.session = null;
            await this.#ensureSession(holder);
            continue;
          }
          throw error;
        }
      }
      for (let round = 0; result.pendingQuestion && round < 3; round += 1) {
        const q = result.pendingQuestion;
        const steps = q.request?.steps || [];
        const asked = steps.map((s) => s.question).filter(Boolean).join('；') || '一个问题';
        call.activity = 'AI 提了个问题，已让它按默认继续';
        this.#chatAdd(holder, 'sys', 'AI 想问：' + clip(asked, 160).replace(/[\s。.！!？?；;，,]+$/u, '') + '。这里没法即时回答，已让它按默认继续；想自己回答，接着追问就行。');
        this.#push(call, true);
        const answers = steps.map((s) => ({ stepId: s.id, selectedOptionIds: [], selectedOther: true, otherText: round < 2 ? ASK_DEFAULT : ASK_FINAL }));
        result = await this.agent.answer({ sessionId: holder.session.id, requestId: q.requestId, answers, ...(model ? { model } : {}) }, { signal: call.ctl.signal, onEvent });
      }
      return result;
    } finally {
      call.timer?.stop();
    }
  }

  // ---------- 讲解 ----------
  explain(key, mode, { force = false } = {}) {
    this.#require();
    const p = this.shelf.project(key);
    if (mode !== 'cloud' && mode !== 'local') throw new AppError('bad_mode', '讲解方式不对');
    if (this.#active(key, 'explain')) throw new AppError('busy', '这个项目正在讲解中', 409);
    const call = this.#newCall(key, 'explain', { mode, timeoutMs: TIMEOUT_MS[mode], force: Boolean(force) });
    this.queue.push(call);
    this.#schedule();
    this.#push(call, true);
    return this.#view(call);
  }

  #schedule() {
    const limit = this.state.settings.concurrency;
    while (this.running < limit && this.queue.length) {
      const call = this.queue.shift();
      if (call.status !== 'queued') continue;
      this.running += 1;
      void this.#runExplain(call).finally(() => {
        this.running -= 1;
        this.#schedule();
      });
    }
    this.queue.forEach((c, i) => {
      if (c.queuePosition !== i + 1) {
        c.queuePosition = i + 1;
        c.activity = '排队中（第 ' + (i + 1) + ' 位）';
        this.#push(c);
      }
    });
  }

  async #runExplain(call) {
    const { key, mode } = call;
    try {
      const p = this.shelf.project(key);
      call.startedAt = Date.now();
      call.queuePosition = 0;
      call.status = 'preparing';
      call.phase = '准备资料';
      this.#push(call);
      await this.shelf.ensureReadme(key, { signal: call.ctl.signal }).catch((e) => {
        if (e.code === 'cancelled') throw e;
      });
      const { dir } = await this.#prepare(p);
      await this.#writePrompts(dir);
      await this.#writeProjectFiles(dir, p, mode);
      if (mode === 'local') {
        call.status = 'cloning';
        call.phase = '拉取代码到缓存';
        this.#push(call, true);
        const s = this.state.settings;
        if (!call.force && (p.sizeKB || 0) > s.cloneMaxMB * 1024) {
          throw new AppError('too_big', '这个项目有约 ' + Math.round(p.sizeKB / 1024) + ' MB，超过了 ' + s.cloneMaxMB + ' MB 的上限，建议用云讲解；想硬拉可以在设置里调大上限', 413);
        }
        const root = join(dir, 'cache', 'repos');
        const dest = join(root, p.key);
        const needMB = Math.max(200, Math.ceil((p.sizeKB || 0) / 1024) * 2); // 仓库大小的两倍，至少 200 MB
        const room = await checkWritableDir(root, { needMB });
        if (!room.ok) throw new AppError('cache_unusable', '本地缓存放不下：' + room.reason + '（' + root + '）', 500);
        const git = await this.shelf.gh.git();
        const r = await cloneOrUpdate({ fullName: p.fullName, dest, git, signal: call.ctl.signal, platform: this.shelf.gh.platform, logger: this.shelf.ctx.logger });
        p.cache = { dir: dest, clonedAt: nowIso(), sizeKB: await dirSizeKB(dest), updated: Boolean(r.updated), stale: Boolean(r.stale) };
        this.shelf.changed('project', key);
      }
      if (call.ctl.signal.aborted) throw new AppError('cancelled', '已取消', 499);
      call.status = 'running';
      call.phase = 'AI 阅读并讲解';
      this.#push(call, true);
      const text = mode === 'cloud' ? cloudMsg(p) : localMsg(p);
      this.#chatAdd(p, 'sys', '已发给 AI：' + text);
      const result = await this.#runAgent(call, p, { text, whenBusy: 'queue' });
      if (result.status === 'finished') {
        const body = String(result.text || '').trim();
        if (!body) return this.#finish(call, 'error', new AppError('empty', 'AI 没有给出讲解，可以再试一次'));
        p.explain[mode] = { text: clamp(body, 20000), at: nowIso(), model: call.model, durationMs: Date.now() - call.startedAt, sessionId: result.sessionId, turnId: result.turnId || '' };
        if (p.session) p.session.primed = true;
        this.#finish(call, 'done');
      } else if (result.status === 'aborted') {
        this.#finish(call, call.timedOut ? 'timeout' : 'cancelled', new AppError(call.timedOut ? 'timeout' : 'cancelled', call.timedOut ? '用时太长，已停止' : '已取消'));
      } else {
        this.#finish(call, 'error', new AppError('agent_error', result.error?.message ? 'AI 出错了：' + clip(result.error.message, 160) : 'AI 没有完成这次讲解'));
      }
    } catch (error) {
      this.#fail(call, error);
    }
  }

  // ---------- 追问 / 备注 / 整理 ----------
  sendMessage(key, text, { whenBusy = 'queue' } = {}) {
    this.#require();
    const p = this.shelf.project(key);
    const t = String(text ?? '').trim();
    if (!t) throw new AppError('bad_message', '先写点什么再发送');
    if (t.length > 4000) throw new AppError('bad_message', '内容太长了（最多 4000 字）');
    const mode = whenBusy === 'steer' ? 'steer' : 'queue';
    const call = this.#newCall(key, 'message', { timeoutMs: TIMEOUT_MS.message });
    this.#chatAdd(p, 'user', t, { how: mode });
    void this.#runChat(call, p, primeProject(p) + t, { whenBusy: mode, project: p });
    this.#push(call, true);
    return this.#view(call);
  }

  askAiNotes(key) {
    this.#require();
    const p = this.shelf.project(key);
    if (this.#active(key, 'notes')) throw new AppError('busy', 'AI 正在记备注', 409);
    const call = this.#newCall(key, 'notes', { timeoutMs: TIMEOUT_MS.notes });
    this.#chatAdd(p, 'sys', '已发给 AI：' + notesMsg(p));
    void this.#runChat(call, p, notesMsg(p), { whenBusy: 'queue', project: p });
    this.#push(call, true);
    return this.#view(call);
  }

  managerSend(text) {
    this.#require();
    const m = this.state.manager;
    const t = String(text ?? '').trim();
    if (!t) throw new AppError('bad_message', '先写点什么再发送');
    if (t.length > 1000) throw new AppError('bad_message', '内容太长了（最多 1000 字）');
    if (this.#active(MANAGER_KEY, 'manager')) throw new AppError('busy', 'AI 正在整理，等它做完再说', 409);
    const call = this.#newCall(MANAGER_KEY, 'manager', { timeoutMs: TIMEOUT_MS.manager });
    this.#chatAdd(m, 'user', t);
    void this.#runChat(call, m, primeManager + t, { whenBusy: 'queue', project: null });
    this.#push(call, true);
    return this.#view(call);
  }

  async #runChat(call, holder, text, { whenBusy, project }) {
    try {
      call.startedAt = Date.now();
      call.status = 'preparing';
      call.phase = '准备';
      this.#push(call);
      const { dir } = await this.#prepare(holder);
      await this.#writePrompts(dir);
      if (project) await this.#writeProjectFiles(dir, project, project.cache ? 'local' : 'cloud');
      call.status = 'running';
      call.phase = 'AI 正在回复';
      this.#push(call, true);
      const result = await this.#runAgent(call, holder, { text, whenBusy });
      if (result.status === 'steered') {
        this.#finish(call, 'done');
      } else if (result.status === 'finished') {
        this.#chatAdd(holder, 'ai', String(result.text || '').trim() || '（AI 没有回复）', { model: call.model });
        if (holder.session) holder.session.primed = true;
        this.#finish(call, 'done');
      } else if (result.status === 'aborted') {
        this.#finish(call, call.timedOut ? 'timeout' : 'cancelled', new AppError(call.timedOut ? 'timeout' : 'cancelled', call.timedOut ? '用时太长，已停止' : '已取消'));
        this.#chatFail(holder, call);
      } else {
        this.#finish(call, 'error', new AppError('agent_error', result.error?.message ? 'AI 出错了：' + clip(result.error.message, 160) : 'AI 没有完成这次回复'));
        this.#chatFail(holder, call);
      }
    } catch (error) {
      this.#fail(call, error);
      this.#chatFail(holder, call);
    }
  }

  /** 追问 / 记备注 / 整理没做成时，在聊天里写一行原因（否则界面上什么都不会留下） */
  #chatFail(holder, call) {
    if (!call.error) return;
    if (call.status === 'cancelled') this.#chatAdd(holder, 'sys', '已停止这次回复。');
    else this.#chatAdd(holder, 'sys', '这次没有完成：' + call.error.message, { error: true });
  }

  /** 新开会话：旧会话卡住或想让 AI 忘掉之前的对话时用。讲解、备注、聊天记录都保留 */
  resetSession(key) {
    this.#require();
    const holder = this.#holder(key);
    if (this.busyKind(key)) throw new AppError('busy', 'AI 正在工作，等它做完，或先点「停止」', 409);
    holder.session = null;
    this.#chatAdd(holder, 'sys', '已新开会话：AI 不再记得之前的对话，讲解和备注都还在。');
    this.shelf.store.touch();
    return { ok: true };
  }

  cancel(key) {
    const list = (this.calls.get(key) || []).filter((c) => !TERMINAL.has(c.status));
    if (!list.length) throw new AppError('nothing', '没有进行中的任务', 404);
    for (const c of list) {
      if (c.status === 'queued') {
        this.queue = this.queue.filter((x) => x !== c);
        this.#finish(c, 'cancelled', new AppError('cancelled', '已取消'));
      } else {
        c.ctl.abort();
      }
    }
    this.#schedule();
    return this.callViews(key);
  }

  async replyPermission(key, { requestId, decision }) {
    this.#require();
    if (decision !== 'allowOnce' && decision !== 'deny') throw new AppError('bad_decision', '只能选「允许一次」或「拒绝」');
    const call = (this.calls.get(key) || []).find((c) => c.pendingPermission?.requestId === requestId);
    if (!call) throw new AppError('request_gone', '这个确认已经处理过了', 404);
    const perm = call.pendingPermission;
    try {
      await this.#call(() => this.agent.reply({ sessionId: perm.sessionId, requestId, decision }));
    } catch (error) {
      if (error.code !== 'request_gone') throw error;
    }
    clearTimeout(call.permTimer);
    call.pendingPermission = null;
    call.status = call.prevStatus || 'running';
    call.timer?.resume();
    this.#push(call, true);
    return this.callViews(key);
  }

  // ---------- 本地缓存 ----------
  #cacheRoot() {
    const dir = this.state.settings.agentDir;
    return dir ? join(dir, 'cache', 'repos') : '';
  }
  /** 这个项目的缓存文件夹：优先用拉取时记下的位置；老记录没有，就按 AI 工作文件夹推出来 */
  #cacheDirOf(p) {
    const root = this.#cacheRoot();
    const dir = p.cache?.dir || (root ? join(root, p.key) : '');
    return isCacheDirFor(dir, p.key) ? dir : '';
  }
  /** 缓存记录还在、文件夹却没了（手动删了，或数据搬到了另一台电脑）：清掉记录，免得页面还说「已缓存」 */
  async verifyCache(key) {
    const p = this.state.projects[key];
    if (!p?.cache) return;
    const dir = this.#cacheDirOf(p);
    if (dir && (await isDir(join(dir, '.git')))) return;
    p.cache = null;
    this.shelf.changed('project', key);
  }
  async removeProjectCache(key) {
    if (!isKey(key)) return;
    const p = this.state.projects[key];
    const dir = p ? this.#cacheDirOf(p) : '';
    if (dir) await rm(dir, { recursive: true, force: true });
    if (p) {
      p.cache = null;
      this.shelf.changed('project', key);
    }
  }
  /** 删除项目时，把给 AI 看的资料（projects/<key>/，含 README 副本和备注）也清掉 */
  async removeProjectFiles(key) {
    if (!isKey(key)) return;
    const p = this.state.projects[key];
    const dirs = new Set([this.state.settings.agentDir, p?.session ? this.dirBySession.get(p.session.id) : ''].filter(Boolean));
    for (const dir of dirs) {
      const root = join(dir, 'projects');
      const target = join(root, key);
      if (isInside(root, target)) await rm(target, { recursive: true, force: true });
    }
  }
  async clearAllCache() {
    let n = 0;
    for (const p of Object.values(this.state.projects)) {
      if (p.cache) {
        await this.removeProjectCache(p.key);
        n += 1;
      }
    }
    return { cleared: n };
  }
  async cacheSummary() {
    const items = [];
    for (const p of Object.values(this.state.projects)) {
      if (!p.cache) continue;
      await this.verifyCache(p.key);
      if (!p.cache) continue;
      items.push({ key: p.key, fullName: p.fullName, sizeKB: p.cache.sizeKB || 0, clonedAt: p.cache.clonedAt, dir: this.#cacheDirOf(p) });
    }
    return { dir: this.#cacheRoot(), items, totalKB: items.reduce((x, y) => x + y.sizeKB, 0) };
  }
  /** 给设置页看的真实位置 */
  paths() {
    const dir = this.state.settings.agentDir;
    return { platform: this.shelf.gh.platform, data: this.shelf.ctx.dataDir, agentDir: dir || '', prompts: dir ? join(dir, 'prompts') : '', cache: this.#cacheRoot() };
  }

  /**
   * 启动时校正「AI 工作文件夹」：问宿主某个已有会话现在在哪干活。
   * 数据是从别的电脑搬来的，也会在这里更新成这台电脑的位置；那台电脑上的会话在这里找不到，就试下一个。
   */
  async refreshAgentDir() {
    if (!this.agent || !this.status().available) return;
    let tries = 0;
    for (const holder of [this.state.manager, ...Object.values(this.state.projects)]) {
      const id = holder?.session?.id;
      if (!id) continue;
      if (tries >= 5) return;
      tries += 1;
      try {
        await this.#agentDirFor(id);
        return;
      } catch {
        /* 这个会话不在这台电脑上，试下一个 */
      }
    }
  }

  dispose() {
    for (const list of this.calls.values()) for (const c of list) if (!TERMINAL.has(c.status)) c.ctl.abort();
    for (const t of this.pushTimers.values()) clearTimeout(t);
    this.pushTimers.clear();
  }
}
