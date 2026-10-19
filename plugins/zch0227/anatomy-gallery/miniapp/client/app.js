// @ts-check
/// <reference path="./client-api.ts" />

/* ================= helpers ================= */

/**
 * @param {string} tag
 * @param {Record<string, any>} [props]
 * @param {...any} children
 * @returns {HTMLElement}
 */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const ICONS = {
  cube: '<path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>',
  chat: '<path d="M5 5h14v10H9l-4 4V5Z"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
  more: '<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>',
  panel: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M14 5v14"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
};

/** @param {keyof typeof ICONS} name @param {number} [size] */
function icon(name, size = 16) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'aria-hidden': 'true' })) {
    svg.setAttribute(k, String(v));
  }
  svg.innerHTML = ICONS[name];
  return /** @type {any} */ (svg);
}

/** @param {string} path @param {{ method?: string, body?: any }} [options] */
async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await response.json() : null;
  if (!response.ok) throw new Error(data?.message ?? `请求失败（${response.status}）`);
  return data;
}

/** @param {number} ms */
function when(ms) {
  const diff = Date.now() - ms;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  const d = new Date(ms);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

/** @param {number} ms */
function elapsed(ms) {
  const total = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  const m = Math.floor(total / 60);
  return m >= 60 ? `${Math.floor(m / 60)} 小时 ${m % 60} 分` : `${m}:${String(total % 60).padStart(2, '0')}`;
}

/** replaceChildren() would insert null as the text "null"; skip empty slots. @param {Element} el @param {...any} children */
function fill(el, ...children) {
  el.replaceChildren(...children.flat().filter((child) => child != null && child !== false));
}

/*
 * Agent replies are Markdown. Render a small safe subset (paragraphs, line breaks, lists, headings,
 * **bold**, `code`) as DOM nodes; text is never parsed as HTML.
 */
/** @param {string} text @param {boolean} [allowBold] @returns {(string | Node)[]} */
function mdInline(text, allowBold = true) {
  const out = [];
  const pattern = allowBold ? /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g : /(`[^`\n]+`)/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    out.push(token.startsWith('`') ? h('code', {}, token.slice(1, -1)) : h('strong', {}, mdInline(token.slice(2, -2), false)));
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** @param {string} text */
function markdown(text) {
  const root = h('div', { class: 'md' });
  const LIST = /^\s*(?:[-*•]|\d+[.)])\s+/;
  // Host delivery markup (<deliver-assets> with <media/> tags) is not prose.
  const prose = text.replace(/\r\n/g, '\n').replace(/<deliver-assets>[\s\S]*?(<\/deliver-assets>|$)/g, '').trim();
  for (const block of prose.split(/\n{2,}/)) {
    const lines = block.split('\n').filter((line) => line.trim() !== '');
    if (lines.length === 0) continue;
    if (lines.every((line) => LIST.test(line))) {
      const list = h(/^\s*\d/.test(lines[0]) ? 'ol' : 'ul', {});
      for (const line of lines) list.append(h('li', {}, mdInline(line.replace(LIST, ''))));
      root.append(list);
      continue;
    }
    const paragraph = h('p', {});
    lines.forEach((line, index) => {
      if (index) paragraph.append(h('br'));
      const heading = /^#{1,6}\s+/.exec(line);
      paragraph.append(...(heading ? [h('strong', {}, mdInline(line.slice(heading[0].length), false))] : mdInline(line)));
    });
    root.append(paragraph);
  }
  return root;
}

/** Streaming text may be cut mid-token, so only strip the markers. @param {string} text */
const plainText = (text) => text.replace(/\*\*|`|^#{1,6}\s+/gm, '');

let toastTimer = 0;
/** @param {string} text */
function toast(text) {
  const el = /** @type {HTMLElement} */ (document.getElementById('toast'));
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 3200);
}

/** @param {unknown} error */
const message = (error) => /** @type {Error} */ (error)?.message ?? String(error);

const RUN_STATUS = {
  running: ['制作中', 'running'],
  question: ['等你回答', 'warn'],
  failed: ['失败', 'bad'],
  error: ['出错', 'bad'],
  unknown: ['结果未知', 'warn'],
  aborted: ['已取消', ''],
  interrupted: ['已中断', 'warn'],
  finished: ['已完成', 'ok'],
};

/**
 * A stored model selection named the way the model picker names it, for example
 * "M3.1-Flash-Preview（minimax）· 思考强度：默认". Falls back to the raw model id until the catalog loads.
 * @param {any} model
 */
function modelLabel(model) {
  if (!model?.modelId) return '';
  const option = (catalogCache?.models ?? []).find((/** @type {any} */ o) => o.providerId === model.providerId && o.modelId === model.modelId);
  const provider = String(model.providerId ?? '').replace(/^custom_provider:/, '');
  const name = (option?.displayName || model.modelId) + (provider ? `（${provider}）` : '');
  let thinking = '';
  if (model.variant === '') thinking = '关闭思考';
  else if (model.effort && model.effort !== 'default') thinking = `思考强度：${effortLabel(model.effort)}`;
  else if (model.variant) thinking = `思考强度：${defaultEffortText(option)}`;
  return thinking ? `${name} · ${thinking}` : name;
}

/** "默认（极高）" when the catalog names the default level, otherwise just "默认". @param {any} option */
function defaultEffortText(option) {
  const level = option?.thinking?.default;
  return level && level !== 'default' ? `默认（${effortLabel(level)}）` : '默认';
}

/** @param {string} status */
function badge(status) {
  const [text, cls] = RUN_STATUS[/** @type {keyof typeof RUN_STATUS} */ (status)] ?? [status, ''];
  return h('span', { class: `badge ${cls}` }, text);
}

/* ================= theme ================= */

// The Host does not pass MCode's own theme to Mini Apps, so the user can override the system scheme.
const THEME_KEY = 'anatomy-gallery-theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');
/** @type {Set<(theme: string) => void>} */
const themeListeners = new Set();
const galleryTheme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

function applyTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  const choice = stored === 'light' || stored === 'dark' ? stored : 'system';
  document.documentElement.dataset.theme = choice === 'system' ? (media.matches ? 'dark' : 'light') : choice;
  for (const item of document.querySelectorAll('[data-theme-choice]')) {
    item.setAttribute('aria-checked', String(item.getAttribute('data-theme-choice') === choice));
  }
  for (const listener of themeListeners) listener(galleryTheme());
}
media.addEventListener('change', applyTheme);

/* ================= menus ================= */

/** @param {HTMLButtonElement} button @param {HTMLElement} menu */
function bindMenu(button, menu) {
  const close = () => {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = menu.hidden;
    document.querySelectorAll('.menu').forEach((other) => other !== menu && (/** @type {HTMLElement} */ (other).hidden = true));
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) /** @type {HTMLElement | null} */ (menu.querySelector('button'))?.focus();
  });
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      close();
      button.focus();
    }
  });
  menu.addEventListener('click', (event) => {
    if (/** @type {HTMLElement} */ (event.target).closest('button')) close();
  });
  document.addEventListener('click', (event) => {
    if (!menu.hidden && !menu.contains(/** @type {Node} */ (event.target))) close();
  });
  return close;
}

/* ================= state & routing ================= */

const main = /** @type {HTMLElement} */ (document.getElementById('main'));
/** @type {{ agentAvailable: boolean, figures: any[], examples: { installed: boolean, items: any[] } } | null} */
let galleryState = null;
/** @type {any} */
let view = { kind: 'wall' };
let tickTimer = 0;

/** @param {string} search */
function go(search) {
  history.pushState(null, '', `/gallery${search}`);
  void render();
}
window.addEventListener('popstate', () => void render());

async function loadState() {
  const state = await api('/api/state');
  state.figures.sort((/** @type {any} */ a, /** @type {any} */ b) => b.updatedAt - a.updatedAt);
  galleryState = state;
  fillExampleOptions();
  return state;
}

async function render() {
  themeListeners.clear();
  clearInterval(tickTimer);
  main.setAttribute('aria-busy', 'true');
  const params = new URLSearchParams(location.search);
  try {
    const figureId = params.get('figure');
    const example = params.get('example');
    if (figureId) await renderFigureStage(figureId);
    else if (example) await renderExampleStage(example);
    else await renderWall();
  } catch (error) {
    document.body.classList.remove('mode-stage');
    main.replaceChildren(
      h('div', { class: 'empty-room', role: 'alert' }, h('p', {}, `读取失败：${message(error)}`), h('button', { type: 'button', class: 'btn secondary', onclick: () => go('') }, '回到画廊')),
    );
  } finally {
    main.setAttribute('aria-busy', 'false');
  }
}

/* ================= model choice ================= */

const EFFORT_ZH = { minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最高', default: '默认' };
/** @param {string} effort */
const effortLabel = (effort) => EFFORT_ZH[/** @type {keyof typeof EFFORT_ZH} */ (effort)] ?? effort;
const OFF = '__off__';

/** @type {Promise<{ models: any[], default: any, host?: any } | null> | null} */
let catalogPromise = null;
/** @type {{ models: any[], default: any, host?: any } | null} */
let catalogCache = null;
/** The Host's model catalog; the page API also knows the model of the chat the gallery is open in. */
function loadCatalog() {
  catalogPromise ??= (async () => {
    try {
      const agent = window.mcode?.miniapp?.agent;
      if (agent?.models) return await agent.models();
    } catch {
      /* fall back to the Node service */
    }
    try {
      return await api('/api/models');
    } catch {
      return null;
    }
  })().then((catalog) => {
    catalogCache = catalog;
    // Model labels rendered before the catalog arrived used raw ids; repaint them with picker names.
    if (catalog && view.kind === 'figure' && view.data) updateFigure();
    return catalog;
  });
  return catalogPromise;
}

/** @param {any} a @param {any} b */
const sameModel = (a, b) => !!a && !!b && a.providerId === b.providerId && a.modelId === b.modelId;

/**
 * Fill a model select and an effort select, preselecting `initial`.
 * @param {HTMLSelectElement} modelSelect @param {HTMLSelectElement} effortSelect @param {any} catalog @param {any} initial
 */
function fillModelControls(modelSelect, effortSelect, catalog, initial) {
  const models = catalog?.models ?? [];
  const groups = new Map();
  for (const option of models) {
    const provider = String(option.providerId).replace(/^custom_provider:/, '');
    if (!groups.has(provider)) groups.set(provider, []);
    groups.get(provider).push(option);
  }
  modelSelect.replaceChildren(...[...groups].map(([provider, options]) =>
    h('optgroup', { label: provider }, options.map((/** @type {any} */ option) =>
      h('option', { value: `${option.providerId}\u0000${option.modelId}` }, option.displayName || option.modelId)))));
  const start = models.find((option) => sameModel(option, initial)) ?? models.find((option) => sameModel(option, catalog?.default)) ?? models[0];
  if (start) modelSelect.value = `${start.providerId}\u0000${start.modelId}`;
  const syncEffort = (/** @type {any} */ preset) => {
    const option = currentModel(modelSelect, catalog);
    const efforts = option?.thinking?.efforts ?? [];
    const canTurnOff = (option?.variants ?? []).includes('');
    const items = [h('option', { value: '' }, defaultEffortText(option))];
    for (const effort of efforts) if (effort !== 'default') items.push(h('option', { value: effort }, effortLabel(effort)));
    if (canTurnOff) items.push(h('option', { value: OFF }, '关闭思考'));
    effortSelect.replaceChildren(...items);
    effortSelect.disabled = items.length <= 1;
    const wanted = preset && sameModel(preset, option) ? (preset.variant === '' ? OFF : preset.thinking?.effort ?? preset.effort ?? '') : '';
    effortSelect.value = [...effortSelect.options].some((o) => o.value === wanted) ? wanted : '';
  };
  modelSelect.onchange = () => syncEffort(null);
  syncEffort(initial);
  modelSelect.disabled = models.length === 0;
}

/** @param {HTMLSelectElement} modelSelect @param {any} catalog */
function currentModel(modelSelect, catalog) {
  const [providerId, modelId] = modelSelect.value.split('\u0000');
  return (catalog?.models ?? []).find((/** @type {any} */ option) => option.providerId === providerId && option.modelId === modelId) ?? null;
}

/** Build the selection the Host expects from the two controls. @param {HTMLSelectElement} modelSelect @param {HTMLSelectElement} effortSelect @param {any} catalog */
function readSelection(modelSelect, effortSelect, catalog) {
  const option = currentModel(modelSelect, catalog);
  if (!option) return null;
  /** @type {any} */
  const selection = { providerId: option.providerId, modelId: option.modelId };
  const effort = effortSelect.value;
  if (effort === OFF) selection.variant = '';
  else if (effort) {
    const thinkingVariant = (option.variants ?? []).find((/** @type {string} */ v) => v !== '');
    if (thinkingVariant) selection.variant = thinkingVariant;
    selection.thinking = { effort };
  }
  return selection;
}

/* ================= example names ================= */

/** Chinese names for the examples shipped with the anatomy skill; the English title stays as a subtitle. */
const EXAMPLE_ZH = {
  'arcade-cabinet': '街机机柜',
  'desk-computer': '台式电脑',
  'dial-indicator': '百分表',
  'raptor-engine': '猛禽 2 火箭发动机',
  'ripple-tank': '水波槽',
  'turning-dial': '密码转盘',
  'spot-plate': '点滴板',
  'test-rig': '按键弹簧测试台',
};
/** @param {any} example */
const exampleName = (example) => EXAMPLE_ZH[/** @type {keyof typeof EXAMPLE_ZH} */ (example.name)] ?? example.title;

/* ================= artwork sources ================= */

/** @param {any} figure summary */
function figureSources(figure) {
  const latest = figure.latest;
  if (!latest) return { darkImg: null, lightImg: null, darkPage: null, lightPage: null };
  const base = `/api/figures/${figure.id}/versions/${latest.n}`;
  return {
    darkImg: latest.hasPreview ? `${base}/preview` : null,
    lightImg: latest.hasLightPreview ? `${base}/preview-light` : null,
    darkPage: `${base}/dark`,
    lightPage: latest.hasLight ? `${base}/light` : null,
  };
}

/** @param {any} example */
function exampleSources(example) {
  return {
    darkImg: null, // the skill ships light screenshots only
    lightImg: example.hasPreview ? `/api/examples/${example.name}/preview` : null,
    darkPage: `/api/examples/${example.name}/dark`,
    lightPage: example.hasLight ? `/api/examples/${example.name}/light` : null,
  };
}

/** @type {Map<string, Promise<string>>} */
const pageCache = new Map();
/** @param {string} url */
function fetchPage(url) {
  if (!pageCache.has(url)) {
    const pending = fetch(url).then((response) => {
      if (!response.ok) throw new Error(`读取失败（${response.status}）`);
      return response.text();
    });
    pending.catch(() => pageCache.delete(url));
    pageCache.set(url, pending);
  }
  return /** @type {Promise<string>} */ (pageCache.get(url));
}

/*
 * Live miniatures show only the framed plate of an anatomy page (`.iso-plate`), rendered at a fixed
 * natural width and scaled into the tile. A small injected script reports the plate size so each tile
 * keeps the figure's own aspect ratio. The iframe stays sandboxed (scripts only, opaque origin).
 */
const NATURAL_WIDTH = 860;
const FRAME_STYLE = `<style data-anatomy-gallery>
html,body{margin:0!important;padding:0!important;background:transparent!important;overflow:hidden!important}
body>*:not(.iso-page){display:none!important}
.iso-page{margin:0!important;padding:0!important;max-width:none!important;width:auto!important}
.iso-page>*:not(.iso-figure:first-of-type){display:none!important}
.iso-figure{margin:0!important}
.iso-figure>*:not(.iso-plate){display:none!important}
</style>
<script>(function(){function s(){var p=document.querySelector('.iso-plate');if(!p)return;var r=p.getBoundingClientRect();parent.postMessage({type:'anatomy-gallery:size',w:Math.round(r.width),h:Math.round(r.height)},'*')}addEventListener('load',function(){s();setTimeout(s,400);setTimeout(s,1500)});addEventListener('resize',s)})();</script>`;

/** @param {string} html */
function framed(html) {
  const at = html.search(/<\/head>/i);
  return at >= 0 ? html.slice(0, at) + FRAME_STYLE + html.slice(at) : FRAME_STYLE + html;
}

/** @type {WeakMap<Window, HTMLElement>} */
const liveByWindow = new WeakMap();
window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'anatomy-gallery:size' || !event.source) return;
  const box = liveByWindow.get(/** @type {Window} */ (event.source));
  if (!box || !(data.w > 0 && data.h > 0)) return;
  box.dataset.w = String(data.w);
  box.dataset.h = String(data.h);
  layoutLive(box);
});

/** @param {HTMLElement} box */
function layoutLive(box) {
  const frame = /** @type {HTMLIFrameElement | null} */ (box.querySelector('iframe'));
  if (!frame) return;
  const w = Number(box.dataset.w) || NATURAL_WIDTH;
  const h = Number(box.dataset.h) || Math.round(NATURAL_WIDTH * 0.75);
  frame.style.width = `${w}px`;
  frame.style.height = `${h}px`;
  const cw = box.clientWidth;
  if (!cw) return;
  if (box.dataset.fit === 'contain') {
    const ch = box.clientHeight;
    const scale = Math.min(cw / w, ch / h);
    frame.style.transform = `translate(${(cw - w * scale) / 2}px, ${(ch - h * scale) / 2}px) scale(${scale})`;
  } else {
    box.style.aspectRatio = `${w} / ${h}`;
    frame.style.transform = `scale(${cw / w})`;
  }
}

const liveResize = new ResizeObserver((entries) => {
  for (const entry of entries) layoutLive(/** @type {HTMLElement} */ (entry.target));
});

/** @type {HTMLElement[]} */
const liveQueue = [];
let liveBusy = 0;
const liveObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    liveObserver.unobserve(entry.target);
    liveQueue.push(/** @type {HTMLElement} */ (entry.target));
  }
  pumpLive();
}, { rootMargin: '240px' });

function pumpLive() {
  while (liveBusy < 2 && liveQueue.length) {
    const box = /** @type {HTMLElement} */ (liveQueue.shift());
    if (!box.isConnected) continue;
    liveBusy += 1;
    fetchPage(/** @type {string} */ (box.dataset.src))
      .then((html) => {
        const frame = /** @type {HTMLIFrameElement} */ (box.querySelector('iframe'));
        if (frame.contentWindow) liveByWindow.set(frame.contentWindow, box);
        frame.setAttribute('srcdoc', framed(html));
        return new Promise((resolve) => {
          frame.addEventListener('load', resolve, { once: true });
          setTimeout(resolve, 4000);
        });
      })
      .catch(() => box.replaceChildren(h('div', { class: 'placeholder' }, icon('cube', 24), '载入失败')))
      .finally(() => {
        liveBusy -= 1;
        pumpLive();
      });
  }
}

/** @param {string} url @param {string} theme @param {'width' | 'contain'} [fit] */
function liveMini(url, theme, fit = 'width') {
  const box = h('div', { class: 'live', 'data-figure-theme': theme, 'data-src': url, 'data-fit': fit },
    h('iframe', { sandbox: 'allow-scripts', tabindex: '-1', 'aria-hidden': 'true', title: '作品缩略预览' }));
  liveObserver.observe(box);
  liveResize.observe(box);
  requestAnimationFrame(() => layoutLive(box));
  return box;
}

/**
 * Show the artwork in the gallery theme: a matching screenshot, else a live miniature of the matching
 * edition, else the other screenshot inverted (close to anatomy's monochrome dark edition).
 * @param {{ darkImg: string | null, lightImg: string | null, darkPage: string | null, lightPage: string | null }} s
 * @param {{ preferLive?: boolean, fit?: 'width' | 'contain' }} [options]
 */
function artwork(s, options = {}) {
  const theme = galleryTheme();
  const img = theme === 'dark' ? s.darkImg : s.lightImg;
  const page = theme === 'dark' ? s.darkPage : s.lightPage;
  if (options.preferLive && page) return liveMini(page, theme, options.fit);
  if (img) return h('img', { src: img, alt: '', loading: 'lazy' });
  if (page) return liveMini(page, theme, options.fit);
  const other = s.darkImg ?? s.lightImg;
  if (other) return h('img', { src: other, alt: '', loading: 'lazy', class: 'invert' });
  const anyPage = s.darkPage ?? s.lightPage;
  if (anyPage) return liveMini(anyPage, anyPage === s.darkPage ? 'dark' : 'light', options.fit);
  return h('div', { class: 'placeholder' }, icon('cube', 28), '还没有版本');
}

/** Small still image for filmstrips and version lists; never live. */
function still(/** @type {string | null} */ darkImg, /** @type {string | null} */ lightImg, /** @type {string} */ fallback) {
  const theme = galleryTheme();
  const exact = theme === 'dark' ? darkImg : lightImg;
  const src = exact ?? darkImg ?? lightImg;
  if (!src) return h('span', {}, fallback);
  return h('img', { src, alt: '', loading: 'lazy', class: exact ? '' : 'invert' });
}

/* ================= wall ================= */

async function renderWall() {
  view = { kind: 'wall' };
  document.body.classList.remove('mode-stage');
  const state = await loadState();
  themeListeners.add(() => view.kind === 'wall' && galleryState && paintWall(galleryState));
  paintWall(state);
}

/* ---------- rooms (user-defined categories) ---------- */

const ALL_ROOMS = 'all';
/** The room in the URL, or "all"; unknown ids fall back to all. */
function currentRoom() {
  const id = new URLSearchParams(location.search).get('room');
  return id && galleryState?.categories.some((/** @type {any} */ c) => c.id === id) ? id : ALL_ROOMS;
}
/** @param {string} room */
const roomQuery = (room) => (room && room !== ALL_ROOMS ? `room=${encodeURIComponent(room)}` : '');
/** @param {string} id */
const roomName = (id) => galleryState?.categories.find((/** @type {any} */ c) => c.id === id)?.name ?? '默认';
/** @param {string} figureId @param {string} room */
const figureHref = (figureId, room) => `?figure=${figureId}${roomQuery(room) ? `&${roomQuery(room)}` : ''}`;

/** @param {NonNullable<typeof galleryState>} state */
function paintWall(state) {
  const room = currentRoom();
  const all = state.figures;
  const mine = room === ALL_ROOMS ? all : all.filter((figure) => figure.categoryId === room);
  /** @type {HTMLElement} */ (document.getElementById('brand-sub')).textContent = all.length ? `${all.length} 件作品` : '';
  const nodes = [];
  if (!state.agentAvailable) nodes.push(h('p', { class: 'notice', role: 'status' }, '画廊没有获得运行 Agent 的授权，只能浏览和导入，不能新建或修改。'));

  nodes.push(h('nav', { class: 'rooms', 'aria-label': '展区' },
    h('div', { class: 'room-tabs' },
      [{ id: ALL_ROOMS, name: '全部', count: all.length }, ...state.categories].map((/** @type {any} */ c) =>
        h('a', {
          class: 'room-tab',
          href: `/gallery${roomQuery(c.id) ? `?${roomQuery(c.id)}` : ''}`,
          'aria-current': c.id === room ? 'page' : null,
          onclick: (/** @type {MouseEvent} */ event) => {
            event.preventDefault();
            go(roomQuery(c.id) ? `?${roomQuery(c.id)}` : '');
          },
        }, c.name, h('span', { class: 'room-count' }, String(c.count))))),
    h('button', { type: 'button', class: 'btn ghost sm', onclick: () => openRoomsDialog() }, '管理展区'),
  ));

  const featured = mine.find((figure) => figure.latest) ?? mine[0];
  if (featured) nodes.push(hero({
    href: figureHref(featured.id, room),
    kicker: featured.lastRun?.status === 'running' ? '正在制作' : room === ALL_ROOMS ? `最新作品 · ${roomName(featured.categoryId)}` : '本展区最新',
    title: featured.title,
    note: featured.latest?.note || (featured.latest ? `第 ${featured.latest.n} 版 · ${when(featured.updatedAt)}` : '首版完成后会挂在这里'),
    sources: figureSources(featured),
    action: '进入展厅',
  }));
  else if (room === ALL_ROOMS && state.examples.items.length) {
    const example = state.examples.items.find((item) => item.name === 'dial-indicator') ?? state.examples.items[0];
    nodes.push(hero({
      href: `?example=${example.name}`,
      kicker: `anatomy 示例 · ${example.title}`,
      title: exampleName(example),
      note: '你的作品会挂在这里。点「新建作品」，描述想讲清楚的东西，Agent 会用 anatomy 把它做成一台可以交互的小机器。',
      sources: exampleSources(example),
      action: '看看这件',
    }));
  }

  const title = room === ALL_ROOMS ? '我的作品' : roomName(room);
  const mineRoom = h('section', { class: 'room', 'aria-labelledby': 'room-mine' },
    h('div', { class: 'room-head' }, h('h2', { id: 'room-mine' }, title), h('span', { class: 'muted' }, mine.length ? `${mine.length} 件` : '')),
  );
  if (mine.length === 0) {
    mineRoom.append(h('div', { class: 'empty-room' },
      h('p', {}, room === ALL_ROOMS
        ? '还没有作品。新建一件，或者把已经做好的 anatomy 页面导入进来。'
        : '这个展区还没有作品。可以在这里新建，也可以在作品的“信息”里把它移过来。'),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn secondary', onclick: () => openImportDialog() }, '导入'),
        h('button', { type: 'button', class: 'btn primary', disabled: !state.agentAvailable, onclick: () => openNewDialog() }, '新建作品'),
      ),
    ));
  } else if (mine.length === 1 && featured) {
    mineRoom.append(h('div', { class: 'empty-room' },
      h('p', {}, room === ALL_ROOMS ? '上面就是你的第一件作品。之后新建或导入的作品都会挂在这面墙上。' : '这个展区目前只有上面这一件作品。'),
      h('button', { type: 'button', class: 'btn primary', disabled: !state.agentAvailable, onclick: () => openNewDialog() }, '再做一件'),
    ));
  } else {
    mineRoom.append(h('div', { class: 'wall', role: 'list' }, mine.filter((figure) => figure !== featured).map((figure) => tile({
      href: figureHref(figure.id, room),
      title: figure.title,
      meta: [room === ALL_ROOMS ? roomName(figure.categoryId) : '', figure.latest ? `v${figure.latest.n}` : '', when(figure.latest ? figure.updatedAt : figure.createdAt)].filter(Boolean).join(' · '),
      note: figure.latest?.note,
      sources: figureSources(figure),
      status: figure.lastRun?.status,
    }))));
  }
  nodes.push(mineRoom);

  if (room === ALL_ROOMS) {
    const examplesRoom = h('section', { class: 'room', 'aria-labelledby': 'room-examples' },
      h('div', { class: 'room-head' }, h('h2', { id: 'room-examples' }, 'anatomy 示例'), h('span', { class: 'muted' }, '技能自带，可以照着新建')),
    );
    if (!state.examples.installed) {
      examplesRoom.append(h('div', { class: 'empty-room' }, h('p', {}, '本机没有找到 anatomy 技能。新建作品也需要先安装它。')));
    } else {
      examplesRoom.append(h('div', { class: 'wall', role: 'list' }, state.examples.items.map((example) => tile({
        href: `?example=${example.name}`,
        title: exampleName(example),
        meta: example.title,
        sources: exampleSources(example),
      }))));
    }
    nodes.push(examplesRoom);
  }
  main.replaceChildren(...nodes);
}

/** Fill a room select; `preferred` falls back to the default room. @param {HTMLSelectElement} select @param {string} [preferred] */
function fillRoomSelect(select, preferred) {
  const rooms = galleryState?.categories ?? [{ id: 'default', name: '默认' }];
  select.replaceChildren(...rooms.map((/** @type {any} */ c) => h('option', { value: c.id }, c.name)));
  select.value = rooms.some((/** @type {any} */ c) => c.id === preferred) ? /** @type {string} */ (preferred) : 'default';
}

/* ---------- manage rooms ---------- */

let roomsBusy = false;
function openRoomsDialog() {
  const dialog = /** @type {HTMLDialogElement} */ (document.getElementById('rooms-dialog'));
  /** @type {HTMLElement} */ (document.getElementById('rooms-error')).textContent = '';
  paintRooms();
  dialog.showModal();
  // Land on "add a room", not on the first rename field.
  /** @type {HTMLInputElement} */ (document.getElementById('rooms-add-name')).focus();
}

/** @param {string} path @param {{ method?: string, body?: any }} options */
async function roomsCall(path, options) {
  if (roomsBusy) return false;
  roomsBusy = true;
  const error = /** @type {HTMLElement} */ (document.getElementById('rooms-error'));
  error.textContent = '';
  try {
    await api(path, options);
    await loadState();
    paintRooms();
    if (view.kind === 'wall' && galleryState) paintWall(galleryState);
    return true;
  } catch (err) {
    error.textContent = message(err);
    return false;
  } finally {
    roomsBusy = false;
  }
}

function paintRooms() {
  const list = /** @type {HTMLElement} */ (document.getElementById('rooms-list'));
  const rooms = galleryState?.categories ?? [];
  const home = rooms.find((/** @type {any} */ c) => c.builtIn)?.name ?? '默认';
  /** @type {HTMLElement} */ (document.getElementById('rooms-hint')).textContent =
    `每件作品挂在一个展区里。改名后按回车保存；移除一个展区时，里面的作品会回到“${home}”。“${home}”是内置展区，可以改名，不能移除。`;
  fill(list, ...rooms.map((/** @type {any} */ c, /** @type {number} */ index) => {
    const input = /** @type {HTMLInputElement} */ (h('input', { type: 'text', value: c.name, maxlength: 20, 'aria-label': `展区名称：${c.name}` }));
    const save = () => {
      const name = input.value.trim();
      if (!name || name === c.name) {
        input.value = c.name;
        return;
      }
      void roomsCall(`/api/categories/${c.id}`, { method: 'PATCH', body: { name } });
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        save();
      } else if (event.key === 'Escape') {
        event.stopPropagation();
        input.value = c.name;
        input.blur();
      }
    });
    input.addEventListener('blur', save);
    const move = (/** @type {number} */ delta) => {
      const ids = rooms.map((/** @type {any} */ r) => r.id);
      const [item] = ids.splice(index, 1);
      ids.splice(index + delta, 0, item);
      void roomsCall('/api/categories/order', { method: 'POST', body: { ids } });
    };
    let armed = false;
    const drop = /** @type {HTMLButtonElement} */ (h('button', {
      type: 'button',
      class: 'btn ghost sm danger-text',
      hidden: c.builtIn,
      onclick: () => {
        if (!armed) {
          armed = true;
          drop.textContent = c.count ? `确认（${c.count} 件移到“${home}”）` : '确认';
          setTimeout(() => {
            if (drop.isConnected) {
              armed = false;
              drop.textContent = '移除';
            }
          }, 4000);
          return;
        }
        const leaving = new URLSearchParams(location.search).get('room') === c.id;
        void roomsCall(`/api/categories/${c.id}`, { method: 'DELETE' }).then((ok) => {
          if (ok && leaving) go('');
        });
      },
    }, '移除'));
    return h('li', { class: 'room-row' },
      h('div', { class: 'room-order' },
        h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': `上移 ${c.name}`, disabled: index === 0, onclick: () => move(-1) }, icon('up', 14)),
        h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': `下移 ${c.name}`, disabled: index === rooms.length - 1, onclick: () => move(1) }, icon('down', 14))),
      input,
      h('span', { class: 'muted small room-row-count' }, `${c.count} 件${c.builtIn ? ' · 内置' : ''}`),
      drop);
  }));
}

/** @param {{ href: string, kicker: string, title: string, note: string, sources: any, action: string }} o */
function hero(o) {
  const theme = galleryTheme();
  const art = h('div', { class: 'art' }, artwork(o.sources, { preferLive: true, fit: 'contain' }));
  return h('a', {
    class: 'hero',
    href: `/gallery${o.href}`,
    'data-figure-theme': theme,
    'aria-label': `${o.kicker}：${o.title}`,
    onclick: (/** @type {MouseEvent} */ event) => {
      event.preventDefault();
      go(o.href);
    },
  },
  art,
  h('div', { class: 'hero-caption' },
    h('div', {}, h('p', { class: 'hero-kicker' }, o.kicker), h('p', { class: 'hero-title' }, o.title), h('p', { class: 'hero-note small' }, o.note)),
    h('span', { class: 'btn primary enter' }, o.action),
  ));
}

/** @param {{ href: string, title: string, meta: string, note?: string, sources: any, status?: string }} o */
function tile(o) {
  const frame = h('div', { class: 'tile-frame', 'data-figure-theme': galleryTheme() }, artwork(o.sources));
  if (o.status && o.status !== 'finished' && o.status !== 'aborted') {
    const [text, cls] = RUN_STATUS[/** @type {keyof typeof RUN_STATUS} */ (o.status)] ?? [o.status, ''];
    frame.append(h('span', { class: `status-dot ${cls}` }, text));
  }
  return h('a', {
    class: 'tile',
    role: 'listitem',
    href: `/gallery${o.href}`,
    onclick: (/** @type {MouseEvent} */ event) => {
      event.preventDefault();
      go(o.href);
    },
  },
  frame,
  h('div', { class: 'tile-caption' }, h('span', { class: 'tile-title', title: o.title }, o.title), h('span', { class: 'tile-meta' }, o.meta)),
  o.note ? h('p', { class: 'tile-note' }, o.note) : null,
  );
}

/* ================= stage ================= */

/**
 * Shared immersive frame: bar, artwork, optional drawer, filmstrip.
 * @param {{ title: string, subtitle: string, url: (n: number | null, theme: string) => string,
 *   hasLight: (n: number | null) => boolean, version: number | null, right: HTMLElement[],
 *   drawer?: HTMLElement, film: { items: any[], currentId: string, hrefOf: (item: any) => string, label: (item: any) => string,
 *   still: (item: any) => HTMLElement } }} o
 */
function buildStage(o) {
  document.body.classList.add('mode-stage');
  let theme = galleryTheme();
  let pinned = false;
  let current = o.version;
  let loadedKey = '';
  let token = 0;

  const frame = h('iframe', { title: `${o.title}（可交互）`, sandbox: 'allow-scripts', referrerpolicy: 'no-referrer' });
  const overlay = h('div', { class: 'stage-overlay', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), '正在载入…');
  const art = h('div', { class: 'stage-art' }, h('div', { class: 'stage-canvas' }, frame, overlay));
  const darkChip = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', onclick: () => setTheme('dark') }, '深色');
  const lightChip = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', onclick: () => setTheme('light') }, '浅色');
  const titleEl = h('strong', {}, o.title);
  const subtitleEl = h('span', {}, o.subtitle);
  const themeSeg = h('div', { class: 'seg', role: 'group', 'aria-label': '作品明暗版本' }, darkChip, lightChip);
  const stage = h('section', { class: 'stage', 'aria-label': `展厅：${o.title}` },
    h('header', { class: 'stage-bar' },
      h('div', { class: 'stage-left' },
        h('button', { type: 'button', class: 'chip icon-only', 'aria-label': '返回画廊', onclick: () => go(o.backQuery ?? '') }, icon('back')),
        h('div', { class: 'stage-title' }, titleEl, subtitleEl),
      ),
      h('div', { class: 'stage-right' }, themeSeg, ...o.right),
    ),
    h('div', { class: 'stage-body' }, art, o.drawer ?? null),
    filmstrip(o.film),
  );

  function setTheme(/** @type {string} */ next) {
    pinned = true;
    theme = next;
    void load();
  }
  themeListeners.add((galleryThemeNow) => {
    if (!pinned) {
      theme = galleryThemeNow;
      void load();
    }
  });

  async function load() {
    const lightOk = current == null || o.hasLight(current);
    if (!lightOk && theme === 'light') theme = 'dark';
    themeSeg.hidden = current == null;
    lightChip.toggleAttribute('disabled', current != null && !o.hasLight(current));
    lightChip.title = lightOk ? '' : '这个版本没有浅色版';
    darkChip.setAttribute('aria-pressed', String(theme === 'dark'));
    lightChip.setAttribute('aria-pressed', String(theme === 'light'));
    stage.dataset.figureTheme = theme;
    if (current == null && o.version === null && o.film.currentId.startsWith('fig-')) {
      frame.removeAttribute('srcdoc');
      loadedKey = '';
      overlay.replaceChildren(icon('cube', 32), h('p', {}, '这件作品还没有可以展出的版本。Agent 登记第一版后会自动出现在这里。'));
      overlay.hidden = false;
      return;
    }
    const key = `${current}:${theme}`;
    if (key === loadedKey) return;
    const mine = ++token;
    overlay.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), '正在载入…');
    overlay.hidden = false;
    try {
      const html = await fetchPage(o.url(current, theme));
      if (mine !== token) return;
      frame.addEventListener('load', () => mine === token && (overlay.hidden = true), { once: true });
      frame.setAttribute('srcdoc', html);
      loadedKey = key;
    } catch (error) {
      if (mine === token) overlay.replaceChildren(h('p', {}, `作品载入失败：${message(error)}`));
    }
  }

  main.replaceChildren(stage);
  void load();
  return {
    stage,
    titleEl,
    subtitleEl,
    load,
    get version() {
      return current;
    },
    /** @param {number | null} n */
    show(n) {
      current = n;
      void load();
    },
  };
}

/** @param {{ items: any[], currentId: string, hrefOf: (item: any) => string, label: (item: any) => string, still: (item: any) => HTMLElement }} film */
function filmstrip(film) {
  const index = film.items.findIndex((item) => item.id === film.currentId || item.name === film.currentId);
  const prev = film.items[index - 1];
  const next = film.items[index + 1];
  const list = h('div', { class: 'film', role: 'list' }, film.items.map((item, i) =>
    h('button', {
      type: 'button',
      class: 'film-item',
      role: 'listitem',
      title: film.label(item),
      'aria-label': film.label(item),
      'aria-current': String(i === index),
      onclick: () => go(film.hrefOf(item)),
    }, film.still(item))));
  requestAnimationFrame(() => /** @type {HTMLElement | undefined} */ (list.children[index])?.scrollIntoView({ inline: 'center', block: 'nearest' }));
  return h('nav', { class: 'filmstrip', 'aria-label': '同一展区的其他作品', hidden: film.items.length <= 1 },
    h('button', { type: 'button', class: 'chip icon-only', 'aria-label': '上一件', disabled: !prev, onclick: () => prev && go(film.hrefOf(prev)) }, icon('back')),
    list,
    h('button', { type: 'button', class: 'chip icon-only', 'aria-label': '下一件', disabled: !next, onclick: () => next && go(film.hrefOf(next)) }, icon('next')),
  );
}

document.addEventListener('keydown', (event) => {
  if (!document.body.classList.contains('mode-stage')) return;
  const target = /** @type {HTMLElement} */ (event.target);
  if (target.closest('input, textarea, select, dialog, .menu')) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    const items = [...document.querySelectorAll('.film-item')];
    const index = items.findIndex((item) => item.getAttribute('aria-current') === 'true');
    const nextItem = /** @type {HTMLButtonElement | undefined} */ (items[index + (event.key === 'ArrowLeft' ? -1 : 1)]);
    nextItem?.click();
  } else if (event.key === 'Escape') {
    if (view.drawerOpen) setDrawer(false);
    else go(view.backQuery ?? '');
  }
});

/* ---------- example stage ---------- */

/** @param {string} name */
async function renderExampleStage(name) {
  const state = galleryState ?? (await loadState());
  const example = state.examples.items.find((item) => item.name === name);
  if (!example) throw new Error('找不到这个示例');
  view = { kind: 'example', name };
  buildStage({
    title: exampleName(example),
    subtitle: `anatomy 示例 · ${example.title}`,
    url: (_n, theme) => `/api/examples/${name}/${theme}`,
    hasLight: () => example.hasLight,
    version: 0,
    right: [h('button', { type: 'button', class: 'chip primary', disabled: !state.agentAvailable, onclick: () => openNewDialog(name) }, '照这件新建')],
    film: {
      items: state.examples.items.map((item) => ({ ...item, id: item.name })),
      currentId: name,
      hrefOf: (item) => `?example=${item.name}`,
      label: (item) => exampleName(item),
      still: (item) => still(null, item.hasPreview ? `/api/examples/${item.name}/preview` : null, exampleName(item)),
    },
  });
}

/* ---------- figure stage ---------- */

/** @param {string} id */
async function renderFigureStage(id) {
  const [data, state] = await Promise.all([api(`/api/figures/${id}`), galleryState ? Promise.resolve(galleryState) : loadState()]);
  const figure = data.figure;
  const latest = figure.versions.at(-1)?.n ?? null;
  const room = currentRoom();
  const backQuery = roomQuery(room) ? `?${roomQuery(room)}` : '';
  view = { kind: 'figure', id, data, live: data.live, tab: 'edit', drawerOpen: !!data.live || latest === null, room, backQuery };

  const statusPill = h('button', { type: 'button', class: 'pill', hidden: true, onclick: () => setDrawer(true, 'edit') });
  const versionSelect = /** @type {HTMLSelectElement} */ (h('select', { class: 'chip', 'aria-label': '选择版本', onchange: () => {
    view.stageApi.show(Number(versionSelect.value));
    renderVersionsTab();
  } }));
  const convChip = h('button', { type: 'button', class: 'chip', 'aria-label': '在侧栏打开对话', onclick: () => void openConversation() }, icon('chat', 14), h('span', { class: 'chip-label' }, '对话'));
  const drawerChip = h('button', { type: 'button', class: 'chip', 'aria-label': '修改与版本', 'aria-expanded': 'false', 'aria-controls': 'drawer', onclick: () => setDrawer(!view.drawerOpen) }, icon('panel', 14), h('span', { class: 'chip-label' }, '修改与版本'));
  const moreChip = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'chip icon-only', 'aria-label': '更多操作', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon('more')));
  const moreMenu = h('div', { class: 'menu', role: 'menu', hidden: true },
    h('button', { type: 'button', role: 'menuitem', class: 'danger-item', onclick: () => confirmDelete() }, '从画廊撤下…'));
  bindMenu(moreChip, moreMenu);

  const tabs = /** @type {Record<string, HTMLButtonElement>} */ ({});
  const panels = /** @type {Record<string, HTMLElement>} */ ({});
  for (const [key, label] of [['edit', '修改'], ['process', '过程'], ['versions', '版本'], ['info', '信息']]) {
    tabs[key] = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'tab', role: 'tab', id: `tab-${key}`, 'aria-controls': `panel-${key}`, onclick: () => setDrawer(true, key) }, label));
    panels[key] = h('div', { class: 'tabpanel', role: 'tabpanel', id: `panel-${key}`, 'aria-labelledby': `tab-${key}` });
  }
  const drawer = h('aside', { class: 'drawer', id: 'drawer', 'aria-label': '修改与版本' },
    h('div', { class: 'tabs', role: 'tablist' }, tabs.edit, tabs.process, tabs.versions, tabs.info,
      h('button', { type: 'button', class: 'icon-btn tab-close', 'aria-label': '收起', onclick: () => setDrawer(false) }, icon('close'))),
    panels.edit, panels.process, panels.versions, panels.info);

  const stageApi = buildStage({
    title: figure.title,
    subtitle: '',
    url: (n, theme) => `/api/figures/${id}/versions/${n}/${theme}`,
    hasLight: (n) => !!view.data.figure.versions.find((/** @type {any} */ v) => v.n === n)?.hasLight,
    version: latest,
    right: [statusPill, versionSelect, convChip, drawerChip, h('div', { class: 'menu-wrap' }, moreChip, moreMenu)],
    drawer,
    backQuery,
    film: {
      // Browse within the room the visitor came from.
      items: room === ALL_ROOMS ? state.figures : state.figures.filter((/** @type {any} */ item) => item.categoryId === room),
      currentId: id,
      hrefOf: (item) => figureHref(item.id, room),
      label: (item) => item.title,
      still: (item) => {
        const s = figureSources(item);
        return still(s.darkImg, s.lightImg, item.title);
      },
    },
  });
  Object.assign(view, { stageApi, statusPill, versionSelect, convChip, drawerChip, drawer, tabs, panels, prevLatest: latest });
  themeListeners.add(() => view.kind === 'figure' && renderVersionsTab());
  updateFigure();
  setDrawer(view.drawerOpen, view.tab);
  tickTimer = window.setInterval(() => view.kind === 'figure' && view.live && renderLive(), 1000);
}

/** @param {boolean} open @param {string} [tab] */
function setDrawer(open, tab) {
  if (view.kind !== 'figure') return;
  view.drawerOpen = open;
  if (tab) view.tab = tab;
  view.drawer.hidden = !open;
  view.drawerChip.setAttribute('aria-expanded', String(open));
  for (const [key, button] of Object.entries(view.tabs)) {
    const selected = key === view.tab;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    view.panels[key].hidden = !selected;
  }
  if (open && view.tab === 'process') void renderProcessTab();
}

function updateFigure() {
  const figure = view.data.figure;
  const latest = figure.versions.at(-1)?.n ?? null;
  const stageApi = view.stageApi;
  stageApi.titleEl.textContent = figure.title;
  const origin = { gallery: '画廊新建', chat: '对话中登记', import: '导入' }[/** @type {'gallery'} */ (figure.source)] ?? '';
  stageApi.subtitleEl.textContent = `${roomName(figure.categoryId)} · ${figure.versions.length ? `${figure.versions.length} 个版本` : '尚无版本'} · ${origin}`;

  // Follow a newly registered version only when the visitor was looking at the previous latest one.
  const follow = stageApi.version == null || stageApi.version === view.prevLatest;
  view.prevLatest = latest;
  view.versionSelect.replaceChildren(...[...figure.versions].reverse().map((v) => h('option', { value: v.n }, `v${v.n}${v.n === latest ? ' · 最新' : ''}`)));
  view.versionSelect.hidden = figure.versions.length === 0;
  if (follow && latest !== stageApi.version) stageApi.show(latest);
  if (stageApi.version != null) view.versionSelect.value = String(stageApi.version);
  else void stageApi.load();

  view.convChip.hidden = !figure.sessionId;
  renderLive();
  renderEditTab();
  renderVersionsTab();
  renderInfoTab();
  if (view.drawerOpen && view.tab === 'process') void renderProcessTab();
}

/* ---------- drawer: edit ---------- */

function renderEditTab() {
  const figure = view.data.figure;
  const panel = view.panels.edit;
  const statusBlock = h('div', { class: 'block', id: 'run-block' });
  view.runBlock = statusBlock;
  view.runDom = null;
  const nodes = [statusBlock];
  const hasVersion = figure.versions.length > 0;
  if (!view.data.agentAvailable) {
    nodes.push(h('div', { class: 'block' }, h('p', { class: 'muted small' }, '画廊没有获得运行 Agent 的授权，不能修改。')));
  } else if (!hasVersion) {
    nodes.push(h('div', { class: 'block' },
      h('p', { class: 'muted small' }, view.live ? 'Agent 正在制作首版，完成后会自动展出。' : '首版还没有登记，可以按最初的需求重新生成。'),
      view.live ? null : modelRow(false),
      view.live ? null : h('div', { class: 'row start' }, h('button', { type: 'button', class: 'btn primary sm', onclick: () => void startRun('create', '') }, '重新生成')),
    ));
  } else {
    const textarea = /** @type {HTMLTextAreaElement} */ (h('textarea', { rows: 5, maxlength: 4000, placeholder: '例如：把弹簧换成两根，读数改成毫米，浅色版里指针更醒目。', disabled: !!view.live }));
    textarea.value = view.draft ?? '';
    textarea.addEventListener('input', () => (view.draft = textarea.value));
    const form = h('form', {
      class: 'block',
      onsubmit: (/** @type {SubmitEvent} */ event) => {
        event.preventDefault();
        const text = textarea.value.trim();
        if (!text) {
          textarea.focus();
          toast('先写下要怎么改');
          return;
        }
        void startRun('edit', text).then((ok) => {
          if (ok) view.draft = '';
        });
      },
    },
    h('label', { class: 'field' }, h('span', {}, `想怎么改（基于 v${figure.versions.at(-1).n}）`), textarea),
    modelRow(!!view.live),
    h('div', { class: 'row' }, h('button', { type: 'submit', class: 'btn primary sm', disabled: !!view.live }, view.live ? 'Agent 正在工作' : '交给 Agent')),
    );
    nodes.push(form);
  }
  panel.replaceChildren(...nodes);
  renderLive();
}

/** Model and thinking-effort pickers for the next run; defaults to the model of the previous run. @param {boolean} disabled */
function modelRow(disabled) {
  const modelSelect = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': '模型', disabled: true }));
  const effortSelect = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': '思考强度', disabled: true }));
  view.modelControls = { modelSelect, effortSelect, catalog: null };
  const lastModel = view.data.figure.runs.find((/** @type {any} */ run) => run.model)?.model;
  void loadCatalog().then((catalog) => {
    if (!modelSelect.isConnected || !catalog) return;
    view.modelControls.catalog = catalog;
    fillModelControls(modelSelect, effortSelect, catalog, view.modelChoice ?? lastModel ?? catalog.host ?? catalog.default);
    modelSelect.addEventListener('change', remember);
    effortSelect.addEventListener('change', remember);
    if (disabled) modelSelect.disabled = effortSelect.disabled = true;
  });
  function remember() {
    view.modelChoice = readSelection(modelSelect, effortSelect, view.modelControls.catalog);
  }
  return h('div', { class: 'field-row compact' },
    h('label', { class: 'field' }, h('span', {}, '模型'), modelSelect),
    h('label', { class: 'field' }, h('span', {}, '思考强度'), effortSelect));
}

/** Status pill in the bar and the status block in the drawer; live parts update in place. */
function renderLive() {
  const live = view.live;
  const figure = view.data.figure;
  const lastRun = figure.runs[0];
  const pill = view.statusPill;
  if (live) {
    const waiting = live.permissions.length > 0;
    pill.hidden = false;
    pill.className = `pill ${waiting ? 'warn' : 'running'}`;
    pill.replaceChildren(waiting ? '等你确认' : h('span', { class: 'spinner', 'aria-hidden': 'true' }), waiting ? '' : `制作中 · ${elapsed(live.startedAt)}`);
  } else if (lastRun && ['question', 'failed', 'error', 'unknown', 'interrupted'].includes(lastRun.status)) {
    const [text, cls] = RUN_STATUS[/** @type {keyof typeof RUN_STATUS} */ (lastRun.status)];
    pill.hidden = false;
    pill.className = `pill ${cls}`;
    pill.replaceChildren(text);
  } else {
    pill.hidden = true;
  }

  const block = view.runBlock;
  if (!block) return;
  if (live) {
    if (view.runDom?.runId !== live.runId) {
      const elapsedEl = h('span', {});
      const toolEl = h('p', { class: 'muted small' });
      const modelEl = h('p', { class: 'muted small' });
      const tailEl = h('div', { class: 'tail' });
      const asksEl = h('div', { class: 'block', role: 'region', 'aria-label': '待确认的工具请求' });
      block.replaceChildren(
        h('h3', {}, 'Agent 状态'),
        h('div', { class: 'run-line' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', {}, '正在工作 · 已用 ', elapsedEl)),
        modelEl, toolEl, tailEl, asksEl,
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn ghost sm', onclick: () => setDrawer(true, 'process') }, '看制作过程'),
          h('button', { type: 'button', class: 'btn secondary sm', onclick: () => void cancelRun() }, '取消运行')),
      );
      view.runDom = { runId: live.runId, elapsedEl, modelEl, toolEl, tailEl, asksEl, keys: '' };
    }
    const dom = view.runDom;
    dom.elapsedEl.textContent = elapsed(live.startedAt);
    dom.modelEl.textContent = live.model ? `模型：${modelLabel(live.model)}` : '';
    dom.modelEl.hidden = !live.model;
    dom.toolEl.textContent = live.lastTool ? `最近一步：${live.lastTool}` : '等待 Agent 开始…';
    dom.tailEl.textContent = plainText(live.textTail);
    dom.tailEl.hidden = !live.textTail;
    const keys = live.permissions.map((/** @type {any} */ p) => p.requestId).join('|');
    if (keys !== dom.keys) {
      dom.keys = keys;
      dom.asksEl.replaceChildren(...live.permissions.map(askCard));
      dom.asksEl.hidden = live.permissions.length === 0;
      if (live.permissions.length) {
        if (!view.drawerOpen || view.tab !== 'edit') setDrawer(true, 'edit');
        toast(`Agent 想使用 ${live.permissions.at(-1).toolName}，等你确认`);
      }
    }
    return;
  }
  view.runDom = null;
  if (!lastRun) {
    block.replaceChildren(h('h3', {}, 'Agent 状态'), h('p', { class: 'muted small' }, '还没有运行过。'));
    return;
  }
  fill(block,
    h('h3', {}, '上一次运行'),
    h('div', { class: 'run-line' }, badge(lastRun.status), h('span', { class: 'muted small' }, `${lastRun.kind === 'create' ? '新建' : '修改'} · ${when(lastRun.endedAt ?? lastRun.startedAt)}`)),
    lastRun.model ? h('p', { class: 'muted small' }, `模型：${modelLabel(lastRun.model)}`) : null,
    lastRun.status === 'question'
      ? h('div', { class: 'ask' },
        h('p', { class: 'small' }, `Agent 有问题要问你${lastRun.question?.title ? `：${lastRun.question.title}` : ''}`),
        lastRun.question?.steps?.length ? h('ul', { class: 'small muted' }, lastRun.question.steps.map((/** @type {string} */ s) => h('li', {}, s))) : null,
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary sm', onclick: () => void openConversation() }, '到对话里回答')))
      : null,
    lastRun.error ? h('p', { class: 'small', role: 'alert' }, lastRun.error) : null,
    lastRun.summary ? h('div', { class: 'summary' }, markdown(lastRun.summary)) : null,
  );
}

/** @param {any} permission */
function askCard(permission) {
  const figureId = view.id;
  /** @param {'allowOnce' | 'deny'} decision @param {boolean} [always] */
  const decide = async (decision, always = false) => {
    try {
      if (always) await api(`/api/figures/${figureId}/auto-allow`, { method: 'POST', body: { value: true } });
      await api(`/api/figures/${figureId}/permissions/${encodeURIComponent(permission.requestId)}`, { method: 'POST', body: { decision } });
    } catch (error) {
      toast(message(error));
    }
  };
  return h('div', { class: 'ask', role: 'group', 'aria-label': `确认：${permission.toolName}` },
    h('strong', { class: 'small' }, `${permission.child ? '子 Agent ' : ''}想使用 ${permission.toolName}`),
    permission.reason ? h('p', { class: 'small muted' }, permission.reason) : null,
    permission.toolInput ? h('pre', { class: 'mono' }, permission.toolInput) : null,
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn ghost sm', onclick: () => void decide('allowOnce', true) }, '本次运行都允许'),
      h('button', { type: 'button', class: 'btn secondary sm', onclick: () => void decide('deny') }, '拒绝'),
      h('button', { type: 'button', class: 'btn primary sm', onclick: () => void decide('allowOnce') }, '允许'),
    ),
  );
}

/* ---------- drawer: production log ---------- */

const RUN_STATUS_TEXT = (/** @type {string} */ status) => (RUN_STATUS[/** @type {keyof typeof RUN_STATUS} */ (status)] ?? [status])[0];

/** @param {number} ms */
const offset = (ms) => {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  return m >= 60 ? `+${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}` : `+${m}:${String(total % 60).padStart(2, '0')}`;
};

/** Load (or reuse) the log of the selected run, then draw it. @param {boolean} [force] */
async function renderProcessTab(force = false) {
  if (view.kind !== 'figure') return;
  const figure = view.data.figure;
  const panel = view.panels.process;
  const runs = figure.runs;
  if (runs.length === 0) {
    fill(panel, h('p', { class: 'muted small' }, '还没有运行过。在画廊里新建或修改后，Agent 的每一步都会记在这里。'));
    return;
  }
  if (!view.processPinned || !runs.some((/** @type {any} */ r) => r.id === view.processRunId)) {
    view.processRunId = view.live?.runId ?? runs[0].id;
  }
  const runId = view.processRunId;
  if (force || view.processLog?.runId !== runId) {
    if (view.processLoading === runId) return;
    view.processLoading = runId;
    try {
      const data = await api(`/api/figures/${figure.id}/runs/${runId}/log`);
      view.processLog = { runId, entries: data.entries, recorded: data.recorded };
    } catch (error) {
      view.processLog = { runId, entries: [], recorded: true, error: message(error) };
    } finally {
      view.processLoading = null;
    }
    if (view.kind !== 'figure' || view.processRunId !== runId) return;
  }
  drawProcess();
}

function drawProcess() {
  const figure = view.data.figure;
  const panel = view.panels.process;
  const run = figure.runs.find((/** @type {any} */ r) => r.id === view.processRunId);
  const logData = view.processLog;
  if (!run || !logData) return;
  const keepScroll = panel.scrollTop;
  const atBottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 40;

  const select = /** @type {HTMLSelectElement} */ (h('select', {
    'aria-label': '选择一次运行',
    onchange: () => {
      view.processPinned = true;
      view.processRunId = select.value;
      void renderProcessTab(true);
    },
  }, figure.runs.map((/** @type {any} */ r, /** @type {number} */ i) =>
    h('option', { value: r.id }, `第 ${figure.runs.length - i} 次 · ${r.kind === 'create' ? '新建' : '修改'} · ${when(r.startedAt)} · ${RUN_STATUS_TEXT(r.status)}`))));
  select.value = run.id;

  const entries = logData.entries;
  const start = entries.find((e) => e.type === 'start');
  const end = entries.findLast((e) => e.type === 'end');
  const model = entries.findLast((e) => e.type === 'turn')?.model ?? run.model ?? start?.model;
  const t0 = start?.t ?? run.startedAt;
  const steps = entries.filter((e) => e.type === 'tool');
  const failedSteps = steps.filter((e) => !e.ok).length;
  const isLive = view.live?.runId === run.id;
  const duration = (end?.t ?? (isLive ? Date.now() : run.endedAt ?? Date.now())) - t0;

  const head = h('div', { class: 'process-head' },
    h('div', { class: 'run-line' }, isLive ? h('span', { class: 'spinner', 'aria-hidden': 'true' }) : badge(run.status),
      h('span', { class: 'small muted' }, `${run.kind === 'create' ? '新建' : '修改'} · 用时 ${elapsed(Date.now() - duration)}`)),
    h('dl', { class: 'kv' },
      h('dt', {}, '模型'), h('dd', {}, model ? modelLabel(model) : '—'),
      h('dt', {}, '步骤'), h('dd', {}, steps.length ? `${steps.length} 步${failedSteps ? `，其中 ${failedSteps} 步失败` : ''}` : '—'),
    ),
  );

  /** @type {(HTMLElement | null)[]} */
  const items = [];
  if (!logData.recorded) {
    items.push(h('p', { class: 'muted small' }, '这次运行发生在“制作过程”记录上线之前，画廊没有保存它的步骤。'));
  }
  if (logData.error) items.push(h('p', { class: 'small', role: 'alert' }, `读取失败：${logData.error}`));
  /** @type {any[]} */
  let toolRun = [];
  const flushTools = () => {
    if (!toolRun.length) return;
    const counts = new Map();
    for (const e of toolRun) counts.set(e.name, (counts.get(e.name) ?? 0) + 1);
    const failed = toolRun.filter((e) => !e.ok).length;
    items.push(h('li', { class: 'tl-item tl-tools' },
      h('div', { class: 'tl-meta' }, h('span', {}, `执行了 ${toolRun.length} 步${failed ? `（${failed} 步失败）` : ''}`), h('span', {}, offset(toolRun[0].t - t0))),
      h('details', {},
        h('summary', { class: 'small muted' }, [...counts].map(([name, n]) => `${name} ×${n}`).join(' · ')),
        h('ol', { class: 'tl-steps' }, toolRun.map((e) => h('li', { class: e.ok ? '' : 'bad' }, `${offset(e.t - t0)}  ${e.name}${e.ok ? '' : ' · 失败'}`))),
      )));
    toolRun = [];
  };
  for (const e of entries) {
    if (e.type === 'tool') {
      toolRun.push(e);
      continue;
    }
    flushTools();
    const at = offset(e.t - t0);
    if (e.type === 'start') {
      items.push(h('li', { class: 'tl-item tl-request' },
        h('div', { class: 'tl-meta' }, h('span', {}, e.kind === 'create' ? '画廊的需求' : '你的修改要求'), h('span', {}, at)),
        h('p', { class: 'prompt-text' }, e.request || '—'),
        h('details', {}, h('summary', { class: 'small muted' }, '发给 Agent 的完整指令'), h('pre', { class: 'mono tl-prompt' }, e.prompt))));
    } else if (e.type === 'message') {
      items.push(h('li', { class: 'tl-item tl-message' }, h('div', { class: 'tl-meta' }, h('span', {}, 'Agent'), h('span', {}, at)), markdown(e.text)));
    } else if (e.type === 'permission') {
      items.push(h('li', { class: 'tl-item tl-ask' },
        h('div', { class: 'tl-meta' }, h('span', {}, `请求使用 ${e.toolName}`), h('span', {}, at)),
        e.reason ? h('p', { class: 'small muted' }, e.reason) : null,
        e.auto ? h('p', { class: 'small muted' }, '已按“本次运行都允许”自动放行') : null));
    } else if (e.type === 'decision') {
      items.push(h('li', { class: 'tl-item tl-note' }, h('div', { class: 'tl-meta' }, h('span', {}, `你${e.decision === 'deny' ? '拒绝' : '允许'}了 ${e.toolName}`), h('span', {}, at))));
    } else if (e.type === 'question') {
      items.push(h('li', { class: 'tl-item tl-ask' },
        h('div', { class: 'tl-meta' }, h('span', {}, `Agent 提问${e.title ? `：${e.title}` : ''}`), h('span', {}, at)),
        e.steps?.length ? h('ul', { class: 'small' }, e.steps.map((/** @type {string} */ q) => h('li', {}, q))) : null));
    } else if (e.type === 'end') {
      items.push(h('li', { class: 'tl-item tl-note' },
        h('div', { class: 'tl-meta' }, h('span', {}, `运行结束 · ${RUN_STATUS_TEXT(e.status)}`), h('span', {}, at)),
        e.error ? h('p', { class: 'small', role: 'alert' }, e.error) : null));
    } else if (e.type === 'truncated') {
      items.push(h('li', { class: 'tl-item tl-note' }, h('p', { class: 'small muted' }, '记录太长，后面的步骤没有保存。')));
    }
  }
  flushTools();
  if (isLive) items.push(h('li', { class: 'tl-item tl-note' }, h('div', { class: 'run-line small muted' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), `Agent 正在工作${view.live.lastTool ? ` · ${view.live.lastTool}` : ''}`)));

  fill(panel,
    h('label', { class: 'field' }, h('span', {}, '运行'), select),
    head,
    h('ol', { class: 'timeline', 'aria-label': '制作过程' }, items),
    figure.sessionId ? h('div', { class: 'row start' }, h('button', { type: 'button', class: 'btn ghost sm', onclick: () => void openConversation() }, '在侧栏打开对话')) : null,
  );
  panel.scrollTop = isLive && atBottom ? panel.scrollHeight : keepScroll;
}

let processTimer = 0;
function scheduleProcessDraw() {
  if (processTimer) return;
  processTimer = window.setTimeout(() => {
    processTimer = 0;
    if (view.kind === 'figure' && view.drawerOpen && view.tab === 'process') drawProcess();
  }, 300);
}

/* ---------- drawer: versions & info ---------- */

function renderVersionsTab() {
  const figure = view.data.figure;
  const current = view.stageApi.version;
  if (figure.versions.length === 0) {
    view.panels.versions.replaceChildren(h('p', { class: 'muted small' }, 'Agent 每登记一个新版本，都会按时间排在这里。'));
    return;
  }
  view.panels.versions.replaceChildren(h('ol', { class: 'versions' }, [...figure.versions].reverse().map((v) => {
    const base = `/api/figures/${figure.id}/versions/${v.n}`;
    return h('li', {}, h('button', {
      type: 'button',
      class: 'version-item',
      'aria-current': String(v.n === current),
      onclick: () => {
        view.stageApi.show(v.n);
        view.versionSelect.value = String(v.n);
        renderVersionsTab();
      },
    },
    h('span', { class: 'version-thumb' }, still(v.hasPreview ? `${base}/preview` : null, v.hasLightPreview ? `${base}/preview-light` : null, `v${v.n}`)),
    h('span', { class: 'version-text' },
      h('strong', {}, `v${v.n} · ${v.origin === 'import' ? '导入' : 'Agent'} · ${when(v.createdAt)}`),
      v.note ? h('span', {}, v.note) : null,
      v.model ? h('span', {}, modelLabel(v.model)) : null),
    ));
  })));
}

function renderInfoTab() {
  const figure = view.data.figure;
  const edits = figure.runs.filter((/** @type {any} */ run) => run.kind === 'edit');
  const roomSelect = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': '所在展区' }));
  fillRoomSelect(roomSelect, figure.categoryId);
  roomSelect.addEventListener('change', async () => {
    roomSelect.disabled = true;
    try {
      await api(`/api/figures/${figure.id}/category`, { method: 'POST', body: { categoryId: roomSelect.value } });
      galleryState = null;
      await loadState();
      toast(`已移到“${roomName(roomSelect.value)}”`);
      await refreshFigure();
    } catch (error) {
      toast(message(error));
      roomSelect.value = figure.categoryId;
    } finally {
      roomSelect.disabled = false;
    }
  });
  fill(view.panels.info,
    h('div', { class: 'block' },
      h('label', { class: 'field' }, h('span', {}, '所在展区'), roomSelect),
      h('p', { class: 'small muted' }, '展区可以在画廊首页的“管理展区”里新建、改名和排序。'),
    ),
    h('div', { class: 'block' },
      h('dl', { class: 'kv' },
        h('dt', {}, '来源'), h('dd', {}, { gallery: '在画廊新建', chat: '在对话中登记', import: '导入' }[/** @type {'gallery'} */ (figure.source)] ?? '—'),
        h('dt', {}, '创建'), h('dd', {}, when(figure.createdAt)),
        h('dt', {}, '对话'), h('dd', {}, figure.sessionId ? '已关联，新建和每次修改都在这个对话里' : '尚未关联，第一次修改时新开'),
        figure.runs.find((/** @type {any} */ run) => run.model) ? [h('dt', {}, '模型'), h('dd', {}, modelLabel(figure.runs.find((/** @type {any} */ run) => run.model).model))] : null,
        figure.sourceDir ? [h('dt', {}, '源文件夹'), h('dd', { class: 'mono' }, figure.sourceDir)] : null,
      ),
    ),
    figure.prompt ? h('div', { class: 'block' }, h('h3', {}, '最初的需求'), h('p', { class: 'prompt-text' }, figure.prompt)) : null,
    edits.length ? h('div', { class: 'block' }, h('h3', {}, '修改记录'),
      h('ul', { class: 'small muted' }, edits.map((/** @type {any} */ run) => h('li', {}, `${when(run.startedAt)}：${run.instruction}`)))) : null,
  );
}

/* ---------- figure actions ---------- */

/** @param {'create' | 'edit'} kind @param {string} instruction */
async function startRun(kind, instruction) {
  try {
    const controls = view.modelControls;
    const model = controls?.catalog ? readSelection(controls.modelSelect, controls.effortSelect, controls.catalog) : null;
    await api(`/api/figures/${view.id}/runs`, { method: 'POST', body: { kind, instruction, model } });
    toast(kind === 'edit' ? '已交给 Agent，改好后会登记为新版本' : '已重新开始制作');
    await refreshFigure();
    return true;
  } catch (error) {
    toast(message(error));
    return false;
  }
}

async function cancelRun() {
  try {
    await api(`/api/figures/${view.id}/cancel`, { method: 'POST' });
    toast('已请求取消');
  } catch (error) {
    toast(message(error));
  }
}

async function openConversation() {
  const sessionId = view.data?.figure?.sessionId;
  const agent = window.mcode?.miniapp?.agent;
  if (!sessionId) return;
  if (!agent?.open) {
    toast('当前环境不支持在侧栏打开对话');
    return;
  }
  try {
    await agent.open(sessionId);
  } catch (error) {
    const code = message(error);
    toast(code === 'not_permitted' ? '画廊不是在对话里打开的，没法在侧栏显示对话' : code === 'session_not_found' ? '这个对话已经不存在了' : '打开对话失败，请稍后再试');
  }
}

function confirmDelete() {
  const dialog = /** @type {HTMLDialogElement} */ (document.getElementById('confirm-dialog'));
  const ok = /** @type {HTMLButtonElement} */ (document.getElementById('confirm-ok'));
  const id = view.id;
  ok.onclick = async () => {
    ok.disabled = true;
    try {
      await api(`/api/figures/${id}`, { method: 'DELETE' });
      dialog.close();
      toast('已撤下');
      go('');
    } catch (error) {
      toast(message(error));
    } finally {
      ok.disabled = false;
    }
  };
  dialog.showModal();
}

async function refreshFigure() {
  if (view.kind !== 'figure') return;
  const data = await api(`/api/figures/${view.id}`);
  if (view.kind !== 'figure' || view.id !== data.figure.id) return;
  view.data = data;
  view.live = data.live;
  updateFigure();
}

/* ================= live updates ================= */

let pollTimer = 0;
let pending = 0;
function scheduleRefresh() {
  clearTimeout(pending);
  pending = window.setTimeout(() => {
    if (view.kind === 'figure') void refreshFigure().catch(() => {});
    else if (view.kind === 'wall') void renderWall().catch(() => {});
    else void loadState().catch(() => {});
  }, 150);
}

function connectEvents() {
  if (!('EventSource' in window)) return startPolling();
  const source = new EventSource('/api/events');
  source.onmessage = (msg) => {
    let event;
    try {
      event = JSON.parse(msg.data);
    } catch {
      return;
    }
    if (event.type === 'run') {
      if (view.kind === 'figure' && view.id === event.figureId) {
        view.live = event.live;
        renderLive();
      }
      return;
    }
    if (event.type === 'log') {
      if (view.kind !== 'figure' || view.id !== event.figureId) return;
      if (view.processLog?.runId === event.runId) {
        view.processLog.entries.push(event.entry);
        scheduleProcessDraw();
      } else if (!view.processPinned && event.entry?.type === 'start') {
        view.processRunId = event.runId;
        view.processLog = { runId: event.runId, entries: [event.entry], recorded: true };
        scheduleProcessDraw();
      }
      return;
    }
    if (event.type === 'removed' && view.kind === 'figure' && view.id === event.figureId) {
      toast('这件作品已被撤下');
      go('');
      return;
    }
    if (event.type === 'categories') {
      void loadState().then(() => {
        if (view.kind === 'wall' && galleryState) paintWall(galleryState);
        else if (view.kind === 'figure') updateFigure();
        if (/** @type {HTMLDialogElement} */ (document.getElementById('rooms-dialog')).open) paintRooms();
      }).catch(() => {});
      return;
    }
    if (view.kind === 'wall' || (view.kind === 'figure' && view.id === event.figureId)) scheduleRefresh();
    else galleryState = null; // the filmstrip reloads the list next time
  };
  source.onerror = () => source.readyState === EventSource.CLOSED && startPolling();
}

function startPolling() {
  if (!pollTimer) pollTimer = window.setInterval(scheduleRefresh, 4000);
}

/* ================= dialogs ================= */

function fillExampleOptions() {
  const select = /** @type {HTMLSelectElement} */ (document.getElementById('new-example'));
  if (/** @type {HTMLDialogElement} */ (document.getElementById('new-dialog')).open) return;
  const items = galleryState?.examples.items ?? [];
  select.replaceChildren(h('option', { value: '' }, '不参考'), ...items.map((item) => h('option', { value: item.name }, `${exampleName(item)}（${item.title}）`)));
}

/** @param {string} [example] */
/** The room a new work should start in: the room being viewed, else the default room. */
function preferredRoom() {
  const room = view.kind === 'figure' ? view.room : currentRoom();
  return room && room !== ALL_ROOMS ? room : 'default';
}

function openNewDialog(example = '') {
  if (galleryState && !galleryState.agentAvailable) return toast('画廊没有获得运行 Agent 的授权，不能新建');
  /** @type {HTMLSelectElement} */ (document.getElementById('new-example')).value = example;
  fillRoomSelect(/** @type {HTMLSelectElement} */ (document.getElementById('new-category')), preferredRoom());
  /** @type {HTMLElement} */ (document.getElementById('new-error')).textContent = '';
  /** @type {HTMLDialogElement} */ (document.getElementById('new-dialog')).showModal();
  /** @type {HTMLTextAreaElement} */ (document.getElementById('new-prompt')).focus();
  const modelSelect = /** @type {HTMLSelectElement} */ (document.getElementById('new-model'));
  const effortSelect = /** @type {HTMLSelectElement} */ (document.getElementById('new-effort'));
  modelSelect.disabled = effortSelect.disabled = true;
  void loadCatalog().then((catalog) => {
    newDialogCatalog = catalog;
    /** @type {HTMLElement} */ (document.getElementById('new-model-row')).hidden = !catalog;
    if (catalog) fillModelControls(modelSelect, effortSelect, catalog, catalog.host ?? catalog.default);
  });
}
/** @type {any} */
let newDialogCatalog = null;

function openImportDialog() {
  fillRoomSelect(/** @type {HTMLSelectElement} */ (document.getElementById('import-category')), preferredRoom());
  /** @type {HTMLElement} */ (document.getElementById('import-error')).textContent = '';
  /** @type {HTMLDialogElement} */ (document.getElementById('import-dialog')).showModal();
}

function setupChrome() {
  const more = /** @type {HTMLButtonElement} */ (document.getElementById('more-btn'));
  more.append(icon('more', 18));
  bindMenu(more, /** @type {HTMLElement} */ (document.getElementById('more-menu')));
  const roomsAdd = /** @type {HTMLFormElement} */ (document.getElementById('rooms-add'));
  roomsAdd.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = /** @type {HTMLInputElement} */ (document.getElementById('rooms-add-name'));
    const name = input.value.trim();
    if (!name) {
      input.focus();
      return;
    }
    if (await roomsCall('/api/categories', { method: 'POST', body: { name } })) {
      input.value = '';
      input.focus();
    }
  });
  document.getElementById('import-item')?.addEventListener('click', openImportDialog);
  for (const item of document.querySelectorAll('[data-theme-choice]')) {
    item.addEventListener('click', () => {
      const choice = item.getAttribute('data-theme-choice');
      if (choice === 'light' || choice === 'dark') localStorage.setItem(THEME_KEY, choice);
      else localStorage.removeItem(THEME_KEY);
      applyTheme();
    });
  }
  for (const button of document.querySelectorAll('[data-close]')) {
    button.addEventListener('click', () => /** @type {HTMLDialogElement} */ (button.closest('dialog')).close());
  }
  document.getElementById('new-btn')?.addEventListener('click', () => openNewDialog());

  const newForm = /** @type {HTMLFormElement} */ (document.getElementById('new-form'));
  newForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = /** @type {HTMLButtonElement} */ (document.getElementById('new-submit'));
    const error = /** @type {HTMLElement} */ (document.getElementById('new-error'));
    const data = new FormData(newForm);
    const prompt = String(data.get('prompt') ?? '').trim();
    if (!prompt) {
      error.textContent = '请描述想讲清楚的内容';
      return;
    }
    submit.disabled = true;
    error.textContent = '';
    try {
      const { figureId } = await api('/api/figures', {
        method: 'POST',
        body: {
          prompt,
          size: data.get('size'),
          example: data.get('example'),
          categoryId: data.get('category'),
          model: newDialogCatalog
            ? readSelection(
              /** @type {HTMLSelectElement} */ (document.getElementById('new-model')),
              /** @type {HTMLSelectElement} */ (document.getElementById('new-effort')),
              newDialogCatalog,
            )
            : null,
        },
      });
      newForm.reset();
      /** @type {HTMLDialogElement} */ (document.getElementById('new-dialog')).close();
      galleryState = null;
      toast('已开始制作');
      go(`?figure=${figureId}`);
    } catch (err) {
      error.textContent = message(err);
    } finally {
      submit.disabled = false;
    }
  });

  const importForm = /** @type {HTMLFormElement} */ (document.getElementById('import-form'));
  importForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = /** @type {HTMLButtonElement} */ (document.getElementById('import-submit'));
    const error = /** @type {HTMLElement} */ (document.getElementById('import-error'));
    const page = /** @type {HTMLInputElement} */ (document.getElementById('import-path')).value.trim();
    if (!page) {
      error.textContent = '请填写页面的绝对路径';
      return;
    }
    submit.disabled = true;
    error.textContent = '';
    try {
      const categoryId = /** @type {HTMLSelectElement} */ (document.getElementById('import-category')).value;
      const { figureId } = await api('/api/import', { method: 'POST', body: { page, categoryId } });
      importForm.reset();
      /** @type {HTMLDialogElement} */ (document.getElementById('import-dialog')).close();
      galleryState = null;
      toast('已导入');
      go(`?figure=${figureId}`);
    } catch (err) {
      error.textContent = message(err);
    } finally {
      submit.disabled = false;
    }
  });
}

applyTheme();
setupChrome();
connectEvents();
void loadCatalog();
void render();
