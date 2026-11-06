// K 线聚合：采样点序列 -> OHLC + 内存构成 + 均线
// 副图是内存构成：每根柱子按活动页 / 联动页 / 压缩页三段堆叠，与 K 线共用时间轴。

const DAY = 86400_000;

export function todayStart(ts = Date.now()) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 内存构成三段 -> 指标代码。单位都是 GiB */
const MEM_CODES = { a: '300002', w: '300003', c: '300006' };

/** 从一条 tick 的采样值里读内存三段，缺项按 0 */
function readMem(v) {
  if (!v) return null;
  const a = v[MEM_CODES.a], w = v[MEM_CODES.w], c = v[MEM_CODES.c];
  if (a == null && w == null && c == null) return null;
  return { a: a ?? 0, w: w ?? 0, c: c ?? 0 };
}

/**
 * 副图内存构成按 K 线周期归桶。内存是全局量，进程品种的 series 里没有这些字段，
 * 所以从主 tick 序列取，再按时间桶贴回 bars。
 * @param {Array<{t:number, v:Record<string,number>}>} globalTicks
 * @param {number} periodMs
 * @returns {Map<number, {a:number,w:number,c:number}>} 时间桶起点 -> 内存三段
 */
function memByBucket(globalTicks, periodMs) {
  const out = new Map();
  for (const tick of globalTicks ?? []) {
    const m = readMem(tick.v);
    if (m) out.set(Math.floor(tick.t / periodMs) * periodMs, m);
  }
  return out;
}

/**
 * 把 tick 序列聚合成 K 线。
 * @param {Array<{t:number, v:Record<string,number>, w:number}>} ticks
 * @param {string} code 指标代码
 * @param {number} periodSeconds K 线周期
 * @param {number} maxBars 最多返回多少根（取最新的）
 * @param {Array<{t:number, v:Record<string,number>}>} [globalTicks] 副图内存的来源，缺省用 ticks 本身
 */
export function aggregate(ticks, code, periodSeconds, maxBars = 180, globalTicks = null) {
  const periodMs = Math.max(1, periodSeconds) * 1000;
  const buckets = new Map();

  for (const tick of ticks) {
    const val = tick.v?.[code];
    if (val == null || !Number.isFinite(val)) continue;
    const key = Math.floor(tick.t / periodMs) * periodMs;
    let b = buckets.get(key);
    if (!b) {
      b = { t: key, o: val, h: val, l: val, c: val, v: 0, n: 0, mem: null };
      buckets.set(key, b);
    }
    b.h = Math.max(b.h, val);
    b.l = Math.min(b.l, val);
    b.c = val;
    b.v += tick.w ?? 0;
    b.n += 1;
  }

  const bars = [...buckets.values()].sort((a, b) => a.t - b.t).slice(-maxBars);
  const memMap = memByBucket(globalTicks ?? ticks, periodMs);
  for (const b of bars) b.mem = memMap.get(b.t) ?? null;
  const closes = bars.map((b) => b.c);

  return {
    bars,
    ma5: movingAverage(closes, 5),
    ma10: movingAverage(closes, 10),
    ma20: movingAverage(closes, 20),
  };
}

export function movingAverage(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/**
 * 品种头：现价 / 涨跌 / 涨跌幅 / 今开 / 最高 / 最低 / 均价
 * 「今开」取当日第一个有效采样点，跨进程重启保持连续。
 */
export function quoteOf(ticks, code) {
  const start = todayStart();
  let open = null, last = null, high = null, low = null, sum = 0, n = 0, volume = 0;

  for (const tick of ticks) {
    const val = tick.v?.[code];
    if (val == null || !Number.isFinite(val)) continue;
    if (tick.t >= start) {
      if (open == null) open = val;
      high = high == null ? val : Math.max(high, val);
      low = low == null ? val : Math.min(low, val);
      sum += val;
      n += 1;
      volume += tick.w ?? 0;
    }
    last = val;
  }

  if (last == null) {
    return { last: null, open: null, high: null, low: null, avg: null, delta: null, pct: null, volume: 0 };
  }

  const base = open ?? last;
  const delta = last - base;
  // 基准为 0 的指标（速率类常从 0 起）不展示涨跌幅，避免除零放大
  const pct = base === 0 ? null : (delta / Math.abs(base)) * 100;

  return {
    last,
    open: base,
    high: high ?? last,
    low: low ?? last,
    avg: n > 0 ? sum / n : last,
    delta,
    pct,
    volume,
  };
}

/**
 * 批量品种头：一次遍历算出所有指标的现价/今开/高低/均价/涨跌。
 * 自选列表有 40+ 项，逐个调用 quoteOf 会重复遍历整段历史。
 */
export function quotesOf(ticks, codes) {
  const start = todayStart();
  const acc = new Map();
  for (const c of codes) acc.set(c, { open: null, last: null, high: null, low: null, sum: 0, n: 0, volume: 0 });

  for (const tick of ticks) {
    const day = tick.t >= start;
    const v = tick.v;
    if (!v) continue;
    for (const c in v) {
      const a = acc.get(c);
      if (!a) continue;
      const val = v[c];
      if (val == null || !Number.isFinite(val)) continue;
      a.last = val;
      if (!day) continue;
      if (a.open == null) a.open = val;
      a.high = a.high == null ? val : Math.max(a.high, val);
      a.low = a.low == null ? val : Math.min(a.low, val);
      a.sum += val;
      a.n += 1;
      a.volume += tick.w ?? 0;
    }
  }

  const out = {};
  for (const [c, a] of acc) {
    if (a.last == null) {
      out[c] = { last: null, open: null, high: null, low: null, avg: null, delta: null, pct: null, volume: 0 };
      continue;
    }
    const base = a.open ?? a.last;
    const delta = a.last - base;
    out[c] = {
      last: a.last,
      open: base,
      high: a.high ?? a.last,
      low: a.low ?? a.last,
      avg: a.n > 0 ? a.sum / a.n : a.last,
      delta,
      pct: base === 0 ? null : (delta / Math.abs(base)) * 100,
      volume: a.volume,
    };
  }
  return out;
}

/** 迷你走势：给指数条与进程行用 */
export function sparkline(ticks, code, limit = 60) {
  const out = [];
  for (let i = Math.max(0, ticks.length - limit); i < ticks.length; i += 1) {
    const v = ticks[i].v?.[code];
    if (v != null && Number.isFinite(v)) out.push(v);
  }
  return out;
}
