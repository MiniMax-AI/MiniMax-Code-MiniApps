// 将上游产物打包为自包含 Mini App；不依赖安装目录的 node_modules。
import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile, readdir, rename, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { createRequire, builtinModules } from 'node:module';
const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
// 发布目录使用白名单组装，源码、Git 与构建缓存不进入安装包。
const releaseRoot = resolve(root, process.argv[2] ?? '../release');
const payload = join(releaseRoot, 'miniapp');
const existingOutput = await readdir(releaseRoot).catch(error => {
  if (error.code === 'ENOENT') return [];
  throw error;
});
if (existingOutput.length) throw new Error('发布目录必须为空；请先将旧 release 移到回收站，避免混入过期产物。');
await mkdir(join(releaseRoot, '.minimax-plugin'), { recursive: true });
for (const file of ['INSTALL.md', 'package.json', 'servers.mcp.json', 'icon.png', '.minimax-plugin/plugin.json', 'miniapp/miniapp.json', 'miniapp/node/server.mjs', 'miniapp/node/setup-server.mjs', 'miniapp/node/install-dependencies.mjs', 'miniapp/node/native-dependencies.json', 'miniapp/node/lazy-resources.mjs', 'miniapp/node/resource-manifest.json', 'source']) {
  await mkdir(dirname(join(releaseRoot, file)), { recursive: true });
  await cp(resolve(root, '..', file), join(releaseRoot, file), { recursive: true });
}
await cp(join(root, 'SHADCN-LICENSE.md'), join(releaseRoot, 'SHADCN-LICENSE.md'));
await mkdir(join(payload, 'node'), { recursive: true });
await cp(join(root, 'miniapp-dist'), join(payload, 'client'), { recursive: true, filter: source => {
  const relative = source.slice(join(root, 'miniapp-dist').length + 1);
  // 模板 JSON 已编译进 initial 模块，无运行时 URL 引用；不重复分发源码副本。
  if (relative === 'templates' || relative.startsWith('templates/')) return false;
  return relative !== 'README.md' && relative !== 'readme-pic' && !relative.startsWith('readme-pic/');
} });
await cp(join(root, 'public/openchatcut-icon.png'), join(payload, 'client/openchatcut-icon.png'));
// 保留浏览器本地媒体处理所需资源；上传文件与下载模型不进入分发包。
for (const directory of ['mediapipe', 'models']) {
  await cp(join(root, 'public', directory), join(payload, 'client', directory), { recursive: true });
}
// 浏览器目录保持完整；只省略稍后会展开至可写缓存的重复文件。
const contentSources = new Map();
const restoreFiles = [];
let savedBytes = 0;
async function deduplicate(source, target, cachePath) {
  const info = await stat(source);
  if (!info.isFile() || info.size < 1024) return true;
  const bytes = await readFile(source);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const key = `${info.size}:${hash}`;
  const original = contentSources.get(key);
  if (original && cachePath && bytes.equals(await readFile(join(payload, original)))) {
    restoreFiles.push({ source: original, target: cachePath, size: info.size, sha256: hash, mode: info.mode & 0o777 });
    savedBytes += info.size;
    return false;
  }
  if (!original) contentSources.set(key, target);
  return true;
}
async function indexClient(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await indexClient(file);
    else if (entry.isFile()) await deduplicate(file, file.slice(payload.length + 1));
  }
}
await indexClient(join(payload, 'client'));
const serverBuild = await build({ metafile: true, plugins: [{ name: 'prebuilt-remotion-only', setup(builder) {
  builder.onResolve({ filter: /^\.\.\/(?:agent\/)?client$/ }, args => args.importer.includes('/src/agent/tools/') || args.path.includes('/agent/client') ? { path: join(root, 'src/agent/miniapp-client.ts') } : undefined);
  builder.onResolve({ filter: /^@remotion\/bundler$/ }, () => ({ path: 'prebuilt-only', namespace: 'miniapp' }));
  builder.onLoad({ filter: /.*/, namespace: 'miniapp' }, () => ({ contents: 'export async function bundle() { throw new Error("预构建渲染资源缺失，请重新安装视频工作室。"); }', loader: 'js' }));
} }], entryPoints: [join(root, 'desktop/miniapp-server.ts')], outfile: join(payload, 'node/runtime/editor.mjs'), platform: 'node', format: 'esm', bundle: true, minify: true, external: ['ffmpeg-static', '@ffprobe-installer/ffprobe', '@remotion/compositor-*', 'sqlite-vec', 'jieba-wasm'], target: 'node22', banner: { js: "import { createRequire as miniappCreateRequire } from 'node:module'; const require = miniappCreateRequire(import.meta.url);" } });
await build({ entryPoints: [join(root, 'scripts/extract-miniapp-package.mjs')], outfile: join(payload, 'node/extract-package.mjs'), platform: 'node', format: 'esm', bundle: true, target: 'node22' });
await writeFile(join(root, '.miniapp-build-meta.json'), JSON.stringify(serverBuild.metafile));
const editorFile = join(payload, 'node/runtime/editor.mjs');
await writeFile(editorFile, (await readFile(editorFile, 'utf8'))
  .replace(/console\.(?:log|info|debug|dir|table)\(/g, 'globalThis.__openVideoDependencyLog(')
  .replaceAll('process.stdout.write(', 'globalThis.__openVideoDependencyLog('));

// Remotion 服务代码已纳入 editor.mjs；仅分发浏览器预构建结果。
await cp(join(root, 'desktop-dist/remotion-bundle'), join(payload, 'node/remotion-bundle'), { recursive: true, filter: async source => {
  const relative = source.slice(join(root, 'desktop-dist/remotion-bundle').length + 1);
  if (relative === 'templates' || relative.startsWith('templates/') || relative === 'public/templates' || relative.startsWith('public/templates/')) return false;
  if (relative.split('/').includes('readme-pic') || relative.endsWith('README.md') || relative.endsWith('.map')) return false;
  return deduplicate(source, `node/remotion-bundle/${relative}`, `remotion-bundle/${relative}`);
} });
// 发布产物不包含构建机器的绝对路径。
const renderHtml = join(payload, 'node/remotion-bundle/index.html');
await writeFile(renderHtml, (await readFile(renderHtml, 'utf8')).replace(/window\.remotion_cwd = .*?;/, 'window.remotion_cwd = "";'));
// 发布版不携带调试映射，同时移除引用，避免渲染器尝试读取不存在的 map。
async function stripDebugMapReferences(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await stripDebugMapReferences(file);
    else if (entry.isFile() && /\.[cm]?js$/.test(entry.name)) {
      const text = await readFile(file, 'utf8');
      const clean = text.replace(/^\/\/[#@] ?sourceMappingURL=[^\r\n]*$/gm, '');
      if (clean !== text) await writeFile(file, clean);
    }
  }
}
await stripDebugMapReferences(join(payload, 'node/remotion-bundle'));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const copied = new Set();
async function vendor(name, from, optional = false) {
  // MiniApp 不内置可选 Copilot CLI；现有安装检测/设置提示支持用户显式安装。
  // SDK 保留，且只使用 resolveCopilotCli() 找到的本机可执行文件，不自动下载。
  if (name === 'ffmpeg-static' || name.startsWith('@ffprobe-installer/') || name.startsWith('@remotion/compositor-') || /^sqlite-vec-(darwin|linux|windows)-/.test(name)) return;
  if (name === '@github/copilot' || name.startsWith('@github/copilot-') && name !== '@github/copilot-sdk') return;
  let file;
  const bases = [];
  for (let dir = from; dir !== dirname(dir); dir = dirname(dir)) bases.push(join(dir, 'node_modules'));
  for (const base of bases) {
    const candidate = join(base, name, 'package.json');
    try { const metadata = JSON.parse(await readFile(candidate, 'utf8')); if (metadata.name === name) { file = candidate; break; } } catch {}
  }
  try { if (!file) { const candidate = require.resolve(`${name}/package.json`, { paths: [from] }); const metadata = JSON.parse(await readFile(candidate, 'utf8')); if (metadata.name !== name) throw new Error('not package root'); file = candidate; } }
  catch {
    let entry;
    try { entry = require.resolve(name, { paths: [from] }); } catch {
      if (optional) return;
      throw new Error(`缺少必需的运行依赖：${name}`);
    }
    let dir = dirname(entry);
    while (dir !== dirname(dir)) {
      try { const p = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')); if (p.name === name) { file = join(dir, 'package.json'); break; } } catch {}
      dir = dirname(dir);
    }
  }
  if (!file) {
    if (optional) return;
    throw new Error(`无法定位运行依赖的 package.json：${name}`);
  }
  if (copied.has(file)) return;
  copied.add(file);
  const dir = dirname(file);
  const relative = dir.slice(join(root, 'node_modules').length + 1);
  if (relative.startsWith('..') || !dir.startsWith(join(root, 'node_modules') + '/')) throw new Error('dependency outside candidate: ' + name);
  const target = join(payload, 'node/vendor', relative.replaceAll('/node_modules/', '/__miniapp_dependencies__/'));
  await cp(dir, target, { recursive: true, dereference: true, filter: async (source) => {
    const suffix = source.slice(dir.length + 1);
    if (suffix.split('/').includes('node_modules')) return false;
    if (/\.d\.[cm]?ts$/.test(suffix) || suffix.endsWith('.map')) return false;
    // Node uses Babel's JS entry; these maps are development-only. Keep Remotion
    // maps intact because its render diagnostics load them from the bundle.
    if (name === '@babel/standalone' && suffix.endsWith('.map')) return false;
    // Only the Node export is reachable in this server. Browser assets are
    // built separately by Vite; preserve licenses and package metadata.
    if (name === 'jieba-wasm' && /^pkg\/(bundler|deno|web)(?:\/|$)/.test(suffix)) return false;
    return deduplicate(source, join(target, suffix).slice(payload.length + 1), join('node_modules', relative, suffix));
  } });
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  const requiredPeers = Object.fromEntries(Object.entries(manifest.peerDependencies ?? {})
    .filter(([dependency]) => !manifest.peerDependenciesMeta?.[dependency]?.optional));
  // 必需 peer 也是实际运行闭包；例如 remotion 的 react-dom 不能借用宿主安装。
  for (const dependency of Object.keys({ ...requiredPeers, ...manifest.dependencies, ...manifest.optionalDependencies })) {
    await vendor(dependency, dir, Object.hasOwn(manifest.optionalDependencies ?? {}, dependency) && !Object.hasOwn(requiredPeers, dependency));
  }
}
const runtimePackages = new Set(Object.values(serverBuild.metafile.outputs).flatMap(output => output.imports)
  .filter(item => item.external && !builtinModules.includes(item.path) && !item.path.startsWith('node:') && !item.path.startsWith('.') && !item.path.startsWith('/'))
  .map(item => item.path.startsWith('@') ? item.path.split('/').slice(0, 2).join('/') : item.path.split('/')[0]));
// createRequire 动态加载的媒体工具不出现在 esbuild imports 中。
runtimePackages.add('ffmpeg-static');
runtimePackages.add('@ffprobe-installer/ffprobe');
for (const name of runtimePackages) {
  await vendor(name, root, ['kerberos', 'bufferutil', 'utf-8-validate'].includes(name));
}
// 第三方资源名可含空格；安装包使用可移植编码，展开时恢复原名。
async function encodeVendorNames(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await encodeVendorNames(path);
    if (!/^[A-Za-z0-9_.@-]+$/.test(entry.name) || entry.name.startsWith('__miniapp_name_')) {
      await rename(path, join(directory, '__miniapp_name_' + Buffer.from(entry.name).toString('hex')));
    }
  }
}
await encodeVendorNames(join(payload, 'node/vendor'));
for (const entry of restoreFiles) {
  if (entry.source.startsWith('node/vendor/')) {
    entry.source = entry.source.split('/').map(name => !/^[A-Za-z0-9_.@-]+$/.test(name) || name.startsWith('__miniapp_name_') ? '__miniapp_name_' + Buffer.from(name).toString('hex') : name).join('/');
  }
}
await writeFile(join(payload, 'node/restore-files.json'), JSON.stringify({ version: 1, files: restoreFiles }, null, 2));
console.log(`Deduplicated ${restoreFiles.length} files, ${savedBytes} bytes; all paths restored at startup.`);
console.log('Runtime package roots:', [...runtimePackages].sort().join(', '));
await cp(join(root, 'LICENSE'), join(payload, 'node/LICENSE-OpenChatCut'));
await writeFile(join(payload, 'node/upstream.json'), JSON.stringify({ name: 'OpenChatCut', version: pkg.version, repository: 'https://github.com/0xsline/OpenChatCut', revision: '2e6f4a29b784200cfb32b859b16f2561592bc3e8', buildId: `miniapp-${Date.now()}`, license: 'AGPL-3.0-or-later' }, null, 2));
console.log('Mini App payload assembled; dependency resolver validation still required.');

await import('../../scripts/strip-resources.mjs').then(module => module.stripResources(releaseRoot));

// 合并依赖后继续分发其许可证与版权声明。
const bundledPackages = new Map();
for (const input of Object.keys(serverBuild.metafile.inputs)) {
  let directory = dirname(resolve(input));
  while (directory.startsWith(join(root, 'node_modules'))) {
    try {
      const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (metadata.name) { bundledPackages.set(metadata.name, { directory, metadata }); break; }
    } catch {}
    directory = dirname(directory);
  }
}
let notices = '';
for (const [name, { directory, metadata }] of [...bundledPackages].sort()) {
  notices += `\n## ${name} ${metadata.version ?? ''} (${metadata.license ?? 'see source'})\n`;
  for (const file of await readdir(directory)) {
    if (/^(license|licence|copying|notice)([.-]|$)/i.test(file) && (await stat(join(directory, file))).isFile()) {
      notices += `\n${file}\n${await readFile(join(directory, file), 'utf8')}\n`;
    }
  }
}
await writeFile(join(payload, 'node/THIRD-PARTY-NOTICES.txt'), notices);
