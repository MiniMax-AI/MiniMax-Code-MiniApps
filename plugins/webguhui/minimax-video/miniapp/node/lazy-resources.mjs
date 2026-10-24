// 固定清单中的公开资源按需下载；旧工程 URL 不变，缓存与工程数据分离。
import { readFile, writeFile, mkdir, rename, rm, copyFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function createResourceStore(source, dataDir, runtime, signal) {
  const manifest = JSON.parse(await readFile(join(source, 'resource-manifest.json'), 'utf8'));
  const root = join(dataDir, 'resources', hash(Buffer.from(JSON.stringify(manifest))).slice(0, 16));
  const pending = new Map();
  const verified = new Set();
  const regionFile = join(dataDir, 'download-region.json');
  const state = { active: 0, completed: 0, error: '' };
  const region = async () => {
    const saved = JSON.parse(await readFile(regionFile, 'utf8').catch(() => '{}'));
    if (!['cn', 'global'].includes(saved.region)) throw new Error('请在设置中选择中国大陆或海外下载源');
    return saved.region;
  };
  const pathKey = input => {
    try { return decodeURIComponent(input.split(/[?#]/)[0]); } catch { return ''; }
  };
  async function ensure(input) {
    const key = pathKey(input);
    const item = manifest.files[key];
    if (!item) return null;
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      signal.throwIfAborted();
      const file = join(root, key.slice(1));
      if (verified.has(key)) return file;
      let bytes = await readFile(file).catch(() => null);
      if (!bytes || bytes.length !== item.size || hash(bytes) !== item.sha256) {
        state.active++;
        try {
          const selected = await region();
          const response = await fetch(item.urls[selected], { signal: AbortSignal.any([signal, AbortSignal.timeout(180000)]) });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const chunks = []; let size = 0;
          for await (const chunk of response.body) {
            size += chunk.length;
            if (size > item.compressedSize) throw new Error('下载文件大小不符');
            chunks.push(chunk);
          }
          const compressed = Buffer.concat(chunks);
          if (size !== item.compressedSize || hash(compressed) !== item.compressedSha256) throw new Error('下载文件校验失败');
          bytes = gunzipSync(compressed, { maxOutputLength: item.size });
          if (bytes.length !== item.size || hash(bytes) !== item.sha256) throw new Error('资源校验失败');
          await mkdir(dirname(file), { recursive: true });
          const temporary = `${file}.${randomUUID()}.tmp`;
          try { await writeFile(temporary, bytes); signal.throwIfAborted(); await rename(temporary, file); }
          finally { await rm(temporary, { force: true }); }
          state.completed++; state.error = '';
        } catch (error) {
          state.error = `资源 ${key} 下载失败：${error.message}。请检查网络，或在设置中切换下载源后重试。`;
          throw new Error(state.error, { cause: error });
        } finally { state.active--; }
      }
      // 渲染器与 Node 处理工具使用同一份已验证资源。
      for (const target of item.targets ?? []) {
        const destination = join(runtime, target);
        await mkdir(dirname(destination), { recursive: true });
        await copyFile(file, destination);
      }
      verified.add(key);
      return file;
    })();
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  }
  return {
    root, ensure,
    has: input => Object.hasOwn(manifest.files, pathKey(input)),
    status: async () => ({ ...state, region: await region(), cached: verified.size, total: Object.keys(manifest.files).length }),
    setRegion: async value => {
      if (!['cn', 'global'].includes(value)) throw new Error('请选择中国大陆或海外下载源');
      await mkdir(dataDir, { recursive: true });
      const temp = `${regionFile}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify({ region: value })); await rename(temp, regionFile);
      state.error = '';
    },
  };
}
