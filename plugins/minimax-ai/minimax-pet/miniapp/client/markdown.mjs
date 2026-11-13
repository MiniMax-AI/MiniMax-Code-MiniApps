// MiniMax Pet — render an Agent reply as DOM. Parsing is delegated to the vendored
// unified + remark parser; this module decides which nodes reach the page and how.
// Nothing here builds an HTML string: every node is created with createElement or
// createTextNode, so model output can never inject markup.
import { parseMarkdown } from './vendor/markdown.mjs';
import { t } from './i18n.mjs';

// A reply is at most a few thousand characters in practice. Keep a ceiling so one
// pathological response cannot stall the page, and bound the parse cache.
const MAX_SOURCE = 200_000;
const MAX_CACHE = 8;
const truncatedNote = () => `\n${t('markdown.truncated')}`;
const HEADING_LEVEL_BASE = 2;

const parses = new Map();
const flats = new Map();

// A reply can be 200k characters; keep a short identity for the DOM marker instead
// of copying the whole text into an attribute.
function sourceKey(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`;
}

function remember(map, key, value) {
  if (map.size >= MAX_CACHE) map.delete(map.keys().next().value);
  map.set(key, value);
  return value;
}

function tree(text) {
  const source = text.length > MAX_SOURCE ? text.slice(0, MAX_SOURCE) + truncatedNote() : text;
  const hit = parses.get(source);
  if (hit) return hit;
  let parsed;
  try {
    parsed = parseMarkdown(source);
  } catch (error) {
    console.warn('[pet] markdown_parse_failed:', error?.message ?? error);
    parsed = { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', value: source }] }] };
  }
  return remember(parses, source, parsed);
}

// ---------------------------------------------------------------------------
// Inline nodes
// ---------------------------------------------------------------------------

function inlineNode(doc, node) {
  switch (node.type) {
    case 'text':
      return doc.createTextNode(typeof node.value === 'string' ? node.value : '');
    case 'break':
      return doc.createElement('br');
    case 'inlineCode': {
      const code = doc.createElement('code');
      code.className = 'md-code-inline';
      code.textContent = typeof node.value === 'string' ? node.value : '';
      return code;
    }
    case 'inlineMath':
    case 'math': {
      const span = doc.createElement('span');
      span.className = 'md-formula';
      span.textContent = typeof node.value === 'string' ? node.value : '';
      return span;
    }
    case 'inlineHtml':
      // Inline HTML tags are dropped: their text stays, the tag never renders.
      return doc.createTextNode('');
    case 'html':
      // A single-line HTML block cannot be laid out as a block; keep it as text.
      return doc.createTextNode(typeof node.value === 'string' ? node.value : '');
    case 'image': {
      // Images are not fetched; the alt text keeps the meaning without a network
      // request. Rendering the URL would expose remote hosts to the reply.
      const span = doc.createElement('span');
      span.className = 'md-image';
      span.textContent = t('markdown.image', { alt: node.alt ? t('markdown.imageAlt', { alt: node.alt }) : '' });
      return span;
    }
    case 'link': {
      // The page cannot open external URLs; keep the label and show the target on hover.
      // Only sane web targets are exposed, so a reply cannot hang a javascript: URL on
      // a hover label where a reader might copy it.
      const span = doc.createElement('span');
      span.className = 'md-link';
      const url = typeof node.url === 'string' ? node.url : '';
      if (/^(?:https?:|mailto:)/iu.test(url)) span.title = url;
      else if (url) span.classList.add('md-link-blocked');
      appendInline(doc, span, node.children);
      return span;
    }
    case 'strong':
    case 'emphasis':
    case 'delete': {
      const tag = node.type === 'strong' ? 'strong' : node.type === 'emphasis' ? 'em' : 'del';
      const el = doc.createElement(tag);
      appendInline(doc, el, node.children);
      return el;
    }
    default: {
      const span = doc.createElement('span');
      appendInline(doc, span, node.children);
      return span;
    }
  }
}

function appendInline(doc, parent, children) {
  for (const child of Array.isArray(children) ? children : []) parent.append(inlineNode(doc, child));
}

// ---------------------------------------------------------------------------
// Block nodes
// ---------------------------------------------------------------------------

function blockNode(doc, node) {
  switch (node.type) {
    case 'paragraph': {
      const p = doc.createElement('p');
      p.className = 'md-p';
      appendInline(doc, p, node.children);
      return p;
    }
    case 'heading': {
      // A reply sits inside a page that already owns its h1/h2, so keep the visual
      // levels without adding competing document headings.
      const div = doc.createElement('div');
      div.className = 'md-heading';
      div.dataset.depth = String(Math.min(Math.max(Number(node.depth) || 1, 1), 6));
      div.setAttribute('role', 'heading');
      div.setAttribute('aria-level', String(Math.min((Number(node.depth) || 1) + HEADING_LEVEL_BASE, 6)));
      appendInline(doc, div, node.children);
      return div;
    }
    case 'list': {
      const list = doc.createElement(node.ordered ? 'ol' : 'ul');
      list.className = 'md-list';
      if (node.ordered && Number.isInteger(node.start) && node.start !== 1) list.start = node.start;
      for (const item of Array.isArray(node.children) ? node.children : []) {
        if (item.type !== 'listItem') continue;
        const li = doc.createElement('li');
        li.className = 'md-li';
        if (item.checked === true || item.checked === false) {
          li.classList.add('md-task');
          li.dataset.checked = String(item.checked);
        }
        appendBlocks(doc, li, item.children, { tight: !item.spread });
        list.append(li);
      }
      return list;
    }
    case 'code': {
      const pre = doc.createElement('pre');
      pre.className = 'md-pre';
      const code = doc.createElement('code');
      if (typeof node.lang === 'string' && node.lang) pre.dataset.lang = node.lang;
      code.textContent = typeof node.value === 'string' ? node.value : '';
      pre.append(code);
      return pre;
    }
    case 'blockquote': {
      const quote = doc.createElement('blockquote');
      quote.className = 'md-quote';
      appendBlocks(doc, quote, node.children, {});
      return quote;
    }
    case 'thematicBreak': {
      const rule = doc.createElement('hr');
      rule.className = 'md-rule';
      return rule;
    }
    case 'table': {
      const wrap = doc.createElement('div');
      wrap.className = 'md-table';
      // Wide tables scroll inside the card instead of widening the page.
      wrap.tabIndex = 0;
      wrap.setAttribute('role', 'region');
      wrap.setAttribute('aria-label', t('desk.tableAria'));
      const table = doc.createElement('table');
      const rows = Array.isArray(node.children) ? node.children : [];
      const align = Array.isArray(node.align) ? node.align : [];
      const header = rows.find((row) => row.type === 'tableRow');
      if (header) {
        const thead = doc.createElement('thead');
        thead.append(tableRow(doc, header, 'th', align));
        table.append(thead);
      }
      const body = rows.filter((row) => row.type === 'tableRow' && row !== header);
      if (body.length) {
        const tbody = doc.createElement('tbody');
        for (const row of body) tbody.append(tableRow(doc, row, 'td', align));
        table.append(tbody);
      }
      wrap.append(table);
      return wrap;
    }
    case 'html': {
      // Raw HTML is shown as its literal source, never parsed: the author meant it
      // to be a block, so dropping it silently would hide half the reply.
      const p = doc.createElement('p');
      p.className = 'md-p md-raw';
      p.textContent = typeof node.value === 'string' ? node.value : '';
      return p;
    }
    case 'tableRow':
    case 'tableCell':
      // Only reachable through a table; a stray cell keeps its inline content.
      return textParagraph(doc, inlineText(node));
    default: {
      // Unknown block types (footnote definitions, definition lists, math blocks)
      // degrade to their text rather than disappearing.
      const container = doc.createElement('div');
      container.className = 'md-block';
      appendBlocks(doc, container, node.children, {});
      if (!container.childNodes.length) container.textContent = inlineText(node);
      return container;
    }
  }
}

function textParagraph(doc, text) {
  const p = doc.createElement('p');
  p.className = 'md-p';
  p.textContent = text;
  return p;
}

function tableRow(doc, row, cellTag, align = []) {
  const tr = doc.createElement('tr');
  const cells = Array.isArray(row.children) ? row.children.filter((cell) => cell.type === 'tableCell') : [];
  for (const [index, cell] of cells.entries()) {
    const td = doc.createElement(cellTag);
    if (cellTag === 'th') td.scope = 'col';
    // remark-gfm records alignment once per column on the table, not on each cell.
    const column = align[index];
    if (column === 'left' || column === 'center' || column === 'right') td.dataset.align = column;
    appendInline(doc, td, cell.children);
    tr.append(td);
  }
  return tr;
}

function appendBlocks(doc, parent, children, { tight = false } = {}) {
  for (const child of Array.isArray(children) ? children : []) {
    if (!child || child.type === 'footnoteDefinition') continue;
    const node = blockNode(doc, child);
    // A list item that holds only paragraphs becomes plain inline content when the
    // list is tight, matching how markdown renders without paragraph spacing.
    if (tight && child.type === 'paragraph' && node.classList?.contains('md-p')) {
      const fragment = doc.createDocumentFragment();
      appendInline(doc, fragment, child.children);
      parent.append(fragment);
    } else if (node) {
      parent.append(node);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Renders markdown into `target`, replacing its content only when the text changed.
 * A reply that is still streaming changes on every poll, so the reader's scroll
 * position is captured and restored around the replace.
 */
export function renderMarkdown(target, text) {
  const source = typeof text === 'string' ? text : '';
  const key = sourceKey(source);
  if (target.dataset.mdSource === key) return false;
  const doc = target.ownerDocument;
  const fragment = doc.createDocumentFragment();
  for (const child of tree(source).children) {
    if (!child || child.type === 'footnoteDefinition') continue;
    const node = blockNode(doc, child);
    if (node) fragment.append(node);
  }
  const keepTop = target.scrollTop;
  target.replaceChildren(fragment);
  if (keepTop > 0) target.scrollTop = keepTop;
  target.dataset.mdSource = key;
  target.classList.add('md');
  return true;
}

/** Drops the cached render so the next call repaints (used when the target is reused). */
export function resetMarkdown(target) {
  delete target.dataset.mdSource;
}

// ---------------------------------------------------------------------------
// Plain text, for the five-line previews
// ---------------------------------------------------------------------------

function inlineText(node) {
  switch (node.type) {
    case 'text':
    case 'inlineCode':
      return typeof node.value === 'string' ? node.value : '';
    case 'inlineMath':
    case 'math':
      return typeof node.value === 'string' ? `$${node.value}$` : '';
    case 'break':
      return ' ';
    case 'html':
    case 'inlineHtml':
      return typeof node.value === 'string' ? node.value : '';
    case 'image':
      return t('markdown.image', { alt: node.alt ? t('markdown.imageAlt', { alt: node.alt }) : '' });
    case 'link':
    case 'strong':
    case 'emphasis':
    case 'delete':
    default:
      return (Array.isArray(node.children) ? node.children : []).map(inlineText).join('');
  }
}

function blockText(node, depth = 0) {
  switch (node.type) {
    case 'paragraph':
    case 'heading':
      return inlineText(node);
    case 'code':
      return typeof node.value === 'string' ? node.value : '';
    case 'thematicBreak':
      return '—';
    case 'html':
      return typeof node.value === 'string' ? node.value : '';
    case 'list': {
      const items = Array.isArray(node.children) ? node.children : [];
      return items.map((item, index) => {
        const marker = item.checked === true ? '[x] ' : item.checked === false ? '[ ] '
          : node.ordered ? `${(Number.isInteger(node.start) ? node.start : 1) + index}. ` : '• ';
        // A nested list carries no depth of its own, so collect the item's blocks
        // here and indent every continuation line under the marker text.
        const body = (Array.isArray(item.children) ? item.children : []).map((child) => blockText(child, depth)).join('\n');
        const indent = `${'  '.repeat(depth)}${' '.repeat(marker.length)}`;
        const indented = body.split('\n').filter((line, lineIndex) => lineIndex === 0 || line).join(`\n${indent}`);
        return `${'  '.repeat(depth)}${marker}${indented}`;
      }).join('\n');
    }
    case 'table': {
      const rows = Array.isArray(node.children) ? node.children : [];
      return rows.map((row) => (Array.isArray(row.children) ? row.children : []).map((cell) => (Array.isArray(cell.children) ? cell.children : []).map(inlineText).join('')).join('\t')).join('\n');
    }
    case 'blockquote':
      return (Array.isArray(node.children) ? node.children : []).map((child) => blockText(child, depth)).join('\n');
    default:
      return (Array.isArray(node.children) ? node.children : []).map((child) => blockText(child, depth)).join('\n');
  }
}

/** Flattens markdown to text for previews, which only ever show a few lines. */
export function markdownToPlainText(text) {
  const source = typeof text === 'string' ? text : '';
  if (!source.trim()) return '';
  const hit = flats.get(source);
  if (hit !== undefined) return hit;
  const flat = tree(source).children
    .filter((child) => child && child.type !== 'footnoteDefinition')
    .map((child) => blockText(child))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return remember(flats, source, flat);
}
