import { createRecoveryStore } from './recovery-store.mjs';
import { createEditorService } from './editor-service.mjs';
import { createCodeService } from './editor-code.mjs';
import { createAgentService, readJSON } from './agent-service.mjs';
import { handleAgentMCP } from './agent-mcp.mjs';
import { createServer } from 'node:http';
import { readFile, mkdir, readdir, rename, writeFile, stat } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
const MIME = {
  '.wasm': 'application/wasm',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const MAX = 64 * 1024 * 1024;
export async function start(context) {
  const client = resolve(context.pluginRoot, 'miniapp/client'),
    storage = join(context.dataDir, 'projects');
  await mkdir(storage, { recursive: true });
  const recovery = await createRecoveryStore(context.dataDir);
  const agent = await createAgentService(context.dataDir);
  const editor = await createEditorService(context.dataDir);
  editor.code = await createCodeService(context.dataDir, editor);
  const locks = new Map();
  async function serial(id, fn) {
    const previous = locks.get(id) || Promise.resolve();
    const next = previous.catch(() => {}).then(fn);
    locks.set(id, next);
    try {
      return await next;
    } finally {
      if (locks.get(id) === next) locks.delete(id);
    }
  }
  const json = (res, status, value) => {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(JSON.stringify(value));
  };
  const server = createServer(async (req, res) => {
    try {
      const host = req.headers.host;
      if (
        !host ||
        !['127.0.0.1', 'localhost', '[::1]'].some((h) => host === h || host.startsWith(h + ':'))
      )
        return json(res, 403, { error: '不允许的访问地址' });
      const url = new URL(req.url, 'http://' + host);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
      );
      if (url.pathname === '/mcp/retouch-images') {
        if (req.headers.origin && req.headers.origin !== url.origin)
          return json(res, 403, { error: 'Origin rejected' });
        return await handleAgentMCP(req, res, agent, json, editor);
      }
      if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== url.origin)
        return json(res, 403, { error: '仅允许本页面保存工程' });
      if (url.pathname === '/api/recovery' && req.method === 'GET')
        return json(res, 200, { snapshots: await recovery.list() });
      const recoveryId = url.pathname.match(/^\/api\/recovery\/((?:document|assistant)-[a-f0-9-]{36})$/);
      if (recoveryId) {
        try {
          if (req.method === 'GET') return json(res, 200, await recovery.get(recoveryId[1]));
          if (req.method === 'POST') return json(res, 200, await recovery.put(recoveryId[1],
            await readJSON(req, recoveryId[1].startsWith('document-') ? 96 * 1024 * 1024 : 1024 * 1024)));
          return json(res, 405, { error: 'Unsupported method' });
        } catch (error) { return json(res, error.status || 400, { error: error.message }); }
      }
      if (url.pathname === '/api/editor/register' && req.method === 'POST') {
        try {
          return json(res, 200, editor.register(await readJSON(req, 1024 * 1024)));
        } catch (error) {
          return json(res, 400, { error: error.message });
        }
      }
      const editorRoute = url.pathname.match(
        /^\/api\/editor\/([a-f0-9-]{36})\/(events|claim|finish|ack)$/,
      );
      if (editorRoute) {
        try {
          const [, editorId, action] = editorRoute;
          if (action === 'events' && req.method === 'GET')
            return editor.subscribe(editorId, req, res);
          if (req.method !== 'POST') return json(res, 405, { error: 'Unsupported method' });
          const input = await readJSON(req, action === 'finish' ? 96 * 1024 * 1024 : 1024);
          const result =
            action === 'claim'
              ? await editor.claim(editorId, input.jobId)
              : action === 'finish'
                ? await editor.finish(editorId, input.jobId, input)
                : action === 'ack'
                  ? await editor.acknowledge(editorId, input.jobId, input)
                  : null;
          if (!result) return json(res, 400, { error: 'Unknown action' });
          return json(res, 200, result);
        } catch (error) {
          return json(res, 400, { error: error.message });
        }
      }
      if (url.pathname === '/api/agent/events' && req.method === 'GET')
        return agent.subscribe(req, res);
      if (url.pathname === '/api/agent/requests') {
        if (req.method === 'GET') return json(res, 200, { requests: await agent.list() });
        if (req.method === 'POST') {
          try {
            return json(res, 201, await agent.create(await readJSON(req)));
          } catch {
            return json(res, 400, { error: '图片需求或参考图无效；PNG 最大 16 MB' });
          }
        }
        return json(res, 405, { error: 'Unsupported method' });
      }
      const resultId = url.pathname.match(/^\/api\/agent\/requests\/([a-f0-9-]{36})\/result$/);
      if (resultId && req.method === 'GET') {
        try {
          const bytes = await agent.result(resultId[1]);
          res.writeHead(200, {
            'Content-Type': 'image/png',
            'Cache-Control': 'no-store',
            'Content-Length': bytes.length,
          });
          return res.end(bytes);
        } catch {
          return json(res, 404, { error: '图片尚未生成' });
        }
      }
      if (url.pathname === '/api/projects' && req.method === 'GET') {
        const names = (await readdir(storage)).filter((n) => /^[a-f0-9-]+\.json$/.test(n));
        const projects = [];
        for (const name of names) {
          try {
            const p = JSON.parse(await readFile(join(storage, name), 'utf8'));
            projects.push({
              id: p.id,
              name: p.name,
              width: p.width,
              height: p.height,
              revision: p.revision,
              updatedAt: p.updatedAt,
            });
          } catch {}
        }
        return json(res, 200, { projects: projects.sort((a, b) => b.updatedAt - a.updatedAt) });
      }
      const match = url.pathname.match(/^\/api\/projects\/([a-f0-9-]{36})$/);
      if (match) {
        const id = match[1],
          path = join(storage, id + '.json');
        if (req.method === 'GET') {
          try {
            return json(res, 200, JSON.parse(await readFile(path, 'utf8')));
          } catch (e) {
            if (e.code === 'ENOENT') return json(res, 404, { error: '工程不存在' });
            throw e;
          }
        }
        if (req.method === 'PUT') {
          if (!req.headers['content-type']?.startsWith('application/json'))
            return json(res, 415, { error: '需要 JSON 工程' });
          const chunks = [];
          let total = 0;
          for await (const chunk of req) {
            total += chunk.length;
            if (total > MAX) {
              json(res, 413, { error: '工程超过 64 MB，请导出工程文件保存' });
              req.resume();
              return;
            }
            chunks.push(chunk);
          }
          let p;
          try {
            p = JSON.parse(Buffer.concat(chunks).toString());
          } catch {
            return json(res, 400, { error: '工程不是有效 JSON' });
          }
          if (
            p.id !== id ||
            p.format !== 'retouch-lab' ||
            p.version !== 1 ||
            typeof p.name !== 'string' ||
            p.name.length > 200 ||
            !Number.isInteger(p.width) ||
            !Number.isInteger(p.height) ||
            p.width < 1 ||
            p.height < 1 ||
            p.width * p.height > 32e6 ||
            !Array.isArray(p.layers) ||
            p.layers.length < 1 ||
            p.layers.length > 100 ||
            !p.layers.every(
              (l) =>
                typeof l.name === 'string' &&
                typeof l.image === 'string' &&
                l.image.startsWith('data:image/png;base64,'),
            )
          )
            return json(res, 400, { error: '工程内容或尺寸无效' });
          return await serial(id, async () => {
            let old = null;
            try {
              old = JSON.parse(await readFile(path, 'utf8'));
            } catch (e) {
              if (e.code !== 'ENOENT') throw e;
            }
            if ((old?.revision ?? 0) !== (p.revision ?? 0))
              return json(res, 409, {
                error: '工程已被另一窗口修改，请先导出当前工程，再打开最新版本',
              });
            p.revision = (old?.revision ?? 0) + 1;
            p.updatedAt = Date.now();
            const tmp = path + '.' + randomUUID() + '.tmp';
            await writeFile(tmp, JSON.stringify(p), { mode: 0o600 });
            await rename(tmp, path);
            return json(res, 200, { revision: p.revision, updatedAt: p.updatedAt });
          });
        }
        return json(res, 405, { error: '不支持的操作' });
      }
      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: '接口不存在' });
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: '不支持的操作' });
      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        return json(res, 400, { error: '地址无效' });
      }
      const path = resolve(client, '.' + (pathname === '/' ? '/photo.html' : pathname));
      if (pathname.startsWith('/photocraft/')) res.setHeader('Access-Control-Allow-Origin', '*');
      if (!path.startsWith(client + sep)) return json(res, 403, { error: '路径不允许' });
      const compressed = pathname === '/photocraft/photocraft_bg.wasm';
      const diskPath = compressed ? path + '.gz' : path;
      const acceptsGzip = (req.headers['accept-encoding'] || '').split(',').some((entry) => {
        const [name, ...parameters] = entry.trim().toLowerCase().split(';');
        return (
          name === 'gzip' &&
          !parameters.some((parameter) => /^\s*q\s*=\s*0(?:\.0*)?\s*$/.test(parameter))
        );
      });
      let info;
      try {
        info = await stat(diskPath);
      } catch {
        return json(res, 404, { error: '文件不存在' });
      }
      if (!info.isFile()) return json(res, 404, { error: '文件不存在' });
      const etag =
        '"' +
        createHash('sha256')
          .update(String(info.size) + ':' + info.mtimeMs)
          .digest('hex')
          .slice(0, 20) +
        '"';
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'no-cache');
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304);
        return res.end();
      }
      if (compressed) res.setHeader('Vary', 'Accept-Encoding');
      if (compressed && acceptsGzip) res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Type', MIME[extname(path)] || 'application/octet-stream');
      if (!compressed || acceptsGzip) res.setHeader('Content-Length', info.size);
      res.writeHead(200);
      if (req.method === 'HEAD') return res.end();
      const stream = createReadStream(diskPath);
      stream.on('error', () => res.destroy());
      if (compressed && !acceptsGzip) {
        const decoder = createGunzip();
        decoder.on('error', () => res.destroy());
        stream.pipe(decoder).pipe(res);
      } else stream.pipe(res);
    } catch (error) {
      context.logger.error('retouch.request.failed', { code: error.code || 'unknown' });
      if (!res.headersSent) json(res, 500, { error: '保存或读取失败，请重试或导出工程文件' });
      else res.destroy();
    }
  });
  await new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(context.listen.port, context.listen.host, () => {
      server.off('error', fail);
      ok();
    });
  });
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    agent.close();
    editor.close();
    editor.code.close();
    context.signal.removeEventListener('abort', onAbort);
    await new Promise((ok, fail) => {
      server.close((e) => (e ? fail(e) : ok()));
      server.closeIdleConnections();
    });
  };
  const onAbort = () => void dispose();
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();
  context.logger.info('retouch.ready');
  return { dispose };
}
