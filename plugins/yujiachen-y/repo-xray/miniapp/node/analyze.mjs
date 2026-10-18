// @ts-check
import { COUPLE, coKind, mapView } from './codemap.mjs';
import { git } from './git.mjs';

export const ALGO_VERSION = 8;
const FIX_RE = 'fix|bug|broken'; // skill 2c (git --grep, case-insensitive, full message)
const FIRE_RE = /revert|hotfix|emergency|rollback/i; // skill 2e (oneline subject)
const SEP = '\x1f';

/**
 * Build the in-memory history model with one streaming `git log` pass.
 * @param {string} dir
 * @param {{ signal?: AbortSignal, onProgress?: (n: number) => void }} opts
 */
export async function buildModel(dir, { signal, onProgress } = {}) {
  const head = (await git(['-C', dir, 'rev-parse', 'HEAD'], { signal, timeout: 20_000 })).trim();
  let branch = '';
  try {
    branch = (await git(['-C', dir, 'symbolic-ref', '--short', '-q', 'HEAD'], { signal, timeout: 20_000 })).trim();
  } catch {}
  const branches = (await git(['-C', dir, 'for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes'], { signal, timeout: 60_000 }))
    .split('\n')
    .filter((r) => r && !r.endsWith('/HEAD')).length;

  const authors = [];
  const authorIdx = new Map();
  const paths = [];
  const pathIdx = new Map();
  const commits = [];
  let cur = null;
  let rest = '';
  const internAuthor = (name, email) => {
    const key = `${name}\x00${email}`;
    let i = authorIdx.get(key);
    if (i === undefined) {
      i = authors.length;
      authors.push({ name, email });
      authorIdx.set(key, i);
    }
    return i;
  };
  const internPath = (p) => {
    let i = pathIdx.get(p);
    if (i === undefined) {
      i = paths.length;
      paths.push(p);
      pathIdx.set(p, i);
    }
    return i;
  };
  const handleLine = (line) => {
    if (line.charCodeAt(0) === 0x1e) {
      const f = line.slice(1).split(SEP);
      cur = { sha: f[0], a: internAuthor(f[1] || '(unknown)', (f[2] || '').toLowerCase()), ad: f[3], at: Number(f[4]), ct: Number(f[5]), merge: (f[6] || '').trim().includes(' '), subj: f.slice(7).join(SEP), files: [] };
      commits.push(cur);
      if (commits.length % 2000 === 0) onProgress?.(commits.length);
      return;
    }
    if (!cur || !line) return;
    const tab = line.indexOf('\t');
    if (tab < 0) return;
    const status = line[0];
    let p = line.slice(tab + 1);
    if (status === 'R' || status === 'C') p = p.split('\t').pop() || p;
    cur.files.push(internPath(p), status.charCodeAt(0));
  };
  await git(
    ['-C', dir, '-c', 'core.quotePath=false', 'log', '-M100%', '--date=format:%Y-%m-%d', `--format=%x1e%H${SEP}%aN${SEP}%aE${SEP}%ad${SEP}%at${SEP}%ct${SEP}%P${SEP}%s`, '--name-status', 'HEAD'],
    {
      signal,
      env: { GIT_NO_LAZY_FETCH: '1' },
      timeout: 10 * 60_000,
      onStdout: (chunk) => {
        const text = rest + chunk.toString('utf8');
        const lines = text.split('\n');
        rest = lines.pop() || '';
        for (const l of lines) handleLine(l);
      },
    },
  );
  if (rest) handleLine(rest);
  if (!commits.length) throw Object.assign(new Error('仓库还没有任何提交'), { code: 'empty' });

  const fixOut = await git(['-C', dir, 'log', '-i', '-E', `--grep=${FIX_RE}`, '--format=%H', 'HEAD'], { signal, timeout: 5 * 60_000 });
  const fix = new Set(fixOut.split('\n').filter(Boolean));
  for (const c of commits) {
    c.fix = fix.has(c.sha);
    c.fire = FIRE_RE.test(c.subj);
    c.files = Int32Array.from(c.files);
  }

  // Tree at HEAD (for "still exists" and tech stack).
  const tree = [];
  const treeOut = await git(['-C', dir, '-c', 'core.quotePath=false', 'ls-tree', '-r', '--full-tree', 'HEAD'], { signal, timeout: 120_000 });
  for (const line of treeOut.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const [mode, type, oid] = line.slice(0, tab).split(' ');
    if (type !== 'blob') continue;
    tree.push({ path: line.slice(tab + 1), oid, mode });
  }
  const pathCount = new Int32Array(paths.length);
  for (const c of commits) for (let i = 0; i < c.files.length; i += 2) pathCount[c.files[i]]++;
  const model = { head, branch, branches, authors, paths, pathCount, pathIdx, commits, tree, treeSet: new Set(tree.map((t) => t.path)), builtAt: Date.now() };
  model.ids = { raw: rawIdentities(authors), merged: mergedIdentities(authors, commits) };
  return model;
}

// ---------------------------------------------------------------------------
// Identities
// raw    = skill parity: one identity per %aN (mailmap-aware, case-sensitive)
// merged = union by case-insensitive name and by email; bot-like identities
//          (project tokens, [bot], agent accounts) form their own groups
// ---------------------------------------------------------------------------

const BOT_EMAIL = /(^|[._+-])bot[s]?([._+-]|@)|\[bot\]|project_\d+_bot|group_\d+_bot|^(agent|ci|build|robot|automation|deploy)@|^agent@/i;
const BOT_NAME = /\[bot\]|(^|[\s_-])bot$|^bot[\s_-]|^(dependabot|renovate|github-actions|gitlab-ci|semantic-release|greenkeeper|snyk-bot|mergify|codecov|pre-commit-ci)\b|(^|\s)agent$|^test[\s_-]?agent$/i;
export function isBot(a) {
  if (/\[bot\]@users\.noreply\.github\.com$/.test(a.email)) return true;
  const ghUser = /@users\.noreply\.github\.com$/.test(a.email);
  return (!ghUser && BOT_EMAIL.test(a.email)) || BOT_NAME.test(a.name);
}

function rawIdentities(authors) {
  const byName = new Map();
  const names = [];
  const idOf = new Int32Array(authors.length);
  authors.forEach((a, i) => {
    let id = byName.get(a.name);
    if (id === undefined) {
      id = names.length;
      names.push(a.name);
      byName.set(a.name, id);
    }
    idOf[i] = id;
  });
  return { idOf, names, bot: names.map(() => false), mode: 'raw' };
}

function mergedIdentities(authors, commits) {
  const parent = authors.map((_, i) => i);
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent[b] = a;
  };
  const bot = authors.map(isBot);
  const firstByKey = new Map();
  authors.forEach((a, i) => {
    const keys = [`${bot[i] ? 'b' : 'h'}:n:${a.name.trim().toLowerCase()}`];
    if (a.email && !bot[i] && /@/.test(a.email)) keys.push(`h:e:${a.email}`);
    for (const k of keys) {
      const j = firstByKey.get(k);
      if (j === undefined) firstByKey.set(k, i);
      else union(j, i);
    }
  });
  const counts = new Int32Array(authors.length);
  for (const c of commits) counts[c.a]++;
  const groups = new Map();
  authors.forEach((_, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(i);
  });
  const names = [];
  const botFlags = [];
  const aliases = [];
  const idOf = new Int32Array(authors.length);
  for (const members of groups.values()) {
    const id = names.length;
    const byName = new Map();
    for (const m of members) byName.set(authors[m].name, (byName.get(authors[m].name) || 0) + counts[m]);
    const sorted = [...byName.entries()].sort((a, b) => b[1] - a[1]);
    names.push(sorted[0][0]);
    aliases.push(sorted.slice(1).map(([n]) => n));
    botFlags.push(members.every((m) => bot[m]));
    for (const m of members) idOf[m] = id;
  }
  const humanNames = new Set(names.filter((_, i) => !botFlags[i]).map((n) => n.toLowerCase()));
  names.forEach((n, i) => {
    if (botFlags[i] && humanNames.has(n.toLowerCase())) names[i] = `${n}（令牌）`;
  });
  return { idOf, names, bot: botFlags, aliases, mode: 'merged' };
}

// ---------------------------------------------------------------------------
// Report (mirrors codebase-recon SKILL.md)
// ---------------------------------------------------------------------------

const DAY = 86_400;

function minusMonths(sec, months) {
  const d = new Date(sec * 1000);
  d.setMonth(d.getMonth() - months);
  return Math.floor(d.getTime() / 1000);
}
const monthOf = (ad) => ad.slice(0, 7);
function topDir(p) {
  const parts = p.split('/');
  if (parts.length <= 1) return '（根目录）';
  return parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0];
}

const ymdOf = (sec) => {
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Daily commit counts (author date, merges included like momentum) for the 365 days ending at anchor. */
function buildActivity(commits, anchor) {
  const end = ymdOf(anchor);
  const start = ymdOf(anchor - 364 * DAY);
  /** @type {Record<string, number>} */
  const daily = {};
  for (const c of commits) if (c.ad >= start && c.ad <= end) daily[c.ad] = (daily[c.ad] || 0) + 1;
  return { start, end, daily };
}

export function buildReport(model, { now = Math.floor(Date.now() / 1000), identity = 'merged' } = {}) {
  const { commits, paths } = model;
  const ident = model.ids[identity] || model.ids.merged;
  const authors = ident.names;
  const who = (c) => ident.idOf[c.a];
  const human = (id) => !ident.bot[id];
  const total = commits.length;

  // Phase 1: Probe
  const latest = commits[0].ad;
  const first = commits[commits.length - 1].ad;
  const tier = total < 500 ? 'small' : total <= 10_000 ? 'medium' : 'large';
  const N = { small: 10, medium: 20, large: 30 }[tier];
  const windowMonths = { small: null, medium: 12, large: 6 }[tier];
  let anchor = now;
  let anchorFallback = false;
  let since = windowMonths ? minusMonths(now, windowMonths) : -Infinity;
  if (windowMonths && !commits.some((c) => c.ct >= since)) {
    anchor = commits[0].ct;
    since = minusMonths(anchor, windowMonths);
    anchorFallback = true;
  }
  const windowLabel = windowMonths ? (windowMonths === 12 ? '1 year ago' : '6 months ago') : 'all time';
  const inWin = (c) => c.ct >= since;

  // 2a hotspots / 2c bug magnets / 2f recently added
  const hot = new Map();
  const bug = new Map();
  const added = new Map();
  let windowCommits = 0;
  for (const c of commits) {
    if (!inWin(c)) continue;
    windowCommits++;
    const f = c.files;
    for (let i = 0; i < f.length; i += 2) {
      const p = f[i];
      hot.set(p, (hot.get(p) || 0) + 1);
      if (c.fix) bug.set(p, (bug.get(p) || 0) + 1);
      if (f[i + 1] === 65 /* A */) added.set(p, (added.get(p) || 0) + 1);
    }
  }
  const rank = (m) => [...m.entries()].sort((a, b) => b[1] - a[1] || (paths[a[0]] < paths[b[0]] ? -1 : 1));
  const asList = (ranked, n) => ranked.slice(0, n).map(([p, count], i) => ({ path: paths[p], count, rank: i + 1, exists: model.treeSet.has(paths[p]) }));
  const hotspots = asList(rank(hot), N);
  const bugMagnets = asList(rank(bug), N);
  const recentFiles = asList(rank(added), N);
  const addedDirs = new Map();
  for (const [p, n] of added) addedDirs.set(topDir(paths[p]), (addedDirs.get(topDir(paths[p])) || 0) + n);

  // Per-file all-time ownership (non-merge), needed for risk ownership.
  const ownersOf = (pathStr) => {
    const pi = model.pathIdx.get(pathStr) ?? -1;
    const counts = new Map();
    for (const c of commits) {
      if (c.merge || !human(who(c))) continue;
      const f = c.files;
      for (let i = 0; i < f.length; i += 2) if (f[i] === pi) {
        counts.set(who(c), (counts.get(who(c)) || 0) + 1);
        break;
      }
    }
    const sum = [...counts.values()].reduce((s, n) => s + n, 0);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([a, n]) => ({ name: authors[a], commits: n, share: sum ? n / sum : 0 }));
  };

  // Cross-ref 1+2: high-risk files
  const bugRank = new Map(bugMagnets.map((b) => [b.path, b]));
  const highRisk = hotspots
    .filter((h) => bugRank.has(h.path))
    .map((h) => {
      const b = bugRank.get(h.path);
      const owners = ownersOf(h.path);
      return { path: h.path, hotRank: h.rank, bugRank: b.rank, hotCount: h.count, bugCount: b.count, exists: h.exists, owner: owners[0] || null, owners };
    });

  // 2b bus factor + 2g active contributors (3B: ranked by person)
  const per = new Map();
  const cutoff3m = minusMonths(now, 3);
  const months12 = [];
  {
    const d = new Date(anchor * 1000);
    for (let i = 11; i >= 0; i--) {
      const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
      months12.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`);
    }
  }
  const m12Index = new Map(months12.map((m, i) => [m, i]));
  const botCommits = new Map();
  for (const c of commits) {
    if (c.merge) continue;
    if (!human(who(c))) {
      botCommits.set(who(c), (botCommits.get(who(c)) || 0) + 1);
      continue;
    }
    let p = per.get(who(c));
    if (!p) {
      p = { a: who(c), commits: 0, first: c.ad, last: c.ad, lastCt: c.ct, active: false, window: 0, fixes: 0, dirs: new Map(), monthly: new Array(12).fill(0) };
      per.set(who(c), p);
    }
    p.commits++;
    if (c.ad < p.first) p.first = c.ad;
    if (c.ad > p.last) p.last = c.ad;
    if (c.ct > p.lastCt) p.lastCt = c.ct;
    if (c.ct >= cutoff3m) p.active = true;
    if (inWin(c)) p.window++;
    if (c.fix) p.fixes++;
    const mi = m12Index.get(monthOf(c.ad));
    if (mi !== undefined) p.monthly[mi]++;
    const f = c.files;
    const seen = new Set();
    for (let i = 0; i < f.length; i += 2) {
      const d = topDir(paths[f[i]]);
      if (seen.has(d)) continue;
      seen.add(d);
      p.dirs.set(d, (p.dirs.get(d) || 0) + 1);
    }
  }
  const nonMerge = [...per.values()].reduce((s, p) => s + p.commits, 0);
  const ranked = [...per.values()].sort((a, b) => b.commits - a.commits || (authors[a.a] < authors[b.a] ? -1 : 1));
  const contributors = ranked.slice(0, 100).map((p, i) => ({
    rank: i + 1,
    name: authors[p.a],
    aliases: ident.aliases?.[p.a] || [],
    commits: p.commits,
    share: nonMerge ? p.commits / nonMerge : 0,
    first: p.first,
    last: p.last,
    active: p.active,
    window: p.window,
    fixes: p.fixes,
    dirs: [...p.dirs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
    monthly: p.monthly,
  }));
  const totalContributors = per.size;
  const active3m = ranked.filter((p) => p.active).length;
  let acc = 0;
  let half = 0;
  for (const p of ranked) {
    acc += p.commits;
    half++;
    if (acc >= nonMerge / 2) break;
  }
  const busFactor = {
    total: totalContributors,
    active3m,
    ratio: totalContributors ? active3m / totalContributors : 0,
    warn: totalContributors > 0 && active3m / totalContributors < 0.3,
    halfCount: half,
    topShare: ranked[0] ? ranked[0].commits / nonMerge : 0,
  };

  // 2d momentum (all commits, author month) + cross-ref 4
  const monthCounts = new Map();
  for (const c of commits) monthCounts.set(monthOf(c.ad), (monthCounts.get(monthOf(c.ad)) || 0) + 1);
  const allMonths = [];
  {
    const [fy, fm] = first.slice(0, 7).split('-').map(Number);
    const [ly, lm] = latest.slice(0, 7).split('-').map(Number);
    for (let y = fy, m = fm; y < ly || (y === ly && m <= lm); m === 12 ? ((m = 1), y++) : m++) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      allMonths.push({ m: key, n: monthCounts.get(key) || 0 });
    }
  }
  const nowMonth = (() => {
    const d = new Date(anchor * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  const complete = allMonths.filter((x) => !(x.m === nowMonth && !anchorFallback));
  const partialMonth = complete.length !== allMonths.length ? nowMonth : null;
  const last3 = complete.slice(-3);
  const prev3 = complete.slice(-6, -3);
  const avg = (a) => (a.length ? a.reduce((s, x) => s + x.n, 0) / a.length : 0);
  const lastAvg = avg(last3);
  const prevAvg = avg(prev3);
  let trend = 'stable';
  if (prev3.length === 3 && prevAvg > 0 && lastAvg > prevAvg * 1.2) trend = 'rising';
  else if (prev3.length === 3 && lastAvg < prevAvg * 0.8) trend = 'declining';
  else {
    const six = complete.slice(-6);
    const changes = [];
    for (let i = 1; i < six.length; i++) if (six[i - 1].n > 0) changes.push(Math.abs(six[i].n - six[i - 1].n) / six[i - 1].n);
    if (changes.length >= 3 && changes.reduce((s, x) => s + x, 0) / changes.length > 0.5) trend = 'erratic';
  }
  if (prev3.length < 3) trend = 'insufficient';

  // 2e firefighting
  const fires = commits.filter((c) => inWin(c) && c.fire);
  const firefighting = {
    count: fires.length,
    total: windowCommits,
    rate: windowCommits ? fires.length / windowCommits : 0,
    list: fires.slice(0, 60).map((c) => ({ sha: c.sha, subj: c.subj, date: c.ad, author: authors[who(c)], kind: (c.subj.match(FIRE_RE)?.[0] || '').toLowerCase() })),
    kinds: Object.entries(fires.reduce((m, c) => ((m[(c.subj.match(FIRE_RE)?.[0] || '').toLowerCase()] = (m[(c.subj.match(FIRE_RE)?.[0] || '').toLowerCase()] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]),
  };

  // Problems (deterministic signals)
  const problems = [];
  if (highRisk.length) {
    problems.push({ level: 'warn', anchor: 'risk', title: `${highRisk.length} 个高风险文件：既是热点，又频繁被修 bug`, detail: highRisk.slice(0, 3).map((h) => h.path.split('/').pop()).join('、') });
    const solo = highRisk.filter((h) => h.exists && h.owner && h.owner.share >= 0.8);
    if (solo.length) problems.push({ level: 'warn', anchor: 'risk', filter: 'solo', title: `${solo.length} 个高风险文件主要由一个人维护（≥80% 提交）`, detail: solo.slice(0, 3).map((h) => `${h.path.split('/').pop()} → ${h.owner.name}`).join('、') });
  } else {
    problems.push({ level: 'good', anchor: 'risk', title: '热点文件和 bug 磁铁没有重叠', detail: 'skill 原话：No files appear in both lists — good sign.' });
  }
  if (busFactor.warn) problems.push({ level: 'warn', anchor: 'people', title: `活跃贡献者比例偏低：${active3m} / ${totalContributors}（${Math.round(busFactor.ratio * 100)}%）`, detail: '近 3 个月活跃的人不足历史总人数的 30%，知识可能集中在少数人身上' });
  if (busFactor.halfCount <= 2 && totalContributors >= 4) problems.push({ level: 'warn', anchor: 'people', title: `${busFactor.halfCount} 个人贡献了一半以上的提交`, detail: `${contributors.slice(0, busFactor.halfCount).map((c) => c.name).join('、')}` });
  if (trend === 'declining') problems.push({ level: 'warn', anchor: 'momentum', title: `提交节奏在下降：近 3 个月月均 ${Math.round(lastAvg)}，之前 3 个月 ${Math.round(prevAvg)}`, detail: '降幅超过 20%' });
  if (trend === 'erratic') problems.push({ level: 'info', anchor: 'momentum', title: '提交节奏波动大', detail: '近几个月环比变化平均超过 50%' });
  if (trend === 'rising') problems.push({ level: 'good', anchor: 'momentum', title: `提交节奏在上升：近 3 个月月均 ${Math.round(lastAvg)}，之前 3 个月 ${Math.round(prevAvg)}`, detail: '增幅超过 20%' });
  if (firefighting.rate >= 0.05) problems.push({ level: 'warn', anchor: 'fire', title: `救火提交占 ${(firefighting.rate * 100).toFixed(1)}%（${firefighting.count} / ${windowCommits}）`, detail: firefighting.kinds.map(([k, n]) => `${k} ${n}`).join('、') });
  else if (firefighting.count) problems.push({ level: 'info', anchor: 'fire', title: `窗口内有 ${firefighting.count} 次 revert / hotfix 类提交（${(firefighting.rate * 100).toFixed(1)}%）`, detail: firefighting.kinds.map(([k, n]) => `${k} ${n}`).join('、') });
  if (anchorFallback) problems.push({ level: 'info', anchor: 'vitals', title: `仓库最近 ${windowMonths === 12 ? '一年' : '半年'}没有提交`, detail: `最后一次提交在 ${latest}，分析窗口改为以它为终点` });
  const deletedHot = hotspots.filter((h) => !h.exists).length;
  if (deletedHot >= Math.max(3, N / 4)) problems.push({ level: 'info', anchor: 'risk', filter: 'deleted', title: `${deletedHot} 个热点文件已在 HEAD 中删除或改名`, detail: '它们的历史仍算在热点里，阅读时以现存文件为准' });

  // Recommendations (skill template)
  const readList = (highRisk.length ? highRisk : hotspots).filter((x) => x.exists !== false).slice(0, 3).map((x) => x.path);
  const talkFile = (highRisk[0] || hotspots.find((h) => h.exists) || hotspots[0])?.path;
  const talkOwner = talkFile ? (highRisk[0]?.owner || ownersOf(talkFile)[0]) : null;
  const watchOut = [];
  if (trend === 'declining') watchOut.push('提交节奏在下降');
  if (trend === 'erratic') watchOut.push('提交节奏不稳定');
  if (busFactor.warn) watchOut.push('活跃贡献者比例低，存在知识集中风险');
  if (firefighting.rate >= 0.05) watchOut.push('救火提交比例高');
  const recommendations = { startReading: readList, talkTo: talkOwner ? { name: talkOwner.name, file: talkFile, share: talkOwner.share } : null, watchOut };

  return {
    algo: ALGO_VERSION,
    identity: ident.mode,
    bots: [...botCommits.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ name: authors[id], commits: n })),
    head: model.head,
    branch: model.branch,
    vitals: { commits: total, first, latest, branches: model.branches, tier, N, window: windowLabel, since: Number.isFinite(since) ? since : null, anchorFallback, windowCommits, files: model.tree.length },
    hotspots,
    bugMagnets,
    highRisk,
    recentlyAdded: { files: recentFiles, dirs: [...addedDirs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10), total: [...added.values()].reduce((s, n) => s + n, 0) },
    contributors,
    busFactor,
    momentum: { months: allMonths, trend, lastAvg, prevAvg, partialMonth },
    firefighting,
    problems,
    recommendations,
    activity: buildActivity(commits, anchor),
    // Overview thumbnail of the code map: HEAD structure (files), window activity, small budget.
    codemap: mapView(model, { since: Number.isFinite(since) ? since : null, lite: true, maxBlocks: 20, risk: new Set(highRisk.map((h) => h.path)), now }),
    generatedAt: Date.now(),
  };
}

function identOf(model, identity) {
  return model.ids[identity] || model.ids.merged;
}

/** Drill-down for one file. */
export function fileDetail(model, path, { identity = 'merged' } = {}) {
  const pi = model.pathIdx.get(path);
  if (pi === undefined) return null;
  const ident = identOf(model, identity);
  const owners = new Map();
  const months = new Map();
  const list = [];
  const co = new Map();
  let coRevs = 0;
  let firstAdd = null;
  let fixes = 0;
  let total = 0;
  for (const c of model.commits) {
    const f = c.files;
    let st = 0;
    for (let i = 0; i < f.length; i += 2) if (f[i] === pi) {
      st = f[i + 1];
      break;
    }
    if (!st) continue;
    total++;
    // Co-change with code-maat's thresholds: non-merge commits of at most 30 files.
    if (!c.merge && f.length / 2 <= COUPLE.maxChangeset) {
      coRevs++;
      for (let i = 0; i < f.length; i += 2) if (f[i] !== pi) co.set(f[i], (co.get(f[i]) || 0) + 1);
    }
    if (c.fix) fixes++;
    const id = ident.idOf[c.a];
    if (!c.merge && !ident.bot[id]) owners.set(id, (owners.get(id) || 0) + 1);
    months.set(monthOf(c.ad), (months.get(monthOf(c.ad)) || 0) + 1);
    if (st === 65) firstAdd = c.ad;
    if (list.length < 40) list.push({ sha: c.sha, subj: c.subj, date: c.ad, author: ident.names[id], bot: ident.bot[id], fix: c.fix, fire: c.fire, status: String.fromCharCode(st) });
  }
  const sum = [...owners.values()].reduce((s, n) => s + n, 0);
  const ranked = [...co]
    .map(([q, n]) => ({ path: model.paths[q], shared: n, degree: coRevs ? n / coRevs : 0, exists: model.treeSet.has(model.paths[q]) }))
    .sort((a, b) => b.degree - a.degree || (a.path < b.path ? -1 : 1));
  const tag = (x) => ({ ...x, degree: Math.round(x.degree * 1000) / 1000, kind: coKind(model, path, x.path) });
  const strong = ranked.filter((x) => x.shared >= COUPLE.minShared && x.degree >= COUPLE.minDegree).slice(0, 8).map(tag);
  return {
    path,
    exists: model.treeSet.has(path),
    coupling: { revs: coRevs, strong, weak: strong.length ? [] : ranked.filter((x) => x.shared >= 3).slice(0, 3).map(tag), ...COUPLE },
    total,
    fixes,
    firstAdd,
    owners: [...owners.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([a, n]) => ({ name: ident.names[a], commits: n, share: sum ? n / sum : 0 })),
    ownerCount: owners.size,
    months: [...months.entries()].sort(),
    commits: list,
  };
}

/** Drill-down for one contributor (by display name in the chosen identity mode). */
export function personDetail(model, name, { identity = 'merged' } = {}) {
  const ident = identOf(model, identity);
  const id = ident.names.indexOf(name);
  if (id < 0) return null;
  const files = new Map();
  const dirs = new Map();
  const months = new Map();
  const list = [];
  let commits = 0;
  let merges = 0;
  let fixes = 0;
  let first = null;
  let last = null;
  for (const c of model.commits) {
    if (ident.idOf[c.a] !== id) continue;
    if (c.merge) {
      merges++;
      continue;
    }
    commits++;
    if (c.fix) fixes++;
    if (!last) last = c.ad;
    first = c.ad;
    months.set(monthOf(c.ad), (months.get(monthOf(c.ad)) || 0) + 1);
    const seen = new Set();
    for (let i = 0; i < c.files.length; i += 2) {
      const p = c.files[i];
      files.set(p, (files.get(p) || 0) + 1);
      const d = topDir(model.paths[p]);
      if (!seen.has(d)) {
        seen.add(d);
        dirs.set(d, (dirs.get(d) || 0) + 1);
      }
    }
    if (list.length < 30) list.push({ sha: c.sha, subj: c.subj, date: c.ad, fix: c.fix, fire: c.fire });
  }
  const emails = [...new Set(model.authors.filter((_, i) => ident.idOf[i] === id).map((a) => a.email))].slice(0, 5);
  return {
    name,
    bot: ident.bot[id],
    aliases: ident.aliases?.[id] || [],
    emails,
    commits,
    merges,
    fixes,
    first,
    last,
    months: [...months.entries()].sort(),
    files: [...files.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([p, n]) => ({ path: model.paths[p], count: n, exists: model.treeSet.has(model.paths[p]) })),
    dirs: [...dirs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    recent: list,
  };
}

/** ⌘K search over all historical paths and contributors. */
export function search(model, q, { identity = 'merged', limit = 12 } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return { files: [], people: [] };
  const ident = identOf(model, identity);
  const files = [];
  for (let i = 0; i < model.paths.length; i++) {
    const p = model.paths[i];
    const lower = p.toLowerCase();
    const at = lower.indexOf(needle);
    if (at < 0) continue;
    const base = lower.slice(lower.lastIndexOf('/') + 1);
    const exists = model.treeSet.has(p);
    const score = (base === needle ? 4000 : base.startsWith(needle) ? 3000 : base.includes(needle) ? 2000 : 0) + (exists ? 1000 : 0) + Math.min(999, model.pathCount[i]);
    files.push({ path: p, count: model.pathCount[i], exists, score });
  }
  files.sort((a, b) => b.score - a.score);
  const counts = new Map();
  for (const c of model.commits) if (!c.merge) counts.set(ident.idOf[c.a], (counts.get(ident.idOf[c.a]) || 0) + 1);
  const people = [];
  ident.names.forEach((n, id) => {
    const hay = [n, ...(ident.aliases?.[id] || [])].join(' ').toLowerCase();
    if (hay.includes(needle)) people.push({ name: n, commits: counts.get(id) || 0, bot: ident.bot[id] });
  });
  people.sort((a, b) => b.commits - a.commits);
  return { files: files.slice(0, limit).map(({ score, ...f }) => f), people: people.slice(0, 6) };
}

/** Compare two reports of the same repo (same identity mode). */
export function diffReports(prev, next) {
  if (!prev || prev.head === next.head) return null;
  const a = new Set(prev.highRisk.map((h) => h.path));
  const b = new Set(next.highRisk.map((h) => h.path));
  return {
    fromHead: prev.head,
    fromAt: prev.generatedAt,
    commits: next.vitals.commits - prev.vitals.commits,
    riskAdded: [...b].filter((p) => !a.has(p)),
    riskRemoved: [...a].filter((p) => !b.has(p)),
    trendFrom: prev.momentum.trend,
    trendTo: next.momentum.trend,
  };
}
