// WXSS -> browser CSS for the H5 approximation preview.

import { convertStyleValues } from '../client/style-values.mjs';

export const BUILTIN_TAGS = [
  'view', 'text', 'image', 'button', 'input', 'textarea', 'scroll-view', 'swiper', 'swiper-item',
  'icon', 'progress', 'rich-text', 'checkbox', 'checkbox-group', 'radio', 'radio-group', 'switch',
  'slider', 'picker', 'picker-view', 'picker-view-column', 'navigator', 'form', 'label', 'map',
  'canvas', 'video', 'camera', 'web-view', 'movable-area', 'movable-view', 'cover-view',
  'cover-image', 'page', 'open-data', 'editor', 'audio', 'live-player', 'live-pusher', 'ad',
  'official-account', 'page-container', 'root-portal', 'match-media', 'block',
];
const TAG_SET = new Set(BUILTIN_TAGS);

export function stripComments(css) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      const start = i;
      i++;
      while (i < css.length && css[i] !== ch) i += css[i] === '\\' ? 2 : 1;
      out += css.slice(start, i + 1);
      i++;
      continue;
    }
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function findMatching(css, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < css.length; i++) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      i++;
      while (i < css.length && css[i] !== ch) i += css[i] === '\\' ? 2 : 1;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findTopLevel(css, start, chars) {
  let paren = 0;
  for (let i = start; i < css.length; i++) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      i++;
      while (i < css.length && css[i] !== ch) i += css[i] === '\\' ? 2 : 1;
      continue;
    }
    if (ch === '(') paren++;
    else if (ch === ')') paren--;
    else if (paren === 0 && chars.includes(ch)) return i;
  }
  return -1;
}

export function parseBlocks(css) {
  const blocks = [];
  let i = 0;
  while (i < css.length) {
    while (i < css.length && /\s/.test(css[i])) i++;
    if (i >= css.length) break;
    if (css[i] === '}') {
      i++;
      continue;
    }
    const stop = findTopLevel(css, i, css[i] === '@' ? '{;' : '{');
    if (stop < 0) {
      const rest = css.slice(i).trim();
      if (rest) blocks.push({ type: 'raw', text: rest });
      break;
    }
    const head = css.slice(i, stop).trim();
    if (css[stop] === ';') {
      blocks.push({ type: 'statement', text: head });
      i = stop + 1;
      continue;
    }
    const end = findMatching(css, stop);
    if (end < 0) throw new Error(`unbalanced braces near "${head.slice(0, 40)}"`);
    const body = css.slice(stop + 1, end);
    if (head.startsWith('@')) {
      const match = head.match(/^@([\w-]+)\s*([\s\S]*)$/);
      blocks.push({ type: 'at', name: (match?.[1] ?? '').toLowerCase(), prelude: match?.[2] ?? '', body });
    } else {
      blocks.push({ type: 'rule', selector: head, body });
    }
    i = end + 1;
  }
  return blocks;
}

export function convertUnits(text) {
  return convertStyleValues(text);
}

function splitSelectorList(selector) {
  const parts = [];
  let depth = 0;
  let bracket = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === '"' || ch === "'") {
      i++;
      while (i < selector.length && selector[i] !== ch) i += selector[i] === '\\' ? 2 : 1;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === '[') bracket++;
    else if (ch === ']') bracket--;
    else if (ch === ',' && depth === 0 && bracket === 0) {
      parts.push(selector.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(selector.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** Replaces bare built-in tag names with their `wx-*` custom element names. */
export function rewriteTags(selector, pageReplacement) {
  let out = '';
  let i = 0;
  while (i < selector.length) {
    const ch = selector[i];
    if (ch === '[') {
      const end = selector.indexOf(']', i);
      const stop = end < 0 ? selector.length : end + 1;
      out += selector.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < selector.length && selector[j] !== ch) j += selector[j] === '\\' ? 2 : 1;
      out += selector.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (/[a-zA-Z]/.test(ch)) {
      let j = i;
      while (j < selector.length && /[\w-]/.test(selector[j])) j++;
      const word = selector.slice(i, j);
      const prev = out[out.length - 1] ?? '';
      const isTypePosition = !prev || /[\s>+~,(]/.test(prev);
      const lower = word.toLowerCase();
      if (isTypePosition && lower === 'page') out += pageReplacement;
      else if (isTypePosition && TAG_SET.has(lower)) out += `wx-${lower}`;
      else out += word;
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function cssString(value) {
  return JSON.stringify(String(value)).replace(/[\n\r\f]/g, (ch) => `\\${ch.charCodeAt(0).toString(16)} `);
}

function scopeToken(scope) {
  return scope.kind === 'app' ? 'app' : `${scope.kind}:${encodeURIComponent(scope.id)}`;
}

// Scope every selector compound, rather than just an ancestor: a descendant
// prefix alone still lets page styles cross into isolated component templates.
function scopeCompounds(selector, token, hostAttribute) {
  const scope = `[data-wx-style-scope~=${cssString(token)}]`;
  const qualify = (compound) => {
    if (!compound || compound.startsWith(hostAttribute || '\u0000')) return compound;
    const externalClasses = [];
    let pseudoElement = -1;
    let depth = 0;
    let bracket = 0;
    for (let i = 0; i < compound.length; i++) {
      const ch = compound[i];
      if (ch === '\\') { i++; continue; }
      if (ch === '"' || ch === "'") {
        i++;
        while (i < compound.length && compound[i] !== ch) i += compound[i] === '\\' ? 2 : 1;
        continue;
      }
      if (ch === '[') bracket++;
      else if (ch === ']') bracket--;
      else if (!bracket && ch === '(') depth++;
      else if (!bracket && ch === ')') depth--;
      else if (!bracket && !depth && ch === '.' && /[\w-]/.test(compound[i + 1] || '')) {
        const name = compound.slice(i + 1).match(/^[\w-]+/)[0];
        externalClasses.push(`[data-wx-external~=${cssString(`${token}|${encodeURIComponent(name)}`)}]`);
      } else if (!bracket && !depth && ch === ':' && /^(?:::|:(?:before|after|first-line|first-letter)\b)/.test(compound.slice(i))) {
        pseudoElement = i;
        break;
      }
    }
    // Importing an external class admits only that class, not all parent CSS.
    const filter = `:where(${scope}${externalClasses.length ? `,${externalClasses.join('')}` : ''})`;
    const at = pseudoElement < 0 ? compound.length : pseudoElement;
    return compound.slice(0, at) + filter + compound.slice(at);
  };
  let out = '';
  let start = 0;
  let depth = 0;
  let bracket = 0;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '"' || ch === "'") {
      i++;
      while (i < selector.length && selector[i] !== ch) i += selector[i] === '\\' ? 2 : 1;
      continue;
    }
    if (ch === '[') bracket++;
    else if (ch === ']') bracket--;
    else if (!bracket && ch === '(') depth++;
    else if (!bracket && ch === ')') depth--;
    else if (!depth && !bracket && /[\s>+~]/.test(ch)) {
      out += qualify(selector.slice(start, i)) + ch;
      start = i + 1;
    }
  }
  return out + qualify(selector.slice(start));
}

function scopeSelector(selector, scope) {
  const trimmed = selector.trim();
  const page = scope.kind === 'page' ? `wx-page[data-wx-route=${cssString(scope.id)}]` : 'wx-page';
  const host = scope.kind === 'component' ? `[data-wx-comp=${cssString(scope.id)}]` : null;
  const hosted = host ? trimmed.replace(/:host(\(([^)]*)\))?/g, (_m, _g, inner) => `${host}${inner ?? ''}`) : trimmed;
  return scopeCompounds(rewriteTags(hosted, page), scopeToken(scope), host);
}

function rewriteDeclarations(body, rewriteUrl) {
  const withUrls = body.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote, raw) => {
    const next = rewriteUrl(raw.trim());
    return next === raw ? match : `url("${next}")`;
  });
  return convertUnits(withUrls);
}

function compileBlocks(blocks, scope, rewriteUrl) {
  const out = [];
  for (const block of blocks) {
    if (block.type === 'rule') {
      const selectors = splitSelectorList(block.selector).map((part) => scopeSelector(part, scope));
      out.push(`${selectors.join(',')}{${rewriteDeclarations(block.body, rewriteUrl)}}`);
    } else if (block.type === 'at') {
      if (['media', 'supports', 'layer', 'container'].includes(block.name)) {
        out.push(`@${block.name} ${block.prelude}{${compileBlocks(parseBlocks(block.body), scope, rewriteUrl)}}`);
      } else {
        out.push(`@${block.name} ${block.prelude}{${rewriteDeclarations(block.body, rewriteUrl)}}`);
      }
    } else if (block.type === 'statement' && !/^@import\b/i.test(block.text)) {
      out.push(`${block.text};`);
    }
  }
  return out.join('\n');
}

function diagnosticMask(source) {
  const mask = source.split('');
  const blank = (start, end) => {
    for (let at = start; at < end; at++) if (source[at] !== '\n' && source[at] !== '\r') mask[at] = ' ';
  };
  const quoteEnd = (start) => {
    const quote = source[start];
    let at = start + 1;
    while (at < source.length && source[at] !== quote) at += source[at] === '\\' ? 2 : 1;
    return Math.min(at + 1, source.length);
  };
  for (let index = 0; index < source.length;) {
    const start = index;
    if (source[index] === '"' || source[index] === "'") index = quoteEnd(index);
    else if (source[index] === '/' && source[index + 1] === '*') {
      const close = source.indexOf('*/', index + 2);
      index = close < 0 ? source.length : close + 2;
    } else if ((index === 0 || !/[\w-]/.test(source[index - 1])) && /^url\s*\(/i.test(source.slice(index))) {
      index += /^url\s*\(/i.exec(source.slice(index))[0].length;
      let depth = 1;
      while (index < source.length && depth) {
        const char = source[index];
        if (char === '"' || char === "'") index = quoteEnd(index);
        else if (char === '\\') index += 2;
        else { index++; if (char === '(') depth++; else if (char === ')') depth--; }
      }
    } else { index++; continue; }
    blank(start, index);
  }
  return mask.join('');
}

function diagnoseWxss(source, file, warn) {
  const mask = diagnosticMask(source);
  const emit = (code, offset, message) => {
    const prefix = source.slice(0, offset).split(/\r\n|\n|\r/);
    warn({ code, file, line: prefix.length, column: prefix.at(-1).length + 1, message });
  };
  const selector = (text, offset) => {
    for (const match of text.matchAll(/:(is|where|not|has)\s*\(/gi)) {
      let at = match.index + match[0].length, depth = 1, bracket = 0, relational = match[1].toLowerCase() === 'has';
      for (; at < text.length && depth; at++) {
        const char = text[at];
        if (char === '\\') { at++; continue; }
        if (char === '[') bracket++;
        else if (char === ']') bracket--;
        else if (!bracket && char === '(') depth++;
        else if (!bracket && char === ')') depth--;
        else if (!bracket && depth === 1) {
          if (/[>+~]/.test(char) || (char === '|' && text[at + 1] === '|')) relational = true;
          if (/\s/.test(char)) {
            const left = text.slice(match.index + match[0].length, at).trimEnd().at(-1);
            const right = text.slice(at).trimStart()[0];
            if (left && right && !/[,>+~(]/.test(left) && !/[,>+~)]/.test(right)) relational = true;
          }
        }
      }
      if (relational) emit('WXSS_COMPLEX_SELECTOR', offset + match.index,
        'Relational selectors inside :is/:where/:not/:has are preserved, but their inner component style boundaries are not fully scoped in H5 preview.');
    }
  };
  const walk = (start, end, declarations = false) => {
    let cursor = start;
    while (cursor < end) {
      while (cursor < end && /\s/.test(mask[cursor])) cursor++;
      const begin = cursor;
      if (begin >= end) return;
      let paren = 0, bracket = 0;
      for (; cursor < end; cursor++) {
        const char = mask[cursor];
        if (char === '\\') { cursor++; continue; }
        if (char === '(') paren++;
        else if (char === ')') paren--;
        else if (char === '[') bracket++;
        else if (char === ']') bracket--;
        else if (!paren && !bracket && (char === '{' || char === ';')) break;
      }
      if (cursor >= end) return;
      const head = mask.slice(begin, cursor).trim();
      if (mask[cursor] === ';') { cursor++; continue; }
      const open = cursor;
      let depth = 1;
      for (cursor++; cursor < end && depth; cursor++) {
        if (mask[cursor] === '\\') { cursor++; continue; }
        if (mask[cursor] === '{') depth++;
        else if (mask[cursor] === '}') depth--;
      }
      const close = depth ? end : cursor - 1;
      const at = /^@([\w-]+)/.exec(head);
      if (declarations) emit('WXSS_NESTED_RULE', begin,
        'Nested CSS rules are preserved without recursively applying component style scopes; flatten them for reliable H5 preview.');
      if (at) {
        const name = at[1].toLowerCase();
        if (name === 'keyframes' || name === '-webkit-keyframes') {
          emit('WXSS_GLOBAL_KEYFRAMES', begin,
            'Keyframe names are not isolated between components in H5 preview; the original animation rules are preserved and may collide.');
        } else if (['media', 'supports', 'layer', 'container'].includes(name)) walk(open + 1, close, declarations);
        else if (name !== 'font-face') {
          emit('WXSS_UNSUPPORTED_AT_RULE', begin,
            `@${name} is preserved but its selector or declaration semantics are not adapted to component scopes in H5 preview.`);
          walk(open + 1, close);
        }
      } else {
        selector(head, begin);
        walk(open + 1, close, true);
      }
    }
  };
  walk(0, mask.length);
}

/**
 * @param {object} input
 * @param {string} input.source
 * @param {string} input.file root-relative file path, used for diagnostics and import resolution
 * @param {{kind: 'app'|'page'|'component', id?: string}} input.scope
 * @param {(spec: string, fromFile: string) => {file: string, source: string} | null} input.resolveImport
 * @param {(raw: string, fromFile: string) => string} input.rewriteUrl
 */
export function compileWxss(input) {
  const warnings = [];
  const warningKeys = new Set();
  const warn = (warning) => {
    const key = warning.file + ':' + warning.code;
    if (warningKeys.has(key) || warnings.length >= 100) return;
    warningKeys.add(key); warnings.push(warning);
  };
  const seen = new Set();
  const inline = (source, file) => {
    if (seen.has(file)) return '';
    seen.add(file);
    diagnoseWxss(source, file, warn);
    const imports = [];
    // Resolve url() against the file that declares it, before imports are flattened.
    const clean = stripComments(source)
      .replace(/@import\s+(?:url\()?\s*(['"])([^'"]+)\1\s*\)?\s*;?/gi, (_m, _q, spec) => {
        imports.push(spec);
        return `\u0000IMPORT${imports.length - 1}\u0000`;
      })
      .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, _quote, raw) => {
        const next = input.rewriteUrl(raw.trim(), file);
        return next === raw.trim() ? match : `url("${next}")`;
      });
    return clean.replace(/\u0000IMPORT(\d+)\u0000/g, (_m, index) => {
      const spec = imports[Number(index)];
      const resolved = input.resolveImport(spec, file);
      if (!resolved) {
        warn({ code: 'WXSS_IMPORT_MISSING', file, message: `@import "${spec}" was not found` });
        return '';
      }
      return inline(resolved.source, resolved.file);
    });
  };
  const expanded = inline(input.source, input.file);
  const css = compileBlocks(parseBlocks(expanded), input.scope, (raw) => raw);
  return { css, warnings };
}
