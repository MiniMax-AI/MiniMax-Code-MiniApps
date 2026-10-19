// @ts-check
import { execFile } from 'node:child_process';
import { constants as fsc } from 'node:fs';
import { access, chmod, readFile, readdir, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

import { ALGO_VERSION, buildModel, buildReport, diffReports, fileDetail, personDetail, search } from './analyze.mjs';
import { buildDescs, mapView, pickDescFiles } from './codemap.mjs';
import { GitError, HOST_RE, children, git, netEnv, parseTarget, prefetchBlobs, readBlobs, syncRemote } from './git.mjs';
import { buildTechStack, pickManifests } from './techstack.mjs';
import { readJson, writeJsonAtomic } from './util.mjs';

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */
/** @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle */

const CLIENT_FILES = {
  '/assets/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/assets/charts.js': ['charts.js', 'text/javascript; charset=utf-8'],
  '/assets/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/assets/icon.svg': ['icon.svg', 'image/svg+xml'],
};
const ID_RE = /^[rl]-[0-9a-f]{12}$/;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * The Host header must name this machine (a DNS-rebound name is refused), and a browser Origin,
 * when sent, must be this listener: http, a loopback host, and our port. The page is same-origin.
 * @param {import('node:http').IncomingMessage} req
 * @param {number} port
 */
function isLoopbackRequest(req, port) {
  const host = req.headers.host;
  if (host !== undefined && !LOOPBACK_HOSTS.has(hostnameOf(host))) return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false; // includes "null" (sandboxed iframes, file://)
  }
  const originPort = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(hostnameOf(url.host)) && originPort === port;
}

/** @param {string} hostHeader */
function hostnameOf(hostHeader) {
  const h = hostHeader.trim().toLowerCase();
  const bracketed = /^\[([^\]]*)\]/.exec(h);
  if (bracketed) return bracketed[1];
  const colon = h.lastIndexOf(':');
  return colon === -1 ? h : h.slice(0, colon);
}

/**
 * @param {MiniAppContext} context
 * @returns {Promise<MiniAppLifecycle>}
 */
export async function start(context) {
  const { dataDir, logger: log } = context;
  const clientDir = join(context.pluginRoot, 'miniapp/client');
  const configFile = join(dataDir, 'config.json');
  /** @type {{ repos: any[], settings: { proxy: string, tokens: Record<string,string> } }} */
  const config = { repos: [], ...(await readJson(configFile, {})) };
  config.repos ??= [];
  config.settings = { proxy: '', tokens: {}, scanRoots: null, ...(config.settings || {}) };
  // Files written by earlier versions used the default mode; tighten an existing config now.
  await chmod(configFile, 0o600).catch(() => {});
  const saveConfig = () => writeJsonAtomic(configFile, config);
  const repoDir = (id) => join(dataDir, 'repos', `${id}.git`);
  const reportFile = (id) => join(dataDir, 'reports', `${id}.json`);

  // ---------------------------------------------------------------------------
  // Proxy + credentials (tokens never leave this process)
  // ---------------------------------------------------------------------------
  let proxy = { url: '', origin: 'none' };
  async function resolveProxy() {
    const env = process.env;
    let url = config.settings.proxy || '';
    let origin = url ? 'settings' : 'none';
    if (!url && (url = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || '')) origin = 'env';
    if (!url && process.platform === 'darwin') {
      try {
        const out = await runOut('/usr/sbin/scutil', ['--proxy']);
        const get = (k) => out.match(new RegExp(`\\b${k}\\s*:\\s*(\\S+)`))?.[1];
        if (get('HTTPSEnable') === '1' && get('HTTPSProxy')) {
          url = `http://${get('HTTPSProxy')}:${get('HTTPSPort')}`;
          origin = 'system';
        }
      } catch {}
    }
    proxy = { url, origin };
  }

  const binCache = new Map();
  async function findBin(name) {
    if (binCache.has(name)) return binCache.get(name);
    const dirs = [...(process.env.PATH || '').split(delimiter), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', join(homedir(), '.local/bin'), join(homedir(), '.local/share/mise/shims')].filter(Boolean);
    for (const d of dirs) {
      for (const ext of process.platform === 'win32' ? ['.exe', '.cmd', ''] : ['']) {
        try {
          await access(join(d, name + ext), fsc.X_OK);
          binCache.set(name, join(d, name + ext));
          return join(d, name + ext);
        } catch {}
      }
    }
    binCache.set(name, null);
    return null;
  }
  function runOut(cmd, args) {
    return new Promise((resolve, reject) => {
      const child = execFile(cmd, args, { timeout: 10_000, maxBuffer: 1 << 20, windowsHide: true }, (err, stdout) => {
        children.delete(child);
        err ? reject(err) : resolve(String(stdout).trim());
      });
      children.add(child);
    });
  }
  async function glabHosts() {
    const files = [process.env.GLAB_CONFIG_DIR && join(process.env.GLAB_CONFIG_DIR, 'config.yml'), join(homedir(), '.config', 'glab-cli', 'config.yml'), join(homedir(), 'Library', 'Application Support', 'glab-cli', 'config.yml')].filter(Boolean);
    for (const f of files) {
      let text = '';
      try {
        text = await readFile(/** @type {string} */ (f), 'utf8');
      } catch {
        continue;
      }
      const hosts = new Set();
      let inHosts = false;
      for (const line of text.split('\n')) {
        if (/^hosts:\s*$/.test(line)) {
          inHosts = true;
          continue;
        }
        if (inHosts && /^\S/.test(line)) inHosts = false;
        const m = inHosts && line.match(/^ {2,4}([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+):\s*$/i);
        if (m) hosts.add(m[1].toLowerCase());
      }
      if (hosts.size) return hosts;
    }
    return new Set();
  }
  // Hosts gh is logged in to: the top-level keys of its hosts.yml (tokens are not read here).
  async function ghHosts() {
    const env = process.env;
    const dir = env.GH_CONFIG_DIR || (env.XDG_CONFIG_HOME ? join(env.XDG_CONFIG_HOME, 'gh') : join(homedir(), '.config', 'gh'));
    let text = '';
    try {
      text = await readFile(join(dir, 'hosts.yml'), 'utf8');
    } catch {
      return new Set();
    }
    const hosts = new Set();
    for (const line of text.split('\n')) {
      const m = line.match(/^([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+):\s*$/i);
      if (m) hosts.add(m[1].toLowerCase());
    }
    return hosts;
  }
  const tokenCache = new Map();
  /** @returns {Promise<{ token: string, source: string }>} */
  async function credentialFor(host) {
    if (config.settings.tokens[host]) return { token: config.settings.tokens[host], source: 'token' };
    const hit = tokenCache.get(host);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.value;
    let value = { token: '', source: 'none' };
    const gh = await findBin('gh');
    // Only github.com and hosts gh is logged in to: for any other host gh would hand out
    // GH_ENTERPRISE_TOKEN if that is set.
    if (gh && (host === 'github.com' || (await ghHosts()).has(host))) {
      const t = await runOut(gh, ['auth', 'token', '--hostname', host]).catch(() => '');
      if (t) value = { token: t, source: 'gh' };
    }
    if (!value.token) {
      const glab = await findBin('glab');
      if (glab && (await glabHosts()).has(host)) {
        const t = await runOut(glab, ['config', 'get', 'token', '--host', host]).catch(() => '');
        if (t) value = { token: t, source: 'glab' };
      }
    }
    tokenCache.set(host, { value, at: Date.now() });
    return value;
  }

  // ---------------------------------------------------------------------------
  // SSE
  // ---------------------------------------------------------------------------
  const streams = new Set();
  const broadcast = (event, data) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of streams) {
      try {
        res.write(payload);
      } catch {}
    }
  };
  const heartbeat = setInterval(() => broadcast('ping', {}), 25_000);

  // ---------------------------------------------------------------------------
  // Models (LRU) and jobs
  // ---------------------------------------------------------------------------
  const models = new Map();
  const remember = (id, m) => {
    models.delete(id);
    models.set(id, m);
    while (models.size > 3) models.delete(models.keys().next().value);
  };
  const workDirOf = (repo) => (repo.target.kind === 'local' ? repo.target.dir : repoDir(repo.id));
  // One build per repo at a time: the map tab, ⌘K and the file drawer may all ask right after a restart.
  const building = new Map();
  function modelFor(repo, signal) {
    const m = models.get(repo.id);
    if (m) return Promise.resolve(m);
    let p = building.get(repo.id);
    if (!p) {
      p = buildModel(workDirOf(repo), { signal })
        .then((built) => {
          // A sync that finished meanwhile already stored a newer model; keep that one. A repo
          // removed while this was building is not cached again.
          if (!models.has(repo.id) && config.repos.some((r) => r.id === repo.id)) remember(repo.id, built);
          return models.get(repo.id) || built;
        })
        .finally(() => building.delete(repo.id));
      building.set(repo.id, p);
    }
    return p;
  }

  const jobs = new Map();
  const publicJob = (j) => j && { repoId: j.repoId, running: j.running, stage: j.stage, pct: j.pct, detail: j.detail, error: j.error, startedAt: j.startedAt, finishedAt: j.finishedAt || null, steps: j.steps, stageStartedAt: j.stageStartedAt, reportHead: j.reportHead || null };
  let lastTick = 0;
  const tick = (j, force) => {
    if (!force && Date.now() - lastTick < 200) return;
    lastTick = Date.now();
    broadcast('job', publicJob(j));
  };
  let activeNet = 0;
  const netQueue = [];
  const netSlot = async () => {
    if (activeNet >= 2) await new Promise((r) => netQueue.push(r));
    activeNet++;
    return () => {
      activeNet--;
      netQueue.shift()?.();
    };
  };

  async function webBaseFor(repo) {
    if (repo.target.kind === 'remote') return { url: repo.target.webUrl, provider: repo.target.provider };
    try {
      const origin = (await git(['-C', repo.target.dir, 'config', '--get', 'remote.origin.url'], { timeout: 5000 })).trim();
      const t = await parseTarget(origin);
      if (t.kind === 'remote') return { url: t.webUrl, provider: t.provider };
    } catch {}
    return null;
  }

  function startJob(repo) {
    const existing = jobs.get(repo.id);
    if (existing?.running) return existing;
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    context.signal.addEventListener('abort', onAbort, { once: true });
    const job = { repoId: repo.id, running: true, stage: 'queued', pct: 0, detail: '', error: null, startedAt: Date.now(), stageStartedAt: Date.now(), steps: [], reportHead: null, ac, done: /** @type {Promise<void> | null} */ (null) };
    const enter = (stage) => {
      if (job.stage !== 'queued') job.steps.push({ stage: job.stage, ms: Date.now() - job.stageStartedAt });
      job.stage = stage;
      job.stageStartedAt = Date.now();
      job.pct = 0;
      job.detail = '';
      tick(job, true);
    };
    jobs.set(repo.id, job);
    tick(job, true);
    job.done = (async () => {
      const dir = workDirOf(repo);
      let env = {};
      if (repo.target.kind === 'remote') {
        await resolveProxy();
        const cred = await credentialFor(repo.target.host);
        env = netEnv(repo.target, cred.token, proxy.url);
        const release = await netSlot();
        try {
          enter('sync');
          const r = await syncRemote(repo.target, dir, {
            env,
            signal: ac.signal,
            onProgress: ({ phase, pct }) => {
              job.detail = { 'Counting objects': '统计对象', 'Compressing objects': '压缩对象', 'Receiving objects': '下载对象', 'Resolving deltas': '解析增量' }[phase] || phase;
              job.pct = pct;
              tick(job);
            },
          });
          repo.cloned = true;
          if (r.cloned) log.info('repo.cloned', {});
        } finally {
          release();
        }
      }
      enter('analyze');
      const model = await buildModel(dir, {
        signal: ac.signal,
        onProgress: (n) => {
          job.detail = `${n.toLocaleString()} commits`;
          tick(job);
        },
      });
      remember(repo.id, model);
      const prev = await readJson(reportFile(repo.id), null);
      const web = await webBaseFor(repo);
      const out = {
        algo: ALGO_VERSION,
        head: model.head,
        merged: buildReport(model, { identity: 'merged' }),
        raw: buildReport(model, { identity: 'raw' }),
        tech: prev && prev.algo === ALGO_VERSION && prev.head === model.head ? prev.tech : null,
        descs: prev && prev.algo === ALGO_VERSION && prev.head === model.head ? prev.descs || null : null,
        web,
        delta: null,
      };
      if (prev?.merged && prev.algo === ALGO_VERSION) out.delta = diffReports(prev.merged, out.merged);
      else if (prev?.merged) out.delta = prev.head !== model.head ? { fromHead: prev.head, fromAt: prev.merged.generatedAt, commits: out.merged.vitals.commits - (prev.merged.vitals?.commits || 0), riskAdded: [], riskRemoved: [] } : null;
      // Publish the history report first; tech stack fills in afterwards.
      await writeJsonAtomic(reportFile(repo.id), out);
      job.reportHead = model.head;
      repo.lastSync = { at: Date.now(), head: model.head, error: null };
      repo.summary = { commits: out.merged.vitals.commits, latest: out.merged.vitals.latest, risk: out.merged.highRisk.length, trend: out.merged.momentum.trend, spark: out.merged.momentum.months.slice(-12).map((x) => x.n) };
      await saveConfig();
      if (!out.tech || !out.descs) {
        enter('tech');
        // Manifests for the tech stack plus README / manifest files that describe directories.
        const manifests = pickManifests(model.tree);
        const descFiles = pickDescFiles(model.tree);
        const oids = [...new Set([...manifests.map((m) => m.oid), ...descFiles.map((f) => f.oid)])];
        if (repo.target.kind === 'remote') {
          try {
            await prefetchBlobs(dir, oids, { env, signal: ac.signal });
          } catch (e) {
            if (e?.code === 'aborted') throw e;
            log.warn('tech.prefetch_failed', { code: e?.code || 'error' });
          }
        }
        const blobs = await readBlobs(dir, oids, { signal: ac.signal });
        out.tech ??= buildTechStack(model.tree, blobs, manifests);
        out.descs = buildDescs(descFiles, blobs);
        await writeJsonAtomic(reportFile(repo.id), out);
      }
      job.steps.push({ stage: job.stage, ms: Date.now() - job.stageStartedAt });
      job.stage = 'done';
      repo.lastSync = { ...repo.lastSync, ms: Date.now() - job.startedAt, steps: job.steps };
      await saveConfig();
    })()
      .catch(async (e) => {
        job.error = e?.code === 'aborted' ? null : { code: e?.code || 'error', message: e instanceof GitError || e?.code === 'empty' ? e.message : '分析失败' };
        job.stage = e?.code === 'aborted' ? 'cancelled' : 'error';
        if (!(e instanceof GitError)) log.error('job.failed', { reason: String(e?.message || e).slice(0, 160) });
        if (job.error) {
          repo.lastSync = { ...(repo.lastSync || {}), errorAt: Date.now(), error: job.error };
          await saveConfig().catch(() => {});
        }
        if (repo.target.kind === 'remote' && e?.code === 'auth') tokenCache.delete(repo.target.host);
      })
      .finally(() => {
        job.running = false;
        job.finishedAt = Date.now();
        context.signal.removeEventListener('abort', onAbort);
        tick(job, true);
      });
    return job;
  }

  const identityOf = (url) => (url.searchParams.get('identity') === 'raw' ? 'raw' : 'merged');

  // ---------------------------------------------------------------------------
  // Local repository suggestions (read-only scan for .git directories)
  // ---------------------------------------------------------------------------
  const DEFAULT_ROOTS = ['~/Workspace', '~/workspace', '~/code', '~/Code', '~/src', '~/Projects', '~/projects', '~/Developer', '~/dev', '~/repos', '~/GitHub', '~/git'];
  const expand = (p) => (p.startsWith('~') ? join(homedir(), p.slice(1)) : p);
  const scanRoots = () => (config.settings.scanRoots?.length ? config.settings.scanRoots : DEFAULT_ROOTS).map(expand);
  let suggestCache = null;
  async function suggestLocal(refresh) {
    if (!refresh && suggestCache && Date.now() - suggestCache.at < 5 * 60_000) return suggestCache.list;
    const found = new Map();
    const SKIP = new Set(['node_modules', 'vendor', 'dist', 'build', 'target', 'Library', 'Pods']);
    let budget = 4000;
    async function walk(dir, depth) {
      if (budget-- <= 0 || found.size >= 300) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      if (entries.some((e) => e.name === '.git')) {
        let mtime = 0;
        for (const f of ['.git/FETCH_HEAD', '.git/index', '.git/HEAD']) {
          try {
            mtime = Math.max(mtime, (await stat(join(dir, f))).mtimeMs);
          } catch {}
        }
        if (!found.has(dir)) found.set(dir, mtime);
        return;
      }
      if (depth >= 4) return;
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('.') || SKIP.has(e.name)) continue;
        await walk(join(dir, e.name), depth + 1);
      }
    }
    const seen = new Set();
    for (const root of scanRoots()) {
      try {
        const real = await stat(root).then(() => root);
        if (seen.has(real.toLowerCase())) continue;
        seen.add(real.toLowerCase());
        await walk(real, 0);
      } catch {}
    }
    const analyzed = new Set(config.repos.filter((r) => r.target.kind === 'local').map((r) => r.target.dir));
    const list = [...found.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([dir, mtime]) => ({ path: dir.replace(homedir(), '~'), name: dir.split('/').pop(), mtime, analyzed: analyzed.has(dir) }));
    suggestCache = { at: Date.now(), list };
    return list;
  }

  // ---------------------------------------------------------------------------
  // HTTP
  // ---------------------------------------------------------------------------
  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const fail = (res, e) => {
    const code = e?.code || 'error';
    const status = { invalid: 400, not_repo: 400, not_found: 404, conflict: 409 }[code] || (e instanceof GitError ? 502 : 500);
    if (!(e instanceof GitError)) log.error('request.failed', { reason: String(e?.message || e).slice(0, 160) });
    send(res, status, { error: { code, message: e instanceof GitError ? e.message : '内部错误' } });
  };
  async function body(req) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 64 * 1024) throw new GitError('invalid', '请求体过大');
      chunks.push(c);
    }
    if (!chunks.length) return {};
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new GitError('invalid', '请求体不是 JSON');
    }
  }
  const findRepo = (id) => {
    if (!ID_RE.test(id)) throw new GitError('invalid', '仓库 ID 不合法');
    const r = config.repos.find((x) => x.id === id);
    if (!r) throw new GitError('not_found', '仓库不在列表里');
    return r;
  };
  const publicRepo = (r) => ({
    id: r.id,
    name: r.name,
    kind: r.target.kind,
    provider: r.target.kind === 'remote' ? r.target.provider : 'local',
    display: r.target.kind === 'remote' ? `${r.target.host}/${r.target.path}` : r.target.dir.replace(homedir(), '~'),
    webUrl: r.target.kind === 'remote' ? r.target.webUrl : null,
    localDir: r.target.kind === 'local' ? r.target.dir : null,
    addedAt: r.addedAt,
    lastSync: r.lastSync || null,
    summary: r.summary || null,
    job: publicJob(jobs.get(r.id)) || null,
  });
  async function stateBody() {
    await resolveProxy();
    const hosts = [...new Set(config.repos.filter((r) => r.target.kind === 'remote').map((r) => r.target.host))];
    const cred = await Promise.all(hosts.map(async (h) => ({ host: h, source: (await credentialFor(h)).source })));
    return { repos: config.repos.map(publicRepo), settings: { proxy: config.settings.proxy, proxyActive: proxy.origin, hosts: cred, tokenHosts: Object.keys(config.settings.tokens), scanRoots: scanRoots().map((r) => r.replace(homedir(), '~')) } };
  }

  async function handle(req, res) {
    // Every route: the Host names this machine and a browser Origin, if any, is this page.
    if (!isLoopbackRequest(req, context.listen.port)) return send(res, 403, { error: { code: 'forbidden', message: '只接受本机页面的请求' } });
    const url = new URL(req.url ?? '/', 'http://miniapp.local');
    const p = url.pathname;
    const method = req.method || 'GET';
    let m;
    if (method === 'GET' && (p === '/dashboard' || p === '/')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(await readFile(join(clientDir, 'index.html')));
    }
    if (method === 'GET' && CLIENT_FILES[p]) {
      const [f, type] = CLIENT_FILES[p];
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      return res.end(await readFile(join(clientDir, f)));
    }
    if (method === 'GET' && p === '/api/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(': connected\n\n');
      streams.add(res);
      req.on('close', () => streams.delete(res));
      return;
    }
    if (method === 'GET' && p === '/api/state') return send(res, 200, await stateBody());
    if (method === 'POST' && p === '/api/repos') {
      const b = await body(req);
      const target = await parseTarget(b.input);
      let repo = config.repos.find((r) => r.id === target.id);
      if (!repo) {
        repo = { id: target.id, name: target.kind === 'remote' ? target.path : target.name, target, addedAt: Date.now(), lastSync: null };
        config.repos.unshift(repo);
        await saveConfig();
      }
      startJob(repo);
      return send(res, 200, { repo: publicRepo(repo) });
    }
    if ((m = p.match(/^\/api\/repos\/([^/]+)\/sync$/))) {
      const repo = findRepo(m[1]);
      if (method === 'POST') return send(res, 202, { job: publicJob(startJob(repo)) });
      if (method === 'DELETE') {
        jobs.get(repo.id)?.ac.abort();
        return send(res, 200, { ok: true });
      }
    }
    if ((m = p.match(/^\/api\/repos\/([^/]+)$/)) && method === 'DELETE') {
      const repo = findRepo(m[1]);
      config.repos = config.repos.filter((r) => r.id !== repo.id);
      models.delete(repo.id);
      // Let a running job's git exit and the job write its last file before deleting them.
      const job = jobs.get(repo.id);
      job?.ac.abort();
      await job?.done;
      jobs.delete(repo.id);
      await saveConfig();
      // Only Mini App-owned caches are removed; local repositories are never touched.
      await rm(reportFile(repo.id), { force: true });
      if (repo.target.kind === 'remote') await rm(repoDir(repo.id), { recursive: true, force: true });
      return send(res, 200, { ok: true });
    }
    if ((m = p.match(/^\/api\/repos\/([^/]+)\/report$/)) && method === 'GET') {
      const repo = findRepo(m[1]);
      const file = await readJson(reportFile(repo.id), null);
      if (!file?.merged) return send(res, 404, { error: { code: 'no_report', message: '还没有分析结果' } });
      const identity = url.searchParams.get('identity') === 'raw' ? 'raw' : 'merged';
      // A report from an older algorithm is still served (no blank page); the client re-analyzes in the background.
      return send(res, 200, { ...file[identity], tech: file.tech, web: file.web, delta: file.delta, about: file.descs?.[''] || null, stale: file.algo !== ALGO_VERSION });
    }
    if ((m = p.match(/^\/api\/repos\/([^/]+)\/file$/)) && method === 'GET') {
      const repo = findRepo(m[1]);
      const path = url.searchParams.get('path') || '';
      if (!path || path.length > 1000) throw new GitError('invalid', '文件路径不合法');
      const model = await modelFor(repo, AbortSignal.timeout(120_000));
      const d = fileDetail(model, path, { identity: identityOf(url) });
      if (!d) throw new GitError('not_found', '历史里没有这个文件');
      return send(res, 200, d);
    }
    if ((m = p.match(/^\/api\/repos\/([^/]+)\/person$/)) && method === 'GET') {
      const repo = findRepo(m[1]);
      const name = (url.searchParams.get('name') || '').slice(0, 200);
      const model = await modelFor(repo, AbortSignal.timeout(120_000));
      const d = personDetail(model, name, { identity: identityOf(url) });
      if (!d) throw new GitError('not_found', '历史里没有这个贡献者');
      return send(res, 200, d);
    }
    if ((m = p.match(/^\/api\/repos\/([^/]+)\/map$/)) && method === 'GET') {
      const repo = findRepo(m[1]);
      if (!repo.lastSync?.at) throw new GitError('not_found', '还没有分析结果');
      const q = url.searchParams;
      const focus = (q.get('focus') || '').replace(/^\/+|\/+$/g, '');
      if (focus.length > 1000) throw new GitError('invalid', '目录路径不合法');
      const range = ['3', '6', '12', 'all'].includes(q.get('range') || '') ? q.get('range') : 'all';
      const model = await modelFor(repo, AbortSignal.timeout(120_000));
      const file = await readJson(reportFile(repo.id), null);
      const view = mapView(model, {
        focus,
        size: q.get('size') === 'churn' ? 'churn' : 'files',
        range,
        identity: identityOf(url),
        maxBlocks: Math.max(8, Math.min(60, Number(q.get('max')) || 44)),
        risk: new Set((file?.merged?.highRisk || []).map((h) => h.path)),
        descs: file?.descs || {},
      });
      if (!view) throw new GitError('not_found', 'HEAD 中没有这个目录（可能已删除或改名）');
      return send(res, 200, view);
    }
    if ((m = p.match(/^\/api\/repos\/([^/]+)\/search$/)) && method === 'GET') {
      const repo = findRepo(m[1]);
      if (!repo.lastSync?.at) return send(res, 200, { files: [], people: [] });
      const model = await modelFor(repo, AbortSignal.timeout(120_000));
      return send(res, 200, search(model, (url.searchParams.get('q') || '').slice(0, 200), { identity: identityOf(url) }));
    }
    if (method === 'GET' && p === '/api/suggest') return send(res, 200, { repos: await suggestLocal(url.searchParams.get('refresh') === '1') });
    if (method === 'POST' && p === '/api/settings') {
      const b = await body(req);
      if (typeof b.proxy === 'string') {
        const px = b.proxy.trim();
        if (px && !/^(https?|socks5h?):\/\/[^\s]+$/i.test(px)) throw new GitError('invalid', '代理地址应类似 http://127.0.0.1:7890');
        config.settings.proxy = px;
      }
      if (Array.isArray(b.scanRoots)) {
        config.settings.scanRoots = b.scanRoots.map((x) => String(x).trim()).filter(Boolean).slice(0, 10);
        suggestCache = null;
      }
      if (b.token && typeof b.token.host === 'string') {
        const host = b.token.host.trim().toLowerCase();
        if (!HOST_RE.test(host)) throw new GitError('invalid', '主机名不合法');
        const t = String(b.token.value || '').trim();
        if (t) config.settings.tokens[host] = t;
        else delete config.settings.tokens[host];
        tokenCache.delete(host);
      }
      await saveConfig();
      return send(res, 200, await stateBody());
    }
    send(res, 404, { error: { code: 'not_found', message: '接口不存在' } });
  }

  await resolveProxy();
  const server = createServer((req, res) => {
    handle(req, res).catch((e) => (res.headersSent ? res.end() : fail(res, e)));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(context.listen.port, context.listen.host, () => {
      server.off('error', reject);
      resolve(undefined);
    });
  });
  log.info('miniapp.runtime.listening', { proxy: proxy.origin });

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    context.signal.removeEventListener('abort', onAbort);
    clearInterval(heartbeat);
    for (const j of jobs.values()) j.ac?.abort();
    for (const c of children) c.kill('SIGKILL');
    for (const s of streams) {
      try {
        s.end();
      } catch {}
    }
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  };
  const onAbort = () => void dispose();
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();
  return { dispose };
}
