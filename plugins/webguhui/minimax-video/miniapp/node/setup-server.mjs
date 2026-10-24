import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,extname} from 'node:path';
import {randomBytes} from 'node:crypto';
import {nativeCacheInfo,nativeCacheReady,installDependencies} from './install-dependencies.mjs';

export async function startSetup(context,startEditor) {
  const controller=new AbortController();
  const signal=AbortSignal.any([context.signal,controller.signal]);
  const source=join(context.pluginRoot,'miniapp/node');
  const token=randomBytes(24).toString('hex');
  const state={state:'choose',message:'请选择下载源。组件只安装到应用自己的数据目录。',platform:({'darwin-arm64':'Mac · Apple Silicon','darwin-x64':'Mac · Intel','win32-x64':'Windows · x64','linux-x64':'Linux · x64','linux-arm64':'Linux · ARM64'})[`${process.platform}-${process.arch}`] ?? `${process.platform}-${process.arch}`,token};
  let task,editor;
  const server=createServer((req,res)=>void handle(req,res).catch(()=>{res.writeHead(500);res.end('无法读取准备页面');}));
  const json=(res,code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  async function begin(region) {
    if(task || signal.aborted)return;
    state.state='installing';state.region=region;state.message='正在检查本地依赖…';
    task=(async()=>{
      const info=await nativeCacheInfo(source,context.dataDir);
      const root=await installDependencies(info,region,signal,message=>{state.message=message;});
      signal.throwIfAborted();
      await writeFile(join(context.dataDir,'download-region.json'),JSON.stringify({region}));
      state.message='正在打开编辑器…';
      editor=await startEditor(server,root);
      state.state='ready';
    })().catch(error=>{state.state='error';state.message=error.message;context.logger.error('minimax-video.setup.failed',{message:error.message});}).finally(()=>{task=undefined;});
  }
  async function handle(req,res) {
    const path=new URL(req.url,'http://localhost').pathname;
    if(path==='/__setup/status' && req.method==='GET') return json(res,200,state);
    if(path==='/__setup/install' && req.method==='POST') {
      // 宿主负责入口认证；随机令牌和 JSON 请求额外防止跨站触发下载。
      if(req.headers['x-setup-token']!==token || req.headers['content-type']!=='application/json') return json(res,403,{error:'Forbidden'});
      let body=''; for await(const chunk of req) {body+=chunk; if(body.length>256)return json(res,413,{error:'Too large'});}
      let region; try {region=JSON.parse(body).region;} catch {return json(res,400,{error:'Invalid JSON'});}
      if(!['cn','global'].includes(region))return json(res,400,{error:'Invalid region'});
      if(task)return json(res,409,{error:'Already running'});
      void begin(region);return json(res,202,{ok:true});
    }
    if(req.method!=='GET')return json(res,503,{error:'环境准备中'});
    let file='setup.html';
    if(path.startsWith('/assets/') && /^\/assets\/[A-Za-z0-9_.-]+$/.test(path))file=path.slice(1);
    const bytes=await readFile(join(context.pluginRoot,'miniapp/client',file));
    const types={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'};
    res.writeHead(200,{'Content-Type':types[extname(file)]??'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);
  }
  await mkdir(context.dataDir,{recursive:true});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(context.listen.port,context.listen.host,resolve);});
  // 有完整缓存或已选区域时自动继续；无宿主区域信号时不猜测用户所在地。
  void (async()=>{
    let region;try {region=JSON.parse(await readFile(join(context.dataDir,'download-region.json'),'utf8')).region;}catch{}
    const info=await nativeCacheInfo(source,context.dataDir);
    if(await nativeCacheReady(info))void begin(['cn','global'].includes(region)?region:'global');
    else if(['cn','global'].includes(region))void begin(region);
  })().catch(error=>{state.state='error';state.message=error.message;});
  let disposal;
  const dispose=()=>disposal??=(async()=>{
    controller.abort();context.signal.removeEventListener('abort',onAbort);
    await task;
    if(editor)await editor.dispose();
    else {server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  })();
  const onAbort=()=>void dispose();
  context.signal.addEventListener('abort',onAbort,{once:true});
  if(context.signal.aborted)await dispose();
  return {dispose};
}
