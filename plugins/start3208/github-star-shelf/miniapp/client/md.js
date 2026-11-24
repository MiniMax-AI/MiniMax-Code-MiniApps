// Markdown / README 渲染。
// 流程：Markdown → HTML 字符串（保留文里写的 HTML）→ DOMParser 解析 → 按白名单重建节点。
// 页面里不会出现脚本、样式、表单、框架；链接只允许 http(s)/mailto；图片按设置只载入 GitHub 自家域名。

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const BLOCK_TAGS = new Set(['address', 'article', 'aside', 'blockquote', 'caption', 'center', 'col', 'colgroup', 'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'iframe', 'legend', 'li', 'main', 'menu', 'nav', 'ol', 'p', 'picture', 'section', 'source', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul']);
const RAW_END = new Set(['pre', 'script', 'style', 'textarea']);

const reFence = /^( {0,3})(`{3,}|~{3,})\s*([^`]*)$/;
const reAtx = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const reHr = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const reQuote = /^ {0,3}>/;
const reList = /^( {0,3})([*+-]|\d{1,9}[.)])( +|$)(.*)$/;
const reSetext = /^ {0,3}(=+|-+)[ \t]*$/;
const reTableSep = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const blank = (l) => /^\s*$/.test(l);

function htmlBlockStart(line) {
  const m = /^ {0,3}<(\/?)([A-Za-z][A-Za-z0-9-]*)(?=[\s/>]|$)/.exec(line);
  if (m) {
    const tag = m[2].toLowerCase();
    if (RAW_END.has(tag) && !m[1]) return { kind: 'raw', tag };
    if (BLOCK_TAGS.has(tag) || (m[1] && BLOCK_TAGS.has(tag))) return { kind: 'block' };
    return null;
  }
  if (/^ {0,3}<!--/.test(line)) return { kind: 'comment' };
  return null;
}

function startsBlock(line) {
  if (reFence.test(line) || reAtx.test(line) || reHr.test(line) || reQuote.test(line) || htmlBlockStart(line)) return true;
  const m = reList.exec(line);
  if (m && m[4] !== '' && (!/\d/.test(m[2][0]) || parseInt(m[2], 10) === 1)) return true;
  return false;
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  let tick = false;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === '`') tick = !tick;
    if (c === '\\' && s[i + 1] === '|') {
      cur += '|';
      i += 1;
    } else if (c === '|' && !tick) {
      cells.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

function inline(src, ctx) {
  const stash = [];
  const hold = (html) => {
    stash.push(html);
    return '\u0000' + (stash.length - 1) + '\u0000';
  };
  let s = String(src);
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!|~<>"'&])/g, (_, c) => hold(esc(c)));
  s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, _t, code) => hold('<code>' + esc(code.replace(/\n/g, ' ').replace(/^ (.+) $/, '$1')) + '</code>'));
  s = s.replace(/<((?:https?:\/\/|mailto:)[^\s<>]+)>/gi, (_, u) => hold('<a href="' + attr(u) + '">' + esc(u) + '</a>'));
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[^<>]*)?\/?>/g, (m) => hold(m));
  s = s.replace(/&(?!#?\w+;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const titleOf = (t1, t2) => {
    const t = t1 ?? t2;
    return t ? ' title="' + attr(t) + '"' : '';
  };
  const cleanUrl = (u) => (u.startsWith('&lt;') && u.endsWith('&gt;') ? u.slice(4, -4) : u);
  const un = (u) => u.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

  // 图片（含引用式）
  s = s.replace(/!\[([^\]]*)\]\(\s*((?:[^\s()]|\([^\s()]*\))*)(?:\s+(?:"([^"]*)"|'([^']*)'))?\s*\)/g, (_, alt, url, t1, t2) =>
    hold('<img alt="' + attr(un(alt)) + '" src="' + attr(un(cleanUrl(url))) + '"' + titleOf(t1, t2) + '>'),
  );
  s = s.replace(/!\[([^\]]*)\]\[([^\]]*)\]/g, (m, alt, ref) => {
    const d = ctx.refs.get((ref || alt).toLowerCase());
    return d ? hold('<img alt="' + attr(un(alt)) + '" src="' + attr(d.url) + '"' + titleOf(d.title) + '>') : m;
  });
  // 链接（含引用式）
  s = s.replace(/\[((?:[^[\]]|\[[^[\]]*\])*)\]\(\s*((?:[^\s()]|\([^\s()]*\))*)(?:\s+(?:"([^"]*)"|'([^']*)'))?\s*\)/g, (_, text, url, t1, t2) =>
    hold('<a href="' + attr(un(cleanUrl(url))) + '"' + titleOf(t1, t2) + '>' + emph(text) + '</a>'),
  );
  s = s.replace(/\[((?:[^[\]]|\[[^[\]]*\])+)\]\[([^\]]*)\]/g, (m, text, ref) => {
    const d = ctx.refs.get((ref || text).toLowerCase());
    return d ? hold('<a href="' + attr(d.url) + '"' + titleOf(d.title) + '>' + emph(text) + '</a>') : m;
  });
  if (ctx.refs.size) {
    s = s.replace(/\[([^[\]]+)\](?!\()/g, (m, text) => {
      const d = ctx.refs.get(text.toLowerCase());
      return d ? hold('<a href="' + attr(d.url) + '"' + titleOf(d.title) + '>' + emph(text) + '</a>') : m;
    });
  }
  // 裸链接
  s = s.replace(/(^|[\s(>])(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"\]])/g, (_, pre, u) => pre + hold('<a href="' + attr(un(u)) + '">' + u + '</a>'));
  s = emph(s);
  s = s.replace(/(?: {2,}|\\)\n/g, '<br>\n');
  for (let i = 0; i < 6 && /\u0000\d+\u0000/.test(s); i += 1) s = s.replace(/\u0000(\d+)\u0000/g, (_, n) => stash[Number(n)] ?? '');
  return s;
}

function emph(s) {
  return s
    .replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
    .replace(/\*(?=[^\s*])([\s\S]*?[^\s*])\*/g, '<em>$1</em>')
    .replace(/(^|[^\w])_(?=[^\s_])([\s\S]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
}

function parseList(lines, start, ctx) {
  const first = reList.exec(lines[start]);
  const ordered = /\d/.test(first[2][0]);
  const delim = ordered ? first[2].slice(-1) : first[2];
  const startNum = ordered ? parseInt(first[2], 10) : 1;
  const items = [];
  let loose = false;
  let i = start;
  while (i < lines.length) {
    const m = reList.exec(lines[i]);
    if (!m || reHr.test(lines[i])) break;
    const same = ordered ? /\d/.test(m[2][0]) && m[2].slice(-1) === delim : m[2] === delim;
    if (!same) break;
    const indent = m[1].length;
    const spaces = m[4] === '' || m[3].length > 4 ? 1 : m[3].length;
    const w = indent + m[2].length + spaces;
    const body = [m[3].length > 4 ? ' '.repeat(m[3].length - 1) + m[4] : m[4]];
    let j = i + 1;
    let sawBlank = false;
    while (j < lines.length) {
      const l = lines[j];
      if (blank(l)) {
        let k = j + 1;
        while (k < lines.length && blank(lines[k])) k += 1;
        if (k >= lines.length) {
          j = k;
          break;
        }
        const ind = lines[k].match(/^ */)[0].length;
        if (ind >= w) {
          for (let x = j; x < k; x += 1) body.push('');
          sawBlank = true;
          j = k;
          continue;
        }
        const nm = reList.exec(lines[k]);
        if (nm && ind < w && !reHr.test(lines[k])) loose = true;
        j = k;
        break;
      }
      const ind = l.match(/^ */)[0].length;
      if (ind >= w) {
        body.push(l.slice(w));
        j += 1;
        continue;
      }
      if (reList.test(l) && ind < w) break;
      if (!blank(body[body.length - 1] ?? '') && !startsBlock(l)) {
        body.push(l.trim());
        j += 1;
        continue;
      }
      break;
    }
    items.push({ body, sawBlank });
    i = j;
    if (j >= lines.length) break;
    if (blank(lines[j - 1] ?? '') || true) {
      /* 空行已被消费；下一行是否仍是同一个列表由循环顶部判断 */
    }
  }
  const tightAll = !loose && !items.some((it) => it.body.some((b, idx) => b === '' && idx > 0 && idx < it.body.length - 1 && it.body.slice(0, idx).some((x) => x !== '')));
  const html = items
    .map((it) => {
      let lead = it.body[0] ?? '';
      let task = '';
      const t = /^\[([ xX])\][ \t]+/.exec(lead);
      if (t) {
        task = '<span class="task">' + (t[1] === ' ' ? '\u2610' : '\u2611') + ' </span>';
        lead = lead.slice(t[0].length);
      }
      const inner = blocks([lead, ...it.body.slice(1)], ctx, tightAll);
      return '<li>' + task + inner + '</li>';
    })
    .join('');
  const tag = ordered ? 'ol' : 'ul';
  return { html: '<' + tag + (ordered && startNum !== 1 ? ' start="' + startNum + '"' : '') + '>' + html + '</' + tag + '>', next: i };
}

function blocks(lines, ctx, tight = false) {
  const out = [];
  const n = lines.length;
  let i = 0;
  while (i < n) {
    const line = lines[i];
    if (blank(line)) {
      i += 1;
      continue;
    }
    let m = reFence.exec(line);
    if (m) {
      const fence = m[2];
      const indent = m[1].length;
      const body = [];
      i += 1;
      while (i < n) {
        const l = lines[i];
        const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(l);
        if (close && close[1][0] === fence[0] && close[1].length >= fence.length) {
          i += 1;
          break;
        }
        body.push(l.replace(new RegExp('^ {0,' + indent + '}'), ''));
        i += 1;
      }
      out.push('<pre><code>' + esc(body.join('\n')) + '</code></pre>');
      continue;
    }
    m = reAtx.exec(line);
    if (m) {
      const level = m[1].length;
      out.push('<h' + level + '>' + inline((m[2] || '').trim(), ctx) + '</h' + level + '>');
      i += 1;
      continue;
    }
    if (reHr.test(line)) {
      out.push('<hr>');
      i += 1;
      continue;
    }
    const hb = htmlBlockStart(line);
    if (hb) {
      const buf = [];
      if (hb.kind === 'comment') {
        while (i < n) {
          buf.push(lines[i]);
          i += 1;
          if (/-->/.test(buf[buf.length - 1])) break;
        }
        continue;
      }
      if (hb.kind === 'raw') {
        const closeRe = new RegExp('</' + hb.tag + '\\s*>', 'i');
        while (i < n) {
          buf.push(lines[i]);
          i += 1;
          if (closeRe.test(buf[buf.length - 1])) break;
        }
        out.push(buf.join('\n'));
        continue;
      }
      while (i < n && !blank(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      out.push(buf.join('\n'));
      continue;
    }
    if (reQuote.test(line)) {
      const buf = [];
      while (i < n && (reQuote.test(lines[i]) || (!blank(lines[i]) && buf.length && !startsBlock(lines[i])))) {
        buf.push(lines[i].replace(/^ {0,3}> ?/, ''));
        i += 1;
      }
      out.push('<blockquote>' + blocks(buf, ctx) + '</blockquote>');
      continue;
    }
    if (reList.test(line) && !reHr.test(line)) {
      const r = parseList(lines, i, ctx);
      out.push(r.html);
      i = r.next;
      continue;
    }
    if (line.includes('|') && i + 1 < n && reTableSep.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = splitRow(line);
      const sep = splitRow(lines[i + 1]);
      if (head.length === sep.length) {
        const aligns = sep.map((c) => (/^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : /^:-+/.test(c) ? 'left' : ''));
        const cell = (tag, c, idx) => '<' + tag + (aligns[idx] ? ' align="' + aligns[idx] + '"' : '') + '>' + inline(c, ctx) + '</' + tag + '>';
        const rows = [];
        i += 2;
        while (i < n && !blank(lines[i]) && lines[i].includes('|')) {
          const cells = splitRow(lines[i]);
          rows.push('<tr>' + head.map((_, idx) => cell('td', cells[idx] ?? '', idx)).join('') + '</tr>');
          i += 1;
        }
        out.push('<div class="tablewrap"><table><thead><tr>' + head.map((c, idx) => cell('th', c, idx)).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>');
        continue;
      }
    }
    if (/^( {4}|\t)/.test(line)) {
      const buf = [];
      while (i < n && (/^( {4}|\t)/.test(lines[i]) || blank(lines[i]))) {
        buf.push(lines[i].replace(/^( {4}|\t)/, ''));
        i += 1;
      }
      while (buf.length && blank(buf[buf.length - 1])) buf.pop();
      out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>');
      continue;
    }
    const buf = [line];
    i += 1;
    let heading = 0;
    while (i < n && !blank(lines[i])) {
      const u = reSetext.exec(lines[i]);
      if (u) {
        heading = u[1][0] === '=' ? 1 : 2;
        i += 1;
        break;
      }
      if (startsBlock(lines[i])) break;
      buf.push(lines[i]);
      i += 1;
    }
    const text = inline(buf.map((l) => l.trim()).join('\n'), ctx);
    if (heading) out.push('<h' + heading + '>' + text + '</h' + heading + '>');
    else out.push(tight ? text : '<p>' + text + '</p>');
  }
  return out.join(tight ? '' : '\n');
}

function mdToHtml(src) {
  const text = String(src).replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  const refs = new Map();
  const kept = [];
  let fence = null;
  for (const line of text.split('\n')) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
    }
    if (!fence) {
      const d = /^ {0,3}\[([^\]]+)\]:\s*<?([^\s>]+)>?(?:\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?\s*$/.exec(line);
      if (d) {
        if (!refs.has(d[1].toLowerCase())) refs.set(d[1].toLowerCase(), { url: d[2], title: d[3] ?? d[4] ?? d[5] });
        continue;
      }
    }
    kept.push(line);
  }
  return blocks(kept, { refs });
}

// ---------- 白名单 ----------
const KEEP = new Set(['a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code', 'dd', 'del', 'details', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q', 's', 'samp', 'small', 'span', 'strike', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul', 'var']);
const AS_DIV = new Set(['center', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'fieldset', 'address']);
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'option', 'svg', 'math', 'video', 'audio', 'canvas', 'link', 'meta', 'base', 'title', 'template', 'noscript', 'frame', 'frameset', 'applet', 'head', 'source', 'track', 'dialog']);

function normalizePath(p) {
  const out = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out;
}
function encodePath(segs) {
  return segs.map((s) => {
    try {
      return encodeURIComponent(decodeURIComponent(s));
    } catch {
      return encodeURIComponent(s);
    }
  }).join('/');
}

function resolveUrl(raw, kind, o) {
  const u = String(raw ?? '').trim();
  if (!u) return null;
  if (u.startsWith('#')) return kind === 'link' ? { anchor: u.slice(1) } : null;
  if (/^https?:\/\//i.test(u)) return { url: u };
  if (kind === 'link' && /^mailto:/i.test(u)) return { url: u };
  if (u.startsWith('//')) return { url: 'https:' + u };
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return null;
  if (!o.repo) return null;
  const cut = u.search(/[?#]/);
  const pathPart = cut >= 0 ? u.slice(0, cut) : u;
  const tail = cut >= 0 ? u.slice(cut) : '';
  const segs = normalizePath(pathPart);
  const branch = o.branch || 'HEAD';
  if (kind === 'img') return { url: 'https://raw.githubusercontent.com/' + o.repo + '/' + branch + '/' + encodePath(segs) + (tail.startsWith('?') ? tail : '') };
  const dir = pathPart.endsWith('/') || segs.length === 0;
  return { url: 'https://github.com/' + o.repo + '/' + (dir ? 'tree' : 'blob') + '/' + branch + (segs.length ? '/' + encodePath(segs) : '') + tail };
}

function imageAllowed(url, mode) {
  if (mode === 'all') return true;
  if (mode === 'none') return false;
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === 'github.com' || h.endsWith('.github.com') || h === 'githubusercontent.com' || h.endsWith('.githubusercontent.com') || h === 'github.githubassets.com';
  } catch {
    return false;
  }
}

const slugify = (t) => t.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');

function convert(node, o) {
  if (node.nodeType === 3) return document.createTextNode(node.nodeValue);
  if (node.nodeType !== 1) return null;
  const tag = node.tagName.toLowerCase();
  if (DROP.has(tag)) return null;
  const kids = () => {
    const f = document.createDocumentFragment();
    for (const c of node.childNodes) {
      const r = convert(c, o);
      if (r) f.append(r);
    }
    return f;
  };
  if (tag === 'img') {
    const r = resolveUrl(node.getAttribute('src'), 'img', o);
    const alt = (node.getAttribute('alt') || '').slice(0, 200);
    o.stats.images += 1;
    if (!r?.url) return alt ? document.createTextNode(alt) : null;
    if (!imageAllowed(r.url, o.imageMode)) {
      o.stats.blocked += 1;
      const s = document.createElement('span');
      s.className = 'imgblocked';
      s.textContent = alt || '图片';
      s.title = '外部图片未载入';
      return s;
    }
    const img = document.createElement('img');
    img.src = r.url;
    img.alt = alt;
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    const t = node.getAttribute('title');
    if (t) img.title = t.slice(0, 200);
    for (const k of ['width', 'height']) {
      const v = node.getAttribute(k);
      if (v && /^\d{1,4}$/.test(v)) img.setAttribute(k, v);
    }
    return img;
  }
  if (tag === 'picture') return kids();
  if (tag === 'a') {
    const r = resolveUrl(node.getAttribute('href'), 'link', o);
    if (!r) return kids();
    const a = document.createElement('a');
    if (r.anchor !== undefined) {
      a.href = '#';
      a.dataset.anchor = r.anchor;
    } else {
      a.href = r.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
    const t = node.getAttribute('title');
    if (t) a.title = t.slice(0, 200);
    a.append(kids());
    return a;
  }
  let el;
  if (KEEP.has(tag)) el = document.createElement(tag);
  else if (AS_DIV.has(tag)) {
    el = document.createElement('div');
    if (tag === 'center') el.className = 'al-center';
  } else return kids();
  const align = (node.getAttribute('align') || '').toLowerCase();
  if (align === 'center' || align === 'right') el.classList.add('al-' + align);
  if (tag === 'td' || tag === 'th') {
    for (const k of ['colspan', 'rowspan']) {
      const v = node.getAttribute(k);
      if (v && /^\d{1,2}$/.test(v)) el.setAttribute(k, v);
    }
  }
  if (tag === 'ol') {
    const v = node.getAttribute('start');
    if (v && /^\d{1,6}$/.test(v)) el.setAttribute('start', v);
  }
  if (tag === 'details' && node.hasAttribute('open')) el.setAttribute('open', '');
  if (/^h[1-6]$/.test(tag)) o.headings.push(el);
  el.append(kids());
  return el;
}

// 浏览器解析 HTML 时，没闭合的 style / script / textarea / title / iframe / svg / math / form 等，以及没收尾的 <!-- 注释，
// 会把后面的内容整段吞掉；GitHub 自己的渲染不会这样。所以先拆掉这些「雷」再交给 DOMParser：
// 有收尾标签的整段去掉，没收尾的只去开标签，没收尾的注释还原成普通文字。
// （这一步只为「别吞内容」；安全把关仍是后面的白名单重建。线性扫描，恶意长文也不会拖慢。）
const SWALLOW = 'script|style|textarea|title|iframe|xmp|noembed|noframes|noscript|plaintext|svg|math|form|select|button|object|applet|video|audio|canvas|template|frameset|dialog';
function defuseHtml(html) {
  const lower = html.toLowerCase();
  const lastClose = new Map();
  const re = new RegExp('<(' + SWALLOW + ')(?=[\\s/>])', 'gi');
  let out = '';
  let pos = 0;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[1].toLowerCase();
    const start = m.index;
    const gt = html.indexOf('>', start);
    out += html.slice(pos, start);
    if (gt < 0) {
      pos = html.length;
      break;
    }
    let end = gt + 1;
    if (!lastClose.has(tag)) lastClose.set(tag, lower.lastIndexOf('</' + tag));
    if (lastClose.get(tag) >= end) {
      const close = lower.indexOf('</' + tag, end);
      const closeGt = html.indexOf('>', close);
      end = closeGt < 0 ? html.length : closeGt + 1;
    }
    pos = end;
    re.lastIndex = end;
  }
  out += html.slice(pos);
  const last = out.lastIndexOf('-->');
  return out.slice(0, last + 3) + out.slice(last + 3).replace(/<!--/g, '&lt;!--');
}

/** 返回 { node, stats: { images, blocked } } */
export function renderMarkdown(text, options = {}) {
  const o = { repo: options.repo || '', branch: options.branch || 'HEAD', imageMode: options.imageMode || 'github', stats: { images: 0, blocked: 0 }, headings: [] };
  const html = defuseHtml(mdToHtml(String(text ?? '').slice(0, 400000)));
  const doc = new DOMParser().parseFromString('<body>' + html, 'text/html');
  const frag = document.createDocumentFragment();
  for (const c of doc.body.childNodes) {
    const r = convert(c, o);
    if (r) frag.append(r);
  }
  const seen = new Map();
  for (const h of o.headings) {
    const base = slugify(h.textContent || '');
    if (!base) continue;
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    h.dataset.slug = n ? base + '-' + n : base;
  }
  return { node: frag, stats: o.stats };
}

/** 点击 README 里的「#锚点」链接，在容器内滚动到对应标题 */
export function handleAnchorClick(event, container) {
  const a = event.target.closest?.('a[data-anchor]');
  if (!a || !container.contains(a)) return false;
  event.preventDefault();
  let id = a.dataset.anchor;
  try {
    id = decodeURIComponent(id);
  } catch {
    /* 保持原样 */
  }
  id = slugify(id.replace(/^user-content-/, '').replace(/-/g, ' ')).replace(/--+/g, '-');
  const direct = container.querySelector('[data-slug="' + CSS.escape(a.dataset.anchor.toLowerCase()) + '"]');
  const target = direct || [...container.querySelectorAll('[data-slug]')].find((h) => h.dataset.slug.replace(/-/g, '') === id.replace(/-/g, ''));
  target?.scrollIntoView({ block: 'start' });
  return true;
}
