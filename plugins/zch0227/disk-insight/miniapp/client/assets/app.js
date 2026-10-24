/* 磁盘透视 — 页面端逻辑。原生 JavaScript，不依赖框架和第三方库。
 * 只按接口契约 knowledge/contracts/miniapp-disk-insight-api.md 调用相对 URL。
 */
/** @typedef {import('../client-api.js').MiniAppAgentAPI} MiniAppAgentAPI */
/** @typedef {import('../client-api.js').MiniAppAgentRunEvent} MiniAppAgentRunEvent */

'use strict';

/* ---------- 主题：同步执行，避免首屏闪烁 ---------- */
(function initTheme() {
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const apply = () => {
    document.documentElement.setAttribute('data-theme', mq && mq.matches ? 'dark' : 'light');
  };
  apply();
  if (mq) {
    if (mq.addEventListener) mq.addEventListener('change', apply);
    else if (mq.addListener) mq.addListener(apply);
  }
})();

(function main() {
  /* ---------- 常量与文案 ---------- */

  const CATEGORY_NAMES = {
    temp: '临时文件',
    'pkg-cache': '包管理器缓存',
    'browser-cache': '浏览器缓存',
    logs: '日志和崩溃报告',
    thumbnails: '缩略图缓存',
    'build-artifacts': '开发构建产物',
    installers: '旧安装包',
    'pnpm-store': 'pnpm 存储',
    'app-cache': '应用缓存',
    'chat-cache': '聊天软件缓存',
    'chat-received': '聊天软件接收的文件',
    'python-venv': 'Python 虚拟环境',
    simulators: '模拟器和设备支持',
    'large-old': '大且久未修改的文件',
    duplicates: '重复文件',
    'system-junk': '系统垃圾',
    trash: '废纸篓或回收站',
    docker: 'Docker 磁盘镜像',
    'go-mod-cache': 'Go 模块缓存',
  };

  const TIERS = [
    { id: 'safe', title: '建议清理', desc: '删除后会自动重建，默认已勾选' },
    { id: 'confirm', title: '需要确认', desc: '可能丢失信息，默认不勾选，请逐项确认' },
    { id: 'info', title: '仅提示', desc: '需要系统或对应软件处理，这里只显示大小和处理方法' },
  ];

  const PHASES = [
    { id: 'quick', name: '快速扫描' },
    { id: 'deep', name: '深度扫描' },
    { id: 'duplicates', name: '比对重复文件' },
  ];

  const KIND_OPTIONS = [
    ['', '全部类型'],
    ['video', '视频'],
    ['image', '图片'],
    ['audio', '音频'],
    ['disk-image', '磁盘镜像'],
    ['archive', '压缩包'],
    ['installer', '安装包'],
    ['vm', '虚拟机磁盘'],
    ['other', '其他'],
  ];
  const KIND_LABELS = Object.fromEntries(KIND_OPTIONS.slice(1));
  KIND_LABELS['dev-cache'] = '开发缓存';

  const AGE_OPTIONS = [
    ['', '不限'],
    ['90', '90 天前'],
    ['180', '180 天前'],
    ['365', '1 年前'],
  ];

  const REPO_SORT_OPTIONS = [
    ['size', '合计大小'],
    ['worktrees', 'worktree 数量'],
    ['activity', '最近活动'],
  ];

  /** worktree 状态：文字、徽章样式 */
  const WT_STATUS = {
    unchecked: ['未检查', ''],
    checking: ['检查中', 'is-checking'],
    clean: ['干净', 'badge-ok'],
    dirty: ['有未提交的改动', 'badge-warn'],
    ahead: ['有未推送的提交', 'badge-warn'],
    'dirty-ahead': ['两者都有', 'badge-warn'],
    error: ['检查失败', 'badge-danger'],
    'no-git': ['未安装 git', 'badge-danger'],
  };

  /** 已选清单的来源分组名称 */
  const SOURCE_LABELS = {
    large: '大文件',
    duplicates: '重复文件',
    worktree: 'worktree',
    manual: '空间地图里手动勾选的条目',
  };

  const SORT_OPTIONS = [
    ['size', '大小'],
    ['mtime', '修改时间（从旧到新）'],
    ['name', '名称'],
  ];

  /** 路径校验错误码翻译 */
  function pathErrorText(code) {
    const win = S.state && S.state.platform === 'win32';
    switch (code) {
      case 'not_absolute':
        return `请输入完整路径，例如 ${win ? 'C:\\Users\\你的用户名\\code' : '/Users/你的用户名/code'}`;
      case 'not_found':
        return '找不到这个文件夹';
      case 'not_dir':
        return '这是文件，不是文件夹';
      case 'unknown_disk':
        return '这个位置不在已识别的磁盘上';
      case 'invalid_path':
        return '有文件夹已经不存在或不可用，请检查后再试';
      default:
        return '没能检查这个路径，请稍后再试';
    }
  }

  const TAG_BADGES = {
    git: { text: '含 git 仓库', cls: 'badge-warn' },
    chat: { text: '聊天文件', cls: 'badge-warn' },
    'in-use': { text: '可能正在使用', cls: '' },
  };

  /** 清理失败原因，按契约错误码翻译 */
  function cleanErrorText(code) {
    const trash = labels().trash;
    const map = {
      changed: '扫描后有变化，请重新扫描',
      missing: '已不存在',
      protected: '受保护的位置，不能删除',
      symlink: '是符号链接或目录联接，已跳过',
      not_deletable_volume: '在外接盘或网络盘上，只扫描不删除',
      in_use: '正被程序占用，请先退出相关程序再试',
      permission_denied: '没有权限删除',
      delete_failed: '没能删完，可能已经删掉了一部分，重新扫描可以看到剩下的大小',
      // 现在清理是直接删除，trash_failed 只会出现在旧的清理记录里
      trash_failed: `没能移到${trash}`,
    };
    return map[code] || '清理失败';
  }

  /** 问 Agent 的错误码翻译 */
  function agentErrorText(code, hasSession) {
    switch (code) {
      case 'not_permitted':
        return '这个 Mini App 没有获得调用 Agent 的权限。';
      case 'busy':
        return 'Agent 正忙，请稍后再试。';
      case 'runtime_unavailable':
        return 'MiniMax Code 暂时不可用，这次提问没有发出，请稍后再试。';
      case 'result_unknown':
        return hasSession
          ? '不确定这次提问是否已经执行。请点「在对话中打开」查看，确认前不要重复提问。'
          : '不确定这次提问是否已经执行。请先在 MiniMax Code 的对话列表里确认，不要立即重复提问。';
      case 'cancelled':
        return '提问已取消，没有执行。';
      case 'invalid_request':
        return '提问内容无效，请重新扫描后再试。';
      case 'session_not_found':
        return '找不到这次对话。';
      case 'request_not_found':
        return '这个请求已经失效。';
      default:
        return '提问失败，请稍后再试。';
    }
  }

  const ICONS = {
    more: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.5" cy="8" r="1.3"/></svg>',
    search: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>',
    lock: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7"/></svg>',
    chevron: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4.5 6.5L8 10l3.5-3.5"/></svg>',
    warn: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5l6 10.5H2z"/><path d="M8 6.5v3"/><path d="M8 11.3v.2"/></svg>',
    repo: '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="13" cy="10" r="3.5"/><circle cx="13" cy="30" r="3.5"/><circle cx="27" cy="16" r="3.5"/><path d="M13 13.5v13M27 19.5c0 5-6 5-12 8"/></svg>',
    disk: '<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="6" y="9" width="28" height="22" rx="4"/><path d="M6 23h28"/><circle cx="28" cy="27" r="1.2"/><path d="M12 15h10"/></svg>',
    map: '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="13"/><circle cx="20" cy="20" r="5"/><path d="M20 7v8M33 20h-8"/></svg>',
  };

  /* ---------- 小工具 ---------- */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtBytes(n) {
    const v = Number(n) || 0;
    if (v >= 1e9) return `${(v / 1e9).toFixed(1)} GB`;
    if (v >= 1e6) return `${Math.round(v / 1e6)} MB`;
    if (v >= 1e3) return `${Math.round(v / 1e3)} KB`;
    return `${Math.max(0, Math.round(v))} B`;
  }

  const pad = (n) => String(n).padStart(2, '0');

  function fmtDate(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function fmtDateTime(ms) {
    const d = new Date(ms);
    return `${fmtDate(ms)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /** 30 天以内显示「N 天前」，更早显示日期 */
  function fmtAgo(ms) {
    if (!ms) return '';
    const days = Math.floor((Date.now() - ms) / 86400000);
    if (days <= 0) return '今天';
    if (days <= 30) return `${days} 天前`;
    return fmtDate(ms);
  }

  function modifiedText(ms) {
    if (!ms) return '';
    const ago = fmtAgo(ms);
    return /^\d{4}-/.test(ago) ? `${ago} 修改` : `${ago}修改`;
  }

  function fmtCount(n) {
    return (Number(n) || 0).toLocaleString('zh-CN');
  }

  function pctText(part, total) {
    if (!total) return '0%';
    const p = (part / total) * 100;
    if (p > 0 && p < 0.1) return '<0.1%';
    return `${p.toFixed(p >= 10 ? 0 : 1)}%`;
  }

  function newRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return `ask-${window.crypto.randomUUID()}`;
    }
    return `ask-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  }

  /** 统一的接口请求。失败时抛出带 status / code 的错误，不把原文展示给用户。 */
  async function api(path, options) {
    const opts = options || {};
    const init = { method: opts.method || 'GET', headers: {} };
    if (opts.body !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    let res;
    try {
      res = await fetch(path, init);
    } catch (e) {
      const err = new Error('network');
      err.status = 0;
      err.code = 'network';
      throw err;
    }
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    if (!res.ok) {
      const err = new Error('http');
      err.status = res.status;
      err.code = data && typeof data.error === 'string' ? data.error : '';
      throw err;
    }
    return data;
  }

  /* ---------- 页面状态 ---------- */

  const S = {
    state: null,
    stateError: false,
    tab: 'map',
    largeView: 'large',
    mapView: 'dirs',
    largeFilter: { kind: '', minAgeDays: '', q: '', sort: 'size' },
    junkQuery: { q: '', sort: 'size' },
    mapQuery: { q: '', sort: 'size' },
    reposQuery: { q: '', sort: 'size' },
    reposExpanded: new Set(),
    wt: new Map(),
    mapRootId: null,
    scope: { diskIds: new Set(), folders: [], seeded: false, editing: false },
    expanded: new Set(),
    catIds: {},
    treeId: null,
    mapDiskChosen: null,
    mapDiskNotice: '',
    sel: new Set(),
    selPending: new Map(),
    selSummary: { count: 0, bytes: 0 },
    clean: { jobId: null, progress: null, modalOpen: false },
    ask: {
      requestId: null,
      preparing: false,
      sessionId: null,
      text: '',
      opener: null,
    },
    sse: { down: false, everOpen: false },
    hot: null,
  };

  /** 每个数据源一个槽位，记录数据、加载中、错误 */
  const slots = {
    junk: { data: null, inflight: null, again: false, error: false },
    large: { data: null, inflight: null, again: false, error: false },
    dup: { data: null, inflight: null, again: false, error: false },
    tree: { data: null, inflight: null, again: false, error: false, code: '' },
    types: { data: null, inflight: null, again: false, error: false },
    repos: { data: null, inflight: null, again: false, error: false },
  };

  const SOURCES = {
    junk: {
      url: () => {
        const q = [];
        if (S.junkQuery.q) q.push(`q=${encodeURIComponent(S.junkQuery.q)}`);
        if (S.junkQuery.sort !== 'size') q.push(`sort=${encodeURIComponent(S.junkQuery.sort)}`);
        return `api/junk${q.length ? `?${q.join('&')}` : ''}`;
      },
      render: () => renderJunk(),
    },
    large: {
      url: () => {
        const q = [];
        if (S.largeFilter.kind) q.push(`kind=${encodeURIComponent(S.largeFilter.kind)}`);
        if (S.largeFilter.minAgeDays) q.push(`minAgeDays=${encodeURIComponent(S.largeFilter.minAgeDays)}`);
        if (S.largeFilter.q) q.push(`q=${encodeURIComponent(S.largeFilter.q)}`);
        if (S.largeFilter.sort !== 'size') q.push(`sort=${encodeURIComponent(S.largeFilter.sort)}`);
        return `api/large${q.length ? `?${q.join('&')}` : ''}`;
      },
      render: () => renderLarge(),
    },
    dup: { url: () => 'api/duplicates', render: () => renderLarge() },
    tree: {
      url: () => {
        if (S.treeId) return `api/tree?id=${encodeURIComponent(S.treeId)}&depth=4`;
        const rootId = currentRootId();
        if (rootId) return `api/tree?depth=4&rootId=${encodeURIComponent(rootId)}`;
        if (S.mapDiskChosen) return `api/tree?depth=4&diskId=${encodeURIComponent(S.mapDiskChosen)}`;
        return 'api/tree?depth=4';
      },
      render: () => renderMap(),
    },
    repos: {
      url: () => {
        const q = [];
        if (S.reposQuery.q) q.push(`q=${encodeURIComponent(S.reposQuery.q)}`);
        if (S.reposQuery.sort !== 'size') q.push(`sort=${encodeURIComponent(S.reposQuery.sort)}`);
        return `api/repos${q.length ? `?${q.join('&')}` : ''}`;
      },
      render: () => renderRepos(),
    },
    types: {
      url: () => {
        const rootId = currentRootId();
        if (rootId) return `api/types?rootId=${encodeURIComponent(rootId)}`;
        const diskId = currentMapDiskId();
        return `api/types${diskId ? `?diskId=${encodeURIComponent(diskId)}` : ''}`;
      },
      render: () => renderMap(),
    },
  };

  /** 还没有可以显示的空间地图：从没完成过扫描，而且现在也没在扫描 */
  function mapUnavailable() {
    return !S.state || (!S.state.lastScanAt && !isScanning());
  }

  function load(key) {
    const slot = slots[key];
    const src = SOURCES[key];
    if ((key === 'tree' || key === 'types') && mapUnavailable()) {
      src.render();
      return Promise.resolve();
    }
    if (slot.inflight) {
      slot.again = true;
      return slot.inflight;
    }
    const url = src.url();
    slot.error = false;
    if (!slot.data) src.render();
    slot.inflight = api(url)
      .then(
        (data) => {
          if (url !== src.url()) {
            slot.again = true;
            return;
          }
          slot.data = data;
          slot.code = '';
          afterLoad(key, data);
        },
        (err) => {
          slot.error = true;
          slot.code = err.code || String(err.status || '');
          if (key === 'tree' && slot.code === 'root_not_found' && S.mapRootId && !S.treeId) {
            S.mapRootId = null;
            S.mapDiskNotice = '这个扫描范围已经不在了，显示的是第一个扫描范围';
            slot.again = true;
            slot.error = false;
          } else if (key === 'tree' && slot.code === 'disk_not_scanned' && S.mapDiskChosen && !S.treeId) {
            // 选中的磁盘没有扫描结果，退回第一个已扫描的磁盘
            S.mapDiskChosen = null;
            S.mapDiskNotice = '这个磁盘还没有扫描结果。可以在上方的扫描范围里勾选它后重新扫描';
            slot.again = true;
            slot.error = false;
          } else if (key === 'tree' && err.status === 404 && S.treeId) {
            // 目录可能已被清理，回到磁盘根目录
            S.treeId = null;
            slot.again = true;
            slot.error = false;
          }
        },
      )
      .finally(() => {
        slot.inflight = null;
        src.render();
        if (slot.again) {
          slot.again = false;
          load(key);
        }
      });
    return slot.inflight;
  }

  const loadTimers = {};
  function scheduleLoad(key) {
    clearTimeout(loadTimers[key]);
    loadTimers[key] = setTimeout(() => load(key), 300);
  }

  /** 当前标签页需要的数据源 */
  function currentNeeds() {
    if (S.tab === 'junk') return ['junk'];
    if (S.tab === 'large') return [S.largeView === 'large' ? 'large' : 'dup'];
    if (S.tab === 'repos') return ['repos'];
    return [S.mapView === 'dirs' ? 'tree' : 'types', ...(S.mapView === 'types' && !slots.tree.data ? ['tree'] : [])];
  }

  function refreshCurrent() {
    currentNeeds().forEach((k) => load(k));
  }

  /** 用接口返回的 selected 字段同步本地勾选状态（正在提交的条目除外） */
  function syncSel(items) {
    for (const it of items) {
      if (!it || !it.id || S.selPending.has(it.id)) continue;
      if (it.selected) S.sel.add(it.id);
      else S.sel.delete(it.id);
    }
  }

  function afterLoad(key, data) {
    if (!data) return;
    if (key === 'junk') {
      const all = [];
      (data.tiers || []).forEach((t) =>
        (t.categories || []).forEach((c) => {
          all.push(...(c.items || []));
          if (S.junkQuery.q && (c.items || []).length) S.expanded.add(c.id);
        }),
      );
      syncSel(all);
    } else if (key === 'large') {
      syncSel(data.items || []);
    } else if (key === 'dup') {
      const all = [];
      (data.groups || []).forEach((g) => all.push(...(g.files || [])));
      syncSel(all);
    } else if (key === 'repos') {
      const ids = new Set((data.repos || []).map((r) => r.id));
      Array.from(S.reposExpanded).forEach((id) => {
        if (!ids.has(id) && !S.reposQuery.q) S.reposExpanded.delete(id);
      });
    } else if (key === 'tree') {
      syncSel((data.node && data.node.children) || []);
      if (data.rootId && stateRoots().some((r) => r.id === data.rootId)) S.mapRootId = data.rootId;
      if (data.diskId && S.mapDiskChosen && data.diskId !== S.mapDiskChosen) S.mapDiskChosen = data.diskId;
    }
  }

  /* ---------- 平台文案 ---------- */

  function labels() {
    const st = S.state;
    if (st && st.labels && st.labels.trash) return st.labels;
    if (st && st.platform === 'win32') return { trash: '回收站', fileManager: '资源管理器' };
    if (!st && /Windows/i.test(navigator.userAgent || '')) return { trash: '回收站', fileManager: '资源管理器' };
    return { trash: '废纸篓', fileManager: '访达' };
  }

  function isUnsupported() {
    return !!(S.state && S.state.platform === 'unsupported');
  }

  function scanStatus() {
    return (S.state && S.state.scan && S.state.scan.status) || 'idle';
  }

  function isScanning() {
    return scanStatus() === 'running';
  }

  function neverScanned() {
    return !!S.state && !S.state.lastScanAt && scanStatus() === 'idle';
  }

  function scannedDiskIds() {
    const st = S.state;
    if (!st) return [];
    const ids = (st.scan && st.scan.diskIds) || [];
    if (ids.length) return ids;
    const paths = (st.scan && st.scan.paths) || [];
    if (paths.length) return [];
    if (st.lastScanAt) return (st.disks || []).filter((d) => d.defaultScan).map((d) => d.id);
    return [];
  }

  function stateRoots() {
    return (S.state && Array.isArray(S.state.roots) && S.state.roots) || [];
  }

  /** 空间地图当前的扫描根：用户选的，或第一个 */
  function currentRootId() {
    const roots = stateRoots();
    if (!roots.length) return '';
    if (S.mapRootId && roots.some((r) => r.id === S.mapRootId)) return S.mapRootId;
    return roots[0].id;
  }

  function currentMapDiskId() {
    if (slots.tree.data && slots.tree.data.diskId) return slots.tree.data.diskId;
    if (S.mapDiskChosen) return S.mapDiskChosen;
    return scannedDiskIds()[0] || '';
  }

  /* ---------- 提示 ---------- */

  let toastTimer = 0;
  let errorTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.hidden = true;
    }, 4000);
  }

  function toastError(msg) {
    const el = $('#toastError');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(errorTimer);
    errorTimer = setTimeout(() => {
      el.hidden = true;
    }, 7000);
  }

  /** 重新渲染容器，并尽量把焦点还给同一个控件 */
  function renderInto(container, html) {
    const active = document.activeElement;
    const fk = active && container.contains(active) ? active.getAttribute('data-fk') : null;
    const hadFocus = active && container.contains(active);
    container.innerHTML = html;
    if (itemMenuTrigger && !document.contains(itemMenuTrigger)) closeItemMenu(false);
    $$('[data-indeterminate="true"]', container).forEach((el) => {
      el.indeterminate = true;
    });
    if (fk) {
      const target = container.querySelector(`[data-fk="${cssEscape(fk)}"]`);
      if (target) {
        target.focus({ preventScroll: true });
        return;
      }
    }
    if (hadFocus) {
      const fallback = container.hasAttribute('tabindex') ? container : container.closest('[role="tabpanel"]');
      if (fallback) fallback.focus({ preventScroll: true });
    }
  }

  /* ---------- 页头、磁盘、进度 ---------- */

  function renderTop() {
    const st = S.state;
    $('#subtitle').textContent = '扫描磁盘里的垃圾文件，确认后直接删除';
    const stats = st && st.stats;
    const statsLine = $('#statsLine');
    if (stats && (stats.cleanCount || 0) > 0) {
      statsLine.textContent = `累计释放 ${fmtBytes(stats.totalFreedBytes)}，共清理 ${fmtCount(stats.cleanCount)} 次`;
      statsLine.hidden = false;
    } else {
      statsLine.hidden = true;
    }

    renderScope();
    updateScanButton();
    renderDisks();
    renderScanStatus();
    renderSelBar();
    updateLiveHints();
  }

  function renderDisks() {
    const st = S.state;
    const list = $('#diskList');
    const note = $('#unscannedNote');
    if (!st) {
      list.innerHTML = '';
      note.hidden = true;
      return;
    }
    const scanned = scannedDiskIds();
    const hasScan = !!st.lastScanAt || isScanning() || scanStatus() !== 'idle';
    const unscanned = (st.unscanned && st.unscanned.bytes) || 0;
    const deniedCount = (st.unscanned && st.unscanned.deniedDirCount) || 0;
    const single = scanned.length === 1 ? scanned[0] : null;
    /** 每个磁盘的未扫描大小；旧版 Node 没有 unscannedBytes 时，只在单盘情况下用合计 */
    const unscannedOf = (d) => {
      if (typeof d.unscannedBytes === 'number') return d.unscannedBytes;
      return d.id === single ? unscanned : null;
    };

    list.innerHTML = (st.disks || [])
      .map((d) => {
        const total = d.totalBytes || 0;
        const used = Math.min(d.usedBytes || 0, total || Infinity);
        const free = d.freeBytes || 0;
        const w = (v) => (total > 0 ? Math.max(0, Math.min(100, (v / total) * 100)) : 0);
        let segs;
        let legend;
        let aria;
        const diskUn = hasScan && scanned.includes(d.id) ? unscannedOf(d) : null;
        if (diskUn !== null) {
          const un = Math.min(diskUn, used);
          const done = Math.max(0, used - un);
          segs =
            `<span class="cap-seg cap-scanned" style="width:${w(done)}%"></span>` +
            `<span class="cap-seg cap-unscanned" style="width:${w(un)}%"></span>`;
          legend =
            `<span class="legend-item"><span class="legend-dot legend-scanned"></span>已扫描 ${fmtBytes(done)}</span>` +
            `<span class="legend-item"><span class="legend-dot legend-unscanned"></span>未扫描或无权限 ${fmtBytes(un)}</span>` +
            `<span class="legend-item"><span class="legend-dot legend-free"></span>可用 ${fmtBytes(free)}</span>`;
          aria = `${d.label}：已用 ${fmtBytes(used)}，其中已扫描 ${fmtBytes(done)}，未扫描或无权限 ${fmtBytes(un)}；可用 ${fmtBytes(free)}，共 ${fmtBytes(total)}`;
        } else {
          segs = `<span class="cap-seg cap-used" style="width:${w(used)}%"></span>`;
          legend = '';
          aria = `${d.label}：已用 ${fmtBytes(used)}，可用 ${fmtBytes(free)}，共 ${fmtBytes(total)}`;
        }
        const badges = [];
        if (!d.deletable || d.kind !== 'internal') badges.push('<span class="badge">只扫描，不可删除</span>');
        if (d.kind === 'network') badges.push('<span class="badge">网络盘</span>');
        else if (d.kind === 'external') badges.push('<span class="badge">外接盘</span>');
        const folderDisks = stateRoots().filter((r) => r.kind === 'folder').map((r) => r.diskId);
        if (hasScan && !scanned.includes(d.id) && folderDisks.includes(d.id)) badges.push('<span class="badge badge-info">扫描了其中的文件夹</span>');
        else if (hasScan && (scanned.length || folderDisks.length) && !scanned.includes(d.id)) badges.push('<span class="badge">未扫描</span>');
        return `<li class="disk">
          <div class="disk-head">
            <span class="disk-name">${esc(d.label)}</span>
            ${badges.join('')}
            <span class="disk-nums num">已用 <strong>${fmtBytes(used)}</strong> · 可用 <strong>${fmtBytes(free)}</strong> · 共 ${fmtBytes(total)}</span>
          </div>
          <div class="cap-bar" role="img" aria-label="${esc(aria)}">${segs}</div>
          ${legend ? `<div class="disk-legend">${legend}</div>` : ''}
        </li>`;
      })
      .join('');

    const parts = [];
    const perDisk = (st.disks || []).some((d) => typeof d.unscannedBytes === 'number');
    if (hasScan && scanned.length > 1 && unscanned > 0 && !perDisk) {
      parts.push(`<span>已扫描的磁盘里，未扫描或无权限的部分合计 <strong class="num">${fmtBytes(unscanned)}</strong></span>`);
    }
    if (deniedCount > 0) {
      let text = `${fmtCount(deniedCount)} 个目录没有读取权限`;
      if (st.platform === 'darwin' && st.fullDiskAccess === 'missing') text += '，开启完全磁盘访问后可以扫全';
      parts.push(`<span>${esc(text)}</span><button type="button" class="btn btn-ghost" data-act="open-denied" data-fk="open-denied">查看无权限的目录</button>`);
    }
    note.innerHTML = parts.join('');
    note.hidden = parts.length === 0;
  }

  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }

  function renderScanStatus() {
    const st = S.state;
    const box = $('#scanStatus');
    const phaseEl = $('#scanPhase');
    const spinner = $('#scanSpinner');
    const steps = $('#phaseSteps');
    const stats = $('#scanStats');
    const pathEl = $('#scanPath');
    if (!st) {
      box.hidden = true;
      return;
    }
    const scan = st.scan || {};
    const status = scan.status || 'idle';
    if (status === 'running') {
      box.hidden = false;
      spinner.hidden = false;
      const idx = PHASES.findIndex((p) => p.id === scan.phase);
      const phase = PHASES[idx];
      setText(phaseEl, phase ? `正在${phase.name}` : '正在扫描');
      steps.hidden = false;
      const stepsHtml = PHASES.map((p, i) => {
        const cls = i === idx ? 'is-current' : i < idx ? 'is-done' : '';
        return `<span class="${cls}">${i + 1}. ${p.name}</span>`;
      }).join('<span>·</span>');
      if (steps.innerHTML !== stepsHtml) steps.innerHTML = stepsHtml;
      const pr = scan.progress || {};
      stats.hidden = false;
      const statsHtml =
        `<span>已扫 <strong class="num">${fmtCount(pr.files)}</strong> 个文件</span>` +
        `<span>已统计 <strong class="num">${fmtBytes(pr.bytes)}</strong></span>` +
        `<span>速度 <strong class="num">${fmtCount(Math.round(pr.filesPerSec || 0))}</strong> 个文件/秒</span>`;
      if (stats.innerHTML !== statsHtml) stats.innerHTML = statsHtml;
      const cur = pr.currentPath || '';
      pathEl.hidden = !cur;
      setText(pathEl, cur ? `当前目录：${cur}` : '');
      pathEl.title = cur;
      return;
    }
    spinner.hidden = true;
    steps.hidden = true;
    stats.hidden = true;
    pathEl.hidden = true;
    let text = '';
    const at = st.lastScanAt || scan.finishedAt;
    if (status === 'cancelled') text = `扫描已取消，已得到的结果会保留${at ? `（上次完成扫描：${fmtDateTime(at)}）` : ''}`;
    else if (status === 'error') text = '扫描没有完成，请重新扫描';
    else if (at) text = `上次扫描：${fmtDateTime(at)}`;
    box.hidden = !text;
    setText(phaseEl, text);
  }

  function updateLiveHints() {
    const deep = isScanning() && S.state && S.state.scan.phase === 'deep';
    $$('[data-live-hint]').forEach((el) => {
      el.hidden = !deep;
    });
  }

  function renderSelBar() {
    const { count, bytes } = S.selSummary;
    $('#selText').innerHTML = `已选 <strong class="num">${fmtCount(count)}</strong> 项，可释放 <strong class="num">${fmtBytes(bytes)}</strong>`;
    const pieSel = $('#junkPieSel');
    if (pieSel) pieSel.textContent = `${fmtBytes(bytes)}（${fmtCount(count)} 项）`;
    const btn = $('#cleanBtn');
    btn.disabled = !(count > 0) || isUnsupported() || isScanning();
    if (isScanning()) btn.title = '扫描结束后才能清理';
    else btn.removeAttribute('title');
    const drawerClean = $('#drawerFoot [data-act="drawer-clean"]');
    if (drawerClean) {
      drawerClean.disabled = isScanning();
      if (isScanning()) drawerClean.title = '扫描结束后才能清理';
      else drawerClean.removeAttribute('title');
    }
  }

  function applySelSummary(sum) {
    if (!sum || typeof sum.count !== 'number') return;
    S.selSummary = { count: sum.count, bytes: Number(sum.bytes) || 0 };
    if (sum.count === 0) {
      Array.from(S.sel).forEach((id) => {
        if (!S.selPending.has(id)) S.sel.delete(id);
      });
    }
    renderSelBar();
    syncChecks();
  }

  /* ---------- 空状态 / 加载 / 错误 ---------- */

  function emptyHtml(text, icon) {
    return `<div class="empty">${icon || ICONS.disk}<p>${esc(text)}</p></div>`;
  }

  function loadingHtml(text) {
    return `<div class="loading-line" role="status"><span class="spinner" aria-hidden="true"></span>${esc(text || '正在读取…')}</div>`;
  }

  function errorHtml(text) {
    return `<div class="inline-error" role="alert"><span>${esc(text)}</span><button type="button" class="btn btn-secondary btn-sm" data-act="retry" data-fk="retry">重试</button></div>`;
  }

  function commonPanelState(slot, loadingText) {
    if (isUnsupported()) return emptyHtml('暂不支持此系统');
    if (S.stateError && !S.state) return errorHtml('无法连接磁盘透视服务，请稍后重试');
    if (!S.state) return loadingHtml('正在读取状态…');
    if (neverScanned()) return emptyHtml('先在上方选择扫描范围，再点开始扫描');
    if (slot && !slot.data && slot.error && isScanning()) return emptyHtml('扫描还在进行，结果出来后会显示在这里', ICONS.map);
    if (slot && !slot.data && slot.error) return errorHtml('没能读取扫描结果，请重试');
    if (slot && !slot.data) return loadingHtml(loadingText);
    return null;
  }

  /* ---------- 条目行（垃圾清理、大文件、重复文件、已选清单共用） ---------- */

  function badgesHtml(tags) {
    return (tags || [])
      .map((t) => TAG_BADGES[t])
      .filter(Boolean)
      .map((b) => `<span class="badge ${b.cls}">${esc(b.text)}</span>`)
      .join('');
  }

  function computingHtml(on) {
    return on ? '<small class="computing"><span class="spinner spinner-xs" aria-hidden="true"></span>统计中</small>' : '';
  }

  function itemRow(item, opts) {
    const o = opts || {};
    const selectable = o.selectable !== false;
    const id = item.id || '';
    const name = item.name || '';
    const path = item.path || '';
    const primary = name || path || '未命名条目';
    const lb = labels();
    let check = '<span class="check-cell" aria-hidden="true"></span>';
    if (selectable && id) {
      if (item.locked) {
        check = `<span class="check-cell"><input type="checkbox" class="checkbox" disabled aria-label="${esc(primary)}：已锁定，不能勾选"></span>`;
      } else {
        check = `<span class="check-cell"><input type="checkbox" class="checkbox" data-act="sel" data-id="${esc(id)}" data-fk="sel:${esc(id)}" aria-label="选择 ${esc(primary)}" ${S.sel.has(id) ? 'checked' : ''}></span>`;
      }
    }
    const meta = [];
    if (o.kind && item.kind && KIND_LABELS[item.kind]) meta.push(`<span class="badge">${esc(KIND_LABELS[item.kind])}</span>`);
    if (o.newest) meta.push('<span class="badge badge-info">最新的一份</span>');
    if (item.note) meta.push(`<span>${esc(item.note)}</span>`);
    else if (item.mtimeMs) meta.push(`<span>${esc(modifiedText(item.mtimeMs))}</span>`);
    const badges = badgesHtml(item.tags);
    if (badges) meta.push(badges);
    if (item.locked) {
      meta.push(`<span class="lock-reason">${ICONS.lock}<span>${esc(item.lockReason || '已锁定')}</span></span>`);
    }
    const nameHtml = name
      ? `<span class="item-name truncate">${esc(name)}</span>`
      : `<span class="item-name mono truncate" title="${esc(path)}">${esc(path)}</span>`;
    const pathHtml = name && path ? `<span class="item-path mono truncate" title="${esc(path)}">${esc(path)}</span>` : '';
    const size = item.sizeBytes || 0;
    const rel = item.releasableBytes;
    const relHtml =
      typeof rel === 'number' && rel < size * 0.95 ? `<small>实际可释放 ${fmtBytes(rel)}</small>` : '';
    void lb;
    const actions = itemActionsHtml({
      id,
      name: primary,
      path,
      isFile: !!o.isFile || item.kind === 'file' || item.entryKind === 'file',
      ignorable: selectable && !item.locked,
      rescan: false,
    });
    return `<li class="item${item.locked ? ' is-locked' : ''}">
      ${check}
      <div class="item-main">
        <div class="item-title">${nameHtml}</div>
        ${pathHtml}
        ${meta.length ? `<div class="item-meta">${meta.join('')}</div>` : ''}
      </div>
      <span class="item-size">${fmtBytes(size)}${computingHtml(item.computing)}${relHtml}</span>
      ${actions}
    </li>`;
  }

  /** 勾选状态变化后，同步页面上所有勾选框和分类三态 */
  function syncChecks() {
    $$('input[data-act="sel"]').forEach((el) => {
      el.checked = S.sel.has(el.getAttribute('data-id'));
    });
    $$('input[data-act="cat"]').forEach((el) => {
      const ids = S.catIds[el.getAttribute('data-cat')] || [];
      const n = ids.filter((id) => S.sel.has(id)).length;
      el.checked = ids.length > 0 && n === ids.length;
      el.indeterminate = n > 0 && n < ids.length;
    });
  }

  /* ---------- 条目操作：问 Agent + 更多菜单 ---------- */

  function itemActionsHtml(o) {
    const cls = o.cls || 'item-actions';
    if (!o.id) return `<div class="${cls}"></div>`;
    const id = esc(o.id);
    const name = esc(o.name || '');
    return `<div class="${cls}">
      <button type="button" class="btn btn-ghost" data-act="ask" data-id="${id}" data-name="${name}" data-path="${esc(o.path || '')}" data-fk="ask:${id}" aria-label="问 Agent：${name}">问 Agent</button>
      <button type="button" class="btn btn-icon btn-more" data-act="item-more" data-id="${id}" data-name="${name}" data-path="${esc(o.path || '')}" data-file="${o.isFile ? '1' : '0'}" data-ignorable="${o.ignorable ? '1' : '0'}" data-rescan="${o.rescan ? '1' : '0'}" data-fk="more:${id}" aria-haspopup="menu" aria-expanded="false" aria-label="更多操作：${name}">${ICONS.more}</button>
    </div>`;
  }

  let itemMenuTrigger = null;

  function openItemMenu(btn) {
    const menu = $('#itemMenu');
    if (itemMenuTrigger === btn && !menu.hidden) {
      closeItemMenu(true);
      return;
    }
    closeItemMenu(false);
    const lb = labels();
    const darwin = !!(S.state && S.state.platform === 'darwin');
    const items = [
      ['reveal', `在${lb.fileManager}中显示`],
      ['copy', '复制路径'],
    ];
    if (darwin && btn.getAttribute('data-file') === '1') items.push(['preview', '快速预览']);
    if (btn.getAttribute('data-rescan') === '1') items.push(['rescan', '重新扫描此目录']);
    if (btn.getAttribute('data-ignorable') === '1') items.push(['ignore', '忽略']);
    menu.innerHTML = items
      .map(([k, l]) => `<li role="none"><button type="button" role="menuitem" tabindex="-1" data-item-menu="${k}">${esc(l)}</button></li>`)
      .join('');
    menu.setAttribute('aria-label', `更多操作：${btn.getAttribute('data-name') || ''}`);
    menu.hidden = false;
    const r = btn.getBoundingClientRect();
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    const below = window.innerHeight - r.bottom;
    const top = below < h + 12 && r.top > h + 12 ? r.top - h - 6 : r.bottom + 6;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w));
    menu.style.top = `${Math.round(top)}px`;
    menu.style.left = `${Math.round(left)}px`;
    btn.setAttribute('aria-expanded', 'true');
    itemMenuTrigger = btn;
    const first = $('[role="menuitem"]', menu);
    if (first) first.focus();
  }

  function closeItemMenu(restore) {
    const menu = $('#itemMenu');
    const trigger = itemMenuTrigger;
    itemMenuTrigger = null;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    if (menu.hidden) return;
    menu.hidden = true;
    if (restore && trigger && document.contains(trigger)) trigger.focus();
  }

  function onItemMenuKey(e) {
    const items = $$('#itemMenu [role="menuitem"]');
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(i + 1) % items.length].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length].focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0].focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1].focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeItemMenu(true);
    } else if (e.key === 'Tab') {
      closeItemMenu(false);
    }
  }

  function onItemMenuChoose(key) {
    const btn = itemMenuTrigger;
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const name = btn.getAttribute('data-name') || '';
    const path = btn.getAttribute('data-path') || '';
    closeItemMenu(key !== 'ignore');
    if (key === 'reveal') reveal(id);
    else if (key === 'copy') copyPathFor(id, path, btn);
    else if (key === 'preview') previewItem(id);
    else if (key === 'rescan') rescanDir(id);
    else if (key === 'ignore') confirmIgnore(id, path || name, btn);
  }

  /** 写剪贴板：优先 Clipboard API，失败时用隐藏 textarea 加 execCommand('copy') */
  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {
      /* 改用下面的兜底方式 */
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.className = 'copy-buffer';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  async function copyPathFor(id, knownPath, trigger) {
    let path = knownPath;
    if (!path) {
      try {
        const d = await api(`api/item?id=${encodeURIComponent(id)}`);
        path = d && d.path;
      } catch (e) {
        path = '';
      }
    }
    if (!path) {
      toastError('没能读取这个条目的路径，请重新扫描后再试');
      return;
    }
    const ok = await copyText(path);
    if (trigger && document.contains(trigger)) trigger.focus({ preventScroll: true });
    if (ok) toast('已复制路径');
    else toastError('没能复制路径，请检查剪贴板权限');
  }

  async function previewItem(id) {
    try {
      await api('api/preview', { method: 'POST', body: { id } });
    } catch (e) {
      if (e.code === 'unsupported') toastError('当前系统不支持快速预览');
      else if (e.code === 'not_file') toastError('只有文件可以快速预览');
      else toastError('没能打开快速预览，文件可能已被移动或删除');
    }
  }

  /* ---------- 忽略名单 ---------- */

  function confirmIgnore(id, label, opener) {
    openModal({
      kind: 'ignore',
      compact: true,
      title: '忽略这一项',
      opener,
      body: `<p class="mono ignore-path" title="${esc(label)}">${esc(label)}</p>
        <p>以后扫描不再显示这一项，可以在「更多 → 忽略名单」里恢复。</p>`,
      foot: `<span class="foot-note"></span><button type="button" class="btn btn-secondary" data-modal="cancel">取消</button><button type="button" class="btn btn-primary" data-modal="confirm-ignore" data-id="${esc(id)}">忽略</button>`,
      focus: '[data-modal="confirm-ignore"]',
    });
  }

  async function doIgnore(id) {
    $$('#modalFoot button').forEach((b) => {
      b.disabled = true;
    });
    try {
      await api('api/ignore', { method: 'POST', body: { id } });
      S.sel.delete(id);
      closeModal();
      toast('已忽略。可以在「更多 → 忽略名单」里恢复');
      currentNeeds().forEach((k) => scheduleLoad(k));
    } catch (e) {
      const msg = e.code === 'not_ignorable' ? '锁定的条目和仅提示的条目不能忽略' : '没能忽略这一项，请稍后再试';
      updateModal({
        foot: `<span class="foot-note result-fail" role="alert">${esc(msg)}</span><button type="button" class="btn btn-secondary" data-modal="cancel">关闭</button>`,
        focus: '[data-modal="cancel"]',
      });
    }
  }

  async function openIgnoreList(opener) {
    openModal({ kind: 'ignore-list', title: '忽略名单', opener, body: loadingHtml('正在读取忽略名单…') });
    await renderIgnoreList();
  }

  async function renderIgnoreList(focusFk) {
    try {
      const d = await api('api/ignore');
      if (modalKind !== 'ignore-list') return;
      const entries = (d && d.entries) || [];
      const body = entries.length
        ? `<p class="muted">这些位置不会出现在垃圾清理、大文件和重复文件里，空间地图照常统计它们的大小。恢复后，下次扫描时会重新出现。</p>
          <ul class="denied-list ignore-list">${entries
            .map(
              (x) => `<li>
                <span class="item-main"><span class="mono truncate" title="${esc(x.path)}">${esc(x.path)}</span><span class="muted">${x.at ? `${esc(fmtDateTime(x.at))} 忽略` : ''}</span></span>
                <button type="button" class="btn btn-ghost" data-act="ignore-restore" data-id="${esc(x.id)}" data-fk="restore:${esc(x.id)}" aria-label="恢复：${esc(x.path)}">恢复</button>
              </li>`,
            )
            .join('')}</ul>`
        : '<div class="inline-note">忽略名单是空的</div>';
      updateModal({ body });
      if (focusFk !== undefined) {
        const t = focusFk ? $(`#modalBody [data-fk="${cssEscape(focusFk)}"]`) : null;
        (t || $('#modalClose')).focus();
      }
    } catch (e) {
      if (modalKind === 'ignore-list') updateModal({ body: '<div class="inline-error" role="alert">没能读取忽略名单，请稍后再试</div>' });
    }
  }

  async function restoreIgnored(id, btn) {
    const li = btn.closest('li');
    const sib = li && (li.nextElementSibling || li.previousElementSibling);
    const nextBtn = sib ? $('[data-act="ignore-restore"]', sib) : null;
    const nextFk = nextBtn ? nextBtn.getAttribute('data-fk') : null;
    btn.disabled = true;
    try {
      await api('api/ignore/remove', { method: 'POST', body: { id } });
      toast('已恢复，下次扫描时会重新出现');
      await renderIgnoreList(nextFk);
    } catch (e) {
      btn.disabled = false;
      toastError('没能恢复这一项，请稍后再试');
    }
  }

  /* ---------- 环形饼图（垃圾清理、文件类型共用） ---------- */

  /** 超过 6 项时，最大的 5 项各占一色，其余合并成「其他」（中性灰）。返回排序后的条目、扇区和每项的色号 */
  function pieSlices(entries) {
    const sorted = entries.filter((e) => e.bytes > 0).sort((a, b) => b.bytes - a.bytes);
    const colorOf = new Map();
    const sliceOf = new Map();
    let slices;
    if (sorted.length <= 6) {
      slices = sorted.map((e, i) => {
        colorOf.set(e.key, i);
        sliceOf.set(e.key, e.key);
        return { key: e.key, label: e.label, bytes: e.bytes, color: i, link: true };
      });
    } else {
      const head = sorted.slice(0, 5);
      const rest = sorted.slice(5);
      slices = head.map((e, i) => {
        colorOf.set(e.key, i);
        sliceOf.set(e.key, e.key);
        return { key: e.key, label: e.label, bytes: e.bytes, color: i, link: true };
      });
      rest.forEach((e) => {
        colorOf.set(e.key, -1);
        sliceOf.set(e.key, '__others');
      });
      slices.push({
        key: '__others',
        label: `其他（${rest.length} 项）`,
        bytes: rest.reduce((sum, e) => sum + e.bytes, 0),
        color: -1,
        link: false,
      });
    }
    const total = sorted.reduce((sum, e) => sum + e.bytes, 0);
    return { sorted, slices, colorOf, sliceOf, total };
  }

  /** 色号对应的图表变量；-1 是合并后的「其他」，用中性灰 */
  function chartVar(c) {
    return c < 0 ? 'var(--mcode-chart-rest)' : `var(--mcode-chart-${c + 1})`;
  }

  function ringPath(cx, cy, r0, r1, a0, a1In) {
    const a1 = a1In - a0 >= 359.99 ? a0 + 359.99 : a1In;
    const large = a1 - a0 > 180 ? 1 : 0;
    const pt = (r, deg) => {
      const rad = ((deg - 90) * Math.PI) / 180;
      return [(cx + r * Math.cos(rad)).toFixed(2), (cy + r * Math.sin(rad)).toFixed(2)];
    };
    const [x0, y0] = pt(r1, a0);
    const [x1, y1] = pt(r1, a1);
    const [x2, y2] = pt(r0, a1);
    const [x3, y3] = pt(r0, a0);
    return `M${x0} ${y0}A${r1} ${r1} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 ${large} 0 ${x3} ${y3}Z`;
  }

  function donutSvg(o) {
    const total = o.total;
    let a = 0;
    const paths = o.slices
      .map((sl) => {
        const span = total > 0 ? (sl.bytes / total) * 360 : 0;
        const a0 = a;
        a += span;
        if (span < 0.2) return '';
        const link = sl.link && o.linkAct;
        return `<path class="pie-sector${link ? ' is-link' : ''}" d="${ringPath(100, 100, 60, 92, a0, a0 + span)}" style="fill:${chartVar(sl.color)}" data-pie-key="${esc(sl.key)}"${link ? ` data-act="${o.linkAct}" data-cat="${esc(sl.key)}"` : ''}><title>${esc(`${sl.label}  ${fmtBytes(sl.bytes)}  ${pctText(sl.bytes, total)}`)}</title></path>`;
      })
      .join('');
    return `<svg class="pie" viewBox="0 0 200 200" role="img" aria-label="${esc(o.aria)}">
      ${paths}
      <text class="pie-center-label" x="100" y="92" text-anchor="middle">${esc(o.centerLabel)}</text>
      <text class="pie-center-value" x="100" y="115" text-anchor="middle">${esc(o.centerValue)}</text>
    </svg>`;
  }

  /** 垃圾清理页顶部的可释放空间饼图。info 档和大小为 0 的分类不画。 */
  function junkPieHtml(data) {
    const entries = [];
    (data.tiers || []).forEach((t) => {
      if (t.tier === 'info') return;
      (t.categories || []).forEach((c) => {
        const bytes = typeof c.releasableBytes === 'number' ? c.releasableBytes : c.totalBytes || 0;
        if (bytes > 0) entries.push({ key: c.id, label: c.name || CATEGORY_NAMES[c.id] || c.id, bytes });
      });
    });
    if (!entries.length) return '';
    const { sorted, slices, colorOf, sliceOf, total } = pieSlices(entries);
    const top = sorted
      .slice(0, 3)
      .map((e) => `${e.label} ${fmtBytes(e.bytes)}（${pctText(e.bytes, total)}）`)
      .join('，');
    const svg = donutSvg({
      slices,
      total,
      centerLabel: '可释放',
      centerValue: fmtBytes(total),
      aria: `可释放空间分布，合计 ${fmtBytes(total)}，共 ${sorted.length} 个分类。最大的分类：${top}。`,
      linkAct: 'goto-cat',
    });
    const legend = sorted
      .map((e) => {
        const pct = pctText(e.bytes, total);
        return `<li><button type="button" class="pie-legend-item" data-act="goto-cat" data-cat="${esc(e.key)}" data-pie-key="${esc(sliceOf.get(e.key))}" data-fk="pie:${esc(e.key)}" aria-label="${esc(`${e.label}，${fmtBytes(e.bytes)}，占 ${pct}，跳到这个分类`)}">
          <span class="legend-dot" style="background:${chartVar(colorOf.get(e.key))}" aria-hidden="true"></span>
          <span class="pie-legend-name truncate">${esc(e.label)}</span>
          <span class="num">${fmtBytes(e.bytes)}</span>
          <span class="pie-legend-pct num">${pct}</span>
        </button></li>`;
      })
      .join('');
    const sel = S.selSummary;
    return `<section class="pie-card" aria-labelledby="junkPieTitle">
      <div class="pie-head">
        <h2 id="junkPieTitle">可释放空间</h2>
        <p class="pie-summary">合计 <strong class="num">${fmtBytes(total)}</strong><span class="pie-sep" aria-hidden="true">·</span>已选 <strong class="num" id="junkPieSel">${fmtBytes(sel.bytes)}（${fmtCount(sel.count)} 项）</strong></p>
      </div>
      <div class="pie-layout">
        <div class="pie-figure">${svg}</div>
        <ul class="pie-legend" aria-label="分类图例，点击跳到对应分类">${legend}</ul>
      </div>
      <p class="pie-note">按可释放大小统计，不含「仅提示」。点扇区或分类名，跳到对应分类。</p>
    </section>`;
  }

  /** 空间地图「文件类型」饼图 */
  function typesPieHtml(types) {
    const entries = types.map((t) => ({ key: t.kind, label: t.label || KIND_LABELS[t.kind] || t.kind, bytes: t.bytes || 0, count: t.count || 0 }));
    const { sorted, slices, colorOf, sliceOf, total } = pieSlices(entries);
    if (!sorted.length) return '<div class="inline-note">没有统计数据</div>';
    const top = sorted
      .slice(0, 3)
      .map((e) => `${e.label} ${fmtBytes(e.bytes)}（${pctText(e.bytes, total)}）`)
      .join('，');
    const svg = donutSvg({
      slices,
      total,
      centerLabel: '合计',
      centerValue: fmtBytes(total),
      aria: `按文件类型统计，合计 ${fmtBytes(total)}。最大的类型：${top}。`,
    });
    const legend = sorted
      .map(
        (e) => `<li class="pie-legend-item is-static" data-pie-key="${esc(sliceOf.get(e.key))}">
          <span class="legend-dot" style="background:${chartVar(colorOf.get(e.key))}" aria-hidden="true"></span>
          <span class="pie-legend-name truncate">${esc(e.label)}</span>
          <span class="num">${fmtBytes(e.bytes)}</span>
          <span class="pie-legend-pct num">${pctText(e.bytes, total)}</span>
          <span class="pie-legend-count num">${fmtCount(e.count)} 个文件</span>
        </li>`,
      )
      .join('');
    return `<div class="pie-card pie-card-flat">
      <div class="pie-layout">
        <div class="pie-figure">${svg}</div>
        <ul class="pie-legend" aria-label="文件类型图例">${legend}</ul>
      </div>
      ${sorted.length > 6 ? '<p class="pie-note">饼图里最小的几类合并为「其他」，图例列出全部类型。</p>' : ''}
    </div>`;
  }

  function setPieHot(card, key) {
    if (!card) return;
    card.classList.toggle('has-hot', !!key);
    $$('[data-pie-key]', card).forEach((el) => {
      el.classList.toggle('is-hot', !!key && el.getAttribute('data-pie-key') === key);
    });
  }

  /** 搜索框和排序选择。放在不重绘的区域，避免打断输入法 */
  function queryOf(scope) {
    if (scope === 'junk') return S.junkQuery;
    if (scope === 'large') return S.largeFilter;
    if (scope === 'repos') return S.reposQuery;
    return S.mapQuery;
  }

  function searchToolsHtml(scope, label, placeholder, options) {
    const st = queryOf(scope);
    return `<div class="search-box">${ICONS.search}<input type="search" class="search-input" data-search="${scope}" value="${esc(st.q)}" placeholder="${esc(placeholder)}" aria-label="${esc(label)}" autocomplete="off" spellcheck="false"></div>
      <label class="field">排序<select class="select" data-sort="${scope}">${(options || SORT_OPTIONS).map(
        ([v, l]) => `<option value="${v}" ${st.sort === v ? 'selected' : ''}>${esc(l)}</option>`,
      ).join('')}</select></label>
      <span class="search-status" data-search-status="${scope}" role="status"></span>`;
  }

  function setSearchStatus(scope, text) {
    const el = $(`[data-search-status="${scope}"]`);
    if (el && el.textContent !== text) el.textContent = text;
  }

  function noMatchHtml(scope) {
    return `<div class="empty">${ICONS.search}<p>没有找到匹配的条目</p><button type="button" class="btn btn-secondary" data-act="clear-search" data-scope="${scope}" data-fk="clear-search:${scope}">清除搜索</button></div>`;
  }

  /* ---------- 勾选 ---------- */

  let selChain = Promise.resolve();

  /**
   * 按分类整类勾选或取消：调用 addCategories / removeCategories，不受每类 300 条的限制。
   * 已返回条目先按预期更新，接口返回后以合计为准，并重新拉取垃圾清理结果核对勾选状态。
   */
  function setCategorySelected(catId, on) {
    const ids = S.catIds[catId] || [];
    const prev = ids.map((id) => [id, S.sel.has(id)]);
    ids.forEach((id) => {
      if (on) S.sel.add(id);
      else S.sel.delete(id);
      S.selPending.set(id, (S.selPending.get(id) || 0) + 1);
    });
    syncChecks();
    selChain = selChain.then(async () => {
      try {
        const res = await api('api/selection', {
          method: 'POST',
          body: on ? { addCategories: [catId] } : { removeCategories: [catId] },
        });
        applySelSummary(res);
      } catch (e) {
        prev.forEach(([id, was]) => (was ? S.sel.add(id) : S.sel.delete(id)));
        toastError(e.code === 'invalid_category' ? '这个分类不能整类勾选' : '没能更新已选清单，请重试');
      } finally {
        ids.forEach((id) => {
          const n = (S.selPending.get(id) || 1) - 1;
          if (n <= 0) S.selPending.delete(id);
          else S.selPending.set(id, n);
        });
        syncChecks();
        scheduleLoad('junk');
      }
    });
    return selChain;
  }

  function setSelected(ids, on) {
    const list = ids.filter(Boolean);
    if (!list.length) return selChain;
    const prev = list.map((id) => [id, S.sel.has(id)]);
    list.forEach((id) => {
      if (on) S.sel.add(id);
      else S.sel.delete(id);
      S.selPending.set(id, (S.selPending.get(id) || 0) + 1);
    });
    syncChecks();
    selChain = selChain.then(async () => {
      try {
        const res = await api('api/selection', { method: 'POST', body: on ? { add: list } : { remove: list } });
        const skipped = res && Array.isArray(res.skipped) ? res.skipped : [];
        const skippedIds = new Set(skipped.map((s) => s.id));
        list.forEach((id) => {
          if (on && !skippedIds.has(id)) S.sel.add(id);
          else S.sel.delete(id);
        });
        const notClean = skipped.filter((s) => s.reason === 'worktree_not_clean').length;
        if (notClean) {
          toastError('这个 worktree 有未提交的改动或未推送的提交，先提交或推送再清理');
          refreshOpenWorktrees();
        } else if (skipped.length) {
          const locked = skipped.filter((s) => s.reason === 'locked').length;
          toastError(
            locked === skipped.length
              ? `${skipped.length} 项已锁定，没有加入已选清单`
              : `${skipped.length} 项没有加入已选清单，扫描结果可能已变化，请重新扫描`,
          );
        }
        applySelSummary(res);
      } catch (e) {
        prev.forEach(([id, was]) => (was ? S.sel.add(id) : S.sel.delete(id)));
        toastError('没能更新已选清单，请重试');
      } finally {
        list.forEach((id) => {
          const n = (S.selPending.get(id) || 1) - 1;
          if (n <= 0) S.selPending.delete(id);
          else S.selPending.set(id, n);
        });
        syncChecks();
      }
    });
    return selChain;
  }

  /* ---------- 垃圾清理 ---------- */

  function renderJunk() {
    const panel = $('#panel-junk');
    if (!$('#junkBody', panel)) {
      panel.innerHTML = `<div id="junkPie"></div><div class="list-tools" id="junkTools" hidden>${searchToolsHtml('junk', '搜索垃圾清理条目', '搜索名称或路径')}</div><div id="junkBody"></div>`;
    }
    const tools = $('#junkTools');
    const pieBox = $('#junkPie');
    const bodyEl = $('#junkBody');
    const slot = slots.junk;
    const state = commonPanelState(slot, '正在读取垃圾清理结果…');
    if (state) {
      tools.hidden = true;
      renderInto(pieBox, '');
      renderInto(bodyEl, state);
      return;
    }
    tools.hidden = false;
    const q = S.junkQuery.q;
    const data = slot.data;
    const byTier = {};
    (data.tiers || []).forEach((t) => {
      byTier[t.tier] = t.categories || [];
    });
    const visible = (c) => (c.itemCount || 0) > 0 || (c.totalBytes || 0) > 0;
    const matched = TIERS.reduce(
      (n, t) => n + (byTier[t.id] || []).filter(visible).reduce((m, c) => m + (c.itemCount || 0), 0),
      0,
    );
    if (q && matched === 0) {
      setSearchStatus('junk', '没有匹配的条目');
      renderInto(pieBox, '');
      renderInto(bodyEl, noMatchHtml('junk'));
      return;
    }
    setSearchStatus('junk', q ? `匹配 ${fmtCount(matched)} 项` : '');
    renderInto(pieBox, q ? '' : junkPieHtml(data));
    S.catIds = {};
    const html = TIERS.filter((tier) => !q || (byTier[tier.id] || []).some(visible)).map((tier) => {
      const cats = (byTier[tier.id] || []).filter(visible);
      const total = cats.reduce((s, c) => s + (c.totalBytes || 0), 0);
      const headingId = `tier-${tier.id}`;
      const body = cats.length
        ? `<ul class="cat-list">${cats.map((c) => catBlock(c, tier.id)).join('')}</ul>`
        : `<div class="inline-note">${isScanning() ? '还没有发现，扫描结束前会继续增加' : '没有发现这类文件'}</div>`;
      return `<section class="tier" aria-labelledby="${headingId}">
        <div class="tier-head">
          <h2 id="${headingId}">${esc(tier.title)}</h2>
          <span class="tier-desc">${esc(tier.desc)}</span>
          <span class="hint-live" data-live-hint hidden><span class="spinner" aria-hidden="true"></span>深度扫描中，结果会继续增加</span>
          ${cats.length ? `<span class="tier-total num">合计 ${fmtBytes(total)}</span>` : ''}
        </div>
        ${body}
      </section>`;
    }).join('');
    renderInto(bodyEl, `<div class="tiers">${html}</div>`);
    updateLiveHints();
    syncChecks();
  }

  /** 点饼图扇区或图例：展开并滚动到对应分类 */
  function gotoCategory(catId) {
    if (!catId || catId === '__others') return;
    S.expanded.add(catId);
    renderJunk();
    const li = document.getElementById(`cat-${catId}`);
    if (!li) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    li.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    const focusEl = li.querySelector('.cat-row .expand-btn') || li.querySelector('.cat-row button, .cat-row input:not(:disabled)');
    if (focusEl) focusEl.focus({ preventScroll: true });
  }

  function catBlock(cat, tierId) {
    const items = cat.items || [];
    const isInfo = tierId === 'info' || cat.selectable === false;
    const isDupCat = cat.id === 'duplicates';
    const selectableIds = isInfo ? [] : items.filter((i) => i.id && !i.locked).map((i) => i.id);
    S.catIds[cat.id] = selectableIds;
    const name = cat.name || CATEGORY_NAMES[cat.id] || cat.id;
    const truncatedList = !isDupCat && (cat.itemCount || 0) > items.length && items.length > 0;
    const q = S.junkQuery.q;
    let check = '<span class="check-cell" aria-hidden="true"></span>';
    if (!isInfo && !isDupCat && items.length) {
      if (selectableIds.length) {
        const n = selectableIds.filter((id) => S.sel.has(id)).length;
        const all = n === selectableIds.length;
        const allLabel = q
          ? `选择 ${name} 里列出的 ${fmtCount(selectableIds.length)} 个匹配项`
          : truncatedList
            ? `全选 ${name}（共 ${fmtCount(cat.itemCount)} 项）`
            : `全选 ${name}`;
        check = `<span class="check-cell"><input type="checkbox" class="checkbox" data-act="cat" data-cat="${esc(cat.id)}" data-fk="cat:${esc(cat.id)}" aria-label="${esc(allLabel)}" ${all ? 'checked' : ''} ${n > 0 && !all ? 'data-indeterminate="true"' : ''}></span>`;
      } else {
        check = `<span class="check-cell"><input type="checkbox" class="checkbox" disabled aria-label="${esc(name)}：条目都已锁定"></span>`;
      }
    }
    const expanded = S.expanded.has(cat.id);
    const listId = `cat-items-${cat.id}`;
    const controls = [];
    if (cat.action && cat.action.id) {
      controls.push(
        `<button type="button" class="btn btn-secondary btn-sm" data-act="sysaction" data-action="${esc(cat.action.id)}" data-fk="act:${esc(cat.id)}">${esc(cat.action.label || '打开系统设置')}</button>`,
      );
    }
    if (isDupCat) {
      controls.push(
        `<button type="button" class="btn btn-secondary btn-sm" data-act="goto-dup" data-fk="goto-dup">查看重复文件</button>`,
      );
    } else if (items.length) {
      controls.push(
        `<button type="button" class="btn btn-icon expand-btn" data-act="expand" data-cat="${esc(cat.id)}" data-fk="exp:${esc(cat.id)}" aria-expanded="${expanded}" aria-controls="${listId}" aria-label="${expanded ? '收起' : '展开'} ${esc(name)}">${ICONS.chevron}</button>`,
      );
    }
    const total = cat.totalBytes || 0;
    const rel = cat.releasableBytes;
    const relHtml = typeof rel === 'number' && rel < total * 0.95 ? `<small>实际可释放 ${fmtBytes(rel)}</small>` : '';
    const countText =
      q && typeof cat.matchedFrom === 'number'
        ? ` · 匹配 ${fmtCount(cat.itemCount)} 项（共 ${fmtCount(cat.matchedFrom)} 项）`
        : truncatedList
          ? ` · 共 ${fmtCount(cat.itemCount)} 项，列表只显示前 ${fmtCount(items.length)} 项`
          : cat.itemCount
            ? ` · ${fmtCount(cat.itemCount)} 项`
            : '';
    let inner = '';
    if (expanded && items.length && !isDupCat) {
      const more =
        (cat.itemCount || 0) > items.length
          ? q
            ? `<p class="cat-more">列表只显示前 ${fmtCount(items.length)} 项，共匹配 ${fmtCount(cat.itemCount)} 项。搜索时勾选分类，只选中列表里显示的条目</p>`
            : `<p class="cat-more">列表只显示最大的 ${fmtCount(items.length)} 项，共 ${fmtCount(cat.itemCount)} 项。勾选上方的分类会选中全部 ${fmtCount(cat.itemCount)} 项</p>`
          : '';
      inner = `<div class="cat-items" id="${listId}"><ul class="item-list">${items
        .map((it) => itemRow(it, { selectable: !isInfo }))
        .join('')}</ul>${more}</div>`;
    }
    return `<li class="cat" id="cat-${esc(cat.id)}">
      <div class="cat-row">
        ${check}
        <div class="item-main">
          <span class="cat-name">${esc(name)}</span>
          <span class="cat-effect">${esc(cat.effect || '')}${esc(countText)}</span>
        </div>
        <span class="cat-size num">${fmtBytes(total)}${computingHtml(cat.computing)}${relHtml}</span>
        <div class="item-actions">${controls.join('')}</div>
      </div>
      ${inner}
    </li>`;
  }

  /* ---------- 大文件与重复文件 ---------- */

  function renderLarge() {
    const panel = $('#panel-large');
    if (!$('#largeBody', panel)) {
      panel.innerHTML = `<div id="largeTop"></div><div class="list-tools" id="largeTools" hidden>${searchToolsHtml('large', '搜索大文件', '搜索名称或路径')}</div><div id="largeBody"></div>`;
    }
    const topEl = $('#largeTop');
    const toolsEl = $('#largeTools');
    const bodyEl = $('#largeBody');
    const key = S.largeView === 'large' ? 'large' : 'dup';
    const slot = slots[key];
    const base = commonPanelState(null);
    if (base) {
      renderInto(topEl, '');
      toolsEl.hidden = true;
      renderInto(bodyEl, base);
      return;
    }
    toolsEl.hidden = key !== 'large';
    const seg = `<div class="segmented" role="group" aria-label="切换大文件和重复文件">
      <button type="button" data-act="largeview" data-v="large" data-fk="lv:large" aria-pressed="${S.largeView === 'large'}">大文件</button>
      <button type="button" data-act="largeview" data-v="dup" data-fk="lv:dup" aria-pressed="${S.largeView === 'dup'}">重复文件</button>
    </div>`;
    let tools = '';
    let body = '';
    if (key === 'large') {
      const kindSel = KIND_OPTIONS.map(
        ([v, l]) => `<option value="${esc(v)}" ${S.largeFilter.kind === v ? 'selected' : ''}>${esc(l)}</option>`,
      ).join('');
      const ageSel = AGE_OPTIONS.map(
        ([v, l]) => `<option value="${esc(v)}" ${S.largeFilter.minAgeDays === v ? 'selected' : ''}>${esc(l)}</option>`,
      ).join('');
      tools = `<label class="field">类型<select class="select" data-act="filter-kind" data-fk="filter-kind">${kindSel}</select></label>
        <label class="field">最后修改<select class="select" data-act="filter-age" data-fk="filter-age">${ageSel}</select></label>`;
      if (!slot.data && slot.error) body = errorHtml('没能读取大文件列表，请重试');
      else if (!slot.data) body = loadingHtml('正在读取大文件…');
      else {
        const items = slot.data.items || [];
        const total = slot.data.total || items.length;
        const q = S.largeFilter.q;
        setSearchStatus('large', q ? `匹配 ${fmtCount(total)} 个` : '');
        if (!items.length && q) {
          body = noMatchHtml('large');
        } else if (!items.length) {
          body = `<div class="inline-note">${isScanning() ? '还没有找到符合条件的大文件，扫描结束前会继续增加' : '没有符合条件的大文件'}</div>`;
        } else {
          const head = q ? `匹配 ${fmtCount(total)} 个大文件` : `共 ${fmtCount(total)} 个大文件（单个 ≥ 500 MB）`;
          body = `<p class="list-summary">${head}${total > items.length ? `，只列出前 ${fmtCount(items.length)} 个` : ''}</p>
            <ul class="list-card item-list">${items.map((it) => itemRow(it, { kind: true, isFile: true })).join('')}</ul>`;
        }
      }
    } else {
      const d = slot.data;
      const groups = (d && d.groups) || [];
      tools = `<button type="button" class="btn btn-secondary" data-act="keep-newest" data-fk="keep-newest" ${groups.length ? '' : 'disabled'}>每组只保留最新的一份</button>`;
      if (!d && slot.error) body = errorHtml('没能读取重复文件，请重试');
      else if (!d) body = loadingHtml('正在读取重复文件…');
      else {
        const notes = [];
        if (d.status === 'running' || (d.status === 'pending' && isScanning())) {
          notes.push(`<div class="inline-note" role="status"><span class="spinner" aria-hidden="true"></span>正在比对重复文件</div>`);
        } else if (d.status === 'pending') {
          notes.push('<div class="inline-note">这次扫描还没有比对重复文件，重新扫描后会比对</div>');
        }
        if (groups.length) {
          notes.push(
            `<p class="list-summary">${fmtCount(groups.length)} 组重复文件，每组保留一份可释放 <strong class="num">${fmtBytes(d.wastedBytes)}</strong>。默认不勾选。</p>`,
          );
          const groupsHtml = groups
            .map((g, gi) => {
              const files = g.files || [];
              let newestIdx = -1;
              files.forEach((f, i) => {
                if (newestIdx < 0 || (f.mtimeMs || 0) > (files[newestIdx].mtimeMs || 0)) newestIdx = i;
              });
              const hid = `dup-${gi}`;
              return `<section class="list-card" aria-labelledby="${hid}">
                <div class="dup-head"><h3 id="${hid}">${fmtCount(files.length)} 个相同文件，每份 ${fmtBytes(g.sizeBytes)}</h3></div>
                <ul class="item-list">${files.map((f, i) => itemRow(f, { newest: i === newestIdx, isFile: true })).join('')}</ul>
              </section>`;
            })
            .join('');
          notes.push(`<div class="dup-groups">${groupsHtml}</div>`);
        } else if (d.status === 'done') {
          notes.push('<div class="inline-note">没有发现重复文件</div>');
        }
        body = notes.join('');
      }
    }
    renderInto(topEl, `<div class="toolbar">${seg}<span class="spacer"></span>${tools}</div>`);
    renderInto(bodyEl, `<div aria-busy="${slot.inflight ? 'true' : 'false'}">${body}</div>`);
    syncChecks();
  }

  /* ---------- 空间地图 ---------- */

  const R = [62, 102, 132, 156, 176];
  const C = 180;
  const DEPTH_OPACITY = [1, 0.72, 0.52, 0.36];

  function polar(r, deg) {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [C + r * Math.cos(rad), C + r * Math.sin(rad)];
  }

  function arcPath(r0, r1, a0, a1In) {
    const a1 = a1In - a0 >= 359.99 ? a0 + 359.99 : a1In;
    const large = a1 - a0 > 180 ? 1 : 0;
    const f = (n) => n.toFixed(2);
    const [x0, y0] = polar(r1, a0);
    const [x1, y1] = polar(r1, a1);
    const [x2, y2] = polar(r0, a1);
    const [x3, y3] = polar(r0, a0);
    return `M${f(x0)} ${f(y0)}A${r1} ${r1} 0 ${large} 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${r0} ${r0} 0 ${large} 0 ${f(x3)} ${f(y3)}Z`;
  }

  function fillFor(kind, colorIdx, depth) {
    if (kind === 'denied') return 'fill:url(#hatch)';
    if (kind === 'others') return `fill:var(--mcode-chart-others);fill-opacity:${DEPTH_OPACITY[depth - 1]}`;
    if (kind === 'file') return `fill:var(--mcode-chart-file);fill-opacity:${DEPTH_OPACITY[depth - 1]}`;
    return `fill:var(--mcode-chart-${colorIdx + 1});fill-opacity:${DEPTH_OPACITY[depth - 1]}`;
  }

  function swatchStyle(kind, colorIdx) {
    if (kind === 'denied') return '';
    if (kind === 'others') return 'background:var(--mcode-chart-others)';
    if (kind === 'file') return 'background:var(--mcode-chart-file)';
    return `background:var(--mcode-chart-${colorIdx + 1})`;
  }

  /** 第一圈目录轮流取色，返回每个子项的色号 */
  function topColors(children) {
    let n = 0;
    return children.map((c) => (c.kind === 'dir' ? n++ % 6 : -1));
  }

  function buildSunburst(tree) {
    const node = tree.node;
    const crumbs = tree.breadcrumbs || [];
    const children = node.children || [];
    const colors = topColors(children);
    const sectors = [];
    function walk(parent, a0, a1, depth, top, ci) {
      const kids = parent.children || [];
      if (!kids.length) return;
      const sum = kids.reduce((s, k) => s + (k.sizeBytes || 0), 0);
      const total = Math.max(parent.sizeBytes || 0, sum);
      if (total <= 0) return;
      let a = a0;
      kids.forEach((k, i) => {
        const span = ((a1 - a0) * (k.sizeBytes || 0)) / total;
        const t = depth === 1 ? i : top;
        const c = depth === 1 ? colors[i] : ci;
        if (span >= 0.5) {
          sectors.push({ k, depth, a0: a, a1: a + span, top: t, ci: c < 0 ? 0 : c });
          if (depth < 4 && k.kind === 'dir') walk(k, a, a + span, depth + 1, t, c < 0 ? 0 : c);
        }
        a += span;
      });
    }
    walk(node, 0, 360, 1, 0, 0);

    const paths = sectors
      .map((s, i) => {
        const link = s.k.kind === 'dir' && s.k.id;
        const title = `${s.k.name || ''}  ${fmtBytes(s.k.sizeBytes)}`;
        return `<path class="sector${link ? ' is-link' : ''}" d="${arcPath(R[s.depth - 1], R[s.depth], s.a0, s.a1)}" style="${fillFor(s.k.kind, s.ci, s.depth)}" data-top="${s.top}" data-sid="${i}"${link ? ` data-enter="${esc(s.k.id)}"` : ''} data-name="${esc(s.k.name || '')}" data-size="${esc(fmtBytes(s.k.sizeBytes))}"><title>${esc(title)}</title></path>`;
      })
      .join('');
    const canUp = crumbs.length > 1;
    const top5 = children
      .filter((c) => c.kind !== 'others')
      .slice(0, 5)
      .map((c) => `${c.name} ${fmtBytes(c.sizeBytes)}`)
      .join('，');
    const aria = `空间分布图。当前目录 ${node.name}，共 ${fmtBytes(node.sizeBytes)}。${top5 ? `最大的子项：${top5}。` : '没有子项。'}`;
    const shortName = truncateMiddle(node.name || '', 14);
    return `<svg class="sunburst" id="sunburst" viewBox="0 0 360 360" role="img" aria-label="${esc(aria)}">
      ${paths}
      <circle class="center${canUp ? ' is-link' : ''}" cx="${C}" cy="${C}" r="${R[0] - 3}" ${canUp ? 'data-up="1"' : ''}><title>${canUp ? '返回上一层' : esc(node.name || '')}</title></circle>
      <text class="center-name" x="${C}" y="${C - 6}" text-anchor="middle" id="sbName">${esc(shortName)}</text>
      <text class="center-size" x="${C}" y="${C + 12}" text-anchor="middle" id="sbSize">${esc(fmtBytes(node.sizeBytes))}</text>
      ${canUp ? `<text class="center-hint" x="${C}" y="${C + 30}" text-anchor="middle">点击返回上一层</text>` : ''}
    </svg>`;
  }

  function truncateMiddle(s, max) {
    if (s.length <= max) return s;
    const head = Math.ceil((max - 1) / 2);
    const tail = Math.floor((max - 1) / 2);
    return `${s.slice(0, head)}…${s.slice(s.length - tail)}`;
  }

  function mapRow(child, i, parentSize, ci) {
    const lb = labels();
    const kind = child.kind;
    const id = child.id || '';
    const name = child.name || (kind === 'others' ? '其他小文件' : '未命名');
    let check = '<span class="check-cell" aria-hidden="true"></span>';
    if (id && kind !== 'others' && kind !== 'denied') {
      if (child.locked) {
        check = `<span class="check-cell"><input type="checkbox" class="checkbox" disabled aria-label="${esc(name)}：已锁定，不能勾选"></span>`;
      } else {
        check = `<span class="check-cell"><input type="checkbox" class="checkbox" data-act="sel" data-id="${esc(id)}" data-fk="sel:${esc(id)}" aria-label="选择 ${esc(name)}" ${S.sel.has(id) ? 'checked' : ''}></span>`;
      }
    }
    const sw = swatchStyle(kind, ci < 0 ? 0 : ci);
    const swatch = `<span class="map-swatch${kind === 'denied' ? ' legend-denied' : ''}" style="${sw}" aria-hidden="true"></span>`;
    const lock = child.locked ? `<span class="lock-reason" aria-hidden="true">${ICONS.lock}</span>` : '';
    const nameEl =
      kind === 'dir' && id
        ? `<button type="button" class="map-name-btn" data-act="enter" data-id="${esc(id)}" data-fk="enter:${esc(id)}" title="${esc(name)}" aria-label="进入目录 ${esc(name)}">${esc(name)}</button>`
        : `<span class="map-name-text" title="${esc(name)}">${esc(name)}</span>`;
    const share = parentSize > 0 ? Math.min(100, ((child.sizeBytes || 0) / parentSize) * 100) : 0;
    const meta = [];
    if (kind === 'dir') meta.push('<span>目录</span>');
    else if (kind === 'file') meta.push('<span>文件</span>');
    else if (kind === 'others') meta.push('<span>合并显示的小文件</span>');
    else if (kind === 'denied') meta.push('<span class="badge">无权限</span>');
    if (child.mtimeMs) meta.push(`<span>${esc(modifiedText(child.mtimeMs))}</span>`);
    if (child.category) {
      meta.push(`<span class="badge badge-info">${esc(CATEGORY_NAMES[child.category] || child.category)}</span>`);
    }
    const b = badgesHtml(child.tags);
    if (b) meta.push(b);
    if (child.locked && child.lockReason) {
      meta.push(`<span class="lock-reason">${ICONS.lock}<span>${esc(child.lockReason)}</span></span>`);
    }
    void lb;
    const actionsHtml =
      id && kind !== 'others'
        ? itemActionsHtml({
            id,
            name,
            path: '',
            isFile: kind === 'file',
            ignorable: !child.locked && (kind === 'dir' || kind === 'file'),
            rescan: kind === 'dir' || kind === 'denied',
            cls: 'map-actions',
          })
        : '<div class="map-actions"></div>';
    return `<li class="map-row" data-top="${i}">
      ${check}
      <div class="map-name">${swatch}${lock}${nameEl}</div>
      <div class="map-size"><span>${fmtBytes(child.sizeBytes)}</span><span class="share-bar" aria-hidden="true"><span style="width:${share.toFixed(1)}%"></span></span><span class="share-pct">${pctText(child.sizeBytes || 0, parentSize)}</span></div>
      <div class="map-meta">${meta.join('')}</div>
      ${actionsHtml}
    </li>`;
  }

  function renderMap() {
    const panel = $('#panel-map');
    if (!$('#mapMain', panel)) {
      panel.innerHTML = `<div id="mapBase"></div>
        <div id="mapMain" hidden>
          <div id="mapTop"></div>
          <div class="map-grid">
            <div class="sunburst-wrap" id="mapChart"></div>
            <div class="map-side">
              <div id="mapSideHead"></div>
              <div class="list-tools" id="mapTools">${searchToolsHtml('map', '搜索当前目录的子项', '搜索当前目录')}</div>
              <div id="mapList"></div>
            </div>
          </div>
        </div>`;
    }
    const baseEl = $('#mapBase');
    const mainEl = $('#mapMain');
    let base = null;
    if (S.state && !neverScanned() && !isUnsupported() && mapUnavailable()) {
      base = emptyHtml('扫描没有完成，暂时没有空间地图，请重新扫描', ICONS.map);
    } else if (S.state && !neverScanned() && !slots.tree.data && slots.tree.error && slots.tree.code === 'disk_not_scanned' && !isScanning()) {
      base = emptyHtml('还没有可以显示的磁盘，请先扫描', ICONS.map);
    } else {
      base = commonPanelState(slots.tree, '正在读取空间地图…');
    }
    if (base) {
      mainEl.hidden = true;
      renderInto(baseEl, base);
      return;
    }
    renderInto(baseEl, '');
    mainEl.hidden = false;

    const tree = slots.tree.data;
    const node = tree.node || { name: '', sizeBytes: 0, children: [] };
    const crumbs = tree.breadcrumbs || [];
    const children = node.children || [];
    const st = S.state;

    // 扫描根选择：优先用 state.roots，旧版 Node 没有时退回按磁盘选择
    let rootSel = '';
    const roots = stateRoots();
    if (roots.length) {
      const curId = tree.rootId || currentRootId();
      const cur = roots.find((r) => r.id === curId);
      if (roots.length > 1) {
        rootSel = `<label class="field">扫描范围<select class="select" data-act="map-root" data-fk="map-root">${roots
          .map(
            (r) =>
              `<option value="${esc(r.id)}" ${r.id === curId ? 'selected' : ''}>${esc(r.kind === 'folder' ? `${r.label}（文件夹）` : r.label)}</option>`,
          )
          .join('')}</select></label>`;
      }
      if (cur && cur.kind === 'folder') {
        rootSel += `<span class="badge badge-info">文件夹</span><span class="mono root-path truncate" title="${esc(cur.path)}">${esc(cur.path)}</span>`;
      }
    } else {
      const scanned = scannedDiskIds();
      const disks = (st.disks || []).filter((d) => scanned.includes(d.id));
      if (disks.length > 1) {
        rootSel = `<label class="field">磁盘<select class="select" data-act="map-disk" data-fk="map-disk">${disks
          .map((d) => `<option value="${esc(d.id)}" ${d.id === tree.diskId ? 'selected' : ''}>${esc(d.label)}</option>`)
          .join('')}</select></label>`;
      }
    }
    const crumbHtml = `<nav class="crumbs" aria-label="当前位置"><ol>${crumbs
      .map((c, i) =>
        i === crumbs.length - 1
          ? `<li><span aria-current="page" title="${esc(c.name)}">${esc(c.name)}</span></li>`
          : `<li><button type="button" data-act="crumb" data-id="${esc(c.id)}" data-fk="crumb:${esc(c.id)}" title="${esc(c.name)}">${esc(c.name)}</button></li>`,
      )
      .join('')}</ol></nav>`;
    const notice = S.mapDiskNotice ? `<div class="inline-note" role="status">${esc(S.mapDiskNotice)}</div>` : '';
    renderInto($('#mapTop'), `<div class="map-top">${rootSel}${crumbHtml}</div>${notice}`);

    const chart = children.length
      ? buildSunburst(tree)
      : emptyHtml(isScanning() ? '这个目录还在扫描' : '这个目录是空的，或者没有可以显示的子项', ICONS.map);
    const legend = `<div class="map-legend" aria-hidden="true">
      <span class="legend-item"><span class="legend-dot legend-scanned"></span>目录</span>
      <span class="legend-item"><span class="legend-dot legend-file"></span>文件</span>
      <span class="legend-item"><span class="legend-dot legend-others"></span>其他小文件</span>
      <span class="legend-item"><span class="legend-dot legend-denied"></span>无权限</span>
    </div>`;
    renderInto($('#mapChart'), `${chart}${children.length ? legend : ''}`);

    const seg = `<div class="segmented" role="group" aria-label="切换目录和文件类型">
      <button type="button" data-act="mapview" data-v="dirs" data-fk="mv:dirs" aria-pressed="${S.mapView === 'dirs'}">目录</button>
      <button type="button" data-act="mapview" data-v="types" data-fk="mv:types" aria-pressed="${S.mapView === 'types'}">文件类型</button>
    </div>`;
    const headTitle =
      S.mapView === 'dirs'
        ? `<h2 class="truncate" title="${esc(node.name)}">${esc(node.name)} · <span class="num">${fmtBytes(node.sizeBytes)}</span></h2>`
        : '<h2>按文件类型统计</h2>';
    renderInto($('#mapSideHead'), `<div class="map-side-head">${headTitle}${seg}</div>`);
    $('#mapTools').hidden = S.mapView !== 'dirs';

    if (S.mapView === 'dirs') {
      renderMapList();
    } else {
      const ts = slots.types;
      let body;
      if (!ts.data && ts.error) body = errorHtml('没能读取文件类型统计，请重试');
      else if (!ts.data) body = loadingHtml('正在读取文件类型统计…');
      else body = typesPieHtml(ts.data.types || []);
      renderInto($('#mapList'), body);
    }
    $('#mapMain .map-side').setAttribute('aria-busy', slots.tree.inflight ? 'true' : 'false');
    S.hot = null;
    syncChecks();
  }

  /** 当前层子项列表：页面内搜索和排序，旭日图不受影响 */
  function renderMapList() {
    const box = $('#mapList');
    const tree = slots.tree.data;
    if (!box || !tree || S.mapView !== 'dirs') return;
    const node = tree.node || { name: '', sizeBytes: 0, children: [] };
    const children = node.children || [];
    const colors = topColors(children);
    const parentSize = Math.max(node.sizeBytes || 0, children.reduce((sum, c) => sum + (c.sizeBytes || 0), 0));
    const q = S.mapQuery.q.trim().toLowerCase();
    let rows = children.map((c, i) => ({ c, i }));
    if (q) rows = rows.filter((r) => r.c.kind !== 'others' && (r.c.name || '').toLowerCase().includes(q));
    const sort = S.mapQuery.sort;
    if (sort !== 'size') {
      const rest = rows.filter((r) => r.c.kind !== 'others');
      const tail = rows.filter((r) => r.c.kind === 'others');
      if (sort === 'mtime') rest.sort((a, b) => (a.c.mtimeMs || Infinity) - (b.c.mtimeMs || Infinity));
      else rest.sort((a, b) => (a.c.name || '').localeCompare(b.c.name || '', 'zh-CN'));
      rows = rest.concat(tail);
    }
    const realCount = children.filter((c) => c.kind !== 'others').length;
    setSearchStatus('map', q ? `匹配 ${fmtCount(rows.length)} 项（共 ${fmtCount(realCount)} 项）` : '');
    const sortLabel = (SORT_OPTIONS.find(([v]) => v === sort) || SORT_OPTIONS[0])[1];
    let html;
    if (!children.length) html = '<div class="inline-note">没有子项</div>';
    else if (q && !rows.length) html = noMatchHtml('map');
    else {
      html = `<ul class="list-card item-list map-list" aria-label="${esc(`${node.name} 的子项，按${sortLabel}排序`)}">${rows
        .map((r) => mapRow(r.c, r.i, parentSize, colors[r.i]))
        .join('')}</ul>`;
    }
    renderInto(box, html);
    syncChecks();
  }

  function resetMapQuery() {
    S.mapQuery.q = '';
    const input = $('[data-search="map"]');
    if (input) input.value = '';
  }

  function setHot(top, sector) {
    const svg = $('#sunburst');
    const key = top == null ? null : String(top);
    if (S.hot !== key) {
      S.hot = key;
      $$('#panel-map .map-row.is-hot').forEach((el) => el.classList.remove('is-hot'));
      if (svg) {
        $$('.sector.is-hot', svg).forEach((el) => el.classList.remove('is-hot'));
        svg.classList.toggle('has-hot', key != null);
      }
      if (key != null) {
        $$(`#panel-map .map-row[data-top="${key}"]`).forEach((el) => el.classList.add('is-hot'));
        if (svg) $$(`.sector[data-top="${key}"]`, svg).forEach((el) => el.classList.add('is-hot'));
      }
    }
    if (svg) {
      const tree = slots.tree.data;
      const nameEl = $('#sbName', svg);
      const sizeEl = $('#sbSize', svg);
      if (sector) {
        nameEl.textContent = truncateMiddle(sector.getAttribute('data-name') || '', 14);
        sizeEl.textContent = sector.getAttribute('data-size') || '';
      } else if (key != null && tree) {
        const c = (tree.node.children || [])[Number(key)];
        if (c) {
          nameEl.textContent = truncateMiddle(c.name || '', 14);
          sizeEl.textContent = fmtBytes(c.sizeBytes);
        }
      } else if (tree) {
        nameEl.textContent = truncateMiddle(tree.node.name || '', 14);
        sizeEl.textContent = fmtBytes(tree.node.sizeBytes);
      }
    }
  }

  function goTree(id) {
    S.treeId = id || null;
    S.mapDiskNotice = '';
    resetMapQuery();
    load('tree');
  }

  /* ---------- 代码仓库 ---------- */

  const NA_HTML = '<span aria-hidden="true">—</span><span class="sr-only">主仓库不在扫描范围内，不统计</span>';

  function renderRepos() {
    const panel = $('#panel-repos');
    if (!$('#reposBody', panel)) {
      panel.innerHTML = `<div id="reposSummary"></div>
        <div class="list-tools" id="reposTools" hidden>${searchToolsHtml('repos', '搜索代码仓库', '搜索仓库名或路径', REPO_SORT_OPTIONS)}<span class="spacer"></span><button type="button" class="btn btn-secondary btn-sm" id="repoRecheckBtn" data-act="repo-recheck">重新检查状态</button></div>
        <div id="reposBody"></div>`;
    }
    const sumEl = $('#reposSummary');
    const tools = $('#reposTools');
    const bodyEl = $('#reposBody');
    const slot = slots.repos;
    const showOnly = (html) => {
      tools.hidden = true;
      renderInto(sumEl, '');
      renderInto(bodyEl, html);
    };
    const base = commonPanelState(slot, '正在读取代码仓库…');
    if (base) {
      showOnly(base);
      return;
    }
    const d = slot.data;
    if (d.status === 'pending') {
      showOnly(emptyHtml('深度扫描完成后显示代码仓库', ICONS.repo));
      return;
    }
    const repos = d.repos || [];
    const q = S.reposQuery.q;
    if (!repos.length && !q) {
      showOnly(emptyHtml('扫描范围里没有找到代码仓库', ICONS.repo));
      return;
    }
    tools.hidden = false;
    renderInto(sumEl, d.summary ? reposSummaryHtml(d.summary) : '');
    const recheck = $('#repoRecheckBtn');
    const anyOpen = repos.some((r) => S.reposExpanded.has(r.id));
    recheck.disabled = !anyOpen;
    if (anyOpen) recheck.removeAttribute('title');
    else recheck.title = '先展开一个仓库，再重新检查它的 worktree 状态';
    setSearchStatus('repos', q ? `匹配 ${fmtCount(repos.length)} 个仓库` : '');
    if (!repos.length) {
      renderInto(bodyEl, noMatchHtml('repos'));
      return;
    }
    renderInto(bodyEl, `<ul class="repo-list" aria-label="代码仓库列表">${repos.map(repoHtml).join('')}</ul>`);
    syncChecks();
  }

  function reposSummaryHtml(sum) {
    const b = sum.breakdown || {};
    const entries = [
      { key: 'main', label: '主仓库源码', bytes: b.mainSourceBytes || 0 },
      { key: 'git', label: '.git 数据', bytes: b.gitBytes || 0 },
      { key: 'wt', label: 'worktree 源码', bytes: b.worktreeSourceBytes || 0 },
      { key: 'deps', label: '依赖和构建产物', bytes: b.depsBytes || 0 },
    ];
    const { slices, colorOf, sliceOf, total } = pieSlices(entries);
    const pie = total
      ? donutSvg({
          slices,
          total,
          centerLabel: '合计',
          centerValue: fmtBytes(total),
          aria: `代码占用构成：${entries.map((e) => `${e.label} ${fmtBytes(e.bytes)}（${pctText(e.bytes, total)}）`).join('，')}。`,
        })
      : '';
    const legend = entries
      .map(
        (e) => `<li class="pie-legend-item is-static is-compact" data-pie-key="${esc(sliceOf.get(e.key) || '')}">
          <span class="legend-dot" style="background:${colorOf.has(e.key) ? chartVar(colorOf.get(e.key)) : 'var(--mcode-chart-track)'}" aria-hidden="true"></span>
          <span class="pie-legend-name truncate">${esc(e.label)}</span>
          <span class="num">${fmtBytes(e.bytes)}</span>
          <span class="pie-legend-pct num">${pctText(e.bytes, total)}</span>
        </li>`,
      )
      .join('');
    return `<section class="pie-card" aria-labelledby="reposTitle">
      <div class="pie-head"><h2 id="reposTitle">代码仓库</h2></div>
      <div class="pie-layout">
        <dl class="repo-kpis">
          <div><dt>仓库</dt><dd class="num">${fmtCount(sum.repoCount)}</dd></div>
          <div><dt>worktree</dt><dd class="num">${fmtCount(sum.worktreeCount)}</dd></div>
          <div><dt>合计占用</dt><dd class="num">${fmtBytes(sum.sizeBytes)}<small>实际可释放 ${fmtBytes(sum.releasableBytes)}</small></dd></div>
        </dl>
        ${pie ? `<div class="pie-figure">${pie}</div>` : ''}
        <ul class="pie-legend" aria-label="代码占用构成">${legend}</ul>
      </div>
      <p class="pie-note">合计占用里，克隆和硬链接的文件只算一次，不会超过磁盘已用空间。单个仓库和 worktree 的大小和 du 一致，共享的文件每份都计入，所以各项相加会比合计大。实际可释放只算删掉后真正能腾出的空间。</p>
    </section>`;
  }

  function repoHtml(r) {
    const id = esc(r.id);
    const name = r.name || r.path || '未命名仓库';
    const inScope = !!r.mainInScope;
    const open = S.reposExpanded.has(r.id);
    const hasWt = (r.worktreeCount || 0) > 0;
    const toggle = hasWt
      ? `<button type="button" class="btn btn-icon expand-btn" data-act="repo-toggle" data-id="${id}" data-fk="rt:${id}" aria-expanded="${open}" aria-controls="wt-${id}" aria-label="${open ? '收起' : '展开'} ${esc(name)} 的 worktree">${ICONS.chevron}</button>`
      : '<span class="check-cell" aria-hidden="true"></span>';
    const stale =
      inScope && typeof r.staleCount === 'number'
        ? r.staleCount > 0
          ? `<span class="warn-count">${fmtCount(r.staleCount)} 条</span>`
          : '0'
        : NA_HTML;
    const metrics = [
      ['合计', `<span class="num">${fmtBytes(r.sizeBytes)}</span><small>实际可释放 ${fmtBytes(r.releasableBytes)}</small>`],
      ['.git', inScope && r.main ? `<span class="num">${fmtBytes(r.main.gitBytes)}</span>` : NA_HTML],
      ['worktree', `<span class="num">${fmtCount(r.worktreeCount)} 个 · ${fmtBytes(r.worktreeBytes)}</span>`],
      ['依赖和构建产物', `<span class="num">${fmtBytes(r.depsBytes)}</span>`],
      ['最近活动', inScope && r.lastActivityMs ? esc(fmtAgo(r.lastActivityMs)) : NA_HTML],
      ['失效 worktree', stale],
    ];
    const actions = [];
    actions.push(
      `<button type="button" class="btn btn-secondary btn-sm" data-act="repo-deps" data-id="${id}" data-fk="rd:${id}" aria-label="勾选 ${esc(name)} 的依赖和构建产物">勾选依赖和构建产物</button>`,
    );
    if (inScope && (r.staleCount || 0) > 0) {
      actions.push(
        `<button type="button" class="btn btn-secondary btn-sm" data-act="repo-prune" data-id="${id}" data-name="${esc(name)}" data-fk="rp:${id}" aria-label="清理 ${esc(name)} 的失效 worktree">清理失效 worktree</button>`,
      );
    }
    const itemActs =
      inScope && r.main && r.main.entityId
        ? itemActionsHtml({ id: r.main.entityId, name, path: r.path, isFile: false, ignorable: false, rescan: false })
        : '';
    return `<li class="repo${inScope ? '' : ' is-outside'}" id="repo-${id}">
      <div class="repo-head">
        ${toggle}
        <div class="repo-title">
          <h3 class="repo-name truncate" title="${esc(name)}">${esc(name)}</h3>
          <span class="item-path mono truncate" title="${esc(r.path)}">${esc(r.path)}</span>
          ${inScope ? '' : '<span class="badge">主仓库不在扫描范围内</span>'}
        </div>
        <div class="repo-actions">${actions.join('')}${itemActs}</div>
      </div>
      <dl class="repo-metrics">${metrics.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>
      ${open ? `<div class="wt-box" id="wt-${id}">${worktreesHtml(r.id)}</div>` : ''}
    </li>`;
  }

  function worktreesHtml(repoId) {
    const w = S.wt.get(repoId);
    if (!w || (!w.data && !w.error)) return loadingHtml('正在读取 worktree…');
    if (!w.data && w.error) {
      return `<div class="inline-error" role="alert"><span>没能读取 worktree，请重试</span><button type="button" class="btn btn-secondary btn-sm" data-act="wt-retry" data-id="${esc(repoId)}">重试</button></div>`;
    }
    const list = w.data.worktrees || [];
    if (!list.length) return '<div class="inline-note">这个仓库在扫描范围里没有 worktree</div>';
    const checking = list.filter((x) => x.status === 'checking').length;
    const head = checking
      ? `<p class="wt-note" role="status"><span class="spinner spinner-xs" aria-hidden="true"></span>正在检查 ${fmtCount(checking)} 个 worktree 的状态</p>`
      : '';
    return `${head}<ul class="item-list wt-list" aria-label="worktree 列表">${list.map(wtRowHtml).join('')}</ul>`;
  }

  function wtRowHtml(wt) {
    const id = wt.id || '';
    const name = wt.name || wt.path || '未命名 worktree';
    const [label, cls] = WT_STATUS[wt.status] || WT_STATUS.unchecked;
    const details = [];
    if ((wt.status === 'dirty' || wt.status === 'dirty-ahead') && wt.changedCount) details.push(`${fmtCount(wt.changedCount)} 个文件有改动`);
    if ((wt.status === 'ahead' || wt.status === 'dirty-ahead') && wt.aheadCount) details.push(`${fmtCount(wt.aheadCount)} 个提交未推送`);
    const detail = details.join('，');
    const spin = wt.status === 'checking' ? '<span class="spinner spinner-xs" aria-hidden="true"></span>' : '';
    const badge = `<span class="badge status-badge ${cls}"${detail ? ` title="${esc(detail)}"` : ''}>${spin}状态：${esc(label)}${detail ? `（${esc(detail)}）` : ''}</span>`;
    let check = '<span class="check-cell" aria-hidden="true"></span>';
    if (id) {
      check = wt.locked
        ? `<span class="check-cell"><input type="checkbox" class="checkbox" disabled aria-label="${esc(name)}：${esc(wt.lockReason || '已锁定')}"></span>`
        : `<span class="check-cell"><input type="checkbox" class="checkbox" data-act="sel" data-id="${esc(id)}" data-fk="sel:${esc(id)}" aria-label="选择 worktree ${esc(name)}" ${S.sel.has(id) ? 'checked' : ''}></span>`;
    }
    const meta = [];
    if (wt.branch) meta.push(`<span class="branch mono" title="分支 ${esc(wt.branch)}"><span class="sr-only">分支 </span>${esc(wt.branch)}</span>`);
    meta.push(badge);
    if (wt.mtimeMs) meta.push(`<span>${esc(modifiedText(wt.mtimeMs))}</span>`);
    meta.push(`<span>依赖和构建产物 ${fmtBytes(wt.depsBytes)}</span>`);
    if (wt.locked && wt.lockReason) meta.push(`<span class="lock-reason">${ICONS.lock}<span>${esc(wt.lockReason)}</span></span>`);
    return `<li class="item wt-row${wt.locked ? ' is-locked' : ''}">
      ${check}
      <div class="item-main">
        <div class="item-title"><span class="item-name truncate">${esc(name)}</span></div>
        <span class="item-path mono truncate" title="${esc(wt.path)}">${esc(wt.path)}</span>
        <div class="item-meta">${meta.join('')}</div>
      </div>
      <span class="item-size">${fmtBytes(wt.sizeBytes)}<small>实际可释放 ${fmtBytes(wt.releasableBytes)}</small></span>
      ${itemActionsHtml({ id, name, path: wt.path, isFile: false, ignorable: false, rescan: false })}
    </li>`;
  }

  function loadWorktrees(repoId) {
    let w = S.wt.get(repoId);
    if (!w) {
      w = { data: null, error: false, inflight: null, again: false };
      S.wt.set(repoId, w);
    }
    if (w.inflight) {
      w.again = true;
      return;
    }
    w.error = false;
    w.inflight = api(`api/repos/worktrees?id=${encodeURIComponent(repoId)}`)
      .then(
        (d) => {
          w.data = d;
          syncSel((d && d.worktrees) || []);
        },
        () => {
          w.error = true;
        },
      )
      .finally(() => {
        w.inflight = null;
        renderWorktrees(repoId);
        if (w.again) {
          w.again = false;
          loadWorktrees(repoId);
        }
      });
  }

  const wtTimers = {};
  function scheduleWorktrees(repoId) {
    clearTimeout(wtTimers[repoId]);
    wtTimers[repoId] = setTimeout(() => loadWorktrees(repoId), 300);
  }

  function renderWorktrees(repoId) {
    const box = document.getElementById(`wt-${repoId}`);
    if (!box) return;
    renderInto(box, worktreesHtml(repoId));
    syncChecks();
  }

  /** force 为 false 时只检查未检查过和检查失败的 worktree；为 true 时全部重新检查 */
  function checkRepoStatus(repoId, force) {
    return api('api/repos/check-status', { method: 'POST', body: { id: repoId, force: !!force } }).catch(() => {
      toastError('没能开始检查 worktree 状态，请稍后再试');
    });
  }

  function toggleRepo(repoId) {
    if (S.reposExpanded.has(repoId)) {
      S.reposExpanded.delete(repoId);
      renderRepos();
      return;
    }
    S.reposExpanded.add(repoId);
    renderRepos();
    checkRepoStatus(repoId, false).then(() => loadWorktrees(repoId));
    loadWorktrees(repoId);
  }

  function recheckRepos() {
    const ids = Array.from(S.reposExpanded);
    if (!ids.length) return;
    toast('正在重新检查 worktree 状态');
    ids.forEach((id) => checkRepoStatus(id, true).then(() => loadWorktrees(id)));
  }

  function refreshOpenWorktrees() {
    S.reposExpanded.forEach((id) => loadWorktrees(id));
  }

  async function selectRepoDeps(repoId) {
    try {
      const res = await api('api/repos/select-deps', { method: 'POST', body: { id: repoId } });
      applySelSummary(res);
      toast('已勾选这个仓库的依赖和构建产物');
    } catch (e) {
      toastError('没能勾选依赖和构建产物，请稍后再试');
    }
  }

  async function openPrune(repoId, name, opener) {
    const closeFoot = '<span class="foot-note"></span><button type="button" class="btn btn-secondary" data-modal="cancel">关闭</button>';
    openModal({ kind: 'prune', title: '清理失效 worktree', opener, body: loadingHtml('正在读取失效 worktree…'), foot: '' });
    let d;
    try {
      d = await api(`api/repos/stale?id=${encodeURIComponent(repoId)}`);
    } catch (e) {
      if (modalKind !== 'prune') return;
      const msg = e.code === 'main_not_in_scope' ? '主仓库不在扫描范围内，不能清理失效 worktree' : '没能读取失效 worktree，请稍后再试';
      updateModal({ body: `<div class="inline-error" role="alert">${esc(msg)}</div>`, foot: closeFoot, focus: '[data-modal="cancel"]' });
      return;
    }
    if (modalKind !== 'prune') return;
    const recs = (d && d.records) || [];
    if (!recs.length) {
      updateModal({ body: '<div class="inline-note">没有失效的 worktree 记录</div>', foot: closeFoot, focus: '[data-modal="cancel"]' });
      return;
    }
    updateModal({
      body: `<p>${esc(name)} 有 <strong class="num">${fmtCount(recs.length)}</strong> 条失效的 worktree 记录。</p>
        <div class="banner banner-warn" role="note">只删除这些目录已经不存在的 worktree 记录，不碰任何代码文件。</div>
        <ul class="confirm-list" aria-label="将清理的失效 worktree 记录">${recs
          .map(
            (x) => `<li><span class="item-main"><span class="truncate">${esc(x.name)}</span><span class="item-path mono truncate" title="${esc(x.path)}">${esc(x.path)}</span></span></li>`,
          )
          .join('')}</ul>`,
      foot: `<span class="foot-note"></span><button type="button" class="btn btn-secondary" data-modal="cancel">取消</button><button type="button" class="btn btn-primary" data-modal="confirm-prune" data-id="${esc(repoId)}">清理 ${fmtCount(recs.length)} 条记录</button>`,
      focus: '[data-modal="cancel"]',
    });
  }

  async function doPrune(repoId) {
    $$('#modalFoot button').forEach((b) => {
      b.disabled = true;
    });
    try {
      const res = await api('api/repos/prune', { method: 'POST', body: { id: repoId } });
      closeModal();
      const removed = (res && res.removed) || 0;
      const remaining = (res && res.remaining) || 0;
      toast(`已清理 ${fmtCount(removed)} 条${remaining ? `，还有 ${fmtCount(remaining)} 条没能清理` : ''}`);
      scheduleLoad('repos');
    } catch (e) {
      let msg = '清理失败，请稍后再试';
      if (e.code === 'no_git') msg = '没有找到 git，无法清理';
      else if (e.code === 'main_not_in_scope') msg = '主仓库不在扫描范围内，不能清理失效 worktree';
      updateModal({
        foot: `<span class="foot-note result-fail" role="alert">${esc(msg)}</span><button type="button" class="btn btn-secondary" data-modal="cancel">关闭</button>`,
        focus: '[data-modal="cancel"]',
      });
    }
  }

  /* ---------- 标签页 ---------- */

  function setTab(tab, focusTab) {
    S.tab = tab;
    $$('#tablist [role="tab"]').forEach((t) => {
      const on = t.getAttribute('data-tab') === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focusTab) t.focus();
    });
    ['junk', 'large', 'map', 'repos'].forEach((k) => {
      const panel = $(`#panel-${k}`);
      panel.hidden = k !== tab;
      panel.inert = k !== tab;
    });
    renderCurrent();
    refreshCurrent();
  }

  function renderCurrent() {
    if (S.tab === 'junk') renderJunk();
    else if (S.tab === 'large') renderLarge();
    else if (S.tab === 'repos') renderRepos();
    else renderMap();
  }

  /* ---------- 状态与 SSE ---------- */

  function onState(st) {
    if (!st) return;
    const prev = S.state;
    S.state = st;
    S.stateError = false;
    $('#pageAlert').hidden = true;
    if (st.selection) applySelSummary(st.selection);
    renderTop();
    renderMenu();
    const was = prev && prev.scan ? prev.scan.status : null;
    const now = st.scan ? st.scan.status : 'idle';
    if (!prev) {
      renderCurrent();
      refreshCurrent();
    } else if (was !== now || (prev.lastScanAt || null) !== (st.lastScanAt || null)) {
      renderCurrent();
      refreshCurrent();
    }
  }

  async function loadState() {
    try {
      const st = await api('api/state');
      onState(st);
    } catch (e) {
      if (!S.state) {
        S.stateError = true;
        const alert = $('#pageAlert');
        alert.innerHTML =
          '<span>无法连接磁盘透视服务，请稍后重试。</span><button type="button" class="btn btn-secondary btn-sm" data-act="retry-state">重试</button>';
        alert.hidden = false;
        renderCurrent();
      }
    }
  }

  let es = null;
  let reconnectTimer = 0;

  function setConn(down) {
    const el = $('#connBanner');
    el.textContent = down ? '连接中断，正在重连' : '';
    el.hidden = !down;
  }

  function parseData(ev) {
    try {
      return JSON.parse(ev.data);
    } catch (e) {
      return null;
    }
  }

  function connectEvents() {
    if (typeof EventSource === 'undefined') return;
    clearTimeout(reconnectTimer);
    if (es) es.close();
    es = new EventSource('api/events');
    es.addEventListener('open', () => {
      const recovering = S.sse.down;
      S.sse.down = false;
      S.sse.everOpen = true;
      setConn(false);
      if (recovering) {
        loadState();
        refreshCurrent();
        if (S.clean.jobId) reconcileClean();
      }
    });
    es.addEventListener('error', () => {
      S.sse.down = true;
      setConn(true);
      if (es && es.readyState === EventSource.CLOSED) {
        es.close();
        reconnectTimer = setTimeout(connectEvents, 3000);
      }
    });
    es.addEventListener('state', (ev) => onState(parseData(ev)));
    es.addEventListener('results', (ev) => {
      const d = parseData(ev);
      const kinds = (d && Array.isArray(d.kinds) && d.kinds) || [];
      const map = { junk: 'junk', large: 'large', duplicates: 'dup', tree: 'tree', types: 'types', repos: 'repos' };
      if (kinds.includes('repos') && S.tab === 'repos') S.reposExpanded.forEach((id) => scheduleWorktrees(id));
      const needs = currentNeeds();
      kinds.forEach((k) => {
        const key = map[k];
        if (key && needs.includes(key)) scheduleLoad(key);
        if (k === 'denied' && modalKind === 'denied') openDenied(null, true);
      });
    });
    es.addEventListener('selection', (ev) => applySelSummary(parseData(ev)));
    es.addEventListener('clean', (ev) => onCleanEvent(parseData(ev)));
  }

  /* ---------- 扫描 ---------- */

  async function onScanClick() {
    if (isScanning()) {
      try {
        await api('api/scan/cancel', { method: 'POST', body: {} });
        toast('正在取消扫描，已得到的结果会保留');
      } catch (e) {
        toastError('没能取消扫描，请稍后再试');
      }
      return;
    }
    if (scopeEmpty()) {
      toastError('请先选择扫描范围');
      setScopeEditing(true, true);
      return;
    }
    if (S.selSummary.count > 0) {
      const opener = $('#scanBtn');
      openModal({
        kind: 'rescan',
        title: '重新扫描',
        opener,
        body: `<p>重新扫描会清空上一次的结果和已选清单（已选 ${fmtCount(S.selSummary.count)} 项）。</p>`,
        foot: `<span class="foot-note"></span><button type="button" class="btn btn-secondary" data-modal="cancel">取消</button><button type="button" class="btn btn-primary" data-modal="confirm-rescan">重新扫描</button>`,
        focus: '[data-modal="confirm-rescan"]',
      });
      return;
    }
    startScan();
  }

  async function startScan() {
    const sel = scopeSelection();
    const body = {};
    if (sel.diskIds.length) body.diskIds = sel.diskIds;
    if (sel.paths.length) body.paths = sel.paths;
    try {
      await api('api/scan', { method: 'POST', body });
      S.scope.editing = false;
      S.mapRootId = null;
      resetMapQuery();
      S.sel.clear();
      S.selSummary = { count: 0, bytes: 0 };
      S.treeId = null;
      S.mapDiskChosen = null;
      S.mapDiskNotice = '';
      S.expanded.clear();
      Object.values(slots).forEach((s) => {
        s.data = null;
      });
      renderSelBar();
      toast('已开始扫描');
      await loadState();
      renderCurrent();
      refreshCurrent();
      return true;
    } catch (e) {
      let msg = '扫描没能开始，请稍后再试';
      if (e.code === 'scan_running' || e.status === 409) msg = '已经在扫描了';
      else if (e.code === 'scope_required') msg = '请先选择扫描范围';
      else if (e.code === 'invalid_disk') msg = '磁盘列表有变化，请检查扫描范围后再试';
      else if (e.code === 'invalid_path') msg = pathErrorText('invalid_path');
      if (e.code === 'scope_required' || e.code === 'invalid_disk' || e.code === 'invalid_path') {
        setScopeEditing(true, false);
        const err = $('#scopeError');
        err.textContent = msg;
        err.hidden = false;
      }
      toastError(msg);
      return false;
    }
  }

  async function rescanDir(id) {
    try {
      await api('api/rescan', { method: 'POST', body: { id } });
      toast('正在重新扫描这个目录，完成后列表会更新');
    } catch (e) {
      if (e.status === 409) toastError('正在扫描，请等扫描结束后再试');
      else toastError('没能重新扫描这个目录，请重新扫描整个磁盘');
    }
  }

  async function reveal(id) {
    const fm = labels().fileManager;
    try {
      await api('api/reveal', { method: 'POST', body: { id } });
    } catch (e) {
      toastError(`没能在${fm}中显示，它可能已被移动或删除`);
    }
  }

  async function systemAction(action) {
    try {
      await api('api/system-action', { method: 'POST', body: { action } });
      if (action === 'mac-full-disk-access') {
        toast('已打开系统设置。打开 MiniMax Code 的完全磁盘访问权限后，重启 MiniMax Code 并重新扫描');
      } else if (action === 'win-disk-cleanup') {
        toast('已打开磁盘清理');
      } else {
        toast('已打开存储设置');
      }
    } catch (e) {
      toastError('没能打开系统设置，请手动打开');
    }
  }

  /* ---------- 更多菜单 ---------- */

  function renderMenu() {
    const st = S.state;
    const items = [];
    items.push(['history', '清理记录'], ['ignore', '忽略名单'], ['denied', '无权限的目录']);
    if (st && st.platform === 'darwin' && st.fullDiskAccess === 'missing') items.push(['fda', '开启完全磁盘访问']);
    const html = items
      .map(([k, l]) => `<li role="none"><button type="button" role="menuitem" tabindex="-1" data-menu="${k}">${esc(l)}</button></li>`)
      .join('');
    const menu = $('#moreMenu');
    if (menu.innerHTML !== html) menu.innerHTML = html;
  }

  function openMenu() {
    const menu = $('#moreMenu');
    renderMenu();
    menu.hidden = false;
    $('#moreBtn').setAttribute('aria-expanded', 'true');
    const first = $('[role="menuitem"]', menu);
    if (first) first.focus();
  }

  function closeMenu(restore) {
    const menu = $('#moreMenu');
    if (menu.hidden) return;
    menu.hidden = true;
    $('#moreBtn').setAttribute('aria-expanded', 'false');
    if (restore) $('#moreBtn').focus();
  }

  function onMenuKey(e) {
    const items = $$('#moreMenu [role="menuitem"]');
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(i + 1) % items.length].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length].focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0].focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1].focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu(true);
    } else if (e.key === 'Tab') {
      closeMenu(false);
    }
  }

  function onMenuChoose(key) {
    const opener = $('#moreBtn');
    closeMenu(false);
    if (key === 'history') openHistory(opener);
    else if (key === 'ignore') openIgnoreList(opener);
    else if (key === 'denied') openDenied(opener);
    else if (key === 'fda') {
      opener.focus();
      systemAction('mac-full-disk-access');
    }
  }

  /* ---------- 弹窗 ---------- */

  let modalKind = null;
  let modalOpener = null;
  let modalLive = false;

  /** 弹窗关闭后的收尾。关闭按钮、Escape（cancel 事件）和 close 事件都会调用，只执行一次。 */
  function onModalClosed() {
    if (!modalLive) return;
    modalLive = false;
    const opener = modalOpener;
    modalKind = null;
    modalOpener = null;
    // 清空关闭后的内容，避免读屏软件读到上一次弹窗里的列表
    $('#modalTitle').textContent = '';
    $('#modalBody').innerHTML = '';
    $('#modalFoot').innerHTML = '';
    setTimeout(() => restoreFocus(opener), 0);
  }

  function openModal(o) {
    const modal = $('#modal');
    modalKind = o.kind;
    if (o.opener !== undefined && !modal.open) modalOpener = o.opener;
    modalLive = true;
    modal.classList.toggle('modal-compact', !!o.compact);
    $('#modalTitle').textContent = o.title;
    $('#modalBody').innerHTML = o.body || '';
    $('#modalFoot').innerHTML = o.foot || '';
    if (!modal.open) modal.showModal();
    const target = o.focus ? $(o.focus, modal) : null;
    (target || $('#modalClose')).focus();
  }

  function updateModal(o) {
    const modal = $('#modal');
    if (!modal.open) return;
    if (o.title) $('#modalTitle').textContent = o.title;
    if (o.body !== undefined) $('#modalBody').innerHTML = o.body;
    if (o.foot !== undefined) $('#modalFoot').innerHTML = o.foot;
    if (o.focus) {
      const t = $(o.focus, modal);
      if (t) t.focus();
    }
  }

  function closeModal() {
    const modal = $('#modal');
    if (modal.open) modal.close();
    onModalClosed();
  }

  function restoreFocus(el) {
    if (el && document.contains(el) && !el.disabled) el.focus();
    else {
      const panel = $(`#panel-${S.tab}`);
      if (panel) panel.focus();
    }
  }

  /* ---------- 扫描范围（首页常驻区域） ---------- */
  const MAX_FOLDERS = 20;

  /** 第一次拿到状态时预填：lastScope 为 null 时什么都不选 */
  function seedScope() {
    const st = S.state;
    if (S.scope.seeded || !st) return;
    S.scope.seeded = true;
    const last = st.lastScope;
    if (!last) return;
    const known = new Set((st.disks || []).map((d) => d.id));
    (last.diskIds || []).forEach((id) => {
      if (known.has(id)) S.scope.diskIds.add(id);
    });
    (last.paths || []).slice(0, MAX_FOLDERS).forEach((path) => {
      const root = stateRoots().find((r) => r.kind === 'folder' && r.path === path);
      const disk = root ? (st.disks || []).find((d) => d.id === root.diskId) : null;
      S.scope.folders.push({ path, diskId: root ? root.diskId : '', deletable: disk ? !!disk.deletable : true });
    });
  }

  function scopeSelection() {
    const known = new Set(((S.state && S.state.disks) || []).map((d) => d.id));
    return {
      diskIds: Array.from(S.scope.diskIds).filter((id) => known.has(id)),
      paths: S.scope.folders.map((f) => f.path),
    };
  }

  function scopeEmpty() {
    const sel = scopeSelection();
    return sel.diskIds.length === 0 && sel.paths.length === 0;
  }

  function hasScanResults() {
    const st = S.state;
    if (!st) return false;
    const status = scanStatus();
    return !!st.lastScanAt || status === 'done' || status === 'cancelled' || status === 'error';
  }

  /** 主目录用 ~ 缩写（只限 macOS） */
  function shortPath(path) {
    const st = S.state;
    if (!st || st.platform !== 'darwin') return path;
    const home = (st.places || []).find((x) => x.id === 'home');
    if (home && home.path && (path === home.path || path.startsWith(`${home.path}/`))) return `~${path.slice(home.path.length)}`;
    return path;
  }

  function scopeSummaryText() {
    const st = S.state || {};
    const sel = scopeSelection();
    const names = sel.diskIds.map((id) => {
      const d = (st.disks || []).find((x) => x.id === id);
      return d ? d.label : id;
    });
    sel.paths.forEach((p) => names.push(shortPath(p)));
    return names.length ? names.join('、') : '还没有选择';
  }

  function ensureScopeSkeleton() {
    const panel = $('#scopePanel');
    if ($('#scopeEditor', panel)) return panel;
    panel.innerHTML = `<div class="scope-collapsed" id="scopeCollapsed" hidden>
        <p class="scope-summary"><span class="muted">扫描范围：</span><span id="scopeSummaryText"></span></p>
        <button type="button" class="btn btn-secondary btn-sm" data-act="scope-edit" aria-expanded="false" aria-controls="scopeEditor">修改</button>
      </div>
      <div class="scope-editor" id="scopeEditor" hidden>
        <div class="scope-head">
          <h2 id="scopeTitle">扫描范围</h2>
          <span class="muted">选择要扫描的磁盘或文件夹，至少一项</span>
          <button type="button" class="btn btn-ghost" id="scopeCollapseBtn" data-act="scope-collapse" hidden>收起</button>
        </div>
        <div class="scope-grid">
          <fieldset class="scope-set">
            <legend>磁盘</legend>
            <ul class="scope-list" id="scopeDisks"></ul>
          </fieldset>
          <fieldset class="scope-set">
            <legend>指定路径</legend>
            <div class="folder-input-row">
              <input type="text" class="text-input mono" id="folderPath" placeholder="输入或粘贴文件夹路径" aria-label="文件夹路径" aria-describedby="folderError" autocomplete="off" spellcheck="false">
              <button type="button" class="btn btn-secondary" id="addFolderBtn" data-act="add-folder">添加</button>
            </div>
            <p class="field-error" id="folderError" role="alert" hidden></p>
            <div class="folder-tools">
              <button type="button" class="btn btn-secondary btn-sm" id="pickFolderBtn" data-act="pick-folder">选择文件夹…</button>
              <div class="places" id="scopePlaces" role="group" aria-label="常用位置"></div>
            </div>
            <p class="muted scope-hint">文件夹在已选的磁盘里时，会按整个磁盘扫描。最多 ${MAX_FOLDERS} 个文件夹。</p>
          </fieldset>
        </div>
        <div class="scope-chosen">
          <span class="muted">已选</span>
          <ul class="chips" id="scopeChips" aria-label="已选的扫描范围"></ul>
        </div>
        <p class="scope-error result-fail" id="scopeError" role="alert" hidden></p>
      </div>`;
    return panel;
  }

  function renderIfChanged(el, html) {
    if (el.getAttribute('data-html') === html) return;
    el.setAttribute('data-html', html);
    renderInto(el, html);
  }

  function renderScope() {
    const st = S.state;
    const panel = ensureScopeSkeleton();
    if (!st || isUnsupported()) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    seedScope();
    const collapsed = !S.scope.editing && (isScanning() || hasScanResults());
    const collapsedEl = $('#scopeCollapsed');
    const editor = $('#scopeEditor');
    collapsedEl.hidden = !collapsed;
    editor.hidden = collapsed;
    panel.classList.toggle('is-collapsed', collapsed);
    setText($('#scopeSummaryText'), scopeSummaryText());
    $('#scopeCollapseBtn').hidden = !hasScanResults() && !isScanning();
    if (collapsed) return;

    const disks = st.disks || [];
    const diskHtml = disks
      .map((d) => {
        const notes = [];
        if (!d.deletable || d.kind !== 'internal') notes.push('<span class="badge">只扫描，不可删除</span>');
        if (d.kind === 'network') notes.push('<span class="badge">网络盘</span>');
        else if (d.kind === 'external') notes.push('<span class="badge">外接盘</span>');
        return `<li class="scope-row">
          <label class="scope-label">
            <input type="checkbox" class="checkbox" data-act="scope-disk" data-fk="sd:${esc(d.id)}" value="${esc(d.id)}" ${S.scope.diskIds.has(d.id) ? 'checked' : ''}>
            <span class="item-main">
              <span class="scope-name">${esc(d.label)} ${notes.join('')}</span>
              <span class="item-meta"><span class="mono">${esc(d.mount || '')}</span><span>已用 ${fmtBytes(d.usedBytes)} · 共 ${fmtBytes(d.totalBytes)}</span></span>
            </span>
          </label>
        </li>`;
      })
      .join('');
    renderIfChanged($('#scopeDisks'), diskHtml);

    const full = S.scope.folders.length >= MAX_FOLDERS;
    const placesHtml = (st.places || []).length
      ? `<span class="muted">常用位置</span>${(st.places || [])
          .map(
            (pl) =>
              `<button type="button" class="btn btn-secondary btn-sm" data-act="add-place" data-path="${esc(pl.path)}" data-fk="pl:${esc(pl.id)}" title="${esc(pl.path)}" aria-label="添加常用位置：${esc(pl.label)}" ${full ? 'disabled' : ''}>${esc(pl.label)}</button>`,
          )
          .join('')}`
      : '';
    renderIfChanged($('#scopePlaces'), placesHtml);
    const pick = $('#pickFolderBtn');
    if (!pick.hasAttribute('data-busy')) pick.disabled = full;
    $('#addFolderBtn').disabled = full;
    $('#folderPath').disabled = full;
    if (full) showFolderError(`最多添加 ${MAX_FOLDERS} 个文件夹，移除一些后才能继续添加`);
    else if ($('#folderError').getAttribute('data-kind') === 'limit') showFolderError('');

    renderScopeChips();
  }

  function renderScopeChips(focusFk) {
    const box = $('#scopeChips');
    if (!box) return;
    const st = S.state || {};
    const sel = scopeSelection();
    const chips = [];
    sel.diskIds.forEach((id) => {
      const d = (st.disks || []).find((x) => x.id === id);
      const label = d ? d.label : id;
      chips.push(`<li class="chip"><span class="chip-kind">磁盘</span><span class="chip-text">${esc(label)}</span><button type="button" class="chip-remove" data-act="scope-remove-disk" data-id="${esc(id)}" data-fk="chip:d:${esc(id)}" aria-label="移除 ${esc(label)}"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></li>`);
    });
    S.scope.folders.forEach((f, i) => {
      const extra = f.deletable ? '' : '<span class="chip-note">只扫描</span>';
      chips.push(`<li class="chip"><span class="chip-kind">路径</span><span class="chip-text mono" title="${esc(f.path)}">${esc(shortPath(f.path))}</span>${extra}<button type="button" class="chip-remove" data-act="scope-remove-path" data-index="${i}" data-fk="chip:p:${esc(f.path)}" aria-label="移除 ${esc(f.path)}"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></li>`);
    });
    const html = chips.length ? chips.join('') : '<li class="chips-empty muted">还没有选择，先勾选磁盘或添加路径</li>';
    if (focusFk === undefined) {
      renderIfChanged(box, html);
    } else {
      box.setAttribute('data-html', html);
      renderInto(box, html);
    }
    if (focusFk !== undefined) {
      const t = focusFk ? box.querySelector(`[data-fk="${cssEscape(focusFk)}"]`) : null;
      const input = $('#folderPath');
      (t || (input && !input.disabled ? input : $('#scanBtn'))).focus();
    }
    updateScanButton();
  }

  function removeChip(el) {
    const li = el.closest('li');
    const sib = li && (li.nextElementSibling || li.previousElementSibling);
    const nextBtn = sib ? $('.chip-remove', sib) : null;
    let nextFk = nextBtn ? nextBtn.getAttribute('data-fk') : null;
    if (el.getAttribute('data-act') === 'scope-remove-disk') {
      S.scope.diskIds.delete(el.getAttribute('data-id'));
      const cb = $(`#scopeDisks input[value="${cssEscape(el.getAttribute('data-id'))}"]`);
      if (cb) cb.checked = false;
    } else {
      S.scope.folders.splice(Number(el.getAttribute('data-index')), 1);
    }
    renderScope();
    if (nextFk && !$(`#scopeChips [data-fk="${cssEscape(nextFk)}"]`)) nextFk = null;
    renderScopeChips(nextFk);
  }

  function showFolderError(msg) {
    const el = $('#folderError');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
    el.setAttribute('data-kind', msg && msg.startsWith('最多添加') ? 'limit' : '');
    const input = $('#folderPath');
    if (input) input.setAttribute('aria-invalid', msg && !msg.startsWith('最多添加') ? 'true' : 'false');
  }

  async function addFolderPath(raw) {
    const path = String(raw || '').trim();
    if (!path) {
      showFolderError('请先输入文件夹路径');
      return false;
    }
    if (S.scope.folders.length >= MAX_FOLDERS) {
      showFolderError(`最多添加 ${MAX_FOLDERS} 个文件夹，移除一些后才能继续添加`);
      return false;
    }
    let res;
    try {
      res = await api('api/validate-path', { method: 'POST', body: { path } });
    } catch (e) {
      showFolderError(pathErrorText(e.code));
      return false;
    }
    const norm = (res && res.path) || path;
    if (S.scope.folders.some((f) => f.path === norm)) {
      showFolderError('这个文件夹已经添加过了');
      return false;
    }
    S.scope.folders.push({ path: norm, diskId: (res && res.diskId) || '', deletable: !(res && res.deletable === false) });
    showFolderError('');
    $('#scopeError').hidden = true;
    renderScope();
    return true;
  }

  async function addFolderFromInput() {
    const input = $('#folderPath');
    if (!input) return;
    const ok = await addFolderPath(input.value);
    if (ok) input.value = '';
    if (!input.disabled) input.focus();
  }

  async function pickFolder(btn) {
    if (btn.hasAttribute('data-busy')) return;
    btn.setAttribute('data-busy', '1');
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = '请在弹出的窗口里选择';
    showFolderError('');
    let moveTo = btn;
    try {
      const res = await api('api/pick-folder', { method: 'POST', body: {} });
      if (res && res.path) await addFolderPath(res.path);
    } catch (e) {
      if (e.code === 'picker_unavailable') {
        showFolderError('系统选择框打不开，请粘贴路径');
        moveTo = $('#folderPath');
      } else if (e.code === 'picker_open') {
        showFolderError('选择框已经打开，请先在弹出的窗口里完成选择');
      } else {
        showFolderError('没能打开选择框，请粘贴路径');
        moveTo = $('#folderPath');
      }
    } finally {
      btn.removeAttribute('data-busy');
      btn.removeAttribute('aria-busy');
      btn.textContent = '选择文件夹…';
      btn.disabled = S.scope.folders.length >= MAX_FOLDERS;
      if (moveTo && !moveTo.disabled && !$('#scopeEditor').hidden) moveTo.focus();
    }
  }

  function setScopeEditing(on, focus) {
    S.scope.editing = on;
    renderScope();
    if (!focus) return;
    if (on) {
      const first = $('#scopeDisks input') || $('#folderPath');
      if (first) first.focus();
    } else {
      $('#scopeCollapsed [data-act="scope-edit"]').focus();
    }
  }

  function updateScanButton() {
    const btn = $('#scanBtn');
    const st = S.state;
    if (!st || isUnsupported()) {
      btn.textContent = '开始扫描';
      btn.disabled = true;
      btn.removeAttribute('title');
      return;
    }
    if (isScanning()) {
      btn.textContent = '取消扫描';
      btn.disabled = false;
      btn.removeAttribute('title');
      return;
    }
    btn.textContent = hasScanResults() ? '重新扫描' : '开始扫描';
    const empty = scopeEmpty();
    btn.disabled = empty;
    if (empty) btn.title = '请先选择扫描范围';
    else btn.removeAttribute('title');
  }

  /* 清理记录 */
  async function openHistory(opener) {
    openModal({ kind: 'history', title: '清理记录', opener, body: loadingHtml('正在读取清理记录…') });
    try {
      const d = await api('api/history');
      if (modalKind !== 'history') return;
      const entries = (d && d.entries) || [];
      const trash = labels().trash;
      // 新条目 method === 'delete' 是直接删除；没有 method 的旧条目当时是移到废纸篓/回收站，还能放回原处
      const isDeleted = (e) => e.method === 'delete';
      const hasLegacy = entries.some((e) => e.ok && !isDeleted(e));
      const body = entries.length
        ? `${hasLegacy ? `<p class="muted">之前移到${esc(trash)}的条目，可以在${esc(trash)}里放回原处；直接删除的条目不能恢复。</p>` : ''}
          <div class="table-wrap"><table class="data-table">
            <thead><tr><th scope="col">时间</th><th scope="col">路径</th><th scope="col">大小</th><th scope="col">结果</th></tr></thead>
            <tbody>${entries
              .map(
                (e) => `<tr>
                <td class="num">${esc(fmtDateTime(e.at))}</td>
                <td class="path-cell"><span class="mono truncate" style="display:block" title="${esc(e.path)}">${esc(e.path)}</span></td>
                <td class="num">${fmtBytes(e.bytes)}</td>
                <td>${e.ok ? `<span class="result-ok">${isDeleted(e) ? '已删除' : `已移到${esc(trash)}`}</span>` : `<span class="result-fail">失败：${esc(cleanErrorText(e.error))}</span>`}</td>
              </tr>`,
              )
              .join('')}</tbody>
          </table></div>`
        : '<div class="inline-note">还没有清理记录</div>';
      updateModal({ body });
    } catch (e) {
      if (modalKind === 'history') updateModal({ body: '<div class="inline-error" role="alert">没能读取清理记录，请稍后再试</div>' });
    }
  }

  /* 无权限的目录 */
  async function openDenied(opener, silent) {
    if (!silent) openModal({ kind: 'denied', title: '无权限的目录', opener, body: loadingHtml('正在读取…') });
    try {
      const d = await api('api/denied');
      if (modalKind !== 'denied') return;
      const st = S.state || {};
      const dirs = (d && d.dirs) || [];
      const count = (d && d.count) || dirs.length;
      // 列表为空时不显示授权引导：没有被拒绝的目录，就没有需要授权才能扫到的空间，引导是多余的。
      // 只给一行提示，并区分「扫描过但没遇到」和「还没扫描过」。
      if (!count && !dirs.length) {
        const note = hasScanResults() ? '这次扫描没有遇到无权限的目录' : '还没有扫描结果，扫描后再来看';
        updateModal({ body: `<div class="inline-note">${note}</div>` });
        return;
      }
      const parts = [];
      if (st.platform === 'darwin') {
        parts.push(`<p>MiniMax Code 没有读取这些目录的权限，它们占用的空间算在「未扫描或无权限」里。开启完全磁盘访问权限后可以扫全：</p>
          <ol class="steps">
            <li>打开系统设置 → 隐私与安全性 → 完全磁盘访问权限</li>
            <li>打开 MiniMax Code 旁边的开关</li>
            <li>重启 MiniMax Code，再回来重新扫描</li>
          </ol>
          <div><button type="button" class="btn btn-secondary" data-act="sysaction" data-action="mac-full-disk-access" data-fk="fda-open">打开完全磁盘访问权限设置</button></div>`);
      } else if (st.platform === 'win32') {
        parts.push('<p>其他用户的目录和系统目录会拒绝访问，这是正常现象。它们占用的空间算在「未扫描或无权限」里。</p>');
      }
      if (dirs.length) {
        parts.push(`<p class="muted">共 ${fmtCount(count)} 个目录${count > dirs.length ? `，只列出前 ${fmtCount(dirs.length)} 个` : ''}</p>
          <ul class="denied-list">${dirs
            .map(
              (x) =>
                `<li><span class="mono truncate" title="${esc(x.path)}">${esc(x.path)}</span><span class="muted" style="margin-left:auto;white-space:nowrap">${x.reason === 'permission' ? '没有权限' : '无法读取'}</span></li>`,
            )
            .join('')}</ul>`);
      } else {
        parts.push('<div class="inline-note">没有无权限的目录</div>');
      }
      updateModal({ body: parts.join('') });
    } catch (e) {
      if (modalKind === 'denied') updateModal({ body: '<div class="inline-error" role="alert">没能读取无权限的目录，请稍后再试</div>' });
    }
  }

  /* ---------- 已选清单抽屉 ---------- */

  let drawerOpener = null;
  let drawerLive = false;

  function closeDrawer() {
    const drawer = $('#drawer');
    if (drawer.open) drawer.close();
    onDrawerClosed();
  }

  function onDrawerClosed() {
    if (!drawerLive) return;
    drawerLive = false;
    const opener = drawerOpener;
    drawerOpener = null;
    $('#drawerBody').innerHTML = '';
    $('#drawerFoot').innerHTML = '';
    setTimeout(() => {
      if (!$('#modal').open) restoreFocus(opener);
    }, 0);
  }

  async function openDrawer(opener) {
    const drawer = $('#drawer');
    drawerOpener = opener;
    drawerLive = true;
    resetGroupView('dg');
    groupViews.dg.seenWarn = false;
    if (!drawer.open) drawer.showModal();
    $('#drawerClose').focus();
    await renderDrawer();
  }

  async function renderDrawer(focusFk) {
    const body = $('#drawerBody');
    const foot = $('#drawerFoot');
    if (!body.childElementCount) body.innerHTML = loadingHtml('正在读取已选清单…');
    try {
      const d = await api('api/selection');
      const items = (d && d.items) || [];
      syncSel(items.map((i) => ({ ...i, selected: true })));
      applySelSummary(d);
      if (!$('#drawer').open) return;
      body.setAttribute('aria-busy', 'false');
      const { groups } = buildSelGroups(items, false);
      // 含 git 或聊天文件的一组默认展开，方便核对
      if (!groupViews.dg.seenWarn && groups.some((g) => g.key === 'warn')) {
        groupViews.dg.open.add('warn');
        groupViews.dg.seenWarn = true;
      }
      renderInto(
        body,
        items.length
          ? `<p class="muted">共 ${fmtCount(d.count)} 项，可释放 <strong class="num">${fmtBytes(d.bytes)}</strong>。目录和它里面的条目同时选中时，只算外层目录。点组名展开。</p>
            ${selGroupsHtml('dg', groups)}`
          : '<div class="empty"><p>还没有选择任何条目</p></div>',
      );
      foot.innerHTML = items.length
        ? '<button type="button" class="btn btn-secondary" data-act="sel-clear">全部移出</button><span class="foot-note"></span><button type="button" class="btn btn-primary" data-act="drawer-clean">清理</button>'
        : '';
      renderSelBar();
      if (focusFk !== undefined) {
        const t = focusFk ? body.querySelector(`[data-fk="${cssEscape(focusFk)}"]`) : null;
        (t || $('#drawerClose')).focus();
      }
    } catch (e) {
      renderInto(body, '<div class="inline-error" role="alert">没能读取已选清单，请稍后再试</div>');
      foot.innerHTML = '';
    }
  }

  /* ---------- 已选清单分组（确认清理弹窗、已选清单抽屉共用） ---------- */

  const GROUP_FIRST = 50;
  const GROUP_STEP = 200;
  const groupViews = {
    cg: { groups: new Map(), open: new Set(), shown: new Map(), removable: false },
    dg: { groups: new Map(), open: new Set(), shown: new Map(), removable: true },
  };

  function resetGroupView(prefix) {
    const v = groupViews[prefix];
    v.groups = new Map();
    v.open = new Set();
    v.shown = new Map();
  }

  function itemBytes(it) {
    return typeof it.releasableBytes === 'number' ? it.releasableBytes : it.sizeBytes || 0;
  }

  function isWarnItem(it) {
    return (it.tags || []).some((t) => t === 'git' || t === 'chat');
  }

  /** 条目的来源分组。Node 还没给 source 时，统一归到「已选条目」 */
  function groupOf(it) {
    const src = it && it.source;
    if (!src || !src.type) return { key: 'other', label: '已选条目' };
    if (src.type === 'junk') {
      return { key: `junk:${src.categoryId || ''}`, label: CATEGORY_NAMES[src.categoryId] || '垃圾清理' };
    }
    return { key: src.type, label: SOURCE_LABELS[src.type] || '其他' };
  }

  /** warnApart：带 git、chat 标签的条目单列，不进分组 */
  function buildSelGroups(items, warnApart) {
    const warn = [];
    const map = new Map();
    items.forEach((it) => {
      if (warnApart && isWarnItem(it)) {
        warn.push(it);
        return;
      }
      const g = isWarnItem(it) && !warnApart ? { key: 'warn', label: '含 git 仓库或聊天文件' } : groupOf(it);
      let e = map.get(g.key);
      if (!e) {
        e = { key: g.key, label: g.label, items: [], bytes: 0 };
        map.set(g.key, e);
      }
      e.items.push(it);
      e.bytes += itemBytes(it);
    });
    const groups = Array.from(map.values());
    groups.forEach((g) => g.items.sort((a, b) => itemBytes(b) - itemBytes(a)));
    groups.sort((a, b) => (a.key === 'warn' ? -1 : b.key === 'warn' ? 1 : b.bytes - a.bytes));
    warn.sort((a, b) => itemBytes(b) - itemBytes(a));
    return { warn, groups };
  }

  function selRowHtml(it, removable) {
    const primary = it.name || it.path || '未命名条目';
    if (!removable) {
      return `<li><span class="mono truncate" title="${esc(it.path || primary)}">${esc(it.path || primary)}</span><span class="num">${fmtBytes(itemBytes(it))}</span></li>`;
    }
    return `<li>
      <div class="item-main">
        <span class="item-name truncate${it.name ? '' : ' mono'}" title="${esc(it.path || primary)}">${esc(primary)}</span>
        ${it.name && it.path ? `<span class="item-path mono truncate" title="${esc(it.path)}">${esc(it.path)}</span>` : ''}
        ${badgesHtml(it.tags) ? `<div class="item-meta">${badgesHtml(it.tags)}</div>` : ''}
      </div>
      <span class="item-size">${fmtBytes(itemBytes(it))}</span>
      <button type="button" class="btn btn-ghost" data-act="sel-remove" data-id="${esc(it.id)}" data-fk="rm:${esc(it.id)}" aria-label="移出：${esc(primary)}">移出</button>
    </li>`;
  }

  function groupBodyHtml(prefix, g) {
    const v = groupViews[prefix];
    const shown = Math.min(g.items.length, v.shown.get(g.key) || GROUP_FIRST);
    const rest = g.items.length - shown;
    const listCls = v.removable ? 'sel-list' : 'confirm-list';
    const more =
      rest > 0
        ? `<div class="group-more"><button type="button" class="btn btn-ghost" data-act="grp-more" data-prefix="${prefix}" data-key="${esc(g.key)}" data-fk="${prefix}:more:${esc(g.key)}">再显示 ${fmtCount(Math.min(GROUP_STEP, rest))} 项</button><span class="muted">还有 ${fmtCount(rest)} 项没有显示</span></div>`
        : '';
    return `<ul class="${listCls}">${g.items
      .slice(0, shown)
      .map((it) => selRowHtml(it, v.removable))
      .join('')}</ul>${more}`;
  }

  function selGroupsHtml(prefix, groups) {
    const v = groupViews[prefix];
    v.groups = new Map(groups.map((g) => [g.key, g]));
    return `<div class="sel-groups">${groups
      .map((g, i) => {
        const open = v.open.has(g.key);
        const bodyId = `${prefix}-g-${i}`;
        return `<section class="sel-group" data-group="${esc(g.key)}">
          <h3 class="sel-group-head"><button type="button" class="sel-group-btn" data-act="grp-toggle" data-prefix="${prefix}" data-key="${esc(g.key)}" data-fk="${prefix}:g:${esc(g.key)}" aria-expanded="${open}" aria-controls="${bodyId}">
            <span class="sel-group-chev" aria-hidden="true">${ICONS.chevron}</span>
            <span class="sel-group-name truncate">${esc(g.label)}</span>
            <span class="muted num">${fmtCount(g.items.length)} 项</span>
            <span class="num sel-group-bytes">${fmtBytes(g.bytes)}</span>
          </button></h3>
          <div class="sel-group-body" id="${bodyId}"${open ? '' : ' hidden'}>${open ? groupBodyHtml(prefix, g) : ''}</div>
        </section>`;
      })
      .join('')}</div>`;
  }

  function findGroupSection(prefix, key) {
    const root = prefix === 'cg' ? $('#modalBody') : $('#drawerBody');
    return root ? root.querySelector(`.sel-group[data-group="${cssEscape(key)}"]`) : null;
  }

  function toggleGroup(prefix, key) {
    const v = groupViews[prefix];
    const g = v.groups.get(key);
    const sec = findGroupSection(prefix, key);
    if (!g || !sec) return;
    const open = !v.open.has(key);
    if (open) v.open.add(key);
    else v.open.delete(key);
    sec.querySelector('.sel-group-btn').setAttribute('aria-expanded', String(open));
    const body = sec.querySelector('.sel-group-body');
    body.hidden = !open;
    renderInto(body, open ? groupBodyHtml(prefix, g) : '');
  }

  function showMoreInGroup(prefix, key) {
    const v = groupViews[prefix];
    const g = v.groups.get(key);
    const sec = findGroupSection(prefix, key);
    if (!g || !sec) return;
    const before = Math.min(g.items.length, v.shown.get(key) || GROUP_FIRST);
    v.shown.set(key, before + GROUP_STEP);
    const body = sec.querySelector('.sel-group-body');
    renderInto(body, groupBodyHtml(prefix, g));
    // 「再显示」按钮消失时，焦点落到新显示的第一项附近
    if (!body.contains(document.activeElement)) {
      const rows = body.querySelectorAll('li');
      const target = rows[before] ? rows[before].querySelector('button') : null;
      (target || sec.querySelector('.sel-group-btn')).focus();
    }
  }

  /* ---------- 清理 ---------- */

  async function openCleanConfirm(opener) {
    const trash = labels().trash;
    if (isScanning()) {
      toastError('扫描结束后才能清理');
      return;
    }
    openModal({ kind: 'clean', title: '确认删除', opener, body: loadingHtml('正在读取已选清单…'), foot: '' });
    let d;
    try {
      d = await api('api/selection');
    } catch (e) {
      if (modalKind === 'clean') updateModal({ body: '<div class="inline-error" role="alert">没能读取已选清单，请稍后再试</div>' });
      return;
    }
    if (modalKind !== 'clean') return;
    applySelSummary(d);
    const items = ((d && d.items) || []).slice();
    if (!items.length) {
      updateModal({ body: '<div class="inline-note">已选清单是空的</div>', foot: '<span class="foot-note"></span><button type="button" class="btn btn-secondary" data-modal="cancel">关闭</button>' });
      return;
    }
    S.clean.itemIds = items.map((i) => i.id);
    resetGroupView('cg');
    const { warn, groups } = buildSelGroups(items, true);
    const warnCount = warn.length;
    const list = warn
      .map((it) => {
        const tags = it.tags || [];
        const warns = [];
        if (tags.includes('git')) warns.push('含 git 仓库，未提交的改动会一起删除，不能恢复');
        if (tags.includes('chat')) warns.push('聊天软件文件，删除后聊天记录里的图片、视频、文件可能打不开');
        const size = itemBytes(it);
        return `<li class="${warns.length ? 'is-warn' : ''}">
          <span class="mono truncate" title="${esc(it.path || it.name)}">${esc(it.path || it.name)}</span>
          <span class="num">${fmtBytes(size)}</span>
          ${warns.map((w) => `<span class="warn-text">${ICONS.warn}<span>${esc(w)}</span></span>`).join('')}
        </li>`;
      })
      .join('');
    updateModal({
      body: `<div class="confirm-summary"><strong>${fmtBytes(d.bytes)}</strong><span class="muted">共 ${fmtCount(d.count)} 项，将直接删除</span></div>
        <div class="banner banner-error" role="note">直接删除，不进${esc(trash)}，删除后不能恢复</div>
        ${
          warnCount
            ? `<section class="sel-warn" aria-labelledby="selWarnTitle">
                <h3 id="selWarnTitle" class="result-heading">需要特别确认（${fmtCount(warnCount)} 项）</h3>
                <div class="banner banner-warn" role="note">这些条目含 git 仓库或聊天文件，全部列在这里，请逐项确认</div>
                <ul class="confirm-list" aria-label="含 git 仓库或聊天文件的条目">${list}</ul>
              </section>`
            : ''
        }
        ${groups.length ? `<h3 class="result-heading">按来源分组（点组名展开）</h3>${selGroupsHtml('cg', groups)}` : ''}`,
      foot: `<span class="foot-note"></span>
        <button type="button" class="btn btn-secondary" data-modal="cancel">取消</button>
        <button type="button" class="btn btn-danger" data-modal="confirm-clean">删除</button>`,
      focus: '[data-modal="cancel"]',
    });
  }

  async function confirmClean() {
    const ids = S.clean.itemIds || [];
    if (!ids.length) return;
    $$('#modalFoot button').forEach((b) => {
      b.disabled = true;
    });
    try {
      const res = await api('api/clean', { method: 'POST', body: { itemIds: ids } });
      S.clean.jobId = res && res.jobId;
      S.clean.progress = { done: 0, total: ids.length, freedBytes: 0, failed: 0, finished: false };
      renderCleanProgress();
      reconcileClean();
    } catch (e) {
      let msg = '没能开始清理，请稍后再试';
      if (e.code === 'not_selected') msg = '已选清单有变化，请关闭后重新确认';
      else if (e.status === 409) msg = '正在扫描或清理，请等结束后再试';
      updateModal({
        foot: `<span class="foot-note result-fail" role="alert">${esc(msg)}</span><button type="button" class="btn btn-secondary" data-modal="cancel">关闭</button>`,
        focus: '[data-modal="cancel"]',
      });
    }
  }

  function renderCleanProgress() {
    if (modalKind !== 'clean') return;
    const p = S.clean.progress || { done: 0, total: 0, freedBytes: 0, failed: 0 };
    const pct = p.total ? (p.done / p.total) * 100 : 0;
    updateModal({
      title: '正在删除',
      body: `<div role="status">已处理 <strong class="num">${fmtCount(p.done)}</strong> / ${fmtCount(p.total)} 项，已释放 <strong class="num">${fmtBytes(p.freedBytes)}</strong>${p.failed ? `，失败 ${fmtCount(p.failed)} 项` : ''}</div>
        <div class="progress-track" role="progressbar" aria-label="清理进度" aria-valuemin="0" aria-valuemax="${p.total}" aria-valuenow="${p.done}"><span style="width:${pct.toFixed(1)}%"></span></div>
        <p class="muted">可以关闭这个窗口，清理会在后台继续。</p>`,
      foot: '<span class="foot-note"></span><button type="button" class="btn btn-secondary" data-modal="cancel">关闭</button>',
    });
  }

  function onCleanEvent(ev) {
    if (!ev || !S.clean.jobId || ev.jobId !== S.clean.jobId) return;
    S.clean.progress = ev;
    if (ev.finished) fetchCleanResult();
    else renderCleanProgress();
  }

  async function reconcileClean() {
    const jobId = S.clean.jobId;
    if (!jobId) return;
    try {
      const d = await api(`api/clean?jobId=${encodeURIComponent(jobId)}`);
      if (d && d.finished) showCleanResult(d);
    } catch (e) {
      /* 重连后再试 */
    }
  }

  async function fetchCleanResult() {
    const jobId = S.clean.jobId;
    if (!jobId) return;
    try {
      const d = await api(`api/clean?jobId=${encodeURIComponent(jobId)}`);
      showCleanResult(d);
    } catch (e) {
      S.clean.jobId = null;
      if (modalKind === 'clean') {
        updateModal({
          title: '清理结束',
          body: '<div class="inline-error" role="alert">清理已结束，但没能读取结果。请打开「更多 → 清理记录」查看</div>',
          foot: '<span class="foot-note"></span><button type="button" class="btn btn-primary" data-modal="cancel">完成</button>',
          focus: '[data-modal="cancel"]',
        });
      } else {
        toastError('清理已结束，请在「清理记录」里查看结果');
      }
    }
  }

  function showCleanResult(d) {
    S.clean.jobId = null;
    const results = (d && d.results) || [];
    const ok = results.filter((r) => r.ok);
    const fail = results.filter((r) => !r.ok);
    const summary = `本次释放 ${fmtBytes(d.freedBytes)}，成功 ${fmtCount(ok.length)} 项${fail.length ? `，失败 ${fmtCount(fail.length)} 项` : ''}`;
    loadState();
    refreshCurrent();
    if (modalKind !== 'clean' || !$('#modal').open) {
      if (fail.length) toastError(`清理完成：${summary}`);
      else toast(`清理完成：${summary}`);
      return;
    }
    const failHtml = fail.length
      ? `<h3 class="result-heading">失败的条目</h3>
        <ul class="confirm-list">${fail
          .map(
            (r) => `<li><span class="mono truncate" title="${esc(r.path)}">${esc(r.path)}</span><span class="result-fail">${esc(cleanErrorText(r.error))}</span></li>`,
          )
          .join('')}</ul>`
      : '';
    updateModal({
      title: '清理完成',
      body: `<div class="confirm-summary" role="status"><span>本次释放</span><strong>${fmtBytes(d.freedBytes)}</strong><span class="muted">已删除</span></div>
        <p><span class="result-ok">成功 ${fmtCount(ok.length)} 项</span>${fail.length ? `，<span class="result-fail">失败 ${fmtCount(fail.length)} 项</span>` : ''}</p>
        ${failHtml}`,
      foot: '<span class="foot-note"></span><button type="button" class="btn btn-primary" data-modal="cancel">完成</button>',
      focus: '[data-modal="cancel"]',
    });
  }

  /* ---------- 安全的 Markdown 子集渲染（问 Agent 的回答） ---------- */
  // 先整段 HTML 转义，再把有限的语法换成固定标签：不输出原始 HTML，不生成链接，不带任何事件或 style 属性。

  const MD_UL = /^\s*[-*+]\s+(.*)$/;
  const MD_OL = /^\s*(\d{1,9})[.)]\s+(.*)$/;
  const MD_HR = /^\s*([-*_])(\s*\1){2,}\s*$/;

  /** 行内语法。输入必须是已转义的文本 */
  function mdInline(escaped) {
    const codes = [];
    let t = escaped.replace(/(`+)([^`\n]|[^`\n][^\n]*?[^`\n])\1(?!`)/g, (m, ticks, code) => {
      codes.push(code);
      return `\u0000${codes.length - 1}\u0000`;
    });
    // 链接和图片只显示文字和网址，避免页面被导航走
    t = t.replace(/!?\[([^\]\n]*)\]\(([^)\s]+)(?:\s+&quot;[^\n]*?&quot;)?\)/g, (m, text, url) => (text ? `${text}（${url}）` : url));
    t = t.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*\w])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?!\*)/g, '$1<em>$2</em>');
    t = t.replace(/(^|[^_\w])_(?=[^\s_])([^_\n]*?[^\s_])_(?![_\w])/g, '$1<em>$2</em>');
    return t.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code>${codes[Number(i)]}</code>`);
  }

  function mdText(lines) {
    return mdInline(esc(lines.join('\n'))).replace(/\n/g, '<br>');
  }

  /** 块级语法：标题、代码块、列表、引用、分隔线、段落。流式输出时没闭合的代码块按代码块显示 */
  function renderMarkdown(src, depth) {
    const level = depth || 0;
    const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let para = [];
    const flush = () => {
      if (para.length) out.push(`<p>${mdText(para)}</p>`);
      para = [];
    };
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const fence = line.match(/^\s*(`{3,}|~{3,})\s*([\w+#.-]*)/);
      if (fence) {
        flush();
        const close = new RegExp(`^\\s*${fence[1][0] === '`' ? '`' : '~'}{${fence[1].length},}\\s*$`);
        const body = [];
        i += 1;
        while (i < lines.length && !close.test(lines[i])) {
          body.push(lines[i]);
          i += 1;
        }
        i += 1;
        out.push(`<pre class="md-code"><code>${esc(body.join('\n'))}</code></pre>`);
        continue;
      }
      if (!line.trim()) {
        flush();
        i += 1;
        continue;
      }
      const h = line.match(/^(#{1,3})\s+(.*?)\s*#*\s*$/);
      if (h) {
        flush();
        const tag = `h${h[1].length + 2}`;
        out.push(`<${tag} class="md-h">${mdInline(esc(h[2]))}</${tag}>`);
        i += 1;
        continue;
      }
      if (MD_HR.test(line)) {
        flush();
        out.push('<hr class="md-hr">');
        i += 1;
        continue;
      }
      if (/^\s*>/.test(line)) {
        flush();
        const quote = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          quote.push(lines[i].replace(/^\s*>\s?/, ''));
          i += 1;
        }
        const inner = level < 3 ? renderMarkdown(quote.join('\n'), level + 1) : `<p>${mdText(quote)}</p>`;
        out.push(`<blockquote class="md-quote">${inner}</blockquote>`);
        continue;
      }
      if (MD_UL.test(line) || MD_OL.test(line)) {
        flush();
        const ordered = !MD_UL.test(line);
        const re = ordered ? MD_OL : MD_UL;
        const start = ordered ? Number(line.match(MD_OL)[1]) : 1;
        const items = [];
        while (i < lines.length) {
          const l = lines[i];
          const m = l.match(re);
          if (m) {
            items.push([ordered ? m[2] : m[1]]);
            i += 1;
          } else if (items.length && /^\s{2,}\S/.test(l)) {
            items[items.length - 1].push(l.trim());
            i += 1;
          } else {
            break;
          }
        }
        const lis = items.map((parts) => `<li>${mdText(parts)}</li>`).join('');
        out.push(ordered ? `<ol class="md-list"${start > 1 ? ` start="${start}"` : ''}>${lis}</ol>` : `<ul class="md-list">${lis}</ul>`);
        continue;
      }
      para.push(line);
      i += 1;
    }
    flush();
    return out.join('');
  }

  /* ---------- 问 Agent ---------- */

  /** @returns {MiniAppAgentAPI | null} */
  function getAgent() {
    const a = window.mcode && window.mcode.miniapp && window.mcode.miniapp.agent;
    return a && typeof a.run === 'function' ? a : null;
  }

  function askBusy() {
    return !!(S.ask.requestId || S.ask.preparing);
  }

  function openAskPanel(opener) {
    const panel = $('#askPanel');
    if (opener) S.ask.opener = opener;
    panel.hidden = false;
    $('#askClose').focus();
  }

  function closeAskPanel() {
    const panel = $('#askPanel');
    if (panel.hidden) return;
    panel.hidden = true;
    restoreFocus(S.ask.opener);
  }

  function askAlert(msg, warn) {
    const el = $('#askAlert');
    el.textContent = msg || '';
    el.classList.toggle('is-warn', !!warn);
    el.hidden = !msg;
  }

  function askStatus(msg, spinning) {
    const el = $('#askStatus');
    el.innerHTML = msg ? `${spinning ? '<span class="spinner" aria-hidden="true"></span>' : ''}<span>${esc(msg)}</span>` : '';
  }

  function refreshAskControls() {
    $('#askStop').disabled = !S.ask.requestId;
    $('#askOpen').hidden = !S.ask.sessionId;
  }

  function resetAskPanel(subject) {
    S.ask.sessionId = null;
    S.ask.text = '';
    S.ask.needBreak = false;
    $('#askTitle').textContent = '问 Agent';
    $('#askSubject').textContent = subject || '';
    $('#askOutput').textContent = '';
    $('#askOutput').setAttribute('data-placeholder', 'Agent 的回答会显示在这里');
    $('#askPerms').innerHTML = '';
    $('#askQuestion').hidden = true;
    $('#askQuestion').innerHTML = '';
    $('#askPanel').classList.remove('is-unsupported');
    askAlert('');
    askStatus('');
    refreshAskControls();
  }

  async function askAgent(id, name, opener, path) {
    if (askBusy()) {
      openAskPanel(opener);
      askAlert('上一个提问还没结束。请先点「停止」，再问新的条目。', true);
      return;
    }
    resetAskPanel(path || name);
    openAskPanel(opener);
    const agent = getAgent();
    if (!agent) {
      $('#askPanel').classList.add('is-unsupported');
      askAlert('当前环境不支持问 Agent，请在 MiniMax Code 桌面端打开', true);
      return;
    }
    S.ask.preparing = true;
    askStatus('正在准备提问…', true);
    let ctx;
    try {
      ctx = await api(`api/ask-context?id=${encodeURIComponent(id)}`);
    } catch (e) {
      S.ask.preparing = false;
      askStatus('');
      askAlert('没能读取这个条目的信息，请重新扫描后再试');
      return;
    }
    S.ask.preparing = false;
    if (!ctx || typeof ctx.prompt !== 'string') {
      askStatus('');
      askAlert('没能读取这个条目的信息，请重新扫描后再试');
      return;
    }
    const title = ctx.title || name || '';
    $('#askTitle').textContent = `问 Agent：${title}`;
    if ($('#askSubject').textContent === title) $('#askSubject').textContent = '';
    const requestId = newRequestId();
    S.ask.requestId = requestId;
    refreshAskControls();
    askStatus('已发给 Agent，等待回答…', true);

    /** @param {MiniAppAgentRunEvent} ev */
    const onEvent = (ev) => {
      if (!ev || S.ask.requestId !== requestId) {
        if (ev && ev.type === 'permission.requested') addPermCard(agent, ev);
        return;
      }
      switch (ev.type) {
        case 'run.queued':
          askStatus(`正在排队，前面还有 ${Math.max(0, (ev.position || 1) - 1)} 个提问`, true);
          break;
        case 'turn.started':
          if (!S.ask.sessionId) {
            S.ask.sessionId = ev.sessionId;
            refreshAskControls();
          }
          askStatus('Agent 正在回答…', true);
          break;
        case 'text.delta':
          if (S.ask.needBreak && S.ask.text.trim()) {
            // 上一段消息已经提交或中间调用了工具，新的一段另起一段
            const tail = S.ask.text.endsWith('\n\n') ? '' : S.ask.text.endsWith('\n') ? '\n' : '\n\n';
            S.ask.text += tail;
          }
          S.ask.needBreak = false;
          appendAskText(ev.text || '');
          break;
        case 'message.committed':
          S.ask.needBreak = true;
          break;
        case 'tool.started':
          S.ask.needBreak = true;
          askStatus(`Agent 正在使用工具：${ev.name || ''}`, true);
          break;
        case 'tool.finished':
          askStatus('Agent 正在回答…', true);
          break;
        case 'permission.requested':
          addPermCard(agent, ev);
          askStatus('Agent 想使用工具，需要你确认', false);
          break;
        default:
          break;
      }
    };

    try {
      const result = await agent.run({ text: ctx.prompt, requestId }, { onEvent });
      if (result && result.sessionId) S.ask.sessionId = result.sessionId;
      if (result && result.text && !S.ask.text) {
        S.ask.text = result.text;
        $('#askOutput').innerHTML = renderMarkdown(result.text);
      }
      if (result && result.status === 'aborted') askStatus('已停止');
      else if (result && result.status === 'error') {
        askStatus('');
        askAlert('Agent 没能完成回答，请稍后再试。');
      } else askStatus('回答完成');
      if (result && result.pendingQuestion) showPendingQuestion(result.pendingQuestion);
    } catch (e) {
      const code = e && typeof e === 'object' && 'message' in e ? String(e.message) : '';
      askStatus('');
      askAlert(agentErrorText(code, !!S.ask.sessionId), code === 'cancelled');
    } finally {
      if (S.ask.requestId === requestId) S.ask.requestId = null;
      refreshAskControls();
    }
  }

  function appendAskText(text) {
    const out = $('#askOutput');
    const nearBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 40;
    S.ask.text += text;
    out.innerHTML = renderMarkdown(S.ask.text);
    if (nearBottom) out.scrollTop = out.scrollHeight;
  }

  function showPendingQuestion(pq) {
    const box = $('#askQuestion');
    const req = pq.request || {};
    const lines = [];
    if (req.title) lines.push(req.title);
    (req.steps || []).forEach((s) => {
      if (s.question) lines.push(s.question);
    });
    box.innerHTML = `<strong>Agent 的问题</strong><span>${esc(lines.join('\n') || 'Agent 提了一个问题')}</span><span class="muted">Agent 需要你补充信息，请点「在对话中打开」继续</span>`;
    box.hidden = false;
  }

  function addPermCard(agent, ev) {
    const box = $('#askPerms');
    const card = document.createElement('div');
    card.className = 'perm-card';
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', `权限请求：${ev.toolName || ''}`);
    let input = typeof ev.toolInput === 'string' ? ev.toolInput : '';
    if (input.length > 300) input = `${input.slice(0, 300)}…`;
    card.innerHTML = `<h3>Agent 想使用工具：<span class="mono">${esc(ev.toolName || '')}</span></h3>
      ${ev.reason ? `<p>${esc(ev.reason)}</p>` : ''}
      ${input ? `<pre class="perm-input mono">${esc(input)}</pre>` : ''}
      <p class="perm-note muted" role="status"></p>
      <div class="perm-actions">
        <button type="button" class="btn btn-secondary btn-sm" data-decision="deny">拒绝</button>
        <button type="button" class="btn btn-primary btn-sm" data-decision="allowOnce">允许一次</button>
      </div>`;
    const note = $('.perm-note', card);
    card.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-decision]');
      if (!btn) return;
      const decision = btn.getAttribute('data-decision');
      $$('[data-decision]', card).forEach((b) => {
        b.disabled = true;
      });
      agent
        .reply({ sessionId: ev.sessionId, requestId: ev.requestId, decision })
        .then(() => {
          note.textContent = decision === 'allowOnce' ? '已允许一次' : '已拒绝';
          $('.perm-actions', card).remove();
          if (S.ask.requestId) askStatus('Agent 正在回答…', true);
          setTimeout(() => card.remove(), 2500);
        })
        .catch((err) => {
          const code = err && err.message ? String(err.message) : '';
          if (code === 'request_not_found') {
            note.textContent = '这个请求已经失效';
            $('.perm-actions', card).remove();
          } else {
            note.textContent = '没能提交你的选择，请重试';
            $$('[data-decision]', card).forEach((b) => {
              b.disabled = false;
            });
          }
        });
    });
    box.appendChild(card);
  }

  function stopAsk() {
    const agent = getAgent();
    if (agent && S.ask.requestId) {
      agent.cancel(S.ask.requestId);
      askStatus('正在停止…', true);
    }
  }

  async function openAskSession() {
    const agent = getAgent();
    if (!agent || !S.ask.sessionId) return;
    try {
      await agent.open(S.ask.sessionId);
    } catch (e) {
      const code = e && e.message ? String(e.message) : '';
      if (code === 'not_permitted') askAlert('只有从对话里打开的 Mini App 才能跳到对话。', true);
      else if (code === 'session_not_found') askAlert('找不到这次对话。');
      else if (code === 'runtime_unavailable' || code === 'result_unknown') askAlert('暂时没能打开对话，请稍后再点一次。', true);
      else askAlert('没能打开对话，请稍后再试。');
    }
  }

  /* ---------- 事件绑定 ---------- */

  function onClick(e) {
    const target = e.target;
    if (!(target instanceof Element)) return;

    const menuItem = target.closest('[data-menu]');
    if (menuItem) {
      onMenuChoose(menuItem.getAttribute('data-menu'));
      return;
    }
    if (!target.closest('.menu-wrap')) closeMenu(false);

    const itemMenuItem = target.closest('[data-item-menu]');
    if (itemMenuItem) {
      onItemMenuChoose(itemMenuItem.getAttribute('data-item-menu'));
      return;
    }
    if (!target.closest('#itemMenu') && !target.closest('[data-act="item-more"]')) closeItemMenu(false);

    const modalBtn = target.closest('[data-modal]');
    if (modalBtn) {
      const a = modalBtn.getAttribute('data-modal');
      if (a === 'cancel') closeModal();
      else if (a === 'confirm-clean') confirmClean();
      else if (a === 'confirm-rescan') {
        closeModal();
        startScan();
      } else if (a === 'confirm-prune') {
        doPrune(modalBtn.getAttribute('data-id'));
      } else if (a === 'confirm-ignore') {
        doIgnore(modalBtn.getAttribute('data-id'));
      }
      return;
    }

    const sector = target.closest('#sunburst .sector[data-enter]');
    if (sector) {
      goTree(sector.getAttribute('data-enter'));
      return;
    }
    if (target.closest('#sunburst [data-up]')) {
      const crumbs = (slots.tree.data && slots.tree.data.breadcrumbs) || [];
      if (crumbs.length > 1) goTree(crumbs[crumbs.length - 2].id);
      return;
    }

    const el = target.closest('[data-act]');
    if (!el) return;
    const act = el.getAttribute('data-act');
    const id = el.getAttribute('data-id');
    switch (act) {
      case 'expand': {
        const cat = el.getAttribute('data-cat');
        if (S.expanded.has(cat)) S.expanded.delete(cat);
        else S.expanded.add(cat);
        renderJunk();
        break;
      }
      case 'ask':
        askAgent(id, el.getAttribute('data-name') || '', el, el.getAttribute('data-path') || '');
        break;
      case 'reveal':
        reveal(id);
        break;
      case 'rescan':
        rescanDir(id);
        break;
      case 'sysaction':
        systemAction(el.getAttribute('data-action'));
        break;
      case 'goto-dup':
        S.largeView = 'dup';
        setTab('large', true);
        break;
      case 'largeview':
        if (S.largeView !== el.getAttribute('data-v')) {
          S.largeView = el.getAttribute('data-v');
          renderLarge();
          refreshCurrent();
        }
        break;
      case 'mapview':
        if (S.mapView !== el.getAttribute('data-v')) {
          S.mapView = el.getAttribute('data-v');
          renderMap();
          refreshCurrent();
        }
        break;
      case 'enter':
      case 'crumb':
        goTree(id);
        break;
      case 'keep-newest':
        keepNewest(el);
        break;
      case 'retry':
        if (!S.state) loadState();
        refreshCurrent();
        break;
      case 'retry-state':
        loadState();
        break;
      case 'goto-cat':
        gotoCategory(el.getAttribute('data-cat'));
        break;
      case 'clear-search':
        clearSearch(el.getAttribute('data-scope'));
        break;
      case 'item-more':
        openItemMenu(el);
        break;
      case 'pick-folder':
        pickFolder(el);
        break;
      case 'add-folder':
        addFolderFromInput();
        break;
      case 'add-place':
        addFolderPath(el.getAttribute('data-path'));
        break;
      case 'scope-remove-disk':
      case 'scope-remove-path':
        removeChip(el);
        break;
      case 'scope-edit':
        setScopeEditing(true, true);
        break;
      case 'scope-collapse':
        setScopeEditing(false, true);
        break;
      case 'ignore-restore':
        restoreIgnored(id, el);
        break;
      case 'repo-toggle':
        toggleRepo(id);
        break;
      case 'grp-toggle':
        toggleGroup(el.getAttribute('data-prefix'), el.getAttribute('data-key'));
        break;
      case 'grp-more':
        showMoreInGroup(el.getAttribute('data-prefix'), el.getAttribute('data-key'));
        break;
      case 'repo-deps':
        selectRepoDeps(id);
        break;
      case 'repo-prune':
        openPrune(id, el.getAttribute('data-name') || '', el);
        break;
      case 'repo-recheck':
        recheckRepos();
        break;
      case 'wt-retry':
        loadWorktrees(id);
        break;
      case 'open-denied':
        openDenied(el);
        break;
      case 'sel-remove': {
        const li = el.closest('li');
        const sib = li && (li.nextElementSibling || li.previousElementSibling);
        const nextBtn = sib ? $('[data-act="sel-remove"]', sib) : null;
        const nextFk = nextBtn ? nextBtn.getAttribute('data-fk') : null;
        setSelected([id], false).then(() => renderDrawer(nextFk));
        break;
      }
      case 'sel-clear':
        clearSelection();
        break;
      case 'drawer-clean':
        closeDrawer();
        openCleanConfirm($('#cleanBtn'));
        break;
      default:
        break;
    }
  }

  async function keepNewest(btn) {
    btn.disabled = true;
    try {
      const res = await api('api/duplicates/keep-newest', { method: 'POST', body: {} });
      applySelSummary(res);
      toast('每组保留最新的一份，其余副本已加入已选清单');
      await load('dup');
    } catch (e) {
      toastError('没能加入已选清单，请稍后再试');
    } finally {
      if (document.contains(btn)) btn.disabled = false;
    }
  }

  async function clearSelection() {
    try {
      const res = await api('api/selection', { method: 'POST', body: { clear: true } });
      S.sel.clear();
      applySelSummary(res);
      await renderDrawer();
      $('#drawerClose').focus();
    } catch (e) {
      toastError('没能清空已选清单，请重试');
    }
  }

  function onChange(e) {
    const el = e.target;
    if (!(el instanceof Element)) return;
    const act = el.getAttribute('data-act');
    if (act === 'sel') {
      setSelected([el.getAttribute('data-id')], el.checked);
    } else if (act === 'cat') {
      const catId = el.getAttribute('data-cat');
      const ids = S.catIds[catId] || [];
      const allOn = ids.length > 0 && ids.every((id) => S.sel.has(id));
      if (S.junkQuery.q) {
        if (allOn) setSelected(ids, false);
        else setSelected(ids.filter((id) => !S.sel.has(id)), true);
      } else {
        setCategorySelected(catId, !allOn);
      }
    } else if (act === 'scope-disk') {
      if (el.checked) S.scope.diskIds.add(el.value);
      else S.scope.diskIds.delete(el.value);
      $('#scopeError').hidden = true;
      renderScopeChips();
      setText($('#scopeSummaryText'), scopeSummaryText());
    } else if (act === 'map-root') {
      S.mapRootId = el.value;
      S.treeId = null;
      S.mapDiskNotice = '';
      resetMapQuery();
      slots.types.data = null;
      load('tree');
      if (S.mapView === 'types') load('types');
    } else if (el.hasAttribute('data-sort')) {
      const scope = el.getAttribute('data-sort');
      if (scope === 'junk') {
        S.junkQuery.sort = el.value;
        load('junk');
      } else if (scope === 'large') {
        S.largeFilter.sort = el.value;
        load('large');
      } else if (scope === 'repos') {
        S.reposQuery.sort = el.value;
        load('repos');
      } else {
        S.mapQuery.sort = el.value;
        renderMapList();
      }
    } else if (act === 'filter-kind') {
      S.largeFilter.kind = el.value;
      load('large');
    } else if (act === 'filter-age') {
      S.largeFilter.minAgeDays = el.value;
      load('large');
    } else if (act === 'map-disk') {
      S.mapDiskChosen = el.value;
      S.treeId = null;
      S.mapDiskNotice = '';
      slots.types.data = null;
      load('tree');
      if (S.mapView === 'types') load('types');
    }
  }

  const searchTimers = {};

  function onSearchInput(el) {
    const scope = el.getAttribute('data-search');
    const v = el.value.trim();
    if (scope === 'map') {
      S.mapQuery.q = v;
      renderMapList();
      return;
    }
    clearTimeout(searchTimers[scope]);
    searchTimers[scope] = setTimeout(() => {
      if (scope === 'junk') {
        if (S.junkQuery.q === v) return;
        S.junkQuery.q = v;
        load('junk');
      } else if (scope === 'large') {
        if (S.largeFilter.q === v) return;
        S.largeFilter.q = v;
        load('large');
      } else if (scope === 'repos') {
        if (S.reposQuery.q === v) return;
        S.reposQuery.q = v;
        load('repos');
      }
    }, 300);
  }

  function clearSearch(scope) {
    const input = $(`[data-search="${scope}"]`);
    if (input) input.value = '';
    clearTimeout(searchTimers[scope]);
    if (scope === 'junk') {
      S.junkQuery.q = '';
      load('junk');
    } else if (scope === 'large') {
      S.largeFilter.q = '';
      load('large');
    } else if (scope === 'repos') {
      S.reposQuery.q = '';
      load('repos');
    } else {
      S.mapQuery.q = '';
      renderMapList();
    }
    if (input) input.focus();
  }

  function onTabKey(e) {
    const tabs = $$('#tablist [role="tab"]');
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next >= 0) {
      e.preventDefault();
      setTab(tabs[next].getAttribute('data-tab'), true);
    }
  }

  function bindMapHover() {
    const panel = $('#panel-map');
    panel.addEventListener('mouseover', (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const sector = t.closest('#sunburst .sector');
      if (sector) {
        setHot(sector.getAttribute('data-top'), sector);
        return;
      }
      const row = t.closest('.map-row');
      if (row) {
        setHot(row.getAttribute('data-top'), null);
        return;
      }
      if (S.hot != null) setHot(null, null);
    });
    panel.addEventListener('mouseleave', () => setHot(null, null));
    panel.addEventListener('focusin', (e) => {
      const row = e.target instanceof Element ? e.target.closest('.map-row') : null;
      setHot(row ? row.getAttribute('data-top') : null, null);
    });
  }

  function init() {
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    $('#tablist').addEventListener('keydown', onTabKey);
    $$('#tablist [role="tab"]').forEach((t) => {
      t.addEventListener('click', () => setTab(t.getAttribute('data-tab'), false));
    });
    $('#scanBtn').addEventListener('click', onScanClick);
    $('#moreBtn').addEventListener('click', () => {
      if ($('#moreMenu').hidden) openMenu();
      else closeMenu(true);
    });
    $('#moreBtn').addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        openMenu();
      }
    });
    $('#moreMenu').addEventListener('keydown', onMenuKey);
    $('#viewSelBtn').addEventListener('click', (e) => openDrawer(e.currentTarget));
    $('#cleanBtn').addEventListener('click', (e) => openCleanConfirm(e.currentTarget));

    const modal = $('#modal');
    $('#modalClose').addEventListener('click', closeModal);
    modal.addEventListener('cancel', () => onModalClosed());
    modal.addEventListener('close', () => onModalClosed());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    const drawer = $('#drawer');
    $('#drawerClose').addEventListener('click', closeDrawer);
    drawer.addEventListener('cancel', () => onDrawerClosed());
    drawer.addEventListener('close', () => onDrawerClosed());
    drawer.addEventListener('click', (e) => {
      if (e.target === drawer) closeDrawer();
    });

    $('#askClose').addEventListener('click', closeAskPanel);
    $('#askStop').addEventListener('click', stopAsk);
    $('#askOpen').addEventListener('click', openAskSession);
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if ($('#modal').open || $('#drawer').open) return;
      if (!$('#itemMenu').hidden) {
        closeItemMenu(true);
        return;
      }
      if (!$('#moreMenu').hidden) {
        closeMenu(true);
        return;
      }
      if (!$('#askPanel').hidden) {
        e.preventDefault();
        closeAskPanel();
      }
    });

    bindMapHover();
    document.addEventListener('input', (e) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement) || !el.hasAttribute('data-search')) return;
      if (e.isComposing) return;
      onSearchInput(el);
    });
    document.addEventListener('compositionend', (e) => {
      const el = e.target;
      if (el instanceof HTMLInputElement && el.hasAttribute('data-search')) onSearchInput(el);
    });
    document.addEventListener('keydown', (e) => {
      const el = e.target;
      if (e.key === 'Enter' && el instanceof HTMLInputElement && el.id === 'folderPath' && !e.isComposing) {
        e.preventDefault();
        addFolderFromInput();
      }
    });
    $('#itemMenu').addEventListener('keydown', onItemMenuKey);
    window.addEventListener('scroll', () => closeItemMenu(false), { passive: true });
    window.addEventListener('resize', () => closeItemMenu(false));
    // 饼图扇区和图例互相高亮
    document.addEventListener('mouseover', (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const card = t.closest('.pie-card');
      $$('.pie-card.has-hot').forEach((c) => {
        if (c !== card) setPieHot(c, null);
      });
      if (card) {
        const k = t.closest('[data-pie-key]');
        setPieHot(card, k ? k.getAttribute('data-pie-key') : null);
      }
    });
    document.addEventListener('focusin', (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      $$('.pie-card.has-hot').forEach((c) => setPieHot(c, null));
      const k = t.closest('.pie-card [data-pie-key]');
      if (k) setPieHot(k.closest('.pie-card'), k.getAttribute('data-pie-key'));
    });
    renderTop();
    renderCurrent();
    loadState();
    connectEvents();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
