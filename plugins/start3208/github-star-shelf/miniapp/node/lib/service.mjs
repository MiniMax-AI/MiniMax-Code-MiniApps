import { AppError, clamp, isKey, keyOf, newId, nowIso, parseRepoRef } from './util.mjs';
import { DEFAULT_COLLECTION } from './store.mjs';
import { GitHub } from './github.mjs';
import { searchProjects } from './search.mjs';
import { AgentHub } from './agent.mjs';

const META_FIELDS = ['url', 'description', 'language', 'stars', 'forks', 'topics', 'license', 'homepage', 'pushedAt', 'createdAt', 'archived', 'fork', 'defaultBranch', 'sizeKB'];
const DAY = 24 * 3600 * 1000;

/** 收藏夹的全部业务逻辑。页面、MCP 工具、后台任务都走这里，改完先落盘再通知页面 */
export class Shelf {
  constructor(context, store, options = {}) {
    this.ctx = context;
    this.store = store;
    // 自己的停止信号：宿主停止 Mini App 时（context.signal）会触发它，dispose() 也会触发它。
    // gh / git 的在途子进程（包括检测用的探测）都挂在它上面：不管宿主先发信号、还是直接调 dispose()，它们都会一起终止。
    // options.envCtx 只给测试注入假环境
    this.stopCtl = new AbortController();
    this.onHostAbort = () => this.stopCtl.abort();
    if (context.signal?.aborted) this.stopCtl.abort();
    else context.signal?.addEventListener('abort', this.onHostAbort, { once: true });
    this.gh = new GitHub(context.logger, { signal: this.stopCtl.signal, envCtx: options.envCtx });
    this.listeners = new Set();
    this.importJob = null;
    this.prefetchJob = null;
    this.readmeInflight = new Map();
    this.closed = false;
    this.hub = new AgentHub(this);
  }

  get state() {
    return this.store.state;
  }

  init() {
    this.gh.setOverrides({ gh: this.state.settings.ghPath, git: this.state.settings.gitPath });
    // start 期间不联网、不问宿主（宿主要求先把服务跑起来）：gh / git 的检测和 AI 的工作文件夹，都等页面第一次来取状态时再做（见 stateView）
    const s = this.state;
    if (!s.manager || typeof s.manager !== 'object') s.manager = { session: null, chat: [] };
    s.manager.chat = Array.isArray(s.manager.chat) ? s.manager.chat : [];
    for (const p of Object.values(s.projects)) {
      if (p.lastCall && !['done', 'error', 'cancelled', 'timeout', 'interrupted'].includes(p.lastCall.status)) {
        p.lastCall = { ...p.lastCall, status: 'interrupted', error: '上次被中断了，可以重新来一次' };
      }
    }
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(evt) {
    for (const fn of this.listeners) {
      try {
        fn(evt);
      } catch {
        /* 一个页面出错不影响其他页面 */
      }
    }
  }
  changed(scope = 'all', key) {
    this.store.touch();
    this.emit({ type: 'changed', scope, key });
  }

  // ---------- 收藏夹 ----------
  collections() {
    const counts = new Map();
    for (const p of Object.values(this.state.projects)) for (const id of p.collections) counts.set(id, (counts.get(id) || 0) + 1);
    return this.state.collections
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((c) => ({ id: c.id, name: c.name, description: c.description || '', isDefault: Boolean(c.isDefault), count: counts.get(c.id) || 0 }));
  }

  resolveCollection(ref) {
    const s = String(ref ?? '').trim();
    if (!s) return null;
    const list = this.state.collections;
    return list.find((c) => c.id === s) || list.find((c) => c.name.toLowerCase() === s.toLowerCase()) || null;
  }

  #checkName(name, exceptId) {
    const n = String(name ?? '').trim();
    if (!n) throw new AppError('bad_name', '收藏夹要有名字');
    if ([...n].length > 30) throw new AppError('bad_name', '名字太长了（最多 30 个字）');
    if (n === '全部') throw new AppError('bad_name', '「全部」是保留名');
    if (this.state.collections.some((c) => c.id !== exceptId && c.name.toLowerCase() === n.toLowerCase())) {
      throw new AppError('exists', '已经有同名的收藏夹了', 409);
    }
    return n;
  }

  createCollection({ name, description = '' }) {
    const n = this.#checkName(name);
    if (this.state.collections.length >= 100) throw new AppError('too_many', '收藏夹太多了（最多 100 个）');
    const order = Math.max(0, ...this.state.collections.map((c) => c.order || 0)) + 1;
    const c = { id: newId('c'), name: n, description: clamp(description, 200).trim(), isDefault: false, createdAt: nowIso(), order };
    this.state.collections.push(c);
    this.changed('collections');
    return this.collections().find((x) => x.id === c.id);
  }

  updateCollection(ref, { name, description }) {
    const c = this.resolveCollection(ref);
    if (!c) throw new AppError('no_collection', '没有这个收藏夹', 404);
    if (name !== undefined) {
      if (c.isDefault) throw new AppError('default_locked', '默认收藏夹不能改名');
      c.name = this.#checkName(name, c.id);
    }
    if (description !== undefined) c.description = clamp(description, 200).trim();
    this.changed('collections');
    return this.collections().find((x) => x.id === c.id);
  }

  deleteCollection(ref) {
    const c = this.resolveCollection(ref);
    if (!c) throw new AppError('no_collection', '没有这个收藏夹', 404);
    if (c.isDefault) throw new AppError('default_locked', '默认收藏夹不能删除');
    this.state.collections = this.state.collections.filter((x) => x.id !== c.id);
    for (const p of Object.values(this.state.projects)) p.collections = p.collections.filter((id) => id !== c.id);
    this.changed('collections');
    return { id: c.id, name: c.name };
  }

  setMembership(key, { add = [], remove = [] }) {
    const p = this.project(key);
    const known = new Set(this.state.collections.map((c) => c.id));
    for (const id of add) if (known.has(id) && !p.collections.includes(id)) p.collections.push(id);
    for (const id of remove) p.collections = p.collections.filter((x) => x !== id);
    this.changed('project', key);
    return p.collections.slice();
  }

  // ---------- 项目 ----------
  project(key) {
    if (!isKey(key)) throw new AppError('bad_key', '项目标识不对');
    const p = this.state.projects[key];
    if (!p) throw new AppError('no_project', '没有这个项目', 404);
    return p;
  }

  #upsert(meta, { defaultCollections = [], source = 'star' } = {}) {
    const key = keyOf(meta.fullName);
    let p = this.state.projects[key];
    let created = false;
    if (!p) {
      const [owner, name] = meta.fullName.split('/');
      p = this.state.projects[key] = {
        key, fullName: meta.fullName, owner, name, addedAt: nowIso(), source,
        collections: [], notes: [], chat: [], explain: {}, session: null, readme: null, cache: null, lastCall: null,
      };
      for (const id of defaultCollections) if (!p.collections.includes(id)) p.collections.push(id);
      created = true;
    }
    p.fullName = meta.fullName;
    for (const f of META_FIELDS) if (meta[f] !== undefined) p[f] = meta[f];
    if (meta.starredAt) p.starredAt = meta.starredAt;
    else if (p.starredAt === undefined) p.starredAt = null;
    return { p, created };
  }

  async addProject(ref, collectionIds = []) {
    const parsed = parseRepoRef(ref);
    if (!parsed) throw new AppError('bad_repo', '这不是 GitHub 项目地址，可以填 owner/repo 或网址');
    const key = keyOf(parsed.fullName);
    let p = this.state.projects[key];
    const isNew = !p;
    if (!p) {
      const meta = await this.gh.getRepo(parsed.fullName);
      ({ p } = this.#upsert(meta, { source: 'manual' }));
    }
    const ids = collectionIds.length ? collectionIds : isNew ? [DEFAULT_COLLECTION] : [];
    for (const id of ids) if (!p.collections.includes(id) && this.state.collections.some((c) => c.id === id)) p.collections.push(id);
    this.changed('project', key);
    if (isNew) void this.ensureReadme(key).catch(() => {});
    return p;
  }

  async removeProject(key) {
    const p = this.project(key);
    await this.hub.removeProjectCache(key).catch(() => {});
    await this.hub.removeProjectFiles(key).catch(() => {});
    await this.store.deleteReadme(key).catch(() => {});
    delete this.state.projects[key];
    this.changed('all');
    return { key, fullName: p.fullName };
  }

  // ---------- 备注 ----------
  addNote(key, text, author = 'user') {
    const p = this.project(key);
    const t = String(text ?? '').trim();
    if (!t) throw new AppError('bad_note', '备注不能是空的');
    if (p.notes.length >= 100) throw new AppError('too_many', '备注太多了（最多 100 条）');
    const note = { id: newId('n'), author: author === 'ai' ? 'ai' : 'user', text: clamp(t, 2000), createdAt: nowIso(), updatedAt: nowIso() };
    p.notes.push(note);
    this.changed('project', key);
    return note;
  }
  updateNote(key, id, text) {
    const p = this.project(key);
    const n = p.notes.find((x) => x.id === id);
    if (!n) throw new AppError('no_note', '没有这条备注', 404);
    const t = String(text ?? '').trim();
    if (!t) throw new AppError('bad_note', '备注不能是空的');
    n.text = clamp(t, 2000);
    n.updatedAt = nowIso();
    this.changed('project', key);
    return n;
  }
  deleteNote(key, id) {
    const p = this.project(key);
    const before = p.notes.length;
    p.notes = p.notes.filter((x) => x.id !== id);
    if (p.notes.length === before) throw new AppError('no_note', '没有这条备注', 404);
    this.changed('project', key);
    return { id };
  }

  // ---------- README ----------
  async ensureReadme(key, { force = false, signal } = {}) {
    const p = this.project(key);
    if (!force) {
      const cached = await this.store.readReadme(key);
      if (cached !== null) return { status: 'ok', text: cached };
      if (p.readme?.status === 'none' && Date.now() - Date.parse(p.readme.fetchedAt || 0) < DAY) return { status: 'none', text: '' };
    }
    if (this.readmeInflight.has(key)) return this.readmeInflight.get(key);
    const task = (async () => {
      try {
        const r = await this.gh.getReadme(p.fullName, { signal });
        if (r.status === 'ok') {
          await this.store.writeReadme(key, r.text);
          p.readme = { status: 'ok', fetchedAt: nowIso(), size: r.text.length };
        } else {
          await this.store.deleteReadme(key).catch(() => {});
          p.readme = { status: 'none', fetchedAt: nowIso(), size: 0 };
        }
        this.changed('project', key);
        return r;
      } finally {
        this.readmeInflight.delete(key);
      }
    })();
    this.readmeInflight.set(key, task);
    return task;
  }

  async getReadme(key, { force = false } = {}) {
    const p = this.project(key);
    const r = await this.ensureReadme(key, { force });
    return { status: r.status, text: r.text, repo: p.fullName, branch: p.defaultBranch || 'HEAD', fetchedAt: p.readme?.fetchedAt || null };
  }

  startPrefetch() {
    if (this.prefetchJob?.status === 'running') return this.prefetchView();
    const todo = Object.values(this.state.projects).filter((p) => !p.readme);
    const job = { status: 'running', total: todo.length, done: 0, failed: 0, error: '', ctl: new AbortController(), startedAt: nowIso() };
    this.prefetchJob = job;
    if (todo.length === 0) {
      job.status = 'done';
      return this.prefetchView();
    }
    const queue = todo.slice();
    const worker = async () => {
      while (queue.length && !job.ctl.signal.aborted && job.status === 'running') {
        const p = queue.shift();
        try {
          await this.ensureReadme(p.key, { signal: job.ctl.signal });
        } catch (error) {
          job.failed += 1;
          if (error.code === 'rate_limited') {
            job.status = 'error';
            job.error = error.message;
          }
        }
        job.done += 1;
        this.emit({ type: 'prefetch' });
      }
    };
    void Promise.all([worker(), worker(), worker()]).then(() => {
      if (job.status === 'running') job.status = job.ctl.signal.aborted ? 'cancelled' : 'done';
      this.emit({ type: 'prefetch' });
      this.emit({ type: 'changed', scope: 'projects' });
    });
    this.emit({ type: 'prefetch' });
    return this.prefetchView();
  }
  cancelPrefetch() {
    if (this.prefetchJob?.status === 'running') {
      this.prefetchJob.status = 'cancelled';
      this.prefetchJob.ctl.abort();
      this.emit({ type: 'prefetch' });
    }
    return this.prefetchView();
  }
  prefetchView() {
    const j = this.prefetchJob;
    return j ? { status: j.status, total: j.total, done: j.done, failed: j.failed, error: j.error } : { status: 'idle', total: 0, done: 0, failed: 0, error: '' };
  }

  // ---------- 导入 Star ----------
  startImport({ user } = {}) {
    if (this.importJob?.status === 'running') throw new AppError('busy', '正在导入中', 409);
    const job = { status: 'running', startedAt: nowIso(), fetched: 0, total: null, added: 0, updated: 0, error: '', errorCode: '', user: '', ctl: new AbortController() };
    this.importJob = job;
    void this.#runImport(job, user);
    this.emit({ type: 'import' });
    return this.importView();
  }

  async #runImport(job, userArg) {
    try {
      const s = this.state.settings;
      let user = typeof userArg === 'string' ? userArg.trim() : s.githubUser;
      if (typeof userArg === 'string' && userArg.trim() !== s.githubUser) {
        s.githubUser = userArg.trim();
        this.store.touch();
      }
      job.total = await this.gh.starCount(user);
      this.emit({ type: 'import' });
      const res = await this.gh.listStars({
        user,
        signal: job.ctl.signal,
        onPage: ({ fetched }) => {
          job.fetched = fetched;
          this.emit({ type: 'import' });
        },
      });
      job.user = res.user;
      for (const meta of res.items) {
        const { created } = this.#upsert(meta, { defaultCollections: [DEFAULT_COLLECTION], source: 'star' });
        if (created) job.added += 1;
        else job.updated += 1;
      }
      job.source = res.source;
      this.state.importReport = { at: nowIso(), user: res.user, fetched: res.items.length, added: job.added, updated: job.updated, source: res.source };
      job.status = 'done';
      this.changed('all');
      this.ctx.logger.info('shelf.import.done', { fetched: res.items.length, added: job.added });
      this.startPrefetch();
    } catch (error) {
      job.status = error.code === 'cancelled' ? 'cancelled' : 'error';
      job.error = error.message || '导入失败';
      job.errorCode = error.code || 'error';
      this.ctx.logger.warn('shelf.import.failed', { code: job.errorCode });
    }
    this.emit({ type: 'import' });
  }

  cancelImport() {
    if (this.importJob?.status === 'running') this.importJob.ctl.abort();
    return this.importView();
  }

  importView() {
    const j = this.importJob;
    if (!j) return { status: 'idle', fetched: 0, total: null, added: 0, updated: 0, error: '' };
    return { status: j.status, fetched: j.fetched, total: j.total, added: j.added, updated: j.updated, error: j.error, errorCode: j.errorCode, user: j.user, source: j.source || '' };
  }

  // ---------- 视图 ----------
  card(p, match) {
    return {
      key: p.key,
      fullName: p.fullName,
      description: p.description || '',
      language: p.language || '',
      stars: p.stars || 0,
      pushedAt: p.pushedAt || '',
      starredAt: p.starredAt || null,
      archived: Boolean(p.archived),
      topics: (p.topics || []).slice(0, 4),
      collections: p.collections,
      hasReadme: p.readme?.status === 'ok',
      noteCount: p.notes.length,
      explained: { cloud: Boolean(p.explain?.cloud), local: Boolean(p.explain?.local) },
      hasSession: Boolean(p.session),
      busy: this.hub.busyKind(p.key),
      match: match ? { where: match.where, snippet: match.snippet || null } : null,
    };
  }

  async list(query) {
    const r = await searchProjects(this.store, query);
    return { total: r.total, items: r.items.map((h) => this.card(h.p, h.match)), languages: r.languages, terms: r.terms };
  }

  detail(key) {
    const p = this.project(key);
    return {
      ...this.card(p),
      url: p.url,
      homepage: p.homepage || '',
      license: p.license || '',
      forks: p.forks || 0,
      topics: p.topics || [],
      defaultBranch: p.defaultBranch || '',
      sizeKB: p.sizeKB || 0,
      createdAt: p.createdAt || '',
      fork: Boolean(p.fork),
      notes: p.notes,
      explain: p.explain || {},
      chat: p.chat.slice(-40),
      session: p.session ? { id: p.session.id, primed: Boolean(p.session.primed) } : null,
      cache: p.cache || null,
      readme: p.readme || null,
      calls: this.hub.callViews(key),
      lastCall: p.lastCall || null,
    };
  }

  /** 不等联网检测：用最近一次的结果，过期了就在后台重测，测完通知页面刷新 */
  githubView() {
    const fresh = this.gh.info && Date.now() - this.gh.infoAt < 60000;
    if (!fresh && !this.ghChecking) {
      this.ghChecking = true;
      this.gh
        .detect(true)
        .catch(() => null)
        .finally(() => {
          this.ghChecking = false;
          this.emit({ type: 'changed', scope: 'settings' });
        });
    }
    return this.gh.info || { transport: 'unknown', gh: null, git: null, authed: false, user: '', note: '', checking: true };
  }

  async stateView() {
    if (!this.agentDirAsked) {
      this.agentDirAsked = true;
      void this.hub
        .refreshAgentDir()
        .then(() => this.emit({ type: 'changed', scope: 'settings' }))
        .catch(() => null);
    }
    const gh = this.githubView();
    const all = Object.values(this.state.projects);
    return {
      rev: this.store.rev,
      settings: { ...this.state.settings },
      github: gh,
      agent: this.hub.status(),
      collections: this.collections(),
      totals: {
        projects: all.length,
        withReadme: all.filter((p) => p.readme?.status === 'ok').length,
        explainedCloud: all.filter((p) => p.explain?.cloud).length,
        explainedLocal: all.filter((p) => p.explain?.local).length,
        noted: all.filter((p) => p.notes.length).length,
      },
      import: this.importView(),
      prefetch: this.prefetchView(),
      importReport: this.state.importReport,
      manager: { session: Boolean(this.state.manager?.session), chat: (this.state.manager?.chat || []).slice(-20), calls: this.hub.callViews('__manager__') },
      mcpServer: 'github-star-shelf',
      paths: this.hub.paths(),
    };
  }

  /** 用户点「重新检测」：重新找 gh / git（包括重新问一遍登录 shell 的 PATH） */
  async recheckGithub() {
    const info = await this.gh.recheck();
    this.emit({ type: 'changed', scope: 'settings' });
    return info;
  }

  async updateSettings(patch) {
    const s = this.state.settings;
    const next = {};
    if (patch.concurrency !== undefined) {
      const n = Number(patch.concurrency);
      if (!Number.isInteger(n) || n < 1 || n > 4) throw new AppError('bad_setting', '同时讲解的数量要在 1 到 4 之间');
      next.concurrency = n;
    }
    if (patch.modelKey !== undefined) next.modelKey = clamp(patch.modelKey, 200);
    if (patch.effort !== undefined) {
      if (!['max', 'xhigh', 'high', 'medium', 'low', 'default'].includes(patch.effort)) throw new AppError('bad_setting', '思考强度不对');
      next.effort = patch.effort;
    }
    if (patch.imageMode !== undefined) {
      if (!['github', 'all', 'none'].includes(patch.imageMode)) throw new AppError('bad_setting', '图片显示方式不对');
      next.imageMode = patch.imageMode;
    }
    if (patch.githubUser !== undefined) {
      const u = String(patch.githubUser).trim();
      if (u && !/^[A-Za-z0-9-]{1,39}$/.test(u)) throw new AppError('bad_setting', 'GitHub 用户名格式不对');
      next.githubUser = u;
    }
    if (patch.cloneMaxMB !== undefined) {
      const n = Number(patch.cloneMaxMB);
      if (!Number.isFinite(n) || n < 20 || n > 5000) throw new AppError('bad_setting', '本地拉取的大小上限要在 20 到 5000 MB 之间');
      next.cloneMaxMB = Math.round(n);
    }
    for (const [field, name] of [['ghPath', 'gh'], ['gitPath', 'git']]) {
      if (patch[field] === undefined) continue;
      const value = String(patch[field] ?? '').trim().slice(0, 500);
      const check = await this.gh.checkTool(name, value);
      if (!check.ok) throw new AppError('bad_setting', name + ' 的路径不能用：' + check.reason);
      next[field] = value;
    }
    Object.assign(s, next);
    if ('ghPath' in next || 'gitPath' in next) this.gh.setOverrides({ gh: s.ghPath, git: s.gitPath });
    this.hub.resetModelCache();
    this.changed('settings');
    return { ...s };
  }

  exportMarkdown(ref) {
    const c = ref && ref !== 'all' ? this.resolveCollection(ref) : null;
    if (ref && ref !== 'all' && !c) throw new AppError('no_collection', '没有这个收藏夹', 404);
    const list = Object.values(this.state.projects)
      .filter((p) => !c || p.collections.includes(c.id))
      .sort((a, b) => String(b.starredAt || '').localeCompare(String(a.starredAt || '')));
    const lines = ['# ' + (c ? c.name : '全部收藏'), '', '共 ' + list.length + ' 个项目', ''];
    for (const p of list) {
      lines.push('- [' + p.fullName + '](' + p.url + ')' + (p.stars ? '（★ ' + p.stars + '）' : '') + (p.description ? '：' + p.description : ''));
      for (const n of p.notes) lines.push('  - ' + (n.author === 'ai' ? 'AI 备注' : '备注') + '：' + n.text.replace(/\n+/g, ' '));
    }
    return lines.join('\n') + '\n';
  }

  async dispose() {
    this.closed = true;
    this.stopCtl.abort(); // 先终止所有在途的 gh / git 子进程
    this.ctx.signal?.removeEventListener('abort', this.onHostAbort);
    this.importJob?.ctl.abort();
    this.prefetchJob?.ctl.abort();
    this.hub.dispose();
    await this.store.close();
  }
}
