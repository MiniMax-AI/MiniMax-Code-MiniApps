const TABS = ['appearance', 'tasks', 'settings'];
const FILTERS = ['recent', 'all'];
const CONNECTION = { ready: '已连接', connecting: '连接中', not_permitted: '未授权', unavailable: '连接中断' };

/** Owns the inline panel only; task updates never navigate or replace its content. */
export function createPanelNavigation({ panel, beforeCloseImport = () => true, onLeaveDraft = () => {} }) {
  if (!panel?.ownerDocument) throw new TypeError('A panel element is required.');
  const find = (selector) => panel.querySelector(selector);
  const tabs = new Map(TABS.map((name) => [name, find(`[data-panel-tab="${name}"]`)]));
  const pages = new Map(TABS.map((name) => [name, find(`[data-panel-page="${name}"]`)]));
  if ([...tabs.values(), ...pages.values()].some((node) => !node)) throw new TypeError('Three panel tabs and pages are required.');
  let state = { tab: 'appearance', appearanceView: 'pets', settingsView: 'main', taskFilter: 'recent', taskDetail: false };
  let disposed = false;
  let taskReturnFocus = null, taskReturnId = null;
  const listeners = [];
  const listen = (element, event, callback) => {
    if (!element) return;
    element.addEventListener(event, callback);
    listeners.push(() => element.removeEventListener(event, callback));
  };
  const hidden = (selector, value) => { const node = find(selector); if (node) node.hidden = value; };
  const focus = (selector) => find(selector)?.focus({ preventScroll: true });
  function paint() {
    for (const name of TABS) {
      tabs.get(name).setAttribute('aria-selected', String(name === state.tab));
      tabs.get(name).tabIndex = name === state.tab ? 0 : -1;
      pages.get(name).hidden = name !== state.tab;
    }
    hidden('#appearance-main', state.appearanceView !== 'pets');
    hidden('#import-panel', state.appearanceView !== 'import');
    hidden('#settings-main', state.settingsView !== 'main');
    hidden('#draft-card', state.settingsView !== 'draft');
    hidden('#recent-tasks', state.taskFilter !== 'recent');
    hidden('#all-sessions', state.taskFilter !== 'all');
    for (const filter of FILTERS) find(`#task-filter-${filter}`)?.setAttribute('aria-pressed', String(state.taskFilter === filter));
    panel.dataset.taskDetail = state.taskDetail ? 'open' : 'closed';
  }
  function leaveDraft() {
    if (state.settingsView !== 'draft') return;
    state.settingsView = 'main';
    onLeaveDraft();
  }
  function showTab(tab, { focus: moveFocus = false } = {}) {
    if (disposed || !TABS.includes(tab)) return false;
    if (tab !== 'settings') leaveDraft();
    state.tab = tab;
    paint();
    if (moveFocus) tabs.get(tab).focus({ preventScroll: true });
    return true;
  }
  const api = {
    showTab,
    showImport() {
      if (disposed) return false;
      showTab('appearance'); state.appearanceView = 'import'; paint(); focus('#import-pick'); return true;
    },
    closeImport() {
      if (disposed || state.appearanceView !== 'import' || beforeCloseImport() === false) return false;
      state.appearanceView = 'pets'; paint(); focus('#open-import'); return true;
    },
    completeImport() {
      if (disposed) return false;
      state.appearanceView = 'pets'; paint(); return true;
    },
    showDraft() {
      if (disposed) return false;
      showTab('settings'); state.settingsView = 'draft'; paint(); focus('#talk-text'); return true;
    },
    showTaskDetail() {
      if (disposed) return false;
      const active = panel.ownerDocument.activeElement;
      if (find('#task-list-pane')?.contains(active)) {
        taskReturnFocus = active;
        taskReturnId = active.closest('[data-session-id]')?.dataset.sessionId || null;
      }
      showTab('tasks'); state.taskDetail = true; paint(); focus('#detail-title'); return true;
    },
    showTaskList() {
      if (disposed) return false;
      state.taskDetail = false; paint();
      const target = taskReturnFocus?.isConnected ? taskReturnFocus : taskReturnId
        ? [...panel.querySelectorAll('#task-list-pane [data-session-id]')].find((node) => node.dataset.sessionId === taskReturnId) : null;
      if (target) (target.matches('button') ? target : target.querySelector('button'))?.focus({ preventScroll: true });
      else focus(`#task-filter-${state.taskFilter}`);
      return true;
    },
    setTaskFilter(filter) {
      if (disposed || !FILTERS.includes(filter)) return false;
      state.taskFilter = filter; state.taskDetail = false; paint(); return true;
    },
    update({ reminderCount = 0, availability = 'unavailable' } = {}) {
      if (disposed) return;
      const count = Number.isSafeInteger(reminderCount) && reminderCount > 0 ? reminderCount : 0;
      const badge = find('#panel-task-count');
      if (badge) { badge.hidden = count === 0; badge.textContent = count > 99 ? '99+' : String(count); }
      const connection = find('#connection-status');
      if (connection) {
        connection.textContent = CONNECTION[availability] || CONNECTION.unavailable;
        connection.dataset.status = availability in CONNECTION ? availability : 'unavailable';
      }
    },
    getState: () => ({ ...state }),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const remove of listeners.splice(0)) remove();
    },
  };
  for (const [name, tab] of tabs) {
    listen(tab, 'click', () => showTab(name));
    listen(tab, 'keydown', (event) => {
      const index = TABS.indexOf(name);
      const next = event.key === 'ArrowRight' ? TABS[(index + 1) % TABS.length]
        : event.key === 'ArrowLeft' ? TABS[(index + TABS.length - 1) % TABS.length]
          : event.key === 'Home' ? TABS[0] : event.key === 'End' ? TABS.at(-1) : null;
      if (next) { event.preventDefault(); showTab(next, { focus: true }); }
    });
  }
  listen(find('#open-import'), 'click', api.showImport);
  listen(find('#import-back'), 'click', api.closeImport);
  listen(find('#open-draft'), 'click', api.showDraft);
  listen(find('#draft-back'), 'click', () => { if (!disposed) { leaveDraft(); paint(); focus('#open-draft'); } });
  listen(find('#task-detail-back'), 'click', api.showTaskList);
  for (const filter of FILTERS) listen(find(`#task-filter-${filter}`), 'click', () => api.setTaskFilter(filter));
  paint();
  return api;
}
