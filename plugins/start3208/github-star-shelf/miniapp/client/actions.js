// 所有「做事」的函数：请求、刷新、提示。界面只管调用它们。
import { S, emit, savePrefs } from './state.js';
import { api, connectEvents } from './api.js';
import { toast } from './ui.js';

const enc = encodeURIComponent;
const fail = (e) => {
  toast(e?.message || '操作失败', 'err');
  return null;
};
const run = async (fn) => {
  try {
    return await fn();
  } catch (e) {
    return fail(e);
  }
};

// ---------- 读取 ----------
export async function loadState() {
  try {
    S.st = await api('GET', '/api/state');
    S.stateError = '';
    if (S.collection !== 'all' && !S.st.collections.some((c) => c.id === S.collection)) {
      S.collection = 'all';
      loadList();
    }
  } catch (e) {
    S.stateError = e.message;
  }
  emit('state');
}

function listQuery(offset, limit) {
  const p = new URLSearchParams();
  if (S.q.trim()) p.set('q', S.q.trim());
  p.set('collection', S.collection);
  p.set('sort', S.sort);
  if (S.language) p.set('language', S.language);
  if (S.status !== 'all') p.set('status', S.status);
  if (!S.scopes.name) p.set('name', '0');
  if (!S.scopes.readme) p.set('readme', '0');
  if (!S.scopes.notes) p.set('notes', '0');
  p.set('offset', String(offset));
  p.set('limit', String(limit));
  return p.toString();
}

let listSeq = 0;
/** append：加载更多；keep：刷新时保留已经翻出来的条数 */
export async function loadList({ append = false, keep = false } = {}) {
  const seq = ++listSeq;
  S.list.loading = true;
  emit('list');
  try {
    const have = S.list.items.length;
    const r = await api('GET', '/api/projects?' + listQuery(append ? have : 0, append ? 50 : keep ? Math.min(200, Math.max(50, have)) : 50));
    if (seq !== listSeq) return;
    S.list = { items: append ? [...S.list.items, ...r.items] : r.items, total: r.total, languages: r.languages, terms: r.terms, loading: false, error: '', loaded: true };
  } catch (e) {
    if (seq !== listSeq) return;
    S.list = { ...S.list, loading: false, error: e.message, loaded: true };
  }
  emit('list');
}

export async function loadDetail(key) {
  try {
    const d = await api('GET', '/api/projects/' + enc(key));
    if (S.sel !== key) return;
    const first = !S.detail || S.detail.key !== key;
    S.detail = d;
    if (first) S.exMode = d.explain?.cloud ? 'cloud' : d.explain?.local ? 'local' : 'cloud';
    emit('detail');
  } catch (e) {
    if (S.sel !== key) return;
    if (e.status === 404 || e.code === 'bad_key') {
      S.sel = null;
      S.detail = null;
      S.pane = 'list';
      savePrefs();
      emit('pane');
      emit('sel');
    } else fail(e);
  }
}

// keepPane：启动时恢复上次选中的项目，但窄屏仍先停在列表（宽屏本来就是双栏）
export async function selectProject(key, tab, { keepPane = false } = {}) {
  if (S.sel !== key) {
    S.sel = key;
    S.detail = null;
    emit('sel');
  }
  if (tab) S.tab = tab;
  if (!keepPane) S.pane = 'detail';
  savePrefs();
  emit('pane');
  emit('list');
  await loadDetail(key);
}
export const resetSession = (key) => run(async () => {
  await api('POST', '/api/projects/' + enc(key) + '/session/reset');
  await loadDetail(key);
  return true;
});
export const resetManagerSession = () => run(async () => {
  await api('POST', '/api/manager/session/reset');
  await loadManager();
  return true;
});
export function backToList() {
  S.pane = 'list';
  emit('pane');
}
export function setTab(tab) {
  S.tab = tab;
  savePrefs();
  emit('tab');
}

export async function loadReadme(key, force = false) {
  const cur = S.readmes.get(key);
  if (cur?.loading) return;
  if (cur && cur.status && !force) {
    emit('readme', key);
    return;
  }
  S.readmes.set(key, { ...(force ? {} : cur || {}), loading: true, error: '' });
  emit('readme', key);
  try {
    const r = await api('GET', '/api/projects/' + enc(key) + '/readme' + (force ? '?force=1' : ''));
    S.readmes.set(key, { ...r, loading: false, error: '' });
  } catch (e) {
    S.readmes.set(key, { loading: false, error: e.message });
  }
  emit('readme', key);
}

export async function loadManager() {
  try {
    const r = await api('GET', '/api/manager');
    S.manager = { ...r, loaded: true };
  } catch (e) {
    S.manager = { ...S.manager, loaded: true };
    fail(e);
  }
  emit('manager');
}

export async function loadModels() {
  if (S.models) return S.models;
  try {
    S.models = await api('GET', '/api/models');
  } catch (e) {
    S.models = { models: [], defaultKey: '', preferredKey: '', pickedKey: '', error: e.message };
  }
  return S.models;
}

let refreshing = false;
let again = false;
export async function refreshAll() {
  if (refreshing) {
    again = true;
    return;
  }
  refreshing = true;
  try {
    await Promise.all([loadState(), loadList({ keep: true }), S.sel ? loadDetail(S.sel) : null, S.manager.loaded ? loadManager() : null]);
  } finally {
    refreshing = false;
    if (again) {
      again = false;
      refreshAll();
    }
  }
}

// ---------- 实时 ----------
let pending = { state: false, list: false, detail: false, manager: false };
let timer = null;
function scheduleRefresh(p) {
  Object.assign(pending, Object.fromEntries(Object.entries(p).filter(([, v]) => v)));
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const w = pending;
    pending = { state: false, list: false, detail: false, manager: false };
    if (w.state) loadState();
    if (w.list) loadList({ keep: true });
    if (w.detail && S.sel) loadDetail(S.sel);
    if (w.manager && S.manager.loaded) loadManager();
  }, 250);
}
function onServerEvent(evt) {
  switch (evt.type) {
    case 'hello':
      refreshAll();
      break;
    case 'changed': {
      const scope = evt.scope || 'all';
      scheduleRefresh({
        state: true,
        list: scope !== 'settings' && scope !== 'manager',
        detail: scope === 'all' || scope === 'projects' || scope === 'collections' || (scope === 'project' && evt.key === S.sel),
        manager: scope === 'manager' || scope === 'all',
      });
      break;
    }
    case 'calls':
      if (evt.key === '__manager__') {
        S.manager = { ...S.manager, calls: evt.calls };
        emit('manager');
      } else {
        if (evt.key === S.sel && S.detail) {
          S.detail.calls = evt.calls;
          emit('calls');
        }
        const item = S.list.items.find((i) => i.key === evt.key);
        if (item) {
          item.busy = evt.calls[0]?.kind || null;
          emit('list');
        }
      }
      break;
    case 'import':
      if (S.st) S.st.import = evt.view;
      emit('import');
      break;
    case 'prefetch':
      if (S.st) S.st.prefetch = evt.view;
      emit('prefetch');
      break;
    default:
      break;
  }
}
export function startRealtime() {
  let downTimer = 0;
  connectEvents(onServerEvent, (ok) => {
    S.sse = ok;
    clearTimeout(downTimer);
    if (ok) {
      if (S.sseDown) {
        S.sseDown = false;
        refreshAll();
      }
    } else if (!S.sseDown) {
      downTimer = setTimeout(() => {
        if (!S.sse) {
          S.sseDown = true;
          emit('sse');
        }
      }, 3000);
    }
    emit('sse');
  });
  setInterval(() => {
    if (!S.sse && document.visibilityState === 'visible') refreshAll();
  }, 4000);
  document.addEventListener('visibilitychange', () => {
    savePrefs();
    if (document.visibilityState === 'visible') refreshAll();
  });
}

// ---------- 导入 ----------
export const startImport = (user) => run(async () => {
  const v = await api('POST', '/api/import', { user: user ?? '' });
  if (S.st) S.st.import = v;
  emit('import');
  return v;
});
export const cancelImport = () => run(() => api('POST', '/api/import/cancel', {}));
export const startPrefetch = () => run(() => api('POST', '/api/prefetch', {}));
export const cancelPrefetch = () => run(() => api('POST', '/api/prefetch/cancel', {}));
// 重新找 gh / git（刚装好、或改了终端配置之后用）
export const recheckGithub = () => run(async () => {
  await api('POST', '/api/github/recheck', {});
  await loadState();
  return true;
});

// ---------- 收藏夹 ----------
export const createCollection = (name, description = '') => run(async () => {
  const c = await api('POST', '/api/collections', { name, description });
  await loadState();
  return c;
});
export const updateCollection = (id, patch) => run(async () => {
  const c = await api('PATCH', '/api/collections/' + enc(id), patch);
  await loadState();
  return c;
});
export const deleteCollection = (id) => run(async () => {
  await api('DELETE', '/api/collections/' + enc(id));
  if (S.collection === id) setCollection('all');
  await refreshAll();
  return true;
});
export function setCollection(id) {
  S.collection = id;
  savePrefs();
  emit('filters');
  loadList();
}
export const setMembership = (key, patch) => run(async () => {
  await api('POST', '/api/projects/' + enc(key) + '/collections', patch);
  await Promise.all([loadState(), loadList({ keep: true }), key === S.sel ? loadDetail(key) : null]);
  return true;
});

// ---------- 项目 ----------
// 添加失败时把错误交给对话框，贴在输入框下面显示（toast 会消失）
export async function addProject(url, collection) {
  const card = await api('POST', '/api/projects/add', { url, collection: collection && collection !== 'all' ? collection : undefined });
  await Promise.all([loadState(), loadList({ keep: true })]);
  return card;
}
export const removeProject = (key) => run(async () => {
  await api('DELETE', '/api/projects/' + enc(key));
  if (S.sel === key) {
    S.sel = null;
    S.detail = null;
    S.pane = 'list';
    savePrefs();
    emit('pane');
    emit('sel');
  }
  await refreshAll();
  return true;
});
export const clearProjectCache = (key) => run(async () => {
  await api('DELETE', '/api/projects/' + enc(key) + '/cache');
  await Promise.all([loadState(), key === S.sel ? loadDetail(key) : null]);
  return true;
});

// ---------- 备注 ----------
export const addNote = (key, text) => run(async () => {
  const n = await api('POST', '/api/projects/' + enc(key) + '/notes', { text });
  await loadDetail(key);
  return n;
});
export const updateNote = (key, id, text) => run(async () => {
  const n = await api('PATCH', '/api/projects/' + enc(key) + '/notes/' + enc(id), { text });
  await loadDetail(key);
  return n;
});
export const deleteNote = (key, id) => run(async () => {
  await api('DELETE', '/api/projects/' + enc(key) + '/notes/' + enc(id));
  await loadDetail(key);
  return true;
});

// ---------- AI ----------
function applyCall(key, view) {
  if (key === S.sel && S.detail && view) {
    S.detail.calls = [...S.detail.calls.filter((c) => c.id !== view.id), view];
    emit('calls');
  }
}
export const startExplain = (key, mode, force = false) => run(async () => {
  const v = await api('POST', '/api/projects/' + enc(key) + '/explain', { mode, force });
  S.exMode = mode;
  applyCall(key, v);
  return v;
});
export const sendMessage = (key, text, whenBusy = 'queue') => run(async () => {
  const v = await api('POST', '/api/projects/' + enc(key) + '/message', { text, whenBusy });
  await loadDetail(key);
  applyCall(key, v);
  return v;
});
export const askAiNotes = (key) => run(async () => {
  const v = await api('POST', '/api/projects/' + enc(key) + '/ai-notes', {});
  await loadDetail(key);
  applyCall(key, v);
  return v;
});
export const cancelCalls = (key) => run(() => api('POST', '/api/projects/' + enc(key) + '/cancel', {}));
export const replyPermission = (key, requestId, decision) => run(() => api('POST', '/api/projects/' + enc(key) + '/permission', { requestId, decision }));

export const managerSend = (text) => run(async () => {
  const v = await api('POST', '/api/manager/message', { text });
  await loadManager();
  return v;
});
export const managerCancel = () => run(() => api('POST', '/api/manager/cancel', {}));
export const managerPermission = (requestId, decision) => run(() => api('POST', '/api/projects/__manager__/permission', { requestId, decision }));

// ---------- 设置 / 缓存 / 导出 ----------
export const saveSettings = (patch) => run(async () => {
  const s = await api('POST', '/api/settings', patch);
  S.models = patch.modelKey !== undefined ? null : S.models;
  await loadState();
  return s;
});
export const loadCache = () => run(() => api('GET', '/api/cache'));
export const clearAllCache = () => run(async () => {
  const r = await api('DELETE', '/api/cache');
  await Promise.all([loadState(), S.sel ? loadDetail(S.sel) : null]);
  return r;
});
export const exportMarkdown = (collection) => run(() => api('GET', '/api/export?collection=' + enc(collection || 'all')));
