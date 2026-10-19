import { cp, copyFile, mkdir, readFile, readdir, writeFile, rename, chmod, lstat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { createResourceStore } from './lazy-resources.mjs';
import { startSetup } from './setup-server.mjs';
import { activateDependencies } from './install-dependencies.mjs';

// 依赖随包分发；宿主数据目录中的展开结果是可重建缓存。
async function expandVendor(source, destination) {
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (let index = 0; index < entries.length; index += 8) {
    await Promise.all(entries.slice(index, index + 8).map(async (entry) => {
      let name = entry.name === '__miniapp_dependencies__' ? 'node_modules' : entry.name;
      if (entry.name.startsWith('__miniapp_name_')) {
        const encoded = entry.name.slice('__miniapp_name_'.length);
        if (!/^(?:[a-f0-9]{2})+$/.test(encoded)) throw new Error('Invalid encoded dependency name');
        name = Buffer.from(encoded, 'hex').toString('utf8');
        if (!name || name === '.' || name === '..' || /[\\/\\\\\x00-\x1f]/.test(name)) throw new Error('Unsafe dependency name');
      }
      const target = join(destination, name);
      if (entry.isDirectory()) await expandVendor(join(source, entry.name), target);
      else if (entry.isFile()) await copyFile(join(source, entry.name), target);
      else throw new Error('Unsupported dependency entry');
    }));
  }
}

// 清单仅能引用包内普通文件，恢复目标只能位于两个可重建目录。
async function safePath(root, relative) {
  if (typeof relative !== 'string' || /[\\\\:\x00-\x1f]/.test(relative) || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Unsafe restore path');
  let current = root;
  for (const part of relative.split('/')) {
    current = join(current, part);
    const info = await lstat(current).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (info?.isSymbolicLink()) throw new Error('Restore path contains symlink');
  }
  return current;
}
export async function restoreFiles(payload, cache) {
  const manifest = JSON.parse(await readFile(join(payload, 'node/restore-files.json'), 'utf8'));
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error('Invalid restore manifest');
  for (let index = 0; index < manifest.files.length; index += 16) {
    await Promise.all(manifest.files.slice(index, index + 16).map(async (entry) => {
    if (!/^(client|node\/(vendor|remotion-bundle))\//.test(entry.source) || !/^(node_modules|remotion-bundle)\//.test(entry.target)) throw new Error('Invalid restore root');
    const source = await safePath(payload, entry.source);
    const target = await safePath(cache, entry.target);
    if (!(await lstat(source)).isFile()) throw new Error('Restore source must be a regular file');
    const bytes = await readFile(source);
    if (bytes.length !== entry.size || createHash('sha256').update(bytes).digest('hex') !== entry.sha256 || !Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777) throw new Error('Restore integrity check failed');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
    await chmod(target, entry.mode);
    }));
  }
}

export async function start(context) {
  // Dependency diagnostics must not write to the Host-owned stdout stream.
  globalThis.__openVideoDependencyLog = (...args) => {
    context.logger.debug('OpenVideo dependency diagnostic', { argumentCount: args.length });
    return true;
  };
  return startSetup(context, (server, nativeRoot) => startReady(context, server, nativeRoot));
}

async function startReady(context, server, nativeRoot) {
  const source = join(context.pluginRoot, 'miniapp/node');
  const manifest = JSON.parse(await readFile(join(source, 'upstream.json'), 'utf8'));
  const cache = join(context.dataDir, 'runtime', manifest.buildId);
  await mkdir(cache, { recursive: true });
  const ready = await readFile(join(cache, '.ready'), 'utf8').catch(() => '');
  if (ready !== manifest.buildId) {
    context.logger.info('openchatcut.cache.dependencies');
    await expandVendor(join(source, 'vendor'), join(cache, 'node_modules'));
    context.logger.info('openchatcut.cache.runtime');
    await cp(join(source, 'runtime'), cache, { recursive: true });
    await cp(join(source, 'remotion-bundle'), join(cache, 'remotion-bundle'), { recursive: true });
    context.logger.info('openchatcut.cache.restore');
    await restoreFiles(join(context.pluginRoot, 'miniapp'), cache);
    await writeFile(join(cache, '.ready.next'), manifest.buildId);
    await rename(join(cache, '.ready.next'), join(cache, '.ready'));
  }
  await activateDependencies(nativeRoot, cache);
  // Remotion 按 cwd 寻找下载缓存；专属数据目录可写，安装目录保持只读。
  await writeFile(join(context.dataDir, 'package.json'), '{"private":true,"type":"module"}\n');
  process.chdir(context.dataDir);
  process.env.OPENCHATCUT_MINIAPP = '1';
  process.env.OPENCHATCUT_DATA_DIR = context.dataDir;
  process.env.OPENCHATCUT_DEV_PROFILE_ID = '2e6f4a29-b784-400c-bf32-b859b16f2561';
  process.env.CC_REMOTION_BUNDLE = join(cache, 'remotion-bundle');
  context.logger.info('openchatcut.server.loading');
  const { startEditor } = await import(pathToFileURL(join(cache, 'editor.mjs')).href);
  const resources = await createResourceStore(source, context.dataDir, cache, context.signal);
  const editor = await startEditor(join(context.pluginRoot, 'miniapp/client'), context.listen.host, context.listen.port, server, resources);
  let disposal;
  const dispose = () => disposal ??= (async () => {
    context.signal.removeEventListener('abort', onAbort);
    if (editor.dispose) await editor.dispose();
    else {
      editor.server.closeAllConnections();
      await new Promise((resolve, reject) => editor.server.close(error => error ? reject(error) : resolve()));
    }
  })();
  const onAbort = () => { void dispose().catch(() => context.logger.error('openchatcut.dispose.failed')); };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();
  context.logger.info('openchatcut.runtime.started', { version: manifest.version });
  return { dispose };
}
