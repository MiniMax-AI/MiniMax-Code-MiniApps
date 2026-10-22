/**
 * 后端隔离的回归测试。
 *
 * 控制台过去会去扫 `~/.mcode-dynamic-workflows/projects/<hash>/address.json`，
 * 把另一个插件（mcode-dynamic-workflows）登记的服务地址和访问令牌拿出来用。
 * 那是那个插件的数据和凭证，不该被本应用碰；控制台自带引擎，本来也不需要它。
 *
 * 这个测试用两个手段钉住现状：
 *   1. 在假主目录里造一份别的插件的登记簿，指向一个**真的会记账的**本地服务；
 *   2. 断言那个服务一次请求都没收到——令牌既没被读走，也没被用上。
 *
 * 另外保留一条老回归：全新机器上没有那个插件目录时，
 * 控制台的服务列表不能是空的（早先在这里提前 return，内置引擎整个没进列表）。
 *
 * 运行：
 *   node --test tests/
 *   WC_PACKAGE_ROOT=<活的包目录> node --test tests/
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createSocket } from 'node:net';
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
  const probe = createSocket();
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

test('没有上游插件目录时，服务列表里仍有内置引擎', async () => {
  const box = await makeSandbox('no-registry');
  try {
    /* 故意不建 ~/.mcode-dynamic-workflows/projects：模拟从没装过上游插件的新机器。 */
    await withConsole({ home: box.home, dataDir: box.dataDir, cwd: box.project }, (body) => {
      const ids = Array.isArray(body.services) ? body.services.map((service) => service.id) : [];
      assert.ok(ids.includes('embedded'), `服务列表里必须有内置引擎，实际是 ${JSON.stringify(ids)}`);
      assert.equal(body.activeServiceId, 'embedded', '默认后端应该是内置引擎');
    });
  } finally {
    await box.cleanup();
  }
});

test('不会去连别的插件登记的服务，也不会用它的令牌', async () => {
  const box = await makeSandbox('foreign-service');
  /** 记账用的假服务：只要它收到一次请求，测试就失败。 */
  const hits = [];
  const foreign = createServer((req, res) => {
    hits.push(`${req.method} ${req.url} auth=${req.headers.authorization ?? '-'}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ workspace: box.project, pid: 1 }));
  });
  await new Promise((resolve) => foreign.listen(0, '127.0.0.1', resolve));
  const foreignPort = foreign.address().port;

  try {
    /* 造一份别的插件的登记簿：地址里带着它的访问令牌。 */
    const registry = join(box.home, '.mcode-dynamic-workflows', 'projects', 'd'.repeat(64));
    await mkdir(registry, { recursive: true });
    await writeFile(
      join(registry, 'address.json'),
      JSON.stringify({
        url: `http://127.0.0.1:${foreignPort}/#foreign-token`,
        workspace: box.project,
      }),
      'utf8',
    );
    await writeFile(
      join(registry, 'endpoint.json'),
      JSON.stringify({
        url: `http://127.0.0.1:${foreignPort}/#foreign-token`,
        workspace: box.project,
        pid: 4242,
      }),
      'utf8',
    );

    await withConsole({ home: box.home, dataDir: box.dataDir, cwd: box.project }, (body) => {
      const ids = Array.isArray(body.services) ? body.services.map((service) => service.id) : [];
      assert.deepEqual(ids, ['embedded'], '别的插件的服务不该出现在服务列表里');
      assert.equal(body.activeServiceId, 'embedded');
    });

    assert.deepEqual(
      hits,
      [],
      `不该向别的插件的服务发请求，实际收到了 ${JSON.stringify(hits)}`,
    );
  } finally {
    await new Promise((resolve) => foreign.close(resolve));
    await box.cleanup();
  }
});
