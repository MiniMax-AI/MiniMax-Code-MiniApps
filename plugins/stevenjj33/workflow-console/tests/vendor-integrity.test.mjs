/**
 * 内置引擎副本的完整性测试。
 *
 * 控制台把上游 `mcode-dynamic-workflows` 插件的运行时代码直接内置进来，
 * 好让这台机器没装过那个插件也能跑。代价是：这份副本不会自动跟着上游更新，
 * 也没法一眼看出它到底对应上游的哪一次提交。
 *
 * 这个测试把这件事钉死：下面每个文件都记着它在上游仓库里的 **git blob
 * 对象 ID**（不是内容摘要，是 git 仓库里那个对象的真实地址）。
 * 本地重算一次 git blob 哈希就能证明副本和那个对象逐字节相同——
 * 于是「副本来自上游哪一个提交」不再是一句口头说明，而是一条随时可验的事实。
 *
 * 升级副本的流程见同目录 README 与 `miniapp/node/vendor/dynamic-workflows/VENDOR.md`：
 * 换上游提交时，替换文件并同步更新下面这张表，然后跑这个测试。
 *
 * 运行：
 *   node --test tests/
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
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
const vendorRoot = join(
  packageRoot,
  'miniapp',
  'node',
  'vendor',
  'dynamic-workflows',
);

/**
 * 上游来源：`MiniMax-AI/MiniMax-Code-Plugins` → `plugins/hetaoBackend/mcode-dynamic-workflows`
 * 的提交 `6481e4ae1e03`（插件版本 0.8.0）。
 */
const UPSTREAM_REPO = 'MiniMax-AI/MiniMax-Code-Plugins';
const UPSTREAM_COMMIT = '6481e4ae1e03';

/** 内置副本里每个文件对应的上游 git blob 对象 ID。 */
const UPSTREAM_BLOBS = {
  'LICENSE': '125be1b8e1012ef2d9839626f9c045a352bcfa9d',
  'THIRD_PARTY_NOTICES.txt': '23e2f09fae50383217a40f9850a837d9776365b3',
  'dist/main.mjs': '0b42f464e5377bb86014979e94dd934f0910c691',
  'dist/quickjs.wasm': '1815757b9a01a3e9a2eac80fc6e6ef3a6db566b9',
  'dist/sandbox.mjs': 'c8dc9a99fd63657d215703d44fa13cc3612794c0',
  'examples/audit-en.js': '071ea5162a14213bb31d51636108a1b95995aeaa',
  'examples/audit.js': '928a48032e797fe382f9c6793c84537dacc4b87b',
  'examples/reflection.js': 'cb99623b1afb76ec12d5503ce9623ef403e49498',
  'examples/smoke.js': '424b53708bceba136c1a0b5c52f4455ddcdb1d1c',
  'web/app.js': 'e0f430155d66efa4ca2f7310b489b5e2e07d25a2',
  'web/app.source.mjs': '87f30cbc568a390235eda30758e97048aa6e56c8',
  'web/graph-model.mjs': 'c8f152d399cf652995740f6f2cd1433df77968d6',
  'web/i18n.mjs': '8d56ed9a47ac8f9b7d70d471fc16ce12da9920c8',
  'web/index.html': '165723a3af9258ff19f770a1e93efee808c6cdd0',
  'web/readable.css': '853cd399443cc7467c1d65307abc67719d08d5bd',
  'web/readable.mjs': '868cb3d4f0646ea226f2905bde9857a2fa5c889e',
  'web/style.css': '450af5398fba6179dbdd25c7e5788e23237a262f',
};

/**
 * git 的 blob 对象 ID：sha1("blob <字节数>\0" + 内容)。
 * 用它做比对，等于直接问 git「这份文件在上游仓库里是不是这个对象」。
 * @param {Buffer} buffer
 * @returns {string}
 */
function gitBlobId(buffer) {
  const header = Buffer.from(`blob ${buffer.length}\0`, 'ascii');
  return createHash('sha1').update(Buffer.concat([header, buffer])).digest('hex');
}

test('内置副本的每个文件都与上游提交逐字节相同', async () => {
  for (const [relative, expected] of Object.entries(UPSTREAM_BLOBS)) {
    const path = join(vendorRoot, ...relative.split('/'));
    assert.ok(existsSync(path), `内置副本缺少文件 ${relative}`);
    const actual = gitBlobId(await readFile(path));
    assert.equal(
      actual,
      expected,
      `${relative} 与上游 ${UPSTREAM_REPO}@${UPSTREAM_COMMIT} 不一致（实际 ${actual}）`,
    );
  }
});

test('内置副本不含上游没有的多余文件', async () => {
  const known = new Set(Object.keys(UPSTREAM_BLOBS));
  /* VENDOR.md 是控制台自己写的说明文件，不属于上游副本。 */
  known.add('VENDOR.md');
  const { readdir } = await import('node:fs/promises');
  for (const dir of ['dist', 'web', 'examples']) {
    const entries = await readdir(join(vendorRoot, dir));
    for (const entry of entries) {
      const relative = `${dir}/${entry}`;
      assert.ok(known.has(relative), `内置副本出现了未登记的文件 ${relative}`);
    }
  }
});

test('graph-model 是控制台的承重依赖，导出名必须保持不变', async () => {
  const module = await import(
    pathToFileURL(join(vendorRoot, 'web', 'graph-model.mjs')).href
  );
  assert.equal(
    typeof module.workflowGraph,
    'function',
    '上游若改了 workflowGraph 的导出名或签名，控制台会在启动时直接报错',
  );
});

test('VENDOR.md 记录的上游提交与本测试一致', async () => {
  const vendor = await readFile(join(vendorRoot, 'VENDOR.md'), 'utf8');
  assert.ok(
    vendor.includes(UPSTREAM_COMMIT),
    `VENDOR.md 必须写明上游提交 ${UPSTREAM_COMMIT}`,
  );
  assert.ok(
    vendor.includes(UPSTREAM_REPO),
    `VENDOR.md 必须写明上游仓库 ${UPSTREAM_REPO}`,
  );
  assert.ok(vendor.includes('0.8.0'), 'VENDOR.md 必须写明上游插件版本 0.8.0');
  /* 上游只发布过 0.8.0，0.8.2 从未存在。
     正文里可以提到「上一版误称为 0.8.2」，但任何一行都不得把版本**声称**成 0.8.2。 */
  for (const line of vendor.split('\n')) {
    assert.ok(
      !/版本[^\n]*0\.8\.2/.test(line),
      `VENDOR.md 不能把上游版本声称成 0.8.2：${line}`,
    );
  }
});
