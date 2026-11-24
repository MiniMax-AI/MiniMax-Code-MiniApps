// AI 这一块（假 AI + 假 git）：讲解、追问、权限、提问、失败、新开会话、思考强度、排队与取消。
import './helpers/no-network.mjs';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { REPO_ROOT, readCalls } from './helpers/sandbox.mjs';
import { ask, e2e as test, explain, idle, managerIdle, ready } from './helpers/world.mjs';

const KEY = 'alice__rocket-core';
const BOB = 'bob__lunar-notes';
const lastRun = (w) => w.stub.state.runs.at(-1);
const detail = async (w, key = KEY) => (await w.app.get('/api/projects/' + key)).json;
const ABSOLUTE = /[A-Za-z]:\\|\/Users\/|\/home\/|\/var\/|\/tmp\//;

test('云讲解：发给 AI 的话很短，资料写进 AI 的工作文件夹（路径带空格、中文、引号也行）', async (t) => {
  const w = await ready(t);
  w.stub.state.workDir = w.sb.weird;
  const dir = w.sb.weird;
  const accepted = await w.app.post('/api/projects/' + KEY + '/explain', { mode: 'cloud' });
  assert.equal(accepted.status, 200);
  assert.ok(['queued', 'preparing'].includes(accepted.json.status), '有空位就立刻开始准备，没有才排队：' + accepted.json.status);
  assert.equal((await w.app.post('/api/projects/' + KEY + '/explain', { mode: 'cloud' })).status, 409, '同一个项目正在讲解时不能再来一次');
  const d = await idle(w.app, KEY);
  assert.match(d.explain.cloud.text, /测试讲解/);
  assert.equal(d.explained.cloud, true);
  assert.equal(d.lastCall.status, 'done');

  const run = w.stub.state.runs[0];
  assert.deepEqual(run.model, { providerId: 'minimax', modelId: 'MiniMax-M3.1-Flash', variant: 'thinking', thinking: { effort: 'max' } }, '默认挑 M3.1，思考强度取最高档');
  assert.equal(run.whenBusy, 'queue');
  assert.ok(run.text.length < 140 && run.text.includes('prompts/explain-cloud.md') && run.text.includes('projects/' + KEY + '/'), run.text);

  assert.deepEqual((await readdir(join(dir, 'prompts'))).sort(), ['common.md', 'explain-cloud.md', 'explain-local.md', 'manage.md', 'notes.md']);
  for (const name of ['common.md', 'notes.md']) {
    assert.equal(await readFile(join(dir, 'prompts', name), 'utf8'), await readFile(join(REPO_ROOT, 'miniapp', 'node', 'prompts', name), 'utf8'));
  }
  const meta = JSON.parse(await readFile(join(dir, 'projects', KEY, 'meta.json'), 'utf8'));
  assert.equal(meta.repo, 'alice/rocket-core');
  assert.equal(meta.localCode, null);
  assert.match(await readFile(join(dir, 'projects', KEY, 'README.md'), 'utf8'), /Unique-token: alice-rocket-core-readme/);

  const s = await w.app.state();
  assert.equal(s.settings.agentDir, dir);
  assert.deepEqual(s.paths, { platform: process.platform, data: w.sb.data, agentDir: dir, prompts: join(dir, 'prompts'), cache: join(dir, 'cache', 'repos') });
});

test('发给 AI 的话和规则文件里都不含任何绝对路径：只用相对路径，别人的电脑上也成立', async (t) => {
  const w = await ready(t);
  await explain(w, KEY, 'local');
  await ask(w, KEY, '再讲讲怎么用？');
  await w.app.post('/api/manager/message', { text: '整理一下' });
  await managerIdle(w.app);
  for (const r of w.stub.state.runs) assert.ok(!ABSOLUTE.test(r.text) && !r.text.includes(w.sb.root), r.text);
  for (const name of await readdir(join(w.sb.agent, 'prompts'))) {
    const text = await readFile(join(w.sb.agent, 'prompts', name), 'utf8');
    assert.ok(!ABSOLUTE.test(text), name + ' 里不该有绝对路径');
  }
});

test('本地讲解：代码拉到 AI 工作文件夹的 cache/repos 下，和云讲解是同一个会话，再讲解就是更新', async (t) => {
  const w = await ready(t);
  w.stub.state.workDir = w.sb.weird;
  await explain(w, KEY, 'cloud');
  const sid = (await detail(w)).session.id;
  const d = await explain(w, KEY, 'local');
  assert.equal(d.session.id, sid, '云讲解和本地讲解是同一个会话');
  assert.ok(d.explain.cloud && d.explain.local);
  const dest = join(w.sb.weird, 'cache', 'repos', KEY);
  assert.ok((await stat(join(dest, '.git'))).isDirectory());
  assert.equal(d.cache.dir, dest);
  assert.ok(d.cache.sizeKB > 0);
  assert.equal(d.cache.updated, false);
  const run = lastRun(w);
  assert.equal(run.sessionId, sid);
  assert.ok(run.text.includes('cache/repos/' + KEY + '/') && run.text.length < 200, run.text);
  const clone = (await readCalls(w.sb)).find((c) => c.tool === 'git' && c.args.includes('clone'));
  assert.equal(clone.args.at(-1), dest);
  const meta = JSON.parse(await readFile(join(w.sb.weird, 'projects', KEY, 'meta.json'), 'utf8'));
  assert.equal(meta.localCode, 'cache/repos/' + KEY);

  const other = await explain(w, BOB, 'cloud');
  assert.notEqual(other.session.id, sid, '另一个项目，另一个会话');
  assert.equal(w.stub.state.created.length, 2);

  const cache = (await w.app.get('/api/cache')).json;
  assert.equal(cache.dir, join(w.sb.weird, 'cache', 'repos'));
  assert.deepEqual(cache.items.map((i) => i.key), [KEY]);

  const again = await explain(w, KEY, 'local');
  assert.equal(again.cache.updated, true);
  const gitArgs = (await readCalls(w.sb)).filter((c) => c.tool === 'git').map((c) => c.args.filter((a) => !a.startsWith('-') && a !== dest));
  assert.ok(gitArgs.some((a) => a.includes('fetch')) && gitArgs.some((a) => a.includes('reset')));
});

test('讲解失败：网络不通就说连不上，已有的讲解不丢；换个模式不受影响', async (t) => {
  const w = await ready(t);
  await explain(w, KEY, 'cloud');
  const { setMode } = await import('./helpers/sandbox.mjs');
  await setMode(w.sb, { cloneFail: true });
  const d = await explain(w, KEY, 'local');
  assert.equal(d.lastCall.status, 'error');
  assert.equal(d.lastCall.errorCode, 'network');
  assert.match(d.lastCall.error, /连不上 GitHub/);
  assert.equal(d.cache, null);
  assert.ok(d.explain.cloud, '云讲解还在');
  assert.equal(w.stub.state.runs.length, 1, '代码没拉下来，就不该让 AI 去讲');
  await setMode(w.sb, {});
  assert.ok((await explain(w, KEY, 'local')).explain.local, '网络恢复后重试就行');
  assert.equal((await w.app.post('/api/projects/' + KEY + '/explain', { mode: 'sideways' })).status, 400);
});

test('追问：同一个会话，带上规则文件；记下对话；空内容和太长的拒绝', async (t) => {
  const w = await ready(t);
  const first = await explain(w, KEY, 'cloud');
  const d = await ask(w, KEY, '再讲讲怎么用？');
  const run = lastRun(w);
  assert.equal(run.sessionId, first.session.id);
  assert.equal(run.whenBusy, 'queue');
  assert.ok(run.text.startsWith('【alice/rocket-core】规则见 prompts/common.md') && run.text.includes('再讲讲怎么用'), run.text);
  assert.deepEqual(d.chat.filter((c) => c.role !== 'sys').map((c) => c.role), ['user', 'ai']);
  assert.equal(d.chat.find((c) => c.role === 'user').how, 'queue');
  assert.equal((await w.app.post('/api/projects/' + KEY + '/message', { text: '   ' })).status, 400);
  assert.equal((await w.app.post('/api/projects/' + KEY + '/message', { text: 'x'.repeat(4001) })).status, 400);
});

test('追问时插话（steer）：不等上一轮结束，也不会多出一条 AI 回复', async (t) => {
  const w = await ready(t);
  w.stub.state.flags.steerNext = true;
  const d = await ask(w, KEY, '补充一点', { whenBusy: 'steer' });
  assert.equal(lastRun(w).whenBusy, 'steer');
  assert.equal(d.chat.find((c) => c.role === 'user').how, 'steer');
  assert.ok(!d.chat.some((c) => c.role === 'ai'));
  assert.equal(d.lastCall, null, '追问不算讲解，不改「最近一次讲解」');
});

test('权限确认：AI 要运行命令时由用户决定；绝不自动放行；拒绝后 AI 换办法', async (t) => {
  const w = await ready(t);
  for (const [decision, pattern] of [['deny', /被拒绝了/], ['allowOnce', /测试讲解/]]) {
    w.stub.state.flags.askPerm = true;
    const before = w.stub.state.calls.reply;
    await w.app.post('/api/projects/' + KEY + '/message', { text: '跑个命令 ' + decision });
    const call = await w.app.waitFor(async () => (await detail(w)).calls[0]?.pendingPermission && (await detail(w)).calls[0], { what: 'permission request' });
    assert.equal(call.status, 'waiting_permission');
    assert.equal(call.pendingPermission.toolName, 'bash');
    assert.equal(call.pendingPermission.requestId, 'req1');
    assert.equal(w.stub.state.calls.reply, before, '用户还没选，不能替他答');
    assert.equal((await w.app.post('/api/projects/' + KEY + '/permission', { requestId: 'req1', decision: 'maybe' })).status, 400);
    assert.equal((await w.app.post('/api/projects/' + KEY + '/permission', { requestId: 'nope', decision })).status, 404);
    assert.equal((await w.app.post('/api/projects/' + KEY + '/permission', { requestId: 'req1', decision })).status, 200);
    const d = await idle(w.app, KEY);
    assert.match(d.chat.at(-1).text, pattern);
    assert.equal(w.stub.state.calls.reply, before + 1);
  }
});

test('让 AI 记备注：消息很短；记备注期间不能重复发起', async (t) => {
  const w = await ready(t);
  w.stub.state.flags.slowMs = 300;
  const first = await w.app.post('/api/projects/' + KEY + '/ai-notes');
  assert.equal(first.status, 200);
  assert.equal((await w.app.post('/api/projects/' + KEY + '/ai-notes')).status, 409);
  await idle(w.app, KEY);
  assert.ok(lastRun(w).text.length < 120 && lastRun(w).text.includes('prompts/notes.md'), lastRun(w).text);
});

test('整理收藏夹：有自己独立的会话，第一句带上规则文件', async (t) => {
  const w = await ready(t);
  assert.equal((await w.app.post('/api/manager/message', { text: '把前端相关的放进「前端项目」' })).status, 200);
  const m = await managerIdle(w.app);
  assert.equal(m.session, true);
  assert.deepEqual(m.chat.map((c) => c.role), ['user', 'ai']);
  assert.ok(lastRun(w).text.startsWith('按 prompts/manage.md'), lastRun(w).text);
  assert.equal((await w.app.post('/api/manager/message', { text: '   ' })).status, 400);
  assert.equal((await w.app.post('/api/manager/message', { text: 'x'.repeat(1001) })).status, 400);
  const managerSession = w.stub.state.runs[0].sessionId;
  await explain(w, KEY, 'cloud');
  assert.notEqual((await detail(w)).session.id, managerSession, '项目的会话和整理的会话不是一个');
  assert.equal((await w.app.post('/api/manager/session/reset')).status, 200);
  assert.equal((await w.app.get('/api/manager')).json.session, false);
});

test('AI 中途提问：用「其他 + 文字」回答让它按默认继续（不能「全部跳过」），并在聊天里留一行说明', async (t) => {
  const w = await ready(t);
  w.stub.state.flags.askNext = true;
  const d = await ask(w, KEY, '帮我选个语言再回答');
  const answered = w.stub.state.answers.at(-1);
  assert.ok(answered.answers.length > 0);
  for (const a of answered.answers) {
    assert.equal(a.selectedOther, true);
    assert.deepEqual(a.selectedOptionIds, []);
    assert.ok(a.otherText.includes('不要再提问'));
    assert.ok(!a.skipped);
  }
  assert.match(answered.requestId, /^q-/);
  assert.equal(answered.sessionId, d.session.id);
  assert.ok(d.chat.some((c) => c.role === 'ai' && c.text.includes('按默认用中文')));
  assert.ok(d.chat.some((c) => c.role === 'sys' && c.text.includes('AI 想问') && c.text.includes('用中文还是英文')));
  assert.equal(w.stub.state.pendingQ.size, 0, '不能留下没回答的问题卡住会话');
});

test('AI 出错：原因写进聊天，不是什么都没留下', async (t) => {
  const w = await ready(t);
  w.stub.state.flags.failNext = true;
  const d = await ask(w, KEY, '这条会失败');
  const msg = d.chat.find((c) => c.role === 'sys' && c.error === true);
  assert.ok(msg && msg.text.includes('模型暂时不可用'), JSON.stringify(d.chat));
  const retry = await ask(w, KEY, '再试一次');
  assert.equal(retry.chat.at(-1).role, 'ai');
});

test('新开会话：旧会话忘掉，讲解和聊天记录保留，下一句重新带规则文件；忙的时候不让开', async (t) => {
  const w = await ready(t);
  await explain(w, KEY, 'cloud');
  const before = (await ask(w, KEY, '第一个问题')).session.id;
  assert.equal((await w.app.post('/api/projects/' + KEY + '/session/reset')).status, 200);
  let d = await detail(w);
  assert.equal(d.session, null);
  assert.ok(d.explain.cloud && d.chat.length >= 3);
  assert.ok(d.chat.some((c) => c.role === 'sys' && c.text.includes('已新开会话')));
  d = await ask(w, KEY, '新会话里的第一句');
  assert.notEqual(d.session.id, before);
  assert.ok(lastRun(w).text.startsWith('【alice/rocket-core】规则见 prompts/common.md'));
  w.stub.state.flags.slowMs = 500;
  await w.app.post('/api/projects/' + KEY + '/message', { text: '正在忙' });
  assert.equal((await w.app.post('/api/projects/' + KEY + '/session/reset')).status, 409);
  await idle(w.app, KEY);
});

test('会话被删了：自动新建一个再继续，用户无感', async (t) => {
  const w = await ready(t);
  const first = await explain(w, KEY, 'cloud');
  w.stub.sessions.delete(first.session.id);
  const d = await explain(w, KEY, 'cloud');
  assert.equal(d.lastCall.status, 'done');
  assert.notEqual(d.session.id, first.session.id);
});

test('重启后每个项目还是原来的会话', async (t) => {
  const w = await ready(t);
  const a = (await explain(w, KEY, 'cloud')).session.id;
  const b = (await explain(w, BOB, 'cloud')).session.id;
  await w.restart();
  assert.equal((await detail(w)).session.id, a);
  assert.equal((await detail(w, BOB)).session.id, b);
  const d = await ask(w, KEY, '重启之后接着问');
  assert.equal(lastRun(w).sessionId, a);
  assert.equal(w.stub.state.created.length, 2, '没有多建会话');
  assert.ok(d.explain.cloud);
});

test('思考强度：最高 / 中 / 低 / 默认；模型不支持分档就不带；选了别的模型就用它', async (t) => {
  const w = await ready(t);
  const effort = async (level) => {
    assert.equal((await w.app.post('/api/settings', { effort: level })).status, 200);
    await ask(w, KEY, '强度测试 ' + level);
    return lastRun(w).model;
  };
  assert.deepEqual(await effort('low'), { providerId: 'minimax', modelId: 'MiniMax-M3.1-Flash', variant: 'thinking', thinking: { effort: 'low' } });
  assert.equal((await effort('medium')).thinking.effort, 'medium');
  const plain = await effort('default');
  assert.equal(plain.modelId, 'MiniMax-M3.1-Flash');
  assert.ok(plain.thinking === undefined && plain.variant === undefined);
  assert.equal((await effort('max')).thinking.effort, 'max');
  assert.equal((await w.app.post('/api/settings', { modelKey: 'x/other' })).status, 200);
  await ask(w, KEY, '换个不支持分档的模型');
  const other = lastRun(w).model;
  assert.deepEqual([other.providerId, other.modelId, other.thinking, other.variant], ['x', 'other', undefined, undefined]);
  const models = (await w.app.get('/api/models')).json;
  assert.equal(models.preferredKey, 'minimax/MiniMax-M3.1-Flash');
  assert.equal(models.defaultKey, 'x/other');
  assert.equal(models.pickedKey, 'x/other');
  assert.deepEqual(models.models.map((m) => m.key), ['minimax/MiniMax-M3.1-Flash', 'x/other']);
  // 设置页要按「这个模型在宿主里声明了哪些档位」来列选项，所以档位要跟着模型列表返回
  const byKey = new Map(models.models.map((m) => [m.key, m.efforts]));
  assert.deepEqual(byKey.get('minimax/MiniMax-M3.1-Flash'), ['default', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(byKey.get('x/other'), [], '没声明档位的模型回空数组，页面据此把下拉框置灰');
});

test('思考强度：high / xhigh 也认，并能传到模型；乱写的值照样拒绝', async (t) => {
  const w = await ready(t);
  const effort = async (level) => {
    assert.equal((await w.app.post('/api/settings', { effort: level })).status, 200, level + ' 应该被接受');
    await ask(w, KEY, '档位测试 ' + level);
    return lastRun(w).model;
  };
  assert.equal((await effort('high')).thinking.effort, 'high');
  assert.equal((await effort('xhigh')).thinking.effort, 'xhigh');
  for (const bad of ['turbo', 'HIGH', '', 'maxim']) {
    assert.equal((await w.app.post('/api/settings', { effort: bad })).status, 400, JSON.stringify(bad) + ' 应该被拒绝');
  }
  assert.equal((await w.app.state()).settings.effort, 'xhigh', '被拒绝的值不能改动已保存的设置');
});

test('排队与取消：同时讲解的数量有上限；排队的可以单独取消；运行中的可以停止，后面的接着跑', async (t) => {
  const w = await ready(t);
  w.stub.state.flags.slowMs = 700;
  assert.equal((await w.app.post('/api/settings', { concurrency: 1 })).status, 200);
  const keys = [KEY, BOB, 'carol__agent-kit'];
  for (const k of keys) assert.equal((await w.app.post('/api/projects/' + k + '/explain', { mode: 'cloud' })).status, 200);
  await w.app.waitFor(async () => (await detail(w, keys[0])).calls[0]?.status === 'running', { what: 'first running' });
  const second = (await detail(w, keys[1])).calls[0];
  const third = (await detail(w, keys[2])).calls[0];
  assert.deepEqual([second.status, second.queuePosition, third.status, third.queuePosition], ['queued', 1, 'queued', 2]);

  assert.equal((await w.app.post('/api/projects/' + keys[2] + '/cancel')).status, 200);
  assert.equal((await detail(w, keys[2])).lastCall.status, 'cancelled');
  assert.equal((await w.app.post('/api/projects/' + keys[2] + '/cancel')).status, 404, '没有进行中的任务可取消');

  assert.equal((await w.app.post('/api/projects/' + keys[0] + '/cancel')).status, 200);
  await idle(w.app, keys[0]);
  assert.equal((await detail(w, keys[0])).lastCall.status, 'cancelled');
  await idle(w.app, keys[1]);
  assert.ok((await detail(w, keys[1])).explain.cloud, '前面的取消后，排队的接着跑');
  assert.equal(w.stub.state.maxActive, 1, '同一时间只能有 1 个在讲解');
});

test('并发上限：设成 2，四个一起请求，最多同时 2 个', async (t) => {
  const w = await ready(t);
  w.stub.state.flags.slowMs = 250;
  assert.equal((await w.app.post('/api/settings', { concurrency: 2 })).status, 200);
  const keys = [KEY, BOB, 'carol__agent-kit', 'dave__pixel-forge'];
  for (const k of keys) await w.app.post('/api/projects/' + k + '/explain', { mode: 'cloud' });
  for (const k of keys) await idle(w.app, k);
  assert.equal(w.stub.state.maxActive, 2);
  for (const k of keys) assert.ok((await detail(w, k)).explain.cloud, k);
});

test('Mini App 停止时，进行中的 AI 任务一起终止，停止在 2 秒内完成', async (t) => {
  const w = await ready(t);
  w.stub.state.flags.slowMs = 10000;
  await w.app.post('/api/projects/' + KEY + '/explain', { mode: 'cloud' });
  await w.app.waitFor(() => w.stub.state.active === 1, { what: 'AI running' });
  const t0 = Date.now();
  await w.app.stop();
  assert.ok(Date.now() - t0 < 2000, '停止花了 ' + (Date.now() - t0) + ' 毫秒');
  await w.app.waitFor(() => w.stub.state.active === 0, { what: 'AI aborted' });
});
