// Token 用量悬浮窗 — 悬浮球页面

import {
  applyTheme,
  buildRows,
  desaturate,
  formatTokens,
  gaugeSelection,
  lightenColor,
  rampColor,
  resolveTheme,
  toRgb,
  toRgba,
  wavePath,
} from './metrics.js';
import { getLocale, localized, onLocaleChange, resolveLocale, setLocale, t } from './i18n.js';

const VIEW_STATE_KEY = 'token-usage-widget-view';
const GEOMETRY_KEY = 'token-usage-widget-geometry';

const GAUGE = {
  arcRadius: 97.6,
  circleRatio: 94 / 220,
  wavePeriod: 220,
  waveFrom: -220,
  waveTo: 440,
  waveBottom: 260,
  surfaceOffset: 213,
  surfaceSpan: 188,
};

const SCALE_STEPS = [0.4, 0.5, 0.6, 0.7, 0.8];
const SCALE_LABEL_KEYS = ['option.scale.0.4', 'option.scale.0.5', 'option.scale.0.6', 'option.scale.0.7', 'option.scale.0.8'];
const SCALE_MIN = 0.4;
const SCALE_MAX = 0.8;
const COMPACT_WINDOW = { width: 280, height: 460 };
const SETTINGS_WINDOW = { width: 720, height: 640 };
const HOVER_EXIT_MS = 140;    // 指针离开圆盘/面板后的收起延迟
const HOVER_BRIDGE_PX = 18;   // 圆盘与详情面板之间的过渡带
const CLICK_MARGIN_PX = 14;   // 圆盘外的可交互余量：指针进圈之前先把点击穿透关掉

const elements = {
  app: document.getElementById('app'),
  stage: document.getElementById('stage'),
  gaugeWrap: document.querySelector('.gauge__wrap'),
  gauge: document.getElementById('gaugeButton'),
  gaugeValue: document.getElementById('gaugeValue'),
  gaugeUnit: document.getElementById('gaugeUnit'),
  trendArea: document.getElementById('gaugeTrendArea'),
  trendLine: document.getElementById('gaugeTrendLine'),
  gaugeArc: document.getElementById('gaugeArc'),
  water: document.getElementById('gaugeWater'),
  waveFront: document.getElementById('waveFront'),
  waveMid: document.getElementById('waveMid'),
  waveBack: document.getElementById('waveBack'),
  maskWater: document.getElementById('gaugeMaskWater'),
  maskWave: document.getElementById('gaugeMaskWave'),
  detail: document.getElementById('gaugeDetails'),
  detailList: document.getElementById('detailList'),
  detailStamp: document.getElementById('detailStamp'),
  detailNote: document.getElementById('detailNote'),
  detailGauge: document.getElementById('detailGauge'),
  spark: document.getElementById('detailSpark'),
  popupButton: document.getElementById('popupButton'),
  scaleButton: document.getElementById('scaleButton'),
};

const state = {
  snapshot: null,
  settings: {
    metrics: [],
    refreshSeconds: 5,
    theme: 'system',
    scale: 0.6,
    trendPeriod: 30,
    language: 'system',
    position: null,
    centerMetric: 'five_hour_ratio',
    waterMetric: 'five_hour_ratio',
    ringMetric: 'week_ratio',
  },
  catalog: [],
  hostTheme: null,
  timer: null,
  refreshSeconds: 5,
  scale: 0.6,
  saving: false,
  mode: 'inline',
  windowState: null,
  suppressClick: false,
  detailVisible: false,
};

// 宿主可能在页面脚本执行之后才注入窗口桥接，按需解析，避免模块加载时缓存到 null。
let windowHandle = null;
function handle() {
  if (!windowHandle) {
    windowHandle = (window.mcode && window.mcode.miniapp && window.mcode.miniapp.window) || null;
  }
  return windowHandle;
}

const drag = {
  active: false,
  moved: false,
  pointerId: null,
  startScreenX: 0,
  startScreenY: 0,
  originX: 0,
  originY: 0,
  pending: null,
  frame: null,
};

let hoverTimer = null;

function clampScale(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0.6;
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(numeric * 100) / 100));
}

function buildWaves() {
  const front = wavePath(12, GAUGE.wavePeriod, GAUGE.waveFrom, GAUGE.waveTo, GAUGE.waveBottom);
  const mid = wavePath(8, GAUGE.wavePeriod, GAUGE.waveFrom, GAUGE.waveTo, GAUGE.waveBottom);
  const back = wavePath(5, GAUGE.wavePeriod, GAUGE.waveFrom, GAUGE.waveTo, GAUGE.waveBottom);
  if (elements.waveFront) elements.waveFront.setAttribute('d', front);
  if (elements.waveMid) elements.waveMid.setAttribute('d', mid);
  if (elements.waveBack) elements.waveBack.setAttribute('d', back);
  // 遮罩里的水面复用同一条前波：干区边界必须跟水面对齐
  if (elements.maskWave) elements.maskWave.setAttribute('d', front);
}

/**
 * 尺寸档位用文字表示：最小 / 小 / 中 / 大 / 最大。
 * @param {number} value
 */
function scaleLabel(value) {
  const index = SCALE_STEPS.findIndex((step) => Math.abs(step - value) < 0.06);
  return t(index >= 0 ? SCALE_LABEL_KEYS[index] : SCALE_LABEL_KEYS[2]);
}

function applyScale() {
  state.scale = clampScale(state.scale);
  document.documentElement.style.setProperty('--widget-scale', String(state.scale));
  if (elements.scaleButton) {
    const label = scaleLabel(state.scale);
    elements.scaleButton.textContent = label;
    elements.scaleButton.title = t('scale.aria.title', { label });
    elements.scaleButton.setAttribute('aria-label', t('scale.aria.label', { label }));
  }
}

/**
 * 按设置里的语言偏好切换界面语言。
 * 偏好是 system 时按系统语言走；设置还没加载出来时保持当前语言。
 */
function applyLocalePreference() {
  const preference = state.settings && state.settings.language ? state.settings.language : 'system';
  if (resolveLocale(preference) === getLocale()) return;
  setLocale(preference);
}

// 语言换了要重画：口径行、单位、aria 全都跟着文案走。
onLocaleChange(() => {
  applyScale();
  render();
});

const TREND_WIDTH = 120;
const TREND_HEIGHT = 34;
const TREND_PADDING = 3;
const TREND_SMOOTH_RADIUS = 2;
const TREND_FLOOR = 0.12;

/**
 * 生成平滑面积曲线：只表达趋势，没有坐标轴与刻度。
 * @param {number[]} values
 */
function trendPaths(values) {
  const raw = Array.isArray(values) ? values : [];
  const count = raw.length;
  if (!count) return { line: '', area: '' };
  // 五点滑动平均：只保留大致趋势，单分钟的突发不会被画成一根孤零零的尖刺。
  // 平滑半径跟着桶数走：窗口拉长时分钟桶挤得更密，
  // 固定半径会把单分钟抖动放大成一排锯齿。
  const smoothRadius = Math.max(TREND_SMOOTH_RADIUS, Math.round(count / 15));
  const list = raw.map((value, index) => {
    let sum = 0;
    let weight = 0;
    for (let offset = -smoothRadius; offset <= smoothRadius; offset += 1) {
      const neighbour = index + offset;
      if (neighbour < 0 || neighbour >= count) continue;
      sum += Number(raw[neighbour]) || 0;
      weight += 1;
    }
    return weight ? sum / weight : Number(value) || 0;
  });
  // 平方根标度：单分钟尖峰不会把其余分钟压成一条直线，整体仍能看出趋势走向。
  const roots = list.map((value) => Math.sqrt(Math.max(0, Number(value) || 0)));
  const peak = roots.reduce((top, value) => Math.max(top, value), 0);
  const top = TREND_PADDING;
  const bottom = TREND_HEIGHT - TREND_PADDING;
  // 零值落在基线上而不是卡片底边，空闲的那几分钟就不会把曲线压成贴边的一条直线。
  const baseline = bottom - (bottom - top) * TREND_FLOOR;
  const usable = baseline - top;
  const step = count > 1 ? TREND_WIDTH / (count - 1) : TREND_WIDTH;
  const points = roots.map((value, index) => ({
    x: count > 1 ? index * step : TREND_WIDTH / 2,
    y: peak > 0 ? baseline - (value / peak) * usable : baseline,
  }));
  let line = 'M ' + points[0].x.toFixed(2) + ' ' + points[0].y.toFixed(2);
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] || points[index];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[index + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    line += ' C ' + c1x.toFixed(2) + ' ' + c1y.toFixed(2) + ' ' + c2x.toFixed(2) + ' ' + c2y.toFixed(2)
      + ' ' + p2.x.toFixed(2) + ' ' + p2.y.toFixed(2);
  }
  // 面积收到基线为止：没有消耗的那几分钟只留一条线，不在卡片底部堆出一块暗色台面。
  const floor = baseline.toFixed(2);
  return {
    line: line,
    area: line + ' L ' + TREND_WIDTH + ' ' + floor + ' L 0 ' + floor + ' Z',
  };
}

/**
 * 概括近 30 分钟消耗趋势的方向，供读屏使用。
 * @param {number[]} values
 */
function trendSummary(values) {
  const list = (Array.isArray(values) ? values : []).map((value) => Number(value) || 0);
  if (list.length < 4) return t('trend.noData');
  const half = Math.floor(list.length / 2);
  const average = (chunk) => chunk.reduce((sum, value) => sum + value, 0) / (chunk.length || 1);
  const first = average(list.slice(0, half));
  const last = average(list.slice(list.length - half));
  const delta = last - first;
  const base = Math.max(first, last, 1);
  if (Math.abs(delta) / base < 0.2) return t('trend.steady');
  return delta > 0 ? t('trend.rising') : t('trend.falling');
}

/**
 * 把近 30 分钟的消耗趋势画成浮在圆盘上的面积曲线。
 * @param {number[]} values
 */
function renderTrend(values) {
  if (!elements.trendLine) return;
  const paths = trendPaths(values);
  if (elements.trendArea) elements.trendArea.setAttribute('d', paths.area);
  elements.trendLine.setAttribute('d', paths.line);
}

/**
 * 上色：水面按它自己的指标比例上色，外圈按它自己的紧急度上色。
 * 两处各用各的紧急程度，才不会出现「环是绿的、水是红的」这种互相打架的配色。
 * @param {number} waterUrgency 0~1
 * @param {number} ringUrgency 0~1
 */
function applyGaugeColors(waterUrgency, ringUrgency) {
  const arc = rampColor(ringUrgency);
  const water = desaturate(rampColor(waterUrgency), 0.24);
  const style = document.documentElement.style;
  style.setProperty('--gauge-arc-from', toRgb(arc));
  style.setProperty('--gauge-arc-to', toRgb(lightenColor(arc, 0.38)));
  style.setProperty('--gauge-arc-glow', toRgba(arc, 0.45));
  style.setProperty('--gauge-water-from', toRgb(lightenColor(water, 0.46)));
  style.setProperty('--gauge-water-to', toRgb(water));
  style.setProperty('--gauge-water-mid', toRgba(lightenColor(water, 0.18), 0.6));
  style.setProperty('--gauge-water-soft', toRgba(lightenColor(water, 0.3), 0.44));
  style.setProperty('--gauge-water-line', 'rgba(255, 255, 255, 0.5)');
}

/**
 * 圆盘上的水面与外圈各代表哪一项，写在悬停面板顶部，
 * 这样选了速率类指标时，不必猜这个环指的是哪一段用量。
 * 两行都只写指标本身，不加「水面」「外圈」前缀。
 * @param {any} selection
 */
function renderGaugeLegend(selection) {
  const host = elements.detailGauge;
  if (!host) return;
  host.textContent = '';

  // 圆盘上只留数字不再写指标名，口径改由这行说明
  const center = document.createElement('span');
  center.className = 'detail__gauge-line';
  center.textContent = selection.center.label + ' ' + selection.center.value
    + (selection.center.unit || '');

  const water = document.createElement('span');
  water.className = 'detail__gauge-line';
  water.textContent = selection.water.label + ' ' + Math.round(selection.water.ratio * 100) + '%';

  const ring = document.createElement('span');
  ring.className = 'detail__gauge-line';
  let ringText = selection.ring.label + ' ' + selection.ring.value + (selection.ring.unit || '');
  if (selection.ring.note) {
    ringText += ' · ' + selection.ring.note + ' ' + Math.round(selection.ring.fill * 100) + '%';
  }
  ring.textContent = ringText;

  host.appendChild(center);
  host.appendChild(water);
  host.appendChild(ring);
}

function renderGauge(selection, trendValues, trendLabel, trendWindow) {
  const waterRatio = Math.max(0, Math.min(1, selection.water.ratio));
  const offset = GAUGE.surfaceOffset - waterRatio * GAUGE.surfaceSpan;
  if (elements.water) {
    elements.water.setAttribute('transform', 'translate(0 ' + offset.toFixed(2) + ')');
  }
  // 遮罩里的水面跟真实水面同步：干区（水面以上）因此只剩 15% 的底色
  if (elements.maskWater) {
    elements.maskWater.setAttribute('transform', 'translate(0 ' + offset.toFixed(2) + ')');
  }
  const ringFill = Math.max(0, Math.min(1, selection.ring.fill));
  if (elements.gaugeArc) {
    const circumference = 2 * Math.PI * GAUGE.arcRadius;
    elements.gaugeArc.setAttribute('stroke-dasharray', circumference.toFixed(2));
    elements.gaugeArc.setAttribute('stroke-dashoffset', (circumference * (1 - ringFill)).toFixed(2));
  }
  if (elements.gaugeValue) elements.gaugeValue.textContent = selection.center.value;
  if (elements.gaugeUnit) elements.gaugeUnit.textContent = selection.center.unit;
  renderTrend(trendValues);
  renderGaugeLegend(selection);
  if (elements.gauge) {
    const separator = t('gaugeLegend.separator');
    const parts = [
      t('gaugeLegend.center') + ' ' + selection.center.label + ' ' + selection.center.value + (selection.center.unit || ''),
      t('gaugeLegend.water') + ' ' + selection.water.label + ' ' + Math.round(waterRatio * 100) + '%',
      t('gaugeLegend.ring') + ' ' + selection.ring.label + ' ' + Math.round(ringFill * 100) + '%'
        + (selection.ring.note ? ' ' + t('gaugeLegend.noteWrap', { note: selection.ring.note }) : ''),
      t('gaugeLegend.trend', { minutes: trendWindow, trend: trendSummary(trendValues) }),
    ];
    if (trendLabel) parts.push(trendLabel);
    parts.push(t('gaugeLegend.settings'));
    elements.gauge.setAttribute('aria-label', parts.join(separator));
  }
}
function renderRows(snapshot) {
  const rows = buildRows(snapshot, state.settings, state.catalog);
  if (!elements.detailList) return;
  elements.detailList.textContent = '';
  for (const row of rows) {
    const wrapper = document.createElement('div');
    wrapper.className = 'detail__row';

    const label = document.createElement('dt');
    label.className = 'detail__label';
    label.textContent = row.label;

    const value = document.createElement('dd');
    value.className = 'detail__value numeric';
    value.textContent = row.value;

    wrapper.appendChild(label);
    wrapper.appendChild(value);
    if (row.sub) {
      const sub = document.createElement('dd');
      sub.className = 'detail__sub';
      sub.textContent = row.sub;
      wrapper.appendChild(sub);
    }
    elements.detailList.appendChild(wrapper);
  }
}

function renderSpark(snapshot) {
  if (!elements.spark) return;
  const days = snapshot && snapshot.account && snapshot.account.usage
    ? snapshot.account.usage.last7Days || []
    : [];
  elements.spark.textContent = '';
  if (!days.length) return;
  const max = days.reduce((peak, day) => Math.max(peak, day.total || 0), 0) || 1;
  days.forEach((day, index) => {
    const bar = document.createElement('div');
    bar.className = index === days.length - 1 ? 'spark__bar' : 'spark__bar spark__bar--muted';
    bar.style.height = Math.max(2, Math.round(((day.total || 0) / max) * 26)) + 'px';
    bar.title = t('spark.title', { date: day.date, value: formatTokens(day.total) });
    elements.spark.appendChild(bar);
  });
}

function renderNote(snapshot) {
  if (!elements.detailNote) return;
  const problems = [];
  const account = snapshot.account || {};
  if (!account.ok) {
    problems.push(localized({ zh: account.message, en: account.messageEn }) || t('note.accountUnavailable'));
  }
  elements.detailNote.textContent = problems.length
    ? problems.join(t('note.separator'))
    : t('note.summary');
}

function render() {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  applyTheme(resolveTheme(state.settings.theme, state.hostTheme));

  const accountRate = snapshot.accountRate || {};
  // 窗口长度跟服务端给的桶数走：设置刚改完、页面还没轮询到时，
  // 至少文案和实际画出来的曲线是一致的。
  const trendWindow = Number(accountRate.trendWindowMinutes) || Number(state.settings.trendPeriod) || 30;
  const trendValues = accountRate.ok && Array.isArray(accountRate.trendBuckets)
    ? accountRate.trendBuckets
    : [];
  const trendLabel = t('trendLabel.account');

  const selection = gaugeSelection(snapshot, state.settings);
  applyGaugeColors(selection.water.ratio, selection.ring.urgency);
  renderGauge(selection, trendValues, trendLabel, trendWindow);
  renderRows(snapshot);
  renderSpark(snapshot);
  renderNote(snapshot);

  if (elements.detailStamp) {
    const updated = snapshot.updatedAt ? new Date(snapshot.updatedAt) : new Date();
    const hours = String(updated.getHours()).padStart(2, '0');
    const minutes = String(updated.getMinutes()).padStart(2, '0');
    const seconds = String(updated.getSeconds()).padStart(2, '0');
    elements.detailStamp.textContent = t('detail.stamp', { time: hours + ':' + minutes + ':' + seconds });
  }
}

async function loadHostTheme() {
  const host = window.mcode && window.mcode.miniapp ? window.mcode.miniapp.host : null;
  if (!host || !host.ui || typeof host.ui.getState !== 'function') return;
  try {
    const result = await host.ui.getState();
    state.hostTheme = result && result.theme ? result.theme : null;
  } catch {
    state.hostTheme = null;
  }
}

// 设置页改完设置后会广播一次，悬浮窗立刻重取数据。
try {
  window.addEventListener('token-usage:refresh', () => {
    void refresh();
  });
} catch {
  /* 浏览器不支持 addEventListener 时忽略 */
}

async function refresh() {
  try {
    const response = await fetch('/api/state', { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const payload = await response.json();
    state.snapshot = payload;
    state.settings = payload.settings || state.settings;
    state.catalog = payload.catalog || [];
    applyLocalePreference();
    const nextScale = clampScale(state.settings.scale);
    if (!state.saving && nextScale !== state.scale) {
      state.scale = nextScale;
      applyScale();
    }
    render();
    if (Number(payload.settings && payload.settings.refreshSeconds) !== Number(state.refreshSeconds)) {
      state.refreshSeconds = Number(payload.settings.refreshSeconds) || 5;
      scheduleRefresh();
    }
  } catch (error) {
    if (elements.detailNote) {
      elements.detailNote.textContent = t('detail.loadError', {
        message: error && error.message ? error.message : t('error.unknown'),
      });
    }
  }
}

function scheduleRefresh() {
  if (state.timer) window.clearInterval(state.timer);
  const seconds = Number(state.settings.refreshSeconds) || 5;
  state.timer = window.setInterval(() => {
    void refresh();
  }, seconds * 1000);
}

async function saveSettings(patch) {
  // 只提交这次真正改动的字段：整份覆盖会让过期副本抹掉用户刚改的指标选择。
  const payload = {};
  const allowed = ['metrics', 'refreshSeconds', 'theme', 'scale', 'position'];
  if (patch) {
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) payload[key] = patch[key];
    }
  }
  state.saving = true;
  try {
    const response = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const result = await response.json();
    state.settings = result.settings || Object.assign({}, state.settings, payload);
    if (Object.prototype.hasOwnProperty.call(payload, 'scale')) {
      state.scale = clampScale(state.settings.scale);
      applyScale();
    }
  } catch {
    /* 保存失败时保持当前显示 */
  } finally {
    state.saving = false;
  }
}

function saveViewState() {
  try {
    const detail = document.getElementById('gaugeDetails');
    window.localStorage.setItem(
      VIEW_STATE_KEY,
      JSON.stringify({ scrollTop: detail ? detail.scrollTop : 0 }),
    );
  } catch {
    /* 忽略存储失败 */
  }
}

function restoreViewState() {
  try {
    const raw = window.localStorage.getItem(VIEW_STATE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const detail = document.getElementById('gaugeDetails');
    if (detail && parsed && typeof parsed.scrollTop === 'number') {
      detail.scrollTop = parsed.scrollTop;
    }
  } catch {
    /* 忽略存储失败 */
  }
}

function saveGeometry() {
  try {
    const geometry = state.windowState && state.windowState.window;
    if (!geometry) return;
    window.sessionStorage.setItem(
      GEOMETRY_KEY,
      JSON.stringify({
        width: geometry.width,
        height: geometry.height,
        x: geometry.x,
        y: geometry.y,
      }),
    );
  } catch {
    /* 忽略存储失败 */
  }
}

function readGeometry() {
  try {
    const raw = window.sessionStorage.getItem(GEOMETRY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Number.isFinite(parsed.width) && Number.isFinite(parsed.height)) return parsed;
    return null;
  } catch {
    return null;
  }
}

function applyMode(next) {
  state.mode = next && next.mode === 'window' ? 'window' : 'inline';
  // 悬浮窗模式下始终使用紧凑透明布局，宽屏布局只留给内联页面。
  document.documentElement.dataset.mode = state.mode;
  if (elements.app) elements.app.dataset.mode = state.mode;
}

async function syncWindowState() {
  if (!handle() || typeof handle().getState !== 'function') return;
  try {
    const next = await handle().getState();
    state.windowState = next;
    applyMode(next);
    if (state.mode === 'window') {
      refreshClickThrough();
      reportClientState();
    }
    if (state.mode === 'window' && currentView() === 'widget' && next && next.window && typeof handle().update === 'function') {
      const geometry = next.window;
      // 悬浮窗被拖得过大时会落进宽屏布局，这里收回紧凑尺寸，避免出现一大块背景并挡住桌面点击。
      if (geometry.width > 480 || geometry.height > 560) {
        await handle()
          .update({ width: COMPACT_WINDOW.width, height: COMPACT_WINDOW.height })
          .catch(() => undefined);
      } else if (geometry.height < COMPACT_WINDOW.height - 2) {
        // 太矮的话详情面板放不下三个指标，同样拉回标准高度；宽度保留用户拖过的值
        await handle().update({ height: COMPACT_WINDOW.height }).catch(() => undefined);
      }
    }
    const saved = state.settings.position;
    const geometry = next && next.window;
    if (state.mode === 'window' && saved && geometry && typeof geometry.x === 'number') {
      const moved = Math.abs(saved.x - geometry.x) > 4 || Math.abs(saved.y - geometry.y) > 4;
      if (moved && typeof handle().update === 'function') {
        await handle().update({ x: saved.x, y: saved.y }).catch(() => undefined);
      }
    }
  } catch {
    applyMode(null);
  }
}

/**
 * 激活窗口。窗口未激活时，系统会把第一次点击当成"激活窗口"而吞掉，
 * 用户第一次拖动就会失灵，所以打开设置页时主动激活一次。
 */
function focusWindow() {
  const current = handle();
  if (!current || typeof current.focus !== 'function') return;
  try {
    void current.focus();
  } catch {
    /* 忽略聚焦失败 */
  }
}

/* ---------- 视图切换（单文档双视图） ---------- */

const VIEW_PATHS = { widget: '/widget', settings: '/settings' };

function currentView() {
  return location.pathname === VIEW_PATHS.settings ? 'settings' : 'widget';
}

/**
 * 切换视图。设置页和悬浮窗共用同一份文档，用 History API 切换，
 * 不做整页跳转：页面跳转会触发宿主重建文档，新文档的第一次点击会被吞掉，
 * 用户第一次拖动就会失灵。
 * @param {string} view
 */
function applyView(view) {
  const isSettings = view === 'settings';
  document.documentElement.dataset.view = isSettings ? 'settings' : 'widget';
  document.body.classList.toggle('settings-page', isSettings);
  document.body.classList.toggle('widget-page', !isSettings);
}

/**
 * 切换视图并同步地址栏。
 * @param {string} view
 */
function setView(view) {
  const path = VIEW_PATHS[view] || VIEW_PATHS.widget;
  if (location.pathname !== path) {
    history.pushState({ view }, '', path);
  }
  applyView(view);
  // 设置页重新拉一次，避免它拿着过期副本把用户的选择覆盖回去。
  if (view === 'settings') {
    const settings = window.__tokenUsageSettings;
    if (settings && typeof settings.refresh === 'function') void settings.refresh();
  } else {
    // 回到悬浮窗时也重新取一次：圆盘上的中心/水面/外圈要立刻跟上刚改的选择，
    // 否则要等到下一次轮询才变，看着像没生效。
    void refresh();
  }
  refreshClickThrough();
  reportClientState();
}

/** 把窗口放大成设置页尺寸，并把位置夹回屏幕内，保证"返回悬浮窗"可点。 */
async function expandSettingsWindow() {
  const current = handle();
  if (!current || typeof current.getState !== 'function' || typeof current.update !== 'function') return;
  try {
    const state = await current.getState();
    if (!state || state.mode !== 'window') return;
    const geometry = state.window || {};
    const screen = window.screen || null;
    const availWidth = screen ? screen.availWidth : 0;
    const availHeight = screen ? screen.availHeight : 0;
    const originX = Number(geometry.x) || 0;
    const originY = Number(geometry.y) || 0;
    const x = availWidth ? Math.max(0, Math.min(originX, availWidth - SETTINGS_WINDOW.width)) : originX;
    const y = availHeight ? Math.max(0, Math.min(originY, availHeight - SETTINGS_WINDOW.height)) : originY;
    await current.update({ width: SETTINGS_WINDOW.width, height: SETTINGS_WINDOW.height, x, y });
  } catch {
    /* 窗口尺寸调整失败时保持当前尺寸 */
  }
}

/** 收回悬浮窗尺寸，并恢复到用户上次摆放的位置。 */
async function shrinkWidgetWindow() {
  const current = handle();
  if (!current || typeof current.getState !== 'function' || typeof current.update !== 'function') return;
  try {
    const windowState = await current.getState();
    if (!windowState || windowState.mode !== 'window') return;
    const patch = { width: COMPACT_WINDOW.width, height: COMPACT_WINDOW.height };
    const saved = state.settings && state.settings.position;
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      patch.x = Math.round(saved.x);
      patch.y = Math.round(saved.y);
    } else {
      const geometry = readGeometry();
      if (geometry && Number.isFinite(geometry.x) && Number.isFinite(geometry.y)) {
        patch.x = Math.round(geometry.x);
        patch.y = Math.round(geometry.y);
      }
    }
    await current.update(patch);
  } catch {
    /* 窗口尺寸调整失败时保持当前尺寸 */
  }
}

/* ---------- 详情面板显隐 ---------- */

function setDetailVisible(visible) {
  if (hoverTimer) {
    window.clearTimeout(hoverTimer);
    hoverTimer = null;
  }
  const stage = elements.stage;
  if (!stage) return;
  if (state.detailVisible === visible) return;
  state.detailVisible = visible;
  stage.classList.toggle('is-detail-visible', visible);
}

function showDetail() {
  setDetailVisible(true);
}

function hideDetailSoon(delay) {
  if (hoverTimer) window.clearTimeout(hoverTimer);
  hoverTimer = window.setTimeout(() => {
    hoverTimer = null;
    setDetailVisible(false);
  }, typeof delay === 'number' ? delay : HOVER_EXIT_MS);
}

/**
 * 指针是否落在圆盘本体上。
 * 之前判定用的是外接矩形加一段过渡带，鼠标停在圆盘下方一点也会把面板叫出来。
 * 这里按真正的圆算，圆外不触发。
 * @param {any} event
 */
function pointerOnGauge(event, margin) {
  const node = elements.gauge;
  if (!node) return false;
  const rect = node.getBoundingClientRect();
  if (!rect.width) return false;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const radius = rect.width * GAUGE.circleRatio + (Number(margin) || 0);
  const dx = event.clientX - cx;
  const dy = event.clientY - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * 指针是否还在圆盘附近（含过渡带）。
 * 只用于「面板已经展开时别急着收起」，不作为展开条件。
 * @param {any} event
 */
function pointerNearGauge(event) {
  if (pointerOnGauge(event)) return true;
  const node = elements.gauge;
  if (!node) return false;
  const rect = node.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const radius = rect.width * GAUGE.circleRatio;
  // 详情面板在圆盘正下方，过渡带只留正下方这一条；
  // 侧面与上方不算「还在附近」，否则鼠标贴着圆盘边缘就会把面板吊着。
  const below = event.clientY >= cy && event.clientY <= cy + radius + HOVER_BRIDGE_PX;
  return below && Math.abs(event.clientX - cx) <= radius;
}
/** 指针是否落在详情面板上。 */
function pointerOnDetail(event) {
  const node = elements.detail;
  if (!node) return false;
  const rect = node.getBoundingClientRect();
  return event.clientX >= rect.left && event.clientX <= rect.right
    && event.clientY >= rect.top && event.clientY <= rect.bottom;
}

/**
 * 指针是否落在某个元素上（可带余量）。
 * @param {any} event
 * @param {any} node
 * @param {number} [margin]
 * @returns {boolean}
 */
function pointerOnElement(event, node, margin) {
  if (!node) return false;
  const rect = node.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;
  const pad = Number(margin) || 0;
  return event.clientX >= rect.left - pad && event.clientX <= rect.right + pad
    && event.clientY >= rect.top - pad && event.clientY <= rect.bottom + pad;
}

/**
 * 指针当前是否落在需要接收点击的地方。
 * 悬浮窗的矩形比看到的内容大（详情面板那一大片平时是空的），
 * 整窗都吃点击的话，放在别的按钮旁边就会挡住下面的应用。
 * @param {any} event
 * @returns {boolean}
 */
function pointerNeedsHit(event) {
  // 设置页整窗都是内容，任何位置都要能点
  if (currentView() === 'settings') return true;
  if (pointerOnGauge(event, CLICK_MARGIN_PX)) return true;
  if (state.detailVisible && pointerOnDetail(event)) return true;
  if (pointerOnElement(event, elements.scaleButton)) return true;
  if (pointerOnElement(event, elements.popupButton)) return true;
  return false;
}

/* ---------- 窗口点击穿透 ---------- */

/** null 表示还没跟宿主同步过。 */
let clickThrough = null;
/** 最近一次指针位置：切视图后要按它重新决定要不要穿透。 */
let lastPointer = null;

/**
 * 切换窗口的点击穿透。
 * 宿主支持窗口级点击穿透：开启后点击会落到下面的窗口上，
 * 但页面仍然收得到鼠标移动事件，所以可以按指针位置实时切换。
 * @param {boolean} next
 */
async function setClickThrough(next) {
  if (state.mode !== 'window') return;
  if (clickThrough === next) return;
  clickThrough = next;
  const current = handle();
  if (!current || typeof current.update !== 'function') return;
  try {
    await current.update({ clickThrough: next });
  } catch {
    clickThrough = null;   // 没同步上，等下一次指针移动再试
  }
  reportClientState();
}

function onWindowPointerMove(event) {
  lastPointer = { clientX: event.clientX, clientY: event.clientY };
  const needs = pointerNeedsHit(event);
  // 命中的区域记在 DOM 上，方便核对「哪些地方算可点」
  if (elements.app) elements.app.dataset.hit = needs ? '1' : '0';
  if (state.mode !== 'window') return;
  void setClickThrough(!needs);
}

/** 窗口失焦时恢复穿透：指针不在这边时更不该挡住下面的应用。 */
function onWindowBlur() {
  if (state.mode !== 'window') return;
  if (currentView() === 'settings') return;
  void setClickThrough(true);
}

/** 按当前指针位置重新决定要不要穿透。 */
function refreshClickThrough() {
  if (state.mode !== 'window') return;
  const target = lastPointer ? !pointerNeedsHit(lastPointer) : true;
  void setClickThrough(target);
}

/**
 * 把页面侧的窗口状态回报给 Node 侧。
 * 悬浮窗是独立窗口，页面里的状态在别处看不到，回报一份才能排查尺寸与穿透状态。
 */
let reportTimer = null;
function reportClientState() {
  const current = handle();
  if (!current || typeof current.getState !== 'function') return;
  if (reportTimer) window.clearTimeout(reportTimer);
  reportTimer = window.setTimeout(() => {
    reportTimer = null;
    void current.getState()
      .then((next) => {
        const win = next && next.window ? next.window : null;
        return fetch('/api/client-report', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            mode: next && next.mode ? next.mode : 'inline',
            view: currentView(),
            clickThrough: win ? Boolean(win.clickThrough) : null,
            geometry: win ? { x: win.x, y: win.y, width: win.width, height: win.height } : null,
            at: Date.now(),
          }),
        });
      })
      .catch(() => undefined);
  }, 150);
}

/**
 * 面板只在指针确实停在圆盘或面板上时保持展开。
 * 之前给圆盘和面板各自绑 mouseleave：指针在两者之间移动时，
 * 收起计时器会在指针到达面板之前先跑完，面板自己闪一下又弹回来。
 */
function onStagePointerMove(event) {
  if (pointerOnGauge(event)) {
    // 只有指针真的在圆上，圆盘才给出放大的反馈
    if (elements.gauge) elements.gauge.classList.add('is-hot');
    showDetail();
    return;
  }
  if (elements.gauge) elements.gauge.classList.remove('is-hot');
  // 面板已经展开时，指针在圆盘与面板之间移动要保持展开，
  // 否则从圆盘挪到面板的路上面板会先收一次再弹回来。
  if (state.detailVisible && (pointerNearGauge(event) || pointerOnDetail(event))) {
    showDetail();
    return;
  }
  hideDetailSoon(HOVER_EXIT_MS);
}
/* ---------- 拖动移动窗口 ---------- */

function scheduleWindowMove() {
  if (drag.frame) return;
  drag.frame = window.requestAnimationFrame(() => {
    drag.frame = null;
    const target = drag.pending;
    if (!target || !handle() || typeof handle().update !== 'function') return;
    drag.pending = null;
    handle()
      .update({ x: target.x, y: target.y })
      .then((next) => {
        if (next && next.window) state.windowState = next;
      })
      .catch(() => undefined);
  });
}

function onGaugePointerDown(event) {
  if (state.mode !== 'window' || !handle()) return;
  if (typeof event.button === 'number' && event.button !== 0) return;
  const geometry = state.windowState && state.windowState.window;
  if (!geometry || typeof geometry.x !== 'number' || typeof geometry.y !== 'number') return;
  drag.active = true;
  drag.moved = false;
  drag.pointerId = event.pointerId;
  drag.startScreenX = event.screenX;
  drag.startScreenY = event.screenY;
  drag.originX = geometry.x;
  drag.originY = geometry.y;
  drag.pending = null;
  state.suppressClick = false;
  document.documentElement.classList.add('is-window-drag');
  // 这里不能调用 preventDefault：它会连带抑制 mousedown，
  // 窗口就拿不到焦点，下一次点击会被系统当成"激活窗口"吞掉，拖动会失灵。
  // 选中文字改由 user-select: none 处理。
}

function onGaugePointerMove(event) {
  if (!drag.active) return;
  if (event.pointerId !== drag.pointerId) return;
  // 用屏幕坐标而不是视口坐标：窗口自身移动会改变视口坐标，造成位移回弹与抖动。
  const dx = event.screenX - drag.startScreenX;
  const dy = event.screenY - drag.startScreenY;
  if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
  if (!drag.moved) {
    drag.moved = true;
    if (elements.gauge) elements.gauge.classList.add('is-dragging');
    event.preventDefault();
  }
  drag.pending = {
    x: Math.round(drag.originX + dx),
    y: Math.round(drag.originY + dy),
  };
  scheduleWindowMove();
}

function onGaugePointerUp(event) {
  if (!drag.active) return;
  drag.active = false;
  document.documentElement.classList.remove('is-window-drag');
  if (!drag.moved) {
    state.suppressClick = true;
    void openSettings();
    return;
  }
  drag.moved = false;
  if (elements.gauge) elements.gauge.classList.remove('is-dragging');
  state.suppressClick = true;
  const geometry = state.windowState && state.windowState.window;
  if (geometry && typeof geometry.x === 'number' && typeof geometry.y === 'number') {
    void saveSettings({ position: { x: geometry.x, y: geometry.y } });
  }
}

function onGaugePointerCancel() {
  drag.active = false;
  drag.moved = false;
  document.documentElement.classList.remove('is-window-drag');
  if (elements.gauge) elements.gauge.classList.remove('is-dragging');
}

function onStageWheel(event) {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  const step = event.deltaY > 0 ? -0.1 : 0.1;
  const next = clampScale(state.scale + step);
  if (next === state.scale) return;
  state.scale = next;
  applyScale();
  void saveSettings({ scale: next });
}

function cycleScale() {
  const index = SCALE_STEPS.findIndex((step) => Math.abs(step - state.scale) < 0.06);
  const next = SCALE_STEPS[(index + 1) % SCALE_STEPS.length];
  state.scale = next;
  applyScale();
  void saveSettings({ scale: next });
}

async function openSettings() {
  saveGeometry();
  await expandSettingsWindow();
  setView('settings');
}

async function popOut() {
  if (!handle() || typeof handle().update !== 'function') return;
  try {
    await handle().update({ mode: 'window' });
  } catch (error) {
    if (elements.detailNote) {
      elements.detailNote.textContent = t('detail.modeError', {
        message: error && error.message ? error.message : t('error.unknown'),
      });
    }
  }
}

function init() {
  buildWaves();
  restoreViewState();
  applyScale();
  applyView(currentView());
  // 直接以设置页打开时（宿主按路径打开），窗口要放大到设置页尺寸。
  if (currentView() === 'settings') void expandSettingsWindow();
  window.__tokenUsageApp = {
    setView,
    expandSettingsWindow,
    shrinkWidgetWindow,
  };
  window.addEventListener('popstate', () => {
    const view = currentView();
    applyView(view);
    if (view === 'settings') void expandSettingsWindow();
    else void shrinkWidgetWindow();
    refreshClickThrough();
    reportClientState();
  });
  // 指针位置决定窗口要不要吃点击：空白处把点击让给下面的应用
  window.addEventListener('pointermove', onWindowPointerMove);
  window.addEventListener('blur', onWindowBlur);

  if (elements.gauge) {
    elements.gauge.addEventListener('click', () => {
      if (state.suppressClick) {
        state.suppressClick = false;
        return;
      }
      void openSettings();
    });
    elements.gauge.addEventListener('pointerdown', onGaugePointerDown);
    // 移动与抬起挂在 window 上：窗口跟着指针移动时，事件目标会离开圆盘，
    // 只在圆盘上监听会让拖动中途断掉。
    window.addEventListener('pointermove', onGaugePointerMove, true);
    window.addEventListener('pointerup', onGaugePointerUp, true);
    window.addEventListener('pointercancel', onGaugePointerCancel, true);

  }
  if (elements.stage) {
    elements.stage.addEventListener('wheel', onStageWheel, { passive: false });
    elements.stage.addEventListener('pointermove', onStagePointerMove);
    elements.stage.addEventListener('mouseleave', () => {
      if (elements.gauge) elements.gauge.classList.remove('is-hot');
      hideDetailSoon(HOVER_EXIT_MS);
    });
  }
  if (elements.gaugeWrap) {
  }
  if (elements.detail) {
    elements.detail.addEventListener('mouseenter', showDetail);
  }
  if (elements.popupButton) {
    elements.popupButton.addEventListener('click', () => {
      void popOut();
    });
  }
  if (elements.scaleButton) {
    elements.scaleButton.addEventListener('click', () => {
      cycleScale();
    });
  }
  if (handle() && typeof handle().onDidChangeState === 'function') {
    const subscription = handle().onDidChangeState((next) => {
      state.windowState = next;
      applyMode(next);
    });
    window.addEventListener('pagehide', () => {
      if (subscription && typeof subscription.dispose === 'function') subscription.dispose();
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveViewState();
    else void refresh();
  });

  window.addEventListener('pagehide', () => {
    if (state.timer) {
      window.clearInterval(state.timer);
      state.timer = null;
    }
  });

  void loadHostTheme().then(() => {
    void refresh().then(scheduleRefresh);
    return syncWindowState();
  });
}

init();

// 暴露给运行时自检使用；不使用 ES 模块导出，保证脚本也能以普通脚本方式解析。
window.__tokenUsageWidget = { state, refresh, readGeometry };
