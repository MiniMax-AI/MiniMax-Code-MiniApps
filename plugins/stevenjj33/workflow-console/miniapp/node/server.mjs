// @ts-check

/**
 * @typedef {import('./miniapp-api.js').JsonObject} JsonObject
 * @typedef {import('./miniapp-api.js').JsonValue} JsonValue
 * @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext
 * @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle
 */

import { spawn } from 'node:child_process';
import { readFile, readdir, mkdir, rm, rename, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
/* 上游自己的图模型：把静态拓扑和运行步骤合并成一张有向图。
   直接复用它而不是自己重写一份，图语义才不会和 Workflow Studio 漂移。
   该文件是纯逻辑、零依赖的 ESM。升级 vendor 时要一并检查这个引用。 */
import { workflowGraph } from './vendor/dynamic-workflows/web/graph-model.mjs';

/**
 * 可被中断的等待。事件流退避时用它，dispose 时能立刻醒来而不是干等。
 * @param {number} ms
 * @param {AbortSignal} [signal]
 */
function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(undefined);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(undefined);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(undefined);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Plugin run identifiers are UUIDs; service identifiers are truncated workspace hashes. */
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;const TEMPLATE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SERVICE_ID = /^(embedded|[0-9a-f]{12})$/;
const ENGINE_ID = 'embedded';
const ENGINE_TIMEOUT_MS = 30_000;
/** 宿主可能用这些环境变量表达当前项目目录。 */
const WORKSPACE_ENV_KEYS = ['MCODE_WORKSPACE', 'MCODE_PROJECT_DIR', 'PROJECT_DIR', 'WORKSPACE'];
/** 登记簿探测结果的缓存时长（毫秒）。 */
const REGISTERED_PROBE_TTL_MS = 30_000;
const LANGUAGE = /^(zh|en)$/;
const REPORT_FORMAT = /^(md|html)$/;
const MAX_BODY = 8 * 1024;
const WAIT_TIMEOUT_MS = 20_000;
const TERMINAL = new Set([
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
  'needs_attention',
  'completed_with_gaps',
]);

/**
 * 只有这些状态还可能产生新事件。
 * 上游 /wait 只在运行「活跃」时才做长轮询；非活跃运行会立刻返回空，
 * 这里必须退避，否则会变成热循环把引擎打满（实测能吃掉半个核）。
 */
const MAY_EMIT = new Set(['running', 'queued', 'pausing', 'stopping']);

/** 非活跃运行的事件流退避间隔（毫秒）。 */
const IDLE_POLL_MS = 2_000;

/**
 * @typedef {object} ServiceRecord
 * @property {string} id Opaque workspace-hash prefix; the only handle the page may use.
 * @property {string} origin Loopback origin of the Workflow Studio service.
 * @property {string} [token] Legacy credential fragment, if that service still requires one.
 * @property {boolean} live
 * @property {string | null} workspace
 * @property {string} [workspaceSource] 工作目录来源：env / learned / service / projects / cwd / home。
 * @property {number | null} pid
 * @property {string | null} executor
 * @property {boolean} mcodeAvailable
 * @property {JsonObject | null} scheduler
 * @property {JsonObject | null} defaults
 * @property {string | null} error
 */

/**
 * Start the console runtime: discover Workflow Studio services, proxy their JSON API onto the
 * Host-assigned loopback port, and stream run events to the page.
 * @param {MiniAppContext} context
 * @returns {Promise<MiniAppLifecycle>}
 */
export async function start(context) {
  const clientDir = join(context.pluginRoot, 'miniapp', 'client');
  const assets = {
    html: await readFile(join(clientDir, 'index.html')),
    app: await readFile(join(clientDir, 'app.js')),
    style: await readFile(join(clientDir, 'style.css')),
  };

  /** @type {Map<string, ServiceRecord>} */
  const services = new Map();
  /** @type {Set<import('node:http').ServerResponse>} */
  const streams = new Set();
  /** @type {Set<AbortController>} */
  const inflight = new Set();
  let discoveredAt = 0;
  /** @type {Promise<void> | null} */
  let discoverInFlight = null;
  let activeId = null;
  let preferredId = null;
  let closing = false;
  let userSelected = false;
  /** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
  let engineChild = null;
  /** @type {Promise<ServiceRecord | null> | null} */
  let engineReady = null;
  /** @type {ServiceRecord | null} */
  let engineRecord = null;
  /** 内置引擎是否正在拉起。启动期间它必须留在服务列表里，否则客户端会失去「启动中」信号。 */
  let engineStarting = false;
  /** 启动轮次令牌：旧的一轮结束时不能把新一轮的「启动中」状态清掉。 */
  let engineStartToken = 0;
  /** @type {string | null} */
  let learnedWorkspace = null;
  /** 已解析出的引擎工作目录；解析完成前为 null。 */
  /** @type {string | null} */
  let engineWorkspace = null;
  /** 工作目录来源，供前端区分「用户指定的」与「猜出来的」。 */
  /** @type {string} */
  let engineWorkspaceSource = 'home';
  /** 登记簿探测的缓存。 */
  /** @type {{at: number, value: string | null} | null} */
  let registeredProbe = null;
  /** @type {Promise<void>} */
  let engineExit = Promise.resolve();
  /** 隐藏记录的写队列：串行化「读-改-写」，避免并发互相覆盖。 */
  /** @type {Promise<any>} */
  let hiddenQueue = Promise.resolve();

  try {
    const stored = JSON.parse(await readFile(join(context.dataDir, 'selection.json'), 'utf8'));
    if (typeof stored?.serviceId === 'string') preferredId = stored.serviceId;
  } catch {
    preferredId = null;
  }
  try {
    const stored = JSON.parse(await readFile(join(context.dataDir, 'workspace.json'), 'utf8'));
    /* 存过的路径可能是旧版本留下的临时投放目录，读取时就要挡住，
       否则它会被当成「用户指定的项目」一直用下去。 */
    if (typeof stored?.workspace === 'string' && isAbsolute(stored.workspace) && !isImplausibleWorkspace(stored.workspace)) {
      learnedWorkspace = stored.workspace;
    }
  } catch {
    learnedWorkspace = null;
  }

  const projectsRoot = () => join(homedir(), '.mcode-dynamic-workflows', 'projects');

  /** @param {string} path */
  async function readJson(path) {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch {
      return null;
    }
  }

  /* 先把工作目录解析出来再开服务：首屏不能把宿主的临时投放目录当成用户项目显示出去。 */
  await resolveEngineWorkspace();

  /**
   * Only plain-HTTP loopback studio addresses may ever be contacted.
   * @param {unknown} value
   * @returns {{origin: string, token?: string} | null}
   */
  function loopbackOrigin(value) {
    if (typeof value !== 'string' || !value) return null;
    let url;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') return null;
    const token = url.hash ? url.hash.slice(1) : '';
    return token ? { origin: url.origin, token } : { origin: url.origin };
  }

  /**
   * Call one Workflow Studio service. The upstream address always comes from the discovered
   * registry; the page can never choose a host, port, or path.
   * @param {ServiceRecord} record
   * @param {string} path
   * @param {{method?: string, body?: JsonValue, timeoutMs?: number, raw?: boolean}} [options]
   */
  async function upstream(record, path, options = {}) {
    const { method = 'GET', body, timeoutMs = 10_000 } = options;
    /* dispose 之后才走到这里的请求不该再跑满超时，白占着连接。 */
    if (closing || context.signal.aborted) throw new Error('控制台正在关闭');
    const controller = new AbortController();
    inflight.add(controller);
    const onAbort = () => controller.abort();
    context.signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      /** @type {Record<string, string>} */
      const headers = { 'X-Workflow-Client': '1' };
      if (record.token) headers.Authorization = `Bearer ${record.token}`;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await fetch(record.origin + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      /** @type {JsonValue | null} */
      let parsed = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      if (!response.ok) {
        const message =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof parsed.error === 'string'
            ? parsed.error
            : `上游服务返回 ${response.status}`;
        throw new Error(message);
      }
      return { parsed, text, response };
    } finally {
      clearTimeout(timer);
      inflight.delete(controller);
      context.signal.removeEventListener('abort', onAbort);
    }
  }

  /**
   * 解析内置引擎绑定的工作目录。
   *
   * Mini App 运行时的 cwd 是宿主投放出来的临时目录（macOS 上形如
   * /private/var/folders/xx/yyyy/T/mavis-miniapp-xxxx/package），不是用户项目。
   * 所以每一层候选都必须先过 isImplausibleWorkspace()：识别出它只是第一步，
   * 真正要避免的是「识别了却照样拿它去跑 Agent」。
   *
   * 顺序：环境变量 → 用户上次指定的 → 正在运行的插件服务 → 引擎项目登记簿 → cwd → 用户主目录。
   * @returns {Promise<string>} 解析出的工作目录绝对路径
   */
  async function resolveEngineWorkspace() {
    for (const key of WORKSPACE_ENV_KEYS) {
      const value = process.env[key];
      if (value && isAbsolute(value) && !isImplausibleWorkspace(value)) {
        engineWorkspace = value;
        engineWorkspaceSource = 'env';
        return value;
      }
    }
    if (learnedWorkspace && !isImplausibleWorkspace(learnedWorkspace)) {
      engineWorkspace = learnedWorkspace;
      engineWorkspaceSource = 'learned';
      return learnedWorkspace;
    }
    const pluginService = [...services.values()].find(
      (record) => !record.embedded && record.live && record.workspace,
    );
    if (pluginService?.workspace && !isImplausibleWorkspace(pluginService.workspace)) {
      learnedWorkspace = pluginService.workspace;
      void persistLearnedWorkspace();
      engineWorkspace = learnedWorkspace;
      engineWorkspaceSource = 'service';
      return learnedWorkspace;
    }
    /* 登记簿里存着每个跑过的项目的绝对路径，取最近改动、且目录仍然存在的那一个。 */
    const registered = await findRegisteredWorkspace();
    if (registered) {
      engineWorkspace = registered;
      engineWorkspaceSource = 'projects';
      return registered;
    }
    const cwd = process.cwd();
    if (cwd && isAbsolute(cwd) && !isImplausibleWorkspace(cwd)) {
      engineWorkspace = cwd;
      engineWorkspaceSource = 'cwd';
      return cwd;
    }
    /* 兜底只能落在用户主目录，同时告诉前端「还没绑定到真实项目」。 */
    engineWorkspace = homedir();
    engineWorkspaceSource = 'home';
    return engineWorkspace;
  }

  /**
   * 从引擎的项目登记簿里找一个真实项目目录。
   *
   * 登记簿每个目录下的 endpoint.json / address.json 都记着该项目的绝对路径，
   * 这是宿主不告诉当前项目时（macOS 上尤其明显）最可靠的自动回退源。
   * @returns {Promise<string | null>} 找不到时返回 null
   */
  async function findRegisteredWorkspace() {
    /* 登记簿很少变，短时间内重复扫盘没有意义。 */
    const now = Date.now();
    if (registeredProbe && now - registeredProbe.at < REGISTERED_PROBE_TTL_MS) {
      return registeredProbe.value;
    }
    const value = await probeRegisteredWorkspace();
    registeredProbe = { at: now, value };
    return value;
  }

  /**
   * @returns {Promise<string | null>} 找不到时返回 null
   */
  async function probeRegisteredWorkspace() {
    /** @type {string[]} */
    let names = [];
    try {
      names = (await readdir(projectsRoot(), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && /^[0-9a-f]{64}$/.test(entry.name))
        .map((entry) => entry.name);
    } catch {
      return null;
    }
    /** @type {{workspace: string, mtime: number}[]} */
    const candidates = [];
    for (const name of names) {
      for (const file of ['endpoint.json', 'address.json']) {
        const path = join(projectsRoot(), name, file);
        const data = await readJson(path);
        const workspace = data?.workspace;
        if (typeof workspace !== 'string' || !isAbsolute(workspace)) continue;
        if (isImplausibleWorkspace(workspace)) continue;
        let mtime = 0;
        try {
          mtime = (await stat(path)).mtimeMs;
        } catch {
          /* 读不到就按最旧处理 */
        }
        candidates.push({ workspace, mtime });
        break;
      }
    }
    candidates.sort((a, b) => b.mtime - a.mtime);
    for (const candidate of candidates) {
      try {
        const info = await stat(candidate.workspace);
        if (info.isDirectory()) return candidate.workspace;
      } catch {
        /* 目录已被删掉，换下一个 */
      }
    }
    return null;
  }

  async function persistLearnedWorkspace() {
    if (!learnedWorkspace) return;
    try {
      await mkdir(context.dataDir, { recursive: true });
      await writeFileAtomic(
        join(context.dataDir, 'workspace.json'),
        JSON.stringify({ workspace: learnedWorkspace }, null, 2),
      );
    } catch (error) {
      context.logger.warn('miniapp.console.workspace_persist_failed', {
        message: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  /** 临时投放目录不是真实项目，运行真实 Agent 时必须让用户看到并可修正。 */
  function isImplausibleWorkspace(value) {
    if (typeof value !== 'string' || !value) return true;
    /* 只认宿主真正的投放目录与系统临时目录，
       不要把 D:\tmp\myproj 这类真实项目误判成临时目录。
       mavis-miniapp 是宿主投放目录的固定片段；
       /var/folders 与 /tmp 是 macOS 的系统临时目录，Windows 走 AppData\Local\Temp。 */
    return /mavis-miniapp|[\\/]AppData[\\/]Local[\\/]Temp[\\/]|[\\/]var[\\/]folders[\\/]|[\\/]private[\\/]tmp[\\/]|[\\/]var[\\/]tmp[\\/]/i.test(value);
  }

  /**
   * @param {{starting?: boolean}} [options]
   * @returns {ServiceRecord}
   */
  function enginePlaceholder(options = {}) {
    return {
      id: ENGINE_ID,
      origin: '',
      live: false,
      workspace: engineWorkspace,
      workspaceSource: engineWorkspaceSource,
      pid: null,
      executor: 'mcode',
      mcodeAvailable: false,
      scheduler: null,
      defaults: null,
      error: null,
      embedded: true,
      starting: options.starting !== false,
    };
  }

  /** Start (or reuse) the vendored engine and wait until its HTTP surface answers. */
  function startEmbedded() {
    if (engineReady) return engineReady;
    const token = ++engineStartToken;
    engineStarting = true;
    /* 链条用局部变量承载：stopEmbedded() 会把 engineReady 置空，
       若在出口再对 engineReady 链式赋值就会踩到 null。 */
    const chain = (async () => {
      /* 上一实例可能还占着端口，等它真正退出再拉起。 */
      await engineExit;
      /* 先扫一遍服务列表：宿主不告诉当前项目时，正在运行的项目服务是最好的线索。
         engineStarting 已在链外同步置位，所以这次扫描里内置引擎是以「启动中」入列的，
         activeService() 不会临时落到别的项目上。 */
      await discover();
      const entry = join(context.pluginRoot, 'miniapp', 'node', 'vendor', 'dynamic-workflows', 'dist', 'main.mjs');
      const engineDir = join(context.dataDir, 'engine');
      const workspace = await resolveEngineWorkspace();
      await mkdir(engineDir, { recursive: true });

      for (let attempt = 1; attempt <= 2; attempt += 1) {
        /* 期间若已有人重启过引擎（token 变了），这一轮就别再拉进程了，
           否则会出现两个引擎实例、其中一个失去引用永远收不掉。 */
        if (token !== engineStartToken) return engineRecord;
        const outcome = await spawnEngineAttempt(entry, engineDir, workspace, attempt, token);
        if (outcome) return outcome;
        /* 端口被上一次崩溃留下的实例占用时，清掉端口簿记再试一次（历史记录不受影响）。 */
        if (attempt === 1) {
          await rm(join(engineDir, 'address.json'), { force: true });
          await rm(join(engineDir, 'endpoint.json'), { force: true });
        }
      }
      const failed = enginePlaceholder();
      failed.starting = false;
      failed.error = '内置引擎启动失败，请查看 dataDir/engine/service.log';
      engineRecord = failed;
      return failed;
    })().catch((error) => {
      context.logger.error('miniapp.console.engine_start_failed', {
        message: error instanceof Error ? error.message : 'unknown',
      });
      const failed = enginePlaceholder({ starting: false });
      failed.error = '内置引擎启动失败';
      engineRecord = failed;
      return failed;
    });
    const settled = chain.then(
      (value) => {
        if (token === engineStartToken) engineStarting = false;
        return value;
      },
      (error) => {
        if (token === engineStartToken) engineStarting = false;
        throw error;
      },
    );
    engineReady = settled;
    return settled;
  }

  /**
   * @param {string} entry
   * @param {string} engineDir
   * @param {string} workspace
   * @param {number} attempt
   * @param {number} [token] 启动轮次令牌；不匹配说明期间已有人重启过引擎
   * @returns {Promise<ServiceRecord | null>} 成功时返回可用记录，失败时返回 null
   */
  async function spawnEngineAttempt(entry, engineDir, workspace, attempt, token = engineStartToken) {
    /* 拉起进程前再确认一次轮次：避免和更新的一轮抢同一个端口，留下收不掉的孤儿进程。 */
    if (token !== engineStartToken) return null;
    let child;
    try {
      child = spawn(process.execPath, [entry, '--workspace', workspace, '--data-dir', engineDir], {
        cwd: workspace,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      context.logger.error('miniapp.console.engine_spawn_failed', {
        message: error instanceof Error ? error.message : 'unknown',
      });
      return null;
    }
    engineChild = child;
    child.stdout?.on('data', (chunk) =>
      context.logger.debug('miniapp.console.engine_stdout', { line: String(chunk).slice(0, 200) }),
    );
    child.stderr?.on('data', (chunk) =>
      context.logger.warn('miniapp.console.engine_stderr', { line: String(chunk).slice(0, 300) }),
    );
    child.once('error', (error) => {
      context.logger.error('miniapp.console.engine_error', {
        message: error instanceof Error ? error.message : 'unknown',
      });
    });

    const record = enginePlaceholder();
    let exited = false;
    child.once('exit', () => {
      exited = true;
      if (engineChild === child) {
        engineChild = null;
        /* 只清掉本轮自己的句柄，别把更新一轮的启动链也带走。 */
        if (token === engineStartToken) engineReady = null;
      }
    });

    const deadline = Date.now() + ENGINE_TIMEOUT_MS;
    while (Date.now() < deadline && !context.signal.aborted) {
      const address = await readJson(join(engineDir, 'address.json'));
      const target = loopbackOrigin(address?.url);
      if (target) {
        record.origin = target.origin;
        record.token = target.token;
        try {
          const { parsed } = await upstream(record, '/api/config', { timeoutMs: 3_000 });
          const config =
            parsed && typeof parsed === 'object' && !Array.isArray(parsed)
              ? /** @type {Record<string, JsonValue>} */ (parsed)
              : {};
          /* address.json 是持久端口簿记：上一次崩溃或尚未退出的实例可能仍占着同一个端口。
             只有确认应答者就是刚拉起的这个子进程，才算就绪，否则继续等待。 */
          if (typeof config.pid === 'number' && config.pid !== child.pid) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            continue;
          }
          record.live = true;
          record.starting = false;
          if (typeof config.workspace === 'string') record.workspace = config.workspace;
          if (typeof config.pid === 'number') record.pid = config.pid;
          if (typeof config.executor === 'string') record.executor = config.executor;
          record.mcodeAvailable = config.mcodeAvailable === true;
          record.scheduler =
            config.scheduler && typeof config.scheduler === 'object' ? config.scheduler : null;
          record.defaults = config.defaults && typeof config.defaults === 'object' ? config.defaults : null;
          engineRecord = record;
          context.logger.info('miniapp.console.engine_ready');
          return record;
        } catch {
          /* 服务尚未监听完成，继续等待。 */
        }
      }
      if (exited) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    record.starting = false;
    if (exited) {
      /* 子进程提前退出：多为端口占用或工作目录问题，交由调用方重试或上报。 */
      context.logger.warn('miniapp.console.engine_exited', { attempt });
      return null;
    }
    /* 没退出但也没就绪：按失败处理并收掉进程。 */
    stopEmbedded();
    record.error = '内置引擎启动超时';
    engineRecord = record;
    return record;
  }

  /** Terminate the engine and its process tree, and make the next start wait for it. */
  function stopEmbedded() {
    const child = engineChild;
    engineChild = null;
    engineReady = null;
    engineRecord = null;
    engineStarting = false;
    engineStartToken += 1;
    if (!child || child.exitCode !== null || child.signalCode !== null || typeof child.pid !== 'number') {
      engineExit = Promise.resolve();
      return;
    }
    const pid = child.pid;
    try {
      child.kill('SIGTERM');
    } catch {
      /* 进程可能已经退出 */
    }
    engineExit = new Promise((resolve) => {
      let settled = false;
      /** @type {NodeJS.Timeout | null} */
      let killTimer = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        resolve(undefined);
      };
      /* Windows 上 Node 不转发信号给子进程树，超时后强制清理整棵树。 */
      const timer = setTimeout(() => {
        try {
          spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        } catch {
          /* 平台限制；进程随后会随父进程退出。 */
        }
        killTimer = setTimeout(finish, 800);
      }, 2_000);
      /* 这里不能 unref：宿主若在 2 秒内退出，taskkill 就永远不会执行，引擎会变孤儿。 */
      child.once('exit', finish);
    });
  }

  /**
   * Re-scan every project service directory and probe each candidate address.
   * 并发调用会合并成同一次扫描：每个候选目录都要探一次 /api/config，
   * 不合并的话每次轮询都会把所有已退出的项目重探一遍。
   * @returns {Promise<void>}
   */
  function discover() {
    if (discoverInFlight) return discoverInFlight;
    discoverInFlight = discoverOnce().finally(() => {
      discoverInFlight = null;
    });
    return discoverInFlight;
  }

  async function discoverOnce() {
    /** @type {string[]} */
    let names = [];
    try {
      names = (await readdir(projectsRoot(), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && /^[0-9a-f]{64}$/.test(entry.name))
        .map((entry) => entry.name);
    } catch {
      /* 插件服务目录不存在不等于出错，只是「本机没有任何项目服务」。
         这里不能提前 return：下面注册内置引擎的逻辑会被跳过，
         服务列表永远是空的，控制台会一直显示「未发现任何 Workflow Studio 项目服务」，
         即使内置引擎已经正常起来。 */
      names = [];
    }
    /** @type {ServiceRecord[]} */
    const found = [];
    await Promise.all(
      names.map(async (name) => {
        const address = await readJson(join(projectsRoot(), name, 'address.json'));
        const endpoint = await readJson(join(projectsRoot(), name, 'endpoint.json'));
        const target = loopbackOrigin(address?.url) ?? loopbackOrigin(endpoint?.url);
        if (!target) return;
        /** @type {ServiceRecord} */
        const record = {
          id: name.slice(0, 12),
          origin: target.origin,
          token: target.token,
          live: false,
          workspace: typeof address?.workspace === 'string' ? address.workspace : null,
          pid: typeof endpoint?.pid === 'number' ? endpoint.pid : null,
          executor: null,
          mcodeAvailable: false,
          scheduler: null,
          defaults: null,
          error: null,
        };
        try {
          const { parsed } = await upstream(record, '/api/config', { timeoutMs: 3_000 });
          const config =
            parsed && typeof parsed === 'object' && !Array.isArray(parsed)
              ? /** @type {Record<string, JsonValue>} */ (parsed)
              : {};
          record.live = true;
          if (typeof config.workspace === 'string') record.workspace = config.workspace;
          if (typeof config.pid === 'number') record.pid = config.pid;
          if (typeof config.executor === 'string') record.executor = config.executor;
          record.mcodeAvailable = config.mcodeAvailable === true;
          record.scheduler = config.scheduler && typeof config.scheduler === 'object' ? config.scheduler : null;
          record.defaults = config.defaults && typeof config.defaults === 'object' ? config.defaults : null;
        } catch (error) {
          record.error = error instanceof Error ? error.message : '服务不可用';
        }
        found.push(record);
      }),
    );
    found.sort((a, b) => Number(b.live) - Number(a.live) || String(a.workspace).localeCompare(String(b.workspace)));
    services.clear();
    /* 内置引擎必须始终占位：即便正在启动、就绪记录尚未产出，也不能从列表里消失。
       否则客户端会失去「启动中」信号而不再拉 bootstrap，内置引擎就再也回不来了。 */
    if (engineRecord) services.set(ENGINE_ID, engineRecord);
    else services.set(ENGINE_ID, enginePlaceholder({ starting: engineStarting }));
    for (const record of found) services.set(record.id, record);
    discoveredAt = Date.now();
  }

  /**
   * Resolve the service the console points at. An explicit user selection wins even when the
   * service is stopped, so the page can report that project's state instead of silently
   * snapping back to another project.
   * 默认使用内置引擎——控制台自带引擎，不需要插件在场。
   * 只有本次会话里用户主动切换过的项目才优先；否则历史里保存的选择不覆盖内置引擎。
   * @param {{maxAgeMs?: number}} [options]
   * @returns {Promise<ServiceRecord | null>}
   */
  async function activeService(options = {}) {
    const maxAgeMs = options.maxAgeMs ?? 0;
    if (!discoveredAt || Date.now() - discoveredAt > maxAgeMs || !services.size) await discover();
    const current = activeId ? services.get(activeId) : undefined;
    const preferred = preferredId ? services.get(preferredId) : undefined;
    /* 本次会话里用户主动切换过的项目优先。 */
    if (current && userSelected) return current;
    const embedded = services.get(ENGINE_ID);
    /* 内置引擎就绪 → 默认用它；还在启动 → 保持在它上面，不要临时跳到别的项目，
       否则控制台会在启动窗口里闪出另一个项目的运行记录。 */
    if (embedded?.live) {
      activeId = ENGINE_ID;
      return embedded;
    }
    if (embedded?.starting) {
      activeId = ENGINE_ID;
      return embedded;
    }
    if (preferred?.live) {
      activeId = preferred.id;
      return preferred;
    }
    if (current?.live) return current;
    const fallback = [...services.values()].find((record) => record.live) ?? null;
    activeId = fallback?.id ?? null;
    return fallback;
  }

  /**
   * A live service is required for every business read and write.
   * @param {{maxAgeMs?: number}} [options]
   */
  async function liveService(options = {}) {
    const service = await activeService(options);
    if (!service) return null;
    if (service.id === ENGINE_ID) {
      /* 首次访问时顺带把内置引擎拉起来，不让用户先去跑一次工作流。 */
      const ready = service.live ? service : await startEmbedded();
      return ready?.live ? ready : null;
    }
    return service.live ? service : null;
  }

  /** @param {ServiceRecord} record */
  function publicService(record) {
    return {
      id: record.id,
      live: record.live,
      workspace: record.workspace,
      workspaceSource: record.workspaceSource ?? null,
      executor: record.executor,
      mcodeAvailable: record.mcodeAvailable,
      scheduler: record.scheduler,
      defaults: record.defaults,
      error: record.error,
      embedded: record.embedded === true,
      starting: record.starting === true,
      /* 两种情况都不该直接拿去跑真实 Agent：
         目录本身不可信（宿主的临时投放目录），或者只是兜底猜出来的（用户主目录）。 */
      needsWorkspace:
        record.embedded === true &&
        (isImplausibleWorkspace(record.workspace) || record.workspaceSource === 'home'),
    };
  }

  /**
   * Keep the run list light. The sidebar polls every few seconds, so scripts, topology trees and
   * per-node prompts/outputs must not travel with the list; the detail view fetches them once.
   * @param {JsonValue} run
   */
  function summarizeRun(run) {
    const { topology, script, input, fingerprints, steps, ...rest } = /** @type {Record<string, JsonValue>} */ (run);
    const compactSteps = Array.isArray(steps)
      ? steps.map((step) => {
          const { prompt, input: stepInput, output, rawOutput, usage, usageHistory, ...restStep } = /** @type {Record<string, JsonValue>} */ (step);
          return restStep;
        })
      : [];
    return { ...rest, steps: compactSteps };
  }

  /**
   * 流程图数据：阶段、节点、依赖。
   *
   * 直接用上游的 workflowGraph（vendor/dynamic-workflows/web/graph-model.mjs），
   * 这样控制台画出来的图和 Workflow Studio 是同一套语义：
   * 静态拓扑的计划节点与运行中真实产生的步骤会合并成同一张图，
   * 依赖边也统一到同一套节点 id 上。
   *
   * 只保留画图需要的字段——完整节点里带 output/prompt/rawOutput，
   * 全量透传会把快照体积翻一倍。
   * @param {Record<string, JsonValue>} run
   * @param {boolean} planOnly
   */
  function graphFor(run, planOnly) {
    const graph = workflowGraph(/** @type {any} */ (run), { planOnly });
    return {
      phases: graph.phases.map((phase) => ({ id: phase.id, label: phase.label })),
      nodes: graph.nodes.map((item) => ({
        id: item.id,
        stepId: item.stepId,
        actualId: item.actualId,
        label: item.label,
        phase: item.phase,
        kind: item.kind,
        status: item.status,
        dependsOn: item.dependsOn,
        placeholder: item.placeholder,
        dynamic: item.dynamic,
        conditional: item.conditional,
        startedAt: item.startedAt,
        endedAt: item.endedAt,
        attempt: item.attempt,
        error: item.error,
        prompt: item.prompt,
        source: item.source,
      })),
    };
  }

  /**
   * 上游 0.8.2 没有删除运行的接口（只有 deleteTemplate），所以「删除」只作用于本面板视图：
   * 运行记录仍保留在 Workflow Studio 里，可以在「已隐藏」里恢复。
   */
  async function hiddenRunIds() {
    const stored = await readJson(join(context.dataDir, 'hidden-runs.json'));
    const list = stored?.runs;
    return new Set(Array.isArray(list) ? list.filter((id) => typeof id === 'string') : []);
  }

  /**
   * 原子写：先写临时文件再改名。
   * 直接覆盖目标文件时若进程在写一半被杀，JSON 会截断，
   * 读的时候异常被吞掉 → 全部隐藏记录复活。
   * @param {string} file
   * @param {string} content
   */
  async function writeFileAtomic(file, content) {
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, content, 'utf8');
    await rename(temp, file);
  }

  /**
   * @param {string} runId
   * @param {boolean} hidden
   */
  async function setRunHidden(runId, hidden) {
    /* 串行化：并发两次隐藏会「读-改-写」互相覆盖，后写的那次把前一次的结果冲掉。 */
    return hiddenQueue = hiddenQueue.then(async () => {
      const set = await hiddenRunIds();
      if (hidden) set.add(runId);
      else set.delete(runId);
      await mkdir(context.dataDir, { recursive: true });
      await writeFileAtomic(
        join(context.dataDir, 'hidden-runs.json'),
        JSON.stringify({ runs: [...set] }, null, 2),
      );
      return [...set];
    });
  }

  /**
   * @param {import('node:http').ServerResponse} response
   * @param {number} status
   * @param {JsonValue} payload
   */
  function sendJson(response, status, payload) {
    const body = JSON.stringify(payload);
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(body);
  }

  /** @param {import('node:http').IncomingMessage} request */
  function sameOrigin(request) {
    const site = request.headers['sec-fetch-site'];
    if (site === 'cross-site' || site === 'same-site') return false;
    const origin = request.headers.origin;
    if (!origin) return true;
    try {
      return new URL(origin).host === request.headers.host;
    } catch {
      return false;
    }
  }

  /** @param {import('node:http').IncomingMessage} request */
  async function readJsonBody(request) {
    let raw = '';
    for await (const chunk of request) {
      raw += chunk;
      if (Buffer.byteLength(raw) > MAX_BODY) throw new Error('请求体过大');
    }
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('请求体格式无效');
    return parsed;
  }

  /** @param {JsonValue} payload */
  function broadcast(payload) {
    const frame = `data: ${JSON.stringify(payload)}\n\n`;
    for (const stream of streams) {
      try {
        stream.write(frame);
      } catch {
        streams.delete(stream);
      }
    }
  }

  /**
   * Read one bound business record; throws when no live project service is reachable.
   * @param {string | null} runId
   */
  async function requireRun(runId) {
    if (!runId || !RUN_ID.test(runId)) throw new Error('运行标识无效');
    const service = await liveService({ maxAgeMs: 30_000 });
    if (!service) throw new Error('本机没有正在运行的 Workflow Studio 服务，请先在对话中运行一次动态工作流');
    const { parsed } = await upstream(service, `/api/runs/${runId}`);
    const run =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? /** @type {Record<string, JsonValue>} */ (parsed)
        : null;
    if (!run) throw new Error('无法读取该运行');
    return { service, run };
  }

  /**
   * 往 SSE 响应写一帧。
   * dispose() 会先 end() 掉所有流，此时在途的长轮询返回后若再 write，
   * Node 会抛出未捕获的 ERR_STREAM_WRITE_AFTER_END，把整个进程带走。
   * @param {import('node:http').ServerResponse} response
   * @param {unknown} payload
   */
  function writeFrame(response, payload) {
    if (response.writableEnded || response.destroyed) return false;
    try {
      response.write(`data: ${JSON.stringify(payload)}\n\n`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Long-poll the studio event log and fan it out to the page over Server-Sent Events.
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:http').ServerResponse} response
   * @param {string} runId
   * @param {number} after
   */
  async function streamEvents(request, response, runId, after) {
    const service = await liveService({ maxAgeMs: 30_000 });
    if (!service) {
      sendJson(response, 503, { error: '本机没有正在运行的 Workflow Studio 服务' });
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Content-Type-Options': 'nosniff',
    });
    response.write('retry: 2000\n\n');
    streams.add(response);
    let cursor = after;
    let ended = false;
    let lastStatus = '';
    /* 连接被对端掐断时不要让 'error' 变成未捕获异常。 */
    response.on('error', () => {
      ended = true;
      streams.delete(response);
    });
    request.on('close', () => {
      ended = true;
      streams.delete(response);
    });
    while (!ended && !closing && !context.signal.aborted) {
      let payload;
      try {
        const { parsed } = await upstream(service, `/api/runs/${runId}/wait?after=${cursor}`, {
          timeoutMs: WAIT_TIMEOUT_MS + 5_000,
        });
        payload = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch (error) {
        const message = error instanceof Error ? error.message : '事件流中断';
        writeFrame(response, { error: message });
        break;
      }
      const record = /** @type {Record<string, JsonValue>} */ (payload);
      const next = typeof record.nextSequence === 'number' ? record.nextSequence : cursor;
      const events = Array.isArray(record.events) ? record.events : [];
      cursor = next;
      const status = typeof record.status === 'string' ? record.status : '';
      /* 只在真的有新内容或状态变化时写帧，避免空转时把客户端刷爆。 */
      if (events.length || status !== lastStatus) {
        lastStatus = status;
        writeFrame(response, { events, nextSequence: next, status: status || null });
      }
      if (TERMINAL.has(status) && events.length === 0) {
        response.end();
        streams.delete(response);
        ended = true;
        break;
      }
      /* 上游 /wait 只在运行活跃时才长轮询；待审核/已暂停等非活跃运行会立刻返回空。
         这里必须退避，否则就是热循环——实测能把引擎白烧掉半个核。 */
      if (!events.length && !MAY_EMIT.has(status)) {
        await sleep(IDLE_POLL_MS, context.signal);
      }
    }
    if (!ended) response.end();
    streams.delete(response);
  }

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://miniapp.local');
      const { pathname } = url;
      const method = request.method ?? 'GET';

      try {
        if (pathname === '/dashboard' && method === 'GET') {
          response.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy':
              "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
          });
          response.end(assets.html);
          return;
        }
        if (pathname === '/app.js' && method === 'GET') {
          response.writeHead(200, {
            'Content-Type': 'text/javascript; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          });
          response.end(assets.app);
          return;
        }
        if (pathname === '/style.css' && method === 'GET') {
          response.writeHead(200, {
            'Content-Type': 'text/css; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          });
          response.end(assets.style);
          return;
        }

        if (!pathname.startsWith('/api/')) {
          sendJson(response, 404, { error: 'not_found' });
          return;
        }
        if (!sameOrigin(request)) {
          sendJson(response, 403, { error: '拒绝跨站请求' });
          return;
        }

        // Read-only views.
        if (pathname === '/api/bootstrap' && method === 'GET') {
          /* 打开控制台就把内置引擎带起来，用户不必先去跑一次工作流。
             必须排在 discover() 之前：否则第一次扫描时内置引擎还没进入启动态，
             activeService() 会临时落到别的项目上，首屏显示的就是别人的运行记录。 */
          if (!engineReady && !engineRecord?.live) void startEmbedded();
          await discover();
          const service = await activeService({ maxAgeMs: 5_000 });
          const hidden = await hiddenRunIds();
          /** @type {JsonValue[]} */
          let runs = [];
          let offline = true;
          if (service?.live) {
            try {
              const list = await upstream(service, '/api/runs', { timeoutMs: 8_000 });
              runs = Array.isArray(list.parsed)
                ? list.parsed
                    .map((run) => summarizeRun(run))
                    .filter((run) => run && typeof run === 'object' && !hidden.has(/** @type {string} */ (/** @type {Record<string, JsonValue>} */ (run).id)))
                : [];
              offline = false;
            } catch (error) {
              /* 上游中途失联：保留服务清单，交由页面显示离线提示，而不是整页报错。 */
              context.logger.warn('miniapp.console.runs_unavailable', {
                message: error instanceof Error ? error.message : 'unknown',
              });
            }
          }
          sendJson(response, 200, {
            services: [...services.values()].map(publicService),
            activeServiceId: service?.id ?? null,
            runs,
            hidden: [...hidden],
            offline,
            serverTime: Date.now(),
          });
          return;
        }

        if (pathname === '/api/hidden' && method === 'GET') {
          sendJson(response, 200, { hidden: [...(await hiddenRunIds())] });
          return;
        }

        if (pathname === '/api/workspace' && method === 'GET') {
          sendJson(response, 200, { workspace: await resolveEngineWorkspace(), source: engineWorkspaceSource });
          return;
        }

        if (pathname === '/api/templates' && method === 'GET') {
          const service = await liveService({ maxAgeMs: 30_000 });
          if (!service) {
            sendJson(response, 200, { templates: [], offline: true });
            return;
          }
          const { parsed } = await upstream(service, '/api/templates', { timeoutMs: 8_000 });
          sendJson(response, 200, {
            templates: Array.isArray(parsed) ? parsed : [],
            offline: false,
          });
          return;
        }

        const templateMatch = pathname.match(/^\/api\/templates\/([^/]+)$/i);
        if (templateMatch && method === 'GET') {
          if (!TEMPLATE_ID.test(templateMatch[1])) {
            sendJson(response, 400, { error: '模板标识无效' });
            return;
          }
          const service = await liveService({ maxAgeMs: 30_000 });
          if (!service) {
            sendJson(response, 503, { error: '当前没有可用的 Workflow Studio 服务' });
            return;
          }
          const { parsed } = await upstream(service, `/api/templates/${templateMatch[1]}`);
          sendJson(response, 200, { template: parsed });
          return;
        }

        if (pathname === '/api/runs' && method === 'GET') {
          const service = await liveService({ maxAgeMs: 30_000 });
          if (!service) {
            sendJson(response, 200, { runs: [], offline: true });
            return;
          }
          const hidden = await hiddenRunIds();
          const { parsed } = await upstream(service, '/api/runs');
          const runs = Array.isArray(parsed)
            ? parsed
                .map((run) => summarizeRun(run))
                .filter(
                  (run) =>
                    run &&
                    typeof run === 'object' &&
                    !hidden.has(/** @type {string} */ (/** @type {Record<string, JsonValue>} */ (run).id)),
                )
            : [];
          sendJson(response, 200, { runs, hidden: [...hidden], offline: false });
          return;
        }

        const runMatch = pathname.match(/^\/api\/runs\/([0-9a-f-]+)(\/[a-z]+)?$/i);
        if (runMatch && method === 'GET' && !runMatch[2]) {
          const { run } = await requireRun(runMatch[1]);
          const { script, input, fingerprints, ...rest } = /** @type {Record<string, JsonValue>} */ (run);
          sendJson(response, 200, {
            ...rest,
            graph: graphFor(run, false),
            planGraph: graphFor(run, true),
          });
          return;
        }

        const streamMatch = pathname.match(/^\/api\/runs\/([^/]+)\/events$/i);
        if (streamMatch && method === 'GET') {
          if (!RUN_ID.test(streamMatch[1])) {
            sendJson(response, 400, { error: '运行标识无效' });
            return;
          }
          const afterRaw = Number(url.searchParams.get('after') ?? '0');
          const after = Number.isInteger(afterRaw) && afterRaw >= 0 ? afterRaw : 0;
          await streamEvents(request, response, streamMatch[1], after);
          return;
        }

        const reportMatch = pathname.match(/^\/api\/runs\/([^/]+)\/report$/i);
        if (reportMatch && method === 'GET') {
          if (!RUN_ID.test(reportMatch[1])) {
            sendJson(response, 400, { error: '运行标识无效' });
            return;
          }
          const format = url.searchParams.get('format') ?? 'md';
          const language = url.searchParams.get('language') ?? 'zh';
          if (!REPORT_FORMAT.test(format) || !LANGUAGE.test(language)) {
            sendJson(response, 400, { error: '导出格式或语言无效' });
            return;
          }
          const service = await liveService({ maxAgeMs: 30_000 });
          if (!service) {
            sendJson(response, 503, { error: '本机没有正在运行的 Workflow Studio 服务' });
            return;
          }
          const result = await upstream(service, `/api/runs/${reportMatch[1]}/report?format=${format}&language=${language}`, {
            timeoutMs: 15_000,
          });
          response.writeHead(200, {
            'Content-Type':
              result.response.headers.get('content-type') ?? 'application/octet-stream',
            'Content-Disposition':
              result.response.headers.get('content-disposition') ?? `attachment; filename="report.${format}"`,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          });
          response.end(result.text);
          return;
        }

        // Studio hand-off: the page never learns the studio address, it only navigates here.
        if (pathname === '/api/studio' && method === 'GET') {
          const service = await activeService({ maxAgeMs: 30_000 });
          if (!service) {
            sendJson(response, 503, { error: '本机没有正在运行的 Workflow Studio 服务' });
            return;
          }
          const run = url.searchParams.get('run');
          const target = new URL(service.origin);
          target.searchParams.set('run', run && RUN_ID.test(run) ? run : '');
          response.writeHead(302, { Location: target.toString(), 'Cache-Control': 'no-store' });
          response.end();
          return;
        }

        // Mutations.
        if (method === 'POST') {
          /* 服务切换与重新扫描必须在「必须有可用服务」之前处理：否则指向已停服务的项目
             将无法切走，用户会被锁在离线状态里。 */
          if (pathname === '/api/service/select') {
            const body = /** @type {Record<string, JsonValue>} */ (await readJsonBody(request));
            const id = typeof body.serviceId === 'string' ? body.serviceId : '';
            if (!SERVICE_ID.test(id) || !services.has(id)) {
              sendJson(response, 400, { error: '未知的项目服务' });
              return;
            }
            preferredId = id;
            activeId = id;
            userSelected = true;
            await mkdir(context.dataDir, { recursive: true });
            await writeFile(join(context.dataDir, 'selection.json'), JSON.stringify({ serviceId: id }), 'utf8');
            broadcast({ type: 'service-changed', serviceId: id });
            sendJson(response, 200, { activeServiceId: id });
            return;
          }

          if (pathname === '/api/workspace') {
            const body = /** @type {Record<string, JsonValue>} */ (await readJsonBody(request));
            const value = typeof body.workspace === 'string' ? body.workspace.trim() : '';
            if (!value || !isAbsolute(value)) {
              sendJson(response, 400, { error: '请填写绝对路径的工作目录' });
              return;
            }
            let info;
            try {
              info = await stat(value);
            } catch {
              info = null;
            }
            if (!info?.isDirectory()) {
              sendJson(response, 400, { error: '该目录不存在' });
              return;
            }
            learnedWorkspace = value;
            engineWorkspace = value;
            engineWorkspaceSource = 'learned';
            await persistLearnedWorkspace();
            /* 工作目录变了，已运行中的引擎必须重启才能重新绑定。 */
            const wasLive = Boolean(engineRecord?.live);
            stopEmbedded();
            /* 立刻按新目录重新拉起，别等下一轮轮询——否则中间会有一段没有后端的空窗。 */
            void startEmbedded();
            sendJson(response, 200, { workspace: value, restarted: wasLive });
            return;
          }

          if (pathname === '/api/service/refresh') {
            await discover();
            sendJson(response, 200, {
              services: [...services.values()].map(publicService),
              activeServiceId: activeId,
            });
            return;
          }

          /* 隐藏/恢复是纯本地面板状态，不该依赖后端在线——
             和 service/select 一样要排在可用性检查之前。 */
          const visibilityMatch = pathname.match(/^\/api\/runs\/([^/]+)\/(hide|unhide)$/i);
          if (visibilityMatch) {
            if (!RUN_ID.test(visibilityMatch[1])) {
              sendJson(response, 400, { error: '运行标识无效' });
              return;
            }
            const hidden = visibilityMatch[2].toLowerCase() === 'hide';
            const list = await setRunHidden(visibilityMatch[1], hidden);
            broadcast({ type: 'hidden-changed' });
            sendJson(response, 200, { hidden: list });
            return;
          }

          const service = await liveService({ maxAgeMs: 30_000 });
          if (!service) {
            sendJson(response, 503, { error: '本机没有正在运行的 Workflow Studio 服务' });
            return;
          }

          if (pathname === '/api/templates') {
            const body = /** @type {Record<string, JsonValue>} */ (await readJsonBody(request));
            const runId = typeof body.runId === 'string' ? body.runId : '';
            if (!RUN_ID.test(runId)) {
              sendJson(response, 400, { error: '运行标识无效' });
              return;
            }
            const { run } = await requireRun(runId);
            const runRecord = /** @type {Record<string, JsonValue>} */ (run);
            const revision = runRecord.revision;
            const name =
              typeof body.name === 'string' && body.name.trim()
                ? body.name.trim().slice(0, 120)
                : String(runRecord.name || '').slice(0, 120);
            if (!name) {
              sendJson(response, 400, { error: '模板名称不能为空' });
              return;
            }
            if (typeof revision !== 'number') {
              sendJson(response, 400, { error: '无法读取该运行的版本号，请刷新后重试' });
              return;
            }
            const { parsed } = await upstream(service, '/api/templates', {
              method: 'POST',
              body: { runId, name, revision },
              timeoutMs: 15_000,
            });
            sendJson(response, 201, { template: parsed });
            return;
          }

          const templateUseMatch = pathname.match(/^\/api\/templates\/([^/]+)\/use$/i);
          if (templateUseMatch && method === 'POST') {
            if (!TEMPLATE_ID.test(templateUseMatch[1])) {
              sendJson(response, 400, { error: '模板标识无效' });
              return;
            }
            const body = /** @type {Record<string, JsonValue>} */ (await readJsonBody(request));
            const { parsed } = await upstream(service, `/api/templates/${templateUseMatch[1]}`, {
              timeoutMs: 10_000,
            });
            const definition =
              parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? /** @type {Record<string, JsonValue>} */ (parsed).definition
                : null;
            const spec =
              definition && typeof definition === 'object' && !Array.isArray(definition)
                ? /** @type {Record<string, JsonValue>} */ (definition)
                : null;
            if (!spec) {
              sendJson(response, 400, { error: '模板内容不完整，无法复用' });
              return;
            }
            const label =
              typeof body.name === 'string' && body.name.trim()
                ? body.name.trim().slice(0, 120)
                : `${String(spec.name || '模板')} · 副本`;
            const { parsed: created } = await upstream(service, '/api/runs', {
              method: 'POST',
              body: {
                requestId: `console-template-${templateUseMatch[1]}-${Date.now()}`,
                ...spec,
                name: label,
              },
              timeoutMs: 20_000,
            });
            sendJson(response, 201, { run: created });
            return;
          }

          if (templateMatch && method === 'POST') {
            if (!TEMPLATE_ID.test(templateMatch[1])) {
              sendJson(response, 400, { error: '模板标识无效' });
              return;
            }
            const body = /** @type {Record<string, JsonValue>} */ (await readJsonBody(request));
            if (body.action === 'delete') {
              await upstream(service, `/api/templates/${templateMatch[1]}`, {
                method: 'POST',
                body: { action: 'delete' },
                timeoutMs: 10_000,
              });
              sendJson(response, 200, { deleted: true });
              return;
            }
            sendJson(response, 400, { error: '模板操作无效' });
            return;
          }

          const actionMatch = pathname.match(/^\/api\/runs\/([0-9a-f-]+)\/(approve|pause|cancel|resume)$/i);
          if (actionMatch) {
            const runId = actionMatch[1];
            const action = actionMatch[2].toLowerCase();
            const { run } = await requireRun(runId);
            const revision = /** @type {Record<string, JsonValue>} */ (run).revision;
            /** @type {JsonObject} */
            let body = {};
            if (action === 'approve') {
              const requested = /** @type {Record<string, JsonValue>} */ (await readJsonBody(request));
              if (requested.revision !== revision) {
                sendJson(response, 409, { error: '审核版本已更新，请刷新后再开始执行' });
                return;
              }
              body = { revision };
            }
            if (action === 'resume') {
              const requested = /** @type {Record<string, JsonValue>} */ (await readJsonBody(request));
              body = { confirmStopped: requested.confirmStopped === true };
            }
            const result = await upstream(service, `/api/runs/${runId}/${action}`, {
              method: 'POST',
              body,
              timeoutMs: action === 'resume' || action === 'cancel' ? 30_000 : 15_000,
            });
            broadcast({ type: 'refresh', runId });
            const snapshot = result.parsed && typeof result.parsed === 'object' ? result.parsed : null;
            const { script, input, fingerprints, ...rest } =
              snapshot && !Array.isArray(snapshot) ? /** @type {Record<string, JsonValue>} */ (snapshot) : {};
            sendJson(response, 200, rest);
            return;
          }
        }

        sendJson(response, 404, { error: 'not_found' });
      } catch (error) {
        const message = error instanceof Error ? error.message : '请求失败';
        context.logger.warn('miniapp.console.request_failed', { path: pathname, message });
        /* 按错误性质分级，不要一律 400：前端要能区分「运行不存在」和「本机没服务」。 */
        const status = /不存在|无效|not_found/i.test(message)
          ? 404
          : /正在关闭|没有正在运行/.test(message)
            ? 503
            : /版本已更新|已过期|冲突/.test(message)
              ? 409
              : 400;
        if (!response.headersSent) sendJson(response, status, { error: message });
        else response.end();
      }
    })();
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(context.listen.port, context.listen.host, () => {
      server.off('error', onError);
      resolve(undefined);
    });
  });
  context.logger.info('miniapp.console.listening');

  let disposal;
  const dispose = () => {
    if (disposal) return disposal;
    closing = true;
    context.signal.removeEventListener('abort', onAbort);
    stopEmbedded();
    for (const controller of inflight) controller.abort();
    for (const stream of streams) {
      try {
        stream.end();
      } catch {
        /* stream already closed */
      }
    }
    streams.clear();
    disposal = (async () => {
      /* 等引擎进程树真的收掉再收工，否则宿主退出得早时 taskkill 不会执行，
         引擎子进程会变成孤儿一直占着端口。 */
      await engineExit.catch(() => undefined);
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve(undefined)));
        /* 浏览器可能还挂着 keep-alive 连接，不主动断开的话 close() 会一直等。 */
        server.closeIdleConnections?.();
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
