// 主界面：顶栏、状态条、左栏（搜索 / 收藏夹 / 筛选 / 项目列表）、右栏详情
import { S, on, savePrefs } from './state.js';
import { h, icon, fmtNum, timeAgo, langColor, markTerms, markRanges, debounce, fill, popover, splitName } from './ui.js';
import * as A from './actions.js';
import { openImport, openAdd, openSettings, openCollections, openManager, importForm } from './view-dialogs.js';
import { mountDetail } from './view-detail.js';

const el = {};
let onboardForm = null;
let dismissed = '';
let closeScopes = null; // 搜索范围弹层开着时，这里是它的关闭函数
const SCOPES = [
  ['name', '名称', '项目名和简介'],
  ['readme', 'README', '只能搜到已经缓存的项目'],
  ['notes', '备注', '你和 AI 写的备注'],
];

const btn = (cls, ico, label, onclick, aria) =>
  h('button.btn' + (cls ? '.' + cls.split(' ').join('.') : ''), { type: 'button', onclick, 'aria-label': aria || label || undefined, title: aria || label || undefined }, icon(ico), label ? h('span', null, label) : null);

export function mountMain(app) {
  el.sub = h('p', null, '读取你的 Star，用大白话讲清每个项目');
  el.strip = h('div.strip', { hidden: true });
  el.coll = h('select', { 'aria-label': '按收藏夹筛选' }); // 收藏夹再多也是一个下拉，不会横着挤成一排
  el.coll.addEventListener('change', () => A.setCollection(el.coll.value));
  el.q = h('input', { type: 'search', 'aria-label': '搜索项目', autocomplete: 'off', spellcheck: 'false', 'aria-keyshortcuts': '/' });
  el.q.value = S.q;
  el.clear = h('button.btn.ghost.icon.sm.clear', { type: 'button', 'aria-label': '清空搜索', hidden: !S.q, onclick: () => setQuery('') }, icon('x'));
  el.scopeBtn = h('button.btn.ghost.icon.sm.scopebtn', { type: 'button', 'aria-haspopup': 'dialog', onclick: (e) => toggleScopes(e.currentTarget) }, icon('filter'));
  el.sort = h('select', { 'aria-label': '排序' });
  for (const [v, t] of [['starred', '最近 Star'], ['stars', 'Star 最多'], ['pushed', '最近更新'], ['recent', '最近加入'], ['name', '名称']]) el.sort.append(h('option', { value: v }, t));
  el.sort.value = S.sort;
  el.lang = h('select', { 'aria-label': '按语言筛选' });
  el.status = h('select', { 'aria-label': '按状态筛选' });
  for (const [v, t] of [['all', '全部状态'], ['explained', '已讲解'], ['unexplained', '还没讲解'], ['noted', '有备注']]) el.status.append(h('option', { value: v }, t));
  el.status.value = S.status;
  el.listhead = h('div.listhead');
  el.list = h('ul.list');
  el.more = h('div.loadmore', { hidden: true });
  el.toolbar = h('div.toolbar', null,
    h('div.field', null, icon('search'), el.q, h('div.ftools', null, el.clear, el.scopeBtn)),
    h('div.coll-row', null, el.coll, btn('ghost icon sm', 'edit', '', openCollections, '管理收藏夹')),
    h('div.filters', null, el.sort, el.lang, el.status),
  );
  el.scroller = h('div.scroller', null, el.listhead, el.list, el.more);
  el.listpane = h('main.pane.listpane', { id: 'listpane' }, el.toolbar, el.scroller);
  el.detail = h('section.pane.detail', { id: 'detailpane', 'aria-label': '项目详情' });

  const doSearch = debounce(() => {
    S.q = el.q.value;
    savePrefs();
    el.clear.hidden = !el.q.value;
    A.loadList();
  }, 220);
  el.q.addEventListener('input', doSearch);
  el.q.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.q.value) {
      e.stopPropagation();
      setQuery('');
    }
  });
  el.sort.addEventListener('change', () => { S.sort = el.sort.value; savePrefs(); A.loadList(); });
  el.lang.addEventListener('change', () => { S.language = el.lang.value; markFilters(); savePrefs(); A.loadList(); });
  el.status.addEventListener('change', () => { S.status = el.status.value; markFilters(); savePrefs(); A.loadList(); });

  app.append(
    h('header.topbar', null,
      h('div.brand', null, h('div.brand-mark', null, icon('star')), h('h1', null, 'GitHub 收藏夹'), el.sub),
      h('div.top-actions', null,
        btn('primary', 'download', '导入 Star', openImport),
        btn('', 'plus', '添加项目', openAdd),
        btn('', 'sparkles', 'AI 整理', openManager),
        btn('ghost icon', 'sliders', '', openSettings, '设置'),
      ),
    ),
    el.strip,
    h('div.layout', null, el.listpane, el.detail),
  );
  mountDetail(el.detail);

  on('state', () => { renderTop(); renderColl(); renderStrip(); renderLang(); if (!S.list.items.length) renderList(); onboardForm?.render(); });
  on('import', () => { renderStrip(); onboardForm?.render(); });
  on('prefetch', renderStrip);
  on('sse', renderStrip);
  on('list', () => { renderList(); renderLang(); });
  on('filters', () => { renderColl(); });
  on('pane', applyPane);
  // 没有选中项目时一定回到列表，免得窄屏卡在空的详情页里
  on('sel', () => { if (!S.sel) S.pane = 'list'; applyPane(); });
  renderScopes();
  markFilters();
  renderTop();
  renderColl();
  renderLang();
  renderList();
  document.body.dataset.pane = S.pane;

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      el.q.focus();
      el.q.select();
    }
  });
}

// 窄屏一次只显示一栏。列表被收起来的时候浏览器会把它的滚动位置清零，所以收起前先记下，回来时放回去。
let listTop = 0;
const listScroller = () => (getComputedStyle(el.scroller).overflowY === 'visible' ? el.listpane : el.scroller); // 窗口矮时整栏一起滚（见 style.css 的 max-height 规则）
function applyPane() {
  const wasHidden = getComputedStyle(el.listpane).display === 'none';
  if (!wasHidden) listTop = listScroller().scrollTop;
  document.body.dataset.pane = S.pane;
  if (wasHidden && getComputedStyle(el.listpane).display !== 'none') listScroller().scrollTop = listTop;
}

function setQuery(v) {
  el.q.value = v;
  el.clear.hidden = !v;
  S.q = v;
  savePrefs();
  A.loadList();
}

// 搜索框右边的小按钮：点开选「在哪些地方找」。再点一次收起。
function toggleScopes(anchor) {
  if (closeScopes) {
    closeScopes();
    return;
  }
  const rows = SCOPES.map(([k, name, hint]) => {
    const cb = h('input', { type: 'checkbox', checked: S.scopes[k] });
    cb.addEventListener('change', () => {
      const next = { ...S.scopes, [k]: cb.checked };
      if (!next.name && !next.readme && !next.notes) {
        cb.checked = true; // 至少留一个地方可搜
        return;
      }
      S.scopes = next;
      savePrefs();
      renderScopes();
      if (S.q.trim()) A.loadList();
    });
    return h('label', null, cb, h('span', null, h('b', null, name), h('span.hint', null, hint)));
  });
  anchor.setAttribute('aria-expanded', 'true');
  closeScopes = popover(anchor, h('div.scopes', null, h('div.hint', { style: 'padding:4px 10px 6px;margin:0' }, '在哪些地方找关键词'), rows), {
    label: '搜索范围',
    align: 'end',
    onClose: () => {
      closeScopes = null;
      anchor.removeAttribute('aria-expanded');
    },
  });
}

// 范围不是「全选」时，按钮上亮一个点，搜索框的提示也跟着变，免得忘了自己限制过范围
function renderScopes() {
  const names = SCOPES.filter(([k]) => S.scopes[k]).map(([, n]) => n);
  const all = names.length === SCOPES.length;
  const tip = '搜索范围：' + (all ? '名称、README、备注' : names.join('、'));
  el.q.placeholder = all ? '搜索项目名、README、备注…' : '只搜' + names.join('、') + '…';
  el.scopeBtn.classList.toggle('on', !all);
  el.scopeBtn.title = tip;
  el.scopeBtn.setAttribute('aria-label', tip);
}

// 语言、状态筛选不是默认值时，下拉框变成强调色，一眼看出当前有筛选
function markFilters() {
  el.lang.classList.toggle('on', Boolean(S.language));
  el.status.classList.toggle('on', S.status !== 'all');
}

function renderTop() {
  const t = S.st?.totals;
  el.sub.textContent = '读取你的 Star，用大白话讲清每个项目';
  if (t && t.projects) {
    const bits = [t.projects + ' 个项目'];
    bits.push('README ' + t.withReadme);
    bits.push('云讲解 ' + t.explainedCloud + ' · 本地讲解 ' + t.explainedLocal);
    el.sub.textContent = bits.join(' · ');
  }
}

function renderColl() {
  const cols = S.st?.collections || [];
  const total = S.st?.totals.projects || 0;
  fill(el.coll, h('option', { value: 'all' }, '全部收藏夹（' + total + '）'), ...cols.map((c) => h('option', { value: c.id }, c.name + '（' + c.count + '）')));
  el.coll.value = S.collection;
  if (el.coll.value !== S.collection) el.coll.value = 'all'; // 选中的那个收藏夹已经不存在了
  el.coll.classList.toggle('on', el.coll.value !== 'all'); // 筛着某个收藏夹时变成强调色，一眼看出
}

function renderLang() {
  const langs = S.list.languages || [];
  const cur = S.language;
  fill(el.lang, h('option', { value: '' }, '全部语言'), ...langs.map(([name, n]) => h('option', { value: name }, name + '（' + n + '）')));
  if (cur && !langs.some(([n]) => n === cur)) el.lang.append(h('option', { value: cur }, cur));
  el.lang.value = cur;
  markFilters();
}

function renderStrip() {
  const st = S.st;
  const s = el.strip;
  const hide = () => {
    s.hidden = true;
    s.className = 'strip';
  };
  if (!st) return hide();
  const imp = st.import || {};
  const pre = st.prefetch || {};
  const set = (cls, ...kids) => {
    s.className = 'strip' + (cls ? ' ' + cls : '');
    s.hidden = false;
    s.setAttribute('role', cls === 'err' ? 'alert' : 'status');
    fill(s, ...kids);
  };
  const dismiss = (text) => h('button.btn.ghost.icon.sm', { type: 'button', 'aria-label': '关闭提示', onclick: () => { dismissed = text; renderStrip(); } }, icon('x'));
  if (imp.status === 'error' && dismissed !== imp.error) {
    return set('err', icon('alert'), h('span.grow', null, '导入没成功：' + imp.error), btn('sm', 'refresh', '重试', () => A.startImport(st.settings.githubUser || '')), dismiss(imp.error));
  }
  if (imp.status === 'running') {
    const pct = imp.total ? Math.min(100, Math.round((imp.fetched / imp.total) * 100)) : null;
    return set('', h('span.grow', null, '正在读取 Star… 已读 ' + imp.fetched + (imp.total ? ' / ' + imp.total : '') + ' 个'), pct !== null ? h('div.bar', null, h('i', { style: 'width:' + pct + '%' })) : null, btn('sm', 'stop', '取消', () => A.cancelImport()));
  }
  if (pre.status === 'running') {
    const pct = pre.total ? Math.round((pre.done / pre.total) * 100) : 0;
    return set('', h('span.grow', null, '正在缓存 README（' + pre.done + ' / ' + pre.total + '），缓存好的就能按内容搜索'), h('div.bar', null, h('i', { style: 'width:' + pct + '%' })), btn('sm', 'stop', '停止', () => A.cancelPrefetch()));
  }
  if (pre.status === 'error' && dismissed !== pre.error) {
    return set('warn', icon('alert'), h('span.grow', null, 'README 没缓存完：' + pre.error), btn('sm', 'refresh', '继续', () => A.startPrefetch()), dismiss(pre.error));
  }
  if (S.stateError && dismissed !== S.stateError) {
    return set('err', icon('alert'), h('span.grow', null, S.stateError), btn('sm', 'refresh', '重试', () => A.refreshAll()), dismiss(S.stateError));
  }
  if (S.sseDown) {
    return set('warn', icon('alert'), h('span.grow', null, '实时更新断开了，正在重连。AI 已经在做的事不受影响，只是进度要晚几秒才显示。'), btn('sm', 'refresh', '刷新', () => A.refreshAll()));
  }
  if (st.agent && !st.agent.available && dismissed !== 'agent') {
    return set('warn', icon('alert'), h('span.grow', null, st.agent.reason + '。导入、搜索、备注、收藏夹照常可用。'), dismiss('agent'));
  }
  if (st.totals.projects > st.totals.withReadme && st.totals.projects > 0 && pre.status !== 'running' && imp.status !== 'running' && dismissed !== 'readme') {
    return set('', h('span.grow', null, 'README 还没缓存完（' + st.totals.withReadme + ' / ' + st.totals.projects + '），没缓存的项目搜不到 README 里的内容'), btn('sm', 'download', '继续缓存', () => A.startPrefetch()), dismiss('readme'));
  }
  hide();
}

function renderList() {
  const L = S.list;
  const pane = listScroller();
  const top = pane.scrollTop;
  const names = new Map((S.st?.collections || []).map((c) => [c.id, c.name]));
  const parts = [];
  if (L.loaded) {
    const filters = [];
    if (S.q.trim()) filters.push('搜索「' + S.q.trim() + '」');
    if (S.collection !== 'all') filters.push('收藏夹「' + (names.get(S.collection) || '') + '」');
    if (S.language) filters.push(S.language);
    fill(el.listhead, h('span', null, '共 ' + L.total + ' 个' + (filters.length ? ' · ' + filters.join(' · ') : '')), L.loading ? h('span.badge.busy', null, '加载中') : null);
  } else fill(el.listhead, );
  onboardForm = null;
  // 一个项目都没有（而且不是被搜索 / 筛选筛没的）：整页只留「先导入」这一件事
  const noProjects = L.loaded && !L.items.length && !L.error && Boolean(S.st) && (S.st.totals.projects || 0) === 0 && !S.q.trim() && S.collection === 'all' && !S.language && S.status === 'all';
  if (noProjects) document.body.dataset.welcome = '1';
  else delete document.body.dataset.welcome;
  if (!L.loaded) {
    for (let i = 0; i < 4; i += 1) parts.push(h('li', null, h('div.skeleton')));
  } else if (L.error && !L.items.length) {
    parts.push(h('li', null, h('div.notice.err', { style: 'margin:12px 4px' }, icon('alert'), h('div', null, h('div', null, L.error), h('button.btn.sm', { type: 'button', style: 'margin-top:8px', onclick: () => A.loadList() }, icon('refresh'), '重试')))));
  } else if (!L.items.length) {
    if (noProjects) {
      onboardForm = importForm();
      parts.push(h('li', null, h('div.empty', { style: 'text-align:left' },
        h('div.brand-mark.lg', null, icon('star')),
        h('h2', { style: 'text-align:center' }, '先把你的 Star 导进来'),
        h('p', { style: 'text-align:center' }, '导进来之后，点任何一个项目，AI 会用大白话讲清楚它是干什么的。'),
        onboardForm.el,
        h('div', { style: 'text-align:center;margin-top:14px' }, h('span.hint', null, '也可以只加一个：'), ' ', btn('sm', 'plus', '添加项目', openAdd)),
      )));
    } else {
      parts.push(h('li', null, h('div.empty', null,
        h('h2', null, S.q.trim() ? '没找到「' + S.q.trim() + '」' : '这里还没有项目'),
        h('p', null, S.q.trim() ? '试试少写几个词，或者点搜索框右边的按钮，多选几个地方找。README 只能搜到已经缓存的项目。' : S.collection !== 'all' ? '这个收藏夹是空的。在项目详情里点「加入收藏夹」，或者让 AI 来整理。' : '换个筛选条件试试。'),
        S.q.trim() || S.language || S.status !== 'all' ? h('button.btn.sm', { type: 'button', onclick: () => { el.q.value = ''; el.clear.hidden = true; S.q = ''; S.language = ''; S.status = 'all'; el.status.value = 'all'; markFilters(); savePrefs(); A.loadList(); } }, '清除搜索和筛选') : null,
      )));
    }
  } else {
    for (const it of L.items) parts.push(h('li', null, card(it)));
  }
  fill(el.list, ...parts);
  const more = L.items.length < L.total;
  el.more.hidden = !more;
  if (more) fill(el.more, h('button.btn', { type: 'button', disabled: L.loading, onclick: () => A.loadList({ append: true }) }, '再加载 ' + Math.min(50, L.total - L.items.length) + ' 个（还剩 ' + (L.total - L.items.length) + '）'));
  pane.scrollTop = top;
}

const WHERE = { name: '名称', readme: 'README', notes: '备注' };
function card(it) {
  const terms = S.list.terms || [];
  const [owner, name] = splitName(it.fullName);
  const badges = [];
  if (it.busy) badges.push(h('span.badge.busy', null, it.busy === 'explain' ? '讲解中' : it.busy === 'notes' ? '记备注中' : it.busy === 'message' ? '回复中' : '处理中'));
  if (it.explained.cloud) badges.push(h('span.badge.cloud', null, icon('cloud'), '云讲解'));
  if (it.explained.local) badges.push(h('span.badge.local', null, icon('code'), '本地讲解'));
  if (it.noteCount) badges.push(h('span.badge', { title: it.noteCount + ' 条备注' }, icon('pencil'), it.noteCount));
  if (it.archived) badges.push(h('span.badge.warn', null, '已归档'));
  let snip = null;
  if (it.match && terms.length) {
    const hit = Object.keys(it.match.where).filter((k) => it.match.where[k]).map((k) => WHERE[k]);
    if (hit.length) badges.push(h('span.badge', { title: '关键词出现在：' + hit.join('、') }, '命中 ' + hit.join('、')));
    if (it.match.snippet) snip = h('div.snip', null, h('b', null, WHERE[it.match.snippet.scope] + '：'), markRanges(it.match.snippet.text, it.match.snippet.ranges));
  }
  return h('button.card', { type: 'button', title: it.fullName, 'aria-current': it.key === S.sel, onclick: () => A.selectProject(it.key), dataset: { key: it.key } },
    h('div.t', null,
      h('span.nm', null, owner ? h('span.o', null, markTerms(owner, terms), ' / ') : null, h('b', null, markTerms(name, terms))),
      h('span.stars', { title: it.stars + ' 个 Star' }, icon('star'), fmtNum(it.stars)),
    ),
    it.description ? h('div.d', null, markTerms(it.description, terms)) : null,
    h('div.m', null,
      it.language ? h('span', null, h('i.dot', { style: 'background:' + langColor(it.language) }), it.language) : null,
      it.pushedAt ? h('span', null, timeAgo(it.pushedAt) + '更新') : null,
      badges,
    ),
    snip,
  );
}
