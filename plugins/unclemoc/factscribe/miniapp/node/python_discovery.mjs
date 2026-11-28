// @ts-check
// FactScribe MiniApp —— Python 解释器发现：候选生成、探针分类、错误文案。
//
// 为什么要单列一个文件（而不是继续塞在 server.mjs 里）：
//   ① Windows 上「明明装了 Python，却说没找到」——老候选表里根本没有 Windows 形态：
//      没有 py 启动器、没有 python3.12 这类版本化命令、没有 %LOCALAPPDATA% 下的安装路径。
//      用户装了 3.10+ 但不在 PATH（或只有 py 启动器），一律判成「没找到」。
//   ② 探测失败一刀切：命令不存在（spawn ENOENT）与版本过低（读到的版本 < 3.10）
//      走同一条路，于是装了 3.9 的用户收到「装好 Python ≥3.10 再来」这种没法定位的话。
//   ③ py 启动器要带前缀参数（py -3），所以候选不能再是裸字符串：
//      统一成形如 {command, args}，**探测与拉起引擎两处从同一份候选派生**，不会只改一处。
//
// 边界：引擎要求 Python ≥3.10（3.10 走引擎仓内兜底 TOML 解析器，3.11+ 用标准库 tomllib）。
// 这里只负责「找到它、说清楚为什么不行」，不放宽版本要求，也不改引擎本体。
//
// 纯度约定：pythonCandidates() 与 pythonFailureMessage() 不碰文件系统与进程，
// 便于单元测试在任意平台上钉死 macOS 与 Windows 两套行为。

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

/** 引擎要求的最低 Python 版本。 */
export const MIN_PYTHON = [3, 10];

/** Windows 上值得一试的 3.x 版本（新的排前面：先挑最新的解释器）。 */
export const WINDOWS_PYTHON_VERSIONS = ['3.14', '3.13', '3.12', '3.11', '3.10'];

/** 探针超时（毫秒）：超了就算这个候选不可用。 */
export const PROBE_TIMEOUT_MS = 15000;

/**
 * 探针脚本：吐版本号 + 解释器真实路径。
 * 带 FSVER/FSEXE 标记是为了 stdout 混进别的东西（launcher 的广告语、Store 别名的提示）时
 * 仍能稳地切出来；切不到就当「读不出版本」，不猜。
 * FSEXE（sys.executable）很关键：候选叫 "py" 时，只有它能说清「这个 3.9 到底装在哪」。
 */
const VERSION_SCRIPT = 'import sys; sys.stdout.write("FSVER:%d.%d\\nFSEXE:%s" % (sys.version_info[0], sys.version_info[1], sys.executable))';

/** 探针输出缓冲上限（防止解释器喷太多把内存吃满）。 */
const PROBE_OUTPUT_CAP = 4000;

/**
 * 候选类型：
 *   env  —— 用户显式指定的 FS_PYTHON；
 *   name —— 交给系统去 PATH 里找的命令名；
 *   path —— 拼出来的绝对路径（探测前先看它在不在）。
 * @typedef {{command: string, args: string[], kind: 'env'|'name'|'path'}} PythonCandidate
 */

/**
 * 发现结果：命令、前缀参数、探到的版本、读不出版本的命令、FS_PYTHON 是否失效。
 * 错误文案全靠它区分「没装」「装了但版本低」「装了但不在 PATH」。
 * @typedef {{
 *   ok: boolean,
 *   command: string,
 *   args: string[],
 *   version: string|null,
 *   executable: string|null,
 *   candidate: PythonCandidate|null,
 *   found: Array<{command: string, args: string[], version: string, executable: string|null, kind: string}>,
 *   broken: Array<{command: string, args: string[], detail: string, stderr: string, kind: string}>,
 *   missingEnv: string|null,
 *   probedPaths: string[],
 * }} PythonDiscovery
 */

/**
 * 从 env 里取一个键（Windows 上环境变量名大小写不敏感，这里做大小写无关查找）。
 * @param {Record<string, string|undefined>} env
 * @param {string} key
 * @returns {string}
 */
function pickEnv(env, key) {
  if (!env) return '';
  const direct = env[key];
  if (typeof direct === 'string' && direct) return direct;
  const lower = key.toLowerCase();
  for (const name of Object.keys(env)) {
    if (name.toLowerCase() === lower) {
      const value = env[name];
      if (typeof value === 'string' && value) return value;
    }
  }
  return '';
}

/** 去掉路径尾部的斜杠（拼绝对路径时避免出现双反斜杠）。 */
function trimSeparators(value) {
  return String(value || '').replace(/[\\/]+$/, '');
}

/**
 * Windows 常见安装目录里的 python.exe 绝对路径。
 * 覆盖三种装法：每用户装（%LOCALAPPDATA%\Programs\Python\Python312）、
 * 全局装（%PROGRAMFILES%\Python312）、以及装在盘根的（C:\Python312）。
 * @param {Record<string, string|undefined>} env
 * @returns {string[]}
 */
export function windowsInstallPaths(env = {}) {
  const local = trimSeparators(pickEnv(env, 'LOCALAPPDATA'));
  const programFiles = trimSeparators(pickEnv(env, 'PROGRAMFILES'));
  const systemDrive = trimSeparators(pickEnv(env, 'SystemDrive')) || 'C:';
  const out = [];
  for (const version of WINDOWS_PYTHON_VERSIONS) {
    const tag = version.replace('.', ''); // 3.12 → 312
    if (local) out.push(local + '\\Programs\\Python\\Python' + tag + '\\python.exe');
    if (programFiles) out.push(programFiles + '\\Python' + tag + '\\python.exe');
    out.push(systemDrive + '\\Python' + tag + '\\python.exe');
  }
  return out;
}

/**
 * 候选表（纯函数：不碰文件系统、不起进程）。
 *
 * macOS/Linux 的顺序与老实现完全一致（python3 → python → /usr/bin/python3 →
 * /opt/homebrew/bin/python3 → /usr/local/bin/python3），不因为这次改动而变。
 * Windows 补上：FS_PYTHON → py（-3 与各版本号）→ py.exe → python3/python/python.exe →
 * 版本化命令 python3.14…python3.10 → 常见安装目录里的绝对路径。
 *
 * @param {string} platform process.platform
 * @param {Record<string, string|undefined>} env
 * @returns {PythonCandidate[]}
 */
export function pythonCandidates(platform, env = {}) {
  /** @type {PythonCandidate[]} */
  const list = [];
  const add = (command, args, kind) => {
    if (typeof command !== 'string') return;
    const cmd = command.trim();
    if (!cmd) return;
    list.push({ command: cmd, args: Array.isArray(args) ? args.slice() : [], kind: kind || 'name' });
  };
  // FS_PYTHON 用 pickEnv 取：Windows 上环境变量名大小写不敏感。
  const fsPython = pickEnv(env, 'FS_PYTHON');
  if (fsPython.trim()) add(fsPython, [], 'env');
  if (platform === 'win32') {
    add('py');
    add('py', ['-3']);
    for (const version of WINDOWS_PYTHON_VERSIONS) add('py', ['-' + version]);
    add('py.exe');
    add('python3');
    add('python');
    add('python.exe');
    for (const version of WINDOWS_PYTHON_VERSIONS) add('python' + version);
    for (const version of WINDOWS_PYTHON_VERSIONS) add('python' + version + '.exe');
    for (const full of windowsInstallPaths(env)) add(full, [], 'path');
  } else {
    add('python3');
    add('python');
    add('/usr/bin/python3');
    add('/opt/homebrew/bin/python3');
    add('/usr/local/bin/python3');
  }
  return list;
}

/**
 * 从探针输出里切版本号（认 FSVER 标记；切不到就返回 null，不猜）。
 * @param {string} text
 * @returns {{major: number, minor: number, text: string}|null}
 */
export function parsePythonVersion(text) {
  const matched = /FSVER:(\d+)\.(\d+)/.exec(String(text || ''));
  if (!matched) return null;
  const major = Number(matched[1]);
  const minor = Number(matched[2]);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return null;
  return { major, minor, text: major + '.' + minor };
}

/**
 * 从探针输出里切解释器真实路径（sys.executable）；切不到返回 null。
 * @param {string} text
 * @returns {string|null}
 */
export function parsePythonExecutable(text) {
  const matched = /FSEXE:([^\r\n]*)/.exec(String(text || ''));
  if (!matched) return null;
  const value = matched[1].trim();
  return value ? value : null;
}

/**
 * 版本比较：a 比 b 新返回正数。
 * @param {{major: number, minor: number}} a
 * @param {number[]} b
 * @returns {number}
 */
export function compareVersion(a, b) {
  const major = Number(a.major) - Number(b[0]);
  if (major !== 0) return major;
  return Number(a.minor) - Number(b[1]);
}

/**
 * 探一个候选：把「命令不存在」「命令在但读不出版本」「版本够」「版本低」四件事分开。
 *
 * @param {PythonCandidate} candidate
 * @param {{timeoutMs?: number, spawnFn?: Function, minVersion?: number[]}} [options]
 * @returns {Promise<{status: 'ready'|'old'|'missing'|'broken', version?: string, executable?: string|null, detail?: string, stderr?: string}>}
 */
export function probePythonCandidate(candidate, options = {}) {
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : PROBE_TIMEOUT_MS;
  const spawnFn = options.spawnFn || spawn;
  const minVersion = options.minVersion || MIN_PYTHON;
  const args = (candidate.args || []).concat(['-c', VERSION_SCRIPT]);
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let settled = false;
    /** @param {{status: string, version?: string, detail?: string}} result */
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, stderr: err.slice(-PROBE_OUTPUT_CAP) });
    };
    /** @type {import('node:child_process').ChildProcess} */
    let child_;
    try {
      // stdout/stdin 绝不继承（归宿主）；探测输出走管道，绝不进宿主 stdout/stderr。
      child_ = spawnFn(candidate.command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      done({ status: 'broken', detail: String((error && error.code) || error) });
      return;
    }
    const timer = setTimeout(() => {
      try { child_.kill('SIGKILL'); } catch { /* 已退出 */ }
      done({ status: 'broken', detail: 'probe_timeout' });
    }, timeoutMs);
    if (child_.stdout) {
      child_.stdout.setEncoding('utf8');
      child_.stdout.on('data', (chunk) => {
        if (out.length < PROBE_OUTPUT_CAP) out += String(chunk);
      });
    }
    if (child_.stderr) {
      child_.stderr.setEncoding('utf8');
      child_.stderr.on('data', (chunk) => {
        if (err.length < PROBE_OUTPUT_CAP) err += String(chunk);
      });
    }
    child_.on('error', (error) => {
      const code = String((error && error.code) || '');
      // ENOENT＝这台机器上根本没有这个命令；其余错误＝命令在，但跑不起来。
      done({ status: code === 'ENOENT' ? 'missing' : 'broken', detail: code || String((error && error.message) || error) });
    });
    // 判定必须等 stdout/stderr 读完再下结论——所以听 'close'，不听 'exit'。
    //
    // 'exit' 只保证「进程退出了」，不保证管道里的字节已经交给父进程：机器一忙
    // （CI runner 上五个矩阵并行、apt 还在装 poppler），'exit' 就可能先于 stdout
    // 的 'data' 到达——那时 out 还是空的，一个明明吐了版本号的解释器会被判成
    // broken/no_version，用户看到的是「这个命令不是可用的 Python 解释器」。
    // 'close' 才是「进程退出、且 stdout/stderr 两个管道都读完」。
    //
    // 语义没变：状态还是 ready/old/missing/broken 四选一，文案一个字没改，
    // 只是把「读数据」的时机从「进程退出」挪到「管道读完」。
    child_.on('close', (code) => {
      const version = parsePythonVersion(out);
      if (!version) {
        done({ status: 'broken', detail: code === 0 ? 'no_version' : 'exit_' + code });
        return;
      }
      done({
        status: compareVersion(version, minVersion) >= 0 ? 'ready' : 'old',
        version: version.text,
        executable: parsePythonExecutable(out),
      });
    });
  });
}

/**
 * 逐个候选探过去，返回发现结果（纯逻辑：探针与存在性检查都可注入，便于单测）。
 *
 * @param {{platform?: string, env?: Record<string, string|undefined>, probe?: Function, exists?: Function, probeOptions?: object}} [options]
 * @returns {Promise<{
 *   ok: boolean, command: string, args: string[], version: string|null,
 *   found: Array<{command: string, args: string[], version: string, kind: string}>,
 *   broken: Array<{command: string, args: string[], detail: string, stderr: string, kind: string}>,
 *   missingEnv: string|null, probedPaths: string[],
 * }>}
 */
export async function discoverPython(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const probe = options.probe || probePythonCandidate;
  const exists = options.exists || existsSync;
  const probeOptions = options.probeOptions || {};
  const candidates = pythonCandidates(platform, env);
  const state = {
    ok: false,
    command: '',
    args: [],
    version: null,
    executable: null,
    candidate: null,
    found: [],
    broken: [],
    missingEnv: null,
    probedPaths: [],
  };
  for (const candidate of candidates) {
    // 绝对路径候选：文件不在就跳过（省一次 spawn，也免得把 ENOENT 混进「装过」的证据里）。
    if (candidate.kind === 'path' && !exists(candidate.command)) {
      state.probedPaths.push(candidate.command);
      continue;
    }
    const result = await probe(candidate, probeOptions);
    if (result.status === 'ready') {
      state.ok = true;
      state.command = candidate.command;
      state.args = candidate.args.slice();
      state.version = result.version || null;
      state.executable = result.executable || null;
      state.candidate = candidate;
      return state;
    }
    if (result.status === 'old') {
      state.found.push({ command: candidate.command, args: candidate.args.slice(), version: result.version || '', executable: result.executable || null, kind: candidate.kind });
      continue;
    }
    if (result.status === 'broken') {
      state.broken.push({ command: candidate.command, args: candidate.args.slice(), detail: result.detail || '', stderr: result.stderr || '', kind: candidate.kind });
      // FS_PYTHON 指错了也可能是「跑不起来」而不只是「文件不存在」——两种都要点名。
      if (candidate.kind === 'env') state.missingEnv = candidate.command;
      continue;
    }
    // missing
    if (candidate.kind === 'env') state.missingEnv = candidate.command;
    else if (candidate.kind === 'path') state.probedPaths.push(candidate.command);
  }
  return state;
}

/**
 * 候选的可读写法（给人看的：「py -3」/「C:\Python39\python.exe」）。
 * @param {{command: string, args?: string[]}} candidate
 * @returns {string}
 */
export function describeCandidate(candidate) {
  const command = String((candidate && candidate.command) || '');
  const args = candidate && candidate.args && candidate.args.length ? ' ' + candidate.args.join(' ') : '';
  return command + args;
}

/**
 * 「这个版本来自哪个可执行文件」：候选名 + 解释器真实路径（sys.executable）。
 * 候选叫 py / python（从 PATH 里捡到的）时，只有真实路径能告诉用户东西装在哪。
 * @param {{command: string, args?: string[], executable?: string|null}} entry
 * @returns {string}
 */
function describeSource(entry) {
  const base = describeCandidate(entry);
  const executable = entry && entry.executable ? String(entry.executable) : '';
  return executable ? base + '，实际解释器在 ' + executable : base;
}

/**
 * 安装说明：当前平台的排前面，另一个平台的也留着——换台机器照样用得上。
 * @param {string} platform
 * @param {string} min 最低版本，形如 '3.10'
 * @returns {string[]}
 */
function installHints(platform, min) {
  const windows = '· 装一个 ≥' + min + ' 的解释器（Windows）：到 https://www.python.org/downloads/windows/ 下载双击安装包，安装时勾上「Add python.exe to PATH」（新旧版本可以并存）；装完在命令行跑 py -3 --version 确认——只装了 py 启动器也行，本机会自动找到它。';
  const unix = '· 装一个 ≥' + min + ' 的解释器（macOS / Debian / Ubuntu）：macOS 用 brew install python@3.12；Debian/Ubuntu 用 sudo apt install python3.12 python3.12-venv';
  return platform === 'win32' ? [windows, unix] : [unix, windows];
}

/**
 * 错误文案：把「没装」「装了但版本低」「装了但不在 PATH / 命令是假的」三种情况分开说。
 * 纯函数：同一份发现状态，引擎启动失败与设置页诊断共用它，两处口径不会漂。
 *
 * @param {object} state discoverPython() 的返回值
 * @param {{platform?: string, minVersion?: number[]}} [options]
 * @returns {string}
 */
export function pythonFailureMessage(state, options = {}) {
  const minVersion = options.minVersion || MIN_PYTHON;
  const platform = options.platform || process.platform;
  const min = minVersion.join('.');
  const found = (state && state.found ? state.found : []).slice();
  const broken = (state && state.broken ? state.broken : []).slice();
  const probedPaths = (state && state.probedPaths ? state.probedPaths : []).slice();
  const lines = [];

  if (state && state.missingEnv) {
    lines.push('环境变量 FS_PYTHON 指向的「' + state.missingEnv + '」跑不起来（文件不存在，或它不是 Python 解释器），请先检查这个路径。');
  }

  // 探到的最高版本（走这条分支说明它们全都低于下限）。
  found.sort((a, b) => {
    const av = parsePythonVersion('FSVER:' + a.version) || { major: 0, minor: 0 };
    const bv = parsePythonVersion('FSVER:' + b.version) || { major: 0, minor: 0 };
    return bv.major - av.major || bv.minor - av.minor;
  });
  const top = found[0];

  if (top) {
    lines.push('找到了 Python，但版本不够：最高只探到 ' + top.version + '（来自 ' + describeSource(top) + '）。');
    lines.push('FactScribe 的引擎需要 Python ≥' + min + '（3.10 走引擎随包的兜底 TOML 解析器，3.11+ 用标准库 tomllib）——Python ' + top.version + ' 及以下跑不了这份引擎。');
    for (const hint of installHints(platform, min)) lines.push(hint);
    lines.push('· 或者指定现成的解释器：设环境变量 FS_PYTHON 指向一个 ≥' + min + ' 的解释器绝对路径，例如 FS_PYTHON=C:\\Users\\你\\AppData\\Local\\Programs\\Python\\Python312\\python.exe');
  } else if (broken.length) {
    const first = broken.find((b) => b.kind !== 'env') || broken[0];
    lines.push('找到了「' + describeCandidate(first) + '」这个命令，但它不是一个可用的 Python 解释器（读不出版本号）。');
    lines.push('· Windows 上这命令常见的两种来路：Microsoft Store 的「python」占位别名会抢在前面（它把你引去商店，像是装了却不能用）；或者只有 `py` 启动器、实际没装 Python。真装了 Python 的话，到「设置 → 应用 → 应用执行别名」把 python / python3 关掉。');
    lines.push('· 或者指定现成的解释器：设环境变量 FS_PYTHON 指向一个 ≥' + min + ' 的解释器绝对路径，例如 FS_PYTHON=C:\\Users\\你\\AppData\\Local\\Programs\\Python\\Python312\\python.exe');
    for (const hint of installHints(platform, min)) lines.push(hint);
    const tail = String(first.stderr || '').trim().split('\n').filter(Boolean).slice(-3).join(' / ');
    if (tail) lines.push('（它的原话：' + tail.slice(0, 300) + '）');
  } else {
    lines.push('没找到可用的 Python 3：FactScribe 的引擎是 Python 写的，需要 Python ≥' + min + '。');
    for (const hint of installHints(platform, min)) lines.push(hint);
    lines.push('· 已经装了 Python、只是它没进 PATH（或装在别处）：设环境变量 FS_PYTHON 指向解释器的绝对路径，例如 FS_PYTHON=C:\\Users\\你\\AppData\\Local\\Programs\\Python\\Python312\\python.exe');
    if (probedPaths.length) {
      const shown = probedPaths.slice(0, 4).join('、');
      const more = probedPaths.length > 4 ? '（共 ' + probedPaths.length + ' 处）' : '';
      lines.push('· 我们探过这些常见安装位置，都没有可用的解释器：' + shown + more);
    }
  }
  return lines.join('\n');
}

/**
 * 非致命的提醒：Python 找到了，但不是在 PATH 里找到的（靠绝对路径或 FS_PYTHON）。
 * 这时候引擎能用，但换台机器/换个 PATH 就可能找不到——值得说一声。
 * @param {object} state discoverPython() 的返回值
 * @returns {string}
 */
export function pythonAdvice(state) {
  if (!state || !state.ok) return '';
  const candidate = state.candidate;
  if (!candidate || candidate.kind === 'name') return '';
  const version = state.version ? ' ' + state.version : '';
  const where = describeCandidate(candidate);
  if (candidate.kind === 'env') {
    // 用户自己指的：告诉他现在用的是哪一个，别让他以为是自己装的默认 python。
    return 'Python' + version + ' 来自环境变量 FS_PYTHON 指定的解释器（' + where + '）。换台机器或换个人用时，记得把这个变量也带上。';
  }
  return 'Python' + version + ' 是在 PATH 之外找到的（用的是 ' + where + '）。想让它每次都被稳定找到，设环境变量 FS_PYTHON 指向它。';
}
