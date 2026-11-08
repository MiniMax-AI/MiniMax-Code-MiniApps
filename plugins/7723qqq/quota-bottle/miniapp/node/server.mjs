// @ts-check

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';

import { ValueCache } from './cache.mjs';
import { QuotaError, isLoginFixable, pickMostSpecific, safeErrorCode } from './errors.mjs';
import { saveOauth } from './auth/auth.mjs';
import { normalizeRegion, readConfiguredRegion } from './auth/config.mjs';
import { openBrowser, pollDeviceLogin, startDeviceLogin } from './auth/oauth.mjs';
import { fetchDesktopSessionQuota } from './desktop-session.mjs';
import { fetchQuota, manualState, normalizeQuota } from './quota.mjs';
import { createStore, normalizeTotal } from './store.mjs';
import { monthWindow, readUsedTokens } from './usage.mjs';

// The desktop reads the same endpoint with a five second cache of its own, so
// three seconds here keeps a pinned window close to live without adding load.
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
  /** @type {'cn' | 'global' | null} */
  let lastLiveRegion = null;
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
    /** @type {string[]} */
    const failures = [];
    // The desktop's own session first: it is a credential the user already has,
    // and it reports the same Token Plan quota the desktop shows.
    try {
      // The client's region is not ours to know: the first read discovers it,
      // and later reads start with the region that answered.
      const preferred = lastLiveRegion ?? (await readConfiguredRegion());
      const session = await fetchDesktopSessionQuota(context, {
        preferredRegion: preferred,
        signal: service.signal,
      });
      const normalized = normalizeQuota(session.payload);
      if (normalized.ok) {
        lastLiveRegion = session.region;
        context.logger.info('quota-bottle.live.ok', { source: 'desktop', region: session.region, models: normalized.models.length });
        return { ...normalized, detail: session.detail, region: session.region };
      }
      failures.push(normalized.code);
    } catch (error) {
      const code = error instanceof QuotaError ? error.code : 'unknown';
      context.logger.warn('quota-bottle.live.desktop_failed', { code });
      failures.push(code);
    }
    try {
      const payload = await fetchQuota(service.signal);
      const normalized = normalizeQuota(payload);
      if (normalized.ok) {
        context.logger.info('quota-bottle.live.ok', { source: 'cli', models: normalized.models.length });
        return { ...normalized, detail: 'token-plan' };
      }
      context.logger.warn('quota-bottle.live.empty', { code: normalized.code });
      failures.push(normalized.code);
    } catch (error) {
      const code = error instanceof QuotaError ? error.code : 'unknown';
      context.logger.warn('quota-bottle.live.failed', { code });
      failures.push(code);
    }
    return { ok: false, code: safeErrorCode(pickMostSpecific(failures)) };
  }

  async function liveState(fresh) {
    return liveCache.get(fresh, () => track(liveValue()));
  }

  async function usageState(window, fresh) {
    return usageCache.get(fresh, () => track(readUsedTokens(window, context)), window.label);
  }

  async function buildState(fresh = false) {
    const live = await liveState(fresh);
    if (live.ok) {
      // The desktop's panel reads the first row of `model_remains`; taking a
      // different row here would show a second number next to that panel.
      const primary = live.models[0];
      return {
        generatedAt: Date.now(),
        mode: 'live',
        region: live.region,
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
    const region = await readConfiguredRegion();
    const problems = [live.code];
    if (!used.ok) problems.push(used.code);
    const base = {
      generatedAt: Date.now(),
      region,
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
      await saveOauth(flow.region, result.credentials, deps.service.signal);
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
