// @ts-check
// token-meter-board Mini App Node entry: serves the dashboard page and the
// read-only usage query API. Data comes from the local MiniMax Code runtime
// state (sqlite + observability logs + config.yaml); all queries are read-only.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveDataDir, openDb, factsStore, factsStats } from './lib/common.mjs';
import { resolveTrendWindow, buildTrendResult } from './lib/trend.mjs';
import { querySummary, querySessions, queryDaily, queryWindow, queryCalls, queryTurns } from './lib/queries.mjs';

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */
/** @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHILD_PATH = path.join(HERE, 'lib', 'db-child.mjs');

// Locate the MiniMax Code data directory. In the Mini App runtime neither
// MINIMAX_DATA_DIR nor PLUGIN_DATA is guaranteed, so first walk up from the
// Host-injected plugin data dir looking for the runtime database, then fall
// back to the shared resolution chain (env override, PLUGIN_DATA, ~/.minimax).
function resolveAppDataDir(contextDataDir) {
  const envDir = process.env.MINIMAX_DATA_DIR;
  if (envDir && fs.existsSync(envDir)) return path.resolve(envDir);
  let dir = contextDataDir ? path.resolve(contextDataDir) : null;
  for (let i = 0; dir && i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'v2', 'sqlite', 'runtime-state.sqlite'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolveDataDir();
}

function isSqliteUnavailable(err) {
  return Boolean(err && err.code === 'NO_DB' && /node:sqlite/.test(err.message || ''));
}

/**
 * @param {MiniAppContext} context
 * @returns {Promise<MiniAppLifecycle>}
 */
export async function start(context) {
  const dataDir = resolveAppDataDir(context.dataDir);
  const children = new Set();
  // null = untried, false = in-process works, true = must use child fallback.
  let childMode = null;

  // NOTE the spread order: `...p` first, `dataDir` last. The data directory is
  // resolved by the Host and must never be overridable by a request, so it is
  // applied AFTER the caller-supplied parameters on purpose.
  const MODES = {
    window: (p) => queryWindow({ ...p, dataDir }),
    trend: (p) => {
      const now = Date.now();
      const { startMs, endMs } = resolveTrendWindow(
        { startAt: p.startAt, endAt: p.endAt, days: p.days },
        now,
      );
      return buildTrendResult({ dataDir, startMs, endMs, bucket: p.bucket, fillEmpty: p.fillEmpty, now });
    },
    summary: (p) => querySummary({ ...p, dataDir }),
    sessions: (p) => querySessions({ ...p, dataDir }),
    daily: (p) => queryDaily({ ...p, dataDir }),
    calls: (p) => queryCalls({ ...p, dataDir }),
    turns: (p) => queryTurns({ ...p, dataDir }),
  };

  function runChild(mode, params) {
    return new Promise((resolve, reject) => {
      const args = [CHILD_PATH, mode, JSON.stringify({ ...params, dataDir })];
      const trySpawn = (cmd, env) => {
        const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env });
        children.add(child);
        let out = '';
        let errBuf = '';
        let settled = false;
        const finish = (fn, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          children.delete(child);
          fn(value);
        };
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          finish(reject, new Error('query timed out'));
        }, 30000);
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (c) => {
          if (out.length < 16 * 1024 * 1024) out += c;
        });
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (c) => {
          if (errBuf.length < 4096) errBuf += c;
        });
        child.on('error', (e) => {
          if (settled) return;
          if (e && e.code === 'ENOENT' && cmd === 'node') {
            // No system node on PATH: retry the runtime's own executable as plain Node.
            children.delete(child);
            clearTimeout(timer);
            settled = true;
            trySpawn(process.execPath, { ...process.env, ELECTRON_RUN_AS_NODE: '1' });
            return;
          }
          finish(reject, e);
        });
        child.on('close', (code) => {
          let body;
          try {
            body = JSON.parse(out);
          } catch {
            finish(reject, new Error(`query helper failed (exit ${code}): ${errBuf.slice(0, 300) || 'no output'}`));
            return;
          }
          if (code !== 0) {
            const err = new Error(body.error || `query helper exit ${code}`);
            err.code = body.code || null;
            finish(reject, err);
            return;
          }
          finish(resolve, body);
        });
      };
      trySpawn('node', process.env);
    });
  }

  async function runQuery(mode, params) {
    if (childMode !== true) {
      try {
        const result = MODES[mode](params);
        childMode = false;
        return result;
      } catch (err) {
        if (!isSqliteUnavailable(err)) throw err;
        childMode = true;
        context.logger.warn('token_meter_board.sqlite_fallback', { reason: err.message });
      }
    }
    return runChild(mode, params);
  }

  function health() {
    const dbFile = path.join(dataDir, 'v2', 'sqlite', 'runtime-state.sqlite');
    const dbExists = fs.existsSync(dbFile);
    let sqliteInProcess = false;
    let usageRows = null;
    if (dbExists) {
      const { db } = openDb(dataDir);
      if (db) {
        sqliteInProcess = true;
        try {
          usageRows = db.prepare('SELECT COUNT(*) c FROM local_runtime_token_usage').get().c;
        } catch {
          usageRows = null;
        }
        db.close();
      }
    }
    const store = factsStore(dataDir);
    return {
      ok: true,
      now: Date.now(),
      runtime: {
        node: process.version,
        sqliteInProcess,
        queryMode: childMode === true ? 'child' : 'in-process',
      },
      dataDir,
      dbExists,
      usageRows,
      facts: factsStats(store),
    };
  }

  const clientEntry = await fs.promises.readFile(
    path.join(context.pluginRoot, 'miniapp', 'client', 'index.html'),
  );
  const chartJs = await fs.promises.readFile(
    path.join(context.pluginRoot, 'miniapp', 'client', 'vendor', 'chart.umd.min.js'),
  );

  const API_ROUTES = {
    '/api/window': 'window',
    '/api/trend': 'trend',
    '/api/summary': 'summary',
    '/api/sessions': 'sessions',
    '/api/daily': 'daily',
    '/api/calls': 'calls',
    '/api/turns': 'turns',
  };

  // Query parameters are an ALLOW-LIST, not a pass-through. Anything the page
  // does not send is dropped here, so a crafted query string can never reach
  // the query layer with a key it does not expect — most importantly it can
  // never carry a `dataDir` (the database location) or any other internal
  // option into the query functions.
  const API_PARAMS = {
    window: ['startAt', 'endAt', 'days', 'bucket', 'fillEmpty'],
    trend: ['startAt', 'endAt', 'days', 'bucket', 'fillEmpty'],
    summary: ['startAt', 'endAt', 'days'],
    sessions: ['startAt', 'endAt', 'days', 'limit'],
    daily: ['days'],
    calls: ['startAt', 'endAt', 'days', 'limit'],
    turns: ['startAt', 'endAt', 'days', 'limit'],
  };

  const server = http.createServer((request, response) => {
    void (async () => {
      try {
        const url = new URL(request.url ?? '/', 'http://miniapp.local');
        if (request.method !== 'GET') {
          response.writeHead(405, { 'content-type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: 'method_not_allowed' }));
          return;
        }
        if (url.pathname === '/' || url.pathname === '/index.html') {
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
          response.end(clientEntry);
          return;
        }
        if (url.pathname === '/vendor/chart.umd.min.js') {
          response.writeHead(200, {
            'content-type': 'application/javascript; charset=utf-8',
            'cache-control': 'public, max-age=86400',
          });
          response.end(chartJs);
          return;
        }
        if (url.pathname === '/api/health') {
          response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          response.end(JSON.stringify(health()));
          return;
        }
        const mode = API_ROUTES[url.pathname];
        if (mode) {
          const allowed = API_PARAMS[mode] || [];
          const params = {};
          for (const key of allowed) {
            if (!url.searchParams.has(key)) continue;
            params[key] = url.searchParams.get(key);
          }
          if (params.fillEmpty != null) params.fillEmpty = params.fillEmpty !== 'false';
          try {
            const result = await runQuery(mode, params);
            response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            response.end(JSON.stringify(result));
          } catch (err) {
            const status = err && err.code === 'NO_DB' ? 503 : 400;
            response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            response.end(JSON.stringify({ error: String(err?.message || err) }));
          }
          return;
        }
        response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'not_found' }));
      } catch (err) {
        try {
          response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: String(err?.message || err) }));
        } catch {
          // socket already gone
        }
      }
    })();
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(context.listen.port, context.listen.host, () => {
      server.off('error', onError);
      resolve();
    });
  });
  context.logger.info('token_meter_board.listening');

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    context.signal.removeEventListener('abort', onAbort);
    for (const child of children) {
      try {
        child.kill('SIGKILL');
      } catch {
        // already gone
      }
    }
    children.clear();
    // drop keep-alive client connections so close() settles promptly
    server.closeIdleConnections?.();
    await new Promise((resolve) => server.close(() => resolve()));
  };
  const onAbort = () => {
    void dispose();
  };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  return { dispose };
}
