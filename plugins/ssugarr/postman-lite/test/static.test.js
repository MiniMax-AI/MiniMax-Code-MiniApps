import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { createStaticHandler } from '../server/static.js';

function startStatic(rootDir) {
  const handler = createStaticHandler(rootDir);
  const server = http.createServer((req, res) => {
    handler(req, res, () => {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

test('static：路径含 null byte 返回 400，服务器不受影响', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-static-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>ok</title>');
  const { server, port } = await startStatic(dir);
  try {
    // fs.stat 在这种路径上会同步抛错；handler 必须自己挡成 400，而不是让进程崩掉
    const res = await fetch(`http://127.0.0.1:${port}/%00`);
    assert.equal(res.status, 400);

    // 服务器仍然活着
    const alive = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(alive.status, 200);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('static：目录穿越被挡在 root 之外', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-static-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>ok</title>');
  const { server, port } = await startStatic(dir);
  try {
    // URL 会把 %2e%2e 当成 .. 规范化掉，但 %2f 不是分隔符、不会被规范化；
    // handler 里的 decodeURIComponent 会把它还原成 /，这才是真正能触发越界的路径
    const res = await fetch(`http://127.0.0.1:${port}/%2e%2e%2f%2e%2e%2fetc/passwd`);
    assert.notEqual(res.status, 200);
    // 服务器仍然活着
    const alive = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(alive.status, 200);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});



