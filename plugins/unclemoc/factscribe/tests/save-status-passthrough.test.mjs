// 发布源（根 miniapp/ 薄壳）的状态码透传：上游判定码必须原样回传。
//
// 这一份验的是**对外发布的那个包**——根目录 miniapp/（上游社区包
// plugins/unclemoc/factscribe 的 plugin.json 指向本仓根 miniapp/，
// 里面含 miniapp/node/server.mjs 与 miniapp/client/）。
// integrations/minifactscribe/ 是第三方件 MiniFactScribe，不是发布源。
//
// 薄壳的 /api/* 走 proxyApi：response.writeHead(res.statusCode) ＋ res.pipe(response)
// ——字节级反向代理。所以引擎的判定码与错误体本就该原样到页面。
// 这份测试就是把这件事钉死，免得哪天有人给 proxyApi 包一层而悄悄压掉状态码。
//
// 覆盖：
//   1. 保存路径 POST /api/disk/{p}/{d}/edit ——引擎拒写（指纹过期）→ 409；
//   2. 保存路径 ——参数不对 → 400；
//   3. 保存路径 ——盘不存在 → 404；
//   4. 只读路径 GET  /api/disk/{p}/{d}/sections ——盘不存在 → 404（不只保存路径）；
//   5. 保存路径成功 → 200，成功体形状不变；
//   6. 只读路径成功 → 200，成功体形状不变；
//   7. 错误体是**引擎的**原样（机器码 BLOCK_STALE 在手，不是薄壳自造的 502）。
//
// 引擎侧不改一个字节——这里只测「代理有没有把码改掉」。
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

/** 走薄壳，回 {status, body, raw}。 */
async function call(path, options = {}) {
  const res = await fetch(base + path, {
    headers: { accept: 'application/json' },
    ...options,
  });
  const raw = await res.text();
  let body = null;
  try { body = JSON.parse(raw); } catch { body = null; }
  return { status: res.status, body, raw };
}

before(async () => {
  if (!(await pythonReady())) return;
  workspace = mkdtempSync(join(tmpdir(), 'factscribe-passthrough-'));
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

/** 打开盘 → 找一段正文 → 从**页面响应**里取出它的指纹与散文。 */
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

/** 保存路径。 */
async function edit(ctx, body, diskId) {
  const disk = diskId === undefined ? ctx.disk.id : diskId;
  return call('/api/disk/' + ctx.project.id + '/' + disk + '/edit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
}

test('发布源·保存路径：引擎拒写（指纹过期）→ 薄壳原样回 409，机器码也带回来', async (t) => {
  if (!available) {
    t.skip('这台机器上没有 Python ≥3.10，端到端跑不了');
    return;
  }
  const ctx = await pageModel();
  const file = join(workspace, 'guide', ctx.model.file);
  const before = readFileSync(file);

  const res = await edit(ctx, {
    file: ctx.model.file,
    block: ctx.model.id,
    text: ctx.model.plain,
    expect_sha: 'stale-sha-not-matching-anything',
  });

  assert.equal(res.status, 409,
    '引擎的 409 必须原样回传（薄壳不许把它改成 200 或 502）');
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'BLOCK_STALE',
    '机器码 BLOCK_STALE 必须一起带回来');
  assert.ok(typeof res.body.error === 'string' && res.body.error.length > 0,
    '错误说明要带回来');
  // 拒写时磁盘上的正文一个字都不许动。
  assert.equal(readFileSync(file).equals(before), true, '拒写时文件必须逐字节不变');
});

test('发布源·保存路径：参数不对 → 薄壳原样回 400', async (t) => {
  if (!available) {
    t.skip('这台机器上没有 Python ≥3.10，端到端跑不了');
    return;
  }
  const ctx = await pageModel();

  const res = await edit(ctx, {
    file: ctx.model.file,
    block: ctx.model.id,
    // text 故意不给：引擎 workbench/server.py 判 400「block / text 都要给」。
  });

  assert.equal(res.status, 400, '引擎的 400 必须原样回传');
  assert.equal(res.body.ok, false);
  assert.match(String(res.body.error), /block|text/);
});

test('发布源·保存路径：盘不存在 → 薄壳原样回 404', async (t) => {
  if (!available) {
    t.skip('这台机器上没有 Python ≥3.10，端到端跑不了');
    return;
  }
  const ctx = await pageModel();

  const res = await edit(ctx, {
    file: 'sections/01-intro.tex',
    block: 'whatever',
    text: 'x',
  }, 'no-such-disk');

  assert.equal(res.status, 404, '引擎的 404 必须原样回传');
  assert.equal(res.body.ok, false);
  assert.match(String(res.body.error), /没有这个盘/);
});

test('发布源·只读路径：盘不存在 → 薄壳原样回 404（不只保存路径）', async (t) => {
  if (!available) {
    t.skip('这台机器上没有 Python ≥3.10，端到端跑不了');
    return;
  }
  const ctx = await pageModel();

  const res = await call('/api/disk/' + ctx.project.id + '/no-such-disk/sections');

  assert.equal(res.status, 404, '引擎的 404 必须原样回传');
  assert.equal(res.body.ok, false);
  assert.match(String(res.body.error), /没有这个盘/);
});

test('发布源·保存路径成功 → 薄壳回 200，成功体形状不变', async (t) => {
  if (!available) {
    t.skip('这台机器上没有 Python ≥3.10，端到端跑不了');
    return;
  }
  const ctx = await pageModel();

  const res = await edit(ctx, {
    file: ctx.model.file,
    block: ctx.model.id,
    text: ctx.model.plain,
    expect_sha: ctx.model.sha,
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  // 成功体形状：引擎回的是 {ok, file, block, html, blocks, ...}，薄壳不许改。
  assert.equal(res.body.block, ctx.model.id);
  assert.equal(typeof res.body.html, 'string');
  assert.equal(typeof res.body.blocks, 'object');
});

test('发布源·只读路径成功 → 薄壳回 200，成功体形状不变', async (t) => {
  if (!available) {
    t.skip('这台机器上没有 Python ≥3.10，端到端跑不了');
    return;
  }
  const ctx = await pageModel();

  const res = await call('/api/disk/' + ctx.project.id + '/' + ctx.disk.id + '/sections');

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.project, ctx.project.id);
  assert.equal(res.body.disk, ctx.disk.id);
  assert.equal(Array.isArray(res.body.blocks), true);
});

test('发布源·只读路径：段不存在时机器码在 body 里，薄壳原样带回来（不压成 502）', async (t) => {
  if (!available) {
    t.skip('这台机器上没有 Python ≥3.10，端到端跑不了');
    return;
  }
  const ctx = await pageModel();

  const res = await call('/api/disk/' + ctx.project.id + '/' + ctx.disk.id
    + '/block/' + encodeURIComponent('no-such-block'));

  // 引擎 workbench/server.py 的 _block_model 对「没有这一段」是 HTTP 200 ＋
  // body 里带 ok:false 与 code:404（机器码在 body 里，不在状态码上）。
  // 薄壳的职责是原样转发——机器码必须活着，不许被压成 502。
  assert.notEqual(res.status, 502,
    '不许把引擎 body 里的机器码压成传输层 502');
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 404, 'body 里的机器码 404 必须活着');
  assert.match(String(res.body.error), /没有这一段/);
});

test('发布源·错误体是引擎的原样，不是薄壳自造的壳', async (t) => {
  if (!available) {
    t.skip('这台机器上没有 Python ≥3.10，端到端跑不了');
    return;
  }
  const ctx = await pageModel();

  const res = await edit(ctx, {
    file: ctx.model.file,
    block: ctx.model.id,
    text: ctx.model.plain,
    expect_sha: 'stale-sha-not-matching-anything',
  });

  // 引擎的错误信封是 {ok:false, error:"…", code:"BLOCK_STALE", block, blocks}。
  // 薄壳自造的壳是 {ok:false, error:"…", code:502}——不能是那个。
  assert.equal(res.status, 409);
  assert.notEqual(res.body.code, 502, '不许是薄壳自造的 502 壳');
  assert.equal(res.body.code, 'BLOCK_STALE');
  assert.equal(typeof res.body.blocks, 'object',
    '引擎随 409 附带的同文件新鲜渲染也要原样带回来');
});
