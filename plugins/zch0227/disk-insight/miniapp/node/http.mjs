// @ts-check
// HTTP 小工具：JSON 响应、请求体、静态文件白名单、SSE。
import path from 'node:path';
import { HttpError } from './util.mjs';

/** @param {import('node:http').ServerResponse} res @param {number} status @param {any} body */
export function sendJSON(res, status, body) {
  if (res.headersSent) {
    res.end();
    return;
  }
  const buf = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': buf.length });
  res.end(buf);
}

/** @param {import('node:http').ServerResponse} res @param {HttpError} e */
export function sendError(res, e) {
  sendJSON(res, e.status, { error: e.code, message: e.message });
}

/** @param {import('node:http').IncomingMessage} req @param {number} [limit] */
export function readJSON(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (c) => {
      if (failed) return;
      size += c.length;
      if (size > limit) {
        failed = true;
        reject(new HttpError(413, 'too_large', '请求内容太大'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (failed) return;
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) {
        resolve({});
        return;
      }
      try {
        const v = JSON.parse(text);
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not object');
        resolve(v);
      } catch {
        reject(new HttpError(400, 'bad_request', '请求内容不是合法的 JSON 对象'));
      }
    });
    req.on('error', () => {
      if (!failed) reject(new HttpError(400, 'bad_request', '读取请求失败'));
    });
  });
}

const STATIC = new Map([
  ['/dashboard', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/assets/app.js', { file: path.join('assets', 'app.js'), type: 'text/javascript; charset=utf-8' }],
  ['/assets/app.css', { file: path.join('assets', 'app.css'), type: 'text/css; charset=utf-8' }],
]);

/**
 * 页面文件只按白名单返回，不存在时 404。
 * @param {any} fs @param {string} pluginRoot @param {string} pathname @param {import('node:http').ServerResponse} res
 * @returns {Promise<boolean>} 是否是静态路由
 */
export async function serveStatic(fs, pluginRoot, pathname, res) {
  if (pathname.startsWith('/assets/') && !STATIC.has(pathname)) {
    sendJSON(res, 404, { error: 'not_found', message: '没有这个文件' });
    return true;
  }
  const hit = STATIC.get(pathname);
  if (!hit) return false;
  let buf;
  try {
    buf = await fs.readFile(path.join(pluginRoot, 'miniapp', 'client', hit.file));
  } catch {
    sendJSON(res, 404, { error: 'not_found', message: '页面文件不存在' });
    return true;
  }
  res.writeHead(200, { 'content-type': hit.type, 'cache-control': 'no-cache', 'content-length': buf.length });
  res.end(buf);
  return true;
}

export function createSseHub() {
  /** @type {Set<import('node:http').ServerResponse>} */
  const clients = new Set();
  /** @type {ReturnType<typeof setInterval> | null} */
  let heartbeat = null;

  /** @param {import('node:http').ServerResponse} res @param {string} event @param {any} data */
  function write(res, event, data) {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      clients.delete(res);
    }
  }

  return {
    /**
     * @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res
     * @param {[string, any][]} initial
     */
    add(req, res, initial) {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write(': connected\n\n');
      clients.add(res);
      for (const [event, data] of initial) write(res, event, data);
      const drop = () => clients.delete(res);
      req.on('close', drop);
      res.on('close', drop);
      if (!heartbeat) {
        heartbeat = setInterval(() => {
          for (const c of clients) {
            try {
              c.write(': ping\n\n');
            } catch {
              clients.delete(c);
            }
          }
        }, 20000);
        heartbeat.unref?.();
      }
    },
    /** @param {string} event @param {any} data */
    broadcast(event, data) {
      for (const c of clients) write(c, event, data);
    },
    get size() {
      return clients.size;
    },
    closeAll() {
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      for (const c of clients) {
        try {
          c.end();
        } catch {
          // 忽略
        }
      }
      clients.clear();
    },
  };
}
