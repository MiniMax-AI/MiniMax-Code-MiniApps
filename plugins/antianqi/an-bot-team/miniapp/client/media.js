// @ts-check
// Files a Bot delivers in its reply: `<media src="..." />` tags (the MiniMax Code delivery
// markup, optionally inside <deliver-assets>) and Markdown images `![alt](src)`. They are cut out
// of the text before Markdown rendering and shown as an image, a player or a file chip. Local
// paths load through /api/media, which serves only a path a Bot of that chat referenced.
import { h } from './core.js';
import { t } from './i18n.js';
import { openDocumentPreview } from './document-preview.js';

const IMAGE = /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i;
const VIDEO = /\.(mp4|webm|mov|m4v)$/i;
const AUDIO = /\.(mp3|wav|m4a|aac|ogg|oga|flac)$/i;
const DOCUMENT = /\.(html?|md|markdown)$/i;

const MEDIA_TAG = /<media\b([^>]*?)\/?>(?:\s*<\/media>)?/gi;
const IMAGE_MD = /!\[([^\]\n]*)\]\(\s*<?((?:https?:\/\/|\/|~\/)[^\s)>]+)>?(?:\s+"[^"\n]*")?\s*\)/g;
const WRAPPER = /<\/?deliver-assets\b[^>]*>/gi;

/** `src="a" caption='b'` → { src: 'a', caption: 'b' }; HTML entities in values are decoded. */
function attrsOf(raw) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const m of raw.matchAll(/([a-zA-Z_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    out[m[1].toLowerCase()] = (m[2] ?? m[3] ?? '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }
  return out;
}

/**
 * Splits text into text and media segments, leaving fenced code untouched.
 * @returns {({ kind: 'text', text: string } | { kind: 'media', src: string, caption: string, type: string })[]}
 */
export function splitMedia(text) {
  const source = String(text ?? '');
  if (!/<media\b|!\[/i.test(source)) return [{ kind: 'text', text: source }];
  /** @type {any[]} */
  const out = [];
  const pushText = (chunk) => {
    if (!chunk) return;
    const last = out[out.length - 1];
    if (last?.kind === 'text') last.text += chunk;
    else out.push({ kind: 'text', text: chunk });
  };
  // Fenced blocks alternate with prose: odd indexes are code and stay as written.
  const blocks = source.split(/(^```[^\n]*\n[\s\S]*?^```[ \t]*$)/m);
  blocks.forEach((block, index) => {
    if (index % 2 === 1) return pushText(block);
    const prose = block.replace(WRAPPER, '');
    const found = [];
    for (const m of prose.matchAll(MEDIA_TAG)) {
      const a = attrsOf(m[1]);
      if (a.src) found.push({ at: m.index, end: m.index + m[0].length, src: a.src, caption: a.caption ?? a.alt ?? '', type: a.type ?? '' });
    }
    for (const m of prose.matchAll(IMAGE_MD)) {
      if (found.some((f) => m.index >= f.at && m.index < f.end)) continue;
      found.push({ at: m.index, end: m.index + m[0].length, src: m[2], caption: m[1], type: 'image' });
    }
    found.sort((a, b) => a.at - b.at);
    let cursor = 0;
    for (const f of found) {
      pushText(prose.slice(cursor, f.at));
      out.push({ kind: 'media', src: f.src.trim(), caption: f.caption.trim(), type: f.type.toLowerCase() });
      cursor = f.end;
    }
    pushText(prose.slice(cursor));
  });
  return out.filter((s) => s.kind === 'media' || s.text.trim());
}

function fileName(src) {
  const remote = /^https?:\/\//i.test(src);
  const path = remote ? src.split(/[?#]/)[0] : src;
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? src;
  // Local filenames are literal, not URL-encoded. Malformed remote escapes still have a
  // useful filename and must never prevent the rest of a reply from rendering.
  if (!remote) return name;
  try { return decodeURIComponent(name); } catch { return name; }
}

/** What to show for a src: image / video / audio / file, from the tag's `type` or the extension. */
function kindOf(src, type) {
  const bare = src.split(/[?#]/)[0];
  if (type === 'image' || IMAGE.test(bare)) return 'image';
  if (type === 'video' || VIDEO.test(bare)) return 'video';
  if (type === 'audio' || AUDIO.test(bare)) return 'audio';
  return 'file';
}

/** Local documents preview within their authenticated Mini App; other files download. */
function fileChip(src, url, caption, missing = false) {
  const path = /^https?:\/\//i.test(src) ? src.split(/[?#]/)[0] : src;
  if (!missing && !/^https?:\/\//i.test(src) && DOCUMENT.test(path)) {
    return h('button', {
      type: 'button', class: 'media-file', title: src, 'aria-haspopup': 'dialog',
      onclick: () => openDocumentPreview(url, fileName(src), /\.html?$/i.test(path)),
    }, h('span', { class: 'media-file-name' }, caption || fileName(src)), h('span', { class: 'media-file-hint' }, fileName(src)));
  }
  return h(
    'a',
    { class: `media-file${missing ? ' missing' : ''}`, href: missing ? undefined : url, download: missing || DOCUMENT.test(path) ? undefined : fileName(src), title: src, target: '_blank', rel: 'noopener noreferrer' },
    h('span', { class: 'media-file-name' }, caption || fileName(src)),
    h('span', { class: 'media-file-hint' }, missing ? t('media.missing') : fileName(src)),
  );
}

/**
 * @param {{ src: string, caption: string, type: string }} media
 * @param {string | undefined} chatId the chat whose Bot delivered it; local files need it
 */
export function mediaNode(media, chatId) {
  const remote = /^https?:\/\//i.test(media.src);
  if (!remote && !chatId) return h('p', null, media.caption || media.src);
  const url = remote ? media.src : `/api/media?chat=${encodeURIComponent(chatId ?? '')}&src=${encodeURIComponent(media.src)}`;
  const kind = kindOf(media.src, media.type);
  const caption = media.caption ? h('figcaption', null, media.caption) : null;
  if (kind === 'file') return h('figure', { class: 'md-media' }, fileChip(media.src, url, media.caption));
  const figure = h('figure', { class: `md-media ${kind}` });
  /** @type {HTMLElement} */
  let el;
  if (kind === 'image') {
    el = h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', title: media.caption || fileName(media.src) }, h('img', { src: url, alt: media.caption || fileName(media.src), loading: 'lazy', decoding: 'async' }));
    el.querySelector('img')?.addEventListener('error', () => figure.replaceChildren(fileChip(media.src, url, media.caption, true)), { once: true });
  } else {
    el = h(kind, { src: url, controls: true, preload: 'metadata' });
    el.addEventListener('error', () => figure.replaceChildren(fileChip(media.src, url, media.caption, true)), { once: true });
  }
  figure.append(el);
  if (caption) figure.append(caption);
  return figure;
}
