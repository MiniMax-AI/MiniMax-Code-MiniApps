// AI 草稿插入路径的行尾保真：往 CRLF 稿子里插一段 AI 草稿，落盘仍是 CRLF。
//
// 跑法（包目录下）：
//   node --test tests/save-draft-eol.test.mjs
//
// 这份测试覆盖的是与段落保存（tests/save-fingerprint.test.mjs）**同源**的
// 另一条路：workbench/write.py::_draft_insertion 以前是硬编码 "\n" 拼草稿
// 块——往 CRLF 稿子里插 AI 草稿，落盘就是一段 LF 行，同一份稿子两种行尾
// 混着（实测：CRLF 稿子插完草稿，文件里同时有 CRLF 和 LF）。
//
// 它证明什么：
//   * 草稿块按**所在文件的主导行尾**落盘（CRLF 稿子插完还是 CRLF，
//     LF 稿子插完不会被改成 CRLF）；
//   * 草稿**正文**一个字不被改写（只改行尾）；
//   * 插进去的草稿块之外，原正文逐字节不变。
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

const BODY = '第一行草稿\n第二行草稿：口径不变';

let available = false;
let workspace = '';
let pristine = '';
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
  workspace = mkdtempSync(join(tmpdir(), 'factscribe-draft-eol-'));
  const paper = join(workspace, 'guide');
  cpSync(SAMPLE, paper, { recursive: true });
  // 原样留一份章节文件：每条用例都从它出发（用例之间不许互相留痕）。
  pristine = readFileSync(join(paper, 'sections', '01-intro.tex'), 'utf8');
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

/** 把章节文件写成给定的行尾，返回 {绝对路径, 写进去的原文}。 */
function rewriteSection(eol) {
  const file = join(workspace, 'guide', 'sections', '01-intro.tex');
  // 从**原样**那份写：上一条用例插进去的草稿块不许留在下一条里
  // （否则草稿 id 会顺延，测的就不是同一条路了）。
  const lf = pristine.replace(/\r\n/g, '\n');
  const written = eol === 'crlf' ? lf.replace(/\n/g, '\r\n') : lf;
  writeFileSync(file, written, 'utf8');
  return { file, written };
}

/** 草稿块在文件里的样子（与引擎 _draft_region 同一形状）。 */
function expectedRegion(marker, bodyLines, eol) {
  return [
    '% FACTSCRIBE-AI-DRAFT-BEGIN ' + marker,
    '\\begin{quote}',
    ...bodyLines,
    '\\end{quote}',
    '% FACTSCRIBE-AI-DRAFT-END ' + marker,
  ].join(eol);
}

async function pageModel() {
  const projects = await getJSON('/api/projects');
  const project = projects.projects[0];
  const disk = project.disks[0];
  const sections = await getJSON('/api/disk/' + project.id + '/' + disk.id + '/sections');
  const target = (sections.blocks || []).find((b) => b.kind === 'para' && /\n/.test(b.raw));
  assert.ok(target, '样例盘里得有正文段');
  const model = await getJSON('/api/disk/' + project.id + '/' + disk.id + '/block/' + encodeURIComponent(target.id));
  assert.ok(model.sha, '页面响应里得有这一段的指纹');
  return { project, disk, model };
}

/** 往那一段之后插一段 AI 草稿；返回 HTTP 状态与应答。 */
async function insertDraft(ctx, text) {
  const res = await fetch(base + '/api/disk/' + ctx.project.id + '/' + ctx.disk.id + '/draft/insert', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      file: ctx.model.file,
      block: ctx.model.id,
      text,
    }),
  });
  return { status: res.status, body: await res.json() };
}

test('CRLF 稿子插 AI 草稿：草稿块也是 CRLF，原正文逐字节不变', async (t) => {
  if (!available) {
    t.skip('这台机器上没有 Python ≥3.10，端到端跑不了');
    return;
  }
  const ctx0 = rewriteSection('crlf');
  const before = readFileSync(ctx0.file);
  assert.ok(before.includes(Buffer.from('\r\n')), '前置条件：文件本来就是 CRLF');

  const ctx = await pageModel();
  const saved = await insertDraft(ctx, BODY);
  assert.equal(saved.status, 200, '插入应当成功');
  assert.equal(saved.body.ok, true);

  const after = readFileSync(ctx0.file);
  const text = after.toString('utf8');
  assert.equal(/(?<!\r)\n/.test(text), false, '全文不该出现落单的 LF');

  const region = expectedRegion(saved.body.marker, BODY.split('\n'), '\r\n');
  const insertion = '\r\n' + region + '\r\n';
  assert.ok(text.includes(insertion), '草稿块必须以 CRLF 落盘');
  assert.equal(text.replace(insertion, ''), ctx0.written, '除草稿块外，原正文逐字节不变');
  assert.ok(text.includes('第一行草稿\r\n第二行草稿'), '草稿正文一字不差');
});

test('LF 稿子插 AI 草稿：不会被改成 CRLF', async (t) => {
  if (!available) {
    t.skip('这台机器上没有 Python ≥3.10，端到端跑不了');
    return;
  }
  const ctx0 = rewriteSection('lf');
  const before = readFileSync(ctx0.file);
  assert.equal(before.includes(Buffer.from('\r\n')), false, '前置条件：文件本来就是 LF');

  const ctx = await pageModel();
  const saved = await insertDraft(ctx, BODY);
  assert.equal(saved.status, 200, '插入应当成功');

  const after = readFileSync(ctx0.file);
  const text = after.toString('utf8');
  assert.equal(text.includes('\r\n'), false, 'LF 稿子不该出现 CRLF');
  const region = expectedRegion(saved.body.marker, BODY.split('\n'), '\n');
  const insertion = '\n' + region + '\n';
  assert.ok(text.includes(insertion), '草稿块必须以 LF 落盘');
  assert.equal(text.replace(insertion, ''), ctx0.written, '除草稿块外，原正文逐字节不变');
});
