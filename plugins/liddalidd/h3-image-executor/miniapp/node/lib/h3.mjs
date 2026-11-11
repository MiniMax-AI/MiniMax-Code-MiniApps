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
  const response = await fetch(config.baseUrl + path, {
    method: 'POST',
    headers: { ...authHeaders(config), 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (response.status !== 200) {
    const message = (body && body.error && body.error.message) || text.slice(0, 300);
    const error = new Error(label + '失败 HTTP ' + response.status + '：' + message);
    error.status = response.status;
    error.requestId = body && body.request_id;
    throw error;
  }
  return normalize(body);
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
  const form = new FormData();
  form.append('purpose', 'image_generation_input');
  form.append('file', new Blob([buffer]), basename(filePath));
  const response = await fetch(config.baseUrl + '/v1/files/upload', {
    method: 'POST',
    headers: authHeaders(config),
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await response.json().catch(() => null);
  const baseResp = (body && body.base_resp) || {};
  if (response.status !== 200 || baseResp.status_code !== 0) {
    throw new Error('参考图上传失败：' + (baseResp.status_msg || 'HTTP ' + response.status));
  }
  return 'mm_file://' + body.file.file_id;
}

export async function download(url, targetPath) {
  // 成图地址来自接口返回。接口本身可能是内网地址（放行），但云元数据段必须拦，
  // 而且每一跳重定向都要重新拦一遍——fetchImage 负责这两件事，并给响应体封顶。
  let buffer;
  try {
    buffer = await fetchImage(url, { maxBytes: MAX_IMAGE_BYTES, timeoutMs: 180000 });
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    throw new Error(error && error.blocked ? '图片' + message : '图片下载失败 ' + message);
  }
  // targetPath 可省略：调用方要先看字节才知道该用什么扩展名（接口回的不一定是 PNG）。
  if (targetPath) await writeFile(targetPath, buffer);
  return buffer;
}
