// @ts-check

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';

const MAX_BODY = 32 * 1024 * 1024;
const ASSETS = new Set(['app.js', 'styles.css', 'deepseek.js', 'archive.js', 'distill.js']);

export async function start(context) {
  await mkdir(context.dataDir, { recursive: true });
  const statePath = join(context.dataDir, 'state.json');
  const state = await loadState(statePath);
  const clientRoot = join(context.pluginRoot, 'miniapp/client');

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
        return json(response, 200, { imported: Object.keys(state.conversations), handoffs: state.handoffs });
      }
      if (request.method === 'POST' && url.pathname === '/api/import') {
        const body = await readJson(request);
        if (!Array.isArray(body.conversations) || body.conversations.length > 1000) return json(response, 400, { error: 'invalid_conversations' });
        for (const conversation of body.conversations) {
          if (!validConversation(conversation)) return json(response, 400, { error: 'invalid_conversation' });
          state.conversations[conversation.stableId] = conversation;
        }
        await saveState(statePath, state);
        return json(response, 200, { saved: body.conversations.length });
      }
      if (request.method === 'POST' && url.pathname === '/api/handoff') {
        const body = await readJson(request);
        if (typeof body.stableId !== 'string' || typeof body.handoff !== 'string' || body.handoff.length > 200000 || !state.conversations[body.stableId]) {
          return json(response, 400, { error: 'invalid_handoff' });
        }
        state.handoffs[body.stableId] = body.handoff;
        await saveState(statePath, state);
        return json(response, 200, { saved: true });
      }
      return json(response, 404, { error: 'not_found' });
    } catch (error) {
      context.logger.warn(`request failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      if (!response.headersSent) json(response, error?.code === 'BODY_TOO_LARGE' ? 413 : 400, { error: 'request_failed' });
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
  };
  const onAbort = () => void dispose();
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();
  return { dispose };
}

function validConversation(value) {
  return value && typeof value === 'object' && typeof value.stableId === 'string' && value.stableId.length <= 256
    && typeof value.title === 'string' && value.title.length <= 10000 && Array.isArray(value.messages)
    && value.messages.length <= 100000;
}

async function loadState(path) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    return { conversations: value.conversations || {}, handoffs: value.handoffs || {} };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return { conversations: {}, handoffs: {} };
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
    if (size > MAX_BODY) {
      const error = new Error('body too large');
      error.code = 'BODY_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
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
