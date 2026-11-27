// 指纹与行尾的一致性：页面返回的段落指纹 → 用它保存多行 CRLF 正文 → 成功，
// 且保存后文件逐字节不变（CRLF 一个不少）。
//
// 跑法（包目录下）：
//   node --test tests/save-fingerprint.test.mjs
//
// 这份测试覆盖的是上游 review 点名的**完整链路**：
//   1. 打开一个正文是多行 CRLF 的文档；
//   2. 从**页面响应**里取出那一段的指纹（sha）与散文（plain）；
//   3. 用这个指纹去保存 → 必须成功（口径不一致时必然 409 BLOCK_STALE）；
//   4. 保存后的文件仍是 CRLF，且与保存前逐字节相同。
//
// 三条用例：CRLF 多行正文、LF 正文（不被改成 CRLF）、CRLF 文件但客户端
// 按浏览器口径发 LF 正文（存回去仍是 CRLF）。
//
// 写操作一律落在 /tmp 的样例盘副本上，不碰任何真实稿盘。

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

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
  workspace = mkdtempSync(join(tmpdir(), 'factscribe-fp-'));
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

/** 把章节文件写成给定的行尾，返回 {绝对路径, 原始 LF 内容}。 */
function rewriteSection(eol) {
  const file = join(workspace, 'guide', 'sections', '01-intro.tex');
  const lf = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const written = eol === 'crlf' ? lf.replace(/\n/g, '\r\n') : lf;
  writeFileSync(file, written, 'utf8');
  return { file, lf };
}

/** 打开盘 → 找到那一段**多行**正文段 → 从页面响应里取出它的指纹与散文。 */
async function pageModel() {
  const projects = await getJSON('/api/projects');
  const project = projects.projects[0];
  const disk = project.disks[0];
  const sections = await getJSON('/api/disk/' + project.id + '/' + disk.id + '/sections');
  const target = (sections.blocks || []).find((b) => b.kind === 'para' && /\n/.test(b.raw));
  assert.ok(target, '样例盘里得多行的正文段');
  const model = await getJSON('/api/disk/' + project.id + '/' + disk.id + '/block/' + encodeURIComponent(target.id));
  assert.ok(model.sha, '页面响应里得有这一段的指纹');
  return { project, disk, model };
}

/** 用**页面给的指纹**保存那一段；返回应答与 HTTP 状态。 */
async function saveWithPageFingerprint(ctx, text) {
  const res = await fetch(base + '/api/disk/' + ctx.project.id + '/' + ctx.disk.id + '/edit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      file: ctx.model.file,
      block: ctx.model.id,
      text,
      expect_sha: ctx.model.sha,
    }),
  });
  return { status: res.status, body: await res.json() };
}

test('CRLF 多行正文：用页面给的指纹存得回去，文件逐字节不变', async (t) => {
  if (!available) {
    t.skip('这台机器上没有 Python ≥3.10，端到端跑不了');
    return;
  }
  const ctx0 = rewriteSection('crlf');
  const before = readFileSync(ctx0.file);
  assert.ok(before.includes(Buffer.from('\r\n')), '前置条件：文件本来就是 CRLF');

  const ctx = await pageModel();
  assert.ok(/\r\n/.test(ctx.model.raw), '页面给的原文也是 CRLF 口径');

  const saved = await saveWithPageFingerprint(ctx, ctx.model.plain);
  assert.equal(saved.status, 200, '保存应当成功（指纹口径不一致时是 409）');
  assert.equal(saved.body.ok, true);

  const after = readFileSync(ctx0.file);
  assert.ok(after.includes(Buffer.from('\r\n')), '保存后仍然是 CRLF');
  assert.equal(after.equals(before), true, '保存后的文件必须与保存前逐字节相同');
});

test('LF 多行正文：用页面给的指纹存得回去，不会被改成 CRLF', async (t) => {
  if (!available) {
    t.skip('这台机器上没有 Python ≥3.10，端到端跑不了');
    return;
  }
  const ctx0 = rewriteSection('lf');
  const before = readFileSync(ctx0.file);
  assert.equal(before.includes(Buffer.from('\r\n')), false, '前置条件：文件本来就是 LF');

  const ctx = await pageModel();
  const saved = await saveWithPageFingerprint(ctx, ctx.model.plain);
  assert.equal(saved.status, 200, '保存应当成功');
  assert.equal(saved.body.ok, true);

  const after = readFileSync(ctx0.file);
  assert.equal(after.includes(Buffer.from('\r\n')), false, 'LF 稿子不该出现 CRLF');
  assert.equal(after.equals(before), true, '保存后的文件必须与保存前逐字节相同');
});

test('CRLF 文件 + 客户端发 LF 正文（浏览器口径）：存回去仍是 CRLF', async (t) => {
  if (!available) {
    t.skip('这台机器上没有 Python ≥3.10，端到端跑不了');
    return;
  }
  const ctx0 = rewriteSection('crlf');
  const before = readFileSync(ctx0.file);

  const ctx = await pageModel();
  // 浏览器 contenteditable 的 textContent 恒是 LF——正文一律这么发。
  const clientText = ctx.model.plain.replace(/\r\n/g, '\n');
  const saved = await saveWithPageFingerprint(ctx, clientText);
  assert.equal(saved.status, 200, '保存应当成功');
  assert.equal(saved.body.ok, true);

  const after = readFileSync(ctx0.file);
  assert.ok(after.includes(Buffer.from('\r\n')), '保存后仍然是 CRLF');
  assert.equal(after.equals(before), true, '保存后的文件必须与保存前逐字节相同');
});
