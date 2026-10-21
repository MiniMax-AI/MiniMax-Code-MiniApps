// 只处理公开静态资源，不包含用户工程、素材、配置或凭据。
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
const root=resolve(process.argv[2]??'release-portable/miniapp/client');
const output=resolve(process.argv[3]??'/tmp/minimax-video-lazy/uploads');
await mkdir(output,{recursive:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const files={};
async function walk(dir,relative='') {
 for(const entry of await readdir(dir,{withFileTypes:true})) {
  const path=relative?`${relative}/${entry.name}`:entry.name;
  if(entry.isDirectory()){await walk(join(dir,entry.name),path);continue;}
  const selected=(path.startsWith('fonts/')&&!path.startsWith('fonts/noto-sans-sc/')&&/\.woff2$/.test(path)) || /^(sound-effects|voice-samples|audio)\/.*\.(mp3|wav)$/.test(path) || /^(mediapipe|models)\//.test(path) || /^assets\/.*\.wasm$/.test(path);
  if(!selected)continue;
  const bytes=await readFile(join(dir,entry.name));const zipped=gzipSync(bytes,{level:6,mtime:0});
  const sha256=hash(bytes);const filename=`minimax-video-${sha256}.gz`;
  await writeFile(join(output,filename),zipped);
  files['/'+path]={sha256,size:bytes.length,compressedSha256:hash(zipped),compressedSize:zipped.length,filename,urls:{}};
 }
}
await walk(root);await writeFile(join(output,'../resource-manifest.json'),JSON.stringify({version:1,files},null,2)+'\n');
console.log('Resources:',Object.keys(files).length,'raw bytes:',Object.values(files).reduce((s,x)=>s+x.size,0),'compressed:',Object.values(files).reduce((s,x)=>s+x.compressedSize,0));
