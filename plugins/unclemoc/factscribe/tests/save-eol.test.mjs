// 保存路径的行尾保真：真引擎端到端（CRLF / LF / 混合三种稿子）。
//
// 跑法（包目录下）：
//   node --test tests/save-eol.test.mjs
//
// 这份测试要真的拉起随包的 Python 引擎（vendored 在 miniapp/node/engine/），
// 所以需要一台有 Python ≥3.10 的机器；没有就跳过（不假装通过）。
//
// 它证明什么：
//   * 引擎读文件用文本模式（CRLF→LF）、写文件用二进制写——不改这一层的话，
//     保存一次就把整篇的行尾变成 LF；
//   * Node 代理这一层在保存前后按原文件的行尾摆回去，CRLF 稿子存一次，
//     CRLF 一个不少地回来，内容一字不差。
//
// 写操作一律落在 /tmp 的样例盘副本上，不碰任何真实稿盘。

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { start } from '../miniapp/node/server.mjs';

// fileURLToPath：Windows 上 URL 的 pathname 是 /C:/...，不能直接当路径用。
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SAMPLE = join(PACKAGE_ROOT, 'miniapp/node/engine/factscribe/samples/guide');

let available = false;
let workspace = '';
let dataDir = '';
let base = '';
let dispose = null;

/** 这台机器上有 Python ≥3.10 吗（没有就跳过这份端到端测试）。 */
function pythonReady() {
  return new Promise((resolve) => {
    const candidates = ['python3', 'python'];
    let index = 0;
    const next = () => {
      if (index >= candidates.length) {
        resolve(false);
        return;
      }
      const command = candidates[index];
      index += 1;
      const child = spawn(command, ['-c', 'import sys; print(1 if sys.version_info >= (3, 10) else 0)'], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let out = '';
      child.stdout?.on('data', (chunk) => { out += String(chunk); });
      child.once('error', () => next());
      child.once('exit', () => { resolve(out.trim() === '1'); });
    };
    next();
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

async function getJSON(path) {
  const res = await fetch(base + path, { headers: { accept: 'application/json' } });
  assert.equal(res.status, 200, path + ' → HTTP ' + res.status);
  return res.json();
}

before(async () => {
  if (!(await pythonReady())) return;
  workspace = mkdtempSync(join(tmpdir(), 'factscribe-eol-'));
  const paper = join(workspace, 'guide');
  cpSync(SAMPLE, paper, { recursive: true });
  dataDir = join(workspace, 'data');
  mkdirSync(dataDir, { recursive: true });
  // 论文根 = workspace（引擎在它下面发现 guide 这个盘）。
  writeFileSync(join(dataDir, 'config.json'), JSON.stringify({ root: workspace }), 'utf8');
  const port = await freePort();
  const controller = new AbortController();
  const handle = await start({
    pluginRoot: PACKAGE_ROOT,
    dataDir,
    listen: { host: '127.0.0.1', port },
    logger: { info() {}, warn() {}, error() {} },
    signal: controller.signal,
  });
  dispose = handle.dispose;
  base = 'http://127.0.0.1:' + port;
  available = true;
});

after(async () => {
  if (dispose) await dispose();
  if (workspace) rmSync(workspace, { recursive: true, force: true });
});

/** 把盘里第一个章节文件写成给定的行尾，返回 {绝对路径, 原始LF内容}。 */
function rewriteSection(eol) {
  const projects = getJSON('/api/projects');
  return projects.then((data) => {
    const project = data.projects[0];
    const disk = project.disks[0];
    const file = join(workspace, 'guide', 'sections', '01-intro.tex');
    const lf = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const written = eol === 'crlf' ? lf.replace(/\n/g, '\r\n') : lf;
    writeFileSync(file, written, 'utf8');
    return { project, disk, file, lf };
  });
}

async function saveFirstBlock(ctx) {
  const sections = await getJSON('/api/disk/' + ctx.project.id + '/' + ctx.disk.id + '/sections');
  const block = (sections.blocks || [])[0];
  assert.ok(block, '样例盘里得有段');
  const model = await getJSON('/api/disk/' + ctx.project.id + '/' + ctx.disk.id + '/block/' + encodeURIComponent(block.id));
  const res = await fetch(base + '/api/disk/' + ctx.project.id + '/' + ctx.disk.id + '/edit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      file: model.file,
      block: model.id,
      text: model.plain,
      expect_sha: model.sha,
    }),
  });
  assert.equal(res.status, 200, '保存应当成功');
  const data = await res.json();
  assert.equal(data.ok, true);
  return data;
}

test('CRLF 稿子保存一次，CRLF 一个不少地回来，内容一字不差', async (t) => {
  if (!available) {
    t.skip('这台机器上没有 Python ≥3.10，端到端跑不了');
    return;
  }
  const ctx = await rewriteSection('crlf');
  const before = readFileSync(ctx.file);
  assert.ok(before.includes(Buffer.from('\r\n')), '前置条件：文件本来就是 CRLF');

  await saveFirstBlock(ctx);

  const after = readFileSync(ctx.file);
  assert.ok(after.includes(Buffer.from('\r\n')), '保存后仍然是 CRLF');
  assert.equal(
    (after.toString('utf8').match(/\r\n/g) || []).length,
    (ctx.lf.match(/\n/g) || []).length,
    'CRLF 的个数必须与原来一样多',
  );
  assert.equal(after.toString('utf8').replace(/\r\n/g, '\n'), ctx.lf, '内容一字不差');
});

test('LF 稿子保存一次，不会被改成 CRLF', async (t) => {
  if (!available) {
    t.skip('这台机器上没有 Python ≥3.10，端到端跑不了');
    return;
  }
  const ctx = await rewriteSection('lf');
  await saveFirstBlock(ctx);
  const after = readFileSync(ctx.file, 'utf8');
  assert.equal(after.includes('\r\n'), false, 'LF 稿子不该出现 CRLF');
  assert.equal(after, ctx.lf, '内容一字不差');
});

test('混合行尾的稿子，没被改到的行连原来的行尾都留着', async (t) => {
  if (!available) {
    t.skip('这台机器上没有 Python ≥3.10，端到端跑不了');
    return;
  }
  const ctx = await rewriteSection('lf');
  // 把第一行单独换成 CRLF，其余仍是 LF。
  const lines = ctx.lf.split('\n');
  const mixed = lines[0] + '\r\n' + lines.slice(1).join('\n');
  writeFileSync(ctx.file, mixed, 'utf8');

  await saveFirstBlock(ctx);

  const after = readFileSync(ctx.file, 'utf8');
  assert.ok(after.startsWith(lines[0] + '\r\n'), '第一行的 CRLF 留着');
  assert.equal((after.match(/(?<!\r)\n/g) || []).length > 0, true, '其余行仍是 LF');
  assert.equal(after.replace(/\r\n/g, '\n'), ctx.lf, '内容一字不差');
});
