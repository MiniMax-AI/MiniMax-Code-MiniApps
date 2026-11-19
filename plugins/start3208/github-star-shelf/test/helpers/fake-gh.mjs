#!/usr/bin/env node
// 假 gh：只会说测试里用到的那几句，别的一概报错。状态放在 SHELF_FAKE_STATE 指向的文件夹里：
//   fixtures.json  假数据    mode.json  让它故意出故障    calls.log  每次被调用都记一行
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.SHELF_FAKE_STATE || '';
const args = process.argv.slice(2);
const read = (file, fallback) => {
  try {
    return JSON.parse(readFileSync(join(dir, file), 'utf8'));
  } catch {
    return fallback;
  }
};
const fx = read('fixtures.json', { login: 'tester', repos: [], extra: [], readmes: {} });
const mode = read('mode.json', {});
if (dir) {
  const line = { tool: 'gh', args, tag: process.env.SHELF_FAKE_TAG || '', GH_HOST: process.env.GH_HOST || '', GH_PROMPT_DISABLED: process.env.GH_PROMPT_DISABLED || '' };
  appendFileSync(join(dir, 'calls.log'), JSON.stringify(line) + '\n');
}
// 任何一次启动都先记下进程号、再睡一会儿：用来测「检测 gh / git」这类一启动就卡住的情况
if (mode.startPidFile) writeFileSync(mode.startPidFile, String(process.pid));
if (mode.startSlowMs) await new Promise((r) => setTimeout(r, mode.startSlowMs));
const fail = (message, code = 1) => {
  process.stderr.write(message + '\n');
  process.exit(code);
};
/** 写完再退出。输出比管道缓冲（约 64KB）大时，写完立刻 process.exit 会把后面的内容丢掉。永不 resolve：await done(...) 之后的代码不会执行 */
const done = (text = '') => new Promise(() => process.stdout.write(text, () => process.exit(0)));

if (args[0] === '--version') await done('gh version 9.9.9 (fake)\nhttps://example.invalid/fake\n');
if (args[0] !== 'api') fail('fake gh: unsupported command ' + args.join(' '), 2);
const rest = args.slice(1);
const login = () => {
  if (mode.notLoggedIn) fail('To get started with GitHub CLI, please run:  gh auth login', 4);
  return fx.login;
};

if (rest[0] === 'user') await done(login() + '\n');
if (rest[0] === 'graphql') {
  login();
  await done(String(fx.repos.length) + '\n');
}

// 下面是读数据的请求：可以故意变慢（测「Mini App 停止时在途的 gh 会被终止」）或被限流
if (mode.pidFile) writeFileSync(mode.pidFile, String(process.pid));
if (mode.slowMs) await new Promise((r) => setTimeout(r, mode.slowMs));
if (mode.rateLimited) fail('gh: API rate limit exceeded for user ID 1. (HTTP 403)', 1);
const target = new URL(rest[rest.length - 1], 'https://api.invalid/');
const parts = target.pathname.split('/').filter(Boolean);
const entries = fx.repos.map(({ starred_at, ...repo }) => ({ starred_at, repo }));
const notFound = () => fail('gh: Not Found (HTTP 404)', 1);

if ((parts[0] === 'user' || parts[0] === 'users') && parts[parts.length - 1] === 'starred') {
  if (parts[0] === 'user') login();
  else if (parts[1] === 'nobody-here') notFound();
  const page = Number(target.searchParams.get('page') || '1');
  const per = Number(target.searchParams.get('per_page') || '30');
  await done(JSON.stringify(entries.slice((page - 1) * per, page * per)) + '\n');
}
if (parts[0] === 'repos' && parts.length >= 3) {
  const full = parts[1] + '/' + parts[2];
  const all = [...fx.repos, ...fx.extra];
  const repo = all.find((r) => r.full_name.toLowerCase() === full.toLowerCase());
  if (!repo) notFound();
  if (parts[3] === 'readme') {
    const text = fx.readmes[repo.full_name];
    if (text === undefined) notFound();
    await done(text);
  }
  const { starred_at, ...plain } = repo;
  await done(JSON.stringify(plain) + '\n');
}
fail('fake gh: unsupported api path ' + target.pathname, 2);
