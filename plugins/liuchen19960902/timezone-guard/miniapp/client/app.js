'use strict';

/**
 * A/时差保安 — 纯本地计算，零外部依赖、零网络请求。
 *
 * 时间与偏移全部通过 IANA 时区 + Intl 计算，夏令时由运行时 tzdata 自动处理。
 */

/* ------------------------------------------------------------------ *
 * 纯时间计算
 * ------------------------------------------------------------------ */

// 时区规范化、档位判定、偏移解析、时差文案都放在 time.js 里：
// 那份文件浏览器与 Node 共用同一份源码，可以直接跑 node --test，
// 也不用在这里和别处各留一份、改一处漏一处。
const { resolveZone, periodOf, parseOffset, formatDiff, dayDelta } = window.TZ_TIME;

/* ------------------------------------------------------------------ *
 * 城市库
 * ------------------------------------------------------------------ */

// 重点城市与全部时区中文名放在 cities.js 里，与逻辑分开便于维护。
const CITIES = Array.isArray(window.TZ_CITIES) ? window.TZ_CITIES : [];

/** 空输入时展示的常用城市。 */
const POPULAR = [
  '洛杉矶', '纽约', '旧金山', '伦敦', '巴黎', '柏林', '东京', '首尔', '新加坡',
  '曼谷', '悉尼', '多伦多', '温哥华', '迪拜', '莫斯科', '上海', '北京', '香港',
  '台北', '奥克兰', '圣保罗',
];

/* ------------------------------------------------------------------ *
 * 判定阈值与文案
 * ------------------------------------------------------------------ */

/**
 * 固定三段阈值（所有城市一致）：
 *   09:00–18:00 白天（绿）
 *   18:00–22:00 傍晚（黄）
 *   22:00–06:00 深夜（红）
 * 06:00–09:00 清晨按黄灯处理：对方刚醒，一句试探即可，别展开。
 *
 * verdict 是给用户看的一句话结论；range 是该档的时间区间；
 * advice 是原「养号窗口」那一行的内容，已并入判定区。
 * tone 是这一档在图标带里的分档名，sky 决定画太阳、半日还是月亮
 * （城市旁的身份图标与图标带里的 24 格刻度共用同一套形状）。
 * 整页只有判定区有状态色，不再有第二套彩色标签。
 */
const BAND_COPY = {
  day: {
    label: '白天',
    color: 'green',
    verdict: '现在可以聊',
    range: '09:00–18:00',
    advice: '正常聊，不用刻意',
    tone: 'day',
    sky: 'sun',
  },
  dawn: {
    label: '清晨',
    color: 'yellow',
    verdict: '先别展开',
    range: '06:00–09:00',
    advice: '刚醒不久，别堆长消息',
    tone: 'dusk',
    sky: 'dusk',
  },
  dusk: {
    label: '傍晚',
    color: 'yellow',
    verdict: '短聊就好',
    range: '18:00–22:00',
    advice: '仍可聊，偏下班口味',
    tone: 'dusk',
    sky: 'dusk',
  },
  night: {
    label: '深夜',
    color: 'red',
    verdict: '先睡，别发',
    range: '22:00–06:00',
    advice: '大概率已睡，不建议开口',
    tone: 'night',
    sky: 'moon',
  },
};

/**
 * 档位判定在 time.js 里，返回的是档位 key；这里补上文案，
 * 调用点拿到的仍然是原来那个对象，用法一个字都不用改。
 */
const bandOf = (hour, minute) => BAND_COPY[window.TZ_TIME.bandOf(hour, minute)];

/** 城市旁的昼夜图标：太阳 / 半日 / 月亮。 */
const SKY_ICONS = { sun: '#i-sun', dusk: '#i-dusk', moon: '#i-moon' };

/* ------------------------------------------------------------------ *
 * 城市索引
 * ------------------------------------------------------------------ */

/** @typedef {{zone: string, title: string, en: string, countryZh: string, subtitle: string, tokens: string[], zoneText: string, zoneDir: string, baseExact: number, basePrefix: number, city: object|null}} Entry */

/** @type {Entry[]} */
let INDEX = [];

function buildIndex() {
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  /** @type {Entry[]} */
  const entries = [];
  const usedZones = new Set();

  // 1) 重点城市（带中文名、口语别名、常用缩写）
  //    当前运行时不支持的时区直接不进候选，避免用户选中后整页崩掉。
  const usableCities = CITIES.map((c) => ({ ...c, rawZone: c.zone, zone: resolveZone(c.zone) })).filter((c) => c.zone);
  for (const c of usableCities) {
    usedZones.add(c.zone);
    // tokens 里额外带上时区原名，这样按 IANA 全名/别名也能搜到
    // （例如「Europe/Kyiv」在部分 ICU 里会被规范化成 Europe/Kiev）。
    const tokens = [c.zh, c.en, c.abbr, c.countryZh, c.countryEn, c.rawZone, ...(c.alias || '').split('|')]
      .filter(Boolean)
      .map((t) => t.toLowerCase());
    entries.push({
      zone: c.zone,
      title: c.zh,
      en: c.en,
      countryZh: c.countryZh,
      subtitle: `${c.en} · ${c.countryZh}`,
      tokens,
      zoneText: c.zone.toLowerCase(),
      zoneDir: c.zone.split('/')[0].toLowerCase(),
      baseExact: 0,
      basePrefix: 0,
      city: c,
    });
  }

  // 2) 其余时区补中文名 —— 保证「全世界每个地方」都能用中文搜到。
  //    注意：与精选城市共用同一时区时**不能**整条跳过，
  //    例如孟买与加尔各答同属 Asia/Calcutta，两个中文名都该能搜到；
  //    这里按「中文名是否重复」来去重，而不是按时区。
  const zoneNames = window.TZ_ZONE_NAMES || {};
  /** @type {{zone: string, zh: string, en: string, countryZh: string}[]} */
  const extraCities = [];
  const usedNames = new Set(usableCities.map((c) => c.zh));
  for (const [rawZone, info] of Object.entries(zoneNames)) {
    const zone = resolveZone(rawZone);
    if (!zone) continue;
    usedZones.add(zone);
    const zh = info[0];
    if (usedNames.has(zh)) continue;
    usedNames.add(zh);
    const countryZh = info[1] || '';
    // 第三项可选：现代英文名（IANA 遗留尾段有时是老拼写，如 Katmandu / Kiev）。
    const en = info[2] || zone.split('/').pop().replace(/_/g, ' ');
    extraCities.push({ zone, zh, en, countryZh });
    entries.push({
      zone,
      title: zh,
      en,
      countryZh,
      subtitle: `${en} · ${countryZh}`,
      tokens: [zh, en.toLowerCase(), countryZh.toLowerCase(), zone.toLowerCase()].filter(Boolean),
      zoneText: zone.toLowerCase(),
      zoneDir: zone.split('/')[0].toLowerCase(),
      baseExact: 2,
      basePrefix: 4,
      city: null,
    });
  }

  // 3) 国家级条目：仅当该国绝大多数城市落在同一个时区时才给出，
  //    否则搜「美国」会直接列出纽约/芝加哥/洛杉矶等具体城市，避免误导。
  //    统计口径必须包含第 2 步的时区，否则俄罗斯会因只留莫斯科而被误判为单时区。
  const byCountry = new Map();
  const addToCountry = (countryZh, item) => {
    if (!countryZh) return;
    if (!byCountry.has(countryZh)) byCountry.set(countryZh, []);
    byCountry.get(countryZh).push(item);
  };
  for (const c of usableCities) addToCountry(c.countryZh, c);
  for (const c of extraCities) addToCountry(c.countryZh, c);

  for (const [countryZh, list] of byCountry) {
    const counts = new Map();
    for (const c of list) counts.set(c.zone, (counts.get(c.zone) || 0) + 1);
    let best = null;
    for (const [zone, n] of counts) if (!best || n > best.n) best = { zone, n };
    if (!best || best.n / list.length < 0.6) continue;
    const rep = list.find((c) => c.zone === best.zone);
    const repEn = rep.en || '';
    entries.push({
      zone: best.zone,
      title: `${countryZh}（默认）`,
      en: repEn,
      countryZh,
      subtitle: `${rep.zh} · ${countryZh}`,
      tokens: [countryZh, repEn.toLowerCase(), best.zone.toLowerCase()].filter(Boolean),
      zoneText: best.zone.toLowerCase(),
      zoneDir: best.zone.split('/')[0].toLowerCase(),
      // 完全匹配时排在该国具体城市之前（搜「中国」直接选中国）；
      // 前缀匹配时反而要靠后，否则「荷兰」会抢在「纽约」前面。
      baseExact: -2,
      basePrefix: 3,
      city: {
        zone: best.zone,
        zh: countryZh,
        en: repEn,
        abbr: '',
        countryZh,
        countryEn: '',
      },
    });
  }

  // 4) 兜底：运行时新增、但两张表都没收录的时区，给英文名。
  for (const rawZone of zones) {
    const zone = resolveZone(rawZone);
    if (!zone || usedZones.has(zone)) continue;
    usedZones.add(zone);
    const tail = zone.split('/').pop().replace(/_/g, ' ');
    entries.push({
      zone,
      title: tail,
      en: tail,
      countryZh: '',
      subtitle: zone,
      tokens: [tail.toLowerCase()],
      zoneText: zone.toLowerCase(),
      zoneDir: zone.split('/')[0].toLowerCase(),
      baseExact: 3,
      basePrefix: 6,
      city: null,
    });
  }

  return entries;
}

/** scoreEntry 的「无匹配」哨兵。必须与任何真实分数区分开：
 *  国家默认项的完全匹配分是 -2，若拿 -1 当哨兵会被误判成未命中。 */
const NO_MATCH = -1000;

/**
 * 模糊匹配。分级越小越靠前：
 *   0 标题完全匹配      1 关键词完全匹配
 *   2 标题前缀          3 关键词前缀
 *   4 时区全名完全匹配  5 时区目录前缀      6 时区路径包含      7 全文包含
 *
 * entry.baseExact / entry.basePrefix 按条目类型整体偏移：
 *   精选城市 (0/0)、国家默认项 (-2/3)、IANA 兜底 (3/6)。
 */
function scoreEntry(entry, query) {
  const title = entry.title.toLowerCase();
  if (title === query) return entry.baseExact;
  for (const token of entry.tokens) {
    if (token === query) return entry.baseExact + 1;
  }
  if (query.includes('/')) {
    if (entry.zoneText === query) return entry.basePrefix + 4;
    if (entry.zoneText.startsWith(query)) return entry.basePrefix + 5;
    if (entry.zoneText.includes(query)) return entry.basePrefix + 6;
  }
  if (title.startsWith(query)) return entry.basePrefix + 2;
  for (const token of entry.tokens) {
    if (token.startsWith(query)) return entry.basePrefix + 3;
  }
  if (query.length >= 3 && entry.zoneDir === query) return entry.basePrefix + 5;
  if (query.length >= 3 && entry.tokens.some((t) => t.includes(query))) return entry.basePrefix + 7;
  return NO_MATCH;
}

// 候选上限。搜一个国家名可能命中几十个城市（美国 40+），
// 上限过低会把正确结果截掉，所以放宽到 60。
function searchEntries(query, limit = 60) {
  const q = query.trim().toLowerCase();
  if (!q) {
    const popular = new Set(POPULAR);
    return INDEX.filter((e) => popular.has(e.title)).slice(0, limit);
  }
  const scored = [];
  for (const entry of INDEX) {
    const score = scoreEntry(entry, q);
    if (score > NO_MATCH) scored.push({ entry, score });
  }
  scored.sort((a, b) => a.score - b.score || a.entry.title.length - b.entry.title.length);
  return scored.slice(0, limit).map((s) => s.entry);
}

/* ------------------------------------------------------------------ *
 * 时区计算
 * ------------------------------------------------------------------ */

const FORMATTERS = new Map();

function getFormatters(timeZone) {
  let f = FORMATTERS.get(timeZone);
  if (!f) {
    f = {
      numeric: new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        weekday: 'short',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short',
      }),
      weekday: new Intl.DateTimeFormat('zh-CN', { timeZone, weekday: 'short' }),
      offset: new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }),
    };
    FORMATTERS.set(timeZone, f);
  }
  return f;
}

/**
 * 取某个时区在给定时刻的完整信息。
 * 时区 ID 先做一次解析兜底，绝不因为一个非法时区让整页渲染抛错。
 */
function zonedInfo(timeZone, date) {
  const zone = resolveZone(timeZone) || 'UTC';
  const f = getFormatters(zone);
  const parts = {};
  for (const part of f.numeric.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  const offsetPart = f.offset.formatToParts(date).find((p) => p.type === 'timeZoneName');

  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  const pad = (n) => String(n).padStart(2, '0');

  return {
    time24: `${pad(hour)}:${pad(minute)}:${pad(second)}`,
    time12: `${pad(hour % 12 === 0 ? 12 : hour % 12)}:${pad(minute)}:${pad(second)}`,
    period: periodOf(hour),
    date: `${Number(parts.month)}月${Number(parts.day)}日 ${f.weekday.format(date)}`,
    zoneLabel: parts.timeZoneName || '',
    offsetMinutes: parseOffset(offsetPart ? offsetPart.value : ''),
    hour,
    minute,
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

/** 绿 < 黄 < 红，用于比较两边的紧迫程度。 */
const SEVERITY = { green: 0, yellow: 1, red: 2 };

/* ------------------------------------------------------------------ *
 * 状态
 * ------------------------------------------------------------------ */

const STORAGE_KEY = window.TZ_TIME.STORAGE_KEY;

const DEFAULT_TARGET = {
  zone: 'America/Los_Angeles',
  title: '洛杉矶',
  en: 'Los Angeles',
  abbr: 'LA',
  countryZh: '美国',
  countryEn: 'United States',
};
const DEFAULT_HOME = {
  zone: 'Asia/Shanghai',
  title: '上海',
  en: 'Shanghai',
  abbr: '',
  countryZh: '中国',
  countryEn: 'China',
};

let state = {
  target: { ...DEFAULT_TARGET },
  home: { ...DEFAULT_HOME },
  theme: 'auto',
  clockFormat: '12h',
};

/**
 * 以 zone 为准重建展示字段。
 *
 * 存档可能缺字段或字段类型不对（例如 title 为 null），直接展开合并会让
 * 页头显示「洛杉矶时间」而时钟其实是东京时间，同一屏自相矛盾。
 * 这里对每个展示字段做类型校验，并以 zone 反查补全。
 */
function normalizeCity(raw, fallback) {
  if (!raw || typeof raw !== 'object') return { ...fallback };
  const zone = resolveZone(raw.zone);
  if (!zone) return { ...fallback };

  const known = CITIES.find((c) => resolveZone(c.zone) === zone);
  const fallbackTitle = known ? known.zh : zone.split('/').pop().replace(/_/g, ' ');
  const text = (value, dflt) => (typeof value === 'string' && value.trim() ? value : dflt);

  return {
    zone,
    title: text(raw.title, fallbackTitle),
    en: text(raw.en, known ? known.en : ''),
    abbr: text(raw.abbr, known ? known.abbr || '' : ''),
    countryZh: text(raw.countryZh, known ? known.countryZh : ''),
    countryEn: text(raw.countryEn, known ? known.countryEn : ''),
  };
}

function loadPrefs() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    if (saved && typeof saved === 'object') {
      if (saved.target) state.target = normalizeCity(saved.target, DEFAULT_TARGET);
      if (saved.home) state.home = normalizeCity(saved.home, DEFAULT_HOME);
      if (saved.theme === 'light' || saved.theme === 'dark' || saved.theme === 'auto') state.theme = saved.theme;
      if (saved.clockFormat === '12h' || saved.clockFormat === '24h') state.clockFormat = saved.clockFormat;
    }
  } catch {
    /* 存档损坏时回落到默认值 */
  }
}

function savePrefs() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        target: state.target,
        home: state.home,
        theme: state.theme,
        clockFormat: state.clockFormat,
      }),
    );
  } catch {
    /* 存储不可用不影响使用 */
  }
}

/* ------------------------------------------------------------------ *
 * DOM
 * ------------------------------------------------------------------ */

const el = {
  pageTitle: document.getElementById('page-title'),
  pageTitleTarget: document.getElementById('page-title-target'),
  pageTitleHome: document.getElementById('page-title-home'),
  pageTitleSwap: document.getElementById('page-title-swap'),
  verdict: document.getElementById('verdict'),
  verdictTitle: document.getElementById('verdict-title'),
  verdictDetail: document.getElementById('verdict-detail'),
  targetHeading: document.getElementById('target-heading'),
  targetMeta: document.getElementById('target-meta'),
  targetClock: document.getElementById('target-clock'),
  targetDate: document.getElementById('target-date'),
  targetIconUse: document.getElementById('target-icon-use'),
  homeHeading: document.getElementById('home-heading'),
  homeMeta: document.getElementById('home-meta'),
  homeClock: document.getElementById('home-clock'),
  homeDate: document.getElementById('home-date'),
  homeIconUse: document.getElementById('home-icon-use'),
  comboTarget: document.getElementById('combo-target'),
  comboHome: document.getElementById('combo-home'),
  factDiff: document.getElementById('fact-diff'),
  verdictExtra: document.getElementById('verdict-extra'),
  targetPeriod: document.getElementById('target-period'),
  homePeriod: document.getElementById('home-period'),
  daylineLabel: document.getElementById('dayline-label'),
  hourBar: document.getElementById('hour-bar'),
  fmt12: document.getElementById('fmt-12h'),
  fmt24: document.getElementById('fmt-24h'),
  themeToggle: document.getElementById('theme-toggle'),
  themeToggleLabel: document.getElementById('theme-toggle-label'),
};

function entryToCity(entry) {
  const c = entry.city;
  if (c) {
    return {
      zone: c.zone,
      title: c.zh,
      en: c.en,
      abbr: c.abbr || '',
      countryZh: c.countryZh,
      countryEn: c.countryEn || '',
    };
  }
  // 非精选条目（其余时区的中文名）：标题即中文名，英文名取 IANA 尾段。
  return {
    zone: entry.zone,
    title: entry.title,
    en: entry.en || entry.title,
    abbr: '',
    countryZh: entry.countryZh || '',
    countryEn: '',
  };
}

/**
 * 只在文本真的变化时写入 DOM。
 * render() 每秒跑一次，直接赋值会反复触发 aria-live 区域的无谓播报。
 */
function setText(node, value) {
  if (node.textContent !== value) node.textContent = value;
}

/**
 * 只在属性值真的变化时写入。
 * render() 每秒跑一次；Blink 不会把同值 setAttribute 短路掉，
 * 每帧重写会触发样式失效与 MutationObserver 噪音，
 * 所以和 setText 一样先比再写。
 */
function setAttr(node, name, value) {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

/** hidden 同理：避免每帧写同一个布尔属性。 */
function setHidden(node, flag) {
  if (node.hidden !== flag) node.hidden = flag;
}

/* ------------------------------------------------------------------ *
 * 一天的图标带
 * ------------------------------------------------------------------ */

/** 一天 24 格，一格一小时。 */
const HOUR_COUNT = 24;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** 图标带里 24 格的 DOM 节点（每格一小时）。 */
let hourCells = [];
/** 当前所在的小时格下标，用于避免每秒重刷同一格。 */
let hourNowIndex = -1;

/**
 * 图标带画的是「对方那一整天」：每小时一格，格里一枚昼夜图标。
 * 太阳 = 白天，半日 = 清晨/傍晚，月亮 = 深夜——靠形状说明对方在睡还是醒着，
 * 不再靠灰阶深浅去暗示：灰阶在深色主题下必须反着设，语义容易读反。
 * 阈值固定，所以格子只建一次；每帧只移动当前格。
 */
function buildHourBar() {
  if (!el.hourBar) return;
  el.hourBar.textContent = '';
  hourCells = [];
  for (let h = 0; h < HOUR_COUNT; h++) {
    const band = bandOf(h, 0);
    const cell = document.createElement('span');
    cell.className = 'hour-cell';
    // 整点起步，四个阈值（06/09/18/22）都落在格边界上。
    cell.dataset.tone = band.tone;

    const icon = document.createElementNS(SVG_NS, 'svg');
    icon.setAttribute('class', 'hour-icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', SKY_ICONS[band.sky]);
    icon.appendChild(use);
    cell.appendChild(icon);

    el.hourBar.appendChild(cell);
    hourCells.push(cell);
  }
  hourNowIndex = -1;
}

/** 把当前时刻对应的那一格标成状态色。 */
function setHourNow(index) {
  if (!hourCells.length) return;
  if (hourNowIndex === index) return;
  if (hourNowIndex >= 0 && hourCells[hourNowIndex]) {
    hourCells[hourNowIndex].removeAttribute('data-now');
  }
  if (hourCells[index]) hourCells[index].dataset.now = 'true';
  hourNowIndex = index;
}

/**
 * 图标带的文字替代：读屏用户拿不到图标，得靠这句话知道
 * 「对方那边一天里的哪一段是深夜、现在落在哪一段」。
 */
function setHourBarLabel(cityTitle, band) {
  if (!el.hourBar) return;
  const label = `${cityTitle} 24 小时昼夜分布（每小时一格）：深夜 22:00–06:00，清晨 06:00–09:00，白天 09:00–18:00，傍晚 18:00–22:00；当前在${band.label}段`;
  // 值不变就不写：render() 每秒跑一次，无谓地改 aria-label 会让读屏反复重播。
  setAttr(el.hourBar, 'aria-label', label);
}

/* ------------------------------------------------------------------ *
 * 渲染
 * ------------------------------------------------------------------ */

function render() {
  const now = new Date();
  const target = zonedInfo(state.target.zone, now);
  const home = zonedInfo(state.home.zone, now);

  const band = bandOf(target.hour, target.minute);
  const homeBand = bandOf(home.hour, home.minute);

  // 页头：两个城市并置。两侧是同一个城市时不重复显示，也不显示交换箭头。
  // 同城判定同时看中文名和时区 ID：只看名字的话，
  // 将来出现两个同名不同区的城市时会误判成同城。
  const sameCity =
    state.target.title === state.home.title && state.target.zone === state.home.zone;
  setText(el.pageTitleTarget, state.target.title);
  setText(el.pageTitleHome, sameCity ? '' : state.home.title);
  // 隐藏而不是清空：清空会留下一个空的 flex 子项，尾部多出 7px 间隙。
  const pairDisplay = sameCity ? 'none' : '';
  if (el.pageTitleHome.style.display !== pairDisplay) {
    el.pageTitleHome.style.display = pairDisplay;
  }
  if (el.pageTitleSwap.style.display !== pairDisplay) {
    el.pageTitleSwap.style.display = pairDisplay;
  }
  // 标题的可访问名显式给：里面的对调按钮若参与 name-from-content，
  // 标题会被读成「洛杉矶 对调两个城市 上海」。显式命名后标题只报两个城市名，
  // 按钮本身仍是独立按钮，聚焦到它时会单独播报。
  setAttr(el.pageTitle, 'aria-label', sameCity ? state.target.title : `${state.target.title} ${state.home.title}`);

  // 判定区：整页唯一的状态色在这里，其余一律中性。
  // 「养号窗口」的内容并入这一块，不再单独占一行。
  // 状态色变量挂在 <html> 上，判定文字与色点共用同一套变量。
  // 每秒重写同一个属性会让样式每秒失效一次，所以先比再写。
  if (document.documentElement.dataset.band !== band.color) {
    document.documentElement.dataset.band = band.color;
  }
  if (el.verdict.dataset.band !== band.color) el.verdict.dataset.band = band.color;
  setText(el.verdictTitle, band.verdict);
  setText(el.verdictDetail, `对方${band.label} ${band.range} · ${band.advice}`);

  // 只在「你这边比对方更晚」时补一句提醒——这是关于你自己而非对方的。
  const extra = extraNote(band, homeBand);
  if (extra) {
    setText(el.verdictExtra, extra);
    setHidden(el.verdictExtra, false);
  } else {
    setHidden(el.verdictExtra, true);
    setText(el.verdictExtra, '');
  }

  // 对方时钟
  setText(el.targetHeading, state.target.title);
  setText(el.targetMeta, `${state.target.en || state.target.title} · ${target.zoneLabel}`);
  setText(el.targetClock, state.clockFormat === '24h' ? target.time24 : target.time12);
  setText(el.targetDate, target.date);

  // 我的时钟
  setText(el.homeHeading, state.home.title);
  setText(el.homeMeta, `${state.home.en || state.home.title} · ${home.zoneLabel}`);
  setText(el.homeClock, state.clockFormat === '24h' ? home.time24 : home.time12);
  setText(el.homeDate, home.date);

  // 城市旁的昼夜图标：每城一个，太阳 / 半日 / 月亮。
  setAttr(el.targetIconUse, 'href', SKY_ICONS[band.sky]);
  setAttr(el.homeIconUse, 'href', SKY_ICONS[homeBand.sky]);

  // 中文时段：12H 模式下它替代 AM/PM；24H 模式本身已含时段，故不重复显示。
  const showPeriod = state.clockFormat !== '24h';
  setHidden(el.targetPeriod, !showPeriod);
  setHidden(el.homePeriod, !showPeriod);
  if (showPeriod) {
    setText(el.targetPeriod, target.period);
    setText(el.homePeriod, home.period);
  }

  // 一天的图标带：标出对方此刻所在的那一小时。
  setText(el.daylineLabel, `${state.target.title}的一天`);
  setHourBarLabel(state.target.title, band);
  setHourNow(target.hour);

  // 时差
  const diffMinutes = home.offsetMinutes - target.offsetMinutes;
  if (state.target.zone === state.home.zone) {
    setText(el.factDiff, '两边同一时区，时间完全一致');
  } else if (diffMinutes === 0) {
    // 同一时刻偏移相同但并非同一时区（例如洛杉矶与凤凰城），
    // 随夏令时切换会分开，此时不能声称「同一时区」。
    setText(el.factDiff, '当前时差 0 小时（此刻同步）');
  } else {
    // ahead 永远是「时区靠前」的那一侧，所以动词恒为「快」。
    // 之前这里跟着 diff 的正负写「快/慢」，结果主语换了动词没换，
    // 会出现「上海比洛杉矶慢约 15 小时」这种自相矛盾的说法。
    const homeAhead = diffMinutes > 0;
    const ahead = homeAhead ? state.home.title : state.target.title;
    const behind = homeAhead ? state.target.title : state.home.title;
    // formatDiff 只回纯文本：整小时是「约 15 小时」，那个「约」自带分词；
    // 非整小时是「5 小时 45 分钟」，直接接在「快」后面会连成一团，这里补一个空格。
    const gap = diffMinutes % 60 === 0 ? '' : ' ';
    const parts = [`${ahead}比${behind}快${gap}${formatDiff(diffMinutes)}`];
    const dayDiff = dayDelta(target, home);
    if (dayDiff < 0) parts.push('对方还在昨天');
    else if (dayDiff > 0) parts.push('对方那边已是明天');
    setText(el.factDiff, parts.join(' · '));
  }
}

/** 当我方比对方更晚 / 都处于深夜时，补一条给用户自己的提醒。 */
function extraNote(band, homeBand) {
  if (SEVERITY[homeBand.color] > SEVERITY[band.color]) {
    // 注意不能写「比对方更晚」：01:43 和 13:43 并排摆着，
    // 说「更晚」会和上面的时钟自相矛盾。改成说「该休息」。
    return `你自己也是${homeBand.label}，比对方更该休息，长对话先收着。`;
  }
  if (homeBand.color === 'red' && band.color === 'red') {
    return '你俩都在深夜，同步作息反而最自然。';
  }
  return '';
}

/* ------------------------------------------------------------------ *
 * 城市选择器（combobox）
 * ------------------------------------------------------------------ */

/**
 * @param {object} options
 * @param {HTMLInputElement} options.input
 * @param {HTMLUListElement} options.list
 * @param {HTMLElement} options.emptyEl 无结果时的提示（放在 listbox 之外）
 * @param {() => object} options.getValue
 * @param {(city: object) => void} options.onSelect
 */
function createCombo({ input, list, emptyEl, getValue, onSelect }) {
  let options = [];
  let activeIndex = -1;
  let open = false;
  // 当前候选列表是不是由输入框内容筛出来的。
  // 聚焦时展开的是「常用城市」列表，与输入框里的城市名对不上，
  // 这时按 Enter 不能默认选首项，否则会把当前城市悄悄改掉。
  let listFromInput = false;

  function currentValue() {
    return getValue();
  }

  function renderOptions() {
    list.textContent = '';
    activeIndex = -1;
    // 选项重建后旧的 aria-activedescendant 会指向已不存在的元素，
    // 必须同步清掉，否则读屏拿到的是悬空引用。
    input.removeAttribute('aria-activedescendant');
    if (emptyEl) emptyEl.textContent = '没找到这个城市，换个关键词试试';

    const current = currentValue();
    options.forEach((entry, index) => {
      const item = document.createElement('li');
      item.className = 'combo-option';
      item.id = `${list.id}-opt-${index}`;
      item.setAttribute('role', 'option');
      // 国家默认项在列表里叫「中国（默认）」，选中后落到城市名「中国」，
      // 所以标题比较要去掉「（默认）」后缀，否则选中态永远不同步。
      const entryTitle = entry.title.replace('（默认）', '');
      const titleMatches = Boolean(current) && (current.title === entry.title || current.title === entryTitle);
      const selected = Boolean(current) && current.zone === entry.zone && titleMatches;
      item.setAttribute('aria-selected', String(selected));
      item.dataset.index = String(index);

      const title = document.createElement('span');
      title.className = 'combo-option-title';
      title.textContent = entry.title;

      const sub = document.createElement('span');
      sub.className = 'combo-option-sub';
      sub.textContent = entry.subtitle;

      item.append(title, sub);
      list.appendChild(item);
    });
  }

  function setOpen(next) {
    open = next;
    const hasOptions = options.length > 0;
    // 没有候选时不要留一个空 listbox 盖在空态提示上。
    // 和 render() 一样先比再写：同值重写会白白触发一次属性变更与样式失效。
    setHidden(list, !next || !hasOptions);
    if (emptyEl) setHidden(emptyEl, !next || hasOptions);
    setAttr(input, 'aria-expanded', String(next && hasOptions));
    if (!next) {
      activeIndex = -1;
      input.removeAttribute('aria-activedescendant');
    }
  }

  /**
   * @param {string} [query] 覆盖输入框内容来筛选（聚焦时用空串展示常用城市）
   */
  function refresh(query) {
    const q = query === undefined ? input.value : query;
    options = searchEntries(q);
    // 只有「确实输入了非空关键词」时，候选才算来自输入。
    // 空查询得到的是常用城市列表，与输入框内容无关，
    // 这时按 Enter 若回退选首项，会把当前城市悄悄改掉。
    listFromInput = q.trim() !== '';
    renderOptions();
    setOpen(true);
  }

  function highlight(index) {
    const items = list.querySelectorAll('.combo-option');
    items.forEach((item) => item.removeAttribute('data-active'));
    if (items.length === 0) {
      input.removeAttribute('aria-activedescendant');
      activeIndex = -1;
      return;
    }
    // 越界回绕：列表只有一项时连按两次 ↓ 也不会把高亮清空导致 Enter 失效。
    const next = (((index % items.length) + items.length) % items.length);
    activeIndex = next;
    const item = items[next];
    item.setAttribute('data-active', 'true');
    input.setAttribute('aria-activedescendant', item.id);
    item.scrollIntoView({ block: 'nearest' });
  }

  function commit(entry) {
    if (!entry) return;
    setOpen(false);
    onSelect(entryToCity(entry));
    input.value = currentValue().title;
    // 全选新值：用户接着打字时是替换，而不是在末尾追加。
    input.select();
  }

  function resetInput() {
    input.value = currentValue().title;
  }

  input.addEventListener('focus', () => {
    // 全选当前城市名，直接输入即可替换。
    // 必须用 select() 而不是 setSelectionRange()：前者会走一遍聚焦步骤，
    // 能把 DOM 焦点真正落到输入框上，键盘操作才收得到事件。
    input.select();
    // 同时把候选展开成常用城市列表，方便不输入就直接浏览。
    refresh('');
  });

  input.addEventListener('click', () => {
    // 已经获得焦点时再点一下不会触发 focus，这里补一次展开。
    if (!open) {
      refresh('');
      // 同样全选，让用户接着打字是替换当前城市名而不是追加。
      input.select();
    }
  });

  input.addEventListener('input', () => {
    refresh();
  });

  input.addEventListener('keydown', (event) => {
    // 输入法组字过程中的按键不参与候选操作，否则选词回车会误选城市。
    if (event.isComposing || event.keyCode === 229) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) refresh();
      else highlight(activeIndex + 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) refresh();
      else highlight(activeIndex < 0 ? options.length - 1 : activeIndex - 1);
      return;
    }
    if (event.key === 'Enter') {
      if (!open) return;
      // 有高亮项就用高亮项；没有高亮时，只有当候选确实是按输入内容筛出来的
      // 才回退选首项 —— 聚焦时的「常用城市」列表与输入内容无关，
      // 直接回退会把当前城市悄悄改成列表首项。
      const pick =
        activeIndex >= 0 && options[activeIndex]
          ? options[activeIndex]
          : listFromInput
            ? options[0]
            : null;
      if (pick) {
        event.preventDefault();
        commit(pick);
      }
      return;
    }
    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        setOpen(false);
        resetInput();
      }
      return;
    }
    if (event.key === 'Tab') {
      setOpen(false);
      resetInput();
    }
  });

  // mousedown 立刻提交：这是最早能拿到选择的时机，早于任何失焦。
  // 同时 preventDefault，避免输入框失焦导致列表收起。
  list.addEventListener('mousedown', (event) => {
    const item = event.target.closest('.combo-option');
    if (!item) return;
    event.preventDefault();
    commit(options[Number(item.dataset.index)]);
  });

  // 兜底：某些宿主只派发 click，那就走这里（列表已关说明上面已提交过）。
  list.addEventListener('click', (event) => {
    if (!open) return;
    const item = event.target.closest('.combo-option');
    if (!item) return;
    commit(options[Number(item.dataset.index)]);
  });

  input.addEventListener('blur', () => {
    // 延后一点再收起：部分宿主在点击候选之前会先让输入框失焦，
    // 立刻收起会让用户点不中。
    // 这里用真实焦点判断而不是标志位——标志位会粘住（选中过一次之后
    // 再点空白就收不起来），真实焦点也不会在用户点回输入框时误收起。
    window.setTimeout(() => {
      if (document.activeElement === input) return;
      setOpen(false);
      resetInput();
    }, 200);
  });

  return {
    setValue(text) {
      input.value = text;
    },
  };
}

/* ------------------------------------------------------------------ *
 * 主题
 * ------------------------------------------------------------------ */

const media = window.matchMedia('(prefers-color-scheme: dark)');

function resolvedTheme() {
  if (state.theme === 'auto') return media.matches ? 'dark' : 'light';
  return state.theme;
}

/**
 * URL 参数 ?theme=light|dark 覆盖初始主题。
 * 用途：把同一个页面并排放两份（浅色 / 深色）做视觉对照，
 * 预览页直接复用这份 index.html，不再维护一份手工同步的副本。
 */
function themeFromUrl() {
  try {
    const t = new URLSearchParams(window.location.search).get('theme');
    return t === 'light' || t === 'dark' ? t : null;
  } catch {
    return null;
  }
}

function applyTheme() {
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  const isDark = theme === 'dark';
  // 主题按钮用固定的半填充圆图标，不跟昼夜图标混用：
  // 太阳/月亮已经被"对方现在是白天还是夜里"占用了，页面上只应出现两枚。
  // 主题语义由 aria-pressed + 无障碍文本承担。
  el.themeToggle.setAttribute('aria-pressed', String(isDark));
  el.themeToggleLabel.textContent = isDark ? '切换到浅色主题' : '切换到深色主题';
}

function toggleTheme() {
  state.theme = resolvedTheme() === 'dark' ? 'light' : 'dark';
  applyTheme();
  savePrefs();
}

/* ------------------------------------------------------------------ *
 * 时间制式
 * ------------------------------------------------------------------ */

function applyClockFormat() {
  const is24 = state.clockFormat === '24h';
  // data-fmt 是首帧可见的视觉依据（由 head 内联脚本预先写好），
  // aria-pressed 负责无障碍语义，两者保持同步。
  document.documentElement.dataset.fmt = state.clockFormat;
  el.fmt12.setAttribute('aria-pressed', String(!is24));
  el.fmt24.setAttribute('aria-pressed', String(is24));
}

function setClockFormat(format) {
  if (format !== '12h' && format !== '24h') return;
  state.clockFormat = format;
  applyClockFormat();
  savePrefs();
  render();
}

/* ------------------------------------------------------------------ *
 * 城市对调
 * ------------------------------------------------------------------ */

/**
 * 一键对调两个城市。
 *
 * 判定始终跟着「对方城市」走，所以对调等于换了一个提问视角：
 * 原本在问「现在能不能找他聊」，对调之后变成「他那边的人想找我聊」。
 * 两个时钟、时差、图标带、判定全部由 render() 按新的 state 重算，不用额外处理。
 */
function swapCities() {
  const target = state.target;
  state.target = state.home;
  state.home = target;
  savePrefs();
  render();
  // 两个城市输入框也要跟着翻。否则标题写「上海 ⇄ 洛杉矶」，
  // 而标注「对方城市」的框里还是「洛杉矶」——判定会用错人，
  // 同一个控件内部还自相矛盾（框里的文字与下拉列表里选中项对不上）。
  // 只能在这里写：render() 每秒跑一次，在那里回写会抹掉用户正在输入的城市名。
  el.comboTarget.value = state.target.title;
  el.comboHome.value = state.home.title;
}

/* ------------------------------------------------------------------ *
 * 启动
 * ------------------------------------------------------------------ */

function init() {
  INDEX = buildIndex();
  loadPrefs();
  // URL 里的 ?theme= 优先于存档（用于并排预览同一个页面的两种主题）。
  const urlTheme = themeFromUrl();
  if (urlTheme) state.theme = urlTheme;
  applyTheme();
  applyClockFormat();
  buildHourBar();

  el.themeToggle.addEventListener('click', toggleTheme);
  el.fmt12.addEventListener('click', () => setClockFormat('12h'));
  el.fmt24.addEventListener('click', () => setClockFormat('24h'));
  // ⇄ 是真正的 <button>，Enter / Space 由浏览器原生触发 click，不用手写 keydown。
  el.pageTitleSwap.addEventListener('click', swapCities);
  media.addEventListener('change', () => {
    if (state.theme === 'auto') applyTheme();
  });

  const targetCombo = createCombo({
    input: document.getElementById('combo-target'),
    list: document.getElementById('listbox-target'),
    emptyEl: document.getElementById('empty-target'),
    getValue: () => state.target,
    onSelect: (city) => {
      state.target = city;
      savePrefs();
      render();
    },
  });

  const homeCombo = createCombo({
    input: document.getElementById('combo-home'),
    list: document.getElementById('listbox-home'),
    emptyEl: document.getElementById('empty-home'),
    getValue: () => state.home,
    onSelect: (city) => {
      state.home = city;
      savePrefs();
      render();
    },
  });

  targetCombo.setValue(state.target.title);
  homeCombo.setValue(state.home.title);

  render();
  window.setInterval(render, 1000);
}

init();
