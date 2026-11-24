// 端到端（离线）：真正的 Mini App 服务 + 假 gh / 假 git / 假 AI，通过 HTTP 和 MCP 接口验收。
import { jsonResponse as json, withFakeFetch } from './helpers/no-network.mjs';
import assert from 'node:assert/strict';
import { starEntry as star } from './helpers/fixtures.mjs';
import { readCalls } from './helpers/sandbox.mjs';
import { e2e as test, importAll, listen, settled, world } from './helpers/world.mjs';
const KEY = 'alice__rocket-core';

test('启动：只起服务，不碰 gh / git / AI；页面第一次取状态时才开始检测', async (t) => {
  const w = await world(t);
  assert.deepEqual(await readCalls(w.sb), [], 'start() 期间不该运行任何外部命令');
  assert.deepEqual(w.stub.state.calls, { create: 0, session: 0, models: 0, run: 0, reply: 0, answer: 0 }, 'start() 期间不该调用宿主的 Agent');
  const html = await w.app.get('/dashboard');
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-type'), /text\/html/);
  assert.match(html.headers.get('content-security-policy'), /script-src 'self'/);
  const s = await settled(w.app);
  assert.equal(s.github.authed, true);
  assert.equal(s.github.user, 'tester');
  assert.equal(s.agent.available, true);
  assert.equal(s.totals.projects, 0);
  assert.equal(s.collections.length, 1);
  assert.equal(s.collections[0].isDefault, true);
  assert.equal(s.settings.effort, 'max');
  assert.equal(s.mcpServer, 'github-star-shelf');
});

test('静态文件：只给 client 目录里的页面文件，不给源码和别的目录', async (t) => {
  const w = await world(t);
  for (const p of ['/', '/dashboard', '/index.html', '/app.js', '/style.css']) assert.equal((await w.app.get(p)).status, 200, p);
  for (const p of ['/server.mjs', '/../node/server.mjs', '/..%2fnode%2fserver.mjs', '/%2e%2e/package.json', '/miniapp.json', '/lib/store.mjs', '/.env', '/state.json']) {
    assert.equal((await w.app.get(p)).status, 404, p);
  }
  assert.equal((await w.app.get('/api/nope')).status, 404);
  assert.equal((await w.app.get('/api/projects/..%2F..%2Fetc')).status, 400);
  const res = await fetch(w.app.base + '/api/collections', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'bad_json');
});

test('导入 Star：12 个进默认收藏夹，README 预取完，重复导入不会重复', async (t) => {
  const w = await world(t);
  const s = await importAll(w.app);
  assert.equal(s.import.status, 'done');
  assert.equal(s.import.source, 'api');
  assert.equal(s.import.user, 'tester');
  assert.equal(s.import.added, 12);
  assert.equal(s.import.total, 12);
  assert.equal(s.totals.projects, 12);
  assert.equal(s.collections.find((c) => c.id === 'default').count, 12);
  assert.equal(s.prefetch.status, 'done');
  assert.equal(s.prefetch.failed, 0);
  assert.equal(s.totals.withReadme, 11);
  assert.equal(s.importReport.fetched, 12);
  assert.equal((await w.app.get('/api/projects/oscar__no-readme-demo')).json.readme.status, 'none', '没有 README 是「没有」，不是出错');
  const rocket = (await w.app.get('/api/projects/' + KEY)).json;
  assert.equal(rocket.hasReadme, true);
  assert.equal(rocket.language, 'TypeScript');
  assert.equal(rocket.stars, 4200);
  assert.equal(rocket.url, 'https://github.com/alice/rocket-core');
  const again = await importAll(w.app);
  assert.equal(again.import.added, 0);
  assert.equal(again.import.updated, 12);
  assert.equal(again.totals.projects, 12);
});

test('导入：gh 没登录又没填用户名，说清楚该怎么办', async (t) => {
  const w = await world(t, { mode: { notLoggedIn: true } });
  assert.equal((await w.app.post('/api/import', {})).status, 200);
  const s = await w.app.waitFor(async () => {
    const x = await w.app.state();
    return x.import.status !== 'running' ? x : null;
  });
  assert.equal(s.import.status, 'error');
  assert.equal(s.import.errorCode, 'need_user');
  assert.match(s.import.error, /用户名/);
  assert.equal(s.totals.projects, 0);
});

test('导入：没装 gh，填用户名走 GitHub 公开接口；只访问两个地址，不抓网页，也不冒充浏览器', async (t) => {
  const w = await world(t, { gh: false, git: false });
  const seen = withFakeFetch(t, async (url) => {
    if (url.startsWith('https://api.github.com/users/octocat/starred')) return json([star('octocat/Hello-World', 3), star('octocat/Spoon-Knife', 5)]);
    if (url === 'https://raw.githubusercontent.com/octocat/Hello-World/HEAD/README.md') return new Response('Hello World!\n');
    return new Response('not found', { status: 404 });
  });
  const s = await importAll(w.app, 'octocat');
  assert.equal(s.import.status, 'done');
  assert.equal(s.import.user, 'octocat');
  assert.equal(s.totals.projects, 2);
  assert.equal(s.github.transport, 'rest');
  assert.equal(s.github.gh, false);
  assert.ok(s.github.ghHint.length > 0, '没装 gh 要给安装办法');
  assert.equal((await w.app.get('/api/projects/octocat__hello-world')).json.hasReadme, true);
  assert.equal((await w.app.get('/api/projects/octocat__spoon-knife')).json.readme.status, 'none');
  assert.ok(seen.length >= 3);
  for (const r of seen) {
    assert.match(r.url, /^https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, '不该访问这两个以外的地址：' + r.url);
    assert.equal(r.headers['user-agent'], 'github-star-shelf/1.0');
    assert.ok(!('authorization' in r.headers) && !('cookie' in r.headers));
  }
});

test('导入：匿名被限流，如实报错：说多久后恢复、怎么解决；不重试，不换办法去抓网页', async (t) => {
  const w = await world(t, { gh: false, git: false });
  const seen = withFakeFetch(t, async () => json({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 1200) }));
  const s = await importAll(w.app, 'octocat');
  assert.equal(s.import.status, 'error');
  assert.equal(s.import.errorCode, 'rate_limited');
  assert.match(s.import.error, /约 (19|20) 分钟后恢复/);
  assert.match(s.import.error, /gh auth login/);
  assert.equal(seen.length, 1);
  assert.equal(s.totals.projects, 0);
});

test('导入：指定别人的用户名，读对方公开的 Star', async (t) => {
  const w = await world(t);
  const s = await importAll(w.app, 'some-friend');
  assert.equal(s.import.status, 'done');
  assert.equal(s.import.user, 'some-friend');
  assert.equal(s.settings.githubUser, 'some-friend', '填过的用户名会记住');
  assert.equal(s.import.total, null, '别人有多少个 Star 这里不知道，不能拿自己的数字充数');
  const args = (await readCalls(w.sb)).flatMap((c) => c.args);
  const rest = args.filter((a) => /^users?\/.*starred/.test(a));
  assert.ok(rest.length > 0 && rest.every((a) => a.startsWith('users/some-friend/starred')), rest.join());
  assert.ok(!args.some((a) => /^query=/.test(a)), '读别人的列表时不该去查自己的 Star 总数');
});

test('导入自己的 Star 时进度条知道总数', async (t) => {
  const w = await world(t);
  const s = await importAll(w.app);
  assert.equal(s.import.total, 12);
});

test('搜索：名称、README、备注三个范围；多个词要同时命中；语言、排序、翻页', async (t) => {
  const w = await world(t);
  await importAll(w.app);
  const q = async (qs) => (await w.app.get('/api/projects?' + qs)).json;
  const names = (r) => r.items.map((i) => i.fullName);

  const byName = await q('q=rocket');
  assert.deepEqual(names(byName), ['alice/rocket-core']);
  assert.equal(byName.items[0].match.where.name, true);

  const readmeOnly = await q('q=lunar-notes-readme&name=0&notes=0');
  assert.deepEqual(names(readmeOnly), ['bob/lunar-notes']);
  assert.equal(readmeOnly.items[0].match.where.readme, true);
  assert.equal(readmeOnly.items[0].match.snippet.scope, 'readme');
  assert.ok(readmeOnly.items[0].match.snippet.text.toLowerCase().includes('lunar-notes-readme'));

  const install = await q('q=install&name=0&notes=0&limit=50');
  assert.equal(install.total, 7);
  assert.ok(install.items.every((i) => i.match.where.readme));
  assert.equal((await q('q=install tools')).total, 7, '两个词都要命中：install 在 README 里，tools 在话题里');
  assert.equal((await q('q=install nonexistentword')).total, 0);
  assert.equal((await q('q=ROCKET')).total, 1, '不分大小写');

  const go = await q('language=Go');
  assert.deepEqual(names(go).sort(), ['bob/lunar-notes', 'frank/tide-charts', 'heidi/cloud-backup']);
  assert.deepEqual(Object.fromEntries(go.languages), { Go: 3, TypeScript: 2, Python: 2, Rust: 2, JavaScript: 1, 'C++': 1 });

  assert.equal((await q('sort=stars')).items[0].fullName, 'carol/agent-kit');
  assert.equal((await q('')).items[0].fullName, 'alice/rocket-core', '默认按 Star 时间，最近的在前');
  const page = await q('limit=5&offset=10');
  assert.equal(page.total, 12);
  assert.equal(page.items.length, 2);
  assert.equal((await q('status=unexplained')).total, 12);
  assert.equal((await q('status=explained')).total, 0);
  assert.equal((await q('status=noted')).total, 0);
});

test('收藏夹：新建、重名、保留名、改名、默认的改不了删不了、按收藏夹筛选', async (t) => {
  const w = await world(t);
  await importAll(w.app);
  const made = (await w.app.post('/api/collections', { name: '前端', description: 'web 相关' })).json;
  assert.equal(made.name, '前端');
  assert.equal(made.count, 0);
  assert.equal((await w.app.post('/api/collections', { name: '前端' })).status, 409);
  assert.equal((await w.app.post('/api/collections', { name: '全部' })).status, 400);
  assert.equal((await w.app.post('/api/collections', { name: '   ' })).status, 400);
  assert.equal((await w.app.post('/api/collections', { name: 'x'.repeat(31) })).status, 400);
  await w.app.post('/api/projects/' + KEY + '/collections', { add: [made.id], remove: [] });
  assert.ok((await w.app.get('/api/projects/' + KEY)).json.collections.includes(made.id));
  const renamed = (await w.app.api('PATCH', '/api/collections/' + made.id, { name: '前端项目' })).json;
  assert.equal(renamed.name, '前端项目');
  assert.equal(renamed.count, 1);
  assert.equal((await w.app.api('PATCH', '/api/collections/default', { name: 'x' })).status, 400);
  assert.equal((await w.app.api('DELETE', '/api/collections/default')).status, 400);
  assert.equal((await w.app.get('/api/projects?collection=' + made.id)).json.total, 1);
  assert.equal((await w.app.api('DELETE', '/api/collections/' + made.id)).status, 200);
  const after = (await w.app.get('/api/projects/' + KEY)).json;
  assert.ok(!after.collections.includes(made.id));
  assert.ok(after.collections.includes('default'), '删收藏夹不会删里面的项目');
  assert.equal((await w.app.api('DELETE', '/api/collections/' + made.id)).status, 404);
});

test('备注：加、改、删，搜索跟着变', async (t) => {
  const w = await world(t);
  await importAll(w.app);
  const base = '/api/projects/' + KEY + '/notes';
  const note = (await w.app.post(base, { text: '用户备注：很香 zzxyq' })).json;
  assert.equal(note.author, 'user');
  const hit = (await w.app.get('/api/projects?q=zzxyq')).json;
  assert.equal(hit.total, 1);
  assert.equal(hit.items[0].match.where.notes, true);
  assert.equal(hit.items[0].match.snippet.scope, 'notes');
  assert.equal((await w.app.api('PATCH', base + '/' + note.id, { text: '改过的备注 qqwwee' })).status, 200);
  assert.equal((await w.app.get('/api/projects?q=qqwwee')).json.total, 1);
  assert.equal((await w.app.get('/api/projects?q=zzxyq')).json.total, 0);
  assert.equal((await w.app.post(base, { text: '   ' })).status, 400);
  assert.equal((await w.app.get('/api/projects?q=qqwwee&status=noted')).json.total, 1);
  assert.equal((await w.app.api('DELETE', base + '/' + note.id)).status, 200);
  assert.equal((await w.app.get('/api/projects?q=qqwwee')).json.total, 0);
  assert.equal((await w.app.api('DELETE', base + '/' + note.id)).status, 404);
  assert.equal((await w.app.get('/api/projects/' + KEY)).json.noteCount, 0);
});

test('手动添加项目：网址和 owner/repo 都行；乱写的拒绝；查不到的说清楚；不会重复', async (t) => {
  const w = await world(t);
  const added = await w.app.post('/api/projects/add', { url: 'https://github.com/octocat/Hello-World' });
  assert.equal(added.status, 200);
  assert.equal(added.json.fullName, 'octocat/Hello-World');
  assert.deepEqual(added.json.collections, ['default']);
  assert.equal((await w.app.post('/api/projects/add', { url: 'octocat/hello-world' })).status, 200);
  assert.equal((await w.app.state()).totals.projects, 1, '同一个项目不会加两次');
  for (const bad of ['https://evil.example/a/b', 'just-a-word', '../../etc/passwd', '', 'a/b/c/d?x']) {
    const r = await w.app.post('/api/projects/add', { url: bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.json.error.code, 'bad_repo');
  }
  const missing = await w.app.post('/api/projects/add', { url: 'nobody/missing' });
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error.code, 'not_found');
  const mine = (await w.app.post('/api/collections', { name: '收集' })).json;
  const into = await w.app.post('/api/projects/add', { url: 'https://github.com/octocat/Hello-World.git', collection: '收集' });
  assert.deepEqual(into.json.collections, ['default', mine.id].filter((id) => id === 'default' || id === mine.id).sort((a, b) => (a === 'default' ? -1 : 1)), '已有的项目：加进指定收藏夹，原来的归属保留');
  assert.equal((await w.app.state()).totals.projects, 1);
});

test('删除项目、导出 Markdown', async (t) => {
  const w = await world(t);
  await importAll(w.app);
  await w.app.post('/api/projects/' + KEY + '/notes', { text: '值得细看' });
  const md = (await w.app.get('/api/export?collection=all')).json.markdown;
  assert.match(md, /^# 全部收藏\n\n共 12 个项目\n/);
  assert.ok(md.includes('- [alice/rocket-core](https://github.com/alice/rocket-core)（★ 4200）：Rocket engine simulator in TypeScript'));
  assert.ok(md.includes('  - 备注：值得细看'));
  assert.equal((await w.app.get('/api/export?collection=nope')).status, 404);
  assert.equal((await w.app.api('DELETE', '/api/projects/' + KEY)).status, 200);
  assert.equal((await w.app.get('/api/projects/' + KEY)).status, 404);
  assert.equal((await w.app.state()).totals.projects, 11);
  assert.equal((await w.app.api('DELETE', '/api/projects/' + KEY)).status, 404);
});

test('设置：逐项校验，一项不对整个不生效；改动会存盘', async (t) => {
  const w = await world(t);
  const bad = [{ concurrency: 9 }, { concurrency: 0 }, { effort: 'turbo' }, { imageMode: 'x' }, { githubUser: 'a b' }, { githubUser: '-'.repeat(40) }, { cloneMaxMB: 5 }, { cloneMaxMB: 99999 }];
  for (const patch of bad) {
    const r = await w.app.post('/api/settings', patch);
    assert.equal(r.status, 400, JSON.stringify(patch));
    assert.equal(r.json.error.code, 'bad_setting');
  }
  const mixed = await w.app.post('/api/settings', { concurrency: 3, effort: 'turbo' });
  assert.equal(mixed.status, 400);
  assert.equal((await w.app.state()).settings.concurrency, 2, '一项不对，其他项也不能生效');
  const ok = await w.app.post('/api/settings', { concurrency: 3, githubUser: 'octocat', effort: 'xhigh', imageMode: 'none', cloneMaxMB: 500 });
  assert.equal(ok.status, 200);
  await w.restart();
  const s = (await w.app.state()).settings;
  assert.deepEqual([s.concurrency, s.githubUser, s.effort, s.imageMode, s.cloneMaxMB], [3, 'octocat', 'xhigh', 'none', 500]);
});

test('重启后项目、收藏夹、备注、README 都还在', async (t) => {
  const w = await world(t);
  await importAll(w.app);
  const made = (await w.app.post('/api/collections', { name: '常用' })).json;
  await w.app.post('/api/projects/' + KEY + '/collections', { add: [made.id], remove: [] });
  await w.app.post('/api/projects/' + KEY + '/notes', { text: '重启也要在 persist-me' });
  await w.restart();
  const s = await w.app.state();
  assert.equal(s.totals.projects, 12);
  assert.equal(s.totals.withReadme, 11);
  assert.equal(s.totals.noted, 1);
  assert.equal(s.collections.find((c) => c.id === made.id).count, 1);
  assert.equal((await w.app.get('/api/projects?q=persist-me')).json.total, 1);
  assert.match((await w.app.get('/api/projects/' + KEY + '/readme')).json.text, /Unique-token: alice-rocket-core-readme/);
});

test('MCP：握手、列工具、12 个工具都能用，出错说得清楚', async (t) => {
  const w = await world(t);
  await importAll(w.app);
  const init = await w.app.mcp('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.equal(init.json.result.protocolVersion, '2025-03-26');
  assert.equal(init.json.result.serverInfo.name, 'github-star-shelf');
  assert.equal((await w.app.mcp('initialize', { protocolVersion: '1999-01-01' })).json.result.protocolVersion, '2025-06-18', '不认识的版本，回答自己支持的最新版');
  assert.equal((await w.app.post('/mcp/github-star-shelf', { jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
  const list = await w.app.mcp('tools/list');
  assert.deepEqual(list.json.result.tools.map((x) => x.name).sort(), ['add_note', 'add_to_collection', 'create_collection', 'delete_collection', 'delete_note', 'get_project', 'import_stars', 'list_collections', 'list_projects', 'remove_from_collection', 'rename_collection', 'update_note']);
  assert.ok(list.json.result.tools.every((x) => x.description && x.inputSchema.type === 'object'));

  const tool = w.app.tool;
  const colls = await tool('list_collections');
  assert.equal(colls.data.length, 1);
  assert.equal(colls.data[0].count, 12);
  const made = await tool('create_collection', { name: 'AI 编程', description: '做 AI 应用用得上' });
  assert.equal(made.data.name, 'AI 编程');
  const added = await tool('add_to_collection', { collection: 'AI 编程', repos: ['alice/rocket-core', 'https://github.com/carol/agent-kit', 'definitely-not-real-xyz/nope-123'] });
  assert.deepEqual(added.data.done, ['alice/rocket-core', 'carol/agent-kit']);
  assert.equal(added.data.failed.length, 1);
  assert.match(added.data.failed[0].reason, /找不到/);
  assert.equal((await tool('list_projects', { collection: 'AI 编程' })).data.total, 2);
  assert.equal((await tool('list_projects', { query: 'install', scope: 'readme' })).data.total, 7);
  assert.equal((await tool('list_projects', { query: 'install', scope: 'name' })).data.total, 0);
  const note = await tool('add_note', { repo: 'alice/rocket-core', text: 'AI 写的备注 hhjjkk' });
  assert.equal(note.data.repo, 'alice/rocket-core');
  let proj = (await tool('get_project', { repo: 'alice/rocket-core' })).data;
  assert.ok(proj.notes.some((n) => n.by === 'ai' && n.text.includes('hhjjkk')));
  assert.ok(proj.collections.includes('AI 编程'));
  assert.match(proj.readme_head, /rocket-core/);
  assert.equal((await w.app.get('/api/projects?q=hhjjkk')).json.total, 1, 'AI 记的备注页面也搜得到');
  assert.equal((await tool('update_note', { repo: 'alice/rocket-core', note_id: note.data.id, text: '改了 mmnnbb' })).data.updated, true);
  assert.equal((await w.app.get('/api/projects?q=mmnnbb')).json.total, 1);
  assert.equal((await tool('delete_note', { repo: 'alice/rocket-core', note_id: note.data.id })).ok, true);
  assert.equal((await tool('rename_collection', { collection: 'AI 编程', name: 'AI 编程助手' })).data.name, 'AI 编程助手');
  assert.equal((await tool('rename_collection', { collection: '默认收藏夹', name: '换个名' })).ok, false);
  assert.equal((await tool('remove_from_collection', { collection: 'AI 编程助手', repos: ['carol/agent-kit'] })).data.done.length, 1);
  assert.equal((await tool('list_projects', { collection: 'AI 编程助手' })).data.total, 1);
  assert.equal((await tool('delete_collection', { collection: '默认收藏夹' })).ok, false);
  assert.equal((await tool('delete_collection', { collection: 'AI 编程助手' })).ok, true);
  proj = (await tool('get_project', { repo: 'alice/rocket-core' })).data;
  assert.ok(!proj.collections.includes('AI 编程助手'));
  const imp = await tool('import_stars', {});
  assert.equal(imp.data.status, 'done');
  assert.equal(imp.data.updated, 12);

  for (const [name, args, pattern] of [
    ['add_note', { repo: 'alice/rocket-core' }, /缺少参数：text/],
    ['get_project', { repo: 'a' }, /项目地址不对/],
    ['get_project', { repo: 'nobody/missing' }, /项目库里还没有/],
    ['add_to_collection', { collection: '不存在', repos: ['a/b'] }, /没有这个收藏夹/],
    ['add_to_collection', { collection: '默认收藏夹', repos: [] }, /不能是空的/],
    ['list_projects', { collection: '不存在' }, /没有这个收藏夹/],
  ]) {
    const r = await tool(name, args);
    assert.equal(r.ok, false, name);
    assert.match(r.error, pattern, name);
  }
  assert.equal((await w.app.mcp('tools/call', { name: 'nope' })).json.error.code, -32602);
  assert.equal((await w.app.mcp('no/such/method')).json.error.code, -32601);
  assert.equal((await w.app.post('/mcp/github-star-shelf', {})).json.error.code, -32600);
  const batch = await w.app.post('/mcp/github-star-shelf', [{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]);
  assert.equal(batch.json.length, 2);
  assert.equal((await w.app.get('/mcp/github-star-shelf')).status, 405);
});

test('实时推送：导入进度和数据变化会推给页面', async (t) => {
  const w = await world(t);
  const sse = await listen(w.app);
  t.after(sse.close);
  await importAll(w.app);
  await w.app.waitFor(() => sse.events.some((e) => e.type === 'prefetch' && e.view.status === 'done'), { what: 'prefetch event' });
  const types = new Set(sse.events.map((e) => e.type));
  for (const x of ['hello', 'import', 'prefetch', 'changed']) assert.ok(types.has(x), x);
  assert.equal(sse.events[0].type, 'hello');
  assert.equal(sse.events.filter((e) => e.type === 'import').at(-1).view.status, 'done');
});
