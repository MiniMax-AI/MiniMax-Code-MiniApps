// Token 用量悬浮窗 — 指标计算与格式化

import { GAUGE_LABELS, GAUGE_SHORT_LABELS, localized, t } from './i18n.js';

export const DEFAULT_THEME = 'system';

/**
 * 只取整数量级，不留小数点。
 * @param {number} numeric
 */
function formatWholeTokens(numeric) {
  const abs = Math.abs(numeric);
  if (abs >= 1e9) return Math.round(numeric / 1e9) + 'B';
  if (abs >= 1e6) {
    const millions = Math.round(numeric / 1e6);
    return millions >= 1000 ? Math.round(millions / 1000) + 'B' : millions + 'M';
  }
  if (abs >= 1e3) {
    const thousands = Math.round(numeric / 1e3);
    return thousands >= 1000 ? Math.round(thousands / 1000) + 'M' : thousands + 'K';
  }
  return String(Math.round(numeric));
}

/**
 * @param {number} value
 * @param {{ integer?: boolean }} [options] integer 为真时只显示整数数量级
 */
export function formatTokens(value, options) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return '0';
  if (options && options.integer) return formatWholeTokens(numeric);
  const abs = Math.abs(numeric);
  if (abs >= 1e9) return (numeric / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (numeric / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return (numeric / 1e3).toFixed(1) + 'K';
  return String(Math.round(numeric));
}

/** @param {number | null | undefined} value */
export function formatDuration(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '--';
  const totalMinutes = Math.floor(Number(value) / 60000);
  if (totalMinutes < 1) return t('duration.lessThan1m');
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return t('duration.days', { days, hours });
  if (hours > 0) return t('duration.hours', { hours, minutes });
  return t('duration.minutes', { minutes });
}

/** @param {number | null | undefined} value */
export function formatClock(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '--';
  const date = new Date(Number(value));
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return t('clock.format', { month, day, time: hours + ':' + minutes });
}

/** @param {number | null | undefined} value */
export function formatPercent(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '--';
  const numeric = Number(value);
  return (Math.round(numeric * 10) / 10).toString();
}

/**
 * 当天 Token：优先用实时口径（账号总览接口每 30~60 秒刷新），
 * 拿不到再退回按天汇总（那个是滞后的批量快照）。
 * @param {any} usage
 */
function realTimeToday(usage) {
  const real = usage && usage.realTime;
  if (real && real.available) return Number(real.todayTotal) || 0;
  return Number(usage && usage.day && usage.day.total) || 0;
}

/**
 * 近 7 天 Token：同上。
 * @param {any} usage
 */
function realTimeSevenDays(usage) {
  const real = usage && usage.realTime;
  if (real && real.available) return Number(real.sevenDayTotal) || 0;
  return Number(usage && usage.sevenDayTotal) || 0;
}

/**
 * 按天用量汇总的更新时间标注。
 * 平台整点批量刷新，这行字说明这个数是新是旧。
 * @param {any} usage
 */
function usageUpdateNote(usage) {
  const text = usage && typeof usage.lastUpdateText === 'string' ? usage.lastUpdateText : '';
  const stamp = Number(usage && usage.lastUpdateAt);
  if (Number.isFinite(stamp) && stamp > 0) {
    const date = new Date(stamp);
    const today = new Date();
    const sameDay = date.getFullYear() === today.getFullYear()
      && date.getMonth() === today.getMonth()
      && date.getDate() === today.getDate();
    if (sameDay) {
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return t('updatedAt', { time: hours + ':' + minutes });
    }
    return t('updatedAt', { time: text });
  }
  return text ? t('updatedAt', { time: text }) : '';
}

/**
 * 速率的实际统计窗口：攒够标称窗口就显示整窗，不够就显示真实跨度，
 * 免得把「实际只有 1.5 分钟」读成「10 分钟平均」。
 * @param {number | null | undefined} spanMinutes 实际覆盖分钟数
 * @param {number} nominalMinutes 标称窗口分钟数
 * @returns {string}
 */
function windowSpanText(spanMinutes, nominalMinutes) {
  const span = Number(spanMinutes);
  if (!Number.isFinite(span) || span <= 0) return t('windowSpan.minutes', { minutes: nominalMinutes });
  if (span >= nominalMinutes) return t('windowSpan.minutes', { minutes: nominalMinutes });
  return t('windowSpan.minutes', { minutes: span.toFixed(1) });
}

/**
 * 生成可无缝循环的水波路径。
 * @param {number} amplitude 振幅
 * @param {number} period 完整周期
 * @param {number} from 起点
 * @param {number} to 终点
 * @param {number} bottom 填充底部
 */
function round(value) {
  return Math.round(value * 100) / 100;
}

export function wavePath(amplitude, period, from, to, bottom) {
  const half = period / 2;
  const segments = Math.ceil((to - from) / half);
  let path = 'M ' + from + ' 0';
  for (let index = 0; index < segments; index += 1) {
    const start = from + index * half;
    const end = start + half;
    const direction = index % 2 === 0 ? 1 : -1;
    const control1 = start + half / 3;
    const control2 = start + (2 * half) / 3;
    path += ' C ' + round(control1) + ' ' + round(direction * amplitude) + ' ' + round(control2) + ' ' + round(direction * amplitude) + ' ' + round(end) + ' 0';
  }
  return path + ' L ' + to + ' ' + bottom + ' L ' + from + ' ' + bottom + ' Z';
}

/** @param {string} key */
export function metricRow(key, snapshot) {
  const account = snapshot && snapshot.account ? snapshot.account : {};
  const accountRate = snapshot && snapshot.accountRate ? snapshot.accountRate : {};
  const quota = account.quota || {};
  const fiveHour = quota.fiveHour || {};
  const weekly = quota.weekly || {};
  const usage = account.usage || {};
  const day = usage.day || {};

  switch (key) {
    case 'five_hour_ratio':
      return {
        value: formatPercent(fiveHour.usedPercent) + '%',
        sub: t('sub.periodEnd', { time: formatClock(fiveHour.resetAt) }),
      };
    case 'today_total':
      return {
        value: formatTokens(realTimeToday(usage)),
        sub: usage && usage.realTime && usage.realTime.available
          ? t('sub.accountTodayLive')
          : [t('sub.accountToday'), usageUpdateNote(usage)].filter(Boolean).join(' · '),
      };
    case 'week_ratio':
      return {
        value: formatPercent(weekly.usedPercent) + '%',
        sub: t('sub.periodEnd', { time: formatClock(weekly.resetAt) }),
      };
    case 'seven_day_total':
      return {
        value: formatTokens(realTimeSevenDays(usage)),
        sub: usage && usage.realTime && usage.realTime.available
          ? t('sub.account7dLive')
          : [t('sub.account7d'), usageUpdateNote(usage)].filter(Boolean).join(' · '),
      };
    case 'reset_countdown':
      return {
        value: formatDuration(fiveHour.remainingMs),
        sub: t('sub.fiveHourRemaining'),
      };
    case 'weekly_countdown':
      return {
        value: formatDuration(weekly.remainingMs),
        sub: t('sub.weeklyRemaining'),
      };
    case 'cache_hit':
      return {
        value: formatPercent(day.cacheHitPercent) + '%',
        sub: t('sub.platformToday'),
      };
    case 'io_split':
      return {
        value: formatTokens(day.input) + ' / ' + formatTokens(day.output),
        sub: t('sub.ioToday'),
      };
    case 'account_rate_10m':
      if (!accountRate.ok) return { value: '--', sub: t('sub.accountCycleUnavailable') };
      if (!accountRate.rate10Ready) return { value: '--', sub: t('sub.notEnoughData') };
      return {
        value: formatTokens(accountRate.tokensPerMinute10m) + t('unit.perMinute'),
        sub: t('sub.actualWindow', {
          window: windowSpanText(accountRate.span10m, 10),
          value: formatTokens(accountRate.tokens10m),
        }),
      };
    case 'account_rate_30m':
      if (!accountRate.ok) return { value: '--', sub: t('sub.accountCycleUnavailable') };
      if (!accountRate.rate30Ready) return { value: '--', sub: t('sub.notEnoughData') };
      return {
        value: formatTokens(accountRate.tokensPerMinute30m) + t('unit.perMinute'),
        sub: t('sub.actualWindow', {
          window: windowSpanText(accountRate.span30m, 30),
          value: formatTokens(accountRate.tokens30m),
        }),
      };
    default:
      return null;
  }
}

/**
 * @param {any} snapshot
 * @param {any} settings
 * @param {any[]} catalog
 */
export function buildRows(snapshot, settings, catalog) {
  const order = (settings && settings.metrics) || [];
  const enabled = new Set(order);
  const computed = new Map();
  for (const item of catalog || []) {
    if (!item.core && !enabled.has(item.key)) continue;
    const value = metricRow(item.key, snapshot);
    if (!value) continue;
    computed.set(item.key, {
      key: item.key,
      label: localized(item.label),
      value: value.value,
      sub: value.sub,
    });
  }
  const rows = [];
  for (const item of catalog || []) {
    if (item.core && computed.has(item.key)) rows.push(computed.get(item.key));
  }
  for (const key of order) {
    const row = computed.get(key);
    if (row && !rows.includes(row)) rows.push(row);
  }
  return rows;
}

/* ---------- 用量颜色渐变 ---------- */

/**
 * 紧急程度配色：全程冷蓝，越满越深；≥90% 直接切红表示预警。
 *
 * 之前走的是「蓝 → 青 → 黄 → 橙 → 红」，青到黄之间必然穿过绿色，
 * 50% 一带的水面就变成了浑浊的屎黄。现在整段只留在蓝色族里做渐变，
 * 中间不出现绿、紫、品红任何一档。预警则由蓝直接切红——
 * 报警本来就该是突变，而不是慢慢化过去；
 * 真要在蓝和红之间插值，中间必然闪出品红。
 */
const RAMP_STOPS = [
  { ratio: 0, lch: [0.68, 0.095, 236] },
  { ratio: 0.4, lch: [0.625, 0.125, 242] },
  { ratio: 0.72, lch: [0.555, 0.145, 250] },
  { ratio: 0.89, lch: [0.5, 0.15, 258] },
].map((stop) => ({ ratio: stop.ratio, lch: [stop.lch[0], stop.lch[1], (stop.lch[2] * Math.PI) / 180] }));

/** 预警阈值：越过它直接给红，不在蓝与红之间过渡。 */
const ALARM_RATIO = 0.9;
const ALARM_STOPS = [
  { ratio: 0.9, lch: [0.545, 0.18, 375] },
  { ratio: 1, lch: [0.515, 0.195, 384] },
].map((stop) => ({ ratio: stop.ratio, lch: [stop.lch[0], stop.lch[1], (stop.lch[2] * Math.PI) / 180] }));

/**
 * RGB → OKLCh（明度 / 彩度 / 色相）。
 * @param {number[]} color
 */
function rgbToOklch(color) {
  const lab = rgbToOklab(color);
  return [lab[0], Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]), Math.atan2(lab[2], lab[1])];
}

/**
 * OKLCh → RGB。
 * @param {number[]} lch
 */
function oklchToRgb(lch) {
  return oklabToRgb([lch[0], lch[1] * Math.cos(lch[2]), lch[1] * Math.sin(lch[2])]);
}



/** @param {number} value */
function srgbToLinear(value) {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** @param {number} value */
function linearToSrgb(value) {
  const c = Math.max(0, Math.min(1, value));
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(v * 255);
}

/** @param {number[]} color */
function rgbToOklab(color) {
  const r = srgbToLinear(color[0]);
  const g = srgbToLinear(color[1]);
  const b = srgbToLinear(color[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** @param {number[]} lab */
function oklabToRgb(lab) {
  const l = Math.pow(lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2], 3);
  const m = Math.pow(lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2], 3);
  const s = Math.pow(lab[0] - 0.0894841775 * lab[1] - 1.291485548 * lab[2], 3);
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/**
 * 在 OKLab 感知空间混合，避免蓝→橙过渡时出现发灰的中间色。
 * @param {number[]} a
 * @param {number[]} b
 * @param {number} t
 */
function mixColor(a, b, t) {
  const ratio = Math.max(0, Math.min(1, t));
  const labA = rgbToOklab(a);
  const labB = rgbToOklab(b);
  return oklabToRgb([
    labA[0] + (labB[0] - labA[0]) * ratio,
    labA[1] + (labB[1] - labA[1]) * ratio,
    labA[2] + (labB[2] - labA[2]) * ratio,
  ]);
}

/**
 * 用量比例 → 颜色：清蓝（宽裕）→ 深蓝（接近上限）→ 切红（≥90% 预警）。
 * 在 OKLCh 空间按停靠点插值，明度与彩度同步过渡，整段都是实色不会发灰。
 * @param {number} ratio 0~1
 */
export function rampColor(ratio) {
  const value = Math.max(0, Math.min(1, Number(ratio) || 0));
  // 预警段：越过阈值直接给红，不做插值，免得中间闪出品红
  if (value >= ALARM_RATIO) {
    const alarmFrom = ALARM_STOPS[0];
    const alarmTo = ALARM_STOPS[ALARM_STOPS.length - 1];
    const alarmSpan = alarmTo.ratio - alarmFrom.ratio;
    const alarmT = alarmSpan > 0
      ? Math.max(0, Math.min(1, (value - alarmFrom.ratio) / alarmSpan))
      : 0;
    return oklchToRgb([
      alarmFrom.lch[0] + (alarmTo.lch[0] - alarmFrom.lch[0]) * alarmT,
      alarmFrom.lch[1] + (alarmTo.lch[1] - alarmFrom.lch[1]) * alarmT,
      alarmFrom.lch[2] + (alarmTo.lch[2] - alarmFrom.lch[2]) * alarmT,
    ]);
  }
  let from = RAMP_STOPS[0];
  let to = RAMP_STOPS[RAMP_STOPS.length - 1];
  for (let index = 0; index < RAMP_STOPS.length - 1; index += 1) {
    if (value >= RAMP_STOPS[index].ratio && value <= RAMP_STOPS[index + 1].ratio) {
      from = RAMP_STOPS[index];
      to = RAMP_STOPS[index + 1];
      break;
    }
  }
  const span = to.ratio - from.ratio;
  const t = span > 0 ? Math.max(0, Math.min(1, (value - from.ratio) / span)) : 0;
  return oklchToRgb([
    from.lch[0] + (to.lch[0] - from.lch[0]) * t,
    from.lch[1] + (to.lch[1] - from.lch[1]) * t,
    from.lch[2] + (to.lch[2] - from.lch[2]) * t,
  ]);
}

/**
 * 降低鲜艳度（与灰度混合），保留色相。
 * @param {number[]} color
 * @param {number} amount 0~1
 */
export function desaturate(color, amount) {
  const lab = rgbToOklab(color);
  const ratio = 1 - Math.max(0, Math.min(1, amount));
  return oklabToRgb([lab[0], lab[1] * ratio, lab[2] * ratio]);
}

/**
 * @param {number[]} color
 * @param {number} amount 0~1
 */
export function lightenColor(color, amount) {
  return mixColor(color, [255, 255, 255], amount);
}

/**
 * @param {number[]} color
 */
export function toRgb(color) {
  return 'rgb(' + color[0] + ', ' + color[1] + ', ' + color[2] + ')';
}

/**
 * @param {number[]} color
 * @param {number} alpha 0~1
 */
export function toRgba(color, alpha) {
  return 'rgba(' + color[0] + ', ' + color[1] + ', ' + color[2] + ', ' + alpha + ')';
}

/**
 * @param {any} snapshot
 * @param {any[]} catalog
 */
export function sourceStates(snapshot) {
  const account = snapshot && snapshot.account ? snapshot.account : {};
  return [
    {
      name: t('source.account'),
      detail: account.ok
        ? t('source.accountDetail')
        : localized({ zh: account.message, en: account.messageEn }) || t('source.unavailable'),
      ok: Boolean(account.ok),
    },
  ];
}

/**
 * @param {string} preference
 * @param {string | null} hostTheme
 */
export function resolveTheme(preference, hostTheme) {
  if (preference === 'light' || preference === 'dark') return preference;
  if (hostTheme === 'light' || hostTheme === 'dark') return hostTheme;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** @param {string} theme */
export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
}

/* ---------- 圆盘三处可选指标 ---------- */

/** 圆盘三处各自的可选指标（按指标键）。 */
const GAUGE_OPTION_KEYS = {
  center: [
    'five_hour_ratio',
    'week_ratio',
    'account_rate_10m',
    'account_rate_30m',
    'today_total',
    'seven_day_total',
  ],
  water: ['five_hour_ratio', 'week_ratio'],
  ring: [
    'five_hour_ratio',
    'week_ratio',
    'five_hour_countdown',
    'weekly_countdown',
    'account_rate_10m',
    'account_rate_30m',
  ],
};

/**
 * 圆盘某处的可选项，名称按当前语言给出。
 * @param {'center' | 'water' | 'ring'} set
 * @returns {{value: string, label: string}[]}
 */
export function gaugeOptions(set) {
  const keys = GAUGE_OPTION_KEYS[set] || [];
  return keys.map((value) => ({ value, label: localized(GAUGE_LABELS[value]) }));
}

/** @param {any} value */
function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

/** @param {number} value */
function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

/**
 * 解析圆盘三处（中心读数 / 水面 / 外圈）当前要显示的指标。
 * 速率类按账号实时 Token 累计的差分取数。
 * @param {any} snapshot
 * @param {any} settings
 */
export function gaugeSelection(snapshot, settings) {
  const account = snapshot && snapshot.account ? snapshot.account : {};
  const accountRate = snapshot && snapshot.accountRate ? snapshot.accountRate : {};
  const quota = account.quota || {};
  const fiveHour = quota.fiveHour || {};
  const weekly = quota.weekly || {};
  const usage = account.usage || {};
  const day = usage.day || {};

  const accountRateOf = (minutes) => {
    const ready = minutes === 10 ? accountRate.rate10Ready : accountRate.rate30Ready;
    const value = toNumber(minutes === 10 ? accountRate.tokensPerMinute10m : accountRate.tokensPerMinute30m);
    if (!ready || value <= 0) return null;
    return { value, estimated: !accountRate.rateExact };
  };

  const rateOf = (key) => {
    if (key === 'account_rate_10m') return accountRateOf(10);
    if (key === 'account_rate_30m') return accountRateOf(30);
    return null;
  };

  const describe = (key) => {
    const label = localized(GAUGE_SHORT_LABELS[key]);
    if (key === 'five_hour_ratio' || key === 'week_ratio') {
      const source = key === 'five_hour_ratio' ? fiveHour : weekly;
      const percent = Number(source.usedPercent);
      const known = source.usedPercent !== null && source.usedPercent !== undefined && Number.isFinite(percent);
      return {
        key,
        label,
        value: known ? formatPercent(percent) + '%' : '--',
        unit: '',
        ratio: known ? clamp01(percent / 100) : null,
      };
    }
    if (key.indexOf('rate_') >= 0) {
      const rate = rateOf(key);
      return {
        key,
        label,
        value: rate ? formatTokens(rate.value) : '--',
        unit: rate ? t('unit.perMinute') : '',
        ratio: null,
        estimated: Boolean(rate && rate.estimated),
      };
    }
    if (key === 'today_total') {
      // 圆盘中心的消耗量只取整数量级，不留小数点
      return { key, label, value: formatTokens(realTimeToday(usage), { integer: true }), unit: '', ratio: null };
    }
    if (key === 'seven_day_total') {
      return { key, label, value: formatTokens(realTimeSevenDays(usage), { integer: true }), unit: '', ratio: null };
    }
    if (key === 'five_hour_countdown' || key === 'weekly_countdown') {
      const source = key === 'five_hour_countdown' ? fiveHour : weekly;
      const remaining = toNumber(source.remainingMs);
      const duration = toNumber(source.resetAt) - toNumber(source.startAt);
      const fraction = duration > 0 ? clamp01(remaining / duration) : 0;
      return { key, label, value: formatDuration(remaining), unit: '', ratio: fraction, remaining: fraction };
    }
    return { key, label, value: '--', unit: '', ratio: null };
  };

  // 按当前速率推算：到 5 小时窗口结束时，额度会被烧掉多少
  const projectedBurn = (key) => {
    const rate = rateOf(key);
    const perPoint = toNumber(accountRate.tokensPerPoint);
    if (!rate || perPoint <= 0) return null;
    const pointsPerMinute = rate.value / perPoint;
    const remainingMinutes = Math.max(0, (toNumber(fiveHour.resetAt) - Date.now()) / 60000);
    return clamp01((pointsPerMinute * remainingMinutes) / 100);
  };

  const pick = (keys, value, fallback) => (keys.includes(value) ? value : fallback);
  const centerKey = pick(GAUGE_OPTION_KEYS.center, settings && settings.centerMetric, 'five_hour_ratio');
  const waterKey = pick(GAUGE_OPTION_KEYS.water, settings && settings.waterMetric, 'five_hour_ratio');
  const ringKey = pick(GAUGE_OPTION_KEYS.ring, settings && settings.ringMetric, 'week_ratio');

  const center = describe(centerKey);
  const water = describe(waterKey);
  const ring = describe(ringKey);

  let ringFill = ring.ratio || 0;
  let ringUrgency = ringFill;
  let ringNote = '';
  if (ringKey === 'five_hour_countdown' || ringKey === 'weekly_countdown') {
    ringFill = ring.remaining || 0;   // 倒计时：环随剩余时间变空
    ringUrgency = 1 - ringFill;       // 越接近重置越告急
  } else if (ringKey.indexOf('rate_') >= 0) {
    const projected = projectedBurn(ringKey);
    ringFill = projected || 0;
    ringUrgency = ringFill;
    ringNote = projected === null ? t('ring.note.needsCalibration') : t('ring.note.projected');
  }

  return {
    center,
    water: { key: waterKey, label: water.label, ratio: water.ratio || 0 },
    ring: {
      key: ringKey,
      label: ring.label,
      value: ring.value,
      unit: ring.unit || '',
      fill: ringFill,
      urgency: ringUrgency,
      note: ringNote,
    },
  };
}
