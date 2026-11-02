/**
 * Read-Only File System API
 * =========================
 *
 * A stable, minimal contract for read-only filesystem access. Designed to be
 * implemented by any backend (in-memory mock, Browser File System Access API,
 * remote HTTP service, IndexedDB, ZIP archive, S3, etc).
 *
 * All paths are POSIX-style absolute paths starting with "/".
 * All methods are async and return Promises.
 * All methods are SAFE: no mutation, no writes, no side effects.
 *
 * --- Core types ---
 *
 *   Stat {
 *     path:        string         // absolute path, "/" = root
 *     name:        string         // basename
 *     type:        'file' | 'directory' | 'symlink'
 *     size:        number         // bytes (0 for dirs)
 *     mtime:       number         // unix ms
 *     ctime:       number         // unix ms
 *     mode:        number         // POSIX permission bits (read-only views still have mode)
 *     mime?:       string         // best-guess mime
 *     language?:   string         // detected language for code files
 *     target?:     string         // for symlinks: resolved target path
 *     hidden:      boolean        // dotfile or platform-hidden
 *   }
 *
 *   DirEntry  = Stat (with type='file'|'directory'|'symlink')
 *   FileChunk = { content: string, encoding: 'utf-8' | 'base64', truncated: boolean }
 *   SearchHit = { path, name, score, snippet?, line? }
 *
 * --- Methods every adapter must implement ---
 *
 *   stat(path)                   -> Stat
 *   list(path, opts?)            -> DirEntry[]
 *   read(path, opts?)            -> FileChunk
 *   exists(path)                 -> boolean
 *   search(query, opts?)         -> SearchHit[]
 *   resolve(path)                -> string   // canonicalize, follow symlinks
 *
 *   Optional:
 *     watch(path, callback)      -> () => void    // unsubscribe
 *     readBinary(path)           -> Blob
 *
 * Adapters MUST throw FsError with .code one of:
 *   ENOENT, ENOTDIR, EISDIR, EACCES, EINVAL, EIO
 */

class FsError extends Error {
  constructor(code, message, path) {
    super(message);
    this.name = 'FsError';
    this.code = code;
    this.path = path;
  }
}

// ---------- Path helpers (POSIX) ----------
const Path = {
  sep: '/',
  isAbs: (p) => typeof p === 'string' && p.startsWith('/'),
  normalize(p) {
    if (!p) return '/';
    const parts = p.split('/').filter(Boolean);
    const out = [];
    for (const part of parts) {
      if (part === '.') continue;
      if (part === '..') { out.pop(); continue; }
      out.push(part);
    }
    return '/' + out.join('/');
  },
  join(...parts) {
    return Path.normalize(parts.join('/'));
  },
  dirname(p) {
    p = Path.normalize(p);
    if (p === '/') return '/';
    const i = p.lastIndexOf('/');
    return i <= 0 ? '/' : p.slice(0, i);
  },
  basename(p) {
    p = Path.normalize(p);
    if (p === '/') return '/';
    return p.slice(p.lastIndexOf('/') + 1);
  },
  extname(p) {
    const b = Path.basename(p);
    const i = b.lastIndexOf('.');
    return i > 0 ? b.slice(i) : '';
  },
  segments(p) {
    p = Path.normalize(p);
    if (p === '/') return [];
    return p.slice(1).split('/');
  },
  ancestors(p) {
    // returns ['/', '/a', '/a/b', '/a/b/c'] for '/a/b/c'
    const segs = Path.segments(p);
    const out = ['/'];
    let cur = '';
    for (const s of segs) {
      cur += '/' + s;
      out.push(cur);
    }
    return out;
  },
};

// ---------- Mime / language detection ----------
const MIME = {
  // text
  '.txt': ['text/plain', 'text'],
  '.md':  ['text/markdown', 'markdown'],
  '.mdx': ['text/markdown', 'markdown'],
  '.html':['text/html', 'html'],
  '.css': ['text/css', 'css'],
  '.scss':['text/scss', 'scss'],
  '.js':  ['text/javascript', 'javascript'],
  '.mjs': ['text/javascript', 'javascript'],
  '.jsx': ['text/jsx', 'jsx'],
  '.ts':  ['text/typescript', 'typescript'],
  '.tsx': ['text/tsx', 'tsx'],
  '.json':['application/json', 'json'],
  '.yml': ['text/yaml', 'yaml'],
  '.yaml':['text/yaml', 'yaml'],
  '.toml':['text/toml', 'toml'],
  '.xml': ['text/xml', 'xml'],
  '.svg': ['image/svg+xml', 'svg'],
  '.py':  ['text/x-python', 'python'],
  '.rs':  ['text/x-rust', 'rust'],
  '.go':  ['text/x-go', 'go'],
  '.sh':  ['text/x-shellscript', 'bash'],
  '.sql': ['text/x-sql', 'sql'],
  '.lock':['text/plain', 'text'],
  '.gitignore':['text/plain', 'text'],
  '.env': ['text/plain', 'text'],
  // binary
  '.png': ['image/png', null],
  '.jpg': ['image/jpeg', null],
  '.jpeg':['image/jpeg', null],
  '.gif': ['image/gif', null],
  '.webp':['image/webp', null],
  '.pdf': ['application/pdf', null],
  '.zip': ['application/zip', null],
  '.woff':['font/woff', null],
  '.woff2':['font/woff2', null],
};

function detectMime(name) {
  const lower = name.toLowerCase();
  if (MIME[lower]) return { mime: MIME[lower][0], language: MIME[lower][1] };
  const i = lower.lastIndexOf('.');
  const ext = i >= 0 ? lower.slice(i) : '';
  if (MIME[ext]) return { mime: MIME[ext][0], language: MIME[ext][1] };
  return { mime: 'application/octet-stream', language: null };
}

// ---------- The base interface ----------
class FileSystem {
  async stat(path)               { throw new Error('stat() not implemented'); }
  async list(path, opts = {})    { throw new Error('list() not implemented'); }
  async read(path, opts = {})    { throw new Error('read() not implemented'); }
  async exists(path)             { try { await this.stat(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
  async search(query, opts = {}) { throw new Error('search() not implemented'); }
  async find(query, opts = {})   { return []; }
  async grep(pattern, opts = {}) { return []; }
  async glob(pattern, opts = {}) { return []; }
  async resolve(path)            { return Path.normalize(path); }
  watch(path, callback)          { return () => {}; }

  // Convenience: walk the tree (read-only iteration)
  async *walk(path = '/', opts = {}) {
    const { maxDepth = Infinity, includeHidden = false } = opts;
    const stack = [{ path, depth: 0 }];
    while (stack.length) {
      const { path: p, depth } = stack.pop();
      if (depth > maxDepth) continue;
      const entries = await this.list(p, { includeHidden });
      for (const e of entries) {
        yield e;
        if (e.type === 'directory') stack.push({ path: e.path, depth: depth + 1 });
      }
    }
  }
}

// ---------- In-memory adapter ----------
/**
 * Tree node format (the data you pass in):
 *   { type: 'directory', name: 'foo', mtime?: number, children: [...] }
 *   { type: 'file', name: 'bar.txt', content: '...', mtime?: number, mode?: number }
 *   { type: 'symlink', name: 'link', target: '/abs/path' }
 *
 * Names beginning with "." are auto-marked hidden (unless hidden:false set).
 */
class InMemoryFs extends FileSystem {
  constructor(rootChildren, opts = {}) {
    super();
    this.now = opts.now || Date.now();
    this.root = this._buildNode({
      type: 'directory',
      name: '',
      children: rootChildren,
      mtime: this.now,
    }, '/');
  }

  _buildNode(raw, path) {
    const node = {
      type: raw.type,
      name: raw.name,
      path,
      mtime: raw.mtime || this.now,
      ctime: raw.ctime || raw.mtime || this.now,
      mode: raw.mode ?? (raw.type === 'directory' ? 0o755 : 0o644),
      hidden: raw.hidden ?? raw.name.startsWith('.'),
    };
    if (raw.type === 'directory') {
      node.children = {};
      for (const child of raw.children || []) {
        const childPath = path === '/' ? '/' + child.name : path + '/' + child.name;
        node.children[child.name] = this._buildNode(child, childPath);
      }
      node.size = 0;
    } else if (raw.type === 'file') {
      node.content = raw.content || '';
      node.size = raw.size ?? new Blob([node.content]).size;
      const det = detectMime(raw.name);
      node.mime = raw.mime || det.mime;
      node.language = raw.language || det.language;
    } else if (raw.type === 'symlink') {
      node.target = raw.target;
      node.size = 0;
    }
    return node;
  }

  _resolveNode(path, follow = true) {
    path = Path.normalize(path);
    if (path === '/') return this.root;
    const segs = path.slice(1).split('/');
    let cur = this.root;
    for (let i = 0; i < segs.length; i++) {
      if (cur.type !== 'directory') {
        throw new FsError('ENOTDIR', 'Not a directory: ' + cur.path, cur.path);
      }
      const next = cur.children[segs[i]];
      if (!next) throw new FsError('ENOENT', 'No such file or directory: ' + path, path);
      cur = next;
      if (cur.type === 'symlink' && follow && i < segs.length - 1) {
        cur = this._resolveNode(cur.target, true);
      }
    }
    return cur;
  }

  _stat(node) {
    return {
      path: node.path || '/',
      name: node.name || '/',
      type: node.type,
      size: node.size,
      mtime: node.mtime,
      ctime: node.ctime,
      mode: node.mode,
      mime: node.mime,
      language: node.language,
      target: node.target,
      hidden: node.hidden,
    };
  }

  async stat(path) {
    return this._stat(this._resolveNode(path, true));
  }

  async list(path, opts = {}) {
    const { includeHidden = true, sortBy = 'name', sortDir = 'asc' } = opts;
    const node = this._resolveNode(path, true);
    if (node.type !== 'directory') {
      throw new FsError('ENOTDIR', 'Not a directory: ' + path, path);
    }
    let entries = Object.values(node.children).map((c) => this._stat(c));
    if (!includeHidden) entries = entries.filter((e) => !e.hidden);
    entries.sort((a, b) => {
      // dirs first, then by chosen field
      if (a.type !== b.type) {
        if (a.type === 'directory') return -1;
        if (b.type === 'directory') return 1;
      }
      let cmp = 0;
      if (sortBy === 'size') cmp = a.size - b.size;
      else if (sortBy === 'mtime') cmp = a.mtime - b.mtime;
      else if (sortBy === 'type') cmp = (a.language || a.mime || '').localeCompare(b.language || b.mime || '');
      else cmp = a.name.localeCompare(b.name, undefined, { numeric: true });
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return entries;
  }

  async read(path, opts = {}) {
    const { maxBytes = 256 * 1024, encoding = 'utf-8' } = opts;
    const node = this._resolveNode(path, true);
    if (node.type !== 'file') {
      throw new FsError('EISDIR', 'Not a file: ' + path, path);
    }
    const content = node.content || '';
    const truncated = content.length > maxBytes;
    return {
      content: truncated ? content.slice(0, maxBytes) : content,
      encoding,
      truncated,
    };
  }

  async search(query, opts = {}) {
    const { root = '/', limit = 100, includeContent = false, includeHidden = false } = opts;
    if (!query) return [];
    const q = query.toLowerCase();
    const results = [];
    const visit = (node) => {
      if (results.length >= limit) return;
      if (node.path !== '/') {
        if (includeHidden || !node.hidden) {
          // fuzzy-ish: substring + acronym
          const name = node.name.toLowerCase();
          let score = 0;
          if (name === q) score = 1000;
          else if (name.startsWith(q)) score = 500;
          else if (name.includes(q)) score = 250;
          else {
            // try acronym match (e.g. "tu" -> "tweaks-utils")
            const initials = node.name.split(/[-_./\s]/).map((s) => s[0]?.toLowerCase() || '').join('');
            if (initials.startsWith(q)) score = 100;
          }
          if (score > 0) {
            results.push({
              path: node.path,
              name: node.name,
              type: node.type,
              score,
              snippet: null,
              line: null,
            });
          }
          if (includeContent && node.type === 'file' && node.content) {
            const content = node.content.toLowerCase();
            const idx = content.indexOf(q);
            if (idx >= 0 && score === 0) {
              const lines = node.content.split('\n');
              let cum = 0, line = 0;
              for (let i = 0; i < lines.length; i++) {
                if (cum + lines[i].length >= idx) { line = i + 1; break; }
                cum += lines[i].length + 1;
              }
              results.push({
                path: node.path,
                name: node.name,
                type: node.type,
                score: 50,
                snippet: lines[line - 1]?.trim().slice(0, 120),
                line,
              });
            }
          }
        }
      }
      if (node.type === 'directory') {
        for (const c of Object.values(node.children)) visit(c);
      }
    };
    visit(this._resolveNode(root, true));
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  async find(query, opts = {}) {
    return this.search(query, { ...opts, includeContent: false });
  }

  async grep(pattern, opts = {}) {
    const { root = '/', limit = 200, ignoreCase = false } = opts;
    if (!pattern) return [];
    let re;
    try { re = new RegExp(pattern, ignoreCase ? 'i' : ''); }
    catch (e) { throw new FsError('EINVAL', 'Bad regex: ' + e.message, ''); }
    const out = [];
    const visit = (node) => {
      if (out.length >= limit) return;
      if (node.type === 'file' && node.content) {
        const lines = node.content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) {
            out.push({ uri: node.path, line: i + 1, content: lines[i] });
            if (out.length >= limit) return;
          }
        }
      } else if (node.type === 'directory') {
        for (const c of Object.values(node.children)) visit(c);
      }
    };
    visit(this._resolveNode(root, true));
    return out;
  }

  async glob(pattern, opts = {}) {
    const { root = '/', limit = 500 } = opts;
    if (!pattern) return [];
    const re = globToRegex(pattern);
    const out = [];
    const visit = (node) => {
      if (out.length >= limit) return;
      if (node.path !== '/' && re.test(node.path)) out.push(node.path);
      if (node.type === 'directory') {
        for (const c of Object.values(node.children)) visit(c);
      }
    };
    visit(this._resolveNode(root, true));
    return out;
  }
}

function globToRegex(glob) {
  let re = '^';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*'; i += 2;
      if (glob[i] === '/') i++;
    } else if (c === '*') {
      re += '[^/]*'; i++;
    } else if (c === '?') {
      re += '[^/]'; i++;
    } else if ('.+()|^$\\{}[]'.includes(c)) {
      re += '\\' + c; i++;
    } else {
      re += c; i++;
    }
  }
  re += '$';
  return new RegExp(re);
}

// ---------- Public exports ----------
window.FS = {
  FileSystem,
  InMemoryFs,
  FsError,
  Path,
  detectMime,
  globToRegex,
  // Adapter-creation helper signatures (stubs to make extension obvious)
  // Uncomment & implement when wiring real backends:
  //   createFsAccessAdapter(directoryHandle): FileSystem
  //   createHttpAdapter(baseUrl): FileSystem
  //   createZipAdapter(zipBlob): FileSystem
};
