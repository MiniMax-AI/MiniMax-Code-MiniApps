// 项目详情：头部、讲解、README、备注、追问、信息
import { S, on } from './state.js';
import { h, icon, toast, fmtNum, timeAgo, fmtDate, fmtDuration, fmtSize, langColor, markTerms, popover, copyText, confirmDialog, fill, splitName, info } from './ui.js';
import { renderMarkdown, handleAnchorClick } from './md.js';
import * as A from './actions.js';

let host = null;
let V = null;
const drafts = { note: new Map(), chat: new Map() };
const openLive = new Set();

const TABS = [
  ['explain', 'sparkles', '讲解'],
  ['readme', 'book', 'README'],
  ['notes', 'pencil', '备注'],
  ['chat', 'message', '追问'],
  ['info', 'info', '信息'],
];

export function mountDetail(el) {
  host = el;
  on('sel', () => {
    V = null;
    renderDetail();
  });
  on('detail', renderDetail);
  on('calls', () => {
    if (!V || !S.detail) return;
    updateRuns();
    updateChoices();
    if (V.tab === 'explain') fillExplain();
    if (V.tab === 'chat') fillChat();
    updateTabs();
  });
  on('tab', () => {
    if (V && S.detail) {
      updateTabs();
      buildPanel(S.tab);
    }
  });
  on('readme', (key) => {
    if (V && key === V.key && V.tab === 'readme') fillReadme();
  });
  on('state', () => {
    if (V && S.detail) {
      updateChoices();
      updateHead();
      if (V.tab === 'readme') fillReadme();
    }
  });
  renderDetail();
}

// ---------- 进度卡（AI 整理的弹窗也用它）----------
export function runCard(c, { onCancel, onPermission }) {
  const title = c.kind === 'explain' ? (c.mode === 'local' ? '本地讲解' : '云讲解') : c.kind === 'message' ? '回复追问' : c.kind === 'notes' ? 'AI 记备注' : c.kind === 'manager' ? 'AI 整理' : 'AI 任务';
  const waiting = c.status === 'waiting_permission';
  const phase = c.status === 'queued' ? (c.queuePosition ? '排队中（第 ' + c.queuePosition + ' 位）' : '排队中') : waiting ? '等你确认' : c.phase || '处理中';
  const bits = [];
  if (c.activity && !waiting) bits.push(c.activity);
  if (c.toolCount) bits.push('用了 ' + c.toolCount + ' 次工具' + (c.toolFails ? '（' + c.toolFails + ' 次失败）' : ''));
  if (c.model) bits.push(String(c.model).replace(/^.*\//, ''));
  const perm = c.pendingPermission;
  const el = h('div.run', { role: 'status' },
    h('div.head', null,
      waiting ? icon('alert') : h('span.spinner'),
      h('span.title', null, title + ' · ' + phase),
      h('span.hint.mono', { dataset: { elapsed: String(c.startedAt || Date.now()) } }),
      h('button.btn.sm', { type: 'button', onclick: onCancel, 'aria-label': '停止' + title }, icon('stop'), '停止'),
    ),
    bits.length ? h('div.sub', null, bits.join(' · ')) : null,
    c.liveText
      ? h('details', { open: openLive.has(c.id), ontoggle: (e) => (e.target.open ? openLive.add(c.id) : openLive.delete(c.id)) }, h('summary', null, '看看 AI 正在写什么'), h('pre.live', null, c.liveText))
      : null,
    perm
      ? h('div.perm', null,
          h('b', null, 'AI 想用「' + perm.toolName + '」，需要你确认'),
          perm.reason ? h('div.hint', null, perm.reason) : null,
          perm.input ? h('pre', null, perm.input) : null,
          h('div.row', null,
            h('button.btn.sm.primary', { type: 'button', onclick: () => onPermission(perm.requestId, 'allowOnce') }, '允许一次'),
            h('button.btn.sm', { type: 'button', onclick: () => onPermission(perm.requestId, 'deny') }, '拒绝'),
          ),
        )
      : null,
  );
  const t = el.querySelector('[data-elapsed]');
  if (t) t.textContent = fmtDuration(Date.now() - Number(t.dataset.elapsed));
  return el;
}
export function tickElapsed() {
  for (const t of document.querySelectorAll('[data-elapsed]')) t.textContent = fmtDuration(Date.now() - Number(t.dataset.elapsed));
}

// ---------- 总装 ----------
export function renderDetail() {
  if (!host) return;
  if (!S.sel) {
    V = null;
    fill(host, h('div.dhead.only-narrow', null, h('button.btn.ghost.sm.back', { type: 'button', onclick: A.backToList }, icon('back'), '返回列表')), h('div.empty', null, h('div.brand-mark.lg', null, icon('book')), h('h2', null, '选一个项目'), h('p', null, '点左边的项目，看它是干什么的。可以让 AI 用大白话给你讲。')));
    return;
  }
  const d = S.detail;
  if (!d || d.key !== S.sel) {
    V = null;
    fill(host, h('div.dhead', null, h('button.btn.ghost.sm.back.only-narrow', { type: 'button', onclick: A.backToList }, icon('back'), '返回列表'), h('div.skeleton', { style: 'margin-top:8px' })));
    return;
  }
  if (!V || V.key !== d.key) {
    const el = { head: h('div.dhead'), choices: h('div.choices'), runs: h('div.runs'), tabs: h('div.tabs', { role: 'tablist' }), panel: h('div.tabpanel', { role: 'tabpanel' }) };
    V = { key: d.key, tab: null, el, readmeSig: '', chatCount: -1 };
    fill(host, el.head, el.choices, el.runs, el.tabs, el.panel);
    host.scrollTop = 0;
  }
  updateHead();
  updateChoices();
  updateRuns();
  updateTabs();
  if (V.tab !== S.tab) buildPanel(S.tab);
  else fillPanel();
}

function updateHead() {
  const d = S.detail;
  const names = new Map((S.st?.collections || []).map((c) => [c.id, c.name]));
  const meta = [];
  if (d.language) meta.push(h('span', null, h('i.dot', { style: 'background:' + langColor(d.language) }), d.language));
  meta.push(h('span', null, icon('star'), ' ' + fmtNum(d.stars)));
  if (d.forks) meta.push(h('span', null, icon('git'), ' ' + fmtNum(d.forks)));
  if (d.license) meta.push(h('span', null, d.license));
  if (d.pushedAt) meta.push(h('span', null, '更新于 ' + timeAgo(d.pushedAt)));
  if (d.archived) meta.push(h('span.badge.warn', null, '已归档'));
  const chips = d.collections
    .filter((id) => names.has(id))
    .map((id) =>
      h('span.cchip', null, names.get(id),
        h('button', { type: 'button', 'aria-label': '移出「' + names.get(id) + '」', title: '移出这个收藏夹', onclick: () => A.setMembership(d.key, { remove: [id] }) }, icon('x', 12)),
      ),
    );
  const [owner, name] = splitName(d.fullName);
  fill(V.el.head,
    h('button.btn.ghost.sm.back.only-narrow', { type: 'button', onclick: A.backToList }, icon('back'), '返回列表'),
    h('div.dtop', null,
      h('h2.dtitle', null, owner ? h('span.o', null, owner + ' / ') : null, h('span', null, name)),
      h('a.btn.sm.ghost', { href: d.url, target: '_blank', rel: 'noopener noreferrer', title: '在 GitHub 打开 ' + d.fullName }, icon('external'), 'GitHub'),
    ),
    d.description ? h('p.ddesc', null, d.description) : null,
    h('div.dmeta', null, meta),
    h('div.dcolls', null, chips, h('button.btn.sm.ghost', { type: 'button', onclick: (e) => memberPicker(e.currentTarget) }, icon('folder'), chips.length ? '管理收藏夹' : '加入收藏夹')),
  );
}

let closeMember = null; // 收藏夹弹层开着时，这里是它的关闭函数；再点一次按钮就收起来
function memberPicker(anchor) {
  if (closeMember) {
    closeMember();
    return;
  }
  const d = S.detail;
  const colls = S.st?.collections || [];
  const body = h('div', null, h('div.hint', { style: 'padding:4px 10px' }, '勾选就放进去，取消勾选就移出'));
  for (const c of colls) {
    const cb = h('input', { type: 'checkbox', checked: d.collections.includes(c.id) });
    cb.addEventListener('change', () => A.setMembership(d.key, cb.checked ? { add: [c.id] } : { remove: [c.id] }));
    body.append(h('label', null, cb, h('span', null, c.name)));
  }
  closeMember = popover(anchor, body, { label: '管理收藏夹', onClose: () => { closeMember = null; } });
}

// 「让 AI 讲讲」：两个小胶囊。说明文字放在悬停提示里，讲解页里也有完整的介绍
function updateChoices() {
  const d = S.detail;
  const off = S.st && S.st.agent && !S.st.agent.available;
  const busy = d.calls.some((c) => c.kind === 'explain');
  const choice = (mode, ico, title, sub) =>
    h('button.choice.' + mode, { type: 'button', title: sub, disabled: Boolean(off || busy), onclick: () => startExplain(mode) },
      icon(ico),
      h('span', null, title + (d.explain?.[mode] ? '（重新讲）' : '')),
    );
  fill(V.el.choices,
    off ? h('div.notice', null, icon('alert'), h('span', null, S.st.agent.reason || 'AI 功能暂时不可用')) : null,
    h('span.lead', null, '让 AI 讲讲'),
    choice('cloud', 'cloud', '云讲解', '只看 README 和公开信息，不下载代码'),
    choice('local', 'code', '本地讲解', '把代码拉到缓存里，翻着代码讲' + (d.sizeKB ? '（约 ' + fmtSize(d.sizeKB) + '）' : '')),
  );
}

async function startExplain(mode, force = false) {
  const d = S.detail;
  const limit = (S.st?.settings.cloneMaxMB || 300) * 1024;
  if (mode === 'local' && !force && (d.sizeKB || 0) > limit) {
    const ok = await confirmDialog({
      title: '这个项目比较大',
      message: '约 ' + fmtSize(d.sizeKB) + '，超过了你设置的 ' + S.st.settings.cloneMaxMB + ' MB 上限。拉取会比较慢，也会占磁盘。\n\n只想了解个大概的话，用云讲解就够了。仍然拉取吗？',
      okText: '仍然拉取',
    });
    if (!ok) return;
    force = true;
  }
  A.setTab('explain');
  await A.startExplain(d.key, mode, force);
}

function updateRuns() {
  const d = S.detail;
  fill(V.el.runs, 
    ...d.calls.map((c) =>
      runCard(c, {
        onCancel: () => A.cancelCalls(d.key),
        onPermission: (id, decision) => A.replyPermission(d.key, id, decision),
      }),
    ),
  );
}

function updateTabs() {
  const d = S.detail;
  const count = { notes: d.notes.length, chat: d.chat.filter((m) => m.role === 'user').length };
  fill(V.el.tabs, 
    ...TABS.map(([id, ico, label]) =>
      h('button.tab', { type: 'button', role: 'tab', 'aria-selected': S.tab === id, onclick: () => A.setTab(id) }, icon(ico), label, count[id] ? h('span.n', null, count[id]) : null),
    ),
  );
}

function buildPanel(tab) {
  const e = V.el;
  V.tab = tab;
  e.dyn = {};
  if (tab === 'explain') {
    e.dyn.ex = h('div');
    fill(e.panel, e.dyn.ex);
  } else if (tab === 'readme') {
    e.dyn.md = h('div');
    fill(e.panel, e.dyn.md);
    V.readmeSig = '';
    const r = S.readmes.get(V.key);
    if (!r || (r.status === 'none' && S.detail.hasReadme) || r.error) A.loadReadme(V.key, false);
  } else if (tab === 'notes') buildNotes();
  else if (tab === 'chat') buildChat();
  else {
    e.dyn.info = h('div');
    fill(e.panel, e.dyn.info);
  }
  fillPanel();
}
function fillPanel() {
  if (V.tab === 'explain') fillExplain();
  else if (V.tab === 'readme') fillReadme();
  else if (V.tab === 'notes') fillNotes();
  else if (V.tab === 'chat') fillChat();
  else fillInfo();
}

// ---------- 讲解 ----------
function fillExplain() {
  const d = S.detail;
  const box = V.el.dyn.ex;
  if (!box) return;
  const mode = S.exMode;
  const seg = (m, ico, label) =>
    h('button', { type: 'button', 'aria-pressed': mode === m, onclick: () => { S.exMode = m; fillExplain(); } }, icon(ico), label, d.explain?.[m] ? h('i.done', { title: '已有讲解' }) : null);
  const parts = [h('div.seg', { role: 'group', 'aria-label': '讲解方式' }, seg('cloud', 'cloud', '云讲解'), seg('local', 'code', '本地讲解'))];
  const running = d.calls.find((c) => c.kind === 'explain' && c.mode === mode);
  const lc = d.lastCall;
  if (lc && lc.kind === 'explain' && lc.mode === mode && (lc.status === 'error' || lc.status === 'timeout') && !running) {
    parts.push(
      h('div.notice.err', null, icon('alert'), h('div', null,
        h('div', null, lc.error || '这次讲解没有成功'),
        h('div', { style: 'margin-top:8px;display:flex;gap:8px;flex-wrap:wrap' },
          h('button.btn.sm', { type: 'button', onclick: () => startExplain(mode) }, icon('refresh'), '再试一次'),
          lc.errorCode === 'too_big' ? h('button.btn.sm', { type: 'button', onclick: () => startExplain(mode, true) }, '仍然拉取') : null,
        ),
      )),
    );
  }
  const saved = d.explain?.[mode];
  if (saved) {
    const md = h('div.md.explain');
    md.append(renderMarkdown(saved.text, { imageMode: 'none' }).node);
    md.addEventListener('click', (ev) => handleAnchorClick(ev, md));
    parts.push(
      md,
      h('div.exmeta', null,
        h('span', null, (mode === 'cloud' ? '云讲解' : '本地讲解') + ' · ' + fmtDate(saved.at)),
        saved.model ? h('span', null, String(saved.model).replace(/^.*\//, '')) : null,
        saved.durationMs ? h('span', null, '用时 ' + fmtDuration(saved.durationMs)) : null,
        h('span.sp'),
        h('button.btn.sm.ghost', { type: 'button', onclick: async () => { const ok = await copyText(saved.text); toast(ok ? '已复制讲解' : '复制失败，请手动选择文字', ok ? '' : 'err'); } }, icon('copy'), '复制'),
        h('button.btn.sm', { type: 'button', disabled: Boolean(running) || Boolean(S.st?.agent && !S.st.agent.available), onclick: () => startExplain(mode) }, icon('refresh'), '重新讲'),
      ),
    );
    if (mode === 'local' && d.cache) {
      parts.push(
        h('p.hint', null,
          '代码缓存在 Mini App 自己的文件夹里（约 ' + fmtSize(d.cache.sizeKB) + '，' + timeAgo(d.cache.clonedAt) + '拉取）。',
          h('button.btn.sm.ghost', { type: 'button', onclick: async () => { if (await confirmDialog({ title: '清除缓存', message: '删除这个项目的本地代码缓存。讲解和备注不受影响。', okText: '清除', danger: true })) A.clearProjectCache(d.key); } }, icon('trash'), '清除缓存'),
        ),
      );
    }
  } else if (!running) {
    const off = S.st && S.st.agent && !S.st.agent.available;
    parts.push(
      h('div.empty', { style: 'margin:0' },
        h('h2', null, mode === 'cloud' ? '还没有云讲解' : '还没有本地讲解'),
        h('p', null, mode === 'cloud'
          ? 'AI 会读这个项目的 README 和公开信息，用大白话讲清楚它是干什么的、有什么用。不会下载任何代码，通常一分钟左右。'
          : '先把代码浅克隆到本地缓存（只取最新一版），AI 翻着代码讲，能讲到代码是怎么组织的。缓存固定放在 Mini App 自己的文件夹里，用完可以清除。' + (d.sizeKB ? '这个仓库约 ' + fmtSize(d.sizeKB) + '。' : '')),
        h('button.btn.primary', { type: 'button', disabled: Boolean(off), onclick: () => startExplain(mode) }, icon(mode === 'cloud' ? 'cloud' : 'code'), mode === 'cloud' ? '生成云讲解' : '拉取代码并讲解'),
      ),
    );
  } else parts.push(h('p.hint', null, 'AI 正在讲解，完成后会显示在这里。你可以先去看看 README 或写备注。'));
  fill(box, ...parts);
}

// ---------- README ----------
function fillReadme() {
  const d = S.detail;
  const box = V.el.dyn.md;
  if (!box) return;
  const r = S.readmes.get(d.key);
  if (!r || (r.loading && !r.text)) {
    V.readmeSig = '';
    fill(box, h('div.skeleton'), h('p.hint', null, '正在取 README…'));
    return;
  }
  if (r.error) {
    V.readmeSig = '';
    fill(box, h('div.notice.err', null, icon('alert'), h('div', null, h('div', null, r.error), h('button.btn.sm', { type: 'button', style: 'margin-top:8px', onclick: () => A.loadReadme(d.key, true) }, icon('refresh'), '重试'))));
    return;
  }
  if (r.status === 'none') {
    V.readmeSig = '';
    fill(box, h('div.empty', { style: 'margin:0' }, h('h2', null, '这个项目没有 README'), h('p', null, '可以直接去 GitHub 看看它的主页。'), h('a.btn', { href: d.url, target: '_blank', rel: 'noopener noreferrer' }, icon('external'), '在 GitHub 打开')));
    return;
  }
  const mode = S.loadExternal.has(d.key) ? 'all' : S.st?.settings.imageMode || 'github';
  const sig = [d.key, r.text.length, r.fetchedAt, mode].join('|');
  if (V.readmeSig === sig) return;
  V.readmeSig = sig;
  const out = renderMarkdown(r.text, { repo: r.repo, branch: r.branch, imageMode: mode });
  const md = h('div.md');
  md.append(out.node);
  md.addEventListener('click', (ev) => handleAnchorClick(ev, md));
  fill(box, 
    h('div.mdtools', null,
      h('span', null, 'README' + (r.fetchedAt ? ' · 缓存于 ' + timeAgo(r.fetchedAt) : '')),
      h('span.sp'),
      out.stats.blocked ? h('button.btn.sm', { type: 'button', title: '外部图片会向第三方网站暴露你的 IP', onclick: () => { S.loadExternal.add(d.key); fillReadme(); } }, '载入 ' + out.stats.blocked + ' 张外部图片') : null,
      h('button.btn.sm.ghost', { type: 'button', onclick: () => A.loadReadme(d.key, true) }, icon('refresh'), '刷新'),
      h('a.btn.sm.ghost', { href: d.url, target: '_blank', rel: 'noopener noreferrer' }, icon('external'), 'GitHub'),
    ),
    md,
  );
}

// ---------- 备注 ----------
function buildNotes() {
  const d = S.detail;
  const e = V.el;
  const ta = h('textarea', { rows: 2, maxlength: 2000, placeholder: '写点备注：它是干嘛的、什么时候会用到、要注意什么…', 'aria-label': '备注内容' });
  ta.value = drafts.note.get(d.key) || '';
  ta.addEventListener('input', () => drafts.note.set(d.key, ta.value));
  const add = async () => {
    const text = ta.value.trim();
    if (!text) return;
    ta.disabled = true;
    const n = await A.addNote(d.key, text);
    ta.disabled = false;
    if (n) {
      ta.value = '';
      drafts.note.delete(d.key);
      ta.focus();
    }
  };
  ta.addEventListener('keydown', (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
      ev.preventDefault();
      add();
    }
  });
  const off = S.st && S.st.agent && !S.st.agent.available;
  const notesTip = info('备注只存在本机，搜索时能搜到。Ctrl/⌘ + 回车 保存。');
  e.dyn.notes = h('div');
  fill(e.panel, 
    h('div.composer', null, ta, h('button.btn.primary', { type: 'button', onclick: add }, icon('plus'), '添加')),
    h('div', { style: 'margin:-4px 0 14px' }, h('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' },
      h('button.btn.sm', { type: 'button', disabled: Boolean(off) || d.calls.some((c) => c.kind === 'notes'), onclick: () => A.askAiNotes(d.key) }, icon('sparkles'), '让 AI 记 3 条'),
      notesTip.tog,
    ), notesTip.note),
    e.dyn.notes,
  );
}
function fillNotes() {
  const d = S.detail;
  const box = V.el.dyn.notes;
  if (!box) return;
  if (box.querySelector('textarea:focus')) {
    V.notesDirty = true;
    return;
  }
  V.notesDirty = false;
  if (!d.notes.length) {
    fill(box, h('p.hint', null, '还没有备注。写下你对它的看法，或者让 AI 帮你记几条。'));
    return;
  }
  const terms = S.list.terms || [];
  fill(box, 
    ...d.notes
      .slice()
      .reverse()
      .map((n) => noteItem(d, n, terms)),
  );
}
function noteItem(d, n, terms) {
  const body = h('div.body', null, markTerms(n.text, terms));
  const item = h('div.note', null, body);
  const foot = h('div.foot', null,
    h('span.badge' + (n.author === 'ai' ? '.ai' : ''), null, n.author === 'ai' ? 'AI' : '我'),
    h('span', null, timeAgo(n.updatedAt || n.createdAt)),
    h('span.sp'),
    h('button.btn.ghost.sm', { type: 'button', 'aria-label': '编辑这条备注', onclick: edit }, icon('edit')),
    h('button.btn.ghost.sm', { type: 'button', 'aria-label': '删除这条备注', onclick: remove }, icon('trash')),
  );
  item.append(foot);
  function edit() {
    const ta = h('textarea', { rows: 3, maxlength: 2000, 'aria-label': '编辑备注' });
    ta.value = n.text;
    const done = () => {
      if (V?.notesDirty) fillNotes();
      else {
        fill(body, ...markTerms(n.text, terms));
        item.replaceChild(foot, item.lastChild);
      }
    };
    const save = async () => {
      const text = ta.value.trim();
      if (!text) return;
      if (text === n.text) return done();
      await A.updateNote(d.key, n.id, text);
      V.notesDirty = false;
      fillNotes();
    };
    ta.addEventListener('keydown', (ev) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
        ev.preventDefault();
        save();
      } else if (ev.key === 'Escape') {
        ev.stopPropagation();
        V.notesDirty = false;
        fillNotes();
      }
    });
    fill(body, ta);
    item.replaceChild(h('div.foot', null, h('span.sp'), h('button.btn.sm', { type: 'button', onclick: () => { V.notesDirty = false; fillNotes(); } }, '取消'), h('button.btn.sm.primary', { type: 'button', onclick: save }, '保存')), item.lastChild);
    ta.focus();
  }
  async function remove() {
    if (await confirmDialog({ title: '删除备注', message: '这条备注会被删除，找不回来。', okText: '删除', danger: true })) A.deleteNote(d.key, n.id);
  }
  return item;
}

// ---------- 追问 ----------
const QUICK = ['用一个生活里的例子，说说它是干嘛的', '和同类项目比，它有什么不一样？', '我该怎么开始用它？', '它靠谱吗？有哪些风险或坑？'];
function buildChat() {
  const d = S.detail;
  const e = V.el;
  const ta = h('textarea', { rows: 2, maxlength: 4000, placeholder: '接着问这个项目…（Ctrl/⌘ + 回车 发送）', 'aria-label': '追问内容' });
  ta.value = drafts.chat.get(d.key) || '';
  ta.addEventListener('input', () => drafts.chat.set(d.key, ta.value));
  const send = async (how) => {
    const text = ta.value.trim();
    if (!text) return;
    const v = await A.sendMessage(d.key, text, how);
    if (v) {
      ta.value = '';
      drafts.chat.delete(d.key);
    }
  };
  ta.addEventListener('keydown', (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
      ev.preventDefault();
      send('queue');
    }
  });
  e.dyn.thread = h('div.thread');
  e.dyn.sendRow = h('div', { style: 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap' });
  e.dyn.sendFn = send;
  e.dyn.ta = ta;
  e.dyn.sugg = h('div.sugg');
  e.dyn.intro = h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px' });
  e.dyn.tip = info('这个项目有自己的会话，不会和别的项目串。AI 看得到上面的讲解资料和你的备注。');
  fill(e.panel, e.dyn.intro, e.dyn.tip.note, e.dyn.thread, e.dyn.sugg, ta, h('div', { style: 'height:8px' }), e.dyn.sendRow);
  V.chatCount = -1;
}
function fillChat() {
  const d = S.detail;
  const e = V.el;
  if (!e.dyn.thread) return;
  const off = S.st && S.st.agent && !S.st.agent.available;
  const busyAny = d.calls.length > 0;
  fill(e.dyn.intro, 
    e.dyn.tip.tog,
    d.session ? h('button.btn.sm', { type: 'button', onclick: () => openSession(d) }, icon('panel'), '在侧边栏打开会话') : null,
    d.session ? h('button.btn.sm.ghost', { type: 'button', disabled: busyAny, title: 'AI 忘掉之前的对话重新开始；讲解、备注、聊天记录都保留', onclick: () => resetSession(d) }, icon('refresh'), '新开会话') : null,
  );
  const live = d.calls.filter((c) => (c.kind === 'message' || c.kind === 'notes') && c.liveText);
  const items = d.chat.map((m) =>
    m.role === 'user' ? h('div.msg.user', null, m.text)
      : m.role === 'ai' ? h('div.msg.ai', null, h('div.who', null, 'AI' + (m.model ? ' · ' + String(m.model).replace(/^.*\//, '') : '')), mdBlock(m.text))
        : h('div.msg.sys' + (m.error ? '.err' : ''), null, m.text),
  );
  for (const c of live) items.push(h('div.msg.ai', null, h('div.who', null, 'AI 正在写…'), h('div', { style: 'white-space:pre-wrap' }, c.liveText.slice(-1200))));
  fill(e.dyn.thread, ...items);
  fill(e.dyn.sugg, 
    ...(d.chat.filter((m) => m.role === 'user').length < 2 ? QUICK.map((q) => h('button.btn.sm', { type: 'button', onclick: () => { e.dyn.ta.value = q; e.dyn.ta.dispatchEvent(new Event('input')); e.dyn.ta.focus(); } }, q)) : []),
  );
  e.dyn.ta.disabled = Boolean(off);
  fill(e.dyn.sendRow, 
    off ? h('span.hint', null, S.st.agent.reason) : null,
    busyAny ? h('button.btn', { type: 'button', title: 'AI 正在忙，等它做完这一轮再回答', onclick: () => e.dyn.sendFn('queue') }, '排队发送') : null,
    busyAny ? h('button.btn', { type: 'button', title: 'AI 马上读到，并按新想法调整正在做的事', onclick: () => e.dyn.sendFn('steer') }, '插话') : null,
    !busyAny ? h('button.btn.primary', { type: 'button', disabled: Boolean(off), onclick: () => e.dyn.sendFn('queue') }, icon('send'), '发送') : null,
  );
  const n = d.chat.length + live.length;
  if (n > V.chatCount && V.chatCount >= 0) e.dyn.thread.lastElementChild?.scrollIntoView({ block: 'nearest' });
  V.chatCount = n;
}
function mdBlock(text) {
  const md = h('div.md');
  md.append(renderMarkdown(text, { imageMode: 'none' }).node);
  md.addEventListener('click', (ev) => handleAnchorClick(ev, md));
  return md;
}
async function resetSession(d) {
  const ok = await confirmDialog({ title: '新开会话', message: 'AI 会忘掉之前的对话，从头开始。讲解、备注和聊天记录都还在。\n\n会话卡住了、或者想换个话题时可以用。', okText: '新开会话' });
  if (ok) A.resetSession(d.key);
}

async function openSession(d) {
  const agent = window.mcode?.miniapp?.agent;
  if (!agent?.open) return toast('当前环境不支持在侧边栏打开会话', 'err');
  try {
    await agent.open(d.session.id);
  } catch (error) {
    toast(error?.message === 'not_permitted' ? '要在聊天窗口里打开这个 Mini App，才能在侧边栏看会话' : '打不开会话：' + (error?.message || '未知原因'), 'err');
  }
}

// ---------- 信息 ----------
function fillInfo() {
  const d = S.detail;
  const box = V.el.dyn.info;
  const row = (k, v) => (v === '' || v === null || v === undefined ? null : [h('dt', null, k), h('dd', null, v)]);
  const colls = S.st?.collections || [];
  const checks = colls.map((c) => {
    const cb = h('input', { type: 'checkbox', checked: d.collections.includes(c.id) });
    cb.addEventListener('change', () => A.setMembership(d.key, cb.checked ? { add: [c.id] } : { remove: [c.id] }));
    return h('label', null, cb, c.name);
  });
  fill(box, 
    h('h3.sec', null, '基本信息'),
    h('dl.kv', null,
      row('地址', h('a', { href: d.url, target: '_blank', rel: 'noopener noreferrer' }, d.url)),
      row('主页', d.homepage ? h('a', { href: /^https?:\/\//i.test(d.homepage) ? d.homepage : '#', target: '_blank', rel: 'noopener noreferrer' }, d.homepage) : ''),
      row('语言', d.language),
      row('Star / Fork', fmtNum(d.stars) + ' / ' + fmtNum(d.forks)),
      row('许可证', d.license),
      row('话题', d.topics?.length ? d.topics.join('、') : ''),
      row('默认分支', d.defaultBranch),
      row('仓库大小', d.sizeKB ? fmtSize(d.sizeKB) : ''),
      row('最近更新', d.pushedAt ? fmtDate(d.pushedAt) + '（' + timeAgo(d.pushedAt) + '）' : ''),
      row('你 Star 于', d.starredAt ? fmtDate(d.starredAt) : ''),
      row('README', d.readme ? (d.readme.status === 'ok' ? '已缓存（' + fmtSize(Math.ceil((d.readme.size || 0) / 1024)) + '）' : '没有 README') : '还没取'),
    ),
    h('h3.sec', null, '所属收藏夹'),
    h('div.checks', null, checks),
    h('h3.sec', null, '会话与缓存'),
    h('dl.kv', null,
      row('AI 会话', d.session ? '已建立（一个项目一个会话）' : '还没有'),
      row('本地代码', d.cache ? fmtSize(d.cache.sizeKB) + '，' + timeAgo(d.cache.clonedAt) + '拉取' : '没有缓存'),
    ),
    d.cache ? h('button.btn.sm', { type: 'button', onclick: async () => { if (await confirmDialog({ title: '清除缓存', message: '删除这个项目的本地代码缓存。', okText: '清除', danger: true })) A.clearProjectCache(d.key); } }, icon('trash'), '清除本地缓存') : null,
    h('h3.sec', null, '危险操作'),
    h('button.btn.danger.sm', { type: 'button', onclick: async () => { if (await confirmDialog({ title: '从项目库删除', message: '「' + d.fullName + '」的备注、讲解、README 缓存和本地代码都会被删除。\n\n从 Star 导入的项目，下次导入还会回来。', okText: '删除', danger: true })) A.removeProject(d.key); } }, icon('trash'), '从项目库删除'),
  );
}
