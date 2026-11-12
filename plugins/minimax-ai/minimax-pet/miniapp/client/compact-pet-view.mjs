import { markdownToPlainText, renderMarkdown, resetMarkdown } from './markdown.mjs';
import { t } from './i18n.mjs';

const STATUS_KEYS = { running: 'desk.statusRunning', error: 'status.error', completed: 'status.completed', aborted: 'status.aborted', idle: 'status.idle', needs_answer: 'status.needsAnswer' };
const statusLabel = (status) => (STATUS_KEYS[status] ? t(STATUS_KEYS[status]) : t('desk.toView'));
const textOf = (value) => typeof value === 'string' ? value : '';
const failureCode = (error) => textOf(error?.code) || textOf(error?.message) || textOf(error) || 'result_unknown';
// A completed live turn returns to raw idle. Only that observed completion
// promotes idle; newer running/error/aborted facts must retain their status.
export const taskStatus = (row) => row?.needsAnswer === true ? 'needs_answer'
  : row?.status === 'idle' && row.liveCompleted === true ? 'completed'
    : textOf(row?.status) || textOf(row?.displayStatus);

/** Task notifications and their complete replies stay beside the pet. */
export function createCompactPetView({
  container, onClose, onSelectTask, onOpenSession,
}) {
  if (!container?.ownerDocument) throw new TypeError('A compact pet container is required.');
  const doc = container.ownerDocument;
  const hadRootClass = container.classList.contains('compact-pet-card');
  container.classList.add('compact-pet-card');
  let disposed = false, opened = false, view = 'tasks', reminders = { items: [] };
  let allSessions = null, taskSelection = {}, detailBackView = 'tasks';
  let paintedDetailId = null, openToken = 0;
  const rows = new Map();
  const setText = (node, value) => { const next = String(value ?? ''); if (node.textContent !== next) node.textContent = next; };
  const element = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const callbacks = [];
  const bind = (node, event, listener) => { node.addEventListener(event, listener); callbacks.push(() => node.removeEventListener(event, listener)); };
  const button = (label, className, handler) => {
    const node = element('button', `compact-button ${className || ''}`.trim(), label);
    node.type = 'button'; bind(node, 'click', handler);
    return node;
  };
  const selection = () => {
    const id = textOf(taskSelection.selectedSessionId);
    return { id,
      session: id && taskSelection.session?.sessionId === id ? taskSelection.session : null,
      detail: id && taskSelection.detail?.sessionId === id ? taskSelection.detail : null,
      available: taskSelection.availability === 'ready',
    };
  };
  const call = async (callback, ...args) => {
    if (disposed) return { ok: false, code: 'disposed' };
    try { return await callback?.(...args); }
    catch (error) { return { ok: false, code: failureCode(error) }; }
  };

  const header = element('div', 'compact-header');
  const state = element('span', 'compact-state'); state.setAttribute('role', 'status');
  const closeButton = button('×', 'compact-close', () => {
    if (disposed) return;
    api.close(); void call(onClose);
  });
  header.append(state, closeButton);

  const tasksPane = element('div', 'compact-tasks compact-body');
  const taskList = element('ul', 'compact-task-list');
  const empty = element('li', 'compact-empty', t('desk.emptyRecent'));
  const tasksFooter = element('div', 'compact-footer');
  const allTasks = button('', 'compact-link', () => api.open('allTasks'));
  tasksFooter.append(allTasks); tasksPane.append(taskList, tasksFooter);

  const detailPane = element('div', 'compact-detail');
  const detailHead = element('div', 'compact-detail-head');
  const detailTitle = element('strong', 'compact-detail-title');
  const detailStatus = element('span', 'compact-detail-status'); detailStatus.setAttribute('role', 'status');
  detailHead.append(detailTitle, detailStatus);
  // Only the reply scrolls; the title and the actions stay pinned so a long title or a
  // long reply can never push the buttons out of the 280px card.
  const detailBody = element('div', 'compact-detail-body');
  const detailReply = element('div', 'compact-detail-reply md');
  detailReply.tabIndex = 0;
  detailBody.append(detailReply);
  const detailFooter = element('div', 'compact-footer');
  const back = button('', 'compact-detail-back compact-link', () => api.open(detailBackView));
  const openHint = element('p', 'compact-hint'); openHint.setAttribute('role', 'status'); openHint.hidden = true;
  const setHint = (text, kind = 'info') => { setText(openHint, text); openHint.dataset.kind = kind; openHint.hidden = !openHint.textContent; };
  // The Host checks user activation, so the callback must run synchronously inside this click.
  const openSession = button(t('tasks.open'), 'compact-open', () => {
    const { id } = selection();
    if (disposed || !id || typeof onOpenSession !== 'function') return;
    const token = ++openToken;
    openSession.disabled = true; setHint(t('desk.openHint'));
    void call(onOpenSession, id).then((result) => {
      if (disposed || token !== openToken) return;
      openSession.disabled = false;
      const failed = result?.ok === false;
      setHint(textOf(result?.text) || (failed ? t('desk.openFailed', { code: failureCode(result) }) : ''), textOf(result?.kind) || (failed ? 'error' : 'info'));
    });
  });
  detailFooter.append(back, openSession);
  detailPane.append(detailHead, detailBody, detailFooter, openHint);
  container.append(header, tasksPane, detailPane);

  function paintTasks() {
    const reminderItems = Array.isArray(reminders?.items) ? reminders.items : Array.isArray(reminders) ? reminders : [];
    const items = view === 'allTasks' && Array.isArray(allSessions) ? allSessions : reminderItems;
    const visible = [], seen = new Set();
    for (const item of items) {
      if (!textOf(item?.sessionId) || seen.has(item.sessionId)) continue;
      seen.add(item.sessionId); visible.push(item);
      if (view !== 'allTasks' && visible.length === 3) break;
    }
    const keep = new Set(visible.map((item) => item.sessionId));
    for (const [id, row] of rows) if (!keep.has(id)) { row.node.remove(); rows.delete(id); }
    if (visible.length) empty.remove();
    for (const [index, item] of visible.entries()) {
      let row = rows.get(item.sessionId);
      if (!row) {
        row = { item, node: element('li', 'compact-task') };
        row.title = button('', 'compact-task-title', () => { void call(onSelectTask, row.item.sessionId); });
        row.status = element('span', 'compact-task-status');
        row.preview = element('p', 'compact-task-preview');
        row.node.append(row.title, row.status, row.preview); rows.set(item.sessionId, row);
      }
      row.item = item;
      setText(row.title, textOf(item.title) || t('desk.untitled'));
      row.title.setAttribute('aria-label', t('desk.taskAria', { title: textOf(item.title) || t('desk.untitled') }));
      setText(row.preview, item.needsAnswer === true ? t('status.needsAnswer') : markdownToPlainText(textOf(item.previewText))); row.preview.hidden = !row.preview.textContent;
      const status = taskStatus(item);
      setText(row.status, statusLabel(status)); row.status.dataset.status = status;
      row.title.disabled = typeof onSelectTask !== 'function';
      if (taskList.children[index] !== row.node) taskList.insertBefore(row.node, taskList.children[index] || null);
    }
    setText(empty, view === 'allTasks' ? t('desk.emptyAll') : t('desk.emptyRecent'));
    allTasks.hidden = view === 'allTasks';
    if (!visible.length && empty.parentNode !== taskList) taskList.append(empty);
  }

  function paintDetail() {
    const { id, session, detail, available } = selection();
    const needsAnswer = available && session?.needsAnswer === true;
    const status = taskStatus(session) || taskStatus(detail);
    setText(detailTitle, textOf(session?.title) || textOf(detail?.title) || t('desk.reply'));
    setText(detailStatus, available ? statusLabel(status) : t('desk.unavailableShort'));
    detailStatus.dataset.status = !available ? 'unavailable' : status;
    let text;
    if (!available) text = t('desk.unavailable');
    else if (needsAnswer) text = t('status.needsAnswer');
    // A background refresh keeps the matching reply mounted; a short loading
    // placeholder would shrink its scroll range and reset a reader's position.
    else if (taskSelection.detailLoading && !detail) text = t('desk.loading');
    else if (taskSelection.detailError) text = t('desk.replyFailed', { code: failureCode(taskSelection.detailError) });
    else if (!id) text = t('desk.chooseTask');
    else if (!detail) text = t('desk.loading');
    else text = (detail.status === 'error' && textOf(detail.error)) || textOf(detail.lastAssistantText) || t('desk.replyEmpty');
    // Status copy stays plain text; an actual reply is markdown. renderMarkdown keeps
    // the DOM when the text is unchanged and restores the scroll offset when a
    // streaming reply replaces it.
    if (needsAnswer || !available || taskSelection.detailLoading && !detail) {
      if (detailReply.dataset.mdSource !== text) { resetMarkdown(detailReply); setText(detailReply, text); }
    } else {
      renderMarkdown(detailReply, text);
    }
    detailPane.setAttribute('aria-busy', String(available && !needsAnswer && taskSelection.detailLoading === true));
    if (paintedDetailId !== id) {
      detailReply.scrollTop = 0; detailBody.scrollTop = 0; paintedDetailId = id;
      openToken++; openSession.disabled = false; setHint('');
    }
    openSession.hidden = typeof onOpenSession !== 'function' || !available || !id;
    setText(openSession, needsAnswer ? t('tasks.goAnswer') : t('tasks.open'));
    openSession.setAttribute('aria-label', t('desk.openAria', {
      action: needsAnswer ? t('tasks.goAnswer') : t('tasks.open'),
      title: textOf(session?.title) || textOf(detail?.title) || t('tasks.openFallback'),
    }));
  }

  function paint() {
    if (disposed) return;
    // Labels follow the interface language, which the page resolves after this view exists.
    closeButton.setAttribute('aria-label', t('desk.closePanel'));
    detailReply.setAttribute('aria-label', t('desk.replyAria'));
    setText(allTasks, t('tasks.all'));
    setText(back, t('tasks.back'));
    container.hidden = !opened;
    tasksPane.hidden = !['tasks', 'allTasks'].includes(view); detailPane.hidden = view !== 'detail';
    setText(state, view === 'tasks' ? t('desk.panelState.tasks') : view === 'allTasks' ? t('desk.panelState.allTasks') : t('desk.panelState.detail'));
    paintTasks(); paintDetail();
  }

  const api = {
    get opened() { return opened && !disposed; },
    get view() { return view; },
    update(next = {}) {
      if (disposed) return;
      reminders = next.reminders || { items: [] };
      allSessions = Array.isArray(next.allSessions) ? next.allSessions : null;
      taskSelection = next.taskSelection || {};
      paint();
    },
    open(next = 'tasks') {
      if (disposed || !['tasks', 'allTasks', 'detail'].includes(next)) return false;
      if (next === 'detail' && ['tasks', 'allTasks'].includes(view)) detailBackView = view;
      view = next; opened = true; paint(); return true;
    },
    close() { if (!disposed) { opened = false; paint(); } },
    dispose() {
      if (disposed) return;
      disposed = true; opened = false;
      for (const unbind of callbacks) unbind();
      header.remove(); tasksPane.remove(); detailPane.remove(); rows.clear();
      container.hidden = true;
      if (!hadRootClass) container.classList.remove('compact-pet-card');
    },
  };
  paint(); return api;
}
