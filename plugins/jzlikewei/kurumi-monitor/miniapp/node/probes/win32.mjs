// Windows 采集实现。
//
// 采集本身跑在一个常驻 PowerShell 进程里：脚本启动时预建全部计数器对象，
// 之后每轮只读 RawValue / NextValue 并输出一行 JSON。
// 这样绕开了 Get-Counter 每次枚举 1 到 4 秒的开销，
// 也避免了每秒拉起六次 powershell.exe 把被测机器的 CPU 吃掉。

import { spawn } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./collector.ps1', import.meta.url));

/** 第一帧最多等这么久。拿不到就降级成全 null，让界面显示「—」而不是卡住 */
const FIRST_FRAME_TIMEOUT = 15_000;
/** 采集进程意外退出后的重启次数上限 */
const MAX_RESTARTS = 5;

let child = null;
let buffer = '';
let latest = null;
let ready = null;
let restarts = 0;
let disposed = false;
let intervalMs = 1000;

// 进程 CPU 是开机以来的累计秒，靠两次采样差分换算成占用率
let prevCpu = new Map();
// 处理器队列长度是瞬时值，1 分取原值，5 分与 15 分走指数平滑
let load5 = 0;
let load15 = 0;
let loadAt = 0;

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function launch() {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };

    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
       '-File', SCRIPT, '-IntervalMs', String(intervalMs)],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    child = ps;

    const timer = setTimeout(done, FIRST_FRAME_TIMEOUT);

    ps.stdout.setEncoding('utf8');
    ps.stdout.on('data', (chunk) => {
      buffer += chunk;
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        const frame = parseLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        if (frame) {
          latest = frame;
          clearTimeout(timer);
          done();
        }
        nl = buffer.indexOf('\n');
      }
      // 采集进程崩了却没换行，缓冲会无限涨
      if (buffer.length > 4 * 1024 * 1024) buffer = '';
    });

    ps.on('error', () => { clearTimeout(timer); child = null; done(); });
    ps.on('exit', () => {
      clearTimeout(timer);
      child = null;
      done();
      if (!disposed && restarts < MAX_RESTARTS) {
        restarts += 1;
        ready = launch();
      }
    });
  });
}

/** 保证采集进程在跑。采样间隔变了要重启，脚本的 param 只在启动时读一次。 */
function ensure(ms) {
  if (ms && ms !== intervalMs) {
    intervalMs = ms;
    stopChild();
    ready = null;
    restarts = 0;
  }
  if (!ready) ready = launch();
  return ready;
}

function stopChild() {
  if (!child) return;
  const ps = child;
  child = null;
  try { ps.kill(); } catch { /* 已经退出 */ }
}

export async function dispose() {
  disposed = true;
  stopChild();
  latest = null;
  ready = null;
  prevCpu.clear();
}

/** 把 [[dd-]hh:]mm:ss 交给 metrics.parseEtime 解析，两个平台的格式保持一致 */
function etimeOf(startedMs, nowMs) {
  if (!startedMs) return '';
  const total = Math.max(0, Math.floor((nowMs - startedMs) / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (d > 0) return d + '-' + pad(h) + ':' + pad(m) + ':' + pad(s);
  if (h > 0) return pad(h) + ':' + pad(m) + ':' + pad(s);
  return pad(m) + ':' + pad(s);
}

// ---------------------------------------------------------------- 各指标

const GiB = 2 ** 30;
const ok = (v) => (typeof v === 'number' && v >= 0 ? v : null);

export const loadAvg = () => {
  const frame = latest;
  if (!frame) return [0, 0, 0];
  const q = ok(frame.queue) ?? 0;
  const now = frame.t;
  if (loadAt && now > loadAt) {
    const dt = now - loadAt;
    load5 += (1 - Math.exp(-dt / 300_000)) * (q - load5);
    load15 += (1 - Math.exp(-dt / 900_000)) * (q - load15);
  } else {
    load5 = q;
    load15 = q;
  }
  loadAt = now;
  return [q, load5, load15];
};

export async function sampleMem() {
  await ensure();
  const m = latest?.mem;
  const totalBytes = ok(m?.total) ?? os.totalmem();
  const totalGiB = totalBytes / GiB;
  const avail = ok(m?.avail);
  const standby = [m?.sbCore, m?.sbNorm, m?.sbRes].every((v) => ok(v) != null)
    ? (m.sbCore + m.sbNorm + m.sbRes) / GiB
    : null;
  // 任务管理器口径：使用中 = 总量 − 可用；可用 = 空闲 + 待机
  const inUse = avail == null ? null : (totalBytes - avail) / GiB;
  return {
    totalGiB,
    pct: avail == null ? null : ((totalBytes - avail) * 100) / totalBytes,
    segments: [inUse, ok(m?.mod) == null ? null : m.mod / GiB, standby],
    free: ok(m?.free) == null ? null : m.free / GiB,
    extra: ok(m?.cache) == null ? null : m.cache / GiB,
    purgeableMiB: null,
  };
}

export async function sampleGpu() {
  await ensure();
  const g = latest?.gpu;
  if (!g || ok(g.device) == null) return null;
  return {
    device: g.device,
    renderer: ok(g.render),
    tiler: ok(g.tiler),
    vramUsedGiB: ok(g.vramUsed) == null ? null : g.vramUsed / GiB,
    vramAllocGiB: ok(g.vramAlloc) == null ? null : g.vramAlloc / GiB,
  };
}

/**
 * 温度与功耗。GPU 读数来自 NVIDIA 驱动，热区来自 ACPI，
 * 两者都只在每 5 轮的整类查询里刷新，中间几轮沿用缓存值。
 * 没有 N 卡或机器不暴露热区时，对应字段为 null。
 */
export async function sampleThermal() {
  await ensure();
  const g = latest?.gpu;
  return { gpuTempC: ok(g?.temp), gpuPowerW: ok(g?.power), zoneTempC: ok(g?.zone) };
}

export async function sampleDiskRaw() {
  await ensure();
  const d = latest?.disk;
  if (!d || ok(d.read) == null) return null;
  return { read: d.read, write: ok(d.write) ?? 0, opR: ok(d.opR) ?? 0, opW: ok(d.opW) ?? 0 };
}

export async function sampleNetRaw() {
  await ensure();
  const n = latest?.net;
  if (!n || ok(n.ib) == null) return null;
  return { name: n.name || '网卡', ib: n.ib, ob: ok(n.ob) ?? 0, ip: ok(n.ip) ?? 0, op: ok(n.op) ?? 0 };
}

export async function sampleThreadRows() {
  await ensure();
  return ok(latest?.threads);
}

export async function sampleProcs(cap, ms) {
  await ensure(ms);
  const frame = latest;
  if (!frame) return [];

  const now = frame.t;
  const totalMem = ok(frame.mem?.total) ?? os.totalmem();
  const cores = os.cpus().length || 1;
  const prev = prevCpu;
  const next = new Map();
  const rows = [];

  for (const p of frame.procs) {
    if (!p.pid || !p.name) continue;
    next.set(p.pid, { cpu: p.cpu, t: now });
    const before = prev.get(p.pid);
    // 累计 CPU 秒的差分除以时间差与核心数，得到与 ps pcpu 同口径的占用率
    const cpu = before && now > before.t
      ? Math.max(0, ((p.cpu - before.cpu) * 1000) / (now - before.t) / cores * 100)
      : 0;
    rows.push({
      pid: p.pid,
      ppid: 0,
      user: '',
      cpu,
      mem: totalMem > 0 ? (p.rss * 100) / totalMem : 0,
      rss: Math.round(p.rss / 1024),
      state: '',
      etime: etimeOf(p.st, now),
      name: p.name,
      command: p.name,
    });
    if (rows.length >= cap) break;
  }

  prevCpu = next;
  return rows;
}
