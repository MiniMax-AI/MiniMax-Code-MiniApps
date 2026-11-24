// 环境探测：别人的电脑上，gh / git / 工作文件夹在哪、能不能用。全部离线，用假命令和假环境。
import './helpers/no-network.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { IS_ROOT, IS_WIN, installFake, installScript, installTripwire, makeSandbox, readLines, shq } from './helpers/sandbox.mjs';
import {
  checkWritableDir,
  exeNames,
  extraDirs,
  installHint,
  isAbsoluteFor,
  isInside,
  locateAll,
  loginShellDirs,
  pathEntries,
  probeVersion,
  searchDirs,
  xcodeToolsInstalled,
} from '../miniapp/node/lib/env.mjs';

const posixOnly = { skip: IS_WIN ? '需要 sh' : false };
const GH = /\bgh version\b/i;

test('pathEntries：只收绝对路径，去掉引号，忽略空项和相对路径', () => {
  assert.deepEqual(pathEntries({ platform: 'linux', env: { PATH: '/a:relative/bin::/b:./c: /d ' } }), ['/a', '/b', '/d']);
  assert.deepEqual(pathEntries({ platform: 'win32', env: { PATH: 'C:\\Tools;"C:\\Program Files\\Git\\cmd";bin;D:\\x;' } }), ['C:\\Tools', 'C:\\Program Files\\Git\\cmd', 'D:\\x']);
  assert.deepEqual(pathEntries({ platform: 'win32', env: { Path: 'C:\\a' } }), ['C:\\a']);
  assert.deepEqual(pathEntries({ platform: 'linux', env: {} }), []);
});

test('extraDirs：macOS 的 Homebrew 两种位置、自定义前缀、家目录里的 bin', () => {
  const mac = extraDirs({ platform: 'darwin', env: {}, homedir: '/Users/alice' });
  for (const d of ['/opt/homebrew/bin', '/usr/local/bin', '/Users/alice/.local/bin', '/Users/alice/bin']) assert.ok(mac.includes(d), d);
  assert.equal(extraDirs({ platform: 'darwin', env: { HOMEBREW_PREFIX: '/custom/brew' }, homedir: '/Users/alice' })[0], '/custom/brew/bin');
});

test('extraDirs：Linux 的 Linuxbrew、snap；家目录为空时不会拼出相对路径', () => {
  const lin = extraDirs({ platform: 'linux', env: {}, homedir: '/home/bob' });
  for (const d of ['/home/linuxbrew/.linuxbrew/bin', '/snap/bin', '/home/bob/.local/bin']) assert.ok(lin.includes(d), d);
  assert.ok(extraDirs({ platform: 'linux', env: {}, homedir: '' }).every((d) => d.startsWith('/')));
});

test('extraDirs：Windows 按环境变量找，没有就用默认位置（用户名带中文也行）', () => {
  const custom = extraDirs({
    platform: 'win32',
    env: { ProgramFiles: 'D:\\Programs', 'ProgramFiles(x86)': 'D:\\Programs (x86)', LOCALAPPDATA: 'E:\\Local', SCOOP: 'F:\\scoop', ChocolateyInstall: 'G:\\choco' },
    homedir: 'C:\\Users\\张三',
  });
  for (const d of ['D:\\Programs\\GitHub CLI', 'D:\\Programs\\Git\\cmd', 'D:\\Programs (x86)\\Git\\cmd', 'E:\\Local\\Programs\\GitHub CLI', 'F:\\scoop\\shims', 'G:\\choco\\bin']) assert.ok(custom.includes(d), d);
  const dflt = extraDirs({ platform: 'win32', env: {}, homedir: 'C:\\Users\\张三' });
  for (const d of ['C:\\Program Files\\GitHub CLI', 'C:\\Program Files\\Git\\cmd', 'C:\\Users\\张三\\scoop\\shims', 'C:\\Users\\张三\\AppData\\Local\\Programs\\GitHub CLI']) assert.ok(dflt.includes(d), d);
  assert.ok(!dflt.some((d) => d.startsWith('/')), 'Windows 的目录表里不该有 Unix 路径');
});

test('extraDirs：测试里可以整体指定（commonDirs）', () => {
  assert.deepEqual(extraDirs({ platform: 'linux', env: {}, homedir: '/h', commonDirs: ['/x'] }), ['/x']);
});

test('searchDirs：PATH 优先，其次登录 shell 给的目录，最后常见位置；去重并保持顺序', () => {
  const ctx = { platform: 'linux', env: { PATH: '/a:/b:/a' }, homedir: '', commonDirs: ['/b', '/c'] };
  assert.deepEqual(searchDirs(ctx, ['/s', '/a']), ['/a', '/b', '/s', '/c']);
  assert.deepEqual(searchDirs({ platform: 'win32', env: { PATH: 'C:\\Tools;c:\\tools' }, homedir: '', commonDirs: ['C:\\TOOLS'] }), ['C:\\Tools']);
});

test('exeNames：Windows 只认 .exe / .com（.cmd .bat 不经过 shell 没法直接启动）', () => {
  assert.deepEqual(exeNames('gh', 'linux'), ['gh']);
  assert.deepEqual(exeNames('gh', 'darwin'), ['gh']);
  assert.deepEqual(exeNames('gh', 'win32'), ['gh.exe', 'gh.com']);
});

test('isAbsoluteFor：按那个系统的规则判断，Windows 的盘符路径在别的系统上不算', () => {
  assert.equal(isAbsoluteFor('win32', 'C:\\x\\gh.exe'), true);
  assert.equal(isAbsoluteFor('linux', 'C:\\x\\gh.exe'), false);
  assert.equal(isAbsoluteFor('linux', '/usr/bin/gh'), true);
  assert.equal(isAbsoluteFor('linux', 'bin/gh'), false);
  assert.equal(isAbsoluteFor('linux', ''), false);
  assert.equal(isAbsoluteFor('linux', undefined), false);
});

test('locateAll：按 PATH → 登录 shell 目录 → 常见位置排序；不可执行的文件、同名目录、相对路径都不算', posixOnly, async (t) => {
  const sb = await makeSandbox();
  t.after(sb.cleanup);
  const inPath = await installFake(sb, 'gh');
  const common = await installFake(sb, 'gh', { dir: sb.tools });
  const shellDir = join(sb.root, '终端 里的 bin');
  const viaShell = await installFake(sb, 'gh', { dir: shellDir });
  const noexec = join(sb.root, 'noexec');
  await installScript(join(noexec, 'gh'), '#!/bin/sh\n', 0o644);
  const dirdir = join(sb.root, 'dirdir');
  await mkdir(join(dirdir, 'gh'), { recursive: true });
  const ctx = { platform: process.platform, env: { PATH: [sb.bin, 'relative/dir', noexec, dirdir].join(':') }, homedir: sb.home, commonDirs: [sb.tools] };
  const hits = await locateAll('gh', { ctx, shellDirs: [shellDir] });
  assert.deepEqual(hits.map((h) => [h.path, h.via]), [[inPath, 'path'], [viaShell, 'shell'], [common, 'common']]);
  assert.deepEqual(await locateAll('gh', { ctx: { ...ctx, env: { PATH: '' }, commonDirs: [] } }), []);
});

test('probeVersion：好的 gh 给出版本号；冒牌的、会崩的、不存在的返回空', posixOnly, async (t) => {
  const sb = await makeSandbox();
  t.after(sb.cleanup);
  const good = await installFake(sb, 'gh');
  assert.equal(await probeVersion(good, { expect: GH }), '9.9.9');
  const impostor = await installScript(join(sb.bin, 'gh-impostor'), '#!/bin/sh\necho "hello 1.2.3 world"\n');
  assert.equal(await probeVersion(impostor, { expect: GH }), '', '同名的别的程序不能当成 gh');
  assert.equal(await probeVersion(impostor), '1.2.3', '不检验身份时只看得到一个版本号，所以调用方必须传 expect');
  const crash = await installScript(join(sb.bin, 'gh-crash'), '#!/bin/sh\necho "gh version 1.0.0"\nexit 3\n');
  assert.equal(await probeVersion(crash, { expect: GH }), '');
  assert.equal(await probeVersion(join(sb.bin, 'nope'), { expect: GH }), '');
});

test('probeVersion：命令卡住，超时后放弃', posixOnly, async (t) => {
  const sb = await makeSandbox();
  t.after(sb.cleanup);
  const hang = await installScript(join(sb.bin, 'gh'), '#!/bin/sh\nexec /bin/sleep 30\n');
  const t0 = Date.now();
  assert.equal(await probeVersion(hang, { timeoutMs: 400, expect: GH }), '');
  const took = Date.now() - t0;
  assert.ok(took >= 300, '应该是等到超时才放弃的，不是一开始就失败了：' + took);
  assert.ok(took < 5000, '超时没有生效：' + took);
});

test('probeVersion：命令已经退出，留在后台占着输出管道的子进程不会拖住我们', posixOnly, async (t) => {
  const sb = await makeSandbox();
  t.after(sb.cleanup);
  const bg = await installScript(join(sb.bin, 'gh'), '#!/bin/sh\n/bin/sleep 8 &\necho "gh version 1.2.3"\n');
  const t0 = Date.now();
  assert.equal(await probeVersion(bg, { expect: GH }), '1.2.3');
  assert.ok(Date.now() - t0 < 4000, '被后台子进程拖住了（后台子进程要 8 秒才结束）');
});

test('probeVersion：取消信号马上生效，已经取消的信号直接返回', posixOnly, async (t) => {
  const sb = await makeSandbox();
  t.after(sb.cleanup);
  const hang = await installScript(join(sb.bin, 'gh'), '#!/bin/sh\nexec /bin/sleep 30\n');
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), 100);
  const t0 = Date.now();
  assert.equal(await probeVersion(hang, { signal: ctl.signal, timeoutMs: 20000 }), '');
  const took = Date.now() - t0;
  assert.ok(took >= 80 && took < 3000, '应该是在取消的那一刻返回：' + took);
  const done = new AbortController();
  done.abort();
  assert.equal(await probeVersion(await installFake(sb, 'gh', { dir: sb.tools }), { signal: done.signal }), '');
});

test('xcodeToolsInstalled：xcode-select 说有就是有，说没有或根本不存在都是没有', posixOnly, async (t) => {
  const sb = await makeSandbox();
  t.after(sb.cleanup);
  const yes = await installScript(join(sb.bin, 'xcode-yes'), '#!/bin/sh\necho /Library/Developer/CommandLineTools\n');
  const no = await installScript(join(sb.bin, 'xcode-no'), '#!/bin/sh\nexit 2\n');
  const base = { platform: 'darwin', env: { PATH: '' } };
  assert.equal(await xcodeToolsInstalled({ ...base, xcodeSelect: yes }), true);
  assert.equal(await xcodeToolsInstalled({ ...base, xcodeSelect: no }), false);
  assert.equal(await xcodeToolsInstalled({ ...base, xcodeSelect: join(sb.bin, 'missing') }), false);
});

const fakeShell = (sb, name, body) => installScript(join(sb.tools, name), '#!/bin/sh\n' + body);

test('loginShellDirs：取到终端里的 PATH；rc 文件的输出不影响，带空格的目录保留，相对路径丢掉', posixOnly, async (t) => {
  const sb = await makeSandbox();
  t.after(sb.cleanup);
  const shell = await fakeShell(sb, 'zsh', 'echo "welcome banner printed by an rc file"\nexport PATH="/custom/tools/bin:/other/bin:relative:/opt/x y/bin"\nexec /bin/sh -c "$2"\n');
  const dirs = await loginShellDirs({ platform: 'linux', env: { SHELL: shell, PATH: '/usr/bin' }, homedir: sb.home });
  assert.deepEqual(dirs, ['/custom/tools/bin', '/other/bin', '/opt/x y/bin']);
});

test('loginShellDirs：只用 SHELL 指向的常见 shell；别的情况一律不运行', posixOnly, async (t) => {
  const sb = await makeSandbox();
  t.after(sb.cleanup);
  const marker = join(sb.root, 'ran');
  const evil = await installTripwire(join(sb.tools, 'evilsh'), marker);
  const zsh = await installTripwire(join(sb.tools, 'zsh'), marker);
  assert.deepEqual(await loginShellDirs({ platform: 'linux', env: { SHELL: evil } }), [], '不在名单里的 shell 不运行');
  assert.deepEqual(await loginShellDirs({ platform: 'linux', env: { SHELL: 'zsh' } }), [], '相对路径不运行');
  assert.deepEqual(await loginShellDirs({ platform: 'linux', env: {} }), []);
  assert.deepEqual(await loginShellDirs({ platform: 'win32', env: { SHELL: zsh } }), [], 'Windows 不用登录 shell');
  await assert.rejects(stat(marker), '不该运行过任何东西');
});

test('loginShellDirs：bash / zsh 用 -ilc，sh / dash 用 -lc', posixOnly, async (t) => {
  const sb = await makeSandbox();
  t.after(sb.cleanup);
  const rec = join(sb.root, 'args.log');
  const body = 'printf "%s\\n" "$1" >> ' + shq(rec) + '\nexport PATH=/p/one\nexec /bin/sh -c "$2"\n';
  const bash = await fakeShell(sb, 'bash', body);
  const sh = await fakeShell(sb, 'sh', body);
  assert.deepEqual(await loginShellDirs({ platform: 'linux', env: { SHELL: bash } }), ['/p/one']);
  assert.deepEqual(await loginShellDirs({ platform: 'linux', env: { SHELL: sh } }), ['/p/one']);
  assert.deepEqual(await readLines(rec), ['-ilc', '-lc']);
});

test('loginShellDirs：传给 shell 的命令是固定的，不含环境里的任何值', posixOnly, async (t) => {
  const sb = await makeSandbox();
  t.after(sb.cleanup);
  const rec = join(sb.root, 'script.log');
  const shell = await fakeShell(sb, 'bash', 'printf "%s" "$2" > ' + shq(rec) + '\nexport PATH=/p/one\nexec /bin/sh -c "$2"\n');
  await loginShellDirs({ platform: 'linux', env: { SHELL: shell, SECRET_TOKEN: 'ghp_topsecret123', HOME: sb.home } });
  const script = await readFile(rec, 'utf8');
  assert.ok(!script.includes('topsecret') && !script.includes(sb.home), script);
  assert.match(script, /^printf '%s' '__SHELF_[0-9a-f]{12}__'; printf '%s' "\$PATH"; printf '%s' '__SHELF_[0-9a-f]{12}__'$/);
});

test('loginShellDirs：shell 卡住，超时后当作没有', posixOnly, async (t) => {
  const sb = await makeSandbox();
  t.after(sb.cleanup);
  const hang = await fakeShell(sb, 'zsh', 'exec /bin/sleep 30\n');
  const t0 = Date.now();
  assert.deepEqual(await loginShellDirs({ platform: 'linux', env: { SHELL: hang } }, { timeoutMs: 400 }), []);
  const took = Date.now() - t0;
  assert.ok(took >= 300 && took < 5000, '应该是等到超时才放弃：' + took);
});

test('installHint：按系统给安装办法', () => {
  assert.match(installHint('gh', 'darwin'), /brew install gh/);
  assert.match(installHint('gh', 'win32'), /winget install GitHub\.cli/);
  assert.match(installHint('gh', 'linux'), /cli\.github\.com/);
  assert.match(installHint('git', 'darwin'), /xcode-select --install/);
  assert.match(installHint('git', 'win32'), /winget install Git\.Git/);
  assert.match(installHint('git', 'linux'), /包管理器/);
  assert.equal(installHint('node', 'linux'), '');
});

test('checkWritableDir：能写，会建出不存在的目录，不留下测试文件', async (t) => {
  const sb = await makeSandbox();
  t.after(sb.cleanup);
  const dir = join(sb.root, '新建的 目录', '子 目录');
  const r = await checkWritableDir(dir);
  assert.equal(r.ok, true);
  assert.equal(r.dir, dir);
  assert.deepEqual(await readdir(dir), []);
});

test('checkWritableDir：不是完整路径、是个文件、空值，都说得清楚地拒绝', async (t) => {
  const sb = await makeSandbox();
  t.after(sb.cleanup);
  for (const bad of ['relative/dir', '', undefined, null]) {
    const r = await checkWritableDir(bad);
    assert.equal(r.ok, false, String(bad));
    assert.equal(typeof r.reason, 'string');
  }
  const file = join(sb.root, 'a file');
  await writeFile(file, 'x');
  assert.equal((await checkWritableDir(file)).ok, false);
  assert.equal((await checkWritableDir(join(file, 'sub'))).ok, false);
});

test('checkWritableDir：只读目录说「没有写入权限」', { skip: IS_WIN || IS_ROOT ? '需要普通用户和 POSIX 权限' : false }, async (t) => {
  const sb = await makeSandbox();
  t.after(sb.cleanup);
  const ro = join(sb.root, 'readonly');
  await mkdir(ro);
  await chmod(ro, 0o555);
  try {
    const r = await checkWritableDir(ro);
    assert.equal(r.ok, false);
    assert.match(r.reason, /没有写入权限/);
  } finally {
    await chmod(ro, 0o755); // 先恢复，沙盒才删得掉
  }
});

test('checkWritableDir：剩余空间不够会说清楚，够用就放行', async (t) => {
  const sb = await makeSandbox();
  t.after(sb.cleanup);
  const tooBig = await checkWritableDir(sb.data, { needMB: 1e12 });
  assert.equal(tooBig.ok, false);
  assert.match(tooBig.reason, /不够/);
  assert.equal(typeof tooBig.freeMB, 'number');
  assert.equal((await checkWritableDir(sb.data, { needMB: 1 })).ok, true);
});

test('isInside：清理文件前确认目标严格在目录里面', () => {
  assert.equal(isInside('/a/b', '/a/b/c'), true);
  assert.equal(isInside('/a/b', '/a/b'), false, '目录本身不算里面');
  assert.equal(isInside('/a/b', '/a/bc/x'), false, '名字前缀相同的兄弟目录不算');
  assert.equal(isInside('/a/b', '/a/b/../c'), false, '用 .. 逃出去不算');
  assert.equal(isInside('', '/a'), false);
  assert.equal(isInside('/a/b', ''), false);
});
