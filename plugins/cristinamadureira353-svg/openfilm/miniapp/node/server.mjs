// @ts-check
/**
 * OpenFilm Mini App —— Node 运行时锚点。
 *
 * 这个 Mini App 里跑的就是 OpenFilm 本体：客户端是一层壳（项目列表 + 一个 iframe），
 * iframe 指向 OpenFilm Studio 的页面。Studio 是 OpenFilm 自己的服务，本 Mini App 不重画编辑器，
 * 只负责把它跑起来、拿到它的地址与密钥，并把项目树交给客户端。
 *
 *   GET  /            客户端页面（surface.path = /dashboard 同样服务）
 *   GET  /api/studio  { ready, origin, key, mode, error }：给客户端拼 iframe 的 src
 *   GET  /api/tree    项目树：{ groups: [{ project, children: [...] }] }
 *   GET  /api/health  本进程与 Studio 的状态（诊断用）
 *
 * ## Studio 从哪儿来
 *
 * **自己起一份纯浏览器的 Studio**（`studio/ui/dist`，不依赖 window.openfilmNative），
 * 用**自己的 home 与端口**（`~/.minimax/openfilm-studio`、4823）。
 *
 * 为什么不用用户那份 OpenFilm 的 Studio：
 *  · 桌面 app 的 Studio 伺服的是 **Electron 专用**的编辑器（依赖 window.openfilmNative），
 *    那个页面在普通浏览器里是白的 —— 而面板嵌的就是浏览器（实测：黑屏 + TypeError）；
 *  · 共用 home 的话，这份 Studio 会把用户的 run.json 抢走，用户的 OpenFilm 就找不着自己的 Studio 了。
 *
 * ## 项目从哪儿来
 *
 * 读**用户那份** Studio home 里的 `studio.json`（只读，不写）：那里是 Studio 记得的项目，
 * 也就是用户正式版 OpenFilm 的项目列表。
 * 另外把自己这份 Studio 记得的项目并进来 —— 面板里新建的项目要能在面板的列表里看见。
 * 嵌套关系自己算：路径是另一个的前缀 ⇒ 它在那个项目文件夹里面（与 Studio 的 `parentProject`
 * 同一个规矩：取最长的那个前缀）。官方版把子文件夹也列成平级的项目，这里把它缩在父项目下面。
 * 项目 id 在各项目的 `.film/id` 里（Studio 算的，同一个文件夹永远是同一个 id）。
 */
import { readFile, stat, mkdir, open, readdir } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { join, dirname, basename, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createIpcMain, registerDesktopIpc, enc, dec } from './desktop-host.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** OpenFilm 的 Studio 打印地址的那一行：`Studio   http://127.0.0.1:4747/open?key=…&to=…`。 */
const ADDRESS_LINE = /Studio\s+(\S+)/;

/** Studio 起来要多久（它是 Node + 浏览器渲染，冷启动不慢）。 */
const BOOT_TIMEOUT_MS = 30_000;
/** 探一个已经跑着的 Studio：它有多快应答。 */
const PROBE_TIMEOUT_MS = 6_000;

/**
 * 这个 Mini App 自己那份 Studio 的 home 与端口：**跟用户那份分开**。
 * 自己的 home 意味着它写自己的 run.json（不抢用户的），自己的端口意味着它不跟谁撞。
 */
const DEFAULT_STUDIO_HOME = join(homedir(), '.minimax', 'openfilm-studio');
const DEFAULT_STUDIO_PORT = 4823;

/** 用户那份 Studio 的 home：项目（recent）在它的 studio.json 里。 */
const USER_STUDIO_HOMES = {
  release: join(homedir(), '.openfilm'),
  dev: join(homedir(), '.openfilm-dev'),
};

/** 库根目录：正式版是 ~/Movies/OpenFilm/Projects（OpenFilm 自己的默认），Dev 版是它旁边的那个。 */
const LIBRARY_ROOTS = {
  release: join(homedir(), 'Movies', 'OpenFilm', 'Projects'),
  dev: join(homedir(), 'Movies', 'OpenFilm Dev', 'Projects'),
};

/** 客户端页面：包内自带，零构建。 */
const CLIENT_FILE = join(here, '..', 'client', 'index.html');
/** 网页版的 openfilmNative 替身（桌面版页面的原生桥，改走 HTTP）。 */
const BRIDGE_WEB_FILE = join(here, '..', 'client', 'bridge-web.js');
/** 配置：Host 启动 Mini App 时无法注入环境变量，所以绝对路径写在这个文件里。 */
const CONFIG_FILE = 'miniapp.config.json';

/** 默认跑 npm 上的正式发布版（= GitHub 官方仓库的发布版），不用 PATH 上那个可能更旧的。 */
const DEFAULT_OPENFILM_BIN = 'npx';
const DEFAULT_OPENFILM_ARGS = ['-y', 'openfilm@0.2.5'];

/** 桌面版模式：把桌面 app 的界面（编辑器 + 聊天栏）跑在面板里。 */
const DEFAULT_OPENFILM_REPO = join(homedir(), 'Developer/openfilm');

/** 读配置：读不到就用默认值（配置只是让人能改，不该成为启动的前提）。 */
async function readConfig(pluginRoot) {
  const read = async (file) => {
    try {
      const parsed = JSON.parse(await readFile(join(pluginRoot, file), 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  };
  /* miniapp.config.local.json 是自己机器上的覆盖（比如你这台的 Dev 版路径），
     不进共享配置、不该被提交 —— 开源出去的包里没有它也能跑。 */
  return { ...(await read(CONFIG_FILE)), ...(await read('miniapp.config.local.json')) };
}

/** 配置里的路径：`~` 当作家目录。 */
function expandHome(path) {
  const value = String(path || '');
  return value.startsWith('~') ? join(homedir(), value.slice(1)) : value;
}

/** 探一个 Studio：它的 /api/health 会不会答。答了就说明地址与 key 都还管用。 */
function probeStudio(origin, key, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const req = httpRequest(
      { host: '127.0.0.1', port: new URL(origin).port, path: '/api/health', method: 'GET', timeout: timeoutMs, agent: false },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          try { parsed = JSON.parse(body); } catch { /* 不是 JSON 也不是它 */ }
          resolve({ ok: response.statusCode === 200 && Boolean(parsed?.product), status: response.statusCode, body: body.slice(0, 200) });
        });
      },
    );
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.on('error', (error) => resolve({ ok: false, error: String(error.message || error).slice(0, 120) }));
    req.end();
  });
}

/** 读 run.json：Studio 自己写的，里头有 origin 与 key。 */
async function readRunFile(path) {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8'));
    if (raw?.origin && raw?.key) return { origin: String(raw.origin), key: String(raw.key), pid: raw.pid ?? null, filmOrigin: raw.filmOrigin ? String(raw.filmOrigin) : null };
  } catch { /* 没有，或者不是它的 */ }
  return null;
}

/** 从 Studio 打印的地址里取出 origin 与 key。 */
function parseStudioAddress(address) {
  try {
    const url = new URL(address);
    const key = url.searchParams.get('key');
    if (!key) return null;
    return { origin: url.origin, key, to: url.searchParams.get('to') };
  } catch {
    return null;
  }
}

/** 杀一个进程树（先温和后强硬）。只对自己 spawn 的用。 */
function killTree(child) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* 已经没了，或者不是组长 */ }
  try { process.kill(child.pid, 'SIGTERM'); } catch { /* 已经没了 */ }
  setTimeout(() => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* 已经没了 */ }
    try { process.kill(child.pid, 'SIGKILL'); } catch { /* 已经没了 */ }
  }, 1500).unref?.();
}

/**
 * 一个路径在这个库里吗（库根自己或它下面）。
 * 只用来标出「这个项目在哪套库里」，不拿来过滤（面板列的是 Studio 记得的项目）。
 */
function insideLibrary(path, root) {
  if (!path || !root) return false;
  const target = String(path);
  return target === root || target.startsWith(root + '/');
}

export async function start(context) {
  const { pluginRoot, listen, signal, logger } = context;
  const config = await readConfig(pluginRoot);

  /* 这个实例自己那份 Studio 的 home 与端口：默认放在 Host 给的 dataDir 里（仓库硬规则：
     持久状态归 context.dataDir），不抢用户桌面 app 的 home。
     测试可以用 miniapp.config.json 的 studioHome / studioPort 指到临时目录与别的端口。 */
  const STUDIO_HOME = expandHome(config.studioHome
    || (context.dataDir ? join(context.dataDir, 'openfilm-studio') : DEFAULT_STUDIO_HOME));
  const STUDIO_PORT = Number(config.studioPort) > 0 ? Number(config.studioPort) : DEFAULT_STUDIO_PORT;

  /* 鉴权交给 Host：MiniMax Code 3.1.2 起，Host 在这个端口上装了每次运行一个凭据的检查，
     没凭据的请求（含直连与 WebSocket）一律 401，根本到不了这里。
     所以这里**不自己造 token**，也不把任何密钥注进页面（仓库硬规则：密钥不出 Node 进程）。
     见 MiniMax-Code-MiniApps 的 docs/runtime.md「Loopback authentication」。 */

  /**
   * 读哪一份 Studio home 的项目列表。
   * 默认 release：用户日常在用的是正式版（~/.openfilm + ~/Movies/OpenFilm/Projects）。
   */
  const flavor = config.flavor === 'dev' ? 'dev' : 'release';
  const userHome = USER_STUDIO_HOMES[flavor];
  const openfilmBin = DEFAULT_OPENFILM_BIN;   // 固定 npx，不接受配置里的可执行文件

  /**
   * 桌面版模式：把桌面 app 的界面（编辑器 + 右边那栏聊天）跑在面板里。
   *
   * MiniApp 只能是网页，Electron 的窗口整体塞不进来；但桌面版的**界面**是网页（它自己是
   * Studio 伺服的一页），缺的只是 `window.openfilmNative` 那套原生桥。所以这里伺服它那一页，
   * 并把桥换成走 HTTP 的那一份。
   *
   * 桌面 app 的那些 handler 不在 npm 包里（`@openfilm/desktop` 没发布），只在这个仓库里，
   * 所以这一模式要指到仓库（openfilmRepo）。
   */
  const desktop = {
    on: config.desktopMode === true,
    repoDir: expandHome(config.openfilmRepo || process.env.OPENFILM_REPO || DEFAULT_OPENFILM_REPO),
    shellDist: '',
    ipc: null,
    sender: null,
    ready: false,
    loading: false,
    error: null,
    streams: new Set(),
  };
  desktop.shellDist = expandHome(config.shellDist || join(desktop.repoDir, 'apps/desktop/shell/dist'));

  /** 面板这一侧的消息（页面的推送）：SSE 推给浏览器。 */
  const tell = (channel, value) => {
    const frame = `data: ${JSON.stringify({ channel, value: enc(value) })}\n\n`;
    for (const stream of desktop.streams) {
      try { stream.write(frame); } catch { /* 断了就断了 */ }
    }
  };
  const openfilmArgs = DEFAULT_OPENFILM_ARGS;   // 固定 -y openfilm@0.2.5

  /** Studio 的现状：reused（我们上次起的，还在跑）还是 spawned（这次起的）。 */
  const state = {
    mode: 'unknown',      // 'reused' | 'spawned'
    origin: null,
    key: null,
    child: null,
    ready: false,
    error: null,
    startedAt: Date.now(),
    readyAt: null,
    bootLog: [],
  };

  const log = (message) => {
    state.bootLog.push(String(message).slice(0, 200));
    if (state.bootLog.length > 30) state.bootLog.shift();
    try { logger?.info?.(`[openfilm] ${message}`); } catch { /* 日志不是关键路径 */ }
  };

  /**
   * 起一份 Studio（或者接上我们上次起的那份）。
   *
   * 走 `openfilm open`：它认自己的 home，会把地址打到 stdout。
   * 但它会**复用**已经跑着的那个（按它自己 home 的 run.json）—— 那可能是用户桌面 app 的
   * Studio（Electron 专用编辑器，浏览器里是白的）。所以先探：能答、且不是 app 自己的，才复用。
   */
  async function ensureStudio() {
    if (state.ready) return;

    const run = await readRunFile(join(STUDIO_HOME, 'run.json'));
    if (run) {
      const probe = await probeStudio(run.origin, run.key);
      if (probe.ok) {
        state.mode = 'reused';
        state.origin = run.origin;
        state.key = run.key;
        state.ready = true;
        state.readyAt = Date.now();
        log(`reused the Studio at ${run.origin}`);
        return;
      }
      log(`the Studio at ${run.origin} did not answer (${probe.error || probe.status}); starting one`);
    }

    // 自己起一个。`openfilm open` 会把带 key 的地址打到 stdout。
    // 自己的 home ⇒ 它写自己的 run.json，不抢用户的；自己的库 ⇒ 它跟用户那份是两份数据。
    //
    // **两个面板同时开时只许起一个**（它们抢同一个端口、同一份 run.json）：
    // 锁文件放在自己那份 home 里，谁先拿到锁谁起，另一个等它起来后复用。
    await mkdir(STUDIO_HOME, { recursive: true }).catch(() => {});
    const lock = join(STUDIO_HOME, 'starting.lock');
    /** 已经有能用的 Studio 就用它，不起新的。 */
    const adopt = async (run, why) => {
      if (!run) return false;
      const probe = await probeStudio(run.origin, run.key);
      if (!probe.ok) return false;
      state.mode = 'reused';
      state.origin = run.origin;
      state.key = run.key;
      state.ready = true;
      state.readyAt = Date.now();
      log(`reused the Studio at ${run.origin}${why ? ` (${why})` : ''}`);
      return true;
    };
    /** 拿锁：拿到了才轮得到起。 */
    const take = async () => {
      try {
        // 'wx'：文件已存在就失败（锁在别人手里）
        const handle = await open(lock, 'wx');
        await handle.writeFile(String(process.pid));
        await handle.close();
        return true;
      } catch {
        return false;
      }
    };

    // 先看有没有能用的（前一个面板留下的）
    if (await adopt(await readRunFile(join(STUDIO_HOME, 'run.json')), 'left by an earlier panel')) return;

    // 没有就抢锁起一个。**两个面板同时开时只许起一个**（它们抢同一个端口、同一份 run.json）。
    let got = false;
    for (let attempt = 0; attempt < 240; attempt++) {
      if (await take()) { got = true; break; }
      // 锁在别人手里：他正起。等一下看他起来没有。
      await new Promise((done) => setTimeout(done, 500));
      if (await adopt(await readRunFile(join(STUDIO_HOME, 'run.json')), 'another panel started it')) return;
    }
    if (!got) {
      state.error = 'Another panel is starting OpenFilm; try again in a moment.';
      log(state.error);
      return;
    }
    // 拿到锁了：可能刚刚有人起来又退了 —— 再看一眼，别重复起。
    if (await adopt(await readRunFile(join(STUDIO_HOME, 'run.json')), 'started while we waited')) {
      await releaseLock();
      return;
    }

    const child = spawn(openfilmBin, [...openfilmArgs, 'open'], {
      cwd: here,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? homedir(),
        LANG: process.env.LANG ?? 'en_US.UTF-8',
        TMPDIR: process.env.TMPDIR ?? '/tmp',
        OPENFILM_NO_BROWSER: '1',
        OPENFILM_HOME: STUDIO_HOME,
        OPENFILM_STUDIO_PORT: String(STUDIO_PORT),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    state.mode = 'spawned';
    state.child = child;
    log(`started openfilm (pid ${child.pid})`);

    let out = '';
    const onData = (chunk) => {
      out += String(chunk);
      const match = out.match(ADDRESS_LINE);
      if (match) {
        const parsed = parseStudioAddress(match[1]);
        if (parsed) {
          state.origin = parsed.origin;
          state.key = parsed.key;
          state.ready = true;
          state.readyAt = Date.now();
          state.error = null;
          log(`the Studio is at ${parsed.origin}`);
        }
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', (chunk) => { out += String(chunk); log(String(chunk).trim()); });
    child.on('error', (error) => { state.error = String(error.message || error); log(`openfilm failed: ${state.error}`); });
    child.on('exit', async (code) => {
      log(`openfilm exited (${code})`);
      /* `openfilm open` 复用已有 Studio 时可能不打印地址就退出：按 run.json 接上。 */
      if (!state.ready) {
        const adopted = await adopt(await readRunFile(join(STUDIO_HOME, 'run.json')), 'it exited after reusing a Studio');
        if (adopted) return;
        const tail = out.trim().split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 200);
        state.error = state.error || `openfilm exited (${code})${tail ? ': ' + tail : ''}`;
      }
    });

    // 等它把地址吐出来
    const until = Date.now() + BOOT_TIMEOUT_MS;
    while (!state.ready && Date.now() < until) {
      await new Promise((done) => setTimeout(done, 250));
    }
    if (!state.ready) {
      state.error = state.error || `OpenFilm did not answer within ${Math.round(BOOT_TIMEOUT_MS / 1000)} s`;
      log(state.error);
    }
    // 锁用完了就放开（Studio 起来了，它自己的 run.json 就是别人的凭据了）
    await releaseLock();
  }

  /** 放开起 Studio 的锁（谁拿到锁谁负责放开）。 */
  async function releaseLock() {
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(join(STUDIO_HOME, 'starting.lock'));
    } catch { /* 已经没了 */ }
  }

  /**
   * 客户端要的项目树。
   *
   * 项目从**用户那份 Studio home** 的 studio.json 来（Studio 记得的，就是它列表里那些），
   * 再并上**面板自己这份 Studio** 记得的 —— 面板里新建的项目得能在面板的列表里看见。
   * 嵌套关系自己算：路径是另一个的前缀 ⇒ 它在那个项目文件夹里面（与 Studio 的 parentProject
   * 同一个规矩：最长的那个前缀算父）。项目 id 从各项目的 .film/id 读（Studio 算的，
   * 同一个文件夹永远同一个 id）。
   */
  async function projectTree() {
    if (!state.ready || !state.origin || !state.key) {
      return { groups: [], library: flavor, error: state.error || 'OpenFilm is not up yet' };
    }
    const recent = [];
    for (const home of [userHome, STUDIO_HOME]) {
      const raw = await readFile(join(home, 'studio.json'), 'utf8').catch(() => null);
      if (raw === null) {
        // 用户那份读不到是真的读不了；自己这份还没有是正常的（还没开过项目）
        if (home === userHome) return { groups: [], library: flavor, error: 'the project list could not be read' };
        continue;
      }
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.recent)) recent.push(...parsed.recent);
      } catch {
        if (home === userHome) return { groups: [], library: flavor, error: 'the project list could not be read' };
      }
    }
    const projects = [];
    const seenPaths = new Set();
    for (const r of recent) {
      if (!r?.path) continue;
      if (seenPaths.has(r.path)) continue;          // 两份列表里同一个项目只算一个
      const id = await projectId(r.path);
      if (!id) continue;                              // 文件夹没了的项目不列（跟官方列表一致：它标 missing）
      seenPaths.add(r.path);
      projects.push({
        id,
        path: r.path,
        name: r.path.split('/').pop() || r.path,
        library: insideLibrary(r.path, LIBRARY_ROOTS.release) ? 'release' : insideLibrary(r.path, LIBRARY_ROOTS.dev) ? 'dev' : 'elsewhere',
      });
    }
    /**
     * 嵌套：路径是另一个项目的前缀 ⇒ 它在那个项目文件夹里面。
     * 取**最长**的那个前缀（Studio 的 parentProject 也是这个规矩：`未命名/子项目` 的父是
     * `未命名`，不是 `未命名 2` —— 路径的前缀得带分隔符才算）。
     */
    const parentOf = new Map();
    const childrenOf = new Map();
    for (const p of projects) {
      let parent = null;
      for (const other of projects) {
        if (other.id === p.id || other.path === p.path) continue;
        if (!p.path.startsWith(other.path + sep)) continue;
        if (!parent || other.path.length > parent.path.length) parent = other;
      }
      if (!parent) continue;
      parentOf.set(p.id, parent.id);
      const list = childrenOf.get(parent.id) || [];
      list.push(p);
      childrenOf.set(parent.id, list);
    }
    const groups = [];
    const done = new Set();
    const collect = (project, depth, into) => {
      if (done.has(project.id)) return;
      done.add(project.id);
      for (const child of childrenOf.get(project.id) || []) {
        into.push({ project: child, depth: depth + 1 });
        collect(child, depth + 1, into);
      }
    };
    for (const p of projects) {
      if (parentOf.has(p.id)) continue;         // 它在别人的文件夹里，不是头
      if (done.has(p.id)) continue;
      const children = [];
      collect(p, 0, children);
      groups.push({ project: p, children });
    }
    for (const p of projects) {
      if (done.has(p.id)) continue;
      const children = [];
      collect(p, 0, children);
      groups.push({ project: p, children });
    }
    return { groups, library: flavor };
  }

  /** 项目自己的 id（Studio 算的，存在项目的 .film/id 里）。 */
  async function projectId(path) {
    try {
      const id = (await readFile(join(path, '.film', 'id'), 'utf8')).trim();
      return /^\w{6,40}$/.test(id) ? id : null;
    } catch {
      return null;
    }
  }

  /**
   * 把桌面 app 的 handler 接上（Studio 起来之后）。只接一次。
   *
   * 那些 handler 在仓库里（apps/desktop/src/*.mjs，`@openfilm/desktop` 没发布到 npm）。
   * 它们是纯 Node 函数，只是拿了个 ipcMain 形状注册 —— 这里给它们一个 HTTP 版的。
   */
  async function ensureDesktopHost() {
    if (!desktop.on) return false;
    if (desktop.ready) return true;
    if (desktop.loading) return false;
    if (!state.ready || !state.origin || !state.key) return false;
    desktop.loading = true;
    try {
      const shell = await stat(join(desktop.shellDist, 'index.html')).catch(() => null);
      if (!shell) throw new Error(`桌面版的页面不在 ${desktop.shellDist}（先在仓库里跑一次 build:shell）`);
      const ipc = createIpcMain();
      /* 假的 webContents：它的 send() 把消息推给页面的 SSE */
      desktop.sender = {
        isDestroyed: () => false,
        send: (channel, value) => tell(channel, value),
        once: () => {},
        on: () => {},
        removeListener: () => {},
      };
      const host = await registerDesktopIpc(ipc, {
        repoDir: desktop.repoDir,
        dataDir: STUDIO_HOME,
        studioOrigin: state.origin,
        studioKey: state.key,
        openfilmHome: STUDIO_HOME,
        openfilmVersion: (DEFAULT_OPENFILM_ARGS.find((a) => a.includes('openfilm@')) || '').split('@')[1] || '0.2.5',
        tell,
        logger,
      });
      desktop.localAgents = host.localAgents;
      desktop.ipc = ipc;
      desktop.ready = true;
      desktop.error = null;
    } catch (error) {
      desktop.error = String(error?.message || error);
    } finally {
      desktop.loading = false;
    }
    return desktop.ready;
  }

  /**
   * 桌面上那个 OpenFilm app 在哪儿。
   *
   * 面板里跑的是**网页版**（Studio 嵌在 iframe 里）；桌面版是 Electron 的窗口，整体塞不进
   * 面板。所以面板上给一个按钮，把人送到他机器上真正装着的那个桌面版去 —— 那是带聊天栏、
   * 带本地 agent 的完整形态。
   *
   * 候选在 `miniapps/openfilm/miniapp.config.json` 的 `desktopApp` 里，按顺序第一个存在的
   * 就是要打开的那个（`~` 开头当作家目录）。
   */
  async function desktopCandidates() {
    /* 只认固定的 OpenFilm app 位置：/Applications 里的正式版、仓库里的 Dev 版。
       不接受配置里的任意路径（评审 Must fix 5）。 */
    const out = [];
    const runtimeRoot = join(desktop.repoDir, 'apps', 'desktop', '.dev', 'runtime');
    try {
      const dirs = (await readdir(runtimeRoot, { withFileTypes: true }))
        .filter((d) => d.isDirectory()).map((d) => d.name).sort().reverse();
      for (const name of dirs) out.push({ path: join(runtimeRoot, name, 'OpenFilm Dev.app'), args: null });
    } catch { /* 没有仓库就没有 Dev 候选 */ }
    out.push({ path: '/Applications/OpenFilm.app', args: null });
    out.push({ path: join(homedir(), 'Applications', 'OpenFilm.app'), args: null });
    return out;
  }

  async function resolveDesktop() {
    for (const candidate of await desktopCandidates()) {
      const info = await stat(candidate.path).catch(() => null);
      if (!info?.isDirectory()) continue;
      /* Dev 版要靠参数找自己的开发资源（仓库的 apps/desktop）；正式版不用带参数。 */
      const args = candidate.args
        ?? (candidate.path.includes(`${sep}.dev${sep}runtime${sep}`) ? [join(desktop.repoDir, 'apps', 'desktop')] : []);
      return { path: candidate.path, args };
    }
    return null;
  }

  /** 桌面上那个 app 是不是已经在跑了（ps 里找它的进程）。 */
  async function desktopRunning(app) {
    const out = await new Promise((resolve) => {
      const child = spawn('ps', ['-ax', '-o', 'command='], { stdio: ['ignore', 'pipe', 'ignore'] });
      const chunks = [];
      child.stdout.on('data', (c) => chunks.push(c));
      child.on('error', () => resolve(''));
      child.on('close', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    const needle = basename(app);
    return out.split('\n').some((line) => line.includes(needle) && !line.includes('ps -ax'));
  }

  /**
   * 把桌面版叫起来。
   *
   * 已经跑着 → `open -a` 把它带到前面来。
   * 没跑着 → `open -n` 起一个（**要带参数**：Dev 版靠那个参数找它的开发资源，
   * 不带就起不来；正式版不需要参数）。
   */
  async function openDesktop() {
    const found = await resolveDesktop();
    if (!found) {
      return {
        ok: false,
        error: 'no OpenFilm desktop app found',
        candidates: (await desktopCandidates()).map((c) => c.path),
      };
    }
    const app = found.path;
    const alreadyRunning = await desktopRunning(app);
    const args = found.args;
    const argv = alreadyRunning
      ? ['-a', app]
      : ['-n', app, ...(args.length ? ['--args', ...args] : [])];
    await new Promise((resolve) => {
      const child = spawn('open', argv, { detached: true, stdio: 'ignore', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? homedir() } });
      child.on('error', () => resolve());
      child.on('spawn', () => { child.unref(); resolve(); });
    });
    return { ok: true, app, alreadyRunning };
  }

  /** 问 Studio 要东西（带 key）。连不上返回 null。 */
  function studioGet(path) {
    return new Promise((resolve) => {
      const url = new URL(path, state.origin);
      const req = httpRequest(
        {
          host: url.hostname,
          port: url.port,
          path: url.pathname + url.search,
          method: 'GET',
          timeout: PROBE_TIMEOUT_MS,
          agent: false,
          headers: { 'x-studio-key': state.key },
        },
        (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            try { resolve(JSON.parse(text)); } catch { resolve(null); }
          });
        },
      );
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.on('error', () => resolve(null));
      req.end();
    });
  }

  /**
   * 让 Studio 自己收摊：`POST /api/quit`。
   * 不用杀进程 —— `openfilm open` 会把 Studio 甩成孤儿（它自己退出，Studio 继续活着），
   * 孤儿进程的 pid 我们根本不知道。而 Studio 有自己的关闭口，干净。
   * 桌面版自己起的 Studio 会拒绝（423），那就留着 —— 那是它的。
   */
  function quitStudio() {
    if (!state.origin || !state.key) return Promise.resolve(null);
    return new Promise((resolve) => {
      const url = new URL('/api/quit', state.origin);
      const req = httpRequest(
        {
          host: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'POST',
          timeout: 5000,
          agent: false,
          headers: { 'x-studio-key': state.key, 'content-type': 'application/json' },
        },
        (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8').slice(0, 120) }));
        },
      );
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.on('error', () => resolve(null));
      req.end('{}');
    });
  }

  /** 把请求的 body 读完（JSON）。 */
  function readBody(request) {
    return new Promise((resolve) => {
      const chunks = [];
      request.on('data', (c) => chunks.push(c));
      request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      request.on('error', () => resolve(''));
    });
  }

  /**
   * 桌面版的原生桥：页面调 `POST /ipc/<channel>`，这里按频道找 handler。
   *
   * handler 是桌面 app 主进程里那些（纯 Node 函数），它们收的是 `(event, opts)`：event.sender
   * 是页面的 webContents，我们给一个假的——它的 send() 把消息推给页面的 SSE。
   */
  /**
   * IPC 频道白名单与参数校验：页面是外部输入，不是什么调用都放。
   * 安装、登录、automatic 一律不放（要去桌面版做）。
   */
  const str = (v) => typeof v === 'string' && v.length > 0;
  const obj = (v) => v === null || (v !== undefined && typeof v === 'object' && !Array.isArray(v));
  const IPC_RULES = new Map(Object.entries({
    'desktop:hello': () => true,
    'desktop:layout': (p) => obj(p),
    'desktop:theme': (p) => p === 'dark' || p === 'light',
    'desktop:language': (p) => str(p) && p.length <= 20,
    'desktop:reveal': (p) => str(p),
    'desktop:pick-folder': () => true,
    'desktop:capture': () => true,
    'desktop:tabs:list': () => true,
    'desktop:tabs:new': (p) => obj(p),
    'desktop:tabs:show': (p) => obj(p) && str(p.id),
    'desktop:tabs:close': (p) => obj(p) && str(p.id),
    'desktop:tabs:move': (p) => obj(p) && str(p.id) && Number.isFinite(p.index),
    'desktop:tabs:report': (p) => obj(p),
    'desktop:tabs:gone': (p) => obj(p) && Array.isArray(p.projectIds),
    'desktop:tabs:retitle': (p) => obj(p) && str(p.id) && str(p.title),
    'desktop:tabs:open': (p) => obj(p) && str(p.to),
    'desktop:agents:list': () => true,
    'desktop:agents:report': () => true,
    'desktop:agents:disconnect': (p) => obj(p) && str(p.id),
    'desktop:agents:usage': (p) => obj(p) && str(p.id),
    'desktop:agents:locate': (p) => obj(p) && str(p.id),
    'desktop:agents:diagnose': (p) => obj(p) && str(p.id),
    'desktop:agents:shown': (p) => obj(p) && str(p.id) && typeof p.shown === 'boolean',
    'desktop:agents:own-model': (p) => obj(p) && obj(p.config) && str(p.config.format) && str(p.config.model),
    'desktop:agents:own-model-remove': (p) => obj(p) && str(p.id),
    'desktop:agents:mcp': (p) => obj(p) && str(p.id),
    'desktop:agents:skills': (p) => obj(p) && str(p.id),
    'desktop:agents:mcp-allow': (p) => obj(p) && str(p.id) && str(p.name) && typeof p.allowed === 'boolean',
    'desktop:skills:allow': (p) => obj(p) && str(p.agent) && str(p.name) && typeof p.allowed === 'boolean',
    'desktop:diagnostics:copy': () => true,
    'desktop:local-agents:list': () => true,
    'desktop:local-agents:probe': (p) => obj(p) && str(p.agent),
    'desktop:local-agents:start': (p) => obj(p) && str(p.agent) && str(p.cwd),
    'desktop:local-agents:prompt': (p) => obj(p) && str(p.key) && str(p.text),
    'desktop:local-agents:running': () => true,
    'desktop:local-agents:ack': (p) => obj(p) && str(p.key) && str(p.turnId),
    'desktop:local-agents:steer': (p) => obj(p) && str(p.key) && str(p.text),
    'desktop:local-agents:adopt': (p) => obj(p) && str(p.key),
    'desktop:local-agents:cancel': (p) => obj(p) && str(p.key),
    'desktop:local-agents:set-option': (p) => obj(p) && str(p.key) && str(p.configId),
    'desktop:local-agents:permission': (p) => obj(p) && str(p.key) && str(p.requestId) && str(p.optionId),
    'desktop:local-agents:answer': (p) => obj(p) && str(p.key) && str(p.requestId),
    'desktop:local-agents:close': (p) => obj(p) && str(p.key),
    'desktop:chat:load': (p) => obj(p) && str(p.project),
    'desktop:chat:sessions': (p) => obj(p) && str(p.project),
    'desktop:chat:turn': (p) => obj(p) && str(p.project),
    'desktop:chat:log': (p) => obj(p) && str(p.project) && str(p.turnId),
    'desktop:chat:reveal': (p) => obj(p) && str(p.project),
    'desktop:chat:ref-image': (p) => obj(p) && str(p.project) && str(p.turnId) && Number.isFinite(p.n),
    'desktop:chat:attachment': (p) => obj(p) && str(p.project) && str(p.name),
    'desktop:chat:paths': (p) => obj(p) && Array.isArray(p.paths),
    'desktop:chat:unsaved': (p) => obj(p) && str(p.project),
    'desktop:chat:snapshot': (p) => obj(p) && str(p.project) && str(p.turnId),
    'desktop:chat:changes': (p) => obj(p) && str(p.project) && str(p.turnId),
    'desktop:skills:list': (p) => obj(p) && str(p.project),
    'desktop:skills:texts': (p) => obj(p) && str(p.project) && Array.isArray(p.names),
    'desktop:skills:changed': () => true,
    'desktop:skills:preview': (p) => obj(p),
    'desktop:skills:commit': (p) => obj(p) && str(p.id),
    'desktop:skills:discard': (p) => obj(p) && str(p.id),
    'desktop:skills:reveal': () => true,
    'desktop:prefs': () => true,
    'desktop:prefs:set': (p) => obj(p),
  }));

  async function handleIpc(request, url, response) {
    /* 页面订阅的那些频道：一条 SSE 连着所有频道 */
    if (url.pathname === '/ipc/events') {
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      response.write(': connected\n\n');
      desktop.streams.add(response);
      request.on('close', () => desktop.streams.delete(response));
      return;
    }

    const channel = decodeURIComponent(url.pathname.slice('/ipc/'.length));
    if (request.method !== 'POST') {
      response.writeHead(405, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'method_not_allowed' }));
      return;
    }
    if (!(await ensureDesktopHost())) {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: desktop.error || 'OpenFilm is not up yet' }));
      return;
    }
    const rule = IPC_RULES.get(channel);
    if (!rule) {
      response.writeHead(403, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'channel not allowed', channel }));
      return;
    }
    const handler = desktop.ipc.get(channel);
    if (!handler) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'no such channel', channel }));
      return;
    }
    let payload = null;
    try { payload = dec(JSON.parse((await readBody(request)) || 'null')); } catch { payload = null; }
    if (!rule(payload)) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'bad payload', channel }));
      return;
    }
    try {
      const result = await handler({ sender: desktop.sender }, payload);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(enc(result) ?? null));
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: String(error?.message || error) }));
    }
  }

  /**
   * Studio 的 /api/* 转到它那儿。
   *
   * 桌面版模式里页面就在这个源上（它的 fetch 用的是绝对路径 /api/…），所以要同源转发。
   * key 我们替它带上；Origin 改成 Studio 自己的（它只认自己的来源）。
   */
  /* 两个源分工（这是预览能不能出画面的关键）：
     · 桌面版页面在 127.0.0.1 —— 影片页的 EDITOR 就指到这儿；
     · 影片页在 localhost —— 跟桌面版**不同源**，bridge 才会启动
       （bridge.js 里「父页面与影片页同源就不启动」，同源反而把桥关了）。
     两个名字都指向面板这一个服务，但浏览器眼里是两个源。 */
  const panelOrigin = `http://127.0.0.1:${listen.port}`;

  /** 影片源（Studio 的 pages 服务，run.json 或 /api/health 里的 filmOrigin）。 */
  let filmOriginCache = null;
  async function filmOrigin() {
    if (filmOriginCache) return filmOriginCache;
    const run = await readRunFile(join(STUDIO_HOME, 'run.json')).catch(() => null);
    if (run?.filmOrigin) { filmOriginCache = run.filmOrigin; return filmOriginCache; }
    try {
      const r = await fetch(state.origin + '/api/health', { headers: { 'x-studio-key': state.key } });
      const body = await r.json();
      if (body?.filmOrigin) { filmOriginCache = body.filmOrigin; return filmOriginCache; }
    } catch { /* 下面按没有处理 */ }
    return null;
  }

  /** 一个响应是不是文本（要改写里面的源），以及怎么改写。 */
  const isText = (type) => /json|html|javascript|text\//i.test(String(type || ''));

  /**
   * Studio 的 /api/* 只放这些前缀（编辑器真正用的）。
   * 管理类的不放：/api/quit、/api/update、/api/open、/api/keys 等一律 403。
   */
  const STUDIO_API_ALLOW = [
    '/api/health', '/api/projects', '/api/files', '/api/doctor', '/api/library',
    '/api/saved', '/api/skills', '/api/prefs', '/api/examples', '/api/fonts',
    '/api/page-links', '/api/exports', '/api/look',
  ];
  const allowStudioApi = (path) => STUDIO_API_ALLOW.some((p) => path === p || path.startsWith(p + '/'));
  /** 只放这几个头过去：不转发 cookie、不转发别人的鉴权头。 */
  const studioHeaders = (request) => ({
    ...(request.headers.accept ? { accept: request.headers.accept } : {}),
    ...(request.headers['content-type'] ? { 'content-type': request.headers['content-type'] } : {}),
    ...(request.headers.range ? { range: request.headers.range } : {}),
    'x-studio-key': state.key,
    origin: state.origin,
  });

  async function forwardToStudio(request, url, response) {
    if (!state.origin || !state.key) {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'OpenFilm is not up yet' }));
      return;
    }
    if (!allowStudioApi(url.pathname)) {
      response.writeHead(403, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'route not allowed', path: url.pathname }));
      return;
    }
    const chunks = [];
    request.on('data', (c) => chunks.push(c));
    request.on('end', async () => {
      const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
      const headers = studioHeaders(request);
      try {
        const r = await fetch(state.origin + url.pathname + url.search, {
          method: request.method,
          headers,
          ...(hasBody ? { body: Buffer.concat(chunks) } : {}),
        });
        const out = {};
        r.headers.forEach((value, key) => {
          if (key !== 'content-encoding' && key !== 'transfer-encoding' && key !== 'content-length') out[key] = value;
        });
        let body = Buffer.from(await r.arrayBuffer());
        /* 影片源（4824）也走面板这个源：Preview 的 folder 变成面板地址，影片页才跟面板同源。 */
        const film = await filmOrigin();
        if (film && isText(out['content-type'])) {
          body = Buffer.from(body.toString('utf8').replaceAll(film, panelOrigin), 'utf8');
        }
        response.writeHead(r.status, out);
        response.end(body);
      } catch (error) {
        response.writeHead(502, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: String(error?.message || error) }));
      }
    });
  }

  /**
   * 影片页与它的素材：转到 Studio 的 pages 服务（filmOrigin，4824）。
   *
   * 关键在 `EDITOR`：影片页只接受这个源发来的消息（bridge.js），而它默认是 4823。
   * 桌面版页面在面板这个源上，所以注入的 EDITOR 必须改写成面板源 —— 不改的话，
   * 父子永远握不上手，预览就一直停在「正在绘制第一帧」。
   */
  async function forwardToFilm(request, url, response) {
    const film = await filmOrigin();
    if (!film || !state.key || !state.origin) {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'the film origin is not up yet' }));
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'the film origin is read-only' }));
      return;
    }
    const target = new URL(film);
    const headers = {
      host: target.host,
      ...(request.headers.accept ? { accept: request.headers.accept } : {}),
      ...(request.headers['content-type'] ? { 'content-type': request.headers['content-type'] } : {}),
      ...(request.headers.range ? { range: request.headers.range } : {}),
    };
    try {
      const r = await fetch(film + url.pathname + url.search, { method: request.method, headers });
      const out = {};
      r.headers.forEach((value, key) => {
        if (key !== 'content-encoding' && key !== 'transfer-encoding' && key !== 'content-length') out[key] = value;
      });
      let body = Buffer.from(await r.arrayBuffer());
      if (isText(out['content-type'])) {
        let text = body.toString('utf8').replaceAll(state.origin, panelOrigin);
        /* bridge.js 原本「父页面与影片页同源就不启动」：那是为了不当编辑器的同域页面。
           这里父页面就是编辑器（桌面版），只是恰好与影片页同源 —— 不能因此把桥关了。
           只改我伺服出去的这份副本，不动上游。 */
        text = text.replace(
          'if (parent !== window && parent.location.origin === location.origin) return;',
          '/* MiniApp: the editor may share this origin with the film page */',
        );
        body = Buffer.from(text, 'utf8');
      }
      if (out['access-control-allow-origin']) out['access-control-allow-origin'] = panelOrigin;
      response.writeHead(r.status, out);
      response.end(body);
    } catch (error) {
      response.writeHead(502, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: String(error?.message || error) }));
    }
  }

  /** 桌面版的那一页（编辑器 + 聊天栏）：它自己的 index.html，前面插上网页版的原生桥。 */
  async function desktopPage() {
    let html = await readFile(join(desktop.shellDist, 'index.html'), 'utf8');
    html = html.replace(
      '<script type="module"',
      '<script src="/bridge-web.js"></script>\n  <script type="module"',
    );
    return html;
  }

  const clientEntry = await readFile(CLIENT_FILE);
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://miniapp.local');
    const send = (status, type, body) => {
      response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
      response.end(body);
    };

    /* 面板自己的接口：/miniapp/*。
       不叫 /api/* —— 桌面版模式里，页面就在这个源上，它用相对路径调 Studio 的 /api/*。 */
    if (url.pathname === '/miniapp/studio') {
      send(200, 'application/json; charset=utf-8', JSON.stringify({
        ready: state.ready,
        origin: state.origin,
        mode: state.mode,
        error: state.error,
        desktop: {
          on: desktop.on,
          ready: desktop.ready,
          error: desktop.error,
          shellDist: desktop.shellDist,
        },
      }));
      return;
    }
    if (url.pathname === '/miniapp/tree') {
      void projectTree().then((tree) => send(200, 'application/json; charset=utf-8', JSON.stringify(tree)));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/miniapp/open-desktop') {
      void openDesktop().then((result) => send(result.ok ? 200 : 404, 'application/json; charset=utf-8', JSON.stringify(result)));
      return;
    }
    if (url.pathname === '/miniapp/health') {
      void resolveDesktop().then((desktopApp) => send(200, 'application/json; charset=utf-8', JSON.stringify({
        ok: state.ready,
        studio: {
          ready: state.ready,
          mode: state.mode,
          origin: state.origin,
          error: state.error,
        },
        library: flavor,
        desktop: { app: desktopApp?.path ?? null, mode: desktop.on, ready: desktop.ready },
      })));
      return;
    }

    /* 桌面版的原生桥：页面调 POST /ipc/<channel>，这里按频道找 handler。 */
    if (url.pathname.startsWith('/ipc/')) {
      void handleIpc(request, url, response);
      return;
    }

    /* 影片页与它的素材：转到 pages 服务（4824），见 forwardToFilm。 */
    if (url.pathname.startsWith('/p/')) {
      void forwardToFilm(request, url, response);
      return;
    }

    /* 桌面版模式：Studio 的 /api/* 转到它那儿（页面是同源的，它用相对路径调）。 */
    if (url.pathname.startsWith('/api/')) {
      void forwardToStudio(request, url, response);
      return;
    }

    /* 面板的页面 */
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/dashboard')) {
      send(200, 'text/html; charset=utf-8', clientEntry);
      return;
    }

    /* 桌面版模式：它的那一页（编辑器 + 聊天栏）与它的资源。 */
    if (desktop.on && request.method === 'GET') {
      void serveDesktop(request, url, response).catch((error) => {
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: String(error?.message || error) }));
      });
      return;
    }

    /* 网页版模式：Studio 的编辑器也同源代理（页面 URL 里不带 key）。 */
    if (!desktop.on && request.method === 'GET') {
      void forwardEditorToStudio(request, url, response);
      return;
    }

    send(404, 'application/json; charset=utf-8', JSON.stringify({ error: 'not_found' }));
  });

  /**
   * 页面与 Studio 之间的 WebSocket（Studio 的事件流）：原样转过去。
   *
   * 握手得自己转：Studio 只认两种钥匙 —— `x-studio-key` 头（浏览器发不了）或
   * 「cookie + Origin 恰好等于它自己」。这里替它把头补齐（key、Host、Origin），
   * 之后就是两个 socket 对着传字节。
   */
  server.on('upgrade', (request, socket, head) => {
    /* 只放 Studio 的两条事件流，别的 upgrade 一律不转。 */
    const path = (request.url || '').split('?')[0];
    const allowed = path === '/api/events' || /^\/api\/projects\/[^/]+\/events$/.test(path);
    if (!allowed || !state.origin || !state.key) { socket.destroy(); return; }
    const target = new URL(state.origin);
    const upstream = net.connect({ host: target.hostname, port: Number(target.port) || 80 }, () => {
      const lines = [`GET ${request.url} HTTP/1.1`];
      /* 只放握手必需的头 + 我们自己的 key；cookie 与别的头都不转发。 */
      for (const name of ['upgrade', 'connection', 'sec-websocket-key', 'sec-websocket-version', 'sec-websocket-protocol', 'sec-websocket-extensions']) {
        if (request.headers[name]) lines.push(`${name}: ${request.headers[name]}`);
      }
      lines.push(`Host: ${target.host}`);
      lines.push(`Origin: ${state.origin}`);
      lines.push(`X-Studio-Key: ${state.key}`);
      upstream.write(lines.join('\r\n') + '\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    const drop = () => { try { socket.destroy(); } catch { /* 已经断了 */ } try { upstream.destroy(); } catch { /* 已经断了 */ } };
    upstream.on('error', drop);
    socket.on('error', drop);
  });

  /**
   * 网页模式的编辑器：同源代理到 Studio 的编辑器页面。
   * key 只在服务端带上（studioHeaders），页面的地址里永远没有 `/open?key=`。
   */
  async function forwardEditorToStudio(request, url, response) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'method_not_allowed' }));
      return;
    }
    if (!state.origin || !state.key) {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'OpenFilm is not up yet' }));
      return;
    }
    try {
      const r = await fetch(state.origin + url.pathname + url.search, { method: request.method, headers: studioHeaders(request) });
      const out = {};
      r.headers.forEach((value, key) => {
        if (key !== 'content-encoding' && key !== 'transfer-encoding' && key !== 'content-length') out[key] = value;
      });
      const body = Buffer.from(await r.arrayBuffer());
      response.writeHead(r.status, out);
      response.end(body);
    } catch (error) {
      response.writeHead(502, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: String(error?.message || error) }));
    }
  }

  /** 桌面版模式下的静态东西：它那一页、它的资源、网页版的原生桥。 */
  async function serveDesktop(request, url, response) {
    const send = (status, type, body) => {
      response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
      response.end(body);
    };
    if (url.pathname === '/bridge-web.js') {
      send(200, 'text/javascript; charset=utf-8', await readFile(BRIDGE_WEB_FILE));
      return;
    }
    if (url.pathname.startsWith('/assets/')) {
      const file = join(desktop.shellDist, url.pathname);
      const info = await stat(file).catch(() => null);
      if (info?.isFile()) {
        const types = {
          '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
          '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
          '.woff2': 'font/woff2', '.woff': 'font/woff', '.jpg': 'image/jpeg',
        };
        send(200, types[extname(file)] || 'application/octet-stream', await readFile(file));
        return;
      }
    }
    /* 别的路径都是它那一页（/projects/<id> 之类：页面自己认这个地址） */
    if (await stat(join(desktop.shellDist, 'index.html')).catch(() => null)) {
      send(200, 'text/html; charset=utf-8', await desktopPage());
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not_found' }));
  }

  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(listen.port, listen.host, () => {
      server.off('error', onError);
      resolve();
    });
  });

  // Studio 的起来是慢的，不挡着面板先开：面板先显示「正在起 OpenFilm」。
  await mkdir(STUDIO_HOME, { recursive: true }).catch(() => {});
  void ensureStudio().then(async () => {
    if (state.ready) await ensureDesktopHost();
  }).catch((error) => {
    state.error = String(error?.message || error);
    log(`could not start OpenFilm: ${state.error}`);
  });

  let disposal;
  const dispose = () => {
    if (disposal) return disposal;
    context.signal.removeEventListener('abort', onAbort);
    disposal = (async () => {
      await releaseLock();
      /**
       * 只关**自己起的那份**。
       *
       * reused 的（上一个面板起的、或者别的面板起的）：不关 —— 那不是我们起的，我们关了它别人就没了。
       * spawned 的：我们起的，收走。
       */
      /* 本地 agent 的会话也是我们的：不收的话，它们的进程会留在这个面板之后。 */
      try { desktop.localAgents?.closeAll?.(); } catch { /* 收不干净也不挡收尾 */ }

      if (state.mode === 'spawned') {
        /* `openfilm open` 自己退出后，Studio 继续活着（它才是那个服务）——
           它的 pid 写在**自己那份 home** 的 run.json 里，不是我们 spawn 的那个进程的 pid。 */
        const run = await readRunFile(join(STUDIO_HOME, 'run.json'));
        const quit = state.ready ? await quitStudio() : null;
        if (quit?.status === 200) log('asked the Studio to quit');
        else if (quit?.status === 423) log('the Studio is the app\'s own; left it running');
        else {
          /* 叫不动就杀：run.json 里的 pid 是 Studio 自己的，killTree 把它的孩子一起收走 */
          if (run?.pid) {
            killTree({ pid: run.pid });
            log('asked the Studio to quit by signal');
          } else if (state.child?.pid) {
            killTree(state.child);
          }
        }
        await new Promise((r) => setTimeout(r, 800));
      }
      /* SSE 是长连接，server.close() 会一直等它：先把推送收掉，再把剩下的连接收掉。
         不这么做的话，页面开着的时候 dispose 永远完不成。 */
      for (const stream of desktop.streams) { try { stream.end(); } catch { /* 已经断了 */ } }
      desktop.streams.clear();
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections?.();
      });
    })();
    return disposal;
  };
  const onAbort = () => {
    void dispose().catch(() => undefined);
  };
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) await dispose();

  return { dispose };
}
