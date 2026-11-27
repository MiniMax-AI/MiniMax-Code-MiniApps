(function () {
  'use strict';

  /* ------------------------------------------------------------- helpers */

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);

  const ICONS = {
    book: '<path d="M4 5.5A2.5 2.5 0 016.5 3H19v15H6.5A2.5 2.5 0 004 20.5z"/><path d="M19 18v3H6.5"/>',
    chat: '<path d="M21 12a8 8 0 01-8 8H7l-4 2 1.2-4.4A8 8 0 1121 12z"/>',
    note: '<path d="M5 4h9l5 5v11H5z"/><path d="M14 4v5h5"/><path d="M8 13h8M8 16.5h5"/>',
    play: '<path d="M7 4l12 8-12 8z"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    dots: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
    send: '<path d="M4 12l16-7-7 16-2.2-6.8z"/>',
    open: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v6H4V6h6"/>',
    folder: '<path d="M3 7.5A1.5 1.5 0 014.5 6H10l2 2.5h7.5A1.5 1.5 0 0121 10v7.5A1.5 1.5 0 0119.5 19h-15A1.5 1.5 0 013 17.5z"/>',
    spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
    up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    left: '<path d="M15 5l-7 7 7 7"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    refresh: '<path d="M20 11a8 8 0 10-2.3 5.7"/><path d="M20 5v6h-6"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/>',
  };
  const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.dots}</svg>`;

  const ERROR_TEXT = {
    BUSY: '这一轮还在进行，等它结束再发。',
    ANSWER_PENDING: '先回答右侧会话里待回答的问题，再重新生成这一课。',
    NOT_PERMITTED: '这个能力在插件设置里被关掉了，打开后再试。',
    NO_QUESTION: '这个问题已经结束，刷新一下会话。',
    NO_PERMISSION: '这次授权请求已经结束。',
    NOT_FOUND: '对象不存在，可能已被移动或删除。',
    TARGET_NOT_EMPTY: '目标文件夹不是空的，换一个名字或目录。',
    NOT_A_WORKSPACE: '这个目录里没有学习工作台（缺少 .workbench/workspace.json）。',
    SETUP_REQUIRED: '先完成前置配置，再生成课纲。',
    PARENT_NOT_FOUND: '目录不存在。',
    HOME_NOT_ALLOWED: '别把工作台建在用户主目录，请选一个具体项目文件夹。',
    DRIVE_ROOT_NOT_ALLOWED: '别把工作台建在磁盘根目录，请选一个项目文件夹。',
    not_a_directory: '这个路径不是一个文件夹。',
    path_must_be_absolute: '要填完整路径，例如 D:\\代码\\项目名。',
    NO_LESSONS: '选中的课程还没有生成文件，先生成课程。',
    SESSION_CREATE_FAILED: '无法创建会话，检查插件权限后重试。',
    internal_error: '内部错误，看一下插件诊断。',
  };

  function errorText(error) {
    const code = error && error.code;
    return ERROR_TEXT[code] || (error && error.message) || '操作失败';
  }

  async function api(path, options) {
    const opts = options || {};
    const response = await fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'content-type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!response.ok) {
      const error = new Error((data && (data.message || data.error)) || `HTTP ${response.status}`);
      error.code = (data && data.error) || 'http_error';
      error.status = response.status;
      throw error;
    }
    return data;
  }

  let toastTimer = 0;
  function toast(message, kind) {
    const node = $('#toast');
    if (!node) return;
    node.textContent = message;
    node.className = `toast show${kind === 'error' ? ' error' : ''}`;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      node.className = 'toast';
    }, 2800);
  }

  function timeLabel(ms) {
    if (!ms) return '';
    const date = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  /* --------------------------------------------------------- mini markdown */

  function md(text) {
    const source = esc(String(text ?? '')).replace(/\r\n/g, '\n');
    const lines = source.split('\n');
    const out = [];
    let index = 0;

    const inline = (value) =>
      value
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
        .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>');

    while (index < lines.length) {
      const line = lines[index];

      if (/^```/.test(line)) {
        const lang = line.slice(3).trim();
        const buffer = [];
        index += 1;
        while (index < lines.length && !/^```/.test(lines[index])) {
          buffer.push(lines[index]);
          index += 1;
        }
        index += 1;
        out.push(
          `<pre${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${buffer.join('\n')}</code></pre>`,
        );
        continue;
      }

      if (!line.trim()) {
        index += 1;
        continue;
      }

      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        const level = Math.min(3, heading[1].length);
        out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
        index += 1;
        continue;
      }

      if (/^(\s*)(---|\*\*\*|___)\s*$/.test(line)) {
        out.push('<hr />');
        index += 1;
        continue;
      }

      if (/^\s*\|/.test(line) && /^\s*\|?[\s:-]+\|/.test(lines[index + 1] || '')) {
        const header = line.split('|').map((cell) => cell.trim()).filter(Boolean);
        index += 2;
        const rows = [];
        while (index < lines.length && /^\s*\|/.test(lines[index])) {
          const cells = lines[index].split('|').map((cell) => cell.trim());
          if (cells.length && cells[0] === '') cells.shift();
          if (cells.length && cells[cells.length - 1] === '') cells.pop();
          rows.push(cells);
          index += 1;
        }
        out.push(
          `<table><thead><tr>${header.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${rows
            .map((cells) => `<tr>${cells.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`)
            .join('')}</tbody></table>`,
        );
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        const buffer = [];
        while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
          buffer.push(lines[index].replace(/^\s*>\s?/, ''));
          index += 1;
        }
        out.push(`<blockquote>${buffer.map(inline).join('<br />')}</blockquote>`);
        continue;
      }

      if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
        const ordered = /^\s*\d+\./.test(line);
        const buffer = [];
        while (index < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[index])) {
          buffer.push(lines[index].replace(/^\s*([-*]|\d+\.)\s+/, ''));
          index += 1;
        }
        const tag = ordered ? 'ol' : 'ul';
        out.push(`<${tag}>${buffer.map((item) => `<li>${inline(item)}</li>`).join('')}</${tag}>`);
        continue;
      }

      const buffer = [];
      while (
        index < lines.length &&
        lines[index].trim() &&
        !/^```/.test(lines[index]) &&
        !/^(#{1,4})\s+/.test(lines[index]) &&
        !/^\s*([-*]|\d+\.)\s+/.test(lines[index]) &&
        !/^\s*>\s?/.test(lines[index]) &&
        !/^(\s*)(---|\*\*\*|___)\s*$/.test(lines[index]) &&
        !/^\s*\|/.test(lines[index])
      ) {
        buffer.push(lines[index]);
        index += 1;
      }
      out.push(`<p>${buffer.map(inline).join('<br />')}</p>`);
    }

    return out.join('\n');
  }

  /* ---------------------------------------------------------------- state */

  const S = {
    boot: null,
    wsId: null,
    snap: null,
    lessonId: null,
    sessionId: null,
    center: 'lesson',
    tab: 'lesson',
    noteId: null,
    noteText: '',
    transcripts: new Map(),
    drafts: new Map(),
    live: new Map(),
    tools: new Map(),
    loads: new Map(),
    unread: new Set(),
    talkOpen: true,
    centerSig: '',
    railSig: '',
    topSig: '',
    snapKey: '',
    sending: false,
    talkError: '',
    pendingQuote: '',
    pendingAnnoId: '',
    picker: null,
    es: null,
  };

  /** Every derived view reads this key; nothing hand-picks snapshot fields. */
  function setSnapshot(next) {
    S.snap = next;
    S.snapKey = next ? JSON.stringify(next) : '';
  }

  const lessonsOf = () =>
    S.snap ? S.snap.curriculum.modules.flatMap((module) => module.lessons) : [];
  const findLesson = (id) => lessonsOf().find((lesson) => lesson.id === id) || null;
  const lessonByFile = (rel) =>
    lessonsOf().find((lesson) => lesson.file && lesson.file === rel) || null;
  const currentLesson = () => findLesson(S.lessonId);
  const lessonHasFile = (lesson) =>
    Boolean(lesson && lesson.file && S.snap && S.snap.lessonFiles.includes(lesson.file));
  const annotationsOf = (lessonId) =>
    S.snap ? S.snap.annotations.filter((item) => item.lessonId === lessonId) : [];
  const currentSession = () => (S.sessionId ? S.transcripts.get(S.sessionId) : null);

  function pickLesson() {
    const all = lessonsOf();
    if (!all.length) return null;
    const stored = localStorage.getItem(`wb.lesson.${S.wsId}`);
    if (stored && all.some((lesson) => lesson.id === stored)) return stored;
    const active = all.find((lesson) => lesson.status === 'active');
    const planned = all.find((lesson) => lesson.status === 'planned');
    return (active || planned || all[0]).id;
  }

  function lessonNumberList(ids) {
    const numbers = ids
      .map((id) => findLesson(id))
      .filter(Boolean)
      .map((lesson) => lesson.no)
      .sort((a, b) => a - b);
    if (!numbers.length) return '';
    if (numbers.length === 1) return `第 ${numbers[0]} 课`;
    const contiguous = numbers.every((n, i) => i === 0 || n === numbers[i - 1] + 1);
    return contiguous ? `第 ${numbers[0]}–${numbers[numbers.length - 1]} 课` : `第 ${numbers.join('、')} 课`;
  }

  /* ----------------------------------------------------------------- theme */

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
    const frame = $('#lesson-frame');
    if (frame && frame.contentWindow) {
      frame.contentWindow.postMessage(
        { source: 'host', type: 'theme', theme: theme === 'dark' ? 'dark' : 'light' },
        '*',
      );
    }
  }

  function initTheme() {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(prefersDark ? 'dark' : 'light');
    const host = window.mcode && window.mcode.miniapp && window.mcode.miniapp.host;
    if (host && host.ui && host.ui.subscribe) {
      try {
        const subscription = host.ui.subscribe(
          (state) => applyTheme(state.theme),
          { onError: () => undefined },
        );
        window.addEventListener(
          'pagehide',
          () => {
            if (subscription && subscription.dispose) subscription.dispose();
          },
          { once: true },
        );
      } catch {
        /* keep the system theme */
      }
    }
  }

  /* --------------------------------------------------------------- landing */

  function renderLanding() {
    const host = $('#app');
    const list = (S.boot && S.boot.workspaces) || [];
    host.innerHTML = `
      <div class="landing">
        <div class="landing-inner">
          <h1>学习工作台</h1>
          <div class="sub">按 teach 方法管理学习目录与课纲；每节课有独立的分支会话，批注和笔记跟着课程走。</div>
          <div class="actions">
            <button class="btn primary" data-act="open-picker" data-mode="create">${icon('plus')}新建学习工作台</button>
            <button class="btn" data-act="open-picker" data-mode="import">${icon('folder')}导入已有目录</button>
            ${list.length ? `<button class="btn" data-act="manage-ws">${icon('dots')}管理工作台</button>` : ''}
          </div>
          ${
            list.length
              ? `<div class="recent">
                  <h2>最近</h2>
                  ${list
                    .map(
                      (workspace) => `<button class="recent-row" data-act="open-ws" data-id="${esc(workspace.id)}">
                        <div class="ws-mark">学</div>
                        <div style="min-width:0">
                          <div class="nm">${esc(workspace.name)}</div>
                          <div class="pt mono">${esc(workspace.root)}</div>
                        </div>
                      </button>`,
                    )
                    .join('')}
                </div>`
              : `<div class="recent"><h2>还没有工作台</h2><div class="hint-line">选一个目录，工作台会在里面创建 MISSION.md、lessons/、reference/ 等 teach 结构。</div></div>`
          }
        </div>
      </div>`;
    connectEvents();
  }

  /* ------------------------------------------------------------ workspace */

  async function openWorkspace(id) {
    S.wsId = id;
    S.transcripts.clear();
    S.drafts.clear();
    S.live.clear();
    S.tools.clear();
    S.unread.clear();
    S.sessionId = null;
    S.noteId = null;
    S.centerSig = '';
    S.railSig = '';
    try {
      setSnapshot(await api(`/api/ws/${encodeURIComponent(id)}`));
    } catch (error) {
      toast(errorText(error), 'error');
      localStorage.removeItem('wb.last');
      S.boot = await api('/api/bootstrap').catch(() => S.boot);
      S.wsId = null;
      renderLanding();
      return;
    }
    localStorage.setItem('wb.last', id);
    S.lessonId = pickLesson();
    const setupPending = S.snap.workspace.configured === false;
    S.center = setupPending || !S.snap.curriculum.modules.length ? 'overview' : 'lesson';
    renderShell(true);
    connectEvents();
    if (setupPending) {
      S.talkOpen = true;
      renderShell(false);
      await openSetupSession();
      return;
    }
    if (S.lessonId) {
      await selectLesson(S.lessonId, { seed: false, silent: true });
    } else {
      const recent = (S.snap.sessions || []).find((session) => session.kind === 'main') || (S.snap.sessions || [])[0];
      if (recent) await openSession(recent.id);
      else updateTalk();
    }
  }

  async function openSetupSession() {
    try {
      const result = await api(`/api/ws/${encodeURIComponent(S.wsId)}/setup/open`, {
        method: 'POST',
        body: {},
      });
      S.talkOpen = true;
      renderShell(false);
      if (result && result.sessionId) await openSession(result.sessionId);
    } catch (error) {
      toast(errorText(error), 'error');
    }
  }

  function shellHtml() {
    return `
      <div class="app${S.talkOpen ? '' : ' no-talk'}" data-ws="${esc(S.wsId)}">
        <header class="top" id="top"></header>
        <nav class="rail" id="rail" aria-label="课纲"></nav>
        <main class="center" id="center">
          <div class="center-head" id="center-head"></div>
          <div class="center-body" id="center-body"></div>
        </main>
        <aside class="talk" id="talk" aria-label="课程会话">
          <div class="talk-head" id="talk-head"></div>
          <div class="chat-scroll" id="talk-body" role="log" aria-live="polite"></div>
          <form class="composer" id="talk-form">
            <div class="box">
              <textarea id="talk-input" rows="2" placeholder="向这一课的老师追问…"></textarea>
              <div class="row">
                <span class="hint" id="talk-hint">Enter 发送 · Shift+Enter 换行</span>
                <div class="actions">
                  <button type="button" class="btn ghost sm hidden" id="talk-stop" data-act="cancel-turn">${icon('stop')}停止</button>
                  <button type="submit" class="btn primary sm" id="talk-send">${icon('send')}发送</button>
                </div>
              </div>
            </div>
          </form>
        </aside>
      </div>`;
  }

  function renderShell(force) {
    const host = $('#app');
    const existing = $('#app .app');
    if (!force && existing && existing.dataset.ws === S.wsId) {
      existing.classList.toggle('no-talk', !S.talkOpen);
      updateTop();
      updateRail();
      updateCenter();
      updateTalk();
      return;
    }
    host.innerHTML = shellHtml();
    bindComposer();
    updateTop();
    updateRail();
    updateCenter();
    updateTalk();
  }

  function bindComposer() {
    const form = $('#talk-form');
    const input = $('#talk-input');
    if (!form || !input) return;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void sendCurrent();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void sendCurrent();
      }
    });
    input.addEventListener('input', () => {
      if (S.sessionId) S.drafts.set(S.sessionId, input.value);
      autoSize(input);
    });
  }

  function autoSize(input) {
    input.style.height = 'auto';
    input.style.height = `${Math.min(120, input.scrollHeight)}px`;
  }

  /* ------------------------------------------------------------------- top */

  function updateTop() {
    const node = $('#top');
    if (!node || !S.snap) return;
    const summary = S.snap.summary;
    const sig = `${S.wsId}|${S.snapKey}|${(S.boot && S.boot.workspaces ? S.boot.workspaces.map((w) => w.name).join(",") : '')}`;
    if (sig === S.topSig) return;
    S.topSig = sig;
    const workspaces = (S.boot && S.boot.workspaces) || [];
    node.innerHTML = `
      <div class="ws-mark">学</div>
      <div style="min-width:0">
        <div class="ws-name">${esc(S.snap.workspace.name)}</div>
        <div class="ws-path mono">${esc(S.snap.workspace.root)}</div>
      </div>
      <div class="grow"></div>
      <span class="chip ok">已学 ${summary.done}/${summary.total} 课</span>
      ${
        workspaces.length > 1
          ? `<select class="ws-switch" id="ws-switch" aria-label="切换工作台">
              ${workspaces
                .map(
                  (workspace) =>
                    `<option value="${esc(workspace.id)}"${workspace.id === S.wsId ? ' selected' : ''}>${esc(workspace.name)}</option>`,
                )
                .join('')}
            </select>`
          : ''
      }
      <button class="btn sm ghost" data-act="open-picker" data-mode="create" title="新建学习工作台">${icon('plus')}</button>
      <button class="btn sm ghost" data-act="manage-ws" title="管理工作台目录">${icon('folder')}管理</button>
      <button class="btn sm${S.center === 'overview' ? ' primary' : ''}" data-act="open-overview">${icon('book')}概览</button>
      <button class="btn sm${S.center === 'notes' || S.center === 'note' ? ' primary' : ''}" data-act="open-notes">${icon('note')}笔记 ${S.snap.notes.length}</button>
      <button class="btn sm" data-act="open-main">${icon('chat')}主会话</button>
    `;
    const select = $('#ws-switch');
    if (select) {
      select.addEventListener('change', () => {
        S.talkOpen = window.innerWidth > 1120;
        void openWorkspace(select.value);
      });
    }
  }

  /* ------------------------------------------------------------------ rail */

  function updateRail() {
    const node = $('#rail');
    if (!node || !S.snap) return;
    const lessons = lessonsOf();
    const sig = JSON.stringify([S.snapKey, S.lessonId, Array.from(S.unread).sort()]);
    if (sig === S.railSig) return;
    S.railSig = sig;
    const total = lessons.length || 0;
    const done = S.snap.summary.done;
    node.innerHTML = `
      <div class="rail-head">
        <div class="label">课纲</div>
        <div class="progress-line">
          <div class="progressbar" style="flex:1"><i style="width:${total ? Math.round((done / total) * 100) : 0}%"></i></div>
          <span>${done}/${total}</span>
        </div>
      </div>
      <div class="tree">
        ${
          total
            ? S.snap.curriculum.modules
                .map(
                  (module) => `
                    <div class="mod"><span class="mname">${esc(module.title)}</span><span class="mcount">${module.lessons.length} 课</span></div>
                    ${module.lessons
                      .map((lesson) => {
                        const count = annotationsOf(lesson.id).length;
                        return `<button class="lesson-row${lesson.id === S.lessonId ? ' active' : ''}" data-act="open-lesson" data-id="${esc(lesson.id)}">
                          <span class="no">${String(lesson.no).padStart(2, '0')}</span>
                          <span class="nm">${esc(lesson.title)}</span>
                          <span class="marks">
                            ${S.unread.has(lesson.sessionId) ? '<span class="unread" title="有新消息"></span>' : ''}
                            ${count ? `<span class="annocount">✎${count}</span>` : ''}
                            <span class="dotstate ${esc(lesson.status)}"></span>
                          </span>
                        </button>`;
                      })
                      .join('')}`,
                )
                .join('')
            : `<div class="hint-line" style="padding:8px 6px">还没有课纲。先在概览里让主会话写一份。</div>`
        }
      </div>
      <div class="rail-foot">
        ${
          S.snap.workspace.configured === false
            ? `<button data-act="open-setup">${icon('chat')}配置会话（未完成）</button>`
            : `<button data-act="open-main">${icon('chat')}主会话与全局配置</button>`
        }
        <button data-act="open-notes">${icon('note')}笔记<span class="count">${S.snap.notes.length}</span></button>
        <button data-act="show-rules">${icon('dots')}规则与目录</button>
      </div>`;
  }

  /* ---------------------------------------------------------------- center */

  function centerSignature() {
    return JSON.stringify([S.snapKey, S.center, S.lessonId, S.tab, S.noteId, S.talkOpen]);
  }

  function updateCenter() {
    const head = $('#center-head');
    const body = $('#center-body');
    if (!head || !body || !S.snap) return;
    const sig = centerSignature();
    if (sig === S.centerSig) return;
    S.centerSig = sig;
    body.classList.toggle('flush', S.center === 'lesson' && lessonHasFile(currentLesson()));

    if (S.center === 'overview') {
      head.innerHTML = `<div class="row1"><h2>概览</h2><div class="grow"></div>
        <button class="btn sm" data-act="show-rules">${icon('book')}教学规则</button></div>
        <div class="objective">使命、课纲与资源都在这个目录里，随时可以改。</div>`;
      body.innerHTML = overviewHtml();
      return;
    }

    if (S.center === 'notes' || S.center === 'note') {
      head.innerHTML = `<div class="row1"><h2>笔记</h2><div class="grow"></div>
        <button class="btn sm primary" data-act="open-notes-picker">${icon('plus')}提炼笔记</button></div>
        <div class="objective">按你选的课程范围，结合课程内容与批注，交给她在独立会话里完成。</div>`;
      body.innerHTML = S.center === 'note' ? noteHtml() : notesHtml();
      return;
    }

    const lesson = currentLesson();
    if (!lesson) {
      head.innerHTML = `<div class="row1"><h2>课程</h2></div>`;
      body.innerHTML = `<div class="empty">${icon('book')}<h3>还没有课程</h3><div>先在概览里生成课纲。</div>
        <div class="actions"><button class="btn" data-act="open-overview">去概览</button></div></div>`;
      return;
    }

    const annoCount = annotationsOf(lesson.id).length;
    head.innerHTML = `
      <div class="row1">
        <h2>第 ${String(lesson.no).padStart(2, '0')} 课</h2>
        <span class="chip ${lesson.status === 'done' ? 'ok' : lesson.status === 'active' ? 'live' : 'todo'}">${
          lesson.status === 'done' ? '已完成' : lesson.status === 'active' ? '进行中' : '未开始'
        }</span>
        <span class="subtle" style="font-size:11.5px">约 ${lesson.minutes} 分钟</span>
        <div class="grow"></div>
        ${
          lessonHasFile(lesson)
            ? `<button class="btn sm ghost" data-act="regenerate-lesson" title="整节重写，会覆盖当前课程文件">${icon('refresh')}重新生成</button>`
            : ''
        }
        <button class="btn sm ghost" data-act="toggle-talk">${icon('chat')}${S.talkOpen ? '收起会话' : '会话'}</button>
        <button class="btn sm" data-act="mark-lesson" data-status="${lesson.status === 'done' ? 'active' : 'done'}">
          ${icon('check')}${lesson.status === 'done' ? '标记未完成' : '标记完成'}
        </button>
      </div>
      <div class="objective">${esc(lesson.objective || lesson.title)}</div>
      <div class="tabs">
        <button data-act="tab" data-tab="lesson" class="${S.tab === 'lesson' ? 'on' : ''}">课程</button>
        <button data-act="tab" data-tab="anno" class="${S.tab === 'anno' ? 'on' : ''}">批注 ${annoCount}</button>
      </div>`;

    if (S.tab === 'anno') {
      body.classList.remove('flush');
      body.innerHTML = annotationPaneHtml(lesson);
      return;
    }

    if (!lessonHasFile(lesson)) {
      body.classList.remove('flush');
      body.innerHTML = `<div class="empty">${icon('spark')}<h3>这一课还没有生成</h3>
        <div>课程分支会话会读使命、课纲和前几课的学习记录，再写这节课的 HTML。</div>
        <div class="actions">
          <button class="btn primary" data-act="start-lesson">${icon('play')}让老师开始这一课</button>
          <button class="btn" data-act="refresh-ws">${icon('refresh')}重新读取目录</button>
        </div></div>`;
      return;
    }

    const src = `/w/${encodeURIComponent(S.wsId)}/${lesson.file
      .split('/')
      .map(encodeURIComponent)
      .join('/')}?v=${S.snap.curriculum.updatedAt}`;
    body.innerHTML = `<div class="frame-wrap"><iframe id="lesson-frame" sandbox="allow-scripts allow-same-origin allow-popups allow-modals" title="${esc(
      lesson.title,
    )}" src="${src}"></iframe></div>`;
  }

  function overviewHtml() {
    const summary = S.snap.summary;
    const issues = S.snap.curriculum.issues || [];
    const hasLessons = summary.total > 0;
    const setupPending = S.snap.workspace.configured === false;
    const titleMissing = !setupPending && !S.snap.missionTitle;
    return `<div class="pane">
      <div class="stat-grid">
        <div class="stat"><div class="k">已掌握</div><div class="v">${summary.done}<small> / ${summary.total} 课</small></div></div>
        <div class="stat"><div class="k">批注</div><div class="v">${summary.annotations}</div></div>
        <div class="stat"><div class="k">笔记</div><div class="v">${summary.notes}</div></div>
      </div>

      <div class="card" style="margin-top:12px">
        <div class="card-head"><h3>前置配置</h3>
          <span class="chip ${setupPending ? 'live' : 'ok'}">${setupPending ? '进行中' : '已就绪'}</span>
          <div class="grow"></div>
          ${
            setupPending
              ? `<button class="btn sm primary" data-act="open-setup">${icon('chat')}继续配置</button>`
              : `<button class="btn sm ghost" data-act="show-mission">${icon('book')}完整使命</button>`
          }
        </div>
        ${
          setupPending
            ? `<div class="hint-line">配置会话会在右侧问你几个问题，然后把使命、来源与规则写进这个目录。这一步只搭前置环境，不产出课程和课纲。</div>`
            : `<div class="prose long">${esc((S.snap.missionExcerpt || '').slice(0, 600) || '使命已写入 MISSION.md。')}</div>`
        }
        ${
          titleMissing
            ? `<div class="hint-line warn" style="margin-top:8px">
                MISSION.md 的第一行不是「# Mission: 主题」，工作台名字仍按目录名显示。改成这个格式后点「重新读取」，就会按标题命名。
                <button class="btn sm" style="margin-top:6px" data-act="refresh-ws">${icon('refresh')}重新读取</button>
              </div>`
            : ''
        }
      </div>

      <div class="card">
        <div class="card-head"><h3>课纲</h3>
          <span class="chip ${hasLessons ? 'ok' : 'todo'}">${hasLessons ? `${summary.total} 课` : '未生成'}</span>
          <div class="grow"></div>
          <button class="btn sm" data-act="generate-curriculum">
            ${icon(hasLessons ? 'refresh' : 'spark')}${hasLessons ? '重新生成' : '生成课纲'}
          </button>
        </div>
        ${
          hasLessons
            ? `<div class="prose">${esc(
                S.snap.curriculum.modules
                  .map(
                    (module) =>
                      `${module.title}：${module.lessons
                        .map((lesson) => `${String(lesson.no).padStart(2, '0')} ${lesson.title}`)
                        .join(' · ')}`,
                  )
                  .join('\n'),
              )}</div>`
            : setupPending
              ? `<div class="hint-line">前置配置完成后，主会话才能按使命写课纲。</div>`
              : `<div class="hint-line">主会话会按使命写 3–6 个模块，每节课 15–25 分钟。生成过程在右侧会话里可见。</div>`
        }
        ${issues.length ? `<div class="hint-line" style="color:var(--mcode-danger);margin-top:8px">${esc(issues.join('；'))}</div>` : ''}
        ${
          S.snap.curriculumError
            ? `<div class="hint-line" style="color:var(--mcode-danger);margin-top:8px">
                课纲文件无法解析（${esc(S.snap.curriculumError)}）。让主会话修复格式，或点「重新读取」。
                <button class="btn sm" data-act="refresh-ws" style="margin-top:6px">${icon('refresh')}重新读取</button>
              </div>`
            : ''
        }
      </div>

      <div class="card">
        <div class="card-head"><h3>学习记录</h3><div class="grow"></div><span class="muted" style="font-size:11.5px">learning-records/</span></div>
        ${
          S.snap.records.length
            ? S.snap.records
                .map(
                  (record) =>
                    `<div class="list-row"><div>${icon('check')}</div><div><div class="t">${esc(record.title)}</div><div class="m">${esc(record.rel)}</div></div></div>`,
                )
                .join('')
            : `<div class="hint-line">还没有学习记录。老师说清一个概念、你做出一次正确判断之后，才会写一条。</div>`
        }
      </div>

      <div class="card">
        <div class="card-head"><h3>目录与规则</h3><div class="grow"></div>
          <button class="btn sm" data-act="copy-path">${icon('folder')}复制路径</button>
          <button class="btn sm" data-act="show-rules">${icon('book')}查看规则</button>
        </div>
        <div class="prose mono" style="font-size:11.5px">${esc(S.snap.workspace.root)}</div>
        <div class="hint-line" style="margin-top:6px">规则文件：.workbench/rules/teach.md · 课纲：.workbench/curriculum.json · 课件：lessons/</div>
      </div>
    </div>`;
  }

  function annotationPaneHtml(lesson) {
    const items = annotationsOf(lesson.id);
    return `<div class="anno-pane">
      <div class="row" style="margin-bottom:10px">
        <span class="label">本课批注</span>
        <div class="grow"></div>
        <button class="btn sm" data-act="annotate-lesson">${icon('plus')}整节批注</button>
      </div>
      ${
        items.length
          ? items
              .map(
                (item) => `<div class="anno" id="anno-${esc(item.id)}">
                  ${item.quote ? `<div class="quote">${esc(item.quote)}</div>` : ''}
                  <div class="note">${esc(item.note)}</div>
                  <div class="meta"><span>${timeLabel(item.createdAt)}</span><div class="grow"></div>
                    <button class="btn sm ghost" data-act="edit-anno" data-id="${esc(item.id)}">编辑</button>
                    <button class="btn sm ghost danger" data-act="delete-anno" data-id="${esc(item.id)}">删除</button>
                  </div>
                </div>`,
              )
              .join('')
          : `<div class="hint-line">在左侧课程里选中一句话，点浮动按钮就能批注；也可以点上面的「整节批注」。</div>`
      }
    </div>`;
  }

  function notesHtml() {
    const items = S.snap.notes;
    if (!items.length) {
      return `<div class="empty">${icon('note')}<h3>还没有笔记</h3>
        <div>选几节课，她会在独立会话里把课程内容和你写在课上的批注一起提炼成 Markdown。</div>
        <div class="actions"><button class="btn primary" data-act="open-notes-picker">${icon('plus')}提炼笔记</button></div></div>`;
    }
    return `<div class="pane">
      ${items
        .map((note) => {
          const scope = lessonNumberList(note.lessonIds);
          const statusChip =
            note.status === 'ready'
              ? '<span class="chip ok">已生成</span>'
              : note.status === 'running'
                ? '<span class="chip live">生成中</span>'
                : '<span class="chip todo">未完成</span>';
          return `<button class="note-row" data-act="open-note" data-id="${esc(note.id)}">
            <div style="color:var(--mcode-text-subtle)">${icon('note')}</div>
            <div style="min-width:0;flex:1;text-align:left">
              <div class="nt">${esc(note.title)}</div>
              <div class="nm">${esc(scope)}${scope ? ' · ' : ''}${timeLabel(note.createdAt)}</div>
            </div>
            ${statusChip}
          </button>`;
        })
        .join('')}
      <div class="hint-line" style="margin-top:12px">笔记写入 notes/*.md，可以继续编辑；再提炼时会重新生成一份。</div>
    </div>`;
  }

  function noteHtml() {
    const note = S.snap.notes.find((item) => item.id === S.noteId);
    if (!note) {
      return `<div class="empty">${icon('note')}<h3>笔记不存在</h3><div class="actions"><button class="btn" data-act="open-notes">返回笔记列表</button></div></div>`;
    }
    return `<div class="pane">
      <div class="row" style="margin-bottom:12px">
        <button class="btn sm ghost" data-act="open-notes">${icon('left')}全部笔记</button>
        <div class="grow"></div>
        <span class="muted mono" style="font-size:11px">${esc(note.path)}</span>
      </div>
      <div class="md">${md(S.noteText)}</div>
    </div>`;
  }

  /* ------------------------------------------------------------------ talk */

  const modelCatalog = () =>
    S.boot && S.boot.models && Array.isArray(S.boot.models.models) ? S.boot.models.models : [];
  const fmtChars = (value) => (value >= 10000 ? (value / 1000).toFixed(1) + 'k' : String(value));
  const countTurns = (session) =>
    session && Array.isArray(session.messages)
      ? session.messages.filter((message) => message.role === 'assistant').length
      : 0;
  const countChars = (session) =>
    session && Array.isArray(session.messages)
      ? session.messages.reduce((sum, message) => sum + String(message.text ?? '').length, 0)
      : 0;

  async function switchModel(model) {
    if (!S.sessionId) return;
    const url =
      '/api/ws/' +
      encodeURIComponent(S.wsId) +
      '/sessions/' +
      encodeURIComponent(S.sessionId) +
      '/model';
    try {
      const result = await api(url, { method: 'POST', body: { model } });
      const known = S.transcripts.get(S.sessionId);
      if (known && result && result.session) {
        known.model = result.session.model;
        known.turns = result.session.turns;
        known.chars = result.session.chars;
      }
      updateTalk();
      const option = modelCatalog().find(
        (item) => item.providerId === model.providerId && item.modelId === model.modelId,
      );
      toast('已切到 ' + ((option && option.displayName) || model.modelId) + '，下一轮生效');
    } catch (error) {
      toast(errorText(error), 'error');
      updateTalk();
    }
  }

  function updateTalk() {
    const head = $('#talk-head');
    const body = $('#talk-body');
    const input = $('#talk-input');
    const form = $('#talk-form');
    if (!head || !body || !input) return;

    if (!S.sessionId) {
      head.innerHTML = `<div><div class="t">会话</div><div class="s">选一节课开始</div></div>`;
      body.innerHTML = `<div class="empty" style="margin:30px auto">${icon('chat')}<h3>还没有会话</h3><div>点左侧任意一节课，她会带着使命和课纲开始备课。</div></div>`;
      input.disabled = true;
      input.placeholder = '先选一节课';
      $('#talk-send').disabled = true;
      return;
    }

    const session = S.transcripts.get(S.sessionId);
    const lesson = currentLesson();
    const isMain = session && session.kind === 'main';
    const isNote = session && session.kind === 'note';
    const isSetup = session && session.kind === 'setup';
    const title = session ? session.title : '会话';
    const running = session && (session.running || S.live.get(S.sessionId));
    const catalog = modelCatalog();
    const currentModel = (session && session.model) || (S.boot.models && S.boot.models.default) || null;
    const modelOptions =
      catalog.length && currentModel
        ? catalog
            .map((item) => {
              const value = item.providerId + '|' + item.modelId;
              const selected =
                currentModel.providerId === item.providerId && currentModel.modelId === item.modelId;
              return '<option value="' + esc(value) + '"' + (selected ? ' selected' : '') + '>' + esc(item.displayName || item.modelId) + '</option>';
            })
            .join('')
        : '';
    const turns = session && typeof session.turns === 'number' ? session.turns : countTurns(session);
    const chars = session && typeof session.chars === 'number' ? session.chars : countChars(session);
    head.innerHTML = `
      <div style="min-width:0">
        <div class="t">${esc(title)}</div>
        <div class="s">${
          isSetup
            ? '前置配置 · 只搭环境，不产出课程与课纲'
            : isMain
              ? '使命、课纲与全局配置'
              : isNote
                ? '独立提炼会话 · 只读课程与批注'
                : '分支会话 · 只改这一课'
        }${running ? ' · 正在生成' : ''}</div>
        <div class="talk-meta">
          ${
            modelOptions
              ? '<select id="model-pick" class="model-pick" title="切换模型（下一轮生效）" ' + (running ? 'disabled' : '') + '>' + modelOptions + '</select>'
              : ''
          }
          <span class="talk-stat" title="应用里保存的对话量；上下文与压缩由 MCode 会话管理">${turns} 轮 · 约 ${fmtChars(chars)} 字</span>
        </div>
      </div>
      <div class="grow"></div>
      ${
        !isSetup && !isMain && !isNote
          ? '<button class="btn sm ghost" data-act="renew-lesson" title="新建追问会话，带上本课上下文与上次结论">新开追问</button>'
          : ''
      }
      <button class="btn sm ghost" data-act="toggle-talk" title="${S.talkOpen ? '收起' : '展开'}会话">${icon(S.talkOpen ? 'x' : 'chat')}</button>`;
    const pick = head.querySelector('#model-pick');
    if (pick) {
      pick.addEventListener('change', () => {
        const parts = pick.value.split('|');
        void switchModel({ providerId: parts[0], modelId: parts[1] });
      });
    }

    const draft = S.drafts.get(S.sessionId);
    if (document.activeElement !== input) {
      input.value = draft || '';
      autoSize(input);
    }
    const hasPending = Boolean(
      session && (session.pending || (session.permissions || []).length),
    );
    const notStarted = Boolean(session && !(session.messages || []).length && !session.running);
    input.disabled = !session || notStarted;
    input.placeholder = notStarted
      ? '先让老师开始'
      : hasPending
        ? '先回答上面的问题…'
        : isSetup
          ? '和老师讨论你想从这个目录学到什么…'
          : isMain
            ? '和主会话讨论使命、课纲或全局设置…'
            : isNote
              ? '补充提炼要求，或追问这份笔记…'
              : lesson
                ? `追问第 ${lesson.no} 课…`
                : '追问…';
    $('#talk-send').disabled =
      !session || notStarted || S.sending || Boolean(session.running) || hasPending;
    $('#talk-hint').textContent = S.sending
      ? '正在发送…'
      : notStarted
        ? '这一课还没有开始'
        : session.running
          ? '正在生成 · 可随时停止'
          : hasPending
            ? '回答上面的问题后继续'
            : 'Enter 发送 · Shift+Enter 换行';
    $('#talk-stop').classList.toggle('hidden', !running);

    if (!session) {
      body.innerHTML = `<div class="empty" style="margin:30px auto">${icon('chat')}<h3>正在建立会话</h3><div>稍等一下。</div></div>`;
      return;
    }

    const stick = body.scrollHeight - body.scrollTop - body.clientHeight < 90;
    const hadPending = Boolean(body.querySelector('.card-interact'));
    renderTalkBody(body, session);
    if (hadPending !== Boolean(body.querySelector('.card-interact')) && body.querySelector('.card-interact')) {
      const card = body.querySelector('.card-interact');
      if (card) {
        const top = card.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
        body.scrollTop = Math.max(0, top - 10);
        return;
      }
    }
    if (stick) body.scrollTop = body.scrollHeight;
  }

  function renderTalkBody(body, session) {
    const sid = session.id;
    const parts = [];
    const messages = session.messages || [];

    if (!messages.length && !S.live.get(sid)) {
      parts.push(emptyTalkHtml(session));
    }

    for (const message of messages) {
      parts.push(messageHtml(message, session.kind));
    }

    const live = S.live.get(sid);
    if (live) {
      parts.push(`<div class="msg assistant" id="live-msg">
        <div class="who">${icon('spark')}老师</div>
        <div class="bubble" id="live-text">${md(live)}</div>
      </div>`);
    } else if (session.running) {
      parts.push(`<div class="msg assistant" id="live-msg">
        <div class="who">${icon('spark')}老师</div>
        <div class="bubble"><span class="pending-dots">思考中</span></div>
      </div>`);
    }

    const tools = S.tools.get(sid) || [];
    for (const tool of tools.slice(-3)) {
      parts.push(
        `<div class="tool-line">${icon(tool.ok ? 'check' : 'x')}<span>${tool.phase === 'start' ? '调用' : '完成'}</span><span class="mono">${esc(tool.name)}</span></div>`,
      );
    }

    for (const permission of session.permissions || []) {
      parts.push(permissionHtml(permission));
    }
    if (session.pending) parts.push(pendingHtml(session.pending));

    body.innerHTML = parts.join('');
  }

  function emptyTalkHtml(session) {
    if (session.kind === 'setup') {
      return `<div class="empty" style="margin:24px auto">${icon('spark')}<h3>还没开始配置</h3>
        <div>老师会看你选的目录，问你三个问题，然后把使命、来源和规则写好。这一轮不产出课程。</div>
        <div class="actions"><button class="btn primary" data-act="open-setup">${icon('chat')}开始配置</button></div></div>`;
    }
    if (session.kind === 'main') {
      return `<div class="empty" style="margin:24px auto">${icon('spark')}<h3>主会话还没开始</h3>
        <div>她会先问你为什么学，再把使命写进 MISSION.md，然后才生成课纲。</div>
        <div class="actions"><button class="btn primary" data-act="start-main">${icon('chat')}开始采访</button></div></div>`;
    }
    if (session.kind === 'note') {
      return `<div class="empty" style="margin:24px auto">${icon('note')}<h3>准备提炼</h3>
        <div>她正在读课程与批注。完成后笔记会出现在「笔记」里。</div></div>`;
    }
    return `<div class="empty" style="margin:24px auto">${icon('spark')}<h3>这一课还没开始</h3>
      <div>点下面的按钮，她会先读使命、课纲和资源清单，再开始备课。</div>
      <div class="actions"><button class="btn primary" data-act="start-lesson">${icon('play')}开始这一课</button></div></div>`;
  }

  function messageHtml(message, sessionKind) {
    if (message.kind === 'seed' || message.kind === 'task' || message.kind === 'rewrite') {
      const label =
        message.kind === 'task'
          ? '已交给主会话：生成课纲'
          : message.kind === 'rewrite'
            ? '已让老师整节重写这一课'
            : sessionKind === 'setup'
            ? '已把目录与规则交给配置会话'
            : sessionKind === 'note'
              ? '已把课程与批注交给提炼会话'
              : sessionKind === 'main'
                ? '已把工作台的规则与现状交给主会话'
                : '已把这一课的上下文交给老师';
      return `<div class="msg system"><div class="bubble"><details><summary>${label}</summary><pre style="white-space:pre-wrap;margin:6px 0 0;font-size:11px">${esc(
        message.text,
      )}</pre></details></div></div>`;
    }
    if (message.role === 'system') {
      return `<div class="msg system${message.kind === 'error' ? ' error' : ''}"><div class="bubble">${esc(message.text)}</div></div>`;
    }
    if (message.role === 'user') {
      return `<div class="msg user"><div class="who">你</div><div class="bubble">${esc(message.text)}</div></div>`;
    }
    const clean = String(message.text || '')
      .replace(/<deliver-assets>[\s\S]*?<\/deliver-assets>/gi, '')
      .trim();
    return `<div class="msg assistant"><div class="who">${icon('spark')}老师</div><div class="bubble">${md(
      clean,
    )}</div></div>`;
  }

  function permissionHtml(pending) {
    return `<div class="card-interact">
      <h4>需要授权：${esc(pending.toolName)}</h4>
      <p>${esc(pending.reason || '这次工具调用超出自动授权范围。')}</p>
      <div class="row">
        <button class="btn sm primary" data-act="permission-allow" data-request="${esc(pending.requestId)}">允许一次</button>
        <button class="btn sm" data-act="permission-deny" data-request="${esc(pending.requestId)}">拒绝</button>
      </div>
    </div>`;
  }

  function pendingHtml(pending) {
    const request = pending.request || { steps: [] };
    const plan =
      request.mode === 'plan' && request.modePayload
        ? request.modePayload.markdown || request.modePayload.text || ''
        : '';
    return `<div class="card-interact" id="question-card">
      <h4>${esc(request.title || '需要你的回答')}</h4>
      ${plan ? `<div class="plan">${esc(plan)}</div>` : ''}
      ${(request.steps || [])
        .map(
          (step) => `<div class="step">
            <div class="step-q">${esc(step.question)}</div>
            <div class="opts">
              ${(step.options || [])
                .map(
                  (option) => `<label class="opt">
                    <input type="${step.selectionMode === 'multiple' ? 'checkbox' : 'radio'}" name="step:${esc(
                      step.id,
                    )}" value="${esc(option.id)}" data-step="${esc(step.id)}" />
                    <span>${esc(option.label)}${
                      option.description ? `<span class="d">${esc(option.description)}</span>` : ''
                    }</span>
                  </label>`,
                )
                .join('')}
            </div>
            <input class="field" data-other="${esc(step.id)}" placeholder="其他（可选，直接写你的答案）" />
          </div>`,
        )
        .join('')}
      <div class="row" style="margin-top:10px">
        <button class="btn sm primary" data-act="answer-question" data-request="${esc(pending.requestId)}">提交回答</button>
        <button class="btn sm ghost" data-act="skip-question" data-request="${esc(pending.requestId)}">跳过</button>
      </div>
    </div>`;
  }

  /* ------------------------------------------------------------- workspace */

  async function selectLesson(lessonId, options) {
    const opts = options || {};
    S.lessonId = lessonId;
    S.center = 'lesson';
    S.tab = 'lesson';
    S.centerSig = '';
    S.talkError = '';
    localStorage.setItem(`wb.lesson.${S.wsId}`, lessonId);
    updateCenter();
    updateRail();
    if (opts.silent && !S.talkOpen) return;
    try {
      const result = await api(
        `/api/ws/${encodeURIComponent(S.wsId)}/lessons/${encodeURIComponent(lessonId)}/open`,
        { method: 'POST', body: { seed: Boolean(opts.seed) } },
      );
      if (result && result.sessionId) {
        await openSession(result.sessionId);
      } else {
        updateTalk();
      }
    } catch (error) {
      if (opts.seed && (error.code === 'ANSWER_PENDING' || error.code === 'BUSY')) {
        // The lesson's session is waiting for an answer or still running: open it
        // as it stands instead of starting a turn over it.
        return selectLesson(lessonId, { seed: false });
      }
      S.talkError = errorText(error);
      toast(errorText(error), 'error');
      updateTalk();
    }
  }

  async function openSession(sessionId) {
    S.sessionId = sessionId;
    S.unread.delete(sessionId);
    await loadTranscript(sessionId);
    updateTalk();
    updateRail();
  }

  async function renewLesson() {
    const lesson = currentLesson();
    closeModal();
    if (!lesson) return;
    try {
      const result = await api(
        '/api/ws/' + encodeURIComponent(S.wsId) + '/lessons/' + encodeURIComponent(lesson.id) + '/renew',
        { method: 'POST', body: {} },
      );
      S.boot = await api('/api/bootstrap');
      S.centerSig = '';
      await refreshSnapshot();
      if (result && result.sessionId) {
        S.talkOpen = true;
        renderShell(false);
        await openSession(result.sessionId);
      }
      toast('已新开追问，这一课的上下文重新带上');
    } catch (error) {
      toast(errorText(error), 'error');
    }
  }

  async function regenerateLesson() {
    const lesson = currentLesson();
    closeModal();
    if (!lesson) return;
    try {
      const result = await api(
        '/api/ws/' + encodeURIComponent(S.wsId) + '/lessons/' + encodeURIComponent(lesson.id) + '/regenerate',
        { method: 'POST', body: {} },
      );
      S.talkOpen = true;
      S.centerSig = '';
      renderShell(false);
      if (result && result.sessionId) await openSession(result.sessionId);
      await refreshSnapshot();
      toast('正在整节重写这一课');
    } catch (error) {
      toast(errorText(error), 'error');
    }
  }

  async function loadTranscript(sessionId) {
    const token = (S.loads.get(sessionId) || 0) + 1;
    S.loads.set(sessionId, token);
    try {
      const data = await api(
        `/api/ws/${encodeURIComponent(S.wsId)}/sessions/${encodeURIComponent(sessionId)}`,
      );
      if (S.loads.get(sessionId) !== token) return;
      S.transcripts.set(sessionId, data);
      if (!data.running) S.live.delete(sessionId);
    } catch (error) {
      if (S.loads.get(sessionId) !== token) return;
      toast(errorText(error), 'error');
    }
  }

  async function sendCurrent() {
    const input = $('#talk-input');
    if (!input || !S.sessionId || S.sending) return;
    const text = input.value.trim();
    if (!text) return;
    const sid = S.sessionId;
    S.sending = true;
    const transcript = S.transcripts.get(sid);
    if (transcript) {
      transcript.messages = transcript.messages.concat({
        id: `tmp_${Date.now()}`,
        role: 'user',
        text,
        at: Date.now(),
      });
    }
    S.drafts.delete(sid);
    input.value = '';
    autoSize(input);
    S.live.delete(sid);
    updateTalk();
    $('#talk-send').disabled = true;
    try {
      await api(`/api/ws/${encodeURIComponent(S.wsId)}/sessions/${encodeURIComponent(sid)}/send`, {
        method: 'POST',
        body: { text },
      });
      if (transcript) transcript.running = true;
    } catch (error) {
      toast(errorText(error), 'error');
      S.drafts.set(sid, text);
      input.value = text;
      autoSize(input);
    } finally {
      S.sending = false;
      updateTalk();
    }
  }

  async function submitAnswers(skip) {
    const session = currentSession();
    if (!session || !session.pending || session.pending.kind !== 'question') return;
    const pending = session.pending;
    const body = $('#talk-body');
    const steps = (pending.request && pending.request.steps) || [];
    const answers = steps.map((step) => {
      const inputs = $$(`[data-step="${cssEscape(step.id)}"]`, body).filter((node) => node.checked);
      const other = $(`[data-other="${cssEscape(step.id)}"]`, body);
      const otherText = other && other.value.trim();
      return {
        stepId: step.id,
        selectedOptionIds: skip ? [] : inputs.map((node) => node.value),
        selectedOther: Boolean(otherText),
        otherText: otherText || undefined,
        skipped: Boolean(skip),
      };
    });
    try {
      await api(
        `/api/ws/${encodeURIComponent(S.wsId)}/sessions/${encodeURIComponent(session.id)}/answer`,
        { method: 'POST', body: { requestId: pending.requestId, answers } },
      );
      session.pending = null;
      updateTalk();
    } catch (error) {
      toast(errorText(error), 'error');
    }
  }

  function cssEscape(value) {
    return String(value).replace(/["\\]/g, '\\$&');
  }

  async function replyPermission(requestId, decision) {
    const session = currentSession();
    if (!session) return;
    try {
      await api(
        `/api/ws/${encodeURIComponent(S.wsId)}/sessions/${encodeURIComponent(session.id)}/reply`,
        { method: 'POST', body: { requestId, decision } },
      );
      session.permissions = (session.permissions || []).filter((item) => item.requestId !== requestId);
      updateTalk();
    } catch (error) {
      toast(errorText(error), 'error');
    }
  }

  async function cancelTurn() {
    const session = currentSession();
    if (!session) return;
    try {
      await api(
        `/api/ws/${encodeURIComponent(S.wsId)}/sessions/${encodeURIComponent(session.id)}/cancel`,
        { method: 'POST', body: {} },
      );
      toast('已请求停止这一轮');
    } catch (error) {
      toast(errorText(error), 'error');
    }
  }

  async function openMain(options) {
    void options;
    try {
      const result = await api(`/api/ws/${encodeURIComponent(S.wsId)}/main/open`, {
        method: 'POST',
        body: {},
      });
      if (result && result.sessionId) {
        S.talkOpen = true;
        renderShell(false);
        await openSession(result.sessionId);
        toast('已打开主会话（右侧栏）');
      }
    } catch (error) {
      toast(errorText(error), 'error');
    }
  }

  async function generateCurriculum() {
    if (S.snap.workspace.configured === false) {
      toast('先完成前置配置，再生成课纲');
      await openSetupSession();
      return;
    }
    try {
      const result = await api(`/api/ws/${encodeURIComponent(S.wsId)}/curriculum`, {
        method: 'POST',
        body: {},
      });
      S.talkOpen = true;
      renderShell(false);
      if (result && result.sessionId) await openSession(result.sessionId);
      toast('主会话正在写课纲，完成后课纲会自动出现');
    } catch (error) {
      if (error && error.code === 'SETUP_REQUIRED') {
        toast('先完成前置配置，再生成课纲');
        await openSetupSession();
        return;
      }
      toast(errorText(error), 'error');
    }
  }

  async function refreshSnapshot() {
    if (!S.wsId) return;
    try {
      setSnapshot(await api(`/api/ws/${encodeURIComponent(S.wsId)}`));
    } catch {
      return;
    }
    const bootEntry = ((S.boot && S.boot.workspaces) || []).find((workspace) => workspace.id === S.wsId);
    if (bootEntry && bootEntry.name !== S.snap.workspace.name) bootEntry.name = S.snap.workspace.name;
    if (S.lessonId && !findLesson(S.lessonId)) S.lessonId = pickLesson();
    if ((S.center === 'note' || S.center === 'notes') && !S.snap.notes.length) S.center = 'overview';
    if (S.center === 'note' && S.noteId && !S.snap.notes.some((note) => note.id === S.noteId)) {
      S.center = 'notes';
    }
    S.centerSig = '';
    updateTop();
    updateRail();
    updateCenter();
    updateTalk();
  }

  async function markLesson(status) {
    if (!S.lessonId) return;
    try {
      const result = await api(
        `/api/ws/${encodeURIComponent(S.wsId)}/lessons/${encodeURIComponent(S.lessonId)}/status`,
        { method: 'POST', body: { status } },
      );
      if (result && result.snapshot) setSnapshot(result.snapshot);
      S.centerSig = '';
      updateRail();
      updateCenter();
      toast(status === 'done' ? '已标记完成' : '已标记未完成');
    } catch (error) {
      toast(errorText(error), 'error');
    }
  }

  async function openNote(noteId) {
    const note = S.snap.notes.find((item) => item.id === noteId);
    if (!note) return;
    if (note.status !== 'ready') {
      if (note.sessionId) {
        S.center = 'notes';
        S.centerSig = '';
        updateCenter();
        S.talkOpen = true;
        renderShell(false);
        await openSession(note.sessionId);
        toast(note.status === 'running' ? '这份笔记还在生成，下面是提炼会话' : '这份笔记没写成功，可以在会话里追问');
      }
      return;
    }
    try {
      const result = await api(
        `/api/ws/${encodeURIComponent(S.wsId)}/file?rel=${encodeURIComponent(note.path)}`,
      );
      S.noteId = noteId;
      S.noteText = result.text || '';
      S.center = 'note';
      S.centerSig = '';
      updateCenter();
      if (note.sessionId) await openSession(note.sessionId);
    } catch (error) {
      toast(errorText(error), 'error');
    }
  }

  /* --------------------------------------------------------------- modals */

  function openModal(config) {
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-backdrop" data-act="modal-backdrop">
      <div class="modal${config.wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(
        config.title,
      )}">
        <div class="modal-head"><h3>${esc(config.title)}</h3><div class="grow"></div>
          <button class="btn icon ghost" data-act="close-modal" aria-label="关闭">${icon('x')}</button>
        </div>
        <div class="modal-body">${config.body || ''}</div>
        ${config.footer ? `<div class="modal-foot">${config.footer}</div>` : ''}
      </div>
    </div>`;
    if (config.onMount) config.onMount(root);
    window.setTimeout(() => {
      const focusable = root.querySelector('input, textarea, button.primary');
      if (focusable) focusable.focus();
    }, 40);
  }

  function closeModal() {
    $('#modal-root').innerHTML = '';
    S.picker = null;
  }

  /* -------------------------------------------------------- directory picker */

  async function openPicker(mode) {
    const start = (S.boot && S.boot.home) || '';
    S.picker = {
      mode,
      path: start,
      input: start,
      error: '',
      parent: null,
      entries: [],
      loading: true,
      busy: false,
    };
    await loadDir(S.picker.path);
  }

  /** Accept what people actually paste: quotes, file://, trailing slash, spaces. */
  function normalizePathInput(value) {
    let text = String(value ?? '').trim();
    text = text.replace(/^["'`]+/, '').replace(/["'`]+$/, '').trim();
    text = text.replace(/^file:\/\/\/?/i, '');
    text = text.replace(/[\\/]+$/, '');
    if (/^[a-zA-Z]:$/.test(text)) text += '\\';
    return text;
  }

  function isAbsolutePath(value) {
    return /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\/.test(value);
  }

  async function loadDir(target) {
    const picker = S.picker;
    if (!picker) return false;
    const next = normalizePathInput(target);
    picker.input = String(target ?? '');
    if (!isAbsolutePath(next)) {
      picker.error = '要填完整路径，例如 D:\\代码\\项目名';
      picker.loading = false;
      renderPicker();
      return false;
    }
    picker.loading = true;
    picker.error = '';
    renderPicker();
    try {
      const data = await api(`/api/fs/list?path=${encodeURIComponent(next)}`);
      picker.path = data.path;
      picker.parent = data.parent;
      picker.entries = data.entries;
      picker.input = data.path;
      picker.error = '';
      return true;
    } catch (error) {
      // Keep the typed value so a bad paste never silently falls back to the
      // previously browsed directory.
      picker.input = String(target ?? '');
      picker.error =
        error.code === 'not_a_directory' || error.code === 'path_must_be_absolute'
          ? '读不到这个目录：确认路径存在、且是一个文件夹'
          : errorText(error);
      return false;
    } finally {
      picker.loading = false;
      renderPicker();
    }
  }

  function renderPicker() {
    const picker = S.picker;
    if (!picker) return;
    const isCreate = picker.mode === 'create';
    const typed = normalizePathInput(picker.input || picker.path);
    const body = `
      <div class="row" style="gap:6px">
        <button class="btn sm ghost" data-act="picker-up" ${picker.parent ? '' : 'disabled'} title="上一级">${icon('up')}</button>
        <input class="field mono" id="pick-path" value="${esc(picker.input ?? picker.path)}" aria-label="目录路径" spellcheck="false" style="font-size:12px" />
        <button class="btn sm" data-act="picker-go" ${picker.loading ? 'disabled' : ''}>读取</button>
      </div>
      ${picker.error ? `<div class="hint-line" style="color:var(--mcode-danger)">${esc(picker.error)}</div>` : ''}
      <div class="dir-list" role="group" aria-label="目录">
        ${
          picker.loading
            ? `<div class="hint-line" style="padding:10px">读取中…</div>`
            : picker.entries.length
              ? picker.entries
                  .map(
                    (entry) => `<button class="dir${entry.hidden ? ' hidden-dir' : ''}" data-act="picker-enter" data-path="${esc(
                      entry.path,
                    )}">
                      ${icon('folder')}<span class="n">${esc(entry.name)}</span>
                      ${entry.isWorkspace ? '<span class="badge">学习工作台</span>' : ''}
                    </button>`,
                  )
                  .join('')
              : `<div class="hint-line" style="padding:10px">这个目录里没有子目录。</div>`
        }
      </div>
      ${
        isCreate
          ? `<div class="stack">
              <div class="row" style="gap:6px">
                <span class="muted" style="font-size:12px">将在</span>
                <span class="mono" style="font-size:12px;word-break:break-all">${esc(
                  typed || '（还没选）',
                )}</span>
              </div>
              <div class="hint-line">会在这里生成 MISSION.md、RESOURCES.md、GLOSSARY.md、lessons/、reference/、.workbench/ 等结构；已有同名文件不会覆盖。</div>
              <div class="hint-line">主题、使命和规则不在这里填——创建工作台后会开一个配置会话，老师先问清楚再写，这一轮不产出课程和课纲。</div>
            </div>`
          : `<div class="hint-line">选择已经用学习工作台创建过的目录（里面有 .workbench/workspace.json）。</div>`
      }`;
    const footer = isCreate
      ? `<div class="left"><button class="btn ghost" data-act="close-modal">取消</button></div>
         <button class="btn primary" data-act="create-ws" ${picker.busy || !typed ? 'disabled' : ''}>${picker.busy ? '创建中…' : '创建工作台'}</button>`
      : `<div class="left"><button class="btn ghost" data-act="close-modal">取消</button></div>
         <button class="btn primary" data-act="import-ws" ${picker.busy || !typed ? 'disabled' : ''}>${picker.busy ? '导入中…' : '使用此目录'}</button>`;
    openModal({
      title: isCreate ? '新建学习工作台' : '导入已有学习工作台',
      body,
      footer,
      wide: true,
      onMount: (root) => {
        const pathInput = $('#pick-path', root);
        if (!pathInput) return;
        pathInput.addEventListener('input', () => {
          picker.input = pathInput.value;
          picker.error = '';
          const line = root.querySelector('.stack .mono');
          if (line) line.textContent = normalizePathInput(pathInput.value) || '（还没选）';
        });
        pathInput.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void loadDir(pathInput.value);
          }
        });
      },
    });
    window.setTimeout(() => {
      const input = $('#pick-path');
      if (input && document.activeElement !== input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }, 30);
  }

  /** Verify the typed path, then create — never reuse a stale browsed path. */
  async function resolveTargetPath() {
    const picker = S.picker;
    if (!picker) return null;
    const input = $('#pick-path');
    const raw = input ? input.value : picker.input;
    const target = normalizePathInput(raw);
    if (!isAbsolutePath(target)) {
      picker.input = String(raw ?? '');
      picker.error = '要填完整路径，例如 D:\\代码\\项目名';
      renderPicker();
      return null;
    }
    picker.input = String(raw ?? '');
    const listing = await api(`/api/fs/list?path=${encodeURIComponent(target)}`);
    return listing.path;
  }

  async function submitCreate() {
    const picker = S.picker;
    if (!picker) return;
    picker.busy = true;
    renderPicker();
    try {
      const target = await resolveTargetPath();
      if (!target) {
        picker.busy = false;
        renderPicker();
        return;
      }
      picker.path = target;
      picker.input = target;
      const result = await api('/api/workspaces/create', {
        method: 'POST',
        body: { parentPath: target },
      });
      closeModal();
      S.boot = await api('/api/bootstrap');
      S.talkOpen = window.innerWidth > 1120;
      await openWorkspace(result.workspace.id);
      toast(result.existing ? '这个目录已经是学习工作台' : '工作台已创建，老师开始配置');
    } catch (error) {
      picker.busy = false;
      picker.error = errorText(error);
      renderPicker();
      toast(errorText(error), 'error');
    }
  }

  async function submitImport() {
    const picker = S.picker;
    if (!picker) return;
    picker.busy = true;
    renderPicker();
    try {
      const target = await resolveTargetPath();
      if (!target) {
        picker.busy = false;
        renderPicker();
        return;
      }
      picker.path = target;
      picker.input = target;
      const result = await api('/api/workspaces/import', {
        method: 'POST',
        body: { root: target },
      });
      closeModal();
      S.boot = await api('/api/bootstrap');
      S.talkOpen = window.innerWidth > 1120;
      await openWorkspace(result.workspace.id);
      toast('已导入');
    } catch (error) {
      picker.busy = false;
      picker.error = errorText(error);
      renderPicker();
      toast(errorText(error), 'error');
    }
  }

  /* -------------------------------------------------------------- manage */

  const cleanList = () => (S.boot && Array.isArray(S.boot.cleanTargets) ? S.boot.cleanTargets : []);
  const defaultCleanTargets = () =>
    new Set(cleanList().filter((row) => row.default).map((row) => row.key));

  function openManage(view, id) {
    S.manage = {
      view: view || 'list',
      id: id || '',
      targets: defaultCleanTargets(),
    };
    renderManage();
  }

  function renderManage() {
    const manage = S.manage;
    if (!manage) return;
    const workspaces = (S.boot && S.boot.workspaces) || [];

    if (manage.view === 'clean') {
      const workspace = workspaces.find((item) => item.id === manage.id);
      if (!workspace) {
        openManage('list');
        return;
      }
      const rows = cleanList();
      openModal({
        title: '清理产物',
        wide: true,
        body: `<div class="hint-line">只删下面勾选的路径；目录里的其他文件（源码、docs、datasets 等）不会动。</div>
          <div class="mono" style="font-size:11.5px;word-break:break-all">${esc(workspace.root)}</div>
          <div class="stack" style="gap:6px">
            ${rows
              .map(
                (row) => `<label class="clean-row">
                  <input type="checkbox" data-clean="${esc(row.key)}" ${manage.targets.has(row.key) ? 'checked' : ''} />
                  <span><span class="mono">${esc(row.label)}</span> <span class="subtle">${esc(row.hint)}</span></span>
                </label>`,
              )
              .join('')}
          </div>`,
        footer: `<div class="left"><button class="btn ghost" data-act="manage-back">返回</button></div>
          <button class="btn danger" data-act="manage-clean-confirm">清理选中的内容</button>`,
        onMount: (root) => {
          root.querySelectorAll('input[data-clean]').forEach((input) => {
            input.addEventListener('change', () => {
              if (input.checked) manage.targets.add(input.dataset.clean);
              else manage.targets.delete(input.dataset.clean);
            });
          });
        },
      });
      return;
    }

    openModal({
      title: '工作台管理',
      wide: true,
      body: `<div class="hint-line">新增、移除，或清理某个工作台按 teach 规约生成的文件。</div>
        ${
          workspaces.length
            ? workspaces
                .map(
                  (workspace) => `<div class="manage-row">
                    <div style="flex:1;min-width:0">
                      <div class="nt">${esc(workspace.name)}${
                        workspace.id === S.wsId ? ' <span class="chip ok">当前</span>' : ''
                      }</div>
                      <div class="nm mono">${esc(workspace.root)}</div>
                    </div>
                    ${
                      workspace.id === S.wsId
                        ? ''
                        : `<button class="btn sm" data-act="manage-open" data-id="${esc(workspace.id)}">打开</button>`
                    }
                    <button class="btn sm" data-act="manage-clean" data-id="${esc(workspace.id)}">清理</button>
                    <button class="btn sm ghost danger" data-act="manage-remove" data-id="${esc(workspace.id)}">移除</button>
                  </div>`,
                )
                .join('')
            : '<div class="hint-line">还没有工作台。</div>'
        }`,
      footer: `<div class="left"><button class="btn ghost" data-act="close-modal">关闭</button></div>
        <button class="btn" data-act="open-picker" data-mode="import">导入已有</button>
        <button class="btn primary" data-act="open-picker" data-mode="create">新建工作台</button>`,
    });
  }

  async function confirmClean() {
    const manage = S.manage;
    if (!manage) return;
    const targets = Array.from(manage.targets);
    if (!targets.length) {
      toast('先勾选要清理的内容');
      return;
    }
    // The clean stops running turns before it deletes, so show the wait.
    const button = $('[data-act="manage-clean-confirm"]');
    const label = button ? button.textContent : '';
    if (button) {
      button.disabled = true;
      button.textContent = '清理中…';
    }
    try {
      const result = await api(`/api/ws/${encodeURIComponent(manage.id)}/clean`, {
        method: 'POST',
        body: { targets },
      });
      const wasCurrent = manage.id === S.wsId;
      S.boot = await api('/api/bootstrap');
      const count = result.removed ? result.removed.length : 0;
      const effects = result.effects || {};
      const notes = effects.notesPruned ? `，笔记索引移除 ${effects.notesPruned} 条` : '';
      toast(`已清理 ${count} 项${notes}`);
      if (result.workspaceGone) {
        closeModal();
        if (wasCurrent) {
          const next = (S.boot.workspaces || [])[0];
          if (next) {
            await openWorkspace(next.id);
          } else {
            S.wsId = null;
            setSnapshot(null);
            renderLanding();
          }
        }
        return;
      }
      if (wasCurrent) {
        S.centerSig = '';
        await refreshSnapshot();
      }
      openManage('list');
    } catch (error) {
      if (button) {
        button.disabled = false;
        button.textContent = label;
      }
      toast(errorText(error), 'error');
    }
  }

  function confirmRemove(id) {
    const workspace = ((S.boot && S.boot.workspaces) || []).find((item) => item.id === id);
    if (!workspace) return;
    openModal({
      title: '移除工作台',
      body: `<div>把「${esc(workspace.name)}」从列表移除。磁盘上的文件不会删除，之后可以再导入。</div>
        <div class="mono" style="font-size:11.5px;word-break:break-all">${esc(workspace.root)}</div>`,
      footer: `<div class="left"><button class="btn ghost" data-act="close-modal">取消</button></div>
        <button class="btn danger" data-act="manage-remove-confirm" data-id="${esc(id)}">移除</button>`,
    });
  }

  async function doRemove(id) {
    try {
      await api('/api/workspaces/forget', { method: 'POST', body: { id } });
      closeModal();
      S.boot = await api('/api/bootstrap');
      if (id === S.wsId) {
        const next = (S.boot.workspaces || [])[0];
        if (next) {
          await openWorkspace(next.id);
        } else {
          S.wsId = null;
          setSnapshot(null);
          renderLanding();
        }
      } else {
        toast('已从列表移除');
      }
    } catch (error) {
      toast(errorText(error), 'error');
    }
  }

  /* ------------------------------------------------------------- annotate */

  function openAnnotate(options) {
    const opts = options || {};
    S.pendingQuote = opts.quote || '';
    S.pendingAnnoId = opts.id || '';
    const existing = opts.id ? S.snap.annotations.find((item) => item.id === opts.id) : null;
    openModal({
      title: existing ? '编辑批注' : '添加批注',
      body: `
        ${opts.quote ? `<div class="quote-box">${esc(opts.quote)}</div>` : ''}
        <textarea class="field note-input" id="anno-note" placeholder="写下你的想法：疑问、反例、和你工作里的对应关系…">${esc(
          existing ? existing.note : '',
        )}</textarea>
        <div class="hint-line">${
          opts.quote ? '批注会挂在这句话上，并在这节课里高亮。' : '整节批注会挂在这一课上。'
        } 提炼笔记时会被一起带上。</div>`,
      footer: `<div class="left"><button class="btn ghost" data-act="close-modal">取消</button></div>
        <button class="btn primary" data-act="save-anno">${existing ? '保存' : '添加批注'}</button>`,
    });
  }

  async function saveAnnotation() {
    const input = $('#anno-note');
    const note = input ? input.value.trim() : '';
    if (!note) {
      toast('写点什么再保存');
      return;
    }
    try {
      await api(`/api/ws/${encodeURIComponent(S.wsId)}/annotations`, {
        method: 'POST',
        body: {
          action: S.pendingAnnoId ? 'update' : 'create',
          id: S.pendingAnnoId || undefined,
          lessonId: S.lessonId,
          quote: S.pendingQuote,
          note,
        },
      });
      closeModal();
      await refreshSnapshot();
      S.tab = 'anno';
      S.centerSig = '';
      updateCenter();
      toast('已保存批注');
    } catch (error) {
      toast(errorText(error), 'error');
    }
  }

  async function deleteAnnotation(id) {
    openModal({
      title: '删除批注',
      body: `<div>删除后无法恢复。这节课的笔记如果已经生成，不受影响。</div>`,
      footer: `<div class="left"><button class="btn ghost" data-act="close-modal">取消</button></div>
        <button class="btn primary" data-act="confirm-delete-anno" data-id="${esc(id)}">删除</button>`,
    });
  }

  async function confirmDeleteAnnotation(id) {
    try {
      await api(`/api/ws/${encodeURIComponent(S.wsId)}/annotations`, {
        method: 'POST',
        body: { action: 'delete', id },
      });
      closeModal();
      await refreshSnapshot();
      S.centerSig = '';
      updateCenter();
    } catch (error) {
      toast(errorText(error), 'error');
    }
  }

  /* ---------------------------------------------------------------- notes */

  function openNotesPicker() {
    const lessons = lessonsOf().filter((lesson) => lessonHasFile(lesson));
    if (!lessons.length) {
      toast('还没有生成任何课程文件');
      return;
    }
    const state = {
      selected: new Set(lessons.map((lesson) => lesson.id)),
      title: '',
      titleTouched: false,
    };
    const render = () => {
      const selectedLessons = lessons.filter((lesson) => state.selected.has(lesson.id));
      const annotationCount = S.snap.annotations.filter((item) => state.selected.has(item.lessonId)).length;
      if (!state.titleTouched) {
        state.title = `${lessonNumberList(Array.from(state.selected))}笔记`;
      }
      const body = `
        <div class="form-label">范围</div>
        ${
          S.snap.curriculum.modules
            .map((module) => {
              const rows = module.lessons.filter((lesson) => lessonHasFile(lesson));
              if (!rows.length) return '';
              return `<div class="pick-group">
                <div class="g-title">${esc(module.title)}</div>
                ${rows
                  .map((lesson) => {
                    const count = annotationsOf(lesson.id).length;
                    return `<label class="pick-row">
                      <input type="checkbox" data-lesson="${esc(lesson.id)}" ${
                        state.selected.has(lesson.id) ? 'checked' : ''
                      } />
                      <span class="t">第 ${String(lesson.no).padStart(2, '0')} 课 · ${esc(lesson.title)}</span>
                      ${count ? `<span class="c">✎ ${count}</span>` : ''}
                    </label>`;
                  })
                  .join('')}
              </div>`;
            })
            .join('')
        }
        <div class="form-label" style="margin-top:6px">笔记标题</div>
        <input class="field" id="note-title" value="${esc(state.title)}" />
        <div class="hint-line">会带上你选中的 ${
          selectedLessons.length
        } 节课的课程内容与 ${annotationCount} 条批注，在独立会话里写成 <span class="mono">notes/*.md</span>。</div>`;
      openModal({
        title: '提炼笔记',
        body,
        footer: `<div class="left"><button class="btn ghost" data-act="close-modal">取消</button></div>
          <button class="btn primary" data-act="start-note" ${
            selectedLessons.length ? '' : 'disabled'
          }>开始提炼</button>`,
        wide: true,
        onMount: (root) => {
          root.querySelectorAll('input[data-lesson]').forEach((input) => {
            input.addEventListener('change', () => {
              if (input.checked) state.selected.add(input.dataset.lesson);
              else state.selected.delete(input.dataset.lesson);
              render();
            });
          });
          const title = $('#note-title', root);
          if (title) {
            title.addEventListener('input', () => {
              state.title = title.value;
              state.titleTouched = true;
            });
          }
        },
      });
      S.notePick = state;
    };
    render();
  }

  async function startNote() {
    const state = S.notePick;
    if (!state) return;
    const lessonIds = Array.from(state.selected);
    if (!lessonIds.length) return;
    const title = (state.title || '').trim() || `${lessonNumberList(lessonIds)}笔记`;
    try {
      const result = await api(`/api/ws/${encodeURIComponent(S.wsId)}/notes`, {
        method: 'POST',
        body: { lessonIds, title },
      });
      closeModal();
      S.center = 'notes';
      S.centerSig = '';
      S.talkOpen = true;
      renderShell(false);
      await refreshSnapshot();
      if (result && result.sessionId) await openSession(result.sessionId);
      toast('已开一个独立会话提炼笔记');
    } catch (error) {
      toast(errorText(error), 'error');
    }
  }

  /* ---------------------------------------------------------------- rules */

  async function showRules() {
    try {
      const result = await api(`/api/ws/${encodeURIComponent(S.wsId)}/rules`);
      openModal({
        title: '教学规则 · teach.md',
        wide: true,
        body: `<div class="hint-line mono">${esc(result.path || '')}</div>
          <pre class="prose mono" style="font-size:11.5px;white-space:pre-wrap;max-height:56vh;overflow:auto">${esc(
            result.text || '',
          )}</pre>`,
        footer: `<button class="btn" data-act="close-modal">关闭</button>`,
      });
    } catch (error) {
      toast(errorText(error), 'error');
    }
  }

  /* ---------------------------------------------------------------- events */

  function handleEvent(event) {
    let message = null;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!message || (message.wsId && message.wsId !== S.wsId)) return;

    if (message.t === 'delta') {
      const sid = message.sessionId;
      const next = (S.live.get(sid) || '') + (message.text || '');
      S.live.set(sid, next);
      if (sid === S.sessionId) {
        const body = $('#talk-body');
        const live = $('#live-text');
        if (body && live) {
          const stick = body.scrollHeight - body.scrollTop - body.clientHeight < 90;
          live.innerHTML = md(next);
          if (stick) body.scrollTop = body.scrollHeight;
        } else {
          updateTalk();
        }
      }
      return;
    }

    if (message.t === 'session') {
      const sid = message.sessionId;
      const session = message.session;
      if (!session) return;
      if (!session.running) {
        S.live.delete(sid);
      }
      const known = S.transcripts.get(sid);
      if (known) {
        known.running = session.running;
        known.pending = session.pending;
        known.permissions = session.permissions || [];
        known.title = session.title;
      }
      if (sid === S.sessionId) {
        void loadTranscript(sid).then(() => {
          S.tools.delete(sid);
          updateTalk();
        });
      } else if (session.messageCount > ((known && known.messages.length) || 0)) {
        S.unread.add(sid);
        updateRail();
      }
      return;
    }

    if (message.t === 'tool') {
      if (message.phase !== 'end') return;
      const sid = message.sessionId;
      const list = S.tools.get(sid) || [];
      list.push({ name: message.name, phase: message.phase, ok: message.ok });
      S.tools.set(sid, list.slice(-6));
      if (sid === S.sessionId) {
        const body = $('#talk-body');
        if (body) {
          const stick = body.scrollHeight - body.scrollTop - body.clientHeight < 90;
          renderTalkBody(body, S.transcripts.get(sid) || { id: sid, messages: [] });
          if (stick) body.scrollTop = body.scrollHeight;
        }
      }
      return;
    }

    if (message.t === 'state' || message.t === 'annotations') {
      window.clearTimeout(handleEvent.timer);
      handleEvent.timer = window.setTimeout(() => {
        void refreshSnapshot();
      }, 250);
    }
  }

  let reconnectCount = 0;
  function connectEvents() {
    if (S.es) {
      S.es.close();
      S.es = null;
    }
    if (!S.wsId) return;
    try {
      const es = new EventSource('/api/events');
      es.onmessage = handleEvent;
      es.onopen = () => {
        reconnectCount += 1;
        if (reconnectCount > 1) void refreshSnapshot();
      };
      es.onerror = () => {
        /* EventSource reconnects on its own */
      };
      S.es = es;
    } catch {
      /* ignore */
    }
  }

  /* --------------------------------------------------------------- bridge */

  /** Resolve a lesson link against the lesson's own path; '' when it leaves the workspace. */
  function resolveDocRel(lessonRel, href) {
    const raw = String(href || '').trim();
    if (!raw || raw.startsWith('#') || raw.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return '';
    const clean = raw.split('#')[0].split('?')[0];
    if (!clean) return '';
    let decoded = clean;
    try {
      decoded = decodeURIComponent(clean);
    } catch {
      /* keep the raw value */
    }
    const out = [];
    for (const part of String(lessonRel || '').split('/').slice(0, -1).concat(decoded.split('/'))) {
      if (!part || part === '.') continue;
      if (part === '..') {
        if (!out.length) return '';
        out.pop();
        continue;
      }
      out.push(part);
    }
    return out.join('/');
  }

  /** "main.py:46–48" → {line:46,end:48}; ":1807" → {line:1807,end:1807}. */
  function parseLineRef(text) {
    const match = String(text || '').match(/:(\d+)(?:\s*[–—-]\s*(\d+))?/);
    if (!match) return { line: 0, end: 0 };
    const line = Number(match[1]) || 0;
    const end = Number(match[2]) || line;
    return { line, end: Math.max(line, end) };
  }

  function openWorkspacePage(rel) {
    const frame = $('#lesson-frame');
    if (!frame) return;
    frame.src = `/w/${encodeURIComponent(S.wsId)}/${rel.split('/').map(encodeURIComponent).join('/')}`;
  }

  async function openCodePanel(data) {
    const lessonRel = data.rel || (currentLesson() || {}).file || '';
    const rel = resolveDocRel(lessonRel, data.href);
    if (!rel) {
      toast('这个链接不在工作台里，暂时打不开');
      return;
    }
    // A link to another lesson or a reference page is page navigation, not a
    // code view: switch lessons for a lesson page, otherwise load the page into
    // the lesson frame.
    const target = lessonByFile(rel);
    if (target) {
      await selectLesson(target.id, { seed: false });
      return;
    }
    if ((S.snap.lessonFiles || []).includes(rel) || (S.snap.referenceFiles || []).includes(rel)) {
      openWorkspacePage(rel);
      return;
    }
    const range = parseLineRef(data.text);
    let payload;
    try {
      payload = await api(`/api/ws/${encodeURIComponent(S.wsId)}/file?rel=${encodeURIComponent(rel)}`);
    } catch (error) {
      toast(errorText(error), 'error');
      return;
    }
    const lines = String(payload.text || '').replace(/\r\n/g, '\n').split('\n');
    const start = range.line ? Math.min(range.line, lines.length) : 0;
    const end = start ? Math.min(range.end || start, lines.length) : 0;
    const rows = lines
      .map((code, index) => {
        const no = index + 1;
        const hit = start && no >= start && no <= end ? ' hit' : '';
        return `<div class="file-row${hit}" data-line="${no}"><span class="ln">${no}</span><span class="lc">${esc(code) || ' '}</span></div>`;
      })
      .join('');
    const label = start ? `${rel}:${start}${end > start ? `–${end}` : ''}` : rel;
    openModal({
      title: label,
      wide: true,
      body: `<div class="file-view">${rows}</div>`,
      footer: `<div class="left subtle" style="font-size:11.5px">共 ${lines.length} 行</div><button class="btn ghost" data-act="close-modal">关闭</button>`,
      onMount: (root) => {
        const view = root.querySelector('.file-view');
        const hit = view ? view.querySelector('.file-row.hit') : null;
        if (view && hit) view.scrollTop = Math.max(0, hit.offsetTop - view.clientHeight / 3);
      },
    });
  }

  window.addEventListener('message', (event) => {
    const frame = $('#lesson-frame');
    if (!frame || event.source !== frame.contentWindow) return;
    const data = event.data;
    if (!data || data.source !== 'wb') return;
    if (data.type === 'file' && data.href) {
      void openCodePanel(data);
      return;
    }
    if (data.type === 'annotate' && data.quote) {
      openAnnotate({ quote: data.quote });
    }
    if (data.type === 'ask' && data.quote) {
      const quote = String(data.quote).slice(0, 300);
      const prefix = '关于「' + quote + '」：';
      const apply = () => {
        if (!S.sessionId) return;
        S.talkOpen = true;
        renderShell(false);
        S.drafts.set(S.sessionId, prefix);
        const input = $('#talk-input');
        if (!input) return;
        input.value = prefix;
        input.focus();
        input.setSelectionRange(prefix.length, prefix.length);
        autoSize(input);
      };
      if (S.sessionId) {
        apply();
        return;
      }
      // Reading a lesson without its branch session open: open it, then prefill.
      const lessonId = pickLesson();
      if (!lessonId) return;
      void selectLesson(lessonId, { seed: false }).then(apply).catch(() => {});
    }
    if (data.type === 'open' && data.id) {
      S.tab = 'anno';
      S.centerSig = '';
      updateCenter();
      window.setTimeout(() => {
        const node = $(`#anno-${CSS.escape(data.id)}`);
        if (node) {
          node.scrollIntoView({ block: 'center', behavior: 'smooth' });
          node.classList.add('flash');
          window.setTimeout(() => node.classList.remove('flash'), 1800);
        }
      }, 60);
    }
    if (data.type === 'ready') {
      frame.contentWindow.postMessage(
        {
          source: 'host',
          type: 'theme',
          theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
        },
        '*',
      );
    }
  });

  /* -------------------------------------------------------------- handlers */

  const ACTIONS = {
    'close-modal': () => closeModal(),
    'modal-backdrop': (node, event) => {
      if (event.target === node) closeModal();
    },
    'open-picker': (node) => openPicker(node.dataset.mode || 'create'),
    'picker-up': () => {
      if (S.picker && S.picker.parent) void loadDir(S.picker.parent);
    },
    'picker-enter': (node) => {
      if (node.dataset.path) void loadDir(node.dataset.path);
    },
    'picker-go': () => {
      const input = $('#pick-path');
      void loadDir(input ? input.value : S.picker && S.picker.input);
    },
    'create-ws': () => void submitCreate(),
    'import-ws': () => void submitImport(),
    'open-ws': (node) => void openWorkspace(node.dataset.id),
    'manage-ws': () => openManage('list'),
    'manage-open': (node) => {
      closeModal();
      S.talkOpen = window.innerWidth > 1120;
      void openWorkspace(node.dataset.id);
    },
    'manage-clean': (node) => {
      S.manage.view = 'clean';
      S.manage.id = node.dataset.id;
      S.manage.targets = defaultCleanTargets();
      renderManage();
    },
    'manage-back': () => {
      S.manage.view = 'list';
      renderManage();
    },
    'manage-clean-confirm': () => void confirmClean(),
    'manage-remove': (node) => confirmRemove(node.dataset.id),
    'manage-remove-confirm': (node) => void doRemove(node.dataset.id),
    'open-lesson': (node) => void selectLesson(node.dataset.id, { seed: true }),
    'renew-lesson': () => {
      const lesson = currentLesson();
      if (!lesson) return;
      openModal({
        title: '新开追问',
        body: '<div>会为「第 ' + lesson.no + ' 课」新建一个分支会话：带上这一课的上下文与上一轮的结论。旧会话记录保留，课件不会被改写。</div>',
        footer: '<div class="left"><button class="btn ghost" data-act="close-modal">取消</button></div>' +
          '<button class="btn primary" data-act="renew-lesson-confirm">新开追问</button>',
      });
    },
    'renew-lesson-confirm': () => void renewLesson(),
    'regenerate-lesson': () => {
      const lesson = currentLesson();
      if (!lesson) return;
      openModal({
        title: '重新生成这一课',
        body:
          '<div>会按课纲把「第 ' +
          lesson.no +
          ' 课」整节重写，覆盖 <span class="mono">' +
          esc(lesson.file || '本课文件') +
          '</span>。课件内容会被替换，批注、笔记与学习记录保留。</div>',
        footer:
          '<div class="left"><button class="btn ghost" data-act="close-modal">取消</button></div>' +
          '<button class="btn danger" data-act="regenerate-lesson-confirm">重新生成</button>',
      });
    },
    'regenerate-lesson-confirm': () => void regenerateLesson(),
    'open-main': () => void openMain(),
    'open-setup': () => void openSetupSession(),
    'open-overview': () => {
      S.center = 'overview';
      S.centerSig = '';
      updateTop();
      updateCenter();
    },
    'open-notes': () => {
      S.center = 'notes';
      S.noteId = null;
      S.centerSig = '';
      updateTop();
      updateCenter();
    },
    'open-note': (node) => void openNote(node.dataset.id),
    tab: (node) => {
      S.tab = node.dataset.tab === 'anno' ? 'anno' : 'lesson';
      S.centerSig = '';
      updateCenter();
    },
    'toggle-talk': () => {
      S.talkOpen = !S.talkOpen;
      renderShell(false);
    },
    'mark-lesson': (node) => void markLesson(node.dataset.status),
    'start-lesson': () => {
      if (S.lessonId) void selectLesson(S.lessonId, { seed: true });
    },
    'start-main': () => void openMain({ seed: true }),
    'generate-curriculum': () => void generateCurriculum(),
    'refresh-ws': () => {
      void (async () => {
        try {
          const result = await api(`/api/ws/${encodeURIComponent(S.wsId)}/refresh`, {
            method: 'POST',
            body: {},
          });
          if (result && result.snapshot) setSnapshot(result.snapshot);
          S.centerSig = '';
          updateTop();
          updateRail();
          updateCenter();
          toast(result && result.error ? `课纲解析失败：${result.error}` : '已重新读取');
        } catch (error) {
          toast(errorText(error), 'error');
        }
      })();
    },
    'annotate-lesson': () => openAnnotate({ quote: '' }),
    'edit-anno': (node) => {
      const item = S.snap.annotations.find((entry) => entry.id === node.dataset.id);
      if (item) openAnnotate({ quote: item.quote, id: item.id });
    },
    'delete-anno': (node) => void deleteAnnotation(node.dataset.id),
    'confirm-delete-anno': (node) => void confirmDeleteAnnotation(node.dataset.id),
    'save-anno': () => void saveAnnotation(),
    'permission-allow': (node) => void replyPermission(node.dataset.request, 'allowOnce'),
    'permission-deny': (node) => void replyPermission(node.dataset.request, 'deny'),
    'answer-question': () => void submitAnswers(false),
    'skip-question': () => void submitAnswers(true),
    'cancel-turn': () => void cancelTurn(),
    'open-notes-picker': () => openNotesPicker(),
    'start-note': () => void startNote(),
    'show-rules': () => void showRules(),
    'show-mission': () =>
      openModal({
        title: '使命 · MISSION.md',
        wide: true,
        body: `<div class="md">${md((S.snap && S.snap.mission) || '')}</div>`,
        footer: `<button class="btn" data-act="close-modal">关闭</button>`,
      }),
    'copy-path': () => {
      const root = S.snap && S.snap.workspace.root;
      if (!root) return;
      navigator.clipboard
        .writeText(root)
        .then(() => toast('路径已复制'))
        .catch(() => toast('复制失败', 'error'));
    },
  };

  document.addEventListener('click', (event) => {
    const node = event.target.closest ? event.target.closest('[data-act]') : null;
    if (!node) return;
    // The modal backdrop is an ancestor of everything in the dialog. Clicks on
    // inputs, checkboxes and links inside it must keep their default behaviour.
    if (node.dataset.act === 'modal-backdrop' && event.target !== node) return;
    const action = ACTIONS[node.dataset.act];
    if (!action) return;
    event.preventDefault();
    action(node, event);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && $('#modal-root').children.length) closeModal();
  });

  /* ------------------------------------------------------------------ boot */

  async function boot() {
    initTheme();
    try {
      S.boot = await api('/api/bootstrap');
    } catch (error) {
      $('#app').innerHTML = `<div class="landing"><div class="landing-inner">
        <h1>无法连接学习工作台</h1>
        <div class="sub">${esc(errorText(error))}</div>
        <button class="btn" onclick="location.reload()">重新加载</button>
      </div></div>`;
      return;
    }
    // A path-vocabulary drift is a code problem: say it here instead of leaving
    // the startup check in a log nobody reads.
    const pathIssues = (S.boot && S.boot.diagnostics && S.boot.diagnostics.pathVocabulary) || [];
    if (pathIssues.length) {
      console.warn('[check-paths]', pathIssues);
      toast(`路径检查发现 ${pathIssues.length} 处问题，详见控制台`, 'error');
    }
    S.talkOpen = window.innerWidth > 1120;
    const list = S.boot.workspaces || [];
    if (!list.length) {
      renderLanding();
      return;
    }
    const last = localStorage.getItem('wb.last');
    const target = list.find((workspace) => workspace.id === last) || list[0];
    await openWorkspace(target.id);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      const input = $('#talk-input');
      if (input && S.sessionId) S.drafts.set(S.sessionId, input.value);
    }
    if (document.visibilityState === 'visible' && S.wsId) {
      void refreshSnapshot();
    }
  });

  void boot();
})();
