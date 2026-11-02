// @ts-check
// Connection settings and an allowlisted, read-only OpenViking proxy.
// Settings live in `<dataDir>/connection.json`; the API key never leaves this process.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const CONFIG_FILE = 'connection.json';
const MAX_URI = 2048;
const TIMEOUT_MS = 30000;
const MAX_RESPONSE = 32 * 1024 * 1024;

/**
 * The only OpenViking routes the page may reach, all read-only. Keys are `METHOD path`.
 * These are exactly the calls made by the vendored Atlas adapter (miniapp/client/openviking-adapter.js).
 */
export const ROUTES = Object.freeze(new Set([
  'GET /health',
  'GET /api/v1/fs/ls',
  'GET /api/v1/fs/tree',
  'GET /api/v1/fs/stat',
  'GET /api/v1/content/read',
  'GET /api/v1/content/abstract',
  'GET /api/v1/content/overview',
  'POST /api/v1/search/find',
  'POST /api/v1/search/grep',
  'POST /api/v1/search/glob',
]));
const QUERY_KEYS = new Set(['uri', 'recursive', 'simple', 'output', 'level_limit', 'node_limit', 'abs_limit', 'limit', 'show_all_hidden', 'offset']);
const PASS_RESPONSE_HEADERS = ['content-type', 'etag', 'last-modified'];

export class InputError extends Error {}

/** @param {unknown} value */
export function parseHttpUrl(value, field) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > MAX_URI) throw new InputError(`${field}_invalid`);
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new InputError(`${field}_invalid`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new InputError(`${field}_invalid`);
  if (url.username || url.password) throw new InputError(`${field}_has_credentials`);
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/+$/, '');
}

/** @param {unknown} value */
export function parseVikingUri(value) {
  if (typeof value !== 'string') throw new InputError('uri_invalid');
  const uri = value.trim();
  if (!uri.startsWith('viking://') || uri.length > MAX_URI || /[\u0000-\u001f]/.test(uri)) {
    throw new InputError('uri_invalid');
  }
  return uri;
}

/** @param {unknown} value */
function optionalText(value, field, max = 128) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f]/.test(value)) {
    throw new InputError(`${field}_invalid`);
  }
  return value.trim();
}

/**
 * @typedef {{ baseUrl: string, apiKey: string, account: string, user: string, studioUrl: string }} Connection
 */

/** @param {string} dataDir @returns {Promise<Connection>} */
export async function loadConnection(dataDir) {
  const empty = { baseUrl: '', apiKey: '', account: '', user: '', studioUrl: '' };
  try {
    const raw = JSON.parse(await readFile(join(dataDir, CONFIG_FILE), 'utf8'));
    return { ...empty, ...pick(raw) };
  } catch {
    return empty;
  }
}

function pick(raw) {
  const out = {};
  for (const key of ['baseUrl', 'apiKey', 'account', 'user', 'studioUrl']) {
    if (typeof raw?.[key] === 'string') out[key] = raw[key];
  }
  return out;
}

/**
 * Merge a page-supplied patch into the stored connection. `apiKey` is only replaced when the patch
 * carries a non-empty string, or cleared with `clearApiKey: true`.
 * @param {string} dataDir
 * @param {any} patch
 */
export async function saveConnection(dataDir, patch) {
  if (!patch || typeof patch !== 'object') throw new InputError('body_invalid');
  const current = await loadConnection(dataDir);
  const next = {
    baseUrl: parseHttpUrl(patch.baseUrl, 'baseUrl'),
    account: optionalText(patch.account, 'account'),
    user: optionalText(patch.user, 'user'),
    studioUrl: parseHttpUrl(patch.studioUrl, 'studioUrl'),
    apiKey: current.apiKey,
  };
  if (patch.clearApiKey === true) next.apiKey = '';
  else if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) {
    next.apiKey = optionalText(patch.apiKey, 'apiKey', 4096).replace(/^bearer\s+/i, '');
  }
  await mkdir(dataDir, { recursive: true });
  const file = join(dataDir, CONFIG_FILE);
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
  await rename(temp, file);
  return next;
}

/** What the page may see: never the key. @param {Connection} c */
export function publicView(c) {
  return {
    baseUrl: c.baseUrl,
    account: c.account,
    user: c.user,
    studioUrl: c.studioUrl,
    hasApiKey: Boolean(c.apiKey),
  };
}

/**
 * Build the upstream request for one allowlisted route. Throws InputError for anything else.
 * @param {Connection} c
 * @param {string} method
 * @param {string} path upstream path, e.g. /api/v1/fs/ls
 * @param {URLSearchParams} query
 * @param {Buffer | undefined} body
 */
export function buildRequest(c, method, path, query, body) {
  if (!ROUTES.has(`${method} ${path}`)) throw new InputError('route_not_allowed');
  if (!c.baseUrl) throw new InputError('not_configured');
  const url = new URL(c.baseUrl + path);
  for (const [key, value] of query) {
    if (!QUERY_KEYS.has(key)) throw new InputError('query_not_allowed');
    if (key === 'uri') parseVikingUri(value);
    if (value.length > MAX_URI) throw new InputError('query_invalid');
    url.searchParams.append(key, value);
  }
  /** @type {string | undefined} */
  let payload;
  if (method === 'POST') {
    let parsed;
    try {
      parsed = JSON.parse(body?.toString('utf8') || '{}');
    } catch {
      throw new InputError('body_invalid');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new InputError('body_invalid');
    for (const key of ['target_uri', 'uri']) if (key in parsed) parseVikingUri(parsed[key]);
    payload = JSON.stringify(parsed);
  }
  /** @type {Record<string, string>} */
  const headers = { accept: 'application/json' };
  if (payload) headers['content-type'] = 'application/json';
  if (c.apiKey) {
    headers.authorization = `Bearer ${c.apiKey}`;
    headers['x-api-key'] = c.apiKey;
  }
  if (c.account) headers['x-openviking-account'] = c.account;
  if (c.user) headers['x-openviking-user'] = c.user;
  return { url, method, headers, body: payload };
}

/**
 * Forward one allowlisted request. Returns status, a filtered header set, and the body bytes.
 * Redirects are refused so the key never follows a redirect to another host.
 * @param {Connection} c
 * @param {{ method: string, path: string, query: URLSearchParams, body?: Buffer }} input
 * @param {typeof fetch} [fetchImpl]
 */
export async function forward(c, input, fetchImpl = fetch) {
  const req = buildRequest(c, input.method, input.path, input.query, input.body);
  const response = await fetchImpl(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body,
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  /** @type {Record<string, string>} */
  const headers = { 'cache-control': 'no-store' };
  for (const name of PASS_RESPONSE_HEADERS) {
    const value = response.headers.get(name);
    if (value) headers[name] = value;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_RESPONSE) return { status: 502, headers: { 'content-type': 'application/json' }, body: Buffer.from('{"error":"response_too_large"}') };
  return { status: response.status, headers, body: bytes };
}

/**
 * Test a connection without saving it: GET /health, then list the root. `patch` may override the
 * stored values; the stored key is used unless a new one is given. Never echoes the key.
 * @param {Connection} stored
 * @param {any} patch
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function testConnection(stored, patch, fetchImpl = fetch) {
  const p = patch && typeof patch === 'object' ? patch : {};
  /** @type {Connection} */
  const c = {
    ...stored,
    baseUrl: p.baseUrl ? parseHttpUrl(p.baseUrl, 'baseUrl') : stored.baseUrl,
    account: p.account !== undefined ? optionalText(p.account, 'account') : stored.account,
    user: p.user !== undefined ? optionalText(p.user, 'user') : stored.user,
    apiKey: typeof p.apiKey === 'string' && p.apiKey.trim()
      ? optionalText(p.apiKey, 'apiKey', 4096).replace(/^bearer\s+/i, '')
      : stored.apiKey,
  };
  if (!c.baseUrl) return { ok: false, error: 'Enter the server URL first.' };
  const rejected = (status) => status === 401 || status === 403;
  try {
    const health = await forward(c, { method: 'GET', path: '/health', query: new URLSearchParams() }, fetchImpl);
    if (rejected(health.status)) return { ok: false, error: `Server reachable, but the API key was rejected (HTTP ${health.status}).` };
    if (health.status >= 400) return { ok: false, error: `Health check failed: HTTP ${health.status}.` };
    const ls = await forward(c, { method: 'GET', path: '/api/v1/fs/ls', query: new URLSearchParams({ uri: 'viking://' }) }, fetchImpl);
    if (rejected(ls.status)) return { ok: false, error: `Server reachable, but the API key was rejected (HTTP ${ls.status}).` };
    if (ls.status >= 400) return { ok: false, error: `Server reachable, but listing the root failed: HTTP ${ls.status}.` };
    return { ok: true };
  } catch (error) {
    const reason = error?.name === 'TimeoutError' ? 'timed out' : (error?.cause?.code || 'network error');
    return { ok: false, error: `Cannot reach ${c.baseUrl}: ${reason}.` };
  }
}
