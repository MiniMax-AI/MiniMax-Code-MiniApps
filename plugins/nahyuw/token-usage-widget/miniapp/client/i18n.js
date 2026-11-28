// Token 用量悬浮窗 — 双语文案与语言解析

/**
 * 语言：简体中文（zh）与英文（en）。
 *
 * 默认跟随系统：系统语言以 zh 开头时用中文，其余语言一律用英文。
 * 用户也可以在设置页显式指定语言，覆盖跟随系统的结果。
 */

/** 界面文案表。占位符用 {name} 形式。 */
const STRINGS = {
  zh: {
    'app.title': 'Token 用量悬浮窗',
    'widget.title': 'Token 用量',
    'widget.desc': '实时查看当前 5 小时与 7 天周期进度、Token 速率与消耗量',
    'scale.title': '缩放悬浮窗（⌘/Ctrl + 滚轮）',
    'popup.mode': '悬浮窗模式',
    'gauge.aria': 'Token 用量水位，点击进入设置',
    'detail.aria': 'Token 用量详情',
    'detail.title': '用量详情',
    'spark.aria': '最近 7 天 Token 用量',
    'settings.drag.title': '拖动可移动窗口',
    'settings.title': 'Token 用量设置',
    'settings.desc': '选择悬浮窗要展示的指标，并调整刷新频率与外观。',
    'settings.back': '返回悬浮窗',
    'section.metrics': '展示指标',
    'section.metrics.hint': '勾选的指标会出现在悬浮窗的详情面板中，拖动左侧手柄可调整面板里的先后顺序（也可用 Alt + ↑/↓）。',
    'section.refresh': '刷新频率',
    'section.refresh.hint': '悬浮窗多久读取一次用量数据。',
    'field.refresh': '刷新间隔',
    'field.refresh.hint': '账号额度数据本身按分钟级变化，不必过于频繁',
    'section.widget': '悬浮窗',
    'section.widget.hint': '悬浮窗模式下，拖动圆形或顶部手柄即可移动窗口，⌘/Ctrl + 滚轮可即时缩放；设置页顶部的手柄同样可以拖动窗口。',
    'field.size': '大小',
    'field.size.hint': '圆形与详情面板同步缩放，共 5 档：最小 / 小 / 中 / 大 / 最大',
    'field.position': '位置',
    'field.position.hint': '拖动悬浮窗后的位置会被记住',
    'action.resetPosition': '重置位置',
    'field.trendPeriod': '趋势周期',
    'field.trendPeriod.hint': '圆盘里那条趋势曲线的统计窗口',
    'section.gauge': '圆盘显示',
    'section.gauge.hint': '中心指标、水面高度、外圈进度分别显示哪一项；选速率做外圈时，按当前速度推算 5 小时周期会被烧掉多少。',
    'field.center': '中心指标',
    'field.water': '水面高度',
    'field.ring': '外圈进度',
    'section.appearance': '外观',
    'section.appearance.hint': '跟随系统时，优先使用 MiniMax Code 的界面主题。',
    'field.theme': '主题',
    'field.theme.hint': '影响悬浮窗与设置页配色',
    'field.language': '语言',
    'field.language.hint': '默认跟随系统语言',
    'section.sources': '数据来源',
    'section.sources.hint': '5 小时与 7 天周期进度来自 MiniMax 账号额度接口；当天与最近 7 天用量来自账号用量接口；速率与趋势取账号实时 Token 累计的差分。',
    'action.reset': '恢复默认',
    'option.refresh.3': '3 秒',
    'option.refresh.5': '5 秒',
    'option.refresh.10': '10 秒',
    'option.refresh.30': '30 秒',
    'option.refresh.60': '1 分钟',
    'option.scale.0.4': '最小',
    'option.scale.0.5': '小',
    'option.scale.0.6': '中',
    'option.scale.0.7': '大',
    'option.scale.0.8': '最大',
    'option.theme.system': '跟随系统',
    'option.theme.light': '浅色',
    'option.theme.dark': '深色',
    'option.trendPeriod.10': '10 分钟',
    'option.trendPeriod.30': '30 分钟',
    'option.trendPeriod.60': '60 分钟',
    'option.trendPeriod.120': '2 小时',
    'option.language.system': '跟随系统',
    'option.language.zh': '简体中文',
    'option.language.en': 'English',
    'trend.noData': '暂无数据',
    'trend.steady': '平稳',
    'trend.rising': '上升',
    'trend.falling': '下降',
    'scale.aria.title': '悬浮窗大小：{label}（⌘/Ctrl + 滚轮可缩放）',
    'scale.aria.label': '悬浮窗大小：{label}，⌘/Ctrl + 滚轮可缩放',
    'gaugeLegend.center': '圆盘中心',
    'gaugeLegend.water': '水面',
    'gaugeLegend.ring': '外圈',
    'gaugeLegend.trend': '最近 {minutes} 分钟消耗趋势{trend}',
    'gaugeLegend.settings': '点击进入设置',
    'gaugeLegend.noteWrap': '（{note}）',
    'gaugeLegend.separator': '，',
    'trendLabel.account': '账号口径',
    'detail.stamp': '更新于 {time}',
    'detail.loadError': '读取用量失败：{message}',
    'detail.modeError': '无法切换到悬浮窗模式：{message}',
    'error.unknown': '未知错误',
    'note.accountUnavailable': '账号额度不可用',
    'note.summary': '全部指标都取自账号口径：5 小时与 7 天周期进度来自账号额度接口，当天与最近 7 天用量来自账号用量接口，速率与趋势取账号实时 Token 累计的差分。',
    'note.separator': '；',
    'spark.title': '{date}：{value} tokens',
    'settings.grip.title': '拖动调整顺序',
    'toast.saved': '已保存',
    'toast.saveError': '保存失败：{message}',
    'toast.loadError': '读取用量失败：{message}',
    'trendHint': '账号口径：趋势曲线取账号实时 Token 累计的差分；刚启动还没攒够整个窗口的那段用周期进度标定换算补齐',
    'duration.lessThan1m': '不足 1 分钟',
    'duration.days': '{days} 天 {hours} 小时',
    'duration.hours': '{hours} 小时 {minutes} 分',
    'duration.minutes': '{minutes} 分钟',
    'clock.format': '{month} 月 {day} 日 {time}',
    'updatedAt': '更新于 {time}',
    'windowSpan.minutes': '{minutes} 分钟',
    'unit.perMinute': ' / 分钟',
    'sub.periodEnd': '周期结束 {time}',
    'sub.accountTodayLive': '账号当天累计 · 实时',
    'sub.accountToday': '账号当天累计',
    'sub.account7dLive': '账号最近 7 天（含今天）· 实时',
    'sub.account7d': '账号最近 7 天（含今天）',
    'sub.fiveHourRemaining': '当前 5 小时周期剩余',
    'sub.weeklyRemaining': '当前 7 天周期剩余',
    'sub.platformToday': '当天平台统计',
    'sub.ioToday': '当天输入 / 输出',
    'sub.accountCycleUnavailable': '账号 5 小时周期不可用',
    'sub.notEnoughData': '周期刚重置，数据不足',
    'sub.actualWindow': '实际窗口 {window}，共 {value}',
    'source.account': '账号周期进度与用量',
    'source.accountDetail': 'MiniMax 账号接口返回 5 小时与 7 天周期进度、当天与最近 7 天用量',
    'source.unavailable': '不可用',
    'ring.note.needsCalibration': '需要账号量纲标定',
    'ring.note.projected': '按当前速率推算 5 小时周期消耗',
  },
  en: {
    'app.title': 'Token Usage Widget',
    'widget.title': 'Token Usage',
    'widget.desc': 'Live view of the current 5-hour and 7-day cycle progress, token rate and consumption',
    'scale.title': 'Scale the widget (⌘/Ctrl + scroll)',
    'popup.mode': 'Popup mode',
    'gauge.aria': 'Token usage level, click to open settings',
    'detail.aria': 'Token usage details',
    'detail.title': 'Usage details',
    'spark.aria': 'Token usage over the last 7 days',
    'settings.drag.title': 'Drag to move the window',
    'settings.title': 'Token Usage Settings',
    'settings.desc': 'Choose the metrics shown in the widget and adjust refresh rate and appearance.',
    'settings.back': 'Back to widget',
    'section.metrics': 'Displayed metrics',
    'section.metrics.hint': 'Checked metrics appear in the widget\u2019s detail panel. Drag the left handle to reorder them (Alt + ↑/↓ works too).',
    'section.refresh': 'Refresh rate',
    'section.refresh.hint': 'How often the widget reads usage data.',
    'field.refresh': 'Refresh interval',
    'field.refresh.hint': 'Account quota changes at minute granularity, so no need to poll too often',
    'section.widget': 'Widget window',
    'section.widget.hint': 'In popup mode, drag the circle or the top handle to move the window and ⌘/Ctrl + scroll to resize it live. The handle at the top of this settings page moves the window too.',
    'field.size': 'Size',
    'field.size.hint': 'The circle and the detail panel scale together across 5 steps: Smallest / Small / Medium / Large / Largest',
    'field.position': 'Position',
    'field.position.hint': 'The position after you drag the widget is remembered',
    'action.resetPosition': 'Reset position',
    'field.trendPeriod': 'Trend window',
    'field.trendPeriod.hint': 'The window the trend curve on the dial covers',
    'section.gauge': 'Dial display',
    'section.gauge.hint': 'Which metric fills the centre readout, the water level and the outer ring. When a rate drives the ring, it projects how much of the 5-hour cycle the current speed would burn.',
    'field.center': 'Centre metric',
    'field.water': 'Water level',
    'field.ring': 'Outer ring',
    'section.appearance': 'Appearance',
    'section.appearance.hint': 'When following the system, the MiniMax Code interface theme is preferred.',
    'field.theme': 'Theme',
    'field.theme.hint': 'Affects the widget and the settings page colours',
    'field.language': 'Language',
    'field.language.hint': 'Follows the system language by default',
    'section.sources': 'Data sources',
    'section.sources.hint': 'The 5-hour and 7-day cycle progress comes from the MiniMax account quota API; today and the last 7 days come from the account usage API; the rate and the trend come from the difference of the live account token counter.',
    'action.reset': 'Reset to defaults',
    'option.refresh.3': '3s',
    'option.refresh.5': '5s',
    'option.refresh.10': '10s',
    'option.refresh.30': '30s',
    'option.refresh.60': '1 min',
    'option.scale.0.4': 'Smallest',
    'option.scale.0.5': 'Small',
    'option.scale.0.6': 'Medium',
    'option.scale.0.7': 'Large',
    'option.scale.0.8': 'Largest',
    'option.theme.system': 'System',
    'option.theme.light': 'Light',
    'option.theme.dark': 'Dark',
    'option.trendPeriod.10': '10 min',
    'option.trendPeriod.30': '30 min',
    'option.trendPeriod.60': '60 min',
    'option.trendPeriod.120': '2 hours',
    'option.language.system': 'System',
    'option.language.zh': '简体中文',
    'option.language.en': 'English',
    'trend.noData': 'No data',
    'trend.steady': 'Steady',
    'trend.rising': 'Rising',
    'trend.falling': 'Falling',
    'scale.aria.title': 'Widget size: {label} (⌘/Ctrl + scroll to resize)',
    'scale.aria.label': 'Widget size: {label}, ⌘/Ctrl + scroll to resize',
    'gaugeLegend.center': 'Dial centre',
    'gaugeLegend.water': 'Water',
    'gaugeLegend.ring': 'Ring',
    'gaugeLegend.trend': '{minutes}-minute consumption trend {trend}',
    'gaugeLegend.settings': 'click to open settings',
    'gaugeLegend.noteWrap': '({note})',
    'gaugeLegend.separator': ', ',
    'trendLabel.account': 'Account source',
    'detail.stamp': 'Updated {time}',
    'detail.loadError': 'Failed to load usage: {message}',
    'detail.modeError': 'Could not switch to popup mode: {message}',
    'error.unknown': 'Unknown error',
    'note.accountUnavailable': 'Account quota unavailable',
    'note.summary': 'Every metric uses the account source: the 5-hour and 7-day cycle progress comes from the account quota API, today and the last 7 days from the account usage API, and the rate and the trend from the difference of the live account token counter.',
    'note.separator': '; ',
    'spark.title': '{date}: {value} tokens',
    'settings.grip.title': 'Drag to reorder',
    'toast.saved': 'Saved',
    'toast.saveError': 'Could not save: {message}',
    'toast.loadError': 'Failed to load usage: {message}',
    'trendHint': 'Account source: the trend curve is the difference of the live account token counter; the part of the window that has not accumulated yet is back-filled from cycle progress.',
    'duration.lessThan1m': 'Less than 1 min',
    'duration.days': '{days}d {hours}h',
    'duration.hours': '{hours}h {minutes}m',
    'duration.minutes': '{minutes} min',
    'clock.format': '{month}/{day} {time}',
    'updatedAt': 'Updated {time}',
    'windowSpan.minutes': '{minutes} min',
    'unit.perMinute': ' / min',
    'sub.periodEnd': 'Cycle ends {time}',
    'sub.accountTodayLive': 'Account total today · live',
    'sub.accountToday': 'Account total today',
    'sub.account7dLive': 'Account, last 7 days (incl. today) · live',
    'sub.account7d': 'Account, last 7 days (incl. today)',
    'sub.fiveHourRemaining': 'Left in the current 5-hour cycle',
    'sub.weeklyRemaining': 'Left in the current 7-day cycle',
    'sub.platformToday': 'Platform stats for today',
    'sub.ioToday': 'Input / output today',
    'sub.accountCycleUnavailable': 'Account 5-hour cycle unavailable',
    'sub.notEnoughData': 'Cycle just reset, not enough data',
    'sub.actualWindow': 'Actual window {window}, {value} total',
    'source.account': 'Account cycles and usage',
    'source.accountDetail': 'The MiniMax account API returns 5-hour and 7-day cycle progress, today\u2019s usage and the last 7 days',
    'source.unavailable': 'Unavailable',
    'ring.note.needsCalibration': 'Account calibration required',
    'ring.note.projected': '5-hour cycle burn projected at the current rate',
  },
};

/** 圆盘三处的指标全名（下拉框用）。 */
export const GAUGE_LABELS = {
  five_hour_ratio: { zh: '当前 5 小时周期内使用进度', en: 'Usage in the current 5-hour cycle' },
  week_ratio: { zh: '当前 7 天周期内使用进度', en: 'Usage in the current 7-day cycle' },
  account_rate_10m: { zh: '账号最近 10 分钟 Token 速率', en: 'Account token rate, last 10 minutes' },
  account_rate_30m: { zh: '账号最近 30 分钟 Token 速率', en: 'Account token rate, last 30 minutes' },
  today_total: { zh: '当天消耗 Token', en: 'Tokens used today' },
  seven_day_total: { zh: '最近 7 天消耗 Token', en: 'Tokens used over the last 7 days' },
  five_hour_countdown: { zh: '当前 5 小时周期重置倒计时', en: 'Reset countdown for the current 5-hour cycle' },
  weekly_countdown: { zh: '当前 7 天周期重置倒计时', en: 'Reset countdown for the current 7-day cycle' },
};

/** 圆盘上显示的短名字：空间有限，用下拉框里的全称太长。 */
export const GAUGE_SHORT_LABELS = {
  five_hour_ratio: { zh: '当前 5 小时周期', en: 'Current 5-hour cycle' },
  week_ratio: { zh: '当前 7 天周期', en: 'Current 7-day cycle' },
  account_rate_10m: { zh: '账号最近 10 分钟速率', en: 'Account rate, last 10 min' },
  account_rate_30m: { zh: '账号最近 30 分钟速率', en: 'Account rate, last 30 min' },
  today_total: { zh: '当天消耗 Token', en: 'Tokens today' },
  seven_day_total: { zh: '最近 7 天消耗 Token', en: 'Tokens, last 7 days' },
  five_hour_countdown: { zh: '当前 5 小时周期倒计时', en: '5-hour cycle countdown' },
  weekly_countdown: { zh: '当前 7 天周期倒计时', en: '7-day cycle countdown' },
};

const LOCALE_EVENT = 'token-usage:locale';
const HTML_LANG = { zh: 'zh-CN', en: 'en-US' };

/** @returns {'zh' | 'en'} */
function detectSystemLocale() {
  try {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    if (!nav) return 'en';
    const list = Array.isArray(nav.languages) ? nav.languages.slice() : [];
    if (nav.language) list.push(nav.language);
    for (const tag of list) {
      if (typeof tag !== 'string') continue;
      const lower = tag.toLowerCase();
      if (lower.startsWith('zh')) return 'zh';
      if (lower.startsWith('en')) return 'en';
    }
  } catch {
    /* 取不到系统语言就退回英文 */
  }
  return 'en';
}

/**
 * @param {any} value
 * @returns {'zh' | 'en' | null}
 */
function normalizeLocale(value) {
  if (value === 'zh' || value === 'en') return value;
  return null;
}

let currentLocale = detectSystemLocale();
const listeners = [];

/**
 * 取当前语言的文案。
 * @param {string} key
 * @param {Record<string, any>} [vars] 占位符
 * @returns {string}
 */
export function t(key, vars) {
  const table = STRINGS[currentLocale] || STRINGS.zh;
  let text = table[key];
  if (typeof text !== 'string') text = STRINGS.zh[key];
  if (typeof text !== 'string') return key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) => {
    const value = vars[name];
    return value === undefined || value === null ? match : String(value);
  });
}

/**
 * 取服务端下发的双语字段（{ zh, en }）。
 * @param {any} value
 * @returns {string}
 */
export function localized(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const picked = value[currentLocale];
    if (typeof picked === 'string') return picked;
    if (typeof value.zh === 'string') return value.zh;
  }
  return '';
}

/** @returns {'zh' | 'en'} */
export function getLocale() {
  return currentLocale;
}

/**
 * 把 HTML 里的静态文案替换成当前语言。
 */
export function applyDocumentStrings() {
  try {
    document.documentElement.lang = HTML_LANG[currentLocale] || 'en-US';
    document.title = t('app.title');
    document.querySelectorAll('[data-i18n]').forEach((node) => {
      const key = node.getAttribute('data-i18n');
      if (!key) return;
      node.textContent = t(key);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach((node) => {
      const key = node.getAttribute('data-i18n-aria');
      if (!key) return;
      node.setAttribute('aria-label', t(key));
    });
    document.querySelectorAll('[data-i18n-title]').forEach((node) => {
      const key = node.getAttribute('data-i18n-title');
      if (!key) return;
      node.setAttribute('title', t(key));
    });
  } catch {
    /* 文档还没就绪时忽略 */
  }
}

function emit() {
  for (const listener of listeners.slice()) {
    try {
      listener(currentLocale);
    } catch {
      /* 单个监听器出错不影响其它 */
    }
  }
}

/**
 * 注册语言变化回调。
 * @param {(locale: 'zh' | 'en') => void} listener
 */
export function onLocaleChange(listener) {
  if (typeof listener === 'function') listeners.push(listener);
}

/**
 * 切换语言。'system' 表示跟随系统。
 * @param {'system' | 'zh' | 'en'} preference
 */
export function setLocale(preference) {
  const next = normalizeLocale(preference) || detectSystemLocale();
  const changed = next !== currentLocale;
  currentLocale = next;
  applyDocumentStrings();
  if (changed) emit();
  try {
    window.dispatchEvent(new CustomEvent(LOCALE_EVENT, { detail: next }));
  } catch {
    /* 没有 CustomEvent 就跳过广播 */
  }
}

/**
 * 按当前语言解析语言偏好。
 * @param {any} preference
 * @returns {'zh' | 'en'}
 */
export function resolveLocale(preference) {
  return normalizeLocale(preference) || detectSystemLocale();
}

/*
 * 悬浮窗页与设置页各自打成一个包，两边各有一份本模块。
 * 用窗口事件把语言同步过去，避免两边显示成不同语言。
 */
try {
  window.addEventListener(LOCALE_EVENT, (event) => {
    const next = normalizeLocale(event && event.detail);
    if (!next || next === currentLocale) return;
    currentLocale = next;
    applyDocumentStrings();
    emit();
  });
} catch {
  /* 忽略不支持 addEventListener 的环境 */
}

/* 脚本一进来就按系统语言把静态文案换上，避免先闪一下另一种语言。 */
applyDocumentStrings();
