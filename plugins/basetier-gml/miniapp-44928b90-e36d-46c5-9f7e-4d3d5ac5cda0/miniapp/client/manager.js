/* ============================================================
   GML 练习记录 · 项目存档管理器（Mini App 版）
   - 数据不再落在用户自选的文件夹，而是由 Mini App 的 Node 服务
     写进宿主分配的数据目录（GML-Saves / GML-Trash / GML-App）。
   - 打卡网页仍然以 iframe + srcdoc 载入，注入层（core/boot.js）
     把 localStorage 虚拟成「当前存档槽」，每次自动存档回传这里，
     由本文件转成业务请求交给 Node 服务落盘。
   ============================================================ */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var API = '/app/api/';
  var PREFIX = 'gml-practice-log-v2:';
  var APP_DEFAULT_URL = 'https://basetier-gml.github.io/gml-practice-log/';

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function clone(o) { return o === undefined ? o : JSON.parse(JSON.stringify(o)); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function hhmmss(t) {
    var d = t instanceof Date ? t : new Date(t);
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function fmtTime(t) {
    if (!t) return '—';
    var d = new Date(t);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hhmmss(d);
  }
  function fmtSize(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function safeFile(s) { return String(s || '存档').replace(/[\\/:*?"<>|]/g, '_').slice(0, 48); }

  /* ---------------- 弹层焦点管理（键盘可达性） ----------------
     统一接管三个弹层（回收站 / 通用对话框 / 应用来源）的开关：
     打开时记录来源元素并把焦点移进弹层，关闭时把焦点还给来源元素，
     Tab / Shift+Tab 在弹层内循环，Esc 关闭最上层弹层。            */
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  var overlayStack = [];
  var overlayCloser = Object.create(null);   /* 元素 id -> 额外的关闭清理逻辑 */

  function isVisible(el) {
    if (!el || el.hidden) return false;
    if (!el.getClientRects) return false;
    return el.getClientRects().length > 0;
  }

  function focusablesIn(root) {
    var list = root.querySelectorAll(FOCUSABLE), out = [];
    for (var i = 0; i < list.length; i++) if (isVisible(list[i])) out.push(list[i]);
    return out;
  }

  function topOverlay() {
    return overlayStack.length ? overlayStack[overlayStack.length - 1] : null;
  }

  function openOverlay(el, opts) {
    if (!el) return;
    opts = opts || {};
    if (overlayStack.indexOf(el) === -1) {
      var active = document.activeElement;
      el._returnFocus = (active && active !== document.body) ? active : null;
      overlayStack.push(el);
    }
    el.hidden = false;
    var target = opts.focus ? $(opts.focus) : null;
    if (!target || !isVisible(target)) {
      var list = focusablesIn(el);
      target = list[0] || null;
    }
    if (target) setTimeout(function () {
      try { target.focus(); if (typeof target.select === 'function' && target.value != null) target.select(); } catch (e) { }
    }, 30);
  }

  function closeOverlay(el) {
    if (!el) return;
    var i = overlayStack.indexOf(el);
    if (i !== -1) overlayStack.splice(i, 1);
    el.hidden = true;
    var back = el._returnFocus;
    el._returnFocus = null;
    if (back && back.focus && isVisible(back)) {
      setTimeout(function () { try { back.focus(); } catch (e) { } }, 0);
    }
  }

  document.addEventListener('keydown', function (e) {
    var top = topOverlay();
    if (!top) return;
    if (e.key === 'Escape') {
      var closer = overlayCloser[top.id];
      if (closer) { e.preventDefault(); closer(); }
      else closeOverlay(top);
      return;
    }
    if (e.key !== 'Tab') return;
    var list = focusablesIn(top);
    if (!list.length) { e.preventDefault(); return; }
    var first = list[0], last = list[list.length - 1];
    var cur = document.activeElement;
    if (!top.contains(cur)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
    if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
  });

  /* ---------------- 界面语言 ---------------- */
  var UI = { lang: 'zh' };
  function T(s, vars) {
    if (s == null) return '';
    var k = String(s), t;
    if (UI.lang === 'en' && has(EN, k)) t = EN[k];
    else if (has(ZH, k)) t = ZH[k];
    else t = k;
    if (vars) {
      t = t.replace(/\{s\}/g, function () { return String(vars.n) === '1' ? '' : 's'; });
      t = t.replace(/\{(\w+)\}/g, function (m, x) { return (vars[x] != null) ? vars[x] : m; });
    }
    return t;
  }

  /* ---------------- 业务请求 ---------------- */
  function api(path, options) {
    options = options || {};
    var init = { method: options.method || 'GET', headers: {} };
    if (options.body !== undefined) {
      init.headers['content-type'] = 'application/json; charset=utf-8';
      init.body = JSON.stringify(options.body);
    }
    return fetch(API + path, init).then(function (resp) {
      return resp.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!resp.ok) {
          var msg = (data && (data.error || data.message)) || ('HTTP ' + resp.status);
          throw new Error(String(msg));
        }
        return data;
      });
    });
  }

  /* ---------------- 全局状态 ---------------- */
  var vault = { saves: [], trash: [], skipped: [], lastOpenedId: null };
  var APP_INFO = { url: APP_DEFAULT_URL, version: '', fetchedAt: 0, size: 0, custom: false, builtinSize: 0 };
  var STORE = { projDir: '', trashDir: '', appDir: '', exportDir: '' };
  var SCAN = { at: 0, total: 0, ok: 0 };
  var activeId = null;
  var frame = null;
  var APP_HTML = null;
  var BOOT_SRC = null;
  var curStatus = null;
  var loadingKey = null;
  var LK_LOADING = '正在载入网页与项目…', LK_SLOW = '网页加载较慢，请稍候…（若一直空白可返回重试）';
  var pendingImport = null;
  var importMode = 'vault';
  var loadTimer = null;
  var rpcSeq = 0;
  var rpcPending = Object.create(null);
  var saveTimer = null;
  var saveChain = Promise.resolve();
  var dirtyIds = {};

  function toast(msg, kind) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'show' + (kind ? ' ' + kind : '');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.className = ''; }, 3000);
  }

  function dialog(opts) {
    return new Promise(function (resolve) {
      var m = $('#modal'), ok = $('#modalOk'), cancel = $('#modalCancel'), input = $('#modalInput');
      $('#modalTitle').textContent = opts.title || '';
      $('#modalDesc').textContent = opts.desc || '';
      $('#modalDesc').hidden = !opts.desc;
      $('#modalLabel').textContent = opts.label || T('名称');
      $('#modalLabel').hidden = !!opts.noInput;
      input.hidden = !!opts.noInput;
      input.value = opts.value || '';
      ok.textContent = opts.confirmText || T('确定');
      ok.className = 'btn ' + (opts.danger ? 'danger' : 'primary');
      overlayCloser.modal = function () { finish(null); };
      openOverlay(m, { focus: opts.noInput ? '#modalOk' : '#modalInput' });
      function finish(v) {
        delete overlayCloser.modal;
        closeOverlay(m);
        ok.onclick = null; cancel.onclick = null; m.onclick = null; input.onkeydown = null;
        resolve(v);
      }
      ok.onclick = function () { finish(opts.noInput ? true : input.value.trim()); };
      cancel.onclick = function () { finish(null); };
      m.onclick = function (e) { if (e.target === m) finish(null); };
      input.onkeydown = function (e) {
        if (e.key === 'Enter') { e.preventDefault(); ok.click(); }
      };
    });
  }

  /* ---------------- 读写数据 ---------------- */
  function loadState() {
    return api('state').then(function (state) {
      UI.lang = state.uiLang === 'en' ? 'en' : 'zh';
      vault.saves = state.saves || [];
      vault.trash = state.trash || [];
      vault.skipped = state.skipped || [];
      APP_INFO = state.app || APP_INFO;
      STORE = state.store || STORE;
      SCAN = state.scan || SCAN;
      var last = null;
      try { last = localStorage.getItem('gml-miniapp:last-project'); } catch (e) { last = null; }
      vault.lastOpenedId = vault.saves.some(function (s) { return s.id === last; })
        ? last
        : (vault.saves.length ? vault.saves[0].id : null);
      applyUiLang();
      renderManager();
      renderTrash();
      updateFsChip();
      return state;
    });
  }

  function slotStats(s) {
    function part(k, def) {
      try {
        var v = JSON.parse((s.data && s.data[PREFIX + k]) || 'null');
        return (v && typeof v === 'object') ? v : def;
      } catch (e) { return def; }
    }
    var records = part('records', {}), days = part('days', {}), apiPart = part('api', {}),
      user = part('user', {}), settings = part('settings', {});
    if (s.siteBackup) {
      var sd = s.siteBackup.data || s.siteBackup;
      var srecs = Array.isArray(sd.records) ? sd.records.length : (sd.records ? Object.keys(sd.records).length : 0);
      var sapis = Array.isArray(sd.apiLib) ? sd.apiLib.length : (sd.apiLib ? Object.keys(sd.apiLib).length : 0);
      return {
        recs: srecs, apis: sapis, days: 0, checkins: 0,
        nick: (sd.user && sd.user.name) || sd.nickname || T('编程新手'),
        goal: sd.dailyGoal || 5, size: JSON.stringify(s.data || {}).length, saves: s.saveCount || 0,
      };
    }
    var checkins = 0;
    for (var d in days) {
      var arr = days[d] && days[d].records;
      if (Array.isArray(arr)) checkins += arr.length;
    }
    return {
      recs: Object.keys(records).length,
      apis: Object.keys(apiPart).length,
      days: Object.keys(days).length,
      checkins: checkins,
      nick: user.name || T('编程新手'),
      goal: settings.dailyGoal || 5,
      size: JSON.stringify(s.data || {}).length,
      saves: s.saveCount || 0,
    };
  }

  function findSlot(id) {
    for (var i = 0; i < vault.saves.length; i++) if (vault.saves[i].id === id) return vault.saves[i];
    return null;
  }

  function ensureFileMeta(s) {
    if (!s.file) s.file = T('file_generic');
    if (s.fileSize == null) s.fileSize = JSON.stringify(s.data || {}).length;
    if (s.fileModified == null) s.fileModified = s.updatedAt || Date.now();
    if (!s.fileFormat) s.fileFormat = 'gml-pm-save';
    return s;
  }

  /* ---------------- 渲染 ---------------- */
  function cardHtml(s) {
    ensureFileMeta(s);
    var st = slotStats(s);
    var last = (s.id === vault.lastOpenedId);
    var site = !!s.siteBackup;
    return '<article class="card' + (last ? ' is-last' : '') + '" data-id="' + esc(s.id) + '">'
      + '<div class="card-top"><div class="card-title"><h3>' + esc(s.name) + '</h3></div>'
      + (last ? T('<span class="badge on">最近打开</span>') : '')
      + (site ? T('<span class="badge">网站原生存档</span>') : '') + '</div>'
      + '<div class="stats">'
      + '<div class="stat"><b>' + st.recs + T('</b><span>练习记录</span></div>')
      + '<div class="stat"><b>' + st.apis + '</b><span>API</span></div>'
      + '<div class="stat"><b>' + st.checkins + T('</b><span>打卡次数</span></div>')
      + '<div class="stat"><b>' + st.days + T('</b><span>练习天数</span></div></div>')
      + '<div class="fileinfo">'
      + T('<div class="fi-row"><span>📄 存档文件</span><em>') + esc(s.file) + '</em></div>'
      + T('<div class="fi-row"><span>大小</span><em>') + fmtSize(s.fileSize) + T('</em><span>· 最后保存</span><em>') + fmtTime(s.updatedAt) + '</em></div>'
      + T('<div class="fi-row"><span>格式</span><em>') + esc(s.fileFormat) + T('</em><span>· 自动存档</span><em>') + st.saves + T('</em> 次</div>')
      + '</div>'
      + '<div class="meta">昵称 <em>' + esc(st.nick) + T('</em> · 目标 <em>') + esc(st.goal) + T('</em> 次<br>')
      + T('创建 ') + fmtTime(s.createdAt) + '</div>'
      + '<div class="card-actions">'
      + T('<button class="btn primary" data-act="open">打开项目 →</button>')
      + T('<button class="btn mini" data-act="rename">重命名</button>')
      + T('<button class="btn mini" data-act="dup">复制</button>')
      + T('<button class="btn mini" data-act="export">导出</button>')
      + T('<button class="btn mini danger" data-act="del">移入回收站</button>')
      + '</div></article>';
  }

  function renderManager() {
    var list = vault.saves.slice().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    list.forEach(ensureFileMeta);
    $('#saveCount').textContent = T('{n} 个项目', { n: list.length });
    $('#emptyState').hidden = list.length > 0;
    $('#saveGrid').hidden = list.length === 0;
    if (!list.length) {
      $('#emptyState h3').textContent = T('no_saves');
      $('#emptyState p').innerHTML = T('no_saves_hint');
      $('#listHint').textContent = T('新建或导入项目后即可打开');
    } else {
      $('#listHint').textContent = T('点「打开项目」开始练习');
    }
    $('#saveGrid').innerHTML = list.map(cardHtml).join('');
    $('#trashCount').textContent = String(vault.trash.length);
    updateStoreInfo();
    renderScanBanner();
  }

  function updateStoreInfo() {
    var el = $('#storeInfo');
    if (!el) return;
    el.textContent = T('store_info_mc', { n: vault.saves.length });
  }

  function renderScanBanner() {
    var b = $('#scanBanner');
    if (!b) return;
    b.hidden = false;
    var bad = vault.skipped && vault.skipped.length;
    b.innerHTML = T('sb_scanned', {
      dir: esc(STORE.projDir || 'GML-Saves'),
      total: SCAN.total, ok: SCAN.ok, time: hhmmss(SCAN.at),
      bad: (bad ? T('sb_skipped', { n: bad, list: esc(vault.skipped.map(function (x) { return x.name; }).join('、')) }) : ''),
    });
  }

  function renderTrash() {
    var box = $('#trashList');
    $('#trashCount').textContent = String(vault.trash.length);
    $('#trashHeadInfo').textContent = T('共 {n} 个项目。', { n: vault.trash.length })
      + T('trash_head_mc', { dir: esc(STORE.trashDir || 'GML-Trash'), idx: 'trash-index.json' });
    if (!vault.trash.length) { box.innerHTML = T('trash_empty'); return; }
    box.innerHTML = vault.trash.slice().sort(function (a, b) { return (b.deletedAt || 0) - (a.deletedAt || 0); }).map(function (t) {
      return T('trash_item', {
        id: esc(t.id), name: esc(t.name), tag: T('回收站文件'),
        deleted: fmtTime(t.deletedAt), size: fmtSize(JSON.stringify(t.data || {}).length),
        file: (t.file ? ' · ' + esc(t.file) : ''), restore: T('恢复'), purge: T('彻底删除'),
      });
    }).join('');
  }

  function updateFsChip() {
    var chip = $('#fsChip'), txt = $('#fsChipText');
    chip.className = 'chip';
    txt.textContent = T('chip_data_dir');
    chip.title = STORE.projDir || '';
    var loc = $('#fsloc');
    loc.innerHTML = T('fsloc_mc', {
      proj: esc(STORE.projDir || 'GML-Saves'),
      trash: esc(STORE.trashDir || 'GML-Trash'),
      export: esc(STORE.exportDir || 'exports'),
      app: esc(STORE.appDir || 'GML-App'),
    });
  }

  function renderAppCard() {
    var tag = $('#appVerTag'), src = $('#appSrcText'), ver = $('#appVerText'),
      ft = $('#appFetchedText'), sz = $('#appSizeText');
    if (!tag) return;
    var custom = APP_INFO.custom;
    tag.textContent = custom ? T('app_custom') : T('app_builtin');
    tag.className = 'avert' + (custom ? ' custom' : '');
    src.textContent = APP_INFO.url || APP_DEFAULT_URL;
    src.title = APP_INFO.url || APP_DEFAULT_URL;
    if (custom) {
      ver.textContent = APP_INFO.version || '—';
      ft.textContent = APP_INFO.fetchedAt ? new Date(APP_INFO.fetchedAt).toLocaleString() : T('app_never_fetched');
      sz.textContent = APP_INFO.size ? fmtSize(APP_INFO.size) : '—';
    } else {
      ver.textContent = T('app_builtin');
      ft.textContent = '—';
      sz.textContent = fmtSize(APP_INFO.builtinSize || 0);
    }
  }

  function applyUiLang() {
    document.documentElement.setAttribute('lang', UI.lang === 'en' ? 'en' : 'zh-CN');
    document.title = T('GML 练习记录 · 项目存档管理器');
    var i, els;
    els = document.querySelectorAll('[data-i18n]');
    for (i = 0; i < els.length; i++) els[i].textContent = T(els[i].getAttribute('data-i18n'));
    els = document.querySelectorAll('[data-i18n-html]');
    for (i = 0; i < els.length; i++) els[i].innerHTML = T(els[i].getAttribute('data-i18n-html'));
    els = document.querySelectorAll('[data-i18n-title]');
    for (i = 0; i < els.length; i++) els[i].title = T(els[i].getAttribute('data-i18n-title'));
    els = document.querySelectorAll('[data-lang-set]');
    for (i = 0; i < els.length; i++) {
      var on = els[i].getAttribute('data-lang-set') === UI.lang;
      els[i].classList.toggle('on', on);
      els[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    renderManager(); renderTrash(); updateFsChip(); renderAppCard();
    if (curStatus) setStatus(curStatus.key, curStatus.ok, false, curStatus.vars);
    if (loadingKey) { var lt = $('#loadingText'); if (lt) lt.textContent = T(loadingKey); }
    var fr = $('#appFrame'); if (fr) fr.title = T('GML 代码练习记录');
  }

  function setUiLang(lang) {
    if (lang !== 'zh' && lang !== 'en') return;
    UI.lang = lang;
    applyUiLang();
    api('config', { method: 'PUT', body: { uiLang: lang } }).catch(function () { });
    if (frame && frame.contentWindow) {
      try { frame.contentWindow.postMessage({ __gml_pm: true, dir: 'to-app', type: 'ui-lang', lang: lang }, '*'); } catch (e) { }
      rpc('cmd', { name: 'lang', args: { lang: lang } }, 8000).catch(function () { });
    }
  }

  function setStatus(key, ok, flash, vars) {
    curStatus = { key: key, ok: ok, vars: vars };
    var p = $('#pstatus');
    $('#statusText').textContent = T(key, vars);
    p.className = 'pstatus' + (ok ? ' ok' : '') + (flash ? ' flash' : '');
    if (flash) setTimeout(function () { p.className = 'pstatus' + (ok ? ' ok' : ''); }, 750);
  }

  function showView(name) {
    $('#view-manager').hidden = (name !== 'manager');
    $('#view-project').hidden = (name !== 'project');
  }

  /* ---------------- 落盘 ---------------- */
  function persistSlot(id) {
    var slot = findSlot(id);
    if (!slot) return Promise.resolve();
    return api('projects/' + encodeURIComponent(id), { method: 'PUT', body: { data: slot.data || {} } })
      .then(function (res) {
        if (res) {
          slot.updatedAt = res.updatedAt || slot.updatedAt;
          slot.saveCount = res.saveCount || slot.saveCount;
        }
      });
  }

  function persist(ids) {
    var list = ids ? (Array.isArray(ids) ? ids : [ids]) : vault.saves.map(function (s) { return s.id; });
    list.forEach(function (x) { dirtyIds[x] = 1; });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      var ids2 = Object.keys(dirtyIds);
      dirtyIds = {};
      saveChain = saveChain.then(function () {
        return ids2.reduce(function (p, id) {
          return p.then(function () { return persistSlot(id); });
        }, Promise.resolve());
      }).catch(function (e) {
        toast(T('save_fail', { err: String((e && e.message) || e) }), 'err');
      });
    }, 150);
  }

  function persistNow() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    var ids = Object.keys(dirtyIds);
    dirtyIds = {};
    saveChain = saveChain.then(function () {
      return ids.reduce(function (p, id) {
        return p.then(function () { return persistSlot(id); });
      }, Promise.resolve());
    });
    return saveChain.catch(function (e) {
      toast(T('save_fail', { err: String((e && e.message) || e) }), 'err');
      throw e;
    });
  }

  /* ---------------- 内嵌打卡网页 ---------------- */
  function stripRemoteFonts(html) {
    return String(html)
      .replace(/<link[^>]*fonts\.googleapis\.com[^>]*>\s*/gi, '')
      .replace(/<link[^>]*fonts\.gstatic\.com[^>]*>\s*/gi, '');
  }

  function loadAppHtml() {
    if (APP_HTML) return Promise.resolve(APP_HTML);
    /* 这个接口返回的是网页源码（text/html），不能走 JSON 解析 */
    return fetch(API + 'app/html').then(function (r) { return r.text(); }).then(function (text) {
      APP_HTML = stripRemoteFonts(text);
      return APP_HTML;
    });
  }

  function loadBootSrc() {
    if (BOOT_SRC) return Promise.resolve(BOOT_SRC);
    return fetch('/app/core/boot.js').then(function (r) { return r.text(); }).then(function (text) {
      BOOT_SRC = text;
      return BOOT_SRC;
    });
  }

  function safeJson(o) {
    return JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }

  function buildSrcdoc(slot) {
    var setup = 'window.__GML_PM_BOOT__=' + safeJson({ saveId: slot.id, data: slot.data || {}, lang: UI.lang }) + ';\n';
    var inject = '<' + 'script>' + setup + BOOT_SRC + '<' + '/script>';
    return APP_HTML.replace('<head>', '<head>\n' + inject);
  }

  function openSlot(id) {
    var slot = findSlot(id);
    if (!slot) return Promise.resolve();
    activeId = id;
    vault.lastOpenedId = id;
    try { localStorage.setItem('gml-miniapp:last-project', id); } catch (e) { }
    pendingImport = slot.siteBackup ? slot.siteBackup : null;
    $('#projName').textContent = slot.name;
    showView('project');
    setStatus(T('正在载入网页…'), false);
    var stage = $('#stage');
    stage.innerHTML = '<div class="loading" id="loading"><div class="spinner"></div><div id="loadingText">' + T(LK_LOADING) + '</div></div>';
    loadingKey = LK_LOADING;

    return Promise.all([loadAppHtml(), loadBootSrc()]).then(function () {
      var f = document.createElement('iframe');
      f.id = 'appFrame';
      f.className = 'app-frame';
      f.title = T('GML 代码练习记录');
      f.setAttribute('allowfullscreen', '');
      frame = f;
      stage.insertBefore(f, stage.firstChild);
      f.srcdoc = buildSrcdoc(slot);
      clearTimeout(loadTimer);
      loadTimer = setTimeout(function () {
        var lt = $('#loadingText');
        if (lt && !$('#loading').hidden) { lt.textContent = T(LK_SLOW); loadingKey = LK_SLOW; }
      }, 9000);
    }).catch(function (e) {
      toast(T('load_fail', { err: String((e && e.message) || e) }), 'err');
      showView('manager');
    });
  }

  function closeProject() {
    /* 先等网页把待写数据 flush 回来，再拆 iframe；否则最后一次自动存档会丢 */
    var flushed = frame ? rpc('flush', {}, 2500).catch(function () { }) : Promise.resolve();
    return flushed.then(function () {
      if (frame) { try { frame.remove(); } catch (e) { } }
      frame = null; activeId = null; clearTimeout(loadTimer);
      return persistNow().catch(function () { });
    }).then(function () {
      return loadState();
    }).then(function () {
      showView('manager');
    });
  }

  /* ---------------- 宿主 ⇄ 网页消息 ---------------- */
  function rpc(type, extra, timeout) {
    return new Promise(function (resolve, reject) {
      if (!frame || !frame.contentWindow) { reject(new Error(T('网页尚未打开'))); return; }
      var id = 'r' + (++rpcSeq);
      var timer = setTimeout(function () { delete rpcPending[id]; reject(new Error(T('网页无响应（超时）'))); }, timeout || 12000);
      rpcPending[id] = { resolve: resolve, reject: reject, timer: timer };
      var msg = { __gml_pm: true, dir: 'to-app', id: id, type: type };
      if (extra) for (var k in extra) if (has(extra, k)) msg[k] = extra[k];
      try { frame.contentWindow.postMessage(msg, '*'); }
      catch (e) { clearTimeout(timer); delete rpcPending[id]; reject(e); }
    });
  }

  function handleCommit(d) {
    if (!activeId || d.saveId !== activeId) return;
    var slot = findSlot(activeId);
    if (!slot) return;
    slot.data = d.data || {};
    slot.updatedAt = d.ts || Date.now();
    slot.saveCount = (slot.saveCount || 0) + 1;
    persist(slot.id);
    setStatus(T('已自动保存 · {t}'), true, true, { t: hhmmss(slot.updatedAt) });
  }

  function onFrameReady() {
    var l = $('#loading'); if (l) l.hidden = true;
    clearTimeout(loadTimer);
    setStatus(T('自动存档已接管'), true);
    if (pendingImport) {
      var o = pendingImport; pendingImport = null;
      rpc('cmd', { name: 'import', args: { json: o } }).then(function (r) {
        if (r && r.ok === false) throw new Error(r.error || T('网页拒绝了这份存档'));
        toast(T('已把网站存档导入当前项目'), 'ok');
        return rpc('flush', {}, 4000);
      }).catch(function (e) { toast(T('import_fail', { err: e.message }), 'err'); });
    }
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.__gml_pm !== true || d.dir !== 'to-host') return;
    if (frame && e.source !== frame.contentWindow) return;
    if (d.type === 'commit') { handleCommit(d); return; }
    if (d.type === 'ready') { onFrameReady(); return; }
    var p = rpcPending[d.id];
    if (!p) return;
    delete rpcPending[d.id]; clearTimeout(p.timer);
    if (d.type === 'cmd-result') { if (d.ok) p.resolve(d.result); else p.reject(new Error(d.error || T('命令执行失败'))); }
    else p.resolve(true);
  });

  /* ---------------- 导入 / 导出 ---------------- */
  function download(name, text) {
    try {
      var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click();
      setTimeout(function () { try { document.body.removeChild(a); } catch (e) { } URL.revokeObjectURL(url); }, 1500);
      return true;
    } catch (e) { return false; }
  }

  function exportProject(id) {
    return api('export/project/' + encodeURIComponent(id)).then(function (res) {
      download(res.filename, res.text);
      toast(T('export_one_ok', { name: res.filename, path: res.path }), 'ok');
    }).catch(function (e) { toast(T('export_fail', { err: e.message }), 'err'); });
  }

  function exportAll() {
    return api('export/all').then(function (res) {
      download(res.filename, res.text);
      toast(T('export_all_ok', {
        n: vault.saves.length, t: vault.trash.length, path: res.path,
      }), 'ok');
    }).catch(function (e) { toast(T('export_fail', { err: e.message }), 'err'); });
  }

  function handleImportText(text, filename) {
    var base = filename.replace(/\.json$/i, '').slice(0, 40) || T('导入项目');
    if (importMode === 'backup') {
      if (!activeId) { toast(T('请先打开一个项目'), 'err'); return; }
      var obj;
      try { obj = JSON.parse(text); } catch (e) { toast(T('不是有效的 JSON 存档文件'), 'err'); return; }
      rpc('cmd', { name: 'import', args: { json: obj } }).then(function (r) {
        if (r && r.ok === false) throw new Error(r.error || T('网页拒绝了这份存档'));
        toast(T('备份已导入当前项目，并自动存档'), 'ok');
        return rpc('flush', {}, 4000);
      }).catch(function (e) { toast(T('import_fail', { err: e.message }), 'err'); });
      return;
    }
    api('import', { method: 'POST', body: { text: text, filename: filename } }).then(function (res) {
      return loadState().then(function () {
        if (res && res.project && res.project.siteBackup) {
          toast(T('import_opening'), 'ok');
          return openSlot(res.project.id);
        }
        toast(T('import_done', { n: (res && res.imported) || 1 }), 'ok');
      });
    }).catch(function (e) { toast(T('import_fail', { err: e.message }), 'err'); });
  }

  /* ---------------- 打卡网页版本 ---------------- */
  function openAppSource() {
    $('#appSrcInput').value = APP_INFO.url || APP_DEFAULT_URL;
    openOverlay($('#appSrcOverlay'), { focus: '#appSrcInput' });
  }

  function fetchLatestApp() {
    var url = (APP_INFO.url || '').trim();
    if (!/^https?:\/\//i.test(url)) { openAppSource(); toast(T('app_url_invalid'), 'err'); return Promise.resolve(); }
    var btn = $('#btnAppFetch');
    if (btn) { btn.disabled = true; btn.textContent = T('app_fetching'); }
    return api('app/fetch', { method: 'POST', body: { url: url } }).then(function (info) {
      APP_INFO = info;
      APP_HTML = null;
      renderAppCard();
      toast(T('app_fetched_ok', { v: info.version }), 'ok');
    }).catch(function (e) {
      toast(T('app_fetched_fail', { err: String((e && e.message) || e) }), 'err');
    }).finally(function () {
      if (btn) { btn.disabled = false; btn.textContent = T('app_btn_fetch'); }
    });
  }

  function restoreBuiltinApp() {
    return api('app/builtin', { method: 'POST' }).then(function (info) {
      APP_INFO = info;
      APP_HTML = null;
      renderAppCard();
      toast(T('app_reset_ok'), 'ok');
    }).catch(function (e) { toast(T('app_reset_fail', { err: String((e && e.message) || e) }), 'err'); });
  }

  /* ---------------- 事件绑定 ---------------- */
  $('#saveGrid').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var card = btn.closest('[data-id]');
    if (!card) return;
    var id = card.getAttribute('data-id');
    var act = btn.getAttribute('data-act');
    var slot = findSlot(id);
    if (!slot) return;
    if (act === 'open') { openSlot(id); return; }
    if (act === 'rename') {
      dialog({ title: T('重命名项目'), label: T('新名称'), value: slot.name, confirmText: T('保存') }).then(function (v) {
        if (!v) return;
        api('projects/' + encodeURIComponent(id), { method: 'PATCH', body: { name: v } })
          .then(function () { return loadState(); })
          .then(function () { toast(T('已重命名'), 'ok'); })
          .catch(function (err) { toast(T('rename_fail', { err: err.message }), 'err'); });
      });
      return;
    }
    if (act === 'dup') {
      api('projects/' + encodeURIComponent(id) + '/copy', { method: 'POST' })
        .then(function () { return loadState(); })
        .then(function () { toast(T('copy_done'), 'ok'); })
        .catch(function (err) { toast(T('copy_fail', { err: err.message }), 'err'); });
      return;
    }
    if (act === 'export') { exportProject(id); return; }
    if (act === 'del') {
      dialog({
        title: T('移入回收站'), noInput: true, danger: true, confirmText: T('移入回收站'),
        desc: T('「{name}」会被移动到回收站，并登记到清单里。可以随时恢复，数据不会立刻消失。', { name: slot.name }),
      }).then(function (ok) {
        if (!ok) return;
        api('projects/' + encodeURIComponent(id), { method: 'DELETE' })
          .then(function () { return loadState(); })
          .then(function () { toast(T('已移入回收站：{name}', { name: slot.name }), 'ok'); })
          .catch(function (err) { toast(T('delete_fail', { err: err.message }), 'err'); });
      });
    }
  });

  $('#trashList').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-tact]');
    if (!btn) return;
    var row = btn.closest('[data-id]');
    if (!row) return;
    var id = row.getAttribute('data-id');
    if (btn.getAttribute('data-tact') === 'restore') {
      api('trash/' + encodeURIComponent(id) + '/restore', { method: 'POST' })
        .then(function () { return loadState(); })
        .then(function () { toast(T('已恢复项目'), 'ok'); })
        .catch(function (err) { toast(T('restore_fail', { err: err.message }), 'err'); });
      return;
    }
    dialog({
      title: T('彻底删除'), noInput: true, danger: true, confirmText: T('永久删除'),
      desc: T('该项目将无法恢复，回收站里的文件也会被删除。'),
    }).then(function (ok) {
      if (!ok) return;
      api('trash/' + encodeURIComponent(id), { method: 'DELETE' })
        .then(function () { return loadState(); })
        .then(function () { toast(T('已彻底删除'), 'ok'); })
        .catch(function (err) { toast(T('delete_fail', { err: err.message }), 'err'); });
    });
  });

  $('#btnClearTrash').addEventListener('click', function () {
    if (!vault.trash.length) { toast(T('回收站已经是空的')); return; }
    dialog({
      title: T('清空回收站'), noInput: true, danger: true, confirmText: T('全部清空'),
      desc: T('将永久删除回收站里的 {n} 个项目，无法恢复。建议先「导出全部」备份。', { n: vault.trash.length }),
    }).then(function (ok) {
      if (!ok) return;
      api('trash/clear', { method: 'POST' })
        .then(function () { return loadState(); })
        .then(function () { toast(T('回收站已清空'), 'ok'); })
        .catch(function (err) { toast(T('clear_fail', { err: err.message }), 'err'); });
    });
  });

  $('#btnTrash').addEventListener('click', function () { renderTrash(); openOverlay($('#trashOverlay'), { focus: '#btnCloseTrash' }); });
  $('#btnCloseTrash').addEventListener('click', function () { closeOverlay($('#trashOverlay')); });
  $('#trashOverlay').addEventListener('click', function (e) { if (e.target === this) closeOverlay(this); });

  $('#fsChip').addEventListener('click', function () {
    var text = STORE.projDir || '';
    if (text && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast(T('copied_path'), 'ok');
      }).catch(function () {
        toast(text);
      });
    } else {
      toast(text || T('store_unavailable'));
    }
  });

  $('#scanBanner').addEventListener('click', function (e) {
    if (e.target.closest('#btnRescan')) {
      loadState().then(function () { toast(T('rescan_done'), 'ok'); });
    }
  });

  function newSlot() {
    dialog({
      title: T('新建项目'), label: T('项目名称'),
      value: T('练习项目 ') + (vault.saves.length + 1), confirmText: T('创建'),
    }).then(function (name) {
      if (!name) return;
      api('projects', { method: 'POST', body: { name: name } })
        .then(function () { return loadState(); })
        .then(function () { toast(T('created_project', { name: name }), 'ok'); })
        .catch(function (err) { toast(T('create_fail', { err: err.message }), 'err'); });
    });
  }
  $('#btnNew').addEventListener('click', newSlot);
  $('#btnNew2').addEventListener('click', newSlot);
  $('#btnExportAll').addEventListener('click', exportAll);
  $('#btnImport').addEventListener('click', function () { importMode = 'vault'; $('#fileInput').click(); });
  $('#fileInput').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () { handleImportText(String(reader.result), file.name); };
    reader.onerror = function () { toast(T('读取文件失败'), 'err'); };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  });

  $('#btnBack').addEventListener('click', function () { closeProject(); });
  $('#btnSaveNow').addEventListener('click', function () {
    var run = function () { return persistNow(); };
    if (frame) {
      rpc('flush', {}, 4000).then(run).catch(function () {
        return run();
      }).then(function () {
        toast(T('已写入当前项目文件'), 'ok');
        setStatus(T('已手动保存 · {t}'), true, true, { t: hhmmss(Date.now()) });
      }).catch(function (e) { toast(T('save_fail', { err: e.message }), 'err'); });
    } else {
      run().then(function () { toast(T('已写入当前项目文件'), 'ok'); })
        .catch(function (e) { toast(T('save_fail', { err: e.message }), 'err'); });
    }
  });

  $('#btnFork').addEventListener('click', function () {
    if (!activeId) return;
    var id = activeId;
    var run = function () { return api('projects/' + encodeURIComponent(id) + '/copy', { method: 'POST' }); };
    var flush = frame ? rpc('flush', {}, 4000).catch(function () { }) : Promise.resolve();
    flush.then(run).then(function (res) {
      return loadState().then(function () {
        toast(T('已另存为「{name}」（当前仍在编辑原项目）', { name: res.name }), 'ok');
      });
    }).catch(function (err) { toast(T('另存失败：{err}', { err: err.message }), 'err'); });
  });

  $('#btnRename').addEventListener('click', function () {
    if (!activeId) return;
    var id = activeId;
    var slot = findSlot(id);
    if (!slot) return;
    dialog({ title: T('重命名当前项目'), label: T('新名称'), value: slot.name, confirmText: T('保存') }).then(function (v) {
      if (!v) return;
      api('projects/' + encodeURIComponent(id), { method: 'PATCH', body: { name: v } })
        .then(function () { $('#projName').textContent = v; return loadState(); })
        .then(function () { toast(T('已重命名'), 'ok'); })
        .catch(function (err) { toast(T('rename_fail', { err: err.message }), 'err'); });
    });
  });

  $('#btnExportPm').addEventListener('click', function () {
    if (!activeId) return;
    var id = activeId;
    var flush = frame ? rpc('flush', {}, 4000).catch(function () { }) : Promise.resolve();
    flush.then(function () { return persistNow(); })
      .then(function () { return exportProject(id); })
      .catch(function (e) { toast(T('export_fail', { err: e.message }), 'err'); });
  });

  $('#btnExportSite').addEventListener('click', function () {
    rpc('cmd', { name: 'export', args: {} }).then(function (r) {
      if (!r || r.ok === false) throw new Error((r && r.error) || T('导出失败'));
      var slot = activeId ? findSlot(activeId) : null;
      var filename = T('网站存档-') + safeFile(slot ? slot.name : 'gml') + '.json';
      var text = JSON.stringify(r.payload);
      return api('export/file', { method: 'POST', body: { filename: filename, text: text } }).then(function (res) {
        download(filename, text);
        toast(T('export_site_ok', { path: res.path }), 'ok');
      });
    }).catch(function (e) { toast(T('export_fail', { err: e.message }), 'err'); });
  });

  $('#btnImportBackup').addEventListener('click', function () { importMode = 'backup'; $('#fileInput').click(); });

  document.addEventListener('click', function (e) {
    var t = e.target;
    var b = (t && t.closest) ? t.closest('[data-lang-set]') : null;
    if (!b) return;
    setUiLang(b.getAttribute('data-lang-set'));
  });

  $('#btnAppSource').addEventListener('click', openAppSource);
  $('#btnAppFetch').addEventListener('click', function () { fetchLatestApp(); });
  $('#btnAppBuiltin').addEventListener('click', function () { restoreBuiltinApp(); });
  $('#appSrcCancel').addEventListener('click', function () { closeOverlay($('#appSrcOverlay')); });
  $('#appSrcOverlay').addEventListener('click', function (e) { if (e.target === this) closeOverlay(this); });
  $('#appSrcOk').addEventListener('click', function () {
    var url = ($('#appSrcInput').value || '').trim();
    if (!/^https?:\/\//i.test(url)) { toast(T('app_url_invalid'), 'err'); return; }
    APP_INFO.url = url;
    closeOverlay($('#appSrcOverlay'));
    renderAppCard();
    fetchLatestApp();
  });

  /* 页面被隐藏时把待写数据立刻落盘，避免宿主回收后台进程时丢数据 */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      if (frame) { try { rpc('flush', {}, 1500).catch(function () { }); } catch (e) { } }
      persistNow().catch(function () { });
    }
  });

  /* ---------------- 启动 ---------------- */
  function boot() {
    renderAppCard();
    loadState().then(function () {
      return Promise.all([loadAppHtml(), loadBootSrc()]);
    }).catch(function (e) {
      toast(T('load_fail', { err: String((e && e.message) || e) }), 'err');
    });
  }
  boot();
})();
