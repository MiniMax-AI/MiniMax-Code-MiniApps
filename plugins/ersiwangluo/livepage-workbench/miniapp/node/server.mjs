// @ts-check
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';

export async function start(context) {
  const root = join(context.pluginRoot, 'miniapp/client');
  const routes = new Map([
    ['/dashboard', ['index.html', 'text/html; charset=utf-8']],
    ['/workbench.css', ['style.css', 'text/css; charset=utf-8']],
    ['/workbench.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
    ['/brief.mjs', ['brief.mjs', 'text/javascript; charset=utf-8']],
    ['/templates.mjs', ['templates.mjs', 'text/javascript; charset=utf-8']],
    ['/templates/daily', ['templates/daily.html', 'text/html; charset=utf-8']],
    ['/templates/invite', ['templates/invite.html', 'text/html; charset=utf-8']],
    ['/templates/report', ['templates/report.html', 'text/html; charset=utf-8']],
  ]);
  const content = new Map(await Promise.all([...routes].map(async ([path, [file, type]]) => [path, {body: await readFile(join(root, file)), type}])));
  const server = createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, {'allow':'GET, HEAD'}); response.end(); return;
    }
    const entry = content.get(request.url);
    if (!entry) {response.writeHead(404); response.end('Not found'); return;}
    response.writeHead(200, {
      'content-type': entry.type, 'cache-control':'no-store', 'x-content-type-options':'nosniff',
      'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'",
      'referrer-policy': 'no-referrer',
    });
    response.end(request.method === 'HEAD' ? undefined : entry.body);
  });
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(context.listen.port,context.listen.host,()=>{server.off('error',reject);resolve();});
  });
  context.logger.info('livepage.workbench.ready');
  let disposed=false;
  const dispose=async()=>{
    if(disposed)return;disposed=true;
    context.signal.removeEventListener('abort',onAbort);
    await new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();});
  };
  const onAbort=()=>{void dispose();};
  context.signal.addEventListener('abort',onAbort,{once:true});
  if(context.signal.aborted)await dispose();
  return {dispose};
}
