// 界面小工具：创建元素、图标、格式化、提示、对话框、弹层
const SVG_NS = 'http://www.w3.org/2000/svg';

export function h(sel, props, ...kids) {
  const parts = String(sel).split('.');
  const el = document.createElement(parts[0] || 'div');
  if (parts.length > 1) el.className = parts.slice(1).join(' ');
  if (props && typeof props === 'object' && !(props instanceof Node) && !Array.isArray(props)) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined) continue;
      // aria-* 要的是 "true" / "false" 这两个字符串，样式和读屏软件都认它；
      // 默认的「true 写成空属性」会让 [aria-pressed='true'] 这类选中态样式永远匹配不上
      if (typeof v === 'boolean' && k.startsWith('aria-')) {
        el.setAttribute(k, String(v));
        continue;
      }
      if (v === false) continue;
      if (k === 'class') el.className += (el.className ? ' ' : '') + v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (['checked', 'disabled', 'hidden', 'selected', 'open', 'readOnly'].includes(k)) el[k] = Boolean(v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  } else if (props !== undefined && props !== null) kids.unshift(props);
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    if (Array.isArray(k)) add(el, k);
    else if (k instanceof Node) el.append(k);
    else el.append(document.createTextNode(String(k)));
  }
}

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  code: '<path d="m7 8-4 4 4 4M17 8l4 4-4 4M14 4l-4 16"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  pencil: '<path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  sparkles: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  sliders: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
  filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  drive: '<path d="M22 12H2M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1zM6 16h.01M10 16h.01"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  git: '<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="9" r="2"/><path d="M6 8v8M18 11c0 4-6 3-12 5"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
};
export function icon(name, size) {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'ic');
  s.setAttribute('aria-hidden', 'true');
  if (size) {
    s.style.width = size + 'px';
    s.style.height = size + 'px';
  }
  s.innerHTML = ICONS[name] || '';
  return s;
}

// ---------- 格式化 ----------
/** 把 owner/repo 拆成两段；没有斜杠时 owner 是空的 */
export function splitName(full) {
  const s = String(full || '');
  const i = s.indexOf('/');
  return i > 0 ? [s.slice(0, i), s.slice(i + 1)] : ['', s];
}
export function fmtNum(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'k';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}
export function timeAgo(iso) {
  const t = Date.parse(iso);
  if (!t) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
  if (s < 86400 * 30) return Math.floor(s / 86400) + ' 天前';
  if (s < 86400 * 365) return Math.floor(s / 86400 / 30) + ' 个月前';
  return Math.floor(s / 86400 / 365) + ' 年前';
}
export function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
export function fmtDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + ' 秒';
  const m = Math.floor(s / 60);
  return m + ' 分 ' + String(s % 60).padStart(2, '0') + ' 秒';
}
export function fmtSize(kb) {
  kb = Number(kb) || 0;
  if (kb >= 1024 * 1024) return (kb / 1024 / 1024).toFixed(1) + ' GB';
  if (kb >= 1024) return (kb / 1024).toFixed(kb >= 10240 ? 0 : 1) + ' MB';
  return Math.max(1, Math.round(kb)) + ' KB';
}
export function langColor(lang) {
  if (!lang) return 'var(--mcode-text-subtle)';
  let x = 0;
  for (const c of lang) x = (x * 31 + c.charCodeAt(0)) % 360;
  return 'hsl(' + x + ' 55% 52%)';
}
/** 把文本里的关键词包成 <mark>，返回节点数组 */
export function markTerms(text, terms) {
  const t = String(text ?? '');
  if (!terms?.length || !t) return [t];
  const lower = t.toLowerCase();
  const spans = [];
  for (const term of terms) {
    let i = 0;
    while (term && (i = lower.indexOf(term, i)) >= 0 && spans.length < 40) {
      spans.push([i, i + term.length]);
      i += term.length;
    }
  }
  if (!spans.length) return [t];
  spans.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([s[0], s[1]]);
  }
  const out = [];
  let pos = 0;
  for (const [a, b] of merged) {
    if (a > pos) out.push(t.slice(pos, a));
    out.push(h('mark', null, t.slice(a, b)));
    pos = b;
  }
  if (pos < t.length) out.push(t.slice(pos));
  return out;
}
export function markRanges(text, ranges) {
  if (!ranges?.length) return [text];
  const out = [];
  let pos = 0;
  for (const [a, b] of ranges) {
    if (a > pos) out.push(text.slice(pos, a));
    out.push(h('mark', null, text.slice(a, b)));
    pos = b;
  }
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}

/** 和 replaceChildren 一样，但会忽略 null / undefined / false，并展开数组 */
export function fill(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false).map((k) => (k instanceof Node ? k : String(k))));
}

export const debounce = (fn, ms) => {
  let t = null;
  const wrapped = (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
};

// ---------- 提示 ----------
let toastBox = null;
// 模态对话框在浏览器「顶层」，普通元素再高的 z-index 也会被盖住；
// 提示用 popover 进顶层，并在每次出现时重新提到最上面。
function raiseToasts() {
  if (!toastBox || typeof toastBox.showPopover !== 'function') return;
  try {
    if (toastBox.matches(':popover-open')) toastBox.hidePopover();
    toastBox.showPopover();
  } catch {
    /* 不支持就保持普通层级 */
  }
}
export function toast(message, kind = '') {
  if (!toastBox) {
    toastBox = h('div.toasts', { role: 'status', 'aria-live': 'polite' });
    if (typeof toastBox.showPopover === 'function') toastBox.setAttribute('popover', 'manual');
    document.body.append(toastBox);
  }
  for (const old of [...toastBox.children]) if (old.textContent === message) old.remove();
  while (toastBox.children.length >= 3) toastBox.firstElementChild.remove();
  const el = h('div.toast' + (kind === 'err' ? '.err' : ''), null, message);
  if (kind === 'err') el.setAttribute('role', 'alert');
  toastBox.append(el);
  raiseToasts();
  setTimeout(() => {
    el.remove();
    if (toastBox && !toastBox.children.length && typeof toastBox.hidePopover === 'function') {
      try {
        if (toastBox.matches(':popover-open')) toastBox.hidePopover();
      } catch {
        /* ignore */
      }
    }
  }, kind === 'err' ? 6000 : 2800);
}

// ---------- 对话框 ----------
export function dialog({ title, body, footer, wide = false, onClose }) {
  const dlg = h('dialog' + (wide ? '.wide' : ''), { 'aria-label': title });
  const close = () => dlg.close();
  dlg.append(
    h('div.dlg', null,
      h('header', null, h('h2', null, title), h('button.btn.ghost.icon.sm', { type: 'button', 'aria-label': '关闭', onclick: close }, icon('x'))),
      h('div.bodyw', null, body),
      footer ? h('footer', null, footer) : null,
    ),
  );
  dlg.addEventListener('close', () => {
    onClose?.();
    dlg.remove();
  });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
  document.body.append(dlg);
  dlg.showModal();
  return Object.assign(dlg, { closeNow: close });
}

export function confirmDialog({ title, message, okText = '确定', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const ok = h('button.btn' + (danger ? '.danger' : '.primary'), { type: 'button', onclick: () => { result = true; dlg.close(); } }, okText);
    const dlg = dialog({
      title,
      body: h('p', { style: 'margin:0;padding:16px;white-space:pre-wrap' }, message),
      footer: [h('button.btn', { type: 'button', onclick: () => dlg.close() }, '取消'), ok],
      onClose: () => resolve(result),
    });
    ok.focus();
  });
}

/** 把一段说明收进「ⓘ」里：默认收起，点一下展开，再点一下收起。
 *  返回 { tog, note }：tog（那个 ⓘ）放在标题旁边，note（说明文字，默认藏着）放在标题下面。
 *  tog 用 span 而不用 button：放进 <label> 里时，button 会被当成这个 label 对应的控件，抢走点击。 */
export function info(text) {
  const note = h('span.tipnote', { hidden: true }, text);
  const tog = h('span.info', { role: 'button', tabindex: '0', 'aria-expanded': 'false', 'aria-label': '说明', title: '说明' }, 'ⓘ');
  const flip = (e) => {
    e.preventDefault(); // 在 <label> 里时，别让这一下点击转给输入框
    e.stopPropagation();
    const open = note.hidden;
    note.hidden = !open;
    tog.setAttribute('aria-expanded', String(open));
  };
  tog.addEventListener('click', flip);
  tog.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') flip(e);
  });
  return { tog, note };
}

/** 在按钮旁边打开一个小弹层。点外面、按 Esc、滚动、改变窗口大小都会关掉；返回关闭函数。
 *  打开时焦点会放进弹层里第一个能操作的控件，按 Esc 关掉后焦点回到按钮（键盘用户不会「丢」）。
 *  想做到「再点一次按钮就收起来」：用 onClose 记下它已经关了，下次点按钮时先看这个记录（见 view-main.js 的 toggleScopes）。 */
export function popover(anchor, content, { label = '', align = 'start', onClose } = {}) {
  const pop = h('div.pop', { role: 'dialog', 'aria-label': label || null }, content);
  const host = anchor.closest('dialog') || document.body;
  pop.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden';
  host.append(pop);
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  const left = align === 'end' ? r.right - pw : r.left;
  const below = r.bottom + 6;
  const above = r.top - 6 - ph;
  const top = below + ph > window.innerHeight - 8 && above >= 8 ? above : below;
  pop.style.left = Math.max(8, Math.min(left, window.innerWidth - pw - 8)) + 'px';
  pop.style.top = Math.max(8, Math.min(top, window.innerHeight - ph - 8)) + 'px';
  pop.style.visibility = '';
  let closed = false;
  const openedAt = performance.now();
  const off = (e) => {
    if (e.timeStamp < openedAt) return; // 打开它的那一下操作本身不算「点外面」
    if (pop.contains(e.target) || anchor.contains(e.target)) return;
    shut(false);
  };
  const key = (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation(); // 这一下 Esc 只用来关弹层，别再传给搜索框（它会把搜索词清掉）
    shut(true);
  };
  const away = (e) => {
    if (!pop.contains(e.target)) shut(false); // 弹层自己里面滚动不算
  };
  function shut(refocus) {
    if (closed) return;
    closed = true;
    document.removeEventListener('mousedown', off, true);
    document.removeEventListener('keydown', key, true);
    document.removeEventListener('scroll', away, true);
    window.removeEventListener('resize', onResize);
    const hadFocus = pop.contains(document.activeElement);
    pop.remove();
    onClose?.();
    if (refocus || hadFocus) anchor.focus?.();
  }
  const onResize = () => shut(false);
  // 立刻注册：不用 setTimeout 延后（延后的话，开得太快的下一次点击会比注册先到）
  document.addEventListener('mousedown', off, true);
  document.addEventListener('keydown', key, true);
  document.addEventListener('scroll', away, true);
  window.addEventListener('resize', onResize);
  pop.querySelector('input, button, select, textarea, [tabindex]')?.focus({ preventScroll: true });
  return () => shut(false);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { style: 'position:fixed;left:-999px;top:0', 'aria-hidden': 'true' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}
