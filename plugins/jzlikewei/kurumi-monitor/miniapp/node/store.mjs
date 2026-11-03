// 持久化：JSONL 按小时分片的 tick 序列 + 事件流 + 设置
// 追加写天然原子；设置走临时文件 + rename。
//
// 采样与事件按小时落盘，48 小时保留下会涨到几十 MB，放系统临时目录，
// 重启后由系统清空。设置只有几 KB 且是用户偏好，留在 dataDir 跨重启保留。

import { createReadStream } from 'node:fs';
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

const HOUR = 3600_000;
const EVENT_KEEP = 500;         // 内存与重启后保留的事件条数（逐笔成交只显示 80 条）
// 事件带要覆盖长周期 K 线：实测约 268 条/分钟，60000 行≈3.7 小时，够 1 分 K 画满 180 根
const EVENT_COMPACT_AT = 60000;

const pad = (n) => String(n).padStart(2, '0');

export function hourKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}`;
}

export const DEFAULT_SETTINGS = {
  theme: 'auto',          // auto | dark | light
  colorScheme: 'redUp',   // redUp(A股红涨) | greenUp(国际绿涨)
  selectedCode: '600001',
  periodIndex: 1,
  sampleMs: 1000,
  sortKey: 'cpu',
  sortDir: 'desc',
  retentionHours: 48,
  running: true,
  watchProcs: [],        // 自选进程目录项，进程版的"加自选"
};

export class Store {
  /**
   * @param {string} dataDir 用户目录，只放设置这种重启后要保留的小文件
   * @param {string} cacheDir 系统临时目录，放采样与事件这些可重建的大文件
   */
  constructor(dataDir, cacheDir) {
    this.settingsPath = join(dataDir, 'settings.json');
    this.tickDir = join(cacheDir, 'ticks');
    this.eventsPath = join(cacheDir, 'events.jsonl');
    this.settings = { ...DEFAULT_SETTINGS };
    this.eventLines = 0;
    this.lastSweepHour = '';
  }

  async init() {
    await mkdir(this.tickDir, { recursive: true });
    await this.loadSettings();
    await this.countEvents();
  }

  async loadSettings() {
    try {
      const raw = await readFile(this.settingsPath, 'utf8');
      const parsed = JSON.parse(raw);
      // 只接受已知键，避免旧版本遗留字段污染
      for (const k of Object.keys(DEFAULT_SETTINGS)) {
        if (parsed[k] !== undefined) this.settings[k] = parsed[k];
      }
    } catch {
      // 首次运行或文件损坏，回落到默认值
    }
  }

  async saveSettings(patch) {
    Object.assign(this.settings, patch ?? {});
    const tmp = this.settingsPath + '.tmp';
    await writeFile(tmp, JSON.stringify(this.settings, null, 2), 'utf8');
    await rename(tmp, this.settingsPath);
    return this.settings;
  }

  tickPath(ts) {
    return join(this.tickDir, hourKey(ts) + '.jsonl');
  }

  /** 追加一条采样点 */
  async appendTick(tick) {
    await appendFile(this.tickPath(tick.t), JSON.stringify(tick) + '\n', 'utf8');
    const hk = hourKey(tick.t);
    if (hk !== this.lastSweepHour) {
      this.lastSweepHour = hk;
      await this.sweep();
    }
  }

  /** 读回 sinceMs 之后的采样点，只触碰相关分片 */
  async readTicks(sinceMs) {
    const keys = new Set();
    const end = Date.now();
    // 向前覆盖到 since 所在小时，多读一小时避免边界缺失
    for (let t = sinceMs - HOUR; t <= end; t += HOUR) keys.add(hourKey(t));
    keys.add(hourKey(end));

    const wanted = [...keys].sort();
    const out = [];
    for (const k of wanted) {
      const p = join(this.tickDir, k + '.jsonl');
      try {
        await stat(p);
      } catch {
        continue;
      }
      const rl = createInterface({ input: createReadStream(p, 'utf8'), crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line) continue;
        try {
          const tick = JSON.parse(line);
          if (tick.t >= sinceMs) out.push(tick);
        } catch {
          // 跳过损坏行，不让单行错误毁掉整段历史
        }
      }
    }
    out.sort((a, b) => a.t - b.t);
    return out;
  }

  /** 删除超出保留窗口的分片 */
  async sweep() {
    const keepMs = (this.settings.retentionHours ?? 48) * HOUR;
    const cutoff = Date.now() - keepMs;
    let files;
    try {
      files = await readdir(this.tickDir);
    } catch {
      return;
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const m = /^(\d{8})-(\d{2})\.jsonl$/.exec(f);
      if (!m) continue;
      const y = +m[1].slice(0, 4), mo = +m[1].slice(4, 6), d = +m[1].slice(6, 8), h = +m[2];
      const start = new Date(y, mo - 1, d, h).getTime();
      // 整小时都早于截止时间才删
      if (start + HOUR < cutoff) {
        await rm(join(this.tickDir, f), { force: true });
      }
    }
  }

  async countEvents() {
    try {
      const raw = await readFile(this.eventsPath, 'utf8');
      this.eventLines = raw.split('\n').filter(Boolean).length;
    } catch {
      this.eventLines = 0;
    }
  }

  /**
   * 读事件。不传参时返回最近 EVENT_KEEP 条，给逐笔成交与 SSE 用；
   * 传 since 时返回该时刻之后的全部，给主图事件带用 —— 长周期 K 线要覆盖几小时，
   * 内存里那 500 条撑不住。
   */
  async readEvents(since = null, limit = EVENT_KEEP) {
    let raw;
    try {
      raw = await readFile(this.eventsPath, 'utf8');
    } catch {
      return [];
    }
    const parsed = raw.split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
    return since == null ? parsed.slice(-limit) : parsed.filter((ev) => ev.t >= since);
  }

  async appendEvent(ev) {
    await appendFile(this.eventsPath, JSON.stringify(ev) + '\n', 'utf8');
    this.eventLines += 1;
    if (this.eventLines > EVENT_COMPACT_AT) await this.compactEvents();
  }

  async compactEvents() {
    // 留一半：砍到 EVENT_KEEP 会把几小时的事件历史一次清空，事件带就断成一小截；
    // 留一半既压住了文件大小，又不会刚截断就立刻回到阈值。
    const keep = await this.readEvents(null, Math.floor(EVENT_COMPACT_AT / 2));
    const tmp = this.eventsPath + '.tmp';
    await writeFile(tmp, keep.map((e) => JSON.stringify(e)).join('\n') + (keep.length ? '\n' : ''), 'utf8');
    await rename(tmp, this.eventsPath);
    this.eventLines = keep.length;
  }

  /** 磁盘占用统计，用于设置面板展示 */
  async usage() {
    let bytes = 0, files = 0;
    try {
      for (const f of await readdir(this.tickDir)) {
        if (!f.endsWith('.jsonl')) continue;
        try {
          const s = await stat(join(this.tickDir, f));
          bytes += s.size;
          files += 1;
        } catch { /* 文件可能刚被淘汰 */ }
      }
    } catch { /* 目录尚未创建 */ }
    return { bytes, files, hours: files };
  }
}
