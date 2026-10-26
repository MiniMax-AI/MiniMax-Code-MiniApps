'use strict';

/**
 * A/时差保安 — 纯时间计算。
 *
 * 浏览器和 Node 跑的是同一份源码：
 *   - 浏览器里当普通 <script> 加载，挂在 window.TZ_TIME 上；
 *   - Node 里走 module.exports，供 node --test 直接测。
 * 不在两处各写一份，免得以后改了一处、另一处悄悄对不上。
 *
 * 这里只放不碰 DOM 的纯函数：时区规范化、档位判定、偏移解析、
 * 时差文案、日历日差。档位文案与页面渲染留在 app.js。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.TZ_TIME = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** 界面偏好在 localStorage 里的键名。 */
  var STORAGE_KEY = 'timezone-guard.prefs.v1';

  /**
   * 部分 IANA 名称在不同 ICU / tzdata 版本下存在与否不同
   * （Europe/Kyiv vs Europe/Kiev、Asia/Kolkata vs Asia/Calcutta …），
   * 这里为它们准备退路，保证任何时候都拿得到一个可用时区。
   */
  var ZONE_FALLBACKS = {
    'Europe/Kyiv': ['Europe/Kiev'],
    'Asia/Ho_Chi_Minh': ['Asia/Saigon'],
    'Asia/Kolkata': ['Asia/Calcutta'],
    'America/Montreal': ['America/Toronto'],
    'America/Argentina/Buenos_Aires': ['America/Rosario'],
  };

  var resolvedZoneCache = new Map();

  /**
   * 返回一个在当前运行时确实可用的时区 ID；都不行时返回 null。
   *
   * 注意：城市名对应的时区名不一定存在。旧金山、西雅图没有独立的
   * America/* 时区，慕尼黑没有 Europe/Munich——这类城市必须归到
   * 本国主时区，否则 new Intl.DateTimeFormat() 会抛 RangeError。
   */
  function resolveZone(zone) {
    if (typeof zone !== 'string' || !zone) return null;
    var trimmed = zone.trim();
    if (!trimmed) return null;
    if (resolvedZoneCache.has(trimmed)) return resolvedZoneCache.get(trimmed);
    var resolved = null;
    var candidates = [trimmed].concat(ZONE_FALLBACKS[trimmed] || []);
    for (var i = 0; i < candidates.length; i++) {
      try {
        // 取规范化后的 ID，避免同一个时区出现大小写 / 别名两种写法，
        // 让「是否同一时区」的比较始终可靠。
        var canonical = new Intl.DateTimeFormat('en-US', { timeZone: candidates[i] }).resolvedOptions().timeZone;
        resolved = canonical || candidates[i];
        break;
      } catch (error) {
        /* 试下一个候选 */
      }
    }
    resolvedZoneCache.set(trimmed, resolved);
    return resolved;
  }

  /** 中文时段，替代 AM/PM：凌晨 / 上午 / 下午 / 晚上。 */
  function periodOf(hour) {
    if (hour < 6) return '凌晨';
    if (hour < 12) return '上午';
    if (hour < 18) return '下午';
    return '晚上';
  }

  /**
   * 固定阈值判定：绿 09–18、黄 18–22、红 22–06，清晨 06–09 归黄。
   *
   * 返回的是档位 key，档位名称、结论、颜色在 app.js 的 BAND_COPY 里，
   * 这样这个文件只留判定规则本身，测起来一目了然。
   */
  function bandOf(hour, minute) {
    var t = hour * 60 + minute;
    if (t >= 22 * 60 || t < 6 * 60) return 'night';
    if (t < 9 * 60) return 'dawn';
    if (t < 18 * 60) return 'day';
    return 'dusk';
  }

  /** 把 "GMT-07:00" / "GMT+05:30" / "GMT" 解析成分钟偏移。 */
  function parseOffset(text) {
    if (!text || text === 'GMT' || text === 'UTC') return 0;
    var m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(text);
    if (!m) return 0;
    var sign = m[1] === '-' ? -1 : 1;
    return sign * (Number(m[2]) * 60 + Number(m[3] || 0));
  }

  /**
   * 时差文案。
   * 整小时沿用「约 N 小时」；存在 45 分钟这类非整小时偏移时给出精确的
   * 小时 + 分钟，避免读者拿 5.8 小时去对旁边并排的两个时钟。
   *
   * 只回纯文本，不带任何前导或尾随空格：拼到「快 / 慢」后面要不要留一个
   * 空格是调用方的事（整小时那个「约」自成一词，非整小时直接接数字会连成一团）。
   */
  function formatDiff(diffMinutes) {
    var abs = Math.abs(diffMinutes);
    var hours = Math.floor(abs / 60);
    var minutes = abs % 60;
    if (minutes === 0) return '约 ' + hours + ' 小时';
    return hours > 0 ? hours + ' 小时 ' + minutes + ' 分钟' : minutes + ' 分钟';
  }

  /** 目标日期相对对照日期的日历天数差。 */
  function dayDelta(target, home) {
    var t = Date.UTC(target.year, target.month - 1, target.day);
    var h = Date.UTC(home.year, home.month - 1, home.day);
    return Math.round((t - h) / 86400000);
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    resolveZone: resolveZone,
    periodOf: periodOf,
    bandOf: bandOf,
    parseOffset: parseOffset,
    formatDiff: formatDiff,
    dayDelta: dayDelta,
  };
});
