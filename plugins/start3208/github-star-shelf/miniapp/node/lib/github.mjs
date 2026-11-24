import { execFile } from 'node:child_process';
import { access, constants, lstat, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { AppError, clip, redact } from './util.mjs';
import { MAC_GIT_SHIM, installHint, isAbsoluteFor, locateAll, loginShellDirs, probeVersion, realEnv, xcodeToolsInstalled } from './env.mjs';

const UA = 'github-star-shelf/1.0';
const JSON_ACCEPT = 'application/vnd.github+json';
const STAR_ACCEPT = 'application/vnd.github.star+json';
const RAW_ACCEPT = 'application/vnd.github.raw+json';
export const MAX_README_CHARS = 400000;

export function limitMessage(waitMs) {
  const min = waitMs > 0 ? Math.max(1, Math.ceil(waitMs / 60000)) : 0;
  return 'GitHub 暂时限制了这个网络的匿名访问' + (min ? '，约 ' + min + ' 分钟后恢复' : '') + '。安装并登录 gh（gh auth login）就不受这个限制';
}

export function run(file, args, { signal, timeoutMs = 60000, maxBuffer = 16 * 1024 * 1024, env, cwd } = {}) {
  return new Promise((resolve, reject) => {
    // 已经取消了（比如 Mini App 正在停止）：连进程都不要起，免得起了又马上杀
    if (signal?.aborted) {
      reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError', code: 'ABORT_ERR' }));
      return;
    }
    const options = {
      timeout: timeoutMs,
      maxBuffer,
      cwd,
      windowsHide: true,
      encoding: 'utf8',
      env: {
        ...process.env,
        GH_PROMPT_DISABLED: '1',
        GH_NO_UPDATE_NOTIFIER: '1',
        GH_SPINNER_DISABLED: '1',
        NO_COLOR: '1',
        GIT_TERMINAL_PROMPT: '0',
        GH_HOST: 'github.com', // 只管 github.com；别被环境里指向企业版的 GH_HOST 带偏
        ...env,
      },
    };
    if (signal) options.signal = signal; // execFile 不接受 null，只能不传
    const child = execFile(
      file,
      args,
      options,
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
        } else resolve({ stdout, stderr });
      },
    );
    child.stdin?.end();
  });
}

// 页面上只显示固定的说明；原始报错（已去掉令牌）放在 extra.detail 里，只写进日志，
// 免得把路径、账号之类的信息带到界面上。
/**
 * 判断原因只看命令自己输出的报错（stderr）。execFile 的 error.message 里带着完整的命令行（含 gh / git 所在的路径）：
 * 拿它去匹配，用户的目录名碰巧含有 proxy、EOF 之类的词就会判错；写进日志，又会把本机路径带进去。
 * stderr 是空的才退而看错误码和去掉命令行之后的消息。
 */
function failureText(error) {
  const stderr = redact(String(error?.stderr || '')).trim();
  if (stderr) return { match: stderr, detail: clip(stderr, 300) };
  const message = redact(String(error?.message || ''))
    .split('\n')
    .filter((line) => line.trim() && !/^Command failed:/.test(line) && !/^spawn .* (ENOENT|EACCES)/.test(line))
    .join(' ')
    .trim();
  return { match: message, detail: clip([error?.code, message].filter(Boolean).join(' '), 300) };
}

function classify(error) {
  if (error instanceof AppError) return error;
  const { match: msg, detail } = failureText(error);
  const make = (code, message, status) => new AppError(code, message, status, { detail });
  if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') return make('cancelled', '已取消', 499);
  if (error?.code === 'ENOENT' || error?.code === 'EACCES') return make('gh_missing', '没有找到可运行的 gh 命令行工具', 500);
  if (error?.killed && error?.signal) return make('timeout', '读取 GitHub 超时', 504);
  if (/HTTP 404|Not Found/i.test(msg)) return make('not_found', '找不到这个仓库或用户', 404);
  if (/rate limit|HTTP 403|HTTP 429/i.test(msg)) return make('rate_limited', 'GitHub 接口被限流，请稍后再试', 429);
  if (/HTTP 401|gh auth login|not logged|Bad credentials/i.test(msg)) return make('unauthenticated', 'gh 还没有登录 GitHub', 401);
  if (/dial tcp|i\/o timeout|no such host|connection|EOF|TLS|proxy/i.test(msg)) return make('network', '连不上 GitHub，请检查网络或代理', 502);
  return make('github_error', '读取 GitHub 失败，原因没能识别（详情在 Mini App 日志里）', 502);
}

function classifyGit(error) {
  if (error instanceof AppError) return error;
  const { match: msg, detail } = failureText(error);
  const make = (code, message, status) => new AppError(code, message, status, { detail });
  if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') return make('cancelled', '已取消', 499);
  if (error?.code === 'ENOENT' || error?.code === 'EACCES') return make('git_missing', '没有找到可运行的 git', 500);
  if (error?.killed && error?.signal) return make('timeout', '拉取代码超时', 504);
  if (/not found|does not exist/i.test(msg)) return make('not_found', '找不到这个仓库', 404);
  if (/terminal prompts disabled|Authentication failed|could not read Username/i.test(msg)) return make('private', '这个仓库需要登录才能拉取', 403);
  if (/Could not resolve host|unable to access|Failed to connect|timed out|TLS|proxy/i.test(msg)) return make('network', '连不上 GitHub，请检查网络或代理', 502);
  if (/filename too long|path too long/i.test(msg)) return make('path_too_long', '路径太长，Windows 放不下。把 AI 工作文件夹所在的位置换短一点，或开启系统的长路径支持', 500);
  return make('clone_failed', '拉取代码失败，原因没能识别（详情在 Mini App 日志里）', 502);
}

export function normalizeRepo(r, starredAt) {
  const license = r.license && r.license.spdx_id && r.license.spdx_id !== 'NOASSERTION' ? r.license.spdx_id : r.license?.name || '';
  return {
    fullName: String(r.full_name),
    url: String(r.html_url || 'https://github.com/' + r.full_name),
    description: String(r.description || '').slice(0, 400),
    language: String(r.language || ''),
    stars: Number(r.stargazers_count) || 0,
    forks: Number(r.forks_count) || 0,
    topics: Array.isArray(r.topics) ? r.topics.slice(0, 20).map(String) : [],
    license: String(license).slice(0, 40),
    homepage: String(r.homepage || '').slice(0, 300),
    pushedAt: String(r.pushed_at || ''),
    createdAt: String(r.created_at || ''),
    archived: Boolean(r.archived),
    fork: Boolean(r.fork),
    defaultBranch: String(r.default_branch || ''),
    sizeKB: Number(r.size) || 0,
    starredAt: starredAt ? String(starredAt) : null,
  };
}

const EXPECT = { gh: /\bgh version\b/i, git: /\bgit version\b/i };

export class GitHub {
  /**
   * opts.signal  context.signal：Mini App 停止时，在途的子进程和请求一起终止
   * opts.envCtx  测试里注入假环境 { platform, env, homedir, commonDirs, macGitShim, xcodeSelect }；正常运行不用传
   */
  constructor(logger, { signal, envCtx } = {}) {
    this.logger = logger;
    this.rootSignal = signal || null;
    this.envCtx = envCtx || null;
    this.overrides = { gh: '', git: '' }; // 用户在设置里手动指定的路径
    this.found = null;
    this.info = null;
    this.infoAt = 0;
    this.detecting = null;
    this.shellDirsP = undefined;
  }

  #ctx() {
    return this.envCtx || realEnv();
  }

  get platform() {
    return this.#ctx().platform;
  }

  /** 调用方的取消信号 + Mini App 停止信号 + 超时，合成一个 */
  #sig(signal, timeoutMs) {
    const list = [signal, this.rootSignal, timeoutMs ? AbortSignal.timeout(timeoutMs) : null].filter(Boolean);
    if (list.length === 0) return undefined;
    if (list.length === 1 || !AbortSignal.any) return list[0];
    return AbortSignal.any(list);
  }

  #fail(error) {
    const c = classify(error);
    if (c.code === 'gh_missing') this.resetDetect(); // 用着用着 gh 没了：下次重新找
    // 项目不存在（没有 README 也是 404）、用户取消，都是正常情况，不记
    if (c.extra?.detail && c.code !== 'not_found' && c.code !== 'cancelled') this.logger?.warn('shelf.github.failed', { code: c.code, detail: c.extra.detail });
    return c;
  }

  setOverrides({ gh = '', git = '' } = {}) {
    this.overrides = { gh: String(gh || ''), git: String(git || '') };
    this.resetDetect();
  }

  /** 登录 shell 的 PATH 只问一次（gh 和 git 同时找时也只问一次）；点「重新检测」才会重新问 */
  #shellDirs() {
    if (!this.shellDirsP) this.shellDirsP = loginShellDirs(this.#ctx(), { signal: this.rootSignal }).catch(() => []);
    return this.shellDirsP;
  }

  /**
   * 找一个真能运行的命令，按顺序：
   *   1) 设置里手动指定的路径
   *   2) PATH 和各系统的常见安装位置
   *   3) 都找不到，才去问一次你登录 shell 的 PATH
   * 每个候选都用 --version 实测：坏的、同名的别的程序、macOS 的占位 git 都会跳过。
   */
  async #resolveTool(name) {
    const ctx = this.#ctx();
    const expect = EXPECT[name];
    const tried = new Set();
    const probe = async (cand) => {
      if (tried.has(cand.path)) return null;
      tried.add(cand.path);
      if (ctx.platform === 'darwin' && name === 'git' && cand.path === (ctx.macGitShim || MAC_GIT_SHIM) && !(await xcodeToolsInstalled(ctx, { signal: this.rootSignal }))) {
        return null; // 没装命令行开发工具：这只是个占位程序，运行它会弹安装窗口
      }
      const version = await probeVersion(cand.path, { signal: this.rootSignal, env: ctx.env, expect });
      return version ? { path: cand.path, via: cand.via, version } : null;
    };
    const wanted = this.overrides[name];
    let overrideBad = false;
    if (wanted) {
      const hit = await probe({ path: wanted, via: 'setting' });
      if (hit) return { ...hit, overrideBad };
      overrideBad = true;
    }
    for (const cand of await locateAll(name, { ctx })) {
      const hit = await probe(cand);
      if (hit) return { ...hit, overrideBad };
    }
    const shellDirs = await this.#shellDirs();
    if (shellDirs.length) {
      for (const cand of await locateAll(name, { ctx, shellDirs })) {
        const hit = await probe(cand);
        if (hit) return { ...hit, overrideBad };
      }
    }
    return { path: '', via: '', version: '', overrideBad };
  }

  async #detect() {
    const ctx = this.#ctx();
    const [ghT, gitT] = await Promise.all([this.#resolveTool('gh'), this.#resolveTool('git')]);
    this.found = { gh: ghT.path ? ghT : null, git: gitT.path ? gitT : null };
    const info = {
      transport: 'rest',
      gh: Boolean(ghT.path),
      git: Boolean(gitT.path),
      ghPath: ghT.path,
      gitPath: gitT.path,
      ghVia: ghT.via,
      gitVia: gitT.via,
      ghVersion: ghT.version,
      gitVersion: gitT.version,
      ghOverrideBad: ghT.overrideBad,
      gitOverrideBad: gitT.overrideBad,
      ghHint: ghT.path ? '' : installHint('gh', ctx.platform),
      gitHint: gitT.path ? '' : installHint('git', ctx.platform),
      authed: false,
      user: '',
      note: '',
    };
    if (ghT.path) {
      try {
        const { stdout } = await run(ghT.path, ['api', 'user', '--jq', '.login'], { timeoutMs: 20000, signal: this.rootSignal });
        const login = stdout.trim();
        if (/^[A-Za-z0-9-]{1,39}$/.test(login)) {
          info.transport = 'gh';
          info.authed = true;
          info.user = login;
        }
      } catch (error) {
        const c = classify(error);
        info.note = c.code === 'unauthenticated' ? 'gh 已安装，但还没登录' : c.message;
      }
    } else {
      info.note = '没有找到 gh，将使用公开接口（需要填用户名，额度较小）';
    }
    this.info = info;
    this.infoAt = Date.now();
    return info;
  }

  /** 选择读取方式：gh 已登录就用 gh（额度大、走 gh 自己的网络设置），否则走公开接口 */
  async detect(force = false) {
    if (!force && this.info && Date.now() - this.infoAt < 30000) return this.info;
    if (this.detecting) return this.detecting;
    this.detecting = this.#detect().finally(() => {
      this.detecting = null;
    });
    return this.detecting;
  }

  async gh() {
    await this.detect();
    return this.found?.gh?.path || '';
  }

  async git() {
    await this.detect();
    return this.found?.git?.path || '';
  }

  resetDetect() {
    this.info = null;
    this.infoAt = 0;
    this.found = null;
  }

  /** 用户点「重新检测」：连登录 shell 的 PATH 也重新问一遍（可能刚装好 gh，或改了终端配置） */
  async recheck() {
    this.shellDirsP = undefined;
    this.resetDetect();
    return this.detect(true);
  }

  /** 设置里手动填了路径：先确认它真能运行、真是这个工具。空字符串表示「改回自动查找」 */
  async checkTool(name, file) {
    const ctx = this.#ctx();
    const p = String(file || '').trim();
    if (!p) return { ok: true, version: '' };
    if (!isAbsoluteFor(ctx.platform, p)) return { ok: false, reason: '要填完整路径（以盘符或 / 开头）' };
    try {
      if (!(await stat(p)).isFile()) return { ok: false, reason: '这个位置不是一个文件' };
    } catch {
      return { ok: false, reason: '这个位置没有文件' };
    }
    const version = await probeVersion(p, { signal: this.rootSignal, env: ctx.env, expect: EXPECT[name] });
    return version ? { ok: true, version } : { ok: false, reason: '这个文件运行不了，或者不是 ' + name };
  }

  async #fetch(url, { accept, signal, json }) {
    const sig = this.#sig(signal, 30000);
    let res;
    try {
      res = await fetch(url, { headers: { accept, 'user-agent': UA, 'x-github-api-version': '2022-11-28' }, signal: sig });
    } catch {
      if (signal?.aborted) throw new AppError('cancelled', '已取消', 499);
      throw new AppError('network', '连不上 GitHub，请检查网络或代理', 502);
    }
    if (res.status === 404) throw new AppError('not_found', '找不到这个仓库或用户', 404);
    const limited = res.status === 429 || (res.status === 403 && (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.get('retry-after')));
    if (limited) {
      const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
      const retry = Number(res.headers.get('retry-after')) * 1000;
      const wait = retry || (reset ? reset - Date.now() : 0);
      throw new AppError('rate_limited', limitMessage(wait), 429, { waitMs: wait > 0 ? wait : 0 });
    }
    if (res.status === 403) throw new AppError('forbidden', 'GitHub 拒绝了这次访问', 403);
    if (res.status === 401) throw new AppError('unauthenticated', 'GitHub 拒绝了请求', 401);
    if (!res.ok) throw new AppError('github_error', 'GitHub 返回了 ' + res.status, 502);
    return json ? res.json() : res.text();
  }

  async #get(path, { accept = JSON_ACCEPT, signal, query, json = true } = {}) {
    const info = await this.detect();
    const qs = query ? '?' + new URLSearchParams(query).toString() : '';
    if (info.transport === 'gh') {
      const gh = await this.gh();
      try {
        const { stdout } = await run(gh, ['api', '-H', 'Accept: ' + accept, path + qs], { signal: this.#sig(signal), timeoutMs: 60000 });
        return json ? JSON.parse(stdout) : stdout;
      } catch (error) {
        throw this.#fail(error);
      }
    }
    return this.#fetch('https://api.github.com/' + path + qs, { accept, signal, json });
  }

  /** 一页一页读 Star 列表（每页 100 条）。path 是 user/starred（自己的）或 users/<名字>/starred（别人公开的） */
  async #starPages(path, { signal, onPage } = {}) {
    const items = [];
    for (let page = 1; page <= 100; page += 1) {
      const arr = await this.#get(path, { accept: STAR_ACCEPT, signal, query: { per_page: 100, page } });
      if (!Array.isArray(arr) || arr.length === 0) break;
      for (const entry of arr) {
        const repo = entry.repo || entry;
        if (repo?.full_name) items.push(normalizeRepo(repo, entry.starred_at));
      }
      onPage?.({ fetched: items.length, page });
      if (arr.length < 100) break;
    }
    return items;
  }

  /** 自己的 Star 总数（用来显示进度）。没登录 gh、或者读的是别人的列表，就不知道总数：返回 null，不能拿自己的数字充数 */
  async starCount(user = '') {
    const info = await this.detect();
    if (info.transport !== 'gh') return null;
    const name = String(user || '').trim();
    if (name && name.toLowerCase() !== info.user.toLowerCase()) return null;
    try {
      const { stdout } = await run(await this.gh(), ['api', 'graphql', '-f', 'query={viewer{starredRepositories{totalCount}}}', '--jq', '.data.viewer.starredRepositories.totalCount'], { timeoutMs: 20000, signal: this.rootSignal });
      const n = Number(stdout.trim());
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }

  /**
   * 读 Star 列表：已登录 gh 且没指定别人，读自己的；否则按用户名读对方公开的 Star 列表。
   * 没登录 gh 时走 GitHub 公开接口（匿名每小时 60 次，一次导入通常只用几次）；被限流时不绕路，
   * 如实告诉用户多久后恢复，或者登录 gh 就不受这个限制。
   */
  async listStars({ user = '', signal, onPage } = {}) {
    const info = await this.detect();
    const name = String(user || '').trim();
    if (name && !/^[A-Za-z0-9-]{1,39}$/.test(name)) throw new AppError('bad_user', '用户名格式不对', 400);
    if (!info.authed && !name) throw new AppError('need_user', '没有检测到已登录的 gh，请先填写你的 GitHub 用户名', 400);
    const mine = info.authed && (!name || name.toLowerCase() === info.user.toLowerCase());
    const items = await this.#starPages(mine ? 'user/starred' : 'users/' + name + '/starred', { signal, onPage });
    return { user: mine ? info.user : name, items, source: 'api' };
  }

  async getRepo(fullName, { signal } = {}) {
    const repo = await this.#get('repos/' + fullName, { signal });
    if (!repo?.full_name) throw new AppError('github_error', '读取项目信息失败', 502);
    return normalizeRepo(repo, null);
  }

  async getReadme(fullName, { signal } = {}) {
    const info = await this.detect();
    let text = '';
    try {
      if (info.transport === 'gh') {
        text = await this.#get('repos/' + fullName + '/readme', { accept: RAW_ACCEPT, signal, json: false });
      } else {
        for (const name of ['README.md', 'readme.md', 'Readme.md', 'README.MD', 'README.markdown', 'README.rst', 'README.txt', 'README']) {
          try {
            text = await this.#fetch('https://raw.githubusercontent.com/' + fullName + '/HEAD/' + name, { accept: 'text/plain', signal, json: false });
            break;
          } catch (error) {
            if (error.code !== 'not_found') throw error;
          }
        }
      }
    } catch (error) {
      if (error.code === 'not_found') return { status: 'none', text: '' };
      throw error;
    }
    if (!text.trim()) return { status: 'none', text: '' };
    if (text.length > MAX_README_CHARS) text = text.slice(0, MAX_README_CHARS) + '\n\n…（README 太长，已截断）';
    return { status: 'ok', text };
  }
}

/** 浅克隆到缓存文件夹；已经有就更新，更新失败就继续用旧的。git 的路径由调用方传入（来自环境探测） */
export async function cloneOrUpdate({ fullName, dest, git, signal, timeoutMs = 300000, platform = process.platform, logger }) {
  if (!git) throw new AppError('git_missing', '没有找到 git，本地讲解需要它。' + installHint('git', platform), 500);
  const env = { GIT_LFS_SKIP_SMUDGE: '1', GCM_INTERACTIVE: 'never' };
  const cfg = platform === 'win32' ? ['-c', 'core.longpaths=true'] : [];
  const fail = (error) => {
    const c = classifyGit(error);
    if (c.code !== 'cancelled' && c.extra?.detail) logger?.warn('shelf.git.failed', { code: c.code, detail: c.extra.detail.split(dest).join('<dest>') });
    return c;
  };
  let exists = false;
  try {
    await access(join(dest, '.git'), constants.R_OK);
    exists = true;
  } catch {
    /* 第一次拉取，或者上次没拉完 */
  }
  if (exists) {
    try {
      await run(git, [...cfg, '-C', dest, 'fetch', '--depth', '1', 'origin'], { signal, timeoutMs, env });
      await run(git, [...cfg, '-C', dest, 'reset', '--hard', 'FETCH_HEAD'], { signal, timeoutMs: 120000, env });
      return { updated: true };
    } catch (error) {
      if (signal?.aborted) throw fail(error);
      return { updated: false, stale: true };
    }
  }
  await rm(dest, { recursive: true, force: true }).catch(() => {}); // 上次没拉完留下的半个文件夹
  await mkdir(dirname(dest), { recursive: true });
  try {
    await run(git, [...cfg, 'clone', '--depth', '1', '--single-branch', '--no-tags', '--quiet', 'https://github.com/' + fullName + '.git', dest], { signal, timeoutMs, env });
  } catch (error) {
    await rm(dest, { recursive: true, force: true }).catch(() => {});
    throw fail(error);
  }
  return { updated: false };
}

/** 文件夹大小（KB）。只用 Node 自带的文件接口，不依赖 du 之类的外部命令 */
export async function dirSizeKB(dir) {
  let total = 0;
  let seen = 0;
  const stack = [dir];
  while (stack.length && seen < 300000) {
    const cur = stack.pop();
    let entries;
    try {
      entries = await readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    const files = [];
    for (const entry of entries) {
      seen += 1;
      const p = join(cur, entry.name);
      if (entry.isDirectory()) stack.push(p);
      else files.push(p);
    }
    const sizes = await Promise.all(files.map((f) => lstat(f).then((s) => s.size, () => 0)));
    for (const n of sizes) total += n;
  }
  return Math.ceil(total / 1024);
}
