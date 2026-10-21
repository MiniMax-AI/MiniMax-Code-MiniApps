/**
 * 服务发现的回归测试。
 *
 * 背景：`discoverOnce()` 扫插件服务注册表 `~/.mcode-dynamic-workflows/projects`，
 * 该目录只有在上游插件跑过一次之后才会存在。全新机器上 `readdir` 直接抛错，
 * 旧实现在 catch 里提前 `return`——而注册内置引擎的代码在这行之后，被整段跳过，
 * 于是 `/api/bootstrap` 返回 `services: []`，控制台一直显示
 * 「未发现任何 Workflow Studio 项目服务」，即使内置引擎已经正常起来。
 *
 * 这个 bug 只在「没装过上游插件」的机器上出现：
 * 写这版代码的机器上恰好有那个目录，catch 分支从没被执行过。
 *
 * 运行：
 *   node --test tests/
 *   WC_PACKAGE_ROOT=<活的包目录> node --test tests/
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

const realHome = homedir();

async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/**
 * 起一个控制台实例，读一次 /api/bootstrap，然后把环境还原。
 * @param {{home: string, dataDir: string, cwd?: string}} options
 * @param {(body: {services: Array<{id: string}>, activeServiceId: string | null}) => void} check
 */
async function withConsole(options, check) {
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, cwd: process.cwd() };
  const controller = new AbortController();
  try {
    process.env.HOME = options.home;
    process.env.USERPROFILE = options.home;
    if (options.cwd) process.chdir(options.cwd);

    const port = await freePort();
    const lifecycle = await start({
      pluginId: 'workflow-console',
      pluginRoot: packageRoot,
      dataDir: options.dataDir,
      listen: { host: '127.0.0.1', port },
      signal: controller.signal,
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/bootstrap`);
      check(await response.json());
    } finally {
      await lifecycle.dispose();
    }
  } finally {
    process.chdir(saved.cwd);
    if (saved.HOME === undefined) delete process.env.HOME;
    else process.env.HOME = saved.HOME;
    if (saved.USERPROFILE === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = saved.USERPROFILE;
  }
}

/** 造一套干净环境：假主目录、假数据目录、一个真实存在的「项目」目录。 */
async function makeSandbox(tag) {
  const root = await mkdtemp(join(tmpdir(), `wc-${tag}-`));
  const home = join(root, 'home');
  const dataDir = join(root, 'data');
  const project = join(realHome, `.wc-test-project-${tag}`);
  await mkdir(home, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await mkdir(project, { recursive: true });
  return {
    root,
    home,
    dataDir,
    project,
    async cleanup() {
      await rm(root, { recursive: true, force: true });
      await rm(project, { recursive: true, force: true });
    },
  };
}

test('插件服务目录不存在时，内置引擎仍然会进服务列表', async () => {
  const box = await makeSandbox('no-registry');
  try {
    /* 故意不建 ~/.mcode-dynamic-workflows/projects：模拟从没装过上游插件的新机器。 */
    await withConsole({ home: box.home, dataDir: box.dataDir, cwd: box.project }, (body) => {
      const ids = Array.isArray(body.services) ? body.services.map((service) => service.id) : [];
      assert.ok(ids.includes('embedded'), `服务列表里必须有内置引擎，实际是 ${JSON.stringify(ids)}`);
    });
  } finally {
    await box.cleanup();
  }
});

test('插件服务目录不存在时，默认选中的仍然是内置引擎', async () => {
  const box = await makeSandbox('no-registry-active');
  try {
    await withConsole({ home: box.home, dataDir: box.dataDir, cwd: box.project }, (body) => {
      assert.equal(body.activeServiceId, 'embedded', '默认服务应该是内置引擎');
    });
  } finally {
    await box.cleanup();
  }
});

test('插件服务目录存在时，内置引擎不会被插件服务挤掉', async () => {
  const box = await makeSandbox('with-registry');
  try {
    const registry = join(box.home, '.mcode-dynamic-workflows', 'projects', 'c'.repeat(64));
    await mkdir(registry, { recursive: true });
    /* 指向一个没人监听的端口：这个插件服务是离线的，但它仍应出现在列表里。 */
    await writeFile(
      join(registry, 'address.json'),
      JSON.stringify({ url: 'http://127.0.0.1:9335/', workspace: box.project }),
      'utf8',
    );
    await withConsole({ home: box.home, dataDir: box.dataDir, cwd: box.project }, (body) => {
      const ids = Array.isArray(body.services) ? body.services.map((service) => service.id) : [];
      assert.ok(ids.includes('embedded'), `服务列表里必须有内置引擎，实际是 ${JSON.stringify(ids)}`);
      assert.ok(ids.includes('cccccccccccc'), `离线插件服务也应在列表里，实际是 ${JSON.stringify(ids)}`);
    });
  } finally {
    await box.cleanup();
  }
});
