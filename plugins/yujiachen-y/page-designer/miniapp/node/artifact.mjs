// @ts-check
// The design artifact: one self-contained HTML document, its safety checks and the sandbox
// bootstrap the preview runs it with.
//
// Adapted from fx0 by Vercel Labs, lib/design-artifact.ts and the edit_design handler in
// lib/agent.ts (https://github.com/vercel-labs/fx0, commit e584782, Apache-2.0).
// Changes from the original: ported from TypeScript to JavaScript; the bootstrap reports to the
// Mini App page instead of fx0's wrapper route and sends no heartbeat timer; the
// exact-replacement edit logic moved here from lib/agent.ts so the MCP tools and the tests
// share it.

export const MAX_DESIGN_BYTES = 512 * 1024;
export const MAX_EDITS = 20;

/** Applied inside the preview document, ahead of everything the design contains. */
export const DESIGN_EMBEDDED_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  'font-src data:',
  'media-src data:',
  "connect-src 'none'",
  "child-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "manifest-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/**
 * WebRTC is switched off before the design runs (CSP does not cover it). With a token, the
 * document also reports to the page when it has loaded and painted, and hands clicked https
 * links to the page, because the sandbox grants no popups or top navigation.
 * @param {string} [readyToken]
 */
function bootstrap(readyToken) {
  const heartbeat = readyToken
    ? `const token=${JSON.stringify(readyToken)};const send=type=>parent.postMessage({type,token},"*");addEventListener("load",()=>{send("ready");requestAnimationFrame(()=>requestAnimationFrame(()=>send("painted")))},{once:true});addEventListener("click",event=>{const link=event.target instanceof Element&&event.target.closest("a[href]");const url=link?link.getAttribute("href")||"":"";if(/^https:/i.test(url)){event.preventDefault();parent.postMessage({type:"open",token,url},"*")}},true);`
    : '';
  return `<script>(()=>{for(const name of ["RTCPeerConnection","webkitRTCPeerConnection","RTCIceGatherer"]){try{Object.defineProperty(globalThis,name,{value:undefined,writable:false,configurable:false})}catch{}}${heartbeat}})()</script>`;
}

/** @param {string} value */
function escapeAttribute(value) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * Insert the CSP meta tag and the bootstrap right after the doctype, before any design content.
 * @param {string} html a document that passed validateDesignHtml
 * @param {string} [readyToken]
 */
export function prepareDesignHtml(html, readyToken) {
  const csp = `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(DESIGN_EMBEDDED_CSP)}">`;
  return html.replace(/^(\s*<!doctype\s+html\s*>)/i, `$1${csp}${bootstrap(readyToken)}`);
}

const PROHIBITED_TAGS = new Map([
  ['base', '<base> elements'],
  ['form', 'forms'],
  ['iframe', '<iframe> elements'],
  ['object', '<object> elements'],
  ['embed', '<embed> elements'],
]);

/** @param {string} source @param {number} start */
function findTagEnd(source, start) {
  let quote = '';
  for (let index = start; index < source.length; index++) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index;
    }
  }
  return -1;
}

/** @param {string} source */
function parseAttributes(source) {
  /** @type {Map<string, string>} */
  const attributes = new Map();
  /** @type {string | null} */
  let duplicateAttribute = null;
  const pattern = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of source.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    if (name === '/') continue;
    if (attributes.has(name)) {
      duplicateAttribute ??= name;
      continue;
    }
    attributes.set(name, match[2] ?? match[3] ?? match[4] ?? '');
  }
  return { attributes, duplicateAttribute };
}

/** @param {string} source */
function parseOpeningTags(source) {
  /** @type {{ name: string, attributes: Map<string, string>, duplicateAttribute: string | null }[]} */
  const tags = [];
  const normalized = source.toLowerCase();
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf('<', cursor);
    if (start < 0) break;
    if (source.startsWith('<!--', start)) {
      const end = source.indexOf('-->', start + 4);
      cursor = end < 0 ? source.length : end + 3;
      continue;
    }
    const marker = source[start + 1];
    if (!marker || marker === '/' || marker === '!' || marker === '?') {
      cursor = start + 2;
      continue;
    }
    const nameMatch = source.slice(start + 1).match(/^([a-z][a-z0-9:-]*)/i);
    if (!nameMatch) {
      cursor = start + 1;
      continue;
    }
    const end = findTagEnd(source, start + 1 + nameMatch[0].length);
    if (end < 0) break;
    const name = nameMatch[1].toLowerCase();
    const attributeSource = source.slice(start + 1 + nameMatch[0].length, end);
    tags.push({ name, ...parseAttributes(attributeSource) });
    if (name === 'script' || name === 'style') {
      const closing = normalized.indexOf(`</${name}`, end + 1);
      cursor = closing < 0 ? source.length : closing;
    } else {
      cursor = end + 1;
    }
  }
  return tags;
}

/** @param {string} digits @param {number} radix */
function decodeCodePoint(digits, radix) {
  const codePoint = Number.parseInt(digits, radix);
  return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '\ufffd';
}

/** @param {string} value */
function decodeAttribute(value) {
  /** @type {Record<string, string>} */
  const named = { colon: ':', tab: '\t', newline: '\n', amp: '&' };
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, digits) => decodeCodePoint(digits, 16))
    .replace(/&#([0-9]+);?/g, (_, digits) => decodeCodePoint(digits, 10))
    .replace(/&(colon|tab|newline|amp);?/gi, (_, entity) => named[entity.toLowerCase()])
    .trim();
}

/** @param {string} value */
function compactUrlScheme(value) {
  return decodeAttribute(value)
    .replace(/[\u0000-\u0020\u007f]+/g, '')
    .toLowerCase();
}

/** @param {string} tag @param {string} value */
function isEmbeddedSource(tag, value) {
  const decoded = decodeAttribute(value);
  if (tag === 'img' || tag === 'input') return /^data:image\//i.test(decoded);
  if (tag === 'audio') return /^data:audio\//i.test(decoded);
  if (tag === 'video') return /^data:video\//i.test(decoded);
  if (tag === 'track') return /^data:text\/vtt(?:[;,]|$)/i.test(decoded);
  if (tag === 'source') return /^data:(?:image|audio|video)\//i.test(decoded);
  return false;
}

/** @param {string} tag @param {string} value */
function isEmbeddedSrcset(tag, value) {
  if (tag !== 'img' && tag !== 'source') return false;
  const decoded = decodeAttribute(value);
  const comma = decoded.indexOf(',');
  if (comma < 0 || decoded.indexOf(',', comma + 1) >= 0) return false;
  const metadata = decoded.slice(0, comma);
  const payload = decoded.slice(comma + 1);
  return /^data:image\/[a-z0-9.+-]+(?:;[^,\s]*)*$/i.test(metadata) && /^\S+(?:\s+(?:\d+(?:\.\d+)?[wx]))?$/.test(payload);
}

/** @param {{ name: string, attributes: Map<string, string>, duplicateAttribute: string | null }} tag */
function validateTag(tag) {
  if (tag.duplicateAttribute) return `the design must not repeat the ${tag.duplicateAttribute} attribute`;

  const prohibited = PROHIBITED_TAGS.get(tag.name);
  if (prohibited) return `the design must not contain ${prohibited}`;
  if (tag.name === 'script' && tag.attributes.has('src')) return 'design scripts must be inline';
  if (tag.name === 'meta' && decodeAttribute(tag.attributes.get('http-equiv') ?? '').toLowerCase() === 'refresh') {
    return 'the design must not contain meta refresh';
  }

  for (const [name, rawValue] of tag.attributes) {
    const compactValue = compactUrlScheme(rawValue);
    if (compactValue.startsWith('javascript:') || compactValue.startsWith('vbscript:')) {
      return 'the design must not use scripted URLs';
    }
    if (name === 'action' || name === 'formaction') return `the design must not contain ${name} attributes`;
    if (name === 'href' || name === 'xlink:href') {
      const value = decodeAttribute(rawValue);
      const isSafeSvgImage = tag.name === 'image' && /^data:image\//i.test(value);
      // Links to https pages (cited sources, references) open outside the preview.
      const isExternalLink = tag.name === 'a' && name === 'href' && /^https:\/\/[^\s]+$/i.test(value);
      if (!value.startsWith('#') && !isSafeSvgImage && !isExternalLink) {
        return `design ${name} values must be local fragments, https links, or compatible embedded data: URLs`;
      }
    }
    if (name === 'src' && !isEmbeddedSource(tag.name, rawValue)) {
      return 'design src values must use a compatible embedded data: URL';
    }
    if (name === 'srcset' && !isEmbeddedSrcset(tag.name, rawValue)) {
      return 'design srcset values must contain one embedded data:image URL';
    }
    if (name === 'poster' && !/^data:image\//i.test(decodeAttribute(rawValue))) {
      return 'design poster values must use an embedded data:image URL';
    }
  }
  return null;
}

/**
 * @param {unknown} html
 * @returns {{ ok: true, bytes: number } | { ok: false, error: string }}
 */
export function validateDesignHtml(html) {
  if (typeof html !== 'string') return { ok: false, error: 'the design must be an HTML string' };
  const bytes = Buffer.byteLength(html, 'utf8');
  if (bytes > MAX_DESIGN_BYTES) return { ok: false, error: 'the design exceeds 512 KiB' };

  const source = html.trim();
  if (source.includes('<!--')) return { ok: false, error: 'the design must not contain HTML comments' };
  if (!/^<!doctype\s+html\s*>/i.test(source)) return { ok: false, error: 'the design must start with <!doctype html>' };
  const afterDoctype = source.replace(/^<!doctype\s+html\s*>/i, '');
  if (/<(?:!|\?)/.test(afterDoctype)) return { ok: false, error: 'the design must not contain markup declarations' };

  for (const tag of ['html', 'head', 'body']) {
    const openings = source.match(new RegExp(`<${tag}(?:\\s[^>]*)?>`, 'gi'))?.length ?? 0;
    const closings = source.match(new RegExp(`</${tag}\\s*>`, 'gi'))?.length ?? 0;
    if (openings !== 1 || closings !== 1) return { ok: false, error: `the design must contain exactly one <${tag}> element` };
  }
  if (
    !/<html(?:\s[^>]*)?>[\s\S]*<head(?:\s[^>]*)?>[\s\S]*<\/head\s*>[\s\S]*<body(?:\s[^>]*)?>[\s\S]*<\/body\s*>[\s\S]*<\/html\s*>\s*$/i.test(
      source,
    )
  ) {
    return { ok: false, error: 'the design must be one complete html document with head and body' };
  }

  for (const tag of parseOpeningTags(source)) {
    const error = validateTag(tag);
    if (error) return { ok: false, error };
  }
  return { ok: true, bytes };
}

/**
 * Apply every replacement of one request to an in-memory copy, in order. Any failed match
 * changes nothing; the caller validates and stores the result once.
 * @param {string} html
 * @param {unknown} edits
 * @returns {{ ok: true, html: string } | { ok: false, error: string }}
 */
export function applyDesignEdits(html, edits) {
  if (!Array.isArray(edits) || edits.length === 0 || edits.length > MAX_EDITS) {
    return { ok: false, error: `edits must contain 1 to ${MAX_EDITS} replacements` };
  }
  let next = html;
  for (const [index, edit] of edits.entries()) {
    const oldString = edit && typeof edit === 'object' ? edit.old_string : undefined;
    const newString = edit && typeof edit === 'object' ? edit.new_string : undefined;
    if (typeof oldString !== 'string' || !oldString || typeof newString !== 'string') {
      return { ok: false, error: `edit ${index + 1}: old_string must be a non-empty string and new_string a string` };
    }
    const matches = next.split(oldString).length - 1;
    if (matches !== 1) {
      return {
        ok: false,
        error: `edit ${index + 1}: old_string matched ${matches} times; it must match exactly once (nothing was published)`,
      };
    }
    next = next.replace(oldString, () => newString);
  }
  return { ok: true, html: next };
}
