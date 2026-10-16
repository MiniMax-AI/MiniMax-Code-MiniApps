import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fixture } from './fixture.mjs';

test('conflict popup: four real mouse choices reach Game.judge and close the modal', {timeout:90000}, async t => {
  const f = await fixture({conflict:true});
  const {chromium} = createRequire(join(process.env.AI_OFFICE_TEST_NODE_MODULES, 'package.json'))('playwright');
  const evidence = resolve(process.env.AI_OFFICE_TEST_EVIDENCE);
  await mkdir(evidence, {recursive:true});
  let browser;
  const errors = [], commands = [], replies = [], results = [], responseReads = [];
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const waitFor = async predicate => {
    for (let i=0; i<40; i++) { if (await predicate()) return; await pause(100); }
    throw new Error('Popup click did not complete the expected judgement');
  };
  try {
    assert.equal((await (await f.post('/api/settings', f.settings)).json()).ok, true);
    await t.test('pending conflict survives closing and reopening with dialogue and progress', async () => {
      const before = await f.get('/api/state');
      await f.dispose();
      await f.restart();
      const after = await f.get('/api/state');
      assert.deepEqual(after.conflicts, before.conflicts, 'original participants and dialogue survive reopening');
      assert.equal(after.day, before.day);
      assert.equal(after.money, before.money);
      assert.deepEqual(after.clients, before.clients);
    });
    browser = await chromium.launch({headless:true, executablePath:process.env.AI_OFFICE_TEST_CHROMIUM,
      args:['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
    const page = await browser.newPage({viewport:{width:879,height:534}});
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type()==='error') errors.push(message.text()); });
    page.on('request', request => {
      if (request.url()===f.base+'/api/command' && request.method()==='POST') commands.push(JSON.parse(request.postData()));
    });
    page.on('response', response => {
      if (response.url()===f.base+'/api/command')
        responseReads.push(response.json().then(reply => replies.push(reply)).catch(error => errors.push(error.message)));
    });
    await page.goto(f.base+'/ai-office');
    const canvas = page.frameLocator('#game').locator('#canvas');
    await canvas.waitFor({state:'visible'});
    await page.waitForFunction(() => document.querySelector('#game').contentWindow.AIOfficeStream && !document.querySelector('#game').contentWindow.document.querySelector('#status'));
    await pause(600);
    const button = index => {
      const {width,height} = page.viewportSize();
      const scale = Math.min(width/1120, height/720);
      const x = (width/scale-620)/2 + 24 + index*(135.5+10) + 135.5/2;
      const y = (height/scale-390)/2 + 390 - 60 + 18;
      return {x:x*scale,y:y*scale};
    };
    const stage = process.env.AI_OFFICE_CONFLICT_STAGE || 'after';
    await page.screenshot({path:join(evidence, 'conflict-'+stage+'-popup.png')});
    for (const [index,kind] of ['a','b','reject','scold'].entries()) {
      await t.test('choice '+kind, async () => {
        const conflict = await f.resetConflict();
        await pause(700);
        const before = commands.length;
        await canvas.click({position:button(index)});
        await waitFor(() => commands.length > before);
        assert.equal(commands.length, before+1, 'one click sends one judgement');
        assert.equal(commands.at(-1).action, 'judge');
        assert.equal(commands.at(-1).arg, conflict.client);
        assert.equal(commands.at(-1).kind, kind, 'the API receives the chosen kind');
        await waitFor(async () => !(await f.get('/api/state')).conflicts.length);
        const state = await f.get('/api/state');
        const customer = state.clients.find(c => c.id===conflict.client);
        const m3 = state.workers.find(w => w.id==='m3'), flash = state.workers.find(w => w.id==='flash');
        const winner = {a:'m3',b:'flash'}[kind] || null;
        assert.equal(customer.served_by, winner);
        assert.equal(customer.status, winner ? '抢单中' : '等待');
        assert.equal(m3.mood, {a:73,b:62,reject:65,scold:67}[kind]);
        assert.equal(flash.mood, {a:62,b:73,reject:65,scold:67}[kind]);
        if (!winner) assert.equal(customer.patience, 150);
        await pause(700);
        // 裁决成功后再次点击原按钮位置，不应再发请求，证明弹窗已关闭。
        await canvas.click({position:button(index)});
        await pause(200);
        assert.equal(commands.length, before+1, 'resolved modal no longer intercepts clicks');
        results.push({kind,client:conflict.client,winner,status:customer.status,mood:{m3:m3.mood,flash:flash.mood}});
        await page.screenshot({path:join(evidence, 'conflict-'+stage+'-'+kind+'-resolved.png')});
      });
    }
    await t.test('failed request shows feedback and allows a real retry', async () => {
      const conflict = await f.resetConflict();
      await pause(700);
      await page.route(f.base+'/api/command', route => route.fulfill({status:200,
        contentType:'application/json',body:JSON.stringify({ok:false,msg:'测试连接失败，请重新选择'})}), {times:1});
      const before = commands.length, replyBefore = replies.length;
      await canvas.click({position:button(0)});
      await waitFor(() => replies.length > replyBefore);
      assert.equal(replies.at(-1).ok, false);
      assert.equal((await f.get('/api/state')).conflicts[0].client, conflict.client, 'failed request keeps the unresolved order');
      await pause(500);
      await page.screenshot({path:join(evidence, 'conflict-'+stage+'-retry-feedback.png')});
      await canvas.click({position:button(1)});
      await waitFor(async () => !(await f.get('/api/state')).conflicts.length);
      assert.equal(commands.length, before+2);
      assert.equal(commands.at(-1).kind, 'b');
      assert.equal((await f.get('/api/state')).clients.find(c => c.id===conflict.client).served_by, 'flash');
      results.push({scenario:'failure-retry',client:conflict.client,winner:'flash'});
    });
    await t.test('slow response disables all choices and submits only once', async () => {
      await f.resetConflict();
      await pause(700);
      await page.route(f.base+'/api/command', async route => { await pause(1000); await route.continue(); }, {times:1});
      const before = commands.length;
      await canvas.click({position:button(0)});
      await canvas.click({position:button(3)});
      await pause(100);
      await page.screenshot({path:join(evidence, 'conflict-'+stage+'-submitting.png')});
      assert.equal(commands.length, before+1, 'clicking another choice during submission sends no second request');
      await waitFor(async () => !(await f.get('/api/state')).conflicts.length);
      assert.equal(commands.at(-1).kind, 'a');
      results.push({scenario:'slow-response',requests:1});
    });
    const received = (await readFile(join(f.dataDir,'commands.jsonl'),'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(JSON.parse);
    assert.equal(received.filter(c => c.action==='judge').length, 6, 'real backend processed four choices, a retry and one delayed submission');
    assert.equal((await readdir(f.dataDir)).includes('network-attempt'), false);
    assert.equal((await readdir(f.dataDir)).includes('calls.jsonl'), false, 'judgement verification consumes no model calls');
    await Promise.all(responseReads);
    assert.deepEqual(errors, []);
  } finally {
    await Promise.all(responseReads);
    await writeFile(join(evidence, 'conflict-'+(process.env.AI_OFFICE_CONFLICT_STAGE || 'after')+'-results.json'), JSON.stringify({commands,replies,results,errors},null,2));
    await browser?.close();
    await f.dispose();
    await rm(f.scratch,{recursive:true,force:true});
  }
});
