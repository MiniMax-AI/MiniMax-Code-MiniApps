import fs from 'node:fs';
import path from 'node:path';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/**
 * fs.stat 在路径非法（比如含 null byte）时会同步抛错，
 * 那样异常会穿过请求处理冒到事件循环里，把进程带崩。
 * 这里统一收成回调错误，让调用方按普通 IO 失败处理。
 */
function safeStat(target, callback) {
  try {
    fs.stat(target, callback);
  } catch (err) {
    callback(err);
  }
}

function contentTypeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * 静态文件处理器：托管 dist/，找不到的路径回退到 index.html（SPA 路由）。
 * 带扩展名的路径不回退，避免把缺失的 JS 资源返回成 HTML。
 */
export function createStaticHandler(rootDir) {
  const root = path.resolve(rootDir);

  return function staticHandler(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://miniapp.local').pathname);
    } catch {
      return next();
    }

    // 路径里带 null byte 会让 fs 同步抛错，这里直接挡成 400
    if (pathname.includes('\0')) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('400 Bad Request');
      return;
    }

    if (pathname.endsWith('/')) pathname += 'index.html';

    const target = path.resolve(path.join(root, pathname));
    // 防目录穿越
    if (target !== root && !target.startsWith(root + path.sep)) return next();

    const send = (filePath, stat) => {
      res.writeHead(200, {
        'content-type': contentTypeFor(filePath),
        'content-length': stat.size,
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      let stream;
      try {
        stream = fs.createReadStream(filePath);
      } catch {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('500 Internal Server Error');
        return;
      }
      stream.on('error', () => {
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        }
        res.end('500 Internal Server Error');
      });
      stream.pipe(res);
    };

    safeStat(target, (err, stat) => {
      if (!err && stat.isFile()) {
        send(target, stat);
        return;
      }
      if (path.extname(pathname)) {
        next();
        return;
      }
      const indexPath = path.join(root, 'index.html');
      safeStat(indexPath, (indexErr, indexStat) => {
        if (indexErr || !indexStat.isFile()) {
          next();
          return;
        }
        send(indexPath, indexStat);
      });
    });
  };
}

