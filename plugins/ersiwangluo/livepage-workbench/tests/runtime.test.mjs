import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { start } from '../miniapp/node/server.mjs';
import { buildBrief } from '../miniapp/client/brief.mjs';

test('brief preserves user text and leaves publication as an explicit choice',()=>{
 const b=buildBrief('daily','<script>alert(1)</script>','采购团队');
 assert.ok(b.includes('<script>alert(1)</script>'));
 assert.ok(b.includes('采购团队'));
 assert.ok(b.includes('先生成本地 HTML 预览，不上传、不发布'));
 assert.throws(()=>buildBrief('unknown','x',''),/scene/);
});

test('runtime serves only bundled routes and disposes cleanly',async()=>{
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const controller=new AbortController();
 const life=await start({pluginRoot:fileURLToPath(new URL('../',import.meta.url)),listen:{host:'127.0.0.1',port},signal:controller.signal,logger:{info(){},error(){}}});
 try {
  const base=`http://127.0.0.1:${port}`;
  assert.equal((await fetch(base+'/dashboard')).status,200);
  for(const p of ['/templates/daily','/templates/invite','/templates/report']) {const r=await fetch(base+p);assert.equal(r.status,200);assert.match(await r.text(),/演示/);}
  for(const p of ['/secret','/package.json','/templates/unknown','/dashboard?file=/etc/passwd']) {const r=await fetch(base+p);assert.equal(r.status,404,p);}
  assert.equal((await fetch(base+'/dashboard',{method:'POST',body:'secret'})).status,405);
 } finally {await life.dispose();await life.dispose();}
 await assert.rejects(fetch(`http://127.0.0.1:${port}/dashboard`));
});
