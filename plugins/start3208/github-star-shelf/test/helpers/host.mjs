// 在测试里扮演宿主：拼出 context，启动真正的 Mini App 服务，给一个会说 HTTP / MCP 的小客户端。
import { start } from '../../miniapp/node/server.mjs';
import { REPO_ROOT, freePort, sleep } from './sandbox.mjs';

export async function boot(sb, { agent, envCtx, capabilities, dataDir } = {}) {
  const port = await freePort();
  const ctl = new AbortController();
  const logs = [];
  const logger = {};
  for (const level of ['debug', 'info', 'warn', 'error']) logger[level] = (message, fields) => logs.push({ level, message, fields });
  const context = {
    pluginId: 'github-star-shelf',
    pluginRoot: REPO_ROOT.replace(/[\\/]+$/, ''),
    dataDir: dataDir || sb.data,
    listen: { host: '127.0.0.1', port },
    logger,
    signal: ctl.signal,
    ...(agent ? { agent } : {}),
    ...(capabilities === undefined ? { capabilities: { has: () => true } } : capabilities ? { capabilities } : {}),
  };
  const handle = await start(context, { envCtx });
  const base = 'http://127.0.0.1:' + port;

  const api = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* 不是 JSON（比如页面） */
    }
    return { status: res.status, json, text, headers: res.headers };
  };
  const get = (path) => api('GET', path);
  const post = (path, body = {}) => api('POST', path, body);
  const mcp = (method, params, id = 1) => post('/mcp/github-star-shelf', { jsonrpc: '2.0', id, method, params });
  /** 调一个 MCP 工具，返回 { ok, data } */
  const tool = async (name, args = {}) => {
    const r = await mcp('tools/call', { name, arguments: args });
    const result = r.json?.result;
    const text = result?.content?.[0]?.text ?? '';
    if (result?.isError) return { ok: false, error: text };
    return { ok: true, data: text ? JSON.parse(text) : null };
  };
  const waitFor = async (fn, { timeout = 8000, every = 40, what = 'condition' } = {}) => {
    const t0 = Date.now();
    let last;
    for (;;) {
      last = await fn();
      if (last) return last;
      if (Date.now() - t0 > timeout) throw new Error('timed out waiting for ' + what);
      await sleep(every);
    }
  };
  const state = async () => (await get('/api/state')).json;
  const stop = async () => {
    await handle.dispose();
  };
  return { base, port, api, get, post, mcp, tool, waitFor, state, handle, logs, ctl, stop };
}

/** 导入 Star 并等预取 README 结束 */
export async function importAll(app, user) {
  const r = await app.post('/api/import', user ? { user } : {});
  if (r.status !== 200) throw new Error('import failed to start: ' + r.text);
  await app.waitFor(async () => (await app.state()).import.status !== 'running', { what: 'import' });
  const s = await app.state();
  if (s.import.status === 'done') await app.waitFor(async () => (await app.state()).prefetch.status !== 'running', { what: 'prefetch' });
  return app.state();
}
