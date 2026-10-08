// @ts-check

import { spawn, execFile } from 'node:child_process';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */
/** @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle */

/** 查询串里的"显式空选"哨兵: 不传参=全部, 哨兵=明确选择了空集(0 数据)。
 *  index.html / api.py 用同名常量, 改语义时三处一起改。 */
const NONE = '__none__';

/** 候选 Python 命令(Windows 商店别名桩会静默失败, 需回退 py -3)。 */
const PYTHON_CANDIDATES = process.platform === 'win32'
  ? [['python'], ['py', '-3']]
  : [['python3'], ['python']];

/** 探测候选命令是否可用, 不阻塞事件循环。 */
function probeCommand(cmd) {
  return new Promise((resolve) => {
    try {
      execFile(cmd[0], [...cmd.slice(1), '--version'],
        { timeout: 5000, windowsHide: true, encoding: 'utf8' },
        (err) => resolve(!err));
    } catch { resolve(false); }
  });
}

/** 探测结果缓存, 首次查询触发一次探测。 @type {Promise<string[]>|null} */
let pythonCmd = null;

/**
 * 探测可用的 Python 命令。首次查询时才探测并缓存结果:
 * 启动时同步 spawnSync 最坏会阻塞两次 5s 超时, 而此时页面还没发起任何查询。
 * @returns {Promise<string[]>}
 */
function pickPython() {
  if (!pythonCmd) {
    pythonCmd = (async () => {
      for (const cmd of PYTHON_CANDIDATES) {
        if (await probeCommand(cmd)) return cmd;
      }
      return PYTHON_CANDIDATES[0]; // 全部失败时保留首选, 保留可见的报错路径
    })();
  }
  return pythonCmd;
}

const QUERY_TIMEOUT_MS = 30000;
const CACHE_TTL_MS = 2000;
const CACHE_MAX = 24; // 条目上限, 防自定义范围×筛选组合无限增长
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
 *  - 客户端断开时放弃对应查询(排队中跳过, 在途则结束子进程)
 *  - dispose() 关闭 HTTP 监听并结束在途子进程
 * @param {MiniAppContext} context
 * @returns {Promise<MiniAppLifecycle>}
 */
export async function start(context) {
  const clientRoot = join(context.pluginRoot, 'miniapp/client');
  const apiPyPath = join(context.pluginRoot, 'miniapp/node/api.py');
  const prefsPath = join(context.dataDir, 'prefs.json');

  let indexHtml = await readFile(join(clientRoot, 'index.html'), 'utf8');
  // 页脚版本号占位符由插件清单注入, 升版本只需改 plugin.json
  try {
    const pluginJson = JSON.parse(
      await readFile(join(context.pluginRoot, '.minimax-plugin', 'plugin.json'), 'utf8'));
    if (pluginJson && typeof pluginJson.version === 'string') {
      indexHtml = indexHtml.replaceAll('__VERSION__', pluginJson.version);
    }
  } catch { /* 清单读取失败时保留占位符, 不影响页面其余功能 */ }
  const echartsJs = await readFile(join(clientRoot, 'echarts.min.js'));

  // ---- 偏好持久化(存到 Host 分配的插件数据目录) ----
  const PREF_INTERVALS = [0, 5, 10, 30];
  const PREF_THEMES = ['auto', 'light', 'dark'];
  // 客户端的卡片/KPI 白名单由这里注入: 校验偏好与页面渲染共用同一份, 不用两边手工同步
  const PREF_CARDS = ['main', 'model', 'proj', 'tool', 'speed', 'recent'];
  const PREF_KPIS = ['total', 'input', 'output', 'cache', 'hit', 'calls', 'speed'];
  for (const [ph, list] of [['__CARD_IDS__', PREF_CARDS], ['__KPI_KEYS__', PREF_KPIS]]) {
    if (!indexHtml.includes(ph)) {
      // 占位符没替换掉, 客户端脚本会解析失败: 直接报错好过白屏
      throw new Error(`client placeholder ${ph} not found in index.html`);
    }
    indexHtml = indexHtml.replace(ph, JSON.stringify(list));
  }

  function sanitizePrefs(input) {
    const out = {};
    if (!input || typeof input !== 'object') return out;
    // 筛选选择: null=全部(显式清除旧值), 'none'=空选(页面 0 数据), 数组=具体选择
    if (input.models === null || input.models === 'none') out.models = input.models;
    else if (Array.isArray(input.models)) {
      out.models = input.models.filter((x) => typeof x === 'string').slice(0, 50);
    }
    if (input.sessions === null || input.sessions === 'none') out.sessions = input.sessions;
    else if (Array.isArray(input.sessions)) {
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
    // 布局顺序: 仅含可见项(空数组=全部移除, 也需显式保存); 缺失项视为已移除
    const pickList = (arr, allow) => {
      if (!Array.isArray(arr)) return null;
      const seen = new Set();
      const order = [];
      for (const id of arr) {
        if (allow.includes(id) && !seen.has(id)) { seen.add(id); order.push(id); }
      }
      return order;
    };
    const order = pickList(input.order, PREF_CARDS);
    if (order !== null) out.order = order; // 空数组=全部移除, 也要落盘
    const kpis = pickList(input.kpis, PREF_KPIS);
    if (kpis !== null) out.kpis = kpis;
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

  let prefsOp = Promise.resolve(); // 串行化读-改-写, 避免并发合并互相覆盖
  async function mergePrefs(patch) {
    const next = prefsOp.then(async () => {
      const merged = { ...(await readPrefs()), ...sanitizePrefs(patch) };
      await mkdir(context.dataDir, { recursive: true });
      const tmp = `${prefsPath}.tmp`;
      await writeFile(tmp, JSON.stringify(merged), 'utf8');
      await rename(tmp, prefsPath); // 原子替换, 避免写一半截断
      return merged;
    });
    prefsOp = next.catch(() => {});
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
  const cache = new Map(); // key -> { at, waiters, dead, done, kill, promise }

  async function runPython(args, onSpawn) {
    const cmd = await pickPython();
    return new Promise((resolve, reject) => {
      let proc;
      try {
        proc = spawn(cmd[0], [...cmd.slice(1), apiPyPath, ...args], {
          cwd: context.pluginRoot,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        reject(err);
        return;
      }
      activeChildren.add(proc);
      if (onSpawn) onSpawn(() => { try { proc.kill(); } catch { /* 已退出 */ } });
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

  function queryBackend(rangeKey, models = null, sessions = null) {
    // models/sessions: null=不过滤(全部), []=显式空选(0 数据, 传哨兵给 python)
    const ms = models === null ? '' : (models.length ? models.join(',') : NONE);
    const ss = sessions === null ? '' : (sessions.length ? sessions.join(',') : NONE);
    const key = `${rangeKey}|${ms}|${ss}`;
    // entry.waiters: 还在等结果的请求数; dead: 等待者全部断开已取消; done: 已出结果
    const hit = cache.get(key);
    if (hit && !hit.dead && Date.now() - hit.at < CACHE_TTL_MS) {
      hit.waiters++;
      return hit;
    }
    const entry = { at: Date.now(), waiters: 1, dead: false, done: false, kill: null, promise: null };
    entry.promise = queue.then(() => {
      if (entry.dead) throw new Error('canceled'); // 排队期间等待者已全部断开: 不再起进程
      return runPython(['--range', rangeKey, '--models', ms, '--sessions', ss],
        (kill) => { entry.kill = kill; });
    });
    entry.promise.then(() => { entry.done = true; }, () => { entry.done = true; });
    cache.set(key, entry);
    if (cache.size > CACHE_MAX) { // 超上限按插入顺序淘汰最旧条目
      for (const k of cache.keys()) {
        cache.delete(k);
        if (cache.size <= CACHE_MAX) break;
      }
    }
    entry.promise.catch(() => cache.delete(key)); // 失败(含取消)不缓存
    queue = entry.promise.catch(() => {}); // 链条继续
    return entry;
  }

  function sendJson(res, code, obj) {
    if (res.destroyed) return; // 客户端已断开, 不再写响应
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
      // 哨兵 = 显式空选(空数组), 不传 = 全部(null)
      const rawModels = url.searchParams.get('models');
      let models = null;
      if (rawModels === NONE) models = [];
      else if (rawModels) models = rawModels.split(',').map((s) => s.trim()).filter(Boolean);
      const rawSessions = url.searchParams.get('sessions');
      let sessions = null;
      if (rawSessions === NONE) sessions = [];
      else if (rawSessions) sessions = rawSessions.split(',').map((s) => s.trim()).filter(Boolean);
      const entry = queryBackend(rangeKey, models, sessions);
      // 客户端断开(如 reload() 取消旧请求)时放弃这次查询:
      // 还在排队就跳过, 已在跑就结束子进程, 别让新查询排在死请求后面。
      res.on('close', () => {
        if (res.writableEnded) return;
        entry.waiters--;
        if (entry.waiters > 0 || entry.done) return;
        entry.dead = true;
        if (entry.kill) entry.kill();
      });
      entry.promise
        .then((payload) => sendJson(res, 200, payload))
        .catch(async (err) => {
          // python 缺失时给出可自查的提示, 而非裸 ENOENT
          const hint = /ENOENT/i.test(String(err.message))
            ? ` (python unavailable, tried: ${(await pickPython()).join(' ')}; install Python 3.8+)`
            : '';
          sendJson(res, 502, { error: `backend unavailable: ${err.message}${hint}` });
        });
      return;
    }
    sendJson(res, 404, { error: 'not_found' });
  });
  // 默认 keepAliveTimeout(5s)与 5s 自动刷新同拍, 空闲连接恰在复用时被关,
  // 会偶发 "Failed to fetch"; 拉长空闲存活避开该竞态。
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;

  await listen(server, context.listen.host, context.listen.port);
  context.logger.info('miniapp.runtime.listening');

  // 预热首次查询(不阻塞就绪)
  queryBackend('all', null, null).promise.catch((err) => {
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
