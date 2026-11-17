// @ts-check
/**
 * JSON parser that also reports duplicate object keys.
 *
 * The official manifest rules state that the JSON must be an object and must not
 * contain duplicate keys (official guide §2). `JSON.parse` silently keeps the
 * last duplicate, so the key set is checked with a small recursive-descent parser.
 */

/**
 * @typedef {{ ok: true, value: unknown, duplicates: { path: string, key: string }[] }
 *  | { ok: false, error: string, duplicates: { path: string, key: string }[] }} ParseResult
 */

/**
 * @param {string} text
 * @returns {ParseResult}
 */
export function parseJsonWithDuplicates(text) {
  /** @type {{ path: string, key: string }[]} */
  const duplicates = [];
  let index = 0;

  const fail = (message) => {
    const error = new Error(`${message}（第 ${index + 1} 个字符）`);
    error.name = 'JsonParseError';
    throw error;
  };

  const skipWhitespace = () => {
    while (index < text.length && /[\s\uFEFF]/.test(text[index])) index += 1;
  };

  const parseString = () => {
    if (text[index] !== '"') fail('期望一个字符串');
    let value = '';
    index += 1;
    while (index < text.length) {
      const char = text[index];
      if (char === '"') {
        index += 1;
        return value;
      }
      if (char === '\\') {
        index += 1;
        const escape = text[index];
        if (escape === 'u') {
          const hex = text.slice(index + 1, index + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('无效的 \\u 转义');
          value += String.fromCharCode(parseInt(hex, 16));
          index += 5;
          continue;
        }
        const map = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (!(escape in map)) fail('无效的转义字符');
        value += map[escape];
        index += 1;
        continue;
      }
      value += char;
      index += 1;
    }
    return fail('字符串没有闭合');
  };

  const parseNumber = () => {
    const match = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(index));
    if (!match) fail('不是合法数字');
    index += match[0].length;
    return Number(match[0]);
  };

  /** @param {string} path */
  const parseValue = (path) => {
    skipWhitespace();
    const char = text[index];
    if (char === '{') return parseObject(path);
    if (char === '[') return parseArray(path);
    if (char === '"') return parseString();
    if (char === '-' || (char >= '0' && char <= '9')) return parseNumber();
    if (text.startsWith('true', index)) {
      index += 4;
      return true;
    }
    if (text.startsWith('false', index)) {
      index += 5;
      return false;
    }
    if (text.startsWith('null', index)) {
      index += 4;
      return null;
    }
    return fail('不是合法的 JSON 值');
  };

  /** @param {string} path */
  const parseObject = (path) => {
    index += 1;
    /** @type {Record<string, unknown>} */
    const result = {};
    /** @type {Set<string>} */
    const seen = new Set();
    skipWhitespace();
    if (text[index] === '}') {
      index += 1;
      return result;
    }
    for (;;) {
      skipWhitespace();
      const key = parseString();
      if (seen.has(key)) duplicates.push({ path: `${path}/${key}`, key });
      seen.add(key);
      skipWhitespace();
      if (text[index] !== ':') fail('键之后缺少冒号');
      index += 1;
      result[key] = parseValue(`${path}/${key}`);
      skipWhitespace();
      if (text[index] === ',') {
        index += 1;
        continue;
      }
      if (text[index] === '}') {
        index += 1;
        return result;
      }
      return fail('对象结构不完整');
    }
  };

  /** @param {string} path */
  const parseArray = (path) => {
    index += 1;
    /** @type {unknown[]} */
    const result = [];
    skipWhitespace();
    if (text[index] === ']') {
      index += 1;
      return result;
    }
    for (;;) {
      result.push(parseValue(`${path}/${result.length}`));
      skipWhitespace();
      if (text[index] === ',') {
        index += 1;
        continue;
      }
      if (text[index] === ']') {
        index += 1;
        return result;
      }
      return fail('数组结构不完整');
    }
  };

  try {
    skipWhitespace();
    if (index >= text.length) {
      return { ok: false, error: '内容为空', duplicates };
    }
    const value = parseValue('');
    skipWhitespace();
    if (index < text.length) {
      return { ok: false, error: '内容末尾存在多余字符', duplicates };
    }
    return { ok: true, value, duplicates };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, duplicates };
  }
}
