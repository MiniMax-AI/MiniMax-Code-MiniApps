/**
 * 内置引擎工作目录解析的回归测试。
 *
 * 背景：宿主把 Mini App 投放成临时目录（macOS 上形如
 * /private/var/folders/xx/yyyy/T/mavis-miniapp-xxxx/package），
 * 旧实现无条件采用 process.cwd()，于是内置引擎被绑到了这个临时目录，
 * 同事在 macOS 上第一次运行控制台时，顶栏就显示了一串临时路径。
 *
 * 这里逐层验证 resolveEngineWorkspace() 的「选谁 / 拒谁」：
 *   - 临时投放目录一律拒绝；
 *   - 真实项目按 环境变量 → 用户指定 → 运行中的服务 → 引擎登记簿 的顺序优先；
 *   - 兜底落回用户主目录，并把来源标记成 home，让前端提示「还没绑定真实项目」。
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
 * 起一个控制台实例，读一次工作目录，然后把环境还原。
 * @param {{home: string, dataDir: string, cwd?: string, env?: Record<string, string>}} options
 * @param {(body: {workspace: string, source: string}) => void} check
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
      const response = await fetch(`http://127.0.0.1:${port}/api/workspace`);
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

test('宿主投放的临时目录不会被选成工作目录', async () => {
  const box = await makeSandbox('deploy');
  try {
    /* 模拟宿主投放目录：路径里带 mavis-miniapp，父目录是系统临时目录。 */
    const deploy = join(box.home, 'mavis-miniapp-2yKnCf', 'package');
    await mkdir(deploy, { recursive: true });
    await withConsole({ home: box.home, dataDir: box.dataDir, cwd: deploy }, (body) => {
      assert.notEqual(body.workspace, deploy, '不能把投放目录当成工作目录');
      assert.equal(body.source, 'home', '没有真实项目线索时应回退到主目录');
      assert.equal(body.workspace, box.home);
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
      (body) => {
        assert.notEqual(body.workspace, macPath, '环境变量里的临时目录不能被采用');
        assert.notEqual(body.source, 'env', '环境变量里的临时目录不能算作有效来源');
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
    await withConsole({ home: box.home, dataDir: box.dataDir, cwd: box.project }, (body) => {
      assert.notEqual(body.workspace, stale, '持久化的临时目录不能被采用');
      assert.notEqual(body.source, 'learned', '持久化的临时目录不能算作用户指定的项目');
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
    await withConsole({ home: box.home, dataDir: box.dataDir, cwd: box.project }, (body) => {
      assert.equal(body.workspace, box.project);
      assert.equal(body.source, 'learned');
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
      (body) => {
        assert.equal(body.workspace, box.project);
        assert.equal(body.source, 'env');
      },
    );
  } finally {
    await box.cleanup();
  }
});

test('引擎项目登记簿里的真实项目会被自动选中', async () => {
  const box = await makeSandbox('registry');
  try {
    /* 登记簿的每个目录里都有一份 endpoint.json / address.json，里面记着项目绝对路径。 */
    const registry = join(box.home, '.mcode-dynamic-workflows', 'projects', 'a'.repeat(64));
    await mkdir(registry, { recursive: true });
    await writeFile(
      join(registry, 'address.json'),
      JSON.stringify({ url: 'http://127.0.0.1:9/', workspace: box.project }),
      'utf8',
    );
    await withConsole({ home: box.home, dataDir: box.dataDir, cwd: box.project }, (body) => {
      assert.equal(body.workspace, box.project);
      assert.equal(body.source, 'projects');
    });
  } finally {
    await box.cleanup();
  }
});

test('登记簿里指向已删除项目的条目会被跳过', async () => {
  const box = await makeSandbox('stale-registry');
  try {
    const gone = join(box.home, 'gone', 'project');
    const registry = join(box.home, '.mcode-dynamic-workflows', 'projects', 'b'.repeat(64));
    await mkdir(registry, { recursive: true });
    await writeFile(
      join(registry, 'address.json'),
      JSON.stringify({ url: 'http://127.0.0.1:9/', workspace: gone }),
      'utf8',
    );
    await withConsole({ home: box.home, dataDir: box.dataDir, cwd: box.project }, (body) => {
      assert.notEqual(body.workspace, gone, '目录已不存在时不能采用登记簿里的路径');
      assert.notEqual(body.source, 'projects', '目录已不存在时不能算作登记簿来源');
    });
  } finally {
    await box.cleanup();
  }
});
