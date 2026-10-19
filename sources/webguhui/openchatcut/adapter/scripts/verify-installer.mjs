// 只验证安装边界，不依赖网络或操作系统二进制。
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'../release-portable/miniapp/node');
const {downloadUrl,verifyArchive,nativeCacheInfo,installDependencies}=await import(pathToFileURL(join(root,'install-dependencies.mjs')));
const data=Buffer.from('verified');
const item={name:'ffmpeg-darwin-arm64.gz',kind:'gzip',version:'b6.1.1',url:'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-arm64.gz',integrity:'sha256-hex:'+createHash('sha256').update(data).digest('hex')};
verifyArchive(data,item);assert.throws(()=>verifyArchive(Buffer.from('damaged'),item));
assert.match(downloadUrl(item,'cn'),/^https:\/\/registry.npmmirror.com\//);
assert.equal(downloadUrl(item,'global'),item.url);assert.throws(()=>downloadUrl(item,'other'));
const temp=await mkdtemp(join(tmpdir(),'minimax-video-install-'));
try {
  await assert.rejects(()=>nativeCacheInfo(root,temp,'win32-arm64'),/暂不支持/);
  const info=await nativeCacheInfo(root,temp);
  await assert.rejects(()=>installDependencies(info,'cn',AbortSignal.abort()));
} finally {await rm(temp,{recursive:true,force:true});}
console.log('PASS 下载源、文件摘要、不支持的平台、取消安装');
