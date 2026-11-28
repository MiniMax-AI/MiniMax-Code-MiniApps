import { buildUrl, isValidHttpUrl } from './shared/url.js';
import { encodeBody } from './shared/body.js';
import { DEFAULT_TIMEOUT_MS, MAX_RESPONSE_BYTES } from './shared/constants.js';

/** 这些头由传输层管理，用户设置会与 undici 冲突 */
const STRIPPED_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'keep-alive',
  'upgrade',
  'expect',
]);

const BINARY_CONTENT_TYPES = [
  /^image\//i,
  /^audio\//i,
  /^video\//i,
  /^application\/octet-stream$/i,
  /^application\/pdf$/i,
];

/** 没有 content-type 时，用 NUL 字节粗判是否为二进制 */
function looksBinary(contentType, buffer) {
  if (BINARY_CONTENT_TYPES.some((pattern) => pattern.test(contentType))) return true;
  if (contentType) return false;
  return buffer.includes(0);
}

/** 把底层网络错误翻译成人话 */
function describeNetworkError(err) {
  const code = err?.cause?.code ?? err?.code ?? '';
  const messages = {
    ENOTFOUND: '域名解析失败，请检查地址是否正确',
    EAI_AGAIN: '域名解析临时失败，请稍后重试',
    ECONNREFUSED: '连接被拒绝，目标端口没有开放',
    ECONNRESET: '连接被对方重置',
    ETIMEDOUT: '连接超时',
    CERT_HAS_EXPIRED: '目标站点的 HTTPS 证书已过期',
    DEPTH_ZERO_SELF_SIGNED_CERT: '目标站点使用自签名证书，校验失败',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: '无法验证目标站点的 HTTPS 证书',
  };
  if (messages[code]) return messages[code];
  return err?.cause?.message || err?.message || '网络请求失败';
}

/**
 * 组装最终请求头。
 * 自动 Content-Type 打底，用户显式写的同名头优先；form 模式一律丢弃 Content-Type。
 */
export function buildHeaders({ userHeaders = [], contentType = null, bodyMode = 'none' } = {}) {
  const headers = {};

  // 同名头按大小写不敏感地覆盖，避免出现
  // "application/json, application/vnd.api+json" 这种被 fetch 拼接的结果
  const setHeader = (name, value) => {
    const lower = name.toLowerCase();
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === lower) delete headers[key];
    }
    headers[name] = value;
  };

  const removeHeader = (name) => {
    const lower = name.toLowerCase();
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === lower) delete headers[key];
    }
  };

  if (contentType) setHeader('content-type', contentType);

  for (const item of userHeaders) {
    if (!item || item.enabled === false) continue;
    const key = String(item.key ?? '').trim();
    if (!key) continue;
    if (STRIPPED_HEADERS.has(key.toLowerCase())) continue;
    setHeader(key, String(item.value ?? ''));
  }

  if (bodyMode === 'form') {
    // multipart 的 boundary 必须由 fetch 生成，手写 Content-Type 会导致服务端无法解析表单
    removeHeader('content-type');
  }
  return headers;
}

/**
 * 转发一次请求。
 * @returns {Promise<{ok: true, response: object} | {ok: false, error: object}>}
 */
export async function sendRequest(payload) {
  const body = payload?.body ?? { mode: 'none' };
  const method = String(payload?.method ?? 'GET').toUpperCase();
  const rawUrl = String(payload?.url ?? '').trim();

  if (!isValidHttpUrl(rawUrl)) {
    return {
      ok: false,
      error: { kind: 'invalid_url', message: 'URL 不合法，需要以 http:// 或 https:// 开头的完整地址' },
    };
  }

  const target = buildUrl(rawUrl, payload?.params ?? []);
  const encoded = encodeBody(body, { method });
  const headers = buildHeaders({
    userHeaders: payload?.headers ?? [],
    contentType: encoded.contentType,
    bodyMode: body.mode,
  });

  const timeoutMs = Number(payload?.options?.timeoutMs) > 0 ? Number(payload.options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const followRedirects = payload?.options?.followRedirects !== false;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const started = performance.now();

  try {
    const res = await fetch(target, {
      method,
      headers,
      body: encoded.payload,
      redirect: followRedirects ? 'follow' : 'manual',
      signal: controller.signal,
    });

    const buffer = Buffer.from(await res.arrayBuffer());
    const size = buffer.length;
    const truncated = size > MAX_RESPONSE_BYTES;
    const payloadBuffer = truncated ? buffer.subarray(0, MAX_RESPONSE_BYTES) : buffer;
    const contentType = res.headers.get('content-type') ?? '';
    const isBinary = looksBinary(contentType, payloadBuffer);
    const timeMs = Math.round(performance.now() - started);

    return {
      ok: true,
      response: {
        status: res.status,
        statusText: res.statusText,
        headers: Object.fromEntries(res.headers.entries()),
        body: isBinary ? null : payloadBuffer.toString('utf8'),
        bodyBase64: isBinary ? payloadBuffer.toString('base64') : null,
        size,
        timeMs,
        finalUrl: res.url,
        redirected: res.redirected,
        truncated,
        contentType,
      },
    };
  } catch (err) {
    const timeMs = Math.round(performance.now() - started);
    if (timedOut || err?.name === 'AbortError' || err?.name === 'TimeoutError') {
      return { ok: false, error: { kind: 'timeout', message: `请求超时（${timeoutMs}ms）`, timeMs } };
    }
    return { ok: false, error: { kind: 'network', message: describeNetworkError(err), timeMs } };
  } finally {
    clearTimeout(timer);
  }
}
