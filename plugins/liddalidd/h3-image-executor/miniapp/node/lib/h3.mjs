// H3-Image 接口客户端：文生图 / 图像编辑 / 参考图上传。
// Key 与接口地址解析顺序：页面里保存的配置 -> 进程环境变量 -> 用户 shell 配置。
//
// 这里不内置任何默认接口地址。H3-Image 的接口地址随账号开通渠道而定，
// 写死一个地址既会把这个包绑死在某个环境上，也会让拿到包的人以为自己开箱可用。
// 没有地址就直接判未就绪，让用户在页面里填。
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, basename, extname } from 'node:path';
import { fetchImage } from './urlguard.mjs';

export const DEFAULT_BASE_URL = '';
// 早期的预览版模型名已经下线，平台现在只认正式名（区分大小写）。
// 用旧名字会稳定返回 HTTP 400：unknown model "..." must be one of MiniMax-H3-Image。
export const DEFAULT_MODEL = 'MiniMax-H3-Image';
export const CANDIDATE_MODELS = ['MiniMax-H3-Image'];
const SHELL_FILES = ['.zshrc', '.zprofile', '.bash_profile', '.profile'];
const REF_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);
const TIMEOUT_MS = 600000;
// 单张生成图的字节上限。4K PNG 一般在几十 MB 以内，留足余量。
const MAX_IMAGE_BYTES = 100 * 1024 * 1024;

// 服务端的临时故障：网关 502/503/504、限流 429、500，以及连不上、连接被重置。这些等一等再试有意义；
// 400/401/403/404 是请求本身的问题，重试多少次都一样。
// 生图、上传、下载各自在这里退避重试两次，间隔逐次拉长，给网关恢复的时间。重试完还失败，
// 抛出的错误带 transient = true，上层据此决定「先交付手上已有的图」，而不是把整个会话判死
// （真机 20261112-23b706 / 463fcd：网关一次 502 就让两个会话各丢掉 8 张、4 张已经生成好的图）。
// delays 导出成可改的对象，测试里改小，不用真等。
export const RETRY = { delays: [4000, 12000] };
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);
// 上传接口 base_resp 里表示临时故障的状态码：1001 超时、1002 / 1039 限流、1013 服务内部错误。
const TRANSIENT_BASE_CODES = new Set([1001, 1002, 1013, 1039]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 连不上、连接被重置、DNS 一时解析不了。等满 10 分钟的超时不在此列：再等一轮不划算。
function isNetworkError(error) {
  if (!error || error.name === 'TimeoutError' || error.name === 'AbortError') return false;
  const cause = error.cause || {};
  const code = String(cause.code || error.code || '');
  return /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT|UND_ERR_CLOSED)$/.test(code) ||
    /fetch failed|socket hang up|other side closed/i.test(String(error.message || ''));
}

function markTransient(error, transient) {
  if (transient) error.transient = true;
  return error;
}

// 网关回的错误页常常是一整段 HTML（真机：<html><head><title>502 Bad Gateway</title>…），
// 原样塞进时间线既难看又看不出要点。取 title，没有就去掉标签。
function briefBody(text) {
  const raw = String(text || '');
  const title = /<title>([^<]*)<\/title>/i.exec(raw);
  const plain = title ? title[1] : raw.replace(/<[^>]*>/g, ' ');
  return plain.replace(/\s+/g, ' ').trim().slice(0, 200);
}

let cached = null;
// 页面里保存的配置。放在模块作用域，由 server 启动时从 dataDir 读进来、
// 保存时更新。Key 只在 Node 进程里流转，绝不回传给页面。
let stored = null;

export function setStoredSettings(value) {
  const key = value && value.apiKey ? String(value.apiKey).trim() : '';
  const url = value && value.baseUrl ? String(value.baseUrl).trim() : '';
  stored = key ? { apiKey: key, baseUrl: url } : null;
  cached = null;
  return stored;
}

export function getStoredSettings() {
  return stored;
}

export async function resolveConfig(force) {
  if (cached && !force) return cached;
  // 页面优先：用户在这里明确表达过意图，环境变量不该盖掉它。
  let apiKey = stored ? stored.apiKey : '';
  let baseUrl = stored ? stored.baseUrl : '';
  let source = apiKey ? 'app' : '';
  if (!apiKey) {
    apiKey = process.env.MINIMAX_API_KEY || process.env.MCODE_API_KEY || '';
    baseUrl = process.env.MINIMAX_BASE_URL || '';
    source = apiKey ? 'env' : '';
  }
  if (!apiKey || !baseUrl) {
    for (const name of SHELL_FILES) {
      let text = '';
      try {
        text = await readFile(join(homedir(), name), 'utf8');
      } catch {
        continue;
      }
      if (!apiKey) {
        const m = text.match(/^\s*export\s+(?:MINIMAX_API_KEY|MCODE_API_KEY)=["']?([^"'\s#]+)["']?/m);
        if (m) {
          apiKey = m[1];
          source = 'shell:' + name;
        }
      }
      if (!baseUrl) {
        const m = text.match(/^\s*export\s+MINIMAX_BASE_URL=["']?([^"'\s#]+)["']?/m);
        if (m) baseUrl = m[1];
      }
      if (apiKey && baseUrl) break;
    }
  }
  cached = {
    apiKey: apiKey || '',
    baseUrl: (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    source: source || 'none',
    model: process.env.H3_IMAGE_MODEL || DEFAULT_MODEL,
  };
  return cached;
}

export function configSummary(config) {
  const key = config.apiKey;
  return {
    ready: Boolean(key && config.baseUrl),
    hasKey: Boolean(key),
    hasBaseUrl: Boolean(config.baseUrl),
    // 只给前缀和长度：够用户确认「是哪个 Key、长度对不对」，但不能反推出尾部字符。
    keyPreview: key ? key.slice(0, 6) + '…' : '',
    keyLength: key.length,
    source: config.source,
    baseUrl: config.baseUrl,
    model: config.model,
    models: CANDIDATE_MODELS,
  };
}

function authHeaders(config) {
  return { Authorization: 'Bearer ' + config.apiKey };
}

export async function generate(config, options) {
  const payload = { model: options.model || config.model, prompt: options.prompt };
  applySize(payload, options);
  if (options.n && options.n > 1) payload.n = options.n;
  if (options.outputFormat) payload.output_format = options.outputFormat;
  if (options.disablePromptEnhanced) payload.disable_prompt_enhanced = true;
  return post(config, '/v1/images/generations', payload, '文生图');
}

export async function edit(config, options) {
  const payload = {
    model: options.model || config.model,
    prompt: options.prompt,
    images: options.images.map((imageUrl) => ({ image_url: imageUrl })),
  };
  applySize(payload, options);
  if (options.n && options.n > 1) payload.n = options.n;
  if (options.outputFormat) payload.output_format = options.outputFormat;
  return post(config, '/v1/images/edits', payload, '图像编辑');
}

function applySize(payload, options) {
  if (options.size) {
    payload.size = options.size;
    return;
  }
  if (options.aspectRatio) payload.aspect_ratio = options.aspectRatio;
  if (options.area) payload.area = options.area;
}

async function post(config, path, payload, label) {
  if (!config.apiKey) throw new Error('missing_api_key');
  if (!config.baseUrl) throw new Error('missing_base_url');
  for (let attempt = 0; ; attempt += 1) {
    const canRetry = attempt < RETRY.delays.length;
    let response;
    try {
      response = await fetch(config.baseUrl + path, {
        method: 'POST',
        headers: { ...authHeaders(config), 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const transient = isNetworkError(error);
      if (transient && canRetry) {
        await sleep(RETRY.delays[attempt]);
        continue;
      }
      throw markTransient(error, transient);
    }
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    if (response.status !== 200) {
      const transient = TRANSIENT_STATUS.has(response.status);
      if (transient && canRetry) {
        await sleep(RETRY.delays[attempt]);
        continue;
      }
      const message = (body && body.error && body.error.message) || briefBody(text);
      const error = new Error(label + '失败 HTTP ' + response.status + '：' + message);
      error.status = response.status;
      error.requestId = body && body.request_id;
      throw markTransient(error, transient);
    }
    return normalize(body);
  }
}

function normalize(body) {
  const data = Array.isArray(body.data) ? body.data : [];
  return {
    requestId: body.request_id || '',
    outputFormat: body.output_format || 'png',
    usage: body.usage || null,
    items: data.map((item) =>
      item && item.error
        ? { error: (item.error && item.error.message) || '生成失败' }
        : { url: item.url, size: item.size || '', revisedPrompt: item.revised_prompt || '' },
    ),
  };
}

// 本地参考图 -> 上传 -> mm_file:// 引用；URL / data URI / mm_file:// 原样透传。
export async function resolveReference(config, ref) {
  if (/^(https?:\/\/|mm_file:\/\/|data:)/.test(ref)) return ref;
  const ext = extname(ref).toLowerCase();
  if (!REF_EXT.has(ext)) throw new Error('参考图格式不支持：' + ext);
  return uploadReference(config, ref);
}

export async function uploadReference(config, filePath) {
  if (!config.apiKey) throw new Error('missing_api_key');
  if (!config.baseUrl) throw new Error('missing_base_url');
  const buffer = await readFile(filePath);
  for (let attempt = 0; ; attempt += 1) {
    const canRetry = attempt < RETRY.delays.length;
    const form = new FormData();
    form.append('purpose', 'image_generation_input');
    form.append('file', new Blob([buffer]), basename(filePath));
    let response;
    try {
      response = await fetch(config.baseUrl + '/v1/files/upload', {
        method: 'POST',
        headers: authHeaders(config),
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const transient = isNetworkError(error);
      if (transient && canRetry) {
        await sleep(RETRY.delays[attempt]);
        continue;
      }
      throw markTransient(new Error('参考图上传失败：' + String(error && error.message ? error.message : error), { cause: error }), transient);
    }
    const body = await response.json().catch(() => null);
    const baseResp = (body && body.base_resp) || {};
    if (response.status === 200 && baseResp.status_code === 0 && body.file && body.file.file_id) {
      return 'mm_file://' + body.file.file_id;
    }
    const transient = response.status === 200
      ? TRANSIENT_BASE_CODES.has(Number(baseResp.status_code))
      : TRANSIENT_STATUS.has(response.status);
    if (transient && canRetry) {
      await sleep(RETRY.delays[attempt]);
      continue;
    }
    const error = new Error('参考图上传失败：' + (baseResp.status_msg || 'HTTP ' + response.status));
    error.status = response.status;
    throw markTransient(error, transient);
  }
}

export async function download(url, targetPath) {
  // 成图地址来自接口返回。接口本身可能是内网地址（放行），但云元数据段必须拦，
  // 而且每一跳重定向都要重新拦一遍——fetchImage 负责这两件事，并给响应体封顶。
  // 图已经生成好了（已经计费），下载失败不该让整轮重画：连接类错误和服务端 5xx 退避重试两次。
  let buffer;
  for (let attempt = 0; ; attempt += 1) {
    try {
      buffer = await fetchImage(url, { maxBytes: MAX_IMAGE_BYTES, timeoutMs: 180000 });
      break;
    } catch (error) {
      const message = String(error && error.message ? error.message : error);
      const status = /^HTTP (\d{3})/.exec(message);
      const transient = !(error && error.blocked) && (isNetworkError(error) || Boolean(status && TRANSIENT_STATUS.has(Number(status[1]))));
      if (transient && attempt < RETRY.delays.length) {
        await sleep(RETRY.delays[attempt]);
        continue;
      }
      throw markTransient(new Error(error && error.blocked ? '图片' + message : '图片下载失败 ' + message), transient);
    }
  }
  // targetPath 可省略：调用方要先看字节才知道该用什么扩展名（接口回的不一定是 PNG）。
  if (targetPath) await writeFile(targetPath, buffer);
  return buffer;
}
