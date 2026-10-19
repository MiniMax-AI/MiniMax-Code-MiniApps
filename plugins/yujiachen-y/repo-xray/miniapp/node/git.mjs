// @ts-check
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export class GitError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Child processes owned by this runtime (killed on dispose). */
export const children = new Set();

/** Host names the app accepts, for repository addresses and Settings alike. */
export const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/;

// Inherited variables that would point git at another repository or inject config (git's own
// list, `git rev-parse --local-env-vars`, plus the numbered GIT_CONFIG_KEY_n / GIT_CONFIG_VALUE_n
// pairs), and GIT_TRACE*, which can print requests. Everything else (PATH, HOME, proxies, CA
// settings) is passed through.
const LOCAL_ENV = new Set(['GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT', 'GIT_OBJECT_DIRECTORY', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE', 'GIT_INDEX_FILE', 'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE', 'GIT_PREFIX', 'GIT_SHALLOW_FILE', 'GIT_COMMON_DIR']);
function inheritedEnv() {
  /** @type {Record<string, string>} */
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || LOCAL_ENV.has(k) || /^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(k) || k.startsWith('GIT_TRACE')) continue;
    env[k] = v;
  }
  return env;
}

/**
 * Run git with an argument array (never a shell).
 * @param {string[]} args
 * @param {{ cwd?: string, env?: Record<string,string>, timeout?: number, signal?: AbortSignal, input?: string, onStderr?: (chunk: string) => void, onStdout?: (chunk: Buffer) => void, maxBuffer?: number }} [opts]
 * @returns {Promise<string>} stdout (empty when onStdout streams it)
 */
export function git(args, opts = {}) {
  return new Promise((resolvePromise, reject) => {
    const env = {
      ...inheritedEnv(),
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: '',
      SSH_ASKPASS: '',
      GCM_INTERACTIVE: 'never',
      LC_ALL: 'C',
      ...opts.env,
    };
    const child = spawn('git', args, { cwd: opts.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    children.add(child);
    const out = [];
    let outLen = 0;
    let err = '';
    let killedFor = '';
    const max = opts.maxBuffer ?? 256 * 1024 * 1024;
    const timer = setTimeout(() => {
      killedFor = 'timeout';
      child.kill('SIGKILL');
    }, opts.timeout ?? 120_000);
    const onAbort = () => {
      killedFor = 'aborted';
      child.kill('SIGKILL');
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (c) => {
      if (opts.onStdout) return opts.onStdout(c);
      outLen += c.length;
      if (outLen > max) {
        killedFor = 'overflow';
        child.kill('SIGKILL');
        return;
      }
      out.push(c);
    });
    child.stderr.on('data', (c) => {
      const s = c.toString('utf8');
      if (err.length < 64 * 1024) err += s;
      opts.onStderr?.(s);
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      children.delete(child);
      reject(new GitError(e.code === 'ENOENT' ? 'git_missing' : 'git', e.code === 'ENOENT' ? '本机没有找到 git，请先安装 git' : 'git 启动失败'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      children.delete(child);
      opts.signal?.removeEventListener('abort', onAbort);
      if (killedFor === 'aborted') return reject(new GitError('aborted', '已取消'));
      if (killedFor === 'timeout') return reject(new GitError('timeout', 'git 执行超时'));
      if (killedFor === 'overflow') return reject(new GitError('overflow', 'git 输出过大'));
      if (code !== 0) return reject(new GitError(classify(err), friendly(err)));
      resolvePromise(Buffer.concat(out).toString('utf8'));
    });
    if (opts.input != null) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

function classify(stderr) {
  // Before 'network': the message also says "unable to access".
  if (/returned error: 30[1-8]\b/.test(stderr)) return 'redirect';
  if (/Authentication failed|could not read Username|403|401|HTTP Basic: Access denied|terminal prompts disabled/i.test(stderr)) return 'auth';
  if (/not found|does not exist|Repository not found|404/i.test(stderr)) return 'not_found';
  if (/Could not resolve host|Failed to connect|Connection (reset|refused|timed out)|SSL|TLS|gnutls|unable to access/i.test(stderr)) return 'network';
  if (/not a git repository/i.test(stderr)) return 'not_repo';
  if (/does not have any commits|bad default revision|unknown revision/i.test(stderr)) return 'empty';
  return 'git';
}

function friendly(stderr) {
  const code = classify(stderr);
  if (code === 'redirect') return '服务器要求跳转到另一个地址（仓库可能改名或迁移了）。带着访问令牌时不会跟随跳转，以免令牌发到别处：请在网页上确认仓库的新地址，用新地址重新添加';
  if (code === 'auth') return '没有权限访问这个仓库：请确认已用 gh / glab 登录，或在设置里为这个主机填写访问令牌';
  if (code === 'not_found') return '仓库不存在，或当前账号看不到它';
  if (code === 'network') return '网络连接失败：内网地址可能需要在设置里配置代理';
  if (code === 'not_repo') return '这个目录不是 git 仓库';
  if (code === 'empty') return '仓库还没有任何提交';
  const line = stderr.split('\n').map((s) => s.trim()).filter((s) => /^(fatal|error):/.test(s))[0];
  return line ? line.replace(/https?:\/\/[^\s@]*@/g, 'https://').slice(0, 200) : 'git 执行失败';
}

// ---------------------------------------------------------------------------
// Target parsing
// ---------------------------------------------------------------------------

/**
 * Parse a user-supplied repo reference.
 * @returns {Promise<{ kind: 'remote', host: string, path: string, url: string, webUrl: string, provider: 'github'|'gitlab'|'other', id: string, name: string } | { kind: 'local', dir: string, id: string, name: string }>}
 */
export async function parseTarget(raw) {
  const input = String(raw || '').trim();
  if (!input) throw new GitError('invalid', '请输入仓库地址或本地路径');
  if (input.length > 500) throw new GitError('invalid', '输入过长');

  // Local path
  if (input.startsWith('/') || input.startsWith('~') || /^[A-Za-z]:[\\/]/.test(input)) {
    let dir = input.startsWith('~') ? join(homedir(), input.slice(1)) : input;
    if (!isAbsolute(dir)) dir = resolve(dir);
    try {
      dir = await realpath(dir);
      if (!(await stat(dir)).isDirectory()) throw new Error();
    } catch {
      throw new GitError('invalid', '找不到这个目录');
    }
    let top;
    try {
      top = (await git(['-C', dir, 'rev-parse', '--show-toplevel'], { timeout: 10_000 })).trim();
    } catch {
      try {
        // bare repository
        const isBare = (await git(['-C', dir, 'rev-parse', '--is-bare-repository'], { timeout: 10_000 })).trim();
        if (isBare !== 'true') throw new Error();
        top = dir;
      } catch {
        throw new GitError('not_repo', '这个目录不是 git 仓库');
      }
    }
    const name = top.split(/[\\/]/).filter(Boolean).pop() || top;
    return { kind: 'local', dir: top, id: 'l-' + hash(`local:${top}`), name };
  }

  let host;
  let path;
  let m;
  if ((m = input.match(/^git@([^:/\s]+):(.+)$/))) {
    host = m[1];
    path = m[2];
  } else if ((m = input.match(/^ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/))) {
    host = m[1];
    path = m[2];
  } else if (/^https?:\/\//i.test(input)) {
    let u;
    try {
      u = new URL(input);
    } catch {
      throw new GitError('invalid', '地址格式不对');
    }
    host = u.host;
    path = decodeURIComponent(u.pathname);
  } else if ((m = input.match(/^([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+)$/))) {
    host = 'github.com';
    path = `${m[1]}/${m[2]}`;
  } else if ((m = input.match(/^([a-z0-9-]+(?:\.[a-z0-9-]+)+)\/(.+)$/i))) {
    host = m[1];
    path = m[2];
  } else {
    throw new GitError('invalid', '无法识别：请输入 https 地址、owner/repo，或本地仓库的绝对路径');
  }
  host = host.toLowerCase();
  // One rule for every form: rejects "git@github.com@evil.example:…" and similar.
  if (!HOST_RE.test(host)) throw new GitError('invalid', '主机名不合法');
  path = path.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
  // Strip web UI suffixes.
  path = path.split('/-/')[0];
  const provider = host === 'github.com' || host.startsWith('github.') ? 'github' : host.includes('gitlab') ? 'gitlab' : 'other';
  if (provider === 'github') path = path.split('/').slice(0, 2).join('/');
  else path = path.replace(/\/(tree|blob|commits?|merge_requests|issues)(\/.*)?$/, '');
  if (!/^[A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)+$/.test(path)) throw new GitError('invalid', '仓库路径不合法');
  const key = `${host}/${path}`.toLowerCase();
  return {
    kind: 'remote',
    host,
    path,
    provider,
    url: `https://${host}/${path}.git`,
    webUrl: `https://${host}/${path}`,
    id: 'r-' + hash(key),
    name: path.split('/').pop() || path,
  };
}

function hash(s) {
  return createHash('sha1').update(s).digest('hex').slice(0, 12);
}

// ---------------------------------------------------------------------------
// Network env (credentials + proxy) — injected through GIT_CONFIG_* env so
// nothing is written to repo config or visible in argv.
// ---------------------------------------------------------------------------

/** @param {{ provider: string }} target @param {string} token @param {string} proxy */
export function netEnv(target, token, proxy) {
  const pairs = [];
  if (token) {
    const user = target.provider === 'github' ? 'x-access-token' : 'oauth2';
    pairs.push(['http.extraHeader', `Authorization: Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`]);
    // The header goes with every request this git process makes, and after following a redirect
    // git keeps talking to the new address (a URL-scoped http.<url>.extraHeader is matched against
    // the original URL, so it does not help). With a token attached, never follow redirects.
    pairs.push(['http.followRedirects', 'false']);
  }
  if (proxy) pairs.push(['http.proxy', proxy]);
  pairs.push(['credential.helper', '']);
  const env = { GIT_CONFIG_COUNT: String(pairs.length) };
  pairs.forEach(([k, v], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = k;
    env[`GIT_CONFIG_VALUE_${i}`] = v;
  });
  return env;
}

/** Parse "Receiving objects:  45% (x/y)" style progress. */
export function progressParser(onProgress) {
  let buf = '';
  return (chunk) => {
    buf += chunk;
    const parts = buf.split(/[\r\n]/);
    buf = parts.pop() || '';
    for (const p of parts) {
      const m = p.match(/(Counting objects|Compressing objects|Receiving objects|Resolving deltas):\s+(\d+)%/);
      if (m) onProgress({ phase: m[1], pct: Number(m[2]) });
    }
  };
}

/** Clone (bare, blob-less) or fetch an existing clone. */
export async function syncRemote(target, dir, { env, signal, onProgress }) {
  const exists = await stat(join(dir, 'HEAD')).then(
    () => true,
    () => false,
  );
  const onStderr = progressParser(onProgress);
  if (!exists) {
    await git(['clone', '--bare', '--filter=blob:none', '--no-tags', '--progress', target.url, dir], { env, signal, timeout: 30 * 60_000, onStderr });
    await git(['-C', dir, 'config', 'remote.origin.fetch', '+refs/heads/*:refs/heads/*']);
    return { cloned: true };
  }
  await git(['-C', dir, 'fetch', '--prune', '--no-tags', '--progress', 'origin'], { env, signal, timeout: 15 * 60_000, onStderr });
  // Follow a default-branch rename.
  try {
    const out = await git(['-C', dir, 'ls-remote', '--symref', 'origin', 'HEAD'], { env, signal, timeout: 60_000 });
    const m = out.match(/^ref:\s+(refs\/heads\/\S+)\s+HEAD/m);
    if (m) await git(['-C', dir, 'symbolic-ref', 'HEAD', m[1]]);
  } catch {}
  return { cloned: false };
}

/** Fetch specific blobs into a partial clone in one round trip. */
export async function prefetchBlobs(dir, oids, { env, signal }) {
  if (!oids.length) return;
  const check = await git(['-C', dir, 'cat-file', '--batch-check=%(objectname) %(objecttype)'], { input: oids.join('\n') + '\n', env: { GIT_NO_LAZY_FETCH: '1' }, signal, timeout: 60_000 });
  const missing = check
    .split('\n')
    .filter((l) => / missing$/.test(l))
    .map((l) => l.split(' ')[0]);
  for (let i = 0; i < missing.length; i += 200) {
    await git(['-C', dir, '-c', 'fetch.negotiationAlgorithm=noop', 'fetch', '-q', '--no-tags', '--no-write-fetch-head', '--filter=blob:none', 'origin', ...missing.slice(i, i + 200)], {
      env,
      signal,
      timeout: 5 * 60_000,
    });
  }
}

/**
 * Read blobs with `cat-file --batch`, never lazily fetching.
 * @returns {Promise<Map<string, string>>} oid -> text (only blobs < 512KB)
 */
export async function readBlobs(dir, oids, { signal }) {
  const result = new Map();
  if (!oids.length) return result;
  const MAX = 512 * 1024;
  // Sizes first, so a huge blob is never read into memory.
  const sizes = await git(['-C', dir, 'cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], { input: oids.join('\n') + '\n', env: { GIT_NO_LAZY_FETCH: '1' }, signal, timeout: 60_000 });
  const small = sizes
    .split('\n')
    .map((l) => l.split(' '))
    .filter(([, type, size]) => type === 'blob' && Number(size) < MAX)
    .map(([oid]) => oid);
  if (!small.length) return result;
  const chunks = [];
  await git(['-C', dir, 'cat-file', '--batch'], {
    input: small.join('\n') + '\n',
    env: { GIT_NO_LAZY_FETCH: '1' },
    signal,
    timeout: 120_000,
    onStdout: (c) => chunks.push(c),
  });
  const buf = Buffer.concat(chunks);
  let pos = 0;
  while (pos < buf.length) {
    const nl = buf.indexOf(10, pos);
    if (nl < 0) break;
    const header = buf.subarray(pos, nl).toString('utf8');
    pos = nl + 1;
    const [oid, type, sizeStr] = header.split(' ');
    if (type === 'missing' || !sizeStr) continue;
    const size = Number(sizeStr);
    if (type === 'blob' && size < MAX) result.set(oid, buf.subarray(pos, pos + size).toString('utf8'));
    pos += size + 1;
  }
  return result;
}
