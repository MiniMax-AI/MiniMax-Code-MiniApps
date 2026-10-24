'use strict';

/**
 * 动态工作流控制台 — Client.
 *
 * 数据全部来自本 Node 运行时转发的 Workflow Studio JSON API；页面本身不知道任何上游地址。
 */

const STATUS = {
  pending_review: { label: '待审核', tone: 'warning' },
  running: { label: '执行中', tone: 'accent' },
  queued: { label: '排队中', tone: 'muted' },
  pausing: { label: '暂停中', tone: 'warning' },
  stopping: { label: '停止中', tone: 'warning' },
  paused: { label: '已暂停', tone: 'warning' },
  succeeded: { label: '已完成', tone: 'success' },
  failed: { label: '失败', tone: 'danger' },
  interrupted: { label: '已中断', tone: 'warning' },
  cancelled: { label: '已取消', tone: 'muted' },
  needs_attention: { label: '需确认', tone: 'danger' },
  completed_with_gaps: { label: '有缺口完成', tone: 'warning' },
  planned: { label: '未开始', tone: 'muted' },
  awaiting: { label: '等待中', tone: 'muted' },
  not_run: { label: '未执行', tone: 'muted' },
  blocked: { label: '依赖受阻', tone: 'warning' },
  dependency_blocked: { label: '依赖受阻', tone: 'warning' },
  not_executed: { label: '未执行', tone: 'muted' },
  skipped: { label: '已跳过', tone: 'muted' },
};

const EVENT_LABEL = {
  'run.created': '创建草稿',
  'run.approved': '审核通过',
  'run.started': '开始执行',
  'run.stopping': '停止调度',
  'run.finished': '运行结束',
  'phase.created': '新增阶段',
  'step.queued': '节点排队',
  'step.started': '节点开始',
  'step.progress': '节点进展',
  'step.finished': '节点结束',
  log: '日志',
};

const ACTIVE_STATUSES = new Set(['running', 'queued', 'pausing', 'stopping']);
const TERMINAL_STATUSES = new Set([
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
  'needs_attention',
  'completed_with_gaps',
]);
const RESUMABLE_STATUSES = new Set([
  'paused',
  'failed',
  'interrupted',
  'cancelled',
  'needs_attention',
  'completed_with_gaps',
]);

const dom = {
  serviceSummary: document.getElementById('service-summary'),
  serviceBanner: document.getElementById('service-banner'),
  refreshServices: document.getElementById('refresh-services'),
  openTemplates: document.getElementById('open-templates'),
  openHidden: document.getElementById('open-hidden'),
  studioLink: document.getElementById('studio-link'),
  themeToggle: document.getElementById('theme-toggle'),
  runList: document.getElementById('run-list'),
  detail: document.getElementById('detail-pane'),
  nodeDialog: document.getElementById('node-dialog'),
  nodeDialogTitle: document.getElementById('node-dialog-title'),
  nodeDialogSub: document.getElementById('node-dialog-sub'),
  nodeTabs: document.getElementById('node-tabs'),
  nodePanel: document.getElementById('node-panel'),
  confirmDialog: document.getElementById('confirm-dialog'),
  confirmTitle: document.getElementById('confirm-title'),
  confirmNote: document.getElementById('confirm-note'),
  confirmCheckboxRow: document.getElementById('confirm-checkbox-row'),
  confirmCheckbox: document.getElementById('confirm-checkbox'),
  confirmCancel: document.getElementById('confirm-cancel'),
  confirmAccept: document.getElementById('confirm-accept'),
  listDialog: document.getElementById('list-dialog'),
  listDialogTitle: document.getElementById('list-dialog-title'),
  listDialogSub: document.getElementById('list-dialog-sub'),
  listDialogBody: document.getElementById('list-dialog-body'),
  workspaceRow: document.getElementById('workspace-row'),
  workspaceTitle: document.getElementById('workspace-title'),
  workspaceHint: document.getElementById('workspace-hint'),
  workspaceInput: document.getElementById('workspace-input'),
  workspaceSave: document.getElementById('workspace-save'),
  toast: document.getElementById('toast'),
};

/* 输入框的路径样例要跟平台一致：macOS 上看到 D:\ 开头的样例会以为填不了。 */
if (/mac|iphone|ipad/i.test(navigator.userAgent)) {
  dom.workspaceInput.placeholder = '/Users/you/path/to/your-project';
}

dom.workspaceSave.addEventListener('click', async () => {
  dom.workspaceSave.disabled = true;
  try {
    const payload = await api('/api/workspace', {
      method: 'POST',
      body: { workspace: dom.workspaceInput.value },
    });
    state.workspaceDirty = false;
    toast(payload.restarted ? `工作目录已改为 ${payload.workspace}，内置引擎正在重启` : `工作目录已设为 ${payload.workspace}`);
    await loadBootstrap();
  } catch (error) {
    toast(error.message, 'danger');
  } finally {
    dom.workspaceSave.disabled = false;
  }
});

/* 用户一旦动过输入框，轮询就不要再回写覆盖——否则点「保存」前的那一下会被改回旧值。 */
dom.workspaceInput.addEventListener('input', () => {
  /* 内容又和服务器一致时，「用户正在改」这件事就不成立了。 */
  state.workspaceDirty = dom.workspaceInput.value.trim() !== state.workspaceServerValue;
});

const state = {
  services: [],
  activeServiceId: null,
  runs: [],
  hidden: new Set(),
  filter: 'all',
  selectedRunId: null,
  snapshot: null,
  events: [],
  after: 0,
  stream: null,
  reportLanguage: 'zh',
  /* 流程图视图：exec = 真实执行（含运行中节点），plan = 静态计划拓扑。与上游 Studio 的「显示计划/显示执行」同义。 */
  graphMode: 'exec',
  /* 流程图缩放：fit = 适应宽度，actual = 原始尺寸（可横向滚动看细节）。 */
  graphZoom: 'fit',
  loadingDetail: false,
  detailToken: 0,
  refreshTimer: null,
  listTimer: null,
  lastStreamStatus: null,
  pendingConfirm: null,
  nodeTab: 'output',
  workspaceDirty: false,
  /* 上一次从服务器读到的目录，用来判断输入框里的内容是不是用户自己改的。 */
  workspaceServerValue: '',
};

const node = (tag, props = {}, children = []) => {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') element.className = value;
    else if (key === 'text') element.textContent = value;
    /* CSP 的 style-src 不含 'unsafe-inline'，style 属性会被浏览器直接剥掉。
       改走 CSSOM 逐条设置，浏览器才认（这是允许的）。 */
    else if (key === 'style') applyStyle(element, String(value));
    /* 刻意不提供 html 分支：上游文本一律走 textContent，避免留下 XSS 入口。 */
    else if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) element.setAttribute(key, '');
    else element.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
};

/**
 * 用 CSSOM 设置行内样式。
 * 不能用 setAttribute('style', ...)——那属于 style 属性，会被 CSP style-src 拦掉。
 * @param {HTMLElement} element
 * @param {string} value 形如 "margin-top:16px;border-left-color:red"
 */
function applyStyle(element, value) {
  for (const piece of value.split(';')) {
    const index = piece.indexOf(':');
    if (index <= 0) continue;
    const name = piece.slice(0, index).trim();
    const raw = piece.slice(index + 1).trim();
    if (!name || !raw) continue;
    /* CSS 变量取值要保留原样交给 setProperty，不能自己拆。 */
    element.style.setProperty(name, raw);
  }
}

const statusMeta = (status) => STATUS[status] ?? { label: status || '未知', tone: 'muted' };

const pill = (status) => {
  const meta = statusMeta(status);
  return node('span', { class: 'pill', 'data-tone': meta.tone }, meta.label);
};

const pretty = (value) => {
  if (value === null || value === undefined) return '（无）';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const clockTime = (value) => {
  if (!value) return '--:--:--';
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return date.toLocaleTimeString('zh-CN', { hour12: false });
};

const dateTime = (value) => {
  if (!value) return '—';
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', { hour12: false });
};

const shortId = (value) => (typeof value === 'string' && value.length > 8 ? value.slice(0, 8) : value || '');

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const error = new Error(data?.error || `请求失败（${response.status}）`);
    error.status = response.status;
    throw error;
  }
  return data;
}

let toastTimer = null;
function toast(message, tone = 'success') {
  dom.toast.textContent = message;
  dom.toast.dataset.tone = tone;
  dom.toast.hidden = false;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    dom.toast.hidden = true;
  }, 4200);
}

/* ---------------- theme ---------------- */

const THEMES = ['system', 'light', 'dark'];
const THEME_LABEL = { system: '跟随系统', light: '浅色', dark: '深色' };

function applyTheme(theme) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  dom.themeToggle.textContent = `主题：${THEME_LABEL[theme]}`;
  dom.themeToggle.dataset.theme = theme;
  try {
    window.localStorage.setItem('wf-console-theme', theme);
  } catch {
    /* 忽略存储不可用 */
  }
}

dom.themeToggle.addEventListener('click', () => {
  const current = window.localStorage.getItem('wf-console-theme') || 'system';
  const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
  applyTheme(next);
});

/* ---------------- engine status ---------------- */

/* 控制台只有一个后端：它自己内置的 Workflow Studio 引擎。
   早期版本还会去扫本机上的插件服务并在多个服务之间切换，
   那样会读到另一个插件的地址和令牌；现在这条路径整个删掉了。 */

let lastEngineSignature = '';

function renderEngine() {
  const active = state.services.find((service) => service.id === state.activeServiceId) || null;
  const signature = active
    ? [
        active.id,
        active.live,
        active.starting,
        active.workspace,
        active.workspaceSource,
        active.needsWorkspace,
        active.mcodeAvailable,
        JSON.stringify(active.scheduler),
      ].join('|')
    : 'none';
  if (signature === lastEngineSignature) return;
  lastEngineSignature = signature;

  const live = Boolean(active?.live);
  const needsWorkspace = Boolean(active?.needsWorkspace);

  if (!active) {
    dom.serviceSummary.textContent = '内置引擎未就绪。';
  } else if (needsWorkspace) {
    dom.serviceSummary.textContent = '内置引擎未绑定项目目录';
  } else if (active.starting) {
    dom.serviceSummary.textContent = '内置引擎 · 正在启动…';
  } else if (!live) {
    dom.serviceSummary.textContent = `${active.workspace || '内置引擎'} · 引擎未在运行`;
  } else {
    const scheduler = active.scheduler || {};
    dom.serviceSummary.textContent =
      `内置引擎 · ${active.workspace || ''}` +
      ` · MCode CLI ${active.mcodeAvailable ? '可用' : '不可用'}` +
      ` · 执行器 ${active.executor || '未知'}` +
      ` · 并发 ${scheduler.active ?? 0}/${scheduler.limit ?? '—'}`;
  }

  if (live) {
    dom.serviceBanner.hidden = true;
  } else {
    dom.serviceBanner.hidden = false;
    dom.serviceBanner.textContent = '';
    dom.serviceBanner.append(
      node('strong', {
        text: needsWorkspace ? '还没有选择项目目录。' : '内置引擎未能启动。',
      }),
      node('span', {
        text: needsWorkspace
          ? ' 内置引擎不会在用户主目录或系统临时目录里运行——那样一次运行就能改写整个家目录。' +
            '请在下方填写项目的绝对路径，保存后引擎会自动启动。'
          : ' 控制台会自动重试；若持续失败，请确认 MCode CLI 可用（需要登录且模型可调用），' +
            '并查看 dataDir/engine/service.log 里的引擎日志。',
      }),
    );
  }

  /* 工作目录入口始终可见：它是控制台唯一的项目入口，
     隐藏它会让用户以为当前项目已经生效。 */
  dom.workspaceRow.hidden = false;
  const source = active?.workspaceSource || 'unset';
  dom.workspaceRow.classList.toggle('banner-warn', needsWorkspace);
  if (needsWorkspace) {
    dom.workspaceTitle.textContent = '请先选择项目目录';
    dom.workspaceHint.textContent =
      ' 内置引擎需要绑定到一个真实项目才能启动。它不会退回到用户主目录或宿主投放的临时目录，' +
      '所以在下面填入项目的绝对路径并保存之前，控制台不会运行任何工作流。';
  } else {
    dom.workspaceTitle.textContent = '内置引擎工作目录';
    dom.workspaceHint.textContent =
      ` 内置引擎当前在 ${active?.workspace || '未确定'} 里运行${source === 'env' ? '（由宿主声明的当前项目决定）' : ''}。` +
      '换项目时把这里改成新项目的绝对路径，保存后引擎自动重启，运行记录不会丢。' +
      '注意：改目录后，属于旧目录的运行将无法开始或恢复（上游要求运行与引擎在同一工作区）。';
  }
  /* 只在用户没在改这个字段时，才把服务器上的目录回写进输入框。
     判断依据有两个：dirty 标记（用户敲过键盘），以及字段里的内容是不是
     上一次服务器给的值。后者能兜住「值是从别处写进去的、没触发 input 事件」
     的情况——否则一次轮询就会把用户正在填的路径悄悄抹掉。 */
  const serverWorkspace = active?.workspace || '';
  const fieldValue = dom.workspaceInput.value;
  if (
    !state.workspaceDirty &&
    document.activeElement !== dom.workspaceInput &&
    fieldValue === state.workspaceServerValue
  ) {
    dom.workspaceInput.value = serverWorkspace;
  }
  state.workspaceServerValue = serverWorkspace;
  dom.studioLink.setAttribute('aria-disabled', live ? 'false' : 'true');
}
dom.refreshServices.addEventListener('click', async () => {
  dom.refreshServices.disabled = true;
  try {
    await loadBootstrap();
    toast('已刷新内置引擎状态');
  } catch (error) {
    toast(error.message, 'danger');
  } finally {
    dom.refreshServices.disabled = false;
  }
});

/* ---------------- run list ---------------- */

function stepTone(steps) {
  const total = steps.length;
  if (!total) return { tone: 'muted', text: '尚未开始执行' };
  const failed = steps.filter((step) => step.status === 'failed').length;
  const done = steps.filter((step) => step.status === 'succeeded').length;
  const running = steps.some((step) => step.status === 'running');
  if (failed) return { tone: 'danger', text: `${done}/${total} 节点成功 · ${failed} 失败` };
  if (running) return { tone: 'accent', text: `${done}/${total} 节点成功 · 执行中` };
  if (done === total) return { tone: 'success', text: `${done}/${total} 节点成功` };
  return { tone: 'warning', text: `${done}/${total} 节点成功` };
}

function visibleRuns() {
  const runs = state.runs;
  if (state.filter === 'active') return runs.filter((run) => ACTIVE_STATUSES.has(run.status) || run.status === 'paused');
  if (state.filter === 'pending_review') return runs.filter((run) => run.status === 'pending_review');
  if (state.filter === 'done') return runs.filter((run) => !ACTIVE_STATUSES.has(run.status) && run.status !== 'pending_review' && run.status !== 'paused');
  return runs;
}

let lastListSignature = '';
/** runId -> { item, pill, time, progress }，用于就地刷新易变字段。 */
const runItems = new Map();

/**
 * 列表签名只记结构：运行 id 与顺序。
 * 早先还带上 updatedAt 和节点状态，运行中每轮轮询都会变 → 整张列表被重建，
 * 「存为模板」「删除」按钮随之被销毁，用户点下去什么也不会发生（元素已脱离文档，
 * mousedown 和 mouseup 落在不同节点上，click 根本不会派发）。
 */
function listSignature(runs) {
  return runs.map((run) => run.id).join(',');
}

function buildRunItem(run) {
  const statusPill = pill(run.status);
  const timeEl = node('span', { text: clockTime(run.updatedAt) });
  const progressEl = node('div', { class: 'run-item-progress' });
  const label = run.name || shortId(run.id);
  const item = node(
    'li',
    {
      class: 'run-item',
      role: 'button',
      tabindex: '0',
      'data-run-id': run.id,
      'aria-current': run.id === state.selectedRunId ? 'true' : 'false',
      onclick: () => selectRun(run.id),
      onkeydown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectRun(run.id);
        }
      },
    },
    [
      node('div', { class: 'run-item-name', text: label }),
      node('div', { class: 'run-item-meta' }, [
        statusPill,
        node('span', { class: 'tag', text: run.executor === 'demo' ? '演示' : '真实执行' }),
        timeEl,
      ]),
      progressEl,
      node('div', { class: 'run-item-tools' }, [
        node('button', {
          type: 'button',
          class: 'btn',
          text: '存为模板',
          'aria-label': `把 ${label} 存为模板`,
          onclick: (event) => {
            event.stopPropagation();
            saveTemplate(run.id);
          },
        }),
        node('button', {
          type: 'button',
          class: 'btn btn-danger',
          text: '删除',
          'aria-label': `从列表中删除 ${label}`,
          onclick: (event) => {
            event.stopPropagation();
            hideRun(run.id);
          },
        }),
      ]),
    ],
  );
  runItems.set(run.id, { item, pill: statusPill, time: timeEl, progress: progressEl });
  return item;
}

/**
 * 列表行里的进度文案。
 *
 * 列表载荷是精简版：上游的 /api/runs 不返回 steps，控制台的 summarizeRun() 又剔掉了
 * topology，所以一条已结束的运行在列表里拿不到「节点成功数」——
 * 直接套详情页的 stepTone([]) 会永远显示成「尚未开始执行」。
 * 这里改用列表里确实存在的字段（status / attempts / latestProgress / error）来描述。
 * @param {Record<string, any>} run
 * @param {Array<Record<string, any>>} steps
 * @returns {string}
 */
function listProgressText(run, steps) {
  if (steps.length) return run.latestProgress?.message || stepTone(steps).text;
  const calls = Number.isInteger(run.attempts) ? run.attempts : 0;
  const live = run.latestProgress?.message;
  switch (run.status) {
    case 'pending_review':
      return '待审核 · 尚未开始执行';
    case 'queued':
      return '排队中';
    case 'running':
      return live || (calls ? `执行中 · ${calls} 次调用` : '执行中');
    case 'pausing':
    case 'stopping':
      return live || '正在停止…';
    case 'paused':
      return calls ? `已暂停 · ${calls} 次调用` : '已暂停';
    case 'succeeded':
      return calls ? `已完成 · ${calls} 次调用` : '已完成';
    case 'completed_with_gaps':
      return calls ? `有缺口完成 · ${calls} 次调用` : '有缺口完成';
    case 'failed':
      return run.error ? `失败：${run.error}` : '执行失败';
    case 'interrupted':
      return calls ? `已中断 · ${calls} 次调用` : '已中断';
    case 'cancelled':
      return calls ? `已取消 · ${calls} 次调用` : '已取消';
    case 'needs_attention':
      return '需要确认后继续';
    default:
      return live || '—';
  }
}

/** 状态、时间、进度就地刷新，不动列表结构。 */
function updateRunItem(run) {
  const entry = runItems.get(run.id);
  if (!entry) return;
  setPill(entry.pill, run.status);
  entry.time.textContent = clockTime(run.updatedAt);
  const steps = Array.isArray(run.steps) ? run.steps : [];
  entry.progress.textContent = listProgressText(run, steps);
}

function renderRuns() {
  const list = dom.runList;
  list.setAttribute('aria-busy', 'false');
  const runs = visibleRuns();
  const signature = `${state.filter}::${listSignature(runs)}`;
  if (signature !== lastListSignature || !list.childElementCount) {
    lastListSignature = signature;
    list.textContent = '';
    runItems.clear();
    if (!runs.length) {
      const engine = state.services.find((service) => service.id === state.activeServiceId);
      const needsWorkspace = Boolean(engine?.needsWorkspace);
      list.append(
        node('li', {}, [
          node('div', { class: 'empty' }, [
            node('h3', {
              text: needsWorkspace
                ? '还没有选择项目目录'
                : state.activeServiceId
                  ? '还没有运行记录'
                  : '内置引擎未就绪',
            }),
            node('p', {
              text: needsWorkspace
                ? '在顶部填写项目的绝对路径并保存，内置引擎会随即启动，这里会显示该项目的运行记录。'
                : state.activeServiceId
                  ? '换一个筛选条件，或在对话中让 Agent 创建动态工作流。'
                  : '内置引擎没有在运行，请点击顶部的「刷新引擎」查看状态。',
            }),
          ]),
        ]),
      );
    } else {
      for (const run of runs) list.append(buildRunItem(run));
    }
  }
  for (const run of runs) updateRunItem(run);
  syncSelection();
}

/**
 * 原地更新选中标记，不重建列表——重建会把键盘焦点和 hover 状态冲掉。
 */
function syncSelection() {
  for (const item of dom.runList.querySelectorAll('[data-run-id]')) {
    const current = item.getAttribute('data-run-id') === state.selectedRunId;
    item.setAttribute('aria-current', current ? 'true' : 'false');
  }
}

for (const chip of document.querySelectorAll('.chip[data-filter]')) {
  chip.addEventListener('click', () => {
    state.filter = chip.dataset.filter;
    for (const other of document.querySelectorAll('.chip[data-filter]')) {
      const active = other === chip;
      other.classList.toggle('is-active', active);
      other.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    renderRuns();
  });
}

/* ---------------- detail ---------------- */

async function selectRun(runId) {
  if (state.selectedRunId === runId && state.snapshot) return;
  state.selectedRunId = runId;
  renderRuns();
  dom.studioLink.setAttribute('href', `/api/studio?run=${encodeURIComponent(runId)}`);
  await loadSnapshot(runId, { resetEvents: true });
}

async function loadSnapshot(runId, { resetEvents = false } = {}) {
  const token = ++state.detailToken;
  state.loadingDetail = true;
  if (resetEvents) {
    /* 切换运行时先清空事件游标；旧快照保留到新快照到达，避免详情区闪空。 */
    state.events = [];
    state.after = 0;
    state.lastStreamStatus = null;
  }
  try {
    const snapshot = await api(`/api/runs/${encodeURIComponent(runId)}`);
    if (token !== state.detailToken) return;
    state.snapshot = snapshot;
    renderDetail();
    if (resetEvents) {
      openStream(runId);
    } else {
      scheduleRefresh();
    }
  } catch (error) {
    if (token !== state.detailToken) return;
    state.snapshot = null;
    /* 读取失败：先把旧的事件流收掉，否则上一个运行的事件会继续灌进新运行。 */
    closeStream();
    state.events = [];
    state.after = 0;
    /* 错误卡也要让布局失效，否则下次成功后 renderDetail 会早退，卡在错误页。 */
    resetDetailLayout();
    renderDetailError(error.message);
  } finally {
    if (token === state.detailToken) {
      state.loadingDetail = false;
      dom.detail.setAttribute('aria-busy', 'false');
    }
  }
}

/**
 * 详情区定时刷新。
 * 原实现是「刷新完再排 350ms」的自我续链，等于 350ms 一次的永久轮询：
 * 既在标签页隐藏时空转，又每 350ms 整块重建详情、把下拉框和滚动位置都冲掉。
 * 现在改成固定间隔 + 隐藏守卫，并且只有详情真的变了才重建 DOM。
 */
function scheduleRefresh(delay = 1_500) {
  if (state.refreshTimer) return;
  state.refreshTimer = window.setTimeout(() => {
    state.refreshTimer = null;
    if (document.hidden || !state.selectedRunId) return;
    loadSnapshot(state.selectedRunId).finally(() => scheduleRefresh(delay));
  }, delay);
}

function renderDetailError(message) {
  /* 错误卡要把整段布局作废，否则下一次成功渲染会以为骨架还在而跳过重建。 */
  resetDetailLayout();
  dom.detail.textContent = '';
  dom.detail.append(
    node('div', { class: 'card' }, [
      node('div', { class: 'alert' }, [node('strong', { text: '无法读取该运行' }), node('p', { text: message })]),
    ]),
  );
}

/**
 * 详情区三段式布局。
 *
 * 早先是「整个详情区一次性重建」：运行中每次轮询 run.updatedAt 都变，签名跟着变 →
 * dom.detail.textContent = '' → 操作栏里的按钮被销毁重建。用户点「取消运行」时，
 * mousedown 和 mouseup 之间正好撞上一次轮询，按钮节点已被换掉，click 事件不会
 * 派发到它，表现就是「点了没反应」（引擎侧确实收不到取消指令）。
 *
 * 现在头部 / 操作栏 / 正文三段各自持有 DOM、各自算签名：
 *   头部  —— 结构变了才重建；节点进度、调用次数、更新时间、进度条宽度就地更新。
 *   操作栏 —— 只按 运行 id / 状态 / 报告语言 重建，按钮对象保持稳定。
 *   正文  —— 结构变了才重建；每个节点的状态胶囊就地更新。
 */
const detailLayout = {
  runId: null,
  headKey: '',
  actionKey: '',
  bodyKey: '',
  graphKey: '',
  head: null,
  actions: null,
  sections: null,
  graph: null,
  graphCard: null,
  graphWrap: null,
  graphSvg: null,
  graphObserver: null,
  graphNodes: new Map(),
  graphEdges: [],
  timeline: null,
  stepRows: new Map(),
};

function resetDetailLayout() {
  detailLayout.runId = null;
  detailLayout.headKey = '';
  detailLayout.actionKey = '';
  detailLayout.bodyKey = '';
  detailLayout.graphKey = '';
  detailLayout.head = null;
  detailLayout.actions = null;
  detailLayout.sections = null;
  detailLayout.graph = null;
  detailLayout.graphCard = null;
  detailLayout.graphWrap = null;
  detailLayout.graphSvg = null;
  detailLayout.graphObserver?.disconnect();
  detailLayout.graphObserver = null;
  detailLayout.graphWarn = null;
  detailLayout.graphNodes = new Map();
  detailLayout.graphEdges = [];
  detailLayout.timeline = null;
  detailLayout.stepRows = new Map();
}

/** 换运行时重建骨架；同一个运行内一直复用。 */
function ensureDetailLayout(runId) {
  if (detailLayout.runId === runId && detailLayout.head) return;
  resetDetailLayout();
  detailLayout.runId = runId;

  const headCard = node('section', { class: 'card' }, []);
  detailLayout.head = node('div', { id: 'detail-head' });
  detailLayout.actions = node('div', { id: 'detail-actions' });
  headCard.append(detailLayout.head, detailLayout.actions);

  detailLayout.sections = node('div', { id: 'detail-sections' });

  /* 流程图单独占一张卡：它的节点状态每轮都在变，
     但结构（阶段、节点、依赖）几乎不变，分开才能只更新状态不动结构。 */
  const graphCard = node('section', { class: 'card', id: 'detail-graph-card' }, [
    node('header', {}, [
      node('h3', { text: '执行流程图' }),
      node('div', { class: 'graph-head-tools' }, [
        node('span', { class: 'tag', id: 'graph-mode-label', text: '阶段分列 · 箭头为依赖' }),
        node('button', {
          type: 'button',
          class: 'btn',
          id: 'graph-zoom-toggle',
          text: '原始尺寸',
          title: '在「整图塞进宽度」和「原始尺寸（可横向滚动）」之间切换',
          onclick: () => {
            state.graphZoom = state.graphZoom === 'fit' ? 'actual' : 'fit';
            applyGraphZoom();
            const zoom = document.getElementById('graph-zoom-toggle');
            if (zoom) zoom.textContent = state.graphZoom === 'fit' ? '原始尺寸' : '适应宽度';
          },
        }),
        node('button', {
          type: 'button',
          class: 'btn',
          id: 'graph-mode-toggle',
          text: '看计划拓扑',
          onclick: () => {
            state.graphMode = state.graphMode === 'exec' ? 'plan' : 'exec';
            renderDetail();
          },
        }),
      ]),
    ]),
  ]);
  detailLayout.graph = node('div', { id: 'detail-graph' });
  detailLayout.graphWrap = node('div', { class: 'graph-scroll' });
  detailLayout.graphCard = graphCard;
  detailLayout.graphWarn = node('p', { class: 'topbar-sub graph-warnings', hidden: true });
  detailLayout.graph.append(detailLayout.graphWrap);
  graphCard.append(detailLayout.graph, detailLayout.graphWarn);
  /* 容器宽度变了（面板伸缩、窗口缩放）要重新算缩放。 */
  if (typeof ResizeObserver === 'function') {
    detailLayout.graphObserver = new ResizeObserver(() => applyGraphZoom());
    detailLayout.graphObserver.observe(detailLayout.graphWrap);
  }

  const timelineCard = node('section', { class: 'card' }, [
    node('header', {}, [
      node('h3', { text: '实时日志' }),
      node('span', { class: 'tag', id: 'timeline-count', text: '0 条事件' }),
    ]),
  ]);
  detailLayout.timeline = node('ul', { class: 'timeline', id: 'timeline' });
  timelineCard.append(detailLayout.timeline);

  dom.detail.textContent = '';
  dom.detail.append(headCard, graphCard, detailLayout.sections, timelineCard);
  fillTimeline(detailLayout.timeline);
  updateTimelineCount();
}

function updateTimelineCount() {
  const count = document.getElementById('timeline-count');
  if (count) count.textContent = `${state.events.length} 条事件`;
}

/** 就地改写状态胶囊，避免为了换文案把按钮和节点卡片整个换掉。 */
function setPill(element, status) {
  const meta = statusMeta(status);
  element.textContent = meta.label;
  element.dataset.tone = meta.tone;
}

/** 单个节点的耗时文案：未开始 / 执行中 / 精确秒数。 */
function stepDuration(step) {
  if (!step) return '—';
  if (step.startedAt && step.endedAt) return `${((step.endedAt - step.startedAt) / 1000).toFixed(1)}s`;
  return step.startedAt ? '执行中' : '未开始';
}

/* ---------------- flow graph ---------------- */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 流程图布局常量。跟上游 Studio 的画布同构，只是尺寸收窄些以适配侧栏。 */
const GRAPH_LAYOUT = {
  cardWidth: 206,
  cardHeight: 84,
  column: 250,
  rowPitch: 116,
  padX: 18,
  headerHeight: 54,
  padY: 14,
};

function svgEl(tag, attrs = {}, children = []) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    element.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

/** 按显示宽度截断：中日韩字符算 2 个单位。 */
function truncateUnits(value, maxUnits) {
  const text = String(value ?? '');
  let used = 0;
  let out = '';
  for (const ch of text) {
    const width = (ch.codePointAt(0) || 0) > 0x2e80 ? 2 : 1;
    if (used + width > maxUnits) return `${out}…`;
    used += width;
    out += ch;
  }
  return out;
}

function nodeKindLabel(item, run) {
  if (item.placeholder) {
    if (item.dynamic) return '动态分组';
    if (item.conditional) return '条件分支';
    return '计划节点';
  }
  return run?.executor === 'demo' ? '演示 Agent' : 'MCode Agent';
}

function graphDuration(item) {
  if (!item || !item.startedAt) return '';
  const end = item.endedAt ?? Date.now();
  return `${((end - item.startedAt) / 1000).toFixed(1)}s`;
}

/**
 * 画流程图。
 *
 * 布局与上游 Workflow Studio 的画布同构：阶段横向分列，节点在列内纵向排开，
 * 依赖用贝塞尔曲线从上游节点右侧连到下游节点左侧。
 *
 * 数据来自服务端的 graph（执行视图）/ planGraph（计划视图）——
 * 那是上游 workflowGraph() 的输出，所以这里画出来的就是 Studio 里那一张图，
 * 不是另造的一套「节点网格」。
 */
function buildFlowGraph(graph, run) {
  const allNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const agents = allNodes.filter((item) => item.kind === 'agent');
  const nodes = agents.length ? agents : allNodes;
  if (!nodes.length) {
    return node('p', { class: 'empty', text: '这次运行没有可展示的流程结构。' });
  }

  const phaseList = Array.isArray(graph?.phases) ? graph.phases : [];
  const columns = phaseList.map((phase) => ({ id: phase.id, label: phase.label || phase.id, nodes: [] }));
  const columnById = new Map(columns.map((col) => [col.id, col]));
  const loose = [];
  for (const item of nodes) {
    const col = item.phase != null ? columnById.get(item.phase) : null;
    if (col) col.nodes.push(item);
    else loose.push(item);
  }
  if (loose.length) columns.push({ id: null, label: '默认阶段', nodes: loose });
  if (!columns.length) columns.push({ id: null, label: '默认阶段', nodes });

  const maxRows = Math.max(1, ...columns.map((col) => col.nodes.length));
  const positions = new Map();
  columns.forEach((col, ci) => {
    /* 节点少的列整体居中，和上游画布一致。 */
    const offset = maxRows > 3 ? 0 : (maxRows - col.nodes.length) * (GRAPH_LAYOUT.rowPitch / 2);
    col.nodes.forEach((item, ri) => {
      positions.set(item.id, {
        x: GRAPH_LAYOUT.padX + ci * GRAPH_LAYOUT.column,
        y: GRAPH_LAYOUT.headerHeight + GRAPH_LAYOUT.padY + offset + ri * GRAPH_LAYOUT.rowPitch,
      });
    });
  });

  const width =
    GRAPH_LAYOUT.padX * 2 + columns.length * GRAPH_LAYOUT.column - (GRAPH_LAYOUT.column - GRAPH_LAYOUT.cardWidth);
  const height =
    GRAPH_LAYOUT.headerHeight + GRAPH_LAYOUT.padY * 2 + (maxRows - 1) * GRAPH_LAYOUT.rowPitch + GRAPH_LAYOUT.cardHeight;

  const svg = svgEl('svg', {
    class: 'flow-graph',
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    role: 'img',
    'aria-label': '执行流程图',
  });
  svg.dataset.naturalWidth = String(width);
  svg.dataset.naturalHeight = String(height);

  /* 阶段表头 */
  columns.forEach((col, ci) => {
    const x = GRAPH_LAYOUT.padX + ci * GRAPH_LAYOUT.column;
    svg.append(
      svgEl('text', { x, y: 24, class: 'graph-phase-index' }, String(ci + 1).padStart(2, '0')),
      svgEl('text', { x: x + 28, y: 24, class: 'graph-phase-label' }, truncateUnits(col.label, 12)),
      svgEl('text', { x: x + 28, y: 41, class: 'graph-phase-count' }, `${col.nodes.length} 个节点`),
      svgEl('line', {
        x1: x,
        y1: GRAPH_LAYOUT.headerHeight - 8,
        x2: x + GRAPH_LAYOUT.cardWidth,
        y2: GRAPH_LAYOUT.headerHeight - 8,
        class: 'graph-phase-rule',
      }),
    );
  });

  /* 依赖边：画在节点卡片下面 */
  const edgeLayer = svgEl('g', { class: 'graph-edges' });
  for (const item of nodes) {
    const to = positions.get(item.id);
    if (!to) continue;
    for (const dep of item.dependsOn || []) {
      const from = positions.get(dep);
      if (!from) continue;
      const x1 = from.x + GRAPH_LAYOUT.cardWidth;
      const y1 = from.y + GRAPH_LAYOUT.cardHeight / 2;
      const x2 = to.x;
      const y2 = to.y + GRAPH_LAYOUT.cardHeight / 2;
      const path = svgEl('path', {
        d: `M${x1},${y1} C${x1 + 40},${y1} ${x2 - 40},${y2} ${x2},${y2}`,
        class: 'graph-edge',
      });
      edgeLayer.append(path);
      detailLayout.graphEdges.push({ path, from: dep, to: item.id });
    }
  }
  svg.append(edgeLayer);

  /* 节点卡片 */
  for (const item of nodes) {
    const pos = positions.get(item.id);
    if (!pos) continue;
    const meta = statusMeta(item.status);
    const group = svgEl('g', {
      class: 'graph-node',
      'data-tone': meta.tone,
      transform: `translate(${pos.x},${pos.y})`,
      role: 'button',
      tabindex: '0',
      'data-step-id': item.id,
      'aria-label': `${item.label || item.id}，${meta.label}`,
    });
    const stateText = svgEl('text', { x: 14, y: 67, class: 'graph-state' });
    const timeText = svgEl('text', {
      x: GRAPH_LAYOUT.cardWidth - 14,
      y: 67,
      class: 'graph-time',
      'text-anchor': 'end',
    });
    group.append(
      svgEl('rect', {
        class: 'graph-card',
        width: GRAPH_LAYOUT.cardWidth,
        height: GRAPH_LAYOUT.cardHeight,
        rx: 12,
      }),
      svgEl('text', { x: 14, y: 27, class: 'graph-title' }, truncateUnits(item.label || item.id, 20)),
      svgEl('text', { x: 14, y: 46, class: 'graph-kind' }, nodeKindLabel(item, run)),
      svgEl('circle', { cx: GRAPH_LAYOUT.cardWidth - 18, cy: 22, r: 5, class: 'graph-dot' }),
      stateText,
      timeText,
    );
    const open = () => openNode(item);
    group.addEventListener('click', open);
    group.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
    svg.append(group);
    detailLayout.graphNodes.set(item.id, { group, stateText, timeText, item });
  }

  return svg;
}

/**
 * 让整张图塞进可视宽度。
 * 上游 Studio 用的是缩放按钮 + 自动适应；这里默认「适应宽度」，
 * 实在太小就保底 0.5，剩下的部分横向滚动查看。
 */
function applyGraphZoom() {
  const wrap = detailLayout.graphWrap;
  const svg = detailLayout.graphSvg;
  if (!wrap || !svg) return;
  const natural = Number(svg.dataset.naturalWidth) || 0;
  const naturalHeight = Number(svg.dataset.naturalHeight) || 0;
  if (!natural) return;
  if (state.graphZoom === 'actual') {
    svg.style.setProperty('width', `${natural}px`);
    svg.style.setProperty('height', `${naturalHeight}px`);
    return;
  }
  const available = wrap.clientWidth - 4;
  if (available <= 0) return;
  const scale = Math.max(0.5, Math.min(1, available / natural));
  svg.style.setProperty('width', `${Math.round(natural * scale)}px`);
  svg.style.setProperty('height', `${Math.round(naturalHeight * scale)}px`);
}

/** 节点状态就地更新：状态文案、状态点颜色、耗时、边的样式。 */
function updateFlowGraph(run) {
  const steps = Array.isArray(run?.steps) ? run.steps : [];
  const stepById = new Map(steps.map((item) => [item.id, item]));
  for (const [id, entry] of detailLayout.graphNodes) {
    const step = entry.item.actualId ? stepById.get(entry.item.actualId) : null;
    const status = step?.status || entry.item.status;
    const meta = statusMeta(status);
    entry.stateText.textContent = meta.label;
    entry.timeText.textContent = graphDuration(
      step ? { startedAt: step.startedAt, endedAt: step.endedAt } : entry.item,
    );
    entry.group.dataset.tone = meta.tone;
    entry.group.setAttribute('aria-label', `${entry.item.label || id}，${meta.label}`);
  }
  for (const edge of detailLayout.graphEdges) {
    const from = detailLayout.graphNodes.get(edge.from);
    const to = detailLayout.graphNodes.get(edge.to);
    const planned = from?.item.placeholder ? ' is-planned' : '';
    const running = to?.group.dataset.tone === 'accent' ? ' is-running' : '';
    edge.path.setAttribute('class', `graph-edge${planned}${running}`);
  }
}

/** 当前选中的后端服务绑定的工作目录。 */
function activeWorkspace() {
  const service = state.services.find((item) => item.id === state.activeServiceId);
  return service?.workspace || null;
}

function renderDetail() {
  const run = state.snapshot;
  dom.detail.setAttribute('aria-busy', 'false');
  if (!run) {
    /* 没有选中运行：把骨架拆掉，回空态。 */
    resetDetailLayout();
    dom.detail.textContent = '';
    dom.detail.append(
      node('div', { class: 'card' }, [
        node('div', { class: 'empty' }, [
          node('h3', { text: '选择一个运行' }),
          node('p', { text: '左侧列表里点开任意一次运行，这里会显示任务说明、拓扑、节点结果与实时日志。' }),
        ]),
      ]),
    );
    return;
  }

  ensureDetailLayout(run.id);

  const steps = Array.isArray(run.steps) ? run.steps : [];
  const stepById = new Map(steps.map((step) => [step.id, step]));
  const topology = run.topology || null;
  const meta = run.metadata || {};
  const progress = stepTone(steps);
  const percent = steps.length ? Math.round((steps.filter((s) => s.status === 'succeeded').length / steps.length) * 100) : 0;
  /* 上游要求 run.workspace 与引擎当前工作区一致，否则审核/恢复会被拒。
     这里提前把话说清楚，别让用户撞上「工作区已改变，请创建新工作流」。 */
  const engineWorkspace = activeWorkspace();
  const workspaceMismatch = Boolean(run.workspace && engineWorkspace && run.workspace !== engineWorkspace);

  /* ---- 头部：结构变了才重建，易变字段另行就地更新 ---- */
  const headKey = [
    run.id,
    run.name ?? '',
    run.status,
    run.revision,
    run.executor,
    run.createdAt ?? '',
    run.error ?? '',
    run.errorDetails ? 'details' : '',
    workspaceMismatch ? `${run.workspace}|${engineWorkspace}` : '',
    run.status === 'pending_review' ? 'pending' : '',
    steps.length ? 'steps' : 'nosteps',
  ].join('|');
  if (headKey !== detailLayout.headKey) {
    detailLayout.headKey = headKey;
    detailLayout.head.textContent = '';
    detailLayout.head.append(...buildDetailHead(run, { steps, progress, percent, workspaceMismatch, engineWorkspace }));
  }
  updateDetailHead(run, { progress, percent });

  /* ---- 操作栏：按钮对象必须稳定，不能被轮询冲掉 ---- */
  const actionKey = [run.id, run.status, state.reportLanguage].join('|');
  if (actionKey !== detailLayout.actionKey) {
    detailLayout.actionKey = actionKey;
    detailLayout.actions.textContent = '';
    detailLayout.actions.append(buildActionBar(run));
  }

  /* ---- 流程图：结构变了才重建，节点状态就地更新 ---- */
  const graphData = state.graphMode === 'plan' ? run.planGraph : run.graph;
  const graphNodes = Array.isArray(graphData?.nodes) ? graphData.nodes : [];
  detailLayout.graphCard.hidden = graphNodes.length === 0;
  const warnings = Array.isArray(run.topology?.warnings) ? run.topology.warnings : [];
  detailLayout.graphWarn.hidden = warnings.length === 0;
  detailLayout.graphWarn.textContent = warnings.length ? `静态分析提示：${warnings.join('、')}` : '';
  const toggle = document.getElementById('graph-mode-toggle');
  if (toggle) toggle.textContent = state.graphMode === 'exec' ? '看计划拓扑' : '看执行结果';
  const zoomToggle = document.getElementById('graph-zoom-toggle');
  if (zoomToggle) zoomToggle.textContent = state.graphZoom === 'fit' ? '原始尺寸' : '适应宽度';
  const graphKey = [
    run.id,
    state.graphMode,
    run.status,
    graphData ? (graphData.phases || []).map((phase) => phase.id).join(',') : '',
    graphNodes.map((item) => `${item.id}:${item.phase ?? ''}`).join(','),
  ].join('|');
  if (graphKey !== detailLayout.graphKey) {
    detailLayout.graphKey = graphKey;
    detailLayout.graphWrap.textContent = '';
    detailLayout.graphNodes = new Map();
    detailLayout.graphEdges = [];
    const built = buildFlowGraph(graphData, run);
    if (String(built.tagName).toLowerCase() === 'svg') {
      detailLayout.graphSvg = built;
      detailLayout.graphWrap.append(built);
      /* 尺寸要等进了文档、布局完才知道，所以下一帧再算缩放。 */
      window.requestAnimationFrame(applyGraphZoom);
    } else {
      detailLayout.graphSvg = null;
      detailLayout.graphWrap.append(built);
    }
  }
  updateFlowGraph(run);

  /* ---- 正文：结构变了才重建，节点状态另行就地更新 ---- */
  const bodyKey = [
    run.id,
    meta.objective ?? '',
    meta.inputDescription ?? '',
    (meta.deliverables || []).join(','),
    topology ? (topology.nodes || []).map((item) => item.id).join(',') : '',
    topology ? (topology.phases || []).map((item) => item.id).join(',') : '',
    topology ? (topology.warnings || []).join(',') : '',
    steps.map((step) => `${step.id}:${step.label ?? ''}:${step.phase ?? ''}`).join(','),
    run.result === null || run.result === undefined ? '' : `r${JSON.stringify(run.result).length}`,
  ].join('|');
  if (bodyKey !== detailLayout.bodyKey) {
    detailLayout.bodyKey = bodyKey;
    detailLayout.sections.textContent = '';
    detailLayout.stepRows = new Map();
    buildDetailSections(run, { steps, meta });
  }

  updateDetailSteps(steps);
}

/** 头部结构：标题、标签、元信息、进度条骨架、告警。易变字段由 updateDetailHead 就地刷新。 */
function buildDetailHead(run, ctx) {
  const parts = [
    node('header', {}, [
      node('div', { class: 'detail-title' }, [node('h2', { id: 'detail-heading', text: run.name || shortId(run.id) }), pill(run.status)]),
      node('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [
        node('span', { class: 'tag', text: run.executor === 'demo' ? '演示执行（不调用模型）' : '真实执行' }),
        node('span', { class: 'tag', text: `修订 r${run.revision ?? 1}` }),
      ]),
    ]),
    node('p', { class: 'meta-line' }, [
      node('span', { class: 'mono meta-id', text: shortId(run.id) }),
      node('span', { class: 'meta-steps', text: '' }),
      node('span', { class: 'meta-calls', text: '' }),
      node('span', { class: 'meta-created', text: `创建 ${dateTime(run.createdAt)}` }),
      node('span', { class: 'meta-updated', text: '' }),
    ]),
  ];

  if (ctx.steps.length) {
    parts.push(
      node('div', { class: 'progress-track', role: 'img', 'aria-label': `完成度 ${ctx.percent}%` }, [
        node('div', { class: 'progress-fill', 'data-tone': ctx.progress.tone }),
      ]),
    );
  }
  if (run.status === 'pending_review') {
    parts.push(
      node('div', { class: 'alert', style: 'margin-top:16px;border-left-color:var(--mcode-warning)' }, [
        node('strong', { text: '这是待审核草稿。' }),
        node('p', {
          text: '开始执行前请先核对下方拓扑与任务说明。点击「开始执行」后会调度真实 Agent（演示草稿不会调用模型）。',
        }),
      ]),
    );
  }
  if (ctx.workspaceMismatch) {
    parts.push(
      node('div', { class: 'alert', style: 'margin-top:16px;border-left-color:var(--mcode-danger)' }, [
        node('strong', { text: '工作区不匹配，这个运行无法开始或恢复。' }),
        node('p', {
          text: `该运行属于 ${run.workspace}，而当前后端在 ${ctx.engineWorkspace}。上游要求两者一致。请把顶部的工作目录改回 ${run.workspace}，或让 Agent 在新工作区里重新创建工作流。`,
        }),
      ]),
    );
  }
  if (run.error) {
    parts.push(
      node('div', { class: 'alert', style: 'margin-top:16px' }, [
        node('strong', { text: '运行错误' }),
        node('pre', { class: 'mono', text: run.error }),
        run.errorDetails
          ? node('details', { class: 'raw' }, [
              node('summary', { text: '错误详情' }),
              node('pre', { class: 'payload', text: pretty(run.errorDetails) }),
            ])
          : null,
      ]),
    );
  }
  return parts;
}

/** 头部易变字段就地更新：节点进度、调用次数、更新时间、进度条宽度。 */
function updateDetailHead(run, ctx) {
  const head = detailLayout.head;
  if (!head) return;
  const stepsText = head.querySelector('.meta-steps');
  if (stepsText) stepsText.textContent = `节点 ${ctx.progress.text}`;
  const callsText = head.querySelector('.meta-calls');
  if (callsText) callsText.textContent = `调用 ${run.attempts ?? 0} 次`;
  const updatedText = head.querySelector('.meta-updated');
  if (updatedText) updatedText.textContent = `更新 ${clockTime(run.updatedAt)}`;
  const track = head.querySelector('.progress-track');
  if (!track) return;
  track.setAttribute('aria-label', `完成度 ${ctx.percent}%`);
  const fill = track.querySelector('.progress-fill');
  if (!fill) return;
  fill.dataset.tone = ctx.progress.tone;
  /* 宽度必须走 CSSOM：style 属性会被 CSP 的 style-src 直接剥掉。 */
  fill.style.setProperty('width', `${ctx.percent}%`);
}

/** 正文结构：任务说明 / 拓扑 / 节点列表 / 最终结果。 */
function buildDetailSections(run, ctx) {
  const host = detailLayout.sections;
  const { steps, meta } = ctx;

  /* brief */
  if (meta.objective || meta.inputDescription || (meta.deliverables || []).length) {
    const dl = node('dl', { class: 'brief-grid' });
    if (meta.objective) dl.append(node('dt', { text: '任务目标' }), node('dd', { text: meta.objective }));
    if (meta.inputDescription) dl.append(node('dt', { text: '输入说明' }), node('dd', { text: meta.inputDescription }));
    if ((meta.deliverables || []).length) {
      dl.append(
        node('dt', { text: '交付内容' }),
        node('dd', {}, node('ul', {}, meta.deliverables.map((item) => node('li', { text: String(item) })))),
      );
    }
    host.append(node('section', { class: 'card' }, [node('header', {}, [node('h3', { text: '任务说明' })]), dl]));
  }

  /* topology：流程图已经单独成卡（见 buildFlowGraph），这里不再重复画一遍节点网格。
     静态分析提示也挪到流程图卡下面，跟着图一起看。 */

  /* node list */
  if (steps.length) {
    const rows = steps.map((step) => {
      const statusPill = pill(step.status);
      const label = step.label || step.id;
      const sub = node('span', { class: 'step-row-sub', text: `${step.id} · ${step.phase || '—'} · ${stepDuration(step)}` });
      const row = node(
        'button',
        {
          type: 'button',
          class: 'step-row',
          'aria-label': `${label} · ${statusMeta(step.status).label}，查看节点详情`,
          onclick: () =>
            openNode({
              id: step.id,
              actualId: step.id,
              stepId: step.id,
              label,
              phase: step.phase,
              status: step.status,
              kind: step.kind,
            }),
        },
        [
          node('span', { class: 'step-row-main' }, [node('span', { class: 'step-row-name', text: label }), sub]),
          statusPill,
        ],
      );
      detailLayout.stepRows.set(step.id, { status: statusPill, sub, button: row, label });
      return node('li', {}, [row]);
    });
    host.append(
      node('section', { class: 'card' }, [
        node('header', {}, [
          node('h3', { text: '节点执行记录' }),
          node('span', { class: 'tag', text: `${steps.length} 个 · 上方流程图对应的执行明细` }),
        ]),
        node('ul', { class: 'step-list' }, rows),
      ]),
    );
  }

  /* result */
  if (run.result !== null && run.result !== undefined) {
    host.append(
      node('section', { class: 'card' }, [
        node('header', {}, [
          node('h3', { text: '最终结果' }),
          run.executor === 'demo' ? node('span', { class: 'tag', text: '演示结果，不能作为真实结论' }) : null,
        ]),
        node('pre', { class: 'payload mono', text: pretty(run.result) }),
      ]),
    );
  }
}

/** 节点状态就地更新：状态胶囊、耗时、可访问名称。 */
function updateDetailSteps(steps) {
  const stepById = new Map(steps.map((step) => [step.id, step]));
  for (const [stepId, row] of detailLayout.stepRows) {
    const step = stepById.get(stepId);
    if (!step) continue;
    setPill(row.status, step.status);
    row.sub.textContent = `${step.id} · ${step.phase || '—'} · ${stepDuration(step)}`;
    row.button.setAttribute('aria-label', `${row.label} · ${statusMeta(step.status).label}，查看节点详情`);
  }
}

/**
 * 把事件写进已有的时间线列表。
 * 不替换 <ul> 本身：换了节点，引用、滚动位置和事件绑定都要重新拿一遍。
 */
function fillTimeline(list) {
  list.textContent = '';
  if (!state.events.length) {
    list.append(node('li', {}, [node('span', { class: 'timeline-text', text: '暂无事件' })]));
    return;
  }
  for (const event of state.events) {
    const label = EVENT_LABEL[event.type] || event.type;
    let text = event.message || '';
    if (!text && event.stepId) text = `${event.stepId}${event.status ? ` · ${statusMeta(event.status).label}` : ''}`;
    if (!text) {
      const extras = Object.entries(event)
        .filter(([key]) => !['seq', 'type', 'time', 'name', 'message'].includes(key))
        .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
      text = extras.join(' ');
    }
    list.append(
      node('li', { 'data-type': event.type }, [
        node('span', { class: 'timeline-time mono', text: clockTime(event.time) }),
        node('span', { class: 'timeline-type', text: label }),
        node('span', { class: 'timeline-text', text: text || '—' }),
      ]),
    );
  }
  window.requestAnimationFrame(() => {
    list.scrollTop = list.scrollHeight;
  });
}

function replaceTimeline() {
  const existing = document.getElementById('timeline');
  if (!existing) {
    renderDetail();
    return;
  }
  fillTimeline(existing);
  updateTimelineCount();
}

/* ---------------- actions ---------------- */

function buildActionBar(run) {
  const bar = node('div', { class: 'action-bar' });
  const busy = (label) => node('button', { type: 'button', class: 'btn', disabled: true, text: label });
  /* 闭包只捕获 runId：点击发生时再取当前快照，
     免得拿到重建前那一份已经过期的 run 对象。 */
  const runId = run.id;

  if (run.status === 'pending_review') {
    bar.append(
      node('button', {
        type: 'button',
        class: 'btn btn-primary',
        'data-action': 'approve',
        text: '开始执行',
        onclick: () => confirmStart(runId),
      }),
    );
    /* 上游 stop(id,'cancelled') 支持直接取消待审核草稿，不给按钮就永远撤不掉。 */
    bar.append(
      node('button', {
        type: 'button',
        class: 'btn btn-danger',
        'data-action': 'cancel',
        text: '取消草稿',
        onclick: () => confirmCancel(runId),
      }),
    );
  }
  /* 暂停只对「已经在跑」的运行有意义；排队中的运行照样可以被取消。 */
  if (run.status === 'running') {
    bar.append(
      node('button', {
        type: 'button',
        class: 'btn',
        'data-action': 'pause',
        text: '暂停',
        onclick: () => mutate(runId, 'pause', '已暂停调度'),
      }),
    );
  }
  if (ACTIVE_STATUSES.has(run.status)) {
    bar.append(
      node('button', {
        type: 'button',
        class: 'btn btn-danger',
        'data-action': 'cancel',
        text: '取消运行',
        onclick: () => confirmCancel(runId),
      }),
    );
  }
  if (run.status === 'pausing' || run.status === 'stopping') bar.append(busy('正在停止调度…'));
  if (RESUMABLE_STATUSES.has(run.status)) {
    bar.append(
      node('button', {
        type: 'button',
        class: 'btn btn-primary',
        'data-action': 'resume',
        text: '恢复运行',
        onclick: () => confirmResume(runId),
      }),
    );
  }

  const link = (format, label) =>
    node('a', {
      class: 'btn',
      text: label,
      href: `/api/runs/${encodeURIComponent(run.id)}/report?format=${format}&language=${state.reportLanguage}`,
      download: '',
    });

  if (['succeeded', 'failed', 'completed_with_gaps', 'cancelled', 'interrupted', 'paused', 'needs_attention'].includes(run.status)) {
    bar.append(link('md', '导出 Markdown'), link('html', '导出 HTML'));
    bar.append(
      node('label', { class: 'control' }, [
        node('span', { class: 'control-label', text: '报告语言' }),
        node(
          'select',
          {
            'aria-label': '报告语言',
            onchange: (event) => {
              state.reportLanguage = event.target.value === 'en' ? 'en' : 'zh';
              renderDetail();
            },
          },
          [
            node('option', { value: 'zh', text: '中文', selected: state.reportLanguage === 'zh' }),
            node('option', { value: 'en', text: 'English', selected: state.reportLanguage === 'en' }),
          ],
        ),
      ]),
    );
  }
  bar.append(node('a', { class: 'btn', text: '在 Studio 中打开', href: `/api/studio?run=${encodeURIComponent(run.id)}`, target: '_blank', rel: 'noreferrer' }));
  return bar;
}

function askConfirm({ title, note, requireCheck = false, acceptLabel = '确认' }) {
  return new Promise((resolve) => {
    dom.confirmTitle.textContent = title;
    dom.confirmNote.textContent = note;
    dom.confirmAccept.textContent = acceptLabel;
    dom.confirmCheckboxRow.hidden = !requireCheck;
    dom.confirmCheckbox.checked = false;
    dom.confirmAccept.disabled = requireCheck;
    dom.confirmCheckbox.onchange = () => {
      dom.confirmAccept.disabled = requireCheck && !dom.confirmCheckbox.checked;
    };

    const finish = (value) => {
      dom.confirmAccept.onclick = null;
      dom.confirmCancel.onclick = null;
      dom.confirmDialog.removeEventListener('cancel', onCancel);
      dom.confirmDialog.close();
      resolve(value);
    };
    /* 按 Esc 关闭也要 resolve，否则这个 Promise 永远挂着，调用方的 await 永远不返回。 */
    const onCancel = (event) => {
      event.preventDefault();
      finish({ confirmed: false });
    };
    dom.confirmAccept.onclick = () => finish({ confirmed: true, confirmStopped: dom.confirmCheckbox.checked });
    dom.confirmCancel.onclick = () => finish({ confirmed: false });
    dom.confirmDialog.addEventListener('cancel', onCancel);
    dom.confirmDialog.showModal();
  });
}

async function mutate(runId, action, successMessage, body) {
  try {
    await api(`/api/runs/${encodeURIComponent(runId)}/${action}`, { method: 'POST', body: body ?? {} });
    toast(successMessage);
    await Promise.all([loadSnapshot(runId), loadRuns()]);
  } catch (error) {
    toast(error.message, 'danger');
    if (state.selectedRunId === runId) loadSnapshot(runId);
  }
}

/** 取当前快照里的运行；不是当前运行就放弃操作，避免打到过期的数据上。 */
function liveRun(runId) {
  const run = state.snapshot;
  return run && run.id === runId ? run : null;
}

async function confirmStart(runId) {
  const run = liveRun(runId);
  if (!run) return;
  /* 没有项目目录时不允许开始：内置引擎此刻根本没在跑，
     审核通过也不会有任何执行发生。 */
  if (!activeWorkspace()) {
    toast('请先在顶部选择项目目录，再开始执行', 'danger');
    return;
  }
  const nodeCount = Array.isArray(run.topology?.nodes) ? run.topology.nodes.length : 0;
  const real = run.executor !== 'demo';
  const answer = await askConfirm({
    title: '开始执行该工作流',
    note:
      `运行「${run.name}」，静态拓扑共 ${nodeCount} 个节点。` +
      (real
        ? '执行器为真实 MCode Agent，开始后会实际调用模型并产生用量。' +
          '内置运行时以 smart 权限调用 CLI：部分文件写入与命令会自动放行，' +
          '需要你确认的步骤会让该节点直接失败，而不是停下来等你。'
        : '执行器为演示模式，不会调用模型，只返回占位结果。'),
    acceptLabel: '开始执行',
  });
  if (!answer.confirmed) return;
  await mutate(run.id, 'approve', '已提交执行', { revision: run.revision });
}

async function confirmCancel(runId) {
  const run = liveRun(runId);
  if (!run) return;
  const draft = run.status === 'pending_review';
  const answer = await askConfirm({
    title: draft ? '取消该草稿' : '取消该运行',
    note: draft
      ? `草稿「${run.name}」还没有开始执行。取消后它会被标记为已取消，不能再开始执行。`
      : `取消「${run.name}」会中止在途 Agent 调用。已完成节点的结果保留，可用「恢复运行」重新调度。`,
    acceptLabel: draft ? '取消草稿' : '取消运行',
  });
  if (!answer.confirmed) return;
  await mutate(run.id, 'cancel', draft ? '草稿已取消' : '已请求取消');
}

async function confirmResume(runId) {
  const run = liveRun(runId);
  if (!run) return;
  const needsCheck = run.status === 'needs_attention';
  const answer = await askConfirm({
    title: '恢复该运行',
    note:
      `将复用「${run.name}」中已成功的节点，失败节点从头执行；这不是续接原来的 Agent 会话。` +
      (needsCheck ? '\n该运行上次为异常退出，恢复前请确认旧的 Agent 已经停止。' : ''),
    requireCheck: needsCheck,
    acceptLabel: '恢复运行',
  });
  if (!answer.confirmed) return;
  await mutate(run.id, 'resume', '已提交恢复', { confirmStopped: answer.confirmStopped === true });
}

/* ---------------- node dialog ---------------- */

/**
 * 打开节点详情。
 * 传进来的是流程图里的节点描述（id / actualId / stepId），
 * 节点数据在打开那一刻从当前快照里取——否则看到的会是渲染那一刻的旧输出
 * （流程图上的节点卡片是常驻的，输出早就变了）。
 */
function openNode(graphNode) {
  const run = state.snapshot;
  const steps = Array.isArray(run?.steps) ? run.steps : [];
  const step = graphNode?.actualId ? steps.find((item) => item.id === graphNode.actualId) || null : null;
  const planNodes = Array.isArray(run?.topology?.nodes) ? run.topology.nodes : [];
  const planNode =
    planNodes.find((item) => item.id === graphNode?.id) ||
    planNodes.find((item) => item.stepId === graphNode?.stepId) ||
    null;
  const id = graphNode?.actualId || graphNode?.stepId || graphNode?.id || '';
  const label = graphNode?.label || planNode?.label || step?.label || id;
  const status = step?.status || graphNode?.status || 'planned';
  dom.nodeDialogTitle.textContent = label;
  dom.nodeDialogSub.textContent = `${id} · ${statusMeta(status).label}${step?.phase ? ` · 阶段 ${step.phase}` : ''}`;
  dom.nodeDialog.setAttribute('data-node-id', id);

  const nodeEvents = state.events.filter((event) => event.stepId === id);
  const tabs = [
    { key: 'output', label: '输出', value: step ? step.output : null },
    { key: 'input', label: '输入', value: step ? step.input : null },
    { key: 'prompt', label: '提示词', value: planNode?.prompt ?? graphNode?.prompt ?? step?.prompt ?? null },
    { key: 'source', label: '源码片段', value: planNode?.source ?? graphNode?.source ?? null },
    { key: 'logs', label: `日志（${nodeEvents.length}）`, value: null },
  ];
  state.nodeTab = tabs.some((tab) => tab.key === state.nodeTab) ? state.nodeTab : 'output';

  dom.nodeTabs.textContent = '';
  for (const tab of tabs) {
    dom.nodeTabs.append(
      node('button', {
        type: 'button',
        class: `tab${tab.key === state.nodeTab ? ' is-active' : ''}`,
        role: 'tab',
        'aria-selected': tab.key === state.nodeTab ? 'true' : 'false',
        text: tab.label,
        onclick: () => {
          state.nodeTab = tab.key;
          openNode(graphNode);
        },
      }),
    );
  }

  dom.nodePanel.textContent = '';
  if (state.nodeTab === 'logs') {
    if (!nodeEvents.length) {
      dom.nodePanel.append(node('div', { class: 'empty' }, [node('p', { text: '该节点暂无事件。' })]));
    } else {
      dom.nodePanel.append(
        node(
          'ul',
          { class: 'timeline' },
          nodeEvents.map((event) =>
            node('li', { 'data-type': event.type }, [
              node('span', { class: 'timeline-time mono', text: clockTime(event.time) }),
              node('span', { class: 'timeline-type', text: EVENT_LABEL[event.type] || event.type }),
              node('span', { class: 'timeline-text', text: event.message || event.stepId || '—' }),
            ]),
          ),
        ),
      );
    }
  } else {
    const tab = tabs.find((item) => item.key === state.nodeTab);
    dom.nodePanel.append(node('pre', { class: 'payload mono', text: pretty(tab.value) }));
  }

  if (step?.error || step?.errorDetails) {
    dom.nodePanel.append(
      node('div', { class: 'alert', style: 'margin-top:12px' }, [
        node('strong', { text: '节点失败' }),
        node('pre', { class: 'mono', text: step.error || '' }),
        step.errorDetails ? node('pre', { class: 'payload mono', text: pretty(step.errorDetails) }) : null,
      ]),
    );
  }

  if (!dom.nodeDialog.open) dom.nodeDialog.showModal();
}

for (const button of document.querySelectorAll('[data-close]')) {
  button.addEventListener('click', () => document.getElementById(button.dataset.close)?.close());
}
dom.nodeDialog.addEventListener('close', () => {
  dom.nodeDialog.removeAttribute('data-node-id');
});

/* ---------------- live stream ---------------- */

function closeStream() {
  if (state.stream) {
    state.stream.close();
    state.stream = null;
  }
}

/** 事件按 seq 单调递增，去重后再渲染：EventSource 与一次性拉取可能同时回放同一段历史。 */
function appendEvents(events) {
  if (!Array.isArray(events) || !events.length) return false;
  const fresh = events
    .filter((event) => typeof event.seq !== 'number' || event.seq > state.after)
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  if (!fresh.length) return false;
  state.events = state.events.concat(fresh);
  /* 事件只增不减会慢慢吃内存；只保留最近一段。 */
  if (state.events.length > 600) state.events = state.events.slice(-600);
  /* 游标必须取「排好序之后」的最后一个，不能取入参的最后一个：
     入参未必有序，否则会漏事件或重复投递。 */
  const last = fresh[fresh.length - 1];
  if (typeof last?.seq === 'number') state.after = last.seq;
  replaceTimeline();
  return true;
}

function openStream(runId) {
  closeStream();
  if (!runId) return;
  const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events?after=${state.after}`);
  state.stream = source;
  source.onmessage = (message) => {
    let payload;
    try {
      payload = JSON.parse(message.data);
    } catch {
      return;
    }
    if (payload.error) {
      toast(payload.error, 'danger');
      source.close();
      return;
    }
    appendEvents(payload.events);
    /* 只有真正收到事件时才回源拉快照；纯心跳不触发重绘。 */
    if (payload.status && payload.status !== state.lastStreamStatus) {
      state.lastStreamStatus = payload.status;
      scheduleRefresh(250);
    }
    /* 终态后服务端会主动收尾；主动关闭可避免 EventSource 按 retry 反复重连空流。 */
    if (TERMINAL_STATUSES.has(payload.status)) source.close();
  };
  source.onerror = () => {
    /* EventSource 会按 retry 自动重连 */
  };
}

/* ---------------- templates & hidden runs ---------------- */

/** 按 id 取当前列表里的运行快照，避免用到重建前那份旧对象。 */
function liveListRun(runId) {
  return state.runs.find((run) => run.id === runId) || null;
}

async function saveTemplate(runId) {
  const run = liveListRun(runId);
  if (!run) return;
  try {
    await api('/api/templates', { method: 'POST', body: { runId: run.id, name: run.name } });
    toast(`已保存模板「${run.name}」，可在「模板」里复用`);
  } catch (error) {
    toast(error.message, 'danger');
  }
}

async function hideRun(runId) {
  const run = liveListRun(runId);
  if (!run) return;
  const answer = await askConfirm({
    title: '从列表中删除该运行',
    note:
      `「${run.name}」会从控制台列表中移除。` +
      'Workflow Studio 没有提供删除运行的接口，所以记录仍保留在上游；可在「已隐藏」里随时恢复。',
    acceptLabel: '删除',
  });
  if (!answer.confirmed) return;
  try {
    const payload = await api(`/api/runs/${encodeURIComponent(run.id)}/hide`, { method: 'POST', body: {} });
    state.hidden = new Set(payload.hidden || []);
    if (state.selectedRunId === run.id) {
      closeStream();
      state.selectedRunId = null;
      state.snapshot = null;
    }
    await loadRuns();
    renderDetail();
    toast('已从列表中删除');
  } catch (error) {
    toast(error.message, 'danger');
  }
}

async function openHiddenDialog() {
  dom.listDialogTitle.textContent = '已隐藏的运行';
  dom.listDialogSub.textContent = '这些运行只是从控制台列表移除，记录仍保留在 Workflow Studio 中。';
  dom.listDialogBody.textContent = '';
  const payload = await api('/api/hidden');
  const ids = Array.isArray(payload.hidden) ? payload.hidden : [];
  state.hidden = new Set(ids);
  if (!ids.length) {
    dom.listDialogBody.append(node('div', { class: 'empty' }, [node('p', { text: '没有被删除的运行。' })]));
  } else {
    dom.listDialogBody.append(
      node(
        'ul',
        { class: 'stack-list' },
        ids.map((id) =>
          node('li', { class: 'stack-row' }, [
            node('span', { class: 'stack-row-main' }, [
              node('span', { class: 'stack-row-name', text: shortId(id) }),
              node('span', { class: 'stack-row-sub', text: id }),
            ]),
            node('span', { class: 'stack-row-actions' }, [
              node('button', {
                type: 'button',
                class: 'btn',
                text: '恢复',
                'aria-label': `恢复运行 ${shortId(id)}`,
                onclick: async (event) => {
                  event.target.disabled = true;
                  try {
                    await api(`/api/runs/${encodeURIComponent(id)}/unhide`, { method: 'POST', body: {} });
                    await loadRuns();
                    await openHiddenDialog();
                    toast('已恢复到列表');
                  } catch (error) {
                    toast(error.message, 'danger');
                    event.target.disabled = false;
                  }
                },
              }),
            ]),
          ]),
        ),
      ),
    );
  }
  if (!dom.listDialog.open) dom.listDialog.showModal();
}

async function openTemplatesDialog() {
  dom.listDialogTitle.textContent = '模板';
  dom.listDialogSub.textContent = '复用模板会新建一份待审核草稿，不会直接执行。';
  dom.listDialogBody.textContent = '';
  let templates = [];
  try {
    const payload = await api('/api/templates');
    templates = Array.isArray(payload.templates) ? payload.templates : [];
  } catch (error) {
    dom.listDialogBody.append(node('div', { class: 'alert' }, [node('p', { text: error.message })]));
    if (!dom.listDialog.open) dom.listDialog.showModal();
    return;
  }
  if (!templates.length) {
    dom.listDialogBody.append(
      node('div', { class: 'empty' }, [
        node('h3', { text: '还没有模板' }),
        node('p', { text: '在任意运行上点「存为模板」，下次直接复用它的脚本、输入与预算。' }),
      ]),
    );
  } else {
    dom.listDialogBody.append(
      node(
        'ul',
        { class: 'stack-list' },
        templates.map((template) =>
          node('li', { class: 'stack-row' }, [
            node('span', { class: 'stack-row-main' }, [
              node('span', { class: 'stack-row-name', text: template.name || '未命名模板' }),
              node('span', {
                class: 'stack-row-sub',
                text: `${template.objective || '无任务说明'} · 保存于 ${dateTime(template.createdAt)}`,
              }),
            ]),
            node('span', { class: 'stack-row-actions' }, [
              node('button', {
                type: 'button',
                class: 'btn btn-primary',
                text: '复用',
                'aria-label': `复用模板 ${template.name || ''}`,
                onclick: async (event) => {
                  event.target.disabled = true;
                  try {
                    const payload = await api(`/api/templates/${encodeURIComponent(template.id)}/use`, {
                      method: 'POST',
                      body: {},
                    });
                    dom.listDialog.close();
                    await loadRuns();
                    if (payload.run?.id) await selectRun(payload.run.id);
                    toast('已生成待审核草稿，核对拓扑后可点开始执行');
                  } catch (error) {
                    toast(error.message, 'danger');
                    event.target.disabled = false;
                  }
                },
              }),
              node('button', {
                type: 'button',
                class: 'btn btn-danger',
                text: '删除',
                'aria-label': `删除模板 ${template.name || ''}`,
                onclick: async (event) => {
                  event.target.disabled = true;
                  try {
                    await api(`/api/templates/${encodeURIComponent(template.id)}`, {
                      method: 'POST',
                      body: { action: 'delete' },
                    });
                    await openTemplatesDialog();
                    toast('模板已删除');
                  } catch (error) {
                    toast(error.message, 'danger');
                    event.target.disabled = false;
                  }
                },
              }),
            ]),
          ]),
        ),
      ),
    );
  }
  if (!dom.listDialog.open) dom.listDialog.showModal();
}

dom.openTemplates.addEventListener('click', () => {
  openTemplatesDialog().catch((error) => toast(error.message, 'danger'));
});
dom.openHidden.addEventListener('click', () => {
  openHiddenDialog().catch((error) => toast(error.message, 'danger'));
});

/* ---------------- bootstrap & polling ---------------- */

async function loadRuns() {
  try {
    const payload = await api('/api/runs');
    state.runs = Array.isArray(payload.runs) ? payload.runs : [];
    if (Array.isArray(payload.hidden)) state.hidden = new Set(payload.hidden);
    renderRuns();
  } catch (error) {
    toast(error.message, 'danger');
  }
}

async function loadBootstrap() {
  const payload = await api('/api/bootstrap');
  state.services = Array.isArray(payload.services) ? payload.services : [];
  state.activeServiceId = payload.activeServiceId ?? null;
  state.runs = Array.isArray(payload.runs) ? payload.runs : [];
  if (Array.isArray(payload.hidden)) state.hidden = new Set(payload.hidden);
  renderEngine();
  renderRuns();
  const hasSelected = state.selectedRunId && state.runs.some((run) => run.id === state.selectedRunId);
  if (!hasSelected && state.runs.length) {
    await selectRun(state.runs[0].id);
  } else if (!state.runs.length) {
    closeStream();
    state.selectedRunId = null;
    state.snapshot = null;
    renderDetail();
  }
}

async function boot() {
  let theme = 'system';
  try {
    theme = window.localStorage.getItem('wf-console-theme') || 'system';
  } catch {
    theme = 'system';
  }
  applyTheme(THEMES.includes(theme) ? theme : 'system');

  try {
    await loadBootstrap();
  } catch (error) {
    renderEngine();
    dom.detail.setAttribute('aria-busy', 'false');
    renderDetailError(error.message);
  }

  window.setInterval(() => {
    if (document.hidden) return;
    /* 始终拉 bootstrap：它是唯一会重新探测内置引擎、把引擎放回列表的入口。
       只在「引擎正在启动」时才拉，会在后端重启窗口里彻底失去内置引擎。 */
    loadBootstrap().catch(() => {
      /* 轮询失败不弹 toast：离线时不该反复打扰用户，页面上的离线横幅已经说明情况。 */
    });
  }, 8000);
}

boot();
