// macOS 采集实现。内存分段走 vm_stat，GPU 与磁盘走 ioreg，网络走 netstat，进程走 ps。

import os from 'node:os';
import { num, run } from './util.mjs';

export const loadAvg = () => os.loadavg();

// ---------------------------------------------------------------- 内存

export async function sampleMem() {
  const totalBytes = os.totalmem();
  const out = await run('vm_stat', []);
  if (!out) return { totalGiB: totalBytes / 2 ** 30, pct: null };

  const pageSize = num(/page size of (\d+) bytes/.exec(out)?.[1]) ?? 4096;
  const page = (label) => num(new RegExp(label + ':\\s+(\\d+)').exec(out)?.[1]);

  const toGiB = (pages) => (pages == null ? null : (pages * pageSize) / 2 ** 30);

  const free = page('Pages free');
  const active = page('Pages active');
  const inactive = page('Pages inactive');
  const wired = page('Pages wired down');
  const purgeable = page('Pages purgeable');
  const compressed = page('Pages occupied by compressor');

  // 活动监视器口径：活动 + 联动 + 压缩，扣除可清除部分
  const usedPages =
    active == null || wired == null
      ? null
      : active + wired + (compressed ?? 0) - (purgeable ?? 0);

  return {
    totalGiB: totalBytes / 2 ** 30,
    pct: usedPages == null ? null : (usedPages * pageSize * 100) / totalBytes,
    // 三段槽位依次对应 300002 / 300003 / 300006，macOS 填活动页、联动页、压缩页
    segments: [toGiB(active), toGiB(wired), toGiB(compressed)],
    free: toGiB(free),
    extra: toGiB(inactive),
    purgeableMiB: purgeable == null ? null : (purgeable * pageSize) / 2 ** 20,
  };
}

// ---------------------------------------------------------------- GPU

export async function sampleGpu() {
  const out = await run('ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'AGXAccelerator']);
  if (!out) return null;
  // 只取 PerformanceStatistics，避开体积巨大的 IOReportLegend
  const m = /"PerformanceStatistics"\s*=\s*\{([^}]*)\}/.exec(out);
  if (!m) return null;
  const body = m[1];
  const pick = (key) => num(new RegExp('"' + key + '"=(\\d+)').exec(body)?.[1]);

  const device = pick('Device Utilization %');
  const renderer = pick('Renderer Utilization %');
  const tiler = pick('Tiler Utilization %');
  const inUse = pick('In use system memory');
  const alloc = pick('Alloc system memory');
  if (device == null && inUse == null) return null;

  return {
    device,
    renderer,
    tiler,
    vramUsedGiB: inUse == null ? null : inUse / 2 ** 30,
    vramAllocGiB: alloc == null ? null : alloc / 2 ** 30,
  };
}

// ---------------------------------------------------------------- 温度

// Apple Silicon 的 GPU 温度与功耗要走 IOReport，读取需要特权 helper；
// CPU 温度要从 SMC 键读，Node 里没有原生模块也拿不到。
// 这条路径上三项恒为空，页面显示「—」。
export async function sampleThermal() {
  return { gpuTempC: null, gpuPowerW: null, zoneTempC: null };
}

// ---------------------------------------------------------------- 磁盘

export async function sampleDiskRaw() {
  const out = await run('ioreg', ['-c', 'IOBlockStorageDriver', '-r', '-w', '0']);
  if (!out) return null;
  const grab = (key) => {
    const re = new RegExp('"' + key + '"=(\\d+)', 'g');
    let sum = 0, hit = false, mm;
    while ((mm = re.exec(out)) !== null) { sum += Number(mm[1]); hit = true; }
    return hit ? sum : null;
  };
  const read = grab('Bytes \\(Read\\)') ?? 0;
  const write = grab('Bytes \\(Write\\)') ?? 0;
  const opR = grab('Operations \\(Read\\)') ?? 0;
  const opW = grab('Operations \\(Write\\)') ?? 0;
  if (read <= 0 && write <= 0) return null;
  return { read, write, opR, opW };
}

// ---------------------------------------------------------------- 网络

export async function sampleNetRaw() {
  const out = await run('netstat', ['-ibn']);
  if (!out) return null;
  const lines = out.split('\n');
  let best = null, bestBytes = -1;
  for (const line of lines) {
    // 只统计 <Link#> 行，跳过每个接口的地址重复行
    if (!/\<Link#/.test(line)) continue;
    const f = line.trim().split(/\s+/);
    if (f.length < 10) continue;
    const name = f[0];
    if (name === 'lo0') continue;
    const ib = num(f[6]);
    const ob = num(f[9]);
    if (ib == null || ob == null) continue;
    const total = ib + ob;
    // 选累计流量最大的活动接口，避免把闲置的 en1/en4 当成主网卡
    if (total > bestBytes) { bestBytes = total; best = { name, ib, ob, ip: num(f[4]), op: num(f[7]) }; }
  }
  return best;
}

// ---------------------------------------------------------------- 进程

/** 取路径的最后一段作为进程名 */
function basename(p) {
  const clean = String(p).replace(/\s*\(.*\)\s*$/, '');
  const seg = clean.split('/');
  return seg[seg.length - 1] || clean;
}

export async function sampleProcs(cap) {
  const out = await run('ps', ['-Ao', 'pid,ppid,user,pcpu,pmem,rss,state,etime,comm', '-r']);
  if (!out) return [];
  const lines = out.split('\n').slice(1);
  const rows = [];
  for (const line of lines) {
    const f = line.trim().split(/\s+/);
    if (f.length < 9) continue;
    const [pid, ppid, user, pcpu, pmem, rss, state, etime, ...rest] = f;
    const command = rest.join(' ');
    rows.push({
      pid: num(pid),
      ppid: num(ppid),
      user,
      cpu: num(pcpu) ?? 0,
      mem: num(pmem) ?? 0,
      rss: num(rss) ?? 0,
      state,
      etime,
      // 进程在 ps 遍历期间就退出时，COMM 会是空串
      name: basename(command) || '未命名进程',
      command,
    });
    if (rows.length >= cap) break;
  }
  return rows;
}

// ---------------------------------------------------------------- 线程

// kern.num_tasks 与 kern.num_taskthreads 在 macOS 上是静态上限：实测两键同为 6144，
// 与 kern.maxproc(6000)、kern.maxprocperuid(4000) 均不同，且永不变化，涨跌恒为 0。
// 实时线程数只能靠 ps -M —— 它给每个线程输出一行，整表行数减去进程数即线程总数。
export async function sampleThreadRows() {
  const out = await run('ps', ['-axM']);
  if (!out) return null;
  const rows = out.split('\n').length - 1;
  return rows > 0 ? rows : null;
}
