// 本机大盘 · Client
// 数据流：bootstrap 全量 -> SSE 增量 -> 切品种/周期时重新拉聚合

import { Chart, drawSpark } from './chart.js';

const $ = (id) => document.getElementById(id);

const UNITS = {
  pct: { d: 1, s: '%' }, load: { d: 2, s: '' }, gib: { d: 2, s: 'G' },
  mib: { d: 0, s: 'M' }, mbs: { d: 2, s: 'M/s' }, kbs: { d: 1, s: 'K/s' },
  ps: { d: 0, s: '/s' }, cnt: { d: 0, s: '' }, hrs: { d: 1, s: 'h' },
};
const unitRule = (u) => UNITS[u] ?? UNITS.cnt;

function fmt(v, unit) {
  if (v == null || !Number.isFinite(v)) return '—';
  const r = unitRule(unit);
  return v.toFixed(r.d) + r.s;
}
/** 涨跌始终带符号：方向不只靠颜色传达 */
function fmtDelta(v, unit) {
  if (v == null || !Number.isFinite(v)) return '—';
  const r = unitRule(unit);
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return sign + Math.abs(v).toFixed(r.d) + r.s;
}
function fmtPct(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + '%';
}
const dirOf = (v) => (v == null || !Number.isFinite(v) || v === 0 ? 'flat' : v > 0 ? 'up' : 'down');
const fmtBytes = (n) => {
  if (!Number.isFinite(n)) return '—';
  const u = ['B', 'KiB', 'MiB', 'GiB'];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return v.toFixed(i === 0 ? 0 : 1) + ' ' + u[i];
};
const fmtRss = (kb) => (Number.isFinite(kb) ? (kb >= 1048576 ? (kb / 1048576).toFixed(1) + 'G' : (kb / 1024).toFixed(0) + 'M') : '—');

const VIEW_KEY = 'kurumi.view.v1';
const HINT_KEY = 'kurumi.wideHint.dismissed.v1';
// 布局最小宽度。视口比它窄时右栏整个落在可视区外，只能引导用户弹出独立窗口
const LAYOUT_MIN_WIDTH = 1280;
const PROC_CODE_RE = /^P(\d+)-(\d+)$/;
/** 进程品种代码 -> { pid, startedAt }。代码里带启动时刻，pid 复用不会串线 */
const procRef = (code) => {
  const m = PROC_CODE_RE.exec(code ?? '');
  return m ? { pid: Number(m[1]), startedAt: Number(m[2]) } : null;
};

/** 副图内存三段：活动页 / 联动页 / 压缩页，单位 GiB */
const MEM_CODES = { a: '300002', w: '300003', c: '300006' };
const readMem = (v) => {
  if (!v) return null;
  const a = v[MEM_CODES.a], w = v[MEM_CODES.w], c = v[MEM_CODES.c];
  if (a == null && w == null && c == null) return null;
  return { a: a ?? 0, w: w ?? 0, c: c ?? 0 };
};

const state = {
  catalog: [], byCode: new Map(), boards: [],
  // 进程品种不在静态目录里，meta 只能从进程表的行里攒
  procMeta: new Map(), watchedCodes: new Set(), watchMax: 20, alive: true, livePids: new Set(),
  settings: null, periods: [], sampleTiers: [], maxBars: 180,
  currentUser: '', todayStart: 0,
  candles: null, bars: [], ma5: [], ma10: [], ma20: [], quote: null, memTotalGiB: 0,
  memSegments: [],
  snapshot: null, events: [], procs: [], allProcs: [], procFetchAt: 0,
  selectedPid: null, sortKey: 'cpu', sortDir: 'desc', query: '',
  usage: null, host: null, es: null, clockTimer: null,
};

const chart = new Chart($('chart'), $('chartEmpty'));

/** 品种元信息。自选进程会进 catalog，非自选进程只存在于 procMeta */
const metaOf = (code) => state.byCode.get(code) ?? state.procMeta.get(code) ?? null;

/** 用一批进程行刷新 procMeta。自选项无条件保留，其余按新快照重建，避免 Map 无限增长 */
function syncProcMeta(rows) {
  const next = new Map();
  const cur = state.settings?.selectedCode;
  for (const [code, m] of state.procMeta) {
    // 自选项与当前主图品种无条件留下：SSE 快照只带 top 50，选中的进程可能不在里面
    if (state.watchedCodes.has(code) || code === cur) next.set(code, m);
  }
  for (const r of rows) {
    const ref = procRef(r.code);
    if (!ref) continue;
    next.set(r.code, {
      code: r.code, pid: ref.pid, startedAt: ref.startedAt,
      name: r.name, user: r.user, board: 'proc', unit: 'pct',
    });
  }
  state.procMeta = next;
}

// ---------------------------------------------------------------- 网络

async function api(path, options) {
  const res = await fetch(path, {
    ...options,
    headers: options?.body ? { 'content-type': 'application/json' } : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error ?? 'request_failed'), { code: body.error });
  return body;
}

function toast(msg, kind) {
  const el = $('toast');
  el.textContent = msg;
  el.dataset.kind = kind ?? 'info';
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 3600);
}

// ---------------------------------------------------------------- 主题

function applyTheme() {
  const s = state.settings;
  document.documentElement.dataset.theme = s.theme === 'auto' ? 'auto' : s.theme;
  document.documentElement.dataset.scheme = s.colorScheme;
  $('btnTheme').textContent = s.theme === 'light' ? '浅色' : s.theme === 'dark' ? '夜间' : '跟随';
  $('btnScheme').textContent = s.colorScheme === 'redUp' ? '红涨' : '绿涨';
  // 主题变量变了，画布要重画
  requestAnimationFrame(() => { chart.paint(); repaintSparks(); });
}

async function patchSettings(patch) {
  const { settings } = await api('/api/settings', { method: 'POST', body: JSON.stringify(patch) });
  state.settings = settings;
  return settings;
}

// ---------------------------------------------------------------- 指数条

function renderIndex(index) {
  const list = $('indexList');
  list.replaceChildren();
  for (const item of index) {
    const meta = item.meta ?? state.byCode.get(item.code);
    if (!meta) continue;
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ix';
    btn.setAttribute('aria-current', String(item.code === state.settings.selectedCode));
    // index[].quote 与 quotes[code] 在服务端同源，但过 JSON 之后是两个独立对象，
    // 增量更新只写 quotes。指数条必须回 quotes 取，否则永远停在首帧。
    const q = state.candles?.quotes?.[item.code] ?? item.quote ?? { last: null, delta: null };
    const dir = dirOf(q.delta);
    btn.innerHTML =
      '<span class="n"></span><span class="p ' + dir + '"></span><span class="d ' + dir + '"></span>';
    btn.querySelector('.n').textContent = meta.name;
    btn.querySelector('.p').textContent = fmt(q.last, meta.unit);
    btn.querySelector('.d').textContent = fmtDelta(q.delta, meta.unit);
    btn.setAttribute('aria-label', meta.name + ' ' + fmt(q.last, meta.unit) + '，涨跌 ' + fmtDelta(q.delta, meta.unit));
    const cv = document.createElement('canvas');
    btn.appendChild(cv);
    btn.addEventListener('click', () => selectCode(item.code));
    li.appendChild(btn);
    list.appendChild(li);
    requestAnimationFrame(() => drawSpark(cv, item.spark, q.delta >= 0));
  }
}

function repaintSparks() {
  const cvs = document.querySelectorAll('.ix canvas');
  const idx = state.candles?.index ?? [];
  cvs.forEach((cv, i) => {
    const item = idx[i];
    if (item) drawSpark(cv, item.spark, item.quote.delta >= 0);
  });
  document.querySelectorAll('.ptable .spark').forEach((cv) => {
    const vals = (cv.dataset.v ?? '').split(',').map(Number).filter(Number.isFinite);
    drawSpark(cv, vals, cv.dataset.u === '1');
  });
}

// ---------------------------------------------------------------- 我的自选 / 大盘行情

const BOARD_NAMES = {
  cpu: 'CPU 板块', gpu: 'GPU 板块', thermal: '温度 板块', mem: '内存 板块',
  disk: '磁盘 板块', net: '网络 板块', sys: '系统 板块',
};

/**
 * 列表每秒整批重建。重建前记住焦点落在哪一行、列表滚到哪，重建后放回去，
 * 否则键盘用户每秒钟被弹回列表开头。
 */
function withFocusKept(el, rebuild) {
  const scroller = el.closest('.wl-scroll');
  const top = scroller?.scrollTop ?? 0;
  const fk = document.activeElement?.dataset?.fk ?? null;
  const hadFocus = fk != null && el.contains(document.activeElement);
  rebuild();
  if (scroller) scroller.scrollTop = top;
  if (hadFocus) el.querySelector('[data-fk="' + fk + '"]')?.focus();
}

/**
 * 一行行情。大盘行整行是一个按钮；自选行拆成「切主图」与「移除」两个平级按钮 ——
 * 按钮不能嵌按钮，嵌套交互元素屏幕阅读器会读乱。
 */
function quoteRow(m, q, proc) {
  const dir = dirOf(q.delta);
  const cur = String(m.code === state.settings.selectedCode);
  const cells =
    '<span class="cd"></span><span class="nm"></span>' +
    '<span class="px ' + dir + '"></span><span class="ch ' + dir + '"></span>';
  const label = m.name + ' ' + fmt(q.last, m.unit) + '，涨跌 ' + fmtDelta(q.delta, m.unit);

  if (!proc) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wrow';
    btn.dataset.fk = m.code;
    btn.setAttribute('aria-current', cur);
    btn.setAttribute('aria-label', label);
    btn.innerHTML = cells;
    btn.querySelector('.cd').textContent = m.code;
    btn.querySelector('.nm').textContent = m.name;
    btn.querySelector('.px').textContent = fmt(q.last, m.unit);
    btn.querySelector('.ch').textContent = fmtDelta(q.delta, m.unit);
    btn.addEventListener('click', () => selectCode(m.code));
    return btn;
  }

  const row = document.createElement('div');
  row.className = 'wrow wrow--proc';
  row.dataset.exited = String(proc.exited);

  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'wmain';
  main.dataset.fk = m.code;
  main.setAttribute('aria-current', cur);
  main.setAttribute('aria-label', label + '，查看走势');
  main.innerHTML = cells;
  main.querySelector('.cd').textContent = 'PID ' + proc.pid;
  main.querySelector('.nm').textContent = m.name;
  main.querySelector('.px').textContent = fmt(q.last, m.unit);
  main.querySelector('.ch').textContent = fmtDelta(q.delta, m.unit);
  main.addEventListener('click', () => selectCode(m.code));

  const star = document.createElement('button');
  star.type = 'button';
  star.className = 'star';
  star.dataset.fk = m.code + ':star';
  star.setAttribute('aria-pressed', 'true');
  star.setAttribute('aria-label', '移除自选 ' + m.name + ' PID ' + proc.pid);
  star.textContent = '★';
  star.addEventListener('click', () => toggleWatch(m, false));

  row.append(main, star);
  return row;
}

/** 我的自选：只有进程品种。加了自选才有持久历史，退出后历史也还在 */
function renderWatchlist() {
  const body = $('watchBody');
  const quotes = state.candles?.quotes ?? {};
  const items = state.catalog.filter((m) => m.board === 'proc');
  withFocusKept(body, () => {
    body.replaceChildren();
    for (const m of items) {
      const ref = procRef(m.code);
      const pid = ref?.pid ?? m.pid;
      body.appendChild(quoteRow(m, quotes[m.code] ?? { last: null, delta: null }, {
        pid, exited: !state.livePids.has(pid),
      }));
    }
    if (!items.length) {
      const p = document.createElement('p');
      p.className = 'wl-empty';
      p.innerHTML = '还没有自选进程。<br>在下方<b>个股列表</b>点 <b>☆</b> 收藏，' +
        '进程走势会被持续记录，重启后历史仍然在。';
      body.appendChild(p);
    }
  });
  $('wlCount').textContent = items.length + '/' + state.watchMax + ' 项';
}

/** 大盘行情：41 项系统指标，按板块分组 */
function renderMarket() {
  const body = $('marketBody');
  const quotes = state.candles?.quotes ?? {};
  const groups = new Map();
  for (const m of state.catalog) {
    if (m.board === 'proc') continue;
    if (!groups.has(m.board)) groups.set(m.board, []);
    groups.get(m.board).push(m);
  }
  let count = 0;
  withFocusKept(body, () => {
    body.replaceChildren();
    for (const [board, items] of groups) {
      const h = document.createElement('p');
      h.className = 'grp';
      h.textContent = '【' + (BOARD_NAMES[board] ?? board) + '】';
      body.appendChild(h);
      for (const m of items) {
        count += 1;
        body.appendChild(quoteRow(m, quotes[m.code] ?? { last: null, delta: null }, null));
      }
    }
  });
  $('mkCount').textContent = count + ' 项';
}

/** 加 / 移除自选。只有自选进程的采样值会写进 tick 落盘，移除后主图退回内存序列 */
async function toggleWatch(meta, on) {
  try {
    const d = await api('/api/watch', {
      method: 'POST',
      body: JSON.stringify({ op: on ? 'add' : 'remove', code: meta.code, name: meta.name, user: meta.user }),
    });
    state.catalog = d.catalog;
    state.byCode = new Map(d.catalog.map((m) => [m.code, m]));
    state.watchedCodes = new Set(d.watchCodes);
    await refreshProcs();
    // 必须重拉：quotes 的 key 集合跟着 catalog 走，不重拉的话刚加进来的进程
    // 在这一帧拿不到报价，列表上会一直挂着「—」。顺带把当前品种的历史来源也刷新了。
    await loadCandles();
    renderQuote();
    toast(on ? '已加自选 · ' + meta.name : '已移除自选 · ' + meta.name, 'info');
  } catch (e) {
    toast(e.code === 'watch_full'
      ? '自选已满，最多 ' + state.watchMax + ' 个进程'
      : '自选操作失败：' + (e.code ?? '未知错误'), 'error');
  }
}

// ---------------------------------------------------------------- 品种头与主图

function renderQuote() {
  const code = state.settings.selectedCode;
  const meta = metaOf(code);
  const q = state.quote;
  if (!meta || !q) return;
  $('qCode').textContent = meta.code;
  $('quote-h').textContent = meta.name;
  $('qLast').textContent = fmt(q.last, meta.unit);
  $('qLast').className = 'qval ' + dirOf(q.delta);
  $('qDelta').textContent = fmtDelta(q.delta, meta.unit);
  $('qDelta').className = 'qdelta ' + dirOf(q.delta);
  $('qPct').textContent = fmtPct(q.pct);
  $('qPct').className = 'qpct ' + dirOf(q.delta);
  $('qOpen').textContent = fmt(q.open, meta.unit);
  $('qHigh').textContent = fmt(q.high, meta.unit);
  $('qLow').textContent = fmt(q.low, meta.unit);
  $('qAvg').textContent = fmt(q.avg, meta.unit);

  // 进程品种要多说两件事：进程还在不在、收藏了没
  const ref = procRef(code);
  const tag = $('qTag');
  const btn = $('btnWatch');
  if (!ref) {
    tag.hidden = true;
    btn.hidden = true;
    return;
  }
  const on = state.watchedCodes.has(code);
  tag.hidden = false;
  tag.dataset.kind = state.alive ? 'proc' : 'exited';
  tag.textContent = state.alive ? 'PID ' + ref.pid : 'PID ' + ref.pid + ' 已退出';
  btn.hidden = false;
  btn.setAttribute('aria-pressed', String(on));
  btn.textContent = on ? '★ 已自选' : '☆ 加自选';
  btn.setAttribute('aria-label', (on ? '移除自选 ' : '加自选 ') + meta.name + ' PID ' + ref.pid);
}

function renderChart() {
  const meta = metaOf(state.settings.selectedCode);
  chart.render({
    bars: state.bars, ma5: state.ma5, ma10: state.ma10, ma20: state.ma20,
    memTotalGiB: state.memTotalGiB || state.snapshot?.totalMemGiB || 0,
    memSegments: state.memSegments,
  }, meta);
}

function renderPeriods() {
  const box = $('periodTabs');
  box.replaceChildren();
  state.periods.forEach((p, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pd';
    b.role = 'tab';
    b.textContent = p.label;
    b.setAttribute('aria-selected', String(i === state.settings.periodIndex));
    b.addEventListener('click', async () => {
      await patchSettings({ periodIndex: i });
      await loadCandles();
      renderPeriods();
    });
    box.appendChild(b);
  });
}

async function loadCandles() {
  const code = state.settings.selectedCode;
  const period = state.periods[state.settings.periodIndex]?.seconds ?? 5;
  const data = await api('/api/candles?code=' + encodeURIComponent(code) + '&period=' + period);
  state.candles = data;
  state.memTotalGiB = Number(data.memTotalGiB) || 0;
  state.bars = data.bars ?? [];
  state.ma5 = data.ma5 ?? [];
  state.ma10 = data.ma10 ?? [];
  state.ma20 = data.ma20 ?? [];
  state.quote = data.quote;
  state.alive = data.alive !== false;
  renderQuote();
  renderChart();
  renderIndex(data.index ?? []);
  renderWatchlist();
  renderMarket();
  renderMarquee(data.index ?? []);
}

async function selectCode(code) {
  if (code === state.settings.selectedCode) return;
  await patchSettings({ selectedCode: code });
  await loadCandles();
}

// ---------------------------------------------------------------- 主力动向 / 逐笔

function renderDepth(procs) {
  const list = $('depthList');
  list.replaceChildren();
  const top = [...procs].sort((a, b) => b.cpu - a.cpu).slice(0, 10);
  const max = top[0]?.cpu ?? 1;
  for (let i = 0; i < top.length; i += 1) {
    const p = top[i];
    const li = document.createElement('li');
    li.className = 'dr';
    li.innerHTML = '<span class="rk"></span><span class="nm"><span class="bar"></span><span></span></span><span class="vl up"></span>';
    li.querySelector('.rk').textContent = String(i + 1);
    li.querySelector('.bar').style.width = (max > 0 ? (p.cpu / max) * 100 : 0) + '%';
    li.querySelector('.nm span:last-child').textContent = p.name;
    li.querySelector('.vl').textContent = p.cpu.toFixed(1);
    li.setAttribute('aria-label', '第 ' + (i + 1) + ' 名 ' + p.name + '，CPU ' + p.cpu.toFixed(1) + '%');
    list.appendChild(li);
  }
}

function renderTape(events) {
  const list = $('tapeList');
  list.replaceChildren();
  for (const ev of events.slice(-80).reverse()) {
    list.appendChild(tapeRow(ev));
  }
  $('tapeCount').textContent = events.length + ' 条';
}

function tapeRow(ev) {
  const li = document.createElement('li');
  li.className = 'tp';
  const dir = ev.up ? 'up' : 'down';
  li.innerHTML = '<span class="tm"></span><span class="ev"></span><span class="vl ' + dir + '"></span>';
  li.querySelector('.tm').textContent = ev.time;
  li.querySelector('.ev').textContent = ev.label;
  li.querySelector('.vl').textContent = ev.value;
  return li;
}

// ---------------------------------------------------------------- 进程表

function sortProcs(rows) {
  const k = state.sortKey;
  const dir = state.sortDir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[k], bv = b[k];
    if (typeof av === 'string') return av.localeCompare(bv) * dir;
    return ((av ?? 0) - (bv ?? 0)) * dir;
  });
}

function renderProcs() {
  const body = $('procBody');
  const q = state.query.toLowerCase();
  let rows = state.allProcs.length ? state.allProcs : state.procs;
  if (q) rows = rows.filter((p) => p.name.toLowerCase().includes(q) || String(p.pid) === q);
  rows = sortProcs(rows).slice(0, 300);

  // 行会整批重建，焦点与滚动位置必须自己接住，否则键盘用户每 2 秒被弹回页首
  const focusedPid = document.activeElement?.closest?.('#procBody tr')?.dataset.pid ?? null;
  const scroller = body.closest('.proc-scroll');
  const keepTop = scroller?.scrollTop ?? 0;

  body.replaceChildren();
  for (const p of rows) {
    const tr = document.createElement('tr');
    tr.dataset.pid = String(p.pid);
    tr.dataset.killable = String(!!p.killable);
    tr.dataset.chart = String(p.code === state.settings.selectedCode);
    tr.tabIndex = 0;
    tr.setAttribute('aria-selected', String(state.selectedPid === p.pid));
    tr.innerHTML =
      '<td class="c-star"><button type="button" class="star"></button></td>' +
      '<td class="c-pid"></td><td class="c-name"></td><td class="c-user"></td>' +
      '<td class="c-num"></td><td class="c-num"></td><td class="c-num"></td><td class="c-num"></td>' +
      '<td class="c-spark"><canvas class="spark"></canvas></td>';
    const star = tr.querySelector('.star');
    star.textContent = p.watched ? '★' : '☆';
    star.setAttribute('aria-pressed', String(!!p.watched));
    star.setAttribute('aria-label', (p.watched ? '移除自选 ' : '加自选 ') + p.name + ' PID ' + p.pid);
    // 星标只管收藏，不能冒泡到行上，否则点收藏会顺带切主图
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      void toggleWatch(state.procMeta.get(p.code) ?? { code: p.code, name: p.name, user: p.user }, !p.watched);
    });

    const tds = tr.querySelectorAll('td');
    tds[1].textContent = String(p.pid);
    tds[2].textContent = p.name;
    tds[3].textContent = p.user;
    tds[4].textContent = p.cpu.toFixed(1);
    tds[5].textContent = p.mem.toFixed(1);
    tds[6].textContent = fmtRss(p.rss);
    tds[7].textContent = p.etime;
    const cv = tds[8].querySelector('canvas');
    cv.dataset.v = (p.spark ?? []).join(',');
    cv.dataset.u = (p.spark?.length ?? 0) > 1 && p.spark[p.spark.length - 1] >= p.spark[0] ? '1' : '0';

    const pick = () => selectProc(p);
    tr.addEventListener('click', pick);
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
    });
    body.appendChild(tr);
  }
  $('procEmpty').hidden = rows.length > 0;
  if (scroller) scroller.scrollTop = keepTop;
  if (focusedPid) body.querySelector('tr[data-pid="' + focusedPid + '"]')?.focus();
  requestAnimationFrame(() => {
    body.querySelectorAll('canvas.spark').forEach((cv) => {
      const vals = (cv.dataset.v ?? '').split(',').map(Number).filter(Number.isFinite);
      drawSpark(cv, vals, cv.dataset.u === '1');
    });
  });
}

function selectProc(p) {
  state.selectedPid = p.pid;
  const info = $('selInfo');
  const btn = $('btnKill');
  if (p.killable) {
    info.textContent = p.name + ' · PID ' + p.pid + ' · ' + p.user;
    btn.disabled = false;
  } else {
    const why = !p.owned ? '属主 ' + p.user + '，无权清仓' : '受保护进程，不可清仓';
    info.textContent = p.name + ' · ' + why;
    btn.disabled = true;
  }
  document.querySelectorAll('#procBody tr').forEach((tr) => {
    tr.setAttribute('aria-selected', String(Number(tr.dataset.pid) === p.pid));
  });
  saveView();
  // 个股列表里的每一行都是一个可看走势的品种，点行等于切主图
  if (p.code) void selectCode(p.code);
}

// ---------------------------------------------------------------- 跑马灯与状态栏

function renderMarquee(index) {
  const box = $('mq');
  const parts = index.map((i) => {
    const meta = i.meta ?? state.byCode.get(i.code);
    if (!meta) return '';
    const dir = dirOf(i.quote.delta);
    return '<span><span style="color:var(--mute)">' + meta.name + '</span> ' +
      '<span style="color:var(--fg)">' + fmt(i.quote.last, meta.unit) + '</span>' +
      '<b class="' + dir + '">' + fmtDelta(i.quote.delta, meta.unit) + '</b></span>';
  });
  box.innerHTML = parts.join('') + parts.join('');
}

function renderStatus() {
  const s = state.settings;
  $('stSample').textContent = (s.sampleMs / 1000).toFixed(s.sampleMs < 1000 ? 1 : 0) + 's' + (s.running ? '' : ' 暂停');
  $('stProcs').textContent = state.snapshot?.procCount ?? '—';
  $('stHistory').textContent = state.usage ? state.usage.hours + ' 小时' : '—';
  $('stDisk').textContent = state.usage ? fmtBytes(state.usage.bytes) : '—';
  $('stUser').textContent = state.currentUser;
}

// ---------------------------------------------------------------- 增量更新

function applyTick(tick, snapshot, freshEvents) {
  state.snapshot = snapshot;
  state.procs = snapshot.procs ?? [];
  if (state.procs.length) syncProcMeta(state.procs);

  // 当前品种的 K 线增量
  const code = state.settings.selectedCode;
  const meta = metaOf(code);
  const period = state.periods[state.settings.periodIndex]?.seconds ?? 5;
  const periodMs = period * 1000;

  // 进程退出后 livePids 里就没有它了，品种头要立刻从「PID xxx」翻成「已退出」
  const curRef = procRef(code);
  if (curRef && state.livePids.size > 0) {
    const alive = state.livePids.has(curRef.pid);
    if (alive !== state.alive) {
      state.alive = alive;
      renderQuote();
    }
  }

  let val = tick.v?.[code];
  if (val == null || !Number.isFinite(val)) {
    // 非自选进程的采样值不写进 tick（写进去就得落盘），只能从进程快照里现取。
    // 不取的话点开任何一个进程，主图都是一条不动的线。
    const ref = procRef(code);
    if (ref) {
      const row = state.procs.find((x) => x.pid === ref.pid)
        ?? state.allProcs.find((x) => x.pid === ref.pid);
      if (row && Number.isFinite(row.cpu)) val = row.cpu;
    }
  }
  let dirty = false;
  if (meta && val != null && Number.isFinite(val)) {
    const key = Math.floor(tick.t / periodMs) * periodMs;
    const last = state.bars[state.bars.length - 1];
    if (last && last.t === key) {
      last.h = Math.max(last.h, val);
      last.l = Math.min(last.l, val);
      last.c = val;
      last.v += tick.w ?? 0;
    } else {
      state.bars.push({ t: key, o: val, h: val, l: val, c: val, v: tick.w ?? 0, n: 1, mem: null });
      if (state.bars.length > state.maxBars) state.bars.shift();
    }
    const closes = state.bars.map((b) => b.c);
    state.ma5 = movingAverage(closes, 5);
    state.ma10 = movingAverage(closes, 10);
    state.ma20 = movingAverage(closes, 20);

    const q = state.quote ?? {};
    q.last = val;
    if (q.open == null) q.open = val;
    q.high = q.high == null ? val : Math.max(q.high, val);
    q.low = q.low == null ? val : Math.min(q.low, val);
    q.delta = val - q.open;
    q.pct = q.open === 0 ? null : (q.delta / Math.abs(q.open)) * 100;
    state.quote = q;
    renderQuote();
    dirty = true;
  }

  // 副图内存与 K 线共用时间轴，每拍把最新的内存构成贴到当前这根柱子上
  const curBar = state.bars[state.bars.length - 1];
  const mem = readMem(tick.v);
  if (mem && curBar) {
    curBar.mem = mem;
    dirty = true;
  }
  if (dirty) renderChart();

  // 全量品种头：自选列表 40+ 项都要跟着 tick 走
  const quotes = state.candles?.quotes ?? {};
  for (const code in tick.v) {
    const q = quotes[code];
    const v = tick.v[code];
    if (q == null || v == null || !Number.isFinite(v)) continue;
    q.last = v;
    if (q.open == null) q.open = v;
    q.delta = v - q.open;
    q.pct = q.open === 0 ? null : (q.delta / Math.abs(q.open)) * 100;
  }
  const idx = state.candles?.index ?? [];
  for (const item of idx) {
    const v = tick.v?.[item.code];
    if (v == null) continue;
    item.spark.push(v);
    if (item.spark.length > 48) item.spark.shift();
  }
  renderIndex(idx);
  renderWatchlist();
  renderMarket();
  renderMarquee(idx);
  renderDepth(state.procs);
  // 个股列表要全量行和当前搜索词，SSE 快照只带 top N，所以另拉；限流 2 秒
  // 拉到新数据才重绘：每秒重建 300 行会把键盘焦点和滚动位置反复清掉
  if (tick.t - state.procFetchAt > 2000) {
    state.procFetchAt = tick.t;
    void refreshProcs();
  }
  renderStatus();

  if (freshEvents?.length) {
    state.events.push(...freshEvents);
    if (state.events.length > 500) state.events.splice(0, state.events.length - 500);
    const list = $('tapeList');
    for (const ev of freshEvents) list.prepend(tapeRow(ev));
    while (list.children.length > 80) list.lastElementChild.remove();
    $('tapeCount').textContent = state.events.length + ' 条';
  }
}

function movingAverage(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

// ---------------------------------------------------------------- SSE

function connect() {
  if (state.es) state.es.close();
  const es = new EventSource('/api/stream');
  state.es = es;
  es.addEventListener('open', () => setLive('on', '实时采样'));
  es.addEventListener('tick', (e) => {
    try {
      const d = JSON.parse(e.data);
      if (d.tick) applyTick(d.tick, d.snapshot, d.events ?? []);
    } catch (err) {
      console.error('[kurumi] applyTick failed', err);
    }
  });
  es.addEventListener('error', () => setLive('off', '连接中断，重试中'));
}

function setLive(kind, text) {
  const el = document.querySelector('.live');
  el.dataset.state = kind;
  $('liveText').textContent = text;
}

// ---------------------------------------------------------------- 清仓

async function openKillDialog() {
  const pid = state.selectedPid;
  if (pid == null) return;
  let pre;
  try {
    pre = await api('/api/kill/preflight', { method: 'POST', body: JSON.stringify({ pid }) });
  } catch (e) {
    toast('无法校验目标进程：' + (e.code ?? '请求失败'), 'error');
    return;
  }
  if (!pre.ok) {
    toast('该进程不可清仓：' + killReason(pre.reason), 'error');
    return;
  }
  $('cfBody').innerHTML = '即将终止 <strong>' + pre.name + '</strong>（PID <strong>' + pre.pid +
    '</strong>，属主 <strong>' + pre.user + '</strong>），当前 CPU <strong>' +
    (pre.cpu ?? 0).toFixed(1) + '%</strong>，常驻内存 <strong>' + fmtRss(pre.rss) + '</strong>。';
  $('cfForce').checked = false;
  const dlg = $('confirmDlg');
  dlg.returnValue = '';
  dlg.showModal();
  dlg.addEventListener('close', async () => {
    if (dlg.returnValue !== 'confirm') return;
    const force = $('cfForce').checked;
    try {
      const r = await api('/api/kill', { method: 'POST', body: JSON.stringify({ pid, force }) });
      toast('已向 ' + r.name + ' (PID ' + r.pid + ') 发送 ' + r.signal, 'info');
      state.selectedPid = null;
      $('selInfo').textContent = '未选中';
      $('btnKill').disabled = true;
      setTimeout(refreshProcs, 400);
    } catch (e) {
      toast('清仓失败：' + killReason(e.code), 'error');
    }
  }, { once: true });
}

function killReason(code) {
  return {
    not_owned: '进程不属于当前用户',
    protected: '受保护进程，不能终止',
    not_found: '进程已不存在',
    invalid_pid: 'PID 不合法',
    not_permitted: '系统拒绝该操作',
    gone: '进程已经退出',
    kill_failed: '发送信号失败',
  }[code] ?? '未知错误';
}

async function refreshProcs() {
  try {
    const q = state.query ? '&q=' + encodeURIComponent(state.query) : '';
    const d = await api('/api/procs?t=' + Date.now() + q);
    state.allProcs = d.procs;
    syncProcMeta(d.procs);
    // 搜索会把结果过滤掉，存活判断只能在无搜索词时更新，否则自选区会误标「已退出」
    if (!state.query) state.livePids = new Set(d.procs.map((p) => p.pid));
    renderProcs();
  } catch (err) {
    console.error('[kurumi] refreshProcs failed', err);
  }
}

// ---------------------------------------------------------------- 视图状态

function saveView() {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({
      query: state.query, sortKey: state.sortKey, sortDir: state.sortDir,
      selectedPid: state.selectedPid,
      procScroll: document.querySelector('.proc-scroll')?.scrollTop ?? 0,
      wlScroll: document.querySelector('#watchlist .wl-scroll')?.scrollTop ?? 0,
      mkScroll: document.querySelector('.market .wl-scroll')?.scrollTop ?? 0,
    }));
  } catch { /* 存储不可用时忽略 */ }
}

function restoreView() {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) return;
    const v = JSON.parse(raw);
    state.query = v.query ?? '';
    state.sortKey = v.sortKey ?? 'cpu';
    state.sortDir = v.sortDir ?? 'desc';
    state.selectedPid = v.selectedPid ?? null;
    $('procSearch').value = state.query;
    requestAnimationFrame(() => {
      const ps = document.querySelector('.proc-scroll');
      const ws = document.querySelector('#watchlist .wl-scroll');
      const ms = document.querySelector('.market .wl-scroll');
      if (ps && v.procScroll) ps.scrollTop = v.procScroll;
      if (ws && v.wlScroll) ws.scrollTop = v.wlScroll;
      if (ms && v.mkScroll) ms.scrollTop = v.mkScroll;
    });
  } catch { /* 数据损坏时用默认值 */ }
}

// ---------------------------------------------------------------- 事件绑定

function bind() {
  $('btnTheme').addEventListener('click', async () => {
    const order = ['auto', 'dark', 'light'];
    const next = order[(order.indexOf(state.settings.theme) + 1) % order.length];
    await patchSettings({ theme: next });
    applyTheme();
  });
  $('btnScheme').addEventListener('click', async () => {
    await patchSettings({ colorScheme: state.settings.colorScheme === 'redUp' ? 'greenUp' : 'redUp' });
    applyTheme();
  });
  $('btnRun').addEventListener('click', async () => {
    const next = !state.settings.running;
    await patchSettings({ running: next });
    $('btnRun').textContent = next ? '暂停' : '继续';
    $('btnRun').setAttribute('aria-pressed', String(next));
    setLive(next ? 'on' : 'off', next ? '实时采样' : '已暂停');
  });
  $('btnKill').addEventListener('click', openKillDialog);
  $('btnWatch').addEventListener('click', () => {
    const code = state.settings.selectedCode;
    const meta = metaOf(code);
    if (meta) void toggleWatch(meta, !state.watchedCodes.has(code));
  });

  const sel = $('sampleSel');
  sel.replaceChildren();
  for (const ms of state.sampleTiers) {
    const o = document.createElement('option');
    o.value = String(ms);
    o.textContent = ms < 1000 ? (ms / 1000).toFixed(1) + 's' : (ms / 1000) + 's';
    if (ms === state.settings.sampleMs) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', async () => {
    await patchSettings({ sampleMs: Number(sel.value) });
    renderStatus();
  });

  $('procSearch').addEventListener('input', (e) => {
    state.query = e.target.value.trim();
    refreshProcs();
    saveView();
  });

  document.querySelectorAll('.ptable th button[data-sort]').forEach((b) => {
    b.addEventListener('click', () => {
      const k = b.dataset.sort;
      if (state.sortKey === k) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else { state.sortKey = k; state.sortDir = 'desc'; }
      document.querySelectorAll('.ptable th').forEach((th) => th.removeAttribute('aria-sort'));
      b.closest('th').setAttribute('aria-sort', state.sortDir === 'asc' ? 'ascending' : 'descending');
      renderProcs();
      saveView();
    });
  });

  $('btnSettings').addEventListener('click', () => {
    $('setTheme').value = state.settings.theme;
    $('setScheme').value = state.settings.colorScheme;
    $('setRetention').value = String(state.settings.retentionHours);
    $('setUsage').textContent = '历史占用 ' + fmtBytes(state.usage?.bytes ?? 0) +
      ' · ' + (state.usage?.hours ?? 0) + ' 个分片 · ' + (state.host?.cores ?? '?') + ' 核 · ' +
      (state.host?.arch ?? '');
    $('settingsDlg').showModal();
  });
  $('setTheme').addEventListener('change', async (e) => {
    await patchSettings({ theme: e.target.value });
    applyTheme();
  });
  $('setScheme').addEventListener('change', async (e) => {
    await patchSettings({ colorScheme: e.target.value });
    applyTheme();
  });
  $('setRetention').addEventListener('change', async (e) => {
    await patchSettings({ retentionHours: Number(e.target.value) });
    state.usage = (await api('/api/bootstrap')).usage;
    renderStatus();
  });

  // 页面可能被 Host 回收后重建，隐藏时立刻保存视图状态
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveView();
  });
  $('whClose').addEventListener('click', () => {
    try { sessionStorage.setItem(HINT_KEY, '1'); } catch { /* 隐私模式下写不进去 */ }
    updateWideHint();
  });
  window.addEventListener('resize', () => {
    updateWideHint();
    clearTimeout(bind._rt);
    bind._rt = setTimeout(() => { chart.paint(); repaintSparks(); }, 140);
  });
  // 系统主题变化时，auto 模式要跟着重画
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.settings.theme === 'auto') applyTheme();
  });
}

// ---------------------------------------------------------------- 窄屏引导

function updateWideHint() {
  const el = $('wideHint');
  if (!el) return;
  let dismissed = false;
  try { dismissed = sessionStorage.getItem(HINT_KEY) === '1'; } catch { /* 读不到就当没关过 */ }
  el.hidden = window.innerWidth >= LAYOUT_MIN_WIDTH || dismissed;
}

// ---------------------------------------------------------------- 启动

async function boot() {
  const d = await api('/api/bootstrap');
  state.catalog = d.catalog;
  state.byCode = new Map(d.catalog.map((m) => [m.code, m]));
  state.watchedCodes = new Set(d.watchCodes ?? []);
  state.watchMax = d.watchMax ?? 20;
  state.settings = d.settings;
  state.periods = d.periods;
  state.sampleTiers = d.sampleTiers;
  state.maxBars = d.maxBars;
  state.currentUser = d.currentUser;
  state.host = d.host;
  state.snapshot = d.snapshot;
  state.events = d.events ?? [];
  state.usage = d.usage;
  state.todayStart = d.todayStart;
  state.memSegments = d.memSegments ?? [];

  state.candles = d.candles;
  state.memTotalGiB = Number(d.candles.memTotalGiB) || 0;
  state.bars = d.candles.bars ?? [];
  state.ma5 = d.candles.ma5 ?? [];
  state.ma10 = d.candles.ma10 ?? [];
  state.ma20 = d.candles.ma20 ?? [];
  state.quote = d.candles.quote;
  state.alive = d.candles.alive !== false;

  restoreView();
  applyTheme();
  renderPeriods();
  renderQuote();
  renderChart();
  renderIndex(d.candles.index ?? []);
  renderWatchlist();
  renderMarket();
  renderMarquee(d.candles.index ?? []);
  renderTape(state.events);
  renderStatus();
  $('btnRun').textContent = state.settings.running ? '暂停' : '继续';
  $('btnRun').setAttribute('aria-pressed', String(state.settings.running));
  bind();
  updateWideHint();
  await refreshProcs();
  // 存活判断依赖进程表，首帧自选区全是「已退出」，拿到真实 pid 集合后重绘
  renderWatchlist();
  connect();

  state.clockTimer = setInterval(() => {
    const now = new Date();
    const p = (n) => String(n).padStart(2, '0');
    $('clock').textContent = p(now.getHours()) + ':' + p(now.getMinutes()) + ':' + p(now.getSeconds());
    $('clock').dateTime = now.toISOString();
  }, 1000);
}

boot().catch((e) => {
  setLive('off', '启动失败');
  toast('启动失败：' + (e?.code ?? e?.message ?? '未知错误'), 'error');
});
