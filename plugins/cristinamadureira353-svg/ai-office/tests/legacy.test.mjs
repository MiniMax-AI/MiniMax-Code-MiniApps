import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { createRequire } from 'node:module';
import { fixture } from './fixture.mjs';

test('legacy conflict save: complete state, preserved deliveries, reopening and usable Web UI', {timeout:60000}, async () => {
  const f = await fixture();
  const evidence = resolve(process.env.AI_OFFICE_TEST_EVIDENCE);
  await mkdir(evidence, {recursive:true});
  let browser;
    const errors = [], selected = [];
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    const source = await promisify(execFile)(process.env.AI_OFFICE_TEST_PYTHON, ['-c', `
import json,sys
sys.path.insert(0,sys.argv[1])
import game as G,save as S
g=G.Game();g.money=869;g.rep=59;g.tick=81175
for i,(status,who) in enumerate([('待验收','step5'),('待验收','longcat'),('冲突中',None)]):
    c=G.Client('测试订单'+str(i),96,200,'document','normal');c.id='legacy-'+str(i);c.slot=i;c.status=status;c.served_by=who
    c.result='完整测试交付物'+str(i) if who else None
    g.clients.append(c);g.slots[i]=c
g.conflicts={'legacy-2':None}
d=S.snapshot(g);d.pop('conflict_data',None)
print(json.dumps(d,ensure_ascii=False))
`, join(f.pluginRoot,'miniapp/node/backend/server')], {env:{...process.env,AI_OFFICE_ENV_PATH:f.settings.envFile,AI_OFFICE_SAVE_DIR:join(f.dataDir,'saves'),PYTHONDONTWRITEBYTECODE:'1'}});
    f.settings.initialSave = join(f.scratch, 'legacy.json');
    await writeFile(f.settings.initialSave, source.stdout);
    assert.equal((await (await f.post('/api/settings', f.settings)).json()).ok, true);
    const response = await fetch(f.base+'/api/state');
    assert.equal(response.status, 200, 'legacy conflict IDs must not break the entire state endpoint');
    const before = await response.json();
    assert.equal(before.workers.length, 5);
    assert.equal(before.clients.length, 3);
    assert.deepEqual(before.conflicts, []);
    assert.deepEqual([before.day,before.money,before.rep,before.tick], [1,869,59,81175]);
    assert.equal(before.clients[2].status, '等待');
    for (const i of [0,1]) {
      assert.equal(before.clients[i].status, '待验收');
      assert.equal(before.clients[i].result, '完整测试交付物'+i);
    }
    await f.dispose();
    await f.restart();
    const reopened = await f.get('/api/state');
    assert.ok(isDeepStrictEqual(reopened.clients, before.clients), 'reopening preserves recovered order states and deliveries');
    assert.deepEqual(reopened.conflicts, []);
    const {chromium} = createRequire(join(process.env.AI_OFFICE_TEST_NODE_MODULES,'package.json'))('playwright');
    browser = await chromium.launch({headless:true,executablePath:process.env.AI_OFFICE_TEST_CHROMIUM,
      args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    const page = await browser.newPage({viewport:{width:1102,height:957}});
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type()==='error' && !message.text().includes('status of 500')) errors.push(message.text());
    });
    await page.route(f.base+'/api/state', route => route.fulfill({status:500, contentType:'application/json',body:'{"ok":false,"error":"internal"}'}));
    await page.goto(f.base+'/ai-office');
    const canvas = page.frameLocator('#game').locator('#canvas');
    await canvas.waitFor({state:'visible'});
    await page.waitForFunction(() => document.querySelector('#game').contentWindow.AIOfficeStream && !document.querySelector('#game').contentWindow.document.querySelector('#status'));
    await pause(1000);
    await page.screenshot({path:join(evidence, 'state-unavailable-feedback.png')});
    await page.unroute(f.base+'/api/state');
    await pause(1400);
    await page.screenshot({path:join(evidence, 'legacy-state-ui-recovered.png')});
    await writeFile(join(f.dataDir,'quota-restored'), 'true');
    const scale = 1102/1120, width = 1120, height = 957/scale;
    const cardWidth = (width-128)/5;
    for (const [i,who] of ['m3','flash','longcat','kimi','step5'].entries()) {
      // 点击五张身份卡并向隔离模型发送，验证恢复后的交互路径。
      await canvas.click({position:{x:(44+i*(cardWidth+10)+cardWidth-37)*scale,y:(height-120+23)*scale}});
      await pause(180);
      const text = 'restored '+who;
      await page.keyboard.type(text, {delay:30});
      await page.keyboard.press('Enter');
      let delivered = false;
      for (let attempt=0; attempt<30; attempt++) {
        const calls = (await readFile(join(f.dataDir,'calls.jsonl'),'utf8').catch(()=>'')).trim().split('\n').filter(Boolean).map(JSON.parse);
        if (calls.some(call=>call.who===who && call.text.includes(text))) { delivered=true; break; }
        await pause(100);
      }
      assert.ok(delivered, who+' restored chat accepts input and reaches the isolated model');
      selected.push(who);
      await pause(150);
      await page.keyboard.press('Escape');
      await pause(100);
    }
    assert.equal(await readFile(f.settings.initialSave,'utf8'), source.stdout, 'initial legacy save remains read-only');
    assert.equal((await readdir(f.dataDir)).includes('network-attempt'), false);
    assert.equal((await readFile(join(f.dataDir,'calls.jsonl'),'utf8')).trim().split('\n').length, 5, 'only five intentional fake chat calls');
    assert.deepEqual(errors, []);
    await writeFile(join(evidence,'legacy-state-web.json'),JSON.stringify({http:response.status,day:before.day,money:before.money,rep:before.rep,
      workers:before.workers.map(w=>w.id),clients:before.clients.map(c=>({id:c.id,status:c.status,served_by:c.served_by})),selected,errors},null,2));
  } finally {
    await browser?.close();
    await f.dispose();
    await rm(f.scratch,{recursive:true,force:true});
  }
});
