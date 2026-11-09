// 采集层入口：按平台分发实现，对外保持一套函数签名与返回形状。
//
// CPU 采样、核心数、运行时间三样直接走 Node 内置 API，跨平台共用；
// 内存分段、GPU、磁盘、网络、进程、线程交给平台模块。
// 拿不到的指标返回 null，前端渲染成「—」。

import os from 'node:os';
import * as darwin from './darwin.mjs';
import * as win32 from './win32.mjs';

/** 平台实现。win32 之外一律走 macOS 实现，Linux 上命令会失败并逐项返回 null。 */
const impl = process.platform === 'win32' ? win32 : darwin;

/** 进程表行数上限。要高于真实进程数，否则 CPU 排序边界每秒抖动，会被逐笔成交误判成大批进程启停。 */
export const PROC_ROW_CAP = 2000;

let cpuPrev = null;

/**
 * CPU 占用。os.cpus() 的 times 是自开机累计值，取两次差分才是这段时间的占用率。
 * @returns {{total:number, user:number, sys:number, idle:number, cores:number[], work:number}}
 */
export function sampleCpu() {
  const list = os.cpus();
  const now = list.map((c) => ({ ...c.times }));
  const prev = cpuPrev;
  cpuPrev = now;

  const cores = [];
  let dUser = 0, dNice = 0, dSys = 0, dIdle = 0;

  for (let i = 0; i < now.length; i += 1) {
    const p = prev?.[i];
    if (!p) { cores.push(null); continue; }
    const du = Math.max(0, now[i].user - p.user);
    const dn = Math.max(0, now[i].nice - p.nice);
    const ds = Math.max(0, now[i].sys - p.sys);
    const di = Math.max(0, now[i].idle - p.idle);
    const tot = du + dn + ds + di;
    if (tot <= 0) { cores.push(null); continue; }
    cores.push((100 * (tot - di)) / tot);
    dUser += du; dNice += dn; dSys += ds; dIdle += di;
  }

  const tot = dUser + dNice + dSys + dIdle;
  if (!prev || tot <= 0) {
    return { total: null, user: null, sys: null, idle: null, cores: now.map(() => null), work: 0 };
  }
  return {
    total: (100 * (tot - dIdle)) / tot,
    user: (100 * (dUser + dNice)) / tot,
    sys: (100 * dSys) / tot,
    idle: (100 * dIdle) / tot,
    cores,
    work: (dUser + dNice + dSys) / 1000,
  };
}

export const coreCount = () => os.cpus().length;
export const uptimeHours = () => os.uptime() / 3600;

export const loadAvg = () => impl.loadAvg();
export const sampleMem = () => impl.sampleMem();
export const sampleGpu = () => impl.sampleGpu();
export const sampleThermal = () => impl.sampleThermal();
export const sampleDiskRaw = () => impl.sampleDiskRaw();
export const sampleNetRaw = () => impl.sampleNetRaw();
export const sampleThreadRows = () => impl.sampleThreadRows();
export const sampleProcs = (intervalMs) => impl.sampleProcs(PROC_ROW_CAP, intervalMs);

/** 释放平台资源。Windows 的常驻采集进程在这里回收，必须在 2 秒内返回。 */
export const disposeProbes = () => impl.dispose?.() ?? Promise.resolve();
