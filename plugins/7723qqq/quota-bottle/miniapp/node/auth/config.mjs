// @ts-check

import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { normalizeHttpsUrl, quotaHostCandidates } from '../urls.mjs';

export { REGIONS, OAUTH_HOSTS } from './constants.mjs';

const CONFIG_DIR_NAME = '.mmx';
const VALID_REGIONS = new Set(['global', 'cn']);
const VALID_OUTPUTS = new Set(['text', 'json']);

/** @type {Map<string, Promise<void>>} */
const writeQueues = new Map();

export function getConfigDir() {
  const dir = process.env.MMX_CONFIG_DIR?.trim();
  return dir || join(homedir(), CONFIG_DIR_NAME);
}

export function getConfigPath() {
  return join(getConfigDir(), 'config.json');
}

/** @param {unknown} value */
export function normalizeRegion(value) {
  return value === 'cn' || value === 'global' ? value : null;
}

async function withConfigLock(path, task) {
  const previous = writeQueues.get(path) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  const settled = next.catch(() => {});
  writeQueues.set(path, settled);
  try {
    return await next;
  } finally {
    if (writeQueues.get(path) === settled) writeQueues.delete(path);
  }
}

function parseOAuth(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = /** @type {Record<string, unknown>} */ (raw);
  if (typeof o.access_token !== 'string' || !o.access_token) return undefined;
  if (typeof o.refresh_token !== 'string') return undefined;
  if (typeof o.expires_at !== 'string') return undefined;
  const out = /** @type {Record<string, unknown>} */ ({
    access_token: o.access_token,
    refresh_token: o.refresh_token,
    expires_at: o.expires_at,
  });
  if (typeof o.region === 'string' && VALID_REGIONS.has(o.region)) out.region = o.region;
  if (typeof o.resource_url === 'string') {
    const resource = normalizeHttpsUrl(o.resource_url, { purpose: 'api' });
    if (resource) out.resource_url = resource;
  }
  if (typeof o.account === 'string' && o.account.length > 0) out.account = o.account;
  return out;
}

/** @param {unknown} raw */
export function parseConfigFile(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const obj = /** @type {Record<string, unknown>} */ (raw);
  const out = /** @type {Record<string, unknown>} */ ({});
  if (typeof obj.api_key === 'string') out.api_key = obj.api_key;
  if (typeof obj.region === 'string' && VALID_REGIONS.has(obj.region)) out.region = obj.region;
  if (typeof obj.base_url === 'string') {
    const base = normalizeHttpsUrl(obj.base_url, { purpose: 'api' });
    if (base) out.base_url = base;
  }
  if (typeof obj.output === 'string' && VALID_OUTPUTS.has(obj.output)) out.output = obj.output;
  if (typeof obj.proxy === 'string') {
    const proxy = normalizeHttpsUrl(obj.proxy, { purpose: 'api' });
    if (proxy) out.proxy = proxy;
  }
  const oauth = parseOAuth(obj.oauth);
  if (oauth) out.oauth = oauth;
  for (const key of ['default_text_model', 'default_speech_model', 'default_video_model', 'default_music_model']) {
    if (typeof obj[key] === 'string' && obj[key].length > 0) out[key] = obj[key];
  }
  return out;
}

/**
 * Read the config as a raw object so an unrelated field is never lost by a
 * credential update. A missing file is represented by an empty object.
 * @param {string} [path]
 * @returns {Promise<{ ok: true, raw: Record<string, unknown> } | { ok: false, code: string }>}
 */
export async function readRawConfig(path = getConfigPath()) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    const code = /** @type {any} */ (error)?.code;
    if (code === 'ENOENT') return { ok: true, raw: {} };
    return { ok: false, code: 'config_unreadable' };
  }
  try {
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, code: 'config_invalid' };
    return { ok: true, raw: /** @type {Record<string, unknown>} */ (raw) };
  } catch {
    return { ok: false, code: 'config_invalid' };
  }
}

/**
 * Patch a raw config object, serialize writes, keep unrelated fields, and
 * preserve the existing file's mode. The temp name is unique to this process.
 * @param {(raw: Record<string, unknown>) => void} patch
 * @param {string} [path]
 */
export async function updateConfigFile(patch, path = getConfigPath()) {
  return withConfigLock(path, async () => {
    const existing = await readRawConfig(path);
    if (!existing.ok) throw new Error(existing.code);
    const next = { ...existing.raw };
    patch(next);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    let mode = 0o600;
    try {
      mode = (await stat(path)).mode & 0o777;
    } catch (error) {
      if (/** @type {any} */ (error)?.code !== 'ENOENT') throw error;
    }
    const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode });
      await chmod(tmp, mode);
      await rename(tmp, path);
    } catch (error) {
      await unlink(tmp).catch(() => {});
      throw error;
    }
  });
}

/**
 * Build a runtime view from one raw config read. Callers that already read the
 * file pass `raw` so a request never resolves credentials from a second,
 * possibly changed snapshot.
 * @param {Record<string, unknown>} [raw]
 * @param {NodeJS.ProcessEnv} [env]
 */
export function configFromRaw(raw = {}, env = process.env) {
  const file = parseConfigFile(raw);
  const explicitRegion = env.MINIMAX_REGION;
  const region = explicitRegion === 'cn' || explicitRegion === 'global'
    ? explicitRegion
    : normalizeRegion(file.region) ?? 'global';
  const envBase = env.MINIMAX_BASE_URL
    ? normalizeHttpsUrl(env.MINIMAX_BASE_URL, { purpose: 'api', allowHttpLoopback: true })
    : null;
  // An explicit override wins outright. Otherwise the region picks the host and
  // the other MiniMax host stays a fallback, so a stale region no longer
  // decides which API answers the quota request.
  const baseUrls = envBase
    ? [envBase]
    : quotaHostCandidates(region, file.base_url ?? file.oauth?.resource_url ?? null);
  return {
    configPath: getConfigPath(),
    region,
    baseUrl: baseUrls[0],
    baseUrls,
    timeout: 20,
  };
}

/**
 * Read the region the CLI config asks for, so a login can start against the
 * right account service instead of whichever one the panel happened to pick.
 * @returns {Promise<'cn' | 'global' | null>}
 */
export async function readConfiguredRegion() {
  const raw = await readRawConfig();
  if (!raw.ok) return null;
  return normalizeRegion(parseConfigFile(raw.raw).region);
}

/**
 * @returns {Promise<{ ok: true, config: ReturnType<typeof configFromRaw>, credentials: Record<string, unknown> | null, apiKey: string | undefined } | { ok: false, code: string }>}
 */
export async function loadQuotaConfig() {
  const raw = await readRawConfig();
  if (!raw.ok) return raw;
  const file = parseConfigFile(raw.raw);
  return {
    ok: true,
    config: configFromRaw(file),
    credentials: file.oauth ? { ...file.oauth, configPath: getConfigPath() } : null,
    apiKey: typeof file.api_key === 'string' ? file.api_key : undefined,
  };
}
