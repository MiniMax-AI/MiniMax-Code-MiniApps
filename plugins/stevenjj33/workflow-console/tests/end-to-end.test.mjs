/**
 * 端到端冒烟：真的把内置引擎拉起来，跑完一次运行，再逐个检查各个状态。
 *
 * 这个测试覆盖的是单元测试碰不到的那一半：进程真的起来了、HTTP 接口真的通、
 * 审核/执行/报告/隐藏/换目录这些动作真的生效。
 *
 * 它用 `demo` 执行器——不调用任何模型，也不需要本机装有 mcode CLI。
 * 跑测试时会在系统临时目录里造一个沙箱项目目录和一个沙箱 dataDir，
 * 不会碰任何真实项目。
 *
 * 运行：
 *   node --test tests/end-to-end.test.mjs
 *   WC_PACKAGE_ROOT=<活的包目录> node --test tests/end-to-end.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * 定位被测的包根目录。
 * 两种布局都要能用：
 *   - 交接包布局：<repo>/tests/ 与 <repo>/miniapps/workflow-console/ 平级
 *   - 插件包布局：<plugin>/tests/ 与 <plugin>/miniapp/ 平级（社区仓库 plugins/<user>/<id>/）
 * 也可以用环境变量 WC_PACKAGE_ROOT 显式指定。
 */
function defaultPackageRoot() {
  const candidates = [
    fileURLToPath(new URL('../miniapps/workflow-console', import.meta.url)),
    fileURLToPath(new URL('..', import.meta.url)),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'miniapp', 'node', 'server.mjs'))) return resolve(candidate);
  }
  return resolve(candidates[0]);
}

const packageRoot = resolve(process.env.WC_PACKAGE_ROOT || defaultPackageRoot());
const { start } = await import(pathToFileURL(join(packageRoot, 'miniapp', 'node', 'server.mjs')).href);

const TERMINAL = new Set([
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
  'needs_attention',
  'completed_with_gaps',
]);

async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/** 一个只跑 demo 执行器的最小工作流。 */
const DEMO_SCRIPT = [
  "await ctx.phase({id:'p1',label:'第一阶段'});",
  "const a=await ctx.agent({id:'n1',label:'唯一节点',phase:'p1',",
  " prompt:'这是一个冒烟测试。不要调用任何工具，不要读写文件。',input:{x:1}});",
  "if(a.status!=='succeeded')throw Error(a.error);",
  "return {out:a.output};",
].join('\n');

test('内置引擎的完整生命周期', { timeout: 180_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'wc-e2e-'));
  const dataDir = join(root, 'data');
  const project = join(root, 'project');
  const project2 = join(root, 'project2');
  await mkdir(dataDir, { recursive: true });
  await mkdir(project, { recursive: true });
  await mkdir(project2, { recursive: true });

  const controller = new AbortController();
  const port = await freePort();
  const lifecycle = await start({
    pluginId: 'workflow-console',
    pluginRoot: packageRoot,
    dataDir,
    listen: { host: '127.0.0.1', port },
    signal: controller.signal,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  const base = `http://127.0.0.1:${port}`;
  const get = async (p) => (await fetch(base + p)).json();
  const post = async (p, body) => {
    const response = await fetch(base + p, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    return { status: response.status, body: await response.json() };
  };

  try {
    /* 1. 没有项目目录：引擎不该启动，控制台要提示用户选目录。 */
    let boot = await get('/api/bootstrap');
    assert.equal(boot.services.length, 1);
    assert.equal(boot.services[0].id, 'embedded');
    assert.equal(boot.services[0].live, false, '没有项目目录时引擎必须没启动');
    assert.equal(boot.services[0].needsWorkspace, true);
    assert.equal(boot.services[0].workspace, null);
    assert.equal(boot.offline, true);
    assert.deepEqual(boot.runs, []);

    const workspace = await get('/api/workspace');
    assert.equal(workspace.workspace, null);
    assert.equal(workspace.source, 'unset');

    /* 2. 填一个项目目录，引擎应当起来。 */
    const set = await post('/api/workspace', { workspace: project });
    assert.equal(set.status, 200);
    assert.equal(set.body.workspace, project);

    const ready = Date.now() + 60_000;
    let live = false;
    while (Date.now() < ready) {
      boot = await get('/api/bootstrap');
      if (boot.services[0].live) {
        live = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    assert.ok(live, '内置引擎应该在 60 秒内就绪');
    assert.equal(boot.services[0].workspace, project);
    assert.equal(boot.services[0].needsWorkspace, false);
    assert.equal(boot.offline, false);

    /* 3. 建一个 demo 运行。控制台本身不创建运行——运行由对话里的 Agent 创建，
          这里直接向引擎提交，模拟那个过程。 */
    const address = JSON.parse(await readFile(join(dataDir, 'engine', 'address.json'), 'utf8'));
    const engineBase = new URL('/', address.url).origin;
    const created = await fetch(`${engineBase}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workflow-Client': '1' },
      body: JSON.stringify({
        requestId: `e2e-${Date.now()}`,
        name: 'E2E 冒烟运行',
        script: DEMO_SCRIPT,
        input: {},
        executor: 'demo',
      }),
    });
    const run = await created.json();
    assert.equal(created.status, 201);
    assert.equal(run.status, 'pending_review');

    /* 4. 控制台能看到它，并且画得出流程图。 */
    boot = await get('/api/bootstrap');
    assert.equal(boot.runs.length, 1);
    assert.equal(boot.runs[0].id, run.id);

    const detail = await get(`/api/runs/${run.id}`);
    assert.ok(detail.graph.phases.length >= 1);
    assert.ok(detail.graph.nodes.length >= 1);
    assert.ok(detail.planGraph.nodes.length >= 1);

    /* 5. 审核：版本号不对必须被拒。 */
    const stale = await post(`/api/runs/${run.id}/approve`, { revision: run.revision + 999 });
    assert.equal(stale.status, 409);

    const approve = await post(`/api/runs/${run.id}/approve`, { revision: run.revision });
    assert.equal(approve.status, 200);

    /* 6. 跑到终态。 */
    const finished = Date.now() + 120_000;
    let final = null;
    while (Date.now() < finished) {
      const snapshot = await get(`/api/runs/${run.id}`);
      if (TERMINAL.has(snapshot.status)) {
        final = snapshot;
        break;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    assert.ok(final, '运行应该在 120 秒内到达终态');
    assert.equal(final.status, 'succeeded', `运行应成功，实际 ${final.status} / ${final.error}`);

    /* 7. 报告能导出。 */
    const report = await fetch(`${base}/api/runs/${run.id}/report?format=md&language=zh`);
    assert.equal(report.status, 200);
    assert.ok((await report.text()).length > 50, '报告应该有内容');

    /* 8. 隐藏与恢复。 */
    await post(`/api/runs/${run.id}/hide`);
    boot = await get('/api/bootstrap');
    assert.equal(boot.runs.length, 0, '隐藏后列表里不该有这条运行');
    await post(`/api/runs/${run.id}/unhide`);
    boot = await get('/api/bootstrap');
    assert.equal(boot.runs.length, 1, '恢复后这条运行该回来');

    /* 9. 换项目目录 → 引擎重启。 */
    const switched = await post('/api/workspace', { workspace: project2 });
    assert.equal(switched.status, 200);
    assert.equal(switched.body.restarted, true, '引擎之前是活的，应该报告 restarted');
    const moved = Date.now() + 60_000;
    let after = null;
    while (Date.now() < moved) {
      after = await get('/api/workspace');
      if (after.workspace === project2) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    assert.equal(after.workspace, project2);

    /* 10. 不该被接受的工作目录。 */
    const missing = await post('/api/workspace', { workspace: join(root, 'nope') });
    assert.equal(missing.status, 400);
    const home = await post('/api/workspace', { workspace: homedir() });
    assert.equal(home.status, 400, '家目录不能被当成项目目录');
    const relative = await post('/api/workspace', { workspace: 'relative/path' });
    assert.equal(relative.status, 400);
  } finally {
    await lifecycle.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
