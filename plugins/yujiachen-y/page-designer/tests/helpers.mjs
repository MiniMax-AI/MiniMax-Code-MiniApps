// Test harness: the real Node entry on a free loopback port, with a scripted Agent that behaves
// like MiniMax Code's (it calls the Mini App's MCP endpoint to write pages).
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { start } from '../miniapp/node/server.mjs';

export const PLUGIN_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

export async function freePort() {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
      server.close(() => done(port));
    });
  });
}

export function silentLogger() {
  const lines = [];
  const log = (level) => (message) => lines.push(`${level} ${message}`);
  return { lines, debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') };
}

/** A fake Agent. `script(call)` decides what each run or answer does. */
export function createFakeAgent() {
  let sessions = 0;
  const calls = [];
  const replies = [];
  const waiters = new Map();
  const agent = {
    calls,
    replies,
    /** @type {(call: any) => Promise<any>} */
    script: async () => ({ status: 'finished', text: 'ok' }),
    async create() {
      sessions += 1;
      calls.push({ type: 'create' });
      return { sessionId: `s-${sessions}` };
    },
    async run(input, options) {
      calls.push({ type: 'run', input });
      return agent.script({ type: 'run', input, options });
    },
    async answer(input, options) {
      calls.push({ type: 'answer', input });
      return agent.script({ type: 'answer', input, options });
    },
    async reply(input) {
      replies.push(input);
      waiters.get(input.requestId)?.(input.decision);
    },
    /** Resolves with the decision once the page replies to this permission request. */
    waitForReply(requestId) {
      return new Promise((done) => waiters.set(requestId, done));
    },
    async models() {
      return {
        models: [{ providerId: 'minimax', modelId: 'm-1', displayName: 'Model One', thinking: { efforts: ['low', 'high'] } }],
        default: { providerId: 'minimax', modelId: 'm-1' },
      };
    },
    async agents() {
      return { agents: [{ name: 'mavis', displayName: 'Mavis', primary: true }] };
    },
  };
  return agent;
}

export async function startApp({ dataDir, agent = createFakeAgent() } = {}) {
  const dir = dataDir ?? (await mkdtemp(join(tmpdir(), 'page-designer-')));
  const port = await freePort();
  const controller = new AbortController();
  const logger = silentLogger();
  const lifecycle = await start({
    pluginId: 'page-designer',
    pluginRoot: PLUGIN_ROOT,
    dataDir: dir,
    listen: { host: '127.0.0.1', port },
    signal: controller.signal,
    logger,
    agent,
  });
  const base = `http://127.0.0.1:${port}`;

  async function request(method, path, body, headers = {}) {
    const response = await fetch(base + path, {
      method,
      headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const type = response.headers.get('content-type') ?? '';
    const data = type.includes('application/json') ? await response.json() : await response.text();
    return { status: response.status, headers: response.headers, data };
  }

  let rpcId = 0;
  async function mcp(name, args) {
    const response = await fetch(`${base}/mcp/page-designer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
    });
    const payload = await response.json();
    const text = payload.result?.content?.[0]?.text ?? '';
    let value = text;
    try {
      value = JSON.parse(text);
    } catch {
      // plain text error
    }
    return { isError: payload.result?.isError === true, value, payload };
  }

  /** Poll until the project has no live run. */
  async function settled(id, timeout = 3000) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const { data } = await request('GET', `/api/projects/${id}`);
      const running = data.runs?.some?.((run) => run.status === 'running');
      if (!data.live && !running) return data;
      if (Date.now() > deadline) throw new Error(`project ${id} did not settle`);
      await new Promise((done) => setTimeout(done, 20));
    }
  }

  return {
    base,
    dataDir: dir,
    agent,
    logger,
    request,
    mcp,
    settled,
    async stop() {
      await lifecycle.dispose();
    },
    async cleanup() {
      await lifecycle.dispose();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export const projectIdIn = (text) => /\b(p-[0-9a-f]{8})\b/.exec(text)?.[1];

export const SAMPLE_PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>Bakery</title></head><body><h1>Fresh bread</h1><p>Open daily.</p></body></html>';
