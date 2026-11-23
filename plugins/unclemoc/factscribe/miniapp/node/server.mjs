// @ts-check
// FactScribe 论文工作台 — MiniMax Code MiniApp Node 入口（零 npm 依赖，只用 node: 标准库）。
//
// 分工（方案 A「Node 薄壳」）：
//   - 本文件（薄壳）：占住宿主分配的 127.0.0.1 端口、伺服静态页面（miniapp/client/）、
//     把 /api/* 反向代理给 Python 引擎、在 /mcp/factscribe 上提供 6 个只读 MCP 工具；
//     并负责 Python 子进程的生死——宿主只停 Node，不会发现也不会替我们收子进程。
//   - Python 引擎（vendored 于 miniapp/node/engine/factscribe/）：
//     `python3 -m factscribe workbench --root <论文根> --port 0 --json --no-browser`，
//     stdout 首行是 listening JSON 握手（内含真实端口）；业务大脑（项目发现、
//     章节渲染、写回保护链、检查报告）全在它那边，本文件一行业务不做。
//
// 纪律（官方 docs/runtime.md / security.md 口径）：
//   - stdout/stdin 归宿主：本文件绝不 console.log；Python 子进程 stdio 走管道
//     （stdout 只取首行握手后即排掉，stderr 逐行转 context.logger）；
//   - start() 装完全部路由、listen 成功后才 resolve（resolve 即就绪信号）；
//   - dispose() 2 秒内收干净：关 HTTP 服务＋SIGTERM→SIGKILL 杀 Python 子进程；
//   - 状态随变随写 dataDir（同目录临时文件再改名，原子写）——宿主随时可能停进程；
//   - 所有路由先过回环守卫（Host 必须是本机回环名；带 Origin 必须是自己端口，
//     防 DNS rebinding / 跨站页面打接口）。

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { delimiter, join, resolve as resolvePath, sep } from 'node:path';
import { homedir } from 'node:os';

// ---------------------------------------------------------------- 常量

/** MCP 端点路径（与 miniapp.json 的 mcpEndpoints 一致）。 */
export const MCP_PATH = '/mcp/factscribe';

/** 页面路由（与 miniapp.json 的 surface.path 一致）。 */
const SURFACE_PATH = '/workbench';

/** 设置路由：v1 的论文根目录配置页与收表接口。 */
const SETUP_PATHS = { api: '/api/miniapp/setup' };

// AI 对话：宿主 Agent 通道。声明了 agentAccess 的插件宿主才会给 context.agent；
// 没有它就照旧走引擎的本地后端（workbench.toml 的 [ai]）。
const AGENT_CHAT_PATH = '/api/chat';
const AGENT_PREPARE_PATH = '/api/chat/prepare';
const AGENT_MODELS_PATH = '/api/ai/models';
const AGENT_MODEL_LABEL = '宿主 Agent（MCode 当前模型）';

// 面板模型清单的三种来源（下拉里并列，靠 id 前缀区分）：
//   host:   宿主的模型目录（agent.models()）——宿主自己的模型，带思考等级；
//   engine: 引擎 workbench.toml 的 [ai].models——本地后端；
//   custom: 用户自加的自定义模型（OpenAI 兼容端点），凭据只存插件私有 dataDir。
const HOST_MODEL_PREFIX = 'host:';
/** 面板上的「宿主默认」选项：不指定模型＝用 MCode 当前这个模型。 */
const HOST_DEFAULT_ID = 'host:default';
const ENGINE_MODEL_PREFIX = 'engine:';
const CUSTOM_MODEL_PREFIX = 'custom:';
const CUSTOM_MODELS_PATH = '/api/ai/custom-models';
const CUSTOM_MODELS_FILE = 'custom-models.json';
/** 自定义模型后端的限时（毫秒）——后端慢也不能把面板挂死。 */
const CUSTOM_MODEL_TIMEOUT_MS = 60000;
/** 降级回复的首行标记（与引擎口径一致：前端靠它分辨真假）。 */
const AI_FALLBACK_MARK = '模拟回答（未接模型）';

/** 插件包内的载荷位置（相对 context.pluginRoot）。 */
const CLIENT_DIR = join('miniapp', 'client');
const ENGINE_DIR = join('miniapp', 'node', 'engine');

const SERVER_INFO = { name: 'factscribe', version: '1.0.0' }; // 与 plugin.json 保持一致

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const MAX_BODY_BYTES = 1024 * 1024;
const ENGINE_START_TIMEOUT_MS = 20000;
const PYTHON_PROBE_TIMEOUT_MS = 15000;

// ---------------------------------------------------------------- 小件

class HttpError extends Error {
  /** @param {number} status @param {string} code @param {string} [message] */
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.userMessage = message || code;
  }
}

/** @param {number} ms */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @param {string} hostHeader */
function hostnameOf(hostHeader) {
  const h = hostHeader.trim().toLowerCase();
  const bracketed = /^\[([^\]]*)\]/.exec(h);
  if (bracketed) return bracketed[1];
  const colon = h.lastIndexOf(':');
  return colon === -1 ? h : h.slice(0, colon);
}

/**
 * 回环守卫（照 cq-viewer 的实现形）：Host 头必须是本机回环名；浏览器带来的
 * Origin 必须是本监听端口自己。宿主的 MCP 客户端是 Node 进程，不带 Origin。
 * @param {import('node:http').IncomingMessage} request @param {number} port
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
    return false; // 包括 "null"（沙箱 iframe、file://）
  }
  const originPort = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(hostnameOf(url.host)) && originPort === port;
}

/**
 * JSON-only 请求体（跨站页面发不出 application/json——没有 CORS 预检就过不来）。
 * @param {import('node:http').IncomingMessage} request
 * @param {number} [maxBytes]
 */
function readJsonBody(request, maxBytes = MAX_BODY_BYTES) {
  const type = String(request.headers['content-type'] || '').toLowerCase();
  if (!type.startsWith('application/json')) {
    request.resume();
    return Promise.reject(new HttpError(415, 'json_required', '请求体要 application/json'));
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    /** @type {Buffer[]} */
    const chunks = [];
    request.on('data', (chunk) => {
      if (tooLarge) return; // 继续排掉，错误应答才送得出去
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        reject(new HttpError(413, 'body_too_large', '请求体太大'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'invalid_json', '请求体不是合法 JSON'));
      }
    });
    request.on('error', reject);
  });
}

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {unknown} payload
 */
function sendJson(response, status, payload) {
  if (response.headersSent) {
    response.destroy();
    return;
  }
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
  return new Promise((resolve) => {
    server.close(() => resolve(undefined));
  });
}

// ---------------------------------------------------------------- 配置（dataDir）

const CONFIG_FILE = 'config.json';

/** @param {string} dataDir @returns {Promise<string>} 当前配置的论文根（未配置＝空串） */
async function readConfig(dataDir) {
  try {
    const raw = await fs.readFile(join(dataDir, CONFIG_FILE), 'utf8');
    const data = JSON.parse(raw);
    return typeof data?.root === 'string' ? data.root : '';
  } catch {
    return '';
  }
}

/** 原子写：同目录临时文件 → rename。宿主随时可能停进程，状态必须随变随落盘。 */
async function writeConfig(dataDir, root) {
  await fs.mkdir(dataDir, { recursive: true });
  const final = join(dataDir, CONFIG_FILE);
  const tmp = join(dataDir, `${CONFIG_FILE}.${process.pid}.tmp`);
  await fs.writeFile(tmp, `${JSON.stringify({ root }, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, final);
}

// ---------------------------------------------------------------- 自定义模型（dataDir）
//
// 用户自加的模型（OpenAI 兼容端点）：凭据只落插件私有 dataDir，**不进论文目录**，
// 也不进页面——页面只看得到 id／名称／模型名／有没有配密钥。

/** 自定义模型条目 → 页面可见的公开字段（**没有 apiKey**）。 */
function publicCustomModel(entry) {
  return {
    id: String(entry?.id || ''),
    label: String(entry?.label || entry?.model || ''),
    baseUrl: String(entry?.baseUrl || ''),
    model: String(entry?.model || ''),
    hasKey: Boolean(entry?.apiKey),
  };
}

/** 读自定义模型清单；文件坏掉就当没有（不因此崩掉面板）。 */
async function readCustomModels(dataDir) {
  let raw = '';
  try {
    raw = await fs.readFile(join(dataDir, CUSTOM_MODELS_FILE), 'utf8');
  } catch {
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed?.models) ? parsed.models : [];
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || '').trim();
    const model = String(item.model || '').trim();
    if (!id || !model) continue;
    out.push({
      id,
      label: String(item.label || model).trim(),
      baseUrl: String(item.baseUrl || '').trim(),
      model,
      apiKey: String(item.apiKey || ''),
    });
  }
  return out;
}

/** 原子写自定义模型清单（0600：里面有密钥）。 */
async function writeCustomModels(dataDir, models) {
  await fs.mkdir(dataDir, { recursive: true });
  const final = join(dataDir, CUSTOM_MODELS_FILE);
  const tmp = join(dataDir, `${CUSTOM_MODELS_FILE}.${process.pid}.tmp`);
  await fs.writeFile(tmp, `${JSON.stringify({ version: 1, models }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(tmp, final);
  await fs.chmod(final, 0o600).catch(() => {});
}

/** 校验并规整一条自定义模型；不合法就抛 HttpError（人话错误直接给页面）。 */
function sanitizeCustomModel(input) {
  const label = String(input?.label || '').trim();
  const baseUrl = String(input?.baseUrl || '').trim();
  const model = String(input?.model || '').trim();
  const apiKey = String(input?.apiKey || '').trim();
  if (!model) throw new HttpError(400, 'model_required', '模型名不能为空。');
  if (!baseUrl) throw new HttpError(400, 'base_url_required', 'Base URL 不能为空。');
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new HttpError(400, 'bad_base_url', 'Base URL 不是合法网址。');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(400, 'bad_base_url', 'Base URL 只许 http／https。');
  }
  if (label.length > 100 || baseUrl.length > 500 || model.length > 200 || apiKey.length > 500) {
    throw new HttpError(400, 'too_long', '字段太长了。');
  }
  const given = String(input?.id || '').trim();
  const id = given || `cm_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new HttpError(400, 'bad_id', '模型 id 不合法。');
  }
  return { id, label: label || model, baseUrl: baseUrl.replace(/\/+$/, ''), model, apiKey };
}

/**
 * 打一次 OpenAI 兼容的 chat/completions（只用标准库 fetch），回文本。
 * 失败一律抛 Error——降级措辞归调用方管。
 * @param {string} baseUrl @param {string} model @param {string} prompt @param {string} apiKey
 */
async function openAiChat(baseUrl, model, prompt, apiKey) {
  const url = String(baseUrl || '').replace(/\/+$/, '') + '/chat/completions';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CUSTOM_MODEL_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(apiKey ? { authorization: 'Bearer ' + apiKey } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        temperature: 0.2,
      }),
      signal: controller.signal,
    });
    const raw = await res.text();
    if (!res.ok) throw new Error('后端返回 HTTP ' + res.status);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new Error('后端返回的不是 JSON');
    }
    const text = extractOpenAiText(body);
    if (!text) throw new Error('后端返回体里没有可读文本');
    return text;
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error('后端超时（' + Math.round(CUSTOM_MODEL_TIMEOUT_MS / 1000) + ' 秒）');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** 从 OpenAI 兼容返回体里挖正文（content → reasoning_content → text）。 */
function extractOpenAiText(body) {
  const choices = body && typeof body === 'object' ? body.choices : null;
  if (!Array.isArray(choices) || !choices.length) return '';
  const first = choices[0] || {};
  const message = first.message || {};
  const content = typeof message.content === 'string' ? message.content.trim() : '';
  if (content) return content;
  const reasoning = typeof message.reasoning_content === 'string' ? message.reasoning_content.trim() : '';
  if (reasoning) return reasoning;
  const text = typeof first.text === 'string' ? first.text.trim() : '';
  return text;
}

/** 展开 ~ 开头的家目录写法，并解析成绝对路径。 */
function expandRoot(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const expanded = raw === '~' ? homedir() : raw.startsWith('~/') ? join(homedir(), raw.slice(2)) : raw;
  return resolvePath(expanded);
}

// ---------------------------------------------------------------- 首次设置页（未配置论文根时显示）

/**
 * @param {string} presetRoot 配置里有但目录不在这台机器上时，预填出来供改
 * @param {string[]} warnings 额外提示（如目录不存在、Python 缺失）
 */
function setupPageHtml(presetRoot, warnings) {
  const warnHtml = warnings.map((w) => `<p class="warn">${escapeHtml(w)}</p>`).join('');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FactScribe · 首次设置</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
         background: #f2f5f9; color: #1d2b3a; display: flex; min-height: 100vh; align-items: center; }
  main { margin: 0 auto; max-width: 560px; padding: 32px 28px; background: #fff; border-radius: 12px;
         box-shadow: 0 6px 24px rgba(29, 43, 58, .08); }
  h1 { font-size: 20px; margin: 0; }
  p { line-height: 1.7; font-size: 14px; }
  /* 中/EN 常显：首启页也有界面语言开关（同一枚，不藏）。 */
  .top { display: flex; align-items: center; gap: 12px; margin: 0 0 12px; }
  form { display: flex; gap: 8px; margin: 18px 0 6px; }
  input { flex: 1; font-size: 14px; padding: 9px 12px; border: 1px solid #c6d0dc; border-radius: 8px; }
  button { font-size: 14px; padding: 9px 20px; border: 0; border-radius: 8px; background: #2b4a6f; color: #fff; cursor: pointer; }
  button:disabled { opacity: .6; cursor: default; }
  .lang-seg { display: flex; gap: 2px; background: #ececeb; border-radius: 8px; padding: 3px; margin-left: auto; }
  .lang-seg button { min-width: 40px; font-family: inherit; font-size: 12.5px; padding: 4px 10px; border: none;
                     border-radius: 6px; background: transparent; color: #6b7a8c; cursor: pointer; }
  .lang-seg button.on { background: #fff; color: #1d2b3a; font-weight: 600; box-shadow: 0 1px 2px rgba(29, 43, 58, .12); }
  .warn { color: #a5482a; }
  .fine { color: #6b7a8c; font-size: 12px; }
  #msg { min-height: 20px; }
  @media (prefers-color-scheme: dark) {
    body { background: #131a22; color: #dbe4ee; }
    main { background: #1d2733; box-shadow: none; }
    input { background: #131a22; color: #dbe4ee; border-color: #3a4a5c; }
    .lang-seg { background: #27323f; }
    .lang-seg button { color: #9fb0c3; }
    .lang-seg button.on { background: #131a22; color: #dbe4ee; }
  }
</style>
</head>
<body>
<main>
  <div class="top">
    <h1 id="h1">FactScribe 论文工作台</h1>
    <div class="lang-seg" id="langSeg" role="group" aria-label="language">
      <button type="button" data-lang="zh" class="on">中</button>
      <button type="button" data-lang="en">EN</button>
    </div>
  </div>
  <p id="desc">第一次使用，先告诉我论文文件夹在哪里：这个目录下面（三层以内）放着一个个含
     <code>factscribe.toml</code> 的论文项目。我只读它来列出项目和章节；之后在页面里改正文时，
     才会写入该目录下 sections/ 的 .tex 文件（原子写、留 .bak、改动有指纹闸保护）。</p>
  ${warnHtml}
  <form id="f">
    <input id="root" type="text" placeholder="/Users/you/papers" autocomplete="off"
           spellcheck="false" value="${escapeHtml(presetRoot)}" autofocus>
    <button type="submit" id="go">应用</button>
  </form>
  <p id="msg"></p>
  <p class="fine" id="fine">支持 ~ 开头的家目录写法。配置只存在本插件的私有数据目录里，随时回这里改。</p>
</main>
<script>
  var DICT = {
    zh: {
      title: 'FactScribe · 首次设置',
      h1: 'FactScribe 论文工作台',
      desc: '第一次使用，先告诉我论文文件夹在哪里：这个目录下面（三层以内）放着一个个含 <code>factscribe.toml</code> 的论文项目。我只读它来列出项目和章节；之后在页面里改正文时，才会写入该目录下 sections/ 的 .tex 文件（原子写、留 .bak、改动有指纹闸保护）。',
      go: '应用',
      ph: '/Users/you/papers',
      fine: '支持 ~ 开头的家目录写法。配置只存在本插件的私有数据目录里，随时回这里改。',
      empty: '先填一个文件夹路径。',
      applying: '正在应用……',
      saved: '已保存，正在进入工作台……',
      savedWarn: '已保存，但引擎没起来：',
      fail: '保存失败，请检查路径。',
      neterr: '网络出错，请重试。'
    },
    en: {
      title: 'FactScribe · First-time setup',
      h1: 'FactScribe Paper Workbench',
      desc: 'First run: tell me where your papers live. That folder holds one paper project per subfolder (within three levels) containing a <code>factscribe.toml</code>. I only read it to list projects and sections; only when you edit text in the page do I write .tex files under that project sections/ directory (atomic write, a .bak kept, every change guarded by a fingerprint check).',
      go: 'Apply',
      ph: '/Users/you/papers',
      fine: 'A leading ~ means your home folder. The setting lives only in this plugin private data directory; come back here any time to change it.',
      empty: 'Type a folder path first.',
      applying: 'Applying…',
      saved: 'Saved. Opening the workbench…',
      savedWarn: 'Saved, but the engine did not start: ',
      fail: 'Could not save. Please check the path.',
      neterr: 'Network error. Please retry.'
    }
  };
  var lang = 'zh';
  function applyLang(next) {
    lang = (next === 'en') ? 'en' : 'zh';
    var d = DICT[lang];
    document.documentElement.lang = (lang === 'en') ? 'en' : 'zh-CN';
    document.title = d.title;
    document.getElementById('h1').textContent = d.h1;
    document.getElementById('desc').innerHTML = d.desc;
    document.getElementById('go').textContent = d.go;
    document.getElementById('fine').textContent = d.fine;
    document.getElementById('root').setAttribute('placeholder', d.ph);
    var buttons = document.querySelectorAll('#langSeg button');
    for (var i = 0; i < buttons.length; i += 1) {
      buttons[i].classList.toggle('on', buttons[i].getAttribute('data-lang') === lang);
    }
  }
  document.getElementById('langSeg').addEventListener('click', function (event) {
    var target = event.target;
    var button = (target && target.closest) ? target.closest('button[data-lang]') : null;
    if (!button) return;
    applyLang(button.getAttribute('data-lang'));
  });
  applyLang(lang);
  var form = document.getElementById('f');
  var msg = document.getElementById('msg');
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var button = document.getElementById('go');
    var d = DICT[lang];
    var root = document.getElementById('root').value.trim();
    if (!root) { msg.textContent = d.empty; return; }
    button.disabled = true;
    msg.textContent = d.applying;
    fetch('${SETUP_PATHS.api}', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: root })
    }).then(function (res) { return res.json(); }).then(function (data) {
      if (data && data.ok) {
        msg.textContent = data.warning ? (d.savedWarn + data.warning) : d.saved;
        setTimeout(function () { location.reload(); }, data.warning ? 2500 : 400);
      } else {
        msg.textContent = (data && data.error) || d.fail;
        button.disabled = false;
      }
    }).catch(function () {
      msg.textContent = d.neterr;
      button.disabled = false;
    });
  });
</script>
</body>
</html>
`;
}

/** @param {string} s */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);
}

// ---------------------------------------------------------------- Python 引擎（vendored，子进程）

/**
 * 引擎管理：spawn／探活／重启／收尸，全部收在这个闭包里。
 * 引擎 lazily 启动：首个业务请求（页面代理或 MCP 工具）需要时才拉起。
 * @param {{ context: { logger: Logger, dataDir: string, pluginRoot: string }, log: Logger }} env
 */
function createEngine(env) {
  const { context, log } = env;
  const engineDir = join(context.pluginRoot, ENGINE_DIR);

  /** @type {import('node:child_process').ChildProcess | null} */
  let child = null;
  let port = 0; // 引擎真实端口（握手行拿到后填）
  let engineRoot = ''; // 当前引擎用的论文根
  /** @type {Promise<void> | null} */
  let starting = null;
  let failedAt = 0;
  let lastFailure = '';
  let intentionalStop = false;
  /** @type {Promise<string> | null} */
  let pythonProbe = null;

  /** Python 命令发现：FS_PYTHON → python3 → python（全探版本 ≥3.10），缓存结果。 */
  function findPython() {
    if (!pythonProbe) {
      pythonProbe = (async () => {
        const candidates = [
          process.env.FS_PYTHON,
          'python3',
          'python', // Windows 装机常常只有这个名字
          '/usr/bin/python3',
          '/opt/homebrew/bin/python3',
          '/usr/local/bin/python3',
        ].filter((c) => typeof c === 'string' && c.length > 0);
        for (const candidate of /** @type {string[]} */ (candidates)) {
          try {
            await runProbe(candidate);
            return candidate;
          } catch {
            /* 试下一个 */
          }
        }
        return '';
      })();
    }
    return pythonProbe;
  }

  /** @param {string} command */
  function runProbe(command) {
    return new Promise((resolve, reject) => {
      // stdout/stdin 绝不继承（归宿主）；探测输出两边都不要。
      const child_ = spawn(command, ['-c', 'import sys; raise SystemExit(0 if sys.version_info[:2] >= (3, 10) else 1)'],
        { stdio: ['ignore', 'ignore', 'ignore'] });
      const timer = setTimeout(() => {
        try { child_.kill('SIGKILL'); } catch { /* 已退出 */ }
        reject(new Error('probe_timeout'));
      }, PYTHON_PROBE_TIMEOUT_MS);
      child_.on('error', (error) => { clearTimeout(timer); reject(error); });
      child_.on('exit', (code) => { clearTimeout(timer); (code === 0 ? resolve : reject)(undefined); });
    });
  }

  /**
   * 读引擎 stdout 的首行 listening JSON 握手（cli.py --json），拿到真实端口。
   * 超时或子进程先退 → 失败；其余 stdout 内容一律排掉（不归我们）。
   * @param {import('node:child_process').ChildProcess} c
   */
  function readHandshake(c) {
    return new Promise((resolve, reject) => {
      let buf = '';
      let tail = '';
      let settled = false;
      const timer = setTimeout(() => finish(new HttpError(503, 'engine_start_timeout', 'Python 引擎启动超时（20 秒内没等到就绪握手）')), ENGINE_START_TIMEOUT_MS);
      c.stderr?.setEncoding('utf8');
      c.stderr?.on('data', (chunk) => {
        for (const line of String(chunk).split('\n')) {
          const text = line.trim();
          if (!text) continue;
          tail = `${tail}\n${text}`.slice(-1600);
          log.info(`factscribe.engine: ${text.slice(0, 400)}`);
        }
      });
      c.stdout?.setEncoding('utf8');
      c.stdout?.on('data', (chunk) => {
        buf += String(chunk);
        const nl = buf.indexOf('\n');
        if (nl === -1) return;
        finish(null, buf.slice(0, nl).trim());
      });
      c.once('exit', (code, signal) => finish(new HttpError(503, 'engine_died', `Python 引擎启动即退（${signal || code}）。${tail.trim().slice(-400)}`)));
      /**
       * @param {null | HttpError} err
       * @param {string} [line]
       */
      function finish(err, line) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        c.stdout?.removeAllListeners('data');
        c.removeAllListeners('exit');
        c.stdout?.resume(); // 余下的 stdout 一律排掉，绝不堆积、绝不进宿主
        if (err) reject(err);
        else resolve(/** @type {string} */ (line));
      }
    });
  }

  /**
   * 拉起引擎（已在跑就先收掉旧的）。resolve 时引擎已在内部端口上就绪。
   * @param {string} root 论文根目录
   */
  async function start(root) {
    intentionalStop = false;
    lastFailure = '';
    const python = await findPython();
    if (!python) {
      failedAt = Date.now();
      lastFailure = '本机没有找到可用的 Python 3（需要 ≥3.10）。装一个 python3，或设环境变量 FS_PYTHON 指到你的 Python。';
      throw new HttpError(503, 'python_missing', lastFailure);
    }
    const c = spawn(python, ['-B', '-m', 'factscribe', 'workbench', '--root', root, '--port', '0', '--json', '--no-browser', '--state-dir', context.dataDir], {
      stdio: ['ignore', 'pipe', 'pipe'], // stdout 管道取握手行；绝不继承宿主 stdout
      env: {
        ...process.env,
        PYTHONPATH: engineDir + delimiter + (process.env.PYTHONPATH || ''),
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONDONTWRITEBYTECODE: '1', // 不往载荷里写 __pycache__（写盘只许 dataDir 与论文根）
      },
      cwd: context.dataDir, // 引擎不该依赖工作目录；放进宿主给的私有目录最保险
    });
    child = c;
    engineRoot = root;
    port = 0;
    log.info(`factscribe.engine.spawn root=${root.length} chars`);
    c.once('exit', (code, signal) => {
      if (child === c) {
        child = null;
        port = 0;
        if (!intentionalStop) log.warn(`factscribe.engine.exit ${signal || code}`);
      }
    });
    const line = await readHandshake(c);
    let realPort = 0;
    try {
      const handshake = JSON.parse(line);
      if (handshake?.event !== 'listening') throw new Error(`event=${handshake?.event}`);
      realPort = Number(new URL(String(handshake.url)).port);
    } catch {
      stop();
      failedAt = Date.now();
      lastFailure = 'Python 引擎握手行读不懂（不是预期的 listening JSON）。';
      throw new HttpError(503, 'engine_handshake_invalid', lastFailure);
    }
    if (!realPort) {
      stop();
      failedAt = Date.now();
      lastFailure = 'Python 引擎握手行里没有可用端口。';
      throw new HttpError(503, 'engine_handshake_invalid', lastFailure);
    }
    port = realPort;
    log.info(`factscribe.engine.ready port=${port}`);
  }

  /** 收尸：SIGTERM → 700ms 后还在就 SIGKILL；整体 ≤ 900ms。 */
  function stop() {
    const c = child;
    child = null;
    port = 0;
    if (!c) return Promise.resolve();
    intentionalStop = true;
    return new Promise((resolve) => {
      if (c.exitCode !== null || c.signalCode) return resolve();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve(undefined);
      };
      const killer = setTimeout(() => {
        try { c.kill('SIGKILL'); } catch { /* 已退出 */ }
      }, 700);
      c.once('exit', () => { clearTimeout(killer); finish(); });
      try { c.kill('SIGTERM'); } catch { clearTimeout(killer); finish(); }
      setTimeout(() => { clearTimeout(killer); finish(); }, 900);
    });
  }

  /** 引擎在跑就返回；没跑且配置了论文根就（重新）拉起。 */
  async function ensureReady() {
    if (child && port) return;
    if (starting) return starting;
    const configured = await readConfig(context.dataDir);
    if (!configured) {
      throw new HttpError(503, 'not_configured', '还没有配置论文根目录：请打开 FactScribe 工作台页面，完成一次首次设置。');
    }
    if (Date.now() - failedAt < 5000 && lastFailure) {
      throw new HttpError(503, 'engine_start_failed', lastFailure);
    }
    starting = start(configured).then(() => { failedAt = 0; }, (error) => {
      failedAt = Date.now();
      lastFailure = error?.userMessage || String(error);
      throw error;
    });
    try {
      await starting;
    } finally {
      starting = null;
    }
  }

  /** 换论文根：收旧的、起新的（设置页应用时走这里）。 */
  async function restart(root) {
    pythonProbe = null; // 用户可能刚装好 Python，重探
    await stop();
    await start(root);
  }

  return {
    ensureReady,
    restart,
    stop,
    /** 设置页诊断用：本机探到可用 Python（≥3.10）了吗（带缓存，探过即记）。 */
    pythonAvailable: async () => Boolean(await findPython()),
    /** @returns {number} 引擎端口（0＝没在跑） */
    get port() { return port; },
    /** @returns {string} 当前引擎的论文根 */
    get root() { return engineRoot; },
    get running() { return Boolean(child && port); },
  };
}

// ---------------------------------------------------------------- 引擎 HTTP 客户端（MCP 工具用）

/**
 * 对引擎内部端口发一个 POST（JSON 体），回 `{status, data}`——**不判 ok**。
 * AI 对话要原样带回引擎的降级回复（ok=false 但仍是 200），所以传输与判定要分开。
 * @param {number} port @param {string} path @param {object} body
 */
async function enginePostRaw(port, path, body) {
  return new Promise((resolve, reject) => {
    const raw = Buffer.from(JSON.stringify(body ?? {}), 'utf8');
    const upstream = httpRequest({ host: '127.0.0.1', port, path, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(raw.length), accept: 'application/json' } }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size <= 8 * 1024 * 1024) chunks.push(chunk);
      });
      res.on('end', () => {
        let data = null;
        try {
          data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          /* 非 JSON 按空处理 */
        }
        resolve({ status: res.statusCode || 0, data });
      });
      res.on('error', reject);
    });
    upstream.on('error', (error) => reject(new HttpError(502, 'engine_unreachable', `引擎端口够不着（${error?.code || error}）`)));
    upstream.end(raw);
  });
}

/**
 * 对引擎内部端口发一个 POST（JSON 体），回解析好的 JSON。
 * 建提议单要用它（GET 不够）。语义与 engineGet 一致：非 200 或 ok=false → HttpError。
 * @param {number} port @param {string} path @param {object} body
 */
async function enginePost(port, path, body) {
  const payload = await enginePostRaw(port, path, body);
  if (payload.status !== 200 || !payload.data || payload.data.ok === false) {
    const message = payload.data?.error || `引擎返回 HTTP ${payload.status}`;
    const codeName = typeof payload.data?.code === 'string' && payload.data.code
      ? payload.data.code
      : payload.status === 409 ? 'conflict'
        : payload.status === 404 ? 'not_found'
          : payload.status === 400 ? 'bad_request'
            : 'engine_error';
    throw new HttpError(payload.status === 200 ? 502 : payload.status, codeName, String(message));
  }
  return payload.data;
}

/**
 * 对引擎内部端口发一个 GET，回解析好的 JSON。非 200 或 ok=false → HttpError（带上人话）。
 * @param {number} port @param {string} pathWithQuery
 */
async function engineGet(port, pathWithQuery) {
  const payload = await new Promise((resolve, reject) => {
    const upstream = httpRequest({ host: '127.0.0.1', port, path: pathWithQuery, method: 'GET', headers: { accept: 'application/json' } }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size <= 8 * 1024 * 1024) chunks.push(chunk);
      });
      res.on('end', () => {
        let data = null;
        try {
          data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          /* 非 JSON 按空处理 */
        }
        resolve({ status: res.statusCode || 0, data });
      });
      res.on('error', reject);
    });
    upstream.on('error', (error) => reject(new HttpError(502, 'engine_unreachable', `引擎端口够不着（${error?.code || error}）`)));
    upstream.end();
  });
  if (payload.status !== 200 || !payload.data || payload.data.ok === false) {
    const message = payload.data?.error || `引擎返回 HTTP ${payload.status}`;
    const codeName = typeof payload.data?.code === 'string' && payload.data.code
      ? payload.data.code
      : payload.status === 404 ? 'not_found'
        : payload.status === 400 ? 'bad_request'
          : payload.status === 409 ? 'conflict'
            : 'engine_error';
    throw new HttpError(payload.status === 200 ? 502 : payload.status, codeName, String(message));
  }
  return payload.data;
}

// ---------------------------------------------------------------- MCP 工具面（只读检索面）

const READ_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const PROJECT_DISK = {
  project: { type: 'string', minLength: 1, maxLength: 200, description: '项目 ID（先 fs_status 拿清单）' },
  disk: { type: 'string', minLength: 1, maxLength: 200, description: '稿盘 ID（同一项目的语言盘，如 paper / paper-zh）' },
};

const TRUNCATE_NOTE = '结果已截断；更多内容请在 FactScribe 工作台页面查看。';

/** @type {{name: string, title: string, description: string, inputSchema: any, annotations: Record<string, boolean>}[]} */
const TOOLS = [
  {
    name: 'fs_status',
    title: '稿况总览',
    description:
      '【只读】列出 FactScribe 工作台当前的论文项目清单与正在使用的论文根目录：每个项目带语言盘（稿盘）列表，' +
      '每盘带章节数、事实条数、写作进度。一切其他 fs_* 工具都要先从这里拿 project 与 disk 两个 ID。' +
      '改稿类工具 v1 没有（v2 以「提议-确认」方式提供）。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: READ_ANNOTATIONS,
  },
  {
    name: 'fs_get_outline',
    title: '看目录树',
    description:
      '【只读】看某个稿盘的目录树（标题级）：每节给出 id / 所在文件 / 级别 / 标题 / 指纹 sha。' +
      '标题级条目的 id 可以直接用于后续检索定位；要读正文用 fs_read_section（传 file 或 block）。',
    inputSchema: {
      type: 'object',
      properties: PROJECT_DISK,
      required: ['project', 'disk'],
      additionalProperties: false,
    },
    annotations: READ_ANNOTATIONS,
  },
  {
    name: 'fs_read_section',
    title: '读一段正文',
    description:
      '【只读】读稿盘里的一段（或一个文件的全部块）正文。block 与 file 二选一：' +
      '传 block＝单段（先 fs_get_outline 或按 file 读时拿到块 id）；传 file＝该文件全部块按顺序返回。' +
      '返回的 text 是该段 LaTeX 原文——页面上的保护芯片（\\fact{} / \\cite{} / 绑定数字）在这里还原为原始命令形态。' +
      '注意：\\fact{}、\\cite{} 与绑定数字是事实账锚点，任何改稿都不得动它们（v1 也没有改稿工具）。',
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT_DISK,
        block: { type: 'string', maxLength: 200, description: '块 id（二选一；如 sec01-p3、cover-abstract）' },
        file: { type: 'string', maxLength: 300, description: 'sections/ 下的文件相对路径（二选一；如 sections/01_intro.tex）' },
      },
      required: ['project', 'disk'],
      additionalProperties: false,
    },
    annotations: READ_ANNOTATIONS,
  },
  {
    name: 'fs_get_report',
    title: '看检查报告',
    description:
      '【只读】看某个稿盘的最新检查报告（体检摘要＋发现清单＋声明→绑定→回账→出证四步链）。' +
      'health.status 为 red/yellow/ok；findings 里每条带 severity / code / message / location，' +
      '另带 message_key 与 params（i18n 读数：同一条发现的模板 key 与槽位取值）。' +
      '可选 lang=en 让文案出英文版（默认中文＝真闸原话）；改稿建议要以报告读数为依据；' +
      '报告本身不会因读它而变化。',
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT_DISK,
        lang: { type: 'string', enum: ['zh', 'en'], description: 'findings 文案的语言（默认 zh）' },
      },
      required: ['project', 'disk'],
      additionalProperties: false,
    },
    annotations: READ_ANNOTATIONS,
  },
  {
    name: 'fs_get_style',
    title: '看文风闸读数',
    description:
      '【只读】看某个稿盘的文风闸读数（与 CLI factscribe style 同一条分析路）：' +
      'status 为 ok/yellow/red；findings 里每条带 code / severity / message / location；' +
      'summary 与 metrics 给文风指标（句长、名词化率、连接词密度、段落模板等）；' +
      'rules 是实际生效的规则文件路径。' +
      '文风闸只读正文与规则文件，不改盘；它判的是「写得像不像论文」，不判事实真伪。',
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT_DISK,
        lang: { type: 'string', enum: ['zh', 'en'], description: 'findings 文案的语言（默认 zh）' },
      },
      required: ['project', 'disk'],
      additionalProperties: false,
    },
    annotations: READ_ANNOTATIONS,
  },
  {
    name: 'fs_mirror_check',
    title: '看双语对账读数',
    description:
      '【只读】比对同一项目的两个稿盘（语言盘）之间的事实账与参考文献：' +
      'status 为 ok/drift；drift 里每条带 code / kind（field=同一条两侧值不同、' +
      'missing=只在盘 A 有、extra=只在盘 B 有）/ target（fact 或 bib）/ id / field，' +
      '以及 disk_a 与 disk_b 两侧的取值与出处文件。' +
      '同一项目只有一个语言盘时报「不适用」（status=na）。对账只读两个盘，不改盘。',
    inputSchema: {
      type: 'object',
      properties: PROJECT_DISK,
      required: ['project', 'disk'],
      additionalProperties: false,
    },
    annotations: READ_ANNOTATIONS,
  },
  {
    name: 'fs_get_evidence_status',
    title: '看证据锁读数',
    description:
      '【只读】看某个稿盘的证据冻结状态：frozen（有没有冻结件）/ entries（冻结了多少条）/ ' +
      'sha256（冻结件指纹）/ current_sha256（当前清单的指纹）/ mismatch（冻结后清单被改过的明细，null＝一致）/ ' +
      'diff{added,removed,moved}（哪几节、哪几个 fact 动了）/ unfrozen（解冻状态与理由）/ ' +
      'last_log{action,reason,at}（最后一条日志）。' +
      '看到 EVIDENCE_SET_CHANGED 这条发现时，用它回答「哪几节动了、为什么红」。' +
      '本工具只读——冻结/解冻是写操作，走 fs_propose_evidence_freeze / fs_propose_evidence_unfreeze' +
      '（落提议单，人点「采纳写回」才写盘）。',
    inputSchema: {
      type: 'object',
      properties: PROJECT_DISK,
      required: ['project', 'disk'],
      additionalProperties: false,
    },
    annotations: READ_ANNOTATIONS,
  },
  {
    name: 'fs_get_brief',
    title: '看写作简报',
    description:
      '【只读】看某个稿盘的写作简报：这一节能引哪些已核验的数字。' +
      'sections 里每节给 file / title / facts / usable（可引用的事实 id）/ bound（这一节正文里已绑的）/ ' +
      'unbound（可引用但还没绑的）/ reconciled（声明是否都绑上了）；' +
      'facts 里每条给 id / claim / value / bound_in（绑在哪些节）/ status（bound / unbound）；' +
      'counts 给账上总数、已绑、未绑；terms 是术语表；constraints 是五条硬约束。' +
      '写稿前先来这里对账：账上没有的数字不得编造。',
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT_DISK,
        section: { type: 'string', maxLength: 120, description: '可选：节文件名词干前缀（如 04）' },
        fact: { type: 'string', maxLength: 80, description: '可选：事实 id——回一条「这条绑在哪几节」的定位（focus）' },
      },
      required: ['project', 'disk'],
      additionalProperties: false,
    },
    annotations: READ_ANNOTATIONS,
  },
  {
    name: 'fs_get_venue',
    title: '看版式配置',
    description:
      '【只读】看这个项目的版式配置：venue（刊物）/ deadline（截稿日）/ days_left（还剩几天）/ ' +
      'due_soon（临近截稿）/ overdue（已过期）/ lang_lock（语言锁定：中文稿不能换英文刊）/ ' +
      'templates（内置模板清单）。' +
      '刊物要求会约束改稿建议（页数上限、语言锁定），改稿前先对一眼。' +
      '本工具只读——改版式请人在页面里操作。',
    inputSchema: {
      type: 'object',
      properties: { project: { type: 'string', minLength: 1, maxLength: 200, description: '项目 ID（先 fs_status 拿清单）' } },
      required: ['project'],
      additionalProperties: false,
    },
    annotations: READ_ANNOTATIONS,
  },
  {
    name: 'fs_query_facts',
    title: '查事实账本',
    description:
      '【只读】查某个稿盘的事实账本（facts/*.toml 聚合出的账本表）：每条带 id / 主张 / 绑定值 / 置信度 / 来源文件与定位 / 指纹。' +
      '正文里的数字凡带 \\fact{} 就绑定到这里的 value——写任何涉及数字的内容前先来这里对账，' +
      '账上没有的数字不得编造。可选 query 按子串过滤（对 id / 主张 / 值 / 来源文件）。',
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT_DISK,
        query: { type: 'string', maxLength: 200, description: '可选：子串过滤（大小写不敏感，对 id/主张/值/来源文件匹配）' },
      },
      required: ['project', 'disk'],
      additionalProperties: false,
    },
    annotations: READ_ANNOTATIONS,
  },
  {
    name: 'fs_search_kb',
    title: '搜知识库',
    description:
      '【只读】搜项目知识库。不传 path＝列文件清单（可选 query 按文件名/路径子串过滤）；' +
      '传 path＝返回该文件的可读文本预览（文本类直接读，PDF 只登记不提取）。',
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT_DISK,
        query: { type: 'string', maxLength: 200, description: '可选：文件名/路径子串过滤' },
        path: { type: 'string', maxLength: 300, description: '可选：要读的文件相对路径（项目目录内；给了就返回文本预览）' },
      },
      required: ['project', 'disk'],
      additionalProperties: false,
    },
    annotations: READ_ANNOTATIONS,
  },
  {
    name: 'fs_propose_edit',
    title: '提议改稿（待人确认）',
    description:
      '【提议，不写盘】把一段改稿提成一**张提议单**：落宿主私有目录，**不碰正文**。' +
      '人在页面的「待确认」差异卡里看到改前/改后，由人点「采纳写回」才真正落盘；不采纳就什么都不写。' +
      'block 传段 id（先 fs_get_outline 或 fs_read_section 拿），text 是该段的完整替换 LaTeX。' +
      '铁律：不得凭空造 \\fact{} / \\cite{} 与账上没有的数字——写之前先 fs_query_facts 对账。',
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT_DISK,
        block: { type: 'string', maxLength: 200, description: '要改的段 id（如 01-intro-s1）' },
        text: { type: 'string', maxLength: 8000, description: '该段的完整替换 LaTeX（不含 \\fact{} / \\cite{} 等保护面命令）' },
        rationale: { type: 'string', maxLength: 500, description: '可选：为什么这么改（给人看的）' },
      },
      required: ['project', 'disk', 'block', 'text'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'fs_propose_evidence_freeze',
    title: '提议冻结证据清单（待人确认）',
    description:
      '【提议，不写盘】把「冻结当前 [evidence] 清单」提成一**张提议单**：落宿主私有目录，' +
      '**不碰冻结件**。人在页面的「待确认」差异卡里看过，由人点「采纳写回」才真正写 audit/evidence.lock；' +
      '不采纳就什么都不写。reason 可选（会写进证据流水账）。' +
      '冻结的是提议时那份清单——提议之后清单被改过，采纳时会拒写（指纹闸）。',
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT_DISK,
        reason: { type: 'string', maxLength: 500, description: '可选：冻结理由（写进 audit/evidence-log.ndjson）' },
      },
      required: ['project', 'disk'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'fs_propose_evidence_unfreeze',
    title: '提议解冻证据清单（待人确认）',
    description:
      '【提议，不写盘】把「解冻证据清单」提成一**张提议单**：不碰冻结件。' +
      'reason 必填——它会写进 audit/evidence-log.ndjson，是给未来的人看的「为什么当时改了清单」。' +
      'at 可选（YYYY-MM-DD）。由人在页面的「待确认」差异卡里点「采纳写回」才落盘。',
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT_DISK,
        reason: { type: 'string', maxLength: 500, description: '解冻理由（必填，写进证据流水账）' },
        at: { type: 'string', maxLength: 10, description: '可选：日期 YYYY-MM-DD' },
      },
      required: ['project', 'disk', 'reason'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'fs_propose_add_fact',
    title: '提议追加一条事实（待人确认）',
    description:
      '【提议，不写盘】把「往事实账追加一条」提成一**张提议单**：落宿主私有目录，**不碰账**。' +
      '人在页面的「待确认」差异卡里看过，由人点「采纳写回」才真正写进 facts/*.toml。' +
      'id / claim / value / source 必填——source 是 results/ 下的相对路径；value 是正文要绑的那个数字原文。' +
      'id 按大小写不敏感判重，账上已有的 id 会被拒。' +
      '铁律：账上没有的数字不得编造——先 fs_query_facts / fs_get_brief 对账。',
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT_DISK,
        id: { type: 'string', maxLength: 80, description: '事实 id（唯一键；只许字母开头，后接字母/数字/_ . : -）' },
        claim: { type: 'string', maxLength: 400, description: '这条事实主张什么' },
        value: { type: 'string', maxLength: 200, description: '正文要绑的那个数字原文' },
        source: { type: 'string', maxLength: 300, description: '来源文件（results/ 下的相对路径）' },
        locator: { type: 'string', maxLength: 200, description: '可选：来源里的定位（如 line 12）' },
        confidence: { type: 'string', enum: ['high', 'med', 'low'], description: '置信度（默认 med）' },
        expr: { type: 'string', maxLength: 200, description: '可选：推算式（derived_from 给了就必须给）' },
        derived_from: { type: 'string', maxLength: 300, description: '可选：父事实 id（逗号分隔）' },
        note: { type: 'string', maxLength: 300, description: '可选：备注' },
      },
      required: ['project', 'disk', 'id', 'claim', 'value', 'source'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'fs_propose_export_bundle',
    title: '提议导出投稿包（待人确认）',
    description:
      '【提议，不写盘】把「导出投稿包」提成一**张提议单**：不碰盘。' +
      '由人在页面的「待确认」差异卡里点「采纳写回」才真收集一次（正文＋账＋文献＋PDF）并过清单门；' +
      '门不过就不出包，提议单留在待确认。',
    inputSchema: {
      type: 'object',
      properties: PROJECT_DISK,
      required: ['project', 'disk'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'fs_list_proposals',
    title: '看待确认的提议单',
    description:
      '【只读】列当前待人确认的提议单：每条带 id、目标段、改前/改后、警告与理由。' +
      '用 fs_propose_edit 建单后用它核对；真正的采纳由人在页面点，助手这边没有写入接口。',
    inputSchema: {
      type: 'object',
      properties: { ...PROJECT_DISK },
      required: ['project', 'disk'],
      additionalProperties: false,
    },
    annotations: READ_ANNOTATIONS,
  },
];

const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

const INSTRUCTIONS = [
  'FactScribe 论文工作台（本机论文写作工具）的检索面：查稿况 → 看目录 → 读正文 → 看检查报告 → 看文风闸 → 看双语对账 → 看证据锁 → 看写作简报 → 对事实账 → 搜知识库 → 看版式。',
  '典型顺序：fs_status 拿项目与稿盘 ID → fs_get_outline 看目录 → fs_read_section 读某文件/某段 → fs_get_report 看体检 → fs_get_style 看文风闸 → fs_mirror_check 看双语对账 → fs_get_evidence_status 看证据锁 → fs_get_brief 看这一节能引哪些数 → fs_query_facts 对数字与引用的账 → fs_search_kb 翻项目资料 → fs_get_venue 看刊物要求。',
  'fs_get_report 与 fs_get_style 的 findings 文案默认中文（真闸原话）；要英文版就传 lang=en。',
  '铁律：正文里 \\fact{}、\\cite{} 与绑定数字是事实账锚点；账上没有的数字与文献不得编造；涉及数字的论述先 fs_get_brief / fs_query_facts 对账。',
  '写稿面只有「提议」这一条路，没有直写：fs_propose_edit（改一段正文）、fs_propose_add_fact（追加一条事实）、fs_propose_evidence_freeze / fs_propose_evidence_unfreeze（冻结/解冻证据清单）、fs_propose_export_bundle（导出投稿包）都只是落一张提议单（不写盘），由人在页面的「待确认」差异卡里点「采纳写回」才落盘；不采纳就什么都不写。助手这边没有任何直接改正文、直接改账、直接改冻结件的接口。',
  '工具结果设了长度上限，超限会带 truncated 标记——需要更多请让用户打开 FactScribe 工作台页面查看。',
].join('\n');

/**
 * 组装 MCP 的 tools/call 分发服务（每个工具＝转发引擎既有 GET 端点＋整形＋截断）。
 * @param {(pathWithQuery: string) => Promise<any>} get 引擎 GET 客户端
 * @param {(path: string, body: object) => Promise<any>} post 引擎 POST 客户端
 */
function createToolService(get, post, options) {
  const opts = options || {};
  /** @param {string} s @param {number} max */
  const cap = (s, max) => {
    const text = String(s ?? '');
    return text.length > max ? { text: text.slice(0, max), truncated: true } : { text, truncated: false };
  };

  /** 提一张「账与证据面」的提议单（只建单，不写盘）。 */
  const proposeLedger = async (project, disk, kind, body) => {
    const base = `/api/disk/${encodeURIComponent(project)}/${encodeURIComponent(disk)}`;
    const data = await post(`${base}/proposal`, { kind, source: 'mcp', ...body });
    const proposal = data.proposal || {};
    const before = cap(proposal.before_text, 2000);
    const after = cap(proposal.after_text, 2000);
    return {
      project, disk,
      id: proposal.id || '',
      kind: proposal.kind || kind,
      before_sha: proposal.before_sha || '',
      before_text: before.text,
      after_text: after.text,
      warnings: proposal.warnings || [],
      rationale: proposal.rationale || '',
      status: proposal.status || 'pending',
      note: '这是一张提议单，**账与证据面还没动**。请用户在 FactScribe 工作台的「待确认」差异卡里看过再采纳——不采纳就什么都不写。',
    };
  };

  return {
    /** fs_status */
    async status() {
      const data = await get('/api/projects');
      const projects = /** @type {any[]} */ (data.projects || []).map((p) => ({
        id: p.id,
        name: p.name,
        root: p.root,
        langs: p.langs,
        multi_lang: Boolean(p.multi_lang),
        disks: /** @type {any[]} */ (p.disks || []).map((d) => ({
          id: d.id,
          lang: d.lang,
          name: d.name,
          subtitle: d.subtitle || '',
          sections: d.sections,
          facts: d.facts,
          progress: d.progress,
          last_opened: d.last_opened || '',
        })),
      }));
      return {
        root: data.root,
        count: data.count,
        projects,
        // v3：宿主 Agent（MCode 模型）在不在——AI 面板能不能用它，就看这个。
        hostAgent: Boolean(opts.hostAgent),
        note: '后续 fs_* 工具都要传这里拿到的 project 与 disk。',
      };
    },

    /** fs_get_outline */
    async outline(args) {
      const { project, disk } = args;
      const data = await get(`/api/disk/${encodeURIComponent(project)}/${encodeURIComponent(disk)}/sections`);
      const all = /** @type {any[]} */ (data.blocks || []);
      const entries = all
        .filter((b) => b.kind !== 'para' && b.kind !== 'ai_draft')
        .map((b) => ({ id: b.id, file: b.file, kind: b.kind, level: b.level, title: b.title || '', title_en: b.title_en || '', sha: b.sha }));
      const truncated = entries.length > 400;
      const out = {
        project, disk,
        lang: data.lang || '',
        total_blocks: data.count || all.length,
        entry_count: entries.length,
        entries: truncated ? entries.slice(0, 400) : entries,
        hint: '段落级正文用 fs_read_section（传 file 或 block）读取。',
      };
      if (truncated) {
        out.truncated = true;
        out.note = TRUNCATE_NOTE;
      }
      return out;
    },

    /** fs_read_section */
    async readSection(args) {
      const { project, disk, block, file } = args;
      if (block && file) {
        throw new HttpError(400, 'invalid_arguments', 'block 与 file 二选一。');
      }
      if (block) {
        const data = await get(`/api/disk/${encodeURIComponent(project)}/${encodeURIComponent(disk)}/block/${encodeURIComponent(block)}`);
        const capped = cap(data.raw, 8000);
        const out = {
          project, disk,
          id: data.id, file: data.file, kind: data.kind, title: data.title || '',
          sha: data.sha,
          text: capped.text,
          note: 'text 为该段 LaTeX 原文：\\fact{} / \\cite{} / 绑定数字保持原始命令形态（页面上的芯片由它们渲染），改稿不得动它们。',
        };
        if (capped.truncated) {
          out.truncated = true;
          out.note += TRUNCATE_NOTE;
        }
        return out;
      }
      if (file) {
        const data = await get(`/api/disk/${encodeURIComponent(project)}/${encodeURIComponent(disk)}/sections`);
        const blocks = /** @type {any[]} */ (data.blocks || []).filter((b) => b.file === file);
        if (!blocks.length) {
          throw new HttpError(404, 'no_such_file', `这个盘上没有叫 ${file} 的正文文件（先 fs_get_outline 对一眼）。`);
        }
        let budget = 24000;
        let truncated = false;
        const items = [];
        for (const b of blocks) {
          const room = Math.min(8000, budget);
          if (room <= 0) {
            truncated = true;
            break;
          }
          const capped = cap(b.raw, room);
          budget -= capped.text.length;
          if (capped.truncated) truncated = true;
          items.push({ id: b.id, kind: b.kind, title: b.title || '', sha: b.sha, text: capped.text });
        }
        const out = { project, disk, file, block_count: blocks.length, blocks: items };
        if (truncated) {
          out.truncated = true;
          out.note = TRUNCATE_NOTE;
        }
        return out;
      }
      throw new HttpError(400, 'invalid_arguments', 'block 与 file 至少给一个（二选一）。');
    },

    /** fs_get_report */
    async report(args) {
      const { project, disk, lang } = args;
      const query = lang === 'en' ? '?lang=en' : '';
      const data = await get(
        `/api/disk/${encodeURIComponent(project)}/${encodeURIComponent(disk)}/report${query}`);
      const health = data.health || {};
      const findings = /** @type {any[]} */ (data.findings || []);
      const truncated = findings.length > 40;
      const out = {
        project, disk,
        generated_at: data.generated_at || '',
        health: {
          status: health.status,
          red: health.red, yellow: health.yellow, hints: health.hints,
          facts: health.facts, sections: health.sections,
          digest_short: health.digest_short || '',
          numbers: health.numbers || {},
          citations: health.citations || {},
          bib_unused: (health.bib_unused || []).slice(0, 20),
        },
        finding_count: findings.length,
        findings: (truncated ? findings.slice(0, 40) : findings).map((f) => ({
          severity: f.severity, code: f.code, message: f.message, location: f.location || '',
          message_key: f.message_key || '', params: f.params || {},
        })),
        chain: data.chain || [],
        evidence: data.evidence || {},
        // 文风闸与双语对账的读数（报告里同源的两道附加闸）。
        gates: {
          style: (data.gates && data.gates.style) || null,
          mirror: (data.gates && data.gates.mirror) || null,
        },
      };
      if (truncated) {
        out.truncated = true;
        out.note = TRUNCATE_NOTE;
      }
      return out;
    },

    /** fs_get_style */
    async style(args) {
      const { project, disk, lang } = args;
      const query = lang === 'en' ? '?lang=en' : '';
      const data = await get(
        `/api/disk/${encodeURIComponent(project)}/${encodeURIComponent(disk)}/style${query}`);
      const findings = /** @type {any[]} */ (data.findings || []);
      const truncated = findings.length > 40;
      const out = {
        project, disk,
        status: data.status || 'ok',
        gate: data.gate || 'style',
        red: data.red || 0,
        yellow: data.yellow || 0,
        count: data.count ?? findings.length,
        rules: data.rules || '',
        summary: data.summary || {},
        metrics: data.metrics || {},
        finding_count: findings.length,
        findings: (truncated ? findings.slice(0, 40) : findings).map((f) => ({
          severity: f.severity, code: f.code, message: f.message,
          location: f.location || '', message_key: f.message_key || '',
          params: f.params || {},
        })),
      };
      if (truncated) {
        out.truncated = true;
        out.note = TRUNCATE_NOTE;
      }
      return out;
    },

    /** fs_mirror_check */
    async mirrorCheck(args) {
      const { project, disk } = args;
      const data = await get(
        `/api/disk/${encodeURIComponent(project)}/${encodeURIComponent(disk)}/mirror`);
      const drift = /** @type {any[]} */ (data.drift || []);
      const truncated = drift.length > 40;
      const out = {
        project, disk,
        status: data.status || 'na',
        count: data.count ?? drift.length,
        disk_a: data.disk_a || '',
        disk_b: data.disk_b || '',
        summary: data.summary || {},
        drift_count: drift.length,
        drift: (truncated ? drift.slice(0, 40) : drift).map((d) => ({
          code: d.code, kind: d.kind, target: d.target, id: d.id,
          field: d.field || '', disk_a: d.disk_a || {}, disk_b: d.disk_b || {},
        })),
        note: data.note || '',
      };
      if (truncated) {
        out.truncated = true;
        out.note = TRUNCATE_NOTE;
      }
      return out;
    },

    /** fs_get_evidence_status */
    async evidenceStatus(args) {
      const { project, disk } = args;
      const data = await get(
        `/api/disk/${encodeURIComponent(project)}/${encodeURIComponent(disk)}/evidence`);
      return {
        project, disk,
        frozen: Boolean(data.frozen),
        entries: data.entries ?? 0,
        sha256: data.sha256 || '',
        sha256_short: data.sha256_short || '',
        current_sha256: data.current_sha256 || '',
        current_sha256_short: data.current_sha256_short || '',
        declared_sections: data.declared_sections ?? 0,
        declared: data.declared || {},
        mismatch: data.mismatch || null,
        diff: data.diff || { added: [], removed: [], moved: [] },
        unfrozen: data.unfrozen || null,
        last_log: data.last_log || {},
        note: 'mismatch 为 null 表示冻结件与当前清单一致；unfrozen 为 null 表示没解冻。',
      };
    },

    /** fs_get_brief */
    async brief(args) {
      const { project, disk, section, fact } = args;
      const params = [];
      if (section) params.push(`section=${encodeURIComponent(String(section))}`);
      if (fact) params.push(`fact=${encodeURIComponent(String(fact))}`);
      const query = params.length ? `?${params.join('&')}` : '';
      const data = await get(
        `/api/disk/${encodeURIComponent(project)}/${encodeURIComponent(disk)}/brief${query}`);
      const sections = /** @type {any[]} */ (data.sections || []);
      const facts = /** @type {any[]} */ (data.facts || []);
      return {
        project, disk,
        project_name: data.project || '',
        section: data.section || '',
        facts_total: data.facts_total ?? facts.length,
        counts: data.counts || {},
        sections: sections.map((s) => ({
          file: s.file || '', title: s.title || '',
          facts: s.facts ?? 0, budget: s.budget ?? 0,
          usable: s.usable || [], bound: s.bound || [], unbound: s.unbound || [],
          reconciled: Boolean(s.reconciled),
          evidence_source: s.evidence_source || '',
        })),
        facts: facts.map((f) => ({
          id: f.id || '', claim: f.claim || '', value: f.value || '',
          bound_in: f.bound_in || [], status: f.status || 'unbound',
        })),
        terms: data.terms || [],
        constraints: data.constraints || [],
        notes: data.notes || [],
        // fact 给定时才有的定位（这条事实绑在哪几节）。
        focus: data.focus || null,
        hint: 'usable＝可引用；bound＝正文里已绑；unbound＝可引用但还没绑。'
          + '给 fact=<id> 会多回一条 focus：这条事实绑在哪几节。',
      };
    },

    /** fs_get_venue */
    async venue(args) {
      const { project } = args;
      const data = await get(`/api/project/${encodeURIComponent(project)}/venue`);
      const lock = data.lang_lock || {};
      return {
        project,
        venue: data.venue || '',
        deadline: data.deadline || '',
        days_left: data.days_left ?? 0,
        due_soon: Boolean(data.due_soon),
        overdue: Boolean(data.overdue),
        deadline_label: data.deadline_label || '',
        warn_days: data.warn_days ?? 0,
        lang_lock: { lang: lock.lang || '', locked: Boolean(lock.locked),
          note: lock.note || '', note_key: lock.note_key || '' },
        templates: (data.templates || []).map((t) => ({
          id: t.id || '', name: t.name || '', note: t.note || '',
          name_key: t.name_key || '', note_key: t.note_key || '',
        })),
      };
    },

    /** fs_propose_evidence_freeze —— 只建单，不写盘 */
    async proposeEvidenceFreeze(args) {
      const { project, disk, reason } = args;
      return proposeLedger(project, disk, 'evidence_freeze', { reason: String(reason || '') });
    },

    /** fs_propose_evidence_unfreeze —— 只建单，不写盘 */
    async proposeEvidenceUnfreeze(args) {
      const { project, disk, reason, at } = args;
      return proposeLedger(project, disk, 'evidence_unfreeze',
        { reason: String(reason || ''), at: String(at || '') });
    },

    /** fs_propose_add_fact —— 只建单，不写盘 */
    async proposeAddFact(args) {
      const { project, disk, id, claim, value, source, locator, confidence, expr, derived_from, note } = args;
      // 事实的 source（results/ 下的文件）与提议单的来源（mcp）是两件事，
      // 不能共用一个键——平铺会把 source 覆盖掉，卡片上就成了「来源不明」。
      return proposeLedger(project, disk, 'add_fact', {
        fact: {
          id: String(id || ''), claim: String(claim || ''), value: String(value || ''),
          source: String(source || ''), locator: String(locator || ''),
          confidence: String(confidence || 'med'), expr: String(expr || ''),
          derived_from: String(derived_from || ''), note: String(note || ''),
        },
      });
    },

    /** fs_propose_export_bundle —— 只建单，不写盘 */
    async proposeExportBundle(args) {
      const { project, disk } = args;
      return proposeLedger(project, disk, 'export_bundle', {});
    },

    /** fs_query_facts */
    async facts(args) {
      const { project, disk } = args;
      const query = String(args.query || '').trim().toLowerCase();
      const data = await get(`/api/disk/${encodeURIComponent(project)}/${encodeURIComponent(disk)}/machine`);
      const ledger = data.groups?.ledger || {};
      const all = /** @type {any[]} */ (ledger.rows || []);
      const filtered = query
        ? all.filter((r) => `${r.id} ${r.claim} ${r.value} ${r.source_file}`.toLowerCase().includes(query))
        : all;
      const truncated = filtered.length > 100;
      const rows = (truncated ? filtered.slice(0, 100) : filtered).map((r) => ({
        id: r.id, claim: r.claim || '', value: r.value || '',
        confidence: r.confidence || '', kind: r.kind || 'claim',
        source_file: r.source_file || '', locator: r.locator || '',
        file: r.file || '', line: r.line || 0, fp_short: r.fp_short || '',
      }));
      const out = {
        project, disk,
        ledger_total: ledger.total ?? all.length,
        digest_short: ledger.digest_short || '',
        selected: rows.length,
        query: query || undefined,
        rows,
      };
      if (truncated) {
        out.truncated = true;
        out.note = TRUNCATE_NOTE;
      }
      return out;
    },

    /** fs_search_kb */
    async searchKb(args) {
      const { project, disk } = args;
      const query = String(args.query || '').trim().toLowerCase();
      const path = String(args.path || '').trim();
      if (path) {
        const data = await get(`/api/project/${encodeURIComponent(project)}/knowledge/preview?path=${encodeURIComponent(path)}`);
        const capped = cap(data.text, 4000);
        const out = {
          project,
          name: data.name, path: data.path, ext: data.ext,
          size_label: data.size_label || '', sha256: data.sha256 || '',
          status: data.status, status_label: data.status_label || '',
          text: capped.text,
          note: data.note || '',
        };
        if (capped.truncated || data.truncated) {
          out.truncated = true;
          out.note = (out.note ? `${out.note} ` : '') + TRUNCATE_NOTE;
        }
        return out;
      }
      const data = await get(`/api/project/${encodeURIComponent(project)}/knowledge`);
      const all = /** @type {any[]} */ (data.files || []);
      const filtered = query
        ? all.filter((f) => `${f.name} ${f.path} ${f.ext}`.toLowerCase().includes(query))
        : all;
      const truncated = filtered.length > 50;
      const out = {
        project,
        dir: data.dir || '',
        count: data.count ?? all.length,
        selected: filtered.length,
        query: query || undefined,
        files: (truncated ? filtered.slice(0, 50) : filtered).map((f) => ({
          name: f.name, path: f.path, size_label: f.size_label || '', ext: f.ext,
          status: f.status, status_label: f.status_label || '', in_knowledge: Boolean(f.in_knowledge),
        })),
        hint: '看某个文件的内容：再调一次并传 path。',
      };
      if (truncated) {
        out.truncated = true;
        out.note = TRUNCATE_NOTE;
      }
      return out;
    },

    /** fs_propose_edit —— 只建单，不写盘 */
    async proposeEdit(args) {
      const { project, disk, block, text, rationale } = args;
      const base = `/api/disk/${encodeURIComponent(project)}/${encodeURIComponent(disk)}`;
      // 先读这一段的现状（拿文件路径与指纹）：提议要基于一份确定的原文。
      const current = await get(`${base}/block/${encodeURIComponent(block)}`);
      const data = await post(`${base}/proposal`, {
        kind: 'block_edit',
        file: current.file,
        block,
        text,
        expect_sha: current.sha || '',
        source: 'mcp',
        rationale: rationale || '',
      });
      const proposal = data.proposal || {};
      const before = cap(proposal.before_text, 2000);
      const after = cap(proposal.after_text, 2000);
      return {
        project, disk,
        id: proposal.id || '',
        kind: proposal.kind || 'block_edit',
        file: proposal.file || current.file,
        block: proposal.block || block,
        before_sha: proposal.before_sha || '',
        before_text: before.text,
        after_text: after.text,
        warnings: proposal.warnings || [],
        rationale: proposal.rationale || '',
        status: proposal.status || 'pending',
        note: '这是一张提议单，**正文还没动**。请用户在 FactScribe 工作台的「待确认」差异卡里看过再采纳——不采纳就什么都不写。',
      };
    },

    /** fs_list_proposals —— 只读 */
    async listProposals(args) {
      const { project, disk } = args;
      const data = await get(`/api/disk/${encodeURIComponent(project)}/${encodeURIComponent(disk)}/proposal`);
      const rows = /** @type {any[]} */ (data.proposals || []);
      const truncated = rows.length > 20;
      const items = (truncated ? rows.slice(0, 20) : rows).map((p) => ({
        id: p.id,
        kind: p.kind,
        file: p.file,
        block: p.block,
        rationale: p.rationale || '',
        created_at: p.created_at || '',
        status: p.status,
        warnings: p.warnings || [],
        before_text: cap(p.before_text, 1200).text,
        after_text: cap(p.after_text, 1200).text,
      }));
      const out = {
        project, disk,
        count: data.count ?? rows.length,
        proposals: items,
        note: '真正的采纳由人在页面点「采纳写回」；助手这边没有写入接口。',
      };
      if (truncated) {
        out.truncated = true;
        out.note += TRUNCATE_NOTE;
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------- MCP 协议层（streamable-http，JSON 应答）

/**
 * @typedef {ReturnType<typeof createToolService>} ToolService
 */

/**
 * 组装 MCP 请求处理器（照 cq-viewer 的零依赖手写形）。
 * @param {ToolService} services
 * @param {(message: string) => void} log
 */
function createMcpHandler(services, log) {
  /** @param {any} message */
  const handleMessage = async (message) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return rpcError(null, -32600, 'Invalid Request');
    }
    if (message.id === undefined || message.id === null) return null; // notification / response：无应答
    const id = message.id;
    switch (message.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: typeof message.params?.protocolVersion === 'string' ? message.params.protocolVersion : '2025-06-18',
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
            instructions: INSTRUCTIONS,
          },
        };
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
      case 'tools/call': {
        const name = message.params?.name;
        const tool = typeof name === 'string' ? TOOLS_BY_NAME.get(name) : undefined;
        if (!tool) return rpcError(id, -32602, `Unknown tool: ${typeof name === 'string' ? name : '(missing)'}`);
        const args = message.params?.arguments ?? {};
        const issues = validate(tool.inputSchema, args, 'arguments');
        if (issues.length) {
          return result(id, failure('invalid_arguments', `参数不正确：${issues.join('；')}`));
        }
        log(`factscribe.mcp.call ${tool.name}`);
        try {
          const data = await dispatch(services, tool.name, args);
          return result(id, success(data));
        } catch (error) {
          const e = /** @type {any} */ (error);
          const known = e instanceof HttpError;
          return result(id, failure(known ? e.code : 'internal_error', known ? e.userMessage : '工作台内部出错，请重试'));
        }
      }
      default:
        return rpcError(id, -32601, `Method not found: ${String(message.method)}`);
    }
  };

  /** @param {unknown} body */
  return async (body) => {
    if (Array.isArray(body)) {
      if (body.length === 0) return rpcError(null, -32600, 'Invalid Request');
      /** @type {any[]} */
      const replies = [];
      for (const m of body) {
        const r = await handleMessage(m);
        if (r) replies.push(r);
      }
      return replies.length ? replies : null;
    }
    return handleMessage(body);
  };
}

/** @param {any} id @param {any} payload */
function result(id, payload) {
  return { jsonrpc: '2.0', id, result: payload };
}

/** @param {Record<string, unknown>} data */
function success(data) {
  const structuredContent = { ok: true, ...data };
  return { content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }], structuredContent };
}

/** @param {string} code @param {string} message */
function failure(code, message) {
  const structuredContent = { ok: false, error: { code, message } };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }], structuredContent };
}

/** @param {unknown} id @param {number} code @param {string} message */
function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

/** @param {ToolService} services @param {string} name @param {any} args */
function dispatch(services, name, args) {
  switch (name) {
    case 'fs_status': return services.status();
    case 'fs_get_outline': return services.outline(args);
    case 'fs_read_section': return services.readSection(args);
    case 'fs_get_report': return services.report(args);
    case 'fs_get_style': return services.style(args);
    case 'fs_mirror_check': return services.mirrorCheck(args);
    case 'fs_get_evidence_status': return services.evidenceStatus(args);
    case 'fs_get_brief': return services.brief(args);
    case 'fs_get_venue': return services.venue(args);
    case 'fs_query_facts': return services.facts(args);
    case 'fs_search_kb': return services.searchKb(args);
    case 'fs_propose_edit': return services.proposeEdit(args);
    case 'fs_propose_evidence_freeze': return services.proposeEvidenceFreeze(args);
    case 'fs_propose_evidence_unfreeze': return services.proposeEvidenceUnfreeze(args);
    case 'fs_propose_add_fact': return services.proposeAddFact(args);
    case 'fs_propose_export_bundle': return services.proposeExportBundle(args);
    case 'fs_list_proposals': return services.listProposals(args);
    default: throw new Error('unreachable');
  }
}

/**
 * 工具入参的最小 JSON Schema 校验（照 cq-viewer 的子集实现形）。
 * @param {any} schema @param {unknown} value @param {string} path
 * @returns {string[]}
 */
export function validate(schema, value, path) {
  /** @type {string[]} */
  const issues = [];
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.length && !types.some((t) => isType(t, value))) {
    issues.push(`${path} 应为 ${types.join(' 或 ')}`);
    return issues;
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) issues.push(`${path} 不能为空`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) issues.push(`${path} 太长`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) issues.push(`${path} 格式不对`);
  }
  if (isType('object', value)) {
    const obj = /** @type {Record<string, unknown>} */ (value);
    const props = schema.properties ?? {};
    for (const req of schema.required ?? []) if (!Object.hasOwn(obj, req)) issues.push(`缺少 ${path}.${req}`);
    for (const [k, v] of Object.entries(obj)) {
      if (props[k]) issues.push(...validate(props[k], v, `${path}.${k}`));
      else if (schema.additionalProperties === false) issues.push(`${path}.${k} 不是可用参数`);
    }
  }
  return issues;
}

/** @param {string} type @param {unknown} value */
function isType(type, value) {
  switch (type) {
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return Number.isInteger(value);
    case 'array':
      return Array.isArray(value);
    default:
      return typeof value === type;
  }
}

// ---------------------------------------------------------------- 入口

/** @typedef {{debug: (message: string, fields?: Record<string, string>) => void, info: (message: string, fields?: Record<string, string>) => void, warn: (message: string, fields?: Record<string, string>) => void, error: (message: string, fields?: Record<string, string>) => void}} Logger */

/**
 * MiniApp 入口：装完全部路由、listen 成功后才 resolve；返回 { dispose }。
 * @param {{ pluginId: string, pluginRoot: string, dataDir: string, listen: { host: string, port: number }, signal: AbortSignal, logger: Logger }} context
 * @returns {Promise<{ dispose: () => Promise<void> }>}
 */
export async function start(context) {
  const log = context.logger;
  const clientRoot = join(context.pluginRoot, CLIENT_DIR);

  const engine = createEngine({ context, log });

  // 页面与 MCP 工具共用的引擎 GET 客户端（先确保引擎在跑，再发请求）。
  const toolService = createToolService(
    async (pathWithQuery) => {
      await engine.ensureReady();
      return engineGet(engine.port, pathWithQuery);
    },
    async (path, body) => {
      await engine.ensureReady();
      return enginePost(engine.port, path, body);
    },
    // v3：宿主 Agent 在不在（MCode 模型能不能用）——fs_status 会回报它。
    { hostAgent: Boolean(context.agent) },
  );
  const handleMcp = createMcpHandler(toolService, (message) => log.info(message));

  /** @type {Map<string, string>} */
  const pageCache = new Map();
  async function setupPage() {
    const key = 'setup';
    if (pageCache.has(key)) return /** @type {string} */ (pageCache.get(key));
    const configured = await readConfig(context.dataDir);
    /** @type {string[]} */
    const warnings = [];
    if (configured) {
      warnings.push(`已保存的路径（${configured}）在这台机器上不存在或不是文件夹，请改一个真实的目录。`);
    }
    let pythonOk = false;
    try {
      pythonOk = await engine.pythonAvailable();
    } catch {
      pythonOk = false;
    }
    if (!pythonOk) warnings.push('没找到 python3：FactScribe 的引擎是 Python 写的，装好 Python ≥3.10 再来。');
    const html = setupPageHtml(configured, warnings);
    pageCache.set(key, html);
    return html;
  }

  /**
   * 反向代理：页面同源请求 /api/* 透传给 Python 引擎内部端口（只回环）。
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:http').ServerResponse} response
   */
  async function proxyApi(request, response) {
    await engine.ensureReady();
    const target = engine.port;
    const headers = { ...request.headers };
    delete headers.host;
    const upstream = httpRequest(
      { host: '127.0.0.1', port: target, path: request.url || '/api/', method: request.method, headers },
      (res) => {
        response.writeHead(res.statusCode || 502, res.headers);
        res.pipe(response);
      },
    );
    upstream.on('error', (error) => {
      if (!response.headersSent) {
        sendJson(response, 502, { ok: false, error: `引擎没应答（${error?.code || error}），稍后重试或回设置页检查。`, code: 502 });
      } else {
        response.destroy();
      }
    });
    response.on('close', () => upstream.destroy());
    request.on('error', () => upstream.destroy());
    request.pipe(upstream);
  }

  /**
   * 静态页面：client/ 三件套，防路径越界。
   * @param {import('node:http').ServerResponse} response
   * @param {string} rel
   */
  async function serveStatic(response, rel) {
    if (!/^[\w.-]+$/.test(rel) || rel.includes('..')) {
      return sendJson(response, 403, { ok: false, error: '路径越界', code: 403 });
    }
    const target = join(clientRoot, rel);
    const resolved = resolvePath(target);
    if (resolved !== clientRoot && !resolved.startsWith(clientRoot + sep)) {
      return sendJson(response, 403, { ok: false, error: '路径越界', code: 403 });
    }
    let body;
    try {
      body = await fs.readFile(resolved);
    } catch {
      return sendJson(response, 404, { ok: false, error: `没有这个文件：${rel}`, code: 404 });
    }
    response.writeHead(200, {
      'content-type': STATIC_TYPES[resolved.slice(resolved.lastIndexOf('.'))] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    response.end(body);
  }

  const server = createServer((request, response) => {
    void handle(request, response);
  });

  // ------------------------------------------------------------ 宿主 Agent 通道（AI 对话）
  //
  // 页面问一句 → 薄壳先用引擎把「材料」组好（与 /api/chat 同一套口径），
  // 再交给宿主 Agent 跑一轮——用的模型就是 mcode 自己那个。
  // 没有 context.agent（宿主旧版／未声明 agentAccess）→ 照旧走引擎的本地后端。

  /** @returns {any} 宿主 Agent 客户端（没有就是 undefined） */
  function agentClient() {
    return /** @type {any} */ (context).agent;
  }

  /**
   * 宿主的模型目录：`agent.models()`。
   * 形状：`{models:[{providerId, modelId, displayName?, thinking?:{efforts?, default?}, variants?}],
   * default:{providerId, modelId}}`。
   * 宿主不支持按回合选模型（老版本没有 models()）→ 返回 null，面板退回引擎本地后端清单。
   */
  async function hostCatalog() {
    const agent = agentClient();
    if (!agent || typeof agent.models !== 'function') return null;
    let catalog;
    try {
      catalog = await agent.models();
    } catch (error) {
      log.warn('factscribe.agent.models_failed ' + String(error?.message || error));
      return null;
    }
    if (!catalog || !Array.isArray(catalog.models)) return null;
    return catalog;
  }

  /**
   * 引擎那一条路的模型条目：核心的共用声明（catalog）转成面板的形状。
   * 形状与宿主／自定义两路一致：id / kind / label / model / efforts / defaultEffort。
   * @param {any} entry
   */
  function engineModelEntry(entry) {
    const label = String(entry?.label || entry?.model || '').trim();
    if (!label) return null;
    return {
      id: String(entry?.id || (ENGINE_MODEL_PREFIX + label)),
      kind: 'engine',
      label,
      model: String(entry?.model || label),
      efforts: Array.isArray(entry?.efforts) ? entry.efforts : [],
      defaultEffort: String(entry?.defaultEffort || ''),
    };
  }

  /** 宿主目录条目 → 面板条目（含这个模型支持哪些思考等级）。 */
  function hostModelEntry(entry) {
    const providerId = String(entry?.providerId || '').trim();
    const modelId = String(entry?.modelId || '').trim();
    const levels = Array.isArray(entry?.thinking?.efforts)
      ? entry.thinking.efforts.filter((e) => typeof e === 'string' && e.trim()) : [];
    const variants = Array.isArray(entry?.variants) ? entry.variants : [];
    return {
      id: HOST_MODEL_PREFIX + providerId + '/' + modelId,
      kind: 'host',
      label: String(entry?.displayName || modelId || providerId),
      providerId,
      modelId,
      // variants 里有 '' 表示「可以关掉思考」——那也是一个可选档。
      efforts: variants.includes('') ? [...levels, 'off'] : levels,
      defaultEffort: String(entry?.thinking?.default || ''),
      thinkingVariant: variants.includes('thinking'),
    };
  }

  /** provider 名给人看：去掉 custom_provider: 这种协议前缀（原来直接甩 raw id 给用户看）。 */
  function providerLabel(providerId) {
    return String(providerId || '').replace(/^custom_provider:/, '');
  }

  /**
   * 同一个模型在宿主目录里可能挂多条通道（官方通道＋自建通道）——
   * 面板下拉里逐条列就成了重复内容。按 modelId 只留一条：
   * 优先宿主当前路由（catalog.default 所在 provider）那条，其次目录里第一条；
   * 被折叠的 provider 记进 alsoVia（API 仍如实给出，页面不重复列）。
   * @param {any[]} models 宿主条目（原地重排）
   * @param {any} catalogDefault 宿主目录的默认项 {providerId, modelId}
   */
  function dedupeHostModels(models, catalogDefault) {
    const defaultProvider = String(catalogDefault?.providerId || '').trim();
    const kept = [];
    const byModel = new Map();
    for (const item of models) {
      if (item.kind !== 'host' || !item.modelId) { kept.push(item); continue; }
      const key = String(item.modelId).toLowerCase();
      const at = byModel.get(key);
      if (at === undefined) { byModel.set(key, kept.length); kept.push(item); continue; }
      const current = kept[at];
      const currentIsDefault = !!defaultProvider && current.providerId === defaultProvider;
      const candidateIsDefault = !!defaultProvider && item.providerId === defaultProvider;
      if (candidateIsDefault && !currentIsDefault) {
        current.alsoVia = (current.alsoVia || []).concat([current.providerId].filter(Boolean));
        item.alsoVia = (current.alsoVia || []).concat(item.alsoVia || []);
        kept[at] = item;
      } else {
        current.alsoVia = (current.alsoVia || []).concat([item.providerId].filter(Boolean));
      }
    }
    models.length = 0;
    for (const item of kept) models.push(item);
  }

  /**
   * 同名的模型分不清（目录里 displayName 可能重样）→ 重名的加 provider 尾注。
   * @param {any[]} models
   */
  function disambiguateHostLabels(models) {
    const counts = new Map();
    for (const item of models) {
      if (item.kind !== 'host') continue;
      counts.set(item.label, (counts.get(item.label) || 0) + 1);
    }
    for (const item of models) {
      if (item.kind !== 'host') continue;
      if (counts.get(item.label) > 1 && item.providerId) {
        item.label = item.label + ' (' + providerLabel(item.providerId) + ')';
      }
    }
  }

  /** 面板选中的（条目＋等级）→ 宿主 `run({model})` 要的形状。 */
  function hostSelection(entry, effort) {
    if (!entry) return undefined;
    const base = { providerId: entry.providerId, modelId: entry.modelId };
    const level = String(effort || '').trim();
    if (!level) {
      // 模型默认：thinking 变体与默认档都按目录给的来。
      if (entry.thinkingVariant) base.variant = 'thinking';
      if (entry.defaultEffort) base.thinking = { effort: entry.defaultEffort };
      return base;
    }
    if (level === 'off') return { ...base, variant: '' };
    if (!entry.efforts.includes(level)) return undefined;
    const out = { ...base };
    if (entry.thinkingVariant) out.variant = 'thinking';
    out.thinking = { effort: level };
    return out;
  }

  /**
   * 面板传来的模型选择：`{id, effort}`。
   * id 前缀决定走哪条路：host: 宿主模型／engine: 本地后端／custom: 自定义模型。
   */
  function readModelSelection(body) {
    const raw = body?.modelSelection;
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id || '').trim();
    if (!id) return null;
    const effort = String(raw.effort || '').trim();
    if (id.startsWith(CUSTOM_MODEL_PREFIX)) {
      return { kind: 'custom', id, effort, key: id.slice(CUSTOM_MODEL_PREFIX.length) };
    }
    if (id.startsWith(HOST_MODEL_PREFIX)) {
      return { kind: 'host', id, effort, key: id.slice(HOST_MODEL_PREFIX.length) };
    }
    if (id.startsWith(ENGINE_MODEL_PREFIX)) {
      return { kind: 'engine', id, effort, key: id.slice(ENGINE_MODEL_PREFIX.length) };
    }
    return null;
  }

  /**
   * 用宿主 Agent 跑一轮对话。
   * 返回 true＝这个响应已经写出（不再回落引擎）；false＝该回落引擎。
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:http').ServerResponse} response
   * @param {any} body
   */
  async function tryAgentChat(request, response, body, selection) {
    const agent = agentClient();
    if (!agent || typeof agent.run !== 'function') return false;
    // 用户点了宿主模型 → 先对目录核一遍：模型／等级不在目录里就别跑（宿主会拒，白跑一轮）。
    let model;
    let modelLabel = '';
    if (selection && selection.kind === 'host' && selection.id !== HOST_DEFAULT_ID) {
      const catalog = await hostCatalog();
      const entry = (catalog?.models || []).map(hostModelEntry).find((m) => m.id === selection.id);
      model = hostSelection(entry, selection.effort);
      if (!model) {
        sendJson(response, 400, {
          ok: false,
          code: 'MODEL_UNAVAILABLE',
          error: '宿主现在不提供这个模型／思考等级了，请重新选一个。',
        });
        return true;
      }
      modelLabel = entry.label;
    }
    let prepared;
    try {
      await engine.ensureReady();
      prepared = await enginePost(engine.port, AGENT_PREPARE_PATH, body);
    } catch (error) {
      log.warn('factscribe.agent.prepare_failed ' + String(error?.message || error));
      return false;
    }
    const prompt = String(prepared?.prompt || '');
    if (!prompt) return false;
    const wantsStream = String(request.headers.accept || '').includes('text/event-stream');
    const sessionId = String(body?.sessionId || '').trim();
    /** @type {any[]} */
    const pending = [];
    const denied = [];
    let skipped = 0;
    let streaming = false;
    /** @type {((payload: any) => void) | null} */
    let send = null;
    const startStream = () => {
      if (streaming) return;
      streaming = true;
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      send = (payload) => {
        try { response.write('data: ' + JSON.stringify(payload) + '\n\n'); } catch { /* 页面断了就算了 */ }
      };
      for (const item of pending) send(item);
      pending.length = 0;
    };
    const onEvent = (event) => {
      const type = String(event?.type || '');
      if (type === 'text.delta') {
        const text = String(event.text || '');
        if (!text) return;
        if (streaming) send?.({ type: 'delta', text });
        else pending.push({ type: 'delta', text });
        return;
      }
      if (type === 'permission.requested') {
        // 面板是只读的：工具调用一律回绝（模型会知道原因，改按材料回答）。
        denied.push(String(event.toolName || ''));
        try {
          const reply = agent.reply({
            sessionId: String(event.sessionId || ''),
            requestId: String(event.requestId || ''),
            decision: 'deny',
          });
          if (reply && typeof reply.catch === 'function') reply.catch(() => {});
        } catch { /* 旧宿主没有 reply */ }
        return;
      }
      if (type === 'question.requested') {
        // 面板里没有问卷界面：全部跳过，别把回合挂死。
        skipped += 1;
        const steps = Array.isArray(event?.request?.steps) ? event.request.steps : [];
        try {
          if (typeof agent.answer === 'function') {
            const answer = agent.answer({
              sessionId: String(event.sessionId || ''),
              requestId: String(event.requestId || ''),
              answers: steps.map((step) => ({
                stepId: String(step?.id || ''),
                selectedOptionIds: [],
                selectedOther: false,
                skipped: true,
              })),
            });
            if (answer && typeof answer.catch === 'function') answer.catch(() => {});
          }
        } catch { /* 旧宿主没有 answer */ }
      }
    };
    let result;
    try {
      const input = { text: prompt };
      if (sessionId) input.sessionId = sessionId;
      if (model) input.model = model;
      result = await agent.run(input, { onEvent });
    } catch (error) {
      const code = String(error?.code || '');
      if (model && code === 'INVALID_ARGUMENTS') {
        // 宿主不认这个模型／等级（多半已经下线）：明说，不偷换成别的模型答。
        sendJson(response, 400, {
          ok: false,
          code: 'MODEL_UNAVAILABLE',
          error: '宿主不接受这个模型／思考等级了，请重新选一个。',
        });
        return true;
      }
      if (!streaming) {
        log.warn('factscribe.agent.failed ' + String(error?.message || error));
        if (model) {
          // 用户明确点了模型：失败就明说失败，不拿别的模型顶上。
          sendJson(response, 502, {
            ok: false,
            code: code || 'AGENT_ERROR',
            error: '宿主模型这轮没跑成：' + String(error?.message || error),
          });
          return true;
        }
        return false; // 还没写响应 → 回落引擎
      }
      send?.({ type: 'error', message: String(error?.message || error) });
      try { response.end(); } catch { /* ignore */ }
      return true;
    }
    const reply = String(result?.text || '').trim();
    const notes = [];
    if (denied.length) notes.push('tools_denied:' + denied.join(','));
    if (skipped) notes.push('questions_skipped:' + String(skipped));
    const payload = {
      ok: true,
      fallback: false,
      reply,
      source: 'mcode-agent',
      model: modelLabel,
      effort: String(selection?.effort || ''),
      sessionId: String(result?.sessionId || sessionId || ''),
      code: '',
      error: '',
      notes,
    };
    if (streaming) {
      send?.({ type: 'done', ...payload });
      try { response.end(); } catch { /* ignore */ }
      return true;
    }
    if (!reply) return false; // 宿主这一轮没出文本 → 回落引擎
    if (wantsStream) {
      startStream();
      send?.({ type: 'done', ...payload });
      try { response.end(); } catch { /* ignore */ }
      return true;
    }
    sendJson(response, 200, payload);
    return true;
  }

  /**
   * 自定义模型：引擎组材料（与宿主通道同一套 prepare_prompt）→ OpenAI 兼容 chat/completions。
   * 凭据只在薄壳手里（dataDir），不进引擎、不进页面。
   * @param {import('node:http').ServerResponse} response @param {any} body
   * @param {{kind: string, id: string, key: string, effort: string}} selection
   */
  async function tryCustomChat(response, body, selection) {
    const models = await readCustomModels(context.dataDir);
    const entry = models.find((m) => m.id === selection.key);
    if (!entry) {
      return sendJson(response, 404, {
        ok: false,
        code: 'MODEL_NOT_FOUND',
        error: '这个自定义模型不在清单里（可能已经被删了）。',
      });
    }
    let prompt = '';
    try {
      await engine.ensureReady();
      const prepared = await enginePost(engine.port, AGENT_PREPARE_PATH, body);
      prompt = String(prepared?.prompt || '');
    } catch (error) {
      const e = /** @type {HttpError} */ (error);
      const status = typeof e?.status === 'number' ? e.status : 502;
      return sendJson(response, status, {
        ok: false,
        error: e?.userMessage || '材料没组装出来',
        code: e?.code || status,
      });
    }
    if (!prompt) {
      return sendJson(response, 502, { ok: false, code: 'PROMPT_FAILED', error: '材料没组装出来，问不了。' });
    }
    let reply = '';
    try {
      reply = await openAiChat(entry.baseUrl, entry.model, prompt, entry.apiKey);
    } catch (error) {
      const reason = String(error?.message || error);
      log.warn('factscribe.custom_model.failed ' + reason);
      // 诚实降级：明说「没接上」，绝不假装是模型答的。
      return sendJson(response, 200, {
        ok: false,
        fallback: true,
        reply: AI_FALLBACK_MARK + '\n后端没连上，下面这段不是模型的回答，只是占位，别当结论用。\n（原因：' + reason + '）',
        source: 'custom-model',
        model: entry.label,
        effort: '',
        code: 'CUSTOM_MODEL_UNAVAILABLE',
        error: reason,
        notes: [],
      });
    }
    return sendJson(response, 200, {
      ok: true,
      fallback: false,
      reply,
      source: 'custom-model',
      model: entry.label,
      effort: '',
      code: '',
      error: '',
      notes: [],
    });
  }

  async function handle(request, response) {
    const url = new URL(request.url ?? '/', 'http://miniapp.local');
    const path = url.pathname;
    const method = request.method ?? 'GET';

    // 每条路由先过回环守卫。
    if (!isLoopbackRequest(request, context.listen.port)) {
      return sendJson(response, 403, { ok: false, error: 'forbidden', code: 403 });
    }

    // MCP：宿主的 MCP 客户端走回环 POST（Streamable HTTP）。
    if (path === MCP_PATH) {
      if (method !== 'POST') {
        response.writeHead(405, { allow: 'POST', 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'method_not_allowed' }));
        return;
      }
      let body;
      try {
        const raw = await readRawBody(request, MAX_BODY_BYTES);
        body = raw.length ? JSON.parse(raw.toString('utf8')) : undefined;
      } catch {
        return sendJson(response, 400, { error: 'invalid_json' });
      }
      const reply = await handleMcp(body);
      if (reply === null) {
        response.writeHead(202);
        response.end();
        return;
      }
      return sendJson(response, 200, reply);
    }

    // 首次设置：未配置论文根（或配置的目录不在了）→ 页面路由伺服设置页。
    const configured = await readConfig(context.dataDir);
    const configuredOk = Boolean(configured) && (await isDir(configured));
    if (!configuredOk && (method === 'GET' || method === 'HEAD') && (path === SURFACE_PATH || path === '/' || path === '/index.html')) {
      const html = await setupPage();
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(html);
      return;
    }

    // 设置收表：写配置（原子写）→ 换根重启引擎 → 页面 reload 回工作台。
    if (method === 'POST' && path === SETUP_PATHS.api) {
      let body;
      try {
        body = /** @type {any} */ (await readJsonBody(request));
      } catch (error) {
        const e = /** @type {HttpError} */ (error);
        return sendJson(response, e.status, { ok: false, error: e.userMessage, code: e.status });
      }
      let root = '';
      try {
        root = expandRoot(body?.root);
      } catch {
        root = '';
      }
      if (!root || !(await isDir(root))) {
        return sendJson(response, 400, { ok: false, error: '这个目录不存在或不是文件夹，请填一个真实路径。' });
      }
      await writeConfig(context.dataDir, root);
      /** @type {string | undefined} */
      let warning;
      try {
        await engine.restart(root);
      } catch (error) {
        warning = /** @type {HttpError} */ (error)?.userMessage || String(error);
      }
      return sendJson(response, 200, warning ? { ok: true, warning } : { ok: true });
    }

    // 工作台页面与静态三件套（由 Node 直接伺服，与引擎无关）。
    if ((method === 'GET' || method === 'HEAD') && (path === SURFACE_PATH || path === '/' || path === '/index.html')) {
      const index = resolvePath(join(clientRoot, 'index.html'));
      const body = await fs.readFile(index);
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      response.end(body);
      return;
    }
    if ((method === 'GET' || method === 'HEAD') && path.startsWith('/static/')) {
      return serveStatic(response, path.slice('/static/'.length));
    }

    // AI 对话：宿主 Agent 优先（宿主模型＋思考等级）；选了自定义模型就去 OpenAI 兼容端点。
    // 没有 context.agent（宿主旧版／未声明 agentAccess）→ 照旧走引擎的本地后端。
    if (method === 'POST' && path === AGENT_CHAT_PATH) {
      let body;
      try {
        body = /** @type {any} */ (await readJsonBody(request));
      } catch (error) {
        const e = /** @type {HttpError} */ (error);
        return sendJson(response, e.status, { ok: false, error: e.userMessage, code: e.status });
      }
      const selection = readModelSelection(body);
      // 自定义模型：宿主不认这种模型，走薄壳自己的 OpenAI 兼容通道。
      if (selection && selection.kind === 'custom') {
        return await tryCustomChat(response, body, selection);
      }
      // 选了引擎本地后端的模型（宿主没有模型目录时的老路径）→ 直接问引擎，
      // 宿主 Agent 不接管这一路。
      const engineBody = selection && selection.kind === 'engine'
        ? { ...body, model: selection.key, effort: selection.effort || '' }
        : body;
      if (!(selection && selection.kind === 'engine')
        && agentClient() && await tryAgentChat(request, response, body, selection)) {
        return;
      }
      // 回落引擎的本地后端。注意：请求体已经被读掉了，不能再走代理（代理会等一个
      // 永远不来的 body），所以直接问引擎、原样把结果写回去（降级回复也是 200）。
      try {
        await engine.ensureReady();
        const raw = await enginePostRaw(engine.port, AGENT_CHAT_PATH, engineBody);
        return sendJson(response, raw.status || 200, raw.data || { ok: false, error: '引擎没应答', code: 502 });
      } catch (error) {
        const e = /** @type {HttpError} */ (error);
        const status = typeof e?.status === 'number' ? e.status : 502;
        return sendJson(response, status, { ok: false, error: e?.userMessage || '引擎暂不可用', code: status });
      }
    }
    // 模型清单：宿主模型（带思考等级）＋ 引擎本地后端模型 ＋ 自定义模型。
    if ((method === 'GET' || method === 'HEAD') && path === AGENT_MODELS_PATH) {
      const models = [];
      let source = 'engine';
      const catalog = await hostCatalog();
      if (catalog) {
        // 「宿主默认」放最前：不指定模型＝用 MCode 当前这个模型（和旧行为一致）。
        // isDefault＝它是一个**显式档位**（页面据此单列一组；语义不变，
        // 选中的还是同一个 id、同一份请求）。
        models.push({ id: HOST_DEFAULT_ID, kind: 'host', label: AGENT_MODEL_LABEL, isDefault: true, efforts: [], defaultEffort: '' });
        for (const entry of catalog.models) models.push(hostModelEntry(entry));
        // 同一个模型挂了几条通道的，页面上只列一条（折叠掉的记在 alsoVia 里）。
        dedupeHostModels(models, catalog.default);
        disambiguateHostLabels(models);
        source = 'mcode-agent';
      } else {
        // 宿主没有目录 → 问引擎要本地后端的清单（workbench.toml 的 [ai].models）。
        try {
          await engine.ensureReady();
          const query = AGENT_MODELS_PATH
            + '?project=' + encodeURIComponent(url.searchParams.get('project') || '')
            + '&disk=' + encodeURIComponent(url.searchParams.get('disk') || '');
          const data = await engineGet(engine.port, query);
          // 引擎那一份直接用核心的**共用声明**（catalog：id / kind / label /
          // model / efforts / defaultEffort）——两侧的「同一个模型」是同一个概念。
          // 老引擎没有 catalog 就退回按 models 拼（形状一样）。
          const declared = Array.isArray(data?.catalog?.models) ? data.catalog.models : null;
          if (declared) {
            for (const entry of declared) {
              const item = engineModelEntry(entry);
              if (item) models.push(item);
            }
          } else {
            for (const name of (Array.isArray(data?.models) ? data.models : [])) {
              const item = engineModelEntry({ id: ENGINE_MODEL_PREFIX + name, label: name, model: name });
              if (item) models.push(item);
            }
          }
        } catch (error) {
          log.warn('factscribe.models.engine_failed ' + String(error?.message || error));
        }
      }
      // 自定义模型（用户自加）：跟宿主模型并列，凭据不出 dataDir。
      for (const entry of await readCustomModels(context.dataDir)) {
        models.push({
          id: CUSTOM_MODEL_PREFIX + entry.id,
          kind: 'custom',
          label: entry.label,
          model: entry.model,
          efforts: [],
          defaultEffort: '',
        });
      }
      let model = '';
      if (source === 'mcode-agent') model = HOST_DEFAULT_ID;
      else if (models.length) model = models[0].id;
      return sendJson(response, 200, {
        ok: true,
        project: url.searchParams.get('project') || '',
        disk: url.searchParams.get('disk') || '',
        models,
        model,
        source,
      });
    }
    // 自定义模型（用户自加）：凭据只落插件私有 dataDir，不进论文目录、不进页面。
    if (path === CUSTOM_MODELS_PATH && (method === 'GET' || method === 'HEAD')) {
      const models = await readCustomModels(context.dataDir);
      return sendJson(response, 200, { ok: true, models: models.map(publicCustomModel) });
    }
    if (path === CUSTOM_MODELS_PATH && method === 'POST') {
      let body;
      try {
        body = /** @type {any} */ (await readJsonBody(request));
      } catch (error) {
        const e = /** @type {HttpError} */ (error);
        return sendJson(response, e.status, { ok: false, error: e.userMessage, code: e.status });
      }
      try {
        const entry = sanitizeCustomModel(body);
        const models = await readCustomModels(context.dataDir);
        const at = models.findIndex((m) => m.id === entry.id);
        if (at >= 0) models[at] = entry;
        else models.push(entry);
        await writeCustomModels(context.dataDir, models);
        return sendJson(response, 200, { ok: true, models: models.map(publicCustomModel) });
      } catch (error) {
        const e = error instanceof HttpError
          ? error
          : new HttpError(400, 'bad_request', String(error?.message || error));
        return sendJson(response, e.status, { ok: false, error: e.userMessage, code: e.code });
      }
    }
    const customMatch = /^\/api\/ai\/custom-models\/([A-Za-z0-9_-]{1,64})$/.exec(path);
    if (customMatch && method === 'DELETE') {
      const id = customMatch[1];
      const models = await readCustomModels(context.dataDir);
      const kept = models.filter((m) => m.id !== id);
      if (kept.length === models.length) {
        return sendJson(response, 404, { ok: false, error: '没有这个自定义模型。', code: 404 });
      }
      await writeCustomModels(context.dataDir, kept);
      return sendJson(response, 200, { ok: true, models: kept.map(publicCustomModel) });
    }

    // 业务请求：全部透传 Python 引擎（设置接口除外，上面已收）。
    if (path === '/api' || path.startsWith('/api/')) {
      try {
        return await proxyApi(request, response);
      } catch (error) {
        const e = /** @type {HttpError} */ (error);
        const status = typeof e?.status === 'number' ? e.status : 502;
        return sendJson(response, status, { ok: false, error: e?.userMessage || '引擎暂不可用', code: status });
      }
    }

    return sendJson(response, 404, { ok: false, error: 'not_found', code: 404 });
  }

  await listen(server, context.listen.host, context.listen.port);
  log.info('factscribe.agent.available ' + String(Boolean(context.agent)));
  log.info('factscribe.listening');

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    context.signal.removeEventListener('abort', onAbort);
    server.closeAllConnections?.();
    server.closeIdleConnections?.();
    await Promise.race([close(server), delay(400)]);
    await engine.stop(); // 宿主只停 Node；Python 子进程必须亲手收
  };
  const onAbort = () => {
    void dispose();
  };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  return { dispose };
}

/** @param {string} path */
async function isDir(path) {
  try {
    return (await fs.stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 读取原始请求体（MCP 用：宿主客户端的 Content-Type 不一定带 application/json）。
 * @param {import('node:http').IncomingMessage} request
 * @param {number} maxBytes
 */
function readRawBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    /** @type {Buffer[]} */
    const chunks = [];
    request.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        reject(new HttpError(413, 'body_too_large', '请求体太大'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (!tooLarge) resolve(Buffer.concat(chunks));
    });
    request.on('error', reject);
  });
}
