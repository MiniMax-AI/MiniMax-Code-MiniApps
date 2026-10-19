// @ts-check
// 代码仓库：深度扫描结束后识别主仓库和 worktree；读 .git 文件、HEAD、失效记录；解析 git status；按 du 口径汇总大小。
// 大小在查询时从目录树现算（清理、重新扫描后自动更新），持久化的只是结构和兜底数字。
import { F } from './tree.mjs';

const READ_LIMIT = 4096;

/**
 * @typedef {{ path: string, name: string, branch: string | null, du: number, rel: number, mtime: number }} WorktreeRec
 * @typedef {{
 *   id: string, name: string, path: string, mainInScope: boolean,
 *   lastActivityMs: number | null, staleCount: number | null,
 *   du: number, rel: number, gitDu: number, worktrees: WorktreeRec[],
 *   gitDir?: string, gitOutside?: boolean,
 * }} RepoRec
 * gitDir：主仓库的 git 目录（普通仓库是 <主仓库>/.git，--separate-git-dir 的仓库是 .git 文件指向的目录）。
 * gitOutside：独立 git 目录不在扫描范围里（这时 .git 大小记为 0）。
 */

/**
 * 并发上限为 n 地处理，结果顺序和输入一致。
 * @template T, R
 * @param {T[]} items @param {number} n @param {(x: T, i: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function mapLimit(items, n, fn) {
  /** @type {R[]} */
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

/** 读小文件的前 4 KB，读不到返回 null。 @param {any} fs @param {string} p */
export async function readSmall(fs, p) {
  let fh;
  try {
    fh = await fs.open(p, 'r');
    const buf = Buffer.alloc(READ_LIMIT);
    const { bytesRead } = await fh.read(buf, 0, READ_LIMIT, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } catch {
    return null;
  } finally {
    if (fh) await fh.close().catch(() => undefined);
  }
}

/**
 * `.git` 文件的内容 `gitdir: <路径>`，相对路径按 baseDir 解析。
 * @param {string | null} text @param {string} baseDir @param {import('./util.mjs').PathOps} pathOps
 */
export function parseGitFile(text, baseDir, pathOps) {
  if (!text) return null;
  const m = /^gitdir:[ \t]*(.+?)[ \t]*$/m.exec(text);
  if (!m) return null;
  return pathOps.norm(pathOps.api.resolve(baseDir, m[1]));
}

/**
 * 按 gitdir 判断类型：子模块（.git/modules/ 下）、worktree（<仓库 git 目录>/worktrees/<名字>）、其他。
 * @param {string} gitdir @param {import('./util.mjs').PathOps} pathOps
 * @returns {{ kind: 'submodule' } | { kind: 'other' } | { kind: 'worktree', mainPath: string, name: string }}
 */
export function classifyGitdir(gitdir, pathOps) {
  const sep = pathOps.sep;
  if (pathOps.key(gitdir).includes(`${sep}.git${sep}modules${sep}`)) return { kind: 'submodule' };
  const parent = pathOps.dirname(gitdir);
  if (pathOps.basename(parent).toLowerCase() !== 'worktrees') return { kind: 'other' };
  const gitDir = pathOps.dirname(parent);
  // 普通仓库的 git 目录是 <主仓库>/.git；裸仓库的 git 目录就是仓库本身。
  const mainPath = pathOps.basename(gitDir).toLowerCase() === '.git' ? pathOps.dirname(gitDir) : gitDir;
  return { kind: 'worktree', mainPath: pathOps.norm(mainPath), name: pathOps.basename(gitdir) };
}

/**
 * 核对仓库一侧的登记：<gitdir>/gitdir 第一行指向的 .git 就在 dir 里时，dir 才是这条登记的 worktree（和 git worktree list 口径一致）。
 * 拷贝 worktree 目录时 .git 文件会被原样带走，只看 .git 文件会把副本也当成 worktree，所以要回头看仓库那边登记的是谁。
 * 只读这一个登记文件，不列目录、不读 HEAD。返回 null 表示核对通过，否则返回不通过的原因。
 * @param {any} fs @param {import('./util.mjs').PathOps} pathOps @param {string} gitdir worktree 的登记目录 @param {string} dir 候选目录
 * @returns {Promise<null | 'points-elsewhere' | 'record-missing'>}
 */
export async function checkWorktreeRecord(fs, pathOps, gitdir, dir) {
  const text = await readSmall(fs, pathOps.join(gitdir, 'gitdir'));
  const line = text ? text.split(/\r?\n/)[0].trim() : '';
  // 登记文件不存在、读不了或是空的：仓库那边已经没有这条登记（比如 prune 掉了），无从确认这个目录是 worktree。
  if (!line) return 'record-missing';
  // 相对路径按登记目录解析，和 listStale 一致。
  const target = pathOps.api.resolve(gitdir, line);
  // 两边都转成真实路径再用 key 比：扫描路径或登记内容可能经过符号链接、/tmp 和 /private/tmp 这类别名，key 还处理了大小写不敏感。
  const real = (/** @type {string} */ p) => fs.realpath(p).then((/** @type {string} */ r) => pathOps.key(r), () => null);
  const [want, self] = await Promise.all([real(pathOps.dirname(target)), real(dir)]);
  // 登记指向的位置已经不存在（realpath 失败）：同样不是这个目录，算指向别处。
  if (!want) return 'points-elsewhere';
  // 候选目录刚扫描过，realpath 一般不会失败；万一失败（比如被并发删掉）就退回用扫描到的路径比。
  return want === (self || pathOps.key(dir)) ? null : 'points-elsewhere';
}

/**
 * 独立的完整 git 目录（--separate-git-dir）：有 HEAD 和 objects，而且不在 .git/worktrees/、.git/modules/ 下面。
 * @param {any} fs @param {import('./util.mjs').PathOps} pathOps @param {string} gitdir
 */
export async function isSeparateGitDir(fs, pathOps, gitdir) {
  const k = pathOps.key(gitdir);
  const sep = pathOps.sep;
  if (k.includes(`${sep}.git${sep}worktrees${sep}`) || k.includes(`${sep}.git${sep}modules${sep}`)) return false;
  const head = await fs.lstat(pathOps.join(gitdir, 'HEAD')).then((/** @type {any} */ st) => st.isFile(), () => false);
  if (!head) return false;
  return fs.lstat(pathOps.join(gitdir, 'objects')).then((/** @type {any} */ st) => st.isDirectory(), () => false);
}

/** HEAD 指向分支时返回分支名，detached 时返回提交号前 8 位。 @param {string | null} text */
export function parseHead(text) {
  if (!text) return null;
  const line = text.split(/\r?\n/)[0].trim();
  const ref = /^ref:\s*(\S+)/.exec(line);
  if (ref) return ref[1].replace(/^refs\/heads\//, '');
  if (/^[0-9a-f]{7,64}$/i.test(line)) return line.slice(0, 8);
  return null;
}

/**
 * 解析 `git status --porcelain=v1 --branch`：有改动行就是 dirty，分支行里有 `[ahead N` 就是 ahead。
 * @param {string} stdout
 */
export function parseStatus(stdout) {
  let branch = /** @type {string | null} */ (null);
  let aheadCount = 0;
  let changedCount = 0;
  for (const raw of stdout.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line) continue;
    if (line.startsWith('## ')) {
      const b = line.slice(3);
      const m = /\[ahead (\d+)/.exec(b);
      if (m) aheadCount = Number(m[1]);
      const fresh = /^(?:No commits yet on|Initial commit on) (\S+)/.exec(b);
      if (fresh) branch = fresh[1];
      else if (!b.startsWith('HEAD (no branch)')) branch = b.split('...')[0].split(' ')[0] || null;
      continue;
    }
    changedCount += 1;
  }
  const status = changedCount && aheadCount ? 'dirty-ahead' : changedCount ? 'dirty' : aheadCount ? 'ahead' : 'clean';
  return { status, changedCount, aheadCount, branch };
}

/** 仓库记录的 git 目录（旧记录没有 gitDir 字段时是 <主仓库>/.git）。 @param {import('./util.mjs').PathOps} pathOps @param {{ path: string, gitDir?: string }} rec */
export function gitDirOf(pathOps, rec) {
  return rec.gitDir || pathOps.join(rec.path, '.git');
}

/**
 * 主仓库 <git 目录>/worktrees/<名字>/gitdir 指向的 .git 文件已经不存在的记录（git worktree prune 会删除的那些）。
 * @param {any} fs @param {import('./util.mjs').PathOps} pathOps @param {string} gitDir
 * @returns {Promise<{ name: string, path: string }[]>}
 */
export async function listStale(fs, pathOps, gitDir) {
  const dir = pathOps.join(gitDir, 'worktrees');
  /** @type {string[]} */
  let names = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const found = await mapLimit(names.slice(0, 5000), 8, async (name) => {
    const recDir = pathOps.join(dir, name);
    const text = await readSmall(fs, pathOps.join(recDir, 'gitdir'));
    const line = text ? text.split(/\r?\n/)[0].trim() : '';
    if (!line) return null;
    const target = pathOps.norm(pathOps.api.resolve(recDir, line));
    const exists = await fs.lstat(target).then(
      () => true,
      () => false,
    );
    return exists ? null : { name, path: pathOps.dirname(target) };
  });
  return /** @type {{ name: string, path: string }[]} */ (found.filter(Boolean)).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 让节点留在目录树里（小目录在遍历时会被裁掉），这样它有条目编号，能勾选、问 Agent、在访达中显示。
 * @param {import('./model.mjs').ScanModel} model @param {import('./tree.mjs').TNode | null} node
 */
export function pin(model, node) {
  for (let n = node; n && n.parent; n = n.parent) {
    if (n.id && !model.nodeIds.has(n.id)) model.nodeIds.set(n.id, n);
    const p = n.parent;
    if (!p.children) p.children = [n];
    else if (!p.children.includes(n)) p.children.push(n);
  }
}

/**
 * 深度扫描结束：把遍历时收集的候选整理成仓库列表，写入 model.repos。
 * 只用范围内的候选。worktree 候选要核对仓库一侧的登记；主仓库不在范围里时也核对，但只读该 worktree 的登记文件，
 * 不读 HEAD、不列目录、不统计大小。
 * @param {{ model: import('./model.mjs').ScanModel, fs: any, pathOps: import('./util.mjs').PathOps }} o
 */
export async function analyzeRepos(o) {
  const { model, fs, pathOps } = o;
  const cands = model.repoCandidates.filter((c) => !(c.node.flags & F.REMOVED));
  const gitDirNodes = model.gitDirCandidates;
  model.repoCandidates = [];
  model.gitDirCandidates = new Map();
  const counts = {
    repos: 0,
    worktrees: 0,
    submodules: 0,
    separate: 0,
    skipped: 0,
    outOfScopeMains: 0,
    // .git 文件指向某个 worktree 登记，但登记没指回这个目录（多半是拷贝出来的副本）：不算 worktree。
    notRegistered: 0,
    notRegisteredReasons: { 'points-elsewhere': 0, 'record-missing': 0 },
    notRegisteredSample: /** @type {{ path: string, reason: string }[]} */ ([]),
  };
  /** 路径是否位于扫描范围（任一扫描根）里。 @param {string} p */
  const inScope = (p) => [...model.rootInfo.values()].some((r) => pathOps.sameOrInside(pathOps.key(p), pathOps.key(r.path)));
  /** @type {Map<string, (typeof cands)[number]>} */
  const mains = new Map();
  for (const c of cands) if (!c.gitFile) mains.set(pathOps.key(c.path), c);
  const files = cands.filter((c) => c.gitFile);
  const parsed = await mapLimit(files, 8, async (c) => {
    const gitdir = parseGitFile(await readSmall(fs, pathOps.join(c.path, '.git')), c.path, pathOps);
    /** @type {{ kind: string, mainPath?: string }} */
    let cls = gitdir ? classifyGitdir(gitdir, pathOps) : { kind: 'other' };
    if (gitdir && cls.kind !== 'submodule' && (await isSeparateGitDir(fs, pathOps, gitdir))) cls = { kind: 'separate' };
    // 形如 worktree 的候选（包括之后借 byGitDir 归到独立 git 目录主仓库下的）都要核对登记，主仓库不在范围里也核对。
    const notReg = cls.kind === 'worktree' && gitdir ? await checkWorktreeRecord(fs, pathOps, gitdir, c.path) : null;
    return { c, gitdir, cls, notReg };
  });
  /** git 目录 → 主仓库，用来把独立 git 目录的 worktree（<git 目录>/worktrees/<名字>）归到主仓库下。 @type {Map<string, string>} */
  const byGitDir = new Map();
  /** @type {Map<string, string>} */
  const gitDirs = new Map();
  for (const { c, gitdir, cls } of parsed) {
    if (cls.kind !== 'separate' || !gitdir) continue;
    mains.set(pathOps.key(c.path), c);
    gitDirs.set(pathOps.key(c.path), gitdir);
    byGitDir.set(pathOps.key(gitdir), c.path);
    counts.separate += 1;
  }
  /** @type {Map<string, { mainPath: string, wts: { c: (typeof cands)[number], gitdir: string }[] }>} */
  const groups = new Map();
  for (const m of mains.values()) groups.set(pathOps.key(m.path), { mainPath: m.path, wts: [] });
  for (const { c, gitdir, cls, notReg } of parsed) {
    if (cls.kind === 'separate') continue;
    if (cls.kind === 'submodule') {
      counts.submodules += 1;
      continue;
    }
    if (cls.kind !== 'worktree' || !gitdir || !cls.mainPath) {
      counts.skipped += 1;
      continue;
    }
    if (notReg) {
      // 登记没指回这个目录：当普通目录处理，不进仓库列表、不钉在目录树里，也就不会被当成 worktree 勾选清理。
      // 它的 .git 文件解析得了，不是 skipped 那类读不懂的情况，所以单独计数，带上原因和样本方便从日志里核对。
      counts.notRegistered += 1;
      counts.notRegisteredReasons[notReg] += 1;
      if (counts.notRegisteredSample.length < 5) counts.notRegisteredSample.push({ path: c.path, reason: notReg });
      continue;
    }
    const owner = byGitDir.get(pathOps.key(cls.mainPath));
    if (owner) cls.mainPath = owner;
    const mk = pathOps.key(cls.mainPath);
    let g = groups.get(mk);
    if (!g) {
      g = { mainPath: cls.mainPath, wts: [] };
      groups.set(mk, g);
    }
    g.wts.push({ c, gitdir });
  }
  const sorted = [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  /** @type {RepoRec[]} */
  const list = [];
  for (const [mk, g] of sorted) {
    const main = mains.get(mk) || null;
    /** @type {WorktreeRec[]} */
    const worktrees = await mapLimit(g.wts, 8, async ({ c, gitdir }) => {
      pin(model, c.node);
      // 主仓库不在范围里时不读 worktree 的 HEAD（在主仓库的 .git 里），分支等检查状态时从 git status 取。
      const branch = main ? parseHead(await readSmall(fs, pathOps.join(gitdir, 'HEAD'))) : null;
      return { path: c.path, name: c.node.name, branch, du: c.node.du, rel: c.node.rel, mtime: c.node.maxMtime };
    });
    worktrees.sort((a, b) => (a.path < b.path ? -1 : 1));
    let lastActivityMs = null;
    let staleCount = null;
    const sepDir = gitDirs.get(mk) || null;
    const gitDir = sepDir || pathOps.join(g.mainPath, '.git');
    let gitDu = main ? main.gitDu : 0;
    let gitOutside = false;
    if (main) {
      pin(model, main.node);
      if (main.gitNode) pin(model, main.gitNode);
      if (sepDir) {
        // 独立 git 目录：在扫描范围里时按目录树统计大小，否则记为 0。
        gitOutside = !inScope(sepDir);
        const node = gitOutside ? null : gitDirNodes.get(pathOps.key(sepDir)) || model.findNode(sepDir).node;
        if (node) pin(model, node);
        gitDu = node ? node.du : 0;
      }
      lastActivityMs = await fs.lstat(pathOps.join(gitDir, 'index')).then(
        (/** @type {any} */ st) => st.mtimeMs,
        () => null,
      );
      staleCount = (await listStale(fs, pathOps, gitDir)).length;
    } else counts.outOfScopeMains += 1;
    model.repos.seq += 1;
    list.push({
      id: `p_${model.repos.seq.toString(36)}`,
      name: pathOps.basename(g.mainPath),
      path: g.mainPath,
      mainInScope: !!main,
      lastActivityMs,
      staleCount,
      du: main ? main.node.du : 0,
      rel: main ? main.node.rel : 0,
      gitDu,
      worktrees,
      gitDir,
      gitOutside,
    });
    counts.repos += 1;
    counts.worktrees += worktrees.length;
  }
  model.repos.list = list;
  model.repos.status = 'ready';
  model.touch();
  return counts;
}

/** 重新扫描后：已知仓库和 worktree 的新节点重新钉在目录树里。 @param {import('./model.mjs').ScanModel} model @param {import('./util.mjs').PathOps} pathOps */
export function repinRepos(model, pathOps) {
  const cands = model.repoCandidates;
  const gitDirNodes = model.gitDirCandidates;
  model.repoCandidates = [];
  model.gitDirCandidates = new Map();
  if (!model.repos.list.length) return;
  const known = new Set();
  for (const r of model.repos.list) {
    if (r.mainInScope) known.add(pathOps.key(r.path));
    for (const w of r.worktrees) known.add(pathOps.key(w.path));
    const gd = r.mainInScope && r.gitDir && !r.gitOutside ? gitDirNodes.get(pathOps.key(r.gitDir)) : null;
    if (gd) pin(model, gd);
  }
  for (const c of cands) {
    if (!known.has(pathOps.key(c.path))) continue;
    pin(model, c.node);
    if (c.gitNode) pin(model, c.gitNode);
  }
}

/**
 * 清理成功后：去掉被移走的 worktree；主仓库被移走时它不再算范围内。被移走的 worktree 在主仓库里留下失效记录。
 * 返回是否有变化。
 * @param {import('./model.mjs').ScanModel} model @param {import('./util.mjs').PathOps} pathOps @param {string} path
 */
export function forgetRemoved(model, pathOps, path) {
  const key = pathOps.key(path);
  const hit = (/** @type {string} */ p) => pathOps.sameOrInside(pathOps.key(p), key);
  let changed = false;
  const list = [];
  for (const r of model.repos.list) {
    const before = r.worktrees.length;
    r.worktrees = r.worktrees.filter((w) => !hit(w.path));
    if (r.worktrees.length !== before) {
      changed = true;
      if (r.mainInScope && typeof r.staleCount === 'number') r.staleCount += before - r.worktrees.length;
    }
    if (r.mainInScope && hit(r.path)) {
      changed = true;
      Object.assign(r, { mainInScope: false, lastActivityMs: null, staleCount: null, du: 0, rel: 0, gitDu: 0, gitOutside: false });
    }
    if (r.mainInScope || r.worktrees.length) list.push(r);
  }
  model.repos.list = list;
  return changed;
}

/** key 的上一级 key（到根返回 null）。 @param {import('./util.mjs').PathOps} pathOps @param {string} k */
function parentKey(pathOps, k) {
  const p = pathOps.key(pathOps.dirname(k));
  return p === k ? null : p;
}

/**
 * 按当前目录树现算每个仓库的大小。
 * - 主仓库、worktree 各自减去嵌套在里面的其他主仓库和 worktree，互不重复。
 * - 依赖和构建产物：build-artifacts 条目（含 node_modules）归到离它最近的主仓库或 worktree，.git 里面的不算。
 * - 同时算两套口径：du / deps / git 是 du 口径（APFS 克隆和硬链接每份都算），给单个仓库、worktree 和排序用，
 *   这样能和 du 对得上，而且不受扫描顺序影响（占用口径下共享的数据块只算在先扫到的那份里，换个顺序数字就变了）；
 *   occ / occDeps / occGit 是占用口径（TNode.size、item.sizeBytes，克隆和硬链接只算一次），只给顶部合计和分项用，
 *   保证合计不超过磁盘真实占用（pnpm 用克隆给几百个 worktree 装 node_modules 时，du 口径的合计能超过磁盘容量）。
 * @param {import('./model.mjs').ScanModel} model @param {import('./util.mjs').PathOps} pathOps
 */
export function computeRepos(model, pathOps) {
  /**
   * @typedef {{ key: string, path: string, rec: any, kind: 'main' | 'wt', node: import('./tree.mjs').TNode | null,
   *   rawDu: number, rawRel: number, du: number, rel: number, deps: number, depItems: import('./model.mjs').Item[], git: number,
   *   rawOcc: number, occ: number, occDeps: number, occGit: number }} Container
   */
  /** @type {Map<string, Container>} */
  const containers = new Map();
  const add = (/** @type {any} */ rec, /** @type {'main' | 'wt'} */ kind) => {
    const key = pathOps.key(rec.path);
    const { node } = model.findNode(rec.path);
    const live = node && !(node.flags & F.REMOVED) ? node : null;
    const rawDu = live ? live.du : rec.du;
    const rawRel = live ? live.rel : rec.rel;
    // 记录里只存了 du 口径的兜底数字，没有占用口径的。找不到节点时（目录树里已经没有它，数字本来就是旧的）沿用 rec.du，
    // 和 du 口径的兜底保持一致；正常扫描完和从持久化加载后节点都在（钉在树里，size 随树一起持久化），走不到这里。
    const rawOcc = live ? live.size : rec.du;
    /** @type {Container} */
    const c = { key, path: rec.path, rec, kind, node: live, rawDu, rawRel, du: rawDu, rel: rawRel, deps: 0, depItems: [], git: 0, rawOcc, occ: rawOcc, occDeps: 0, occGit: 0 };
    containers.set(key, c);
    return c;
  };
  const repos = model.repos.list.map((r) => ({ rec: r, main: r.mainInScope ? add(r, 'main') : null, wts: r.worktrees.map((w) => add(w, 'wt')) }));
  /** @param {string} k 从 k 的上一级开始找最近的容器 */
  const nearestAbove = (k) => {
    for (let cur = parentKey(pathOps, k); cur; cur = parentKey(pathOps, cur)) {
      const c = containers.get(cur);
      if (c) return c;
    }
    return null;
  };
  for (const c of containers.values()) {
    const outer = nearestAbove(c.key);
    if (outer) {
      outer.du -= c.rawDu;
      outer.rel -= c.rawRel;
      outer.occ -= c.rawOcc;
    }
  }
  if (containers.size) {
    const gitSeg = `.git`;
    for (const it of model.items.values()) {
      if (it.category !== 'build-artifacts') continue;
      const c = nearestAbove(it.key);
      if (!c) continue;
      const rest = it.key.slice(c.key.length + 1);
      if (rest === gitSeg || rest.startsWith(gitSeg + pathOps.sep)) continue;
      c.deps += typeof it.duBytes === 'number' ? it.duBytes : it.sizeBytes;
      c.occDeps += it.sizeBytes;
      c.depItems.push(it);
    }
  }
  for (const c of containers.values()) {
    c.du = Math.max(0, c.du);
    c.rel = Math.max(0, c.rel);
    c.occ = Math.max(0, c.occ);
    if (c.kind === 'main') {
      const kids = c.node ? c.node.children : null;
      const g = kids ? kids.find((n) => n.name === '.git' && n.flags & F.GIT_DIR) : null;
      const gd = gitDirOf(pathOps, c.rec);
      if (pathOps.same(gd, pathOps.join(c.path, '.git'))) {
        c.git = g ? g.du : kids ? 0 : c.rec.gitDu || 0;
        // 占用口径同样取 .git 节点；没有节点时和 du 口径一样用记录里的兜底数字。
        c.occGit = g ? g.size : kids ? 0 : c.rec.gitDu || 0;
      } else if (c.rec.gitOutside) c.git = 0;
      else {
        // --separate-git-dir：git 目录在范围里。不在主仓库目录里时，它的大小也计入主仓库（两种口径都加）。
        const found = model.findNode(gd).node;
        const live = found && !(found.flags & F.REMOVED) ? found : null;
        c.git = live ? live.du : c.rec.gitDu || 0;
        c.occGit = live ? live.size : c.rec.gitDu || 0;
        if (!pathOps.inside(pathOps.key(gd), c.key)) {
          c.du += c.git;
          c.rel += live ? live.rel : 0;
          c.occ += c.occGit;
        }
      }
    }
  }
  return repos.map(({ rec, main, wts }) => {
    let worktreeBytes = 0;
    let worktreeReleasableBytes = 0;
    let depsBytes = main ? main.deps : 0;
    let occSizeBytes = main ? main.occ : 0;
    let occDepsBytes = main ? main.occDeps : 0;
    for (const w of wts) {
      worktreeBytes += w.du;
      worktreeReleasableBytes += w.rel;
      depsBytes += w.deps;
      occSizeBytes += w.occ;
      occDepsBytes += w.occDeps;
    }
    return {
      rec,
      main,
      wts,
      sizeBytes: (main ? main.du : 0) + worktreeBytes,
      releasableBytes: (main ? main.rel : 0) + worktreeReleasableBytes,
      worktreeBytes,
      worktreeReleasableBytes,
      depsBytes,
      // 占用口径，只用于顶部合计（见函数说明）。
      occSizeBytes,
      occDepsBytes,
    };
  });
}
