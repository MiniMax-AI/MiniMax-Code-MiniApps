import * as C from './charts.js';

const { esc, fmt } = C;
const $ = (s, r = document) => r.querySelector(s);
const main = $('#main');

const ICON = {
  github: '<svg class="k" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.4 1.1 2.9.8.1-.6.4-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5a3.9 3.9 0 0 1 1-2.7 3.6 3.6 0 0 1 .1-2.7s.8-.3 2.8 1a9.6 9.6 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7a3.9 3.9 0 0 1 1 2.7c0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9V21c0 .3.2.6.7.5A10 10 0 0 0 12 2"/></svg>',
  gitlab: '<svg class="k" viewBox="0 0 24 24" aria-hidden="true"><path fill="#e24329" d="m12 21.4 3.7-11.3H8.3z"/><path fill="#fc6d26" d="M12 21.4 8.3 10.1H3.1z"/><path fill="#fca326" d="m3.1 10.1-1.1 3.5c-.1.3 0 .7.3.9L12 21.4z"/><path fill="#e24329" d="M3.1 10.1h5.2L6.1 3.2c-.1-.4-.6-.4-.7 0z"/><path fill="#fc6d26" d="m12 21.4 3.7-11.3h5.2z"/><path fill="#fca326" d="m20.9 10.1 1.1 3.5c.1.3 0 .7-.3.9L12 21.4z"/><path fill="#e24329" d="M20.9 10.1h-5.2l2.2-6.9c.1-.4.6-.4.7 0z"/></svg>',
  other: '<svg class="k" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="6" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="9" r="2.2"/><path d="M6 8.2v7.6M18 11.2c0 3-3.5 3.2-9.8 5.4"/></svg>',
  local: '<svg class="k" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  sync: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-15.4 6.4L3 16M3 12a9 9 0 0 1 15.4-6.4L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/></svg>',
  ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>',
  code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 7-5 5 5 5M16 7l5 5-5 5"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 7v6M12 17h.01"/></svg>',
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 11v6M12 7h.01"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 13h10M13 3v18M13 9h8"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/></svg>',
};
const TREND = { rising: '上升', declining: '下降', erratic: '波动', stable: '平稳', insufficient: '数据不足' };
const WINDOW_ZH = { '6 months ago': '近 6 个月', '1 year ago': '近 1 年', 'all time': '全部历史' };
const TREND_GLYPH = { rising: '↗', declining: '↘', erratic: '↯', stable: '→', insufficient: '·' };
const TREND_COLOR = { rising: 'var(--mcode-success)', declining: 'var(--mcode-danger)', erratic: 'var(--mcode-warning)', stable: 'var(--k-code)', insufficient: 'var(--k-other)' };
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const TIER = { small: '小型', medium: '中型', large: '大型' };
const STAGE = { queued: '排队', sync: '同步仓库', analyze: '分析提交历史', tech: '识别技术栈与目录说明' };
const LANG_COLORS = ['var(--k-code)', 'var(--k-mr)', 'var(--k-merge)', 'var(--k-review)', 'var(--k-comment)', 'var(--k-issue)', 'var(--k-other)'];
const TABS = [
  ['overview', '概览'],
  ['map', '代码地图'],
  ['risk', '风险文件'],
  ['people', '贡献者'],
  ['momentum', '节奏与救火'],
  ['tech', '技术栈'],
];
const TAB_OF_ANCHOR = { risk: 'risk', people: 'people', momentum: 'momentum', fire: 'momentum', vitals: 'overview' };

const state = {
  repos: [],
  settings: {},
  report: null,
  reportKey: null,
  error: null,
  momentumAll: false,
  contribFilter: '',
  contribAll: false,
  identity: localStorage.getItem('rr-identity') === 'raw' ? 'raw' : 'merged',
  suggest: null,
  pendingRemoval: new Map(),
  mapPlace: {},
};
const colorCache = new Map();
let route = readRoute();

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
async function api(path, opts = {}) {
  const res = await fetch(path, { method: opts.method || 'GET', headers: opts.body ? { 'content-type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) throw Object.assign(new Error(data?.error?.message || (res.status === 401 ? '页面会话已过期，请刷新页面' : `请求失败（${res.status}）`)), { code: data?.error?.code, status: res.status });
  return data;
}
const repoById = (id) => state.repos.find((r) => r.id === id) || null;
const current = () => (route.repo ? repoById(route.repo) : null);
const dtf = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
function relTime(ts) {
  if (!ts) return '从未';
  const d = Date.now() - ts;
  if (d < 60_000) return '刚刚';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} 分钟前`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} 小时前`;
  if (d < 30 * 86_400_000) return `${Math.floor(d / 86_400_000)} 天前`;
  return dtf.format(ts);
}
function relDay(ymd) {
  if (!ymd) return '–';
  const d = Math.round((new Date().setHours(0, 0, 0, 0) - C.parseYmd(ymd)) / 86_400_000);
  if (d <= 0) return '今天';
  if (d === 1) return '昨天';
  if (d < 30) return `${d} 天前`;
  if (d < 365) return `${Math.floor(d / 30)} 个月前`;
  return `${Math.floor(d / 365)} 年前`;
}
const pct = (x, d = 0) => `${(x * 100).toFixed(d)}%`;
const secs = (ms) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`);

function toast(msg, action, { ok = false } = {}) {
  const t = $('#toast');
  t.innerHTML = `${ok ? `<span class="ok" aria-hidden="true">${ICON.ok}</span>` : ''}<span>${esc(msg)}</span>${action ? `<button class="toast-btn" type="button">${esc(action.label)}</button>` : ''}`;
  t.hidden = false;
  t.style.animation = 'none';
  void t.offsetWidth;
  t.style.animation = '';
  if (action) t.querySelector('button').onclick = () => {
    t.hidden = true;
    action.run();
  };
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), action?.ms || 2800);
}
function flashCopied(el) {
  if (!el?.isConnected) return;
  const svg = el.querySelector('svg');
  if (svg && !el._icon) el._icon = svg.outerHTML;
  if (svg) svg.outerHTML = ICON.ok.replace('<svg', `<svg${svg.getAttribute('width') ? ` width="${svg.getAttribute('width')}" height="${svg.getAttribute('height')}"` : ''}`);
  el.classList.add('copied');
  clearTimeout(el._flash);
  el._flash = setTimeout(() => {
    el.classList.remove('copied');
    const cur = el.querySelector('svg');
    if (cur && el._icon) cur.outerHTML = el._icon;
    el._icon = null;
  }, 1300);
}
async function copyText(text, label = '已复制', el = null) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  flashCopied(el);
  toast(label, null, { ok: true });
}
function pathHtml(p, { link = true, baseFirst = true } = {}) {
  const i = p.lastIndexOf('/');
  const dir = esc(i >= 0 ? p.slice(0, i + 1) : '');
  const base = esc(i >= 0 ? p.slice(i + 1) : p);
  const inner = baseFirst
    ? `<span class="path" translate="no" title="${esc(p)}"><span class="base">${base}</span> <span class="dir">${dir}</span></span>`
    : `<span class="path" translate="no" title="${esc(p)}"><span class="dir">${dir}</span><span class="base">${base}</span></span>`;
  return link ? `<a class="link-btn" href="${esc(href({ file: p, person: null }))}" data-nav aria-label="查看 ${esc(p)} 的历史">${inner}</a>` : inner;
}
function personLink(name, { bot = false } = {}) {
  return `<a class="link-btn person-link" href="${esc(href({ person: name, file: null }))}" data-nav translate="no"><span class="who-name">${esc(name)}</span></a>${bot ? ' <span class="tag">机器人</span>' : ''}`;
}
function avatar(name, cls = '', color = null) {
  const initial = /^[\x00-\x7f]/.test(name) ? name.slice(0, 2).toUpperCase() : name.slice(0, 1);
  return `<span class="avatar ${cls}" style="background:${color || C.memberColor(name)}" aria-hidden="true">${esc(initial)}</span>`;
}
function webLink(kind, ref) {
  const w = state.report?.web;
  if (!w) return null;
  const sep = w.provider === 'github' ? '' : '/-';
  if (kind === 'commit') return `${w.url}${sep}/commit/${ref}`;
  return `${w.url}${sep}/blob/${state.report.head}/${ref.split('/').map(encodeURIComponent).join('/')}`;
}
function editorLink(path) {
  const r = current();
  if (!r?.localDir) return null;
  return `vscode://file${encodeURI(`${r.localDir}/${path}`)}`;
}

// ---------------------------------------------------------------------------
// Routing: the URL is the state
// ---------------------------------------------------------------------------
function readRoute() {
  const q = new URLSearchParams(location.search);
  const tab = q.get('tab');
  return {
    repo: q.get('repo') || null,
    tab: TABS.some(([t]) => t === tab) ? tab : 'overview',
    file: q.get('file') || null,
    person: q.get('person') || null,
    filter: q.get('filter') || null,
    focus: q.get('focus') || null,
    sel: q.get('sel') || null,
    lens: q.get('lens') || null,
    size: q.get('size') || null,
    range: q.get('range') || null,
  };
}
function href(patch) {
  const next = { ...route, ...patch };
  const q = new URLSearchParams();
  if (next.repo) q.set('repo', next.repo);
  if (next.repo && next.tab && next.tab !== 'overview') q.set('tab', next.tab);
  if (next.filter) q.set('filter', next.filter);
  if (next.tab === 'map') for (const k of ['focus', 'sel', 'lens', 'size', 'range']) if (next[k]) q.set(k, next[k]);
  if (next.file) q.set('file', next.file);
  if (next.person) q.set('person', next.person);
  const s = q.toString();
  return `/dashboard${s ? `?${s}` : ''}`;
}
function go(patch, { replace = false } = {}) {
  const url = href(patch);
  if (url === location.pathname + location.search) return applyRoute();
  history[replace ? 'replaceState' : 'pushState']({ drawer: Boolean(patch.file || patch.person) }, '', url);
  applyRoute();
}
window.addEventListener('popstate', () => applyRoute());

let lastRepo = undefined;
async function applyRoute() {
  const prev = route;
  route = readRoute();
  if (route.repo && !repoById(route.repo) && state.repos.length) route = { ...route, repo: null };
  // The element under a visible tooltip is about to be replaced; don't leave its tip behind.
  if (prev.repo !== route.repo || prev.tab !== route.tab || prev.focus !== route.focus) hideTip();
  if (route.repo) localStorage.setItem('rr-repo', route.repo);
  renderSidebar();
  if (route.repo !== lastRepo) {
    lastRepo = route.repo;
    state.contribFilter = '';
    state.contribAll = false;
    await loadReport();
  } else if (prev.tab !== route.tab || prev.filter !== route.filter || !$('#report')) {
    if (prev.tab === 'map' && route.tab !== 'map') stopPlay();
    renderRepo();
    if (prev.tab !== route.tab) window.scrollTo({ top: 0 });
  } else if (route.tab === 'map' && prev.focus !== route.focus) {
    renderRepo();
  } else if (route.tab === 'map' && ['size', 'range', 'lens', 'sel'].some((k) => prev[k] !== route[k])) {
    // Same place, other settings (also back / forward between them): update in place; the
    // old map stays on screen until the new numbers land.
    syncMapControls();
    syncMapLinks();
    if (prev.size !== route.size || prev.range !== route.range) mountMap();
    else {
      paintMap();
      renderMapLegend();
      renderMapTime();
      renderMapDetail();
      markTableSel();
    }
  }
  rememberMapPlace();
  syncDrawer();
  updateTitle();
}
function updateTitle() {
  const r = current();
  const tab = TABS.find(([t]) => t === route.tab)?.[1];
  const where = route.tab === 'map' && route.focus ? ` · ${route.focus}/` : '';
  document.title = r ? `${r.job?.running ? '分析中… ' : ''}${r.name}${route.tab !== 'overview' ? ` · ${tab}` : ''}${where} · 仓库透视` : '仓库透视';
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
const THEMES = ['system', 'light', 'dark'];
function applyTheme() {
  const pref = localStorage.getItem('rr-theme') || 'system';
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0a0a0b' : '#fafafa');
  const b = $('#theme-btn');
  if (b) b.lastChild.textContent = { system: ' 主题：跟随系统', light: ' 主题：浅色', dark: ' 主题：深色' }[pref];
  colorCache.clear();
}
function repaintForTheme() {
  applyTheme();
  // Label ink on the maps is picked from the resolved fill colour, so repaint them.
  if (current() && $('#report')) {
    if ($('#map-canvas svg')) paintMap();
    if ($('#codemap svg')) mountThumb(state.report);
  }
}
function cycleTheme() {
  const cur = localStorage.getItem('rr-theme') || 'system';
  localStorage.setItem('rr-theme', THEMES[(THEMES.indexOf(cur) + 1) % 3]);
  repaintForTheme();
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', repaintForTheme);

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------
const visibleRepos = () => state.repos.filter((r) => !state.pendingRemoval.has(r.id));
function renderSidebar() {
  const list = visibleRepos();
  $('#repo-list').innerHTML = list.length
    ? list
        .map((r) => {
          const running = r.job?.running;
          const err = !running && r.lastSync?.error && (!r.lastSync.at || r.lastSync.errorAt > r.lastSync.at);
          const s = r.summary;
          const spark = s?.spark ? `<span class="spark-mini">${C.sparkline(s.spark, { w: 44, h: 12, color: TREND_COLOR[s.trend] || 'var(--k-code)' })}</span>` : '';
          const sub = running
            ? `<span class="ti-sub"><span class="spinner" style="width:10px;height:10px;border-width:1.5px" aria-hidden="true"></span>分析中</span>`
            : err
              ? '<span class="ti-sub" style="color:var(--mcode-danger)">分析失败</span>'
              : s
                ? `<span class="ti-sub" title="最近一次提交 ${esc(s.latest)}">${spark}<span>${relDay(s.latest)}</span></span>`
                : '<span class="ti-sub">尚未分析</span>';
          const badge = !running && !err && s ? `<span class="ti-risk${s.risk ? ' warn' : ''}" title="高风险文件 ${s.risk} 个"><span class="sr-only">高风险文件 </span>${s.risk}</span>` : '';
          return `<li><a class="team-item repo-item" href="${esc(href({ repo: r.id, tab: 'overview', file: null, person: null, filter: null }))}" data-nav ${r.id === route.repo ? 'aria-current="page"' : ''} title="${esc(r.display)}">
            <span class="kind-dot">${ICON[r.provider] || ICON.other}</span><span class="ti-body"><span class="ti-name" translate="no">${esc(r.name)}</span>${sub}</span>${badge}</a></li>`;
        })
        .join('')
    : '<li class="hint" style="padding:4px 8px">还没有分析过仓库</li>';
  $('.brand-mark')?.classList.toggle('busy', state.repos.some((r) => r.job?.running));
}
function setLive(on) {
  const el = $('#live');
  if (!el) return;
  el.classList.toggle('off', !on);
  $('#live-text').textContent = on ? '已连接 · 实时更新' : '连接中断，正在重连…';
}

// ---------------------------------------------------------------------------
// Welcome
// ---------------------------------------------------------------------------
function parsePreview(input) {
  const v = input.trim();
  if (!v) return '';
  if (/^(\/|~|[A-Za-z]:[\\/])/.test(v)) return `本地仓库 · ${v}`;
  let m;
  if ((m = v.match(/^git@([^:]+):(.+?)(\.git)?$/))) return `${m[1]} · ${m[2]}`;
  if (/^https?:\/\//i.test(v)) {
    try {
      const u = new URL(v);
      return `${u.host} · ${u.pathname.replace(/^\/|\/$/g, '').replace(/\.git$/, '').split('/-/')[0]}`;
    } catch {
      return '地址格式不对';
    }
  }
  if ((m = v.match(/^([\w-]+)\/([\w.-]+)$/))) return `github.com · ${m[1]}/${m[2]}`;
  return '无法识别：请输入 https 地址、owner/repo，或本地仓库的绝对路径';
}
function analyzeBar(value = '') {
  return `<form class="analyze-bar" id="analyze-form" role="search" aria-label="分析仓库" novalidate>
    <span class="prompt" aria-hidden="true">❯</span>
    <div style="flex:1;min-width:0"><label class="sr-only" for="target-input">仓库地址或本地路径</label>
    <input id="target-input" name="repo" class="input mono" autocomplete="off" spellcheck="false" placeholder="GitHub / GitLab 地址、owner/repo，或本地仓库路径…" value="${esc(value)}"></div>
    <button class="btn btn-primary" type="submit">${ICON.search}<span>分析</span><kbd style="background:transparent;border-color:currentColor;color:inherit;opacity:.6">↵</kbd></button>
  </form>
  <div class="parse-hint" id="parse-hint" aria-live="polite"></div>`;
}
const EXAMPLES = ['sindresorhus/got', 'https://github.com/expressjs/express', '~/Workspace/my-repo'];
const METRICS = [
  ['代码热点', '窗口内改得最多的文件', 'git log --name-only'],
  ['Bug 磁铁', '修 bug 时最常碰的文件', '--grep="fix|bug|broken"'],
  ['知识集中度', '一半提交出自几个人', 'git shortlog -sn'],
  ['节奏与救火', '月度趋势、revert / hotfix', '--since · uniq -c'],
];
function renderWelcome() {
  const s = state.suggest;
  main.innerHTML = `<section class="welcome anim-in" aria-labelledby="wl-title" style="max-width:880px">
    <div class="welcome-hero">
      <span class="brand-mark" style="width:44px;height:44px" aria-hidden="true"><img src="/assets/icon.svg" alt="" width="44" height="44"><span class="scan" style="opacity:1"></span></span>
      <h1 id="wl-title">读代码之前，<span class="grad">先看一遍它的 git 历史</span></h1>
      <p class="muted">找出最常被改、最常出 bug 的文件，谁在维护它们，项目节奏是升是降，以及它用了哪些技术。指标定义和 <a href="https://github.com/yujiachen-y/codebase-recon-skill" target="_blank" rel="noopener" class="text-link">codebase-recon</a> skill 保持一致，全部在本机计算。</p>
    </div>
    <div class="term">
      <div class="term-bar" aria-hidden="true"><i></i><i></i><i></i><span class="t">repo-xray — 新的分析</span><span class="r">只读 · 不修改仓库</span></div>
      ${analyzeBar()}
      <div class="examples"><span>试试</span>${EXAMPLES.map((x) => `<button type="button" data-action="example" data-v="${esc(x)}" translate="no">${esc(x)}</button>`).join('')}</div>
    </div>
    <div class="metric-strip">${METRICS.map(([t, d, c]) => `<div><b>${t}</b>${d}<br><code translate="no">${esc(c)}</code></div>`).join('')}</div>
    <section class="card" aria-labelledby="sg-title">
      <div class="card-head"><div><h2 id="sg-title">本机仓库</h2><div class="card-desc">只读扫描常用目录下的 git 仓库，按最近活动排序；扫描目录可在设置里修改</div></div>
        <button class="btn btn-sm" type="button" data-action="rescan">${ICON.sync}<span>重新扫描</span></button></div>
      ${
        !s
          ? '<div class="skeleton" style="height:120px"></div>'
          : s.length
            ? `<ul class="suggest-list">${s
                .map(
                  (x, i) => `<li class="anim-in" style="--i:${Math.min(i, 12)}"><button type="button" class="suggest" data-action="analyze-path" data-path="${esc(x.path)}">
                <span class="kind-dot">${ICON.local}</span><span class="grow"><b translate="no">${esc(x.name)}</b><span class="hint path" translate="no">${esc(x.path)}</span></span>
                ${x.analyzed ? '<span class="tag good">已分析</span>' : ''}<span class="hint nowrap" title="${esc(new Date(x.mtime).toLocaleString('zh-CN'))}">${relTime(x.mtime)}</span><span class="go" aria-hidden="true">${ICON.arrow}</span></button></li>`,
                )
                .join('')}</ul>`
            : '<p class="hint">没有在常用目录里找到 git 仓库。可以在设置里添加扫描目录，或直接在上面输入路径。</p>'
      }
    </section>
  </section>`;
  $('#target-input')?.focus();
}
async function loadSuggest(refresh = false) {
  try {
    state.suggest = (await api(`/api/suggest${refresh ? '?refresh=1' : ''}`)).repos;
  } catch {
    state.suggest = [];
  }
  if (!route.repo) renderWelcome();
}

// ---------------------------------------------------------------------------
// Repo page
// ---------------------------------------------------------------------------
function headerHtml(r, rep) {
  const running = r.job?.running;
  const v = rep?.vitals;
  const web = r.webUrl || rep?.web?.url;
  const at = r.lastSync?.at;
  return `<header class="page-head">
    <div style="min-width:0">
      <h1><span class="kind-dot" style="width:22px;height:22px">${ICON[r.provider] || ICON.other}</span><span class="scramble" aria-hidden="true" translate="no">${esc(r.name)}</span><span class="sr-only">${esc(r.name)}</span></h1>
      <div class="page-meta">
        <span class="chip mono" translate="no" title="${esc(r.display)}">${esc(r.display)}</span>
        ${rep ? `<button type="button" class="head-sha" data-action="copy" data-text="${esc(rep.head)}" title="复制完整 SHA" aria-label="复制 HEAD 的完整 SHA ${esc(rep.head)}" translate="no">${ICON.copy.replace('<svg', '<svg width="12" height="12"')}<span class="br">${esc(rep.branch || 'HEAD')}</span>@${esc(rep.head.slice(0, 8))}</button>` : ''}
        ${r.kind === 'local' ? '<span class="tag">本地仓库 · 分析当前 HEAD，不 fetch</span>' : ''}
        <span style="display:inline-flex;align-items:center;gap:6px" ${at ? `title="${esc(new Date(at).toLocaleString('zh-CN'))}"` : ''}>${running ? '<span class="spinner" aria-hidden="true"></span> 正在分析…' : `<span class="live-dot" aria-hidden="true"></span> 上次分析 ${relTime(at)}`}</span>
      </div>
      ${v ? `<div class="page-meta vitals-line"><span><b>${v.first}</b> → <b>${v.latest}</b></span><span><b>${fmt(v.commits)}</b> commits</span><span><b>${fmt(v.branches)}</b> 个分支</span><span><b>${fmt(v.files)}</b> 个文件</span><span>${TIER[v.tier]} · 窗口 <b>${esc(v.window)}</b> · Top <b>${v.N}</b></span></div>` : ''}
    </div>
    <div class="head-actions">
      ${rep ? `<button class="btn" type="button" data-action="export-menu" aria-haspopup="menu" aria-expanded="false">${ICON.download}<span>导出…</span></button>` : ''}
      ${web ? `<a class="btn" href="${esc(web)}" target="_blank" rel="noopener">${ICON.ext}<span>打开网页</span></a>` : ''}
      <button class="btn btn-ghost btn-danger" type="button" data-action="remove">移除</button>
      <button class="btn btn-primary" type="button" data-action="sync" ${running ? 'disabled' : ''}>${running ? '<span class="spinner" aria-hidden="true"></span>' : ICON.sync}<span>${r.kind === 'local' ? '重新分析' : '同步并分析'}</span></button>
    </div>
  </header>
  <div id="progress"></div><span class="sr-only" role="status" id="pg-sr"></span>`;
}
function tabsHtml(rep) {
  const counts = rep ? { risk: rep.highRisk.length, people: rep.busFactor.total } : {};
  // Coming back to the map tab returns to where it was left for this repo.
  const patch = (t) => ({ tab: t, filter: null, file: null, person: null, ...(t === 'map' && route.tab !== 'map' ? mapPlaceFor(route.repo) : {}) });
  return `<nav class="tabs-bar" aria-label="报告分区">${TABS.map(
    ([t, l], i) => `<a href="${esc(href(patch(t)))}" data-nav ${route.tab === t ? 'aria-current="page"' : ''} aria-keyshortcuts="${i + 1}">${l}${counts[t] != null ? `<span class="count">${fmt(counts[t])}</span>` : ''}<kbd aria-hidden="true">${i + 1}</kbd></a>`,
  ).join('')}<span class="tab-ink" aria-hidden="true"></span></nav>`;
}
function renderRepo() {
  const r = current();
  if (!r) return renderWelcome();
  const rep = state.report && state.reportKey === `${r.id}:${state.identity}` ? state.report : null;
  let body;
  if (state.error && !rep) body = `<div class="alert" role="alert">${esc(state.error)}</div>`;
  else if (!rep) {
    const err = r.lastSync?.error && !r.job?.running;
    body = err
      ? `<div class="empty"><span>${ICON.alert}</span><h2>分析失败</h2><p>${esc(r.lastSync.error.message)}</p><button class="btn btn-primary" type="button" data-action="sync">${ICON.sync}<span>重试</span></button></div>`
      : skeletonFor(route.tab);
  } else body = tabBody(rep) + statusLine(r, rep);
  main.innerHTML = `${headerHtml(r, rep)}${tabsHtml(rep)}<div id="report" tabindex="-1">${body}</div>`;
  afterRender(r, rep);
  renderProgress();
}

// ---- post-render details: tab ink, title decode, count-up, code map -------
let inkAt = null;
function placeInk() {
  const bar = main.querySelector('.tabs-bar');
  const ink = bar?.querySelector('.tab-ink');
  const a = bar?.querySelector('a[aria-current="page"]');
  if (!ink || !a) return;
  const to = { x: a.offsetLeft, w: a.offsetWidth };
  if (inkAt && !reducedMotion()) {
    ink.style.transition = 'none';
    ink.style.transform = `translateX(${inkAt.x}px)`;
    ink.style.width = `${inkAt.w}px`;
    void ink.offsetWidth;
    ink.style.transition = '';
  }
  ink.style.transform = `translateX(${to.x}px)`;
  ink.style.width = `${to.w}px`;
  inkAt = to;
}
let decodedFor = null;
function decodeTitle(el, text) {
  if (!el || reducedMotion()) return;
  const glyphs = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789/<>_-=+*';
  const chars = [...text];
  const t0 = performance.now();
  const dur = Math.min(700, 260 + chars.length * 22);
  const step = (t) => {
    if (!el.isConnected) return;
    const k = (t - t0) / dur;
    if (k >= 1) return void (el.textContent = text);
    el.textContent = chars.map((c, i) => (i / chars.length < k || !/[\x21-\x7e]/.test(c) ? c : glyphs[(Math.random() * glyphs.length) | 0])).join('');
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
let countedFor = null;
function countUp(root) {
  const els = root.querySelectorAll('[data-count]');
  if (!els.length || reducedMotion()) return;
  const t0 = performance.now();
  const ease = (k) => 1 - (1 - k) ** 3;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 900);
    for (const el of els) {
      if (!el.isConnected) return;
      const v = Number(el.dataset.count) * ease(k);
      el.textContent = el.dataset.fmt === 'pct1' ? `${v.toFixed(1)}%` : fmt(Math.round(v));
    }
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function afterRender(r, rep) {
  placeInk();
  if (decodedFor !== r.id) {
    decodedFor = r.id;
    decodeTitle(main.querySelector('.scramble'), r.name);
  }
  if (rep && route.tab === 'overview' && countedFor !== state.reportKey + rep.head) {
    countedFor = state.reportKey + rep.head;
    countUp(main);
  }
  if (rep && route.tab === 'overview') mountThumb(rep);
  else thumbRO?.disconnect();
  if (rep && route.tab === 'map') mountMap();
  else {
    mapRO?.disconnect();
    mapRO = null;
  }
}
function statusLine(r, rep) {
  const steps = r.lastSync?.head === rep.head ? r.lastSync?.steps || [] : [];
  const an = steps.find((x) => x.stage === 'analyze');
  return `<footer class="statusline" aria-label="报告信息">
    <span>HEAD <b translate="no">${esc(rep.head.slice(0, 8))}</b></span>
    <span>算法 <b>v${rep.algo}</b></span>
    <span>口径 <b>${rep.identity === 'raw' ? '原始' : '合并身份'}</b></span>
    <span>解析 <b>${fmt(rep.vitals.commits)}</b> commits${an ? ` · 用时 <b>${secs(an.ms)}</b>` : ''}${r.lastSync?.ms && r.lastSync?.head === rep.head ? ` · 全程 <b>${secs(r.lastSync.ms)}</b>` : ''}</span>
    <span>生成于 <b>${relTime(rep.generatedAt)}</b></span>
    <span class="r"><kbd>⌘K</kbd> 搜索 · <kbd>?</kbd> 快捷键</span>
  </footer>`;
}
function skeletonFor(tab) {
  if (tab === 'overview') return `<div class="kpis">${'<div class="skeleton" style="height:96px"></div>'.repeat(6)}</div><div class="grid"><div class="skeleton span-7" style="height:260px"></div><div class="skeleton span-5" style="height:260px"></div><div class="skeleton span-6" style="height:220px"></div><div class="skeleton span-6" style="height:220px"></div></div>`;
  if (tab === 'map') return '<div class="skeleton" style="height:40px;margin-bottom:12px"></div><div class="map-layout"><div class="skeleton" style="height:520px"></div><div class="skeleton" style="height:520px"></div></div>';
  return '<div class="skeleton" style="height:420px"></div>';
}
function tabBody(rep) {
  switch (route.tab) {
    case 'map':
      return mapTab(rep);
    case 'risk':
      return riskTab(rep);
    case 'people':
      return peopleTab(rep);
    case 'momentum':
      return momentumTab(rep);
    case 'tech':
      return techTab(rep);
    default:
      return overviewTab(rep);
  }
}

// ---- explain popovers -----------------------------------------------------
function explainFor(key, rep) {
  const v = rep.vitals;
  const since = v.window === 'all time' ? '' : ` --since="${v.window}"`;
  const mo = mapOpts(rep);
  const mSince = mo.range === 'all' ? '' : ` --since="${mo.range} months ago"`;
  const cp = mp.view?.couple || { maxChangeset: 30, minRevs: 5, minShared: 5, minDegree: 0.3 };
  const E = {
    window: ['按 skill 的规则给仓库分档：<500 个 commit 看全部历史，500–10k 看 1 年，>10k 看 6 个月。', `git rev-list --count HEAD\ngit log --oneline${since} | wc -l`],
    risk: [`同时出现在“代码热点 Top ${v.N}”和“Bug 磁铁 Top ${v.N}”里的文件。`, `git log --format=format: --name-only${since} | sort | uniq -c | sort -nr | head -${v.N}\ngit log -i -E --grep="fix|bug|broken" --name-only --format=''${since} | sort | uniq -c | sort -nr | head -${v.N}`],
    active: [`近 3 个月有非合并提交的人数 / 历史总人数，低于 30% 时告警。${rep.identity === 'merged' ? '当前为“合并身份”口径：大小写不同的同名账号与同邮箱账号视为一人，机器人不计入。' : '当前为原始口径，与 shortlog 完全一致。'}`, 'git shortlog -sn --no-merges --since="3 months ago" HEAD | wc -l\ngit shortlog -sn --no-merges HEAD | wc -l'],
    half: ['按非合并提交数从高到低累加，达到总数一半时的人数。数字越小，知识越集中。', 'git shortlog -sn --no-merges HEAD'],
    trend: ['比较最近 3 个完整月和之前 3 个月的月均提交数：高 20% 以上为上升，低 20% 以上为下降；环比平均波动超过 50% 为波动。当月未结束不计入。', "git log --format='%ad' --date=format:'%Y-%m' | sort | uniq -c"],
    fire: ['窗口内标题含 revert / hotfix / emergency / rollback 的提交占比，≥5% 判为偏高（skill 未给阈值）。', `git log --oneline${since} | grep -iE 'revert|hotfix|emergency|rollback'`],
    map: ['缩略图只画第一层：面积是 HEAD 中的文件数，颜色是窗口内的修改次数（与“代码热点”同一口径），按分位数分成 5 档。大目录逐层展开，过小的子项合并成“其他 N 项”。点任意一块，会在“代码地图”分区里打开并定位到那里。', `git ls-tree -r --name-only HEAD | cut -d/ -f1 | sort | uniq -c | sort -nr\ngit log --format=format: --name-only${since} | sort | uniq -c | sort -nr`],
    mapview: ['把 HEAD 的目录树画成方块。面积默认是文件数，可以切换成所选时间范围内的修改次数；颜色按上方选择的视角。大目录逐层展开，小于 0.5% 的子项合并成“其他 N 项”。已删除文件的修改，算到它最深的、仍然存在的目录上。时间范围从今天往前算；仓库已经停更时，从最后一次提交往前算。', `git ls-tree -r --name-only HEAD\ngit log -M100% --name-status --format='%H %aN %ct %s'${mSince} HEAD`],
    couple: [`“A 常和 B 一起改”指改了 A 的提交里，同时也改了 B 的比例。这个比例有方向，A→B 和 B→A 可能不同（code-maat 用两边提交数的平均值做分母）。只统计所选时间范围内的非合并提交，超过 ${cp.maxChangeset} 个文件的大提交不计。门槛沿用 code-maat 的默认值：两边各至少 ${cp.minRevs} 个提交、一起改过至少 ${cp.minShared} 次、比例 ≥${Math.round(cp.minDegree * 100)}%。changelog、lock 文件这类几乎随每次修改一起改的流程文件单独列出，不画线；测试目录和同一个包里的代码一起改，标为“测试同步”。`, `git log --no-merges --numstat --date=short --pretty=format:'--%h--%ad--%aN' --no-renames${mSince} HEAD > logfile.log\njava -jar code-maat.jar -l logfile.log -c git2 -a coupling -s ${cp.maxChangeset} -n ${cp.minRevs} -m ${cp.minShared} -i ${Math.round(cp.minDegree * 100)}`],
    cal: ['近 365 天每天的提交数，按作者日期统计，含合并提交（与“提交节奏”同一口径）。', "git log --since='1 year ago' --date=short --format='%ad' | sort | uniq -c"],
  }[key];
  if (!E) return '';
  return `<button type="button" class="info-btn" data-action="explain" data-key="${key}" aria-expanded="false" aria-label="这个指标怎么算">${ICON.info}</button><template data-explain="${key}"><p>${esc(E[0])}</p><pre translate="no">${esc(E[1])}</pre><button type="button" class="btn btn-sm" data-action="copy" data-text="${esc(E[1])}">${ICON.copy}<span>复制命令</span></button></template>`;
}
function kpi({ label, value, sub, accent, i, key, rep, viz = '', tip = '' }) {
  return `<div class="kpi anim-in" style="--i:${i};--kpi-accent:${accent}"><div class="kpi-label">${label}${key ? explainFor(key, rep) : ''}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${sub}</div><div class="kpi-viz"${tip ? ` data-tip="${esc(tip)}"` : ''}>${viz}</div></div>`;
}
const num = (n, f) => `<span data-count="${n}"${f ? ` data-fmt="${f}"` : ''}>${f === 'pct1' ? `${Number(n).toFixed(1)}%` : fmt(n)}</span>`;
function kpisHtml(rep) {
  const v = rep.vitals;
  const bf = rep.busFactor;
  const mo = rep.momentum;
  const ff = rep.firefighting;
  const months = mo.months.slice(-12).map((x) => x.n);
  const done = mo.months.filter((x) => x.m !== mo.partialMonth).slice(-6);
  const riskRanks = new Set(rep.highRisk.map((h) => h.hotRank));
  const top = rep.contributors.slice(0, 8);
  const shares = top.map((c) => ({ value: c.share, color: C.memberColor(c.name) }));
  shares.push({ value: Math.max(0, 1 - top.reduce((s2, c) => s2 + c.share, 0)), color: 'var(--k-other)' });
  const ffMax = Math.max(0.1, ff.rate * 1.4);
  return `<section class="kpis" aria-label="关键指标">${[
    kpi({ i: 0, rep, key: 'window', label: '窗口内提交', value: num(v.windowCommits), sub: `${WINDOW_ZH[v.window] || v.window} · 全部 ${fmt(v.commits)}`, accent: 'var(--k-code)', viz: C.sparkline(months, { w: 120, h: 26, stretch: true, color: 'var(--k-code)' }), tip: `近 12 个月每月提交数\n${mo.months.slice(-12).map((x) => `${x.m}  ${fmt(x.n)}`).join('\n')}` }),
    kpi({ i: 1, rep, key: 'risk', label: '高风险文件', value: num(rep.highRisk.length), sub: `热点 Top ${v.N} 中有 ${rep.highRisk.length} 个也是 Bug 磁铁`, accent: 'var(--mcode-danger)', viz: C.dots(v.N, riskRanks) }),
    kpi({ i: 2, rep, key: 'active', label: '活跃贡献者', value: `${num(bf.active3m)}<span class="unit">/ ${fmt(bf.total)}</span>`, sub: `近 3 个月 · ${pct(bf.ratio)}${bf.warn ? ' · <span class="delta down">低于 30%</span>' : ''}`, accent: 'var(--k-merge)', viz: C.meter({ value: bf.ratio, threshold: 0.3, tick: '30%', color: bf.warn ? 'var(--mcode-danger)' : 'var(--k-merge)' }) }),
    kpi({ i: 3, rep, key: 'half', label: '一半提交来自', value: `${num(bf.halfCount)}<span class="unit">人</span>`, sub: `第一名占 ${pct(bf.topShare)}`, accent: 'var(--k-mr)', viz: C.stackMeter(shares, { mark: 0.5, tick: '50%' }) }),
    kpi({ i: 4, rep, key: 'trend', label: '提交节奏', value: `<span class="trend ${mo.trend}">${TREND[mo.trend]} ${TREND_GLYPH[mo.trend]}</span>`, sub: mo.trend === 'insufficient' ? '历史不足 6 个月' : `月均 ${fmt(Math.round(mo.lastAvg))} ← ${fmt(Math.round(mo.prevAvg))}`, accent: 'var(--k-review)', viz: C.miniBars(done.map((x) => x.n), { hi: 3, color: TREND_COLOR[mo.trend] }), tip: done.map((x) => `${x.m}  ${fmt(x.n)}`).join('\n') }),
    kpi({ i: 5, rep, key: 'fire', label: '救火提交', value: num((ff.rate * 100).toFixed(1), 'pct1'), sub: `${fmt(ff.count)} / ${fmt(ff.total)}${ff.rate >= 0.05 ? ' · <span class="delta down">偏高</span>' : ''}`, accent: 'var(--k-comment)', viz: C.meter({ value: ff.rate, max: ffMax, threshold: 0.05, tick: '5%', color: ff.rate >= 0.05 ? 'var(--mcode-warning)' : 'var(--k-comment)' }) }),
  ].join('')}</section>`;
}
function deltaHtml(rep) {
  const d = rep.delta;
  if (!d) return '';
  const parts = [`<b>${d.commits >= 0 ? '+' : ''}${fmt(d.commits)}</b> 个 commit`];
  if (d.riskAdded?.length) parts.push(`高风险新增 ${d.riskAdded.slice(0, 3).map((p) => pathHtml(p)).join('、')}${d.riskAdded.length > 3 ? ` 等 ${d.riskAdded.length} 个` : ''}`);
  if (d.riskRemoved?.length) parts.push(`移出 ${d.riskRemoved.length} 个`);
  if (d.trendFrom && d.trendFrom !== d.trendTo) parts.push(`节奏 ${TREND[d.trendFrom]} → ${TREND[d.trendTo]}`);
  return `<div class="delta-banner" role="note">${ICON.bolt}<span>自上次分析（<span class="mono">${esc(d.fromHead.slice(0, 8))}</span>，${relTime(d.fromAt)}）以来：${parts.join(' · ')}</span></div>`;
}
const seeAll = (tab, label = '查看全部') => `<a class="see-all" href="${esc(href({ tab, filter: null, file: null, person: null }))}" data-nav>${label}${ICON.arrow}</a>`;

// ---- overview -------------------------------------------------------------
function overviewTab(rep) {
  const mo = rep.momentum;
  const cm = liteMap(rep);
  return `${deltaHtml(rep)}${kpisHtml(rep)}
  <div class="grid">
    <section class="card span-7 anim-in" style="--i:2" aria-labelledby="h-prob">
      <div class="card-head"><div><h2 id="h-prob">主要问题</h2><div class="card-desc">由提交历史上的确定性规则得出，点击进入对应分区</div></div></div>
      ${problemsHtml(rep)}
    </section>
    <section class="card span-5 anim-in" style="--i:3" aria-labelledby="h-rec">
      <div class="card-head"><div><h2 id="h-rec">建议</h2><div class="card-desc">对应 skill 报告的 Recommendations</div></div></div>
      ${recHtml(rep)}
    </section>
    <section class="card span-12 anim-in" style="--i:4" aria-labelledby="h-map">
      <div class="card-head"><div><h2 id="h-map">代码地图 ${explainFor('map', rep)}</h2><div class="card-desc">${cm ? `面积是 HEAD 中的文件数，颜色是窗口内的修改次数。点任意一块，进入代码地图并定位到那里` : '这份报告来自旧版本，缩略图会在后台重新分析完成后出现；代码地图分区现在就能用'}</div></div><div class="card-tools">${cm ? C.heatLegend() : ''}${seeAll('map', '打开代码地图')}</div></div>
      ${cm ? `<div id="codemap" class="codemap"><div class="skeleton" style="height:300px"></div></div><div class="tm-foot">${cm.blocks.some((b) => b.risk) ? '<span class="key"><span class="ring" aria-hidden="true"></span>含高风险文件</span>' : ''}${cm.blocks.some((b) => b.kind === 'other') ? '<span class="key"><i class="hatch" aria-hidden="true"></i>合并在一起的小项</span>' : ''}<span class="mono">${fmt(cm.totals.files)} 个文件 · 窗口内修改 ${fmt(cm.totals.churn)} 次 · ${fmt(cm.blocks.length)} 块</span></div>` : ''}
    </section>
    <section class="card span-7 anim-in" style="--i:5" aria-labelledby="h-risk5">
      <div class="card-head"><div><h2 id="h-risk5">高风险文件</h2><div class="card-desc">前 5 个，按热点排名</div></div>${seeAll('risk', `全部 ${rep.highRisk.length} 个`)}</div>
      ${rep.highRisk.length ? `<ol class="bar-list compact">${rep.highRisk.slice(0, 5).map((h, i) => `<li><span class="rank">${i + 1}</span>${pathHtml(h.path)}<span class="hint nowrap">${h.owner ? esc(h.owner.name) : '–'}</span><span class="n" data-tip="${esc(`修 bug ${h.bugCount} 次 / 共修改 ${h.hotCount} 次`)}"><span style="color:var(--mcode-danger)">${fmt(h.bugCount)}</span><span class="subtle">/${fmt(h.hotCount)}</span></span></li>`).join('')}</ol>` : `<p class="hint">${ICON.ok} 没有文件同时出现在两个榜单里。</p>`}
    </section>
    <section class="card span-5 anim-in" style="--i:6" aria-labelledby="h-ppl5">
      <div class="card-head"><div><h2 id="h-ppl5">主要贡献者</h2><div class="card-desc">非合并提交占比</div></div>${seeAll('people', `全部 ${fmt(rep.busFactor.total)} 人`)}</div>
      ${shareOfContributors(rep, 8)}
      <ol class="bar-list compact" style="margin-top:10px">${rep.contributors.slice(0, 5).map((c) => `<li style="grid-template-columns:22px minmax(0,1fr) 60px 50px"><span class="rank">${c.rank}</span><span class="who" style="min-width:0;gap:8px">${avatar(c.name)}${personLink(c.name)}</span><span class="n">${fmt(c.commits)}</span><span class="n hint">${pct(c.share)}</span></li>`).join('')}</ol>
    </section>
    <section class="card span-7 anim-in" style="--i:7" aria-labelledby="h-mo12">
      <div class="card-head"><div><h2 id="h-mo12">提交节奏 <span class="trend ${mo.trend}" style="font-size:13px;margin-left:6px">${TREND[mo.trend]}</span></h2><div class="card-desc">近 12 个月</div></div>${seeAll('momentum')}</div>
      ${momentumChart(rep, 12, 180)}
    </section>
    <section class="card span-5 anim-in" style="--i:8" aria-labelledby="h-tech5">
      <div class="card-head"><div><h2 id="h-tech5">技术栈</h2><div class="card-desc">${rep.tech ? '语言构成与主要框架' : '正在识别…'}</div></div>${rep.tech ? seeAll('tech') : ''}</div>
      ${rep.tech ? techSummary(rep.tech) : '<div class="skeleton" style="height:150px"></div>'}
    </section>
  </div>`;
}
function problemsHtml(rep) {
  const icon = { warn: ICON.alert, good: ICON.ok, info: ICON.info };
  const lvl = { warn: '提醒', good: '良好', info: '信息' };
  return `<ul class="insights" style="max-height:none">${rep.problems
    .map((p) => {
      const tab = TAB_OF_ANCHOR[p.anchor] || 'overview';
      const inner = `<span class="insight-icon" role="img" aria-label="${lvl[p.level]}">${icon[p.level]}</span><div style="min-width:0;flex:1"><div class="insight-title">${esc(p.title)}</div><div class="insight-detail">${esc(p.detail)}</div></div>${tab !== 'overview' ? `<span class="go" aria-hidden="true">${ICON.arrow}</span>` : ''}`;
      return `<li>${tab !== 'overview' ? `<a class="insight ${p.level} insight-link" href="${esc(href({ tab, filter: p.filter || null, file: null, person: null }))}" data-nav>${inner}</a>` : `<div class="insight ${p.level}">${inner}</div>`}</li>`;
    })
    .join('')}</ul>`;
}
function recHtml(rep) {
  const r = rep.recommendations;
  return `<ul class="rec-list">
    <li><span class="k">先读</span><span class="v">${r.startReading.length ? r.startReading.map((p) => `<span class="rec-row">${pathHtml(p)}${fileActions(p, { compact: true })}</span>`).join('') : '<span class="hint">暂无</span>'}</span></li>
    <li><span class="k">找谁聊</span><span class="v">${r.talkTo ? `<span style="display:flex;align-items:center;gap:8px">${avatar(r.talkTo.name)}${personLink(r.talkTo.name)}<span class="hint">${pct(r.talkTo.share)} 的修改</span></span><span class="hint">负责 ${pathHtml(r.talkTo.file)}</span>` : '<span class="hint">暂无</span>'}</span></li>
    <li><span class="k">注意</span><span class="v">${r.watchOut.length ? r.watchOut.map((w) => `<span class="tag warn" style="align-self:flex-start">${esc(w)}</span>`).join('') : '<span class="tag good" style="align-self:flex-start">没有明显的趋势风险</span>'}</span></li>
    <li><span class="k">继续</span><span class="v"><button type="button" class="btn btn-sm" data-action="to-chat" style="align-self:flex-start">${ICON.chat}<span>发到对话，让 Agent 读高风险文件…</span></button></span></li>
  </ul>`;
}
function fileActions(path, { compact = false, exists = true } = {}) {
  const web = exists ? webLink('file', path) : null;
  const ed = exists ? editorLink(path) : null;
  const cls = compact ? 'icon-btn btn-ghost btn-sm mini' : 'btn-sm';
  return `<span class="actions">
    <button type="button" class="btn ${cls}" data-action="copy" data-text="${esc(path)}" aria-label="复制路径" title="复制路径">${ICON.copy}${compact ? '' : '<span>复制路径</span>'}</button>
    ${web ? `<a class="btn ${cls}" href="${esc(web)}" target="_blank" rel="noopener" aria-label="在网页中查看" title="在网页中查看">${ICON.ext}${compact ? '' : '<span>网页</span>'}</a>` : ''}
    ${ed ? `<a class="btn ${cls}" href="${esc(ed)}" aria-label="在 VS Code 中打开" title="在 VS Code 中打开">${ICON.code}${compact ? '' : '<span>VS Code</span>'}</a>` : ''}
  </span>`;
}
function shareOfContributors(rep, n) {
  const total = rep.contributors[0] ? Math.round(rep.contributors[0].commits / rep.contributors[0].share) : 0;
  const top = rep.contributors.slice(0, n);
  return C.shareBar([...top.map((c) => ({ label: c.name, value: c.commits, color: C.memberColor(c.name) })), { label: '其他贡献者', value: Math.max(0, total - top.reduce((s, c) => s + c.commits, 0)), color: 'var(--k-other)' }], { height: 12, label: '提交占比' });
}
function techSummary(t) {
  const items = langItems(t);
  const groups = t.groups.filter((g) => !['语言与运行时', '工程实践', '代码质量'].includes(g.category)).slice(0, 4);
  return `${C.shareBar(items, { height: 12, label: '语言构成' })}
    <ul class="lang-list" style="margin-top:8px">${items.slice(0, 4).map((i) => `<li><span class="swatch" style="background:${i.color}"></span><span translate="no">${esc(i.label)}</span><span class="v">${pct(i.value / items.reduce((s, x) => s + x.value, 0))}</span></li>`).join('')}</ul>
    <dl class="tech-dl">${groups.map((g) => `<dt>${esc(g.category)}</dt><dd translate="no">${g.items.slice(0, 5).map((i) => esc(i.name)).join(' · ')}</dd>`).join('')}</dl>`;
}

// ---- risk tab -------------------------------------------------------------
function riskTab(rep) {
  const f = route.filter;
  let list = rep.highRisk;
  if (f === 'solo') list = list.filter((h) => h.exists && h.owner && h.owner.share >= 0.8);
  if (f === 'deleted') list = rep.hotspots.filter((h) => !h.exists).map((h) => rep.highRisk.find((x) => x.path === h.path) || { path: h.path, hotRank: h.rank, hotCount: h.count, exists: false, owners: [] });
  const soloN = rep.highRisk.filter((h) => h.exists && h.owner && h.owner.share >= 0.8).length;
  const deletedN = rep.hotspots.filter((h) => !h.exists).length;
  const chips = [
    [null, `全部 <span class="count">${rep.highRisk.length}</span>`],
    ['solo', `单人维护 <span class="count">${soloN}</span>`],
    ['deleted', `已删除的热点 <span class="count">${deletedN}</span>`],
  ];
  return `<section class="card anim-in" aria-labelledby="h-risk" style="margin-bottom:16px">
      <div class="card-head"><div><h2 id="h-risk">高风险文件 ${explainFor('risk', rep)}</h2><div class="card-desc">同时出现在代码热点和 bug 磁铁里的文件；负责人按全部历史中改动它的非合并提交计算${rep.identity === 'merged' ? '，不含机器人' : ''}</div></div>
        <div class="segmented" role="group" aria-label="筛选">${chips.map(([k, l]) => `<a href="${esc(href({ filter: k }))}" data-nav class="seg" aria-current="${route.filter === k ? 'true' : 'false'}">${l}</a>`).join('')}</div></div>
      ${riskTable(list, rep)}
    </section>
    <div class="grid">
      <section class="card span-6 anim-in" style="--i:1" aria-labelledby="h-hot"><div class="card-head"><div><h2 id="h-hot">代码热点</h2><div class="card-desc">窗口内被修改次数最多的文件，红底表示同时是 bug 磁铁</div></div></div>${barListHtml(rep.hotspots, rep, 'var(--k-code)')}</section>
      <section class="card span-6 anim-in" style="--i:2" aria-labelledby="h-bug"><div class="card-head"><div><h2 id="h-bug">Bug 磁铁</h2><div class="card-desc">提交说明含 fix / bug / broken 的提交最常改动的文件</div></div></div>${barListHtml(rep.bugMagnets, rep, 'var(--mcode-danger)')}</section>
      <section class="card span-12 anim-in" style="--i:3" aria-labelledby="h-new"><div class="card-head"><div><h2 id="h-new">新增文件</h2><div class="card-desc">窗口内新增 ${fmt(rep.recentlyAdded.total)} 个文件，按目录看哪里在长新代码</div></div></div>${dirBars(rep.recentlyAdded.dirs)}</section>
    </div>`;
}
function riskTable(list, rep) {
  if (!list.length) return route.filter ? '<p class="hint">没有符合筛选条件的文件。</p>' : `<div class="empty" style="padding:20px"><span>${ICON.ok}</span><h2>没有文件同时出现在两个榜单里</h2><p>No files appear in both lists — good sign.</p></div>`;
  const maxHot = Math.max(...list.map((h) => h.hotCount || 0), 1);
  return `<div class="table-wrap"><table class="board cb"><caption class="sr-only">高风险文件</caption><thead><tr>
    <th scope="col">文件</th><th scope="col" class="num">热点</th><th scope="col">修改次数</th><th scope="col" class="num">磁铁</th><th scope="col" class="num">修 bug</th><th scope="col">主要负责人</th><th scope="col">其他维护者</th><th scope="col"><span class="sr-only">操作</span></th></tr></thead><tbody>${list
    .map(
      (h) => `<tr>
      <td style="max-width:380px">${pathHtml(h.path)}${h.exists ? '' : ' <span class="tag">已删除</span>'}</td>
      <td class="num">#${h.hotRank}</td>
      <td><div class="bar-cell"><div class="bar-track"><span style="width:${((100 * (h.hotCount || 0)) / maxHot).toFixed(1)}%"></span></div><span class="num">${fmt(h.hotCount)}</span></div></td>
      <td class="num">${h.bugRank ? `#${h.bugRank}` : '–'}</td><td class="num">${h.bugCount != null ? `<span style="color:var(--mcode-danger)">${fmt(h.bugCount)}</span> <span class="subtle">${pct(h.bugCount / h.hotCount)}</span>` : '–'}</td>
      <td>${h.owner ? `<div class="who" style="min-width:0">${avatar(h.owner.name)}<div>${personLink(h.owner.name)}<div class="who-user">${pct(h.owner.share)} 的修改${h.owner.share >= 0.8 ? ' · <span style="color:var(--mcode-danger)">单人维护</span>' : ''}</div></div></div>` : '–'}</td>
      <td class="muted">${(h.owners || []).slice(1, 4).map((o) => `${esc(o.name)} ${pct(o.share)}`).join('、') || '–'}</td>
      <td>${fileActions(h.path, { compact: true, exists: h.exists })}</td></tr>`,
    )
    .join('')}</tbody></table></div>`;
}
function barListHtml(list, rep, color) {
  if (!list.length) return '<p class="hint">窗口内没有数据。</p>';
  const risk = new Set(rep.highRisk.map((h) => h.path));
  const max = list[0].count;
  return `<ol class="bar-list">${list.map((x) => `<li class="${risk.has(x.path) ? 'hl' : ''}"><span class="rank">${x.rank}</span>${pathHtml(x.path)}<div class="mini-bar"><span style="width:${((100 * x.count) / max).toFixed(1)}%;background:${color}"></span></div><span class="n">${fmt(x.count)}</span></li>`).join('')}</ol>`;
}
function dirBars(dirs) {
  if (!dirs.length) return '<p class="hint">窗口内没有新增文件。</p>';
  const max = dirs[0][1];
  return `<ol class="bar-list">${dirs.map(([d, n], i) => `<li><span class="rank">${i + 1}</span><span class="path" translate="no"><span class="base">${esc(d)}</span></span><div class="mini-bar"><span style="width:${((100 * n) / max).toFixed(1)}%;background:var(--k-merge)"></span></div><span class="n">${fmt(n)}</span></li>`).join('')}</ol>`;
}

// ---- people tab -----------------------------------------------------------
function peopleTab(rep) {
  const bf = rep.busFactor;
  return `<section class="card anim-in" aria-labelledby="h-people">
      <div class="card-head"><div><h2 id="h-people">贡献者排名 ${explainFor('half', rep)}</h2><div class="card-desc">按全部历史的非合并提交数排序，共 ${fmt(bf.total)} 人；近 3 个月活跃 ${bf.active3m} 人${explainFor('active', rep)}</div></div>
        <div class="toolbar">
          <div class="segmented" role="group" aria-label="身份口径">
            <button type="button" data-action="identity" data-v="merged" aria-pressed="${state.identity === 'merged'}" title="大小写不同的同名账号、同邮箱账号合并为一人；机器人单独列出">合并身份</button>
            <button type="button" data-action="identity" data-v="raw" aria-pressed="${state.identity === 'raw'}" title="与 git shortlog -sn --no-merges 完全一致">原始口径</button>
          </div>
          <label class="sr-only" for="contrib-filter">筛选贡献者</label><input id="contrib-filter" class="input search" type="search" name="contributor" autocomplete="off" placeholder="筛选贡献者…" value="${esc(state.contribFilter)}"></div></div>
      ${shareOfContributors(rep, 8)}
      <div class="table-wrap" id="contrib" style="margin-top:12px">${contribHtml(rep)}</div>
    </section>
    ${
      rep.identity === 'merged' && rep.bots.length
        ? `<section class="card anim-in" style="--i:1;margin-top:16px" aria-labelledby="h-bots"><div class="card-head"><div><h2 id="h-bots">机器人与令牌账号</h2><div class="card-desc">按名字和邮箱识别（如 <span class="mono">[bot]</span>、<span class="mono">project_*_bot</span>、agent 账号），不参与排名、活跃比例和负责人计算；切到“原始口径”可看 skill 的原始结果</div></div></div>
        <div class="chips">${rep.bots.map((b) => `<a class="tech-chip" href="${esc(href({ person: b.name, file: null }))}" data-nav translate="no">${esc(b.name)}<span class="c">${fmt(b.commits)}</span></a>`).join('')}</div></section>`
        : ''
    }`;
}
function contribHtml(rep) {
  const q = state.contribFilter.trim().toLowerCase();
  const matched = rep.contributors.filter((c) => !q || [c.name, ...(c.aliases || [])].some((n) => n.toLowerCase().includes(q)));
  const list = state.contribAll || q ? matched : matched.slice(0, 20);
  const max = rep.contributors[0]?.commits || 1;
  return `<table class="board cb"><caption class="sr-only">贡献者排名</caption><thead><tr>
    <th scope="col">#</th><th scope="col">贡献者</th><th scope="col">提交数</th><th scope="col" class="num">占比</th><th scope="col" class="num">窗口内</th><th scope="col" class="num">修 bug</th><th scope="col">近 12 个月</th><th scope="col">首次 → 最近</th><th scope="col">状态</th><th scope="col">主要目录</th></tr></thead><tbody>${
    list
      .map(
        (c) => `<tr><td class="rank">${c.rank}</td>
      <td><div class="who">${avatar(c.name)}<div style="min-width:0">${personLink(c.name)}${c.aliases?.length ? `<div class="who-user" translate="no">也作 ${esc(c.aliases.join('、'))}</div>` : ''}</div></div></td>
      <td><div class="bar-cell"><div class="bar-track"><span style="width:${((100 * c.commits) / max).toFixed(1)}%;background:${C.memberColor(c.name)}"></span></div><span class="num">${fmt(c.commits)}</span></div></td>
      <td class="num">${pct(c.share, 1)}</td><td class="num">${fmt(c.window)}</td><td class="num">${fmt(c.fixes)}</td>
      <td>${C.sparkline(c.monthly, { color: C.memberColor(c.name) })}</td>
      <td class="muted mono" style="font-size:12px">${c.first} → ${c.last}</td>
      <td>${c.active ? '<span class="status up">活跃</span>' : '<span class="status idle">近 3 月无提交</span>'}</td>
      <td class="muted" style="max-width:240px;overflow:hidden;text-overflow:ellipsis" title="${esc(c.dirs.map(([d, n]) => `${d} ${n}`).join('\n'))}" translate="no">${c.dirs.slice(0, 2).map(([d]) => `<span class="mono" style="font-size:12px">${esc(d)}</span>`).join('、')}</td></tr>`,
      )
      .join('') || `<tr><td colspan="10" class="hint">没有匹配的贡献者</td></tr>`
  }</tbody></table>${!q && matched.length > 20 ? `<div style="margin-top:10px"><button type="button" class="btn btn-sm" data-action="contrib-all">${state.contribAll ? '收起' : `展开全部 ${matched.length} 人`}</button></div>` : ''}`;
}

// ---- momentum tab ---------------------------------------------------------
function momentumChart(rep, last, height = 220) {
  const mo = rep.momentum;
  const months = last ? mo.months.slice(-last) : mo.months;
  const done = mo.months.filter((x) => x.m !== mo.partialMonth);
  const last3 = done.slice(-3);
  const prev3 = done.slice(-6, -3);
  const bands = [];
  if (prev3.length === 3) bands.push({ from: prev3[0].m, to: prev3[2].m, value: mo.prevAvg, label: `之前月均 ${fmt(Math.round(mo.prevAvg))}`, color: 'var(--k-other)' });
  if (last3.length) bands.push({ from: last3[0].m, to: last3[last3.length - 1].m, value: mo.lastAvg, label: `近 3 月 ${fmt(Math.round(mo.lastAvg))}`, color: mo.trend === 'declining' ? 'var(--mcode-danger)' : mo.trend === 'rising' ? 'var(--mcode-success)' : 'var(--k-review)' });
  return C.monthBars({ months, partial: mo.partialMonth, bands, height });
}
function calStats(a) {
  const days = [];
  for (let d = a.start; d <= a.end; d = C.addDays(d, 1)) days.push([d, a.daily[d] || 0]);
  let streak = 0;
  let best = 0;
  let bestEnd = null;
  let peak = [null, 0];
  let total = 0;
  let weekend = 0;
  for (const [d, n] of days) {
    total += n;
    if (n > peak[1]) peak = [d, n];
    const wd = C.parseYmd(d).getDay();
    if (wd === 0 || wd === 6) weekend += n;
    streak = n ? streak + 1 : 0;
    if (streak > best) {
      best = streak;
      bestEnd = d;
    }
  }
  return { active: days.filter(([, n]) => n).length, span: days.length, best, bestEnd, peak, total, weekend: total ? weekend / total : 0 };
}
function calendarCard(rep) {
  const a = rep.activity;
  if (!a) return '';
  const st = calStats(a);
  return `<section class="card anim-in" aria-labelledby="h-cal" style="margin-bottom:16px">
      <div class="card-head"><div><h2 id="h-cal">提交日历 ${explainFor('cal', rep)}</h2><div class="card-desc">近 365 天，共 ${fmt(st.total)} 个 commit；颜色越深当天提交越多</div></div>${C.heatLegend()}</div>
      <div class="cal-wrap">${C.calendar({ daily: a.daily, start: a.start, end: a.end, cell: 13, gap: 3, label: `提交日历：近 365 天有 ${st.active} 天有提交`, unit: '个 commit' })}</div>
      <div class="cal-stats">
        <div class="cal-stat"><div class="v">${st.active}<span class="hint" style="font-size:11px"> / ${st.span}</span></div><div class="k">有提交的天数</div></div>
        <div class="cal-stat"><div class="v">${st.best} 天</div><div class="k">最长连续${st.bestEnd ? `，止于 ${st.bestEnd.slice(5)}` : ''}</div></div>
        <div class="cal-stat"><div class="v">${fmt(st.peak[1])}</div><div class="k">单日最多${st.peak[0] ? `（${st.peak[0]}）` : ''}</div></div>
        <div class="cal-stat"><div class="v">${pct(st.weekend)}</div><div class="k">周末提交占比</div></div>
      </div>
    </section>`;
}
function momentumTab(rep) {
  const mo = rep.momentum;
  const ff = rep.firefighting;
  return `${calendarCard(rep)}<section class="card anim-in" style="--i:1;margin-bottom:16px" aria-labelledby="h-mo">
      <div class="card-head"><div><h2 id="h-mo">提交节奏 <span class="trend ${mo.trend}" style="font-size:13px;margin-left:6px">${TREND[mo.trend]}</span> ${explainFor('trend', rep)}</h2><div class="card-desc">每月提交数（含合并提交）。虚线是近 3 个月和之前 3 个月的月均${mo.partialMonth ? `；${mo.partialMonth} 尚未结束，浅色显示` : ''}</div></div>
        <div class="segmented" role="group" aria-label="时间范围"><button type="button" data-action="mo-range" data-all="0" aria-pressed="${!state.momentumAll}">近 24 个月</button><button type="button" data-action="mo-range" data-all="1" aria-pressed="${state.momentumAll}">全部</button></div></div>
      <div id="momentum">${momentumChart(rep, state.momentumAll ? 0 : 24)}</div>
    </section>
    <section class="card anim-in" style="--i:2" aria-labelledby="h-fire">
      <div class="card-head"><div><h2 id="h-fire">救火记录 ${explainFor('fire', rep)}</h2><div class="card-desc">窗口内 ${fmt(ff.count)} 次，占 ${pct(ff.rate, 1)}${ff.count > ff.list.length ? `，显示最近 ${ff.list.length} 条` : ''}</div></div>
        <div class="chips">${ff.kinds.map(([k, n]) => `<span class="tag warn">${esc(k)} ${fmt(n)}</span>`).join('')}</div></div>
      ${ff.list.length ? `<ul class="fire-list" style="max-height:none">${ff.list.map((c) => commitRow(c)).join('')}</ul>` : '<p class="hint">窗口内没有救火类提交。</p>'}
    </section>`;
}
function commitRow(c, extra = '') {
  const link = webLink('commit', c.sha);
  const subj = link ? `<a href="${esc(link)}" target="_blank" rel="noopener" title="${esc(c.subj)}">${esc(c.subj)}</a>` : `<span title="${esc(c.subj)}">${esc(c.subj)}</span>`;
  return `<li><span class="mono muted" style="font-size:12px">${esc(c.date)}</span><span class="s">${extra}${subj}</span><span class="hint nowrap"><button type="button" class="sha" data-action="copy" data-text="${esc(c.sha)}" title="复制完整 SHA" translate="no">${esc(c.sha.slice(0, 7))}</button>${c.author ? ` · <span translate="no">${esc(c.author)}</span>` : ''}</span></li>`;
}

// ---- tech tab -------------------------------------------------------------
function langItems(t) {
  const langs = t.languages.slice(0, 6);
  const rest = t.languages.slice(6).reduce((s, l) => s + l.files, 0);
  return [...langs.map((l, i) => ({ label: l.name, value: l.files, color: LANG_COLORS[i] })), ...(rest ? [{ label: '其他', value: rest, color: 'var(--heat-1)' }] : [])];
}
function techTab(rep) {
  const t = rep.tech;
  if (!t) return '<section class="card"><p class="hint"><span class="spinner" aria-hidden="true"></span> 正在识别技术栈…</p></section>';
  const items = langItems(t);
  const total = items.reduce((s, x) => s + x.value, 0) || 1;
  const pms = t.packageManagers.length ? `<div class="tech-group"><h3>包管理</h3><div class="chips">${t.packageManagers.map((p) => `<span class="tech-chip" translate="no">${esc(p.name)}</span>`).join('')}</div></div>` : '';
  const other = t.otherDeps.length ? `<div class="tech-group" style="grid-column:1/-1"><h3>其他常用依赖（未归类，按被多少个 manifest 引用排序）</h3><div class="chips">${t.otherDeps.map((d) => `<span class="tech-chip mono" style="font-size:12px" translate="no">${esc(d.name)}<span class="c">${d.n}</span></span>`).join('')}</div></div>` : '';
  return `<section class="card anim-in" aria-labelledby="h-tech">
    <div class="card-head"><div><h2 id="h-tech">技术栈</h2><div class="card-desc">语言按 HEAD 中的文件数统计；框架和工具来自 ${fmt(t.manifests.reduce((s, m) => s + m.n, 0))} 个 manifest 与配置文件，悬停或聚焦可看依据</div></div></div>
    ${items.length ? C.shareBar(items, { height: 14, label: '语言构成' }) : '<p class="hint">没有识别到代码文件。</p>'}
    <ul class="lang-list">${items.map((i) => `<li><span class="swatch" style="background:${i.color}"></span><span translate="no">${esc(i.label)}</span><span class="v">${fmt(i.value)} · ${pct(i.value / total)}</span></li>`).join('')}</ul>
    <div class="tech-grid" style="margin-top:16px">${t.groups
      .map((g) => `<div class="tech-group"><h3>${esc(g.category)}</h3><div class="chips">${g.items.slice(0, 14).map((i) => `<span class="tech-chip" tabindex="0" data-tip="${esc(i.evidence.join('\n'))}" translate="no">${esc(i.name)}${i.count > 1 ? `<span class="c">${i.count}</span>` : ''}</span>`).join('')}</div></div>`)
      .join('')}${pms}${other}</div>
    ${t.packages > 1 ? `<p class="hint" style="margin:10px 0 0">共识别到 ${t.packages} 个 package.json。</p>` : ''}
  </section>`;
}

// ---------------------------------------------------------------------------
// Code map tab
// ---------------------------------------------------------------------------
const LENSES = [
  ['heat', '热度', '所选时间范围内，这块里的文件一共被修改了多少次（与“代码热点”同一口径）。'],
  ['bug', 'Bug 占比', '这些修改里，提交说明含 fix / bug / broken 的比例（与“Bug 磁铁”同一口径）。修改少于 5 次的块不着色。'],
  ['owner', '负责人', '所选时间范围内在这块提交最多的人（非合并提交，不含机器人）。颜色越淡越是多人共有，第一名不到 25% 的标为“多人共有”。'],
  ['age', '最近修改', '这块里最近一次提交距离仓库最新提交多久，看哪里还在演进、哪里已经稳定。不受时间范围影响。'],
  ['loss', '知识流失', '这块全部历史提交中，来自近 3 个月没有任何提交的人的比例。比例高的地方，最熟悉它的人可能已经不在了。不受时间范围影响。'],
  ['type', '文件类型', '按 HEAD 中的扩展名归类：颜色是占比最多的一类，块底部的细条是构成。没有说明的目录，可以靠它判断是代码、文档还是资源。'],
];
const PLAYABLE = new Set(['heat', 'bug', 'owner']);
const RANGES = [['3', '近 3 个月'], ['6', '近 6 个月'], ['12', '近 12 个月'], ['all', '全部历史']];
const TYPE_META = {
  ts: ['TypeScript', 'hsl(210 65% 52%)'],
  js: ['JavaScript', 'hsl(45 85% 50%)'],
  py: ['Python', 'hsl(168 55% 40%)'],
  go: ['Go', 'hsl(190 70% 46%)'],
  rs: ['Rust', 'hsl(18 62% 46%)'],
  jvm: ['Java / Kotlin', 'hsl(32 50% 50%)'],
  c: ['C / C++', 'hsl(222 45% 58%)'],
  swift: ['Swift', 'hsl(8 80% 58%)'],
  rb: ['Ruby', 'hsl(352 62% 52%)'],
  php: ['PHP', 'hsl(200 38% 40%)'],
  dotnet: ['.NET', 'hsl(140 45% 42%)'],
  style: ['样式', 'hsl(340 65% 62%)'],
  markup: ['HTML / 模板', 'hsl(26 85% 58%)'],
  shell: ['脚本', 'hsl(95 40% 44%)'],
  doc: ['文档', 'hsl(205 18% 58%)'],
  config: ['配置 / 数据', 'hsl(48 24% 52%)'],
  asset: ['图片 / 字体 / 二进制', 'hsl(0 0% 50%)'],
  other: ['其他', 'hsl(0 0% 36%)'],
};
const OWNER_COLORS = ['#2f9e8f', '#f08a4b', '#3b8fd9', '#e5b72f', '#5bb85b', '#e5576f', '#22b8cf', '#b8875a'];
const AGE_LABELS = ['1 周内', '1 个月内', '3 个月内', '1 年内', '更早'];
const LOSS_LABELS = ['<20%', '20–40%', '40–60%', '60–80%', '≥80%'];
const NEUTRAL = 'var(--mcode-surface-muted)';
const DAY_S = 86_400;

const mp = { key: null, rep: null, place: null, max: 0, w: 0, view: null, error: null, loading: false, layout: null, frame: null, playing: false, timer: null, autoplay: false, sort: { key: 'size', dir: -1 } };
const defaultRange = (rep) => ({ 'all time': 'all', '1 year ago': '12', '6 months ago': '6' })[rep?.vitals?.window] || '12';
function mapOpts(rep = state.report) {
  return {
    focus: route.focus || '',
    sel: route.sel || null,
    lens: LENSES.some(([k]) => k === route.lens) ? route.lens : 'heat',
    size: route.size === 'churn' ? 'churn' : 'files',
    range: RANGES.some(([k]) => k === route.range) ? route.range : defaultRange(rep),
  };
}
function rememberMapPlace() {
  const r = current();
  if (r && route.tab === 'map') state.mapPlace[r.id] = { focus: route.focus || null, sel: route.sel || null, lens: route.lens || null, size: route.size || null, range: route.range || null };
}
const mapPlaceFor = (id) => ({ focus: null, sel: null, lens: null, size: null, range: null, ...state.mapPlace[id] });
const mapHeight = (w) => Math.round(Math.max(340, Math.min(620, w * 0.62)));
const maxBlocksFor = (w, h) => Math.max(10, Math.min(44, Math.round((w * h) / 6500)));
const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const rangeText = (v) => (v.range === 'custom' ? '分析窗口内' : { 3: '近 3 个月', 6: '近 6 个月', 12: '近 12 个月', all: '全部历史上' }[v.range] || '');
const ymdOfSec = (sec) => C.ymd(new Date(sec * 1000));
function agoText(days) {
  if (days < 1) return '当天';
  if (days < 30) return `${Math.round(days)} 天前`;
  if (days < 365) return `${Math.max(1, Math.round(days / 30))} 个月前`;
  return `${(days / 365).toFixed(1)} 年前`;
}
function quantiles(values) {
  const s = values.filter((x) => x > 0).sort((a, b) => a - b);
  const at = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : 0);
  return [at(0.3), at(0.6), at(0.85)];
}
const levelOf = (q, n) => (!n ? 0 : n <= q[0] ? 1 : n <= q[1] ? 2 : n <= q[2] ? 3 : 4);
function webTree(path) {
  const w = state.report?.web;
  if (!w) return null;
  const sep = w.provider === 'github' ? '' : '/-';
  return `${w.url}${sep}/tree/${state.report.head}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

// ---- colour helpers: pick dark or light label ink from the actual fill ----
function rgbOf(c) {
  if (colorCache.has(c)) return colorCache.get(c);
  let s = String(c).trim();
  const v = s.match(/^var\((--[\w-]+)\)$/);
  if (v) s = getComputedStyle(document.documentElement).getPropertyValue(v[1]).trim();
  let rgb = [128, 128, 128];
  let x;
  if ((x = s.match(/^#([0-9a-f]{3,8})$/i))) {
    let h = x[1];
    if (h.length <= 4) h = [...h.slice(0, 3)].map((ch) => ch + ch).join('');
    rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  } else if ((x = s.match(/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/i))) {
    const [h, sat, l] = [+x[1], +x[2] / 100, +x[3] / 100];
    const k = (n) => (n + h / 30) % 12;
    const a = sat * Math.min(l, 1 - l);
    rgb = [0, 8, 4].map((n) => Math.round((l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))) * 255));
  } else if ((x = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i))) rgb = [+x[1], +x[2], +x[3]];
  colorCache.set(c, rgb);
  return rgb;
}
function inkFor(fill, opacity = 1) {
  let rgb = rgbOf(fill);
  if (opacity < 1) {
    const bg = rgbOf('var(--mcode-surface)');
    rgb = rgb.map((v, i) => v * opacity + bg[i] * (1 - opacity));
  }
  const t = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * t(rgb[0]) + 0.7152 * t(rgb[1]) + 0.0722 * t(rgb[2]) > 0.36 ? 'dark' : 'light';
}

// ---- names ----------------------------------------------------------------
function blockTitle(v, b) {
  if (b.kind === 'dir') return `${b.path}/`;
  if (b.kind === 'other') return `${b.path ? `${b.path}/` : ''}${b.name}`;
  return b.path;
}
function blockLabels(focus, b) {
  if (b.kind === 'other') {
    const n = b.name.match(/\d+/)?.[0] || '';
    return [b.name, `${n} 项`, `+${n}`];
  }
  if (b.kind === 'file') return [b.name, b.name.replace(/\.[^.]+$/, '')];
  const rel = b.group && b.path.startsWith(`${b.group}/`) ? b.path.slice(b.group.length + 1) : focus && b.path.startsWith(`${focus}/`) ? b.path.slice(focus.length + 1) : b.path;
  return C.dirLabels(rel);
}
const groupLabel = (focus, k) => (k === '' ? (focus ? '本层' : '根目录') : `${focus && k.startsWith(`${focus}/`) ? k.slice(focus.length + 1) : k}/`);
// Selection key in the URL: the path, except merged blocks ("其他 N 项"), whose path is their parent's
// (possibly the root, ''), so they get "<parent>/*".
const selKey = (b) => (b.kind === 'other' ? `${b.path ? `${b.path}/` : ''}*` : b.path);
const within = (p, q) => q === p || q.startsWith(`${p}/`); // q is p or inside it
function selIndex(v, sel) {
  if (!v || !sel) return -1;
  const i = v.blocks.findIndex((b) => selKey(b) === sel);
  if (i >= 0) return i;
  // A path inside a block (coming back up a level, or a file picked on the overview): select its block.
  const j = v.blocks.findIndex((b) => b.kind === 'dir' && sel.startsWith(`${b.path}/`));
  if (j >= 0) return j;
  // The path is split into several blocks on this level (typically the directory just left with
  // Backspace): no single block stands for it, so select none rather than a neighbour.
  if (v.blocks.some((b) => b.path && within(sel, b.path))) return -1;
  // Otherwise it was folded into a merged block: the deepest one whose level holds it, provided the
  // child on the way to it has no blocks of its own there.
  let best = -1;
  v.blocks.forEach((b, k) => {
    if (b.kind !== 'other' || (b.path && !sel.startsWith(`${b.path}/`))) return;
    const child = b.path ? `${b.path}/${sel.slice(b.path.length + 1).split('/')[0]}` : sel.split('/')[0];
    if (v.blocks.some((o) => o.path && within(child, o.path))) return;
    if (best < 0 || b.path.length > v.blocks[best].path.length) best = k;
  });
  return best;
}

// ---- tab chrome -------------------------------------------------------------
function crumbsHtml(focus) {
  const r = current();
  const segs = focus ? focus.split('/') : [];
  const items = [['', r ? r.name.split('/').pop() : '根目录'], ...segs.map((s, i) => [segs.slice(0, i + 1).join('/'), s])];
  return items
    .map(([p, label], i) =>
      i === items.length - 1
        ? `<span class="crumb cur" aria-current="location" translate="no">${esc(label)}</span>`
        : `<a class="crumb" href="${esc(href({ focus: p || null, sel: null }))}" data-nav translate="no">${esc(label)}</a>`,
    )
    .join('<span class="crumb-sep" aria-hidden="true">/</span>');
}
const segBtns = (action, items, cur, label) => `<div class="segmented" role="group" aria-label="${label}">${items.map(([k, l]) => `<button type="button" data-action="${action}" data-v="${k}" aria-pressed="${cur === k}">${l}</button>`).join('')}</div>`;
function mapTab(rep) {
  const o = mapOpts(rep);
  return `<section class="map-tab" aria-labelledby="h-maptab">
    <div class="map-head">
      <div class="map-title"><h2 id="h-maptab">代码地图 ${explainFor('mapview', rep)}</h2><nav class="crumbs" aria-label="当前位置">${crumbsHtml(o.focus)}</nav></div>
      <div class="map-ctl">${segBtns('map-size', [['files', '按文件数'], ['churn', '按修改次数']], o.size, '面积代表')}${segBtns('map-range', [['3', '3 个月'], ['6', '6 个月'], ['12', '12 个月'], ['all', '全部']], o.range, '时间范围')}</div>
    </div>
    <div class="lens-bar" role="group" aria-label="着色">${LENSES.map(([k, l]) => `<button type="button" class="lens lens-${k}" data-action="map-lens" data-v="${k}" aria-pressed="${o.lens === k}"><i aria-hidden="true"></i>${l}</button>`).join('')}</div>
    <div class="map-layout">
      <div class="card map-main">
        <div id="map-legend" class="map-legend"></div>
        <div id="map-canvas" class="map-canvas"><div class="skeleton" style="height:360px"></div></div>
        <div id="map-time" class="map-time"></div>
        <p id="map-note" class="map-note hint"></p>
      </div>
      <aside id="map-detail" class="card map-detail" aria-label="区域详情"><div class="skeleton" style="height:240px"></div></aside>
    </div>
    <section class="card map-table-card" aria-labelledby="h-maplist">
      <div class="card-head"><div><h2 id="h-maplist">区域列表</h2><div class="card-desc">与地图同一批区域，可排序；点击区域名在地图上选中</div></div></div>
      <div id="map-table" class="table-wrap"></div>
    </section>
  </section>`;
}
function syncMapControls() {
  const o = mapOpts();
  for (const [action, cur] of [['map-size', o.size], ['map-range', o.range], ['map-lens', o.lens]]) {
    for (const b of document.querySelectorAll(`[data-action="${action}"]`)) b.setAttribute('aria-pressed', String(b.dataset.v === cur));
  }
  // The explain popover's command embeds the time range.
  const h = $('#h-maptab');
  if (h && state.report && !h.querySelector('[aria-expanded="true"]')) h.innerHTML = `代码地图 ${explainFor('mapview', state.report)}`;
}
// Links rendered with the map's settings in their URL (the current tab, breadcrumbs) would bring
// back old settings after an in-place change, so rebuild them from the current route.
function syncMapLinks() {
  const tab = main.querySelector('.tabs-bar a[aria-current="page"]');
  if (tab) tab.setAttribute('href', href({ tab: 'map', filter: null, file: null, person: null }));
  const crumbs = $('nav.crumbs');
  if (crumbs) crumbs.innerHTML = crumbsHtml(route.focus);
}

// ---- data -------------------------------------------------------------------
let mapRO = null;
function observeMap(box) {
  if (mapRO?._box === box) return;
  mapRO?.disconnect();
  mapRO = new ResizeObserver(() =>
    requestAnimationFrame(() => {
      if (box.isConnected && Math.abs(Math.round(box.clientWidth) - mp.w) >= 24) mountMap();
    }),
  );
  mapRO._box = box;
  mapRO.observe(box);
}
function prepareView(v) {
  v.qHeat = quantiles(v.blocks.map((b) => b.churn));
  v.qHeatM = quantiles(v.blocks.flatMap((b) => b.m));
  const score = new Map();
  for (const b of v.blocks) {
    if (b.owners[0]) score.set(b.owners[0][0], (score.get(b.owners[0][0]) || 0) + 4);
    for (const a of b.mo) if (a >= 0) score.set(a, (score.get(a) || 0) + 1);
  }
  v.palette = new Map([...score].sort((a, b) => b[1] - a[1]).slice(0, OWNER_COLORS.length).map(([a], i) => [a, OWNER_COLORS[i]]));
}
async function mountMap() {
  const box = $('#map-canvas');
  const r = current();
  const rep = state.report;
  if (!box || !r || !rep) return;
  observeMap(box);
  const o = mapOpts(rep);
  const w = Math.round(box.clientWidth);
  const h = mapHeight(w);
  box.style.height = `${h}px`;
  const max = maxBlocksFor(w, h);
  const key = [r.id, state.identity, rep.head, rep.generatedAt, o.focus, o.size, o.range].join('|');
  const place = [r.id, state.identity, o.focus].join('|');
  // A reloaded report object (e.g. directory descriptions filled in by the tech stage after the
  // history report was published) always refetches, even when head and generatedAt are unchanged.
  if (mp.key === key && mp.rep === rep && Math.abs(max - mp.max) < 6 && (mp.view || mp.error || mp.loading)) return drawMap();
  if (mp.key !== key) {
    stopPlay();
    mp.frame = null;
  }
  // Same place, new numbers (area, range, canvas size): keep the old map on screen until the new one lands.
  const keep = Boolean(mp.view && mp.place === place && box.querySelector('svg'));
  mp.key = key;
  mp.rep = rep;
  mp.max = max;
  mp.error = null;
  mp.loading = true;
  if (!keep) mp.view = null;
  drawMap();
  let v = null;
  let err = null;
  try {
    const q = new URLSearchParams({ focus: o.focus, size: o.size, range: o.range, identity: state.identity, max: String(max) });
    v = await api(`/api/repos/${encodeURIComponent(r.id)}/map?${q}`);
  } catch (e) {
    err = e;
  }
  if (mp.key !== key || mp.max !== max || mp.rep !== rep) return;
  mp.loading = false;
  if (v) {
    prepareView(v);
    mp.view = v;
    mp.place = place;
  } else {
    mp.view = null;
    mp.error = err;
  }
  drawMap();
  if (mp.autoplay && v) startPlay();
  mp.autoplay = false;
}

// ---- drawing ----------------------------------------------------------------
function drawMap() {
  const box = $('#map-canvas');
  if (!box) return;
  const v = mp.view;
  mp.w = Math.round(box.clientWidth);
  const busy = mp.loading && Boolean(v);
  box.closest('.map-main')?.classList.toggle('is-loading', busy);
  box.setAttribute('aria-busy', String(mp.loading));
  if (mp.error) {
    mp.refocus = false;
    box.innerHTML = `<div class="empty map-empty"><span>${ICON.alert}</span><h2>代码地图加载失败</h2><p>${esc(mp.error.message)}</p><p class="actions">${route.focus ? `<a class="btn btn-sm" href="${esc(href({ focus: null, sel: null }))}" data-nav>回到根目录</a>` : ''}<button type="button" class="btn btn-sm" data-action="map-retry">${ICON.sync}<span>重试</span></button></p></div>`;
    for (const id of ['#map-legend', '#map-time', '#map-note', '#map-table']) if ($(id)) $(id).innerHTML = '';
    $('#map-detail').innerHTML = '<p class="hint">没有可显示的区域。</p>';
    return;
  }
  if (!v) {
    box.innerHTML = '<div class="skeleton" style="height:100%"></div>';
    return;
  }
  mp.layout = null;
  if (!v.blocks.length) {
    box.innerHTML = `<div class="empty map-empty"><span>${ICON.map}</span><h2>${v.size === 'churn' ? `${rangeText(v)}这里没有修改` : '这里没有文件'}</h2><p>${v.size === 'churn' ? '面积按修改次数时，没有修改的区域不会出现。可以切换到“按文件数”或更长的时间范围。' : ''}</p></div>`;
  } else {
    mp.layout = C.mapLayout(v.blocks, { width: mp.w, height: mapHeight(mp.w), value: (b) => (v.size === 'churn' ? b.churn : b.files) });
    mp.cellOf = new Map(mp.layout.cells.map((c) => [c.i, c]));
    box.innerHTML = C.mapSvg(mp.layout, { blocks: v.blocks, groupLabel: (k) => groupLabel(v.focus, k), groupValue: (n) => `${C.fmtK(n)} ${v.size === 'churn' ? '次' : '个文件'}`, nameOf: (b) => blockLabels(v.focus, b), label: `代码地图：${v.focus ? `${v.focus}/` : '仓库根目录'}，${v.blocks.length} 个区域。方向键在区域间移动，空格或单击选中，回车或双击进入` });
  }
  paintMap();
  renderMapLegend();
  renderMapTime();
  renderMapDetail();
  renderMapTable();
  renderMapNote();
  // After drilling in or out from the map, keep the keyboard on the map.
  if (mp.refocus && !mp.loading) {
    mp.refocus = false;
    box.querySelector('.tm-cell[tabindex="0"]')?.focus({ preventScroll: true });
  }
}
function lensPaint(v, b, lens, f) {
  const range = f == null ? rangeText(v) : `${v.months[f]} `;
  const none = (val, tip) => ({ fill: NEUTRAL, ink: inkFor(NEUTRAL), val, tip: [tip], aria: tip });
  switch (lens) {
    case 'bug': {
      const n = f == null ? b.churn : b.m[f];
      const k = f == null ? b.bug : b.mb[f];
      if (n < (f == null ? 5 : 3)) return none(n ? '样本少' : '无修改', `${range}修改 ${fmt(n)} 次，太少，不计算占比`);
      const ratio = k / n;
      const fill = `var(--risk-${C.riskLevel(ratio)})`;
      return { fill, ink: inkFor(fill), val: pct(ratio), tip: [`${range}修改 ${fmt(n)} 次，其中修 bug ${fmt(k)} 次（${pct(ratio)}）`], aria: `修 bug 占 ${pct(ratio)}` };
    }
    case 'owner': {
      if (f != null) {
        const a = b.mo[f];
        if (a < 0) return none('无人修改', `${range}没有人修改`);
        const fill = v.palette.get(a) || 'var(--k-other)';
        return { fill, opacity: 0.92, ink: inkFor(fill, 0.92), val: v.authors[a], tip: [`${range}提交最多：${v.authors[a]}`], aria: `本月提交最多 ${v.authors[a]}` };
      }
      const top = b.owners[0];
      if (!top) return none('无人修改', `${range}没有人修改`);
      const share = top[1] / b.ownerSum;
      const list = b.owners.slice(0, 3).map(([a, n]) => `${v.authors[a]} ${pct(n / b.ownerSum)}`).join('、');
      if (share < 0.25) return { ...none('多人共有', `${range}共 ${fmt(b.ownerSum)} 次提交，没有人超过 25%：${list}`), aria: '多人共有' };
      const fill = v.palette.get(top[0]) || 'var(--k-other)';
      const opacity = Math.min(1, 0.4 + share);
      return { fill, opacity, ink: inkFor(fill, opacity), val: `${v.authors[top[0]]} ${pct(share)}`, tip: [`${range}的提交：${list}`], aria: `主要负责人 ${v.authors[top[0]]}，占 ${pct(share)}` };
    }
    case 'age': {
      if (!b.last) return none('无记录', '历史里没有这块的提交');
      const days = Math.max(0, (v.latest - b.last) / DAY_S);
      const fill = `var(--age-${days <= 7 ? 0 : days <= 30 ? 1 : days <= 90 ? 2 : days <= 365 ? 3 : 4})`;
      return { fill, ink: inkFor(fill), val: agoText(days), tip: [`最近一次修改：${ymdOfSec(b.last)}（相对仓库最新提交 ${agoText(days)}）`], aria: `最近一次修改在 ${agoText(days)}` };
    }
    case 'loss': {
      if (b.loss == null) return none('无记录', '没有可统计的提交');
      const fill = `var(--loss-${b.loss < 0.2 ? 0 : b.loss < 0.4 ? 1 : b.loss < 0.6 ? 2 : b.loss < 0.8 ? 3 : 4})`;
      const who = b.lossTop.map((a) => v.authors[a]).join('、');
      return { fill, ink: inkFor(fill), val: pct(b.loss), tip: [`${pct(b.loss)} 的历史提交来自近 3 个月没有提交的人${who ? `（主要是 ${who}）` : ''}`], aria: `知识流失 ${pct(b.loss)}` };
    }
    case 'type': {
      const t = b.types[0];
      if (!t) return none('—', '没有文件');
      const [label, fill] = TYPE_META[t[0]] || TYPE_META.other;
      const total = b.types.reduce((s, x) => s + x[1], 0);
      return { fill, ink: inkFor(fill), val: `${label} ${pct(t[1] / total)}`, tip: [`构成：${b.types.slice(0, 4).map(([k, n]) => `${(TYPE_META[k] || TYPE_META.other)[0]} ${pct(n / total)}`).join('、')}`], aria: `主要是 ${label}` };
    }
    default: {
      const n = f == null ? b.churn : b.m[f];
      const fill = `var(--heat-${levelOf(f == null ? v.qHeat : v.qHeatM, n)})`;
      const avg = f == null && n && b.files > 1 ? `，平均每个文件 ${(n / b.files).toFixed(1)} 次` : '';
      return { fill, ink: inkFor(fill), val: n ? `${C.fmtK(n)} 次` : '无修改', tip: [`${range}修改 ${fmt(n)} 次${avg}`], aria: n ? `修改 ${n} 次` : '没有修改' };
    }
  }
}
function paintMap() {
  const v = mp.view;
  const svg = $('#map-canvas svg');
  if (!v || !svg) return;
  const o = mapOpts();
  const f = PLAYABLE.has(o.lens) ? mp.frame : null;
  const selIdx = selIndex(v, o.sel);
  const partners = new Map();
  if (selIdx >= 0) for (const c of v.blocks[selIdx].couple) if (c.block >= 0) partners.set(c.block, c);
  for (const g of svg.querySelectorAll('.tm-cell')) {
    const i = Number(g.dataset.i);
    const b = v.blocks[i];
    const L = lensPaint(v, b, o.lens, f);
    const rect = g.querySelector('.tm-r');
    rect.style.fill = L.fill;
    rect.style.fillOpacity = L.opacity == null ? '' : String(L.opacity);
    g.classList.toggle('ink-light', L.ink === 'light');
    g.classList.toggle('sel', i === selIdx);
    g.classList.toggle('partner', partners.has(i));
    g.classList.toggle('dim', selIdx >= 0 && partners.size > 0 && i !== selIdx && !partners.has(i));
    if (i === selIdx) g.setAttribute('aria-current', 'true');
    else g.removeAttribute('aria-current');
    const val = g.querySelector('.tm-val');
    if (val) val.textContent = C.fitLabel([L.val], Number(val.dataset.w) || 0, 10);
    const mix = g.querySelector('.tm-mix');
    const cell = mp.cellOf?.get(i);
    if (mix) mix.innerHTML = o.lens === 'type' && cell && cell.w > 24 && cell.h > 18 ? typeStrip(b, cell) : '';
    const p = partners.get(i);
    const head = [blockTitle(v, b), b.kind === 'file' ? '' : `${fmt(b.files)} 个文件`, b.desc ? b.desc.text.slice(0, 60) + (b.desc.text.length > 60 ? '…' : '') : '', b.risk ? `含 ${b.risk} 个高风险文件` : ''].filter(Boolean);
    g.dataset.tip = [...head, ...L.tip, p ? `改选中区域的提交里 ${pct(p.degree)} 也改了这里（${p.shared} 次）` : '', b.kind === 'file' ? '双击或回车：查看文件历史' : b.zoom ? '双击或回车：进入这块' : ''].filter(Boolean).join('\n');
    g.setAttribute('aria-label', `${blockTitle(v, b)}，${b.kind === 'file' ? '' : `${b.files} 个文件，`}${L.aria}${b.risk ? `，含 ${b.risk} 个高风险文件` : ''}`);
  }
  drawLines(svg, v, selIdx);
  // Tab lands on the selected tile unless the keyboard is already inside the map; with a selection
  // that is split on this level (see selIndex), on its largest piece, so Backspace keeps your place.
  const land = selIdx >= 0 ? selIdx : o.sel ? v.blocks.findIndex((b) => b.path && within(o.sel, b.path)) : -1;
  if (land >= 0 && !svg.contains(document.activeElement)) setRoving(svg, svg.querySelector(`.tm-cell[data-i="${land}"]`));
}
function typeStrip(b, c) {
  const total = b.types.reduce((s, x) => s + x[1], 0) || 1;
  let x = c.x + 1;
  const w = c.w - 2;
  return b.types
    .slice(0, 5)
    .map(([k, n]) => {
      const ww = (w * n) / total;
      const r = `<rect x="${x.toFixed(1)}" y="${(c.y + c.h - 4).toFixed(1)}" width="${Math.max(0, ww - 0.5).toFixed(1)}" height="3" style="fill:${(TYPE_META[k] || TYPE_META.other)[1]}"/>`;
      x += ww;
      return r;
    })
    .join('');
}
function drawLines(svg, v, selIdx) {
  const layer = svg.querySelector('.tm-lines');
  if (!layer) return;
  const a = selIdx >= 0 ? mp.cellOf?.get(selIdx) : null;
  if (!a) {
    layer.innerHTML = '';
    return;
  }
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  let out = '';
  for (const c of v.blocks[selIdx].couple.slice(0, 6)) {
    const b = c.block >= 0 ? mp.cellOf.get(c.block) : null;
    if (!b) continue;
    const bx = b.x + b.w / 2;
    const by = b.y + b.h / 2;
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const bend = Math.min(60, len * 0.18);
    const cx = (ax + bx) / 2 - ((by - ay) / len) * bend;
    const cy = (ay + by) / 2 + ((bx - ax) / len) * bend;
    out += `<path class="cp-line${c.kind === 'test' ? ' cp-test' : ''}" d="M${ax.toFixed(1)},${ay.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)}" style="stroke-width:${(1.2 + c.degree * 3.2).toFixed(1)}"/><circle class="cp-end" cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="3.5"/><text class="cp-pct" x="${bx.toFixed(1)}" y="${(by - 8).toFixed(1)}" text-anchor="middle">${Math.round(c.degree * 100)}%</text>`;
  }
  layer.innerHTML = `${out}<circle class="cp-src" cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="4.5"/>`;
}

// ---- keyboard: one Tab stop per map, arrow keys move between tiles ------------
function setRoving(svg, cell) {
  if (!svg || !cell) return;
  for (const g of svg.querySelectorAll('.tm-cell[tabindex="0"]')) if (g !== cell) g.setAttribute('tabindex', '-1');
  cell.setAttribute('tabindex', '0');
}
function cellBox(g) {
  const r = g.querySelector('.tm-r');
  const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((k) => Number(r.getAttribute(k)));
  return { x, y, w, h };
}
/** Nearest tile in the arrow's direction: tiles sharing an edge span first, then the closest one. */
function moveCellFocus(cell, key) {
  const svg = cell.closest('svg');
  const cells = [...svg.querySelectorAll('.tm-cell')];
  let next = key === 'Home' ? cells[0] : key === 'End' ? cells.at(-1) : null;
  if (!next) {
    const a = cellBox(cell);
    const horiz = key === 'ArrowLeft' || key === 'ArrowRight';
    const fwd = key === 'ArrowRight' || key === 'ArrowDown';
    let best = Infinity;
    for (const g of cells) {
      if (g === cell) continue;
      const b = cellBox(g);
      const gap = horiz ? (fwd ? b.x - (a.x + a.w) : a.x - (b.x + b.w)) : fwd ? b.y - (a.y + a.h) : a.y - (b.y + b.h);
      if (gap < -2) continue;
      const overlap = horiz ? Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) : Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const cross = horiz ? Math.abs(b.y + b.h / 2 - (a.y + a.h / 2)) : Math.abs(b.x + b.w / 2 - (a.x + a.w / 2));
      const score = (overlap > 0 ? 0 : 1e6 - overlap * 10) + Math.max(0, gap) * 10 + cross;
      if (score < best) {
        best = score;
        next = g;
      }
    }
  }
  if (!next) return;
  setRoving(svg, next);
  next.focus();
}
document.addEventListener('focusin', (e) => {
  const g = e.target.closest?.('.tm-cell');
  if (g) setRoving(g.closest('svg'), g);
});

// ---- legend, timeline, note --------------------------------------------------
function renderMapLegend() {
  const el = $('#map-legend');
  const v = mp.view;
  if (!el) return;
  if (!v) return void (el.innerHTML = '');
  const o = mapOpts();
  const f = PLAYABLE.has(o.lens) ? mp.frame : null;
  const key = (fill, label) => `<span class="lg-key"><i style="background:${fill}"></i>${label}</span>`;
  let keys = '';
  if (o.lens === 'heat') {
    const q = f == null ? v.qHeat : v.qHeatM;
    keys = `<span class="lg-ramp">${f == null ? '少' : '当月少'} ${[0, 1, 2, 3, 4].map((l) => `<i style="background:var(--heat-${l})"></i>`).join('')} 多</span>${q[2] ? `<span class="hint mono">≤${q[0]} / ≤${q[1]} / ≤${q[2]} / &gt;${q[2]} 次</span>` : ''}`;
  } else if (o.lens === 'bug') keys = C.riskLegend() + key(NEUTRAL, '修改太少');
  else if (o.lens === 'owner') keys = [...v.palette].map(([a, c]) => key(c, `<span translate="no">${esc(v.authors[a])}</span>`)).join('') + key('var(--k-other)', '其他人') + key(NEUTRAL, '多人共有 / 无人修改');
  else if (o.lens === 'age') keys = AGE_LABELS.map((l, i) => key(`var(--age-${i})`, l)).join('');
  else if (o.lens === 'loss') keys = LOSS_LABELS.map((l, i) => key(`var(--loss-${i})`, l)).join('');
  else {
    const present = new Map();
    for (const b of v.blocks) for (const [k, n] of b.types) present.set(k, (present.get(k) || 0) + n);
    keys = [...present].sort((a, b) => b[1] - a[1]).slice(0, 9).map(([k]) => key((TYPE_META[k] || TYPE_META.other)[1], (TYPE_META[k] || TYPE_META.other)[0])).join('');
  }
  const extra = `${v.blocks.some((b) => b.risk) ? '<span class="lg-key"><span class="ring" aria-hidden="true"></span>含高风险文件</span>' : ''}${v.blocks.some((b) => b.kind === 'other') ? '<span class="lg-key"><i class="hatch"></i>合并的小目录</span>' : ''}`;
  el.innerHTML = `<p class="lg-desc">${esc(LENSES.find(([k]) => k === o.lens)[2])}</p><div class="lg-keys" aria-hidden="true">${keys}${extra}</div>`;
}
function renderMapTime() {
  const el = $('#map-time');
  const v = mp.view;
  if (!el) return;
  if (!v || !v.blocks.length) return void (el.innerHTML = '');
  const o = mapOpts();
  const can = PLAYABLE.has(o.lens) && v.months.length > 1;
  const tot = v.focusInfo.m;
  const max = Math.max(1, ...tot);
  const part = tot.map((_, i) => Boolean(frameSpan(v, i)));
  const hint = !PLAYABLE.has(o.lens) ? '逐月播放适用于热度、Bug 占比、负责人三种着色' : v.size === 'churn' ? '播放时会改为按文件数排布，让布局保持不动' : `${v.months.length} 个月，结构不动、颜色逐月变化`;
  el.innerHTML = `<button type="button" class="btn btn-sm play-btn" data-action="map-play" aria-pressed="false" ${can ? '' : 'disabled'}></button>
    <div class="mt-track"><div class="mt-bars" aria-hidden="true">${tot.map((n, i) => `<i${part[i] ? ' class="part"' : ''} style="height:${Math.max(6, (100 * n) / max).toFixed(0)}%"></i>`).join('')}</div>
      <input type="range" id="map-month" min="0" max="${Math.max(0, v.months.length - 1)}" step="1" aria-label="逐月查看：月份" ${can ? '' : 'disabled'}></div>
    <div class="mt-label" aria-live="off"><b class="mono" id="mt-month"></b><span class="hint" id="mt-sub"></span></div>
    <button type="button" class="btn btn-sm btn-ghost" data-action="map-frame-clear" id="mt-clear">回到汇总</button>
    <span class="hint mt-hint">${hint}${part.some(Boolean) ? ' · 虚线框的柱子是不完整的月份' : ''}</span>`;
  syncMapTime();
}
// The first frame usually starts mid-month (the range is counted back from today, or the history
// begins mid-month) and the last one is still running, so their lower bars are not a slowdown; name
// the days they actually cover.
function frameSpan(v, f) {
  const parts = [];
  const start = v.start ?? v.since;
  if (f === 0 && start != null) {
    const s = ymdOfSec(start);
    if (s.slice(0, 7) === v.months[0] && !s.endsWith('-01')) parts.push(`${s.slice(5)} 起`);
  }
  if (f === v.months.length - 1 && v.latest) {
    const d = new Date(v.latest * 1000);
    if (d.getDate() < new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()) parts.push(`截至 ${ymdOfSec(v.latest).slice(5)}`);
  }
  return parts.join('，');
}
function syncMapTime() {
  const v = mp.view;
  const btn = $('#map-time .play-btn');
  if (!v || !btn) return;
  const o = mapOpts();
  const f = PLAYABLE.has(o.lens) ? mp.frame : null;
  const M = v.months.length;
  btn.innerHTML = `${mp.playing ? ICON.pause : ICON.play}<span>${mp.playing ? '暂停' : f != null && f < M - 1 ? '继续播放' : '逐月播放'}</span>`;
  btn.setAttribute('aria-pressed', String(mp.playing));
  const input = $('#map-month');
  const span = f == null ? '' : frameSpan(v, f);
  input.value = String(f ?? M - 1);
  input.setAttribute('aria-valuetext', f == null ? `${rangeText(v)}汇总` : `${v.months[f]}${span ? `（${span}）` : ''}`);
  $('#mt-month').textContent = f == null ? `${v.months[0]} → ${v.months[M - 1]}` : v.months[f];
  $('#mt-sub').textContent = f == null ? `${rangeText(v)}汇总 · ${fmt(v.totals.churn)} 次修改` : `${span ? `${span} · ` : '当月 '}${fmt(v.focusInfo.m[f])} 次修改`;
  $('#mt-clear').hidden = f == null;
  $('#map-time').classList.toggle('framed', f != null);
  [...$('#map-time .mt-bars').children].forEach((bar, i) => bar.classList.toggle('on', i === f));
}
function renderMapNote() {
  const el = $('#map-note');
  const v = mp.view;
  if (!el || !v) return;
  const parts = [`${v.size === 'churn' ? `面积：${rangeText(v)}的修改次数` : '面积：HEAD 中的文件数'} · ${v.blocks.length} 个区域`];
  if (v.totals.delChurn) parts.push(`另有 ${fmt(v.totals.delChurn)} 次修改落在已删除、且所在目录也不在了的路径上，没有画进图里`);
  if (v.process.length) parts.push(`流程文件 <span class="mono">${v.process.map(esc).join('、')}</span> 几乎随每次修改一起改，不参与连线`);
  parts.push('单击选中 · 双击或回车进入 · Backspace 返回上一层 · 方向键移动');
  el.innerHTML = parts.join(' · ');
}

// ---- playback ---------------------------------------------------------------
function startPlay() {
  const v = mp.view;
  if (!v || v.months.length < 2) return;
  if (!PLAYABLE.has(mapOpts().lens)) setLens('heat');
  if (mapOpts().size === 'churn') {
    // Playback keeps the structure still: lay out by files, then play.
    mp.autoplay = true;
    return go({ size: null }, { replace: true });
  }
  if (mp.frame == null || mp.frame >= v.months.length - 1) mp.frame = 0;
  mp.playing = true;
  const M = v.months.length;
  clearInterval(mp.timer);
  paintMap();
  renderMapLegend();
  syncMapTime();
  syncDetailFrame();
  mp.timer = setInterval(
    () => {
      if (!$('#map-canvas svg') || !mp.view) return stopPlay();
      if (mp.frame >= mp.view.months.length - 1) return stopPlay();
      mp.frame++;
      paintMap();
      syncMapTime();
      syncDetailFrame();
    },
    M > 60 ? 220 : M > 24 ? 380 : 650,
  );
}
function stopPlay() {
  clearInterval(mp.timer);
  mp.timer = null;
  if (!mp.playing) return;
  mp.playing = false;
  syncMapTime();
}
function setFrame(f) {
  stopPlay();
  const was = mp.frame;
  mp.frame = f;
  paintMap();
  if ((was == null) !== (f == null)) renderMapLegend();
  syncMapTime();
  syncDetailFrame();
}

// ---- selection, lens -----------------------------------------------------------
function setSel(path) {
  if ((route.sel || null) === (path || null)) return;
  route = { ...route, sel: path || null };
  history.replaceState(history.state, '', href({}));
  rememberMapPlace();
  paintMap();
  renderMapDetail();
  markTableSel();
}
function setLens(k) {
  if (mapOpts().lens === k) return;
  route = { ...route, lens: k === 'heat' ? null : k };
  history.replaceState(history.state, '', href({}));
  rememberMapPlace();
  if (!PLAYABLE.has(k)) {
    stopPlay();
    mp.frame = null;
  }
  syncMapControls();
  paintMap();
  renderMapLegend();
  renderMapTime();
  renderMapDetail();
}
function zoomOrOpen(i) {
  const b = mp.view?.blocks[i];
  if (!b) return;
  if (b.kind === 'file') return go({ file: b.path, person: null });
  if (b.zoom) {
    mp.refocus = true;
    return go({ focus: b.zoom, sel: null });
  }
  setSel(selKey(b));
}

// ---- details -------------------------------------------------------------------
function inferDesc(b) {
  const total = b.types.reduce((s, x) => s + x[1], 0);
  if (!total) return '';
  const [k1, n1] = b.types[0];
  const second = b.types[1] && b.types[1][1] / total >= 0.15 ? `，其次是${(TYPE_META[b.types[1][0]] || TYPE_META.other)[0]}（${pct(b.types[1][1] / total)}）` : '';
  return `主要是${(TYPE_META[k1] || TYPE_META.other)[0]}（${pct(n1 / total)}）${second}。<span class="md-src">仓库里没有找到这块的说明</span>`;
}
function summaryOf(v, b, isFocus) {
  const range = rangeText(v);
  const parts = [];
  if (b.churn) {
    const share = !isFocus && v.totals.churn ? b.churn / v.totals.churn : null;
    parts.push(`${range}修改 ${fmt(b.churn)} 次${share != null ? `，占${v.focus ? '这一层' : '全仓'}的 ${pct(share)}` : ''}`);
    if (b.churn >= 5) parts.push(`其中 ${pct(b.bug / b.churn)} 是修 bug`);
  } else parts.push(`${range}没有修改`);
  if (b.owners.length) parts.push(`主要由 ${b.owners.slice(0, 2).map(([a, n]) => `${v.authors[a]}（${pct(n / b.ownerSum)}）`).join('、')} 维护`);
  if (b.last) {
    const days = (v.latest - b.last) / DAY_S;
    parts.push(days <= 30 ? `${agoText(days)}还有人改` : `最近一次修改在 ${ymdOfSec(b.last)}`);
  }
  if (b.loss != null && b.loss >= 0.4) parts.push(`${pct(b.loss)} 的历史提交来自近 3 个月不再提交的人`);
  return `${parts.join('；')}。`;
}
/** Split two titles at their shared directory prefix: ('a/b/test/', 'a/b/src/') → ['a/b/', 'test/', 'src/']. */
function splitCommon(a, b) {
  const A = a.split('/');
  const Bs = b.split('/');
  let k = 0;
  while (k < A.length - 1 && k < Bs.length - 1 && A[k] === Bs[k]) k++;
  const pre = A.slice(0, k).join('/');
  return [pre ? `${pre}/` : '', A.slice(k).join('/'), Bs.slice(k).join('/')];
}
function coItem(v, c, base) {
  const t = c.block >= 0 ? v.blocks[c.block] : null;
  const name = t ? blockTitle(v, t) : `${c.path}${c.target === 'dir' ? '/' : ''}`;
  const [pre, , short] = splitCommon(base, name);
  const attrs = `translate="no" title="${esc(name)}" aria-label="${esc(name)}"`;
  const link = t
    ? `<button type="button" class="link-btn co-name" data-action="map-select" data-i="${c.block}" ${attrs}>${esc(short)}</button>`
    : `<a class="link-btn co-name" href="${esc(c.target === 'file' ? href({ file: c.path, person: null }) : href({ focus: c.path, sel: null }))}" data-nav ${attrs}>${esc(short)}</a>`;
  return `<li><span class="co-pct mono">${Math.round(c.degree * 100)}%</span><span class="co-pair">${link}${pre ? `<span class="co-ctx mono" aria-hidden="true">${esc(pre)}</span>` : ''}</span><span class="co-meta hint">${fmt(c.shared)} 次${t ? '' : ' · 视图外'}${c.kind === 'test' ? ' · 测试同步' : ''}</span><span class="co-bar" aria-hidden="true"><span style="width:${(c.degree * 100).toFixed(0)}%"></span></span></li>`;
}
function pairItem(v, p) {
  const a = blockTitle(v, v.blocks[p.from]);
  const b = blockTitle(v, v.blocks[p.to]);
  const [pre, sa, sb] = splitCommon(a, b);
  const btn = (i, full, short) => `<button type="button" class="link-btn co-name" data-action="map-select" data-i="${i}" translate="no" title="${esc(full)}" aria-label="${esc(full)}">${esc(short)}</button>`;
  return `<li class="pair"><span class="co-pct mono">${Math.round(p.degree * 100)}%</span><span class="co-pair"><span class="co-names">${btn(p.from, a, sa)}<span class="arrow" aria-label="也改了">→</span>${btn(p.to, b, sb)}</span>${pre ? `<span class="co-ctx mono" aria-hidden="true">${esc(pre)}</span>` : ''}</span><span class="co-meta hint">${fmt(p.shared)} 次${p.kind === 'test' ? ' · 测试同步' : ''}</span><span class="co-bar" aria-hidden="true"><span style="width:${(p.degree * 100).toFixed(0)}%"></span></span></li>`;
}
function syncDetailFrame() {
  const el = $('#md-frame');
  const v = mp.view;
  if (!el || !v) return;
  const o = mapOpts();
  const f = PLAYABLE.has(o.lens) ? mp.frame : null;
  const i = selIndex(v, o.sel);
  const b = i >= 0 ? v.blocks[i] : v.focusInfo;
  el.hidden = f == null;
  if (f == null) return;
  const owner = b.mo[f] >= 0 ? `，提交最多的是 ${v.authors[b.mo[f]]}` : '';
  el.textContent = `${v.months[f]}：修改 ${fmt(b.m[f])} 次，修 bug ${fmt(b.mb[f])} 次${owner}`;
}
function renderMapDetail() {
  const el = $('#map-detail');
  const v = mp.view;
  if (!el) return;
  if (!v) {
    if (!mp.error) el.innerHTML = '<div class="skeleton" style="height:240px"></div>';
    return;
  }
  const r = current();
  const o = mapOpts();
  const i = selIndex(v, o.sel);
  const isFocus = i < 0;
  const b = isFocus ? v.focusInfo : v.blocks[i];
  const range = rangeText(v);
  const path = isFocus ? v.focus : b.path;
  const title = isFocus ? (v.focus ? `${v.focus}/` : r.name) : blockTitle(v, b);
  const kicker = isFocus ? (v.focus ? '当前目录' : '整个仓库') : { dir: '目录', file: '文件', other: '合并的小项' }[b.kind];
  const icon = b.kind === 'file' ? ICON.file : ICON.map;
  const desc = b.desc ? `${esc(b.desc.text)} <span class="md-src">— ${esc(b.desc.source)}</span>` : b.kind === 'file' ? '' : inferDesc(b);
  const stat = (k, val, sub = '') => `<div class="md-stat"><div class="v">${val}</div><div class="k">${k}${sub}</div></div>`;
  const days = b.last ? (v.latest - b.last) / DAY_S : null;
  // Within the map one person is one colour: avatar and bar use the owner lens palette.
  const owners = b.owners.length
    ? `<ul class="md-owners">${b.owners.map(([a, n]) => `<li><span class="who" style="min-width:0;gap:8px">${avatar(v.authors[a], '', v.palette.get(a) || 'var(--k-other)')}${personLink(v.authors[a])}</span><span class="mini-bar"><span style="width:${((100 * n) / b.owners[0][1]).toFixed(0)}%;background:${v.palette.get(a) || 'var(--k-other)'}"></span></span><span class="n mono">${fmt(n)} · ${pct(n / b.ownerSum)}</span></li>`).join('')}</ul>`
    : `<p class="hint">${range}没有人修改。</p>`;
  const lossNote = b.loss != null && b.loss >= 0.3 && b.lossTop.length ? `<p class="hint md-loss">知识流失 ${pct(b.loss)}：${b.lossTop.map((a) => `<span translate="no">${esc(v.authors[a])}</span>`).join('、')} 写过这里的大量提交，但近 3 个月没有任何提交。</p>` : '';
  const tops = b.top.length
    ? `<ol class="md-top">${b.top.map(([p, n, k, ex], j) => `<li><span class="rank">${j + 1}</span>${pathHtml(p)}${ex ? '' : '<span class="tag">已删除</span>'}<span class="n mono" title="修 bug ${k} 次">${fmt(n)}${k ? `<span class="bugc"> · ${pct(k / n)}</span>` : ''}</span></li>`).join('')}</ol>`
    : `<p class="hint">${range}没有修改。</p>`;
  let co;
  if (isFocus && !b.couple.length && v.pairs.length) {
    co = `<p class="hint md-co-head">这一层里最强的关系（改左边的提交里，有多少也改了右边）：</p><ul class="co-list">${v.pairs
      .slice(0, 6)
      .map((p) => pairItem(v, p))
      .join('')}</ul>`;
  } else if (b.couple.length) co = `<p class="hint md-co-head">改${isFocus ? '这一层' : '它'}的 ${fmt(b.revs)} 个提交里（不含超过 ${v.couple.maxChangeset} 个文件的大提交）：</p><ul class="co-list">${b.couple.map((c) => coItem(v, c, title)).join('')}</ul>`;
  else co = `<p class="hint">${b.revs < v.couple.minRevs ? `${range}只有 ${fmt(b.revs)} 个相关提交，还看不出稳定的关系。` : `没有达到门槛的关系（至少一起改过 ${v.couple.minShared} 次、占比 ≥${pct(v.couple.minDegree)}）。`}</p>`;
  const proc = b.processWith.length ? `<p class="hint">另外 ${b.processWith.map((p) => `<span class="mono">${esc(p.path)}</span>`).join('、')} 几乎随每次修改一起改（流程文件），没有列出。</p>` : '';
  const items = b.kind === 'other' && b.items?.length ? `<section class="md-sec"><h4>包含的 ${b.items.length} 项</h4><ul class="md-items">${b.items.map(([p, k, n]) => `<li>${k === 'dir' ? `<a class="link-btn" href="${esc(href({ focus: p, sel: null }))}" data-nav translate="no">${esc(p.split('/').pop())}/</a>` : `<a class="link-btn" href="${esc(href({ file: p, person: null }))}" data-nav translate="no">${esc(p.split('/').pop())}</a>`}<span class="hint mono">${k === 'dir' ? `${fmt(n)} 个文件` : '文件'}</span></li>`).join('')}</ul></section>` : '';
  const acts = [];
  if (!isFocus && b.zoom) acts.push(`<a class="btn btn-sm btn-primary" href="${esc(href({ focus: b.zoom, sel: null }))}" data-nav>${ICON.arrow}<span>进入这块</span></a>`);
  if (!isFocus && b.kind === 'file') acts.push(`<a class="btn btn-sm btn-primary" href="${esc(href({ file: b.path, person: null }))}" data-nav>${ICON.file}<span>查看文件历史</span></a>`);
  if (isFocus && v.focus) acts.push(`<a class="btn btn-sm" href="${esc(href({ focus: parentOf(v.focus) || null, sel: v.focus }))}" data-nav>${ICON.up}<span>返回上一层</span></a>`);
  if (b.kind !== 'other') acts.push(`<button type="button" class="btn btn-sm" data-action="map-agent">${ICON.chat}<span>让 Agent 讲解${isFocus && !v.focus ? '这个仓库' : '这块'}…</span></button>`);
  if (path) acts.push(`<button type="button" class="btn btn-sm btn-ghost" data-action="copy" data-text="${esc(path)}">${ICON.copy}<span>复制路径</span></button>`);
  const web = path ? (b.kind === 'file' ? webLink('file', path) : webTree(path)) : null;
  if (web) acts.push(`<a class="btn btn-sm btn-ghost" href="${esc(web)}" target="_blank" rel="noopener">${ICON.ext}<span>网页</span></a>`);
  if (b.kind === 'file' && editorLink(path)) acts.push(`<a class="btn btn-sm btn-ghost" href="${esc(editorLink(path))}">${ICON.code}<span>VS Code</span></a>`);
  el.innerHTML = `<div class="md-head"><span class="md-icon" aria-hidden="true">${icon}</span><div class="md-titles"><div class="md-kicker">${kicker}${b.test ? ' · 测试' : ''}${b.process ? ' · 流程文件' : ''}</div><h3 class="md-title" translate="no">${esc(title)}</h3></div>${isFocus ? '' : `<button type="button" class="btn icon-btn btn-ghost btn-sm" data-action="map-sel-clear" aria-label="取消选择，查看${v.focus ? '当前目录' : '整个仓库'}">${ICON.close}</button>`}</div>
    ${desc ? `<p class="md-desc">${desc}</p>` : ''}
    <p class="md-summary">${esc(summaryOf(v, b, isFocus))}</p>
    <p class="md-frame mono" id="md-frame" hidden></p>
    <div class="md-stats">${stat('文件', fmt(b.files))}${stat('修改', fmt(b.churn), `<br>${range.replace(/上$/, '')}`)}${stat('修 bug', b.churn >= 5 ? pct(b.bug / b.churn) : '–')}${stat('最近修改', days == null ? '–' : agoText(days))}</div>
    ${items}
    <section class="md-sec"><h4>负责人 <span class="hint">${range}，按提交数</span></h4>${owners}${lossNote}</section>
    <section class="md-sec"><h4>最常改的文件 <span class="hint">${range}</span></h4>${tops}</section>
    <section class="md-sec"><h4>常和${isFocus ? '这一层' : '它'}一起改 ${explainFor('couple', state.report)}</h4>${co}${proc}</section>
    <div class="md-actions">${acts.join('')}</div>`;
  syncDetailFrame();
}

// ---- table --------------------------------------------------------------------
function renderMapTable() {
  const el = $('#map-table');
  const v = mp.view;
  if (!el) return;
  if (!v || !v.blocks.length) return void (el.innerHTML = v ? '<p class="hint">没有区域。</p>' : '');
  const cols = [
    ['name', '区域'],
    ['size', v.size === 'churn' ? '修改' : '文件'],
    ['churn', v.size === 'churn' ? '文件' : '修改'],
    ['bug', '修 bug'],
    ['owner', '负责人'],
    ['last', '最近修改'],
    ['loss', '知识流失'],
    ['type', '主要类型'],
  ];
  const val = {
    name: (b) => blockTitle(v, b),
    size: (b) => (v.size === 'churn' ? b.churn : b.files),
    churn: (b) => (v.size === 'churn' ? b.files : b.churn),
    bug: (b) => (b.churn >= 5 ? b.bug / b.churn : -1),
    owner: (b) => (b.owners[0] ? v.authors[b.owners[0][0]] : ''),
    last: (b) => b.last || 0,
    loss: (b) => b.loss ?? -1,
    type: (b) => (b.types[0] ? (TYPE_META[b.types[0][0]] || TYPE_META.other)[0] : ''),
  };
  const { key, dir } = mp.sort;
  const rows = v.blocks.map((b, i) => [b, i]).sort(([a], [b]) => {
    const x = val[key](a);
    const y = val[key](b);
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir;
  });
  const sel = selIndex(v, mapOpts().sel);
  el.innerHTML = `<table class="board map-list"><caption class="sr-only">代码地图的区域列表</caption><thead><tr>${cols.map(([k, l]) => `<th scope="col"${k === key ? ` aria-sort="${dir > 0 ? 'ascending' : 'descending'}"` : ''}${['size', 'churn', 'bug', 'last', 'loss'].includes(k) ? ' class="num"' : ''}><button type="button" data-action="map-sort" data-k="${k}">${l}${k === key ? (dir > 0 ? ' ↑' : ' ↓') : ''}</button></th>`).join('')}</tr></thead><tbody>${rows
    .map(([b, i]) => {
      const own = b.owners[0];
      return `<tr data-i="${i}"${i === sel ? ' class="is-sel" aria-current="true"' : ''}><th scope="row"><button type="button" class="link-btn" data-action="map-select" data-i="${i}" translate="no"><span class="path"><span class="base">${esc(blockTitle(v, b))}</span></span></button>${b.risk ? ` <span class="tag danger">高风险 ${b.risk}</span>` : ''}${b.desc ? `<div class="ml-desc hint" title="${esc(b.desc.text)}">${esc(b.desc.text)}</div>` : ''}</th>
        <td class="num">${fmt(val.size(b))}</td><td class="num">${fmt(val.churn(b))}</td><td class="num">${b.churn >= 5 ? pct(b.bug / b.churn) : '–'}</td>
        <td translate="no">${own ? `${esc(v.authors[own[0]])} <span class="subtle">${pct(own[1] / b.ownerSum)}</span>` : '–'}</td>
        <td class="num mono">${b.last ? agoText((v.latest - b.last) / DAY_S) : '–'}</td><td class="num">${b.loss == null ? '–' : pct(b.loss)}</td><td>${val.type(b) || '–'}</td></tr>`;
    })
    .join('')}</tbody></table>`;
}
function markTableSel() {
  const sel = selIndex(mp.view, mapOpts().sel);
  for (const tr of document.querySelectorAll('#map-table tbody tr')) {
    const on = Number(tr.dataset.i) === sel;
    tr.classList.toggle('is-sel', on);
    if (on) tr.setAttribute('aria-current', 'true');
    else tr.removeAttribute('aria-current');
  }
}

// ---- agent ----------------------------------------------------------------------
function mapAgentPrompt() {
  const v = mp.view;
  const r = current();
  const rep = state.report;
  const i = selIndex(v, mapOpts().sel);
  const isFocus = i < 0;
  const b = isFocus ? v.focusInfo : v.blocks[i];
  const path = isFocus ? v.focus : b.path;
  const title = isFocus ? (v.focus ? `${v.focus}/` : '整个仓库') : blockTitle(v, b);
  const web = path ? (b.kind === 'file' ? webLink('file', path) : webTree(path)) : r.webUrl;
  const where = r.kind === 'local' ? `本地路径：${r.localDir}${path ? `/${path}` : ''}` : `网页：${web || r.webUrl}（若本地没有 checkout，请先 clone ${r.webUrl}）`;
  const range = rangeText(v);
  const owners = b.owners.slice(0, 3).map(([a, n]) => `${v.authors[a]}（${pct(n / b.ownerSum)}）`).join('、') || '无';
  const top = b.top.slice(0, 5).map(([p, n]) => `${p}（${n} 次）`).join('、') || '无';
  const co = b.couple.slice(0, 5).map((c) => `${c.path}（改这里的提交里 ${pct(c.degree)} 也改了它）`).join('、') || '无';
  return [
    `请帮我讲解仓库 ${r.display} 里的 \`${title}\`${b.kind === 'file' ? '' : `（${fmt(b.files)} 个文件）`}是做什么的。`,
    where,
    '',
    `仓库透视的数据（${range}，HEAD ${rep.head.slice(0, 12)}）：`,
    `- 修改 ${fmt(b.churn)} 次，其中修 bug ${b.churn ? pct(b.bug / b.churn) : '0%'}；最近一次修改 ${b.last ? ymdOfSec(b.last) : '–'}`,
    `- 主要负责人：${owners}`,
    `- 最常改的文件：${top}`,
    `- 常一起改：${co}`,
    ...(b.desc ? [`- 仓库自带的说明（${b.desc.source}）：${b.desc.text}`] : []),
    '',
    b.kind === 'file'
      ? '请阅读这个文件，说明它负责什么、对外提供什么、被谁调用，以及为什么常和上面那些文件一起改。只读分析，不要修改代码。'
      : '请先读这个目录的 README（如果有）和入口文件，说明：它负责什么、由哪几个主要部分组成、对外提供什么接口，以及和上面那些“常一起改”的区域是什么关系。只读分析，不要修改代码。',
  ].join('\n');
}

// ---- overview thumbnail ----------------------------------------------------------
// Reports from before ALGO 7 carry an older codemap shape; only the lite view (with totals) is drawn.
const liteMap = (rep) => (rep?.codemap?.totals && Array.isArray(rep.codemap.blocks) ? rep.codemap : null);
let thumbRO = null;
function mountThumb(rep) {
  thumbRO?.disconnect();
  const box = $('#codemap');
  const cm = liteMap(rep);
  if (!box || !cm?.blocks.length) return;
  const q = quantiles(cm.blocks.map((b) => b.churn));
  let lastW = 0;
  const draw = () => {
    const w = Math.round(box.clientWidth);
    if (!w || Math.abs(w - lastW) < 24) return;
    lastW = w;
    const layout = C.mapLayout(cm.blocks, { width: w, height: Math.round(Math.max(240, Math.min(380, w * 0.36))), value: (b) => b.files });
    box.innerHTML = C.mapSvg(layout, { blocks: cm.blocks, groupLabel: (k) => groupLabel('', k), groupValue: (n) => `${C.fmtK(n)} 个文件`, nameOf: (b) => blockLabels('', b), action: 'thumb-open', label: '代码地图缩略图：点任意一块，在代码地图里打开' });
    for (const g of box.querySelectorAll('.tm-cell')) {
      const b = cm.blocks[g.dataset.i];
      const fill = `var(--heat-${levelOf(q, b.churn)})`;
      g.querySelector('.tm-r').style.fill = fill;
      g.classList.toggle('ink-light', inkFor(fill) === 'light');
      const val = g.querySelector('.tm-val');
      if (val) val.textContent = C.fitLabel([`${C.fmtK(b.files)} 个文件`], Number(val.dataset.w) || 0, 10);
      g.dataset.tip = `${blockTitle({}, b)}\n${fmt(b.files)} 个文件 · 窗口内修改 ${fmt(b.churn)} 次${b.risk ? `\n含 ${b.risk} 个高风险文件` : ''}\n点击：在代码地图中打开`;
      g.setAttribute('aria-label', `${blockTitle({}, b)}，${b.files} 个文件，窗口内修改 ${b.churn} 次，打开代码地图`);
    }
  };
  draw();
  thumbRO = new ResizeObserver(() => requestAnimationFrame(draw));
  thumbRO.observe(box);
}
function openThumb(i) {
  const b = liteMap(state.report)?.blocks[i];
  if (!b) return;
  // A folder opens as the new level; a file or a merged block opens its parent with it selected.
  const at = b.kind === 'dir' ? { focus: b.path, sel: null } : b.kind === 'other' ? (b.zoom ? { focus: b.zoom, sel: null } : { focus: null, sel: selKey(b) }) : { focus: parentOf(b.path) || null, sel: b.path };
  go({ tab: 'map', ...at, lens: null, size: null, range: null, file: null, person: null, filter: null });
}

// ---------------------------------------------------------------------------
// Progress (deployment-log style)
// ---------------------------------------------------------------------------
const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
const pg = { key: null, timer: null, stage: null, f: 0 };
function stopProgress() {
  clearInterval(pg.timer);
  pg.timer = null;
  pg.key = null;
  pg.stage = null;
}
function renderProgress() {
  const el = $('#progress');
  const r = current();
  if (!el || !r) return stopProgress();
  const j = r.job;
  main.classList.toggle('scanning', Boolean(j?.running && state.report && state.reportKey?.startsWith(`${r.id}:`)));
  if (!j?.running) {
    stopProgress();
    const showErr = j && j.stage === 'error' && Date.now() - (j.finishedAt || 0) < 60_000 && state.report;
    el.className = '';
    el.innerHTML = showErr ? `<div class="alert" role="alert">${esc(j.error?.message || '分析失败')}，下面显示的是上一次的结果。</div>` : '';
    return;
  }
  const key = `${r.id}:${j.startedAt}`;
  if (pg.key !== key || !el.querySelector('#pg-body')) {
    pg.key = key;
    el.className = 'progress-log term';
    el.innerHTML = `<div class="term-bar"><i aria-hidden="true"></i><i aria-hidden="true"></i><i aria-hidden="true"></i><span class="t" translate="no">xray ${esc(r.kind === 'local' ? r.display : r.name)}</span><span class="r"><span class="mono" id="pg-total" aria-hidden="true"></span><button type="button" class="btn btn-sm btn-ghost" data-action="cancel">取消</button></span></div><div class="term-body" id="pg-body" aria-hidden="true"></div>`;
  }
  if (pg.stage !== j.stage) {
    pg.stage = j.stage;
    const sr = $('#pg-sr');
    if (sr) sr.textContent = j.stage === 'queued' ? '排队等待分析' : `正在${STAGE[j.stage] || '分析'}`;
  }
  drawProgress();
  if (!pg.timer) pg.timer = setInterval(drawProgress, reducedMotion() ? 1000 : 90);
}
function drawProgress() {
  const r = current();
  const j = r?.job;
  const body = $('#pg-body');
  if (!j?.running || !body) return stopProgress();
  pg.f++;
  const order = r.kind === 'local' ? ['analyze', 'tech'] : ['sync', 'analyze', 'tech'];
  const done = new Map((j.steps || []).map((x) => [x.stage, x.ms]));
  const spin = reducedMotion() ? '›' : SPIN[pg.f % SPIN.length];
  body.innerHTML =
    (j.stage === 'queued' ? `<div class="ln cur"><span class="braille">${spin}</span><span>等待空闲的网络通道…</span><span class="ms">${secs(Date.now() - j.startedAt)}</span></div>` : '') +
    order
      .map((st) => {
        const ms = done.get(st);
        const isCur = j.stage === st;
        const icon = ms != null ? '<span class="ok">✓</span>' : isCur ? `<span class="braille">${spin}</span>` : '<span>·</span>';
        const time = ms != null ? secs(ms) : isCur ? secs(Date.now() - (j.stageStartedAt || Date.now())) : '';
        let detail = '';
        if (isCur && st === 'sync' && j.detail) detail = ` <span class="detail">${esc(j.detail)}</span><span class="bar"><span style="width:${j.pct || 0}%"></span></span><span class="detail">${j.pct || 0}%</span>`;
        else if (isCur && j.detail) detail = ` <span class="detail">· ${esc(j.detail)}</span>`;
        if (st === 'tech' && isCur && j.reportHead) detail += ' <span class="detail">· 报告已可查看</span>';
        return `<div class="ln ${ms != null ? 'done' : isCur ? 'cur' : ''}">${icon}<span>${STAGE[st]}${detail}${isCur ? '<span class="cursor"></span>' : ''}</span><span class="ms">${time}</span></div>`;
      })
      .join('');
  const total = $('#pg-total');
  if (total) total.textContent = secs(Date.now() - j.startedAt);
}

// ---------------------------------------------------------------------------
// Data flow
// ---------------------------------------------------------------------------
async function loadState() {
  const s = await api('/api/state');
  state.repos = s.repos;
  state.settings = s.settings;
  renderSidebar();
}
let seq = 0;
async function loadReport({ quiet = false } = {}) {
  const r = current();
  if (!r) {
    state.report = null;
    renderWelcome();
    if (!state.suggest) loadSuggest();
    return;
  }
  const my = ++seq;
  const key = `${r.id}:${state.identity}`;
  state.error = null;
  if (!quiet || state.reportKey?.split(':')[0] !== r.id) {
    state.report = null;
    renderRepo();
  }
  if (!r.lastSync?.at) return renderRepo();
  try {
    const rep = await api(`/api/repos/${encodeURIComponent(r.id)}/report?identity=${state.identity}`);
    if (my !== seq) return;
    state.report = rep;
    state.reportKey = key;
    // Older algorithm: keep showing it and recompute quietly; the progress log explains what is happening.
    if (rep.stale && !r.job?.running) api(`/api/repos/${encodeURIComponent(r.id)}/sync`, { method: 'POST' }).catch(() => {});
  } catch (e) {
    if (my !== seq) return;
    if (e.code === 'no_report' && !r.job?.running) {
      // Report format changed since the last run: re-analyze transparently.
      api(`/api/repos/${encodeURIComponent(r.id)}/sync`, { method: 'POST' }).catch(() => {});
    } else if (e.code !== 'no_report') state.error = e.message;
  }
  const y = window.scrollY;
  renderRepo();
  if (quiet) window.scrollTo({ top: y });
}
async function analyze(input) {
  const v = input.trim();
  if (!v) return toast('请输入仓库地址或本地路径');
  const btn = $('#analyze-form [type=submit]');
  if (btn) {
    btn.disabled = true;
    btn.firstChild.outerHTML = '<span class="spinner" aria-hidden="true"></span>';
  }
  try {
    const { repo } = await api('/api/repos', { method: 'POST', body: { input: v } });
    await loadState();
    go({ repo: repo.id, tab: 'overview', file: null, person: null, filter: null });
  } catch (e) {
    const hint = $('#parse-hint');
    if (hint) {
      hint.textContent = e.message;
      hint.className = 'parse-hint err';
    } else toast(e.message);
    $('#target-input')?.focus();
  } finally {
    if (btn?.isConnected) {
      btn.disabled = false;
      btn.firstChild.outerHTML = ICON.search;
    }
  }
}
function connect() {
  const es = new EventSource('/api/stream');
  es.addEventListener('open', () => setLive(true));
  es.addEventListener('error', () => setLive(es.readyState === EventSource.OPEN));
  es.addEventListener('job', async (ev) => {
    let j;
    try {
      j = JSON.parse(ev.data);
    } catch {
      return;
    }
    const r = repoById(j.repoId);
    if (!r) return;
    const prev = r.job;
    r.job = j;
    const isCur = j.repoId === route.repo;
    if (!j.running && prev?.running !== false) {
      await loadState().catch(() => {});
      if (isCur) {
        await loadReport({ quiet: true });
        updateTitle();
        const took = j.finishedAt && j.startedAt ? ` · 用时 ${secs(j.finishedAt - j.startedAt)}` : '';
        toast(j.stage === 'done' ? `分析完成${took}` : j.stage === 'cancelled' ? '已取消' : j.error?.message || '分析失败', null, { ok: j.stage === 'done' });
      }
      return;
    }
    renderSidebar();
    if (!isCur) return;
    updateTitle();
    if (j.reportHead && j.reportHead !== prev?.reportHead && state.report?.head !== j.reportHead) {
      await loadState().catch(() => {});
      return loadReport({ quiet: true });
    }
    if (!$('#progress')) renderRepo();
    else renderProgress();
    const b = main.querySelector('[data-action="sync"]');
    if (b) b.disabled = true;
  });
}

// ---------------------------------------------------------------------------
// Drawers (file / person), driven by the URL
// ---------------------------------------------------------------------------
let drawerKey = null;
function syncDrawer() {
  const dlg = $('#drawer');
  const key = route.file ? `f:${route.file}` : route.person ? `p:${route.person}` : null;
  if (!key) {
    drawerKey = null;
    if (dlg.open) dlg.close();
    return;
  }
  if (key === drawerKey && dlg.open) return;
  drawerKey = key;
  if (route.file) openFile(route.file);
  else openPerson(route.person);
}
function closeDrawer() {
  if (history.state?.drawer) history.back();
  else go({ file: null, person: null }, { replace: true });
}
function drawerShell(title, sub) {
  return `<div class="dlg"><div class="dlg-head"><div style="min-width:0">${title}${sub ? `<div class="hint" style="margin-top:4px">${sub}</div>` : ''}</div><button type="button" class="btn icon-btn btn-ghost" data-action="close-drawer" aria-label="关闭">${ICON.close}</button></div>`;
}
function fileBadges(path) {
  const rep = state.report;
  if (!rep) return '';
  const hot = rep.hotspots.find((h) => h.path === path);
  const bug = rep.bugMagnets.find((h) => h.path === path);
  const risk = rep.highRisk.some((h) => h.path === path);
  const b = [];
  if (risk) b.push('<span class="rank-badge danger">高风险</span>');
  if (hot) b.push(`<span class="rank-badge">热点 #${hot.rank} / ${rep.vitals.N}</span>`);
  if (bug) b.push(`<span class="rank-badge">Bug 磁铁 #${bug.rank}</span>`);
  if (!b.length) b.push('<span class="rank-badge">不在窗口内的 Top 榜单</span>');
  return `<div class="drawer-badges">${b.join('')}</div>`;
}
function personBadges(name) {
  const rep = state.report;
  const c = rep?.contributors.find((x) => x.name === name);
  if (!c) return '';
  return `<div class="drawer-badges"><span class="rank-badge">排名 #${c.rank} / ${fmt(rep.busFactor.total)}</span><span class="rank-badge">占 ${pct(c.share, 1)}</span>${c.active ? '<span class="status up">近 3 个月活跃</span>' : '<span class="status idle">近 3 个月无提交</span>'}</div>`;
}
/** File-level co-change, all history (code-maat thresholds; weak candidates only when nothing passes). */
function couplingHtml(c) {
  if (!c) return '';
  const strong = c.strong.length > 0;
  const list = strong ? c.strong : c.weak;
  const head = `<h3 class="sub-h">常一起改的文件 <span class="hint" style="font-weight:400">全部历史上改它的 ${fmt(c.revs)} 个提交里，同时也改了这些文件的比例（不含合并提交和超过 ${c.maxChangeset} 个文件的大提交）</span></h3>`;
  if (!list.length) return `<section>${head}<p class="hint">${c.revs < c.minRevs ? `只有 ${fmt(c.revs)} 个相关提交，还看不出稳定的关系。` : '没有经常和它一起改的文件。'}</p></section>`;
  const note = strong ? '' : `<p class="hint">没有达到门槛（一起改过至少 ${c.minShared} 次、占比 ≥${pct(c.minDegree)}）的文件。下面是一起改过 3 次以上的，仅供参考：</p>`;
  return `<section>${head}${note}<ul class="co-list${strong ? '' : ' weak'}">${list
    .map((x) => `<li><span class="co-pct mono">${Math.round(x.degree * 100)}%</span>${pathHtml(x.path)}<span class="co-meta hint">${fmt(x.shared)} 次${x.kind === 'test' ? ' · 测试同步' : x.kind === 'process' ? ' · 流程文件' : ''}${x.exists ? '' : ' · 已删除'}</span><span class="co-bar" aria-hidden="true"><span style="width:${(x.degree * 100).toFixed(0)}%"></span></span></li>`)
    .join('')}</ul></section>`;
}
async function openFile(path) {
  const r = current();
  const dlg = $('#drawer');
  if (!r) return;
  dlg.innerHTML = `${drawerShell(`<h2 id="drawer-title" style="font-size:15px">${pathHtml(path, { link: false, baseFirst: false })}</h2>`)}<div class="dlg-body"><div class="skeleton" style="height:96px"></div><div class="skeleton" style="height:200px"></div></div></div>`;
  dlg.setAttribute('aria-labelledby', 'drawer-title');
  if (!dlg.open) dlg.showModal();
  try {
    const d = await api(`/api/repos/${encodeURIComponent(r.id)}/file?path=${encodeURIComponent(path)}&identity=${state.identity}`);
    if (drawerKey !== `f:${path}`) return;
    const max = d.owners[0]?.commits || 1;
    dlg.innerHTML = `${drawerShell(`<h2 id="drawer-title" style="font-size:15px">${pathHtml(path, { link: false, baseFirst: false })}</h2>`, `${d.exists ? '在 HEAD 中存在' : '<span class="tag">已在 HEAD 中删除或改名</span>'}${d.firstAdd ? ` · 首次加入 ${d.firstAdd}` : ''}${fileBadges(path)}`)}
      <div class="dlg-body">
        <div>${fileActions(path, { exists: d.exists })}</div>
        <div class="mini-kpis">
          <div class="mini-kpi"><div class="kpi-label">全部修改</div><div class="kpi-value">${fmt(d.total)}</div></div>
          <div class="mini-kpi"><div class="kpi-label">修 bug 的提交</div><div class="kpi-value" style="color:var(--mcode-danger)">${fmt(d.fixes)}</div></div>
          <div class="mini-kpi"><div class="kpi-label">维护者</div><div class="kpi-value">${fmt(d.ownerCount)}</div></div>
        </div>
        <section><h3 class="sub-h">每月修改次数</h3>${C.monthBars({ months: d.months.slice(-24).map(([m, n]) => ({ m, n })), height: 170, color: 'var(--k-mr)' })}</section>
        <section><h3 class="sub-h">维护者 <span class="hint" style="font-weight:400">等同 <span class="mono">git shortlog -sn -- &lt;file&gt;</span>${state.identity === 'merged' ? '，不含机器人' : ''}</span></h3>
          <ul class="repo-list">${d.owners.map((o) => `<li class="repo-row" style="grid-template-columns:minmax(120px,200px) 1fr 90px"><span style="display:flex;gap:8px;align-items:center;min-width:0">${avatar(o.name)}${personLink(o.name)}</span><div class="repo-bar"><span style="width:${((100 * o.commits) / max).toFixed(1)}%;background:${C.memberColor(o.name)}"></span></div><span class="num">${fmt(o.commits)} · ${pct(o.share)}</span></li>`).join('')}</ul></section>
        ${couplingHtml(d.coupling)}
        <section><h3 class="sub-h">最近 ${d.commits.length} 次修改</h3><ul class="fire-list" style="max-height:none">${d.commits.map((c) => commitRow(c, `${c.fix ? '<span class="tag danger">fix</span> ' : ''}${c.fire ? '<span class="tag warn">救火</span> ' : ''}${c.status === 'A' ? '<span class="tag good">新增</span> ' : c.status === 'D' ? '<span class="tag">删除</span> ' : ''}`)).join('')}</ul></section>
      </div></div>`;
  } catch (e) {
    dlg.querySelector('.dlg-body').innerHTML = `<div class="alert" role="alert">${esc(e.message)}</div>`;
  }
}
async function openPerson(name) {
  const r = current();
  const dlg = $('#drawer');
  if (!r) return;
  dlg.innerHTML = `${drawerShell(`<h2 id="drawer-title">${esc(name)}</h2>`)}<div class="dlg-body"><div class="skeleton" style="height:96px"></div><div class="skeleton" style="height:240px"></div></div></div>`;
  dlg.setAttribute('aria-labelledby', 'drawer-title');
  if (!dlg.open) dlg.showModal();
  try {
    const d = await api(`/api/repos/${encodeURIComponent(r.id)}/person?name=${encodeURIComponent(name)}&identity=${state.identity}`);
    if (drawerKey !== `p:${name}`) return;
    const maxF = d.files[0]?.count || 1;
    dlg.innerHTML = `${drawerShell(`<div class="person">${avatar(d.name, 'lg')}<div><h2 id="drawer-title" translate="no">${esc(d.name)}${d.bot ? ' <span class="tag">机器人</span>' : ''}</h2></div></div>`, `${d.first || '–'} → ${d.last || '–'}${d.aliases.length ? ` · 也作 <span translate="no">${esc(d.aliases.join('、'))}</span>` : ''}${d.emails.length ? ` · <span class="mono" translate="no">${esc(d.emails.join(', '))}</span>` : ''}${personBadges(d.name)}`)}
      <div class="dlg-body">
        <div class="mini-kpis">
          <div class="mini-kpi"><div class="kpi-label">非合并提交</div><div class="kpi-value">${fmt(d.commits)}</div></div>
          <div class="mini-kpi"><div class="kpi-label">修 bug</div><div class="kpi-value" style="color:var(--mcode-danger)">${fmt(d.fixes)}</div></div>
          <div class="mini-kpi"><div class="kpi-label">合并提交</div><div class="kpi-value">${fmt(d.merges)}</div></div>
        </div>
        <section><h3 class="sub-h">每月提交</h3>${C.monthBars({ months: d.months.slice(-24).map(([m, n]) => ({ m, n })), height: 170, color: C.memberColor(d.name) })}</section>
        <section><h3 class="sub-h">改得最多的文件</h3><ol class="bar-list">${d.files.map((f, i) => `<li><span class="rank">${i + 1}</span>${pathHtml(f.path)}<div class="mini-bar"><span style="width:${((100 * f.count) / maxF).toFixed(1)}%;background:${C.memberColor(d.name)}"></span></div><span class="n">${fmt(f.count)}</span></li>`).join('')}</ol></section>
        <section><h3 class="sub-h">最近提交</h3><ul class="fire-list" style="max-height:none">${d.recent.map((c) => commitRow(c, `${c.fix ? '<span class="tag danger">fix</span> ' : ''}${c.fire ? '<span class="tag warn">救火</span> ' : ''}`)).join('')}</ul></section>
      </div></div>`;
  } catch (e) {
    dlg.querySelector('.dlg-body').innerHTML = `<div class="alert" role="alert">${esc(e.message)}</div>`;
  }
}

// ---------------------------------------------------------------------------
// Export & chat
// ---------------------------------------------------------------------------
function buildMarkdown(rep, r) {
  const v = rep.vitals;
  const L = [];
  L.push(`# Codebase Recon Report — ${r.display}`, '');
  L.push(`> 由仓库透视（Repo X-Ray）生成于 ${new Date().toLocaleString('zh-CN')}，HEAD \`${rep.head.slice(0, 12)}\`（${rep.branch || 'HEAD'}），身份口径：${rep.identity === 'raw' ? '原始（与 shortlog 一致）' : '合并身份，机器人除外'}`, '');
  L.push('## Repo Vitals', `Age: ${v.first} to ${v.latest} | Commits: ${v.commits} | Branches: ${v.branches} | Analysis window: ${v.window}`, '');
  L.push('## 1. Code Hotspots', ...rep.hotspots.map((h) => `- ${h.count}  \`${h.path}\``), '');
  L.push('## 2. Bug Magnets', ...rep.bugMagnets.map((h) => `- ${h.count}  \`${h.path}\``), '');
  L.push('## 3. High-Risk Files');
  if (rep.highRisk.length) L.push(...rep.highRisk.map((h) => `- \`${h.path}\` — hotspot rank #${h.hotRank}, bug magnet rank #${h.bugRank}, primary owner: ${h.owner ? `${h.owner.name} (${pct(h.owner.share)})` : '–'}`));
  else L.push('No files appear in both lists — good sign.');
  L.push('', '## 4. Bus Factor', ...rep.contributors.slice(0, 10).map((c) => `- ${c.commits}  ${c.name}`), `Active (last 3 months): ${rep.busFactor.active3m} of ${rep.busFactor.total} total contributors`);
  if (rep.busFactor.warn) L.push('Warning: low active contributor ratio — knowledge concentration risk');
  L.push('', '## 5. Team Momentum', ...rep.momentum.months.slice(-12).map((m) => `- ${m.m}: ${m.n}`), `Trend: ${rep.momentum.trend}`, '');
  L.push('## 6. Firefighting Frequency', ...(rep.firefighting.list.length ? rep.firefighting.list.slice(0, 20).map((c) => `- ${c.sha.slice(0, 7)} ${c.subj}`) : ['None found']), `Rate: ${rep.firefighting.count} emergency commits out of ${rep.firefighting.total} total in window (${pct(rep.firefighting.rate, 1)})`, '');
  L.push('## 7. Recently Added Files', ...rep.recentlyAdded.files.map((f) => `- ${f.count}  \`${f.path}\``), '');
  if (rep.tech) {
    L.push('## Tech Stack', `Languages: ${rep.tech.languages.slice(0, 6).map((l) => `${l.name} ${pct(l.share)}`).join(', ')}`);
    for (const g of rep.tech.groups) L.push(`- ${g.category}: ${g.items.map((i) => i.name).join(', ')}`);
    L.push('');
  }
  const rec = rep.recommendations;
  L.push('## 8. Recommendations', `- Start reading: ${rec.startReading.map((p) => `\`${p}\``).join(', ') || '–'}`, `- Talk to: ${rec.talkTo ? `${rec.talkTo.name} (owner of \`${rec.talkTo.file}\`)` : '–'}`, `- Watch out: ${rec.watchOut.join('; ') || 'nothing notable'}`, '');
  return L.join('\n');
}
function chatPrompt(rep, r) {
  const loc = r.kind === 'local' ? `本地仓库 ${r.localDir}` : `${r.webUrl}（若本地没有 checkout，请先 clone）`;
  const risk = rep.highRisk.slice(0, 5).map((h, i) => `${i + 1}. ${h.path}（热点 #${h.hotRank}，修 bug ${h.bugCount}/${h.hotCount} 次，主要负责人 ${h.owner?.name || '–'}）`);
  return [
    `请基于下面这份仓库透视报告，帮我深入看一下 ${loc}。`,
    '',
    `HEAD ${rep.head.slice(0, 12)}；${rep.vitals.commits} 个 commit；节奏${TREND[rep.momentum.trend]}；救火占比 ${pct(rep.firefighting.rate, 1)}；近 3 个月活跃 ${rep.busFactor.active3m}/${rep.busFactor.total} 人。`,
    '',
    '高风险文件（热点 ∩ bug 磁铁）：',
    ...(risk.length ? risk : ['（无）']),
    '',
    '请先阅读前 3 个高风险文件，回答：它们为什么反复出 bug（结构、耦合、职责、测试覆盖），有哪些具体可落地的拆分或加固建议。只读分析，不要修改代码。',
  ].join('\n');
}
async function sendToChat(btn, custom = null) {
  const r = current();
  const rep = state.report;
  if (!r || !rep) return;
  const message = window.mcode?.miniapp?.message;
  const text = custom ?? chatPrompt(rep, r);
  if (!message?.append) {
    await copyText(text, '当前环境不支持直接发到对话，已复制到剪贴板');
    return;
  }
  if (btn) btn.disabled = true;
  try {
    await message.append(text);
    toast('已追加到对话输入框，确认后按发送即可');
  } catch (e) {
    const code = e?.message;
    toast(code === 'user_cancelled' ? '已取消，没有追加内容' : code === 'result_unknown' ? '结果未知，请先检查对话输入框再重试' : code === 'target_unavailable' ? '找不到可追加的对话，请从对话里打开这个 Mini App' : '追加失败，请稍后重试');
  } finally {
    if (btn?.isConnected) btn.disabled = false;
  }
}
function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function openExportMenu(btn) {
  closeMenus();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `<button role="menuitem" type="button" data-action="export-copy">${ICON.copy}<span>复制 Markdown 报告</span></button>
    <button role="menuitem" type="button" data-action="export-download">${ICON.download}<span>下载 .md 文件</span></button>
    <button role="menuitem" type="button" data-action="to-chat">${ICON.chat}<span>发到对话…</span></button>`;
  document.body.append(menu);
  const b = btn.getBoundingClientRect();
  menu.style.top = `${b.bottom + 6}px`;
  menu.style.left = `${Math.min(b.left, innerWidth - 240)}px`;
  btn.setAttribute('aria-expanded', 'true');
  menu.querySelector('button').focus();
  menu._owner = btn;
}
function closeMenus() {
  document.querySelectorAll('.menu').forEach((m) => {
    m._owner?.setAttribute('aria-expanded', 'false');
    m.remove();
  });
}

// ---------------------------------------------------------------------------
// Explain popover
// ---------------------------------------------------------------------------
function toggleExplain(btn) {
  const open = btn.getAttribute('aria-expanded') === 'true';
  closePopovers();
  if (open) return;
  const tpl = btn.parentElement.querySelector(`template[data-explain="${btn.dataset.key}"]`) || btn.nextElementSibling;
  if (!tpl) return;
  const pop = document.createElement('div');
  pop.className = 'popover';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', '指标说明');
  pop.append(tpl.content.cloneNode(true));
  document.body.append(pop);
  const b = btn.getBoundingClientRect();
  const w = pop.getBoundingClientRect().width;
  pop.style.top = `${b.bottom + 8}px`;
  pop.style.left = `${Math.max(8, Math.min(b.left - 16, innerWidth - w - 8))}px`;
  btn.setAttribute('aria-expanded', 'true');
  pop._owner = btn;
}
function closePopovers() {
  document.querySelectorAll('.popover').forEach((p) => {
    p._owner?.setAttribute('aria-expanded', 'false');
    p.remove();
  });
}

// ---------------------------------------------------------------------------
// ⌘K command palette
// ---------------------------------------------------------------------------
const pal = { items: [], active: 0, seq: 0, timer: null };
function openPalette(prefill = '') {
  const dlg = $('#palette');
  dlg.innerHTML = `<div class="pal" role="combobox" aria-expanded="true" aria-haspopup="listbox" aria-owns="pal-list">
    <div class="pal-input">${ICON.search}<label class="sr-only" for="pal-q">搜索</label><input id="pal-q" autocomplete="off" spellcheck="false" placeholder="${current()?.lastSync?.at ? `搜索仓库、${esc(current().name)} 里的文件和贡献者…` : '搜索仓库或执行操作…'}" aria-controls="pal-list" aria-autocomplete="list"><kbd>Esc</kbd></div>
    <ul id="pal-list" role="listbox" aria-label="结果"></ul>
    <div class="pal-foot hint"><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>↵</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span><span class="r" id="pal-count"></span></div></div>`;
  if (!dlg.open) dlg.showModal();
  const q = $('#pal-q');
  q.value = prefill;
  pal.active = 0;
  palQuery(prefill);
  q.focus();
}
function hl(text, needle) {
  const t = String(text);
  const i = needle ? t.toLowerCase().indexOf(needle) : -1;
  if (i < 0) return esc(t);
  return `${esc(t.slice(0, i))}<mark>${esc(t.slice(i, i + needle.length))}</mark>${esc(t.slice(i + needle.length))}`;
}
function palActions() {
  const r = current();
  const A = [{ kind: 'action', label: '分析新仓库…', icon: ICON.search, run: () => go({ repo: null, tab: 'overview', file: null, person: null, filter: null }) }];
  if (r) {
    A.push({ kind: 'action', label: r.kind === 'local' ? '重新分析当前仓库' : '同步并分析当前仓库', icon: ICON.sync, run: () => syncCurrent() });
    if (state.report) {
      A.push({ kind: 'action', label: '复制 Markdown 报告', icon: ICON.copy, run: () => copyText(buildMarkdown(state.report, r), '报告已复制') });
      A.push({ kind: 'action', label: '发到对话…', icon: ICON.chat, run: () => sendToChat() });
    }
    for (const [t, l] of TABS) A.push({ kind: 'action', label: `转到：${l}`, icon: ICON.arrow, run: () => go({ tab: t, filter: null, file: null, person: null }) });
  }
  A.push({ kind: 'action', label: '切换主题', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3v18a9 9 0 0 0 0-18" fill="currentColor"/></svg>', run: cycleTheme });
  A.push({ kind: 'action', label: '打开设置', icon: ICON.info, run: openSettings });
  return A;
}
function palQuery(q) {
  const needle = q.trim().toLowerCase();
  const repos = visibleRepos()
    .filter((r) => !needle || r.name.toLowerCase().includes(needle) || r.display.toLowerCase().includes(needle))
    .slice(0, 6)
    .map((r) => ({ kind: 'repo', label: r.name, sub: r.display, icon: ICON[r.provider] || ICON.other, run: () => go({ repo: r.id, tab: 'overview', file: null, person: null, filter: null }) }));
  const actions = palActions().filter((a) => !needle || a.label.toLowerCase().includes(needle));
  pal.base = needle ? [...repos, ...actions] : [...actions.slice(0, 5), ...repos];
  pal.remote = [];
  renderPal();
  clearTimeout(pal.timer);
  const r = current();
  if (!needle || !r?.lastSync?.at) return;
  const my = ++pal.seq;
  pal.loading = true;
  renderPal();
  pal.timer = setTimeout(async () => {
    try {
      const res = await api(`/api/repos/${encodeURIComponent(r.id)}/search?q=${encodeURIComponent(needle)}&identity=${state.identity}`);
      if (my !== pal.seq) return;
      pal.remote = [
        ...res.files.map((f) => ({ kind: 'file', label: f.path, count: f.count, exists: f.exists, icon: ICON.file, run: () => go({ file: f.path, person: null }) })),
        ...res.people.map((p) => ({ kind: 'person', label: p.name, count: p.commits, bot: p.bot, icon: ICON.user, run: () => go({ person: p.name, file: null }) })),
      ];
    } catch {}
    pal.loading = false;
    if (my === pal.seq) renderPal();
  }, 120);
}
function renderPal() {
  const list = $('#pal-list');
  if (!list) return;
  pal.items = [...pal.base.filter((x) => x.kind !== 'action' || !pal.remote.length), ...pal.remote, ...(pal.remote.length ? pal.base.filter((x) => x.kind === 'action') : [])];
  pal.active = Math.min(pal.active, Math.max(0, pal.items.length - 1));
  const GROUP = { action: '操作', repo: '仓库', file: '文件', person: '贡献者' };
  const needle = ($('#pal-q')?.value || '').trim().toLowerCase();
  let last = '';
  list.innerHTML =
    pal.items
      .map((it, i) => {
        const head = it.kind !== last ? `<li class="pal-group" role="presentation">${GROUP[it.kind]}</li>` : '';
        last = it.kind;
        let label;
        if (it.kind === 'file') {
          const k = it.label.lastIndexOf('/');
          label = `<span class="path" translate="no" title="${esc(it.label)}"><span class="base">${hl(it.label.slice(k + 1), needle)}</span> <span class="dir">${hl(it.label.slice(0, k + 1), needle)}</span></span>`;
        } else label = `<span translate="no">${hl(it.label, needle)}</span>`;
        const meta = it.kind === 'file' ? `${fmt(it.count)} 次修改${it.exists ? '' : ' · 已删除'}` : it.kind === 'person' ? `${fmt(it.count)} 个提交${it.bot ? ' · 机器人' : ''}` : it.sub ? esc(it.sub) : '';
        return `${head}<li id="pal-${i}" role="option" aria-selected="${i === pal.active}" data-i="${i}"><span class="pi">${it.icon}</span><span class="pl">${label}</span><span class="pm hint" translate="no">${meta}</span></li>`;
      })
      .join('') + (pal.loading ? '<li class="pal-group" role="presentation">搜索中…</li>' : !pal.items.length ? '<li class="pal-empty hint" role="presentation">没有匹配的结果</li>' : '');
  $('#pal-q')?.setAttribute('aria-activedescendant', pal.items.length ? `pal-${pal.active}` : '');
  const cnt = $('#pal-count');
  if (cnt) cnt.textContent = pal.items.length ? `${pal.items.length} 项` : '';
  $(`#pal-${pal.active}`)?.scrollIntoView({ block: 'nearest' });
}
function palRun(i) {
  const it = pal.items[i];
  if (!it) return;
  $('#palette').close();
  it.run();
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
function openSettings() {
  const s = state.settings;
  const src = { gh: 'gh 登录', glab: 'glab 登录', token: '手动令牌', none: '未找到凭据（按公开仓库访问）' };
  const dlg = $('#settings');
  dlg.innerHTML = `<div class="dlg"><div class="dlg-head"><h2 id="set-title">设置</h2><button type="button" class="btn icon-btn btn-ghost" data-action="close-dialog" aria-label="关闭">${ICON.close}</button></div>
    <div class="dlg-body">
      <section><h3 class="sub-h">凭据</h3><p class="hint" style="margin:0 0 8px">默认复用本机 gh / glab 的登录；令牌只保存在这个 Mini App 的数据目录里，不会发送到页面，也不会写进仓库配置。</p>
        <ul class="src-list">${(s.hosts || []).map((h) => `<li class="src-item"><div class="grow"><b class="mono" translate="no">${esc(h.host)}</b><div class="hint">${src[h.source] || h.source}</div></div>${s.tokenHosts?.includes(h.host) ? `<button type="button" class="btn btn-sm btn-ghost btn-danger" data-action="clear-token" data-host="${esc(h.host)}">清除令牌</button>` : ''}</li>`).join('') || '<li class="hint">分析远程仓库后，这里会列出用到的主机。</li>'}</ul></section>
      <form id="token-form" class="card" style="display:flex;flex-direction:column;gap:10px" novalidate>
        <h3 class="sub-h" style="margin:0">为某个主机填写访问令牌</h3>
        <div class="row"><div class="field"><label for="tk-host">主机</label><input id="tk-host" name="host" class="input mono" spellcheck="false" autocomplete="off" placeholder="gitlab.example.com…"></div><div class="field"><label for="tk-val">令牌</label><input id="tk-val" name="token" class="input mono" type="password" autocomplete="off" placeholder="GitLab：read_repository；GitHub：repo…"></div></div>
        <div style="display:flex;gap:8px;align-items:center"><button class="btn" type="submit">保存令牌</button><span class="form-msg" id="tk-msg" role="status"></span></div>
      </form>
      <form id="scan-form" class="card" style="display:flex;flex-direction:column;gap:10px" novalidate>
        <h3 class="sub-h" style="margin:0">本机仓库扫描目录</h3>
        <div class="field"><label for="sc-roots">每行一个目录，最多 10 个；只检查是否存在 <span class="mono">.git</span>，深度 4 层</label><textarea id="sc-roots" name="roots" class="input mono" spellcheck="false" style="min-height:96px">${esc((s.scanRoots || []).join('\n'))}</textarea></div>
        <div style="display:flex;gap:8px;align-items:center"><button class="btn" type="submit">保存并重新扫描</button><span class="form-msg" id="sc-msg" role="status"></span></div>
      </form>
      <form id="proxy-form" class="card" style="display:flex;flex-direction:column;gap:10px" novalidate>
        <h3 class="sub-h" style="margin:0">网络代理</h3>
        <div class="field"><label for="pf-proxy">HTTP 代理（可选，用于 git clone / fetch）</label><input id="pf-proxy" name="proxy" class="input mono" spellcheck="false" autocomplete="off" placeholder="http://127.0.0.1:7890…" value="${esc(s.proxy || '')}">
          <span class="hint">当前：${{ settings: '使用这里的设置', env: '使用环境变量里的代理', system: '使用系统代理', none: '直连' }[s.proxyActive] || '直连'}</span></div>
        <div style="display:flex;gap:8px;align-items:center"><button class="btn" type="submit">保存代理</button><span class="form-msg" id="pf-msg" role="status"></span></div>
      </form>
    </div></div>`;
  dlg.setAttribute('aria-labelledby', 'set-title');
  if (!dlg.open) dlg.showModal();
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
async function syncCurrent() {
  const r = current();
  if (!r) return;
  try {
    await api(`/api/repos/${encodeURIComponent(r.id)}/sync`, { method: 'POST' });
  } catch (e) {
    toast(e.message);
  }
}
function removeCurrent() {
  const r = current();
  if (!r) return;
  state.pendingRemoval.set(r.id, true);
  const next = visibleRepos()[0];
  go({ repo: next?.id || null, tab: 'overview', file: null, person: null, filter: null });
  const timer = setTimeout(async () => {
    state.pendingRemoval.delete(r.id);
    try {
      await api(`/api/repos/${encodeURIComponent(r.id)}`, { method: 'DELETE' });
      await loadState();
    } catch (e) {
      toast(e.message);
      await loadState().catch(() => {});
    }
  }, 8000);
  toast(r.kind === 'local' ? `已移除 ${r.name}（不会动本地仓库）` : `已移除 ${r.name}，8 秒后删除缓存的 clone`, {
    label: '撤销',
    ms: 8000,
    run: () => {
      clearTimeout(timer);
      state.pendingRemoval.delete(r.id);
      go({ repo: r.id, tab: 'overview', file: null, person: null, filter: null });
    },
  });
}
async function setIdentity(v) {
  if (state.identity === v) return;
  state.identity = v;
  localStorage.setItem('rr-identity', v);
  await loadReport({ quiet: true });
  if (route.file || route.person) {
    drawerKey = null;
    syncDrawer();
  }
}

function openKeys() {
  const dlg = $('#keys');
  const row = (keys, text) => `<dt>${keys}</dt><dd>${text}</dd>`;
  dlg.innerHTML = `<div class="dlg"><div class="dlg-head"><h2 id="keys-title">键盘快捷键</h2><button type="button" class="btn icon-btn btn-ghost" data-action="close-dialog" aria-label="关闭">${ICON.close}</button></div>
    <div class="dlg-body"><dl class="keys">
      ${row('<kbd>⌘</kbd><kbd>K</kbd>', '搜索仓库、全部历史文件、贡献者和操作')}
      ${row('<kbd>/</kbd>', '聚焦贡献者筛选框或仓库地址输入框')}
      ${row(`<kbd>1</kbd>–<kbd>${TABS.length}</kbd>`, '切换报告分区')}
      ${row('<kbd>[</kbd><kbd>]</kbd>', '切换到上一个 / 下一个仓库')}
      ${row('<kbd>Esc</kbd>', '关闭抽屉、弹层和菜单；在代码地图上取消选择')}
      ${row('<kbd>?</kbd>', '显示这份列表')}
    </dl>
    <h3 class="sub-h">代码地图</h3>
    <dl class="keys">
      ${row('<kbd>←</kbd><kbd>↑</kbd><kbd>→</kbd><kbd>↓</kbd>', '在方块之间移动')}
      ${row('<kbd>Space</kbd> / 单击', '选中，查看详情和“常一起改”的连线')}
      ${row('<kbd>↵</kbd> / 双击', '进入目录，或打开文件历史')}
      ${row('<kbd>⌫</kbd>', '返回上一层（浏览器后退也可以）')}
    </dl></div></div>`;
  if (!dlg.open) dlg.showModal();
}
document.addEventListener('click', async (e) => {
  // Popovers and menus close on outside click.
  if (!e.target.closest('.popover,[data-action="explain"]')) closePopovers();
  if (!e.target.closest('.menu,[data-action="export-menu"]')) closeMenus();

  const nav = e.target.closest('a[data-nav]');
  if (nav && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) {
    e.preventDefault();
    const u = new URL(nav.href, location.href);
    history.pushState({ drawer: u.searchParams.has('file') || u.searchParams.has('person') }, '', u.pathname + u.search);
    closePopovers();
    closeMenus();
    if ($('#palette').open) $('#palette').close();
    return applyRoute();
  }
  const opt = e.target.closest('#pal-list [role=option]');
  if (opt) return palRun(Number(opt.dataset.i));

  const el = e.target.closest('[data-action]');
  if (!el) {
    if (e.target.tagName === 'DIALOG') e.target.id === 'drawer' ? closeDrawer() : e.target.close();
    return;
  }
  const r = current();
  switch (el.dataset.action) {
    case 'new':
      return go({ repo: null, tab: 'overview', file: null, person: null, filter: null });
    case 'analyze-path':
      return analyze(el.dataset.path);
    case 'rescan':
      state.suggest = null;
      renderWelcome();
      return loadSuggest(true);
    case 'sync':
      return syncCurrent();
    case 'cancel':
      return r && api(`/api/repos/${encodeURIComponent(r.id)}/sync`, { method: 'DELETE' }).catch((err) => toast(err.message));
    case 'remove':
      return removeCurrent();
    case 'mo-range':
      state.momentumAll = el.dataset.all === '1';
      for (const b of el.parentElement.children) b.setAttribute('aria-pressed', String(b === el));
      $('#momentum').innerHTML = momentumChart(state.report, state.momentumAll ? 0 : 24);
      return;
    case 'contrib-all':
      state.contribAll = !state.contribAll;
      $('#contrib').innerHTML = contribHtml(state.report);
      return;
    case 'identity':
      return setIdentity(el.dataset.v);
    case 'explain':
      return toggleExplain(el);
    case 'copy':
      return copyText(el.dataset.text, '已复制', el);
    case 'map-cell':
      return mp.view?.blocks[el.dataset.i] && setSel(selKey(mp.view.blocks[el.dataset.i]));
    case 'thumb-open':
      return openThumb(Number(el.dataset.i));
    case 'map-select': {
      const b = mp.view?.blocks[el.dataset.i];
      if (!b) return;
      setSel(selKey(b));
      // Picked from the list below the map: bring the map back into view.
      if (el.closest('#map-table')) $('#map-canvas')?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
      return;
    }
    case 'map-sel-clear':
      setSel(null);
      return $(`#map-canvas .tm-cell[tabindex="0"]`)?.focus();
    case 'map-lens':
      return setLens(el.dataset.v);
    case 'map-size':
      return go({ size: el.dataset.v === 'files' ? null : el.dataset.v }, { replace: true });
    case 'map-range':
      return go({ range: el.dataset.v === defaultRange(state.report) ? null : el.dataset.v }, { replace: true });
    case 'map-play':
      return mp.playing ? stopPlay() : startPlay();
    case 'map-frame-clear':
      return setFrame(null);
    case 'map-retry':
      mp.key = null;
      return mountMap();
    case 'map-sort': {
      const k = el.dataset.k;
      mp.sort = mp.sort.key === k ? { key: k, dir: -mp.sort.dir } : { key: k, dir: ['name', 'owner', 'type'].includes(k) ? 1 : -1 };
      renderMapTable();
      return $(`#map-table [data-action="map-sort"][data-k="${k}"]`)?.focus();
    }
    case 'map-agent':
      return mp.view && sendToChat(el, mapAgentPrompt());
    case 'example': {
      const i = $('#target-input');
      if (!i) return;
      i.value = el.dataset.v;
      i.dispatchEvent(new Event('input', { bubbles: true }));
      i.focus();
      return;
    }
    case 'keys':
      return openKeys();
    case 'export-menu':
      return el.getAttribute('aria-expanded') === 'true' ? closeMenus() : openExportMenu(el);
    case 'export-copy':
      closeMenus();
      return state.report && copyText(buildMarkdown(state.report, r), 'Markdown 报告已复制');
    case 'export-download':
      closeMenus();
      if (!state.report) return;
      download(`${r.name.replace(/[^\w.-]+/g, '-')}-xray-${state.report.head.slice(0, 8)}.md`, buildMarkdown(state.report, r));
      return toast('已开始下载');
    case 'to-chat':
      closeMenus();
      return sendToChat(el);
    case 'close-drawer':
      return closeDrawer();
    case 'close-dialog':
      return el.closest('dialog')?.close();
    case 'settings':
      await loadState().catch(() => {});
      return openSettings();
    case 'palette':
      return openPalette();
    case 'clear-token':
      try {
        await api('/api/settings', { method: 'POST', body: { token: { host: el.dataset.host, value: '' } } });
        await loadState();
        openSettings();
      } catch (err) {
        toast(err.message);
      }
      return;
    case 'theme':
      return cycleTheme();
  }
});
$('#drawer').addEventListener('cancel', (e) => {
  e.preventDefault();
  closeDrawer();
});
$('#drawer').addEventListener('close', () => {
  if (route.file || route.person) closeDrawer();
});

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    return $('#palette').open ? $('#palette').close() : openPalette();
  }
  if (e.key === 'Escape') {
    if (document.querySelector('.popover,.menu')) {
      const owner = document.querySelector('.popover,.menu')._owner;
      closePopovers();
      closeMenus();
      owner?.focus();
      e.preventDefault();
    } else if (route.tab === 'map' && route.sel && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      return setSel(null);
    }
  }
  if (e.target.id === 'pal-q') {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = pal.items.length;
      if (!n) return;
      pal.active = (pal.active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      renderPal();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      palRun(pal.active);
    }
  }
  const menu = document.querySelector('.menu');
  if (menu && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    const items = [...menu.querySelectorAll('[role=menuitem]')];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    e.preventDefault();
  }
  const cell = e.target.classList?.contains('tm-cell') ? e.target : null;
  if (cell && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const i = Number(cell.dataset.i);
    const thumb = cell.dataset.action === 'thumb-open';
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (thumb) return openThumb(i);
      return e.key === 'Enter' ? zoomOrOpen(i) : mp.view?.blocks[i] && setSel(selKey(mp.view.blocks[i]));
    }
    if (/^(Arrow(Left|Right|Up|Down)|Home|End)$/.test(e.key)) {
      e.preventDefault();
      return moveCellFocus(cell, e.key);
    }
  }
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable;
  if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (e.key === '?') {
      e.preventDefault();
      return $('#keys').open ? $('#keys').close() : openKeys();
    }
    if (!document.querySelector('dialog[open]')) {
      if (/^[1-9]$/.test(e.key) && Number(e.key) <= TABS.length && current()) {
        e.preventDefault();
        const t = TABS[Number(e.key) - 1][0];
        return go({ tab: t, filter: null, file: null, person: null, ...(t === 'map' && route.tab !== 'map' ? mapPlaceFor(route.repo) : {}) });
      }
      if (e.key === 'Backspace' && route.tab === 'map' && route.focus) {
        e.preventDefault();
        mp.refocus = true;
        return go({ focus: parentOf(route.focus) || null, sel: route.focus });
      }
      if ((e.key === '[' || e.key === ']') && visibleRepos().length > 1) {
        e.preventDefault();
        const list = visibleRepos();
        const i = list.findIndex((r) => r.id === route.repo);
        const next = list[(i + (e.key === ']' ? 1 : list.length - 1) + list.length) % list.length];
        return go({ repo: next.id, tab: route.tab, file: null, person: null, filter: null, ...mapPlaceFor(next.id) });
      }
    }
  }
  if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '') && !document.querySelector('dialog[open]')) {
    const i = $('#contrib-filter') || $('#target-input');
    if (i) {
      e.preventDefault();
      i.focus();
    }
  }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'contrib-filter') {
    state.contribFilter = e.target.value;
    $('#contrib').innerHTML = contribHtml(state.report);
  } else if (e.target.id === 'target-input') {
    const h = $('#parse-hint');
    const p = parsePreview(e.target.value);
    h.textContent = p ? `将分析：${p}` : '';
    h.className = `parse-hint${p.startsWith('无法识别') || p.startsWith('地址格式') ? ' err' : ''}`;
  } else if (e.target.id === 'pal-q') {
    pal.active = 0;
    palQuery(e.target.value);
  } else if (e.target.id === 'map-month') {
    setFrame(Number(e.target.value));
  }
});
// Single click selects (so the details and co-change lines show); double click goes in.
document.addEventListener('dblclick', (e) => {
  const el = e.target.closest?.('[data-action="map-cell"]');
  if (!el) return;
  e.preventDefault();
  zoomOrOpen(Number(el.dataset.i));
});
document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.id === 'analyze-form') return analyze($('#target-input').value);
  const msg = (id, text, ok) => {
    const m = $(id);
    m.textContent = text;
    m.className = `form-msg ${ok ? 'ok' : 'err'}`;
  };
  const save = async (body, id) => {
    try {
      await api('/api/settings', { method: 'POST', body });
      await loadState();
      openSettings();
      msg(id, '已保存', true);
      return true;
    } catch (err) {
      msg(id, err.message);
      f.querySelector('input,textarea')?.focus();
      return false;
    }
  };
  if (f.id === 'token-form') await save({ token: { host: $('#tk-host').value.trim(), value: $('#tk-val').value.trim() } }, '#tk-msg');
  if (f.id === 'proxy-form') await save({ proxy: $('#pf-proxy').value.trim() }, '#pf-msg');
  if (f.id === 'scan-form' && (await save({ scanRoots: $('#sc-roots').value.split('\n').map((x) => x.trim()).filter(Boolean) }, '#sc-msg'))) {
    state.suggest = null;
    loadSuggest(true);
  }
});

// Spotlight border: cards track the pointer (one rAF per frame, only the hovered card).
let spotEl = null;
let spotRaf = 0;
document.addEventListener(
  'pointermove',
  (e) => {
    const el = e.target.closest?.('.card,.kpi,.suggest');
    if (spotEl && spotEl !== el) {
      spotEl.style.removeProperty('--mx');
      spotEl.style.removeProperty('--my');
    }
    spotEl = el;
    if (!el || spotRaf) return;
    spotRaf = requestAnimationFrame(() => {
      spotRaf = 0;
      const b = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${e.clientX - b.left}px`);
      el.style.setProperty('--my', `${e.clientY - b.top}px`);
    });
  },
  { passive: true },
);
addEventListener('resize', () => placeInk(), { passive: true });

// Tooltips: pointer and keyboard; first one delayed, peers instant.
const tip = $('#tooltip');
let tipWarmUntil = 0;
let tipTimer = null;
function showTip(el, x, y) {
  tip.textContent = el.getAttribute('data-tip');
  tip.classList.add('show');
  tipWarmUntil = Date.now() + 600;
  const b = tip.getBoundingClientRect();
  if (x + 14 + b.width > innerWidth - 8) x = x - b.width - 28;
  if (y + 14 + b.height > innerHeight - 8) y = y - b.height - 28;
  tip.style.left = `${x + 14}px`;
  tip.style.top = `${y + 14}px`;
}
function hideTip() {
  clearTimeout(tipTimer);
  if (tip.classList.contains('show')) tipWarmUntil = Date.now() + 600;
  tip.classList.remove('show');
}
document.addEventListener('pointermove', (e) => {
  const el = e.target.closest?.('[data-tip]');
  if (!el) return hideTip();
  clearTimeout(tipTimer);
  if (tip.classList.contains('show') || Date.now() < tipWarmUntil) showTip(el, e.clientX, e.clientY);
  else tipTimer = setTimeout(() => showTip(el, e.clientX, e.clientY), 350);
});
document.addEventListener('focusin', (e) => {
  const el = e.target.closest?.('[data-tip]');
  if (!el) return hideTip();
  const b = el.getBoundingClientRect();
  showTip(el, b.left, b.bottom);
});
window.addEventListener('scroll', hideTip, { passive: true });

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
applyTheme();
(async () => {
  try {
    await loadState();
    connect();
    if (!route.repo && !location.search) {
      const last = localStorage.getItem('rr-repo');
      if (last && repoById(last)) history.replaceState(null, '', href({ repo: last }));
    }
    await applyRoute();
  } catch (e) {
    main.innerHTML = `<div class="alert" role="alert">加载失败：${esc(e.message)}</div>`;
  }
})();
