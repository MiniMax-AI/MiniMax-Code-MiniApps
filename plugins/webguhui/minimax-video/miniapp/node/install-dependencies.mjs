// 固定版本和摘要来自发布清单；只写应用数据目录，不执行依赖安装脚本。
import { readFile, writeFile, mkdir, readdir, chmod, rename, rm, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { extract } from './extract-package.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function downloadUrl(item, region) {
  if (!['cn', 'global'].includes(region)) throw new Error('请选择中国大陆或海外下载源');
  if (region === 'global') return item.url;
  if (item.kind === 'gzip') return `https://registry.npmmirror.com/-/binary/ffmpeg-static/${item.version}/${item.name}`;
  const url = new URL(item.url);
  if (url.hostname !== 'registry.npmjs.org') throw new Error('不支持的依赖来源');
  return `https://registry.npmmirror.com${url.pathname}`;
}
export function verifyArchive(bytes, item) {
  if (item.size && bytes.length !== item.size) throw new Error(`${item.name} 下载不完整`);
  const valid = item.integrity.startsWith('sha256-hex:')
    ? digest(bytes) === item.integrity.slice(11)
    : item.integrity === `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  if (!valid) throw new Error(`${item.name} 文件校验失败，请重试或切换下载源`);
}
async function inventory(root, relative = '') {
  const files = [];
  for (const entry of await readdir(join(root, relative), {withFileTypes:true})) {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await inventory(root,path));
    else if (entry.isFile() && path !== '.complete.json') files.push({path,sha256:digest(await readFile(join(root,path)))});
    else if (!entry.isFile()) throw new Error('依赖目录包含不支持的文件');
  }
  return files;
}
export async function nativeCacheInfo(source, dataDir, platform = `${process.platform}-${process.arch}`) {
  const bytes = await readFile(join(source,'native-dependencies.json'));
  const manifest = JSON.parse(bytes);
  const packages = manifest.platforms[platform];
  if (!packages || (platform.startsWith('linux') && process.platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime)) throw new Error(`暂不支持 ${platform}；Linux 需要 glibc`);
  const key = `${platform}-${digest(bytes).slice(0,16)}`;
  return {root:join(dataDir,'dependencies',key),packages,key};
}
export async function nativeCacheReady(info) {
  try {
    const record = JSON.parse(await readFile(join(info.root,'.complete.json'),'utf8'));
    if(record.key !== info.key || !record.files?.length) return false;
    for(const file of record.files) {
      if(file.path.split('/').some(x=>!x || x==='..' || x==='.') || /[\\:]/.test(file.path)) return false;
      if(digest(await readFile(join(info.root,file.path))) !== file.sha256) return false;
    }
    return true;
  } catch { return false; }
}
async function download(item, region, signal, report) {
  let response;
  try { response = await fetch(downloadUrl(item,region), {signal:AbortSignal.any([signal,AbortSignal.timeout(180000)])}); }
  catch (error) { if(signal.aborted) throw error; throw new Error(`${item.name} 下载连接失败或超时，请检查网络或切换下载源重试`); }
  if (!response.ok) throw new Error(`${item.name} 下载失败（HTTP ${response.status}），可以切换下载源重试`);
  const chunks=[]; let size=0;
  for await(const chunk of response.body) {
    size+=chunk.length;
    if(size>200*1024*1024) throw new Error('依赖文件超过大小限制');
    chunks.push(chunk);
    report(`正在下载 ${item.name} · ${(size/1024/1024).toFixed(1)} MB`);
  }
  const bytes=Buffer.concat(chunks); verifyArchive(bytes,item); return bytes;
}
export async function installDependencies(info, region, signal, report=()=>{}) {
  if(await nativeCacheReady(info)) return info.root;
  const temp=`${info.root}.tmp-${randomUUID()}`;
  await mkdir(temp,{recursive:true});
  try {
    for(const item of info.packages) {
      signal.throwIfAborted();
      const bytes=await download(item,region,signal,report);
      if(item.kind==='gzip') {
        const target=join(temp,'bin',item.target); await mkdir(join(temp,'bin'),{recursive:true});
        await writeFile(target,gunzipSync(bytes,{maxOutputLength:256*1024*1024}));
        if(item.target.startsWith('ff')) await chmod(target,0o755);
      } else {
        const directory=join(temp,'node_modules',item.name);
        await mkdir(directory,{recursive:true});
        const archive=join(temp,'package.tgz'); await writeFile(archive,bytes);
        await extract(archive,directory); await rm(archive);
        const metadata=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
        if(metadata.name!==item.name || metadata.version!==item.version) throw new Error('依赖版本不匹配');
      }
    }
    const files=await inventory(temp);
    await writeFile(join(temp,'.complete.json'),JSON.stringify({key:info.key,files}));
    signal.throwIfAborted();
    // 只替换这个清单对应的可重建缓存，失败下载不会覆盖现有缓存。
    await rm(info.root,{recursive:true,force:true});
    await rename(temp,info.root);
    report('依赖准备完成'); return info.root;
  } finally { await rm(temp,{recursive:true,force:true}); }
}
export async function activateDependencies(root, runtime) {
  await cp(join(root,'node_modules'),join(runtime,'node_modules'),{recursive:true});
  const extension=process.platform==='win32'?'.exe':'';
  process.env.OPENCHATCUT_FFMPEG=join(root,'bin',`ffmpeg${extension}`);
  process.env.OPENCHATCUT_FFPROBE=join(root,'bin',`ffprobe${extension}`);
}
