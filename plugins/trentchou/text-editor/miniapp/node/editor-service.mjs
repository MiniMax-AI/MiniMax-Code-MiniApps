// @ts-check
// Domain service of the text editor: sidebar folders, tabs, shared document buffers
// (CodeMirror collab authority), saving, disk change detection, and hot-exit persistence.
// Every mutation from the page, the MCP tools, or the disk poller goes through this class.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ChangeSet, Text } from './vendor/cm-state.mjs';

export const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_UPDATE_LOG = 4000;
const MAX_LIST_ENTRIES = 5000;
const MAX_INDEX_FILES = 50000;
const AGENT_READ_MAX_LINES = 2000;
const AGENT_READ_MAX_CHARS = 400_000;
const HIDDEN_NAMES = new Set(['.git', '.svn', '.hg', 'CVS', '.DS_Store', '.Trash']);
const INDEX_SKIP_DIRS = new Set([
  ...HIDDEN_NAMES, 'node_modules', '__pycache__', '.venv', 'venv', '.mypy_cache', '.pytest_cache',
  '.ruff_cache', '.next', '.nuxt', '.cache', '.idea', '.vscode', 'dist', 'build', 'target', 'coverage',
]);
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
// After an editor page opens, workspaces of conversations started or messaged within this window are
// followed immediately; later ones wait for the next page open so the sidebar does not jump while in use.
export const FOLLOW_WINDOW_MS = 2 * 60 * 1000;
// Credential-like files stay out of the Agent tools; the user can still open them in the editor.
const SENSITIVE_DIRS = new Set(['.secrets', '.ssh', '.gnupg', '.aws', '.kube', '.docker']);
const SENSITIVE_NAME = /^(\.env(\..+)?|\.netrc|\.npmrc|\.pypirc|\.git-credentials|credentials(\.json)?|id_(rsa|dsa|ecdsa|ed25519)|.+\.(pem|key|p12|pfx|jks|keystore))$/i;
const TEMPLATE_NAME = /\.(example|sample|template|dist)$/i;
const HIGHLIGHT_KINDS = new Set(['info', 'warning', 'error', 'success']);
const MAX_HIGHLIGHTS_PER_FILE = 200;
const MAX_HIGHLIGHTS_PER_CALL = 50;
const MAX_NOTE_CHARS = 2000;

/** @param {string} path */
export function isSensitivePath(path) {
  const parts = path.split(sep);
  if (parts.some((part) => SENSITIVE_DIRS.has(part))) return true;
  const name = parts[parts.length - 1] ?? '';
  return SENSITIVE_NAME.test(name) && !TEMPLATE_NAME.test(name);
}

/** @param {string} path */
function assertAgentAccessible(path) {
  if (isSensitivePath(path)) {
    throw new EditorError('SENSITIVE_FILE', `出于安全考虑，Agent 工具不能读写凭据类文件：${basename(path)}。如需修改，请让用户在编辑器中自行处理。`, 403);
  }
}

export const DEFAULT_SETTINGS = Object.freeze({
  theme: 'system',
  codeFont: 'system',
  fontFamily: '',
  fontSize: 14,
  lineHeight: 1.6,
  tabSize: 4,
  insertSpaces: true,
  wordWrap: false,
  minimap: true,
  indentGuides: true,
  showWhitespace: false,
  lineNumbers: true,
  sidebarVisible: true,
  sidebarWidth: 248,
  highlightsVisible: true,
  // Off: an Agent highlight disappears once its code is edited or its file is closed.
  // On: it stays (also across restarts) until the user or the Agent clears it.
  highlightsPersist: false,
});

const isBool = (v) => typeof v === 'boolean';
/** @type {Record<string, (v: unknown) => boolean>} */
const SETTING_RULES = {
  theme: (v) => v === 'system' || v === 'dark' || v === 'light',
  codeFont: (v) => v === 'system' || v === 'menlo' || v === 'jetbrains-mono' || v === 'custom',
  fontFamily: (v) => typeof v === 'string' && v.length <= 200 && !/[;{}<>\\]/.test(v),
  fontSize: (v) => Number.isInteger(v) && Number(v) >= 8 && Number(v) <= 40,
  lineHeight: (v) => typeof v === 'number' && v >= 1 && v <= 2.5,
  tabSize: (v) => Number.isInteger(v) && Number(v) >= 1 && Number(v) <= 8,
  insertSpaces: isBool,
  wordWrap: isBool,
  minimap: isBool,
  indentGuides: isBool,
  showWhitespace: isBool,
  lineNumbers: isBool,
  sidebarVisible: isBool,
  sidebarWidth: (v) => Number.isInteger(v) && Number(v) >= 160 && Number(v) <= 640,
  highlightsVisible: isBool,
  highlightsPersist: isBool,
};

export class EditorError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number} [status]
   * @param {Record<string, unknown>} [extra]
   */
  constructor(code, message, status = 400, extra) {
    super(message);
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

/** @param {any} error */
export function mapFsError(error) {
  if (error instanceof EditorError) return error;
  switch (error?.code) {
    case 'ENOENT':
      return new EditorError('NOT_FOUND', '文件或文件夹不存在', 404);
    case 'EACCES':
    case 'EPERM':
      return new EditorError('PERMISSION', '没有访问权限', 403);
    case 'ENOTDIR':
      return new EditorError('NOT_DIRECTORY', '路径不是文件夹', 400);
    case 'EISDIR':
      return new EditorError('IS_DIRECTORY', '这是一个文件夹', 400);
    case 'EEXIST':
      return new EditorError('EXISTS', '已存在同名文件', 409);
    default:
      return error;
  }
}

const sha1 = (/** @type {string} */ s) => createHash('sha1').update(s).digest('hex');
const toText = (/** @type {string} */ s) => Text.of(s.split(/\r\n|\r|\n/));
const normalizeNewlines = (/** @type {string} */ s) => s.replace(/\r\n?/g, '\n');
const diskOf = (/** @type {import('node:fs').Stats} */ st) => ({ mtimeMs: st.mtimeMs, size: st.size });
/** @param {{mtimeMs:number,size:number}|null|undefined} a @param {{mtimeMs:number,size:number}|null|undefined} b */
const sameDisk = (a, b) => !!a && !!b && a.mtimeMs === b.mtimeMs && a.size === b.size;

/** @param {Buffer} buf */
function decodeFile(buf) {
  if (buf.subarray(0, 8192).includes(0)) {
    throw new EditorError('BINARY', '这是二进制文件，编辑器只能打开文本文件', 415);
  }
  const bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bom ? buf.subarray(3) : buf);
  } catch {
    throw new EditorError('ENCODING', '文件不是 UTF-8 编码，暂不支持打开', 415);
  }
  return { text, bom, eol: text.includes('\r\n') ? '\r\n' : '\n' };
}

/** Minimal single-range diff, so remote edits keep the user's cursor and undo history stable. */
function diffChange(/** @type {string} */ a, /** @type {string} */ b) {
  const max = Math.min(a.length, b.length);
  let start = 0;
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) {
    endA--;
    endB--;
  }
  if (start === endA && start === endB) return null;
  return { from: start, to: endA, insert: b.slice(start, endB) };
}

/** @param {string} name */
function splitName(name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 1024) {
    throw new EditorError('INVALID_NAME', '请输入文件名');
  }
  const segments = name.trim().split('/').filter((s) => s !== '');
  if (!segments.length) throw new EditorError('INVALID_NAME', '请输入文件名');
  for (const s of segments) {
    if (s === '.' || s === '..' || s.length > 255 || /[\0\\]/.test(s)) {
      throw new EditorError('INVALID_NAME', `文件名无效：${s}`);
    }
  }
  return segments;
}

async function exists(/** @type {string} */ p) {
  return stat(p).then(() => true, () => false);
}

/**
 * Save a user file without ever leaving it half-written: write a temp file beside the real target
 * (symlinks are followed, so a link stays a link), give it the original permission bits, then rename it
 * over the target. Hard links to the old file keep the old content. If the directory itself is not
 * writable, fall back to writing the file in place so such files stay editable.
 * @param {string} path @param {Buffer} data @param {import('node:fs').Stats|null} st @param {number} seq
 */
async function writeAtomic(path, data, st, seq) {
  const target = st ? await realpath(path) : path;
  const mode = st ? st.mode & 0o7777 : 0o666;
  const tmp = join(dirname(target), `.${basename(target)}.${process.pid}.${seq}.tmp`);
  try {
    await writeFile(tmp, data, { flag: 'wx', mode });
  } catch (error) {
    const code = /** @type {any} */ (error)?.code;
    if (st && (code === 'EACCES' || code === 'EPERM' || code === 'EROFS')) {
      await writeFile(target, data);
      return;
    }
    throw error;
  }
  try {
    if (st) await chmod(tmp, mode); // writeFile's mode is filtered by the umask
    await rename(tmp, target);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function uniquePath(/** @type {string} */ target) {
  if (!(await exists(target))) return target;
  const dir = dirname(target);
  const name = basename(target);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 1; n < 1000; n++) {
    const candidate = join(dir, `${stem} (${n})${ext}`);
    if (!(await exists(candidate))) return candidate;
  }
  throw new EditorError('EXISTS', '同名文件过多', 409);
}

/**
 * @typedef {{mtimeMs:number,size:number}} DiskMeta
 * @typedef {{
 *   path: string, text: any, savedText: any, eol: string, bom: boolean,
 *   disk: DiskMeta|null, conflictDisk: DiskMeta|null, diskChanged: boolean, deleted: boolean,
 *   version: number, base: number, log: {clientID:string, changes:unknown}[],
 *   hotTimer: NodeJS.Timeout|null, saving: Promise<unknown>|null,
 * }} Doc
 * Review highlight placed by the Agent. from/to are offsets into the loaded document; while the file is
 * closed (kept highlights only) text/startLine/endLine identify the code so it can be re-anchored.
 * @typedef {{
 *   id: string, from: number, to: number, lines: boolean, kind: string, note: string, at: number,
 *   text?: string, startLine?: number, endLine?: number,
 * }} Highlight
 */

export class EditorService {
  /**
   * @param {{ dataDir: string, pluginId: string, logger: import('./miniapp-api.js').MiniAppLogger, signal: AbortSignal }} options
   */
  constructor({ dataDir, pluginId, logger, signal }) {
    this.logger = logger;
    this.signal = signal;
    this.statePath = join(dataDir, 'state.json');
    this.highlightsPath = join(dataDir, 'highlights.json');
    this.hotDir = join(dataDir, 'hot');
    this.draftsDir = join(dataDir, 'drafts');
    // Written by hooks/record-workspace.* into the Plugin Hook data directory, which the Host keeps
    // next to this Mini App's data directory (plugin-data/hooks/<id> beside plugin-data/liveboards/<id>).
    this.followFile = join(dirname(dirname(dataDir)), 'hooks', pluginId, 'active-workspace');
    /** Folders added automatically because a conversation used them; dropped again when unused. */
    /** @type {Set<string>} */ this.autoFolders = new Set();
    this.followedAt = 0;
    this.pageOpenedAt = 0;
    this.following = false;
    /** @type {string[]} */ this.folders = [];
    /** @type {string[]} */ this.tabs = [];
    /** @type {string|null} */ this.active = null;
    this.settings = { ...DEFAULT_SETTINGS };
    /** @type {Map<string, Doc>} */ this.docs = new Map();
    /** @type {Map<string, Promise<Doc>>} */ this.loading = new Map();
    /** @type {Set<string>} */ this.hotPaths = new Set();
    /** @type {Map<string, Highlight[]>} */ this.highlights = new Map();
    this.highlightSeq = 0;
    /** @type {NodeJS.Timeout|null} */ this.highlightTimer = null;
    /** @type {Set<(event: any) => void>} */ this.listeners = new Set();
    /** @type {Map<string, {at:number, result:any}>} */ this.indexCache = new Map();
    /** @type {any} */ this.view = null;
    this.pageCount = 0;
    this.persistChain = Promise.resolve();
    this.stateQueued = false;
    this.polling = false;
    this.tmpCounter = 0;
  }

  async init() {
    await mkdir(this.hotDir, { recursive: true });
    await mkdir(this.draftsDir, { recursive: true });
    /** @type {any} */
    let saved = null;
    try {
      saved = JSON.parse(await readFile(this.statePath, 'utf8'));
    } catch {
      saved = null;
    }
    if (saved && Array.isArray(saved.folders)) {
      this.folders = [...new Set(saved.folders.filter((p) => typeof p === 'string' && isAbsolute(p)).map((p) => resolve(p)))];
    } else {
      this.folders = [this.draftsDir];
    }
    if (saved && Array.isArray(saved.autoFolders)) {
      this.autoFolders = new Set(saved.autoFolders.filter((p) => typeof p === 'string' && this.folders.includes(p)));
    }
    if (saved && Number.isFinite(saved.followedAt)) this.followedAt = saved.followedAt;
    if (saved && Array.isArray(saved.tabs)) {
      this.tabs = saved.tabs.filter((p) => typeof p === 'string' && isAbsolute(p) && this.inFolders(p));
    }
    this.active = saved && typeof saved.active === 'string' && this.tabs.includes(saved.active) ? saved.active : (this.tabs[0] ?? null);
    if (saved && saved.settings && typeof saved.settings === 'object') {
      for (const [key, value] of Object.entries(saved.settings)) {
        if (SETTING_RULES[key]?.(value)) /** @type {any} */ (this.settings)[key] = value;
      }
      // 1.0.0 stored only a free-form font name; keep it as a custom choice.
      if (saved.settings.codeFont === undefined && this.settings.fontFamily) this.settings.codeFont = 'custom';
    }
    for (const name of await readdir(this.hotDir)) {
      if (!name.endsWith('.json')) continue;
      try {
        const hot = JSON.parse(await readFile(join(this.hotDir, name), 'utf8'));
        if (typeof hot.path === 'string' && this.tabs.includes(hot.path)) this.hotPaths.add(hot.path);
        else await rm(join(this.hotDir, name), { force: true });
      } catch {
        await rm(join(this.hotDir, name), { force: true });
      }
    }
    if (this.settings.highlightsPersist) await this.loadHighlights();
  }

  // ---- events -------------------------------------------------------------------------------

  /** @param {(event: any) => void} listener */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** @param {any} event */
  emit(event) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A broken page connection must not block other listeners.
      }
    }
  }

  emitState() {
    if (this.stateQueued) return;
    this.stateQueued = true;
    queueMicrotask(() => {
      this.stateQueued = false;
      this.emit({ type: 'state', state: this.snapshot() });
    });
  }

  /** @param {Doc} doc */
  emitStatus(doc) {
    this.emit({ type: 'doc.status', path: doc.path, ...this.status(doc.path) });
  }

  /** @param {'info'|'warn'|'error'} level @param {string} message */
  notice(level, message) {
    this.emit({ type: 'notice', level, message });
  }

  persist() {
    const data = JSON.stringify({
      folders: this.folders, autoFolders: [...this.autoFolders], followedAt: this.followedAt,
      tabs: this.tabs, active: this.active, settings: this.settings,
    });
    this.persistChain = this.persistChain
      .then(async () => {
        const tmp = `${this.statePath}.${process.pid}.${++this.tmpCounter}.tmp`;
        await writeFile(tmp, data);
        await rename(tmp, this.statePath);
      })
      .catch((error) => this.logger.warn('editor.state.persist_failed', { code: String(error?.code ?? 'unknown') }));
    return this.persistChain;
  }

  snapshot() {
    return {
      folders: this.folders.map((p) => ({
        path: p, name: p === this.draftsDir ? '草稿' : basename(p) || p, drafts: p === this.draftsDir, auto: this.autoFolders.has(p),
      })),
      tabs: this.tabs.map((p) => ({ path: p, name: basename(p), ...this.status(p) })),
      active: this.active,
      settings: this.settings,
      highlights: this.highlightTotal(),
    };
  }

  /** @param {string} path */
  status(path) {
    const doc = this.docs.get(path);
    if (doc) return { dirty: this.isDirty(doc), diskChanged: doc.diskChanged, deleted: doc.deleted };
    return { dirty: this.hotPaths.has(path), diskChanged: false, deleted: false };
  }

  /** @param {Doc} doc */
  isDirty(doc) {
    return doc.deleted || !doc.text.eq(doc.savedText);
  }

  // ---- paths and folders ---------------------------------------------------------------------

  /** @param {string} p */
  inFolders(p) {
    return this.folders.some((f) => p === f || p.startsWith(f.endsWith(sep) ? f : f + sep));
  }

  /** @param {string} p */
  folderOf(p) {
    let best = null;
    for (const f of this.folders) {
      if ((p === f || p.startsWith(f + sep)) && (!best || f.length > best.length)) best = f;
    }
    return best;
  }

  /** @param {unknown} input */
  expand(input) {
    if (typeof input !== 'string' || !input.trim() || input.includes('\0') || input.length > 4096) {
      throw new EditorError('INVALID_PATH', '路径无效');
    }
    let p = input.trim();
    if (p === '~' || p.startsWith('~/')) p = join(homedir(), p.slice(1));
    return p;
  }

  /**
   * Resolve a path and require it to be inside one of the sidebar folders.
   * @param {unknown} input
   * @param {{ relativeToPrimary?: boolean }} [options]
   */
  resolvePath(input, { relativeToPrimary = false } = {}) {
    let p = this.expand(input);
    if (!isAbsolute(p)) {
      if (!relativeToPrimary || !this.folders.length) throw new EditorError('INVALID_PATH', '需要绝对路径');
      p = resolve(this.folders[0], p);
    }
    p = resolve(p);
    if (!this.inFolders(p)) {
      throw new EditorError('OUTSIDE_FOLDERS', `路径不在编辑器侧边栏的文件夹内：${p}`, 403, { folders: this.folders });
    }
    return p;
  }

  /** @param {unknown} input @param {{ top?: boolean }} [options] */
  async addFolder(input, { top = false } = {}) {
    const raw = this.expand(input);
    if (!isAbsolute(raw)) throw new EditorError('INVALID_PATH', '请填写绝对路径，例如 /Users/you/project');
    const p = resolve(raw);
    if (p === dirname(p)) throw new EditorError('INVALID_PATH', '不能添加文件系统根目录');
    const st = await stat(p).catch(() => null);
    if (!st) throw new EditorError('NOT_FOUND', `文件夹不存在：${p}`, 404);
    if (!st.isDirectory()) throw new EditorError('NOT_DIRECTORY', `不是文件夹：${p}`);
    const index = this.folders.indexOf(p);
    let changed = false;
    if (index === -1) {
      if (top) this.folders.unshift(p);
      else this.folders.push(p);
      changed = true;
    } else if (top && index > 0) {
      this.folders.splice(index, 1);
      this.folders.unshift(p);
      changed = true;
    }
    // A folder the user or Agent adds explicitly is pinned: it is no longer removed automatically.
    if (this.autoFolders.delete(p)) changed = true;
    if (changed) {
      this.indexCache.delete(p);
      await this.persist();
      this.emitState();
    }
    return { path: p, added: index === -1 };
  }

  /** @param {unknown} input */
  async removeFolder(input) {
    const p = resolve(this.expand(input));
    if (!this.folders.includes(p)) throw new EditorError('NOT_FOUND', '该文件夹不在侧边栏中', 404);
    const remaining = this.folders.filter((f) => f !== p);
    const covered = (/** @type {string} */ q) => remaining.some((f) => q === f || q.startsWith(f + sep));
    const affected = this.tabs.filter((t) => (t === p || t.startsWith(p + sep)) && !covered(t));
    const dirty = affected.filter((t) => this.status(t).dirty);
    if (dirty.length) {
      throw new EditorError('HAS_UNSAVED', `该文件夹中还有 ${dirty.length} 个未保存的文件，请先保存或关闭`, 409);
    }
    for (const t of affected) this.dropDoc(t);
    this.tabs = this.tabs.filter((t) => !affected.includes(t));
    if (this.active && affected.includes(this.active)) this.active = this.tabs[0] ?? null;
    this.folders = remaining;
    this.autoFolders.delete(p);
    this.indexCache.delete(p);
    await this.persist();
    this.emitState();
  }

  /**
   * Put the workspace of the most recently active conversation first in the sidebar.
   * Each recorded workspace is applied once; earlier automatic folders without open tabs are dropped.
   */
  async followWorkspace() {
    if (this.following) return;
    this.following = true;
    try {
      const st = await stat(this.followFile).catch(() => null);
      if (!st || st.mtimeMs <= this.followedAt) return;
      const raw = (await readFile(this.followFile, 'utf8').catch(() => '')).trim();
      this.followedAt = st.mtimeMs;
      const ws = isAbsolute(raw) ? resolve(raw) : null;
      const dir = ws ? await stat(ws).catch(() => null) : null;
      // Skip conversations without a real project directory (filesystem root or the home folder).
      if (!ws || !dir?.isDirectory() || ws === dirname(ws) || ws === homedir()) {
        await this.persist();
        return;
      }
      const moved = this.folders[0] !== ws;
      if (moved) {
        const index = this.folders.indexOf(ws);
        if (index === -1) this.autoFolders.add(ws);
        else this.folders.splice(index, 1);
        this.folders.unshift(ws);
      }
      for (const f of [...this.autoFolders]) {
        if (f === ws || this.tabs.some((t) => t === f || t.startsWith(f + sep))) continue;
        this.folders = this.folders.filter((x) => x !== f);
        this.autoFolders.delete(f);
        this.indexCache.delete(f);
      }
      await this.persist();
      this.emitState();
      if (moved) this.emit({ type: 'workspace.follow', path: ws });
    } finally {
      this.following = false;
    }
  }

  /** @param {unknown} input */
  async listDir(input) {
    const path = this.resolvePath(input);
    const dirents = await readdir(path, { withFileTypes: true }).catch((e) => {
      throw mapFsError(e);
    });
    const entries = [];
    for (const d of dirents) {
      if (HIDDEN_NAMES.has(d.name)) continue;
      let kind = d.isDirectory() ? 'dir' : d.isFile() ? 'file' : null;
      const link = d.isSymbolicLink();
      if (link) {
        const target = await stat(join(path, d.name)).catch(() => null);
        kind = target ? (target.isDirectory() ? 'dir' : 'file') : 'broken';
      }
      if (kind) entries.push({ name: d.name, kind, link });
    }
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    entries.sort((a, b) => (a.kind === 'dir') !== (b.kind === 'dir') ? (a.kind === 'dir' ? -1 : 1) : collator.compare(a.name, b.name));
    return { path, entries: entries.slice(0, MAX_LIST_ENTRIES), truncated: entries.length > MAX_LIST_ENTRIES };
  }

  /** File list for quick open; uses git when available so ignored files stay out. @param {unknown} input */
  async fileIndex(input) {
    const root = this.resolvePath(input);
    if (!this.folders.includes(root)) throw new EditorError('INVALID_PATH', '只能索引侧边栏中的文件夹');
    const cached = this.indexCache.get(root);
    if (cached && Date.now() - cached.at < 30_000) return cached.result;
    let files = await this.gitFiles(root);
    if (!files) files = await this.walkFiles(root);
    const result = { root, files: files.slice(0, MAX_INDEX_FILES), truncated: files.length > MAX_INDEX_FILES };
    this.indexCache.set(root, { at: Date.now(), result });
    return result;
  }

  /** @param {string} root @returns {Promise<string[]|null>} */
  gitFiles(root) {
    return new Promise((resolvePromise) => {
      execFile(
        'git',
        ['-C', root, 'ls-files', '-co', '--exclude-standard', '-z'],
        { timeout: 5000, maxBuffer: 64 * 1024 * 1024, signal: this.signal, encoding: 'utf8' },
        (error, stdout) => {
          if (error) return resolvePromise(null);
          resolvePromise(stdout.split('\0').filter((f) => f && !f.endsWith('/')));
        },
      );
    });
  }

  /** @param {string} root */
  async walkFiles(root) {
    const deadline = Date.now() + 3000;
    /** @type {string[]} */
    const files = [];
    const stack = [''];
    while (stack.length && files.length <= MAX_INDEX_FILES && Date.now() < deadline) {
      const rel = /** @type {string} */ (stack.pop());
      const dirents = await readdir(join(root, rel), { withFileTypes: true }).catch(() => []);
      for (const d of dirents) {
        const child = rel ? `${rel}/${d.name}` : d.name;
        if (d.isDirectory()) {
          if (!INDEX_SKIP_DIRS.has(d.name)) stack.push(child);
        } else if (d.isFile() || d.isSymbolicLink()) {
          if (!HIDDEN_NAMES.has(d.name)) files.push(child);
        }
      }
    }
    return files;
  }

  // ---- documents -----------------------------------------------------------------------------

  /** @param {string} path @param {Partial<Doc>} fields @returns {Doc} */
  newDoc(path, fields) {
    return /** @type {Doc} */ ({
      path, eol: '\n', bom: false, disk: null, conflictDisk: null, diskChanged: false, deleted: false,
      version: 0, base: 0, log: [], hotTimer: null, saving: null, ...fields,
    });
  }

  /** @param {unknown} input @param {{ tab?: boolean, focus?: boolean }} [options] */
  async openDoc(input, { tab = true, focus = false } = {}) {
    const path = this.resolvePath(input);
    let doc = this.docs.get(path);
    if (!doc) {
      let pending = this.loading.get(path);
      if (!pending) {
        pending = this.loadDoc(path);
        this.loading.set(path, pending);
        pending.finally(() => this.loading.delete(path)).catch(() => undefined);
      }
      doc = await pending;
    }
    if (tab) await this.addTab(path, focus);
    return doc;
  }

  /** @param {string} path @returns {Promise<Doc>} */
  async loadDoc(path) {
    const st = await stat(path).catch(() => null);
    const hot = this.hotPaths.has(path) ? await this.readHot(path) : null;
    /** @type {Doc} */
    let doc;
    if (!st) {
      if (!hot) throw new EditorError('NOT_FOUND', `文件不存在：${basename(path)}`, 404);
      doc = this.newDoc(path, { text: toText(hot.text), savedText: Text.empty, eol: hot.eol === '\r\n' ? '\r\n' : '\n', bom: !!hot.bom, deleted: true });
    } else {
      if (st.isDirectory()) throw new EditorError('IS_DIRECTORY', '这是一个文件夹');
      if (st.size > MAX_FILE_BYTES) throw new EditorError('TOO_LARGE', '文件超过 32 MB，无法打开', 413);
      const decoded = decodeFile(await readFile(path).catch((e) => { throw mapFsError(e); }));
      const savedText = toText(decoded.text);
      let text = savedText;
      let diskChanged = false;
      if (hot) {
        const hotText = toText(hot.text);
        if (!hotText.eq(savedText)) {
          text = hotText;
          diskChanged = !sameDisk(hot.disk, diskOf(st));
        }
      }
      doc = this.newDoc(path, { text, savedText, eol: decoded.eol, bom: decoded.bom, disk: diskOf(st), diskChanged });
    }
    if (!this.isDirty(doc)) await this.removeHot(path);
    this.docs.set(path, doc);
    this.attachHighlights(doc);
    return doc;
  }

  /** @param {Doc} doc */
  docPayload(doc) {
    return {
      path: doc.path,
      text: doc.text.toString(),
      version: doc.version,
      eol: doc.eol === '\r\n' ? 'CRLF' : 'LF',
      bom: doc.bom,
      highlights: this.highlightItems(doc.path),
      ...this.status(doc.path),
    };
  }

  /** @param {unknown} input @param {unknown} version @param {unknown} updates */
  pushUpdates(input, version, updates) {
    const path = this.resolvePath(input);
    const doc = this.docs.get(path);
    if (!doc) throw new EditorError('NOT_OPEN', '文档未打开', 409);
    if (!Number.isInteger(version)) throw new EditorError('INVALID_UPDATE', '缺少版本号');
    if (!Array.isArray(updates) || updates.length === 0 || updates.length > 2000) throw new EditorError('INVALID_UPDATE', '编辑数据无效');
    if (version !== doc.version) return { ok: false, version: doc.version };
    let text = doc.text;
    const applied = [];
    for (const update of updates) {
      if (!update || typeof update.clientID !== 'string' || update.clientID.length > 100) {
        throw new EditorError('INVALID_UPDATE', '编辑数据无效');
      }
      let changes;
      try {
        changes = ChangeSet.fromJSON(update.changes);
      } catch {
        throw new EditorError('INVALID_UPDATE', '编辑数据无效');
      }
      if (changes.length !== text.length) throw new EditorError('DESYNC', '文档状态不同步，请重新加载', 409);
      text = changes.apply(text);
      applied.push({ clientID: update.clientID, changes });
    }
    this.commit(doc, text, applied);
    return { ok: true, version: doc.version };
  }

  /** @param {Doc} doc @param {any} text @param {{clientID:string, changes:any}[]} applied */
  commit(doc, text, applied) {
    const start = doc.version;
    doc.text = text;
    const wire = applied.map((u) => ({ clientID: u.clientID, changes: u.changes.toJSON() }));
    doc.log.push(...wire);
    doc.version += applied.length;
    if (doc.log.length > MAX_UPDATE_LOG) {
      const drop = doc.log.length - MAX_UPDATE_LOG;
      doc.log.splice(0, drop);
      doc.base += drop;
    }
    this.scheduleHot(doc);
    this.emit({ type: 'doc.updates', path: doc.path, version: start, updates: wire, ...this.status(doc.path) });
    this.mapHighlights(doc, applied);
  }

  /** @param {unknown} input @param {unknown} version */
  pullUpdates(input, version) {
    const path = this.resolvePath(input);
    const doc = this.docs.get(path);
    if (!doc || !Number.isInteger(version) || Number(version) < doc.base || Number(version) > doc.version) return { reset: true };
    return { version, updates: doc.log.slice(Number(version) - doc.base) };
  }

  /** Apply a whole-content replacement as one collab update. @param {Doc} doc @param {string} content @param {string} clientID */
  applyServerString(doc, content, clientID) {
    const change = diffChange(doc.text.toString(), normalizeNewlines(content));
    if (!change) return false;
    const changes = ChangeSet.of(change, doc.text.length);
    this.commit(doc, changes.apply(doc.text), [{ clientID, changes }]);
    return true;
  }

  /** @param {unknown} input @param {{ overwrite?: boolean }} [options] */
  async saveDoc(input, { overwrite = false } = {}) {
    const path = this.resolvePath(input);
    let doc = this.docs.get(path);
    if (!doc) {
      if (!this.hotPaths.has(path)) return { saved: false, reason: 'not_modified' };
      doc = await this.openDoc(path, { tab: true });
    }
    while (doc.saving) await doc.saving.catch(() => undefined);
    const run = this.writeDoc(doc, overwrite);
    doc.saving = run;
    try {
      return await run;
    } finally {
      if (doc.saving === run) doc.saving = null;
    }
  }

  /** @param {Doc} doc @param {boolean} overwrite */
  async writeDoc(doc, overwrite) {
    const st = await stat(doc.path).catch(() => null);
    if (st?.isDirectory()) throw new EditorError('IS_DIRECTORY', '目标路径是一个文件夹');
    if (!overwrite && st && !sameDisk(diskOf(st), doc.disk)) {
      let same = false;
      try {
        same = toText(decodeFile(await readFile(doc.path)).text).eq(doc.savedText);
      } catch {
        same = false;
      }
      if (!same) {
        if (!doc.diskChanged) {
          doc.diskChanged = true;
          doc.conflictDisk = diskOf(st);
          this.emitStatus(doc);
        }
        throw new EditorError('CONFLICT', '文件已在磁盘上被其他程序修改，保存会覆盖这些修改', 409);
      }
    }
    if (!st) await mkdir(dirname(doc.path), { recursive: true });
    const snapshot = doc.text;
    const body = Buffer.from(snapshot.sliceString(0, snapshot.length, doc.eol), 'utf8');
    const data = doc.bom ? Buffer.concat([BOM, body]) : body;
    await writeAtomic(doc.path, data, st, ++this.tmpCounter).catch((e) => {
      throw mapFsError(e);
    });
    const written = await stat(doc.path);
    doc.savedText = snapshot;
    doc.disk = diskOf(written);
    doc.conflictDisk = null;
    doc.diskChanged = false;
    doc.deleted = false;
    if (this.isDirty(doc)) {
      this.scheduleHot(doc);
    } else {
      if (doc.hotTimer) clearTimeout(doc.hotTimer);
      doc.hotTimer = null;
      await this.removeHot(doc.path);
    }
    if (!st) {
      this.indexCache.clear();
      this.emit({ type: 'fs.changed', dir: dirname(doc.path) });
    }
    this.emitStatus(doc);
    return { saved: true, bytes: data.length };
  }

  /** Reload from disk, discarding unsaved edits. @param {unknown} input */
  async revertDoc(input) {
    const path = this.resolvePath(input);
    const doc = this.docs.get(path);
    if (!doc) throw new EditorError('NOT_OPEN', '文档未打开', 409);
    const st = await stat(path).catch(() => null);
    if (!st) throw new EditorError('NOT_FOUND', '磁盘上的文件已不存在', 404);
    if (st.size > MAX_FILE_BYTES) throw new EditorError('TOO_LARGE', '文件超过 32 MB，无法打开', 413);
    const decoded = decodeFile(await readFile(path));
    this.applyServerString(doc, decoded.text, 'disk');
    doc.savedText = doc.text;
    doc.eol = decoded.eol;
    doc.bom = decoded.bom;
    doc.disk = diskOf(st);
    doc.conflictDisk = null;
    doc.diskChanged = false;
    doc.deleted = false;
    if (doc.hotTimer) clearTimeout(doc.hotTimer);
    doc.hotTimer = null;
    await this.removeHot(path);
    this.emitStatus(doc);
  }

  /** Detect changes made on disk by other programs (including the Agent's own file tools). */
  async pollDisk() {
    if (this.polling) return;
    this.polling = true;
    try {
      for (const doc of [...this.docs.values()]) {
        if (doc.saving || this.docs.get(doc.path) !== doc) continue;
        const st = await stat(doc.path).catch(() => null);
        if (!st) {
          if (!doc.deleted) {
            doc.deleted = true;
            doc.disk = null;
            this.scheduleHot(doc);
            this.emitStatus(doc);
            this.notice('warn', `${basename(doc.path)} 已在磁盘上被删除，保存可重新创建`);
          }
          continue;
        }
        if (st.isDirectory()) continue;
        const meta = diskOf(st);
        if (sameDisk(meta, doc.disk)) continue;
        if (doc.diskChanged && sameDisk(meta, doc.conflictDisk)) continue;
        if (st.size > MAX_FILE_BYTES) continue;
        let decoded;
        try {
          decoded = decodeFile(await readFile(doc.path));
        } catch {
          continue;
        }
        if (this.docs.get(doc.path) !== doc || doc.saving) continue;
        const diskText = toText(decoded.text);
        const wasDeleted = doc.deleted;
        doc.deleted = false;
        if (diskText.eq(doc.savedText) && !wasDeleted) {
          doc.disk = meta;
          continue;
        }
        if (!this.isDirty(doc) || wasDeleted && doc.text.eq(diskText)) {
          if (!doc.text.eq(diskText)) this.applyServerString(doc, decoded.text, 'disk');
          this.markClean(doc, decoded, meta);
          if (!wasDeleted) this.notice('info', `已从磁盘重新加载 ${basename(doc.path)}`);
        } else if (diskText.eq(doc.text)) {
          this.markClean(doc, decoded, meta);
        } else {
          doc.conflictDisk = meta;
          if (!doc.diskChanged) {
            doc.diskChanged = true;
            this.emitStatus(doc);
            this.notice('warn', `${basename(doc.path)} 已在磁盘上被修改，而编辑器中有未保存的更改`);
          }
        }
      }
    } finally {
      this.polling = false;
    }
  }

  /** @param {Doc} doc @param {{eol:string,bom:boolean}} decoded @param {DiskMeta} meta */
  markClean(doc, decoded, meta) {
    doc.savedText = doc.text;
    doc.eol = decoded.eol;
    doc.bom = decoded.bom;
    doc.disk = meta;
    doc.conflictDisk = null;
    doc.diskChanged = false;
    if (doc.hotTimer) clearTimeout(doc.hotTimer);
    doc.hotTimer = null;
    void this.removeHot(doc.path);
    this.emitStatus(doc);
  }

  // ---- tabs ----------------------------------------------------------------------------------

  /** @param {string} path @param {boolean} focus */
  async addTab(path, focus) {
    let changed = false;
    if (!this.tabs.includes(path)) {
      this.tabs.push(path);
      changed = true;
    }
    if ((focus || !this.active) && this.active !== path) {
      this.active = path;
      changed = true;
    }
    if (changed) {
      await this.persist();
      this.emitState();
    }
  }

  /** @param {unknown} input */
  async activateTab(input) {
    const path = resolve(this.expand(input));
    if (!this.tabs.includes(path)) throw new EditorError('NOT_FOUND', '标签不存在', 404);
    if (this.active !== path) {
      this.active = path;
      await this.persist();
      this.emitState();
    }
  }

  /** @param {unknown} input @param {{ discard?: boolean }} [options] */
  async closeTab(input, { discard = false } = {}) {
    const path = resolve(this.expand(input));
    const index = this.tabs.indexOf(path);
    if (index === -1) return;
    if (this.status(path).dirty && !discard) throw new EditorError('UNSAVED', '文件有未保存的更改', 409);
    this.tabs.splice(index, 1);
    if (this.active === path) this.active = this.tabs[Math.min(index, this.tabs.length - 1)] ?? null;
    this.dropDoc(path);
    await this.removeHot(path);
    await this.persist();
    this.emitState();
  }

  /** @param {string} path */
  dropDoc(path) {
    const doc = this.docs.get(path);
    if (doc?.hotTimer) clearTimeout(doc.hotTimer);
    const list = this.highlights.get(path);
    if (doc && list) {
      if (this.settings.highlightsPersist) for (const h of list) Object.assign(h, this.anchorOf(doc, h));
      else this.highlights.delete(path);
      this.emitState();
      this.scheduleHighlightSave();
    }
    this.docs.delete(path);
  }

  // ---- file system ---------------------------------------------------------------------------

  /**
   * @param {{ dir?: unknown, name: unknown, kind?: unknown, content?: unknown, unique?: unknown, open?: unknown, focus?: unknown }} request
   */
  async createEntry({ dir, name, kind = 'file', content = '', unique = false, open = true, focus = true }) {
    if (kind !== 'file' && kind !== 'dir') throw new EditorError('INVALID_KIND', '只能创建文件或文件夹');
    if (typeof content !== 'string') throw new EditorError('INVALID_CONTENT', '文件内容必须是文本');
    if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new EditorError('TOO_LARGE', '文件超过 32 MB', 413);
    const base = dir === undefined || dir === null || dir === '' ? this.folders[0] : this.resolvePath(dir);
    if (!base) throw new EditorError('NO_FOLDER', '请先在侧边栏添加一个文件夹');
    const baseStat = await stat(base).catch(() => null);
    if (!baseStat?.isDirectory()) throw new EditorError('NOT_DIRECTORY', '目标文件夹不存在', 404);
    let target = resolve(base, ...splitName(String(name)));
    if (target === base || !this.inFolders(target)) throw new EditorError('INVALID_NAME', '文件名无效');
    await mkdir(dirname(target), { recursive: true }).catch((e) => {
      throw mapFsError(e);
    });
    if (unique) target = await uniquePath(target);
    try {
      if (kind === 'dir') await mkdir(target);
      else await writeFile(target, content, { flag: 'wx' });
    } catch (error) {
      if (/** @type {any} */ (error)?.code === 'EEXIST') throw new EditorError('EXISTS', `已存在同名文件：${basename(target)}`, 409);
      throw mapFsError(error);
    }
    this.indexCache.clear();
    this.emit({ type: 'fs.changed', dir: dirname(target) });
    if (kind === 'file' && open) await this.openDoc(target, { tab: true, focus: !!focus });
    return { path: target, kind };
  }

  // ---- hot exit ------------------------------------------------------------------------------

  /** @param {string} path */
  hotFile(path) {
    return join(this.hotDir, `${sha1(path)}.json`);
  }

  /** @param {string} path */
  async readHot(path) {
    try {
      const hot = JSON.parse(await readFile(this.hotFile(path), 'utf8'));
      return hot.path === path && typeof hot.text === 'string' ? hot : null;
    } catch {
      return null;
    }
  }

  /** @param {Doc} doc */
  scheduleHot(doc) {
    if (doc.hotTimer) clearTimeout(doc.hotTimer);
    doc.hotTimer = setTimeout(() => void this.flushHot(doc), 1000);
  }

  /** @param {Doc} doc */
  async flushHot(doc) {
    if (doc.hotTimer) clearTimeout(doc.hotTimer);
    doc.hotTimer = null;
    try {
      if (this.docs.get(doc.path) !== doc) return;
      if (this.isDirty(doc)) {
        const file = this.hotFile(doc.path);
        const tmp = `${file}.${process.pid}.${++this.tmpCounter}.tmp`;
        await writeFile(tmp, JSON.stringify({ path: doc.path, text: doc.text.toString(), disk: doc.disk, eol: doc.eol, bom: doc.bom, at: Date.now() }));
        await rename(tmp, file);
        this.hotPaths.add(doc.path);
      } else {
        await this.removeHot(doc.path);
      }
    } catch (error) {
      this.logger.warn('editor.hot.write_failed', { code: String(/** @type {any} */ (error)?.code ?? 'unknown') });
    }
  }

  /** @param {string} path */
  async removeHot(path) {
    this.hotPaths.delete(path);
    await rm(this.hotFile(path), { force: true }).catch(() => undefined);
  }

  async flushAll() {
    for (const doc of [...this.docs.values()]) await this.flushHot(doc);
    if (this.highlightTimer) {
      clearTimeout(this.highlightTimer);
      this.highlightTimer = null;
      this.saveHighlights();
    }
    await this.persistChain;
  }

  // ---- review highlights ---------------------------------------------------------------------
  // Agent highlights are editor overlays: they never touch the buffer or the file. Positions follow edits
  // the way a cursor does. The user's highlightsPersist switch decides their lifetime (see DEFAULT_SETTINGS).

  /** @param {string} path */
  highlightItems(path) {
    return (this.highlights.get(path) ?? []).map(({ id, from, to, lines, kind, note }) => ({ id, from, to, lines, kind, note }));
  }

  highlightTotal() {
    let total = 0;
    for (const list of this.highlights.values()) total += list.length;
    return total;
  }

  /** Broadcast a file's list after highlights were added or removed (pure mapping needs no event). @param {string} path */
  highlightsChanged(path) {
    const doc = this.docs.get(path);
    if (doc) this.emit({ type: 'highlights', path, version: doc.version, items: this.highlightItems(path) });
    this.emitState();
    this.scheduleHighlightSave();
  }

  /** @param {string} path @param {Highlight[]} list */
  setHighlightList(path, list) {
    if (list.length) this.highlights.set(path, list);
    else this.highlights.delete(path);
  }

  /** Map highlights through committed changes; without persistence, touched ones are dropped. @param {Doc} doc @param {{changes:any}[]} applied */
  mapHighlights(doc, applied) {
    const list = this.highlights.get(doc.path);
    if (!list) return;
    const keep = this.settings.highlightsPersist;
    const next = list.filter((h) => {
      let { from, to } = h;
      for (const { changes } of applied) {
        if (!keep && changes.touchesRange(from, to)) return false;
        const mappedFrom = changes.mapPos(from, 1);
        const mappedTo = Math.max(mappedFrom, changes.mapPos(to, -1));
        if (to > from && mappedTo === mappedFrom) return false; // all highlighted text was deleted
        from = mappedFrom;
        to = mappedTo;
      }
      h.from = from;
      h.to = to;
      return true;
    });
    if (next.length !== list.length) {
      this.setHighlightList(doc.path, next);
      this.highlightsChanged(doc.path);
    } else {
      this.scheduleHighlightSave();
    }
  }

  /** What identifies a kept highlight while its file is closed. @param {Doc} doc @param {Highlight} h */
  anchorOf(doc, h) {
    return {
      text: doc.text.sliceString(h.from, h.to),
      startLine: doc.text.lineAt(h.from).number,
      endLine: doc.text.lineAt(h.lines ? h.to : Math.max(h.from, h.to - 1)).number,
    };
  }

  /**
   * A closed file was loaded again. A kept highlight stays where its code still is; if the file changed in the
   * meantime it moves to the only other place that code occurs, otherwise it is dropped.
   * @param {Doc} doc
   */
  attachHighlights(doc) {
    const list = this.highlights.get(doc.path);
    if (!list) return;
    /** @type {string|null} */
    let source = null;
    const kept = list.filter((h) => {
      const code = h.text ?? '';
      if (h.to <= doc.text.length && doc.text.sliceString(h.from, h.to) === code) return true;
      if (!code) return false;
      source ??= doc.text.toString();
      const at = source.indexOf(code);
      if (at === -1 || source.indexOf(code, at + 1) !== -1) return false;
      h.from = at;
      h.to = at + code.length;
      return true;
    });
    for (const h of kept) {
      if (h.lines) {
        h.from = doc.text.lineAt(h.from).from;
        h.to = doc.text.lineAt(h.to).to;
      }
      delete h.text;
      delete h.startLine;
      delete h.endLine;
    }
    this.scheduleHighlightSave();
    if (kept.length === list.length) return;
    this.setHighlightList(doc.path, kept);
    this.notice('info', `${basename(doc.path)} 在关闭期间被修改，${list.length - kept.length} 个 Agent 高亮已失效`);
    this.emitState();
  }

  highlightLifetimeChanged() {
    if (this.settings.highlightsPersist) {
      this.saveHighlights();
      return;
    }
    // Back to temporary highlights: those of closed files are dropped, nothing is kept on disk.
    for (const path of [...this.highlights.keys()]) if (!this.docs.has(path)) this.highlights.delete(path);
    if (this.highlightTimer) clearTimeout(this.highlightTimer);
    this.highlightTimer = null;
    this.persistChain = this.persistChain.then(() => rm(this.highlightsPath, { force: true })).catch(() => undefined);
    this.emitState();
  }

  scheduleHighlightSave() {
    if (!this.settings.highlightsPersist || this.highlightTimer) return;
    this.highlightTimer = setTimeout(() => {
      this.highlightTimer = null;
      this.saveHighlights();
    }, 1000);
  }

  saveHighlights() {
    const files = [...this.highlights].map(([path, list]) => {
      const doc = this.docs.get(path);
      return { path, items: list.map((h) => (doc ? { ...h, ...this.anchorOf(doc, h) } : { ...h })) };
    });
    const data = JSON.stringify({ seq: this.highlightSeq, files });
    this.persistChain = this.persistChain
      .then(async () => {
        const tmp = `${this.highlightsPath}.${process.pid}.${++this.tmpCounter}.tmp`;
        await writeFile(tmp, data);
        await rename(tmp, this.highlightsPath);
      })
      .catch((error) => this.logger.warn('editor.highlights.persist_failed', { code: String(error?.code ?? 'unknown') }));
  }

  async loadHighlights() {
    /** @type {any} */
    let saved;
    try {
      saved = JSON.parse(await readFile(this.highlightsPath, 'utf8'));
    } catch {
      return;
    }
    if (!saved || !Array.isArray(saved.files)) return;
    if (Number.isInteger(saved.seq)) this.highlightSeq = Math.max(this.highlightSeq, saved.seq);
    const int = (/** @type {unknown} */ v) => Number.isInteger(v) && Number(v) >= 0;
    for (const file of saved.files) {
      if (!file || typeof file.path !== 'string' || !isAbsolute(file.path) || !this.inFolders(file.path) || !Array.isArray(file.items)) continue;
      const items = file.items
        .filter((h) => h && typeof h.id === 'string' && /^h\d+$/.test(h.id) && int(h.from) && int(h.to) && h.to >= h.from
          && typeof h.lines === 'boolean' && HIGHLIGHT_KINDS.has(h.kind) && typeof h.note === 'string' && h.note.length <= MAX_NOTE_CHARS
          && typeof h.text === 'string' && int(h.startLine) && int(h.endLine))
        .slice(0, MAX_HIGHLIGHTS_PER_FILE)
        .map(({ id, from, to, lines, kind, note, at, text, startLine, endLine }) => ({
          id, from, to, lines, kind, note, at: Number.isFinite(at) ? at : 0, text, startLine, endLine,
        }));
      if (items.length) this.highlights.set(resolve(file.path), items);
    }
  }

  /** Remove by ids, by file, or everything. @param {{ ids?: unknown, path?: unknown, all?: unknown }} target */
  clearHighlights({ ids, path, all }) {
    /** @type {Set<string>} */
    const touched = new Set();
    let removed = 0;
    const filterAll = (/** @type {(h: Highlight) => boolean} */ drop) => {
      for (const [p, list] of [...this.highlights]) {
        const next = list.filter((h) => !drop(h));
        if (next.length === list.length) continue;
        removed += list.length - next.length;
        this.setHighlightList(p, next);
        touched.add(p);
      }
    };
    if (Array.isArray(ids)) {
      const wanted = new Set(ids.filter((id) => typeof id === 'string'));
      filterAll((h) => wanted.has(h.id));
    } else if (typeof path === 'string' && path) {
      const p = resolve(this.expand(path));
      const list = this.highlights.get(p);
      if (list) {
        removed = list.length;
        this.highlights.delete(p);
        touched.add(p);
      }
    } else if (all === true) {
      filterAll(() => true);
    } else {
      throw new EditorError('INVALID_ARGUMENT', '请指定要清除的高亮');
    }
    for (const p of touched) this.highlightsChanged(p);
    return removed;
  }

  /** @param {unknown} input */
  highlightsPayload(input) {
    const doc = this.docs.get(resolve(this.expand(input)));
    return doc ? { version: doc.version, items: this.highlightItems(doc.path) } : { version: -1, items: [] };
  }

  /**
   * Turn one highlight_code entry into document offsets (validated before anything is added).
   * @param {any} text @param {() => string} source @param {any} spec @param {number} index
   */
  resolveHighlight(text, source, spec, index) {
    const where = `highlights[${index}]`;
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new EditorError('INVALID_ARGUMENT', `${where} 必须是对象`);
    const kind = spec.kind ?? 'info';
    if (!HIGHLIGHT_KINDS.has(kind)) throw new EditorError('INVALID_ARGUMENT', `${where}.kind 只能是 info、warning、error 或 success`);
    const note = spec.note ?? '';
    if (typeof note !== 'string' || note.length > MAX_NOTE_CHARS) throw new EditorError('INVALID_ARGUMENT', `${where}.note 必须是不超过 ${MAX_NOTE_CHARS} 字的文本`);
    const positional = ['start_line', 'end_line', 'start_column', 'end_column'].filter((k) => spec[k] !== undefined);
    const isLine = (/** @type {unknown} */ v) => Number.isInteger(v) && Number(v) >= 1;

    if (spec.text !== undefined) {
      if (positional.length) throw new EditorError('INVALID_ARGUMENT', `${where} 不能同时使用 text 和 ${positional.join('/')}`);
      if (typeof spec.text !== 'string' || !spec.text) throw new EditorError('INVALID_ARGUMENT', `${where}.text 不能为空`);
      const needle = normalizeNewlines(spec.text);
      const content = source();
      const hits = [];
      for (let i = content.indexOf(needle); i !== -1 && hits.length < 11; i = content.indexOf(needle, i + 1)) hits.push(i);
      if (!hits.length) throw new EditorError('NOT_FOUND', `${where}.text 未在文件当前内容中找到（当前内容包含未保存的修改）`, 404);
      if (hits.length > 1) {
        const lines = hits.slice(0, 10).map((i) => text.lineAt(i).number).join('、');
        throw new EditorError('AMBIGUOUS', `${where}.text 匹配到多处（第 ${lines} 行${hits.length > 10 ? ' 等' : ''}），请提供更长的片段，或改用 start_line/end_line`, 409);
      }
      return { from: hits[0], to: hits[0] + needle.length, lines: false, kind, note };
    }

    if (!isLine(spec.start_line)) throw new EditorError('INVALID_ARGUMENT', `${where} 需要 text，或从 1 开始的 start_line`);
    const startLine = Number(spec.start_line);
    const endLine = spec.end_line === undefined ? startLine : spec.end_line;
    if (!isLine(endLine) || endLine < startLine) throw new EditorError('INVALID_ARGUMENT', `${where}.end_line 必须 ≥ start_line`);
    if (endLine > text.lines) throw new EditorError('OUT_OF_RANGE', `${where} 超出文件范围：文件只有 ${text.lines} 行`);
    const first = text.line(startLine);
    const last = text.line(endLine);
    if (spec.start_column === undefined && spec.end_column === undefined) {
      return { from: first.from, to: last.to, lines: true, kind, note };
    }
    const startColumn = spec.start_column ?? 1;
    if (!isLine(startColumn) || (spec.end_column !== undefined && !isLine(spec.end_column))) {
      throw new EditorError('INVALID_ARGUMENT', `${where} 的列号必须是从 1 开始的整数`);
    }
    const from = first.from + Math.min(startColumn - 1, first.length);
    const to = spec.end_column === undefined ? last.to : last.from + Math.min(spec.end_column, last.length);
    if (to <= from) throw new EditorError('INVALID_ARGUMENT', `${where} 的范围为空`);
    return { from, to, lines: false, kind, note };
  }

  /** Human-oriented position of a highlight (1-based lines; columns inclusive). @param {Doc|null} doc @param {Highlight} h */
  describeHighlight(doc, h) {
    const base = { id: h.id, kind: h.kind, note: h.note };
    if (!doc) return { ...base, startLine: h.startLine, endLine: h.endLine, lines: true, fileClosed: true };
    const first = doc.text.lineAt(h.from);
    const last = doc.text.lineAt(h.lines ? h.to : Math.max(h.from, h.to - 1));
    if (h.lines) return { ...base, startLine: first.number, endLine: last.number, lines: true };
    return {
      ...base, lines: false, startLine: first.number, endLine: last.number,
      startColumn: h.from - first.from + 1, endColumn: h.to - last.from, text: doc.text.sliceString(h.from, Math.min(h.to, h.from + 200)),
    };
  }

  // ---- page view and settings ----------------------------------------------------------------

  /** @param {unknown} patch */
  async updateSettings(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new EditorError('INVALID_SETTING', '设置格式无效');
    const next = { ...this.settings };
    for (const [key, value] of Object.entries(patch)) {
      const rule = SETTING_RULES[key];
      if (!rule) throw new EditorError('INVALID_SETTING', `未知设置项：${key}`);
      if (!rule(value)) throw new EditorError('INVALID_SETTING', `设置项取值无效：${key}`);
      /** @type {any} */ (next)[key] = value;
    }
    const lifetimeChanged = next.highlightsPersist !== this.settings.highlightsPersist;
    this.settings = next;
    if (lifetimeChanged) this.highlightLifetimeChanged();
    await this.persist();
    this.emitState();
    return this.settings;
  }

  /** The page reports what the user is looking at, so the Agent can act on "this selection". @param {any} body */
  setView(body) {
    if (!body || typeof body.path !== 'string' || !this.tabs.includes(body.path)) return;
    const selections = Array.isArray(body.selections)
      ? body.selections.slice(0, 50).filter((s) => s && Number.isInteger(s.anchor?.line) && Number.isInteger(s.head?.line))
        .map((s) => ({ anchor: { line: s.anchor.line, col: s.anchor.col }, head: { line: s.head.line, col: s.head.col } }))
      : [];
    const selectedText = typeof body.selectedText === 'string' ? body.selectedText.slice(0, 8000) : '';
    this.view = { path: body.path, selections, selectedText, at: Date.now() };
  }

  // ---- Agent operations (MCP) ----------------------------------------------------------------

  editorState() {
    const view = this.view && this.view.path === this.active && !isSensitivePath(this.view.path) ? this.view : null;
    return {
      folders: this.folders,
      primaryFolder: this.folders[0] ?? null,
      draftsFolder: this.draftsDir,
      openEditorPages: this.pageCount,
      activeFile: this.active,
      tabs: this.tabs.map((p) => ({ path: p, active: p === this.active, ...this.status(p), highlights: this.highlights.get(p)?.length ?? 0 })),
      selection: view ? { file: view.path, ranges: view.selections, selectedText: view.selectedText } : null,
      highlights: {
        total: this.highlightTotal(),
        visible: this.settings.highlightsVisible,
        keepUntilCleared: this.settings.highlightsPersist,
      },
    };
  }

  /** @param {unknown} input */
  async agentList(input) {
    const path = input === undefined || input === null || input === '' ? this.folders[0] : this.resolvePath(input, { relativeToPrimary: true });
    if (!path) throw new EditorError('NO_FOLDER', '编辑器侧边栏中还没有文件夹');
    return this.listDir(path);
  }

  /** @param {unknown} input @param {unknown} startLine @param {unknown} endLine */
  async agentRead(input, startLine, endLine) {
    const path = this.resolvePath(input, { relativeToPrimary: true });
    assertAgentAccessible(path);
    let doc = this.docs.get(path);
    if (!doc && this.hotPaths.has(path)) doc = await this.openDoc(path, { tab: true });
    let text;
    let source;
    let dirty = false;
    if (doc) {
      text = doc.text;
      source = 'editor buffer';
      dirty = this.isDirty(doc);
    } else {
      const st = await stat(path).catch((e) => {
        throw mapFsError(e);
      });
      if (st.isDirectory()) throw new EditorError('IS_DIRECTORY', '这是一个文件夹，请使用 list_directory');
      if (st.size > MAX_FILE_BYTES) throw new EditorError('TOO_LARGE', '文件超过 32 MB', 413);
      text = toText(decodeFile(await readFile(path)).text);
      source = 'disk';
    }
    const total = text.lines;
    const from = Number.isInteger(startLine) ? Math.min(Math.max(1, Number(startLine)), total) : 1;
    let to = Number.isInteger(endLine) ? Math.min(Math.max(from, Number(endLine)), total) : Math.min(total, from + AGENT_READ_MAX_LINES - 1);
    to = Math.min(to, from + AGENT_READ_MAX_LINES - 1);
    let content = text.sliceString(text.line(from).from, text.line(to).to);
    let clipped = false;
    if (content.length > AGENT_READ_MAX_CHARS) {
      content = content.slice(0, AGENT_READ_MAX_CHARS);
      clipped = true;
    }
    return { path, source, dirty, totalLines: total, startLine: from, endLine: to, clipped, content };
  }

  /** @param {unknown} input @param {unknown} content @param {unknown} open */
  async agentCreate(input, content, open) {
    const path = this.resolvePath(input, { relativeToPrimary: true });
    const folder = this.folderOf(path);
    if (!folder || folder === path) throw new EditorError('INVALID_PATH', '请提供文件路径');
    const result = await this.createEntry({
      dir: folder, name: relative(folder, path).split(sep).join('/'), kind: 'file',
      content: typeof content === 'string' ? content : '', open: open !== false, focus: false,
    });
    this.emit({ type: 'agent.activity', action: 'create', path: result.path });
    return result;
  }

  /** @param {unknown} input @param {unknown} content @param {unknown} save */
  async agentWrite(input, content, save) {
    if (typeof content !== 'string') throw new EditorError('INVALID_CONTENT', 'content 必须是字符串');
    if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new EditorError('TOO_LARGE', '内容超过 32 MB', 413);
    const path = this.resolvePath(input, { relativeToPrimary: true });
    assertAgentAccessible(path);
    const doc = await this.openDoc(path, { tab: true });
    const changed = this.applyServerString(doc, content, 'agent');
    const saveResult = save === true ? await this.saveDoc(doc.path) : null;
    this.emit({ type: 'agent.activity', action: 'write', path: doc.path });
    return { path: doc.path, changed, saved: !!saveResult?.saved, ...this.status(doc.path) };
  }

  /** @param {unknown} input @param {unknown} oldText @param {unknown} newText @param {unknown} replaceAll @param {unknown} save */
  async agentEdit(input, oldText, newText, replaceAll, save) {
    if (typeof oldText !== 'string' || oldText === '') throw new EditorError('INVALID_ARGUMENT', 'old_text 不能为空');
    if (typeof newText !== 'string') throw new EditorError('INVALID_ARGUMENT', 'new_text 必须是字符串');
    const path = this.resolvePath(input, { relativeToPrimary: true });
    assertAgentAccessible(path);
    const doc = await this.openDoc(path, { tab: true });
    const source = doc.text.toString();
    const needle = normalizeNewlines(oldText);
    const insert = normalizeNewlines(newText);
    const positions = [];
    for (let i = source.indexOf(needle); i !== -1; i = source.indexOf(needle, i + needle.length)) positions.push(i);
    if (!positions.length) throw new EditorError('NOT_FOUND', 'old_text 未在文件当前内容中找到（当前内容包含未保存的修改）', 404);
    if (positions.length > 1 && replaceAll !== true) {
      throw new EditorError('AMBIGUOUS', `old_text 匹配到 ${positions.length} 处，请提供更多上下文，或设置 replace_all: true`, 409);
    }
    const targets = replaceAll === true ? positions : positions.slice(0, 1);
    const changes = ChangeSet.of(targets.map((from) => ({ from, to: from + needle.length, insert })), doc.text.length);
    this.commit(doc, changes.apply(doc.text), [{ clientID: 'agent', changes }]);
    const saveResult = save === true ? await this.saveDoc(doc.path) : null;
    this.emit({ type: 'agent.activity', action: 'write', path: doc.path });
    return { path: doc.path, replacements: targets.length, saved: !!saveResult?.saved, ...this.status(doc.path) };
  }

  /** @param {unknown} input @param {unknown} overwrite */
  async agentSave(input, overwrite) {
    const path = this.resolvePath(input, { relativeToPrimary: true });
    const result = await this.saveDoc(path, { overwrite: overwrite === true });
    return { path, ...result };
  }

  /** @param {unknown} input @param {unknown} line */
  async agentOpen(input, line) {
    let p = this.expand(input);
    if (!isAbsolute(p)) {
      if (!this.folders.length) throw new EditorError('INVALID_PATH', '需要绝对路径');
      p = resolve(this.folders[0], p);
    }
    p = resolve(p);
    const st = await stat(p).catch(() => null);
    if (st?.isDirectory()) {
      const result = await this.addFolder(p, { top: true });
      this.emit({ type: 'agent.activity', action: 'folder', path: result.path });
      return { kind: 'folder', ...result, primary: true };
    }
    const doc = await this.openDoc(this.resolvePath(p), { tab: true, focus: true });
    const lineNumber = Number.isInteger(line) && Number(line) >= 1 ? Math.min(Number(line), doc.text.lines) : null;
    this.emit({ type: 'agent.activity', action: 'open', path: doc.path, line: lineNumber });
    return { kind: 'file', path: doc.path, line: lineNumber };
  }

  /** @param {unknown} input @param {unknown} specs @param {{ replace?: unknown, reveal?: unknown }} options */
  async agentHighlight(input, specs, { replace, reveal }) {
    if (!Array.isArray(specs) || !specs.length) throw new EditorError('INVALID_ARGUMENT', 'highlights 至少需要一项');
    if (specs.length > MAX_HIGHLIGHTS_PER_CALL) throw new EditorError('INVALID_ARGUMENT', `一次最多添加 ${MAX_HIGHLIGHTS_PER_CALL} 个高亮`);
    const path = this.resolvePath(input, { relativeToPrimary: true });
    assertAgentAccessible(path);
    const doc = await this.openDoc(path, { tab: true });
    /** @type {string|null} */
    let source = null;
    const content = () => (source ??= doc.text.toString());
    const resolved = specs.map((spec, i) => this.resolveHighlight(doc.text, content, spec, i));
    const existing = replace === true ? [] : (this.highlights.get(path) ?? []);
    const replaced = replace === true ? (this.highlights.get(path)?.length ?? 0) : 0;
    if (existing.length + resolved.length > MAX_HIGHLIGHTS_PER_FILE) {
      throw new EditorError('TOO_MANY', `每个文件最多 ${MAX_HIGHLIGHTS_PER_FILE} 个高亮，请先用 clear_highlights 清除一些`, 409);
    }
    const at = Date.now();
    /** @type {Highlight[]} */
    const items = resolved.map((r) => ({ id: `h${++this.highlightSeq}`, ...r, at }));
    this.highlights.set(path, [...existing, ...items]);
    this.highlightsChanged(path);
    if (reveal !== false) {
      const first = items.reduce((a, b) => (b.from < a.from ? b : a));
      this.emit({ type: 'agent.activity', action: 'reveal', path, line: doc.text.lineAt(first.from).number });
    }
    return { path, replaced, items: items.map((h) => this.describeHighlight(doc, h)) };
  }

  /** @param {unknown} input */
  agentListHighlights(input) {
    const only = input === undefined || input === null || input === '' ? null : this.resolvePath(input, { relativeToPrimary: true });
    const files = [];
    for (const [path, list] of this.highlights) {
      if (only && path !== only) continue;
      const doc = this.docs.get(path) ?? null;
      const items = [...list].sort((a, b) => (doc ? a.from - b.from : Number(a.startLine) - Number(b.startLine)));
      files.push({ path, items: items.map((h) => this.describeHighlight(doc, h)) });
    }
    return { files, total: this.highlightTotal(), visible: this.settings.highlightsVisible, keepUntilCleared: this.settings.highlightsPersist };
  }

  /** @param {unknown} ids @param {unknown} input */
  agentClearHighlights(ids, input) {
    if (ids !== undefined) {
      if (!Array.isArray(ids) || !ids.length) throw new EditorError('INVALID_ARGUMENT', 'ids 必须是非空数组');
      return this.clearHighlights({ ids });
    }
    if (input !== undefined && input !== null && input !== '') return this.clearHighlights({ path: this.resolvePath(input, { relativeToPrimary: true }) });
    return this.clearHighlights({ all: true });
  }
}
