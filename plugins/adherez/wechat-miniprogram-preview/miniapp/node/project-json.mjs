function location(source, offset) {
  const before = source.slice(0, offset);
  const lines = before.split(/\r\n|\n|\r/);
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

export class ProjectJsonError extends Error {
  constructor(message, file, source, offset) {
    super(message);
    this.name = 'ProjectJsonError';
    this.code = 'INVALID_JSON';
    this.file = file;
    Object.assign(this, location(source, offset));
  }
}

// Some Node versions omit the offset in JSON.parse errors. This locator runs
// only after native parsing has failed; it never accepts or repairs a document.
function invalidOffset(source) {
  let index = 0;
  const fail = () => { throw index; };
  const space = () => { while (/[\t\r\n ]/.test(source[index] ?? 'x')) index++; };
  const string = () => {
    if (source[index] !== '"') fail();
    index++;
    while (index < source.length) {
      const char = source[index++];
      if (char === '"') return;
      if (char.charCodeAt(0) < 32) { index--; fail(); }
      if (char !== '\\') continue;
      const escaped = source[index++];
      if (escaped === 'u') {
        for (let count = 0; count < 4; count++, index++) if (!/[\da-f]/i.test(source[index] ?? 'x')) fail();
      } else if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(escaped)) { index--; fail(); }
    }
    fail();
  };
  const value = (depth = 0) => {
    space();
    if (depth > 1024) fail();
    const char = source[index];
    if (char === '"') return string();
    if (char === '{' || char === '[') {
      const close = char === '{' ? '}' : ']';
      index++; space();
      if (source[index] === close) { index++; return; }
      while (index < source.length) {
        if (char === '{') {
          string(); space();
          if (source[index] !== ':') fail();
          index++;
        }
        value(depth + 1); space();
        if (source[index] === close) { index++; return; }
        if (source[index] !== ',') fail();
        index++; space();
      }
      fail();
    }
    if (char === '-' || /\d/.test(char ?? 'x')) {
      const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(index));
      if (!number) fail();
      index += number[0].length;
      return;
    }
    const keyword = { t: 'true', f: 'false', n: 'null' }[char];
    if (keyword) {
      for (const expected of keyword) { if (source[index] !== expected) fail(); index++; }
      return;
    }
    fail();
  };
  try { value(); space(); } catch (offset) { return typeof offset === 'number' ? Math.min(offset, source.length) : index; }
  return Math.min(index, source.length);
}

// Replacing comment bytes with spaces preserves parser offsets and never changes
// quoted URLs or repairs syntax that an official JSON compiler would reject.
export function parseProjectJson(source, file) {
  const comments = [];
  let clean = '';
  let index = 0;
  while (index < source.length) {
    const start = index;
    if (source[index] === '"') {
      index++;
      while (index < source.length && source[index] !== '"') index += source[index] === '\\' ? 2 : 1;
      index = Math.min(index + 1, source.length);
    } else if (source[index] === '/' && source[index + 1] === '/') {
      index += 2;
      while (index < source.length && source[index] !== '\n' && source[index] !== '\r') index++;
      comments.push(start);
    } else if (source[index] === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      if (end < 0) throw new ProjectJsonError('Unterminated JSON block comment', file, source, start);
      index = end + 2;
      comments.push(start);
    } else {
      index++;
    }
    const chunk = source.slice(start, index);
    clean += comments.at(-1) === start ? chunk.replace(/[^\r\n]/g, ' ') : chunk;
  }
  let value;
  try {
    value = JSON.parse(clean);
  } catch (error) {
    const offset = Number(/\bposition (\d+)\b/.exec(error.message)?.[1] ?? invalidOffset(clean));
    throw new ProjectJsonError(`invalid JSON: ${error.message}`, file, source, offset);
  }
  return {
    value,
    warnings: comments.length ? [{
      code: 'NONSTANDARD_JSON_COMMENT', file, ...location(source, comments[0]),
      message: 'JSON comments are accepted for local preview only; official compilation or publishing may reject them.',
    }] : [],
  };
}
