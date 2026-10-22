// CadQuery Viewer — white-model render panel.
//
// Captures the current view as a white model, asks the Node side to start a background render (one
// Agent turn per render), and follows the renders: progress, approvals the Agent asks for, results.
// Approvals are decided only by the user's click here; this page never answers one on its own.

const STATUS_TEXT = {
  queued: '排队中',
  running: '渲染中',
  approval: '等待授权',
  done: '已完成',
  error: '失败',
  cancelled: '已取消',
};
const ASPECT_VALUES = { '1:1': 1, '4:3': 4 / 3, '3:4': 3 / 4, '16:9': 16 / 9, '9:16': 9 / 16 };
const ACTIVE = new Set(['queued', 'running', 'approval']);
const CAPTURE_LONG_SIDE = 1600;
const PREVIEW_LONG_SIDE = 640;
const MAX_PROMPT = 800;

/**
 * @param {{
 *   apiUrl: (path: string, query?: Record<string, string>) => string,
 *   errorMessage: (res: Response) => Promise<string>,
 *   capture: (opts: {longSide: number, aspect: number, keepColors: boolean}) => string,
 *   hasModel: () => boolean,
 *   modelNames: () => string[],
 *   frameAspect: () => number,
 *   folder: () => string | null,
 *   isOpen: () => boolean,
 *   open: () => void,
 *   showToast: (text: string, kind?: string, ms?: number) => void,
 *   prefs: {renderStyle: string|null, renderAspect: string, renderColors: boolean},
 *   savePrefs: () => void,
 * }} api
 */
export function createRenderPanel(api) {
  const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
  const el = {
    toggle: $('render-toggle'),
    badge: $('render-badge'),
    unavailable: $('render-unavailable'),
    form: /** @type {HTMLFormElement} */ ($('render-form')),
    preview: $('render-preview'),
    previewImg: /** @type {HTMLImageElement} */ ($('render-preview-img')),
    previewCaption: $('render-preview-caption'),
    styles: $('render-styles'),
    styleHint: $('render-style-hint'),
    aspect: /** @type {HTMLSelectElement} */ ($('render-aspect')),
    colors: /** @type {HTMLInputElement} */ ($('render-colors')),
    prompt: /** @type {HTMLTextAreaElement} */ ($('render-prompt')),
    promptCount: $('render-prompt-count'),
    start: /** @type {HTMLButtonElement} */ ($('render-start')),
    startLabel: $('render-start-label'),
    status: $('render-status'),
    jobs: $('render-jobs'),
    jobsEmpty: $('render-jobs-empty'),
    jobsCount: $('render-jobs-count'),
    dialog: /** @type {HTMLDialogElement} */ ($('render-dialog')),
    dialogImg: /** @type {HTMLImageElement} */ ($('render-dialog-img')),
    dialogMeta: $('render-dialog-meta'),
    dialogCopy: /** @type {HTMLButtonElement} */ ($('render-dialog-copy')),
    dialogDownload: /** @type {HTMLAnchorElement} */ ($('render-dialog-download')),
    dialogClose: $('render-dialog-close'),
    dialogViews: /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('[data-render-view]')]),
  };

  /** @type {{available: boolean|null, styles: {id: string, label: string, hint: string}[], jobs: any[]}} */
  const data = { available: null, styles: [], jobs: [] };
  let style = api.prefs.renderStyle || 'studio';
  let submitting = false;
  let loaded = false;
  /** @type {Map<string, string>} last status seen per render, to announce changes */
  const lastStatus = new Map();
  /** @type {Map<string, {li: HTMLLIElement, stamp: string}>} */
  const items = new Map();
  /** @type {ReturnType<typeof setInterval> | null} */
  let ticker = null;
  /** @type {{job: any, view: 'output'|'input'} | null} */
  let dialogState = null;

  // ---------------------------------------------------------------- helpers
  const fileUrl = (job, which, extra = {}) => api.apiUrl(`renders/${job.id}/${which}`, { v: job.updatedAt, ...extra });
  const styleLabel = (id) => data.styles.find((s) => s.id === id)?.label ?? id;
  const agentBridge = () => /** @type {any} */ (window).mcode?.miniapp?.agent;
  /** Nearest supported ratio to the framed model. */
  const autoAspectName = () => {
    const va = api.frameAspect();
    let best = '4:3';
    let bestErr = Infinity;
    for (const [name, v] of Object.entries(ASPECT_VALUES)) {
      const err = Math.abs(Math.log(v) - Math.log(va));
      if (err < bestErr) {
        best = name;
        bestErr = err;
      }
    }
    return best;
  };
  const resolveAspect = () => (el.aspect.value === 'auto' ? autoAspectName() : el.aspect.value);

  function setStatus(text, kind = 'info') {
    el.status.textContent = text;
    el.status.dataset.kind = kind;
  }

  function fmtTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    return d.toDateString() === new Date().toDateString() ? time : `${d.getMonth() + 1}/${d.getDate()} ${time}`;
  }
  function fmtElapsed(fromIso) {
    const s = Math.max(0, Math.round((Date.now() - Date.parse(fromIso)) / 1000));
    return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
  }

  /** Small DOM builder. */
  function h(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'className') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of children) if (c !== null && c !== undefined && c !== false) node.append(c);
    return node;
  }

  // ---------------------------------------------------------------- form
  function renderStyles() {
    el.styles.replaceChildren(
      ...data.styles.map((s) =>
        h(
          'label',
          { className: 'style-chip', title: s.hint },
          h('input', {
            type: 'radio',
            name: 'render-style',
            value: s.id,
            checked: s.id === style,
            onchange: () => {
              style = s.id;
              api.prefs.renderStyle = style;
              api.savePrefs();
              el.styleHint.textContent = s.hint;
            },
          }),
          h('span', { text: s.label }),
        ),
      ),
    );
    if (!data.styles.some((s) => s.id === style) && data.styles[0]) {
      style = data.styles[0].id;
      /** @type {HTMLInputElement|null} */ (el.styles.querySelector('input'))?.click();
    }
    el.styleHint.textContent = data.styles.find((s) => s.id === style)?.hint ?? '';
  }

  function updateForm() {
    const hasModel = api.hasModel();
    const ok = data.available === true;
    el.start.disabled = submitting || !ok || !hasModel;
    el.startLabel.textContent = submitting ? '正在启动…' : '开始渲染';
    el.unavailable.hidden = data.available !== false;
    el.unavailable.textContent = '后台渲染需要 MiniMax Code 3.1.2 或更高版本，并且这个 Mini App 获得了运行 Agent 的权限。';
    const n = el.prompt.value.length;
    el.promptCount.textContent = `${n} / ${MAX_PROMPT}`;
  }

  let previewTimer = null;
  function schedulePreview() {
    if (!api.isOpen()) return;
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      previewTimer = null;
      updatePreview();
    }, 160);
  }
  function updatePreview() {
    updateForm();
    const aspect = resolveAspect();
    el.preview.style.aspectRatio = aspect.replace(':', ' / ');
    if (!api.hasModel()) {
      el.preview.dataset.empty = 'true';
      el.previewImg.hidden = true;
      el.previewImg.removeAttribute('src');
      el.previewCaption.textContent = '先打开一个模型';
      return;
    }
    try {
      el.previewImg.src = api.capture({ longSide: PREVIEW_LONG_SIDE, aspect: ASPECT_VALUES[aspect], keepColors: el.colors.checked });
      el.previewImg.hidden = false;
      el.preview.dataset.empty = 'false';
      el.previewCaption.textContent = `当前角度 · 按模型构图 · ${aspect}${el.aspect.value === 'auto' ? '（自动）' : ''}`;
    } catch {
      el.preview.dataset.empty = 'true';
      el.previewImg.hidden = true;
      el.previewCaption.textContent = '预览生成失败';
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (submitting || data.available !== true) return;
    if (!api.hasModel()) {
      setStatus('先打开一个模型', 'error');
      return;
    }
    const aspect = resolveAspect();
    let image;
    try {
      image = api.capture({ longSide: CAPTURE_LONG_SIDE, aspect: ASPECT_VALUES[aspect], keepColors: el.colors.checked });
    } catch {
      setStatus('白模截图没有生成成功，请重试', 'error');
      return;
    }
    submitting = true;
    updateForm();
    setStatus('正在启动后台渲染…');
    try {
      const res = await fetch(api.apiUrl('renders'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          image,
          style,
          aspect,
          keepColors: el.colors.checked,
          prompt: el.prompt.value,
          models: api.modelNames(),
          ...(api.folder() ? { folder: api.folder() } : {}),
        }),
      });
      if (!res.ok) throw new Error(await api.errorMessage(res));
      const { job } = await res.json();
      lastStatus.set(job.id, job.status);
      upsert(job);
      revealJob(job.id);
      setStatus('已在后台开始，可以继续操作，完成后会提示你', 'ok');
    } catch (error) {
      setStatus(`没有开始：${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      submitting = false;
      updateForm();
    }
  }

  // ---------------------------------------------------------------- jobs
  function upsert(job) {
    const i = data.jobs.findIndex((j) => j.id === job.id);
    if (i >= 0) data.jobs[i] = job;
    else data.jobs.unshift(job);
    renderJobs();
  }

  async function refresh() {
    try {
      const folder = api.folder();
      const res = await fetch(api.apiUrl('renders', folder ? { folder } : undefined), { cache: 'no-store' });
      if (!res.ok) throw new Error(await api.errorMessage(res));
      const next = await res.json();
      if (!next || !Array.isArray(next.jobs)) throw new Error('渲染记录格式不正确');
      const firstStyles = data.styles.length === 0;
      data.available = next.available === true;
      data.styles = Array.isArray(next.styles) ? next.styles : [];
      // renders belong to a session folder: outside a chat there are none to show
      data.jobs = folder ? next.jobs.filter((j) => j && typeof j.id === 'string') : [];
      if (firstStyles) renderStyles();
      announce();
      renderJobs();
      updateForm();
      loaded = true;
    } catch (error) {
      if (!loaded) setStatus(`渲染记录没有读取成功：${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }

  /** Tell the user about changes that happened while they were doing something else. */
  function announce() {
    for (const job of data.jobs) {
      const before = lastStatus.get(job.id);
      lastStatus.set(job.id, job.status);
      if (!loaded || before === job.status) continue;
      if (job.status === 'approval') {
        if (api.isOpen()) requestAnimationFrame(() => revealJob(job.id));
        else api.showToast('后台渲染在等你授权，打开「白模渲染」处理', 'warning', 6000);
      } else if (job.status === 'done' && before && ACTIVE.has(before)) {
        api.showToast('渲染完成', 'info', 3000);
        if (!data.jobs.some((j) => ACTIVE.has(j.status))) setStatus('');
      } else if (job.status === 'error' && before && ACTIVE.has(before)) {
        api.showToast('渲染失败，详情见「白模渲染」', 'error', 4000);
        if (!data.jobs.some((j) => ACTIVE.has(j.status))) setStatus('');
      }
    }
  }

  /** Scroll a render into view inside the panel (the form above can push it below the fold). */
  function revealJob(id) {
    const li = items.get(id)?.li;
    if (!li || !api.isOpen()) return;
    li.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  function renderJobs() {
    let prev = null;
    const seen = new Set();
    for (const job of data.jobs) {
      seen.add(job.id);
      const stamp = `${job.updatedAt}|${job.status}|${agentBridge() ? 1 : 0}`;
      let entry = items.get(job.id);
      if (!entry || entry.stamp !== stamp) {
        const active = /** @type {HTMLElement|null} */ (document.activeElement);
        const refocus = entry && active && entry.li.contains(active) ? active.dataset.action : null;
        const li = jobItem(job);
        if (entry) entry.li.replaceWith(li);
        entry = { li, stamp };
        items.set(job.id, entry);
        if (refocus) /** @type {HTMLElement|null} */ (li.querySelector(`[data-action="${refocus}"]`))?.focus();
      }
      const want = prev ? prev.nextSibling : el.jobs.firstChild;
      if (entry.li !== want) el.jobs.insertBefore(entry.li, want);
      prev = entry.li;
    }
    for (const [id, entry] of items) {
      if (!seen.has(id)) {
        entry.li.remove();
        items.delete(id);
      }
    }
    const active = data.jobs.filter((j) => ACTIVE.has(j.status));
    el.jobsEmpty.hidden = data.jobs.length > 0;
    el.jobsCount.textContent = data.jobs.length ? String(data.jobs.length) : '';
    el.badge.hidden = active.length === 0;
    el.badge.textContent = String(active.length);
    el.badge.dataset.kind = active.some((j) => j.status === 'approval') ? 'warning' : '';
    if (active.length && !ticker) ticker = setInterval(tick, 1000);
    if (!active.length && ticker) {
      clearInterval(ticker);
      ticker = null;
    }
    if (dialogState) {
      const fresh = data.jobs.find((j) => j.id === dialogState.job.id);
      if (!fresh || fresh.status !== 'done') closeDialog();
    }
  }

  function tick() {
    for (const span of el.jobs.querySelectorAll('[data-since]')) {
      span.textContent = `已用 ${fmtElapsed(/** @type {HTMLElement} */ (span).dataset.since || '')}`;
    }
  }

  function jobItem(job) {
    const active = ACTIVE.has(job.status);
    const done = job.status === 'done';
    const li = /** @type {HTMLLIElement} */ (h('li', { className: 'job', dataset: { status: job.status } }));

    const thumb = h(
      'button',
      {
        type: 'button',
        className: 'job-thumb',
        'aria-label': done ? '查看成品图' : '查看白模截图',
        onclick: () => openDialog(job, done ? 'output' : 'input'),
      },
      h('img', { src: fileUrl(job, done ? 'output' : 'input'), alt: '', loading: 'lazy', decoding: 'async' }),
    );

    const head = h(
      'div',
      { className: 'job-head' },
      h('span', { className: 'pill', dataset: { status: job.status }, text: STATUS_TEXT[job.status] ?? job.status }),
      h('span', { className: 'job-meta', text: [fmtTime(job.createdAt), styleLabel(job.style), job.aspect].filter(Boolean).join(' · ') }),
    );
    const promptText = job.prompt ? job.prompt : '没有补充描述';
    const prompt = h('p', { className: job.prompt ? 'job-prompt' : 'job-prompt muted', title: job.prompt || undefined, text: promptText });

    const main = h('div', { className: 'job-main' }, head, prompt);
    if (active) {
      main.append(
        h(
          'p',
          { className: 'job-step', role: 'status' },
          h('span', { text: job.step || STATUS_TEXT[job.status] }),
          ' · ',
          h('span', { dataset: { since: job.startedAt || job.createdAt }, text: `已用 ${fmtElapsed(job.startedAt || job.createdAt)}` }),
        ),
      );
    }
    if (job.status === 'approval' && job.permission) main.append(approvalCard(job));
    if (job.status === 'error' && job.error) main.append(h('p', { className: 'job-error', role: 'alert', text: job.error }));

    const actions = h('div', { className: 'job-actions' });
    const canOpenSession = !!job.sessionId && typeof agentBridge()?.open === 'function';
    if (done) {
      actions.append(
        actionBtn('view', '查看', () => openDialog(job, 'output')),
        actionBtn('copy', '复制图片', (btn) => void copyImage(job, btn)),
        h('a', { className: 'btn ghost small-btn', dataset: { action: 'download' }, href: fileUrl(job, 'output', { download: '1' }), download: `cq-render-${job.id}` }, '下载'),
      );
    }
    if (active) {
      if (canOpenSession) actions.append(actionBtn('session', '查看过程', () => void openSession(job)));
      actions.append(actionBtn('cancel', '取消', (btn) => void post(job, 'cancel', {}, btn)));
    } else {
      if (!done) actions.append(actionBtn('retry', '重试', (btn) => void post(job, 'retry', {}, btn)));
      if (canOpenSession) actions.append(actionBtn('session', '查看过程', () => void openSession(job)));
      actions.append(deleteBtn(job));
    }
    main.append(actions);
    li.append(thumb, main);
    return li;
  }

  function actionBtn(action, label, onClick) {
    const btn = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', className: 'btn ghost small-btn', dataset: { action }, text: label }));
    btn.addEventListener('click', () => onClick(btn));
    return btn;
  }

  /** Two-step delete: the first click asks, the second (within 4 s) removes. */
  function deleteBtn(job) {
    let armed = null;
    const btn = actionBtn('delete', '删除', async () => {
      if (!armed) {
        btn.textContent = '确认删除';
        btn.classList.add('danger');
        armed = setTimeout(() => {
          armed = null;
          btn.textContent = '删除';
          btn.classList.remove('danger');
        }, 4000);
        return;
      }
      clearTimeout(armed);
      armed = null;
      btn.disabled = true;
      try {
        const res = await fetch(api.apiUrl(`renders/${job.id}`), { method: 'DELETE' });
        if (!res.ok) throw new Error(await api.errorMessage(res));
        data.jobs = data.jobs.filter((j) => j.id !== job.id);
        renderJobs();
      } catch (error) {
        btn.disabled = false;
        api.showToast(`没有删除：${error instanceof Error ? error.message : String(error)}`, 'error', 4000);
      }
    });
    return btn;
  }

  function approvalCard(job) {
    const p = job.permission;
    const decide = async (decision, btn) => {
      for (const b of card.querySelectorAll('button')) /** @type {HTMLButtonElement} */ (b).disabled = true;
      const ok = await post(job, 'permission', { requestId: p.requestId, decision }, btn);
      if (!ok) for (const b of card.querySelectorAll('button')) /** @type {HTMLButtonElement} */ (b).disabled = false;
    };
    const card = h(
      'div',
      { className: 'job-approval', role: 'group', 'aria-label': `后台 Agent 请求使用 ${p.toolName}` },
      h('p', { className: 'job-approval-title' }, '后台 Agent 请求使用 ', h('strong', { text: p.toolName || '工具' })),
      p.toolInput ? h('pre', { className: 'job-approval-input', text: p.toolInput }) : null,
      p.reason ? h('p', { className: 'muted small job-approval-reason', text: p.reason }) : null,
      h(
        'div',
        { className: 'job-approval-actions' },
        actionBtnPlain('deny', '拒绝', 'btn', (btn) => void decide('deny', btn)),
        actionBtnPlain('allow', '允许一次', 'btn btn-primary', (btn) => void decide('allowOnce', btn)),
      ),
    );
    return card;
  }
  function actionBtnPlain(action, label, className, onClick) {
    const btn = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', className, dataset: { action }, text: label }));
    btn.addEventListener('click', () => onClick(btn));
    return btn;
  }

  /** @returns {Promise<boolean>} */
  async function post(job, action, body, btn) {
    if (btn) btn.disabled = true;
    try {
      const res = await fetch(api.apiUrl(`renders/${job.id}/${action}`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await api.errorMessage(res));
      const result = await res.json();
      if (result?.job) upsert(result.job);
      if (action === 'retry') api.showToast('已用同一张白模重新开始渲染', 'info', 2500);
      return true;
    } catch (error) {
      api.showToast(`操作没有完成：${error instanceof Error ? error.message : String(error)}`, 'error', 4000);
      void refresh();
      return false;
    } finally {
      if (btn && btn.isConnected) btn.disabled = false;
    }
  }

  async function openSession(job) {
    const bridge = agentBridge();
    if (typeof bridge?.open !== 'function') return;
    try {
      await bridge.open(job.sessionId);
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      api.showToast(
        code === 'not_permitted'
          ? '需要在对话里打开 Viewer，才能在侧栏查看后台过程'
          : code === 'session_not_found'
            ? '这个后台会话已不存在'
            : `没有打开：${code}`,
        'error',
        4000,
      );
    }
  }

  async function copyImage(job, btn) {
    btn.disabled = true;
    try {
      const blob = await (await fetch(fileUrl(job, 'output'), { cache: 'no-store' })).blob();
      let png = blob;
      if (blob.type !== 'image/png') {
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d')).drawImage(bitmap, 0, 0);
        bitmap.close();
        png = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'));
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      api.showToast('图片已复制', 'info', 1800);
    } catch {
      api.showToast('这个窗口不能写入剪贴板，可以用「下载」保存图片', 'warning', 4000);
    } finally {
      btn.disabled = false;
    }
  }

  // ---------------------------------------------------------------- viewer dialog
  function openDialog(job, view) {
    dialogState = { job, view: job.status === 'done' ? view : 'input' };
    const canOutput = job.status === 'done';
    for (const b of el.dialogViews) b.disabled = b.dataset.renderView === 'output' && !canOutput;
    el.dialogCopy.hidden = !canOutput;
    el.dialogDownload.hidden = !canOutput;
    el.dialogMeta.textContent = [fmtTime(job.createdAt), styleLabel(job.style), job.aspect, job.prompt].filter(Boolean).join(' · ');
    showDialogView();
    if (!el.dialog.open) el.dialog.showModal();
  }
  function showDialogView() {
    if (!dialogState) return;
    const { job, view } = dialogState;
    el.dialogImg.src = fileUrl(job, view);
    el.dialogImg.alt = view === 'output' ? '渲染成品图' : '发送给渲染的白模截图';
    for (const b of el.dialogViews) b.setAttribute('aria-pressed', String(b.dataset.renderView === view));
    if (job.status === 'done') {
      el.dialogDownload.href = fileUrl(job, 'output', { download: '1' });
      el.dialogDownload.setAttribute('download', `cq-render-${job.id}`);
    }
  }
  function closeDialog() {
    dialogState = null;
    if (el.dialog.open) el.dialog.close();
  }

  // ---------------------------------------------------------------- wiring
  function init() {
    el.aspect.value = Object.hasOwn(ASPECT_VALUES, api.prefs.renderAspect) ? api.prefs.renderAspect : 'auto';
    el.colors.checked = api.prefs.renderColors;
    el.form.addEventListener('submit', submit);
    el.aspect.addEventListener('change', () => {
      api.prefs.renderAspect = el.aspect.value;
      api.savePrefs();
      updatePreview();
    });
    el.colors.addEventListener('change', () => {
      api.prefs.renderColors = el.colors.checked;
      api.savePrefs();
      updatePreview();
    });
    el.prompt.addEventListener('input', updateForm);
    el.prompt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        el.form.requestSubmit();
      }
    });
    el.toggle.addEventListener('click', () => api.open());
    for (const b of el.dialogViews) {
      b.addEventListener('click', () => {
        if (!dialogState || b.disabled) return;
        dialogState.view = /** @type {'output'|'input'} */ (b.dataset.renderView);
        showDialogView();
      });
    }
    el.dialogClose.addEventListener('click', closeDialog);
    el.dialog.addEventListener('close', () => (dialogState = null));
    el.dialog.addEventListener('click', (e) => {
      if (e.target === el.dialog) closeDialog(); // backdrop
    });
    el.dialogCopy.addEventListener('click', () => {
      if (dialogState) void copyImage(dialogState.job, el.dialogCopy);
    });
    updateForm();
  }

  return {
    init,
    refresh,
    /** Camera, visibility, loaded models, or window size changed. */
    viewChanged: schedulePreview,
    /** @param {boolean} open */
    panelToggled(open) {
      el.toggle.setAttribute('aria-pressed', String(open));
      if (open) {
        updatePreview();
        void refresh();
      }
    },
    isDialogOpen: () => el.dialog.open,
  };
}
