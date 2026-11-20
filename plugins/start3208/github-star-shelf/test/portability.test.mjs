// 「别人的电脑」：gh / git / AI 工作文件夹在哪、会不会变、坏了怎么办。全部离线，用假命令和假环境。
import './helpers/no-network.mjs';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makeFixtures } from './helpers/fixtures.mjs';
import { boot } from './helpers/host.mjs';
import { installFake, readCalls, setMode, shq, installScript } from './helpers/sandbox.mjs';
import { e2e as test, explain, idle, importAll, ready, settled, world } from './helpers/world.mjs';

const gone = (pid) => {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
};

const KEY = 'alice__rocket-core';
const BOB = 'bob__lunar-notes';
const detail = async (w, key = KEY) => (await w.app.get('/api/projects/' + key)).json;
const exists = (p) => stat(p).then(() => true, () => false);

test('数据搬到另一台电脑、AI 工作文件夹变了：页面一打开就校正，之后的资料都写进新位置', async (t) => {
  const w = await ready(t);
  await explain(w, KEY, 'cloud');
  assert.equal((await w.app.state()).settings.agentDir, w.sb.agent);
  const moved = join(w.sb.root, '另一台电脑 的 AI 工作区');
  w.stub.state.workDir = moved;
  const asked = w.stub.state.calls.session;
  await w.restart();
  assert.equal(w.stub.state.calls.session, asked, '启动时不能去问宿主（官方要求 start 里不调 Agent）');
  await w.app.state(); // 页面第一次来取状态
  const s = await w.app.waitFor(async () => {
    const x = await w.app.state();
    return x.settings.agentDir === moved ? x : null;
  }, { what: 'agent dir corrected' });
  assert.equal(s.paths.agentDir, moved);
  assert.equal(s.paths.cache, join(moved, 'cache', 'repos'));
  await explain(w, BOB, 'cloud');
  assert.ok(await exists(join(moved, 'projects', BOB, 'meta.json')));
  assert.ok(await exists(join(moved, 'prompts', 'common.md')));
  await explain(w, KEY, 'cloud'); // 已有会话的旧项目：同样写进新位置
  assert.ok(await exists(join(moved, 'projects', KEY, 'README.md')));
});

test('AI 工作文件夹用不了（路径下是个文件）：说清楚原因和位置，也不会让 AI 白跑；修好后重试就行', async (t) => {
  const w = await ready(t);
  const blocker = join(w.sb.root, '占位文件');
  await writeFile(blocker, 'x');
  const broken = join(blocker, '子目录');
  w.stub.state.workDir = broken;
  await w.app.post('/api/projects/' + KEY + '/explain', { mode: 'cloud' });
  const d = await idle(w.app, KEY);
  assert.equal(d.lastCall.status, 'error');
  assert.equal(d.lastCall.errorCode, 'agent_dir_unusable');
  assert.match(d.lastCall.error, /AI 的工作文件夹用不了/);
  assert.ok(d.lastCall.error.includes(broken), '要告诉用户是哪个位置');
  assert.equal(w.stub.state.calls.run, 0, '文件夹不能用，就不该让 AI 开始干活');
  w.stub.state.workDir = w.sb.agent;
  assert.equal((await explain(w, KEY, 'cloud')).lastCall.status, 'done');
});

test('缓存文件夹被手动删了：页面不再说「已缓存」，汇总里也没有', async (t) => {
  const w = await ready(t);
  const d = await explain(w, KEY, 'local');
  assert.ok(d.cache);
  await rm(d.cache.dir, { recursive: true, force: true });
  assert.equal((await detail(w)).cache, null);
  assert.deepEqual((await w.app.get('/api/cache')).json.items, []);
  assert.ok((await detail(w)).explain.local, '讲解本身还在');
});

test('存盘数据被改坏（缓存位置指到别处）：清理缓存、删除项目都不会碰缓存文件夹以外的东西', async (t) => {
  const w = await ready(t);
  await explain(w, KEY, 'local');
  await explain(w, BOB, 'local');
  const precious = join(w.sb.root, '重要资料');
  const lookalike = join(w.sb.agent, 'cache', 'repos', 'someone__else');
  await w.restart(async () => {
    for (const dir of [precious, lookalike]) {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'keep.txt'), 'do not delete');
    }
    const file = join(w.sb.data, 'state.json');
    const state = JSON.parse(await readFile(file, 'utf8'));
    state.projects[KEY].cache.dir = precious; // 指到毫不相干的目录
    state.projects[BOB].cache.dir = lookalike; // 指到长得像、但不是这个项目的缓存目录
    await writeFile(file, JSON.stringify(state));
  });
  assert.equal((await detail(w)).cache, null, '位置不对的缓存记录要丢掉');
  assert.equal((await detail(w, BOB)).cache, null);
  assert.equal((await w.app.api('DELETE', '/api/projects/' + KEY + '/cache')).status, 200);
  assert.equal((await w.app.api('DELETE', '/api/projects/' + BOB)).status, 200);
  assert.equal((await w.app.api('DELETE', '/api/cache')).status, 200);
  for (const dir of [precious, lookalike]) assert.equal(await readFile(join(dir, 'keep.txt'), 'utf8'), 'do not delete', dir);
});

test('删除项目：缓存的代码和给 AI 看的资料一起清掉，别的项目不受影响', async (t) => {
  const w = await ready(t);
  await explain(w, KEY, 'local');
  await explain(w, BOB, 'local');
  const dir = w.sb.agent;
  assert.ok(await exists(join(dir, 'cache', 'repos', KEY)) && await exists(join(dir, 'projects', KEY)));
  assert.equal((await w.app.api('DELETE', '/api/projects/' + KEY)).status, 200);
  assert.ok(!(await exists(join(dir, 'cache', 'repos', KEY))));
  assert.ok(!(await exists(join(dir, 'projects', KEY))));
  assert.ok(await exists(join(dir, 'cache', 'repos', BOB)) && await exists(join(dir, 'projects', BOB, 'meta.json')));
  assert.equal((await w.app.api('DELETE', '/api/cache')).json.cleared, 1);
  assert.ok(!(await exists(join(dir, 'cache', 'repos', BOB))));
  assert.ok(await exists(join(dir, 'projects', BOB, 'meta.json')), '清缓存只清代码，不动给 AI 看的资料');
});

test('没装 git：本地讲解说清楚怎么装；云讲解和别的功能不受影响', async (t) => {
  const w = await ready(t, { git: false });
  const s = await settled(w.app);
  assert.equal(s.github.git, false);
  assert.equal(s.github.gh, true);
  assert.ok(s.github.gitHint.length > 0);
  await w.app.post('/api/projects/' + KEY + '/explain', { mode: 'local' });
  const d = await idle(w.app, KEY);
  assert.equal(d.lastCall.errorCode, 'git_missing');
  assert.match(d.lastCall.error, /没有找到 git/);
  assert.equal(w.stub.state.calls.run, 0);
  assert.equal((await explain(w, KEY, 'cloud')).lastCall.status, 'done');
});

test('太大的项目：本地讲解先拒绝（可以硬拉）；磁盘放不下会说清楚', async (t) => {
  const fx = makeFixtures();
  fx.repos[0].size = 310 * 1024; // alice/rocket-core：310 MB，超过默认的 300 MB 上限
  fx.repos[1].size = 5e11; // bob/lunar-notes：约 480 TB，哪台电脑都放不下
  const w = await ready(t, { fixtures: fx });
  await w.app.post('/api/projects/' + KEY + '/explain', { mode: 'local' });
  let d = await idle(w.app, KEY);
  assert.equal(d.lastCall.errorCode, 'too_big');
  assert.match(d.lastCall.error, /约 310 MB，超过了 300 MB/);
  assert.equal(w.stub.state.calls.run, 0);
  d = await explain(w, KEY, 'local', { force: true });
  assert.equal(d.lastCall.status, 'done', '硬拉：跳过大小上限');
  assert.ok(d.cache);
  assert.equal((await w.app.post('/api/settings', { cloneMaxMB: 5000 })).status, 200);
  d = await explain(w, BOB, 'local', { force: true });
  assert.equal(d.lastCall.errorCode, 'cache_unusable');
  assert.match(d.lastCall.error, /剩余空间只有约 \d+ MB，不够/);
  assert.equal(d.cache, null);
});

test('设置里手动指定 gh / git 的路径：试运行通过才保存；优先于自动查找；一个不对整个不生效；重启后还记得；清空改回自动', async (t) => {
  const w = await ready(t);
  const mineGh = await installFake(w.sb, 'gh', { dir: w.sb.weird, tag: 'mine-gh' });
  const mineGit = await installFake(w.sb, 'git', { dir: w.sb.weird, tag: 'mine-git' });
  const missing = join(w.sb.root, '不存在', 'gh');
  const bad = await w.app.post('/api/settings', { ghPath: missing });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error.message, /gh 的路径不能用/);
  const mixed = await w.app.post('/api/settings', { ghPath: mineGh, gitPath: missing });
  assert.equal(mixed.status, 400);
  assert.equal((await w.app.state()).settings.ghPath, '', '一个好一个坏：都不生效');
  assert.equal((await w.app.post('/api/settings', { ghPath: 'gh' })).status, 400, '只写命令名不行，要完整路径');
  assert.equal((await w.app.post('/api/settings', { gitPath: mineGh })).status, 400, '把 gh 当 git 填进去要被拒绝');

  assert.equal((await w.app.post('/api/settings', { ghPath: mineGh, gitPath: mineGit })).status, 200);
  const s = await w.app.waitFor(async () => {
    const x = await w.app.state();
    return !x.github.checking && x.github.ghPath === mineGh ? x : null;
  }, { what: 'override applied' });
  assert.deepEqual([s.github.ghVia, s.github.gitPath, s.github.gitVia], ['setting', mineGit, 'setting']);
  const earlier = (await readCalls(w.sb)).length; // 之前用自动找到的 gh 导入过一次，不算
  await importAll(w.app);
  const data = (await readCalls(w.sb)).slice(earlier).filter((c) => c.tool === 'gh' && /starred|readme/.test(c.args.join(' ')));
  assert.ok(data.length > 0 && data.every((c) => c.tag === 'mine-gh'), '读数据用的是指定的 gh：' + JSON.stringify(data.map((c) => c.tag)));
  await explain(w, KEY, 'local');
  assert.equal((await readCalls(w.sb)).find((c) => c.tool === 'git' && c.args.includes('clone')).tag, 'mine-git');

  await w.restart();
  await w.app.state();
  const again = await w.app.waitFor(async () => {
    const x = await w.app.state();
    return !x.github.checking && x.github.ghPath === mineGh ? x : null;
  }, { what: 'override restored after restart' });
  assert.equal(again.settings.ghPath, mineGh);

  assert.equal((await w.app.post('/api/settings', { ghPath: '', gitPath: '' })).status, 200);
  const auto = await w.app.waitFor(async () => {
    const x = await w.app.state();
    return !x.github.checking && x.github.ghVia === 'path' ? x : null;
  }, { what: 'back to auto' });
  assert.equal(auto.github.ghPath, join(w.sb.bin, 'gh'));
});

test('指定的路径后来坏了（比如卸载了）：自动改用能找到的，并提示「指定的不能用」', async (t) => {
  const w = await ready(t);
  const mine = await installFake(w.sb, 'gh', { dir: w.sb.tools });
  assert.equal((await w.app.post('/api/settings', { ghPath: mine })).status, 200);
  await w.app.waitFor(async () => (await w.app.state()).github.ghPath === mine, { what: 'override applied' });
  await rm(mine);
  const r = await w.app.post('/api/github/recheck');
  assert.equal(r.status, 200);
  assert.equal(r.json.ghPath, join(w.sb.bin, 'gh'));
  assert.equal(r.json.ghOverrideBad, true);
});

test('用户装好了 gh：点「重新检测」就认到，不用重启', async (t) => {
  const w = await world(t, { gh: false });
  const before = await settled(w.app);
  assert.equal(before.github.gh, false);
  assert.equal(before.github.authed, false);
  await installFake(w.sb, 'gh');
  const r = await w.app.post('/api/github/recheck');
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.gh, r.json.authed, r.json.user, r.json.ghPath], [true, true, 'tester', join(w.sb.bin, 'gh')]);
  assert.equal((await w.app.state()).github.user, 'tester');
});

test('gh 和 git 只在终端的 PATH 里（图形界面启动的程序拿不到）：问一次登录 shell 就找到，整个流程照常用', async (t) => {
  let termBin = '';
  const w = await world(t, {
    gh: false,
    git: false,
    setup: async (sb) => {
      termBin = join(sb.root, '终端 里的 bin');
      await installFake(sb, 'gh', { dir: termBin });
      await installFake(sb, 'git', { dir: termBin });
      await installScript(join(sb.tools, 'zsh'), '#!/bin/sh\nexport PATH=' + shq(termBin) + ':"$PATH"\nexec /bin/sh -c "$2"\n');
    },
    env: (sb) => ({ env: { PATH: sb.bin, SHELL: join(sb.tools, 'zsh') } }),
  });
  const s = await settled(w.app);
  assert.deepEqual([s.github.ghPath, s.github.ghVia, s.github.gitVia], [join(termBin, 'gh'), 'shell', 'shell']);
  assert.equal((await importAll(w.app)).totals.projects, 12);
  await w.app.restart?.();
  const d = await (async () => {
    await w.app.post('/api/projects/' + KEY + '/explain', { mode: 'local' });
    return idle(w.app, KEY);
  })();
  assert.equal(d.lastCall.status, 'done');
  assert.ok((await readCalls(w.sb)).some((c) => c.tool === 'git' && c.args.includes('clone')));
});

test('宿主没开「运行 Agent」、或版本太旧：AI 功能给明确原因，其他功能照常', async (t) => {
  const off = await world(t, { agent: false });
  const s = await settled(off.app);
  assert.deepEqual([s.agent.available, s.agent.code], [false, 'agent_off']);
  assert.match(s.agent.reason, /运行 Agent/);
  for (const [method, path, body] of [['POST', '/api/projects/' + KEY + '/explain', { mode: 'cloud' }], ['POST', '/api/projects/' + KEY + '/message', { text: 'hi' }], ['POST', '/api/manager/message', { text: 'hi' }], ['GET', '/api/models']]) {
    const r = await off.app.api(method, path, body);
    assert.equal(r.status, 403, path);
    assert.equal(r.json.error.code, 'agent_off', path);
  }
  assert.equal((await importAll(off.app)).totals.projects, 12, '导入、搜索、备注这些不需要 AI');

  const old = await world(t, { capabilities: { has: (name) => name !== 'agent.session' } });
  const o = (await settled(old.app)).agent;
  assert.deepEqual([o.available, o.code], [false, 'host_too_old']);
  assert.match(o.reason, /agent\.session/);
  assert.equal((await old.app.post('/api/projects/' + KEY + '/explain', { mode: 'cloud' })).json.error.code, 'host_too_old');

  const noField = await world(t, { capabilities: null });
  const n = (await settled(noField.app)).agent;
  assert.deepEqual([n.available, n.code], [false, 'host_too_old'], '没有 capabilities 这个字段，说明宿主比 3.1.6 还旧，没有 agent.session 可用');
  assert.match(n.reason, /3\.1\.6/);
});

test('Mini App 停止：在途的 gh 马上被终止，停止在 2 秒内完成', async (t) => {
  const w = await world(t);
  const pidFile = join(w.sb.root, 'gh.pid');
  await setMode(w.sb, { slowMs: 30000, pidFile });
  await settled(w.app);
  assert.equal((await w.app.post('/api/import', {})).status, 200);
  const pid = Number(await w.app.waitFor(async () => (await readFile(pidFile, 'utf8').catch(() => '')).trim(), { what: 'gh started' }));
  assert.ok(pid > 0);
  const t0 = Date.now();
  w.app.ctl.abort(); // 宿主要停止 Mini App 时，先发这个信号
  await w.app.stop();
  assert.ok(Date.now() - t0 < 2000, '停止花了 ' + (Date.now() - t0) + ' 毫秒');
  await w.app.waitFor(() => {
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  }, { what: 'gh process gone', timeout: 3000 });
});

test('stop() 自己就能终止在途的导入（gh api 读 Star 读到一半）：不能靠宿主先发停止信号', async (t) => {
  const w = await world(t);
  const pidFile = join(w.sb.root, 'gh2.pid');
  await setMode(w.sb, { slowMs: 30000, pidFile });
  await settled(w.app);
  assert.equal((await w.app.post('/api/import', {})).status, 200);
  const pid = Number(await w.app.waitFor(async () => (await readFile(pidFile, 'utf8').catch(() => '')).trim(), { what: 'gh started' }));
  assert.ok(pid > 0 && !gone(pid), 'gh 应该正在跑');
  const t0 = Date.now();
  await w.app.stop(); // 注意：这里没有先 abort context.signal
  assert.ok(Date.now() - t0 < 2000, '停止花了 ' + (Date.now() - t0) + ' 毫秒');
  await w.app.waitFor(() => gone(pid), { what: 'gh process gone', timeout: 3000 });
});

test('stop() 自己就能终止在途的检测探测（gh --version 一启动就卡住）：不能靠宿主先发停止信号', async (t) => {
  const w = await world(t);
  const startPidFile = join(w.sb.root, 'gh-start.pid');
  await setMode(w.sb, { startSlowMs: 30000, startPidFile });
  await w.app.state(); // 页面第一次取状态：后台开始检测，会去运行 gh --version
  const pid = Number(await w.app.waitFor(async () => (await readFile(startPidFile, 'utf8').catch(() => '')).trim(), { what: 'gh --version started' }));
  assert.ok(pid > 0 && !gone(pid), 'gh 应该正在跑');
  const t0 = Date.now();
  await w.app.stop(); // 注意：这里没有先 abort context.signal
  assert.ok(Date.now() - t0 < 2000, '停止花了 ' + (Date.now() - t0) + ' 毫秒');
  await w.app.waitFor(() => gone(pid), { what: 'gh --version process gone', timeout: 3000 });
});

test('stop() 自己就能终止在途的 git clone（本地讲解拉代码到一半时停止）', async (t) => {
  const w = await ready(t);
  const gitPidFile = join(w.sb.root, 'git.pid');
  await setMode(w.sb, { cloneSlowMs: 30000, gitPidFile });
  assert.equal((await w.app.post('/api/projects/' + KEY + '/explain', { mode: 'local' })).status, 200);
  const pid = Number(await w.app.waitFor(async () => (await readFile(gitPidFile, 'utf8').catch(() => '')).trim(), { what: 'git clone started' }));
  assert.ok(pid > 0 && !gone(pid), 'git 应该正在跑');
  const t0 = Date.now();
  await w.app.stop();
  assert.ok(Date.now() - t0 < 2000, '停止花了 ' + (Date.now() - t0) + ' 毫秒');
  await w.app.waitFor(() => gone(pid), { what: 'git process gone', timeout: 3000 });
});

test('报错分类只看命令自己输出的报错，不看命令行里的路径：目录名碰巧叫 proxy 也不会判成「连不上」', async (t) => {
  const w = await world(t, { gh: false, git: false });
  const dir = join(w.sb.root, 'my proxy EOF tools');
  await installScript(join(dir, 'gh'), '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "gh version 9.9.9"; exit 0; fi\nif [ "$2" = "user" ]; then echo tester; exit 0; fi\necho "something odd happened" >&2\nexit 1\n');
  await installScript(join(dir, 'git'), '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "git version 9.9.9"; exit 0; fi\necho "something odd happened" >&2\nexit 128\n');
  await w.app.stop();
  const odd = await boot(w.sb, { agent: w.stub.agent, envCtx: { ...w.envCtx, env: { PATH: dir } } });
  t.after(() => odd.stop());
  const added = await odd.post('/api/projects/add', { url: 'a/b' });
  assert.equal(added.json.error.code, 'github_error');
  assert.ok(!/连不上/.test(added.json.error.message));
  assert.equal((await odd.post('/api/import', {})).status, 200);
  const s = await odd.waitFor(async () => {
    const x = await odd.state();
    return x.import.status !== 'running' ? x : null;
  });
  assert.equal(s.import.errorCode, 'github_error');
  await odd.stop();
  w.app = await boot(w.sb, { agent: w.stub.agent, envCtx: w.envCtx }); // 让沙盒清理钩子有东西可停
});

test('页面上要显示的位置，不会被写进日志（日志常被人贴出来求助）', async (t) => {
  const w = await ready(t);
  w.stub.state.workDir = w.sb.weird;
  await explain(w, KEY, 'local');
  await w.app.state();
  const logged = JSON.stringify(w.app.logs);
  for (const secret of [w.sb.weird, w.sb.data, w.sb.root, w.sb.agent]) assert.ok(!logged.includes(secret), '日志里不该有本机路径：' + secret);
});
