// 页面共享状态 + 简单的事件总线 + 界面偏好的保存
export const S = {
  st: null,
  list: { items: [], total: 0, languages: [], terms: [], loading: false, error: '', loaded: false },
  q: '',
  scopes: { name: true, readme: true, notes: true },
  collection: 'all',
  sort: 'starred',
  language: '',
  status: 'all',
  sel: null,
  detail: null,
  tab: 'explain',
  exMode: 'cloud',
  readmes: new Map(),
  loadExternal: new Set(),
  manager: { chat: [], calls: [], session: false, loaded: false },
  models: null,
  sse: false,
  sseDown: false, // 实时连接断了超过 3 秒才算（短暂重连不打扰）
  pane: 'list',
};

const listeners = new Map();
export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt)?.delete(fn);
}
export function emit(evt, data) {
  for (const fn of [...(listeners.get(evt) || [])]) {
    try {
      fn(data);
    } catch (error) {
      console.error('listener failed', evt, error);
    }
  }
}

const KEY = 'ghshelf.ui.v1';
export function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (typeof p.collection === 'string') S.collection = p.collection;
    if (['starred', 'stars', 'pushed', 'name', 'recent'].includes(p.sort)) S.sort = p.sort;
    if (typeof p.language === 'string') S.language = p.language;
    if (['all', 'explained', 'unexplained', 'noted'].includes(p.status)) S.status = p.status;
    if (p.scopes && typeof p.scopes === 'object') S.scopes = { name: p.scopes.name !== false, readme: p.scopes.readme !== false, notes: p.scopes.notes !== false };
    if (typeof p.sel === 'string') S.sel = p.sel;
    if (['explain', 'readme', 'notes', 'chat', 'info'].includes(p.tab)) S.tab = p.tab;
    if (typeof p.q === 'string') S.q = p.q.slice(0, 120);
  } catch {
    /* 偏好读不出来就用默认值 */
  }
}
export function savePrefs() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ collection: S.collection, sort: S.sort, language: S.language, status: S.status, scopes: S.scopes, sel: S.sel, tab: S.tab, q: S.q }));
  } catch {
    /* 存不了也不影响使用 */
  }
}
