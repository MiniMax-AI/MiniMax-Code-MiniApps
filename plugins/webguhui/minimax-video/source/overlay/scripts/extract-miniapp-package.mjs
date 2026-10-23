import { x } from 'tar';
export async function extract(file, cwd) {
  await x({file,cwd,strip:1,strict:true,preservePaths:false,filter(path,entry) {
    const parts=path.split('/');
    if(parts[0]!=='package' || parts.some(p=>p==='..') || /[\\:\x00-\x1f]/.test(path)) throw new Error('依赖压缩包包含非法路径');
    if(!['File','Directory','OldFile'].includes(entry.type)) throw new Error('依赖压缩包包含不支持的链接');
    return true;
  }});
}
