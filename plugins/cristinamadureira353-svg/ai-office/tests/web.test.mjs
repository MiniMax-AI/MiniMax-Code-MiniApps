import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fixture } from './fixture.mjs';

test('rest area seating aligns with cushions and shifted workers remain clickable', {timeout:90000}, async () => {
  const f=await fixture({resting:true});
  const {chromium}=createRequire(join(process.env.AI_OFFICE_TEST_NODE_MODULES,'package.json'))('playwright');
  const evidence=resolve(process.env.AI_OFFICE_TEST_EVIDENCE);
  await mkdir(evidence,{recursive:true});
  let browser;
  const errors=[],commands=[];
  try {
    assert.equal((await(await f.post('/api/settings',f.settings)).json()).ok,true);
    browser=await chromium.launch({headless:true,executablePath:process.env.AI_OFFICE_TEST_CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:2});
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error') errors.push(message.text());});
    page.on('request',request=>{
      if(request.url()===f.base+'/api/command' && request.method()==='POST') commands.push(JSON.parse(request.postData()));
    });
    await page.goto(f.base+'/ai-office');
    const canvas=page.frameLocator('#game').locator('#canvas');
    await canvas.waitFor({state:'visible'});
    await page.waitForFunction(()=>document.querySelector('#game').contentWindow.AIOfficeStream && !document.querySelector('#game').contentWindow.document.querySelector('#status'));
    const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    // 后端位置是固定的隔离夹具；前端仍实际寻路，从工位走到休息区。
    await pause(14000);
    const scale=Math.min(1600/1120,1000/720),width=1600/scale,height=1000/scale;
    const usable={w:Math.max(400,width-424),h:Math.max(300,height-282)};
    const zoom=Math.min(usable.w/1280,usable.h/768);
    const origin={x:24+usable.w/2-640*zoom,y:94+usable.h/2-384*zoom};
    const stage=process.env.AI_OFFICE_SEATING_STAGE || 'after';
    await page.screenshot({path:join(evidence,'rest-seating-'+stage+'-overview.png')});
    await page.screenshot({path:join(evidence,'rest-seating-'+stage+'-detail.png'),clip:{
      x:(origin.x+14*32*zoom)*scale,y:(origin.y+17*32*zoom)*scale,
      width:14*32*zoom*scale,height:6.4*32*zoom*scale}});
    for(const [who,x,y] of [['flash',18,20.8],['longcat',19.7,20.8],['step5',22.6,21.2]]) {
      await canvas.click({position:{x:(origin.x+x*32*zoom)*scale,y:(origin.y+(y*32-24)*zoom)*scale}});
      await pause(200);
      if(who==='flash') await page.screenshot({path:join(evidence,'rest-seating-'+stage+'-selected.png')});
      await canvas.click({position:{x:(width-292)*scale,y:396*scale}});
      for(let i=0;i<20 && !commands.some(c=>c.who===who);i++) await pause(100);
      assert.ok(commands.some(c=>c.who===who && c.action==='goto' && c.arg==='lounge'),who+' can be selected at its rendered torso');
      await page.keyboard.press('Escape');
      await pause(200);
    }
    assert.equal((await readdir(f.dataDir)).includes('network-attempt'),false);
    assert.equal((await readdir(f.dataDir)).includes('calls.jsonl'),false,'movement and seating never invoke a model');
    assert.deepEqual(errors,[]);
    await writeFile(join(evidence,'rest-seating-web.json'),JSON.stringify({commands,errors,workers:(await f.get('/api/state')).workers.map(w=>({id:w.id,x:w.x,y:w.y,acting:w.acting}))},null,2));
  } finally {
    await writeFile(join(evidence,'rest-seating-'+(process.env.AI_OFFICE_SEATING_STAGE || 'after')+'-console.json'),JSON.stringify({errors,commands},null,2));
    await browser?.close();
    await f.dispose();
    await rm(f.scratch,{recursive:true,force:true});
  }
});

test('exported Godot Web: readable UI, employee clicks with a client open, and five chats', {timeout:90000}, async () => {
  const f = await fixture({client:true});
  const dependencies = process.env.AI_OFFICE_TEST_NODE_MODULES;
  const {chromium} = createRequire(join(dependencies, 'package.json'))('playwright');
  const evidence = resolve(process.env.AI_OFFICE_TEST_EVIDENCE);
  await mkdir(evidence, {recursive:true});
  let browser;
  const errors = [], logs = [];
  const commands = [];
  try {
    browser = await chromium.launch({headless:true,
      executablePath:process.env.AI_OFFICE_TEST_CHROMIUM,
      args:['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
    const page = await browser.newPage({viewport:{width:854,height:568}});
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {origin:f.base});
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { logs.push(message.text()); if (message.type() === 'error') errors.push(message.text()); });
    page.on('request', request => {
      if (request.url() === f.base + '/api/command' && request.method() === 'POST')
        commands.push(JSON.parse(request.postData()));
    });
    await page.goto(f.base + '/ai-office');
    await page.locator('#setup').waitFor({state:'visible'});
    await page.waitForFunction(() => !document.querySelector('#copy').disabled);
    assert.equal(await page.locator('#setup input').count(), 0, 'users do not fill technical paths');
    const prompt = await page.locator('#prompt').inputValue();
    assert.match(prompt,/首次启动向导/);
    assert.match(prompt,/没有 Key/);
    assert.match(prompt,/单独引导 Jev/);
    assert.equal(await page.getByText('Jev · OpenRouter（可选）', {exact:true}).count(), 1);
    assert.match(await page.locator('#setup small').textContent(), /Jev 使用 OpenRouter Key/);
    assert.doesNotMatch(prompt.split('本次运行信息（由 MiniApp 自动提供')[0],/ai-model-party|\/(?:Users|home)\/[^/\s]+|[A-Z]:\\Users\\|当前工作区/);
    assert.ok(prompt.includes(f.base + '/api/settings'), 'copyable prompt targets this exact MiniApp');
    for (const key of ['MINIMAX_API_KEY', 'LONGCAT_API_KEY', 'KIMI_API_KEY', 'STEPFUN_API_KEY', 'OPENROUTER_API_KEY'])
      assert.ok(prompt.includes(key));
    await page.screenshot({path:join(evidence, 'miniapp-ai-setup-desktop.png')});
    await page.getByRole('button', {name:'复制引导提示词'}).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), prompt, 'copy button copies the full prompt');
    await page.evaluate(() => {
      navigator.clipboard.writeText = async () => { throw new Error('simulated Host clipboard restriction'); };
      document.execCommand = () => false;
    });
    await page.getByRole('button', {name:'复制引导提示词'}).click();
    assert.match(await page.locator('#message').textContent(), /提示词已选中/);
    assert.equal(await page.locator('#prompt').evaluate(el => el.selectionEnd - el.selectionStart), prompt.length);
    await page.getByRole('button', {name:'检查配置'}).click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('配置还未保存'));
    await page.setViewportSize({width:390,height:700});
    const bounds = await page.locator('#setup').evaluate(root => ({
      viewport:document.documentElement.clientWidth,
      width:document.documentElement.scrollWidth,
      children:[...root.querySelectorAll('textarea,button,.keys')].map(el => {
        const rect=el.getBoundingClientRect();return {left:rect.left,right:rect.right};
      })
    }));
    assert.ok(bounds.width <= bounds.viewport, 'narrow panel has no horizontal overflow');
    assert.ok(bounds.children.every(rect => rect.left >= 0 && rect.right <= bounds.viewport));
    await page.screenshot({path:join(evidence, 'miniapp-ai-setup-narrow.png'),fullPage:true});
    await writeFile(join(evidence, 'miniapp-ai-setup-bounds.json'), JSON.stringify(bounds,null,2));
    await page.setViewportSize({width:1102,height:957});
    await writeFile(join(f.dataDir, 'quota-restored'), 'initially available');
    assert.equal((await (await f.post('/api/settings', f.settings)).json()).ok, true, 'AI completes setup using the local API');
    await page.locator('#game').waitFor({state:'visible',timeout:6000});
    assert.equal(await page.locator('#setup').isVisible(), false, 'saved config automatically enters the game');
    const frame = page.frameLocator('#game');
    await frame.locator('#canvas').waitFor({state:'visible'});
    await page.waitForFunction(() => {
      const frame = document.querySelector('#game').contentWindow;
      return frame.AIOfficeStream && !frame.document.querySelector('#status');
    }, {timeout:30000});
    for (let i=0; i<40 && !logs.some(line => line.includes('[MAIN] 后端 已连接')); i++)
      await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(logs.some(line => line.includes('[MAIN] 后端 已连接')), true, 'real Godot Web must poll this MiniApp backend');
    const canvas = frame.locator('#canvas');
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const geometry = () => {
      const {width,height} = page.viewportSize();
      const scale = Math.min(width / 1120, height / 720);
      return {width:width/scale,height:height/scale,scale};
    };
    const click = async (x,y) => {
      const {scale} = geometry();
      await canvas.click({position:{x:x*scale,y:y*scale}});
      await pause(180);
    };
    const card = index => {
      const {width,height} = geometry();
      const w = (width - 128) / 5;
      return {x:44 + index * (w+10),y:height-120,w};
    };
    const chatFrame = () => {
      const {width,height} = geometry();
      const w=Math.min(620,width-48),h=Math.min(560,height-96);
      return {x:(width-w)/2,y:(height-h)/2,w,h};
    };
    const calls = async () => (await readFile(join(f.dataDir,'calls.jsonl'),'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const waitFor = async predicate => {
      for(let i=0;i<40;i++) { if(await predicate()) return; await pause(100); }
      throw new Error('Expected UI action did not reach the isolated backend');
    };
    await pause(400);
    await page.screenshot({path:join(evidence, 'miniapp-web-healthy.png')});
    await click(geometry().width-184,160);
    await page.screenshot({path:join(evidence, 'miniapp-web-client.png')});
    const beforeDisabled = commands.length;
    await click(geometry().width-320,418);
    assert.equal(commands.length,beforeDisabled,'busy employee button must explain its state without dispatching');
    await page.screenshot({path:join(evidence, 'miniapp-web-disabled-feedback.png')});
    // 在客户详情可见的情况下逐个选中员工，并验证指令、直接聊天、自动聚焦与发送。
    for (const [i,who] of ['m3','flash','longcat','kimi','step5'].entries()) {
      await click(geometry().width-184,160);
      let row=card(i);
      await click(row.x+22,row.y+36);
      if(i===0) await page.screenshot({path:join(evidence, 'miniapp-web-selected.png')});
      await click(geometry().width-292,396);
      await waitFor(() => commands.some(command => command.who===who && command.action==='goto' && command.arg==='lounge'));
      await page.keyboard.press('Escape');
      await pause(150);
      await click(geometry().width-184,160);
      row=card(i);
      await click(row.x+row.w-37,row.y+23);
      if(i===0) await page.screenshot({path:join(evidence, 'miniapp-web-before-input.png')});
      const message='hello '+who;
      await page.keyboard.type(message,{delay:40});
      if(i===0) {
        await page.screenshot({path:join(evidence,'miniapp-web-draft.png')});
        await writeFile(join(evidence,'miniapp-web-canvas.json'),JSON.stringify(await page.evaluate(() => {
          const frame=document.querySelector('#game').contentWindow;
          const canvas=frame.document.querySelector('#canvas');
          return {canvas:canvas.getBoundingClientRect().toJSON(),width:canvas.width,height:canvas.height,active:frame.document.activeElement?.tagName,
            editable:[...frame.document.querySelectorAll('[contenteditable]')].map(el=>({rect:el.getBoundingClientRect().toJSON(),pointerEvents:el.style.pointerEvents}))};
        }),null,2));
      }
      if(i===1) await page.keyboard.press('Enter');
      else { const panel=chatFrame(); await click(panel.x+panel.w-74,panel.y+panel.h-88); }
      if(i===0) await page.screenshot({path:join(evidence,'miniapp-web-after-send.png')});
      await waitFor(async () => (await calls()).some(call => call.who===who && call.text.includes(message)));
      await pause(300);
      await page.screenshot({path:join(evidence, 'miniapp-web-chat-'+who+'.png')});
      const panel=chatFrame();
      await click(panel.x+panel.w-74,panel.y+37);
    }
    assert.equal((await calls()).filter(call => call.text.includes('hello ')).length,5,'each employee gets exactly one UI chat');
    await rm(join(f.dataDir,'quota-restored'));
    await (await f.post('/api/chat', {who:'kimi', text:'模拟额度耗尽'})).text();
    await pause(650);
    const downCard=card(3);
    const callsBefore = (await calls()).length;
    await click(downCard.x+downCard.w-37,downCard.y+23);
    assert.equal((await calls()).length,callsBefore,'down employee chat entry must not call the model');
    await page.screenshot({path:join(evidence, 'miniapp-web-brain-down.png')});
    assert.equal((await f.get('/api/state')).workers.find(w => w.id === 'kimi').brain_down, true);
    await click(geometry().width-206,348);
    await waitFor(async () => (await calls()).length===callsBefore+1);
    assert.equal((await f.get('/api/state')).workers.find(w => w.id === 'kimi').brain_down, true);
    assert.equal((await calls()).length, callsBefore+1,'visible reboot control must perform exactly one probe');
    await page.keyboard.press('Escape');
    const sizes=[];
    for(const viewport of [{width:854,height:568},{width:1280,height:800},{width:1600,height:1000}]) {
      await page.setViewportSize(viewport);
      await pause(400);
      const row=card(4);
      await click(row.x+row.w-37,row.y+23);
      await page.keyboard.type('resize '+viewport.width,{delay:40});
      await pause(120);
      await page.keyboard.press('Enter');
      await waitFor(async () => (await calls()).some(call => call.who==='step5' && call.text.includes('resize '+viewport.width)));
      await pause(200);
      await page.screenshot({path:join(evidence, 'miniapp-web-'+viewport.width+'.png')});
      const panel=chatFrame();
      await click(panel.x+panel.w-74,panel.y+37);
      const g=geometry();
      sizes.push({...viewport,body_pixels:16*g.scale,secondary_pixels:14*g.scale});
    }
    await writeFile(join(evidence,'miniapp-web-actions.json'),JSON.stringify({commands,calls:await calls(),sizes},null,2));
    assert.equal((await readdir(f.dataDir)).includes('network-attempt'), false);
    await page.reload();
    await page.locator('#game').waitFor({state:'visible'});
    assert.equal(await page.locator('#setup').isVisible(), false, 'future opens skip first setup');
    assert.deepEqual(errors, []);
  } finally {
    await writeFile(join(evidence, 'miniapp-web-console.json'), JSON.stringify({logs, errors}, null, 2));
    await browser?.close();
    await f.dispose();
    await rm(f.scratch, {recursive:true,force:true});
  }
});

test('HiDPI canvas keeps readable labels and direct chat input', {timeout:45000}, async () => {
  const f=await fixture();
  const {chromium}=createRequire(join(process.env.AI_OFFICE_TEST_NODE_MODULES,'package.json'))('playwright');
  const evidence=resolve(process.env.AI_OFFICE_TEST_EVIDENCE);
  let browser;
  try {
    assert.equal((await (await f.post('/api/settings',f.settings)).json()).ok,true);
    browser=await chromium.launch({headless:true,executablePath:process.env.AI_OFFICE_TEST_CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    const page=await browser.newPage({viewport:{width:1102,height:957},deviceScaleFactor:2});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error') errors.push(message.text());});
    await page.goto(f.base+'/ai-office');
    await page.frameLocator('#game').locator('#canvas').waitFor({state:'visible'});
    await page.waitForFunction(()=>document.querySelector('#game').contentWindow.AIOfficeStream && !document.querySelector('#game').contentWindow.document.querySelector('#status'));
    await new Promise(resolve=>setTimeout(resolve,900));
    await page.screenshot({path:join(evidence,'miniapp-web-retina-overview.png')});
    const canvas=page.frameLocator('#game').locator('#canvas');
    await canvas.click({position:{x:1023,y:862}});
    await new Promise(resolve=>setTimeout(resolve,200));
    await page.keyboard.type('retina',{delay:40});
    await new Promise(resolve=>setTimeout(resolve,120));
    await page.keyboard.press('Enter');
    let calls='';
    for(let i=0;i<40;i++) {
      calls=await readFile(join(f.dataDir,'calls.jsonl'),'utf8').catch(()=> '');
      if(calls.includes('retina')) break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.match(calls,/retina/);
    assert.equal(JSON.parse(calls.trim().split('\n').at(-1)).who,'step5');
    await new Promise(resolve=>setTimeout(resolve,250));
    await page.screenshot({path:join(evidence,'miniapp-web-retina-chat.png')});
    const metrics=await canvas.evaluate(el=>({width:el.width,height:el.height,cssWidth:el.clientWidth,cssHeight:el.clientHeight,dpr:window.devicePixelRatio}));
    assert.equal(metrics.dpr,2);
    assert.equal(metrics.width,metrics.cssWidth*2);
    await writeFile(join(evidence,'miniapp-web-retina.json'),JSON.stringify({metrics,errors},null,2));
    assert.deepEqual(errors,[]);
    assert.equal((await readdir(f.dataDir)).includes('network-attempt'),false);
  } finally {
    await browser?.close();
    await f.dispose();
    await rm(f.scratch,{recursive:true,force:true});
  }
});
