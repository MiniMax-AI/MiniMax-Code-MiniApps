/** 全局常量：前后端共用 */

/** @type {string[]} */
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/** @type {Array<'none'|'raw'|'json'|'urlencoded'|'form'>} */
export const BODY_MODES = ['none', 'raw', 'json', 'urlencoded', 'form'];

/** @type {Record<string, string>} */
export const BODY_MODE_LABELS = {
  none: '无',
  raw: 'raw',
  json: 'JSON',
  urlencoded: 'x-www-form-urlencoded',
  form: 'form-data',
};

/** 响应体最大字节数，超过则截断 */
export const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

/** 默认请求超时（毫秒） */
export const DEFAULT_TIMEOUT_MS = 30000;
