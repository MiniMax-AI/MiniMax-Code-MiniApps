/**
 * 内置引擎工作目录解析的回归测试。
 *
 * 这里锁住两条硬规则：
 *
 *   1. **不猜、不兜底。** 没有任何可信来源时，工作目录是 `null`，
 *      引擎根本不启动。早先的实现会退到用户主目录——那等于允许一次运行
 *      改写整个家目录；也会采用宿主投放出来的临时目录，那不是项目。
 *      现在唯一的两个来源是：宿主用环境变量声明的当前项目，
 *      以及用户在控制台顶栏里填的绝对路径。
 *
 *   2. **不碰另一个插件的数据。** `~/.mcode-dynamic-workflows/projects`
 *      属于 `mcode-dynamic-workflows` 插件，登记簿里还存着它的服务令牌。
 *      控制台既不读它的工作目录，也不把它当成服务来源。
 *
 * 运行：
 *   node --test tests/
 *   WC_PACKAGE_ROOT=<活的包目录> node --test tests/     # 测工作区里那一份
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

/* 真实主目录在任何平台都不是临时目录，拿它当「真实项目」的替身最稳。 */
const realHome = homedir();
/** 宿主可能用这些环境变量表达当前项目目录。 */
const WORKSPACE_ENV_KEYS = ['MCODE_WORKSPACE', 'MCODE_PROJECT_DIR', 'PROJECT_DIR', 'WORKSPACE'];

async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/**
 * 起一个控制台实例，读一次工作目录和一次 bootstrap，然后把环境还原。
 * @param {{home: string, dataDir: string, cwd?: string, env?: Record<string, string>}} options
 * @param {(result: {workspace: {workspace: string | null, source: string}, bootstrap: any}) => void} check
 */
async function withConsole(options, check) {
  const saved = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    cwd: process.cwd(),
  };
  const controller = new AbortController();
  try {
    process.env.HOME = options.home;
    process.env.USERPROFILE = options.home;
    for (const key of WORKSPACE_ENV_KEYS) delete process.env[key];
    for (const [key, value] of Object.entries(options.env || {})) process.env[key] = value;
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
      const workspace = await (await fetch(`http://127.0.0.1:${port}/api/workspace`)).json();
      const bootstrap = await (await fetch(`http://127.0.0.1:${port}/api/bootstrap`)).json();
      check({ workspace, bootstrap });
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

test('没有任何线索时不猜目录，工作目录为空', async () => {
  const box = await makeSandbox('unset');
  try {
    await withConsole({ home: box.home, dataDir: box.dataDir, cwd: box.project }, ({ workspace }) => {
      assert.equal(workspace.workspace, null, '没有可信来源时不应返回任何目录');
      assert.equal(workspace.source, 'unset');
    });
  } finally {
    await box.cleanup();
  }
});

test('没有项目目录时内置引擎不启动', async () => {
  const box = await makeSandbox('no-engine');
  try {
    await withConsole({ home: box.home, dataDir: box.dataDir, cwd: box.project }, ({ bootstrap }) => {
      const services = Array.isArray(bootstrap.services) ? bootstrap.services : [];
      assert.equal(services.length, 1, '服务列表里只有内置引擎');
      assert.equal(services[0].id, 'embedded');
      assert.equal(services[0].live, false, '没有项目目录时引擎不该被拉起来');
      assert.equal(services[0].needsWorkspace, true, '前端需要知道在等用户填目录');
      assert.ok(
        services[0].workspace === null || services[0].workspace === undefined,
        '引擎不能被绑到任何目录上',
      );
    });
    /* 引擎目录都没建，说明进程压根没起来。 */
    assert.equal(
      existsSync(join(box.dataDir, 'engine')),
      false,
      '没有项目目录时不应创建引擎数据目录',
    );
  } finally {
    await box.cleanup();
  }
});

test('宿主投放的临时目录不会被选成工作目录', async () => {
  const box = await makeSandbox('deploy');
  try {
    /* 模拟宿主投放目录：路径里带 mavis-miniapp，父目录是系统临时目录。 */
    const deploy = join(box.home, 'mavis-miniapp-2yKnCf', 'package');
    await mkdir(deploy, { recursive: true });
    await withConsole({ home: box.home, dataDir: box.dataDir, cwd: deploy }, ({ workspace }) => {
      assert.notEqual(workspace.workspace, deploy, '不能把投放目录当成工作目录');
      assert.equal(workspace.workspace, null, '投放目录不可信时不应有工作目录');
      assert.equal(workspace.source, 'unset');
    });
  } finally {
    await box.cleanup();
  }
});

test('macOS 形态的临时绝对路径会被拒掉，不会被当成项目', async () => {
  const box = await makeSandbox('macpath');
  try {
    const macPath = '/private/var/folders/xx/yyyy/T/mavis-miniapp-2yKnCf/package';
    await withConsole(
      { home: box.home, dataDir: box.dataDir, cwd: box.project, env: { MCODE_WORKSPACE: macPath } },
      ({ workspace }) => {
        assert.notEqual(workspace.workspace, macPath, '环境变量里的临时目录不能被采用');
        assert.equal(workspace.source, 'unset', '环境变量里的临时目录不能算作有效来源');
      },
    );
  } finally {
    await box.cleanup();
  }
});

test('持久化的临时目录会被拒掉（早期版本把它当用户指定的项目）', async () => {
  const box = await makeSandbox('stale');
  try {
    const stale = join(box.home, 'mavis-miniapp-old', 'package');
    await mkdir(stale, { recursive: true });
    await writeFile(
      join(box.dataDir, 'workspace.json'),
      JSON.stringify({ workspace: stale }),
      'utf8',
    );
    await withConsole({ home: box.home, dataDir: box.dataDir, cwd: box.project }, ({ workspace }) => {
      assert.notEqual(workspace.workspace, stale, '持久化的临时目录不能被采用');
      assert.equal(workspace.source, 'unset', '持久化的临时目录不能算作用户指定的项目');
    });
  } finally {
    await box.cleanup();
  }
});

test('用户指定过的真实项目会被沿用', async () => {
  const box = await makeSandbox('learned');
  try {
    await writeFile(
      join(box.dataDir, 'workspace.json'),
      JSON.stringify({ workspace: box.project }),
      'utf8',
    );
    await withConsole({ home: box.home, dataDir: box.dataDir, cwd: box.project }, ({ workspace }) => {
      assert.equal(workspace.workspace, box.project);
      assert.equal(workspace.source, 'learned');
    });
  } finally {
    await box.cleanup();
  }
});

test('环境变量优先于其它线索', async () => {
  const box = await makeSandbox('env');
  try {
    await withConsole(
      { home: box.home, dataDir: box.dataDir, cwd: box.project, env: { MCODE_WORKSPACE: box.project } },
      ({ workspace }) => {
        assert.equal(workspace.workspace, box.project);
        assert.equal(workspace.source, 'env');
      },
    );
  } finally {
    await box.cleanup();
  }
});

test('另一个插件的登记簿不会被当成工作目录来源', async () => {
  const box = await makeSandbox('registry');
  try {
    /* `~/.mcode-dynamic-workflows` 是 mcode-dynamic-workflows 插件的数据目录。
       它的登记簿里记着项目绝对路径——控制台不该去读，更不该顺手把那个
       插件的服务令牌也用上。 */
    const registry = join(box.home, '.mcode-dynamic-workflows', 'projects', 'a'.repeat(64));
    await mkdir(registry, { recursive: true });
    await writeFile(
      join(registry, 'address.json'),
      JSON.stringify({ url: 'http://127.0.0.1:9/#secret-token', workspace: box.project }),
      'utf8',
    );
    await withConsole({ home: box.home, dataDir: box.dataDir, cwd: box.project }, ({ workspace, bootstrap }) => {
      assert.equal(workspace.workspace, null, '不应从别的插件的登记簿里取工作目录');
      assert.equal(workspace.source, 'unset');
      const services = Array.isArray(bootstrap.services) ? bootstrap.services : [];
      assert.deepEqual(
        services.map((service) => service.id),
        ['embedded'],
        '别的插件的服务不该出现在控制台的服务列表里',
      );
    });
  } finally {
    await box.cleanup();
  }
});

test('另一个插件的登记簿存在时，内置引擎依然是唯一的后端', async () => {
  const box = await makeSandbox('registry-services');
  try {
    const registry = join(box.home, '.mcode-dynamic-workflows', 'projects', 'c'.repeat(64));
    await mkdir(registry, { recursive: true });
    await writeFile(
      join(registry, 'address.json'),
      JSON.stringify({ url: 'http://127.0.0.1:9/', workspace: box.project }),
      'utf8',
    );
    await withConsole({ home: box.home, dataDir: box.dataDir, cwd: box.project }, ({ bootstrap }) => {
      const services = Array.isArray(bootstrap.services) ? bootstrap.services : [];
      assert.deepEqual(
        services.map((service) => service.id),
        ['embedded'],
        '控制台只应使用自己内置的引擎',
      );
      assert.equal(bootstrap.activeServiceId, 'embedded');
    });
  } finally {
    await box.cleanup();
  }
});
