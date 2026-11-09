// @ts-check

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { normalizeHttpsUrl, quotaHostCandidates } from '../urls.mjs';

export { REGIONS, OAUTH_HOSTS } from './constants.mjs';

const CONFIG_DIR_NAME = '.mmx';
const VALID_REGIONS = new Set(['global', 'cn']);
const VALID_OUTPUTS = new Set(['text', 'json']);

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
 * Read the CLI config for a user-configured credential. This module only
 * reads it: the panel login stores its own credentials under dataDir, and a
 * credential found here is never rewritten.
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
 * Build a runtime view from one raw config read. Callers that already read the
 * file pass `raw` so a request never resolves credentials from a second,
 * possibly changed snapshot. `regionOverride` is the region stored with the
 * plugin's own login; an explicit environment value still wins.
 * @param {Record<string, unknown>} [raw]
 * @param {NodeJS.ProcessEnv} [env]
 * @param {'cn' | 'global' | null} [regionOverride]
 */
export function configFromRaw(raw = {}, env = process.env, regionOverride = null) {
  const file = parseConfigFile(raw);
  const explicitRegion = env.MINIMAX_REGION;
  const region = explicitRegion === 'cn' || explicitRegion === 'global'
    ? explicitRegion
    : normalizeRegion(regionOverride) ?? normalizeRegion(file.region) ?? 'global';
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
    region,
    baseUrl: baseUrls[0],
    baseUrls,
    timeout: 20,
  };
}
