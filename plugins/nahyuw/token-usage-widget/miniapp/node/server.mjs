// @ts-check

/**
 * Token 用量悬浮窗 — Node 运行时服务
 *
 * 数据来源（均已在本机实测通过，全部为账号口径）：
 *  1. 账号额度 API /backend/account/token_plan/remains_percent
 *     官方 5 小时窗口与周窗口的额度占比、剩余时间、重置时间。
 *  2. 账号用量 API /backend/account/token_plan/usage_summary
 *     按天聚合的 Token 用量（平台口径：输入 + 输出，缓存读取单列）。
 *  3. 账号用量 API /backend/account/token_plan/usage_overview
 *     实时总览：当天与最近 7 天的 Token 累计，以及速率与趋势的取数来源。
 *
 * 凭据只在 Node 侧读取与使用，不会随任何响应下发到页面。
 */

import { readFile, writeFile, rename, mkdir, readdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */
/** @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle */

/** 账号接口主机，按登录区域选择。 */
const API_HOSTS = {
  cn: 'https://api.minimax.cn',
  io: 'https://api.minimax.io',
  com: 'https://api.minimaxi.com',
  minimaxi: 'https://api.minimaxi.com',
};

/** 可配置指标目录。core 为固定展示项，不参与开关。 */
const METRIC_CATALOG = [
  {
    key: 'five_hour_ratio',
    label: { zh: '当前 5 小时周期内使用进度', en: 'Usage in the current 5-hour cycle' },
    hint: { zh: '当前 5 小时周期内的使用进度，随计划重置（也是水位高度）', en: 'Usage within the current 5-hour cycle, which resets with the plan (this is also the water level)' },
  },
  {
    key: 'account_rate_10m',
    label: { zh: '账号最近 10 分钟 Token 速率', en: 'Account token rate, last 10 minutes' },
    hint: { zh: '账号口径的 Token 消耗速率，按时间滚动（取账号实时 Token 累计的差分）', en: 'Token consumption rate on the account, rolling on wall-clock time (difference of the live account token counter)' },
  },
  {
    key: 'account_rate_30m',
    label: { zh: '账号最近 30 分钟 Token 速率', en: 'Account token rate, last 30 minutes' },
    hint: { zh: '账号口径的 Token 消耗速率，按时间滚动（取账号实时 Token 累计的差分）', en: 'Token consumption rate on the account, rolling on wall-clock time (difference of the live account token counter)' },
  },
  {
    key: 'today_total',
    label: { zh: '当天消耗 Token', en: 'Tokens used today' },
    hint: { zh: '账号当天的 Token 消耗总量，每天零点重置（实时口径）', en: 'Total tokens consumed on the account today, resetting at midnight (live source)' },
  },
  {
    key: 'week_ratio',
    label: { zh: '当前 7 天周期内使用进度', en: 'Usage in the current 7-day cycle' },
    hint: { zh: '当前 7 天周期内的使用进度，随计划重置', en: 'Usage within the current 7-day cycle, which resets with the plan' },
  },
  {
    key: 'seven_day_total',
    label: { zh: '最近 7 天消耗 Token', en: 'Tokens used over the last 7 days' },
    hint: { zh: '账号最近 7 天（含今天）的 Token 消耗总量，按时间滚动（实时口径）', en: 'Total tokens consumed on the account over the last 7 days (including today), rolling on wall-clock time (live source)' },
  },
  {
    key: 'reset_countdown',
    label: { zh: '当前 5 小时周期重置倒计时', en: 'Reset countdown for the current 5-hour cycle' },
    hint: { zh: '当前 5 小时周期距离刷新的剩余时间', en: 'Time left before the current 5-hour cycle refreshes' },
  },
  {
    key: 'weekly_countdown',
    label: { zh: '当前 7 天周期重置倒计时', en: 'Reset countdown for the current 7-day cycle' },
    hint: { zh: '当前 7 天周期距离刷新的剩余时间', en: 'Time left before the current 7-day cycle refreshes' },
  },
  {
    key: 'cache_hit',
    label: { zh: '当天缓存命中率', en: 'Cache hit rate today' },
    hint: { zh: '平台统计的当天缓存命中比例', en: 'Cache hit ratio for today as reported by the platform' },
  },
  {
    key: 'io_split',
    label: { zh: '当天输入 / 输出', en: 'Input / output today' },
    hint: { zh: '账号当天的输入与输出 Token 拆分', en: 'Split of the account input and output tokens for today' },
  },
];

const METRIC_KEYS = new Set(METRIC_CATALOG.map((item) => item.key));
const CORE_METRIC_KEYS = METRIC_CATALOG.filter((item) => item.core).map((item) => item.key);

const DEFAULT_SETTINGS = {
  metrics: ['account_rate_10m', 'today_total', 'week_ratio', 'seven_day_total', 'reset_countdown'],
  refreshSeconds: 5,
  theme: 'system',
  scale: 0.6,
  trendPeriod: 30,
  language: 'system',
  position: null,
  centerMetric: 'five_hour_ratio',
  waterMetric: 'five_hour_ratio',
  ringMetric: 'week_ratio',
};

/** 圆盘中心读数的可选指标。 */
const GAUGE_CENTER_CHOICES = [
  'five_hour_ratio',
  'week_ratio',
  'account_rate_10m',
  'account_rate_30m',
  'today_total',
  'seven_day_total',
];
/** 圆盘水面高度的可选指标。 */
const GAUGE_WATER_CHOICES = ['five_hour_ratio', 'week_ratio'];
/** 圆盘外圈进度环的可选指标。 */
const GAUGE_RING_CHOICES = [
  'five_hour_ratio',
  'week_ratio',
  'five_hour_countdown',
  'weekly_countdown',
  'account_rate_10m',
  'account_rate_30m',
];

const REFRESH_CHOICES = [3, 5, 10, 30, 60];
const THEME_CHOICES = ['system', 'light', 'dark'];
const LANGUAGE_CHOICES = ['system', 'zh', 'en'];
const TREND_PERIOD_CHOICES = [10, 30, 60, 120];

/**
 * 趋势窗口的分钟数：只认配置里的档位，其它值退回默认。
 * @param {any} value
 * @returns {number}
 */
function normalizeTrendMinutes(value) {
  const numeric = Number(value);
  return TREND_PERIOD_CHOICES.includes(numeric) ? numeric : DEFAULT_SETTINGS.trendPeriod;
}
const SCALE_MIN = 0.4;
const SCALE_MAX = 0.8;

/** 服务内部错误，携带稳定的 code 与可展示文案。 */
class ServiceError extends Error {
  /**
   * @param {string} code
   * @param {string} message 中文文案
   * @param {string} [messageEn] 英文文案
   */
  constructor(code, message, messageEn) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.messageEn = messageEn || message;
  }
}

/** @param {unknown} value */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** @param {unknown} value */
function numberValue(value) {
  const numeric = typeof value === 'string' ? Number(value) : value;
  return isFiniteNumber(numeric) ? numeric : 0;
}

/** 解析 "84%" / "93.24%" 这类百分比字符串。 */
function percentValue(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return 0;
  const numeric = Number.parseFloat(String(value).replace('%', '').trim());
  return Number.isFinite(numeric) ? numeric : 0;
}

/** @param {unknown} value */
function millisValue(value) {
  const numeric = typeof value === 'string' ? Number(value) : value;
  return isFiniteNumber(numeric) ? numeric : null;
}

/** @param {number} timestamp */
function localDayStart(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** @param {string} path */
async function pathExists(path) {
  try {
    await readFile(path);
    return true;
  } catch {
    try {
      const { stat } = await import('node:fs/promises');
      return (await stat(path)).isFile();
    } catch {
      return false;
    }
  }
}

/* ------------------------------------------------------------------ *
 * 运行时目录与登录凭据
 * ------------------------------------------------------------------ */

/** @returns {Promise<string>} */
async function resolveRuntimeRoot() {
  const candidates = [
    process.env.MINIMAX_DATA_DIR,
    process.env.MAVIS_DATA_DIR,
    process.env.MCODE_DATA_DIR,
    join(homedir(), '.minimax'),
  ].filter((value) => typeof value === 'string' && value.length > 0);
  for (const candidate of candidates) {
    if (await pathExists(join(candidate, 'v2', 'sqlite', 'runtime-state.sqlite'))) return candidate;
  }
  for (const candidate of candidates) {
    if (await pathExists(join(candidate, 'auth', 'prod'))) return candidate;
  }
  return candidates[candidates.length - 1] || join(homedir(), '.minimax');
}

/**
 * 递归收集认证目录下的凭据文件（目录层级随版本变化，这里按深度上限扫描）。
 * @param {string} dir
 * @param {number} depth
 * @returns {Promise<string[]>}
 */
async function collectAuthFiles(dir, depth) {
  if (depth > 4) return [];
  /** @type {string[]} */
  const files = [];
  /** @type {import('node:fs').Dirent[]} */
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      files.push(...(await collectAuthFiles(join(dir, entry.name), depth + 1)));
    } else if (entry.name === 'auth.json' || entry.name === 'auth-state.json') {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

/** @param {string} authDir */
async function readAuthRegion(authDir) {
  for (const file of await collectAuthFiles(authDir, 0)) {
    if (!file.endsWith('auth-state.json')) continue;
    try {
      const state = JSON.parse(await readFile(file, 'utf8'));
      if (state && typeof state.region === 'string' && state.region) return state.region;
    } catch {
      /* 忽略不可读的认证状态文件 */
    }
  }
  return 'cn';
}

/**
 * 读取当前登录态。凭据只在本进程内使用。
 * @returns {Promise<{accessToken: string, expiresAtMs: number, region: string} | null>}
 */
async function loadAuthProfile() {
  const root = await resolveRuntimeRoot();
  const authDir = join(root, 'auth');
  const region = await readAuthRegion(authDir);
  /** @type {{accessToken: string, expiresAtMs: number} | null} */
  let best = null;
  for (const file of await collectAuthFiles(authDir, 0)) {
    if (!file.endsWith('auth.json')) continue;
    /** @type {any} */
    let parsed;
    try {
      parsed = JSON.parse(await readFile(file, 'utf8'));
    } catch {
      continue;
    }
    const records = parsed && typeof parsed.records === 'object' && parsed.records ? parsed.records : {};
    for (const value of Object.values(records)) {
      if (!value || typeof value !== 'object') continue;
      const accessToken = typeof (/** @type {any} */ (value).accessToken) === 'string'
        ? /** @type {any} */ (value).accessToken
        : '';
      if (!accessToken) continue;
      const expiresAtMs = numberValue(/** @type {any} */ (value).expiresAtMs);
      if (!best || expiresAtMs > best.expiresAtMs) best = { accessToken, expiresAtMs };
    }
  }
  if (!best) return null;
  return { ...best, region };
}

/* ------------------------------------------------------------------ *
 * 账号额度与用量
 * ------------------------------------------------------------------ */

/**
 * @param {string} base
 * @param {string} token
 * @param {string} path
 */
async function accountGet(base, token, path) {
  let response;
  try {
    response = await fetch(base + path, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ServiceError('account_unreachable', '无法连接 MiniMax 账号接口，请检查网络', 'Cannot reach the MiniMax account API, check your network');
  }
  const text = await response.text();
  if (text.length > 8 * 1024 * 1024) {
    throw new ServiceError('account_response_too_large', '账号接口返回内容过大', 'The account API response is too large');
  }
  /** @type {any} */
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ServiceError('account_parse_failed', '账号接口返回了无法解析的内容', 'The account API returned content that could not be parsed');
  }
  const baseResp = json && typeof json === 'object' ? json.base_resp : null;
  if (baseResp && numberValue(baseResp.status_code) !== 0) {
    const statusCode = numberValue(baseResp.status_code);
    if (statusCode === 1004) {
      throw new ServiceError('auth_expired', 'MiniMax Code 登录状态已过期，请重新登录', 'Your MiniMax Code session has expired, please sign in again');
    }
    throw new ServiceError('account_error', baseResp.status_msg || `账号接口返回错误（${statusCode}）`, `The account API returned an error (${statusCode})`);
  }
  return json;
}

/**
 * 解析按天用量汇总的更新时间。
 * 平台返回形如 "11-26 21:00"，按天汇总是整点批量刷新的，
 * 这个时间戳就是这份数据的年龄——用它告诉用户「这个数刚更新到几点」。
 * @param {any} value
 * @returns {number} epoch 毫秒，解析不了返回 0
 */
function parseUsageUpdateTime(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  const matched = /^(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})$/.exec(text);
  if (!matched) return 0;
  const now = new Date();
  const month = Number(matched[1]);
  const day = Number(matched[2]);
  const hour = Number(matched[3]);
  const minute = Number(matched[4]);
  let stamp = new Date(now.getFullYear(), month - 1, day, hour, minute, 0, 0).getTime();
  // 平台只给月日：算出来在未来，说明是去年的数据
  if (stamp > Date.now() + 24 * 3600 * 1000) {
    stamp = new Date(now.getFullYear() - 1, month - 1, day, hour, minute, 0, 0).getTime();
  }
  return stamp;
}

/**
 * 解析实时用量总览（/backend/account/token_plan/usage_overview）。
 * 这是控制台「订阅套餐用量详情」背后的接口：当天与近 7 天 Token 每 30~60 秒就刷新，
 * 而 usage_summary 的按天汇总是滞后的批量快照（约两小时后才追平）。
 * @param {any} overview
 */
function parseOverviewPayload(overview) {
  const empty = { available: false, todayTotal: 0, sevenDayTotal: 0, cacheHitPercent: 0, days: [] };
  if (!overview || typeof overview !== 'object') return empty;
  const trend = Array.isArray(overview.trend) ? overview.trend : [];
  const days = trend.map((row) => ({
    date: String((row && row.time_label) || ''),
    total: numberValue(row && row.total_token),
    models: Array.isArray(row && row.models)
      ? row.models.map((model) => ({
        model: String((model && (model.model || model.model_name)) || ''),
        token: numberValue(model && model.token),
      }))
      : [],
  }));
  if (days.length === 0) return empty;
  const total = numberValue(overview.language_model_token);
  const sum = days.reduce((acc, day) => acc + day.total, 0);
  return {
    available: true,
    todayTotal: days[days.length - 1].total,
    sevenDayTotal: total > 0 ? total : sum,
    cacheHitPercent: percentValue(overview.cache_hit_percent),
    days,
  };
}

/**
 * @param {any} remains
 * @param {any} usage
 * @param {any} overview
 */
function parseAccountPayload(remains, usage, overview) {
  const rows = Array.isArray(remains?.model_remains) ? remains.model_remains : [];
  const general = rows.find((row) => row && row.model_name === 'general') || rows[0];
  if (!general) throw new ServiceError('account_parse_failed', '额度接口没有返回可用的周期数据', 'The quota API returned no usable cycle data');

  const daily = (Array.isArray(usage?.date_model_usage) ? usage.date_model_usage : [])
    .filter((row) => row && typeof row.date === 'string')
    .slice(-14);
  if (daily.length === 0) throw new ServiceError('account_parse_failed', '用量接口没有返回按天数据', 'The usage API returned no daily data');

  const today = daily[daily.length - 1];
  const last7 = daily.slice(-7);

  return {
    quota: {
      fiveHour: {
        startAt: millisValue(general.start_time),
        usedPercent: percentValue(general.current_interval_used_percent),
        totalPercent: percentValue(general.current_interval_total_percent),
        remainingMs: millisValue(general.remains_time),
        resetAt: millisValue(general.end_time),
        status: Number.isFinite(general.current_interval_status) ? general.current_interval_status : null,
      },
      weekly: {
        startAt: millisValue(general.weekly_start_time),
        usedPercent: percentValue(general.current_weekly_used_percent),
        totalPercent: percentValue(general.current_weekly_total_percent),
        remainingMs: millisValue(general.weekly_remains_time),
        resetAt: millisValue(general.weekly_end_time),
        status: Number.isFinite(general.current_weekly_status) ? general.current_weekly_status : null,
      },
    },
    usage: {
      day: {
        date: today.date,
        total: numberValue(today.total_token),
        input: numberValue(today.total_input_token),
        output: numberValue(today.total_output_token),
        cacheRead: numberValue(today.total_cache_read_token),
        cacheWrite: numberValue(today.total_cache_create_token),
        cacheHitPercent: percentValue(today.cache_hit_percent),
      },
      last7Days: last7.map((row) => ({
        date: row.date,
        total: numberValue(row.total_token),
      })),
      sevenDayTotal: last7.reduce((sum, row) => sum + numberValue(row.total_token), 0),
      lastUpdateAt: parseUsageUpdateTime(usage && usage.last_update_time),
      lastUpdateText: typeof (usage && usage.last_update_time) === 'string' ? usage.last_update_time : '',
      realTime: parseOverviewPayload(overview),
    },
  };
}

/** @returns {Promise<{ok: boolean, code?: string, message?: string, quota?: any, usage?: any}>} */
async function fetchAccount() {
  const auth = await loadAuthProfile();
  if (!auth) {
    return { ok: false, code: 'no_auth', message: '未找到 MiniMax Code 的登录凭据，请先登录 MiniMax Code', messageEn: 'No MiniMax Code credentials found, please sign in to MiniMax Code first' };
  }
  if (auth.expiresAtMs && auth.expiresAtMs <= Date.now() + 60_000) {
    return { ok: false, code: 'auth_expired', message: 'MiniMax Code 登录状态已过期，请重新登录后重试', messageEn: 'Your MiniMax Code session has expired, please sign in again' };
  }
  const base = API_HOSTS[auth.region] || API_HOSTS.cn;
  try {
    const [remains, usage, overview] = await Promise.all([
      accountGet(base, auth.accessToken, '/backend/account/token_plan/remains_percent'),
      accountGet(base, auth.accessToken, '/backend/account/token_plan/usage_summary'),
      // 实时用量总览：拿不到就退回按天汇总，不影响其它数据
      accountGet(base, auth.accessToken, '/backend/account/token_plan/usage_overview').catch(() => null),
    ]);
    return { ok: true, ...parseAccountPayload(remains, usage, overview) };
  } catch (error) {
    const code = error instanceof ServiceError ? error.code : 'account_failed';
    const message = error instanceof ServiceError ? error.message : '读取账号额度失败';
    const messageEn = error instanceof ServiceError ? error.messageEn : 'Failed to read the account quota';
    return { ok: false, code, message, messageEn };
  }
}

/* ------------------------------------------------------------------ *
 * 账号口径速率：额度窗口差分 + 账号 Token 标定
 * ------------------------------------------------------------------ */

/*
 * 账号接口只给额度窗口的「已用百分比」，不给绝对额度
 * （current_interval_total_count 恒为 -1），也没有分钟级的 Token 序列。
 * 所以账号侧的秒级速率这样来：
 *   1) 形状：相邻两次采样之间的百分比差分，得到秒级消耗节奏；
 *   2) 量纲：用账号当日累计 Token 的增量，去对齐同一区间内百分点的增量，
 *      标定出「一个百分点等于多少 Token」。
 * 标定值需要账号按小时刷新日累计后才能收敛，冷启动阶段先用粗估并标注为估算。
 */

/** 采样状态文件名，放在 dataDir 里原子写入。 */
const ACCOUNT_RATE_FILE = 'account-rate.json';
/** 窗口采样保留时长：够画 30 分钟趋势。 */
const ACCOUNT_SAMPLE_KEEP_MS = 45 * 60 * 1000;
/** 账号日累计快照保留时长。 */
const ACCOUNT_DAILY_KEEP_MS = 8 * 60 * 60 * 1000;
/** 计算平均速率所需的最短覆盖时长：不足 1 分钟的跨度算出来的速率没有意义。 */
const ACCOUNT_RATE_MIN_SPAN_MINUTES = 1;
/** 用实时计数器标定时要求的最短区间：额度百分比只有 1% 一跳，区间太短会撞上粒度噪声。 */
const ACCOUNT_SCALE_MIN_SPAN_MS = 5 * 60 * 1000;
/** 计数器采样保留条数：画 30 分钟趋势只需要几十条，留 600 条足够，状态文件才不会越跑越大。 */
const ACCOUNT_COUNTER_KEEP = 600;

/** @returns {{samples: any[], daily: any[], counter: any[], tokensPerPoint: number, tokensPerPointAt: number, tokensPerPointDay: string}} */
function emptyAccountRateState() {
  return { samples: [], daily: [], counter: [], tokensPerPoint: 0, tokensPerPointAt: 0, tokensPerPointDay: '' };
}

/**
 * @param {string} dataDir
 * @returns {Promise<any>}
 */
async function readAccountRateState(dataDir) {
  try {
    const parsed = JSON.parse(await readFile(join(dataDir, ACCOUNT_RATE_FILE), 'utf8'));
    if (!parsed || typeof parsed !== 'object') return emptyAccountRateState();
    const state = emptyAccountRateState();
    const rawSamples = Array.isArray(parsed.samples)
      ? parsed.samples.filter((item) => item && Number.isFinite(Number(item.t)) && Number.isFinite(Number(item.used)))
      : [];
    // 旧格式里的 t 记的是「最后观测到该百分比的时刻」，差分语义不对，
    // 这里还原成「该百分比首次出现的时刻」：窗口内第一条取窗口起点，其余取前一条的观测时刻。
    state.samples = rawSamples.map((item, index) => {
      const used = Number(item.used);
      const start = Number(item.start);
      const previous = index > 0 ? rawSamples[index - 1] : null;
      const sameWindow = previous && Number(previous.start) === start;
      if (Number.isFinite(Number(item.seen))) {
        return { t: Number(item.t), seen: Number(item.seen), used, start };
      }
      const t = sameWindow ? Number(previous.t) : (Number.isFinite(start) && start > 0 ? start : Number(item.t));
      return { t, seen: Number(item.t), used, start };
    });
    state.daily = Array.isArray(parsed.daily)
      ? parsed.daily.filter((item) => item && Number.isFinite(Number(item.t)) && Number.isFinite(Number(item.tokens)))
      : [];
    // 实时累计计数器的采样：{t 首次观测时刻, seen 最后观测时刻, tokens 当天累计, date}
    state.counter = Array.isArray(parsed.counter)
      ? parsed.counter.filter((item) => item && Number.isFinite(Number(item.t)) && Number.isFinite(Number(item.tokens)))
      : [];
    state.tokensPerPoint = numberValue(parsed.tokensPerPoint);
    state.tokensPerPointAt = numberValue(parsed.tokensPerPointAt);
    state.tokensPerPointDay = typeof parsed.tokensPerPointDay === 'string' ? parsed.tokensPerPointDay : '';
    return state;
  } catch {
    return emptyAccountRateState();
  }
}

/**
 * @param {string} dataDir
 * @param {any} state
 */
async function writeAccountRateState(dataDir, state) {
  const path = join(dataDir, ACCOUNT_RATE_FILE);
  await mkdir(dataDir, { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, JSON.stringify(state), 'utf8');
  await rename(temporary, path);
}

/**
 * 记一次额度窗口采样。
 * t 记录「这个百分比第一次被观测到的时刻」，seen 记录「最后一次被观测到的时刻」。
 * 差分必须用 t：某个时刻的百分比 = 第一个 t 不晚于该时刻的采样值；
 * 用 seen 差分会把「数值长期不变」的时段压缩掉，平均速率会被放大好几倍。
 * @param {any} state
 * @param {number} now
 * @param {any} account
 */
function sampleAccountWindow(state, now, account) {
  const fiveHour = account && account.quota && account.quota.fiveHour;
  const used = numberValue(fiveHour && fiveHour.usedPercent);
  const start = numberValue(fiveHour && fiveHour.startAt);
  if (!Number.isFinite(used) || !Number.isFinite(start) || start <= 0) return;
  const samples = state.samples;
  const last = samples[samples.length - 1];
  if (!last || last.start !== start || last.used !== used) {
    samples.push({ t: now, seen: now, used, start });
  } else {
    last.seen = now;
  }
  // 当前窗口的基线样本必须留着（差分时它代表「窗口开始时的百分比」），
  // 更早的窗口按时间裁剪。
  while (samples.length > 1) {
    const first = samples[0];
    if (first.start === start) break;
    if (now - first.t > ACCOUNT_SAMPLE_KEEP_MS) {
      samples.shift();
      continue;
    }
    break;
  }
}

/**
 * 记一次账号实时累计计数器采样。
 * 这个计数器每 30~60 秒刷新一次，给的是真实 Token 累计；
 * 拿它的差分就能得到账号口径的分钟级真实用量（含外部工具的消耗），
 * 不再依赖「额度百分点 × 标定系数」这条估算路径。
 * @param {any} state
 * @param {number} now
 * @param {any} account
 */
function sampleAccountCounter(state, now, account) {
  const usage = account && account.usage;
  const real = usage && usage.realTime;
  if (!real || !real.available) return;
  const tokens = numberValue(real.todayTotal);
  const date = String((usage.day && usage.day.date) || '');
  if (tokens <= 0 || !date) return;
  const samples = state.counter;
  const last = samples[samples.length - 1];
  if (!last || last.date !== date || last.tokens !== tokens) {
    samples.push({ t: now, seen: now, tokens, date });
  } else {
    last.seen = now;
  }
  while (samples.length > 1 && (samples[0].date !== date
    || now - samples[0].t > ACCOUNT_DAILY_KEEP_MS
    || samples.length > ACCOUNT_COUNTER_KEEP)) {
    samples.shift();
  }
}

/**
 * 用实时累计计数器标定「窗口一个百分点 = 多少 Token」。
 * 按天汇总那条路标出来的系数会偏：那份数据是滞后的批量快照，
 * 用它算增量等于把两个不同时间点的用量错位相减。
 * @param {any} state
 * @returns {boolean} 是否标定成功
 */
function calibrateFromCounter(state, now) {
  const counter = state.counter;
  const samples = state.samples;
  if (!Array.isArray(counter) || counter.length < 2) return false;
  if (!Array.isArray(samples) || samples.length < 2) return false;
  // 计数器每分钟才跳一次，只看相邻两条永远凑不满 5 分钟；
  // 这里取「同一天里最老的一条 → 最新的一条」，跨度最长，标定最稳。
  const newest = counter[counter.length - 1];
  for (let index = 0; index < counter.length - 1; index += 1) {
    const from = counter[index];
    const to = newest;
    if (from.date !== to.date) continue;
    // 起点往后挪只会让区间更短，凑不满就直接收工
    if (to.t - from.t < ACCOUNT_SCALE_MIN_SPAN_MS) break;
    const deltaTokens = to.tokens - from.tokens;
    if (deltaTokens <= 0) continue;
    const inRange = samples.filter((item) => item.t >= from.t && item.t <= to.t);
    if (inRange.length < 2) continue;
    const windowStart = inRange[0].start;
    if (inRange.some((item) => item.start !== windowStart)) continue;
    const points = inRange[inRange.length - 1].used - inRange[0].used;
    if (points <= 0) continue;
    const tokensPerPoint = deltaTokens / points;
    if (tokensPerPoint > 0) {
      state.tokensPerPoint = tokensPerPoint;
      state.tokensPerPointAt = now;
      state.tokensPerPointDay = to.date;
      return true;
    }
  }
  return false;
}

/**
 * 用实时累计计数器的差分算真实 Token 的分钟序列与区间用量。
 * @param {any[]} samples
 * @param {number} now
 */
function computeCounterSeries(samples, now, windowMinutes) {
  const minutes = normalizeTrendMinutes(windowMinutes);
  const buckets = new Array(minutes).fill(0);
  const empty = { ready: false, buckets, tokens10m: 0, tokens30m: 0, span10m: 0, span30m: 0 };
  if (!Array.isArray(samples) || samples.length < 2) return empty;
  let moved = false;
  for (let index = 1; index < samples.length; index += 1) {
    const from = samples[index - 1];
    const to = samples[index];
    if (from.date !== to.date) continue;
    const delta = to.tokens - from.tokens;
    const span = to.t - from.t;
    if (delta <= 0 || span <= 0) continue;
    moved = true;
    for (let bucket = 0; bucket < minutes; bucket += 1) {
      const bucketStart = now - (minutes - bucket) * 60000;
      const overlap = Math.min(to.t, bucketStart + 60000) - Math.max(from.t, bucketStart);
      if (overlap > 0) buckets[bucket] += delta * (overlap / span);
    }
  }
  if (!moved) return empty;
  const valueAt = (moment) => {
    let value = null;
    for (const item of samples) {
      if (item.t <= moment) value = item.tokens;
      else break;
    }
    return value;
  };
  const newest = samples[samples.length - 1];
  const coverage = Math.max(0, (now - samples[0].t) / 60000);
  const span30 = Math.min(30, coverage);
  const span10 = Math.min(10, coverage);
  const reference30 = valueAt(now - span30 * 60000);
  const reference10 = valueAt(now - span10 * 60000);
  return {
    ready: true,
    buckets,
    tokens10m: reference10 === null ? 0 : Math.max(0, newest.tokens - reference10),
    tokens30m: reference30 === null ? 0 : Math.max(0, newest.tokens - reference30),
    span10m: span10,
    span30m: span30,
  };
}

/**
 * 用实时计数器的结果覆盖趋势与速率。
 * 计数器覆盖到的分钟用真实 Token；还没覆盖到的（刚启动那段时间）用标定换算补齐，
 * 这样趋势一打开就是完整的 30 分钟形状，而不是前 28 分钟空着。
 * @param {any} result
 * @param {any} state
 * @param {number} now
 * @param {number[]} estimatedBuckets 「百分点 × 标定系数」换算出的分钟序列
 * @returns {boolean} 是否覆盖成功
 */
function applyCounterSeries(result, state, now, estimatedBuckets, windowMinutes) {
  const minutes = normalizeTrendMinutes(windowMinutes);
  const series = computeCounterSeries(state.counter, now, minutes);
  if (!series.ready) return false;
  const counter = state.counter;
  const newest = counter[counter.length - 1];
  const first = counter.find((item) => item.date === newest.date);
  const estimated = Array.isArray(estimatedBuckets) ? estimatedBuckets : [];
  const buckets = new Array(minutes).fill(0);
  for (let bucket = 0; bucket < minutes; bucket += 1) {
    const bucketStart = now - (minutes - bucket) * 60000;
    const covered = first ? bucketStart + 60000 > first.t : false;
    buckets[bucket] = covered ? (series.buckets[bucket] || 0) : (estimated[bucket] || 0);
  }
  const coveredMinutes = first ? Math.min(minutes, Math.max(0, (now - first.t) / 60000)) : 0;
  result.trendBuckets = buckets;
  result.trendWindowMinutes = minutes;
  // 整窗都是真实 Token 才算完全精确
  result.trendExactMinutes = coveredMinutes;
  result.exact = coveredMinutes >= minutes;
  result.estimated = !result.exact;
  result.counterSamples = counter.length;
  // 速率：真实 Token 覆盖够了就用真实值，否则保留标定换算的结果
  if (series.span10m >= ACCOUNT_RATE_MIN_SPAN_MINUTES) {
    result.tokens10m = series.tokens10m;
    result.span10m = series.span10m;
    result.rate10Ready = true;
    result.rateExact = true;
    result.tokensPerMinute10m = result.tokens10m / series.span10m;
  }
  if (series.span30m >= ACCOUNT_RATE_MIN_SPAN_MINUTES) {
    result.tokens30m = series.tokens30m;
    result.span30m = series.span30m;
    result.rate30Ready = true;
    result.rateExact = true;
    result.tokensPerMinute30m = result.tokens30m / series.span30m;
  }
  return true;
}

/**
 * 标定「窗口一个百分点 = 多少 Token」。
 * @param {any} state
 * @param {number} now
 * @param {any} account
 */
function calibrateAccountRate(state, now, account) {
  // 实时计数器能标定就用它（分钟级），标不出来再退回按天汇总
  if (calibrateFromCounter(state, now)) return;
  const day = account && account.usage && account.usage.day;
  const tokens = numberValue(day && day.total);
  const date = String((day && day.date) || '');
  if (!Number.isFinite(tokens) || tokens <= 0 || !date) return;
  const daily = state.daily;
  const last = daily[daily.length - 1];
  if (!last || last.date !== date || last.tokens !== tokens) {
    daily.push({ t: now, date, tokens });
  }
  while (daily.length > 1 && now - daily[0].t > ACCOUNT_DAILY_KEEP_MS) daily.shift();
  for (let index = daily.length - 1; index > 0; index -= 1) {
    const from = daily[index - 1];
    const to = daily[index];
    if (from.date !== to.date) continue;
    const deltaTokens = to.tokens - from.tokens;
    const spanMs = to.t - from.t;
    if (deltaTokens <= 0 || spanMs <= 0) continue;
    // 取区间内覆盖时间最长的一组同窗口采样
    const groups = new Map();
    for (const sample of state.samples) {
      if (sample.t < from.t || sample.t > to.t) continue;
      const list = groups.get(sample.start) || [];
      list.push(sample);
      groups.set(sample.start, list);
    }
    let best = null;
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const points = list[list.length - 1].used - list[0].used;
      const coverMs = list[list.length - 1].t - list[0].t;
      if (points <= 0 || coverMs <= 0) continue;
      if (!best || coverMs > best.coverMs) best = { points, coverMs };
    }
    if (!best) continue;
    const tokensInCover = deltaTokens * (best.coverMs / spanMs);
    const tokensPerPoint = tokensInCover / best.points;
    if (tokensPerPoint > 0) {
      state.tokensPerPoint = tokensPerPoint;
      state.tokensPerPointAt = now;
      state.tokensPerPointDay = date;
      return;
    }
  }
}

/**
 * 还没有标定样本时的粗估：把当日账号总量按时间比例摊到窗口区间。
 * @param {number} now
 * @param {any} account
 */
function estimateTokensPerPoint(now, account) {
  const fiveHour = account && account.quota && account.quota.fiveHour;
  const day = account && account.usage && account.usage.day;
  const used = numberValue(fiveHour && fiveHour.usedPercent);
  const tokens = numberValue(day && day.total);
  const start = numberValue(fiveHour && fiveHour.startAt);
  if (used <= 0 || tokens <= 0 || start <= 0) return 0;
  const elapsedDay = now - localDayStart(now);
  const elapsedWindow = now - start;
  if (elapsedDay <= 0 || elapsedWindow <= 0 || elapsedWindow > elapsedDay) return 0;
  return (tokens * (elapsedWindow / elapsedDay)) / used;
}

/**
 * 算出账号口径的速率、趋势与「还能撑多久」。
 * @param {any} state
 * @param {number} now
 * @param {any} account
 */
function computeAccountRate(state, now, account, windowMinutes) {
  const fiveHour = (account && account.quota && account.quota.fiveHour) || {};
  const used = numberValue(fiveHour.usedPercent);
  const start = numberValue(fiveHour.startAt);
  const day = account && account.usage && account.usage.day;
  const dayDate = String((day && day.date) || '');
  const calibrated = state.tokensPerPoint > 0 && state.tokensPerPointDay === dayDate;
  const scale = calibrated ? state.tokensPerPoint : estimateTokensPerPoint(now, account);
  const result = {
    ok: Number.isFinite(start) && start > 0,
    windowUsedPercent: Number.isFinite(used) ? used : null,
    windowStart: start || null,
    windowEnd: millisValue(fiveHour.resetAt),
    calibrated,
    estimated: !calibrated && scale > 0,
    tokensPerPoint: scale,
    pctPerMinute: 0,
    tokens10m: 0,
    tokens30m: 0,
    tokensPerMinute10m: 0,
    tokensPerMinute30m: 0,
    trendBuckets: new Array(normalizeTrendMinutes(windowMinutes)).fill(0),
    trendWindowMinutes: normalizeTrendMinutes(windowMinutes),
    minutesToFull: null,
    samples: 0,
    exact: false,
    counterSamples: 0,
    trendExactMinutes: 0,
    rateExact: false,
  };
  if (!Number.isFinite(start) || start <= 0) {
    applyCounterSeries(result, state, now, [], windowMinutes);
    return result;
  }
  const samples = state.samples.filter((item) => item.start === start);
  result.samples = samples.length;
  if (samples.length < 2) {
    applyCounterSeries(result, state, now, [], windowMinutes);
    return result;
  }
  const newest = samples[samples.length - 1];
  const baseline = samples[0].used;
  const windowAge = Math.max(0, (now - start) / 60000);
  // 某个时刻的百分比：第一个「首次观测时刻」不晚于它的采样值
  const valueAt = (moment) => {
    let value = null;
    for (const item of samples) {
      if (item.t <= moment) value = item.used;
      else break;
    }
    return value === null ? baseline : value;
  };
  // 覆盖时长 = 标称窗口与窗口年龄取小：窗口刚重置时还没跑满标称窗口，
  // 用窗口年龄兜底，否则会把几秒钟的增量当成十分钟平均。
  const windowStats = (nominalMinutes) => {
    const span = Math.min(nominalMinutes, windowAge);
    if (span <= 0) return { points: 0, span: 0 };
    const reference = valueAt(now - span * 60000);
    return { points: Math.max(0, newest.used - reference), span };
  };
  const ten = windowStats(10);
  const thirty = windowStats(30);
  result.pctPerMinute = thirty.span > 0 ? thirty.points / thirty.span : 0;
  // 每分钟桶：把相邻采样之间的百分点增量按时间摊开
  const minutes = normalizeTrendMinutes(windowMinutes);
  const buckets = new Array(minutes).fill(0);
  for (let index = 1; index < samples.length; index += 1) {
    const from = samples[index - 1];
    const to = samples[index];
    const points = to.used - from.used;
    const span = to.t - from.t;
    if (points <= 0 || span <= 0) continue;
    for (let bucket = 0; bucket < minutes; bucket += 1) {
      const bucketStart = now - (minutes - bucket) * 60000;
      const overlap = Math.min(to.t, bucketStart + 60000) - Math.max(from.t, bucketStart);
      if (overlap > 0) buckets[bucket] += points * (overlap / span);
    }
  }
  const estimatedBuckets = buckets.map((value) => value * scale);
  result.trendBuckets = estimatedBuckets;
  result.trendWindowMinutes = minutes;
  result.tokens30m = thirty.points * scale;
  result.tokens10m = ten.points * scale;
  // 实际覆盖时长：窗口刚重置时不足 10/30 分钟，短跨度下算平均速率会被放大成假尖峰
  result.span10m = ten.span;
  result.span30m = thirty.span;
  result.windowAgeMinutes = windowAge;
  result.rate10Ready = ten.span >= ACCOUNT_RATE_MIN_SPAN_MINUTES;
  result.rate30Ready = thirty.span >= ACCOUNT_RATE_MIN_SPAN_MINUTES;
  result.tokensPerMinute30m = result.rate30Ready ? result.tokens30m / thirty.span : 0;
  result.tokensPerMinute10m = result.rate10Ready ? result.tokens10m / ten.span : 0;
  if (result.pctPerMinute > 0) {
    result.minutesToFull = Math.round((100 - used) / result.pctPerMinute);
  }
  // 实时计数器的真实 Token 覆盖「百分点 × 标定系数」这条估算结果
  applyCounterSeries(result, state, now, estimatedBuckets, minutes);
  return result;
}

/* ------------------------------------------------------------------ *
 * 设置持久化
 * ------------------------------------------------------------------ */

/** @param {any} input */
function normalizeSettings(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const requested = Array.isArray(raw.metrics) ? raw.metrics : DEFAULT_SETTINGS.metrics;
  const metrics = [...new Set(requested.filter((key) => typeof key === 'string' && METRIC_KEYS.has(key)))];
  const refreshSeconds = REFRESH_CHOICES.includes(Number(raw.refreshSeconds))
    ? Number(raw.refreshSeconds)
    : DEFAULT_SETTINGS.refreshSeconds;
  const theme = THEME_CHOICES.includes(raw.theme) ? raw.theme : DEFAULT_SETTINGS.theme;
  const trendPeriod = normalizeTrendMinutes(raw.trendPeriod);
  const language = LANGUAGE_CHOICES.includes(raw.language) ? raw.language : DEFAULT_SETTINGS.language;
  const rawScale = Number(raw.scale);
  const scale = Number.isFinite(rawScale)
    ? Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(rawScale * 100) / 100))
    : DEFAULT_SETTINGS.scale;
  let position = null;
  if (raw.position && typeof raw.position === 'object') {
    const x = Number(raw.position.x);
    const y = Number(raw.position.y);
    if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 100000 && Math.abs(y) <= 100000) {
      position = { x: Math.round(x), y: Math.round(y) };
    }
  }
  const centerMetric = GAUGE_CENTER_CHOICES.includes(raw.centerMetric)
    ? raw.centerMetric
    : DEFAULT_SETTINGS.centerMetric;
  const waterMetric = GAUGE_WATER_CHOICES.includes(raw.waterMetric)
    ? raw.waterMetric
    : DEFAULT_SETTINGS.waterMetric;
  const ringMetric = GAUGE_RING_CHOICES.includes(raw.ringMetric)
    ? raw.ringMetric
    : DEFAULT_SETTINGS.ringMetric;
  return { metrics, refreshSeconds, theme, scale, trendPeriod, language, position, centerMetric, waterMetric, ringMetric };
}

/**
 * @param {string} dataDir
 * @returns {Promise<{path: string, settings: any}>}
 */
async function readSettings(dataDir) {
  const path = join(dataDir, 'settings.json');
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    return { path, settings: normalizeSettings(parsed) };
  } catch {
    return { path, settings: normalizeSettings(DEFAULT_SETTINGS) };
  }
}

/**
 * @param {string} dataDir
 * @param {any} settings
 */
async function writeSettings(dataDir, settings) {
  const path = join(dataDir, 'settings.json');
  await mkdir(dataDir, { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, JSON.stringify(settings, null, 2), 'utf8');
  await rename(temporary, path);
  return settings;
}

/* ------------------------------------------------------------------ *
 * HTTP 服务
 * ------------------------------------------------------------------ */

const CLIENT_ASSETS = {
  '/assets/base.css': 'text/css; charset=utf-8',
  '/assets/metrics.js': 'text/javascript; charset=utf-8',
  '/assets/widget.js': 'text/javascript; charset=utf-8',
  '/assets/settings.js': 'text/javascript; charset=utf-8',
};

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {unknown} payload
 */
function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(body);
}

/**
 * @param {MiniAppContext} context
 * @returns {Promise<MiniAppLifecycle>}
 */
export async function start(context) {
  const clientDir = join(context.pluginRoot, 'miniapp', 'client');
  /** @type {Map<string, { body: Buffer, mtimeMs: number }>} */
  const assetCache = new Map();
  // 每次运行态启动生成新的资源版本号：浏览器不会再沿用上一次留下的模块缓存，
  // 升级后打开设置页也能立刻拿到最新脚本。
  const assetVersion = Date.now().toString(36);

  /**
   * @param {string} name
   * @param {string} contentType
   * @param {import('node:http').ServerResponse} response
   */
  /**
   * 给静态资源引用加上版本号，浏览器不会沿用上一次的缓存。
   * @param {string} body
   * @param {string} contentType
   * @returns {string}
   */
  function withAssetVersion(body, contentType) {
    const text = body.toString('utf8');
    if (contentType.includes('html')) {
      return text.replace(/(\/assets\/[A-Za-z0-9_.-]+)(["'])/g, `$1?v=${assetVersion}$2`);
    }
    return text;
  }

  /**
   * 把 ES 模块语法转成普通脚本：内联同目录依赖、去掉 import/export。
   * 这样即使浏览器缓存了旧版 HTML（用普通 <script> 引用脚本），
   * 新版脚本依然能被解析，不会因为一句 export 直接整页崩掉。
   * @param {string} text
   * @returns {Promise<string>}
   */
  /**
   * 去掉 export 语法：export { a, b } 语句与 export 声明前缀。
   * @param {string} text
   * @returns {string}
   */
  function stripModuleSyntax(text) {
    let out = text.replace(/^[ \t]*export\s*\{[^}]*\};?[ \t]*$/gm, '');
    out = out.replace(/^([ \t]*)export[ \t]+(?=(?:const|let|var|function|async|class)\b)/gm, '$1');
    return out;
  }

  /** 客户端模块之间的相对 import。 */
  const CLIENT_IMPORT_PATTERN = /import\s*\{([^}]*)\}\s*from\s*['"]\.\/([^'"]+)['"];?/g;

  /**
   * 列出脚本引用了哪些同目录模块。
   * @param {string} text
   * @returns {string[]}
   */
  function importDeps(text) {
    const deps = [];
    const pattern = new RegExp(CLIENT_IMPORT_PATTERN.source, 'g');
    let match = pattern.exec(text);
    while (match !== null) {
      if (!deps.includes(match[2])) deps.push(match[2]);
      match = pattern.exec(text);
    }
    return deps;
  }

  /**
   * 依赖脚本的全局名。
   * @param {string} dep
   * @returns {string}
   */
  function dependencyGlobal(dep) {
    return `window.__tokenUsage_${dep.replace(/[^A-Za-z0-9]/g, '')}`;
  }

  /**
   * 取依赖脚本导出的名字。
   * @param {string} text
   * @returns {string[]}
   */
  function exportNames(text) {
    const exported = [];
    const declPattern = /export\s+(?:const|let|var|function|async\s+function|class)\s+([A-Za-z0-9_$]+)/g;
    let match = declPattern.exec(text);
    while (match !== null) {
      exported.push(match[1]);
      match = declPattern.exec(text);
    }
    const listPattern = /export\s*\{([^}]*)\}/g;
    match = listPattern.exec(text);
    while (match !== null) {
      for (const part of match[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop();
        if (name) exported.push(name);
      }
      match = listPattern.exec(text);
    }
    return exported;
  }

  /**
   * 把依赖脚本包进 IIFE 并挂到全局，避免顶层常量与主脚本重复声明。
   *
   * 依赖还有依赖时按同样方式递归内联：只处理一层的话，
   * 嵌套的 import 会留在 IIFE 里，在普通脚本里就成了非法语法。
   *
   * 同一个模块只内联一次：i18n 这类带运行时状态的模块如果被复制成两份，
   * 两份的状态就会各走各的，界面上会出现两种语言。
   * @param {string} text 主脚本
   * @returns {Promise<string>}
   */
  async function toPlainScript(text) {
    /** @type {Map<string, string>} */
    const sources = new Map();
    /** @type {string[]} */
    const order = [];
    /** @type {Set<string>} */
    const visiting = new Set();

    const collect = async (dep) => {
      if (sources.has(dep) || visiting.has(dep)) return;
      visiting.add(dep);
      const depText = await readFile(join(clientDir, dep), 'utf8');
      for (const child of importDeps(depText)) {
        await collect(child);
      }
      visiting.delete(dep);
      sources.set(dep, depText);
      order.push(dep);
    };

    for (const dep of importDeps(text)) {
      await collect(dep);
    }

    const parts = [];
    for (const dep of order) {
      const depText = sources.get(dep) || '';
      const exported = exportNames(depText);
      const body = stripModuleSyntax(
        depText.replace(
          CLIENT_IMPORT_PATTERN,
          (full, names, name) => `const { ${String(names).trim()} } = ${dependencyGlobal(name)};`,
        ),
      );
      parts.push(`${dependencyGlobal(dep)} = (function () {\n${body}\nreturn { ${exported.join(', ')} };\n})();`);
    }

    let out = text.replace(
      CLIENT_IMPORT_PATTERN,
      (full, names, dep) => `const { ${String(names).trim()} } = ${dependencyGlobal(dep)};`,
    );
    out = stripModuleSyntax(out);
    return parts.length ? parts.join('\n') + '\n' + out : out;
  }

  async function sendFile(name, contentType, response) {
    const filePath = join(clientDir, name);
    let mtimeMs = 0;
    try {
      mtimeMs = (await stat(filePath)).mtimeMs;
    } catch {
      mtimeMs = 0;
    }
    const cached = assetCache.get(name);
    let body = cached ? cached.body : null;
    if (!body || cached.mtimeMs !== mtimeMs) {
      body = await readFile(filePath);
      assetCache.set(name, { body, mtimeMs });
    }
    response.writeHead(200, {
      'content-type': contentType,
      'cache-control': 'no-store',
    });
    const payload = contentType.includes('javascript')
      ? await toPlainScript(body.toString('utf8'))
      : withAssetVersion(body.toString('utf8'), contentType);
    response.end(payload);
  }

  /** @type {any} */
  let cachedSnapshot = null;
  let cachedAt = 0;
  const SNAPSHOT_TTL_MS = 15000;
  /** 页面侧回报的窗口状态（悬浮窗是独立窗口，页面里的状态在别处看不到）。 */
  /** @type {any} */
  let clientReport = null;

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://miniapp.local');
    const path = url.pathname;
    const method = request.method ?? 'GET';

    /** @type {Promise<void>} */
    (async () => {
      if (method === 'GET' && (path === '/widget' || path === '/')) {
        await sendFile('index.html', 'text/html; charset=utf-8', response);
        return;
      }
      if (method === 'GET' && path === '/settings') {
        // 设置页与悬浮窗共用同一份文档，用地址区分视图。
        await sendFile('index.html', 'text/html; charset=utf-8', response);
        return;
      }
      if (method === 'GET' && CLIENT_ASSETS[path]) {
        await sendFile(path.replace('/assets/', ''), CLIENT_ASSETS[path], response);
        return;
      }
      if (method === 'POST' && path === '/api/client-report') {
        const raw = await readRequestBody(request);
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          const win = raw.geometry && typeof raw.geometry === 'object' ? raw.geometry : null;
          clientReport = {
            mode: String(raw.mode || ''),
            view: String(raw.view || ''),
            clickThrough: raw.clickThrough === null || raw.clickThrough === undefined
              ? null
              : Boolean(raw.clickThrough),
            geometry: win
              ? {
                x: numberValue(win.x),
                y: numberValue(win.y),
                width: numberValue(win.width),
                height: numberValue(win.height),
              }
              : null,
            at: numberValue(raw.at) || Date.now(),
          };
        }
        sendJson(response, 200, { ok: true });
        return;
      }
      if (method === 'GET' && path === '/api/state') {
        const now = Date.now();
        if (!cachedSnapshot || now - cachedAt > SNAPSHOT_TTL_MS) {
          const account = await fetchAccount();
          const { settings } = await readSettings(context.dataDir);
          // 账号速率：额度窗口差分拿节奏，日累计增量拿量纲
          const rateState = await readAccountRateState(context.dataDir);
          sampleAccountWindow(rateState, now, account);
          sampleAccountCounter(rateState, now, account);
          calibrateAccountRate(rateState, now, account);
          const accountRate = computeAccountRate(rateState, now, account, settings.trendPeriod);
          await writeAccountRateState(context.dataDir, rateState);
          cachedSnapshot = {
            updatedAt: now,
            settings,
            catalog: METRIC_CATALOG,
            coreMetrics: CORE_METRIC_KEYS,
            account,
            accountRate,
          };
          cachedAt = now;
        }
        sendJson(response, 200, Object.assign({}, cachedSnapshot, { clientReport }));
        return;
      }
      if (method === 'GET' && path === '/api/settings') {
        const { settings } = await readSettings(context.dataDir);
        sendJson(response, 200, { settings, catalog: METRIC_CATALOG });
        return;
      }
      if ((method === 'PUT' || method === 'POST') && path === '/api/settings') {
        const raw = await readRequestBody(request);
        if (raw === null) {
          sendJson(response, 400, { error: 'invalid_json', message: '设置内容不是有效的 JSON', messageEn: 'The settings payload is not valid JSON' });
          return;
        }
        // 只合并请求里真正带上的字段。整份覆盖会让任何一个拿着过期副本的客户端
        // （比如运行态重启后没刷新成功的悬浮窗）把用户别的选择一起抹掉。
        const { settings: stored } = await readSettings(context.dataDir);
        const patch = {};
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          for (const key of Object.keys(raw)) {
            const value = raw[key];
            if (value === undefined) continue;
            if (value === null && key !== 'position') continue;
            patch[key] = value;
          }
        }
        const settings = normalizeSettings({ ...stored, ...patch });
        await writeSettings(context.dataDir, settings);
        cachedSnapshot = null;
        cachedAt = 0;
        sendJson(response, 200, { settings, catalog: METRIC_CATALOG });
        return;
      }
      sendJson(response, 404, { error: 'not_found' });
    })().catch((error) => {
      context.logger.error('miniapp.request.failed', { message: String(error && error.message) });
      if (!response.headersSent) {
        sendJson(response, 500, { error: 'internal_error', message: '服务处理请求时出错', messageEn: 'The service failed to handle the request' });
      } else {
        response.end();
      }
    });
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(context.listen.port, context.listen.host, () => {
      server.off('error', onError);
      resolve(undefined);
    });
  });
  context.logger.info('miniapp.token.listening');

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    context.signal.removeEventListener('abort', onAbort);
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  };
  const onAbort = () => {
    void dispose();
  };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  return { dispose };
}

/**
 * @param {import('node:http').IncomingMessage} request
 * @returns {Promise<any | null>}
 */
function readRequestBody(request) {
  return new Promise((resolve) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > 256 * 1024) {
        request.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve(null);
      }
    });
    request.on('error', () => resolve(null));
  });
}
