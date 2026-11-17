// @ts-check

import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import {
  defaultTargetDataDir,
  findMigrationPlugin,
  normalizeTargetDataDir,
  runMigrationCommand,
} from './migration.mjs';

const TARGET_AGENT = 'mavis';

const MAX_JSON_BODY = 1024 * 1024;
const MAX_ZIP_BODY = 1024 * 1024 * 1024;
const ASSETS = new Set(['app.js', 'styles.css', 'deepseek.js', 'archive.js']);

export async function start(context) {
  await mkdir(context.dataDir, { recursive: true });
  const statePath = join(context.dataDir, 'state.json');
  const state = await loadState(statePath);
  const clientRoot = join(context.pluginRoot, 'miniapp/client');
  let source = null;
  const pendingPlans = new Map();

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://miniapp.local');
      if (request.method === 'GET' && url.pathname === '/deepseek-chat-migration') return sendFile(response, join(clientRoot, 'index.html'));
      if (request.method === 'GET' && url.pathname.startsWith('/assets/')) {
        const name = url.pathname.slice('/assets/'.length);
        if (!ASSETS.has(name)) return json(response, 404, { error: 'not_found' });
        return sendFile(response, join(clientRoot, name));
      }
      if (request.method === 'GET' && url.pathname === '/api/state') {
        const migrationPlugin = await findMigrationPlugin();
        return json(response, 200, {
          imported: Object.keys(state.imported),
          targetDataDir: state.targetDataDir,
          defaultTargetDataDir: defaultTargetDataDir(),
          agentName: state.agentName,
          migrationPlugin: migrationPlugin
            ? { installed: true, path: migrationPlugin }
            : { installed: false, message: 'Install the agent-session-migration plugin to import native sessions.' },
        });
      }
      if (request.method === 'POST' && url.pathname === '/api/source') {
        if (source?.dir) await rm(source.dir, { recursive: true, force: true });
        const dir = await mkdtemp(join(context.dataDir, 'migration-'));
        const path = join(dir, 'deepseek-export.zip');
        try {
          await saveRequestBody(request, path, MAX_ZIP_BODY);
        } catch (error) {
          await rm(dir, { recursive: true, force: true });
          throw error;
        }
        source = { dir, path };
        pendingPlans.clear();
        return json(response, 200, { uploaded: true });
      }
      if (request.method === 'POST' && url.pathname === '/api/migration/plan') {
        if (!source?.path) return json(response, 409, { error: 'source_not_uploaded' });
        const body = await readJson(request);
        const selections = readSelections(body.sessions);
        const pluginRoot = await findMigrationPlugin();
        if (!pluginRoot) {
          return json(response, 409, {
            error: 'migration_plugin_missing',
            message: 'Install the agent-session-migration plugin, then reopen this Mini App.',
          });
        }
        const targetDataDir = defaultTargetDataDir();
        const agentName = TARGET_AGENT;
        const reportPath = join(source.dir, `plan-${randomUUID()}.json`);
        const result = await runMigrationCommand({
          scriptPath: join(pluginRoot, 'scripts', 'migrate.py'),
          action: 'plan',
          sourcePath: source.path,
          sessionIds: selections.map((item) => item.id),
          reportPath,
          targetDataDir,
          agentName,
          signal: context.signal,
        });
        const planId = randomUUID();
        pendingPlans.set(planId, { selections, pluginRoot, targetDataDir, agentName });
        state.targetDataDir = targetDataDir;
        state.agentName = agentName;
        await saveState(statePath, state);
        return json(response, 200, { planId, pluginPath: pluginRoot, ...result });
      }
      if (request.method === 'POST' && url.pathname === '/api/migration/apply') {
        if (!source?.path) return json(response, 409, { error: 'source_not_uploaded' });
        const body = await readJson(request);
        const plan = typeof body.planId === 'string' ? pendingPlans.get(body.planId) : null;
        if (!plan) return json(response, 409, { error: 'plan_not_found' });
        const reportPath = join(source.dir, `apply-${randomUUID()}.json`);
        const result = await runMigrationCommand({
          scriptPath: join(plan.pluginRoot, 'scripts', 'migrate.py'),
          action: 'apply',
          sourcePath: source.path,
          sessionIds: plan.selections.map((item) => item.id),
          reportPath,
          targetDataDir: plan.targetDataDir,
          agentName: plan.agentName,
          signal: context.signal,
        });
        const statusById = new Map(result.sessions.map((item) => [item.sessionId, item.status]));
        const imported = [];
        for (const selection of plan.selections) {
          if (result.exitCode === 0 && statusById.get(selection.id) !== 'failed') {
            state.imported[selection.stableId] = {
              sourceId: selection.id,
              importedAt: new Date().toISOString(),
            };
            imported.push(selection.stableId);
          }
        }
        await saveState(statePath, state);
        pendingPlans.delete(body.planId);
        return json(response, 200, { imported, ...result });
      }
      return json(response, 404, { error: 'not_found' });
    } catch (error) {
      context.logger.warn(`request failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      if (!response.headersSent) {
        const code = typeof error?.code === 'string' ? error.code : 'request_failed';
        const message = error instanceof Error && error.message !== code ? error.message : undefined;
        json(response, code === 'BODY_TOO_LARGE' || code === 'body_too_large' ? 413 : 400, { error: code, message });
      }
      else response.end();
    }
  });

  await listen(server, context.listen.host, context.listen.port);
  context.logger.info('deepseek-chat-migration.runtime.listening');
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    context.signal.removeEventListener('abort', onAbort);
    await close(server);
    if (source?.dir) await rm(source.dir, { recursive: true, force: true });
  };
  const onAbort = () => void dispose();
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();
  return { dispose };
}

function readSelections(value) {
  if (!Array.isArray(value) || !value.length || value.length > 1000) throw requestError('invalid_sessions');
  return value.map((item) => {
    if (!item || typeof item.id !== 'string' || !item.id || item.id.startsWith('-') || item.id.length > 256
      || typeof item.stableId !== 'string' || !item.stableId || item.stableId.length > 256
      || /[\u0000-\u001f\u007f]/.test(item.id)) {
      throw requestError('invalid_sessions');
    }
    return { id: item.id, stableId: item.stableId };
  });
}

async function loadState(path) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    return {
      imported: value.imported && typeof value.imported === 'object' ? value.imported : {},
      targetDataDir: typeof value.targetDataDir === 'string'
        ? normalizeTargetDataDir(value.targetDataDir)
        : defaultTargetDataDir(),
      agentName: typeof value.agentName === 'string' ? value.agentName : '',
    };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return { imported: {}, targetDataDir: defaultTargetDataDir(), agentName: '' };
  }
}

async function saveState(path, state) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, path);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_JSON_BODY) {
      const error = new Error('body too large');
      error.code = 'BODY_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function saveRequestBody(request, path, limit) {
  let size = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > limit) {
        callback(requestError('body_too_large'));
        return;
      }
      callback(null, chunk);
    },
  });
  await pipeline(request, limiter, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
  if (!size) throw requestError('empty_source');
}

function requestError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function sendFile(response, path) {
  const body = await readFile(path);
  const type = ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(path)] || 'application/octet-stream';
  response.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'x-content-type-options': 'nosniff' });
  response.end(body);
}

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(body));
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
