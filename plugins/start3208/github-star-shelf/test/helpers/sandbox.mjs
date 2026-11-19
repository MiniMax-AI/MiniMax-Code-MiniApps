// 临时「别人的电脑」：每个路径都带空格和中文，因为这是真实用户机器上最常见的坑。
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const IS_WIN = process.platform === 'win32';
export const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const HELPERS = fileURLToPath(new URL('./', import.meta.url));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const freePort = () =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });

/** 把任意字符串安全放进 sh 脚本（POSIX 单引号转义） */
export const shq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";

export async function makeSandbox(label = 'shelf') {
  const root = await mkdtemp(join(tmpdir(), label + ' 测试 '));
  const dirs = {
    bin: join(root, 'fake bin'), // PATH 里的目录
    tools: join(root, '工具 tools'), // 不在 PATH 里的目录
    // 名字里带引号、美元符、分号、括号：只要有哪里把路径拼进了 shell 命令行，就会出事。Windows 不允许其中一部分字符
    weird: join(root, IS_WIN ? 'weird 中文 & dir' : "it's $HOME \"q\" ; & (x) 目录"),
    home: join(root, '用户 home'),
    data: join(root, '数据 data'),
    agent: join(root, 'AI 工作区'),
    state: join(root, 'fake state'),
  };
  for (const d of Object.values(dirs)) await mkdir(d, { recursive: true });
  // 刚被终止的子进程可能还在往目录里写最后一行：删除时遇到「目录非空」就等一下再删（慢机器上出现过 ENOTEMPTY）
  return { root, ...dirs, cleanup: () => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) };
}

/** 在 dir 里放一个假命令（sh 脚本，转去运行 test/helpers 里的 fake-*.mjs）。只在 macOS / Linux 上用 */
export async function installFake(sb, name, { dir = sb.bin, tag = '' } = {}) {
  if (IS_WIN) throw new Error('fake CLI needs sh');
  const script = join(HELPERS, name === 'git' ? 'fake-git.mjs' : 'fake-gh.mjs');
  const file = join(dir, name);
  await mkdir(dir, { recursive: true });
  await writeFile(file, '#!/bin/sh\nSHELF_FAKE_STATE=' + shq(sb.state) + (tag ? ' SHELF_FAKE_TAG=' + shq(tag) : '') + ' exec ' + shq(process.execPath) + ' ' + shq(script) + ' "$@"\n');
  await chmod(file, 0o755);
  return file;
}

/** 放一个自己定的脚本（坏的 gh、冒牌的 gh、会卡住的命令……） */
export async function installScript(file, body, mode = 0o755) {
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, body);
  await chmod(file, mode);
  return file;
}

/**
 * 放一个「一运行就留下记号文件」的脚本，用来证明某个程序「没有被运行」。
 * 只用 shell 自带的命令（重定向），在只有一个目录的 PATH 下也能留下记号；并且先自己运行一次、确认记号真的留得下来，
 * 再把记号删掉。否则「记号不存在」的断言，在脚本压根没法运行时也会白白通过。
 * output：脚本被运行时打印什么（比如假装是 git）。
 */
export async function installTripwire(file, marker, { output = '', env = {} } = {}) {
  await installScript(file, '#!/bin/sh\necho ran > ' + shq(marker) + '\n' + (output ? 'echo ' + shq(output) + '\n' : ''));
  await new Promise((resolve, reject) => execFile(file, ['--version'], { env }, (error) => (error ? reject(error) : resolve())));
  await stat(marker); // 对照：自己运行时，记号确实出现了
  await rm(marker);
  return file;
}

export const setFixtures = (sb, fx) => writeFile(join(sb.state, 'fixtures.json'), JSON.stringify(fx));
export const setMode = (sb, mode) => writeFile(join(sb.state, 'mode.json'), JSON.stringify(mode));
export async function readLines(file) {
  try {
    return (await readFile(file, 'utf8')).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}
export async function readCalls(sb) {
  return (await readLines(join(sb.state, 'calls.log'))).map((l) => JSON.parse(l));
}

/** 注入给 GitHub 类的「假环境」：PATH 只有一个目录，常见位置清空，免得碰到这台机器上真装的 gh / git */
export const fakeEnv = (sb, over = {}) => ({
  platform: process.platform,
  env: { PATH: sb.bin },
  homedir: sb.home,
  commonDirs: [],
  ...over,
});
