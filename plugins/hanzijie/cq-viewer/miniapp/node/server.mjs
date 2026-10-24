// @ts-check
// CadQuery Viewer — Node runtime.
//
// Exchange contract (fixed, documented):
//   ~/.cqview/scene/<name>.stl   parts pushed by cqview.show()                   (read)
//   ~/.cqview/scene/scene.json   optional per-part colour/opacity               (read)
//   ~/.cqview/roots.json         registered folders the page may browse          (read/write)
//   ~/.cqview/selection.json     last picked points, resolved to absolute files  (write)
//   <dataDir>/open-requests.json what the AI asked the page to open (MCP tools)  (read/write)
//   <dataDir>/renders/           white-model renders: captured view, Agent turn, result (render.mjs)
//
// Folder browsing is scoped: only folders registered in roots.json, only inside the
// user's home directory, only .stl/.step/.stp files, no symlinks, no hidden folders.
// Every route answers only loopback requests (Host is this machine; Origin, if sent, is this listener).
// The MCP endpoint (mcp.mjs) reuses the folder rules; its one extra power is copy_to_scene, which
// copies a model file into ~/.cqview/scene. Writes to ~/.cqview run one at a time (serial()).

import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, watch } from 'node:fs';
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, sep } from 'node:path';

import { createMcpHandler, MCP_PATH } from './mcp.mjs';
import { createRenderService, JOB_ID_RE, RENDER_BODY_BYTES } from './render.mjs';

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */
/** @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle */

const BASE = '/viewer';
const HOME = homedir();
const EXCHANGE_DIR = join(HOME, '.cqview');
const SCENE_DIR = join(EXCHANGE_DIR, 'scene');
const ROOTS_FILE = join(EXCHANGE_DIR, 'roots.json');
const SELECTION_FILE = join(EXCHANGE_DIR, 'selection.json');
const SELECTIONS_DIR = join(EXCHANGE_DIR, 'selections');
const DISPLAY_SCENE_DIR = '~/.cqview/scene';
const DISPLAY_SELECTION_FILE = '~/.cqview/selection.json';
const MAX_WORKSPACES = 100;
const MAX_EXTRAS = 20;

const PART_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.(stl|step|stp)$/i;
const PART_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const ROOT_ID_RE = /^[a-f0-9]{10}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const MODEL_EXT = new Set(['.stl', '.step', '.stp']);
const SKIP_DIRS = new Set(['node_modules', '__pycache__', 'venv', 'site-packages']);
const WALK_MAX_DEPTH = 10;
const WALK_MAX_ENTRIES = 50_000;
const WALK_MAX_FILES = 1_000;
const MAX_ROOTS = 20;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_POINTS = 50;
const MAX_NOTE_CHARS = 500;
const CLIENT_ID_RE = /^[a-z0-9]{8,32}$/;
const HEARTBEAT_MS = 20_000;
const WATCH_DEBOUNCE_MS = 250;
const PY_PROBE_TIMEOUT_MS = 60_000;
const STEP_TIMEOUT_MS = 300_000;
const STEP_MESH_VERSION = 'cqvm-1';
const CQVM_TYPE = 'application/x-cqview-mesh';
const STEP_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const STEP_CACHE_MAX_BYTES = 1024 * 1024 * 1024;
const STEP_TMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const REQUEST_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_REQUESTS = 20;
const REQUEST_TYPES = new Set(['folder', 'file', 'scene']);
const MCP_LIST_LIMIT = 200;
const MAX_COPY_BYTES = 512 * 1024 * 1024;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

const STEP_TO_STL_PY = [
  'import sys',
  'import cadquery as cq',
  'src, dst = sys.argv[1], sys.argv[2]',
  'wp = cq.importers.importStep(src)',
  'shapes = [v for v in wp.vals() if isinstance(v, cq.Shape)]',
  'if not shapes: sys.exit(3)',
  'shape = shapes[0] if len(shapes) == 1 else cq.Compound.makeCompound(shapes)',
  'tol = max(0.02, shape.BoundingBox().DiagonalLength * 1e-4)',
  'ok = shape.exportStl(dst, tolerance=tol, angularTolerance=0.15, ascii=False, relative=False)',
  'sys.exit(0 if ok is not False else 4)',
].join('\n');

/** Explicit allowlist of static Client assets (path under miniapp/client/assets). */
const ASSETS = /** @type {Record<string, string>} */ ({
  'app.js': 'text/javascript; charset=utf-8',
  'host-bridge.js': 'text/javascript; charset=utf-8',
  'render-panel.js': 'text/javascript; charset=utf-8',
  'style.css': 'text/css; charset=utf-8',
  'logo.png': 'image/png',
  'vendor/three.module.min.js': 'text/javascript; charset=utf-8',
  'vendor/OrbitControls.js': 'text/javascript; charset=utf-8',
  'vendor/STLLoader.js': 'text/javascript; charset=utf-8',
});

class HttpError extends Error {
  /** @param {number} status @param {string} code @param {string} [message] */
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.userMessage = message;
  }
}

/**
 * @param {MiniAppContext} context
 * @returns {Promise<MiniAppLifecycle>}
 */
export async function start(context) {
  const clientRoot = join(context.pluginRoot, 'miniapp', 'client');
  const indexHtml = await readFile(join(clientRoot, 'index.html'));
  const stepCacheDir = join(context.dataDir, 'step-cache');
  const requestsFile = join(context.dataDir, 'open-requests.json');
  const workspacesFile = join(context.dataDir, 'workspaces.json');
  const log = context.logger;
  /** Set by dispose(): from then on nothing new is spawned. */
  let disposed = false;

  /** Read-modify-write of our JSON files runs one at a time (page and AI can write together). */
  let writeChain = Promise.resolve();
  /** @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
  const serial = (fn) => {
    const run = writeChain.then(fn, fn);
    writeChain = run.then(
      () => {},
      () => {},
    );
    return run;
  };

  /** @type {Set<import('node:child_process').ChildProcess>} */
  const children = new Set();
  /** @type {Map<string, Promise<string>>} */
  const stepJobs = new Map();
  /** @type {Promise<string|null> | null} */
  let pythonProbe = null;

  // ---------- live updates (SSE) ----------
  /** @type {Set<import('node:http').ServerResponse>} */
  const clients = new Set();
  /** Workspace of each live page that told us one. @type {Map<import('node:http').ServerResponse, string>} */
  const clientDirs = new Map();
  /** @type {import('node:fs').FSWatcher | null} */
  let sceneWatcher = null;
  /** @type {Map<string, import('node:fs').FSWatcher>} */
  const rootWatchers = new Map();
  /** @type {Map<string, NodeJS.Timeout>} */
  const timers = new Map();
  let sceneVersion = 0;

  /** @param {Record<string, unknown>} payload */
  const broadcast = (payload) => {
    const frame = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of clients) {
      try {
        res.write(frame);
      } catch {
        clients.delete(res);
      }
    }
  };
  /** @param {string} key @param {() => void} fn */
  const debounced = (key, fn) => {
    const prev = timers.get(key);
    if (prev) clearTimeout(prev);
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        fn();
      }, WATCH_DEBOUNCE_MS),
    );
  };

  const ensureSceneWatcher = async () => {
    if (sceneWatcher || disposed) return;
    await mkdir(SCENE_DIR, { recursive: true });
    if (sceneWatcher || disposed) return; // a request raced us, or dispose ran meanwhile
    sceneWatcher = watch(SCENE_DIR, { persistent: false }, () =>
      debounced('scene', () => {
        sceneVersion += 1;
        broadcast({ type: 'scene', version: sceneVersion });
      }),
    );
    sceneWatcher.on('error', () => {
      sceneWatcher?.close();
      sceneWatcher = null;
      broadcast({ type: 'watch-lost' });
    });
  };

  /** Watch registered folders plus the session folders (and their extras) of the pages that are open. */
  const syncRootWatchers = async () => {
    const paths = new Set((await readRoots()).map((r) => r.path));
    const live = new Set(clientDirs.values());
    if (live.size) {
      const ws = await readWorkspaces();
      for (const dir of live) {
        paths.add(dir);
        for (const p of ws[dir]?.extras ?? []) paths.add(p);
      }
    }
    if (disposed) return;
    const wanted = new Set();
    for (const path of paths) {
      const id = rootId(path);
      wanted.add(id);
      if (rootWatchers.has(id)) continue;
      try {
        const w = watch(path, { persistent: false, recursive: true }, (_event, filename) => {
          if (filename && !MODEL_EXT.has(extname(String(filename)).toLowerCase())) return;
          debounced(`root:${id}`, () => broadcast({ type: 'files', root: id }));
        });
        w.on('error', () => {
          w.close();
          rootWatchers.delete(id);
        });
        rootWatchers.set(id, w);
      } catch {
        // folder vanished; the files route reports it
      }
    }
    for (const [id, w] of rootWatchers) {
      if (!wanted.has(id)) {
        w.close();
        rootWatchers.delete(id);
      }
    }
  };

  const heartbeat = setInterval(() => {
    for (const res of clients) {
      try {
        res.write(': ping\n\n');
      } catch {
        clients.delete(res);
      }
    }
  }, HEARTBEAT_MS);

  // ---------- domain: pushed scene ----------
  const readScene = async () => {
    await mkdir(SCENE_DIR, { recursive: true });
    const warnings = [];
    /** @type {Record<string, unknown>} */
    let meta = {};
    try {
      const parsed = JSON.parse(await readFile(join(SCENE_DIR, 'scene.json'), 'utf8'));
      if (parsed && typeof parsed === 'object' && parsed.parts && typeof parsed.parts === 'object') meta = parsed.parts;
      else warnings.push('scene.json 缺少 parts 字段，已忽略');
    } catch (error) {
      if (/** @type {any} */ (error).code !== 'ENOENT') warnings.push('scene.json 无法解析，已忽略');
    }
    const entries = (await readdir(SCENE_DIR)).filter((f) => PART_FILE_RE.test(f)).sort();
    /** @type {Map<string, any>} newest file wins when a name exists in several formats */
    const byName = new Map();
    for (const file of entries) {
      let st;
      try {
        st = await lstat(join(SCENE_DIR, file));
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      const ext = extname(file).toLowerCase();
      const name = file.slice(0, -ext.length);
      const prev = byName.get(name);
      if (prev && prev.mtime >= Math.round(st.mtimeMs)) continue;
      byName.set(name, {
        name,
        file,
        kind: ext === '.stl' ? 'stl' : 'step',
        size: st.size,
        mtime: Math.round(st.mtimeMs),
        ...sanitizeMeta(meta[name]),
      });
    }
    const parts = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
    return { dir: DISPLAY_SCENE_DIR, selectionFile: DISPLAY_SELECTION_FILE, parts, warnings };
  };

  // ---------- domain: registered folders ----------
  /** @param {unknown} input */
  const addRoot = async (input) => {
    const real = await validateRootPath(input);
    await serial(async () => {
      const roots = await readRoots();
      const next = [{ path: real, used: new Date().toISOString() }, ...roots.filter((r) => r.path !== real)].slice(
        0,
        MAX_ROOTS,
      );
      await writeJsonAtomic(ROOTS_FILE, { roots: next }); // commit first …
    });
    await syncRootWatchers();
    broadcast({ type: 'roots' }); // … then notify
    return describeRoot(real);
  };

  // ---------- domain: session folders ----------
  // A page opened in a chat works in that chat's folder (its "workspace"). Each workspace keeps the
  // extra folders added to it; models and annotations are per workspace. Stored in dataDir.
  /** @returns {Promise<Record<string, {extras: string[], used: string}>>} */
  const readWorkspaces = async () => {
    /** @type {Record<string, {extras: string[], used: string}>} */
    const out = {};
    try {
      const parsed = JSON.parse(await readFile(workspacesFile, 'utf8'));
      const all = parsed && typeof parsed.workspaces === 'object' && parsed.workspaces ? parsed.workspaces : {};
      for (const [dir, w] of Object.entries(all)) {
        if (!isAbsolute(dir) || !isAllowedWorkspace(dir) || !w || typeof w !== 'object') continue;
        const extras = Array.isArray(w.extras)
          ? w.extras.filter((/** @type {unknown} */ p) => typeof p === 'string' && isAbsolute(p) && isAllowedRoot(p))
          : [];
        out[dir] = { extras: extras.slice(0, MAX_EXTRAS), used: typeof w.used === 'string' ? w.used : '' };
      }
    } catch {
      /* none yet */
    }
    return out;
  };
  /** Read-modify-write of workspaces.json (one at a time), keeping the MAX_WORKSPACES most recent. */
  const updateWorkspaces = (/** @type {(ws: Record<string, {extras: string[], used: string}>) => void} */ fn) =>
    serial(async () => {
      const ws = await readWorkspaces();
      fn(ws);
      const keep = Object.entries(ws)
        .sort((a, b) => b[1].used.localeCompare(a[1].used))
        .slice(0, MAX_WORKSPACES);
      await writeJsonAtomic(workspacesFile, { version: 1, workspaces: Object.fromEntries(keep) });
      return Object.fromEntries(keep);
    });
  const touchWorkspace = (/** @type {string} */ dir) =>
    updateWorkspaces((ws) => {
      ws[dir] = { extras: ws[dir]?.extras ?? [], used: new Date().toISOString() };
    });
  /** @param {string} dir @param {string} extra */
  const addExtra = async (dir, extra) => {
    await updateWorkspaces((ws) => {
      const prev = ws[dir]?.extras ?? [];
      ws[dir] = { extras: [...prev.filter((p) => p !== extra), extra].slice(-MAX_EXTRAS), used: new Date().toISOString() };
    });
    await syncRootWatchers();
    broadcast({ type: 'workspace', folder: rootId(dir) });
  };
  /** @param {string} dir @param {string} extraId */
  const removeExtra = async (dir, extraId) => {
    await updateWorkspaces((ws) => {
      if (ws[dir]) ws[dir] = { ...ws[dir], extras: ws[dir].extras.filter((p) => rootId(p) !== extraId) };
    });
    await syncRootWatchers();
    broadcast({ type: 'workspace', folder: rootId(dir) });
  };
  /** What the page shows for a workspace: the session folder, its extra folders, its annotation file. */
  const describeWorkspace = async (/** @type {string} */ dir) => {
    const ws = await readWorkspaces();
    const extras = [];
    for (const p of ws[dir]?.extras ?? []) {
      const st = await stat(p).catch(() => null);
      extras.push({ ...describeRoot(p), kind: 'extra', missing: !st || !st.isDirectory() });
    }
    return {
      folder: { ...describeRoot(dir), kind: 'session' },
      extras,
      selectionFile: `~/.cqview/selections/${rootId(dir)}.json`,
    };
  };
  /** Every folder the viewer may read: registered folders, session folders, and their extras. */
  const allFolders = async () => {
    const set = new Set((await readRoots()).map((r) => r.path));
    for (const [dir, w] of Object.entries(await readWorkspaces())) {
      set.add(dir);
      for (const p of w.extras) set.add(p);
    }
    return [...set];
  };
  const findFolder = async (/** @type {string | null | undefined} */ id) => {
    if (!id || !ROOT_ID_RE.test(id)) return null;
    return (await allFolders()).find((p) => rootId(p) === id) ?? null;
  };
  const requireFolder = async (/** @type {string | null} */ id) => {
    const p = await findFolder(id);
    if (!p) throw new HttpError(404, 'root_not_registered', '这个文件夹还没有登记');
    return { path: p };
  };

  // ---------- domain: requests from the AI (MCP) for the page ----------
  /** @returns {Promise<{epoch: string|null, seq: number, items: Record<string, unknown>[]}>} */
  const readRequests = async () => {
    try {
      const parsed = JSON.parse(await readFile(requestsFile, 'utf8'));
      if (parsed && typeof parsed.epoch === 'string' && Number.isInteger(parsed.seq) && Array.isArray(parsed.items)) {
        const now = Date.now();
        const absOpt = (/** @type {unknown} */ v) => v === undefined || (typeof v === 'string' && isAbsolute(v));
        const items = parsed.items.filter(
          (/** @type {any} */ it) =>
            it &&
            Number.isInteger(it.seq) &&
            typeof it.at === 'string' &&
            now - Date.parse(it.at) < REQUEST_TTL_MS &&
            REQUEST_TYPES.has(it.type) &&
            absOpt(it.workspace) &&
            absOpt(it.path) &&
            absOpt(it.folder) &&
            (it.type === 'scene'
              ? typeof it.name === 'string' && PART_NAME_RE.test(it.name)
              : typeof it.root === 'string' && ROOT_ID_RE.test(it.root) && (it.type === 'folder' || typeof it.rel === 'string')),
        );
        return { epoch: parsed.epoch, seq: parsed.seq, items };
      }
    } catch {
      /* none yet */
    }
    return { epoch: null, seq: 0, items: [] };
  };

  /**
   * The requests that belong to one workspace, pointed at its own folders. A request made with a
   * workspace goes only there; one without goes wherever its file or folder lies inside the
   * workspace or one of its extra folders. Scene requests without a workspace go everywhere.
   * @param {string} dir
   */
  const requestsFor = async (dir) => {
    const doc = await readRequests();
    const ws = await readWorkspaces();
    const targets = [dir, ...(ws[dir]?.extras ?? [])];
    /** @param {string} p */
    const owner = (p) =>
      targets.filter((t) => p === t || p.startsWith(t + sep)).sort((a, b) => b.length - a.length)[0] ?? null;
    const items = [];
    for (const it of /** @type {any[]} */ (doc.items)) {
      if (it.workspace && it.workspace !== dir) continue;
      if (it.type === 'scene') {
        items.push({ seq: it.seq, at: it.at, type: 'scene', name: it.name });
        continue;
      }
      const target = it.type === 'file' ? it.path : it.folder;
      const t = typeof target === 'string' ? owner(target) : null;
      if (!t) continue;
      if (it.type === 'file') items.push({ seq: it.seq, at: it.at, type: 'file', root: rootId(t), rel: relative(t, target).split(sep).join('/') });
      else items.push({ seq: it.seq, at: it.at, type: 'folder', root: rootId(t) });
    }
    return { epoch: doc.epoch, seq: doc.seq, items };
  };

  /** Persist a request (the page may not be open, or the process may restart), then notify. */
  const pushRequest = async (/** @type {Record<string, unknown>} */ req) => {
    const seq = await serial(async () => {
      const doc = await readRequests();
      const next = doc.seq + 1;
      const items = [...doc.items, { seq: next, at: new Date().toISOString(), ...req }].slice(-MAX_REQUESTS);
      await writeJsonAtomic(requestsFile, { epoch: doc.epoch ?? randomBytes(6).toString('hex'), seq: next, items });
      return next;
    });
    broadcast({ type: 'request', seq });
    return seq;
  };

  /** Is a viewer page listening (for that workspace, when given)? */
  const viewerConnected = (/** @type {string | null} */ ws = null) =>
    ws ? [...clientDirs.values()].includes(ws) : clients.size > 0;

  /** @param {string} p */
  const folderInfo = (p) => ({ id: rootId(p), path: p, label: basename(p) });

  /** @param {string} rootPath @param {{rel: string, size: number, kind: string}[]} files */
  const modelList = (rootPath, files) =>
    files.slice(0, MCP_LIST_LIMIT).map((f) => ({ path: join(rootPath, ...f.rel.split('/')), kind: f.kind, size: f.size }));

  /** @param {string} p @param {string} dir */
  const isInside = (p, dir) => p === dir || p.startsWith(dir + sep);

  /** @param {{path: string, select?: boolean, workspace?: string}} args */
  const addModelFolder = async (args) => {
    const ws = args.workspace !== undefined ? await validateWorkspacePath(args.workspace) : null;
    // inside the caller's session folder any subfolder is fine; elsewhere the usual folder rules apply
    let real = ws ? await realDirOrNull(args.path) : null;
    if (!real || !ws || !isInside(real, ws)) real = await validateRootPath(args.path);
    if (ws) {
      await touchWorkspace(ws);
      if (!isInside(real, ws)) {
        await addRoot(real);
        await addExtra(ws, real);
      }
    } else {
      await addRoot(real);
    }
    const { files, truncated } = await listModels(real);
    if (args.select !== false) {
      await pushRequest({ type: 'folder', root: rootId(real), folder: real, ...(ws ? { workspace: ws } : {}) });
    }
    return {
      folder: folderInfo(real),
      model_count: files.length,
      truncated,
      models: modelList(real, files),
      viewer_connected: viewerConnected(ws),
    };
  };

  /** @param {{path: string, copy_to_scene?: boolean, name?: string, color?: string, opacity?: number, workspace?: string}} args */
  const addModelFile = async (args) => {
    const ws = args.workspace !== undefined ? await validateWorkspacePath(args.workspace) : null;
    const src = await validateModelPath(args.path);
    if (args.copy_to_scene) return copyToScene(src, args, ws);
    if (args.name !== undefined || args.color !== undefined || args.opacity !== undefined) {
      throw new HttpError(400, 'copy_only_option', 'name、color、opacity 只在 copy_to_scene 为 true 时可用');
    }
    if (basename(src.real).startsWith('.')) throw new HttpError(400, 'hidden_file', '不能打开隐藏文件');
    /** @type {{rootPath: string, rel: string} | null} */
    let chosen = null;
    if (ws && isInside(src.real, ws)) {
      // in the caller's session folder: the viewer lists it from there
      const rel = relative(ws, src.real).split(sep).join('/');
      if (!isListableRel(rel)) {
        throw new HttpError(422, 'not_listed', '这个文件在隐藏目录、node_modules 之类的目录里，或者层级太深，查看器不会列出它');
      }
      await touchWorkspace(ws);
      chosen = { rootPath: ws, rel };
    } else {
      if (!isAllowedRoot(dirname(src.real))) {
        throw new HttpError(
          400,
          'outside_home',
          '只能原地打开会话文件夹或用户主目录内的文件（不能直接放在主目录下，也不能在 ~/Library 或隐藏的顶层目录里）；其他位置的文件请加 copy_to_scene: true',
        );
      }
      // closest registered folder that really lists the file, else register its own folder
      const candidates = (await readRoots())
        .filter((r) => src.real.startsWith(r.path + sep))
        .sort((a, b) => b.path.length - a.path.length);
      for (const r of candidates) {
        const rel = relative(r.path, src.real).split(sep).join('/');
        if (!isListableRel(rel)) continue;
        const { files } = await listModels(r.path);
        if (files.some((f) => f.rel === rel)) {
          chosen = { rootPath: r.path, rel };
          break;
        }
      }
      if (!chosen) {
        const dir = dirname(src.real);
        const rel = basename(src.real);
        await validateRootPath(dir);
        const { files } = await listModels(dir);
        if (!files.some((f) => f.rel === rel)) {
          throw new HttpError(422, 'not_listed', '这个文件所在的文件夹模型太多，查看器列不出它');
        }
        chosen = { rootPath: dir, rel };
      }
      await addRoot(chosen.rootPath); // registers it, or marks it recently used
      if (ws) await addExtra(ws, chosen.rootPath); // shows up in that session's viewer as an extra folder
    }
    await pushRequest({
      type: 'file',
      root: rootId(chosen.rootPath),
      rel: chosen.rel,
      path: src.real,
      ...(ws ? { workspace: ws } : {}),
    });
    return {
      mode: 'reference',
      path: src.real,
      kind: src.ext === '.stl' ? 'stl' : 'step',
      size: src.stat.size,
      folder: folderInfo(chosen.rootPath),
      rel: chosen.rel,
      viewer_connected: viewerConnected(ws),
      note: '原地打开：之后重新导出这个文件，查看器会自动刷新，不用再调用。',
    };
  };

  /**
   * Copy a model file into the pushed scene, like cqview.show_file().
   * @param {{real: string, stat: import('node:fs').Stats, ext: string}} src
   * @param {{name?: string, color?: string, opacity?: number}} opts
   * @param {string | null} [ws] the caller's session folder: only that viewer opens the copy
   */
  const copyToScene = async (src, opts, ws = null) => {
    const name = opts.name ?? sceneNameFrom(src.real);
    if (!PART_NAME_RE.test(name)) throw new HttpError(400, 'invalid_name', '模型名只能用字母、数字、. _ -，且不能以 . 开头');
    if (src.stat.size === 0) throw new HttpError(422, 'empty_file', '这个文件是空的');
    if (src.stat.size > MAX_COPY_BYTES) throw new HttpError(413, 'file_too_large', '文件超过 512 MB，不能复制');
    const dst = join(SCENE_DIR, `${name}${src.ext}`);
    await serial(async () => {
      await mkdir(SCENE_DIR, { recursive: true });
      const tmp = join(SCENE_DIR, `.${name}.${process.pid}.${randomUUID()}.tmp`);
      try {
        await copyFile(src.real, tmp);
        await rename(tmp, dst);
      } finally {
        await unlink(tmp).catch(() => {});
      }
      for (const ext of MODEL_EXT) {
        if (ext !== src.ext) await unlink(join(SCENE_DIR, `${name}${ext}`)).catch(() => {});
      }
      await setSceneMeta(name, opts);
    });
    await pushRequest({ type: 'scene', name, ...(ws ? { workspace: ws } : {}) });
    return {
      mode: 'copy',
      name,
      scene_file: dst,
      source: src.real,
      kind: src.ext === '.stl' ? 'stl' : 'step',
      size: src.stat.size,
      viewer_connected: viewerConnected(ws),
      note: '这是一份副本：源文件之后的修改不会同步，需要时再调用一次。',
    };
  };

  /** Same rules as cqview.py: a push replaces the part's colour/opacity with what was given. */
  const setSceneMeta = async (/** @type {string} */ name, /** @type {{color?: string, opacity?: number}} */ opts) => {
    const file = join(SCENE_DIR, 'scene.json');
    /** @type {{parts: Record<string, unknown>}} */
    let meta = { parts: {} };
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      if (parsed && typeof parsed === 'object' && parsed.parts && typeof parsed.parts === 'object') meta = parsed;
    } catch {
      /* missing or unreadable: start fresh */
    }
    /** @type {Record<string, unknown>} */
    const entry = {};
    if (opts.color !== undefined) entry.color = opts.color.toLowerCase();
    if (opts.opacity !== undefined) entry.opacity = clamp(opts.opacity, 0.05, 1);
    const had = Object.hasOwn(meta.parts, name);
    if (!had && !Object.keys(entry).length) return;
    if (Object.keys(entry).length) meta.parts[name] = entry;
    else delete meta.parts[name];
    await writeJsonAtomic(file, meta);
  };

  /** @param {{folder?: string}} args */
  const listModelFolders = async (args) => {
    const roots = await readRoots();
    if (args.folder === undefined) {
      const folders = [];
      for (const r of roots) {
        const st = await stat(r.path).catch(() => null);
        folders.push({ ...folderInfo(r.path), exists: !!st && st.isDirectory(), last_used: r.used ?? null });
      }
      const scene = await readScene();
      return {
        folders,
        scene: {
          dir: SCENE_DIR,
          models: scene.parts.map((p) => ({ name: p.name, path: join(SCENE_DIR, p.file), kind: p.kind, size: p.size })),
        },
        viewer_connected: viewerConnected(),
      };
    }
    const folders = await allFolders();
    let rootPath = ROOT_ID_RE.test(args.folder) ? folders.find((p) => rootId(p) === args.folder) : undefined;
    if (!rootPath) {
      let p = args.folder.trim();
      if (p === '~' || p.startsWith('~/')) p = join(HOME, p.slice(1));
      const real = isAbsolute(p) ? await realpath(p).catch(() => null) : null;
      rootPath = real ? folders.find((f) => f === real) : undefined;
    }
    if (!rootPath) throw new HttpError(404, 'root_not_registered', '这个文件夹还没有登记，先调用 add_model_folder');
    const root = { path: rootPath };
    const st = await stat(root.path).catch(() => null);
    if (!st || !st.isDirectory()) throw new HttpError(404, 'root_missing', '文件夹已不存在');
    const { files, truncated } = await listModels(root.path);
    return {
      folder: folderInfo(root.path),
      model_count: files.length,
      truncated,
      models: modelList(root.path, files),
      viewer_connected: viewerConnected(),
    };
  };

  const handleMcp = createMcpHandler({
    addModelFolder,
    addModelFile,
    listModelFolders,
    log: (message) => log.info(message),
  });

  // ---------- domain: white-model renders (background Agent turns) ----------
  const renders = createRenderService({
    agent: context.agent,
    dataDir: context.dataDir,
    broadcast,
    serial,
    writeJsonAtomic,
    HttpError,
    log: { info: (m) => log.info(m), warn: (m) => log.warn(m) },
  });

  /** @param {string} file @param {import('node:fs').Stats} st @returns {Promise<{path: string, type: 'cqvm'|'stl'}>} */
  const stepToMesh = async (file, st) => {
    if (disposed) throw new HttpError(503, 'shutting_down', '查看器正在关闭');
    const key = createHash('sha1').update(`${STEP_MESH_VERSION}|${file}|${st.size}|${st.mtimeMs}`).digest('hex');
    const outMesh = join(stepCacheDir, `${key}.cqvm`);
    const outStl = join(stepCacheDir, `${key}.stl`);
    for (const [path, type] of /** @type {const} */ ([[outMesh, 'cqvm'], [outStl, 'stl']])) {
      try {
        await access(path);
        const now = new Date();
        await utimes(path, now, now).catch(() => {}); // last use, for pruning
        return { path, type };
      } catch {
        /* not cached yet */
      }
    }
    const running = stepJobs.get(key);
    if (running) return running;
    const job = (async () => {
      const python = await findPython();
      if (!python) {
        if (disposed) throw new HttpError(503, 'shutting_down', '查看器正在关闭');
        throw new HttpError(503, 'step_unavailable', '打开 STEP 需要本机的 Python 和 CadQuery');
      }
      await mkdir(stepCacheDir, { recursive: true });
      pruneOnce();
      // 1) full fidelity: assembly names, colours, real edges
      const tmpMesh = `${outMesh}.${process.pid}.tmp`;
      try {
        await runChild(python, [join(context.pluginRoot, 'miniapp', 'node', 'step_mesh.py'), file, tmpMesh], STEP_TIMEOUT_MS);
        await rename(tmpMesh, outMesh);
        return { path: outMesh, type: /** @type {const} */ ('cqvm') };
      } catch (error) {
        await unlink(tmpMesh).catch(() => {});
        const code = /** @type {any} */ (error).code;
        if (code === 'exit_3' || code === 'exit_4') {
          throw new HttpError(422, 'step_convert_failed', code === 'exit_3' ? '这个 STEP 文件读不出来，可能已损坏' : '这个 STEP 文件里没有实体');
        }
        // Stopped on purpose (shutdown, time limit) or killed outright: running the fallback would
        // only start another Python nobody waits for. A native crash (SIGSEGV, SIGABRT …) is what
        // the simpler fallback is for, so that one still falls through.
        if (code === 'disposed') throw new HttpError(503, 'shutting_down', '查看器正在关闭');
        if (code === 'timeout') {
          throw new HttpError(422, 'step_convert_failed', 'STEP 转换超过 5 分钟，已停止；文件可能太大或太复杂');
        }
        if (code === 'signal_SIGKILL' || code === 'signal_SIGTERM') {
          throw new HttpError(422, 'step_convert_failed', 'STEP 转换进程被系统结束了，可能是内存不足');
        }
        log.warn(`cqviewer.step.mesh_failed ${code ?? 'unknown'}`, { code: code ?? 'unknown' });
      }
      // 2) fallback: single merged mesh
      const tmpStl = `${outStl}.${process.pid}.tmp`;
      try {
        await runChild(python, ['-c', STEP_TO_STL_PY, file, tmpStl], STEP_TIMEOUT_MS);
        await rename(tmpStl, outStl);
        return { path: outStl, type: /** @type {const} */ ('stl') };
      } catch (error) {
        await unlink(tmpStl).catch(() => {});
        const code = /** @type {any} */ (error).code;
        if (code === 'disposed') throw new HttpError(503, 'shutting_down', '查看器正在关闭');
        log.warn(`cqviewer.step.convert_failed ${code ?? 'unknown'}`, { code: code ?? 'unknown' });
        throw new HttpError(422, 'step_convert_failed', 'STEP 没有打开成功，文件可能已损坏或不含实体');
      }
    })().finally(() => stepJobs.delete(key));
    stepJobs.set(key, job);
    return job;
  };

  /** Drop cache entries unused for STEP_CACHE_MAX_AGE_MS, then the oldest until under STEP_CACHE_MAX_BYTES. */
  let pruned = false;
  const pruneOnce = () => {
    if (pruned) return;
    pruned = true;
    void pruneStepCache(stepCacheDir).catch((error) =>
      log.warn(`cqviewer.step.prune_failed ${error?.code ?? 'unknown'}`, { code: error?.code ?? 'unknown' }),
    );
  };

  /** Stream a model file, converting STEP on the way. */
  const serveModel = async (response, full, st, kind) => {
    if (kind === 'stl') return streamFile(response, full, st.size, 'model/stl');
    const converted = await stepToMesh(full, st);
    const cst = await stat(converted.path);
    return streamFile(response, converted.path, cst.size, converted.type === 'cqvm' ? CQVM_TYPE : 'model/stl');
  };

  /** @returns {Promise<string|null>} */
  const findPython = () => {
    if (!pythonProbe) {
      pythonProbe = (async () => {
        const candidates = [
          process.env.CQVIEW_PYTHON,
          'python3',
          'python', // Windows installs usually only provide this name
          '/usr/bin/python3',
          '/opt/homebrew/bin/python3',
          '/usr/local/bin/python3',
        ].filter((c) => typeof c === 'string' && c.length > 0);
        for (const c of /** @type {string[]} */ (candidates)) {
          if (disposed) return null;
          try {
            await runChild(c, ['-c', 'import cadquery'], PY_PROBE_TIMEOUT_MS);
            return c;
          } catch {
            /* try next */
          }
        }
        return null;
      })().then((found) => {
        if (!found) pythonProbe = null; // retry next time (e.g. after installing cadquery)
        return found;
      });
    }
    return pythonProbe;
  };

  /**
   * Rejects with code 'disposed' once dispose() has run (and when dispose kills the child),
   * 'timeout' when the time limit kills it, 'signal_<SIG>' / 'exit_<n>' otherwise.
   * @param {string} cmd @param {string[]} args @param {number} timeoutMs
   */
  const runChild = (cmd, args, timeoutMs) =>
    new Promise((resolve, reject) => {
      if (disposed) {
        reject(Object.assign(new Error('disposed'), { code: 'disposed' }));
        return;
      }
      // stdout is reserved for the Host protocol: never inherit it.
      const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'ignore'], env: process.env });
      children.add(child);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);
      child.on('error', (error) => {
        clearTimeout(timer);
        children.delete(child);
        reject(error);
      });
      child.on('exit', (code, signal) => {
        clearTimeout(timer);
        children.delete(child);
        if (code === 0) resolve(undefined);
        else {
          const why = disposed ? 'disposed' : timedOut ? 'timeout' : signal ? `signal_${signal}` : `exit_${code}`;
          reject(Object.assign(new Error('child failed'), { code: why }));
        }
      });
    });

  // ---------- domain: selection ----------
  // One annotation file per session folder (~/.cqview/selections/<folder id>.json). Every write is
  // also mirrored to ~/.cqview/selection.json, the last-written file cqview.selection() reads.
  /** @param {string | null} folder @returns {string} */
  const selectionFileFor = (folder) => (folder ? join(SELECTIONS_DIR, `${folder}.json`) : SELECTION_FILE);
  /** @param {unknown} folder @returns {Promise<string | null>} */
  const checkSelectionFolder = async (folder) => {
    if (folder === undefined || folder === null || folder === '') return null;
    if (typeof folder !== 'string' || !ROOT_ID_RE.test(folder) || !(await findFolder(folder))) {
      throw new HttpError(400, 'invalid_folder', '这个文件夹还没有登记');
    }
    return folder;
  };
  const readSelection = async (/** @type {string | null} */ folder = null) => {
    try {
      return JSON.parse(await readFile(selectionFileFor(folder), 'utf8'));
    } catch {
      return { points: [] };
    }
  };

  /** @param {unknown} body */
  const writeSelection = async (body) => {
    const folder = await checkSelectionFolder(/** @type {any} */ (body)?.folder);
    const raw = validateSelection(body);
    const points = [];
    for (const p of raw) {
      const { ref, ...rest } = p;
      const file = await resolveRef(ref);
      // keep the ref only when it resolves to a real file the viewer may read
      points.push(file ? { ...rest, ref, file } : rest);
    }
    /** @type {Record<string, unknown>} */
    const doc = { updated: new Date().toISOString(), unit: 'mm', count: points.length, points };
    const instruction = /** @type {any} */ (body).instruction;
    if (typeof instruction === 'string') {
      const text = instruction.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, 2000);
      if (text) doc.instruction = text;
    }
    if (points.length >= 2) {
      doc.segments = points.slice(1).map((b, i) => {
        const a = points[i];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        return { from: a.index, to: b.index, d: round(Math.hypot(dx, dy, dz)), dx: round(dx), dy: round(dy), dz: round(dz) };
      });
    }
    if (points.length === 2) {
      const { d, dx, dy, dz } = /** @type {any[]} */ (doc.segments)[0];
      doc.distance = { d, dx, dy, dz };
    }
    await serial(async () => {
      // commit first …
      if (folder) await writeJsonAtomic(selectionFileFor(folder), doc);
      await writeJsonAtomic(SELECTION_FILE, folder ? { ...doc, folder } : doc);
    });
    const client = /** @type {any} */ (body).client;
    broadcast({ type: 'selection', folder, client: typeof client === 'string' && CLIENT_ID_RE.test(client) ? client : null }); // … then notify
    return doc;
  };

  /** @param {unknown} ref */
  const resolveRef = async (ref) => {
    if (!ref || typeof ref !== 'object') return null;
    const r = /** @type {Record<string, unknown>} */ (ref);
    if (r.source === 'scene' && typeof r.name === 'string' && PART_NAME_RE.test(r.name)) {
      for (const ext of ['.stl', '.step', '.stp']) {
        const candidate = join(SCENE_DIR, `${r.name}${ext}`);
        const st = await lstat(candidate).catch(() => null);
        if (st && st.isFile()) return candidate;
      }
      return null;
    }
    if (r.source === 'file' && typeof r.root === 'string' && typeof r.rel === 'string') {
      const rootPath = await findFolder(r.root);
      if (!rootPath) return null;
      try {
        return (await resolveModel(rootPath, r.rel)).full;
      } catch {
        return null;
      }
    }
    return null;
  };

  // ---------- HTTP ----------
  const server = createServer((request, response) => {
    handle(request, response).catch((error) => {
      if (error instanceof HttpError) {
        if (!response.headersSent) sendJson(response, error.status, { error: error.code, message: error.userMessage });
        else response.end();
        return;
      }
      log.error('cqviewer.request.failed', { code: error?.code ?? 'unknown' });
      if (!response.headersSent) sendJson(response, 500, { error: 'internal_error' });
      else response.end();
    });
  });

  /**
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:http').ServerResponse} response
   */
  async function handle(request, response) {
    const url = new URL(request.url ?? '/', 'http://miniapp.local');
    const path = url.pathname;
    const method = request.method ?? 'GET';

    // Every route: the Host header must name this machine (a DNS-rebound hostname is refused) and a
    // browser Origin, when sent, must be this listener itself. The page is same-origin; the Host's
    // MCP client is a Node process and sends no Origin.
    if (!isLoopbackRequest(request, context.listen.port)) return sendJson(response, 403, { error: 'forbidden' });

    // MCP: the Host's MCP client calls this over loopback.
    if (path === MCP_PATH) {
      if (method !== 'POST') {
        response.writeHead(405, { allow: 'POST', 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'method_not_allowed' }));
        return;
      }
      const body = await readJsonBody(request);
      const reply = await handleMcp(body);
      if (reply === null) {
        response.writeHead(202);
        response.end();
        return;
      }
      return sendJson(response, 200, reply);
    }

    if (method === 'GET' && path === BASE) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      response.end(indexHtml);
      return;
    }
    if (method === 'GET' && path === `${BASE}/`) {
      response.writeHead(302, { location: `${BASE}${url.search}` });
      response.end();
      return;
    }
    if (method === 'GET' && path.startsWith(`${BASE}/assets/`)) {
      const rel = path.slice(`${BASE}/assets/`.length);
      const type = Object.prototype.hasOwnProperty.call(ASSETS, rel) ? ASSETS[rel] : undefined;
      if (!type) return sendJson(response, 404, { error: 'not_found' });
      const body = await readFile(join(clientRoot, 'assets', ...rel.split('/')));
      response.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
      response.end(body);
      return;
    }

    // pushed scene
    if (method === 'GET' && path === `${BASE}/api/scene`) return sendJson(response, 200, await readScene());
    if (method === 'GET' && path.startsWith(`${BASE}/api/part/`)) {
      let file = '';
      try {
        file = decodeURIComponent(path.slice(`${BASE}/api/part/`.length));
      } catch {
        throw new HttpError(400, 'invalid_part_name');
      }
      if (!PART_FILE_RE.test(file)) throw new HttpError(400, 'invalid_part_name');
      const full = join(SCENE_DIR, file);
      const st = await lstat(full).catch(() => null);
      if (!st || !st.isFile()) throw new HttpError(404, 'part_not_found', '文件已不存在');
      return serveModel(response, full, st, extname(file).toLowerCase() === '.stl' ? 'stl' : 'step');
    }

    // session folder (the chat's folder, from the page) and the extra folders added to it
    if (method === 'POST' && path === `${BASE}/api/workspace`) {
      const body = /** @type {any} */ (await readJsonBody(request));
      const dir = await validateWorkspacePath(body?.dir);
      await touchWorkspace(dir);
      return sendJson(response, 200, await describeWorkspace(dir));
    }
    if (method === 'POST' && path === `${BASE}/api/workspace/folders`) {
      const body = /** @type {any} */ (await readJsonBody(request));
      const dir = await validateWorkspacePath(body?.dir);
      if (body?.remove !== undefined) {
        if (typeof body.remove !== 'string' || !ROOT_ID_RE.test(body.remove)) throw new HttpError(400, 'invalid_folder');
        await removeExtra(dir, body.remove);
      } else {
        const real = await validateRootPath(body?.path);
        if (real === dir) throw new HttpError(400, 'invalid_root', '这就是会话文件夹，已经在列表里了');
        await addRoot(real);
        await addExtra(dir, real);
      }
      return sendJson(response, 200, await describeWorkspace(dir));
    }

    // registered folders
    if (method === 'GET' && path === `${BASE}/api/roots`) {
      const roots = await readRoots();
      return sendJson(response, 200, { roots: roots.map((r) => describeRoot(r.path)) });
    }
    if (method === 'POST' && path === `${BASE}/api/roots`) {
      const body = await readJsonBody(request);
      const root = await addRoot(/** @type {any} */ (body)?.path);
      return sendJson(response, 200, { root });
    }
    if (method === 'GET' && path === `${BASE}/api/files`) {
      const root = await requireFolder(url.searchParams.get('root'));
      const st = await stat(root.path).catch(() => null);
      if (!st || !st.isDirectory()) throw new HttpError(404, 'root_missing', '文件夹已不存在');
      const { files, truncated } = await listModels(root.path);
      return sendJson(response, 200, { root: describeRoot(root.path), files, truncated });
    }
    if (method === 'GET' && path === `${BASE}/api/file`) {
      const root = await requireFolder(url.searchParams.get('root'));
      const model = await resolveModel(root.path, url.searchParams.get('rel'));
      return serveModel(response, model.full, model.stat, model.kind);
    }

    // selection (per session folder with ?folder=<id>)
    if (method === 'GET' && path === `${BASE}/api/selection`) {
      const folder = await checkSelectionFolder(url.searchParams.get('folder'));
      return sendJson(response, 200, await readSelection(folder));
    }
    if (method === 'POST' && path === `${BASE}/api/selection`) {
      const body = await readJsonBody(request);
      return sendJson(response, 200, await writeSelection(body));
    }

    // what the AI asked the page to open (?dir=<session folder>: only that workspace's, pointed at its folders)
    if (method === 'GET' && path === `${BASE}/api/requests`) {
      const dir = url.searchParams.get('dir');
      if (dir === null) return sendJson(response, 200, await readRequests());
      return sendJson(response, 200, await requestsFor(await validateWorkspacePath(dir)));
    }

    // white-model renders (?folder=<id>: that session folder's)
    if (path === `${BASE}/api/renders`) {
      if (method === 'GET') {
        const folder = url.searchParams.get('folder');
        return sendJson(response, 200, await renders.list(folder && ROOT_ID_RE.test(folder) ? folder : null));
      }
      if (method === 'POST') {
        const body = await readJsonBody(request, RENDER_BODY_BYTES);
        return sendJson(response, 202, { job: await renders.create(body) });
      }
      return sendJson(response, 405, { error: 'method_not_allowed' });
    }
    if (path.startsWith(`${BASE}/api/renders/`)) {
      const [id, action = '', ...rest] = path.slice(`${BASE}/api/renders/`.length).split('/');
      if (!JOB_ID_RE.test(id) || rest.length) return sendJson(response, 404, { error: 'not_found' });
      if (method === 'GET' && (action === 'input' || action === 'output')) {
        const img = await renders.file(id, action);
        const disposition = url.searchParams.get('download') === '1' ? `attachment; filename="${img.name}"` : undefined;
        return streamFile(response, img.path, img.size, img.type, disposition);
      }
      if (method === 'DELETE' && action === '') {
        await renders.remove(id);
        return sendJson(response, 200, { ok: true });
      }
      if (method === 'POST' && (action === 'cancel' || action === 'retry' || action === 'permission')) {
        const body = await readJsonBody(request);
        if (action === 'cancel') return sendJson(response, 200, { job: await renders.cancel(id) });
        if (action === 'retry') return sendJson(response, 202, { job: await renders.retry(id) });
        return sendJson(response, 200, { job: await renders.reply(id, body) });
      }
      return sendJson(response, 404, { error: 'not_found' });
    }

    // live updates
    if (method === 'GET' && path === `${BASE}/api/events`) {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      response.write('retry: 2000\n\n');
      clients.add(response);
      response.on('close', () => {
        clients.delete(response);
        if (clientDirs.delete(response)) void syncRootWatchers().catch(() => {});
      });
      try {
        const dir = url.searchParams.get('dir');
        if (dir !== null) clientDirs.set(response, await validateWorkspacePath(dir));
      } catch {
        /* not a usable session folder: this page gets no folder updates */
      }
      try {
        await ensureSceneWatcher();
        await syncRootWatchers();
        response.write(`data: ${JSON.stringify({ type: 'hello', version: sceneVersion })}\n\n`);
      } catch {
        response.write(`data: ${JSON.stringify({ type: 'watch-lost' })}\n\n`);
      }
      return;
    }
    sendJson(response, 404, { error: 'not_found' });
  }

  await listen(server, context.listen.host, context.listen.port);
  log.info('cqviewer.runtime.listening');

  const dispose = async () => {
    if (disposed) return;
    disposed = true; // runChild refuses from here on, so no fallback can start after this
    context.signal.removeEventListener('abort', onAbort);
    renders.dispose(); // aborts running Agent turns; the next start reports them as interrupted
    clearInterval(heartbeat);
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    sceneWatcher?.close();
    sceneWatcher = null;
    for (const w of rootWatchers.values()) w.close();
    rootWatchers.clear();
    for (const c of children) c.kill('SIGKILL');
    children.clear();
    for (const res of clients) res.end();
    clients.clear();
    clientDirs.clear();
    server.closeAllConnections?.();
    await close(server);
    await writeChain; // let a write already in progress finish its rename
  };
  const onAbort = () => {
    void dispose();
  };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  return { dispose };
}

// ---------------------------------------------------------------- folders

/** @param {string} p */
function rootId(p) {
  return createHash('sha1').update(p).digest('hex').slice(0, 10);
}

/** @param {string} p */
function displayPath(p) {
  if (p === HOME) return '~';
  return p.startsWith(HOME + sep) ? `~${p.slice(HOME.length)}` : p;
}

/** @param {string} p */
function describeRoot(p) {
  return { id: rootId(p), label: basename(p), display: displayPath(p) };
}

/** @returns {Promise<{path: string, used?: string}[]>} */
async function readRoots() {
  try {
    const parsed = JSON.parse(await readFile(ROOTS_FILE, 'utf8'));
    if (parsed && Array.isArray(parsed.roots)) {
      return parsed.roots.filter(
        (/** @type {any} */ r) => r && typeof r.path === 'string' && isAbsolute(r.path) && isAllowedRoot(r.path),
      );
    }
  } catch {
    /* no registry yet */
  }
  return [];
}

/**
 * A session folder (the chat's folder) may be anywhere, hidden folders included, except the home
 * directory itself or a filesystem root: both are too large to scan.
 * @param {string} p
 */
function isAllowedWorkspace(p) {
  return isAbsolute(p) && p !== HOME && dirname(p) !== p;
}

/** @param {unknown} input */
async function validateWorkspacePath(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > 1024 || input.includes('\0')) {
    throw new HttpError(400, 'invalid_workspace', '会话文件夹路径无效');
  }
  const real = await realDirOrNull(input);
  if (!real) throw new HttpError(400, 'invalid_workspace', '会话文件夹不存在');
  if (!isAllowedWorkspace(real)) throw new HttpError(400, 'invalid_workspace', '会话文件夹是用户主目录或磁盘根目录，范围太大，查看器不扫描');
  return real;
}

/** Absolute (or ~/) path to an existing directory, symlinks resolved; null otherwise. @param {unknown} input */
async function realDirOrNull(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > 1024 || input.includes('\0')) return null;
  let p = input.trim();
  if (p === '~' || p.startsWith('~/')) p = join(HOME, p.slice(1));
  if (!isAbsolute(p)) return null;
  const real = await realpath(p).catch(() => null);
  if (!real) return null;
  const st = await stat(real).catch(() => null);
  return st && st.isDirectory() ? real : null;
}

/** Folders must live under the home directory, not be home itself, not hidden/Library at the top level. */
function isAllowedRoot(/** @type {string} */ p) {
  if (!p.startsWith(HOME + sep)) return false;
  const first = p.slice(HOME.length + 1).split(sep)[0];
  return !!first && !first.startsWith('.') && first !== 'Library';
}

/** @param {unknown} input */
async function validateRootPath(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > 1024 || input.includes('\0')) {
    throw new HttpError(400, 'invalid_root', '请输入文件夹路径');
  }
  let p = input.trim();
  if (p === '~' || p.startsWith('~/')) p = join(HOME, p.slice(1));
  if (!isAbsolute(p)) throw new HttpError(400, 'invalid_root', '请输入绝对路径（可用 ~/ 开头）');
  let real;
  try {
    real = await realpath(p);
  } catch {
    throw new HttpError(400, 'invalid_root', '文件夹不存在');
  }
  const st = await stat(real);
  if (!st.isDirectory()) throw new HttpError(400, 'invalid_root', '这不是文件夹');
  if (!isAllowedRoot(real)) throw new HttpError(400, 'invalid_root', '只能添加用户目录下的项目文件夹');
  return real;
}

/** @param {string} rootPath */
async function listModels(rootPath) {
  /** @type {{rel: string, size: number, mtime: number, kind: 'stl'|'step'}[]} */
  const files = [];
  let scanned = 0;
  let truncated = false;
  /** @param {string} dir @param {number} depth */
  const walk = async (dir, depth) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of entries) {
      if (truncated) return;
      if (++scanned > WALK_MAX_ENTRIES || files.length >= WALK_MAX_FILES) {
        truncated = true;
        return;
      }
      if (d.name.startsWith('.')) continue;
      const full = join(dir, d.name);
      if (d.isDirectory()) {
        if (!SKIP_DIRS.has(d.name) && depth < WALK_MAX_DEPTH) await walk(full, depth + 1);
      } else if (d.isFile()) {
        const ext = extname(d.name).toLowerCase();
        if (!MODEL_EXT.has(ext)) continue;
        const st = await lstat(full).catch(() => null);
        if (!st) continue;
        files.push({
          rel: relative(rootPath, full).split(sep).join('/'),
          size: st.size,
          mtime: Math.round(st.mtimeMs),
          kind: ext === '.stl' ? 'stl' : 'step',
        });
      }
    }
  };
  await walk(rootPath, 0);
  files.sort((a, b) => a.rel.localeCompare(b.rel, 'zh-CN'));
  return { files, truncated };
}

/** @param {string} rootPath @param {unknown} rel */
async function resolveModel(rootPath, rel) {
  const bad = () => new HttpError(400, 'invalid_file', '文件路径无效');
  if (typeof rel !== 'string' || !rel || rel.length > 1024 || rel.includes('\0') || rel.includes('\\')) throw bad();
  const segs = rel.split('/');
  if (segs.some((s) => s === '' || s === '.' || s === '..' || s.startsWith('.'))) throw bad();
  const ext = extname(rel).toLowerCase();
  if (!MODEL_EXT.has(ext)) throw bad();
  const full = join(rootPath, ...segs);
  let real;
  try {
    real = await realpath(full);
  } catch {
    throw new HttpError(404, 'file_not_found', '文件已不存在');
  }
  if (real !== full) throw bad(); // symlink somewhere on the path
  const st = await lstat(full);
  if (!st.isFile()) throw bad();
  return { full, stat: st, kind: /** @type {'stl'|'step'} */ (ext === '.stl' ? 'stl' : 'step') };
}

/**
 * A model file named by the AI: absolute (or ~/), an allowed extension, a regular file.
 * Symbolic links are resolved; every later rule applies to the real path.
 * @param {unknown} input
 */
async function validateModelPath(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > 1024 || input.includes('\0')) {
    throw new HttpError(400, 'invalid_path', '请提供模型文件的绝对路径');
  }
  let p = input.trim();
  if (p === '~' || p.startsWith('~/')) p = join(HOME, p.slice(1));
  if (!isAbsolute(p)) throw new HttpError(400, 'invalid_path', '请提供绝对路径（可用 ~/ 开头）');
  if (!MODEL_EXT.has(extname(p).toLowerCase())) throw new HttpError(400, 'unsupported_type', '只支持 .stl、.step、.stp 文件');
  let real;
  try {
    real = await realpath(p);
  } catch {
    throw new HttpError(404, 'file_not_found', '文件不存在');
  }
  const ext = extname(real).toLowerCase();
  if (!MODEL_EXT.has(ext)) throw new HttpError(400, 'unsupported_type', '只支持 .stl、.step、.stp 文件');
  const st = await stat(real);
  if (!st.isFile()) throw new HttpError(400, 'not_a_file', '这不是文件');
  return { real, stat: st, ext };
}

/** Would listModels() list this path, relative to its folder? */
function isListableRel(/** @type {string} */ rel) {
  const segs = rel.split('/');
  if (segs.length - 1 > WALK_MAX_DEPTH) return false;
  return segs.every((s, i) => !!s && !s.startsWith('.') && (i === segs.length - 1 || !SKIP_DIRS.has(s)));
}

/** Scene name from a file name, like cqview.show_file(). */
function sceneNameFrom(/** @type {string} */ file) {
  const stem = basename(file, extname(file))
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 100);
  return stem || 'model';
}

/**
 * Host must be loopback (blocks DNS rebinding). Origin, when a browser sends one, must be this
 * listener: loopback host and our port. The Host's MCP client is a Node process and sends no Origin.
 * @param {import('node:http').IncomingMessage} request
 * @param {number} port
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
    return false; // includes "null" (sandboxed iframes, file://)
  }
  const originPort = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(hostnameOf(url.host)) && originPort === port;
}

/** @param {string} hostHeader */
function hostnameOf(hostHeader) {
  const h = hostHeader.trim().toLowerCase();
  const bracketed = /^\[([^\]]*)\]/.exec(h);
  if (bracketed) return bracketed[1];
  const colon = h.lastIndexOf(':');
  return colon === -1 ? h : h.slice(0, colon);
}

// ---------------------------------------------------------------- helpers

/** @param {unknown} raw */
function sanitizeMeta(raw) {
  /** @type {{color?: string, opacity?: number, edges?: boolean}} */
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  const m = /** @type {Record<string, unknown>} */ (raw);
  if (typeof m.color === 'string' && COLOR_RE.test(m.color)) out.color = m.color.toLowerCase();
  if (typeof m.opacity === 'number' && Number.isFinite(m.opacity)) out.opacity = clamp(m.opacity, 0.05, 1);
  if (typeof m.edges === 'boolean') out.edges = m.edges;
  return out;
}

/** @param {unknown} body */
function validateSelection(body) {
  const fail = () => new HttpError(400, 'invalid_selection');
  if (!body || typeof body !== 'object') throw fail();
  const pts = /** @type {any} */ (body).points;
  if (!Array.isArray(pts) || pts.length > MAX_POINTS) throw fail();
  return pts.map((p, i) => {
    if (!p || typeof p !== 'object') throw fail();
    const x = num(p.x);
    const y = num(p.y);
    const z = num(p.z);
    if (x === null || y === null || z === null) throw fail();
    const part =
      typeof p.part === 'string' && p.part.length <= 200 && !/[\u0000-\u001f]/.test(p.part) ? p.part : null;
    /** @type {{index: number, label: string, part: string|null, x: number, y: number, z: number, normal?: {x:number,y:number,z:number}, note?: string, ref?: unknown}} */
    const point = { index: i + 1, label: `#${i + 1}`, part, x: round(x), y: round(y), z: round(z) };
    if (typeof p.body === 'string' && p.body.length <= 300 && !/[\u0000-\u001f]/.test(p.body)) {
      /** @type {any} */ (point).body = p.body; // part inside a STEP assembly, e.g. "总成/pins/pin_right"
    }
    if (p.normal && typeof p.normal === 'object') {
      const nx = num(p.normal.x);
      const ny = num(p.normal.y);
      const nz = num(p.normal.z);
      if (nx !== null && ny !== null && nz !== null) point.normal = { x: round(nx, 4), y: round(ny, 4), z: round(nz, 4) };
    }
    if (typeof p.note === 'string') {
      // free text for the AI: keep newlines/tabs, drop other control characters
      const note = p.note.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, MAX_NOTE_CHARS);
      if (note) point.note = note;
    }
    if (p.ref && typeof p.ref === 'object') {
      const r = p.ref;
      if (r.source === 'scene' && typeof r.name === 'string' && PART_NAME_RE.test(r.name)) {
        point.ref = { source: 'scene', name: r.name };
      } else if (
        r.source === 'file' &&
        typeof r.root === 'string' &&
        ROOT_ID_RE.test(r.root) &&
        typeof r.rel === 'string' &&
        r.rel.length <= 1024 &&
        !/[\u0000-\u001f\\]/.test(r.rel)
      ) {
        point.ref = { source: 'file', root: r.root, rel: r.rel };
      }
    }
    return point;
  });
}

/** @param {unknown} v */
function num(v) {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e7 ? v : null;
}

/** @param {number} v @param {number} [digits] */
function round(v, digits = 3) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/** @param {number} v @param {number} lo @param {number} hi */
function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Temp file in the same folder, then rename. The random suffix keeps two writes in the same
 * millisecond apart; callers that read-modify-write go through serial(). The file keeps its mode.
 * @param {string} file @param {unknown} data
 */
async function writeJsonAtomic(file, data) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    const prev = await stat(file).catch(() => null);
    if (prev) await chmod(tmp, prev.mode & 0o777);
    await rename(tmp, file);
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

/**
 * Remove step-cache entries not used for STEP_CACHE_MAX_AGE_MS (a cache hit refreshes the
 * modification time), then the least recently used until the folder is under STEP_CACHE_MAX_BYTES.
 * Also clears temp files left by a crash. Only touches the files this Mini App writes there.
 * @param {string} dir
 */
async function pruneStepCache(dir) {
  const now = Date.now();
  /** @type {{path: string, size: number, mtime: number}[]} */
  const kept = [];
  for (const name of await readdir(dir)) {
    if (!/^[a-f0-9]{40}\.(cqvm|stl)(\.\d+\.tmp)?$/.test(name)) continue;
    const path = join(dir, name);
    const st = await lstat(path).catch(() => null);
    if (!st || !st.isFile()) continue;
    const age = now - st.mtimeMs;
    if (name.endsWith('.tmp') ? age > STEP_TMP_MAX_AGE_MS : age > STEP_CACHE_MAX_AGE_MS) {
      await unlink(path).catch(() => {});
    } else if (!name.endsWith('.tmp')) {
      kept.push({ path, size: st.size, mtime: st.mtimeMs });
    }
  }
  let total = kept.reduce((sum, f) => sum + f.size, 0);
  kept.sort((a, b) => a.mtime - b.mtime);
  for (const f of kept) {
    if (total <= STEP_CACHE_MAX_BYTES) break;
    await unlink(f.path).catch(() => {});
    total -= f.size;
  }
}

/**
 * JSON-only bodies: a cross-site page cannot send application/json without a CORS preflight,
 * which this server never grants.
 * @param {import('node:http').IncomingMessage} request
 * @param {number} [maxBytes]
 */
async function readJsonBody(request, maxBytes = MAX_BODY_BYTES) {
  const type = String(request.headers['content-type'] || '').toLowerCase();
  if (!type.startsWith('application/json')) {
    request.resume();
    throw new HttpError(415, 'json_required');
  }
  const text = await new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    /** @type {Buffer[]} */
    const chunks = [];
    request.on('data', (chunk) => {
      if (tooLarge) return; // keep draining so the error response can still be delivered
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        reject(new HttpError(413, 'body_too_large'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (!tooLarge) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', reject);
  });
  try {
    return JSON.parse(/** @type {string} */ (text));
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

/**
 * @param {import('node:http').ServerResponse} response
 * @param {string} file
 * @param {number} size
 * @param {string} type
 * @param {string} [disposition]
 */
function streamFile(response, file, size, type, disposition) {
  response.writeHead(200, {
    'content-type': type,
    'content-length': String(size),
    'cache-control': 'no-store',
    ...(disposition ? { 'content-disposition': disposition } : {}),
  });
  const stream = createReadStream(file);
  stream.on('error', () => response.destroy());
  stream.pipe(response);
}

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {unknown} payload
 */
function sendJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(payload));
}

/** @param {import('node:http').Server} server @param {string} host @param {number} port */
function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    /** @param {Error} error */
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve(undefined);
    });
  });
}

/** @param {import('node:http').Server} server */
function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve(undefined)));
  });
}
