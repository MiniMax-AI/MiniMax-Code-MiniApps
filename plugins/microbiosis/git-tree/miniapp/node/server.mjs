// @ts-check

import { execFile } from 'node:child_process';
import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import {
  layoutGitGraphDetailed,
  DEFAULT_LANE_GAP,
  DEFAULT_LANE_PADDING,
  DEFAULT_ROW_HEIGHT,
} from './git-graph.mjs';

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */
/** @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle */

const SURFACE_PATH = '/git-tree';
const API_ROOT = '/api/git-tree';
const ROW_HEIGHT = DEFAULT_ROW_HEIGHT;
const LANE_SPACING = DEFAULT_LANE_GAP;
const GRAPH_PADDING = DEFAULT_LANE_PADDING;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 400;
// Per-command git timeout budgets. Tight, quick reads should fail fast so a
// hung background process does not stall the whole overview response.
const GIT_TIMEOUT_QUICK_MS = 10_000;   // for-each-ref, tag --list, contains checks
const GIT_TIMEOUT_MEDIUM_MS = 15_000;  // log -n 1, status --porcelain, git show (single commit)
const GIT_TIMEOUT_HEAVY_MS = 30_000;   // log --topo-order --all, rev-list --all --count
const MAX_BUFFER = 64 * 1024 * 1024;
const DISCOVERY_TTL_MS = 60_000;
const OVERVIEW_TTL_MS = 30_000;
const COMMIT_TTL_MS = 60_000;
const GZIP_MIN_BYTES = 256;
const REF_PATTERN = /^(?!-)[A-Za-z0-9._/+^-]{1,200}$/;
const SHA_PATTERN = /^[0-9a-fA-F]{4,64}$/;

/**
 * @typedef {object} GitResult
 * @property {boolean} ok
 * @property {string} stdout
 * @property {string} stderr
 * @property {number} code
 */

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {number} [timeoutMs]
 * @returns {Promise<GitResult>}
 */
function runGit(cwd, args, timeoutMs = GIT_TIMEOUT_HEAVY_MS) {
  return new Promise((resolvePromise) => {
    execFile(
      'git',
      args,
      { cwd, windowsHide: true, maxBuffer: MAX_BUFFER, timeout: timeoutMs, encoding: 'utf8' },
      (error, stdout, stderr) => {
        const code = typeof error?.code === 'number' ? error.code : error ? 1 : 0;
        resolvePromise({
          ok: !error,
          stdout: typeof stdout === 'string' ? stdout : '',
          stderr: typeof stderr === 'string' ? stderr : '',
          code,
        });
      },
    );
  });
}

/** @param {string} target */
async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Walk up from `start` until a directory containing `.git` is found.
 * @param {string} start
 * @returns {Promise<string | null>}
 */
async function findRepoRoot(start) {
  let current = resolve(start);
  for (let depth = 0; depth < 5; depth += 1) {
    if (await pathExists(join(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/**
 * @typedef {object} RepoEntry
 * @property {string} path
 * @property {string} label
 * @property {boolean} isDefault
 */

/**
 * @typedef {object} Registry
 * @property {string | null} defaultRepo
 * @property {RepoEntry[]} repos
 */

/**
 * @typedef {object} RepoConfig
 * @property {string[]} repos
 * @property {string[]} scanRoots
 */

/**
 * Load the authored repository allowlist shipped beside the Node entry. The
 * published Host install directory sits outside the workspace, so this file is
 * the only discovery source that survives publication.
 * @param {string} pluginRoot
 * @returns {Promise<RepoConfig>}
 */
async function loadRepoConfig(pluginRoot) {
  /** @type {RepoConfig} */
  const empty = { repos: [], scanRoots: [] };
  try {
    const raw = await readFile(join(pluginRoot, 'miniapp/node/repos.json'), 'utf8');
    const parsed = JSON.parse(raw);
    const pick = (/** @type {unknown} */ value) =>
      Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && isAbsolute(resolve(entry))) : [];
    return { repos: pick(parsed?.repos), scanRoots: pick(parsed?.scanRoots) };
  } catch {
    return empty;
  }
}

/**
 * Subdirectories we never want to walk into even when they appear at a scan
 * base, because they are either inaccessible, contain OS state, or are simply
 * not where a developer keeps code. Most hidden dirs (`.Trash`, `.cache`, …)
 * are caught by the `startsWith('.')` rule in the filter; this set covers
 * unhidden-but-systemic names.
 */
const SKIP_DIR_NAMES = new Set([
  // macOS system / resource / metadata directories
  'Library', 'Applications', 'System',
  // Windows system hives — even when read access works, recursing here is
  // never what a developer wants.
  'Program Files', 'Program Files (x86)', 'ProgramData', 'Windows', 'Users',
  '$Recycle.Bin', 'System Volume Information', '$WinREAgent', 'Recovery',
  'PerfLogs', 'Boot', 'Config.Msi', 'OneDriveTemp',
]);

/** @param {string} name */
function isSkippableDirectoryName(name) {
  if (!name) return true;
  // Hidden dirs: .Trash, .cache, .npm, .next, .pnpm-store, .git, ...
  if (name.startsWith('.')) return true;
  // macOS resource forks / metadata and AppleDouble double-dot prefixes
  if (name.startsWith('_')) return true;
  return SKIP_DIR_NAMES.has(name);
}

/**
 * Portability fallback for `repos.json` empty installs: derive a small, bounded
 * set of plausible dev directories. On macOS/Linux we stay under or one level
 * above `$HOME`; on Windows we also walk every mounted drive root because
 * developers routinely keep projects on a non-OS drive (`D:\GitHub\...`,
 * `E:\Work\...`) that is never under `$HOME`.
 *
 * The candidate set is only added when nothing else surfaced a scan base, so
 * users with an explicit `repos.json` are unaffected. Per-entry filtering
 * below drops Windows system hives (`Program Files`, `Users`, `Windows`, …),
 * so widening to drive roots cannot accidentally recurse into `%ProgramFiles%`.
 *
 * Names with case duplicates (Code/code, Repos/repos) are intentional because
 * Windows and macOS default to case-insensitive filesystems and developers
 * frequently mix capitalizations. The set itself is small (≈ 16 + drives)
 * and the per-base scan is one-level deep with a 60-entry cap.
 * @returns {string[]}
 */
function discoverDefaultScanBases() {
  const home = homedir();
  if (!home) return [];
  const bases = [];
  for (const name of [
    'Code', 'code',
    'Projects', 'projects',
    'repos', 'Repos',
    'workspace', 'Workspace',
    'src', 'SRC', 'source', 'Source',
    'dev', 'Dev', 'work', 'Work',
    'Documents', 'git', 'Git',
  ]) {
    bases.push(join(home, name));
  }
  if (process.platform === 'win32') {
    // Each Windows drive root is one readdir() away from common
    // "all my projects live here" parents (D:\GitHub\<user>\...,
    // D:\Projects\..., D:\Work\...). Per-entry filter below keeps
    // Windows system hives out of the scan.
    for (let i = 65; i <= 90; i += 1) {
      bases.push(`${String.fromCharCode(i)}:\\`);
    }
  } else {
    // On macOS/Linux the home parent (e.g. /home, /Users) is a
    // sibling-user scan that costs one extra readdir and frequently
    // catches other developer accounts on the same host.
    bases.push(resolve(home, '..'));
  }
  return bases;
}

/**
 * Build a bounded repository registry from an explicit allowlist plus bounded
 * discovery: walk-ups from the plugin root and the process cwd, then one
 * directory level of every scan root, each validated by a `.git` entry.
 * @param {string} pluginRoot
 * @returns {Promise<Registry>}
 */
async function buildRegistry(pluginRoot) {
  /** @type {RepoEntry[]} */
  const repos = [];
  /** @type {Set<string>} */
  const seen = new Set();

  const add = (/** @type {string} */ candidate) => {
    const normalized = resolve(candidate);
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    repos.push({ path: normalized, label: normalized.split(/[\\/]/).filter(Boolean).pop() ?? normalized, isDefault: false });
  };

  const config = await loadRepoConfig(pluginRoot);
  const walkRoots = [await findRepoRoot(pluginRoot), await findRepoRoot(process.cwd())];

  /** @type {string[]} */
  const preferred = [];
  for (const candidate of [...config.repos, ...walkRoots]) {
    if (candidate && (await pathExists(join(candidate, '.git')))) preferred.push(candidate);
  }
  for (const candidate of preferred) add(candidate);

  /** @type {Set<string>} */
  const scanBases = new Set();
  for (const base of config.scanRoots) scanBases.add(resolve(base));
  for (const root of walkRoots) if (root) scanBases.add(dirname(root));

  // Portability fallback: when walk-up produced nothing (plugin installed
  // outside any git tree) AND the user has not authored `repos.json`, derive
  // a small set of `$HOME` dev directories plus, on Windows, every mounted
  // drive root. This lets a fresh install on a brand-new host surface
  // projects without any manual configuration.
  //
  // On Windows the per-entry filter below drops system hives (`Program
  // Files`, `Users`, `Windows`, …) so widening to drive roots cannot
  // accidentally recurse into %ProgramFiles% or %SystemRoot%.
  if (scanBases.size === 0) {
    for (const base of discoverDefaultScanBases()) {
      scanBases.add(resolve(base));
    }
  }

  for (const scanBase of scanBases) {
    try {
      const entries = await readdir(scanBase, { withFileTypes: true });
      const directories = entries
        .filter((entry) => entry.isDirectory() && !isSkippableDirectoryName(entry.name))
        .slice(0, 60);
      for (const entry of directories) {
        const candidate = join(scanBase, entry.name);
        if (await pathExists(join(candidate, '.git'))) add(candidate);
      }
    } catch {
      /* scan base unreadable: keep whatever was already found */
    }
  }

  if (preferred.length > 0 && repos.length > 0) repos[0].isDefault = true;
  return { defaultRepo: preferred[0] ?? null, repos };
}

/** @param {string} value */
function normalizeRepo(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (value.includes('\0')) return null;
  const normalized = resolve(value);
  if (!isAbsolute(normalized)) return null;
  return normalized;
}

/**
 * Resolve a requested repository against the discovered registry.
 * @param {Registry} registry
 * @param {string | null} requested
 * @returns {string | null}
 */
function resolveRepo(registry, requested) {
  const target = requested ? normalizeRepo(requested) : registry.defaultRepo;
  if (!target) return null;
  const key = target.toLowerCase();
  const match = registry.repos.find((repo) => repo.path.toLowerCase() === key);
  return match ? match.path : null;
}

/**
 * @typedef {object} CommitRow
 * @property {string} sha
 * @property {string} short
 * @property {string[]} parents
 * @property {string} authorName
 * @property {string} authorEmail
 * @property {string} date
 * @property {string} subject
 * @property {number} lane
 * @property {boolean} merge
 * @property {string[]} tags
 */

/**
 * @typedef {object} GraphEdge
 * @property {number} from
 * @property {number} to
 * @property {number} fromLane
 * @property {number} toLane
 */

/**
 * Compute the swim-lane layout, full SVG path strings, and per-row pixel
 * coordinates the client renders as a single canvas SVG. Also mutates each
 * commit with its assigned lane index and merge flag.
 * @param {CommitRow[]} commits
 */
function buildGraph(commits) {
  const graphCommits = commits.map((c) => ({ hash: c.sha, parents: c.parents }));
  const layout = layoutGitGraphDetailed(graphCommits, {
    rowHeight: ROW_HEIGHT,
    laneGap: LANE_SPACING,
    lanePadding: GRAPH_PADDING,
  });

  for (const row of layout.rows) {
    const commit = commits[row.rowIndex];
    if (commit) {
      commit.lane = row.laneIndex;
      commit.merge = commit.parents.length > 1;
    }
  }

  return layout;
}

/** @param {string} stdout */
function splitLines(stdout) {
  return stdout
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.length > 0);
}

/** @param {string} stdout */
function splitFields(stdout, separator) {
  return splitLines(stdout).map((line) => line.split(separator));
}

/**
 * @param {string} repo
 * @returns {Promise<Map<string, string[]>>}
 */
async function loadTagMap(repo) {
  const result = await runGit(repo, ['log', '--all', '--simplify-by-decoration', '--format=%H %D']);
  /** @type {Map<string, string[]>} */
  const tags = new Map();
  if (!result.ok) return tags;
  for (const line of splitLines(result.stdout)) {
    const separator = line.indexOf(' ');
    if (separator <= 0) continue;
    const sha = line.slice(0, separator);
    const decoration = line.slice(separator + 1);
    const names = [];
    for (const part of decoration.split(',')) {
      const trimmed = part.trim();
      if (trimmed.startsWith('tag:')) names.push(trimmed.slice(4).trim());
    }
    if (names.length > 0) tags.set(sha, names);
  }
  return tags;
}

/**
 * @typedef {object} CacheEntry
 * @property {number} at
 * @property {Map<string, string[]>} tags
 */

/**
 * @param {MiniAppContext['logger']} logger
 */
function createTagCache(logger) {
  /** @type {Map<string, CacheEntry>} */
  const cache = new Map();
  return {
    /**
     * @param {string} repo
     * @returns {Promise<Map<string, string[]>>}
     */
    async get(repo) {
      const key = repo.toLowerCase();
      const hit = cache.get(key);
      const now = Date.now();
      if (hit && now - hit.at < DISCOVERY_TTL_MS) return hit.tags;
      const tags = await loadTagMap(repo);
      cache.set(key, { at: now, tags });
      logger.debug('git-tree.tags.loaded', { entries: tags.size });
      return tags;
    },
  };
}

/** @param {string} value */
function clampText(value, limit) {
  const trimmed = value.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed;
}

/**
 * @template T
 * @param {number} ttlMs
 * @param {string} label
 * @param {MiniAppContext['logger']} logger
 */
function createTTLCache(ttlMs, label, logger) {
  /** @type {Map<string, { at: number, value: T }>} */
  const store = new Map();
  return {
    /**
     * @param {string} key
     * @returns {T | null}
     */
    get(key) {
      const hit = store.get(key);
      if (!hit) return null;
      if (Date.now() - hit.at >= ttlMs) {
        store.delete(key);
        return null;
      }
      return hit.value;
    },
    /**
     * @param {string} key
     * @param {T} value
     */
    set(key, value) {
      store.set(key, { at: Date.now(), value });
    },
    /** @param {string} key */
    delete(key) { store.delete(key); },
    clear() { store.clear(); },
    get size() { return store.size; },
    sweep() {
      const now = Date.now();
      let dropped = 0;
      for (const [key, hit] of store) {
        if (now - hit.at >= ttlMs) {
          store.delete(key);
          dropped += 1;
        }
      }
      if (dropped > 0) logger.debug(`git-tree.${label}.sweep`, { dropped });
    },
  };
}

/**
 * @param {MiniAppContext['logger']} logger
 */
function createOverviewCache(logger) {
  const cache = createTTLCache(OVERVIEW_TTL_MS, 'overview', logger);
  return {
    /**
     * @param {string} repo
     * @param {() => Promise<unknown>} loader
     */
    async get(repo, loader) {
      const key = repo.toLowerCase();
      const hit = cache.get(key);
      if (hit) return hit;
      const value = await loader();
      cache.set(key, value);
      return value;
    },
    /** @param {string} repo */
    invalidate(repo) { cache.delete(repo.toLowerCase()); },
  };
}

/**
 * @param {MiniAppContext['logger']} logger
 */
function createCommitCache(logger) {
  const cache = createTTLCache(COMMIT_TTL_MS, 'commit', logger);
  return {
    /**
     * @param {string} repo
     * @param {string} sha
     */
    get(repo, sha) {
      const key = `${repo.toLowerCase()}::${sha}`;
      return cache.get(key);
    },
    /**
     * @param {string} repo
     * @param {string} sha
     * @param {unknown} value
     */
    set(repo, sha, value) {
      const key = `${repo.toLowerCase()}::${sha}`;
      cache.set(key, value);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Preferences persistence                                              */
/* ------------------------------------------------------------------ */

const PREF_KEYS = /** @type {const} */ (['theme', 'repo', 'ref', 'q', 'author', 'interval']);
const PREF_INTERVALS = [0, 5, 10, 30, 60];
const PREF_THEMES = ['auto', 'light', 'dark'];

/**
 * Whitelist and type-coerce an arbitrary patch so a stray or malformed
 * payload cannot poison the prefs.json on disk.
 * @param {unknown} input
 */
function sanitizePrefs(input) {
  /** @type {Record<string, unknown>} */
  const out = {};
  if (!input || typeof input !== 'object') return out;
  const obj = /** @type {Record<string, unknown>} */ (input);
  for (const key of PREF_KEYS) {
    if (!(key in obj)) continue;
    const value = obj[key];
    if (key === 'interval') {
      if (typeof value === 'number' && PREF_INTERVALS.indexOf(value) >= 0) out[key] = value;
    } else if (key === 'theme') {
      if (typeof value === 'string' && PREF_THEMES.indexOf(value) >= 0) out[key] = value;
    } else {
      // repo / ref / q / author: bounded string
      if (typeof value === 'string' && value.length > 0 && value.length <= 240) out[key] = value;
    }
  }
  return out;
}

/**
 * Build a prefs module bound to the Host-injected plugin data directory.
 * Reads happen lazily; writes merge with whatever is already on disk so a
 * partial POST never wipes sibling fields.
 * @param {string} dataDir
 */
function createPrefsStore(dataDir) {
  /** @type {string | null} */
  let prefsPath = null;
  /** @type {Promise<string> | null} */
  let resolving = null;

  function path() {
    if (prefsPath) return Promise.resolve(prefsPath);
    if (!resolving) {
      resolving = mkdir(dataDir, { recursive: true })
        .then(() => {
          prefsPath = join(dataDir, 'prefs.json');
          return /** @type {string} */ (prefsPath);
        })
        .catch((error) => {
          resolving = null;
          throw error;
        });
    }
    return resolving;
  }

  return {
    async read() {
      try {
        const p = await path();
        const raw = await readFile(p, 'utf8');
        const obj = JSON.parse(raw);
        return obj && typeof obj === 'object' ? sanitizePrefs(obj) : {};
      } catch (error) {
        const code = /** @type {NodeJS.ErrnoException} */ (error).code;
        if (code !== 'ENOENT') {
          // Corrupt file: don't crash the whole prefs surface, just start fresh.
          return {};
        }
        return {};
      }
    },
    /**
     * @param {Record<string, unknown>} patch
     */
    async merge(patch) {
      const sanitized = sanitizePrefs(patch);
      const current = await this.read();
      const next = { ...current, ...sanitized };
      const p = await path();
      // tmp-write + rename for crash-safety. Avoid clobbering the file with
      // a half-written JSON if we crash mid-write.
      const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, JSON.stringify(next), 'utf8');
      const fs = await import('node:fs/promises');
      await fs.rename(tmp, p);
      return next;
    },
  };
}

/**
 * Decide whether the response is worth gzipping. The cost of compressing very
 * small payloads is not worth the extra headers, so we require a minimum body
 * size before turning on compression.
 * @param {import('node:http').IncomingMessage} request
 * @param {string} payload
 */
function acceptsGzip(request, payload) {
  if (payload.length < GZIP_MIN_BYTES) return false;
  const acceptEncoding = String(request.headers['accept-encoding'] ?? '');
  return acceptEncoding.split(',').some((token) => token.trim().toLowerCase().startsWith('gzip'));
}

/**
 * Send a JSON body, transparently gzipping it when the client accepts it and
 * the payload is large enough to benefit. Stream-based to avoid buffering the
 * compressed bytes twice.
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {unknown} body
 */
async function sendJson(request, response, status, body) {
  const payload = JSON.stringify(body);
  const baseHeaders = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  };
  if (!acceptsGzip(request, payload)) {
    response.writeHead(status, baseHeaders);
    response.end(payload);
    return;
  }
  response.writeHead(status, { ...baseHeaders, 'content-encoding': 'gzip', vary: 'Accept-Encoding' });
  const gzip = createGzip();
  pipeline(gzip, response).catch(() => undefined);
  gzip.end(payload);
}

/**
 * @typedef {object} RequestContext
 * @property {Registry} registry
 * @property {{ get: (repo: string) => Promise<Map<string, string[]>> }} tags
 * @property {{ get: (repo: string, loader: () => Promise<unknown>) => Promise<unknown>, invalidate: (repo: string) => void }} overview
 * @property {{ get: (repo: string, sha: string) => unknown, set: (repo: string, sha: string, value: unknown) => void }} commits
 * @property {MiniAppContext['logger']} logger
 */

/**
 * @param {RequestContext} context
 * @param {URL} url
 */
async function handleRepos(context, url) {
  return { defaultRepo: context.registry.defaultRepo, repos: context.registry.repos };
}

/**
 * @param {RequestContext} context
 * @param {URL} url
 */
async function handleOverview(context, url) {
  const repo = resolveRepo(context.registry, url.searchParams.get('repo'));
  if (!repo) return { status: 400, body: { code: 'unknown_repo', message: '仓库不在可用列表内。' } };

  const body = await context.overview.get(repo, async () => {
    const [headResult, countResult, branchesResult, remotesResult, tagsResult, statusResult, decorateResult] =
      await Promise.all([
        runGit(repo, ['log', '-n', '1', '--date=iso-strict', '--format=%H%x09%h%x09%an%x09%ad%x09%s'], GIT_TIMEOUT_MEDIUM_MS),
        runGit(repo, ['rev-list', '--all', '--count'], GIT_TIMEOUT_HEAVY_MS),
        runGit(repo, ['for-each-ref', '--format=%(refname:short) %(objectname:short) %(upstream:short) %(HEAD)', 'refs/heads'], GIT_TIMEOUT_QUICK_MS),
        runGit(repo, ['for-each-ref', '--format=%(refname:short) %(objectname:short)', 'refs/remotes'], GIT_TIMEOUT_QUICK_MS),
        runGit(repo, ['tag', '--list'], GIT_TIMEOUT_QUICK_MS),
        runGit(repo, ['status', '--porcelain=v1', '-b'], GIT_TIMEOUT_MEDIUM_MS),
        runGit(repo, ['log', '-n', '1', '--format=%D'], GIT_TIMEOUT_QUICK_MS),
      ]);

    if (!headResult.ok) {
      return { code: 'git_failed', message: '无法读取仓库历史。' };
    }

    const headFields = headResult.stdout.split('\t');
    const decorate = decorateResult.ok ? decorateResult.stdout.trim() : '';
    const branchFromStatus = statusResult.ok
      ? (statusResult.stdout.split('\n')[0] ?? '').replace(/^## /, '').split('...')[0].trim()
      : '';

    const branches = splitFields(branchesResult.ok ? branchesResult.stdout : '', ' ').map((fields) => ({
      name: fields[0] ?? '',
      short: fields[1] ?? '',
      upstream: fields[2] ?? '',
      current: (fields[3] ?? '').includes('*'),
    }));
    const remotes = splitFields(remotesResult.ok ? remotesResult.stdout : '', ' ').map((fields) => ({
      name: fields[0] ?? '',
      short: fields[1] ?? '',
    }));

    const statusLines = splitLines(statusResult.ok ? statusResult.stdout : '');
    const statusEntries = statusLines
      .slice(1)
      .map((line) => ({ code: line.slice(0, 2), path: line.slice(3) }))
      .filter((entry) => entry.path.length > 0)
      .slice(0, 60);

    const tags = splitLines(tagsResult.ok ? tagsResult.stdout : '');
    const total = Number.parseInt(countResult.ok ? countResult.stdout.trim() : '0', 10);

    return {
      repo,
      head: {
        sha: headFields[0] ?? '',
        short: headFields[1] ?? '',
        authorName: headFields[2] ?? '',
        date: headFields[3] ?? '',
        subject: (headFields[4] ?? '').replace(/[\r\n]+$/, ''),
        decoration: decorate,
        branch: branchFromStatus,
      },
      counts: {
        commits: Number.isFinite(total) ? total : 0,
        branches: branches.length,
        remotes: remotes.length,
        tags: tags.length,
        changed: statusEntries.length,
      },
      branches,
      remotes,
      tags,
      status: {
        branch: branchFromStatus,
        clean: statusEntries.length === 0,
        entries: statusEntries,
      },
    };
  });

  // The loader returns either a domain body or a { code, message } error.
  if (body && typeof body === 'object' && 'code' in body && !('repo' in body)) {
    return { status: 502, body };
  }
  return { status: 200, body };
}

/**
 * @param {RequestContext} context
 * @param {URL} url
 */
async function handleGraph(context, url) {
  const repo = resolveRepo(context.registry, url.searchParams.get('repo'));
  if (!repo) return { status: 400, body: { code: 'unknown_repo', message: '仓库不在可用列表内。' } };

  const rawRef = url.searchParams.get('ref') ?? 'all';
  const ref = rawRef === 'all' ? '--all' : rawRef;
  if (ref !== '--all' && !REF_PATTERN.test(ref)) {
    return { status: 400, body: { code: 'invalid_ref', message: '引用名称不合法。' } };
  }
  if (ref !== '--all' && ref.includes('..')) {
    return { status: 400, body: { code: 'invalid_ref', message: '引用名称不合法。' } };
  }

  const rawLimit = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT) : DEFAULT_LIMIT;
  const rawOffset = Number.parseInt(url.searchParams.get('offset') ?? '0', 10);
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;

  const query = (url.searchParams.get('q') ?? '').slice(0, 120);
  const author = (url.searchParams.get('author') ?? '').slice(0, 120);

  /** @type {string[]} */
  const args = ['log', ref, '--topo-order', '--date=iso-strict', '--format=%H%x09%h%x09%P%x09%an%x09%ae%x09%ad%x09%s'];
  if (query) args.push('-F', '-i', `--grep=${query}`);
  if (author) args.push(`--author=${author}`);
  // Fetch one extra row so `hasMore` can be derived from real evidence
  // instead of being permanently false.
  args.push('-n', String(offset + limit + 1));

  const [logResult, tagMap] = await Promise.all([runGit(repo, args), context.tags.get(repo)]);
  if (!logResult.ok) {
    context.logger.warn('git-tree.log.failed', { reason: 'git_log' });
    return { status: 502, body: { code: 'git_failed', message: '无法读取提交图。' } };
  }

  const rows = splitFields(logResult.stdout, '\t');
  const hasMore = rows.length > offset + limit;
  const commits = rows.slice(offset, offset + limit).map((/** @type {string[]} */ fields) => ({
    sha: fields[0] ?? '',
    short: fields[1] ?? '',
    parents: (fields[2] ?? '').split(' ').filter(Boolean),
    authorName: fields[3] ?? '',
    authorEmail: fields[4] ?? '',
    date: fields[5] ?? '',
    subject: fields[6] ?? '',
    lane: 0,
    merge: false,
    tags: tagMap.get(fields[0] ?? '') ?? [],
  }));

  const layout = buildGraph(commits);

  return {
    status: 200,
    body: {
      repo,
      ref: rawRef,
      commits,
      rows: layout.rows,
      edges: layout.edges,
      paths: layout.paths,
      laneSegments: layout.laneSegments,
      laneCount: layout.laneCount,
      laneSpacing: LANE_SPACING,
      rowHeight: layout.rowHeight,
      graphPadding: GRAPH_PADDING,
      graphWidth: layout.width,
      graphHeight: layout.height,
      hasMore,
      loaded: commits.length,
    },
  };
}

/**
 * @param {RequestContext} context
 * @param {URL} url
 */
async function handleCommit(context, url) {
  const repo = resolveRepo(context.registry, url.searchParams.get('repo'));
  if (!repo) return { status: 400, body: { code: 'unknown_repo', message: '仓库不在可用列表内。' } };

  const sha = url.searchParams.get('sha') ?? '';
  if (!SHA_PATTERN.test(sha)) {
    return { status: 400, body: { code: 'invalid_sha', message: '提交哈希不合法。' } };
  }

  const cached = context.commits.get(repo, sha);
  if (cached) return { status: 200, body: cached };

  const [metaResult, statResult, branchesResult, tagsResult] = await Promise.all([
    runGit(repo, ['show', '-s', '--date=iso-strict', sha, '--format=%H%x09%h%x09%P%x09%an%x09%ae%x09%ad%x09%cn%x09%ce%x09%cd%x09%s%x09%B'], GIT_TIMEOUT_MEDIUM_MS),
    runGit(repo, ['show', '--numstat', '--format=', sha], GIT_TIMEOUT_MEDIUM_MS),
    runGit(repo, ['branch', '--contains', sha, '--format=%(refname:short)'], GIT_TIMEOUT_QUICK_MS),
    runGit(repo, ['tag', '--contains', sha], GIT_TIMEOUT_QUICK_MS),
  ]);

  if (!metaResult.ok) {
    return { status: 404, body: { code: 'commit_not_found', message: '找不到该提交。' } };
  }

  // %B is the 11th field (index 10); it may itself contain tabs, so re-join.
  // Its first line repeats the subject, which the panel already renders.
  // A trailing tab/empty body produces an extra empty entry after split; trim
  // and drop that empty tail explicitly so we never render a phantom newline.
  const fields = metaResult.stdout.split('\t');
  const subject = fields[9] ?? '';
  const rawBody = fields.slice(10).join('\t');
  const bodyLines = rawBody.split('\n');
  while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === '') bodyLines.pop();
  if (bodyLines.length > 0 && bodyLines[0].trim() === subject.trim()) bodyLines.shift();
  const body = bodyLines.join('\n').trim();
  const files = statResult.ok
    ? splitLines(statResult.stdout).map((line) => {
        const parts = line.split('\t');
        return {
          added: parts[0] === '-' ? null : Number.parseInt(parts[0] ?? '0', 10),
          deleted: parts[1] === '-' ? null : Number.parseInt(parts[1] ?? '0', 10),
          path: parts.slice(2).join('\t'),
          binary: parts[0] === '-',
        };
      })
    : [];

  const insertions = files.reduce((sum, file) => sum + (file.added ?? 0), 0);
  const deletions = files.reduce((sum, file) => sum + (file.deleted ?? 0), 0);

  const result = {
    sha: fields[0] ?? '',
    short: fields[1] ?? '',
    parents: (fields[2] ?? '').split(' ').filter(Boolean),
    authorName: fields[3] ?? '',
    authorEmail: fields[4] ?? '',
    authorDate: fields[5] ?? '',
    committerName: fields[6] ?? '',
    committerDate: fields[8] ?? '',
    subject,
    body,
    files,
    stats: { files: files.length, insertions, deletions },
    branches: splitLines(branchesResult.ok ? branchesResult.stdout : ''),
    tags: splitLines(tagsResult.ok ? tagsResult.stdout : ''),
  };

  context.commits.set(repo, sha, result);
  return { status: 200, body: result };
}

/**
 * @param {MiniAppContext} context
 * @returns {Promise<MiniAppLifecycle>}
 */

export async function start(context) {
  const clientEntry = await readFile(join(context.pluginRoot, 'miniapp/client/index.html'));
  const registry = await buildRegistry(context.pluginRoot);
  const tagCache = createTagCache(context.logger);
  const overviewCache = createOverviewCache(context.logger);
  const commitCache = createCommitCache(context.logger);

  if (!registry.defaultRepo) {
    context.logger.warn('git-tree.registry.empty');
  } else {
    context.logger.info('git-tree.registry.ready', { repos: registry.repos.length });
  }

  const prefsStore = createPrefsStore(context.dataDir);

  /** @type {RequestContext} */
  const requestContext = {
    registry,
    tags: tagCache,
    overview: overviewCache,
    commits: commitCache,
    logger: context.logger,
  };

  /**
   * Read the request body as utf-8 text, capped at `limit` bytes so a runaway
   * POST cannot exhaust memory.
   * @param {import('node:http').IncomingMessage} req
   * @param {number} [limit]
   */
  function readRequestBody(req, limit = 8192) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk) => {
        data += chunk.toString('utf-8');
        if (data.length > limit) {
          req.destroy();
          reject(new Error('body too large'));
        }
      });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
  }

  /**
   * @param {string} method
   * @param {string} route
   * @param {URL} url
   * @param {import('node:http').IncomingMessage} request
   * @returns {Promise<{ status: number, body: unknown }>}
   */
  async function dispatch(method, route, url, request) {
    if (route === '/prefs') {
      if (method === 'GET') {
        return { status: 200, body: await prefsStore.read() };
      }
      if (method === 'POST') {
        let patch = {};
        try {
          const text = await readRequestBody(request);
          patch = text ? JSON.parse(text) : {};
        } catch (error) {
          return { status: 400, body: { code: 'bad_body', message: '无法解析 prefs 请求体。' } };
        }
        try {
          const merged = await prefsStore.merge(patch);
          return { status: 200, body: merged };
        } catch (error) {
          context.logger.warn('git-tree.prefs.write_failed', {
            message: /** @type {Error} */ (error).message,
          });
          return { status: 500, body: { code: 'prefs_write_failed', message: '写入偏好失败。' } };
        }
      }
      return { status: 405, body: { code: 'method_not_allowed', message: 'prefs 仅支持 GET / POST。' } };
    }
    if (method !== 'GET') {
      return { status: 405, body: { code: 'method_not_allowed', message: '该接口仅支持 GET。' } };
    }
    if (route === '/repos') return { status: 200, body: await handleRepos(requestContext, url) };
    if (route === '/overview') return handleOverview(requestContext, url);
    if (route === '/graph') return handleGraph(requestContext, url);
    if (route === '/commit') return handleCommit(requestContext, url);
    return { status: 404, body: { code: 'not_found', message: '接口不存在。' } };
  }

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://miniapp.local');
      if (request.method === 'GET' && url.pathname === SURFACE_PATH) {
        const html = clientEntry.toString('utf8');
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        response.end(html);
        return;
      }

      if (url.pathname.startsWith(`${API_ROOT}/`)) {
        const route = url.pathname.slice(API_ROOT.length);
        const method = String(request.method ?? 'GET').toUpperCase();
        try {
          const outcome = await dispatch(method, route, url, request);
          await sendJson(request, response, outcome.status, outcome.body);
        } catch (error) {
          context.logger.warn('git-tree.request.failed', { route, method });
          await sendJson(request, response, 500, { code: 'internal', message: '处理请求时出错。' });
        }
        return;
      }

      await sendJson(request, response, 404, { code: 'not_found', message: '接口不存在。' });
    })();
  });

  await new Promise((resolvePromise, reject) => {
    const onError = (/** @type {Error} */ error) => reject(error);
    server.once('error', onError);
    server.listen(context.listen.port, context.listen.host, () => {
      server.off('error', onError);
      resolvePromise(undefined);
    });
  });
  context.logger.info('miniapp.runtime.listening');

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    context.signal.removeEventListener('abort', onAbort);
    await new Promise((resolvePromise) => {
      server.close(() => resolvePromise(undefined));
      server.closeIdleConnections?.();
    });
  };
  const onAbort = () => {
    void dispose().catch(() => undefined);
  };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  return { dispose };
}
