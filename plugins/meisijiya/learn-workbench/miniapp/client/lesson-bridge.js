(function () {
  'use strict';

  const cfg = window.__WB__ || { annotations: [] };
  const source = 'wb';

  /* ------------------------------------------------------------ highlight */

  const style = document.createElement('style');
  style.textContent = `
    mark.wb-hl {
      background: color-mix(in srgb, #f59e0b 26%, transparent);
      border-bottom: 1px solid color-mix(in srgb, #f59e0b 70%, transparent);
      border-radius: 2px;
      padding: 0 1px;
      cursor: pointer;
      color: inherit;
    }
    mark.wb-hl:hover { background: color-mix(in srgb, #f59e0b 40%, transparent); }
  `;
  document.head.appendChild(style);

  function normalize(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  // Quotes may cross <strong>/<a> inside one block, so highlight per block
  // instead of per text node.
  const BLOCK_SELECTOR =
    'p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, dd, dt, figcaption, caption, pre';

  function textNodesIn(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'MARK' || tag === 'NOSCRIPT') {
          return NodeFilter.FILTER_REJECT;
        }
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    let current = walker.nextNode();
    while (current) {
      nodes.push(current);
      current = walker.nextNode();
    }
    return nodes;
  }

  /** Concatenate a block's text and remember where each character came from. */
  function buildIndex(nodes) {
    let text = '';
    const map = [];
    for (const node of nodes) {
      const value = node.nodeValue;
      for (let i = 0; i < value.length; i += 1) {
        const char = value[i];
        if (/\s/.test(char)) {
          if (text.endsWith(' ')) continue;
          map.push({ node, offset: i });
          text += ' ';
        } else {
          map.push({ node, offset: i });
          text += char;
        }
      }
    }
    return { text, map };
  }

  function markFor(annotation) {
    const mark = document.createElement('mark');
    mark.className = 'wb-hl';
    mark.dataset.wb = annotation.id;
    mark.title = annotation.note ? String(annotation.note).slice(0, 200) : '查看批注';
    return mark;
  }

  function wrapNode(node, start, end, annotation) {
    if (start >= end) return false;
    try {
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      range.surroundContents(markFor(annotation));
      return true;
    } catch {
      return false;
    }
  }

  function locate(index, target) {
    if (target.length < 2) return null;
    let at = index.text.indexOf(target);
    let length = target.length;
    if (at < 0 && target.length > 12) {
      const head = target.slice(0, 12);
      at = index.text.indexOf(head);
      length = head.length;
    }
    if (at < 0) return null;
    const start = index.map[at];
    const end = index.map[Math.min(index.map.length - 1, at + length - 1)];
    if (!start || !end) return null;
    return { start, end, at, length };
  }

  function highlightIn(block, quote, annotation) {
    const nodes = textNodesIn(block);
    if (!nodes.length) return false;
    const found = locate(buildIndex(nodes), normalize(quote));
    if (!found) return false;
    const { start, end } = found;

    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset + 1);
    try {
      range.surroundContents(markFor(annotation));
      return true;
    } catch {
      /* The range crosses element boundaries; wrap each covered text node. */
    }

    const from = nodes.indexOf(start.node);
    const to = nodes.indexOf(end.node);
    if (from < 0 || to < from) return false;
    let touched = false;
    for (let i = from; i <= to; i += 1) {
      const node = nodes[i];
      const startOffset = node === start.node ? start.offset : 0;
      const endOffset = node === end.node ? end.offset + 1 : node.nodeValue.length;
      touched = wrapNode(node, startOffset, endOffset, annotation) || touched;
    }
    return touched;
  }

  /** Plain text inside a block-less container: only wrap within one text node. */
  function highlightSingleNode(quote, annotation) {
    const target = normalize(quote);
    if (target.length < 2) return false;
    for (const node of textNodesIn(document.body)) {
      const flat = normalize(node.nodeValue);
      if (flat.length < target.length) continue;
      let at = flat.indexOf(target);
      let length = target.length;
      if (at < 0 && target.length > 12) {
        at = flat.indexOf(target.slice(0, 12));
        length = Math.min(12, target.length);
      }
      if (at < 0) continue;
      // Map the normalized index back onto this node's raw text.
      let rawStart = -1;
      let seen = 0;
      let cursor = 0;
      while (cursor < node.nodeValue.length) {
        const char = node.nodeValue[cursor];
        if (/\s/.test(char)) {
          if (seen > 0) {
            let lookahead = cursor;
            while (lookahead < node.nodeValue.length && /\s/.test(node.nodeValue[lookahead])) lookahead += 1;
            if (lookahead < node.nodeValue.length && seen === at) {
              rawStart = lookahead;
              break;
            }
            cursor = lookahead;
            continue;
          }
          cursor += 1;
          continue;
        }
        if (seen === at) {
          rawStart = cursor;
          break;
        }
        seen += 1;
        cursor += 1;
      }
      if (rawStart < 0) return false;
      let rawEnd = rawStart;
      let counted = 0;
      while (rawEnd < node.nodeValue.length && counted < length) {
        const char = node.nodeValue[rawEnd];
        if (!/\s/.test(char) || !/\s/.test(node.nodeValue[rawEnd - 1] || '')) counted += 1;
        rawEnd += 1;
      }
      return wrapNode(node, rawStart, rawEnd, annotation);
    }
    return false;
  }

  function applyHighlights() {
    for (const annotation of cfg.annotations || []) {
      if (document.querySelector(`mark.wb-hl[data-wb="${annotation.id}"]`)) continue;
      let done = false;
      for (const block of document.body.querySelectorAll(BLOCK_SELECTOR)) {
        if (highlightIn(block, annotation.quote, annotation)) {
          done = true;
          break;
        }
      }
      if (!done) highlightSingleNode(annotation.quote, annotation);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyHighlights, { once: true });
  } else {
    applyHighlights();
  }

  /* --------------------------------------------------------------- bubble */

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;z-index:2147483647;top:0;left:0;';
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      .bubble {
        position: fixed;
        display: none;
        align-items: center;
        gap: 6px;
        transform: translate(-50%, -100%);
        background: #171717;
        color: #fff;
        border-radius: 999px;
        padding: 5px 6px 5px 10px;
        font: 12px/1.4 ui-sans-serif, -apple-system, "PingFang SC", sans-serif;
        box-shadow: 0 6px 20px rgb(0 0 0 / 24%);
        white-space: nowrap;
      }
      .bubble.show { display: inline-flex; }
      .bubble button {
        border: 0;
        background: #fff;
        color: #171717;
        border-radius: 999px;
        padding: 3px 9px;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }
      .bubble button:hover { opacity: 0.85; }
      .bubble button.ghost {
        background: transparent;
        color: #fff;
        border: 1px solid rgb(255 255 255 / 45%);
      }
    </style>
    <div class="bubble" part="bubble">
      <span class="txt">添加批注</span>
      <button type="button" data-act="annotate">批注</button>
      <button type="button" class="ghost" data-act="ask">添加到对话</button>
    </div>
  `;
  const bubble = shadow.querySelector('.bubble');
  const bubbleText = shadow.querySelector('.txt');
  let pendingQuote = '';

  function hideBubble() {
    bubble.classList.remove('show');
    pendingQuote = '';
  }

  function showBubble(quote, rect) {
    pendingQuote = quote;
    bubbleText.textContent = quote.length > 18 ? `${quote.slice(0, 18)}…` : quote;
    bubble.style.left = `${Math.max(80, Math.min(window.innerWidth - 80, rect.left + rect.width / 2))}px`;
    bubble.style.top = `${Math.max(40, rect.top - 6)}px`;
    bubble.classList.add('show');
  }

  shadow.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!pendingQuote) return;
      const kind = button.dataset.act === 'ask' ? 'ask' : 'annotate';
      parent.postMessage({ source, type: kind, quote: pendingQuote }, '*');
      hideBubble();
      const selection = window.getSelection();
      if (selection) selection.removeAllRanges();
    });
  });

  document.addEventListener('mouseup', (event) => {
    if (event.target && event.target.closest && event.target.closest('mark.wb-hl')) return;
    window.setTimeout(() => {
      const selection = window.getSelection();
      const quote = selection ? normalize(selection.toString()) : '';
      if (!quote || quote.length < 2) {
        hideBubble();
        return;
      }
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) return;
      showBubble(quote.slice(0, 400), rect);
    }, 10);
  });

  document.addEventListener('mousedown', (event) => {
    // The bubble lives in a shadow root, so event.target arrives retargeted to
    // the host. composedPath() is the only reliable way to tell a click on the
    // bubble from a click on the lesson text; getting this wrong clears the
    // pending quote before the button's click handler reads it.
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    if (path.includes(bubble) || path.includes(host) || bubble.contains(event.target)) return;
    hideBubble();
  });

  document.addEventListener('scroll', hideBubble, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideBubble();
  });

  document.addEventListener(
    'click',
    (event) => {
      const link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
      if (!link) return;
      const href = link.getAttribute('href') || '';
      if (!href || href.startsWith('#') || href.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(href)) return;
      // The lesson page cannot reach the workspace API (connect-src 'none'); the
      // host opens the file panel on the lesson's behalf.
      event.preventDefault();
      parent.postMessage(
        { source, type: 'file', href, text: normalize(link.textContent || ''), rel: cfg.rel || '' },
        '*',
      );
    },
    true,
  );

  document.addEventListener('click', (event) => {
    const mark = event.target && event.target.closest ? event.target.closest('mark.wb-hl') : null;
    if (!mark) return;
    event.preventDefault();
    parent.postMessage({ source, type: 'open', id: mark.dataset.wb }, '*');
  });

  /* ------------------------------------------------------------- lifecycle */

  parent.postMessage({ source, type: 'ready', rel: cfg.rel || '' }, '*');

  /* ------------------------------------------------------------- theme sync */

  const LIGHT_VARS =
    ':root{--ink:#1c1b19;--muted:#6b6a66;--line:#0a0a0a14;--paper:#fbfaf7;--surface:#ffffff;' +
    '--accent:#0b6bcb;--ok:#0f7a3d;--bad:#b42318;--warn:#b45309;--code:#f2f0eb}' +
    'html{background:#fbfaf7;color-scheme:light}';
  const DARK_VARS =
    ':root{--ink:#ece9e2;--muted:#a09d95;--line:#ffffff1f;--paper:#1e1d1b;--surface:#26251f;' +
    '--accent:#7db4ff;--ok:#6ee7a8;--bad:#ff9a8f;--warn:#ffc46b;--code:#2b2a24}' +
    'html{background:#1e1d1b;color-scheme:dark}';

  let themeStyle = null;
  function applyHostTheme(theme) {
    const systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const wantDark = theme === 'dark';
    const needsOverride = wantDark !== Boolean(systemDark);
    if (!themeStyle) {
      themeStyle = document.createElement('style');
      themeStyle.id = 'wb-theme';
      document.head.appendChild(themeStyle);
    }
    themeStyle.textContent = needsOverride ? (wantDark ? DARK_VARS : LIGHT_VARS) : '';
    document.documentElement.dataset.wbTheme = wantDark ? 'dark' : 'light';
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.source !== 'host') return;
    if (data.type === 'theme') {
      applyHostTheme(data.theme);
      return;
    }
    if (data.type === 'focus') {
      const mark = document.querySelector(`mark.wb-hl[data-wb="${data.id}"]`);
      if (mark) {
        mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
        mark.style.outline = '2px solid #f59e0b';
        window.setTimeout(() => {
          mark.style.outline = '';
        }, 1600);
      }
    }
  });
})();
