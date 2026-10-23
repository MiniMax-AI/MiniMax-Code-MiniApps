// WXML -> compact JSON AST used by the browser-side preview runtime.
// Node shape: element { t: 'e', n: tag, a: { attr: value }, c: [children] }
//             text    { t: 'x', v: text }

// WXML is XML-like: every non-self-closing component requires its closing tag.
const VOID_TAGS = new Set();
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', ensp: '\u2002', emsp: '\u2003' };

export class WxmlSyntaxError extends Error {
  constructor(message, line, column) {
    super(message);
    this.name = 'WxmlSyntaxError';
    this.line = line;
    this.column = column;
  }
}

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

function position(source, index) {
  let line = 1;
  let column = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === '\n') {
      line++;
      column = 1;
    } else column++;
  }
  return { line, column };
}

/** Reads `{{ ... }}` aware text until one of the stop characters outside mustaches. */
function readAttributeValue(source, index) {
  const quote = source[index];
  if (quote === '"' || quote === "'") {
    let i = index + 1;
    let depth = 0;
    while (i < source.length) {
      if (source.startsWith('{{', i)) {
        depth++;
        i += 2;
        continue;
      }
      if (depth > 0 && source.startsWith('}}', i)) {
        depth--;
        i += 2;
        continue;
      }
      if (source[i] === quote && depth === 0) return { value: source.slice(index + 1, i), end: i + 1 };
      i++;
    }
    // Mustache contains the quote char (e.g. "{{ a ? "x" : "y" }}") - fall back to the plain quote scan.
    const close = source.indexOf(quote, index + 1);
    if (close < 0) return null;
    return { value: source.slice(index + 1, close), end: close + 1 };
  }
  let i = index;
  while (i < source.length && !/[\s>]/.test(source[i]) && !source.startsWith('/>', i)) i++;
  return { value: source.slice(index, i), end: i };
}

export function parseWxml(source, file = 'template.wxml') {
  const root = { t: 'e', n: 'root', a: {}, c: [] };
  const stack = [root];
  let i = 0;
  const fail = (message, at) => {
    const { line, column } = position(source, at);
    throw new WxmlSyntaxError(`${file}:${line}:${column} ${message}`, line, column);
  };
  const pushText = (text) => {
    if (!text) return;
    const parent = stack[stack.length - 1];
    const keepWhitespace = parent.n === 'text' || stack.some((node) => node.n === 'text');
    if (!keepWhitespace && !text.trim()) return;
    const value = keepWhitespace ? text : text.replace(/\s+/g, ' ');
    parent.c.push({ t: 'x', v: decodeEntities(value) });
  };

  while (i < source.length) {
    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4);
      if (end < 0) fail('unterminated comment', i);
      i = end + 3;
      continue;
    }
    const top = stack[stack.length - 1];
    if (top.n === 'wxs') {
      const end = source.indexOf('</wxs', i);
      if (end < 0) fail('unterminated <wxs>', i);
      top.code = source.slice(i, end);
      i = end;
    }
    if (source[i] === '<' && source[i + 1] === '/') {
      const end = source.indexOf('>', i);
      if (end < 0) fail('unterminated closing tag', i);
      const name = source.slice(i + 2, end).trim().toLowerCase();
      const index = stack.length - 1;
      if (index === 0 || stack[index].n !== name) fail(`unexpected closing tag </${name}>`, i);
      stack.pop();
      i = end + 1;
      continue;
    }
    if (source[i] === '<' && /[a-zA-Z]/.test(source[i + 1] ?? '')) {
      let j = i + 1;
      while (j < source.length && /[\w:.-]/.test(source[j])) j++;
      const name = source.slice(i + 1, j).toLowerCase();
      const attrs = {};
      let selfClosing = false;
      while (j < source.length) {
        while (/\s/.test(source[j] ?? '')) j++;
        if (source.startsWith('/>', j)) {
          selfClosing = true;
          j += 2;
          break;
        }
        if (source[j] === '>') {
          j++;
          break;
        }
        if (j >= source.length) fail(`unterminated <${name}>`, i);
        let k = j;
        while (k < source.length && !/[\s=>]/.test(source[k]) && !source.startsWith('/>', k)) k++;
        const attrName = source.slice(j, k);
        if (!attrName) fail(`invalid attribute in <${name}>`, j);
        j = k;
        while (/\s/.test(source[j] ?? '')) j++;
        if (source[j] === '=') {
          j++;
          while (/\s/.test(source[j] ?? '')) j++;
          const read = readAttributeValue(source, j);
          if (!read) fail(`unterminated attribute ${attrName}`, j);
          attrs[attrName] = decodeEntities(read.value);
          j = read.end;
        } else {
          attrs[attrName] = true;
        }
      }
      const node = { t: 'e', n: name, a: attrs, c: [] };
      stack[stack.length - 1].c.push(node);
      if (!selfClosing && !VOID_TAGS.has(name)) stack.push(node);
      i = j;
      continue;
    }
    // Text runs until the next `<` outside a mustache, so `{{ a < b }}` stays text.
    let next = source[i] === '<' ? i + 1 : i;
    let depth = 0;
    while (next < source.length) {
      if (source.startsWith('{{', next)) {
        depth++;
        next += 2;
        continue;
      }
      if (depth > 0 && source.startsWith('}}', next)) {
        depth--;
        next += 2;
        continue;
      }
      if (depth === 0 && source[next] === '<') break;
      next++;
    }
    pushText(source.slice(i, next));
    i = next;
  }
  if (stack.length > 1) {
    const open = stack[stack.length - 1];
    fail(`unclosed <${open.n}>`, source.length);
  }
  return root.c;
}

/** Collects `<import src>` / `<include src>` / `<wxs src>` references for dependency resolution. */
export function collectReferences(nodes, result = { imports: [], includes: [], wxs: [] }) {
  for (const node of nodes) {
    if (node.t !== 'e') continue;
    if (node.n === 'import' && typeof node.a.src === 'string') result.imports.push(node.a.src);
    if (node.n === 'include' && typeof node.a.src === 'string') result.includes.push(node.a.src);
    if (node.n === 'wxs' && typeof node.a.src === 'string') result.wxs.push(node.a.src);
    collectReferences(node.c, result);
  }
  return result;
}
