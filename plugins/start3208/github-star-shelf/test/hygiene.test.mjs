// 仓库卫生：开源之后，别人的电脑上不该出现作者的路径、账号、密钥；访问了哪些地址、起了哪些进程，必须和 README 的声明一致。
import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import { REPO_ROOT } from './helpers/sandbox.mjs';

const SKIP = new Set(['.git', 'node_modules']);
async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}
const rel = (p) => relative(REPO_ROOT, p).split(sep).join('/');
const all = (await walk(REPO_ROOT)).map((p) => ({ path: p, rel: rel(p) }));
const isText = (f) => /\.(mjs|js|json|md|html|css|yml|yaml|txt)$/i.test(f.rel) || ['LICENSE', '.gitignore', '.gitattributes'].includes(basename(f.rel));
const texts = [];
for (const f of all) if (isText(f)) texts.push({ ...f, text: await readFile(f.path, 'utf8') });
const under = (prefixes) => texts.filter((f) => prefixes.some((p) => f.rel.startsWith(p)));
const code = under(['miniapp/', 'test/', '.github/']); // 代码、测试、CI：最严
const read = (name) => texts.find((f) => f.rel === name)?.text ?? '';
const plugin = JSON.parse(read('.minimax-plugin/plugin.json'));

// 虚构的名字；linuxbrew 是 Linuxbrew 官方安装位置里的目录名，是个系统约定，不是某个人
const FAKE_NAMES = new Set(['alice', 'bob', 'carol', 'tester', 'someone', 'user', 'username', 'name', 'you', 'me', 'example', '张三', 'shared', 'public', 'linuxbrew']);

test('每个文件的路径都可移植（官方包规则）：只用 ASCII、不带保留名、没有符号链接、个数和大小在限额内', async () => {
  const RESERVED = new Set(['con', 'prn', 'aux', 'nul', ...Array.from({ length: 9 }, (_, i) => 'com' + (i + 1)), ...Array.from({ length: 9 }, (_, i) => 'lpt' + (i + 1))]);
  let total = 0;
  for (const f of all) {
    assert.match(f.rel, /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/, '路径不可移植：' + f.rel);
    assert.ok(Buffer.byteLength(f.rel) <= 512 && f.rel.split('/').length <= 16, '路径太长：' + f.rel);
    for (const seg of f.rel.split('/')) {
      assert.ok(!seg.endsWith('.') && !RESERVED.has(seg.split('.')[0].toLowerCase()), '不可移植的名字：' + f.rel);
    }
    const info = await lstat(f.path);
    assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1, '只能是普通文件：' + f.rel);
    assert.ok(info.size <= 16 * 1024 * 1024, '文件太大：' + f.rel);
    total += info.size;
  }
  assert.ok(all.length <= 1024, '文件太多：' + all.length);
  assert.ok(total <= 64 * 1024 * 1024);
});

test('没有垃圾文件：系统生成的、日志、临时文件、运行时数据、环境变量文件', () => {
  const junk = all.filter((f) => /(^|\/)(\.DS_Store|Thumbs\.db|state\.json|\.env(\..*)?)$|\.(log|tmp)$|\.corrupt-/.test(f.rel));
  assert.deepEqual(junk.map((f) => f.rel), []);
});

test('代码、测试、CI 里没有任何人的主目录路径（除了测试里明显是虚构的名字）', () => {
  const HOME = /(?:\/Users\/|\/home\/|[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2})([^\\/\s'"`)]+)/g;
  const bad = [];
  for (const f of texts) {
    for (const m of f.text.matchAll(HOME)) {
      if (!FAKE_NAMES.has(m[1].toLowerCase())) bad.push(f.rel + ' → ' + m[0]);
    }
  }
  assert.deepEqual(bad, []);
});

test('代码和测试里没有作者的账号名，也没有写死宿主的数据目录名', () => {
  const author = String(plugin.author || '').toLowerCase();
  assert.ok(author.length > 2, 'plugin.json 的 author 不能为空');
  // 宿主的数据目录名；官方规定的清单目录 .minimax-plugin 不算，所以后面不能跟 - 或字母数字
  const hostDir = new RegExp('\\.' + 'minimax(?![-\\w])', 'i');
  const bad = [];
  for (const f of code) {
    if (f.text.toLowerCase().includes(author)) bad.push(f.rel + ' 含作者账号名');
    if (hostDir.test(f.text)) bad.push(f.rel + ' 写死了宿主的数据目录名');
  }
  assert.deepEqual(bad, []);
});

test('没有邮箱地址（noreply 和示例域名除外），没有看起来像令牌 / 私钥的字符串', () => {
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
  const OK_MAIL = /@(users\.noreply\.github\.com|example\.(com|org|net))$/i;
  const SECRET = /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|Bearer\s+[A-Za-z0-9._-]{20,}/;
  const bad = [];
  for (const f of texts) {
    for (const m of f.text.matchAll(EMAIL)) if (!OK_MAIL.test(m[0])) bad.push(f.rel + ' → ' + m[0]);
    if (SECRET.test(f.text)) bad.push(f.rel + ' 里有像令牌或私钥的字符串');
  }
  assert.deepEqual(bad, []);
});

test('固定提示词和代码里不提宿主内部的名字，只用相对路径', () => {
  for (const f of under(['miniapp/'])) {
    assert.ok(!/mavis/i.test(f.text), f.rel + ' 提到了宿主内部的名字');
  }
  for (const f of under(['miniapp/node/prompts/'])) {
    assert.ok(!/[A-Za-z]:\\|\/Users\/|\/home\//.test(f.text), f.rel + ' 里有绝对路径');
  }
});

test('Node 端只访问这几个地址、只在这两个文件里起进程，而且不用 shell；README 里都有声明', () => {
  const node = under(['miniapp/node/']).filter((f) => f.rel.endsWith('.mjs'));
  const hosts = new Set();
  for (const f of node) for (const m of f.text.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) hosts.add(m[1]);
  hosts.delete('miniapp.local'); // 只是拿来解析请求地址的假域名，不会发请求
  assert.deepEqual([...hosts].sort(), ['api.github.com', 'cli.github.com', 'github.com', 'raw.githubusercontent.com']);

  const spawners = node.filter((f) => /node:child_process/.test(f.text)).map((f) => f.rel).sort();
  assert.deepEqual(spawners, ['miniapp/node/lib/env.mjs', 'miniapp/node/lib/github.mjs']);
  for (const f of node) {
    assert.ok(!/shell\s*:\s*true/.test(f.text), f.rel + ' 不能经过 shell 启动命令');
    assert.ok(!/(?<![.\w])(exec|execSync|execFileSync|spawnSync|fork)\s*\(/.test(f.text), f.rel + ' 用了没声明过的起进程方式');
  }

  for (const name of ['README.md', 'README.zh-CN.md']) {
    const readme = read(name);
    for (const needle of ['api.github.com', 'raw.githubusercontent.com', 'github.com', 'cli.github.com', 'xcode-select', 'git clone', 'gh api', 'localStorage', '$SHELL']) {
      assert.ok(readme.includes(needle), name + ' 的「数据与访问」没有提到 ' + needle);
    }
  }
});

test('页面端访问的地址只有 GitHub 自家的图片和链接；README 里有声明', () => {
  const hosts = new Set();
  for (const f of under(['miniapp/client/'])) for (const m of f.text.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) hosts.add(m[1]);
  hosts.delete('www.w3.org'); // SVG 的命名空间，不是请求
  assert.deepEqual([...hosts].sort(), ['github.com', 'raw.githubusercontent.com']);
});

test('清单一致：名字、版本、最低版本、权限；README 写明已测试的 MiniMax Code 版本，不低于最低版本', () => {
  const pkg = JSON.parse(read('package.json'));
  const mini = JSON.parse(read('miniapp/miniapp.json'));
  assert.equal(plugin.name, 'github-star-shelf');
  assert.equal(pkg.name, plugin.name);
  assert.equal(pkg.version, plugin.version);
  assert.deepEqual(pkg.mcode, { schemaVersion: 2, miniApp: './miniapp/miniapp.json' });
  assert.equal(pkg.license, 'MIT');
  assert.deepEqual(mini.agentAccess, ['session.run'], '只要「运行 Agent」，不读用户的其他会话');
  assert.ok(!('toolAccess' in mini) && !('deviceAccess' in mini) && !('hostAccess' in mini) && !('hostConnectorAccess' in mini));
  assert.equal(mini.engines.mcode, '>=3.1.6', 'agent.session 和 whenBusy 都是 3.1.6 起才有');
  assert.match(read('LICENSE'), /^MIT License\n\nCopyright \(c\) 20\d\d \S+/);
  for (const name of ['README.md', 'README.zh-CN.md']) {
    const readme = read(name);
    const section = readme.split(/^## /m).find((s) => /^(Tested environment|已测试环境)/.test(s)) || '';
    const versions = [...section.matchAll(/MiniMax Code\D{0,16}?(\d+)\.(\d+)\.(\d+)/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
    assert.ok(versions.some(([a, b, c]) => a > 3 || (a === 3 && (b > 1 || (b === 1 && c >= 6)))), name + ' 要在「已测试环境」里写明 3.1.6 或更新的 MiniMax Code 版本');
  }
  assert.match(read('README.md'), /^## Tested environment$/m);
  assert.match(read('README.md'), /^## Data & access$/m);
});

test('固定提示词只有这五个，都不是空的', () => {
  const names = under(['miniapp/node/prompts/']).map((f) => basename(f.rel)).sort();
  assert.deepEqual(names, ['common.md', 'explain-cloud.md', 'explain-local.md', 'manage.md', 'notes.md']);
  for (const f of under(['miniapp/node/prompts/'])) assert.ok(f.text.trim().length > 100, f.rel);
});
