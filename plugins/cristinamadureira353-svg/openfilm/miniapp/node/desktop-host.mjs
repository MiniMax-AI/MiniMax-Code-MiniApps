/**
 * 桌面版的「主进程」，搬成 HTTP。
 *
 * 桌面 app 的页面（apps/desktop/shell）靠 `window.openfilmNative` 说话，而那套接口（preload.cjs）
 * 每个方法都是 `ipcRenderer.invoke(channel, payload)`；真正做事的是主进程里的 handler。
 *
 * 这里的做法：**把那些 handler 原样拿来用**（它们是纯 Node 函数，见 apps/desktop/src/*.mjs），
 * 只是把 `ipcMain` 换成一个 HTTP 版的替身：
 *
 *   · handle(channel, fn)  →  POST /ipc/<channel> 时调 fn(event, payload)
 *   · event.sender         →  一个假的 webContents：send() 把消息推给页面的 SSE
 *
 * handler 自己不 import electron（chat-ipc / local-agents-ipc / skills-ipc 都没有），
 * 所以它们能原样跑在这里。
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * 一个 ipcMain 形状的替身：handler 收进 Map，页面来调时按频道找。
 * `send` 的频道（fire-and-forget）也收进来，页面那边用同一个 invoke 调。
 */
export function createIpcMain() {
  /** @type {Map<string, (event: any, payload: any) => any>} */
  const handlers = new Map();
  return {
    handle(channel, fn) { handlers.set(channel, fn); },
    on(channel, fn) { handlers.set(channel, fn); },
    get(channel) { return handlers.get(channel); },
    has(channel) { return handlers.has(channel); },
    channels() { return [...handlers.keys()]; },
  };
}

/** JSON 里的二进制（ArrayBuffer / Uint8Array）走 base64，不然会变成 {}。 */
export function enc(value) {
  if (value === undefined) return null;
  if (value instanceof ArrayBuffer) return { __b64: bytesToB64(new Uint8Array(value)) };
  if (ArrayBuffer.isView(value)) return { __b64: bytesToB64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
  if (Array.isArray(value)) return value.map(enc);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = enc(v);
    return out;
  }
  return value;
}
export function dec(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(dec);
  if (typeof value === 'object') {
    if (typeof value.__b64 === 'string') return b64ToBytes(value.__b64);
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = dec(v);
    return out;
  }
  return value;
}
function bytesToB64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return Buffer.from(s, 'binary').toString('base64');
}
function b64ToBytes(b64) {
  return Buffer.from(b64, 'base64').buffer.slice(0);
}

/**
 * 把桌面 app 的 handler 接上。
 *
 * @param {object} options
 * @param {string} options.repoDir          OpenFilm 仓库（桌面 app 的 src 在 apps/desktop/src）
 * @param {string} options.dataDir           这个 Mini App 自己的 home（prefs、日志）
 * @param {string} options.studioOrigin      Studio 的地址（项目的列表从它那儿问）
 * @param {string} options.studioKey         Studio 的 key
 * @param {(channel: string, value: unknown) => void} options.tell  把消息推给页面
 * @param {string} options.openfilmHome      agent 跑起来时的 OPENFILM_HOME（它要找到同一个 Studio）
 * @param {object} [options.logger]        context.logger（stdout 属于 Host，不能 console.log）
 */
export async function registerDesktopIpc(ipcMain, options) {
  const { repoDir, dataDir, studioOrigin, studioKey, tell, openfilmHome } = options;
  const src = join(repoDir, 'apps/desktop/src');
  const load = async (file) => import(pathToFileURL(join(src, file)).href);

  const { registerChatIpc, readPreferences } = await load('chat-ipc.mjs');
  const { registerLocalAgentIpc } = await load('local-agents-ipc.mjs');
  const { registerSkillsIpc } = await load('skills-ipc.mjs');

  const log = (message) => { try { options.logger?.info?.(`[openfilm-desktop] ${message}`); } catch { /* 日志不是关键路径 */ } };

  /** Studio 记得的项目（chat 与 skills 只认这些文件夹）。 */
  const projects = async () => {
    try {
      const r = await fetch(studioOrigin + '/api/projects', { headers: { 'x-studio-key': studioKey } });
      const body = await r.json();
      return (body.projects || []).filter((p) => !p.missing).map((p) => p.path);
    } catch {
      return [];
    }
  };

  /** 访达里显示它：Electron 是 shell.showItemInFolder，这里用 `open -R`。 */
  const reveal = (path) => {
    try { spawn('open', ['-R', String(path)], { detached: true, stdio: 'ignore' }).unref(); } catch { /* 找不到就算了 */ }
  };

  /** 人挑的文件夹：网页里没有原生对话框，先退成「没挑」。 */
  const pickFolder = () => null;

  /* 桌面的 prefs 在它自己的 home 里；这里用自己的。 */
  const prefsHome = openfilmHome;

  registerChatIpc(ipcMain, {
    trusted: () => true,
    projects,
    dataDir,
    reveal,
    tell,
    log,
  });

  const localAgents = registerLocalAgentIpc(ipcMain, {
    trusted: () => true,
    log,
    onWorking: (folders) => tell('desktop:working', folders),
    onAsking: (folders) => tell('desktop:asking', folders),
    binDir: null,
    fallbackDir: null,
    env: { OPENFILM_HOME: openfilmHome },
    harness: async () => null,
    logDir: () => (readPreferences(dataDir).developer ? join(dataDir, 'agent-logs') : null),
    skills: { dataDir, mine: join(openfilmHome, 'skills'), prefsHome },
  });

  registerSkillsIpc(ipcMain, {
    trusted: () => true,
    projects,
    dataDir,
    mine: join(openfilmHome, 'skills'),
    prefsHome,
    oldMine: join(openfilmHome, 'skills'),
    reveal,
    pickFolder,
    refreshSkills: (agent) => localAgents?.refreshSkills(agent),
    log,
  });

  /* 下面这些是 app 自己的（窗口、标签、更新、登录）——网页里没有，就照实说没有。 */
  ipcMain.handle('desktop:hello', () => ({
    flavor: 'dev',
    version: options.openfilmVersion || '0.2.5',
    ffmpeg: null,
    update: null,
    chatOpen: true,
    chatWidth: 420,
    chatMin: 320,
    studioMin: 480,
    fullScreen: false,
  }));
  ipcMain.handle('desktop:layout', () => ({ ok: true }));
  ipcMain.handle('desktop:theme', () => ({ ok: true }));
  ipcMain.handle('desktop:language', () => ({ ok: true }));
  ipcMain.handle('desktop:reveal', async (event, path) => {
    /* 只让在项目文件夹里的路径被 reveal（评审 Optional 8）。 */
    if (typeof path !== 'string' || !path) return { ok: false, error: 'which folder?' };
    const allowed = await projects();
    if (!allowed.some((root) => path === root || path.startsWith(root + '/'))) {
      return { ok: false, error: 'not inside a project' };
    }
    reveal(path);
    return { ok: true };
  });
  ipcMain.handle('desktop:pick-folder', () => null);
  ipcMain.handle('desktop:capture', () => null);
  ipcMain.handle('desktop:update-restart', () => ({ ok: false, error: 'the desktop app does updates, not this panel' }));
  ipcMain.handle('desktop:update-state', () => null);
  ipcMain.handle('desktop:update-check', () => null);
  ipcMain.handle('desktop:full-screen', () => ({ ok: true }));
  ipcMain.handle('desktop:toggle-chat', () => ({ ok: true }));
  ipcMain.handle('desktop:open-settings', () => ({ ok: true }));
  ipcMain.handle('desktop:studio-browser', () => ({ ok: true }));
  ipcMain.handle('desktop:ffmpeg', () => ({ ok: true }));

  /* 窗口的标签：面板里只有一个页面，它就是那一个标签。 */
  ipcMain.handle('desktop:tabs:list', () => ({ self: 'panel', tabs: [] }));
  ipcMain.handle('desktop:tabs:new', () => ({ ok: true }));
  ipcMain.handle('desktop:tabs:show', () => ({ ok: true }));
  ipcMain.handle('desktop:tabs:close', () => ({ ok: true }));
  ipcMain.handle('desktop:tabs:move', () => ({ ok: true }));
  ipcMain.handle('desktop:tabs:report', () => ({ ok: true }));
  ipcMain.handle('desktop:tabs:gone', () => ({ ok: true }));
  ipcMain.handle('desktop:tabs:retitle', () => ({ ok: true }));
  ipcMain.handle('desktop:tabs:open', () => ({ ok: true }));

  /* Settings → Agents 和聊天的 agent 菜单用的是**另一份**名单（roster），不是 localAgents。
     之前这里被 stub 成空数组，所以「你的智能体」一个都没有 —— 现在接真的。
     这些模块（agent-roster / agents / agent-usage / app-report）都不 import electron。 */
  const { createRoster } = await load('agent-roster.mjs');
  const {
    listAgents, localAgent, openAgentSignIn, openAgentInstaller,
    setChosenPaths, checkAgentProgram, diagnoseAgent,
  } = await load('agents.mjs');
  const { agentUsage, forgetAgentUsage } = await load('agent-usage.mjs');
  const { gatherAppReport } = await load('app-report.mjs');

  const roster = createRoster({
    dataDir,
    localAgents: listAgents,
    localAgent,
    openSignIn: openAgentSignIn,
    openInstaller: openAgentInstaller,
    closeSessions: (id) => { forgetAgentUsage(id); localAgents?.closeAgent(id); },
    seal: (text) => sealKey(dataDir, text),
    unseal: (data) => unsealKey(dataDir, data),
    onChange: (list) => tell('desktop:agents', list),
    usePaths: setChosenPaths,
    /* 网页里没有原生文件对话框：让系统去找，不让人手点路径 */
    pickProgram: async () => null,
    checkProgram: checkAgentProgram,
    diagnose: (id) => diagnoseAgent(id, { appVersion: 'miniapp' }),
  });

  ipcMain.handle('desktop:agents:list', () => { void roster.refresh(); return roster.list(); });
  ipcMain.handle('desktop:agents:connect', (event, { id } = {}) => roster.connect(String(id)));
  ipcMain.handle('desktop:agents:disconnect', (event, { id } = {}) => { roster.disconnect(String(id)); return { ok: true }; });
  ipcMain.handle('desktop:agents:usage', (event, { id, fresh } = {}) => agentUsage(String(id), { fresh: fresh === true }));
  ipcMain.handle('desktop:agents:locate', (event, { id, words } = {}) => roster.locate(String(id), words));
  ipcMain.handle('desktop:agents:automatic', (event, { id } = {}) => roster.useAutomatic(String(id)));
  ipcMain.handle('desktop:agents:install', (event, { id } = {}) => roster.install(String(id)));
  ipcMain.handle('desktop:agents:diagnose', (event, { id } = {}) => roster.diagnose(String(id)));
  ipcMain.handle('desktop:agents:shown', (event, { id, shown } = {}) => { roster.setShown(String(id), shown === true); return { ok: true }; });
  ipcMain.handle('desktop:agents:own-model', (event, { config } = {}) => roster.saveOwnModel(config));
  ipcMain.handle('desktop:agents:own-model-remove', (event, { id } = {}) => { roster.removeOwnModel(String(id)); return { ok: true }; });

  const appReport = () => gatherAppReport(
    { list: () => roster.refresh(), check: checkAgentProgram },
    { version: 'miniapp', flavor: 'dev', packaged: false, channel: null, electron: null, pathSource: 'miniapp' },
  );
  ipcMain.handle('desktop:agents:report', appReport);
  /* 「复制诊断报告」：网页里不让写剪贴板的地方，走 pbcopy（macOS）。 */
  ipcMain.handle('desktop:diagnostics:copy', async () => {
    const [computer, own] = await Promise.all([
      studioGet(studioOrigin, studioKey, '/api/doctor').then((r) => String(r.text ?? ''), () => ''),
      appReport().catch(() => ''),
    ]);
    const text = [computer, own].filter(Boolean).join('\n\n────────\n\n');
    if (!text) return { ok: false };
    const copied = await new Promise((resolve) => {
      const child = spawn('pbcopy', [], { stdio: ['pipe', 'ignore', 'ignore'] });
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
      child.stdin.end(text);
    });
    return { ok: copied };
  });

  return { localAgents, roster };
}

/** 一次 studio 调用（项目的列表、prefs 之类）。 */
export async function studioGet(studioOrigin, studioKey, path) {
  const r = await fetch(studioOrigin + path, { headers: { 'x-studio-key': studioKey } });
  return r.json();
}

/** 读一个文件（探测仓库在不在）。 */
export async function exists(path) {
  try { await readFile(path); return true; } catch { return false; }
}

/**
 * 自有密钥（BYOK）的封存。
 *
 * 桌面 app 用系统钥匙串（Electron 的 safeStorage）；面板不是 Electron，没有它。
 * 这里用一份只在本机、0600 的主密钥做 AES-256-GCM：密钥不落明文，但**不是钥匙串**。
 * 面板的数据目录是自己的（~/.minimax/openfilm-studio），跟桌面 app 的不是同一份，
 * 所以两边存的密钥互不相通（换一边用要重新填）。
 */
function masterKey(dataDir) {
  const file = join(dataDir, 'byok-master-key');
  if (existsSync(file)) return readFileSync(file);
  mkdirSync(dataDir, { recursive: true });
  const key = randomBytes(32);
  writeFileSync(file, key, { mode: 0o600 });
  return key;
}

function sealKey(dataDir, text) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(dataDir), iv);
  return Buffer.concat([Buffer.from('enc:'), iv, cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()]);
}

function unsealKey(dataDir, data) {
  const kind = data.subarray(0, 4).toString();
  if (kind === 'raw:') return data.subarray(4).toString();
  const body = data.subarray(4);
  const iv = body.subarray(0, 12);
  const tag = body.subarray(body.length - 16);
  const encrypted = body.subarray(12, body.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', masterKey(dataDir), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
