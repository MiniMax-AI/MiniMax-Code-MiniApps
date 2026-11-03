// 本机大盘 · Node 运行时
// 职责：采样循环、tick 持久化、HTTP 路由、SSE 广播、进程清仓校验

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import { extname, join, normalize, sep } from 'node:path';

import {
  coreCount, disposeProbes, loadAvg, sampleCpu, sampleDiskRaw, sampleGpu, sampleMem,
  sampleNetRaw, sampleProcs, sampleThermal, sampleThreadRows, PROC_ROW_CAP, uptimeHours,
} from './probes/index.mjs';
import {
  buildCatalog, DEFAULT_CODE, INDEX_CODES, MEM_SEGMENTS, PERIODS, SAMPLE_TIERS,
  parseEtime, procCode, procMetaOf, WATCH_MAX,
} from './metrics.mjs';
import { Store } from './store.mjs';
import { aggregate, quotesOf, sparkline, todayStart } from './candles.mjs';

const MAX_BARS = 180;
const MEM_TICK_WINDOW_MS = 4 * 3600_000; // 内存里保留 4 小时采样点
const PROC_HISTORY = 600;                // 尾部进程保留的采样点数
const SSE_PROC_TOP = 50;                  // SSE 每次推送的进程行数
// 进程表按 CPU 排序，用户翻表时先看到的就是 SSE 推的这批。给它们留 1 小时形态，
// 点开任意一个都有完整 K 线；尾部进程保持 10 分钟，省内存。
const HOT_HISTORY = 3600;                 // 热门进程的采样点数（1 小时）
const ALERT_COOLDOWN = 60_000;           // 同类告警的最小间隔

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// 绝不允许清仓的对象：板子自己与它的父进程（MCode 主界面）
const PROTECTED_PIDS = new Set([process.pid, process.ppid, 0, 1]);

/**
 * 能不能向这个进程发信号。signal 0 不投递任何信号，只做权限检查。
 * Windows 上拿不到可靠的进程属主，靠这个探测出来的才是真实能力；
 * macOS 上它与 ps 的 user 字段结论一致，两个平台因此统一到同一个口径。
 */
function canSignal(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

class Hub {
  constructor() {
    this.clients = new Set();
  }
  add(res) {
    this.clients.add(res);
    return () => this.clients.delete(res);
  }
  send(event, data) {
    if (this.clients.size === 0) return;
    const frame = 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
    for (const res of this.clients) {
      try { res.write(frame); } catch { this.clients.delete(res); }
    }
  }
  closeAll() {
    for (const res of this.clients) { try { res.end(); } catch { /* 已断开 */ } }
    this.clients.clear();
  }
  get size() { return this.clients.size; }
}

export async function start(context) {
  const log = context.logger;
  // 采样与事件每小时落盘，48 小时保留下会涨到几十 MB，放系统临时目录由系统清空；
  // 设置只有几 KB，留在 dataDir 让主题与自选跨重启保留。
  const store = new Store(context.dataDir, join(os.tmpdir(), 'kurumi-monitor'));
  await store.init();

  const baseCatalog = buildCatalog(coreCount());
  const byCode = new Map(baseCatalog.map((m) => [m.code, m]));
  const currentUser = os.userInfo().username;

  // 自选进程是动态品种：代码由 pid + 启动时刻构成，只存在于本次运行与设置里。
  // 它们的采样值直接写进同一条 tick 的 v，聚合、今开、均线、持久化全部复用现有链路。
  const watchMeta = new Map();   // code -> 目录项，只装自选进程
  let catalog = baseCatalog;

  function rebuildCatalog() {
    catalog = [...baseCatalog, ...watchMeta.values()];
    return catalog;
  }

  const PROC_CODE_RE = /^P(\d+)-(\d+)$/;

  function parseProcCode(code) {
    const m = PROC_CODE_RE.exec(code);
    return m ? { pid: Number(m[1]), startedAt: Number(m[2]) } : null;
  }

  /**
   * 进程启动时刻。etime 只有秒精度，每条采样现算会让同一个进程在相邻两拍里
   * 得出两个 code，历史被劈成两段。第一次见到某个 pid 时定下来，之后一直复用；
   * 进程消失时丢弃，pid 被系统复用后重新定值，历史自然分段。
   */
  function startedAtOf(proc, nowMs) {
    let s = procStart.get(proc.pid);
    if (s == null) {
      const secs = parseEtime(proc.etime);
      s = secs == null ? Math.floor(nowMs / 1000) : Math.floor(nowMs / 1000) - secs;
      procStart.set(proc.pid, s);
    }
    return s;
  }

  /**
   * 品种的采样序列。自选进程的 CPU 占用在 ticks 里（跨重启连续，4 小时）；
   * 没加自选的进程只有本次运行的内存序列，热门进程 1 小时、尾部进程 10 分钟。
   */
  function seriesFor(code) {
    if (watchMeta.has(code)) return ticks;
    const ref = parseProcCode(code);
    if (!ref) return ticks;
    const hist = procHist.get(ref.pid) ?? [];
    return hist
      .filter((x) => x.s === ref.startedAt)
      .map((x) => ({ t: x.t, v: { [code]: x.c }, w: 0 }));
  }

  const ticks = [];
  const events = [];
  const procHist = new Map();
  const procByPid = new Map();
  const procStart = new Map();   // pid -> 启动秒，稳住品种代码不被 etime 精度带偏
  const alertAt = new Map();

  let prevProcs = new Map();
  let diskPrev = null;
  let netPrev = null;
  let snapshot = null;
  let timer = null;
  let stopped = false;
  const hub = new Hub();

  // ------------------------------------------------ 启动后异步恢复历史
  // start() 只负责装路由 + 起监听。读 4 小时历史是重 IO，必须放到监听就绪之后，
  // 否则 Host 的就绪探测会超时。
  async function restoreHistory() {
    try {
      const restoredEvents = await store.readEvents();
      events.push(...restoredEvents);
      const since = Date.now() - MEM_TICK_WINDOW_MS;
      const restored = await store.readTicks(since);
      ticks.push(...restored);
      // 恢复期间采集循环可能已经写入新 tick，合并后按时间排序并去掉同刻重复
      ticks.sort((a, b) => a.t - b.t);
      const seen = new Set();
      for (let i = ticks.length - 1; i >= 0; i -= 1) {
        if (seen.has(ticks[i].t)) ticks.splice(i, 1);
        else seen.add(ticks[i].t);
      }
      log.info('kurumi.history.restored', { ticks: ticks.length, events: events.length });
    } catch {
      log.warn('kurumi.history.restore_failed', {});
    }
  }

  // ------------------------------------------------ 采样
  async function collect() {
    const t0 = Date.now();

    // CPU 先取差分基准，再并发跑外部命令
    const cpu = sampleCpu();
    const [mem, gpu, thermal, diskRaw, netRaw, procs, threadRows] = await Promise.all([
      sampleMem(), sampleGpu(), sampleThermal(), sampleDiskRaw(), sampleNetRaw(),
      sampleProcs(store.settings.sampleMs), sampleThreadRows(),
    ]);

    const dt = diskPrev ? (t0 - diskPrev.t) / 1000 : 0;
    const nt = netPrev ? (t0 - netPrev.t) / 1000 : 0;

    const disk = diskRaw
      ? {
          readMBs: diskPrev && dt > 0 ? Math.max(0, (diskRaw.read - diskPrev.read) / dt / 2 ** 20) : null,
          writeMBs: diskPrev && dt > 0 ? Math.max(0, (diskRaw.write - diskPrev.write) / dt / 2 ** 20) : null,
          readOps: diskPrev && dt > 0 ? Math.max(0, (diskRaw.opR - diskPrev.opR) / dt) : null,
          writeOps: diskPrev && dt > 0 ? Math.max(0, (diskRaw.opW - diskPrev.opW) / dt) : null,
        }
      : null;
    if (diskRaw) diskPrev = { ...diskRaw, t: t0 };

    const net = netRaw
      ? {
          name: netRaw.name,
          downKBs: netPrev && nt > 0 ? Math.max(0, (netRaw.ib - netPrev.ib) / nt / 1024) : null,
          upKBs: netPrev && nt > 0 ? Math.max(0, (netRaw.ob - netPrev.ob) / nt / 1024) : null,
          downPkt: netPrev && nt > 0 ? Math.max(0, (netRaw.ip - netPrev.ip) / nt) : null,
          upPkt: netPrev && nt > 0 ? Math.max(0, (netRaw.op - netPrev.op) / nt) : null,
        }
      : null;
    if (netRaw) netPrev = { ...netRaw, t: t0 };

    const [l1, l5, l15] = loadAvg();
    const cores = coreCount();

    // ps 两次 spawn 之间存在毫秒级错位，进程表撞到上限时两个计数都不可信，宁可留空
    const procCount = procs.length >= PROC_ROW_CAP ? null : procs.length;
    const threadCount = threadRows && procCount ? Math.max(0, threadRows - procCount) : null;

    const v = {
      '000001': cpu.total, '000002': l1, '000003': l5, '000004': l15,
      '000005': cpu.user, '000006': cpu.sys, '000007': cpu.idle,
      '600001': gpu?.device ?? null, '600002': gpu?.renderer ?? null, '600003': gpu?.tiler ?? null,
      '600004': gpu?.vramUsedGiB ?? null, '600005': gpu?.vramAllocGiB ?? null,
      '700001': thermal.gpuTempC, '700002': thermal.gpuPowerW, '700003': thermal.zoneTempC,
      // 内存三段是定长槽位，两个平台各填自己的分段，指标代码与历史序列保持稳定
      '300001': mem.pct, '300002': mem.segments?.[0], '300003': mem.segments?.[1],
      '300004': mem.free, '300005': mem.extra, '300006': mem.segments?.[2],
      '300007': mem.purgeableMiB,
      '002001': disk?.readMBs ?? null, '002002': disk?.writeMBs ?? null,
      '002003': disk?.readOps ?? null, '002004': disk?.writeOps ?? null,
      '001001': net?.downKBs ?? null, '001002': net?.upKBs ?? null,
      '001003': net?.downPkt ?? null, '001004': net?.upPkt ?? null,
      // 进程数直接取 ps 解析出的行数；线程数是 ps -axM 全表行数减去进程数
      '900001': procCount, '900002': threadCount,
      '900003': cores > 0 ? (l1 / cores) * 100 : null,
      '900004': uptimeHours(),
    };
    cpu.cores.forEach((c, i) => { v['0000' + String(10 + i).padStart(2, '0')] = c; });

    for (const k of Object.keys(v)) if (v[k] == null || !Number.isFinite(v[k])) delete v[k];

    const tick = { t: t0, v, w: cpu.work };

    // ------------------------------------------------ 进程快照与历史
    const now = new Map();
    const rows = [];
    let rank = 0;
    for (const p of procs) {
      if (p.pid == null) continue;
      now.set(p.pid, p);
      // 每轮探测一次，rows 与 /api/procs 共用同一个结论
      p.owned = canSignal(p.pid);
      let hist = procHist.get(p.pid);
      if (!hist) { hist = []; procHist.set(p.pid, hist); }
      const startedAt = startedAtOf(p, t0);
      hist.push({ t: t0, c: p.cpu, s: startedAt });
      // procs 按 CPU 降序，rank 就是用户翻进程表时看到它的先后。
      // 掉出热门名单的进程在这里一次收缩回短历史。
      const cap = rank < SSE_PROC_TOP ? HOT_HISTORY : PROC_HISTORY;
      rank += 1;
      while (hist.length > cap) hist.shift();

      // 自选进程的 CPU 占用并入本条 tick。tick.v 就是 v，改 v 即改 tick，
      // 聚合、今开、均线、落盘全都走同一条链路。
      const meta = procMetaOf(p, startedAt);
      if (watchMeta.has(meta.code) && Number.isFinite(p.cpu)) {
        watchMeta.set(meta.code, meta);  // 进程可能改标题，目录项跟着刷新
        v[meta.code] = p.cpu;
      }

      rows.push({
        pid: p.pid, name: p.name, user: p.user, cpu: p.cpu, mem: p.mem,
        rss: p.rss, state: p.state, etime: p.etime,
        spark: hist.slice(-24).map((x) => x.c),
        code: meta.code,
        watched: watchMeta.has(meta.code),
        owned: p.owned,
        killable: p.owned && !PROTECTED_PIDS.has(p.pid),
      });
    }
    // 清理已退出进程的历史，避免 Map 无限增长
    if (procHist.size > now.size * 3) {
      for (const pid of procHist.keys()) if (!now.has(pid)) procHist.delete(pid);
    }
    for (const pid of procStart.keys()) if (!now.has(pid)) procStart.delete(pid);
    procByPid.clear();
    for (const [pid, p] of now) procByPid.set(pid, p);

    // ------------------------------------------------ 逐笔成交
    const fresh = [];
    const pushEvent = async (ev) => {
      fresh.push(ev);
      events.push(ev);
      if (events.length > 500) events.shift();
      try { await store.appendEvent(ev); } catch { /* 事件落盘失败不阻断采样 */ }
    };

    const hhmmss = new Date(t0).toTimeString().slice(0, 8);
    const selfPid = process.pid;
    if (prevProcs.size > 0) {
      const started = [];
      const exited = [];
      // 采集命令由本进程派生，每秒都会启停。不排除的话逐笔成交全是自己的 ps / ioreg
      for (const [pid, proc] of now) {
        if (!prevProcs.has(pid) && proc.ppid !== selfPid) started.push(proc);
      }
      for (const [pid, proc] of prevProcs) {
        if (!now.has(pid) && proc.ppid !== selfPid) exited.push(proc);
      }

      // 报具体进程名与 PID，最多 3 条，其余汇总成一条
      for (const proc of started.slice(0, 3)) {
        await pushEvent({ t: t0, time: hhmmss, kind: 'start', label: '启动 · ' + proc.name, value: String(proc.pid), up: true });
      }
      if (started.length > 3) {
        await pushEvent({ t: t0, time: hhmmss, kind: 'start', label: '其余进程启动', value: '+' + (started.length - 3), up: true });
      }
      for (const proc of exited.slice(0, 3)) {
        await pushEvent({ t: t0, time: hhmmss, kind: 'exit', label: '退出 · ' + proc.name, value: String(proc.pid), up: false });
      }
      if (exited.length > 3) {
        await pushEvent({ t: t0, time: hhmmss, kind: 'exit', label: '其余进程退出', value: '-' + (exited.length - 3), up: false });
      }
    }

    const alerts = [
      ['000001', 88, 'CPU 占用'], ['600001', 92, 'GPU 占用'], ['300001', 90, '内存占用'],
      ['700001', 85, 'GPU 温度'], ['700003', 80, '热区温度'],
    ];
    for (const [code, limit, label] of alerts) {
      const val = v[code];
      if (val == null || val < limit) continue;
      const last = alertAt.get(code) ?? 0;
      if (t0 - last < ALERT_COOLDOWN) continue;
      alertAt.set(code, t0);
      await pushEvent({
        t: t0, time: hhmmss, kind: 'alert', code,
        label: label + ' 突破 ' + limit, value: val.toFixed(1) + '%', up: true,
      });
    }

    prevProcs = now;

    // ------------------------------------------------ 落盘与内存窗口
    ticks.push(tick);
    while (ticks.length && ticks[0].t < t0 - MEM_TICK_WINDOW_MS) ticks.shift();
    try { await store.appendTick(tick); } catch (e) { log.warn('kurumi.tick.persist_failed', {}); }

    const top = rows.slice(0, SSE_PROC_TOP);
    snapshot = {
      t: t0,
      net: net ? { name: net.name } : null,
      gpuAvailable: gpu != null,
      diskAvailable: disk != null,
      cores,
      totalMemGiB: mem.totalGiB,
      procs: top,
      procCount: rows.length,
    };

    hub.send('tick', { tick, snapshot, events: fresh });
  }

  function schedule() {
    if (stopped) return;
    const ms = store.settings.sampleMs ?? 1000;
    timer = setTimeout(async () => {
      if (stopped) return;
      try {
        if (store.settings.running !== false) await collect();
      } catch (e) {
        log.warn('kurumi.sample.failed', { msg: String(e?.message ?? e).slice(0, 120) });
      }
      schedule();
    }, ms);
    if (timer.unref) timer.unref();
  }

  // ------------------------------------------------ 清仓校验
  function validateKill(pid) {
    if (!Number.isInteger(pid) || pid <= 1) return { ok: false, reason: 'invalid_pid' };
    if (PROTECTED_PIDS.has(pid)) return { ok: false, reason: 'protected' };
    const p = procByPid.get(pid);
    if (!p) return { ok: false, reason: 'not_found' };
    if (!canSignal(pid)) return { ok: false, reason: 'not_owned' };
    return { ok: true, proc: p };
  }

  for (const m of Array.isArray(store.settings.watchProcs) ? store.settings.watchProcs : []) {
    if (m && typeof m.code === 'string' && parseProcCode(m.code)) watchMeta.set(m.code, m);
  }
  rebuildCatalog();

  // ------------------------------------------------ HTTP
  const clientRoot = join(context.pluginRoot, 'miniapp', 'client');

  async function serveStatic(pathname, res) {
    const rel = normalize(pathname).replace(/^([/\\])+/, '');
    if (!rel || rel.split(/[/\\]/).includes('..')) {
      res.writeHead(404).end();
      return;
    }
    const abs = join(clientRoot, rel);
    if (!abs.startsWith(clientRoot + sep) && abs !== clientRoot) {
      res.writeHead(404).end();
      return;
    }
    try {
      const buf = await readFile(abs);
      res.writeHead(200, { 'content-type': MIME[extname(abs)] ?? 'application/octet-stream' });
      res.end(buf);
    } catch {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
    }
  }

  function json(res, code, body) {
    const payload = JSON.stringify(body);
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) });
    res.end(payload);
  }

  async function readBody(req, limit = 64 * 1024) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > limit) throw new Error('body_too_large');
      chunks.push(c);
    }
    if (!chunks.length) return {};
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }

  const httpServer = createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url ?? '/', 'http://miniapp.local');
    } catch {
      json(res, 400, { error: 'bad_request' });
      return;
    }
    const p = url.pathname;

    try {
      if (req.method === 'GET' && p === '/board') { await serveStatic('index.html', res); return; }

      if (req.method === 'GET' && p === '/api/bootstrap') {
        const period = PERIODS[store.settings.periodIndex] ?? PERIODS[1];
        const saved = store.settings.selectedCode;
        const code = byCode.has(saved) || parseProcCode(saved) ? saved : DEFAULT_CODE;
        json(res, 200, {
          catalog: rebuildCatalog(), watchCodes: [...watchMeta.keys()], watchMax: WATCH_MAX,
          boards: true, indexCodes: INDEX_CODES, periods: PERIODS,
          memSegments: MEM_SEGMENTS,
          sampleTiers: SAMPLE_TIERS, maxBars: MAX_BARS,
          settings: store.settings, currentUser,
          host: { cores: coreCount(), platform: process.platform, arch: process.arch },
          snapshot, events: events.slice(-120),
          usage: await store.usage(),
          candles: await packCandles(code, period.seconds),
          todayStart: todayStart(),
        });
        return;
      }

      if (req.method === 'GET' && p === '/api/candles') {
        const code = url.searchParams.get('code') ?? DEFAULT_CODE;
        const seconds = Number(url.searchParams.get('period') ?? 5);
        if (!byCode.has(code) && !parseProcCode(code)) { json(res, 400, { error: 'unknown_code' }); return; }
        json(res, 200, await packCandles(code, seconds));
        return;
      }

      if (req.method === 'GET' && p === '/api/procs') {
        const q = (url.searchParams.get('q') ?? '').toLowerCase();
        const all = [];
        for (const [, p2] of procByPid) {
          if (q && !p2.name.toLowerCase().includes(q) && String(p2.pid) !== q) continue;
          const hist = procHist.get(p2.pid) ?? [];
          const code = procMetaOf(p2, startedAtOf(p2, Date.now())).code;
          all.push({
            pid: p2.pid, name: p2.name, user: p2.user, cpu: p2.cpu, mem: p2.mem,
            rss: p2.rss, state: p2.state, etime: p2.etime,
            spark: hist.slice(-24).map((x) => x.c),
            code,
            watched: watchMeta.has(code),
            owned: p2.owned === true,
            killable: p2.owned === true && !PROTECTED_PIDS.has(p2.pid),
          });
        }
        all.sort((a, b) => b.cpu - a.cpu);
        json(res, 200, { procs: all.slice(0, 400), total: all.length });
        return;
      }

      if (req.method === 'GET' && p === '/api/stream') {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
        });
        res.write('retry: 2000\n\n');
        const off = hub.add(res);
        req.on('close', off);
        // 只给这条新连接补一帧，不能广播给已连接的页面
        const last = ticks[ticks.length - 1];
        if (last) {
          res.write('event: tick\ndata: ' + JSON.stringify({ tick: last, snapshot, events: [] }) + '\n\n');
        }
        return;
      }

      if (req.method === 'POST' && p === '/api/settings') {
        const body = await readBody(req);
        const patch = {};
        if (['auto', 'dark', 'light'].includes(body.theme)) patch.theme = body.theme;
        if (['redUp', 'greenUp'].includes(body.colorScheme)) patch.colorScheme = body.colorScheme;
        if (typeof body.selectedCode === 'string' && (byCode.has(body.selectedCode) || parseProcCode(body.selectedCode))) {
          patch.selectedCode = body.selectedCode;
        }
        if (Number.isInteger(body.periodIndex) && body.periodIndex >= 0 && body.periodIndex < PERIODS.length) patch.periodIndex = body.periodIndex;
        if (SAMPLE_TIERS.includes(body.sampleMs)) patch.sampleMs = body.sampleMs;
        if (['cpu', 'mem', 'rss', 'pid', 'name'].includes(body.sortKey)) patch.sortKey = body.sortKey;
        if (['asc', 'desc'].includes(body.sortDir)) patch.sortDir = body.sortDir;
        if (Number.isInteger(body.retentionHours) && body.retentionHours >= 1 && body.retentionHours <= 720) patch.retentionHours = body.retentionHours;
        if (typeof body.running === 'boolean') patch.running = body.running;
        const saved = await store.saveSettings(patch);
        json(res, 200, { settings: saved });
        return;
      }

      if (req.method === 'POST' && p === '/api/kill') {
        const body = await readBody(req);
        const pid = Number(body.pid);
        const check = validateKill(pid);
        if (!check.ok) { json(res, 403, { error: check.reason }); return; }
        const signal = body.force === true ? 'SIGKILL' : 'SIGTERM';
        try {
          process.kill(pid, signal);
        } catch (e) {
          const code = e?.code === 'EPERM' ? 'not_permitted' : e?.code === 'ESRCH' ? 'gone' : 'kill_failed';
          json(res, 403, { error: code });
          return;
        }
        json(res, 200, { ok: true, pid, signal, name: check.proc.name });
        return;
      }

      if (req.method === 'POST' && p === '/api/watch') {
        const body = await readBody(req);
        const code = String(body.code ?? '');
        const ref = parseProcCode(code);
        if (!ref) { json(res, 400, { error: 'bad_code' }); return; }

        if (body.op === 'remove') {
          watchMeta.delete(code);
        } else {
          if (!watchMeta.has(code) && watchMeta.size >= WATCH_MAX) {
            json(res, 409, { error: 'watch_full', max: WATCH_MAX });
            return;
          }
          const live = procByPid.get(ref.pid);
          watchMeta.set(code, procMetaOf(
            live ?? { pid: ref.pid, name: String(body.name ?? '未知进程'), user: String(body.user ?? '') },
            ref.startedAt,
          ));
        }
        rebuildCatalog();
        await store.saveSettings({ watchProcs: [...watchMeta.values()] });
        json(res, 200, { catalog, watchCodes: [...watchMeta.keys()] });
        return;
      }

      if (req.method === 'POST' && p === '/api/kill/preflight') {
        const body = await readBody(req);
        const check = validateKill(Number(body.pid));
        json(res, 200, check.ok
          ? { ok: true, pid: Number(body.pid), name: check.proc.name, user: check.proc.user, cpu: check.proc.cpu, rss: check.proc.rss }
          : { ok: false, reason: check.reason });
        return;
      }

      if (p.startsWith('/assets/')) { await serveStatic(p.slice('/assets/'.length), res); return; }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
    } catch (e) {
      const msg = String(e?.message ?? e);
      json(res, msg === 'body_too_large' ? 413 : 500, { error: 'server_error' });
      log.warn('kurumi.request.failed', { path: p, msg: msg.slice(0, 120) });
    }
  });

  async function packCandles(code, seconds) {
    const series = seriesFor(code);
    // 副图内存是全局量，进程品种的 series 里没有这些字段，统一从主 tick 序列取
    const agg = aggregate(series, code, seconds, MAX_BARS, ticks);
    // 一次遍历算出全部品种的品种头，自选列表每行都要用
    const quotes = quotesOf(ticks, catalog.map((m) => m.code));
    const ref = parseProcCode(code);
    return {
      code, period: seconds,
      meta: byCode.get(code) ?? watchMeta.get(code) ?? null,
      // 副图柱高按总内存归一化，柱子高度直接就是内存水位
      memTotalGiB: snapshot?.totalMemGiB ?? null,
      bars: agg.bars, ma5: agg.ma5, ma10: agg.ma10, ma20: agg.ma20,
      // 非自选进程的采样值不在 ticks 里，品种头只能现算
      quote: quotes[code] ?? (ref ? quotesOf(series, [code])[code] ?? null : null),
      // 进程退出后历史还在，但不该假装它还在跳
      alive: ref ? procByPid.has(ref.pid) : true,
      watched: watchMeta.has(code),
      quotes,
      index: INDEX_CODES.map((c) => ({
        code: c,
        meta: byCode.get(c) ?? null,
        quote: quotes[c] ?? null,
        spark: sparkline(ticks, c, 48),
      })),
    };
  }

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(context.listen.port, context.listen.host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  // 路由装好、监听就绪后再启动采样与历史恢复，不在 start 里同步拉数据
  schedule();
  void restoreHistory();
  log.info('kurumi.runtime.listening', { port: context.listen.port, cores: coreCount() });

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    stopped = true;
    if (timer) clearTimeout(timer);
    context.signal.removeEventListener('abort', onAbort);
    hub.closeAll();
    await disposeProbes();
    await new Promise((resolve) => httpServer.close(() => resolve()));
  };
  const onAbort = () => { void dispose(); };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  return { dispose };
}
