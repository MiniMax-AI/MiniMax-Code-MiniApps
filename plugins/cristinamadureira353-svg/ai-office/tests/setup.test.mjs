import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat, writeFile, chmod, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './fixture.mjs';

test('AI-assisted first setup and persistent configuration', async t => {
  const f = await fixture();
  const originalEnv = await readFile(f.settings.envFile, 'utf8');
  try {
    await t.test('prompt contains live connection details and the required Key names', async () => {
      const data = await f.get('/api/setup');
      assert.equal(data.ok, true);
      for (const name of ['MINIMAX_API_KEY', 'LONGCAT_API_KEY', 'KIMI_API_KEY', 'STEPFUN_API_KEY', 'OPENROUTER_API_KEY'])
        assert.ok(data.prompt.includes(name), name);
      assert.ok(data.prompt.includes(f.base + '/api/settings'));
      assert.ok(data.prompt.includes(f.dataDir));
      assert.ok(data.prompt.includes(f.pluginRoot));
      assert.match(data.prompt, /M3 和 Flash 共用/);
      assert.match(data.prompt, /可选/);
      assert.match(data.prompt, /不要回显/);
      assert.match(data.prompt, /不调用付费模型/);
      assert.match(data.prompt, /initialSave/);
    });
    await t.test('Jev guidance checks existing config and offers an explicit enable or skip choice', async () => {
      const {prompt} = await f.get('/api/setup');
      assert.match(prompt, /即使已经配置员工.*检查 Jev/);
      assert.match(prompt, /普通 OpenRouter API Key/);
      assert.match(prompt, /已有非空 Key.*保留并复用/);
      assert.match(prompt, /现在启用 Jev.*暂时跳过/);
      assert.match(prompt, /OpenRouter 账户额度/);
      assert.match(prompt, /注册或登录.*创建并保存 API Key/);
      assert.match(prompt, /openrouter\.ai\/settings\/keys/);
      assert.match(prompt, /收到真实 Key 后才写入 OPENROUTER_API_KEY/);
      assert.match(prompt, /不用员工 Key 代替/);
      assert.match(prompt, /不阻止其他员工配置和游戏启动/);
    });
    await t.test('reading Jev guidance never returns a configured Key or starts a model call', async () => {
      const secret='isolated-jev-secret-must-not-be-returned';
      try {
        await writeFile(f.settings.envFile, 'OPENROUTER_API_KEY='+secret+'\n');
        const {prompt} = await f.get('/api/setup');
        assert.ok(!prompt.includes(secret));
        assert.equal((await readdir(f.dataDir)).length, 0);
        assert.ok(!f.logs.join('\n').includes(secret));
      } finally {
        await writeFile(f.settings.envFile, originalEnv);
      }
    });
    await t.test('new players receive a step-by-step guide without a developer workspace assumption', async () => {
      const {prompt} = await f.get('/api/setup');
      const guidance = prompt.split('本次运行信息（由 MiniApp 自动提供')[0];
      assert.equal(guidance.trim(), (await readFile(join(f.pluginRoot, 'SETUP_PROMPT.md'), 'utf8')).trim());
      assert.match(guidance, /首次启动向导/);
      assert.match(guidance, /不需要游戏源码/);
      assert.match(guidance, /没有 Key/);
      assert.match(guidance, /注册.*创建/);
      assert.match(guidance, /等待我/);
      assert.match(guidance, /至少.*一家/);
      assert.match(guidance, /不要.*占位/);
      assert.doesNotMatch(guidance, /ai-model-party|\/(?:Users|home)\/[^/\s]+|[A-Z]:\\Users\\|当前工作区/);
      for (const host of ['platform.minimax.cn', 'longcat.chat', 'kimi.com', 'platform.stepfun.com'])
        assert.ok(guidance.includes(host), host);
    });
    await t.test('reading the prompt and polling settings neither starts the game nor writes credentials', async () => {
      for (let i=0; i<3; i++) assert.equal((await f.get('/api/settings')).configured, false);
      assert.equal((await readdir(f.dataDir)).length, 0);
      assert.equal(await readFile(f.settings.envFile, 'utf8'), originalEnv);
    });
    await t.test('the config API accepts paths instead of raw credentials', async () => {
      const result = await (await f.post('/api/settings', {MINIMAX_API_KEY:'secret-must-not-be-saved'})).json();
      assert.equal(result.ok, false);
      assert.equal((await f.get('/api/settings')).configured, false);
      assert.equal((await readdir(f.dataDir)).length, 0);
    });
    await t.test('a Python with missing dependencies cannot mark setup as complete', async () => {
      const brokenDir = join(f.scratch, 'broken');
      await mkdir(brokenDir);
      const pythonPath = join(brokenDir, 'python');
      await writeFile(pythonPath, `#!${process.env.AI_OFFICE_TEST_PYTHON}\nraise SystemExit(1)\n`);
      await chmod(pythonPath, 0o700);
      const result = await (await f.post('/api/settings', {...f.settings, pythonPath})).json();
      assert.equal(result.ok, false);
      assert.match(result.msg, /依赖/);
      assert.equal((await f.get('/api/settings')).configured, false);
      assert.equal((await readdir(f.dataDir)).length, 0);
    });
    await t.test('AI saves config through the local API with concurrency protection', async () => {
      const responses = await Promise.all([
        f.post('/api/settings', {...f.settings, apiKey:'secret-must-not-be-saved'}),
        f.post('/api/settings', f.settings)
      ]);
      assert.deepEqual(responses.map(r => r.status).sort(), [200,409]);
      assert.deepEqual(JSON.parse(await readFile(join(f.dataDir, 'settings.json'), 'utf8')), f.settings);
      assert.equal((await stat(join(f.dataDir, 'settings.json'))).mode & 0o777, 0o600);
      assert.equal((await f.get('/api/settings')).configured, true);
      assert.equal((await readdir(f.dataDir)).includes('fixture-pid'), false);
    });
    await t.test('configuration survives closing and reopening, without asking for Keys again', async () => {
      await f.dispose();
      await f.restart();
      const result = await f.get('/api/settings');
      assert.equal(result.configured, true);
      assert.deepEqual(result.settings, f.settings);
      assert.equal((await readdir(f.dataDir)).includes('fixture-pid'), false);
      assert.equal(await readFile(f.settings.envFile, 'utf8'), originalEnv);
      assert.ok(!(await f.get('/api/setup')).prompt.includes('secret-must-not-be-saved'));
      assert.ok(!f.logs.join('\n').includes('secret-must-not-be-saved'));
    });
  } finally {
    await f.dispose();
    await rm(f.scratch, {recursive:true,force:true});
  }
});

test('a new player can configure a relocated standalone package with one model Key', async () => {
  const f = await fixture({relocate:true});
  try {
    const {prompt} = await f.get('/api/setup');
    assert.ok(prompt.includes(f.pluginRoot));
    assert.ok(prompt.includes(f.dataDir));
    assert.ok(prompt.includes(f.base + '/api/settings'));
    assert.doesNotMatch(prompt, /ai-model-party|\/(?:Users|home)\/[^/\s]+|[A-Z]:\\Users\\/);
    assert.equal((await f.get('/api/settings')).configured, false);
    assert.match(await readFile(join(f.pluginRoot, 'miniapp/node/requirements.txt'),'utf8'), /Flask/);
    const template = await readFile(join(f.pluginRoot, 'miniapp/node/env.example'),'utf8');
    assert.match(template, /LONGCAT_API_KEY=\s*\n/);
    await writeFile(f.settings.envFile,'LONGCAT_API_KEY=isolated-new-player-key\n');
    assert.equal((await (await f.post('/api/settings',f.settings)).json()).ok,true);
    assert.equal((await f.get('/api/state')).gameplay_version,5);
    assert.equal((await readdir(f.dataDir)).includes('network-attempt'),false);
    await f.dispose();
    await f.restart();
    assert.equal((await f.get('/api/settings')).configured,true);
    assert.equal(await readFile(f.settings.envFile,'utf8'),'LONGCAT_API_KEY=isolated-new-player-key\n');
  } finally {
    await f.dispose();
    await rm(f.scratch,{recursive:true,force:true});
  }
});

test('closing MiniApp during dependency check reaps the probe without saving settings', async () => {
  const f = await fixture();
  const slowDir = join(f.scratch, 'slow');
  await mkdir(slowDir);
  const pythonPath = join(slowDir, 'python'), pidFile = join(f.scratch, 'probe-pid');
  await writeFile(pythonPath, `#!${process.env.AI_OFFICE_TEST_PYTHON}\nimport os, pathlib, time\npathlib.Path(${JSON.stringify(pidFile)}).write_text(str(os.getpid()))\ntime.sleep(60)\n`);
  await chmod(pythonPath, 0o700);
  const pending = f.post('/api/settings', {...f.settings, pythonPath}).catch(() => null);
  try {
    let pid;
    for (let i=0; i<50; i++) {
      pid = await readFile(pidFile, 'utf8').catch(() => '');
      if (pid) break;
      await new Promise(resolve => setTimeout(resolve,20));
    }
    assert.ok(pid, 'test probe started');
    await f.dispose();
    await pending;
    assert.throws(() => process.kill(Number(pid),0), /ESRCH/);
    assert.equal((await readdir(f.dataDir)).length, 0);
  } finally {
    await f.dispose();
    await rm(f.scratch,{recursive:true,force:true});
  }
});
