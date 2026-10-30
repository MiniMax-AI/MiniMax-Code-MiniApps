/**
 * OpenViking read-only HTTP adapter.
 *
 * Implements the FileSystem contract (see fs-api.js) on top of the
 * OpenViking REST API. Read-only: only GET endpoints are used.
 *
 * Base URL example:  http://localhost:1933
 * Auth:              X-API-Key header (optional in dev/no-auth mode)
 *
 * Endpoints used (from OpenViking docs, /api/v1/...):
 *   GET  /health                                 — connectivity probe
 *   GET  /api/v1/fs/ls?uri=...&recursive=&simple=
 *   GET  /api/v1/fs/tree?uri=...&level_limit=... — shallow tree preload
 *   GET  /api/v1/fs/read?uri=...                 — file contents
 *   GET  /api/v1/fs/stat?uri=...                 — metadata (best-effort)
 *   POST /api/v1/search/find                     — semantic search
 *
 * Path convention in our app: POSIX paths like "/resources/my_project/docs"
 * map to URIs like "viking://resources/my_project/docs/".
 */

(function () {
  const { FileSystem, FsError, Path, detectMime } = window.FS;

  const VIKING_PROTOCOL = 'viking://';
  const CACHE_TTL_MS = 5000;
  const STALE_FALLBACK_MS = 5000;
  const LIST_NODE_LIMIT = 256;
  const LIST_ABS_LIMIT = 128;
  const TREE_LEVEL_LIMIT = 3;
  const TREE_NODE_LIMIT = 256;
  const TREE_ABS_LIMIT = 128;

  // path "/" -> "viking://"
  // path "/resources" -> "viking://resources/"
  // path "/resources/foo/bar.md" -> "viking://resources/foo/bar.md"
  function pathToUri(path) {
    path = Path.normalize(path);
    if (path === '/') return VIKING_PROTOCOL;
    return VIKING_PROTOCOL + path.slice(1);
  }
  function uriToPath(uri) {
    if (!uri) return '/';
    if (!uri.startsWith(VIKING_PROTOCOL)) return uri.startsWith('/') ? uri : '/' + uri;
    let rest = uri.slice(VIKING_PROTOCOL.length);
    if (rest.endsWith('/')) rest = rest.slice(0, -1);
    return rest ? '/' + rest : '/';
  }

  function pathToDirectoryUri(path) {
    const uri = pathToUri(path);
    return uri === VIKING_PROTOCOL || uri.endsWith('/') ? uri : uri + '/';
  }

  function makeQuery(params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v == null) continue;
      qs.set(k, String(v));
    }
    return qs.toString();
  }

  function isSummaryPlaceholder(text) {
    const t = String(text || '').trim();
    return /\[directory (overview|abstract) is not (generated|ready)\]/i.test(t);
  }

  function usableSummary(text) {
    return typeof text === 'string' && text.trim() && !isSummaryPlaceholder(text);
  }

  function firstString(...values) {
    for (const value of values) {
      if (typeof value === 'string') return value;
    }
    return null;
  }

  function truthyLevelFlag(value) {
    if (value == null) return null;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value > 0;
    if (typeof value === 'string') {
      const v = value.trim().toLowerCase();
      if (!v) return false;
      if (['true', 'ready', 'available', 'generated', '1', 'yes'].includes(v)) return true;
      if (['false', 'not_ready', 'unavailable', 'missing', '0', 'no'].includes(v)) return false;
    }
    return null;
  }

  function levelListed(entry, level) {
    const wanted = level.toLowerCase();
    const values = [
      entry.levels,
      entry.availableLevels,
      entry.available_levels,
      entry.summaryLevels,
      entry.summary_levels,
    ];
    for (const value of values) {
      if (Array.isArray(value)) return value.map((v) => String(v).toLowerCase()).includes(wanted);
      if (value && typeof value === 'object') {
        const raw = value[level] ?? value[level.toUpperCase()] ?? value[wanted] ?? value[wanted.toUpperCase()];
        const flag = truthyLevelFlag(raw);
        if (flag != null) return flag;
      }
    }
    return null;
  }

  function inferPreviewLevels(entry) {
    const abstract = firstString(entry.abstract, entry.l0, entry.L0, entry.summary);
    const overview = firstString(entry.overview, entry.l1, entry.L1);
    const l0 = usableSummary(abstract)
      || truthyLevelFlag(entry.hasAbstract ?? entry.has_abstract ?? entry.abstractReady ?? entry.abstract_ready) === true
      || levelListed(entry, 'l0') === true;
    const explicitL1 = truthyLevelFlag(entry.hasOverview ?? entry.has_overview ?? entry.overviewReady ?? entry.overview_ready);
    const listedL1 = levelListed(entry, 'l1');
    const l1 = usableSummary(overview)
      || explicitL1 === true
      || listedL1 === true
      || (explicitL1 == null && listedL1 == null && usableSummary(abstract));
    return { l0, l1 };
  }

  function mapStatusToErrCode(status) {
    if (status === 404) return 'ENOENT';
    if (status === 403 || status === 401) return 'EACCES';
    if (status === 400) return 'EINVAL';
    return 'EIO';
  }

  function truthyFlag(value) {
    return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
  }

  function isDirectoryEntry(entry) {
    const type = String(entry.type || entry.kind || entry.nodeType || '').toLowerCase();
    const uri = entry.uri || entry.path || '';
    return truthyFlag(entry.isDir)
      || truthyFlag(entry.is_dir)
      || truthyFlag(entry.isdir)
      || type === 'directory'
      || type === 'dir'
      || type === 'folder'
      || uri.endsWith('/');
  }

  class OpenVikingFs extends FileSystem {
    /**
     * @param {object} opts
     * @param {string} opts.url       - base URL, e.g. "http://localhost:1933"
     * @param {string} [opts.apiKey]  - X-API-Key value
     * @param {string} [opts.account] - X-OpenViking-Account (multi-tenant)
     * @param {string} [opts.user]    - X-OpenViking-User    (multi-tenant)
     * @param {number} [opts.timeoutMs=15000]
     */
    constructor(opts = {}) {
      super();
      this.url = (opts.url || '').replace(/\/$/, '');
      this.apiKey = opts.apiKey || '';
      this.account = opts.account || '';
      this.user = opts.user || '';
      this.timeoutMs = opts.timeoutMs ?? 15000;
      this.listNodeLimit = opts.listNodeLimit ?? LIST_NODE_LIMIT;
      this.treeLevelLimit = opts.treeLevelLimit ?? TREE_LEVEL_LIMIT;
      this.treeNodeLimit = opts.treeNodeLimit ?? TREE_NODE_LIMIT;
      this.treeAbsLimit = opts.treeAbsLimit ?? TREE_ABS_LIMIT;
      this._listCache = new Map();
      this._statCache = new Map();
      this._contentCache = new Map();
      this._listInflight = new Map();
      this._statInflight = new Map();
      this._contentInflight = new Map();
      this._treeInflight = new Map();
      this._treeWarmCache = new Map();
      this._dropPersistedListCache();
    }

    _lsKey() { return 'atlas-fs-cache:' + this.url; }

    _dropPersistedListCache() {
      try { localStorage.removeItem(this._lsKey()); } catch {}
    }

    _headers(extra = {}) {
      const h = { 'Accept': 'application/json', ...extra };
      if (this.apiKey) h['X-API-Key'] = this.apiKey;
      if (this.account) h['X-OpenViking-Account'] = this.account;
      if (this.user) h['X-OpenViking-User'] = this.user;
      return h;
    }

    async _req(pathOrUrl, init = {}) {
      const url = pathOrUrl.startsWith('http') ? pathOrUrl : this.url + pathOrUrl;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      let res;
      try {
        res = await fetch(url, {
          ...init,
          headers: this._headers(init.headers),
          signal: ctrl.signal,
        });
      } catch (e) {
        clearTimeout(timer);
        throw new FsError('EIO', `Network error: ${e.message}`, pathOrUrl);
      }
      clearTimeout(timer);
      if (!res.ok) {
        let body = '';
        try { body = await res.text(); } catch {}
        throw new FsError(mapStatusToErrCode(res.status), `${res.status} ${res.statusText}: ${body.slice(0, 200)}`, pathOrUrl);
      }
      return res;
    }

    async ping() {
      const res = await this._req('/health');
      return await res.json().catch(() => ({ status: 'ok' }));
    }

    _cacheWindow(ttl = CACHE_TTL_MS) {
      const now = Date.now();
      return { fetchedAt: now, expires: now + ttl, staleUntil: now + ttl + STALE_FALLBACK_MS };
    }

    _rememberStat(entry, ttl = CACHE_TTL_MS) {
      if (!entry?.path) return;
      const existing = this._statCache.get(entry.path)?.value;
      const value = existing ? { ...existing, ...entry, _levels: { ...(existing._levels || {}), ...(entry._levels || {}) } } : entry;
      this._statCache.set(entry.path, { value, ...this._cacheWindow(ttl) });
    }

    _rememberList(path, entries, opts = {}) {
      path = Path.normalize(path);
      const existing = this._listCache.get(path);
      // A truncated tree preload should never replace a fresh direct ls.
      if (opts.partial && opts.source === 'tree' && existing && existing.source === 'ls' && existing.expires > Date.now()) {
        return existing.entries;
      }
      const record = {
        entries,
        source: opts.source || 'ls',
        partial: !!opts.partial,
        ...this._cacheWindow(opts.ttl || CACHE_TTL_MS),
      };
      this._listCache.set(path, record);
      for (const e of entries) {
        this._rememberStat(e);
        if (e.type === 'directory' && usableSummary(e.abstract)) {
          this._rememberContent(e.path, 'l0', e.abstract, { source: opts.source || 'ls' });
        } else if (e.type === 'directory' && typeof e.abstract === 'string' && isSummaryPlaceholder(e.abstract)) {
          this._rememberContent(e.path, 'l0', '', { source: opts.source || 'ls', negative: true });
        }
        if (e.type === 'directory' && usableSummary(e.overview)) {
          this._rememberContent(e.path, 'l1', e.overview, { source: opts.source || 'ls' });
        } else if (e.type === 'directory' && typeof e.overview === 'string' && isSummaryPlaceholder(e.overview)) {
          this._rememberContent(e.path, 'l1', '', { source: opts.source || 'ls', negative: true });
        }
      }
      return entries;
    }

    _contentKey(path, level) {
      return `${level}:${Path.normalize(path)}`;
    }

    _rememberContent(path, level, content, opts = {}) {
      this._contentCache.set(this._contentKey(path, level), {
        content: content || '',
        negative: !!opts.negative,
        source: opts.source || 'read',
        ...this._cacheWindow(opts.ttl || CACHE_TTL_MS),
      });
    }

    _chunkFromContent(content, maxBytes, encoding) {
      const text = content || '';
      const truncated = text.length > maxBytes;
      return { content: truncated ? text.slice(0, maxBytes) : text, encoding, truncated };
    }

    hasPreviewLevel(path, level) {
      path = Path.normalize(path);
      const cached = this._contentCache.get(this._contentKey(path, level));
      if (cached && cached.staleUntil > Date.now()) return !cached.negative && !!cached.content;
      const stat = this._statCache.get(path)?.value;
      if (stat?._levels && level in stat._levels) return !!stat._levels[level];
      return false;
    }

    async prefetchTree(path = '/', opts = {}) {
      path = Path.normalize(path);
      const levelLimit = opts.levelLimit ?? this.treeLevelLimit;
      const nodeLimit = opts.nodeLimit ?? this.treeNodeLimit;
      const absLimit = opts.absLimit ?? this.treeAbsLimit;
      const showAllHidden = opts.showAllHidden ?? false;
      const key = [path, levelLimit, nodeLimit, absLimit, showAllHidden].join('|');
      const warmed = this._treeWarmCache.get(key);
      if (!opts.refresh && warmed && warmed.expires > Date.now()) return warmed.value;
      const existing = this._treeInflight.get(key);
      if (existing) return existing;

      const promise = this._fetchTree(path, { levelLimit, nodeLimit, absLimit, showAllHidden })
        .then((entries) => {
          this._treeWarmCache.set(key, { value: entries, ...this._cacheWindow(CACHE_TTL_MS) });
          return entries;
        })
        .catch((e) => {
          if (opts.strict) throw e;
          return null;
        })
        .finally(() => this._treeInflight.delete(key));
      this._treeInflight.set(key, promise);
      return promise;
    }

    async _fetchTree(path, opts) {
      const uri = pathToDirectoryUri(path);
      const url = '/api/v1/fs/tree?' + makeQuery({
        uri,
        output: 'agent',
        level_limit: opts.levelLimit,
        node_limit: opts.nodeLimit,
        abs_limit: opts.absLimit,
        show_all_hidden: opts.showAllHidden,
      });
      const res = await this._req(url, { cache: 'no-store' });
      const data = await res.json();
      const raw = data.result || data.entries || data || [];
      return this._cacheTreeResult(path, Array.isArray(raw) ? raw : [], opts);
    }

    _cacheTreeResult(rootPath, raw, opts) {
      rootPath = Path.normalize(rootPath);
      const entries = raw.map((e) => this._normalize(e, rootPath));
      const groups = new Map();
      for (const entry of entries) {
        this._rememberStat(entry);
        if (entry.type === 'directory' && usableSummary(entry.abstract)) {
          this._rememberContent(entry.path, 'l0', entry.abstract, { source: 'tree' });
        } else if (entry.type === 'directory' && typeof entry.abstract === 'string' && isSummaryPlaceholder(entry.abstract)) {
          this._rememberContent(entry.path, 'l0', '', { source: 'tree', negative: true });
        }
        const parent = Path.dirname(entry.path);
        const current = groups.get(parent) || [];
        current.push(entry);
        groups.set(parent, current);
      }

      const partialParents = new Set();
      if (raw.length >= opts.nodeLimit && entries.length) {
        let p = Path.dirname(entries[entries.length - 1].path);
        for (const a of Path.ancestors(p)) {
          if (rootPath === '/' || a === rootPath || a.startsWith(rootPath + '/')) partialParents.add(a);
        }
        partialParents.add(rootPath);
      }

      if (!groups.has(rootPath)) this._rememberList(rootPath, [], { source: 'tree' });
      for (const [parent, children] of groups) {
        if (rootPath !== '/' && parent !== rootPath && !parent.startsWith(rootPath + '/')) continue;
        this._rememberList(parent, children, {
          source: 'tree',
          partial: partialParents.has(parent),
        });
      }
      return entries;
    }

    /**
     * List a directory.
     * OpenViking response shape (per docs):
     *   { status: 'ok', result: [{ name, isDir, uri, size?, mtime? }, ...] }
     * Some servers return { entries: [...] }. We accept both.
     */
    async list(path, opts = {}) {
      path = Path.normalize(path);
      const refresh = truthyFlag(opts.refresh) || truthyFlag(opts.forceRefresh) || truthyFlag(opts.noCache);
      const cached = this._listCache.get(path);
      const now = Date.now();
      const treePartial = cached?.partial && cached.source === 'tree';
      if (!refresh && cached && cached.expires > now && !treePartial) {
        return this._applyOpts(cached.entries, opts);
      }

      const inflight = this._listInflight.get(path);
      if (inflight) {
        if (cached && cached.staleUntil > now) return this._applyOpts(cached.entries, opts);
        return this._applyOpts(await inflight, opts);
      }

      const promise = this._fetchListDirect(path).finally(() => this._listInflight.delete(path));
      this._listInflight.set(path, promise);
      try {
        return this._applyOpts(await promise, opts);
      } catch (e) {
        if (cached && cached.staleUntil > Date.now()) return this._applyOpts(cached.entries, opts);
        throw e;
      }
    }

    async _fetchListDirect(path) {
      const uri = pathToDirectoryUri(path);
      const url = '/api/v1/fs/ls?' + makeQuery({
        uri,
        output: 'agent',
        node_limit: this.listNodeLimit,
        abs_limit: LIST_ABS_LIMIT,
        show_all_hidden: false,
      });
      const res = await this._req(url, { cache: 'no-store' });
      const data = await res.json();
      const raw = data.result || data.entries || data || [];
      const entries = (Array.isArray(raw) ? raw : []).map((e) => this._normalize(e, path));
      this._rememberList(path, entries, {
        source: 'ls',
        partial: entries.length >= this.listNodeLimit,
      });
      return entries;
    }

    _applyOpts(entries, opts = {}) {
      const { includeHidden = true, sortBy = 'name', sortDir = 'asc' } = opts;
      let out = entries.slice();
      if (!includeHidden) out = out.filter((e) => !e.hidden);
      out.sort((a, b) => {
        if (a.type !== b.type) {
          if (a.type === 'directory') return -1;
          if (b.type === 'directory') return 1;
        }
        let cmp = 0;
        if (sortBy === 'size') cmp = (a.size || 0) - (b.size || 0);
        else if (sortBy === 'mtime') cmp = (a.mtime || 0) - (b.mtime || 0);
        else if (sortBy === 'type') cmp = (a.language || a.mime || '').localeCompare(b.language || b.mime || '');
        else cmp = a.name.localeCompare(b.name, undefined, { numeric: true });
        return sortDir === 'desc' ? -cmp : cmp;
      });
      return out;
    }

    _normalize(entry, parentPath) {
      // Defensive — different OpenViking versions emit slightly different fields.
      const name = entry.name ?? Path.basename(uriToPath(entry.uri || entry.path || ''));
      const isDir = isDirectoryEntry(entry);
      const path = entry.uri ? uriToPath(entry.uri) : Path.join(parentPath, name);
      const det = detectMime(name);
      const rawMtime = entry.mtime || entry.modTime;
      let mtime = 0;
      let mtimePartial = false;
      if (rawMtime) {
        if (typeof rawMtime === 'number') mtime = rawMtime;
        else {
          const s = rawMtime.trim();
          if (/^\d{1,2}:\d{2}/.test(s)) {
            // Time-only (UTC) from ls/tree is good enough for a short-lived cache.
            const today = new Date().toISOString().slice(0, 10);
            mtime = Date.parse(today + 'T' + s + 'Z') || 0;
            mtimePartial = true;
          } else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
            mtime = Date.parse(s + 'T00:00:00+08:00') || 0;
          } else {
            const parsed = Date.parse(s);
            if (!isNaN(parsed)) mtime = parsed;
          }
        }
      }
      const out = {
        path,
        name,
        type: isDir ? 'directory' : 'file',
        size: entry.size ?? 0,
        mtime: mtime || 0,
        ctime: entry.ctime ? Date.parse(entry.ctime) || 0 : (mtime || 0),
        mode: entry.mode ?? (isDir ? 0o555 : 0o444),  // read-only bits
        mime: entry.mime || det.mime,
        language: entry.language || det.language,
        hidden: name.startsWith('.') || name.startsWith('_'),
      };
      const abstract = firstString(entry.abstract, entry.l0, entry.L0, entry.summary);
      const overview = firstString(entry.overview, entry.l1, entry.L1);
      if (typeof abstract === 'string') out.abstract = abstract;
      if (typeof overview === 'string') out.overview = overview;
      if (isDir) out._levels = inferPreviewLevels(entry);
      if (mtimePartial) out._mtimePartial = true;
      return out;
    }

    async _statDirect(path) {
      const uri = pathToUri(path);
      const res = await this._req(`/api/v1/fs/stat?uri=${encodeURIComponent(uri)}`);
      const data = await res.json();
      const r = data.result || data;
      if (!r || !r.modTime) return null;
      const name = r.name || Path.basename(path);
      const isDir = !!r.isDir;
      const det = detectMime(name);
      const mtime = Date.parse(r.modTime) || 0;
      return {
        path,
        name,
        type: isDir ? 'directory' : 'file',
        size: r.size ?? 0,
        mtime,
        ctime: mtime,
        mode: r.mode ?? (isDir ? 0o555 : 0o444),
        mime: det.mime,
        language: det.language,
        hidden: name.startsWith('.') || name.startsWith('_'),
      };
    }

    async stat(path) {
      path = Path.normalize(path);
      const cached = this._statCache.get(path);
      if (cached && cached.expires > Date.now()) return cached.value;
      if (cached && cached.staleUntil > Date.now()) return cached.value;
      if (path === '/') {
        const root = { path: '/', name: '/', type: 'directory', size: 0, mtime: 0, ctime: 0, mode: 0o555, hidden: false };
        this._rememberStat(root);
        return root;
      }

      const inflight = this._statInflight.get(path);
      if (inflight) {
        if (cached && cached.staleUntil > Date.now()) return cached.value;
        return inflight;
      }

      // Try stat API first for full timestamp, fall back to parent listing.
      const promise = (async () => {
        const direct = await this._statDirect(path);
        if (direct) {
          this._rememberStat(direct);
          return direct;
        }
      })().finally(() => this._statInflight.delete(path));
      this._statInflight.set(path, promise);

      try {
        const direct = await promise;
        if (direct) return direct;
      } catch {}
      try {
        const parent = Path.dirname(path);
        const entries = await this.list(parent).catch(() => []);
        const hit = entries.find((x) => x.path === path);
        if (hit) return hit;
      } catch {}
      if (cached && cached.staleUntil > Date.now()) return cached.value;
      throw new FsError('ENOENT', 'Not found: ' + path, path);
    }

    async read(path, opts = {}) {
      const { maxBytes = 256 * 1024, encoding = 'utf-8', level = 'l2', isDirectory = false } = opts;
      path = Path.normalize(path);
      const cacheableLevel = level === 'l0' || level === 'l1';
      const contentKey = this._contentKey(path, level);
      const cached = cacheableLevel ? this._contentCache.get(contentKey) : null;
      if (cached && cached.staleUntil > Date.now()) return this._chunkFromContent(cached.content, maxBytes, encoding);
      const inflight = cacheableLevel ? this._contentInflight.get(contentKey) : null;
      if (inflight) {
        if (cached && cached.staleUntil > Date.now()) return this._chunkFromContent(cached.content, maxBytes, encoding);
        return inflight;
      }

      let uri = pathToUri(path);
      if (isDirectory && uri !== VIKING_PROTOCOL && !uri.endsWith('/')) uri += '/';
      // OpenViking uses /api/v1/content/* for content reads.
      // level: 'l0' (abstract), 'l1' (overview), 'l2' (full content)
      const endpoint = level === 'l0' ? 'abstract' : level === 'l1' ? 'overview' : 'read';
      const readPromise = (async () => {
        const res = await this._req(`/api/v1/content/${endpoint}?uri=${encodeURIComponent(uri)}`, { cache: 'no-store' });
        const ct = res.headers.get('content-type') || '';
        let content = '';
        if (ct.includes('application/json')) {
          const data = await res.json();
          const r = data.result;
          if (typeof r === 'string') content = r;
          else if (r && typeof r === 'object') {
            content = r.content ?? r.text ?? r.markdown ?? r.abstract ?? r.overview ?? r.summary ?? JSON.stringify(r, null, 2);
          } else {
            content = data.content ?? data.text ?? data.markdown ?? data.abstract ?? data.overview ?? data.summary ?? '';
          }
        } else {
          content = await res.text();
        }
        if (cacheableLevel) {
          if (isSummaryPlaceholder(content)) content = '';
          this._rememberContent(path, level, content, { negative: !content });
        }
        return this._chunkFromContent(content, maxBytes, encoding);
      })();
      const trackedRead = readPromise.finally(() => this._contentInflight.delete(contentKey));
      if (cacheableLevel) this._contentInflight.set(contentKey, trackedRead);
      try {
        return await trackedRead;
      } catch (e) {
        if (cached && cached.staleUntil > Date.now()) return this._chunkFromContent(cached.content, maxBytes, encoding);
        throw e;
      }
    }

    async exists(path) {
      try { await this.stat(path); return true; }
      catch (e) { if (e.code === 'ENOENT') return false; throw e; }
    }

    async search(query, opts = {}) {
      return this.find(query, opts);
    }

    async find(query, opts = {}) {
      const { limit = 50, root = '/' } = opts;
      if (!query) return [];
      const localFindFile = async (path) => {
        const r = await this.read(path);
        const q = query.toLowerCase();
        const out = [];
        const lines = (r.content || '').split('\n');
        for (let i = 0; i < lines.length && out.length < limit; i++) {
          const line = lines[i];
          if (!line.toLowerCase().includes(q)) continue;
          out.push({
            path,
            name: Path.basename(path),
            type: 'file',
            score: 1,
            snippet: line.trim().slice(0, 240),
            line: i + 1,
          });
        }
        return out;
      };
      const stat = await this.stat(root).catch(() => null);
      if (stat?.type === 'file') {
        const local = await localFindFile(root).catch(() => []);
        if (local.length) return local;
      }
      const body = { query, limit };
      if (root && root !== '/') body.target_uri = pathToUri(root);
      try {
        const res = await this._req('/api/v1/search/find', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        const r = data.result || {};
        const all = [...(r.resources || []), ...(r.memories || [])];
        const out = all.map((h) => ({
          path: h.uri ? uriToPath(h.uri) : (h.path || ''),
          name: h.name || Path.basename(h.uri ? uriToPath(h.uri) : (h.path || '')),
          type: isDirectoryEntry(h) ? 'directory' : 'file',
          score: h.score ?? 0,
          snippet: h.abstract || h.snippet || null,
          line: null,
        }));
        if (!out.length && root !== '/' && Path.extname(root)) {
          const local = await localFindFile(root).catch(() => []);
          if (local.length) return local;
        }
        return out;
      } catch {
        return [];
      }
    }

    async grep(pattern, opts = {}) {
      const { limit = 200, root = '/', ignoreCase = false } = opts;
      if (!pattern) return [];
      const localGrepFile = async (path) => {
        let re;
        try { re = new RegExp(pattern, ignoreCase ? 'i' : ''); }
        catch (e) { throw new FsError('EINVAL', 'Bad regex: ' + e.message, path); }
        const r = await this.read(path);
        const lines = (r.content || '').split('\n');
        const out = [];
        for (let i = 0; i < lines.length && out.length < limit; i++) {
          re.lastIndex = 0;
          if (re.test(lines[i])) out.push({ uri: path, line: i + 1, content: lines[i] });
        }
        return out;
      };

      const stat = await this.stat(root).catch(() => null);
      if (stat?.type === 'file') return localGrepFile(root);

      const uri = pathToUri(root === '/' ? '/' : root);
      const body = { uri, pattern, limit };
      try {
        const res = await this._req('/api/v1/search/grep', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        const result = data.result || {};
        const matches = result.matches || [];
        const out = matches.map((m) => ({
          uri: uriToPath(m.uri),
          line: m.line,
          content: m.content,
        }));
        if (!out.length && root !== '/' && result.files_scanned === 0) {
          const local = await localGrepFile(root).catch(() => null);
          if (local) return local;
        }
        return out;
      } catch (e) {
        throw e;
      }
    }

    async glob(pattern, opts = {}) {
      const { limit = 500, root = '/' } = opts;
      if (!pattern) return [];
      const uri = pathToUri(root === '/' ? '/' : root);
      const body = { uri, pattern, limit };
      try {
        const res = await this._req('/api/v1/search/glob', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        const matches = (data.result && data.result.matches) || [];
        return matches.map((u) => {
          const cleaned = u.startsWith('viking:/') && !u.startsWith('viking://')
            ? 'viking://' + u.slice('viking:/'.length)
            : u;
          return uriToPath(cleaned);
        });
      } catch {
        return [];
      }
    }

    async resolve(path) { return Path.normalize(path); }

    invalidate() {
      this._listCache.clear();
      this._statCache.clear();
      this._contentCache.clear();
      this._listInflight.clear();
      this._statInflight.clear();
      this._contentInflight.clear();
      this._treeInflight.clear();
      this._treeWarmCache.clear();
    }
  }

  window.FS.OpenVikingFs = OpenVikingFs;
  window.FS.uriToPath = uriToPath;
  window.FS.pathToUri = pathToUri;
})();
