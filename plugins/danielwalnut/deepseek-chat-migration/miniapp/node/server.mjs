// @ts-check

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';

// The page parses the DeepSeek export itself and hands text to the chat input through
// `window.mcode.miniapp.message.append`. Node only serves the page: it reads no Host files,
// writes nothing, and spawns no processes.
const ASSETS = new Set(['app.js', 'styles.css', 'deepseek.js', 'archive.js', 'handoff.js', 'icon.png']);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

export async function start(context) {
  const clientRoot = join(context.pluginRoot, 'miniapp/client');
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://miniapp.local');
      if (request.method === 'GET' && url.pathname === '/deepseek-chat-migration') return await sendFile(response, join(clientRoot, 'index.html'));
      if (request.method === 'GET' && url.pathname.startsWith('/assets/')) {
        const name = url.pathname.slice('/assets/'.length);
        if (ASSETS.has(name)) return await sendFile(response, join(clientRoot, name));
      }
      return json(response, 404, { error: 'not_found' });
    } catch (error) {
      context.logger.warn(`request failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      if (!response.headersSent) json(response, 500, { error: 'request_failed' });
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

async function sendFile(response, path) {
  const body = await readFile(path);
  const type = TYPES[extname(path)] || 'application/octet-stream';
  const charset = type.startsWith('text/') ? '; charset=utf-8' : '';
  response.writeHead(200, { 'content-type': `${type}${charset}`, 'x-content-type-options': 'nosniff' });
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
