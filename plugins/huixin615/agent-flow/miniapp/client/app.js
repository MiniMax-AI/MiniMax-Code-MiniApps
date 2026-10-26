import { buildTimeline, executionOverlap, parseEventFiles } from './flow.mjs';

const ids = ['event-files', 'file-note', 'error', 'session-select', 'latest-session', 'session-note', 'observation-panel',
  'total', 'running', 'done', 'linked', 'observation', 'flow', 'detail', 'children'];
const dom = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
let timeline = null;
let selectedSession = null;
let selectedTask = null;

function node(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = String(value);
  return element;
}

const shortId = (id) => id ? `${id.slice(0, 10)}…` : '未记录';
function time(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const date = new Date(ms);
  const two = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} `
    + `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}
const duration = (start, end) => start != null && end != null
  ? `${((end - start) / 1000).toFixed(1)} 秒` : '—';
function timeRange(start, end) {
  if (end == null) return `${time(start)} – —`;
  const from = time(start);
  const to = time(end);
  return `${from} – ${to.slice(0, 10) === from.slice(0, 10) ? to.slice(11) : to}`;
}

function fact(list, label, value) {
  list.append(node('dt', '', label), node('dd', '', value));
}

function renderDetail(task) {
  dom.detail.replaceChildren();
  if (!task) return dom.detail.append(node('div', 'empty', '选择一项 task 调用'));
  dom.detail.append(node('h3', '', task.title || '未记录任务标题'));
  dom.detail.append(node('p', 'subline', '仅保存任务标题，不保存完整指令或回复。'));
  const facts = node('dl', 'facts');
  fact(facts, '开始调用', time(task.startAt));
  fact(facts, '工具回传', time(task.endAt));
  fact(facts, '调用耗时', duration(task.startAt, task.endAt));
  fact(facts, '回传状态', task.endAt === null ? '未观察到 PostToolUse' : task.resultPresent ? 'PostToolUse 带有结果' : '观察到 PostToolUse；无结果字段');
  fact(facts, '会话散列', shortId(task.session));
  fact(facts, '轮次散列', shortId(task.turn));
  fact(facts, '调用散列', task.id.includes(':') ? shortId(task.id.split(':').at(-1)) : '未记录');
  const child = timeline.children.find((item) => item.linkedTaskId === task.id);
  if (child) {
    fact(facts, '关联子 Agent', `${child.agentType || '子 Agent'} · ${shortId(child.session)}`);
    fact(facts, '子 Agent 运行', `${timeRange(child.startAt, child.endAt)} · ${duration(child.startAt, child.endAt)}`);
    fact(facts, '关联依据', 'task 回传中的子会话 ID 与子 Agent 事件中的会话 ID 一致');
  } else if (task.childSession) {
    fact(facts, '关联子 Agent', '工具回传包含子会话 ID；导入记录中没有唯一匹配的启停事件');
  }
  dom.detail.append(facts);
  dom.detail.append(node('p', 'warning', '工具回传不表示父 Agent 已使用或认可子 Agent 的结果。'));
}

function childCard(child, visibleChildren) {
  const card = node('div', 'child-card');
  const heading = node('div', 'child-heading');
  const task = timeline.tasks.find((item) => item.id === child.linkedTaskId);
  heading.append(node('strong', '', task?.title || `${child.agentType || '子 Agent'} · ${shortId(child.session)}`));
  heading.append(node('span', '', `${timeRange(child.startAt, child.endAt)} · ${duration(child.startAt, child.endAt)}`));
  card.append(heading);
  if (task) card.append(node('span', 'child-identity', `${child.agentType || '子 Agent'} · ${shortId(child.session)}`));
  if (child.startAt !== null && child.endAt !== null) {
    const complete = visibleChildren.filter((item) => item.startAt !== null && item.endAt !== null);
    const first = Math.min(...complete.map((item) => item.startAt));
    const last = Math.max(...complete.map((item) => item.endAt));
    const span = Math.max(1, last - first);
    const rail = node('div', 'rail child-rail');
    const bar = node('span');
    bar.style.marginLeft = `${(child.startAt - first) / span * 100}%`;
    bar.style.width = `${Math.max(1, (child.endAt - child.startAt) / span * 100)}%`;
    rail.append(bar);
    card.append(rail);
  }
  card.append(node('span', '', child.endAt ? '观察到停止' : '未观察到停止'));
  return card;
}

function renderChildren() {
  const linked = timeline.children.filter((child) => selectedSession && child.linkSource && !child.relationConflict && child.parentSession === selectedSession);
  dom.linked.textContent = linked.length;
  dom.children.replaceChildren();
  if (!selectedSession) {
    dom.children.append(node('div', 'empty', '选择一条导入记录中的会话后查看关联的子 Agent。'));
    return;
  }
  if (!linked.length) {
    dom.children.append(node('div', 'empty', '所选会话没有可确认关联的子 Agent 启停事件。'));
    return;
  }
  for (const child of linked) dom.children.append(childCard(child, linked));
}

function render() {
  if (!timeline) return;
  const tasks = timeline.tasks.filter((task) => task.session === selectedSession);
  dom.total.textContent = tasks.length;
  dom.running.textContent = tasks.filter((task) => task.endAt === null).length;
  dom.done.textContent = tasks.filter((task) => task.endAt !== null).length;
  const notes = [];
  if (selectedSession) {
    const selectedChildren = timeline.children.filter((child) => child.linkSource && !child.relationConflict && child.parentSession === selectedSession);
    const completeSelected = selectedChildren.filter((child) => child.startAt !== null && child.endAt !== null);
    if (completeSelected.length > 1) notes.push(executionOverlap(completeSelected)
      ? '已关联的子 Agent 运行区间存在重叠。'
      : '已关联的子 Agent 运行区间没有重叠。');
    else if (selectedChildren.length === 0 && tasks.length) notes.push('尚无可确认关联的子 Agent 运行记录。');
  }
  if (!selectedSession) notes.push('选择一条导入记录中的会话，或查看最近记录。');
  const orphanResults = timeline.orphanResults.filter((row) => row.session === selectedSession);
  if (orphanResults.length) notes.push(`${orphanResults.length} 条 PostToolUse 缺少可匹配的 PreToolUse，未计入任务。`);
  dom.observation.replaceChildren(...notes.map((value) => node('p', '', value)));
  dom['observation-panel'].hidden = notes.length === 0;
  dom.flow.replaceChildren();
  if (!tasks.length) {
    dom.flow.append(node('div', 'empty', selectedSession
      ? '所选会话没有已记录的 task 调用。Hook 只记录安装后的事件。'
      : '请选择导入记录中的会话；插件无法确认当前聊天对应哪条记录。'));
    selectedTask = null;
    renderDetail(null);
  } else {
    if (!tasks.some((task) => task.id === selectedTask)) selectedTask = tasks[0].id;
    const list = node('div', 'task-list');
    const first = Math.min(...tasks.map((task) => task.startAt));
    const last = Math.max(...tasks.map((task) => task.endAt ?? task.startAt));
    const span = Math.max(1, last - first);
    for (const task of tasks) {
      const status = task.endAt === null ? 'running' : 'succeeded';
      const button = node('button', `task-card ${status}${selectedTask === task.id ? ' selected' : ''}`);
      button.type = 'button';
      const top = node('div', 'task-top');
      top.append(node('span', 'task-title', task.title || '未记录任务标题'));
      top.append(node('span', `status ${status}`, task.endAt === null ? '未见工具回传' : '工具已回传'));
      const meta = node('div', 'task-meta');
      meta.append(node('span', '', timeRange(task.startAt, task.endAt)), node('span', '', duration(task.startAt, task.endAt)));
      const rail = node('div', 'rail');
      const bar = node('span');
      if (task.endAt === null) bar.hidden = true;
      else {
        bar.style.marginLeft = `${(task.startAt - first) / span * 100}%`;
        bar.style.width = `${Math.max(1, (task.endAt - task.startAt) / span * 100)}%`;
      }
      rail.append(bar);
      const child = timeline.children.find((item) => item.linkedTaskId === task.id);
      const relation = child ? `关联子 Agent：${child.agentType || '子 Agent'} · ${shortId(child.session)} · ${duration(child.startAt, child.endAt)}`
        : task.childSession ? '回传含子会话 ID；尚无唯一匹配的启停事件'
          : task.endAt === null ? '尚无 PostToolUse' : '观察到 PostToolUse';
      button.append(top, meta, rail, node('div', 'flow-arrow', relation));
      button.addEventListener('click', () => { selectedTask = task.id; render(); });
      list.append(button);
    }
    dom.flow.append(list);
    renderDetail(tasks.find((task) => task.id === selectedTask));
  }
  renderChildren();
}

function updateSessionSelection() {
  if (!timeline) return;
  if (!timeline.sessions.some((session) => session.id === selectedSession)) selectedSession = null;
  const visible = timeline.sessions.filter((session) => session.taskCount > 0);
  const placeholder = node('option', '', '选择导入记录中的会话');
  placeholder.value = '';
  dom['session-select'].replaceChildren(placeholder, ...visible.map((session) => {
    const option = node('option', '', `${time(session.lastAt)} · ${session.taskCount} 次 task 调用 · ${shortId(session.id)}`);
    option.value = session.id;
    return option;
  }));
  dom['session-select'].disabled = visible.length === 0;
  dom['latest-session'].disabled = visible.length === 0;
  dom['session-select'].value = selectedSession ?? '';
  dom['session-note'].textContent = selectedSession
    ? '已选择导入记录中的会话；不一定是当前聊天。'
    : '选择会话，或查看最近记录；插件无法识别当前聊天。';
  render();
}

function importError(message) {
  timeline = null;
  selectedSession = null;
  selectedTask = null;
  dom['session-select'].replaceChildren();
  dom['session-select'].disabled = true;
  dom['latest-session'].disabled = true;
  dom['file-note'].textContent = '导入失败；未显示记录';
  dom['observation-panel'].hidden = true;
  for (const id of ['total', 'running', 'done', 'linked']) dom[id].textContent = '0';
  dom.observation.textContent = '导入记录后显示时间关系。';
  dom.flow.replaceChildren(node('div', 'empty', '请选择插件生成的记录文件。'));
  dom.detail.replaceChildren(node('div', 'empty', '选择一项 task 调用'));
  dom.children.replaceChildren(node('div', 'empty', '导入后选择会话，查看明确关联的子 Agent。'));
  dom.error.textContent = message;
  dom.error.hidden = false;
  dom['session-note'].textContent = '导入后选择会话，或查看最近记录。';
}

function loadTexts(texts, label) {
  try {
    const rows = parseEventFiles(texts);
    timeline = buildTimeline(rows);
    selectedTask = null;
    selectedSession = null;
    dom['file-note'].textContent = label;
    dom.error.hidden = true;
    updateSessionSelection();
  } catch (error) {
    importError(error.message);
  }
}

dom['event-files'].addEventListener('change', async () => {
  const files = [...dom['event-files'].files];
  if (!files.length) return;
  if (files.reduce((size, file) => size + file.size, 0) > 12 * 1024 * 1024) {
    importError('记录文件合计超过 12 MiB，请分批选择。');
    dom['event-files'].value = '';
    return;
  }
  try { loadTexts(await Promise.all(files.map((file) => file.text())), `已导入 ${files.map((file) => file.name).join('、')} · 当前快照`); }
  catch { importError('读取所选文件失败。'); }
  dom['event-files'].value = '';
});

dom['session-select'].addEventListener('change', () => {
  selectedSession = dom['session-select'].value || null;
  selectedTask = null;
  if (!selectedSession) return updateSessionSelection();
  dom['session-note'].textContent = '已选择导入记录中的会话；不一定是当前聊天。';
  render();
});

dom['latest-session'].addEventListener('click', () => {
  const latest = timeline?.sessions.find((item) => item.taskCount > 0);
  if (!latest) return;
  selectedSession = latest.id;
  selectedTask = null;
  dom['session-select'].value = latest.id;
  dom['session-note'].textContent = '最近有 task 调用的会话（推断）；可能不是当前聊天。';
  render();
});
