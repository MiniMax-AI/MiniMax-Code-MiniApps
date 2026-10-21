/**
 * macOS 场景本地模拟：把控制台跑在一个「新宿主」环境里，供浏览器人工验收。
 *
 * 它模拟同事在 macOS 上第一次打开控制台的现场：
 *   - 运行时 cwd = 宿主的临时投放目录（含 mavis-miniapp 片段）
 *   - 主目录是干净的空目录（没有任何项目登记簿）
 *   - 数据目录是全新的
 *
 * 预期结果：顶栏与工作目录栏里**不会**出现那串临时路径，
 * 而是回退到主目录，并提示「内置引擎还没绑定到真实项目」。
 *
 * 用法：
 *   node tests/manual-mac-scenario.mjs            # 端口 65500
 *   WC_PORT=65510 node tests/manual-mac-scenario.mjs
 *   WC_PACKAGE_ROOT=<活的包目录> node tests/manual-mac-scenario.mjs
 *   WC_REGISTRY_WORKSPACE=<真实项目路径> node tests/manual-mac-scenario.mjs
 *       # 额外验证「登记簿里的真实项目会被自动选中」这一路
 *
 * 起来之后用内置 Browser 打开 http://127.0.0.1:<端口>/ 验收；
 * Ctrl+C 结束。脚本只在系统临时目录里造数据，退出时自动清理。
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
const port = Number(process.env.WC_PORT || 65500);
const { start } = await import(pathToFileURL(join(packageRoot, 'miniapp', 'node', 'server.mjs')).href);

const root = await mkdtemp(join(tmpdir(), 'wc-mac-scenario-'));
const home = join(root, 'home');
const dataDir = join(root, 'data');
/* 宿主投放目录：路径里带 mavis-miniapp，父目录在系统临时目录下面。 */
const deploy = join(root, 'mavis-miniapp-2yKnCf', 'package');
await mkdir(home, { recursive: true });
await mkdir(dataDir, { recursive: true });
await mkdir(deploy, { recursive: true });

/* 造一个已注册的真实项目，用来验证「登记簿里的项目会被自动选中」这一路。
   设置 WC_REGISTRY_WORKSPACE=<真实项目绝对路径> 即可启用。 */
const registry = join(home, '.mcode-dynamic-workflows', 'projects', 'c'.repeat(64));
await mkdir(registry, { recursive: true });
if (process.env.WC_REGISTRY_WORKSPACE) {
  await writeFile(
    join(registry, 'address.json'),
    JSON.stringify({ url: 'http://127.0.0.1:9/', workspace: process.env.WC_REGISTRY_WORKSPACE }),
    'utf8',
  );
}

process.env.HOME = home;
process.env.USERPROFILE = home;
for (const key of ['MCODE_WORKSPACE', 'MCODE_PROJECT_DIR', 'PROJECT_DIR', 'WORKSPACE']) delete process.env[key];
process.chdir(deploy);

const probe = createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
probe.close();

const controller = new AbortController();
const lifecycle = await start({
  pluginId: 'workflow-console',
  pluginRoot: packageRoot,
  dataDir,
  listen: { host: '127.0.0.1', port },
  signal: controller.signal,
  logger: { debug() {}, info() {}, warn() {}, error() {} },
});

const response = await fetch(`http://127.0.0.1:${port}/api/workspace`);
const resolved = await response.json();
console.log('工作目录解析结果：', JSON.stringify(resolved));
console.log('宿主投放目录    ：', deploy);
console.log('是否仍指向投放目录：', resolved.workspace === deploy ? '是（有问题）' : '否（符合预期）');
console.log(`浏览器打开： http://127.0.0.1:${port}/`);

async function shutdown() {
  await lifecycle.dispose();
  await rm(root, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
