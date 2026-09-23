// @ts-check

import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */
/** @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle */

const PYTHON = process.platform === 'win32' ? 'python' : 'python3';
const QUERY_TIMEOUT_MS = 30000;
const CACHE_TTL_MS = 2000;
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const RANGE_PRESETS = ['today', '1h', '12h', '24h', '7d', '30d', 'all'];
const CUSTOM_RANGE_RE = /^(\d+)h$/;
const MAX_CUSTOM_HOURS = 8760;

/** 预设 key 原样通过; <N>h 整数小时(1..8760)通过; 其余返回 null(回退 all)。 */
function normalizeRange(raw) {
  if (typeof raw !== 'string') return null;
  if (RANGE_PRESETS.includes(raw)) return raw;
  const m = CUSTOM_RANGE_RE.exec(raw);
  if (m) {
    const h = Number(m[1]);
    if (Number.isInteger(h) && h >= 1 && h <= MAX_CUSTOM_HOURS) return raw;
  }
  return null;
}

/**
 * mcode-usage-monitor Node 入口:
 *  - 在 Host 分配的端口上服务 /dashboard(客户端页面)与 /echarts.min.js
 *  - /api/data 通过一次性 spawn python api.py 取数(stdout JSON),
 *    不建立 Node->本机端口的 TCP 连接(该路径在 Mini App 运行时内不可用)
 *  - 查询串行化 + 2s 内存缓存, 避免并发快照读放大
 *  - dispose() 关闭 HTTP 监听并结束在途子进程
 * @param {MiniAppContext} context
 * @returns {Promise<MiniAppLifecycle>}
 */
export async function start(context) {
  const clientRoot = join(context.pluginRoot, 'miniapp/client');
  const apiPyPath = join(context.pluginRoot, 'miniapp/node/api.py');
  const prefsPath = join(context.dataDir, 'prefs.json');

  const indexHtml = await readFile(join(clientRoot, 'index.html'));
  const echartsJs = await readFile(join(clientRoot, 'echarts.min.js'));

  // ---- 偏好持久化(存到 Host 分配的插件数据目录) ----
  const PREF_INTERVALS = [0, 5, 10, 30];
  const PREF_THEMES = ['auto', 'light', 'dark'];
  const PREF_CARDS = ['main', 'model', 'proj', 'tool', 'speed', 'recent']; // 与 index.html CARD_IDS 一致

  function sanitizePrefs(input) {
    const out = {};
    if (!input || typeof input !== 'object') return out;
    if (Array.isArray(input.models)) {
      out.models = input.models.filter((x) => typeof x === 'string').slice(0, 50);
    }
    if (Array.isArray(input.sessions)) {
      out.sessions = input.sessions.filter((x) => typeof x === 'string').slice(0, 50);
    }
    const range = normalizeRange(input.range);
    if (range) out.range = range;
    if (PREF_INTERVALS.includes(input.interval)) out.interval = input.interval;
    if (PREF_THEMES.includes(input.theme)) out.theme = input.theme;
    if (input.collapsed && typeof input.collapsed === 'object' && !Array.isArray(input.collapsed)) {
      const c = {};
      for (const id of PREF_CARDS) {
        if (typeof input.collapsed[id] === 'boolean') c[id] = input.collapsed[id];
      }
      out.collapsed = c;
    }
    if (Array.isArray(input.order)) {
      const seen = new Set();
      const order = [];
      for (const id of input.order) {
        if (PREF_CARDS.includes(id) && !seen.has(id)) { seen.add(id); order.push(id); }
      }
      for (const id of PREF_CARDS) { if (!seen.has(id)) order.push(id); } // 补齐缺失项
      out.order = order.slice(0, PREF_CARDS.length);
    }
    return out;
  }

  async function readPrefs() {
    try {
      const raw = await readFile(prefsPath, 'utf8');
      const obj = JSON.parse(raw);
      return obj && typeof obj === 'object' ? obj : {};
    } catch {
      return {};
    }
  }

  async function mergePrefs(patch) {
    const next = { ...(await readPrefs()), ...sanitizePrefs(patch) };
    await mkdir(context.dataDir, { recursive: true });
    await writeFile(prefsPath, JSON.stringify(next), 'utf8');
    return next;
  }

  function readBody(req, limit = 8192) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk) => {
        data += chunk;
        if (data.length > limit) {
          reject(new Error('body too large'));
          req.destroy();
        }
      });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
  }

  // ---- Python 查询子进程 ----
  const activeChildren = new Set();
  let disposed = false;
  let queue = Promise.resolve(); // 串行执行, 避免 sqlite 快照并发
  const cache = new Map(); // key -> { at, promise }

  function runPython(args) {
    return new Promise((resolve, reject) => {
      let proc;
      try {
        proc = spawn(PYTHON, [apiPyPath, ...args], {
          cwd: context.pluginRoot,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        reject(err);
        return;
      }
      activeChildren.add(proc);
      let out = '';
      let errText = '';
      let settled = false;
      const finish = (err, payload) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        activeChildren.delete(proc);
        if (err) reject(err);
        else resolve(payload);
      };
      const timer = setTimeout(() => {
        try { proc.kill(); } catch { /* 已退出 */ }
        finish(new Error('query timeout'));
      }, QUERY_TIMEOUT_MS);
      proc.stdout.setEncoding('utf-8');
      proc.stdout.on('data', (chunk) => {
        if (out.length < MAX_OUTPUT_BYTES) out += chunk;
      });
      proc.stderr.setEncoding('utf-8');
      proc.stderr.on('data', (chunk) => { errText += chunk; });
      proc.on('error', (err) => finish(err));
      proc.on('close', (code) => {
        if (code === 0) {
          try {
            finish(null, JSON.parse(out));
          } catch (e) {
            finish(new Error(`bad payload: ${e.message}`));
          }
        } else {
          const hint = (out || errText || '').trim().slice(0, 300);
          finish(new Error(`backend exit ${code}: ${hint}`));
        }
      });
    });
  }

  function queryBackend(rangeKey, models, sessions) {
    const key = `${rangeKey}|${models ? models.join(',') : ''}|${sessions ? sessions.join(',') : ''}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.promise;
    const promise = queue.then(() =>
      runPython(['--range', rangeKey,
                 '--models', models ? models.join(',') : '',
                 '--sessions', sessions ? sessions.join(',') : '']));
    cache.set(key, { at: Date.now(), promise });
    promise.catch(() => cache.delete(key)); // 失败不缓存
    queue = promise.catch(() => {}); // 链条继续
    return promise;
  }

  function sendJson(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(body);
  }

  // ---- HTTP 服务 ----
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://miniapp.local');
    if (req.method === 'GET' && url.pathname === '/dashboard') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(indexHtml);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/echarts.min.js') {
      res.writeHead(200, {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(echartsJs);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/prefs') {
      readPrefs()
        .then((prefs) => sendJson(res, 200, prefs))
        .catch((err) => sendJson(res, 500, { error: err.message }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/prefs') {
      readBody(req)
        .then((text) => mergePrefs(JSON.parse(text || '{}')))
        .then((prefs) => sendJson(res, 200, prefs))
        .catch((err) => sendJson(res, 400, { error: err.message }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/data') {
      const rawRange = url.searchParams.get('range') ?? 'all';
      const rangeKey = normalizeRange(rawRange) ?? 'all';
      const rawModels = url.searchParams.get('models');
      const models = rawModels
        ? rawModels.split(',').map((s) => s.trim()).filter(Boolean)
        : null;
      const rawSessions = url.searchParams.get('sessions');
      const sessions = rawSessions
        ? rawSessions.split(',').map((s) => s.trim()).filter(Boolean)
        : null;
      queryBackend(rangeKey, models && models.length ? models : null,
                   sessions && sessions.length ? sessions : null)
        .then((payload) => sendJson(res, 200, payload))
        .catch((err) => sendJson(res, 502, { error: `backend unavailable: ${err.message}` }));
      return;
    }
    sendJson(res, 404, { error: 'not_found' });
  });

  await listen(server, context.listen.host, context.listen.port);
  context.logger.info('miniapp.runtime.listening');

  // 预热首次查询(不阻塞就绪)
  queryBackend('all', null).catch((err) => {
    context.logger.warn('miniapp.backend.warmup_failed', { message: err.message });
  });

  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    context.signal.removeEventListener('abort', onAbort);
    for (const proc of activeChildren) {
      try { proc.kill(); } catch { /* 已退出 */ }
    }
    activeChildren.clear();
    await close(server);
  };
  const onAbort = () => {
    void dispose();
  };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  return { dispose };
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}
