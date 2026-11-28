// Token 用量悬浮窗 — 设置页面

import {
  applyTheme,
  buildRows,
  gaugeOptions,
  metricRow,
  resolveTheme,
  sourceStates,
} from './metrics.js';
import { getLocale, localized, onLocaleChange, resolveLocale, setLocale, t } from './i18n.js';

const GEOMETRY_KEY = 'token-usage-widget-geometry';

// 宿主可能在页面脚本执行之后才注入窗口桥接，按需解析，避免模块加载时缓存到 null。
let windowHandle = null;
function handle() {
  if (!windowHandle) {
    windowHandle = (window.mcode && window.mcode.miniapp && window.mcode.miniapp.window) || null;
  }
  return windowHandle;
}

const elements = {
  form: document.getElementById('settingsForm'),
  metricList: document.getElementById('metricList'),
  refreshGroup: document.getElementById('refreshGroup'),
  scaleGroup: document.getElementById('scaleGroup'),
  themeGroup: document.getElementById('themeGroup'),
  languageGroup: document.getElementById('languageGroup'),
  trendPeriodGroup: document.getElementById('trendPeriodGroup'),
  trendPeriodHint: document.getElementById('trendPeriodHint'),
  centerSelect: document.getElementById('centerSelect'),
  waterSelect: document.getElementById('waterSelect'),
  ringSelect: document.getElementById('ringSelect'),
  resetButton: document.getElementById('resetButton'),
  resetPositionButton: document.getElementById('resetPositionButton'),
  backButton: document.getElementById('backButton'),
  toast: document.getElementById('toast'),
  sources: document.getElementById('sourceList'),
  drag: document.getElementById('settingsDrag'),
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
  mode: 'inline',
  windowState: null,
};

let toastTimer = null;
let dragKey = null;
let dropTarget = null;

function showToast(message) {
  if (!elements.toast) return;
  elements.toast.textContent = message;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    if (elements.toast) elements.toast.textContent = '';
  }, 2200);
}

function renderSources() {
  if (!elements.sources || !state.snapshot) return;
  const states = sourceStates(state.snapshot);
  elements.sources.textContent = '';
  for (const item of states) {
    const row = document.createElement('div');
    row.className = 'source';

    const dot = document.createElement('span');
    dot.className = item.ok ? 'source__dot' : 'source__dot source__dot--error';

    const body = document.createElement('div');
    const name = document.createElement('span');
    name.className = 'source__name';
    name.textContent = item.name;
    const detail = document.createElement('div');
    detail.textContent = item.detail;
    body.appendChild(name);
    body.appendChild(detail);

    row.appendChild(dot);
    row.appendChild(body);
    elements.sources.appendChild(row);
  }
}

/** 展示顺序：固定指标在最前，其余按用户配置的顺序排列，未启用的排在最后。 */
function orderedCatalog() {
  const order = state.settings.metrics || [];
  const enabled = new Set(order);
  const core = [];
  const on = [];
  const off = [];
  for (const item of state.catalog || []) {
    if (item.core) core.push(item);
    else if (enabled.has(item.key)) on.push(item);
    else off.push(item);
  }
  const byKey = new Map(on.map((item) => [item.key, item]));
  const sorted = order.map((key) => byKey.get(key)).filter(Boolean);
  return core.concat(sorted, off);
}

function clearDropMarks() {
  if (!elements.metricList) return;
  elements.metricList.querySelectorAll('.metric--drop-before, .metric--drop-after').forEach((node) => {
    node.classList.remove('metric--drop-before', 'metric--drop-after');
  });
}

function currentKeys() {
  if (!elements.metricList) return [];
  return Array.from(elements.metricList.querySelectorAll('.metric')).map((node) => node.dataset.key);
}

function commitOrder(keys) {
  const enabled = new Set(state.settings.metrics || []);
  const next = keys.filter((key) => enabled.has(key));
  void save({ metrics: next });
}

/** 把 sourceKey 移动到 targetKey 之前或之后。 */
function applyMove(sourceKey, targetKey, after) {
  const keys = currentKeys();
  const from = keys.indexOf(sourceKey);
  if (from === -1) return;
  keys.splice(from, 1);
  const target = keys.indexOf(targetKey);
  if (target === -1) return;
  keys.splice(target + (after ? 1 : 0), 0, sourceKey);
  commitOrder(keys);
}

/** 键盘微调：上移或下移一行。 */
function moveBy(key, offset) {
  const keys = currentKeys();
  const from = keys.indexOf(key);
  if (from === -1) return;
  const to = from + offset;
  if (to < 0 || to >= keys.length) return;
  const target = keys[to];
  keys.splice(from, 1);
  const insert = keys.indexOf(target) + (offset > 0 ? 1 : 0);
  keys.splice(insert, 0, key);
  commitOrder(keys);
}

function attachReorder(row, key, fixed) {
  row.dataset.key = key;
  row.tabIndex = 0;
  row.classList.add('metric--reorderable');
  if (fixed) {
    row.classList.add('metric--fixed');
    return;
  }

  const grip = document.createElement('span');
  grip.className = 'metric__grip';
  grip.draggable = true;
  grip.title = t('settings.grip.title');
  grip.innerHTML =
    '<svg viewBox="0 0 10 16" aria-hidden="true" focusable="false">'
    + '<circle cx="3" cy="3" r="1.3"/><circle cx="7" cy="3" r="1.3"/>'
    + '<circle cx="3" cy="8" r="1.3"/><circle cx="7" cy="8" r="1.3"/>'
    + '<circle cx="3" cy="13" r="1.3"/><circle cx="7" cy="13" r="1.3"/></svg>';
  grip.addEventListener('dragstart', (event) => {
    dragKey = key;
    row.classList.add('metric--dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      try {
        event.dataTransfer.setData('text/plain', key);
      } catch {
        /* 忽略受限拖放数据 */
      }
    }
  });
  grip.addEventListener('dragend', () => {
    dragKey = null;
    dropTarget = null;
    row.classList.remove('metric--dragging');
    clearDropMarks();
  });
  row.insertBefore(grip, row.firstChild);

  row.addEventListener('dragover', (event) => {
    if (!dragKey || dragKey === key) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const rect = row.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    clearDropMarks();
    row.classList.add(after ? 'metric--drop-after' : 'metric--drop-before');
    dropTarget = { key, after };
  });
  row.addEventListener('dragleave', () => {
    row.classList.remove('metric--drop-before', 'metric--drop-after');
  });
  row.addEventListener('drop', (event) => {
    event.preventDefault();
    if (!dragKey || !dropTarget) return;
    const source = dragKey;
    const target = dropTarget;
    dragKey = null;
    dropTarget = null;
    clearDropMarks();
    row.classList.remove('metric--dragging');
    applyMove(source, target.key, target.after);
  });

  row.addEventListener('keydown', (event) => {
    if (!event.altKey) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      moveBy(key, event.key === 'ArrowUp' ? -1 : 1);
    }
  });
}

function renderMetrics() {
  if (!elements.metricList) return;
  const enabled = new Set(state.settings.metrics || []);
  const items = orderedCatalog();
  // 内容没变就别重画：设置页每隔几秒刷新一次，重建 DOM 会打断正在进行的点击，
  // 刚进设置页时的那一下点击就会落空。
  const signature = getLocale() + '|' + items
    .map((item) => {
      const computed = state.snapshot ? metricRow(item.key, state.snapshot) : null;
      return item.key + ':' + (item.core ? '1' : (enabled.has(item.key) ? '1' : '0')) + ':' + (computed ? computed.value : '--');
    })
    .join('|');
  if (elements.metricList.dataset.signature === signature) return;
  elements.metricList.dataset.signature = signature;
  elements.metricList.textContent = '';

  for (const item of items) {
    const label = document.createElement('label');
    label.className = item.core ? 'metric metric--fixed' : 'metric';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = item.core ? true : enabled.has(item.key);
    input.disabled = Boolean(item.core);
    input.dataset.key = item.key;

    const body = document.createElement('div');
    body.className = 'metric__body';

    const name = document.createElement('div');
    name.className = 'metric__name';
    const text = document.createElement('span');
    text.textContent = localized(item.label);
    name.appendChild(text);

    const value = document.createElement('span');
    value.className = 'metric__value numeric';
    if (state.snapshot) {
      const computed = metricRow(item.key, state.snapshot);
      value.textContent = computed ? computed.value : '--';
    }
    name.appendChild(value);

    const hint = document.createElement('div');
    hint.className = 'metric__hint';
    hint.textContent = localized(item.hint);

    body.appendChild(name);
    body.appendChild(hint);
    label.appendChild(input);
    label.appendChild(body);
    elements.metricList.appendChild(label);

    attachReorder(label, item.key, Boolean(item.core));
  }
}

function renderSegmented(container, choices, current, onSelect) {
  if (!container) return;
  container.textContent = '';
  for (const choice of choices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = choice.label;
    button.setAttribute('aria-pressed', String(choice.value === current));
    button.addEventListener('click', () => onSelect(choice.value));
    container.appendChild(button);
  }
}

/**
 * 填下拉框的选项。
 * @param {any} element
 * @param {any[]} choices
 * @param {string} current
 */
function renderSelectOptions(element, choices, current) {
  if (!element) return;
  element.textContent = '';
  for (const choice of choices) {
    const option = document.createElement('option');
    option.value = choice.value;
    option.textContent = choice.label;
    option.selected = choice.value === current;
    element.appendChild(option);
  }
}

function renderControls() {
  renderSegmented(
    elements.refreshGroup,
    [
      { value: 3, label: t('option.refresh.3') },
      { value: 5, label: t('option.refresh.5') },
      { value: 10, label: t('option.refresh.10') },
      { value: 30, label: t('option.refresh.30') },
      { value: 60, label: t('option.refresh.60') },
    ],
    state.settings.refreshSeconds,
    (value) => {
      void save({ refreshSeconds: value });
    },
  );

  renderSegmented(
    elements.scaleGroup,
    [
      { value: 0.4, label: t('option.scale.0.4') },
      { value: 0.5, label: t('option.scale.0.5') },
      { value: 0.6, label: t('option.scale.0.6') },
      { value: 0.7, label: t('option.scale.0.7') },
      { value: 0.8, label: t('option.scale.0.8') },
    ],
    state.settings.scale,
    (value) => {
      void save({ scale: value });
    },
  );

  renderSegmented(
    elements.themeGroup,
    [
      { value: 'system', label: t('option.theme.system') },
      { value: 'light', label: t('option.theme.light') },
      { value: 'dark', label: t('option.theme.dark') },
    ],
    state.settings.theme,
    (value) => {
      void save({ theme: value });
    },
  );

  renderSegmented(
    elements.trendPeriodGroup,
    [
      { value: 10, label: t('option.trendPeriod.10') },
      { value: 30, label: t('option.trendPeriod.30') },
      { value: 60, label: t('option.trendPeriod.60') },
      { value: 120, label: t('option.trendPeriod.120') },
    ],
    Number(state.settings.trendPeriod) || 30,
    (value) => {
      void save({ trendPeriod: value });
    },
  );

  renderSegmented(
    elements.languageGroup,
    [
      { value: 'system', label: t('option.language.system') },
      { value: 'zh', label: t('option.language.zh') },
      { value: 'en', label: t('option.language.en') },
    ],
    state.settings.language,
    (value) => {
      void save({ language: value });
    },
  );

  // 口径提示只留在控制面板：讲清楚这条曲线是账号口径的差分
  if (elements.trendPeriodHint) {
    elements.trendPeriodHint.textContent = t('trendHint');
  }

  renderSelectOptions(elements.centerSelect, gaugeOptions('center'), state.settings.centerMetric);
  renderSelectOptions(elements.waterSelect, gaugeOptions('water'), state.settings.waterMetric);
  renderSelectOptions(elements.ringSelect, gaugeOptions('ring'), state.settings.ringMetric);
}

/**
 * 按设置里的语言偏好切换界面语言。
 * 偏好是 system 时按系统语言走。
 */
function applyLocalePreference() {
  const preference = state.settings && state.settings.language ? state.settings.language : 'system';
  if (resolveLocale(preference) === getLocale()) return;
  setLocale(preference);
}

// 语言换了要重画：分段控件、下拉框、指标列表与数据来源都带文案。
onLocaleChange(() => {
  renderControls();
  renderMetrics();
  renderSources();
});

async function save(patch) {
  // 只提交这次真正改动的字段，服务端负责合并，避免用本地副本覆盖用户其它选择。
  const payload = {};
  if (patch && Array.isArray(patch.metrics)) payload.metrics = patch.metrics;
  if (patch && Number.isFinite(Number(patch.refreshSeconds))) {
    payload.refreshSeconds = Number(patch.refreshSeconds);
  }
  if (patch && patch.theme) payload.theme = patch.theme;
  if (patch && Number.isFinite(Number(patch.trendPeriod))) payload.trendPeriod = Number(patch.trendPeriod);
  if (patch && patch.language) payload.language = patch.language;
  if (patch && patch.centerMetric) payload.centerMetric = patch.centerMetric;
  if (patch && patch.waterMetric) payload.waterMetric = patch.waterMetric;
  if (patch && patch.ringMetric) payload.ringMetric = patch.ringMetric;
  if (patch && Number.isFinite(Number(patch.scale))) payload.scale = Number(patch.scale);
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'position')) {
    payload.position = patch.position;
  }
  try {
    const response = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const result = await response.json();
    state.settings = result.settings || Object.assign({}, state.settings, payload);
    applyTheme(resolveTheme(state.settings.theme, state.hostTheme));
    applyLocalePreference();
    renderControls();
    renderMetrics();
    // 悬浮窗页有自己的轮询；设置刚改完时让它立刻重取一次，
    // 曲线和文案不用等下一个轮询周期才跟上。
    try {
      window.dispatchEvent(new CustomEvent('token-usage:refresh'));
    } catch {
      /* 浏览器不支持 CustomEvent 时忽略 */
    }
    showToast(t('toast.saved'));
  } catch (error) {
    showToast(t('toast.saveError', {
      message: error && error.message ? error.message : t('error.unknown'),
    }));
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

async function load() {
  try {
    const response = await fetch('/api/state', { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const payload = await response.json();
    state.snapshot = payload;
    state.settings = payload.settings || state.settings;
    state.catalog = payload.catalog || [];
    applyLocalePreference();
    renderMetrics();
    renderSources();
    // 分段控件要按已保存的设置重绘：初始化时先画的是默认值，
    // 不重画的话页面显示的和用户真正保存的对不上。
    renderControls();
  } catch (error) {
    showToast(t('toast.loadError', {
      message: error && error.message ? error.message : t('error.unknown'),
    }));
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

/**
 * 激活窗口。窗口未激活时，系统会把第一次点击当成"激活窗口"而吞掉，
 * 用户第一次拖动就会失灵，所以打开设置页时主动激活一次。
 */
function focusWindow() {
  const current = handle();
  if (!current || typeof current.focus !== 'function') return;
  try {
    // focus() 需要用户手势，没有手势时会拒绝，这里静默忽略。
    Promise.resolve(current.focus()).catch(() => undefined);
  } catch {
    /* 忽略聚焦失败 */
  }
}

/* ---------- 窗口模式与拖动 ---------- */

const drag = {
  active: false,
  moved: false,
  pointerId: null,
  startScreenX: 0,
  startScreenY: 0,
  originX: 0,
  originY: 0,
  pending: null,
  timer: null,
};

async function syncWindowState() {
  if (!handle() || typeof handle().getState !== 'function') return;
  try {
    const next = await handle().getState();
    state.windowState = next;
    state.mode = next && next.mode === 'window' ? 'window' : 'inline';
  } catch {
    state.mode = 'inline';
  }
  document.documentElement.dataset.mode = state.mode;
}

function scheduleWindowMove() {
  if (drag.timer) return;
  drag.timer = window.setTimeout(() => {
    drag.timer = null;
    const target = drag.pending;
    if (!target || !handle()) return;
    drag.pending = null;
    handle()
      .update({ x: target.x, y: target.y })
      .then((next) => {
        if (next && next.window) state.windowState = next;
      })
      .catch(() => undefined);
  }, 16);
}

function onDragPointerDown(event) {
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
  document.documentElement.classList.add('is-window-drag');
  // 这里不能调用 preventDefault：它会连带抑制 mousedown，
  // 窗口就拿不到焦点，下一次点击会被系统当成"激活窗口"吞掉，拖动会失灵。
  // 选中文字改由 user-select: none 处理。
}

function onDragPointerMove(event) {
  if (!drag.active) return;
  if (event.pointerId !== drag.pointerId) return;
  // 用屏幕坐标差值，窗口自身移动不会造成位移回弹。
  const dx = event.screenX - drag.startScreenX;
  const dy = event.screenY - drag.startScreenY;
  if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
  if (!drag.moved) {
    drag.moved = true;
    elements.drag.classList.add('is-dragging');
    event.preventDefault();
  }
  drag.pending = {
    x: Math.round(drag.originX + dx),
    y: Math.round(drag.originY + dy),
  };
  scheduleWindowMove();
}

function onDragPointerUp(event) {
  if (!drag.active) return;
  drag.active = false;
  drag.moved = false;
  elements.drag.classList.remove('is-dragging');
  document.documentElement.classList.remove('is-window-drag');
}

async function backToWidget() {
  const app = window.__tokenUsageApp;
  if (app && typeof app.shrinkWidgetWindow === 'function' && typeof app.setView === 'function') {
    await app.shrinkWidgetWindow();
    app.setView('widget');
    return;
  }
  window.location.href = '/widget';
}

function init() {
  if (elements.form) {
    elements.form.addEventListener('change', (event) => {
      const target = event.target;
      if (!target || target.tagName !== 'INPUT' || !target.dataset || !target.dataset.key) return;
      // 从服务端已知的列表推导新列表，不依赖 DOM 是否渲染完整：
      // 早期版本直接读 DOM，页面刚打开时会写回一份残缺的指标列表。
      const key = target.dataset.key;
      const current = Array.isArray(state.settings.metrics) ? state.settings.metrics.slice() : [];
      const next = target.checked
        ? (current.indexOf(key) >= 0 ? current : current.concat([key]))
        : current.filter((item) => item !== key);
      void save({ metrics: next });
    });
  }
  if (elements.centerSelect) {
    elements.centerSelect.addEventListener('change', (event) => {
      void save({ centerMetric: event.target.value });
    });
  }
  if (elements.waterSelect) {
    elements.waterSelect.addEventListener('change', (event) => {
      void save({ waterMetric: event.target.value });
    });
  }
  if (elements.ringSelect) {
    elements.ringSelect.addEventListener('change', (event) => {
      void save({ ringMetric: event.target.value });
    });
  }
  if (elements.resetPositionButton) {
    elements.resetPositionButton.addEventListener('click', () => {
      void save({ position: null });
    });
  }
  if (elements.resetButton) {
    elements.resetButton.addEventListener('click', () => {
      void save({
        metrics: ['rate_10m', 'today_total', 'week_ratio', 'five_hour_tokens', 'reset_countdown'],
        refreshSeconds: 5,
        theme: 'system',
        scale: 0.6,
        trendPeriod: 30,
        language: 'system',
        position: null,
        centerMetric: 'five_hour_ratio',
        waterMetric: 'five_hour_ratio',
        ringMetric: 'week_ratio',
      });
    });
  }
  if (elements.backButton) {
    elements.backButton.addEventListener('click', () => {
      void backToWidget();
    });
  }
  if (elements.drag) {
    elements.drag.addEventListener('pointerdown', onDragPointerDown);
  }
  // 移动与抬起挂在 window 上：窗口会跟着指针一起走，事件目标会立刻离开手柄，
  // 只在手柄上监听会导致真实鼠标拖动中途断掉。
  window.addEventListener('pointermove', onDragPointerMove, true);
  window.addEventListener('pointerup', onDragPointerUp, true);
  window.addEventListener('pointercancel', onDragPointerUp, true);
  // 点击时宿主会把焦点交回主窗口，窗口会立刻收到 blur；用 blur 收尾会让真实鼠标按下就断掉。
  // 指针捕获不受失焦影响，所以改用 lostpointercapture 结束拖动。


  void syncWindowState();
  focusWindow();
  void loadHostTheme().then(() => {
    applyTheme(resolveTheme(state.settings.theme, state.hostTheme));
    renderControls();
    return load();
  });
}

init();

// 暴露给运行时自检使用；不使用 ES 模块导出，保证脚本也能以普通脚本方式解析。
window.__tokenUsageSettings = { state, refresh: load };
