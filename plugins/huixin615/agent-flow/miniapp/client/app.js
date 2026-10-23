const dom = Object.fromEntries([
  'session-select', 'selection-note', 'follow-latest', 'load-more-sessions', 'refresh-state', 'refresh-button', 'error',
  'total', 'running', 'done', 'failed', 'observation', 'flow', 'detail',
].map((id) => [id, document.getElementById(id)]));

let selectedId = null;
let selectedTaskId = null;
let manualSelection = false;
let lastSignature = '';
let currentFlow = null;
let requestSequence = 0;
let detailSequence = 0;
let lastDetailKey = '';
let missingFinalRetries = 0;
let sessionLimit = 40;
let sessionSequence = 0;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function time(ms) {
  return Number.isFinite(ms) && ms > 0
    ? new Date(ms).toLocaleTimeString('zh-CN', { hour12: false }) : '—';
}

function duration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  return ms < 1000 ? `${Math.round(ms)} 毫秒` : `${(ms / 1000).toFixed(1)} 秒`;
}

const statusNames = {
  queued: '排队', running: '运行中', stopping: '停止中', succeeded: '已完成',
  failed: '失败', canceled: '已取消', lost: '中断',
};

async function getJson(path) {
  let response;
  try { response = await fetch(path, { cache: 'no-store' }); }
  catch { throw new Error('插件运行时已断开。请点击上方 ▶ 启动，然后刷新页面。'); }
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || '读取失败');
  return data;
}

function showError(message) {
  dom.error.hidden = !message;
  dom.error.textContent = message || '';
}

async function loadSessions() {
  const sequence = ++sessionSequence;
  try {
    const pin = selectedId ? `&pin=${encodeURIComponent(selectedId)}` : '';
    const { sessions, hasMore } = await getJson(`/api/sessions?limit=${sessionLimit}${pin}`);
    if (sequence !== sessionSequence) return;
    const previous = selectedId;
    const newest = sessions[0]?.id ?? null;
    if (!manualSelection || !sessions.some((session) => session.id === selectedId)) {
      selectedId = newest;
      if (selectedId !== previous) {
        selectedTaskId = null;
        lastDetailKey = '';
        missingFinalRetries = 0;
        lastSignature = '';
        currentFlow = null;
        for (const id of ['total', 'running', 'done', 'failed']) dom[id].textContent = '—';
        dom.flow.replaceChildren(node('div', 'empty', '正在读取所选会话…'));
        dom.detail.replaceChildren(node('div', 'empty', '正在读取子任务…'));
      }
      manualSelection = false;
    }
    dom['session-select'].replaceChildren(...sessions.map((session) => {
      const option = node('option', '', `${session.title}${session.taskCount ? ` · ${session.taskCount} 项子任务` : ''}`);
      option.value = session.id;
      option.title = session.id;
      return option;
    }));
    dom['session-select'].disabled = sessions.length === 0;
    if (selectedId) dom['session-select'].value = selectedId;
    dom['follow-latest'].hidden = !manualSelection;
    dom['load-more-sessions'].hidden = !hasMore || sessionLimit >= 10000;
    dom['selection-note'].textContent = manualSelection
      ? `手动选择的本机会话 · 列出 ${sessions.length} 条${hasMore ? sessionLimit >= 10000 ? '，已达展示上限' : '，还有更多' : ''}`
      : `自动跟随最近更新的本机会话（推断，可能不是当前会话）· 列出 ${sessions.length} 条${hasMore ? sessionLimit >= 10000 ? '，已达展示上限' : '，还有更多' : ''}`;
    showError('');
    if (!selectedId) {
      dom.flow.replaceChildren(node('div', 'empty', '暂无可读取的本机会话。'));
      dom.detail.replaceChildren(node('div', 'empty', '暂无子任务。'));
    } else if (previous !== selectedId) await loadFlow();
  } catch (error) {
    if (sequence === sessionSequence) showError(error.message);
  }
}

function addFact(list, label, value) {
  list.append(node('dt', '', label), node('dd', '', value));
}

function addTextSection(container, title, text) {
  const section = node('section', 'detail-section');
  const head = node('div', 'head');
  head.append(node('h4', '', title));
  if (text) {
    const button = node('button', 'copy', '复制');
    button.type = 'button';
    button.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); button.textContent = '已复制'; }
      catch { button.textContent = '复制失败'; }
    });
    head.append(button);
  }
  section.append(head);
  section.append(text ? node('pre', '', text) : node('p', 'none', '当前记录中没有可展示的内容。'));
  container.append(section);
}

function renderDetail(task) {
  const detail = dom.detail;
  detail.replaceChildren();
  if (!task) {
    detail.append(node('div', 'empty', '选择一项子任务'));
    return;
  }
  detail.append(node('h3', '', task.name));
  detail.append(node('div', 'subline', `${task.agent} · ${statusNames[task.status] || task.status} · ${task.mode}`));
  const facts = node('dl', 'facts');
  addFact(facts, '创建', time(task.createdAt));
  addFact(facts, '开始运行', time(task.startedAt));
  addFact(facts, '结束', time(task.endedAt));
  addFact(facts, '耗时', duration(task.startedAt && task.endedAt ? task.endedAt - task.startedAt : null));
  const parentState = task.parentState === 'matched' ? '已在父会话历史中找到回传'
    : task.parentState === 'unreadable' ? '父会话历史暂不可读，无法核实'
      : task.parentState === 'unverified' ? '任务标记已交付；当前历史未找到回传（可能已压缩）'
        : '尚未交付';
  addFact(facts, '父会话结果', parentState);
  addFact(facts, '子会话', task.childId ? `${task.childId.slice(0, 12)}…` : '尚未建立');
  detail.append(facts);
  if (task.warning || task.historyWarning) detail.append(node('p', 'warning', task.warning || task.historyWarning));
  addTextSection(detail, '委派指令（父 Agent 发出的 task 参数）', task.instruction);
  addTextSection(detail, '子 Agent 最终回复', task.finalText);
  const section = node('section', 'detail-section');
  section.append(node('h4', '', `子 Agent 工具调用 · ${task.tools.length}`));
  const tools = node('div', 'tools');
  for (const name of task.tools) tools.append(node('span', 'tool-pill', name));
  section.append(task.tools.length ? tools : node('p', 'none', '尚无工具调用记录。'));
  detail.append(section);
}

async function loadDetail(task) {
  if (!task) { renderDetail(null); return; }
  const key = `${selectedId}:${task.id}:${task.status}:${task.endedAt}:${task.updatedAt}:${task.parentState}:${task.historyWarning}`;
  if (key === lastDetailKey) return;
  lastDetailKey = key;
  const sequence = ++detailSequence;
  dom.detail.replaceChildren(node('div', 'empty', '正在读取子会话详情…'));
  try {
    const detail = await getJson(`/api/task?id=${encodeURIComponent(selectedId)}&task=${encodeURIComponent(task.id)}`);
    if (sequence === detailSequence && selectedTaskId === task.id) {
      missingFinalRetries = detail.childId && !detail.finalText ? missingFinalRetries + 1 : 0;
      renderDetail(detail);
    }
  } catch (error) {
    if (sequence === detailSequence) {
      lastDetailKey = '';
      dom.detail.replaceChildren(node('div', 'empty', error.message));
    }
  }
}

function renderFlow(flow) {
  const tasks = flow.tasks;
  dom.total.textContent = tasks.length;
  dom.running.textContent = tasks.filter((task) => ['queued', 'running', 'stopping'].includes(task.status)).length;
  dom.done.textContent = tasks.filter((task) => task.status === 'succeeded').length;
  dom.failed.textContent = tasks.filter((task) => ['failed', 'canceled', 'lost'].includes(task.status)).length;
  const notes = [];
  for (const group of flow.analysis?.sameTurnGroups ?? []) {
    const mode = group.execution === 'serial' ? '运行区间没有重叠（实际串行）'
      : group.execution === 'overlap' ? '运行区间有重叠'
        : '尚有任务未结束，暂不判断并行关系';
    notes.push(`同一轮委派的 ${group.count} 项子任务：${mode}${group.wallMs === undefined ? '' : `；跨度 ${duration(group.wallMs)}`}`);
  }
  if (tasks.length) {
    const uncertain = tasks.filter((task) => ['unverified', 'unreadable'].includes(task.parentState)).length;
    notes.push(`${flow.analysis?.parentResults ?? 0}/${tasks.length} 项回传可在当前父会话历史中核实${uncertain ? `；${uncertain} 项暂无法核实（可能已压缩或读取失败）` : ''}。匹配不代表父 Agent 已采用。`);
  }
  dom.observation.replaceChildren(...(notes.length ? notes : ['暂无可分析的子任务。']).map((note) => node('p', '', note)));
  const root = node('div', 'root-card');
  root.append(node('span', 'label', '父 Agent · 当前观察会话'));
  root.append(node('strong', '', flow.session.title));
  root.append(node('small', '', `更新于 ${time(flow.session.updatedAt)}`));
  dom.flow.replaceChildren(root);
  if (tasks.length === 0) {
    dom.flow.append(node('div', 'empty', '这条会话尚无原生 task 子 Agent 记录。\n用户可以照常在 MiniMax Code 对话，插件会在打开期间刷新。'));
    renderDetail(null);
    return;
  }
  const list = node('div', 'task-list');
  const now = Date.now();
  const first = Math.min(...tasks.map((task) => task.createdAt || task.startedAt || now));
  const last = Math.max(...tasks.map((task) => task.endedAt || (task.startedAt && ['running', 'stopping'].includes(task.status) ? now : task.createdAt || first)));
  const span = Math.max(1, last - first);
  for (const task of tasks) {
    const button = node('button', `task-card ${task.status}${task.depth ? ' nested' : ''}${task.id === selectedTaskId ? ' selected' : ''}`);
    button.type = 'button';
    button.style.setProperty('--depth', String(task.depth || 0));
    const top = node('div', 'task-top');
    top.append(node('span', 'task-title', task.name), node('span', `status ${task.status}`, statusNames[task.status] || task.status));
    const meta = node('div', 'task-meta');
    meta.append(node('span', '', `${task.agent} · ${task.mode}${task.parentTaskId ? ' · 子任务' : ''}`), node('span', '', task.startedAt ? `${time(task.startedAt)} – ${time(task.endedAt)}` : `创建 ${time(task.createdAt)} · 尚未开始`));
    const rail = node('div', 'rail');
    const bar = node('span');
    if (task.startedAt && (task.endedAt || ['running', 'stopping'].includes(task.status))) {
      bar.style.marginLeft = `${Math.max(0, Math.min(100, (task.startedAt - first) / span * 100))}%`;
      bar.style.width = `${Math.max(1, Math.min(100, ((task.endedAt || now) - task.startedAt) / span * 100))}%`;
    } else bar.hidden = true;
    rail.append(bar);
    const handoff = task.parentState === 'matched' ? '回传已在父会话中找到'
      : task.parentState === 'unverified' ? '已交付；当前历史无法核实回传'
        : task.parentState === 'unreadable' ? '父会话历史不可读' : '等待结果';
    button.append(top, meta, rail, node('div', 'flow-arrow', handoff));
    button.addEventListener('click', () => {
      selectedTaskId = task.id;
      renderFlow(flow);
    });
    list.append(button);
  }
  dom.flow.append(list);
  if (!tasks.some((task) => task.id === selectedTaskId)) selectedTaskId = tasks[0].id;
  void loadDetail(tasks.find((task) => task.id === selectedTaskId));
}

async function loadFlow() {
  if (!selectedId) return;
  const id = selectedId;
  const sequence = ++requestSequence;
  try {
    const flow = await getJson(`/api/flow?id=${encodeURIComponent(id)}`);
    if (sequence !== requestSequence || id !== selectedId) return;
    currentFlow = flow;
    const signature = JSON.stringify({ session: flow.session, tasks: flow.tasks });
    if (signature !== lastSignature || flow.tasks.some((task) => ['running', 'stopping'].includes(task.status))) {
      lastSignature = signature;
      renderFlow(flow);
    }
    dom['refresh-state'].textContent = `已更新 ${time(flow.observedAt)}`;
    showError('');
  } catch (error) {
    if (sequence !== requestSequence) return;
    dom['refresh-state'].textContent = '等待重试';
    showError(error.message);
  }
}

dom['session-select'].addEventListener('change', () => {
  selectedId = dom['session-select'].value;
  selectedTaskId = null;
  lastDetailKey = '';
  missingFinalRetries = 0;
  manualSelection = true;
  dom['follow-latest'].hidden = false;
  lastSignature = '';
  dom['selection-note'].textContent = '手动选择的本机会话';
  void loadFlow();
});
dom['follow-latest'].addEventListener('click', () => {
  manualSelection = false;
  void loadSessions();
});
dom['refresh-button'].addEventListener('click', () => {
  lastSignature = '';
  lastDetailKey = '';
  missingFinalRetries = 0;
  void loadSessions().then(loadFlow);
});
dom['load-more-sessions'].addEventListener('click', () => {
  sessionLimit = Math.min(10000, sessionLimit + 40);
  void loadSessions();
});
void loadSessions();
setInterval(() => { if (document.visibilityState === 'visible') void loadFlow(); }, 3000);
setInterval(() => { if (document.visibilityState === 'visible') void loadSessions(); }, 15000);
setInterval(() => {
  if (document.visibilityState !== 'visible' || !currentFlow) return;
  const task = currentFlow.tasks.find((item) => item.id === selectedTaskId);
  if (task && (['queued', 'running', 'stopping'].includes(task.status) || (missingFinalRetries > 0 && missingFinalRetries < 6))) {
    lastDetailKey = '';
    void loadDetail(task);
  }
}, 10000);
