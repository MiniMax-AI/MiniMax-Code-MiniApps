// @ts-check

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';

import { ValueCache } from './cache.mjs';
import { QuotaError, isLoginFixable, pickMostSpecific, safeErrorCode } from './errors.mjs';
import { saveOauth } from './auth/auth.mjs';
import { normalizeRegion } from './auth/config.mjs';
import { openBrowser, pollDeviceLogin, startDeviceLogin } from './auth/oauth.mjs';
import { readConfiguredRegion } from './auth/snapshot.mjs';
import { fetchQuota, manualState, normalizeQuota } from './quota.mjs';
import { readSettings, writeSettings } from './settings.mjs';
import { createStore, normalizeTotal } from './store.mjs';
import { monthWindow, readUsedTokens } from './usage.mjs';

// Three seconds keeps a pinned window close to live without adding load; the
// page polls every five seconds while pinned.
const LIVE_TTL_MS = 3_000;
const USAGE_TTL_MS = 15_000;
const BODY_LIMIT = 4096;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */
/** @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle */

/** @param {MiniAppContext} context @returns {Promise<MiniAppLifecycle>} */
export async function start(context) {
  const clientEntry = await readFile(join(context.pluginRoot, 'miniapp/client/index.html'));
  const store = createStore(context.dataDir);
  const service = new AbortController();
  if (context.signal.aborted) service.abort();

  const liveCache = new ValueCache(LIVE_TTL_MS);
  const usageCache = new ValueCache(USAGE_TTL_MS);
  let settings = await readSettings(context.dataDir);
  /** @type {any} */
  let loginFlow = null;
  /** @type {Promise<any> | null} */
  let loginRequest = null;
  /** @type {Set<Promise<any>>} */
  const tasks = new Set();
  let disposed = false;

  function track(task) {
    if (disposed) return Promise.reject(new Error('disposed'));
    tasks.add(task);
    const tracked = task.finally(() => tasks.delete(task));
    return tracked;
  }

  async function liveValue() {
    try {
      const payload = await fetchQuota(context.dataDir, service.signal);
      const normalized = normalizeQuota(payload);
      if (normalized.ok) {
        context.logger.info('quota-bottle.live.ok', { source: 'credential', models: normalized.models.length });
        return { ...normalized, detail: 'token-plan' };
      }
      context.logger.warn('quota-bottle.live.empty', { code: normalized.code });
      return { ok: false, code: safeErrorCode(normalized.code) };
    } catch (error) {
      const code = error instanceof QuotaError ? error.code : 'unknown';
      context.logger.warn('quota-bottle.live.failed', { code });
      return { ok: false, code: safeErrorCode(pickMostSpecific([code])) };
    }
  }

  async function liveState(fresh) {
    return liveCache.get(fresh, () => track(liveValue()));
  }

  async function usageState(window, fresh) {
    if (!settings.usageScan) return { ok: false, code: 'usage_scan_off' };
    return usageCache.get(fresh, () => track(readUsedTokens(window, context)), window.label);
  }

  async function buildState(fresh = false) {
    const live = await liveState(fresh);
    if (live.ok) {
      // The plan's first row is the headline; a different row would be a
      // second number next to the plan's own panel.
      const primary = live.models[0];
      return {
        generatedAt: Date.now(),
        mode: 'live',
        region: live.region,
        usageScan: settings.usageScan,
        total: live.total,
        used: live.used,
        remaining: live.remaining,
        ratio: live.ratio,
        percent: live.percent,
        usedPercent: live.usedPercent,
        period: null,
        resetAt: primary?.resetAt ?? null,
        remainsMs: primary?.remainsMs ?? null,
        models: live.models,
        weekly: live.weekly,
        source: { kind: 'token-plan', label: 'Token Plan', detail: live.detail },
        problems: [],
        needsLogin: false,
        overBudget: false,
        overBy: 0,
      };
    }

    const manualTotal = await store.read();
    const window = monthWindow();
    const used = await usageState(window, fresh);
    // The manual fallback has no live session to ask, so the configured region
    // is the only hint available for the label.
    const region = await readConfiguredRegion(context.dataDir);
    const problems = [live.code];
    if (!used.ok) problems.push(used.code);
    const base = {
      generatedAt: Date.now(),
      region,
      usageScan: settings.usageScan,
      period: window.label,
      resetAt: window.endMs,
      remainsMs: null,
      models: [],
      weekly: null,
      source: { kind: 'local-tokens', label: 'Local usage', detail: 'this month' },
      problems,
      // A rejected or missing credential is fixed by logging in, so the panel
      // offers the login instead of leaving the user without a way forward.
      needsLogin: problems.some((code) => isLoginFixable(code)),
    };
    const manual = manualState(manualTotal, used.ok ? used.used : null);
    return { ...base, ...manual };
  }

  const server = createServer((request, response) => {
    if (!isLoopbackRequest(request, context.listen.port)) {
      request.resume();
      return sendJson(response, 403, { error: 'forbidden' });
    }
    let url;
    try {
      url = new URL(request.url ?? '/', 'http://miniapp.local');
    } catch {
      return sendJson(response, 400, { error: 'bad_request' });
    }
    const route = `${request.method ?? 'GET'} ${url.pathname}`;
    const task = track(handleRoute(route, url, request, response, {
      clientEntry, context, store, service,
      getFlow: () => loginFlow,
      setFlow: (value) => { loginFlow = value; },
      getLoginRequest: () => loginRequest,
      setLoginRequest: (value) => { loginRequest = value; },
      setSettings: (value) => { settings = value; },
      clearCache: () => { liveCache.clear(); usageCache.clear(); },
      buildState,
    }));
    task.catch((error) => {
      context.logger.warn('quota-bottle.route.failed', { name: /** @type {any} */ (error)?.name ?? 'Error' });
      sendJson(response, 500, { error: 'internal_error' });
    });
  });

  await listen(server, context.listen.host, context.listen.port);
  context.logger.info('quota-bottle.listening');

  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    service.abort();
    loginFlow = null;
    await Promise.allSettled([...tasks]);
    await close(server);
  };
  context.signal.addEventListener('abort', () => { void dispose(); }, { once: true });
  if (context.signal.aborted) await dispose();
  return { dispose };
}

/** @param {any} deps */
async function handleRoute(route, url, request, response, deps) {
  if (route === 'GET /bottle') {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'self'; form-action 'none'; base-uri 'none'",
    });
    response.end(deps.clientEntry);
    return;
  }
  if (route === 'GET /api/state') {
    const fresh = url.searchParams.has('fresh');
    const state = await deps.buildState(fresh);
    sendJson(response, 200, state);
    return;
  }
  if (route === 'POST /api/login') return handleLoginStart(request, response, deps);
  if (route === 'GET /api/login') return handleLoginStatus(response, deps);
  if (route === 'DELETE /api/login') {
    const active = deps.getFlow();
    if (active) active.status = 'cancelled';
    deps.setFlow(null);
    deps.setLoginRequest(null);
    sendJson(response, 200, { status: 'idle' });
    return;
  }
  if (route === 'POST /api/quota') return handleQuotaPost(request, response, deps);
  if (route === 'POST /api/settings') return handleSettingsPost(request, response, deps);
  sendJson(response, 404, { error: 'not_found' });
}

/** @param {any} deps */
async function handleLoginStart(request, response, deps) {
  const body = await readJsonBody(request, response);
  if (body === undefined) return;
  const region = normalizeRegion(body?.region);
  if (region === null) return sendJson(response, 400, { error: 'invalid_region' });
  if (deps.getLoginRequest()) {
    const result = await deps.getLoginRequest();
    if (result?.ok) return sendJson(response, 409, { error: 'login_pending' });
  }
  if (deps.getFlow()?.status === 'pending') return sendJson(response, 409, { error: 'login_pending' });
  const task = (async () => {
    const flow = await startDeviceLogin(region, deps.service.signal);
    if (deps.getLoginRequest() === task && !deps.service.signal.aborted) {
      deps.setFlow(flow);
      openBrowser(flow.verificationUri);
      sendJson(response, 200, {
        status: flow.status,
        verificationUri: flow.verificationUri,
        userCode: flow.userCode,
        expiresAt: flow.expiresAt,
        intervalMs: flow.intervalMs,
      });
      return { ok: true, flow };
    }
    return { ok: false, flow };
  })();
  deps.setLoginRequest(task);
  try {
    const result = await task;
    if (deps.getLoginRequest() === task) {
      deps.setLoginRequest(null);
      if (!result.ok && !response.headersSent) sendJson(response, 502, { error: 'login_start_failed' });
    }
  } catch (error) {
    if (deps.getLoginRequest() === task) deps.setLoginRequest(null);
    if (!response.headersSent) sendJson(response, 502, { error: 'login_start_failed' });
    deps.context.logger.warn('quota-bottle.login.start_failed', { code: error instanceof QuotaError ? error.code : 'unknown' });
  }
}

/** @param {any} deps */
async function handleLoginStatus(response, deps) {
  const flow = deps.getFlow();
  if (!flow) return sendJson(response, 200, { status: 'idle' });
  try {
    const result = await pollDeviceLogin(flow, deps.service.signal);
    if (result.status === 'success' && result.credentials && deps.getFlow() === flow) {
      await saveOauth(deps.context.dataDir, flow.region, result.credentials, deps.service.signal);
      deps.clearCache();
      deps.setFlow(null);
    }
    sendJson(response, 200, {
      status: result.status,
      verificationUri: flow.verificationUri,
      userCode: flow.userCode,
    });
  } catch (error) {
    deps.context.logger.warn('quota-bottle.login.poll_failed', { code: error instanceof QuotaError ? error.code : 'unknown' });
    sendJson(response, 500, { status: 'error' });
  }
}

/** @param {any} deps */
async function handleQuotaPost(request, response, deps) {
  const body = await readJsonBody(request, response);
  if (body === undefined) return;
  const total = normalizeTotal(body?.total);
  if (total === null) return sendJson(response, 400, { error: 'invalid_total' });
  try {
    await deps.store.write(total);
    deps.clearCache();
    sendJson(response, 200, { ok: true, total });
  } catch {
    sendJson(response, 500, { error: 'write_failed' });
  }
}

/** @param {any} deps */
async function handleSettingsPost(request, response, deps) {
  const body = await readJsonBody(request, response);
  if (body === undefined) return;
  if (typeof body?.usageScan !== 'boolean') return sendJson(response, 400, { error: 'invalid_settings' });
  try {
    const next = await writeSettings(deps.context.dataDir, { usageScan: body.usageScan });
    deps.setSettings(next);
    deps.clearCache();
    sendJson(response, 200, { ok: true, usageScan: next.usageScan });
  } catch {
    sendJson(response, 500, { error: 'write_failed' });
  }
}

/** @param {import('node:http').IncomingMessage} request @param {import('node:http').ServerResponse} response */
async function readJsonBody(request, response) {
  const type = String(request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') {
    sendJson(response, 415, { error: 'json_required' });
    return undefined;
  }
  let text;
  try {
    text = await readBody(request, BODY_LIMIT);
  } catch {
    request.resume();
    sendJson(response, 413, { error: 'body_too_large' });
    return undefined;
  }
  try {
    const parsed = JSON.parse(text || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
    return parsed;
  } catch {
    sendJson(response, 400, { error: 'invalid_json' });
    return undefined;
  }
}

/** @param {import('node:http').ServerResponse} response @param {number} status @param {any} body */
function sendJson(response, status, body) {
  if (response.destroyed || response.headersSent) return;
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

/** @param {import('node:http').IncomingMessage} request @param {number} limit */
function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let done = false;
    const chunks = [];
    request.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        done = true;
        chunks.length = 0;
        reject(new Error('too_large'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (!done) { done = true; resolve(Buffer.concat(chunks).toString('utf8')); }
    });
    request.on('error', (error) => { if (!done) { done = true; reject(error); } });
  });
}

/** @param {import('node:http').IncomingMessage} request @param {number} port */
function isLoopbackRequest(request, port) {
  const host = request.headers.host;
  if (host !== undefined && !LOOPBACK_HOSTS.has(hostnameOf(host))) return false;
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && LOOPBACK_HOSTS.has(hostnameOf(url.host)) && Number(url.port || 80) === port;
  } catch {
    return false;
  }
}

/** @param {string} hostHeader */
function hostnameOf(hostHeader) {
  const h = hostHeader.trim().toLowerCase();
  const bracketed = /^\[([^\]]*)\]/.exec(h);
  if (bracketed) return bracketed[1];
  const colon = h.lastIndexOf(':');
  return colon === -1 ? h : h.slice(0, colon);
}

/** @param {import('node:http').Server} server @param {string} host @param {number} port */
function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (/** @type {Error} */ error) => reject(error);
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
    server.closeAllConnections?.();
  });
}
