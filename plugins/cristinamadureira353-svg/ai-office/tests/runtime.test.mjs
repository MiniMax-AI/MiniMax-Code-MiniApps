import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fixture } from './fixture.mjs';

test('MiniApp runtime and private Python bridge', async t => {
  const f = await fixture();
  const source = await promisify(execFile)(process.env.AI_OFFICE_TEST_PYTHON, ['-c',
    'import sys,json; sys.path.insert(0,sys.argv[1]); import game,save; g=game.Game(); g.day=6; g.money=777; print(json.dumps(save.snapshot(g,"只读继承测试"),ensure_ascii=False))',
    join(f.pluginRoot, 'miniapp/node/backend/server')], {env:{...process.env, AI_OFFICE_ENV_PATH:f.settings.envFile}});
  f.settings.initialSave = join(f.scratch, 'original.json');
  await writeFile(f.settings.initialSave, source.stdout);
  try {
    await t.test('start serves setup without launching Python or paid APIs', async () => {
      assert.equal((await f.get('/api/settings')).configured, false);
      assert.match(await (await fetch(f.base + '/ai-office')).text(), /复制引导提示词/);
      assert.equal((await readdir(f.dataDir)).length, 0);
    });
    await t.test('rejects remote origins and arbitrary files', async () => {
      assert.equal((await fetch(f.base + '/api/state', {headers:{origin:'https://outside.invalid'}})).status, 403);
      assert.equal((await fetch(f.base + '/.env')).status, 404);
      assert.equal((await fetch(f.base + '/api/unknown')).status, 404);
    });
    await t.test('serves compressed engine as a valid WASM response', async () => {
      const response = await fetch(f.base + '/game/game.wasm');
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'application/wasm');
      assert.equal(response.headers.get('content-encoding'), 'gzip');
      const bytes = new Uint8Array(await response.arrayBuffer());
      assert.deepEqual([...bytes.slice(0,4)], [0,97,115,109]);
    });
    await t.test('validates and atomically stores interpreter and env paths', async () => {
      assert.equal((await (await f.post('/api/settings', {pythonPath:'relative', envFile:f.settings.envFile})).json()).ok, false);
      assert.equal((await (await f.post('/api/settings', f.settings)).json()).ok, true);
      assert.deepEqual(JSON.parse(await readFile(join(f.dataDir, 'settings.json'), 'utf8')), f.settings);
      assert.equal((await stat(join(f.dataDir, 'settings.json'))).mode & 0o777, 0o600);
    });
    await t.test('state is V5 and quota failure returns gameplay status through SSE', async () => {
      const initial = await f.get('/api/state');
      assert.equal(initial.gameplay_version, 5);
      assert.equal(initial.day, 6);
      assert.equal(initial.money, 777);
      const response = await f.post('/api/chat', {who:'kimi', text:'测试一下'});
      const text = await response.text();
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /text\/event-stream/);
      assert.match(text, /脑袋宕机了/);
      const state = await f.get('/api/state');
      const kimi = state.workers.find(w => w.id === 'kimi');
      assert.equal(kimi.brain_down, true);
      assert.equal(kimi.acting, '脑袋宕机了');
      assert.equal(kimi.typing, false);
      assert.equal(state.workers.find(w => w.id === 'longcat').brain_down, false);
    });
    await t.test('disabled role has no further model calls and peers remain usable', async () => {
      const before = await readFile(join(f.dataDir, 'calls.jsonl'), 'utf8');
      assert.match(await (await f.post('/api/chat', {who:'kimi', text:'继续'})).text(), /脑袋宕机了/);
      assert.equal((await (await f.post('/api/command', {who:'kimi', action:'goto', arg:'desk'})).json()).ok, false);
      assert.equal(await readFile(join(f.dataDir, 'calls.jsonl'), 'utf8'), before);
      assert.match(await (await f.post('/api/chat', {who:'longcat', text:'你好'})).text(), /老板找我啥事/);
    });
    await t.test('settings cannot switch a running backend', async () => {
      assert.equal((await (await f.post('/api/settings', f.settings)).json()).ok, false);
      assert.deepEqual(JSON.parse(await readFile(join(f.dataDir, 'settings.json'), 'utf8')), f.settings);
    });
    await t.test('save and shutdown persist only inside Host dataDir and reap the child', async () => {
      assert.equal((await (await f.post('/api/save', {name:'MiniApp测试'})).json()).ok, true);
      const pid = Number(await readFile(join(f.dataDir, 'fixture-pid'), 'utf8'));
      await f.dispose();
      assert.throws(() => process.kill(pid, 0), /ESRCH/);
      await assert.rejects(fetch(f.base + '/api/state'));
      assert.equal((await readdir(join(f.dataDir, 'saves'))).length >= 3, true);
      assert.equal(await readFile(f.settings.initialSave, 'utf8'), source.stdout);
      assert.equal((await readdir(f.dataDir)).includes('network-attempt'), false);
    });
    await t.test('restart restores shutdown and manual reboot probes once', async () => {
      const files = await readdir(join(f.dataDir, 'saves'));
      const old = JSON.parse(await readFile(join(f.dataDir, 'saves', files[0]), 'utf8'));
      old.saved_at = 1;
      old.workers.forEach(w => { w.brain_down = false; });
      await writeFile(join(f.dataDir, 'saves', '更旧档.json'), JSON.stringify(old));
      await f.restart();
      assert.equal((await f.get('/api/state')).workers.find(w => w.id === 'kimi').brain_down, true);
      const before = (await readFile(join(f.dataDir, 'calls.jsonl'), 'utf8')).trim().split('\n').length;
      await writeFile(join(f.dataDir, 'quota-restored'), 'true');
      assert.equal((await (await f.post('/api/command', {who:'kimi', action:'reboot'})).json()).ok, true);
      for (let i=0; i<20; i++) {
        if (!(await f.get('/api/state')).workers.find(w => w.id === 'kimi').brain_down) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal((await f.get('/api/state')).workers.find(w => w.id === 'kimi').brain_down, false);
      assert.equal((await readFile(join(f.dataDir, 'calls.jsonl'), 'utf8')).trim().split('\n').length, before + 1);
      assert.equal((await readdir(f.dataDir)).includes('network-attempt'), false);
      assert.equal(f.logs.some(line => line.includes('fake-test-key')), false);
    });
  } finally {
    await f.dispose();
    await rm(f.scratch, {recursive:true, force:true});
  }
});
