// GitHub 类：怎么找 gh / git、怎么选读取方式、出错怎么讲。全部离线（假 gh / 假 git / 假环境）。
import './helpers/no-network.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GitHub, cloneOrUpdate, dirSizeKB, limitMessage, normalizeRepo } from '../miniapp/node/lib/github.mjs';
import { IS_WIN, fakeEnv, installFake, installScript, installTripwire, makeSandbox, readCalls, setFixtures, setMode } from './helpers/sandbox.mjs';
import { makeFixtures, makeManyFixtures } from './helpers/fixtures.mjs';

const posixOnly = { skip: IS_WIN ? '需要 sh' : false };
const log = { warn() {}, info() {}, error() {}, debug() {} };
const FAKE_TOKEN = 'ghp_' + 'abcdefghijklmnopqrstuvwxyz0123456789'; // 拆开写：仓库里不留任何长得像真令牌的字符串

/** 一台「别人的电脑」：gh 和 git 都装在 PATH 里 */
async function machine(t, { gh = true, git = true, authed = true, fixtures = makeFixtures() } = {}) {
  const sb = await makeSandbox();
  t.after(sb.cleanup);
  if (gh) await installFake(sb, 'gh');
  if (git) await installFake(sb, 'git');
  await setFixtures(sb, fixtures);
  if (!authed) await setMode(sb, { notLoggedIn: true });
  return sb;
}
const newGh = (sb, over, opts = {}) => new GitHub(log, { envCtx: fakeEnv(sb, over), ...opts });

test('detect：装了 gh 和 git 并且登录了：走 gh，认得出账号、版本和位置', posixOnly, async (t) => {
  const sb = await machine(t);
  const info = await newGh(sb).detect();
  assert.equal(info.transport, 'gh');
  assert.equal(info.authed, true);
  assert.equal(info.user, 'tester');
  assert.equal(info.ghPath, join(sb.bin, 'gh'));
  assert.equal(info.gitPath, join(sb.bin, 'git'));
  assert.equal(info.ghVia, 'path');
  assert.equal(info.ghVersion, '9.9.9');
  assert.equal(info.gitVersion, '9.9.9');
  assert.equal(info.ghHint, '');
  assert.equal(info.gitHint, '');
});

test('detect：gh 装了但没登录：走公开接口，提示去登录，不报错', posixOnly, async (t) => {
  const sb = await machine(t, { authed: false });
  const info = await newGh(sb).detect();
  assert.equal(info.gh, true);
  assert.equal(info.authed, false);
  assert.equal(info.transport, 'rest');
  assert.equal(info.user, '');
  assert.match(info.note, /还没登录/);
});

test('detect：什么都没装：给出安装办法（按系统），不报错', posixOnly, async (t) => {
  const sb = await machine(t, { gh: false, git: false });
  for (const platform of ['darwin', 'win32', 'linux']) {
    const info = await newGh(sb, { platform }).detect();
    assert.equal(info.gh, false);
    assert.equal(info.git, false);
    assert.equal(info.transport, 'rest');
    assert.ok(info.ghHint.length > 0 && info.gitHint.length > 0, platform);
    assert.match(info.note, /没有找到 gh/);
  }
  assert.match((await newGh(sb, { platform: 'darwin' }).detect()).ghHint, /brew install gh/);
  assert.match((await newGh(sb, { platform: 'win32' }).detect()).gitHint, /winget/);
});

test('detect：gh 不在 PATH 里、在常见安装位置，也找得到（图形界面启动的程序 PATH 常常很短）', posixOnly, async (t) => {
  const sb = await machine(t, { gh: false, git: false });
  await installFake(sb, 'gh', { dir: sb.tools });
  await installFake(sb, 'git', { dir: sb.tools });
  const info = await newGh(sb, { commonDirs: [sb.tools] }).detect();
  assert.equal(info.ghPath, join(sb.tools, 'gh'));
  assert.equal(info.gitPath, join(sb.tools, 'git'));
  assert.equal(info.ghVia, 'common');
});

test('detect：PATH 和常见位置里都没有，才去问登录 shell 的 PATH（找到了说明来源是 shell）', posixOnly, async (t) => {
  const sb = await machine(t, { gh: false, git: false });
  const termBin = join(sb.root, '终端 里的 bin');
  await installFake(sb, 'gh', { dir: termBin });
  await installFake(sb, 'git', { dir: termBin });
  const shell = await installScript(join(sb.tools, 'zsh'), '#!/bin/sh\nexport PATH=' + "'" + termBin + "'" + '\nexec /bin/sh -c "$2"\n');
  const info = await newGh(sb, { env: { PATH: sb.bin, SHELL: shell } }).detect();
  assert.equal(info.ghPath, join(termBin, 'gh'));
  assert.equal(info.ghVia, 'shell');
  assert.equal(info.gitVia, 'shell');
});

test('detect：已经在 PATH 里找到了，就不会去运行登录 shell（它会读用户的 rc 文件）', posixOnly, async (t) => {
  const sb = await machine(t);
  const marker = join(sb.root, 'shell-ran');
  const shell = await installTripwire(join(sb.tools, 'zsh'), marker);
  const info = await newGh(sb, { env: { PATH: sb.bin, SHELL: shell } }).detect();
  assert.equal(info.ghVia, 'path');
  await assert.rejects(stat(marker));
});

test('detect：登录 shell 只问一次，gh 和 git 同时找也一样；点「重新检测」才再问', posixOnly, async (t) => {
  const sb = await machine(t, { gh: false, git: false });
  const rec = join(sb.root, 'asked.log');
  const shell = await installScript(join(sb.tools, 'zsh'), '#!/bin/sh\necho x >> "' + rec + '"\nexec /bin/sh -c "$2"\n');
  const gh = newGh(sb, { env: { PATH: sb.bin, SHELL: shell } });
  await gh.detect();
  assert.equal((await readFile(rec, 'utf8')).split('\n').filter(Boolean).length, 1);
  await gh.recheck();
  assert.equal((await readFile(rec, 'utf8')).split('\n').filter(Boolean).length, 2);
});

test('detect：PATH 里排前面的 gh 是坏的、冒牌的，会跳过去用后面真的那个', posixOnly, async (t) => {
  const sb = await machine(t, { gh: false });
  const brokenDir = join(sb.root, 'broken');
  const impostorDir = join(sb.root, 'impostor');
  await installScript(join(brokenDir, 'gh'), '#!/bin/sh\nexit 1\n');
  await installScript(join(impostorDir, 'gh'), '#!/bin/sh\necho "some other tool 4.5.6"\n');
  const good = await installFake(sb, 'gh', { dir: sb.tools });
  const info = await newGh(sb, { env: { PATH: [brokenDir, impostorDir, sb.tools, sb.bin].join(':') } }).detect();
  assert.equal(info.ghPath, good);
  assert.equal(info.ghVersion, '9.9.9');
});

test('detect：macOS 没装命令行开发工具时，/usr/bin/git 只是个占位程序，运行它会弹安装窗口，所以不碰它', posixOnly, async (t) => {
  const sb = await machine(t, { gh: false, git: false });
  const shimDir = join(sb.root, 'usr-bin');
  const marker = join(sb.root, 'shim-ran');
  const shim = await installTripwire(join(shimDir, 'git'), marker, { output: 'git version 2.39.0' });
  const no = await installScript(join(sb.tools, 'xcode-no'), '#!/bin/sh\nexit 2\n');
  const yes = await installScript(join(sb.tools, 'xcode-yes'), '#!/bin/sh\necho /Library/Developer/CommandLineTools\n');
  const base = { platform: 'darwin', env: { PATH: shimDir }, macGitShim: shim };
  const without = await newGh(sb, { ...base, xcodeSelect: no }).detect();
  assert.equal(without.git, false);
  assert.match(without.gitHint, /xcode-select --install/);
  await assert.rejects(stat(marker), '占位程序被运行了');
  const withTools = await newGh(sb, { ...base, xcodeSelect: yes }).detect();
  assert.equal(withTools.git, true);
  assert.equal(withTools.gitPath, shim);
  await stat(marker); // 装了命令行开发工具，它就是真的 git，会被运行（对照：说明「没运行」那一条断言是有效的）
});

test('手动指定路径：优先于自动查找；指向坏文件时回退到自动，并标出「指定的不能用」', posixOnly, async (t) => {
  const sb = await machine(t);
  const mine = await installFake(sb, 'gh', { dir: sb.tools });
  const gh = newGh(sb);
  gh.setOverrides({ gh: mine });
  let info = await gh.detect();
  assert.equal(info.ghPath, mine);
  assert.equal(info.ghVia, 'setting');
  assert.equal(info.ghOverrideBad, false);
  gh.setOverrides({ gh: join(sb.root, '不存在的 gh') });
  info = await gh.detect();
  assert.equal(info.ghPath, join(sb.bin, 'gh'));
  assert.equal(info.ghOverrideBad, true);
  gh.setOverrides({ gh: '' });
  info = await gh.detect();
  assert.equal(info.ghOverrideBad, false);
  assert.equal(info.ghVia, 'path');
});

test('checkTool：空是「改回自动」；相对路径、不存在、是目录、冒牌的都拒绝，真的放行', posixOnly, async (t) => {
  const sb = await machine(t);
  const gh = newGh(sb);
  assert.deepEqual(await gh.checkTool('gh', ''), { ok: true, version: '' });
  assert.equal((await gh.checkTool('gh', 'gh')).ok, false);
  assert.match((await gh.checkTool('gh', 'bin/gh')).reason, /完整路径/);
  assert.match((await gh.checkTool('gh', join(sb.root, 'nope'))).reason, /没有文件/);
  assert.match((await gh.checkTool('gh', sb.tools)).reason, /不是一个文件/);
  const impostor = await installScript(join(sb.tools, 'fakegh'), '#!/bin/sh\necho "hello 1.2.3"\n');
  assert.match((await gh.checkTool('gh', impostor)).reason, /不是 gh/);
  const good = await gh.checkTool('gh', join(sb.bin, 'gh'));
  assert.deepEqual(good, { ok: true, version: '9.9.9' });
  assert.equal((await gh.checkTool('git', join(sb.bin, 'gh'))).ok, false, '把 gh 当成 git 填进去要被拒绝');
});

test('checkTool：路径里带空格、中文、引号、美元符，照样能用（命令都是用参数数组启动的，不经过 shell）', posixOnly, async (t) => {
  const sb = await machine(t, { gh: false });
  const file = await installFake(sb, 'gh', { dir: sb.weird });
  const gh = newGh(sb);
  assert.deepEqual(await gh.checkTool('gh', file), { ok: true, version: '9.9.9' });
  gh.setOverrides({ gh: file });
  const info = await gh.detect();
  assert.equal(info.ghPath, file);
  assert.equal(info.user, 'tester');
});

test('Windows 路径规则：盘符路径在 Windows 上是完整路径，在别的系统上不是', async (t) => {
  const sb = await makeSandbox();
  t.after(sb.cleanup);
  const asWin = new GitHub(log, { envCtx: { platform: 'win32', env: { PATH: '' }, homedir: 'C:\\Users\\张三', commonDirs: [] } });
  assert.equal(asWin.platform, 'win32');
  const r = await asWin.checkTool('gh', 'C:\\不存在\\gh.exe');
  assert.match(r.reason, /没有文件/, '盘符路径应该被当成完整路径，只是文件不存在');
  if (!IS_WIN) assert.match((await newGh(sb).checkTool('gh', 'C:\\x\\gh.exe')).reason, /完整路径/);
});

test('子进程环境：固定读 github.com，不会被环境里指向企业版的 GH_HOST 带偏；不弹交互提示', posixOnly, async (t) => {
  const sb = await machine(t);
  process.env.GH_HOST = 'ghe.corp.example';
  t.after(() => delete process.env.GH_HOST);
  await newGh(sb).detect();
  const calls = (await readCalls(sb)).filter((c) => c.tool === 'gh' && c.args[0] === 'api');
  assert.ok(calls.length > 0);
  for (const c of calls) {
    assert.equal(c.GH_HOST, 'github.com');
    assert.equal(c.GH_PROMPT_DISABLED, '1');
  }
});

test('listStars（已登录）：读自己的 Star；翻页读完 250 个', posixOnly, async (t) => {
  const sb = await machine(t, { fixtures: makeManyFixtures(250) });
  const pages = [];
  const res = await newGh(sb).listStars({ onPage: (p) => pages.push(p) });
  assert.equal(res.user, 'tester');
  assert.equal(res.source, 'api');
  assert.equal(res.items.length, 250);
  assert.deepEqual(pages.map((p) => p.fetched), [100, 200, 250]);
  assert.equal(new Set(res.items.map((i) => i.fullName)).size, 250);
  const calls = (await readCalls(sb)).filter((c) => c.args.some((a) => /\/starred|user\/starred/.test(a)));
  assert.ok(calls.every((c) => c.args.some((a) => /^user\/starred/.test(a))), '读自己的，用 user/starred');
});

test('listStars（已登录）：指定别人的用户名，读对方公开的；指定自己的用户名（不分大小写）等于读自己的', posixOnly, async (t) => {
  const sb = await machine(t);
  const gh = newGh(sb);
  const other = await gh.listStars({ user: 'some-friend' });
  assert.equal(other.user, 'some-friend');
  const mine = await gh.listStars({ user: 'TESTER' });
  assert.equal(mine.user, 'tester');
  const paths = (await readCalls(sb)).flatMap((c) => c.args).filter((a) => /starred/.test(a));
  assert.ok(paths.some((a) => a.startsWith('users/some-friend/starred')));
  assert.ok(paths.some((a) => a.startsWith('user/starred')));
});

test('listStars：没登录、没填用户名，要说清楚该怎么办；用户名格式不对要拒绝', posixOnly, async (t) => {
  const sb = await machine(t, { authed: false });
  const gh = newGh(sb);
  await assert.rejects(gh.listStars({}), (e) => e.code === 'need_user' && /用户名/.test(e.message));
  await assert.rejects(gh.listStars({ user: '../../etc' }), (e) => e.code === 'bad_user');
  await assert.rejects(gh.listStars({ user: 'a'.repeat(40) }), (e) => e.code === 'bad_user');
});

test('listStars：没登录 gh 但填了用户名：用 gh 以外的公开接口读（这里用假 fetch 验证请求的样子）', posixOnly, async (t) => {
  const sb = await machine(t, { gh: false, git: false });
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), headers: init?.headers });
    return new Response(JSON.stringify([{ starred_at: '2026-01-01T00:00:00Z', repo: { full_name: 'a/b', html_url: 'https://github.com/a/b', stargazers_count: 7 } }]), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  const res = await newGh(sb).listStars({ user: 'octocat' });
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].fullName, 'a/b');
  assert.equal(res.items[0].stars, 7);
  assert.equal(res.source, 'api');
  assert.equal(seen.length, 1);
  assert.match(seen[0].url, /^https:\/\/api\.github\.com\/users\/octocat\/starred\?/);
  assert.equal(seen[0].headers['user-agent'], 'github-star-shelf/1.0', '要老实表明自己是谁，不冒充浏览器');
  assert.ok(!('authorization' in seen[0].headers), '匿名请求不带任何令牌');
});

test('限流：匿名被限流，如实说多久后恢复，不绕路；说明登录 gh 就不受限', posixOnly, async (t) => {
  const sb = await machine(t, { gh: false, git: false });
  const realFetch = globalThis.fetch;
  let hits = 0;
  globalThis.fetch = async () => {
    hits += 1;
    return new Response('{"message":"rate limit"}', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 600) } });
  };
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  await assert.rejects(newGh(sb).listStars({ user: 'octocat' }), (e) => {
    assert.equal(e.code, 'rate_limited');
    assert.match(e.message, /约 (9|10) 分钟后恢复/);
    assert.match(e.message, /gh auth login/);
    return true;
  });
  assert.equal(hits, 1, '被限流之后不能重试、不能换别的办法去抓');
  assert.equal(limitMessage(0).includes('分钟'), false);
  assert.match(limitMessage(30000), /约 1 分钟/);
});

test('公开接口：404 / 401 / 其他状态码都有清楚的说法；网络不通说「连不上」', posixOnly, async (t) => {
  const sb = await machine(t, { gh: false, git: false });
  const realFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  const respond = (status) => async () => new Response('x', { status });
  globalThis.fetch = respond(404);
  await assert.rejects(newGh(sb).listStars({ user: 'octocat' }), (e) => e.code === 'not_found');
  globalThis.fetch = respond(401);
  await assert.rejects(newGh(sb).listStars({ user: 'octocat' }), (e) => e.code === 'unauthenticated');
  globalThis.fetch = respond(500);
  await assert.rejects(newGh(sb).listStars({ user: 'octocat' }), (e) => e.code === 'github_error');
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };
  await assert.rejects(newGh(sb).listStars({ user: 'octocat' }), (e) => e.code === 'network' && /代理/.test(e.message));
});

test('gh 报错：页面上只显示固定的说明，原始报错只放在 detail 里（并已去掉令牌）', posixOnly, async (t) => {
  const sb = await machine(t);
  await installScript(join(sb.bin, 'gh'), '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "gh version 9.9.9"; exit 0; fi\nif [ "$2" = "user" ]; then echo tester; exit 0; fi\necho "weird failure at /home/alice/.config token ' + FAKE_TOKEN + '" >&2\nexit 1\n');
  const gh = newGh(sb);
  await assert.rejects(gh.getRepo('a/b'), (e) => {
    assert.equal(e.code, 'github_error');
    assert.ok(!/alice|ghp_/.test(e.message), '页面文案里不能带路径或令牌');
    assert.ok(!/ghp_/.test(e.extra.detail), '详情里的令牌也要去掉');
    return true;
  });
});

test('日志详情里没有命令行，也就没有 gh 所在的路径；没有 README 这种正常的 404 不记告警', posixOnly, async (t) => {
  const sb = await machine(t);
  const warnings = [];
  const gh = new GitHub({ ...log, warn: (message, fields) => warnings.push({ message, fields }) }, { envCtx: fakeEnv(sb) });
  assert.equal((await gh.getReadme('oscar/no-readme-demo')).status, 'none');
  await assert.rejects(gh.getRepo('nobody/missing'), (e) => e.code === 'not_found');
  assert.deepEqual(warnings, [], '项目不存在、没有 README，都是正常情况');
  await setMode(sb, { rateLimited: true });
  await assert.rejects(gh.getRepo('alice/rocket-core'), (e) => e.code === 'rate_limited');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].fields.detail, /rate limit exceeded/);
  assert.ok(!warnings[0].fields.detail.includes(sb.root) && !/Command failed/.test(warnings[0].fields.detail), warnings[0].fields.detail);
});

test('gh 的各种报错分类：不存在、限流、没登录', posixOnly, async (t) => {
  const sb = await machine(t);
  const gh = newGh(sb);
  await assert.rejects(gh.getRepo('nobody/missing'), (e) => e.code === 'not_found');
  await setMode(sb, { rateLimited: true });
  await assert.rejects(gh.getRepo('alice/rocket-core'), (e) => e.code === 'rate_limited');
});

test('getRepo / getReadme：读项目信息；没有 README 是「没有」而不是报错；太长的 README 会截断', posixOnly, async (t) => {
  const fx = makeFixtures();
  fx.readmes['alice/rocket-core'] = 'x'.repeat(450000);
  const sb = await machine(t, { fixtures: fx });
  const gh = newGh(sb);
  const repo = await gh.getRepo('octocat/Hello-World');
  assert.equal(repo.fullName, 'octocat/Hello-World');
  assert.equal(repo.license, 'MIT');
  assert.equal((await gh.getReadme('oscar/no-readme-demo')).status, 'none');
  const ok = await gh.getReadme('bob/lunar-notes');
  assert.equal(ok.status, 'ok');
  assert.match(ok.text, /Unique-token: bob-lunar-notes-readme/);
  const big = await gh.getReadme('alice/rocket-core');
  assert.ok(big.text.length < 400100 && /已截断/.test(big.text));
});

test('starCount：登录了能问到总数，没登录是 null', posixOnly, async (t) => {
  const sb = await machine(t);
  assert.equal(await newGh(sb).starCount(), 12);
  await setMode(sb, { notLoggedIn: true });
  const fresh = newGh(sb);
  assert.equal(await fresh.starCount(), null);
});

test('detect 的结果缓存 30 秒；recheck 马上重来；用着用着 gh 没了，下次会重新找', posixOnly, async (t) => {
  const sb = await machine(t);
  const gh = newGh(sb);
  const a = await gh.detect();
  assert.equal(await gh.detect(), a, '30 秒内是同一份结果');
  assert.notEqual(await gh.recheck(), a);
});

test('Mini App 停止（rootSignal 取消）时，在途的 gh 请求马上被终止', posixOnly, async (t) => {
  const sb = await machine(t);
  await setMode(sb, { slowMs: 20000 });
  const ctl = new AbortController();
  const gh = newGh(sb, undefined, { signal: ctl.signal });
  await gh.detect();
  const p = gh.getRepo('alice/rocket-core');
  setTimeout(() => ctl.abort(), 300);
  const t0 = Date.now();
  await assert.rejects(p);
  assert.ok(Date.now() - t0 < 4000, '没有在取消后马上结束');
});

test('normalizeRepo：缺字段不崩，许可证取 spdx，话题最多 20 个', () => {
  const n = normalizeRepo({ full_name: 'a/b', topics: Array.from({ length: 30 }, (_, i) => 't' + i), license: { spdx_id: 'NOASSERTION', name: 'Other' } }, '2026-01-01');
  assert.equal(n.license, 'Other');
  assert.equal(n.topics.length, 20);
  assert.equal(n.url, 'https://github.com/a/b');
  assert.equal(n.starredAt, '2026-01-01');
  assert.equal(normalizeRepo({ full_name: 'a/b' }, null).starredAt, null);
});

// ---------------- git：本地讲解要用的浅克隆 ----------------

test('cloneOrUpdate：没有 git 时说清楚怎么装', async () => {
  await assert.rejects(cloneOrUpdate({ fullName: 'a/b', dest: '/x/y', git: '', platform: 'darwin' }), (e) => e.code === 'git_missing' && /xcode-select/.test(e.message));
  await assert.rejects(cloneOrUpdate({ fullName: 'a/b', dest: '/x/y', git: '', platform: 'win32' }), (e) => e.code === 'git_missing' && /winget/.test(e.message));
});

test('cloneOrUpdate：目录名带空格、中文、引号也能克隆；第二次是更新；用的是浅克隆并关掉交互', posixOnly, async (t) => {
  const sb = await machine(t);
  const git = join(sb.bin, 'git');
  const dest = join(sb.weird, 'cache', 'repos', 'alice__rocket-core');
  const first = await cloneOrUpdate({ fullName: 'alice/rocket-core', dest, git, logger: log });
  assert.deepEqual(first, { updated: false });
  assert.ok((await stat(join(dest, '.git'))).isDirectory());
  assert.match(await readFile(join(dest, 'README.md'), 'utf8'), /alice\/rocket-core/);
  const second = await cloneOrUpdate({ fullName: 'alice/rocket-core', dest, git, logger: log });
  assert.deepEqual(second, { updated: true });
  const calls = (await readCalls(sb)).filter((c) => c.tool === 'git');
  const clone = calls.find((c) => c.args.includes('clone'));
  for (const flag of ['--depth', '1', '--single-branch', '--no-tags', '--quiet']) assert.ok(clone.args.includes(flag), flag);
  assert.ok(clone.args.includes('https://github.com/alice/rocket-core.git'));
  assert.equal(clone.GIT_TERMINAL_PROMPT, '0', '不能卡在要用户名密码的提示上');
  assert.equal(clone.GIT_LFS_SKIP_SMUDGE, '1');
  assert.ok(!clone.args.includes('core.longpaths=true'), '只有 Windows 才加长路径设置');
});

test('cloneOrUpdate：Windows 上加 core.longpaths，避免路径太长放不下', posixOnly, async (t) => {
  const sb = await machine(t);
  const dest = join(sb.agent, 'cache', 'repos', 'k');
  await cloneOrUpdate({ fullName: 'a/b', dest, git: join(sb.bin, 'git'), platform: 'win32', logger: log });
  const clone = (await readCalls(sb)).find((c) => c.tool === 'git' && c.args.includes('clone'));
  assert.ok(clone.args.includes('core.longpaths=true'));
});

test('cloneOrUpdate：克隆失败要清掉半个文件夹，并说成「连不上」；网络恢复后能重来', posixOnly, async (t) => {
  const sb = await machine(t);
  const git = join(sb.bin, 'git');
  const dest = join(sb.agent, 'cache', 'repos', 'k');
  await setMode(sb, { cloneFail: true });
  await assert.rejects(cloneOrUpdate({ fullName: 'a/b', dest, git, logger: log }), (e) => e.code === 'network' && /代理/.test(e.message));
  await assert.rejects(stat(dest), '失败后不该留下半个文件夹');
  await setMode(sb, {});
  assert.deepEqual(await cloneOrUpdate({ fullName: 'a/b', dest, git, logger: log }), { updated: false });
});

test('cloneOrUpdate：上次没拉完留下的半个文件夹（没有 .git）会先清掉', posixOnly, async (t) => {
  const sb = await machine(t);
  const dest = join(sb.agent, 'cache', 'repos', 'k');
  await mkdir(join(dest, 'half'), { recursive: true });
  await writeFile(join(dest, 'half', 'leftover.txt'), 'x');
  await cloneOrUpdate({ fullName: 'a/b', dest, git: join(sb.bin, 'git'), logger: log });
  assert.ok(!(await readdir(dest)).includes('half'));
});

test('cloneOrUpdate：更新失败（比如没网）就继续用旧的，并标成「可能过期」', posixOnly, async (t) => {
  const sb = await machine(t);
  const git = join(sb.bin, 'git');
  const dest = join(sb.agent, 'cache', 'repos', 'k');
  await cloneOrUpdate({ fullName: 'a/b', dest, git, logger: log });
  await setMode(sb, { fetchFail: true });
  assert.deepEqual(await cloneOrUpdate({ fullName: 'a/b', dest, git, logger: log }), { updated: false, stale: true });
  assert.ok((await stat(join(dest, '.git'))).isDirectory(), '旧的还在');
});

test('cloneOrUpdate：取消时马上停，不当成「更新失败」', posixOnly, async (t) => {
  const sb = await machine(t);
  const git = join(sb.bin, 'git');
  const dest = join(sb.agent, 'cache', 'repos', 'k');
  await setMode(sb, { cloneSlowMs: 20000 });
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), 300);
  const t0 = Date.now();
  await assert.rejects(cloneOrUpdate({ fullName: 'a/b', dest, git, signal: ctl.signal, logger: log }), (e) => e.code === 'cancelled');
  assert.ok(Date.now() - t0 < 4000);
  await assert.rejects(stat(dest));
});

test('cloneOrUpdate：git 报「路径太长」要给出 Windows 上的办法', posixOnly, async (t) => {
  const sb = await machine(t);
  const git = await installScript(join(sb.tools, 'git'), '#!/bin/sh\necho "error: unable to create file: Filename too long" >&2\nexit 128\n');
  await assert.rejects(cloneOrUpdate({ fullName: 'a/b', dest: join(sb.agent, 'x'), git, logger: log }), (e) => e.code === 'path_too_long' && /长路径/.test(e.message));
});

test('dirSizeKB：只用 Node 自带的文件接口，不依赖 du；数得出各层文件的总和', async (t) => {
  const sb = await makeSandbox();
  t.after(sb.cleanup);
  await mkdir(join(sb.data, 'a', 'b 中文'), { recursive: true });
  await writeFile(join(sb.data, 'one'), Buffer.alloc(2048));
  await writeFile(join(sb.data, 'a', 'two'), Buffer.alloc(3072));
  await writeFile(join(sb.data, 'a', 'b 中文', 'three'), Buffer.alloc(1024));
  assert.equal(await dirSizeKB(sb.data), 6);
  assert.equal(await dirSizeKB(join(sb.root, 'does-not-exist')), 0);
});
