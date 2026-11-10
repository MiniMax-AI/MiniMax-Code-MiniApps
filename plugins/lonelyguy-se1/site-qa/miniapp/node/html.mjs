// Small HTML helpers for static audits. This is not a browser; it only pulls
// the tags and attributes the checks need.

/**
 * @param {string} html
 * @returns {string}
 */
export function stripScriptsAndStyles(html) {
  return String(html ?? '')
    .replace(/<script\b(?![^>]*\btype\s*=\s*["']application\/ld\+json["'])[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * @param {string} html
 * @param {string} tag
 */
export function firstTagInner(html, tag) {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(html);
  return match ? decodeEntities(match[1]).trim() : '';
}

/**
 * @param {string} html
 * @param {string} tag
 */
export function collectTags(html, tag) {
  const out = [];
  const re = new RegExp(`<${tag}\\b([^>]*)\\/?>`, 'gi');
  let match;
  while ((match = re.exec(html))) {
    out.push({ attrs: parseAttrs(match[1]), index: match.index, raw: match[0] });
  }
  return out;
}

/**
 * @param {string} html
 * @param {string} tag
 */
export function collectContainers(html, tag) {
  const out = [];
  const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  let match;
  while ((match = re.exec(html))) {
    out.push({
      attrs: parseAttrs(match[1]),
      inner: decodeEntities(match[2]).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      innerHtml: match[2],
      index: match.index,
    });
  }
  return out;
}

/** @param {string} attrText */
export function parseAttrs(attrText) {
  /** @type {Record<string, string>} */
  const attrs = {};
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = re.exec(attrText))) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    attrs[name] = decodeEntities(value);
  }
  return attrs;
}

/**
 * @param {string} html
 * @param {string} name
 */
export function metaContent(html, name) {
  const tags = collectTags(html, 'meta');
  for (const tag of tags) {
    const key = (tag.attrs.name || tag.attrs.property || tag.attrs.itemprop || '').toLowerCase();
    if (key === name.toLowerCase()) return (tag.attrs.content || '').trim();
  }
  return '';
}

/**
 * @param {string} html
 * @param {string} name
 */
export function allMetaContent(html, name) {
  return collectTags(html, 'meta')
    .filter((tag) => {
      const key = (tag.attrs.name || tag.attrs.property || tag.attrs.itemprop || '').toLowerCase();
      return key === name.toLowerCase();
    })
    .map((tag) => (tag.attrs.content || '').trim())
    .filter(Boolean);
}

/** @param {string} html */
export function hasCharset(html) {
  if (/<meta\b[^>]*charset\s*=/i.test(html)) return true;
  return collectTags(html, 'meta').some(
    (tag) =>
      (tag.attrs['http-equiv'] || '').toLowerCase() === 'content-type' && /charset=/i.test(tag.attrs.content || ''),
  );
}

/** @param {string} html */
export function hasViewport(html) {
  return Boolean(metaContent(html, 'viewport'));
}

/** @param {string} html */
export function documentLang(html) {
  const htmlTag = /<html\b([^>]*)>/i.exec(html);
  if (!htmlTag) return '';
  return (parseAttrs(htmlTag[1]).lang || '').trim();
}

/** @param {string} html */
export function hasDoctype(html) {
  return /^\s*<!doctype\s+html\b/i.test(String(html ?? ''));
}

/** @param {string} html */
export function bodyText(html) {
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  const source = body ? body[1] : html;
  return decodeEntities(source.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();
}

/** @param {string} html */
export function jsonLdBlocks(html) {
  const out = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html))) {
    out.push(match[1].trim());
  }
  return out;
}

/** @param {string} text */
export function decodeEntities(text) {
  return String(text ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

/** @param {Record<string, string>} attrs */
export function accessibleName(attrs, inner = '') {
  return (attrs['aria-label'] || attrs['aria-labelledby'] || attrs.title || attrs.alt || inner || '').trim();
}

/** @param {string} href */
export function isNonCrawlableHref(href) {
  const value = String(href ?? '').trim().toLowerCase();
  if (!value || value === '#') return true;
  if (value.startsWith('javascript:')) return true;
  if (value.startsWith('void(')) return true;
  return false;
}

/** @param {string} text */
export function isGenericLinkText(text) {
  const normalized = String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return false;
  return [
    'click here',
    'click',
    'here',
    'read more',
    'learn more',
    'more',
    'more info',
    'more information',
    'details',
    'link',
    'this link',
    'this page',
    'go',
    'continue',
  ].includes(normalized);
}

/** @param {string} code */
export function looksLikeLang(code) {
  return /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(String(code ?? '').trim());
}

/** @param {string} url */
export function isAbsoluteHttpUrl(url) {
  return /^https?:\/\//i.test(String(url ?? '').trim());
}
