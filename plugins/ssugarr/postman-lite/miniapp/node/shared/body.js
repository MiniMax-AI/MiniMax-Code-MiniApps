/**
 * 请求体编码：前后端共用。
 * 纯函数（FormData 为环境全局对象），无 IO。
 */

/** 这些方法不允许携带请求体 */
const BODYLESS_METHODS = ['GET', 'HEAD'];

function enabledRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter(
    (row) => row && row.enabled !== false && String(row.key ?? '').trim() !== '',
  );
}

/**
 * 按 mode 编码请求体。
 * @param {{mode?: string, raw?: string, json?: string, urlencoded?: Array, form?: Array}} body
 * @param {{method?: string}} options
 * @returns {{payload: string|FormData|undefined, contentType: string|null, mode: string}}
 */
export function encodeBody(body, options = {}) {
  const mode = body?.mode ?? 'none';
  const method = String(options.method ?? 'GET').toUpperCase();

  if (BODYLESS_METHODS.includes(method)) {
    return { payload: undefined, contentType: null, mode };
  }

  switch (mode) {
    case 'json': {
      return { payload: String(body?.json ?? ''), contentType: 'application/json', mode };
    }
    case 'raw': {
      return { payload: String(body?.raw ?? ''), contentType: null, mode };
    }
    case 'urlencoded': {
      const search = new URLSearchParams();
      for (const row of enabledRows(body?.urlencoded)) {
        search.append(String(row.key).trim(), String(row.value ?? ''));
      }
      return { payload: search.toString(), contentType: 'application/x-www-form-urlencoded', mode };
    }
    case 'form': {
      const form = new FormData();
      for (const row of enabledRows(body?.form)) {
        form.append(String(row.key).trim(), String(row.value ?? ''));
      }
      // Content-Type 交给 fetch 生成（含 boundary）
      return { payload: form, contentType: null, mode };
    }
    case 'none':
    default:
      return { payload: undefined, contentType: null, mode: 'none' };
  }
}

/** JSON 语法预检 */
export function validateJsonBody(text) {
  try {
    JSON.parse(String(text ?? ''));
    return { ok: true, message: '' };
  } catch (err) {
    return { ok: false, message: err?.message ?? 'JSON 解析失败' };
  }
}

/** 美化 JSON 文本；解析失败时原样返回 */
export function prettyJson(text) {
  try {
    return JSON.stringify(JSON.parse(String(text ?? '')), null, 2);
  } catch {
    return String(text ?? '');
  }
}
