import { readState, writeState } from './store.js';
import { sendRequest } from './proxy.js';

/** 单次请求体最大字节数 */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

function sendJson(res, status, data) {
  const text = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  res.end(text);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(text);
}

/**
 * API 处理器。
 * 以 (req, res, next) 形式实现，既能挂进 Vite 中间件栈，也能作为独立 http server 的入口。
 */
export function createApiHandler() {
  return async function apiHandler(req, res, next) {
    let pathname;
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      return next();
    }
    if (!pathname.startsWith('/api/')) return next();

    try {
      if (req.method === 'GET' && pathname === '/api/health') {
        return sendJson(res, 200, { ok: true, name: 'postman-lite', time: Date.now() });
      }

      if (req.method === 'GET' && pathname === '/api/state') {
        return sendJson(res, 200, readState());
      }

      if (req.method === 'PUT' && pathname === '/api/state') {
        const doc = await readJsonBody(req);
        const written = writeState(doc);
        const stale = written.stale === true;
        return sendJson(res, 200, { ok: !stale, rev: written.rev, stale });
      }

      if (req.method === 'POST' && pathname === '/api/send') {
        const payload = await readJsonBody(req);
        const result = await sendRequest(payload);
        return sendJson(res, 200, result);
      }

      return sendJson(res, 404, {
        ok: false,
        error: { kind: 'not_found', message: `接口不存在：${req.method} ${pathname}` },
      });
    } catch (err) {
      return sendJson(res, 500, {
        ok: false,
        error: { kind: 'server', message: err?.message ?? '本地服务异常' },
      });
    }
  };
}
