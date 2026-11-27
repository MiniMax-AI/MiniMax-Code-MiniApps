// @ts-check

/**
 * 天气 · 新闻看板 —— Mini App Node 运行时
 *
 * 职责：
 *  - 聚合天气、6 个新闻栏目、自选股行情（A股 + 国际品种）
 *  - 自选股持久化到 context.dataDir（原子写）
 *  - 只暴露白名单路由；所有外部取数都在 Node 侧完成
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */
/** @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle */

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const UPSTREAM_TIMEOUT = 15000;
const QUOTE_TTL = 15_000;
const CONTENT_TTL = 60_000;
const FX_TTL = 30_000;
const MAX_WATCHLIST = 12;
const MAX_BODY_BYTES = 4096;
const GRAMS_PER_OUNCE = 31.1034768;

/* ------------------------------------------------------------------ *
 * 通用取数工具
 * ------------------------------------------------------------------ */

/**
 * @param {string} url
 * @param {{headers?: Record<string,string>, encoding?: string, timeout?: number}} [options]
 * @returns {Promise<string>}
 */
async function httpText(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: '*/*', ...(options.headers ?? {}) },
    redirect: 'follow',
    signal: AbortSignal.timeout(options.timeout ?? UPSTREAM_TIMEOUT),
  });
  if (!response.ok) throw new Error(`upstream_status_${response.status}`);
  const buffer = await response.arrayBuffer();
  return new TextDecoder(options.encoding ?? 'utf-8').decode(buffer);
}

/**
 * @param {string} url
 * @param {{headers?: Record<string,string>, timeout?: number}} [options]
 * @returns {Promise<any>}
 */
async function httpJson(url, options = {}) {
  const text = await httpText(url, options);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('invalid_json');
  }
}

/* ------------------------------------------------------------------ *
 * 文本清洗
 * ------------------------------------------------------------------ */

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  middot: '·',
  times: '×',
  copy: '©',
};

/**
 * @param {string} value
 * @returns {string}
 */
function decodeEntities(value) {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity) => {
    if (entity.charCodeAt(0) === 35) {
      const isHex = entity[1] === 'x' || entity[1] === 'X';
      const code = Number.parseInt(isHex ? entity.slice(2) : entity.slice(1), isHex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const mapped = NAMED_ENTITIES[entity.toLowerCase()];
    return mapped === undefined ? match : mapped;
  });
}

/**
 * 去标签、解实体、压空白、截断。
 * @param {string} value
 * @param {number} [limit]
 * @returns {string}
 */
function cleanText(value, limit = 120) {
  if (!value) return '';
  const plain = decodeEntities(String(value))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= limit) return plain;
  return `${plain.slice(0, limit).replace(/[\s,.;:!?，。、；：！？]+$/u, '')}…`;
}

/**
 * @param {string} body
 * @param {string} tag
 * @returns {string}
 */
function pickTag(body, tag) {
  const match = body.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!match) return '';
  let value = match[1].trim();
  const cdata = value.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  if (cdata) value = cdata[1];
  return value.trim();
}

/**
 * @param {string} body
 * @returns {string}
 */
function pickLink(body) {
  const text = pickTag(body, 'link');
  if (/^https?:\/\//i.test(text)) return text;
  const href = body.match(/<link[^>]*\bhref=["']([^"']+)["'][^>]*>/i);
  if (href) return href[1];
  const guid = pickTag(body, 'guid');
  return /^https?:\/\//i.test(guid) ? guid : '';
}

/**
 * 解析 RSS 2.0 / Atom 条目。
 * @param {string} xml
 * @param {string} sourceName
 */
function parseFeed(xml, sourceName) {
  /** @type {Array<{title:string, description:string, url:string, source:string, publishedAt:string|null}>} */
  const items = [];
  const pattern = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = pattern.exec(xml)) !== null) {
    const body = match[2];
    const title = cleanText(pickTag(body, 'title'), 90);
    if (!title) continue;
    const published =
      pickTag(body, 'pubDate') ||
      pickTag(body, 'published') ||
      pickTag(body, 'updated') ||
      pickTag(body, 'dc:date');
    items.push({
      title,
      description: cleanText(
        pickTag(body, 'description') || pickTag(body, 'content:encoded') || pickTag(body, 'summary'),
        110,
      ),
      url: pickLink(body),
      source: sourceName,
      publishedAt: published ? toIso(published) : null,
    });
  }
  return items;
}

/**
 * 把 RSS / 中文相对时间转成 ISO 字符串，无法解析返回 null。
 * @param {string} raw
 * @returns {string|null}
 */
function toIso(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  const now = Date.now();
  const minute = /^(\d+)\s*分钟前$/.exec(value);
  if (minute) return new Date(now - Number(minute[1]) * 60_000).toISOString();
  const hour = /^(\d+)\s*小时前$/.exec(value);
  if (hour) return new Date(now - Number(hour[1]) * 3_600_000).toISOString();
  const yesterday = /^昨天\s*(\d{1,2}):(\d{2})$/.exec(value);
  if (yesterday) {
    const date = new Date(now);
    date.setDate(date.getDate() - 1);
    date.setHours(Number(yesterday[1]), Number(yesterday[2]), 0, 0);
    return date.toISOString();
  }
  const monthDay = /^(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})$/.exec(value);
  if (monthDay) {
    const date = new Date(now);
    date.setMonth(Number(monthDay[1]) - 1, Number(monthDay[2]));
    date.setHours(Number(monthDay[3]), Number(monthDay[4]), 0, 0);
    if (date.getTime() > now + 86_400_000) date.setFullYear(date.getFullYear() - 1);
    return date.toISOString();
  }
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return null;
}

/* ------------------------------------------------------------------ *
 * 天气
 * ------------------------------------------------------------------ */

/** WWO 天气码 → 中文描述 + 图标键 */
const WEATHER_META = {
  113: ['晴', 'sun'],
  116: ['局部多云', 'partly'],
  119: ['多云', 'cloud'],
  122: ['阴', 'overcast'],
  143: ['薄雾', 'fog'],
  149: ['烟霾', 'haze'],
  176: ['局部有雨', 'rain'],
  179: ['吹雪', 'snow'],
  182: ['暴雪', 'snow'],
  185: ['冻雾', 'fog'],
  200: ['雷阵雨', 'thunder'],
  227: ['大风', 'wind'],
  248: ['冻毛毛雨', 'rain'],
  263: ['局部毛毛雨', 'drizzle'],
  266: ['毛毛雨', 'drizzle'],
  281: ['冻雨', 'rain'],
  284: ['强冻毛毛雨', 'rain'],
  293: ['局部小雨', 'rain'],
  296: ['小雨', 'rain'],
  299: ['中雨', 'rain'],
  302: ['中雨', 'rain'],
  305: ['阵雨', 'rain'],
  308: ['大雨', 'rain'],
  311: ['轻冻雨', 'rain'],
  314: ['强冻雨', 'rain'],
  317: ['轻雨夹雪', 'sleet'],
  320: ['强雨夹雪', 'sleet'],
  323: ['局部小雪', 'snow'],
  326: ['小雪', 'snow'],
  329: ['局部中雪', 'snow'],
  332: ['中雪', 'snow'],
  335: ['局部大雪', 'snow'],
  338: ['大雪', 'snow'],
  350: ['冰粒', 'sleet'],
  353: ['小阵雨', 'rain'],
  356: ['强阵雨', 'rain'],
  359: ['暴雨', 'rain'],
  362: ['轻阵性雨夹雪', 'sleet'],
  365: ['强阵性雨夹雪', 'sleet'],
  368: ['小阵雪', 'snow'],
  371: ['强阵雪', 'snow'],
  374: ['阵性冰粒', 'sleet'],
  377: ['强阵性冰粒', 'sleet'],
  386: ['阵雨伴雪', 'sleet'],
  389: ['强阵雨伴雪', 'sleet'],
};

/**
 * @param {number|string} code
 * @returns {{desc:string, icon:string}}
 */
function weatherMeta(code) {
  const key = Number(code);
  const entry = WEATHER_META[key];
  return entry ? { desc: entry[0], icon: entry[1] } : { desc: '未知', icon: 'cloud' };
}

/**
 * @param {string} cityName
 */
async function geocodeCity(cityName) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    cityName,
  )}&count=8&language=zh&format=json`;
  const json = await httpJson(url);
  const results = Array.isArray(json?.results) ? json.results : [];
  return results.map((item) => ({
    id: String(item.id ?? ''),
    name: String(item.name ?? ''),
    admin1: String(item.admin1 ?? ''),
    country: String(item.country ?? ''),
    latitude: Number(item.latitude),
    longitude: Number(item.longitude),
  }));
}

/**
 * @param {{latitude:number, longitude:number}} candidate
 */
async function fetchWeatherAt(candidate) {
  const url = `https://wttr.in/${candidate.latitude},${candidate.longitude}?format=j1`;
  const json = await httpJson(url, { timeout: 20_000 });
  const current = json?.current_condition?.[0];
  const area = json?.nearest_area?.[0];
  const days = Array.isArray(json?.weather) ? json.weather : [];
  if (!current || days.length === 0) throw new Error('weather_shape');

  const meta = weatherMeta(current.weatherCode);
  const utcHour = new Date().getUTCHours();
  const localHour = (utcHour + Math.round(candidate.longitude / 15) + 24) % 24;

  const forecast = days.slice(0, 3).map((day, index) => {
    const hourly = Array.isArray(day.hourly) ? day.hourly : [];
    const slots = index === 0 ? hourly.filter((slot) => Number(slot.time) / 100 >= localHour) : hourly;
    const pool = slots.length ? slots : hourly;
    const probability = pool.reduce((max, slot) => Math.max(max, Number(slot.chanceofrain) || 0), 0);
    const mid = hourly[Math.floor(hourly.length / 2)] ?? hourly[0] ?? {};
    const dayMeta = weatherMeta(mid.weatherCode ?? current.weatherCode);
    return {
      date: String(day.date ?? ''),
      label: index === 0 ? '今天' : index === 1 ? '明天' : '后天',
      high: Number(day.maxtempC ?? 0),
      low: Number(day.mintempC ?? 0),
      probability,
      desc: dayMeta.desc,
      icon: dayMeta.icon,
    };
  });

  // 逐时预报：从当前时段起向后取若干个三小时档位，供空间富余时展开。
  const currentSlot = Math.floor(localHour / 3) * 3;
  const hourly = [];
  for (let dayIndex = 0; dayIndex < days.length && hourly.length < 6; dayIndex += 1) {
    const slots = Array.isArray(days[dayIndex].hourly) ? days[dayIndex].hourly : [];
    for (const slot of slots) {
      const hour = Number(slot.time) / 100;
      if (!Number.isFinite(hour)) continue;
      if (dayIndex === 0 && hour < currentSlot) continue;
      const slotMeta = weatherMeta(slot.weatherCode);
      hourly.push({
        day: dayIndex === 0 ? '今天' : dayIndex === 1 ? '明天' : '后天',
        time: `${String(Math.floor(hour)).padStart(2, '0')}:00`,
        temp: Number(slot.tempC ?? 0),
        probability: Number(slot.chanceofrain) || 0,
        humidity: Number(slot.humidity) || 0,
        windSpeed: Number(slot.windspeedKmph) || 0,
        desc: slotMeta.desc,
        icon: slotMeta.icon,
      });
      if (hourly.length >= 6) break;
    }
  }

  const astronomy = Array.isArray(days[0]?.astronomy) ? days[0].astronomy[0] : null;

  return {
    // 优先用中文地名（open-meteo geocoding language=zh），再退回 wttr.in 的英文地名。
    city: candidate.name || String(area?.areaName?.[0]?.value ?? ''),
    region: candidate.admin1 || String(area?.region?.[0]?.value ?? ''),
    country: candidate.country || String(area?.country?.[0]?.value ?? ''),
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    current: {
      temp: Number(current.temp_C ?? 0),
      feels: Number(current.FeelsLikeC ?? 0),
      humidity: Number(current.humidity ?? 0),
      windSpeed: Number(current.windspeedKmph ?? 0),
      precipitation: Number(current.precipMM ?? 0),
      pressure: Number(current.pressure ?? 0),
      visibility: Number(current.visibility ?? 0),
      cloud: Number(current.cloudcover ?? 0),
      sunrise: String(astronomy?.sunrise ?? ''),
      sunset: String(astronomy?.sunset ?? ''),
      desc: meta.desc,
      icon: meta.icon,
      observationTime: String(current.observation_time ?? ''),
    },
    forecast,
    hourly,
  };
}

/**
 * @param {string} cityName
 * @param {number} pick
 * @param {boolean} refresh
 */
async function loadWeather(cityName, pick, refresh) {
  const key = cityName || '南京';
  const cached = contentCache.get(`weather:${key}`);
  if (!refresh && cached && Date.now() - cached.at < CONTENT_TTL) {
    const candidates = cached.value.candidates ?? [];
    const index = Math.min(Math.max(pick, 0), Math.max(candidates.length - 1, 0));
    const selected = candidates[index];
    if (selected) return { ...cached.value.data, candidates, index };
  }

  const candidates = await geocodeCity(key);
  if (candidates.length === 0) throw new Error('city_not_found');
  const index = Math.min(Math.max(pick, 0), candidates.length - 1);
  const selected = candidates[index];
  const data = await fetchWeatherAt(selected);
  contentCache.set(`weather:${key}`, {
    at: Date.now(),
    value: { query: key, candidates, data },
  });
  lastGoodWeather = { candidates, data };
  return { ...data, candidates, index };
}

/* ------------------------------------------------------------------ *
 * 新闻栏目
 * ------------------------------------------------------------------ */

const NEWS_DEFINITIONS = {
  headlines: { label: '要闻', feeds: [{ url: 'https://www.chinanews.com.cn/rss/importnews.xml', name: '中新网' }] },
  politics: { label: '时政', feeds: [{ url: 'https://www.chinanews.com.cn/rss/china.xml', name: '中新网' }] },
  tech: {
    label: '科技',
    feeds: [
      { url: 'https://www.ithome.com/rss/', name: 'IT之家' },
      { url: 'https://sspai.com/feed', name: '少数派' },
    ],
  },
  finance: { label: '财经', yicaiCids: [54, 53] },
  hot: { label: '热榜' },
  stories: { label: '知乎日报' },
};

/**
 * @param {string} url
 * @param {string} sourceName
 */
async function fetchFeed(url, sourceName) {
  const xml = await httpText(url);
  return parseFeed(xml, sourceName);
}

/**
 * 科技栏目：两个源合并去重，交替穿插。
 * @returns {Promise<any[]>}
 */
async function fetchTech() {
  const [ithome, sspai] = await Promise.allSettled([
    fetchFeed('https://www.ithome.com/rss/', 'IT之家'),
    fetchFeed('https://sspai.com/feed', '少数派'),
  ]);
  const lists = [ithome.status === 'fulfilled' ? ithome.value : [], sspai.status === 'fulfilled' ? sspai.value : []];
  const seen = new Set();
  const merged = [];
  const max = Math.max(lists[0]?.length ?? 0, lists[1]?.length ?? 0);
  for (let index = 0; index < max; index += 1) {
    for (const list of lists) {
      const item = list[index];
      if (!item || seen.has(item.title)) continue;
      seen.add(item.title);
      merged.push(item);
    }
  }
  if (merged.length === 0) throw new Error('tech_empty');
  return merged;
}

/**
 * @param {number} cid
 */
async function fetchYicai(cid) {
  const url = `https://www.yicai.com/api/ajax/getlistbycid?cid=${cid}&page=1&pagesize=12`;
  const json = await httpJson(url, { headers: { referer: 'https://www.yicai.com/' } });
  const list = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
  return list
    .map((item) => {
      const link = String(item.ShareUrl ?? '');
      const relative = String(item.url ?? '');
      return {
        title: cleanText(String(item.NewsTitle ?? ''), 90),
        description: cleanText(String(item.NewsNotes ?? ''), 110),
        url: link || (relative ? `https://www.yicai.com${relative}` : ''),
        source: '第一财经',
        publishedAt: toIso(String(item.pubDate ?? '')),
        publishedLabel: String(item.pubDate ?? ''),
      };
    })
    .filter((item) => item.title);
}

/**
 * 热榜：今日头条为主，百度兜底。
 */
async function fetchHotBoard() {
  try {
    const json = await httpJson('https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc', {
      headers: { referer: 'https://www.toutiao.com/' },
    });
    const data = Array.isArray(json?.data) ? json.data : [];
    const items = data
      .map((item, index) => ({
        rank: index + 1,
        title: cleanText(String(item.Title ?? ''), 80),
        score: Number(item.HotValue) || 0,
        url: item.ClusterIdStr ? `https://www.toutiao.com/trending/${String(item.ClusterIdStr)}/` : String(item.Url ?? ''),
        category: String(item.InterestCategory ?? ''),
      }))
      .filter((item) => item.title);
    if (items.length === 0) throw new Error('toutiao_empty');
    return { sourceName: '今日头条', items };
  } catch (error) {
    const json = await httpJson('https://top.baidu.com/api/board?platform=pc&tab=realtime', {
      headers: { referer: 'https://top.baidu.com/board?tab=realtime' },
    });
    const content = json?.data?.cards?.[0]?.content;
    const list = Array.isArray(content) ? content : [];
    const items = list
      .map((item, index) => ({
        rank: index + 1,
        title: cleanText(String(item.query ?? item.word ?? ''), 80),
        score: Number(item.hotScore) || 0,
        url: String(item.rawUrl ?? item.url ?? ''),
        category: String(item.hotTag ?? ''),
      }))
      .filter((item) => item.title);
    if (items.length === 0) throw new Error('hot_empty');
    return { sourceName: '百度', items };
  }
}

/**
 * @returns {Promise<any[]>}
 */
async function fetchZhihuStories() {
  const json = await httpJson('https://news-at.zhihu.com/api/4/news/latest');
  const stories = [
    ...(Array.isArray(json?.stories) ? json.stories : []),
    ...(Array.isArray(json?.top_stories) ? json.top_stories : []),
  ];
  const seen = new Set();
  const items = [];
  for (const story of stories) {
    const id = String(story.id ?? story.url ?? '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    items.push({
      title: cleanText(String(story.title ?? ''), 90),
      description: cleanText(String(story.hint ?? ''), 110),
      url: String(story.url ?? ''),
      source: '知乎日报',
      publishedAt: null,
    });
  }
  if (items.length === 0) throw new Error('zhihu_empty');
  return items;
}

/**
 * @param {string} key
 */
async function loadNews(key) {
  const definition = NEWS_DEFINITIONS[key];
  if (!definition) throw new Error('unknown_source');
  const cached = contentCache.get(`news:${key}`);
  if (cached && Date.now() - cached.at < CONTENT_TTL) return cached.value;

  /** @type {{sourceName:string, items:any[], status:string, updatedAt?:string}} */
  let result;
  if (key === 'hot') {
    const hot = await fetchHotBoard();
    result = { sourceName: hot.sourceName, items: hot.items, status: 'ok' };
  } else if (key === 'stories') {
    result = { sourceName: '知乎日报', items: await fetchZhihuStories(), status: 'ok' };
  } else if (key === 'tech') {
    result = { sourceName: 'IT之家 · 少数派', items: await fetchTech(), status: 'ok' };
  } else if (key === 'finance') {
    const groups = await Promise.allSettled(definition.yicaiCids.map((cid) => fetchYicai(cid)));
    const items = [];
    const seen = new Set();
    for (const group of groups) {
      if (group.status !== 'fulfilled') continue;
      for (const item of group.value) {
        if (seen.has(item.title)) continue;
        seen.add(item.title);
        items.push(item);
      }
    }
    if (items.length === 0) throw new Error('finance_empty');
    result = { sourceName: '第一财经', items, status: 'ok' };
  } else {
    const feeds = definition.feeds ?? [];
    const groups = await Promise.allSettled(feeds.map((feed) => fetchFeed(feed.url, feed.name)));
    const items = [];
    const seen = new Set();
    for (const group of groups) {
      if (group.status !== 'fulfilled') continue;
      for (const item of group.value) {
        if (seen.has(item.title)) continue;
        seen.add(item.title);
        items.push(item);
      }
    }
    if (items.length === 0) throw new Error('feed_empty');
    result = { sourceName: feeds.map((feed) => feed.name).join(' · '), items, status: 'ok' };
  }

  result.updatedAt = new Date().toISOString();
  contentCache.set(`news:${key}`, { at: Date.now(), value: result });
  return result;
}

/* ------------------------------------------------------------------ *
 * 行情
 * ------------------------------------------------------------------ */

const STOCK_FIELDS = 'f43,f44,f45,f46,f47,f48,f57,f58,f59,f60,f86,f169,f170';

/**
 * 预定义国际品种。aliases 用于中文输入匹配（大小写不敏感）。
 * @type {Record<string, {code:string, name:string, unit:string, kind:string, aliases:string[], hf?:string, em?:string, decimals?:number}>}
 */
const COMMODITY_SPECS = {
  XAU: {
    code: 'XAU',
    name: '伦敦金',
    unit: '元/克',
    kind: 'metal',
    hf: 'hf_XAU',
    aliases: ['黄金', '金价', '伦敦金', '现货黄金', '国际金价', 'xau', 'gold'],
  },
  XAG: {
    code: 'XAG',
    name: '伦敦银',
    unit: '元/克',
    kind: 'metal',
    hf: 'hf_XAG',
    aliases: ['白银', '银价', '伦敦银', '现货白银', 'xag', 'silver'],
  },
  GC: {
    code: 'GC',
    name: '纽约黄金',
    unit: '元/克',
    kind: 'metal',
    hf: 'hf_GC',
    aliases: ['纽约黄金', '纽约金', 'comex黄金', 'gc'],
  },
  SI: {
    code: 'SI',
    name: '纽约白银',
    unit: '元/克',
    kind: 'metal',
    hf: 'hf_SI',
    aliases: ['纽约白银', 'comex白银', 'si'],
  },
  CL: {
    code: 'CL',
    name: '纽约原油',
    unit: '美元/桶',
    kind: 'oil',
    hf: 'hf_CL',
    aliases: ['原油', '石油', '国际原油', '纽约原油', 'crude', 'cl', 'oil'],
  },
  BTC: {
    code: 'BTC',
    name: '比特币期货',
    unit: '美元',
    kind: 'crypto',
    hf: 'hf_BTC',
    aliases: ['比特币', '比特币期货', 'btc', 'bitcoin'],
  },
  AU9999: {
    code: 'AU9999',
    name: '黄金9999',
    unit: '元/克',
    kind: 'native',
    em: '118.Au9999',
    decimals: 2,
    aliases: ['黄金9999', '沪金', '9999', 'au9999', '黄金9999克'],
  },
};

/**
 * 6 位数字 → 市场前缀。
 * @param {string} digits
 * @returns {string}
 */
function marketOf(digits) {
  const head = digits.charAt(0);
  if (head === '6' || head === '9') return 'sh';
  if (head === '0' || head === '2' || head === '3') return 'sz';
  if (head === '4' || head === '8') return 'bj';
  return 'sh';
}

/**
 * @param {string} code
 * @returns {string}
 */
function secidOf(code) {
  const market = code.slice(0, 2);
  const digits = code.slice(2);
  const prefix = market === 'sh' ? '1.' : '0.';
  return `${prefix}${digits}`;
}

/**
 * 输入白名单解析：6 位数字 / sh|sz|bj 前缀 / 品种别名。
 * @param {string} raw
 * @returns {{code:string, kind:'stock'|'commodity'}|null}
 */
function resolveInput(raw) {
  const value = String(raw ?? '').trim();
  if (!value || value.length > 32) return null;
  const compact = value.replace(/\s+/g, '');
  const lower = compact.toLowerCase();

  for (const spec of Object.values(COMMODITY_SPECS)) {
    if (spec.code.toLowerCase() === lower) return { code: spec.code, kind: 'commodity' };
    if (spec.aliases.some((alias) => alias.toLowerCase() === lower)) {
      return { code: spec.code, kind: 'commodity' };
    }
  }

  const prefixed = /^(sh|sz|bj)([0-9]{6})$/.exec(lower);
  if (prefixed) return { code: `${prefixed[1]}${prefixed[2]}`, kind: 'stock' };

  if (/^[0-9]{6}$/.test(compact)) {
    return { code: `${marketOf(compact)}${compact}`, kind: 'stock' };
  }
  return null;
}

/**
 * @param {string} secid
 */
async function fetchEastmoneyQuote(secid) {
  const url = `https://push2.eastmoney.com/api/qt/stock/get?ut=fa5fd1943c7b386f172d6893dbfba10b&invt=2&fields=${STOCK_FIELDS}&secid=${secid}`;
  const json = await httpJson(url);
  const data = json?.data;
  if (!data || typeof data.f43 !== 'number' || data.f43 === 0) throw new Error('empty_quote');
  const factor = 10 ** (data.f59 || 2);
  return {
    name: String(data.f58 ?? ''),
    code: String(data.f57 ?? ''),
    price: data.f43 / factor,
    prevClose: Number(data.f60 ?? 0) / factor,
    change: Number(data.f169 ?? 0) / factor,
    changePercent: Number(data.f170 ?? 0) / factor,
    high: Number(data.f44 ?? 0) / factor,
    low: Number(data.f45 ?? 0) / factor,
    open: Number(data.f46 ?? 0) / factor,
    volume: Number(data.f47 ?? 0),
    amount: Number(data.f48 ?? 0),
    updatedAt: data.f86 ? new Date(data.f86 * 1000).toISOString() : null,
    provider: '东方财富',
  };
}

/**
 * 新浪 A 股备源（GBK + Referer）。
 * @param {string} code
 */
async function fetchSinaStock(code) {
  const text = await httpText(`https://hq.sinajs.cn/list=${code}`, {
    encoding: 'gbk',
    headers: { referer: 'https://finance.sina.com.cn/' },
  });
  const match = text.match(/="([^"]*)"/);
  const fields = match ? match[1].split(',') : [];
  if (fields.length < 32) throw new Error('empty_quote');
  const price = Number(fields[3]);
  const prevClose = Number(fields[2]);
  if (!Number.isFinite(price) || price === 0) throw new Error('empty_quote');
  const date = fields[30] ?? '';
  const time = fields[31] ?? '';
  return {
    name: String(fields[0] ?? ''),
    code: code.slice(2),
    price,
    prevClose,
    change: price - prevClose,
    changePercent: prevClose ? ((price - prevClose) / prevClose) * 100 : 0,
    high: Number(fields[4] ?? 0),
    low: Number(fields[5] ?? 0),
    open: Number(fields[1] ?? 0),
    volume: Number(fields[8] ?? 0),
    amount: Number(fields[9] ?? 0),
    updatedAt: date && time ? new Date(`${date}T${time}:00+08:00`).toISOString() : null,
    provider: '新浪财经',
  };
}

/**
 * 腾讯 A 股备源（GBK，无需 Referer）。时间字段用 14 位数字锚点定位。
 * @param {string} code
 */
async function fetchTencentStock(code) {
  const text = await httpText(`https://qt.gtimg.cn/q=${code}`, { encoding: 'gbk' });
  const match = text.match(/="([^"]*)"/);
  const fields = match ? match[1].split('~') : [];
  if (fields.length < 32) throw new Error('empty_quote');
  const price = Number(fields[3]);
  const prevClose = Number(fields[4]);
  if (!Number.isFinite(price) || price === 0) throw new Error('empty_quote');
  const anchor = fields.findIndex((value) => /^\d{14}$/.test(value));
  const change = anchor > 0 ? Number(fields[anchor + 1]) : price - prevClose;
  const changePercent = anchor > 0 ? Number(fields[anchor + 2]) : prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
  const stamp = anchor > 0 ? fields[anchor] : '';
  const updatedAt = stamp
    ? new Date(
        `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(
          10,
          12,
        )}:${stamp.slice(12, 14)}+08:00`,
      ).toISOString()
    : null;
  return {
    name: String(fields[1] ?? ''),
    code: String(fields[2] ?? ''),
    price,
    prevClose,
    change: Number.isFinite(change) ? change : 0,
    changePercent: Number.isFinite(changePercent) ? changePercent : 0,
    high: anchor > 0 ? Number(fields[anchor + 3]) : 0,
    low: anchor > 0 ? Number(fields[anchor + 4]) : 0,
    open: Number(fields[5] ?? 0),
    volume: 0,
    amount: 0,
    updatedAt,
    provider: '腾讯财经',
  };
}

/**
 * 新浪国际品种主源（GBK + Referer）。
 * @param {string} hfCode
 */
async function fetchSinaCommodity(hfCode) {
  const text = await httpText(`https://hq.sinajs.cn/list=${hfCode}`, {
    encoding: 'gbk',
    headers: { referer: 'https://finance.sina.com.cn/' },
  });
  const match = text.match(/="([^"]*)"/);
  const fields = match ? match[1].split(',') : [];
  if (fields.length < 14) throw new Error('empty_quote');
  const price = Number(fields[0]);
  const prevClose = Number(fields[7]);
  if (!Number.isFinite(price) || price === 0) throw new Error('empty_quote');
  return {
    name: String(fields[13] ?? ''),
    price,
    prevClose,
    change: price - prevClose,
    changePercent: prevClose ? ((price - prevClose) / prevClose) * 100 : 0,
    high: Number(fields[4] ?? 0),
    low: Number(fields[5] ?? 0),
    open: Number(fields[8] ?? 0),
    updatedAt: fields[12] && fields[6] ? `${fields[12]}T${fields[6]}+08:00` : null,
    provider: '新浪财经',
  };
}

/**
 * 腾讯国际品种备源。
 * @param {string} hfCode
 */
async function fetchTencentCommodity(hfCode) {
  const text = await httpText(`https://qt.gtimg.cn/q=${hfCode}`, { encoding: 'gbk' });
  const match = text.match(/="([^"]*)"/);
  const fields = match ? match[1].split(',') : [];
  if (fields.length < 14) throw new Error('empty_quote');
  const price = Number(fields[0]);
  const prevClose = Number(fields[7]);
  if (!Number.isFinite(price) || price === 0) throw new Error('empty_quote');
  return {
    name: String(fields[13] ?? ''),
    price,
    prevClose,
    change: price - prevClose,
    changePercent: prevClose ? ((price - prevClose) / prevClose) * 100 : 0,
    high: Number(fields[4] ?? 0),
    low: Number(fields[5] ?? 0),
    open: Number(fields[8] ?? 0),
    updatedAt: fields[12] && fields[6] ? `${fields[12]}T${fields[6]}+08:00` : null,
    provider: '腾讯财经',
  };
}

/**
 * 美元兑人民币汇率。
 * @param {boolean} refresh
 */
async function loadFxRate(refresh) {
  const cached = contentCache.get('fx');
  if (!refresh && cached && Date.now() - cached.at < FX_TTL) return cached.value;
  try {
    const quote = await fetchEastmoneyQuote('133.USDCNH');
    if (quote.price > 3 && quote.price < 10) {
      const value = { rate: quote.price, label: '美元兑离岸人民币', provider: '东方财富' };
      contentCache.set('fx', { at: Date.now(), value });
      return value;
    }
    throw new Error('fx_range');
  } catch (error) {
    const text = await httpText('https://hq.sinajs.cn/list=fx_susdcny', {
      encoding: 'gbk',
      headers: { referer: 'https://finance.sina.com.cn/' },
    });
    const match = text.match(/="([^"]*)"/);
    const fields = match ? match[1].split(',') : [];
    const rate = Number(fields[1]);
    if (!Number.isFinite(rate) || rate <= 3 || rate >= 10) throw new Error('fx_unavailable');
    const value = { rate, label: '美元兑人民币', provider: '新浪财经' };
    contentCache.set('fx', { at: Date.now(), value });
    return value;
  }
}

/**
 * A 股行情：东财主源，新浪 / 腾讯备源。
 * @param {string} code
 */
async function fetchStockQuote(code) {
  let quote;
  try {
    quote = await fetchEastmoneyQuote(secidOf(code));
  } catch (error) {
    try {
      quote = await fetchSinaStock(code);
    } catch (secondError) {
      quote = await fetchTencentStock(code);
    }
  }
  // 保留自选股里的规范代码（如 sh600519），供应商原始代码放在 symbol。
  return { ...quote, symbol: quote.code, code };
}

/**
 * 国际品种行情。贵金属统一折算为人民币/克。
 * @param {string} code
 */
async function fetchCommodityQuote(code) {
  const spec = COMMODITY_SPECS[code];
  let raw;
  if (spec.em) {
    raw = await fetchEastmoneyQuote(spec.em);
  } else {
    try {
      raw = await fetchSinaCommodity(spec.hf);
    } catch (error) {
      raw = await fetchTencentCommodity(spec.hf);
    }
  }

  if (spec.kind === 'metal') {
    const fx = await loadFxRate(false);
    const gramPrice = (raw.price * fx.rate) / GRAMS_PER_OUNCE;
    const gramPrev = (raw.prevClose * fx.rate) / GRAMS_PER_OUNCE;
    return {
      code,
      name: spec.name,
      price: gramPrice,
      prevClose: gramPrev,
      change: gramPrice - gramPrev,
      changePercent: raw.prevClose ? ((raw.price - raw.prevClose) / raw.prevClose) * 100 : 0,
      high: (raw.high * fx.rate) / GRAMS_PER_OUNCE,
      low: (raw.low * fx.rate) / GRAMS_PER_OUNCE,
      unit: spec.unit,
      decimals: 2,
      updatedAt: raw.updatedAt,
      provider: raw.provider,
      title: `原始报价 ${raw.price} 美元/盎司（昨收 ${raw.prevClose}）｜汇率 ${fx.rate}（${fx.label}）｜${raw.provider}`,
    };
  }

  return {
    code,
    name: spec.name,
    price: raw.price,
    prevClose: raw.prevClose,
    change: raw.change,
    changePercent: raw.changePercent,
    high: raw.high,
    low: raw.low,
    unit: spec.unit,
    decimals: spec.decimals ?? 2,
    updatedAt: raw.updatedAt,
    provider: raw.provider,
    title: spec.kind === 'native' ? '上海黄金交易所原生报价（人民币元/克）' : '',
  };
}

/**
 * @param {string} code
 * @param {MiniAppContext} context
 * @param {boolean} refresh
 */
async function getQuote(code, context, refresh) {
  const cached = quoteCache.get(code);
  if (!refresh && cached && Date.now() - cached.at < QUOTE_TTL) return cached.value;
  try {
    const value = COMMODITY_SPECS[code]
      ? await fetchCommodityQuote(code)
      : await fetchStockQuote(code);
    quoteCache.set(code, { at: Date.now(), value });
    return value;
  } catch (error) {
    context.logger.warn('miniapp.quote.failed', { code });
    if (cached) return { ...cached.value, stale: true };
    return { code, name: code, error: 'quote_unavailable' };
  }
}

/**
 * 股票池与商品池分开取数。
 * @param {string[]} codes
 * @param {MiniAppContext} context
 * @param {boolean} refresh
 */
async function fetchAllQuotes(codes, context, refresh) {
  const stockPool = codes.filter((code) => !COMMODITY_SPECS[code]);
  const commodityPool = codes.filter((code) => Boolean(COMMODITY_SPECS[code]));
  const [stocks, commodities] = await Promise.all([
    Promise.all(stockPool.map((code) => getQuote(code, context, refresh))),
    Promise.all(commodityPool.map((code) => getQuote(code, context, refresh))),
  ]);
  const map = new Map();
  for (const item of [...stocks, ...commodities]) map.set(item.code, item);
  return codes.map((code) => map.get(code) ?? { code, error: 'quote_unavailable' });
}

/* ------------------------------------------------------------------ *
 * 自选股持久化
 * ------------------------------------------------------------------ */

/**
 * @param {string} dataDir
 * @param {MiniAppContext} context
 */
function createWatchlistStore(dataDir, context) {
  const file = join(dataDir, 'watchlist.json');
  /** @type {string[]} */
  let codes = [];

  return {
    async load() {
      try {
        const raw = await readFile(file, 'utf8');
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed?.codes) ? parsed.codes : [];
        codes = list
          .map((code) => resolveInput(code))
          .filter((resolved) => Boolean(resolved))
          .map((resolved) => /** @type {{code:string}} */ (resolved).code);
      } catch {
        codes = [];
      }
      return codes;
    },
    list() {
      return [...codes];
    },
    async save(next) {
      codes = [...next];
      try {
        await mkdir(dataDir, { recursive: true });
        const temporary = `${file}.tmp`;
        await writeFile(temporary, JSON.stringify({ codes, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
        await rename(temporary, file);
      } catch (error) {
        context.logger.warn('miniapp.watchlist.persist_failed', {});
      }
    },
  };
}

/* ------------------------------------------------------------------ *
 * HTTP 层
 * ------------------------------------------------------------------ */

/** @type {Map<string, {at:number, value:any}>} */
const contentCache = new Map();
/** @type {Map<string, {at:number, value:any}>} */
const quoteCache = new Map();
/** @type {{candidates:any[], data:any}|null} */
let lastGoodWeather = null;

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {any} payload
 */
function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

/**
 * @param {import('node:http').IncomingMessage} request
 * @returns {Promise<string>}
 */
async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('body_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * @param {MiniAppContext} context
 * @param {{list: () => string[], save: (next: string[]) => Promise<void>}} watchlist
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 */
async function handleRequest(context, watchlist, request, response) {
  const url = new URL(request.url ?? '/', 'http://miniapp.local');
  const path = url.pathname;
  const method = request.method ?? 'GET';
  const refresh = url.searchParams.get('refresh') === '1';

  if (method === 'GET' && path === '/dashboard') {
    const html = await readFile(join(context.pluginRoot, 'miniapp/client/index.html'));
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': html.length,
    });
    response.end(html);
    return;
  }

  if (method === 'GET' && path === '/api/health') {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === 'GET' && path === '/api/board') {
    const source = url.searchParams.get('source') ?? 'weather';
    if (source === 'weather') {
      try {
        const city = url.searchParams.get('city') ?? '南京';
        const pick = Number(url.searchParams.get('pick') ?? '0') || 0;
        const data = await loadWeather(city, pick, refresh);
        sendJson(response, 200, { ok: true, source, updatedAt: new Date().toISOString(), data });
      } catch (error) {
        context.logger.warn('miniapp.weather.failed', {});
        if (lastGoodWeather) {
          sendJson(response, 200, {
            ok: true,
            source,
            updatedAt: new Date().toISOString(),
            stale: true,
            warning: 'source_error',
            message: '天气来源异常，已保留上一次数据',
            data: lastGoodWeather.data,
          });
          return;
        }
        sendJson(response, 200, {
          ok: true,
          source,
          updatedAt: new Date().toISOString(),
          warning: 'source_error',
          message: '天气来源异常，请稍后重试',
          data: null,
        });
      }
      return;
    }

    if (NEWS_DEFINITIONS[source]) {
      try {
        const data = await loadNews(source);
        sendJson(response, 200, { ok: true, source, updatedAt: data.updatedAt, data });
      } catch (error) {
        context.logger.warn('miniapp.news.failed', { source });
        const cached = contentCache.get(`news:${source}`);
        if (cached) {
          sendJson(response, 200, {
            ok: true,
            source,
            updatedAt: cached.value.updatedAt,
            stale: true,
            warning: 'source_error',
            message: '新闻来源异常，已保留上一次数据',
            data: cached.value,
          });
          return;
        }
        sendJson(response, 200, {
          ok: true,
          source,
          updatedAt: new Date().toISOString(),
          warning: 'source_error',
          message: '新闻来源异常，请稍后重试',
          data: { label: NEWS_DEFINITIONS[source].label, items: [], status: 'error' },
        });
      }
      return;
    }

    sendJson(response, 400, { ok: false, error: 'invalid_code', message: '未知的栏目标识' });
    return;
  }

  if (method === 'GET' && path === '/api/stocks') {
    const codes = watchlist.list();
    const stocks = await fetchAllQuotes(codes, context, refresh);
    sendJson(response, 200, {
      ok: true,
      updatedAt: new Date().toISOString(),
      watchlist: codes,
      stocks,
    });
    return;
  }

  if (method === 'POST' && path === '/api/watchlist') {
    let payload;
    try {
      const raw = await readBody(request);
      payload = JSON.parse(raw);
    } catch {
      sendJson(response, 400, { ok: false, error: 'invalid_code', message: '请求体无效或超过 4KB' });
      return;
    }

    const action = String(payload?.action ?? '');
    const rawCode = String(payload?.code ?? '');
    if (action !== 'add' && action !== 'remove') {
      sendJson(response, 400, { ok: false, error: 'invalid_code', message: '不支持的操作' });
      return;
    }

    const resolved = resolveInput(rawCode);
    if (!resolved) {
      sendJson(response, 400, {
        ok: false,
        error: 'invalid_code',
        message: '仅支持 6 位 A 股代码、sh/sz/bj 前缀代码或黄金、原油等预定义品种',
      });
      return;
    }

    const codes = watchlist.list();
    if (action === 'add') {
      if (codes.includes(resolved.code)) {
        const stocks = await fetchAllQuotes(codes, context, true);
        sendJson(response, 200, { ok: true, message: '已在自选股中', watchlist: codes, stocks });
        return;
      }
      if (codes.length >= MAX_WATCHLIST) {
        sendJson(response, 400, {
          ok: false,
          error: 'watchlist_full',
          message: `自选股最多 ${MAX_WATCHLIST} 个，请先移除一个`,
        });
        return;
      }
      codes.push(resolved.code);
    } else {
      const index = codes.indexOf(resolved.code);
      if (index >= 0) codes.splice(index, 1);
    }

    await watchlist.save(codes);
    let stocks = [];
    try {
      stocks = await fetchAllQuotes(codes, context, true);
    } catch (error) {
      context.logger.warn('miniapp.watchlist.quote_failed', {});
    }
    sendJson(response, 200, {
      ok: true,
      message: action === 'add' ? '已添加' : '已移除',
      watchlist: codes,
      stocks,
    });
    return;
  }

  sendJson(response, 404, { ok: false, error: 'invalid_code', message: '接口不存在' });
}

/**
 * @param {MiniAppContext} context
 */
export async function start(context) {
  const watchlist = createWatchlistStore(context.dataDir, context);
  await watchlist.load();

  const server = createServer((request, response) => {
    handleRequest(context, watchlist, request, response).catch((error) => {
      context.logger.warn('miniapp.request.failed', {});
      if (!response.headersSent) {
        sendJson(response, 500, { ok: false, error: 'invalid_code', message: '服务内部异常，请稍后重试' });
      } else {
        response.end();
      }
    });
  });

  await listen(server, context.listen.host, context.listen.port);
  context.logger.info('miniapp.runtime.listening', {});

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    context.signal.removeEventListener('abort', onAbort);
    contentCache.clear();
    quoteCache.clear();
    await close(server);
  };
  const onAbort = () => {
    void dispose();
  };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  return { dispose };
}

/**
 * @param {import('node:http').Server} server
 * @param {string} host
 * @param {number} port
 */
function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

/**
 * @param {import('node:http').Server} server
 */
function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
