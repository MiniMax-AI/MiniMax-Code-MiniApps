/**
 * URL 工具：前后端共用。
 * 纯函数、无 IO，可直接用 node --test 覆盖。
 */

/** 拆出 #fragment 部分 */
function splitHash(url) {
  const index = url.indexOf('#');
  return index === -1 ? [url, ''] : [url.slice(0, index), url.slice(index)];
}

/** 校验是否为合法的 http/https 绝对地址 */
export function isValidHttpUrl(raw) {
  const url = String(raw ?? '').trim();
  if (!url) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

/** 从 URL 的 query string 解析出参数行 */
export function parseQuery(rawUrl) {
  const url = String(rawUrl ?? '').trim();
  const hashIndex = url.indexOf('#');
  const withoutHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const queryIndex = withoutHash.indexOf('?');
  if (queryIndex === -1) return [];
  const query = withoutHash.slice(queryIndex + 1);
  if (!query) return [];
  const rows = [];
  for (const [key, value] of new URLSearchParams(query)) {
    rows.push({ key, value, enabled: true });
  }
  return rows;
}

/**
 * 去掉 URL 里的 query string，保留 fragment。
 *
 * 请求发送时用它把 query 从「地址栏」剥离出来，
 * 统一交给参数表承载——否则地址栏里的 ?x=1 和参数表里的 x=1
 * 会在最终 URL 里各出现一次，同一个参数被发两遍。
 */
export function stripQuery(rawUrl) {
  const url = String(rawUrl ?? '').trim();
  if (!url) return '';
  const [withoutHash, hash] = splitHash(url);
  const queryIndex = withoutHash.indexOf('?');
  if (queryIndex === -1) return url;
  return withoutHash.slice(0, queryIndex) + hash;
}

/**
 * 把启用的 query 参数合并进 URL。
 * - URL 原有的 query 保留
 * - 关闭的行、空 key 的行忽略
 * - 同名 key 追加而非覆盖
 */
export function buildUrl(rawUrl, params) {
  const url = String(rawUrl ?? '').trim();
  if (!url) return '';
  const rows = (Array.isArray(params) ? params : []).filter(
    (row) => row && row.enabled !== false && String(row.key ?? '').trim() !== '',
  );
  if (rows.length === 0) return url;

  const [withoutHash, hash] = splitHash(url);
  const queryIndex = withoutHash.indexOf('?');
  const path = queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex);
  const existing = queryIndex === -1 ? '' : withoutHash.slice(queryIndex + 1);

  const search = new URLSearchParams(existing);
  for (const row of rows) {
    search.append(String(row.key).trim(), String(row.value ?? ''));
  }
  const query = search.toString();
  return query ? `${path}?${query}${hash}` : `${path}${hash}`;
}

/**
 * 变量插值钩子（v2 预留）。
 * 目前对未提供的变量原样返回，接入环境变量后在此替换 {{var}}。
 */
export function resolveVariables(value, variables = {}) {
  const text = String(value ?? '');
  if (!text.includes('{{')) return text;
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, name) => {
    return Object.prototype.hasOwnProperty.call(variables, name) ? String(variables[name]) : match;
  });
}

